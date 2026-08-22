/**
 * The v2 read path: compose ANY of Sourcify's 24 `fields=all` fields from the
 * normalized entities — verified_contract + compilation + code + sourcefile (+ blob
 * for the spilled tail) — and say, per field, exactly which entities built it.
 *
 * Composition is the same move Sourcify's own server makes: their Postgres stores
 * ten normalized tables and assembles stdJsonInput / stdJsonOutput / signatures per
 * request. The composition rules here were measured against 120 verbatim
 * `fields=all` records (etl/composecheck.mjs), not assumed:
 *   - stdJsonInput  = { language, sources, settings }, parts byte-equal (120/120)
 *   - JSON.stringify(metadata object) IS the compiler's metadata string (120/120)
 *   - evm.*.object  = recompiled bytecode without the 0x prefix (120/120)
 *   - signatures    = derived from the ABI, in ABI order (120/120 as sets)
 *
 * Reads are BATCHED: content-addressed pieces are fetched with one `or(eq(hash)…)`
 * query per ~20 hashes instead of one read each — a 93-file contract costs ~6
 * queries, not 93, which matters on a devnet that meters anonymous callers at
 * 50 requests/hour. Every piece except the verified_contract is immutable, so an
 * in-process LRU makes repeats free. The fan-out is counted and reported.
 */
import crypto from "node:crypto";
import { keccak256, toBytes } from "viem";
import { eq, or } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/attr";
import { arkiv, DATASET, PUBLISHER, type Row } from "./arkiv";

/** Every field name `fields=` accepts, in Sourcify's own response order. */
export const ALL_FIELDS = [
  "matchId", "creationMatch", "runtimeMatch", "verifiedAt", "creationBytecode",
  "runtimeBytecode", "deployment", "sources", "compilation", "abi", "metadata",
  "storageLayout", "transientStorageLayout", "userdoc", "devdoc", "sourceIds",
  "additionalInput", "stdJsonInput", "stdJsonOutput", "signatures",
  "proxyResolution", "match", "chainId", "address",
] as const;
export type FieldName = (typeof ALL_FIELDS)[number];

/** The default (no `fields=`) projection — Sourcify's minimal response. */
export const MINIMAL: FieldName[] = ["match", "creationMatch", "runtimeMatch", "chainId", "address", "verifiedAt", "matchId"];

// ------------------------------------------------------------- content cache
const CACHE_MAX = 800;
const cache = new Map<string, unknown>();
const cacheGet = (k: string) => {
  if (!cache.has(k)) return undefined;
  const v = cache.get(k);
  cache.delete(k); cache.set(k, v);
  return v;
};
const cacheSet = (k: string, v: unknown) => {
  cache.set(k, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
};

/** One contributing entity, as the UI shows it. */
export type Prov = { kind: string; key?: string; hash?: string; bytes: number; parts?: number; note?: string };
/** One read-fanout ledger per request, plus per-field provenance. */
export type ReadLedger = { reads: number; cached: number; unavailable: string[]; prov: Record<string, Prov[]> };
export const newLedger = (): ReadLedger => ({ reads: 0, cached: 0, unavailable: [], prov: {} });
const addProv = (ledger: ReadLedger, field: string, p: Prov) => {
  (ledger.prov[field] ??= []);
  if (!ledger.prov[field].some((x) => x.kind === p.kind && (x.key ?? x.hash) === (p.key ?? p.hash) && x.note === p.note)) ledger.prov[field].push(p);
};

// ------------------------------------------------------------- batched reads
type Piece = { payload: Uint8Array; key: string; hash: string };

/**
 * Fetch many content-addressed entities of one kind in few queries:
 * `kind = K AND (hash = a OR hash = b OR …)`, ≤20 hashes per query (the node
 * budgets predicate count; 20 is comfortably inside it and keeps a payload-bearing
 * page well under the 200-row cap). Results land in the cache individually.
 */
async function fetchManyByHash(kind: string, hashes: string[], ledger: ReadLedger): Promise<Map<string, Piece>> {
  const out = new Map<string, Piece>();
  const missing: string[] = [];
  for (const h of hashes) {
    const hit = cacheGet(`piece:${kind}:${h}`) as Piece | undefined;
    if (hit) { out.set(h, hit); ledger.cached++; } else missing.push(h);
  }
  for (let i = 0; i < missing.length; i += 20) {
    const chunk = missing.slice(i, i + 20);
    const hashPred = chunk.length === 1 ? eq("hash", str(chunk[0])) : or(...chunk.map((h) => eq("hash", str(h))));
    const q = arkiv
      .select({ key: true, owner: true, payload: true, attributes: { hash: true } })
      .where(eq("ds", str(DATASET)), eq("kind", str(kind)), hashPred)
      .limit(200);
    const page = await (PUBLISHER ? q.ownedBy(PUBLISHER as `0x${string}`) : q).fetch();
    ledger.reads++;
    for (const e of page.entities) {
      const raw = e.attributes?.hash as { value?: unknown } | string | undefined;
      const h = String(typeof raw === "object" && raw ? raw.value : raw);
      if (!e.payload || out.has(h)) continue;
      const piece = { payload: e.payload, key: e.key as string, hash: h };
      out.set(h, piece);
      cacheSet(`piece:${kind}:${h}`, piece);
    }
  }
  return out;
}

/** All parts of one spilled component, reassembled and VERIFIED against its hash. */
async function reassemble(spill: { hash: string; parts: number; bytes: number }, ledger: ReadLedger): Promise<{ value: unknown; keys: string[] } | undefined> {
  const ck = `blob:${spill.hash}`;
  const hit = cacheGet(ck) as { value: unknown; keys: string[] } | undefined;
  if (hit !== undefined) { ledger.cached++; return hit; }
  const q = arkiv
    .select({ key: true, payload: true, attributes: { part: true, parts: true } })
    .where(eq("ds", str(DATASET)), eq("kind", str("blob")), eq("hash", str(spill.hash)))
    .limit(200);
  const page = await (PUBLISHER ? q.ownedBy(PUBLISHER as `0x${string}`) : q).fetch();
  ledger.reads++;
  const byPart = new Map<number, { payload: Uint8Array; key: string }>();
  for (const e of page.entities) {
    const raw = e.attributes?.part as { value?: unknown } | number | undefined;
    const part = Number(typeof raw === "object" && raw ? raw.value : raw);
    if (Number.isInteger(part) && e.payload && !byPart.has(part)) byPart.set(part, { payload: e.payload, key: e.key as string });
  }
  // The reader contract: exactly `parts` distinct indexes AND a hash match, or an
  // explicit unavailable — never a silently shorter component.
  if (byPart.size !== spill.parts) {
    ledger.unavailable.push(`blob ${spill.hash.slice(0, 14)}...: ${byPart.size}/${spill.parts} parts`);
    return undefined;
  }
  const ordered = [...byPart.entries()].sort((a, b) => a[0] - b[0]);
  const whole = Buffer.concat(ordered.map(([, p]) => p.payload));
  const digest = "0x" + crypto.createHash("sha256").update(whole).digest("hex");
  if (digest !== spill.hash) {
    ledger.unavailable.push(`blob ${spill.hash.slice(0, 14)}...: hash mismatch after reassembly`);
    return undefined;
  }
  const result = { value: JSON.parse(whole.toString("utf8")), keys: ordered.map(([, p]) => p.key) };
  cacheSet(ck, result);
  return result;
}

const isSpill = (v: unknown): v is { $spill: { hash: string; parts: number; bytes: number } } =>
  !!v && typeof v === "object" && "$spill" in (v as Record<string, unknown>);

/** A stored component, following its $spill stub when the payload budget forced one. */
async function resolve<T>(v: T, ledger: ReadLedger, field?: string): Promise<T | undefined> {
  if (!isSpill(v)) return v;
  const got = await reassemble(v.$spill, ledger);
  if (got && field) addProv(ledger, field, { kind: "blob", hash: v.$spill.hash, bytes: v.$spill.bytes, parts: v.$spill.parts, note: `${v.$spill.parts} chunk entities, hash-verified` });
  return got?.value as T | undefined;
}

// ------------------------------------------------------------- derivations
const typeOf = (t: { type?: string; components?: unknown[] }): string =>
  t.type?.startsWith("tuple")
    ? `(${((t.components ?? []) as { type?: string; components?: unknown[] }[]).map(typeOf).join(",")})${t.type.slice(5)}`
    : (t.type ?? "");

/** `signatures`, derived from the ABI in ABI order — measured identical as sets 120/120. */
export function deriveSignatures(abi: unknown[]) {
  const out: Record<"function" | "event" | "error", { signature: string; signatureHash32: string; signatureHash4: string }[]> =
    { function: [], event: [], error: [] };
  const seen = new Set<string>();
  for (const x of (abi ?? []) as { type?: string; name?: string; inputs?: unknown[] }[]) {
    if (x.type !== "function" && x.type !== "event" && x.type !== "error") continue;
    const s = `${x.name}(${((x.inputs ?? []) as { type?: string }[]).map(typeOf).join(",")})`;
    const dedupKey = `${x.type}|${s}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const h = keccak256(toBytes(s));
    out[x.type as "function"].push({ signature: s, signatureHash4: h.slice(0, 10), signatureHash32: h });
  }
  return out;
}

// ------------------------------------------------------------- composition
type Json = Record<string, unknown>;
const strip0x = (h: string | null) => (h ? h.replace(/^0x/, "") : null);
const jbytes = (v: unknown) => (v == null ? 0 : Buffer.byteLength(JSON.stringify(v)));

const NEEDS_COMPILATION: FieldName[] = [
  "metadata", "storageLayout", "transientStorageLayout", "userdoc", "devdoc",
  "sourceIds", "sources", "stdJsonInput", "stdJsonOutput", "creationBytecode", "runtimeBytecode",
];

/**
 * Compose the requested top-level fields for one verified_contract row. Returns the
 * body in Sourcify's shape; the ledger carries reads, gaps, and per-field provenance.
 */
export async function composeFields(row: Row, wanted: FieldName[], ledger: ReadLedger): Promise<Json> {
  const p = (row.payload ?? {}) as Json;
  const out: Json = {};
  const want = new Set(wanted);
  const vcProv = (field: string, v: unknown, note?: string) => addProv(ledger, field, { kind: "verified_contract", key: row.key, bytes: jbytes(v), note });

  const direct: Partial<Record<FieldName, unknown>> = {
    match: p.match ?? null, creationMatch: p.creationMatch ?? null, runtimeMatch: p.runtimeMatch ?? null,
    chainId: p.chainId, address: p.address, verifiedAt: p.verifiedAt, matchId: p.matchId,
    abi: p.abi, compilation: p.compilation, deployment: p.deployment,
    proxyResolution: p.proxyResolution, additionalInput: p.additionalInput ?? null,
  };
  for (const [k, v] of Object.entries(direct)) if (want.has(k as FieldName)) { out[k] = v; vcProv(k, v, `payload.${k}`); }

  if (want.has("signatures")) {
    out.signatures = deriveSignatures((p.abi as unknown[]) ?? []);
    vcProv("signatures", p.abi, "derived from payload.abi at read time");
  }

  if (!NEEDS_COMPILATION.some((f) => want.has(f))) return out;

  const cpKey = typeof row.attributes?.compilationref === "string" ? row.attributes.compilationref : null;
  const cpPayload = (await dereferenceByKey(cpKey, ledger)) as Json | null;
  const isV2 = cpPayload?.schema === "sourcify.compilation.v2";
  if (!cpPayload || !isV2) {
    for (const f of NEEDS_COMPILATION) if (want.has(f)) out[f] = null;
    ledger.unavailable.push(cpPayload ? "compilation payload is v1 -- v2 write not yet landed" : "compilation entity unreachable");
    return out;
  }
  const cpProv = (field: string, component: string) =>
    addProv(ledger, field, { kind: "compilation", key: cpKey ?? undefined, bytes: jbytes(cpPayload[component]), note: `payload.${component}` });

  const need = async <T,>(field: string, k: string): Promise<T | undefined> => {
    cpProv(field, k);
    return await resolve(cpPayload[k] as T, ledger, field);
  };

  if (want.has("metadata")) out.metadata = (await need("metadata", "metadata")) ?? null;
  if (want.has("storageLayout")) out.storageLayout = (await need("storageLayout", "storageLayout")) ?? null;
  if (want.has("transientStorageLayout")) out.transientStorageLayout = (await need("transientStorageLayout", "transientStorageLayout")) ?? null;
  if (want.has("userdoc")) out.userdoc = (await need("userdoc", "userdoc")) ?? null;
  if (want.has("devdoc")) out.devdoc = (await need("devdoc", "devdoc")) ?? null;
  if (want.has("sourceIds")) out.sourceIds = (await need("sourceIds", "sourceIds")) ?? null;

  // sources: every unique file hash in batched queries, through the cache.
  const wantsSources = want.has("sources") || want.has("stdJsonInput");
  let sources: Record<string, { content: string }> | null = null;
  if (wantsSources) {
    const field = want.has("sources") ? "sources" : "stdJsonInput";
    const map = ((await need<Record<string, string>>(field, "sources")) ?? {}) as Record<string, string>;
    const pieces = await fetchManyByHash("sourcefile", [...new Set(Object.values(map))], ledger);
    sources = {};
    for (const [path, hash] of Object.entries(map)) {
      const piece = pieces.get(hash);
      if (!piece) { ledger.unavailable.push(`sourcefile ${hash.slice(0, 14)}...`); continue; }
      const parsed = JSON.parse(Buffer.from(piece.payload).toString("utf8")) as { content: unknown };
      const content = await resolve(parsed.content, ledger, "sources");
      if (typeof content !== "string") { ledger.unavailable.push(`sourcefile ${hash.slice(0, 14)}... body`); continue; }
      sources[path] = { content };
      for (const f of ["sources", "stdJsonInput"]) if (want.has(f as FieldName)) addProv(ledger, f, { kind: "sourcefile", key: piece.key, hash, bytes: piece.payload.length, note: path });
    }
    if (want.has("sources")) out.sources = sources;
  }

  // Bytecodes: onchain from the vc's code refs, recompiled from the compilation's.
  const codeRefs = (p.codeRefs ?? {}) as Record<string, string | null>;
  const wantsCreation = want.has("creationBytecode");
  const wantsRuntime = want.has("runtimeBytecode");
  const wantsSjo = want.has("stdJsonOutput");
  const needed: Record<string, string | null> = {
    creationOnchain: wantsCreation ? codeRefs.creationOnchain ?? null : null,
    creationRecompiled: wantsCreation || wantsSjo ? (cpPayload.recompiledCreationHash as string) ?? null : null,
    runtimeOnchain: wantsRuntime ? codeRefs.runtimeOnchain ?? null : null,
    runtimeRecompiled: wantsRuntime || wantsSjo ? (cpPayload.recompiledRuntimeHash as string) ?? null : null,
  };
  const codePieces = await fetchManyByHash("code", [...new Set(Object.values(needed).filter(Boolean) as string[])], ledger);
  const hexOf = (h: string | null, field: string, role: string) => {
    if (!h) return null;
    const piece = codePieces.get(h);
    if (!piece) { ledger.unavailable.push(`code ${h.slice(0, 14)}...`); return null; }
    addProv(ledger, field, { kind: "code", key: piece.key, hash: h, bytes: piece.payload.length, note: role });
    return "0x" + Buffer.from(piece.payload).toString("hex");
  };
  const cbArt = ((await resolve(cpPayload.creationCodeArtifacts as Json, ledger)) ?? {}) as Json;
  const rbArt = ((await resolve(cpPayload.runtimeCodeArtifacts as Json, ledger)) ?? {}) as Json;

  if (wantsCreation) {
    cpProv("creationBytecode", "creationCodeArtifacts");
    vcProv("creationBytecode", { t: p.creationTransformations, v: p.creationTransformationValues }, "payload.creationTransformations");
    out.creationBytecode = {
      onchainBytecode: hexOf(needed.creationOnchain, "creationBytecode", "onchain creation code"),
      recompiledBytecode: hexOf(needed.creationRecompiled, "creationBytecode", "recompiled creation code"),
      sourceMap: cbArt.sourceMap ?? null, linkReferences: cbArt.linkReferences ?? null,
      cborAuxdata: cbArt.cborAuxdata ?? null,
      transformations: p.creationTransformations ?? null, transformationValues: p.creationTransformationValues ?? null,
    };
  }
  if (wantsRuntime) {
    cpProv("runtimeBytecode", "runtimeCodeArtifacts");
    vcProv("runtimeBytecode", { t: p.runtimeTransformations, v: p.runtimeTransformationValues }, "payload.runtimeTransformations");
    out.runtimeBytecode = {
      onchainBytecode: hexOf(needed.runtimeOnchain, "runtimeBytecode", "onchain runtime code"),
      recompiledBytecode: hexOf(needed.runtimeRecompiled, "runtimeBytecode", "recompiled runtime code"),
      sourceMap: rbArt.sourceMap ?? null, linkReferences: rbArt.linkReferences ?? null,
      immutableReferences: rbArt.immutableReferences ?? null, cborAuxdata: rbArt.cborAuxdata ?? null,
      transformations: p.runtimeTransformations ?? null, transformationValues: p.runtimeTransformationValues ?? null,
    };
  }

  if (want.has("stdJsonInput")) {
    cpProv("stdJsonInput", "compilerSettings");
    out.stdJsonInput = { language: cpPayload.language, sources: sources ?? {}, settings: (cpPayload.compilerSettings as Json) ?? {} };
  }

  if (wantsSjo) {
    const fqn = String(cpPayload.fullyQualifiedName ?? "");
    const cut = fqn.lastIndexOf(":");
    const [fqPath, fqName] = cut >= 0 ? [fqn.slice(0, cut), fqn.slice(cut + 1)] : [fqn, fqn];
    const metadata = (await need("stdJsonOutput", "metadata")) ?? null;
    for (const c of ["sourceIds", "userdoc", "devdoc", "storageLayout", "transientStorageLayout", "creationCodeArtifacts", "runtimeCodeArtifacts"]) cpProv("stdJsonOutput", c);
    vcProv("stdJsonOutput", p.abi, "payload.abi");
    out.stdJsonOutput = {
      sources: (await resolve(cpPayload.sourceIds, ledger, "stdJsonOutput")) ?? {},
      contracts: {
        [fqPath]: {
          [fqName]: {
            abi: p.abi ?? [],
            metadata: metadata == null ? null : JSON.stringify(metadata),
            userdoc: (await resolve(cpPayload.userdoc, ledger)) ?? {},
            devdoc: (await resolve(cpPayload.devdoc, ledger)) ?? {},
            storageLayout: (await resolve(cpPayload.storageLayout, ledger)) ?? null,
            transientStorageLayout: (await resolve(cpPayload.transientStorageLayout, ledger)) ?? null,
            evm: {
              bytecode: {
                object: strip0x(hexOf(needed.creationRecompiled, "stdJsonOutput", "recompiled creation code")),
                sourceMap: cbArt.sourceMap ?? null,
                linkReferences: cbArt.linkReferences ?? null,
              },
              deployedBytecode: {
                object: strip0x(hexOf(needed.runtimeRecompiled, "stdJsonOutput", "recompiled runtime code")),
                sourceMap: rbArt.sourceMap ?? null,
                linkReferences: rbArt.linkReferences ?? null,
                immutableReferences: rbArt.immutableReferences ?? null,
              },
            },
          },
        },
      },
    };
  }

  return out;
}

/** getEntity has no owner filter — check ownership AFTER the fetch (see lib/arkiv.ts). */
export async function dereferenceByKey(entityKey: unknown, ledger: ReadLedger): Promise<Record<string, unknown> | null> {
  if (typeof entityKey !== "string" || !entityKey) return null;
  const ck = `cp:${entityKey}`;
  const hit = cacheGet(ck);
  if (hit !== undefined) { ledger.cached++; return hit as Record<string, unknown>; }
  let entity;
  try {
    entity = await arkiv.getEntity(entityKey as `0x${string}`);
    ledger.reads++;
  } catch {
    ledger.reads++;
    return null;
  }
  if (PUBLISHER && entity.owner?.toLowerCase() !== PUBLISHER) return null;
  let payload: Record<string, unknown> | null = null;
  try { payload = entity.toJson?.() ?? null; } catch { payload = null; }
  if (payload && (payload as Json).schema === "sourcify.compilation.v2") cacheSet(ck, payload);
  return payload;
}

// ------------------------------------------------------------- the entity graph
export type GraphNode = {
  id: string; kind: string; key?: string; hash?: string; label: string; bytes?: number;
  attrs?: number; components?: { name: string; bytes: number; spilled?: { hash: string; parts: number; bytes: number } }[];
  children: GraphNode[];
};

/**
 * One contract, as the entities that physically hold it: verified_contract →
 * compilation → its source files, its bytecodes, and any blob parts the payload
 * budget forced. Built with the same batched reads as the record itself.
 */
export async function buildGraph(row: Row, ledger: ReadLedger): Promise<GraphNode> {
  const p = (row.payload ?? {}) as Json;
  const root: GraphNode = {
    id: "vc", kind: "verified_contract", key: row.key, label: String(row.attributes?.name ?? row.attributes?.address ?? "verified_contract"),
    bytes: jbytes(row.payload), attrs: Object.keys(row.attributes ?? {}).length,
    components: ["abi", "compilation", "deployment", "proxyResolution", "creationTransformations", "runtimeTransformations", "codeRefs"]
      .filter((k) => p[k] != null).map((k) => ({ name: k, bytes: jbytes(p[k]) })),
    children: [],
  };
  const cpKey = typeof row.attributes?.compilationref === "string" ? row.attributes.compilationref : null;
  const cp = (await dereferenceByKey(cpKey, ledger)) as Json | null;
  if (!cp) return root;
  const isV2 = cp.schema === "sourcify.compilation.v2";
  const cpNode: GraphNode = {
    id: "cp", kind: "compilation", key: cpKey ?? undefined, label: String(cp.fullyQualifiedName ?? cp.name ?? "compilation"),
    bytes: jbytes(cp), attrs: 11,
    components: Object.entries(cp).filter(([k]) => k !== "schema").map(([k, v]) => ({
      name: k, bytes: jbytes(v),
      ...(isSpill(v) ? { spilled: v.$spill } : {}),
    })),
    children: [],
  };
  root.children.push(cpNode);
  if (!isV2) { cpNode.label += " (v1 payload — v2 write not yet landed)"; return root; }

  const map = (cp.sources ?? {}) as Record<string, string>;
  const hashes = [...new Set(Object.values(map))];
  const pieces = await fetchManyByHash("sourcefile", hashes, ledger);
  const sfNode: GraphNode = { id: "sources", kind: "group", label: `${hashes.length} unique source files · ${Object.keys(map).length} paths`, children: [] };
  for (const [path, hash] of Object.entries(map)) {
    const piece = pieces.get(hash);
    const child: GraphNode = { id: `sf:${hash}:${path}`, kind: "sourcefile", key: piece?.key, hash, label: path, bytes: piece?.payload.length, children: [] };
    if (piece) {
      try {
        const parsed = JSON.parse(Buffer.from(piece.payload).toString("utf8")) as { content: unknown };
        if (isSpill(parsed.content)) child.children.push({ id: `blob:${parsed.content.$spill.hash}`, kind: "blob", hash: parsed.content.$spill.hash, label: `${parsed.content.$spill.parts} chunks · ${parsed.content.$spill.bytes.toLocaleString()} B, hash-verified on read`, bytes: parsed.content.$spill.bytes, children: [] });
      } catch { /* malformed — shown without children */ }
    } else child.label += " (not landed yet)";
    sfNode.children.push(child);
  }
  cpNode.children.push(sfNode);

  const codeRefs = (p.codeRefs ?? {}) as Record<string, string | null>;
  const roles: [string, string | null][] = [
    ["onchain creation", codeRefs.creationOnchain ?? null],
    ["recompiled creation", (cp.recompiledCreationHash as string) ?? null],
    ["onchain runtime", codeRefs.runtimeOnchain ?? null],
    ["recompiled runtime", (cp.recompiledRuntimeHash as string) ?? null],
  ];
  const codeHashes = [...new Set(roles.map(([, h]) => h).filter(Boolean) as string[])];
  const codePieces = await fetchManyByHash("code", codeHashes, ledger);
  const codeNode: GraphNode = { id: "codes", kind: "group", label: `${codeHashes.length} unique bytecodes · ${roles.filter(([, h]) => h).length} uses (onchain / recompiled × creation / runtime)`, children: [] };
  for (const h of codeHashes) {
    const piece = codePieces.get(h);
    codeNode.children.push({
      id: `code:${h}`, kind: "code", key: piece?.key, hash: h,
      label: roles.filter(([, x]) => x === h).map(([r]) => r).join(" = ") + (piece ? "" : " (not landed yet)"),
      bytes: piece?.payload.length, children: [],
    });
  }
  root.children.push(codeNode);

  for (const [k, v] of Object.entries(cp)) {
    if (isSpill(v)) cpNode.children.push({ id: `blob:${v.$spill.hash}`, kind: "blob", hash: v.$spill.hash, label: `${k}: ${v.$spill.parts} chunks · ${v.$spill.bytes.toLocaleString()} B`, bytes: v.$spill.bytes, children: [] });
  }
  return root;
}
