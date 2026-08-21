/**
 * The v2 read path: compose ANY of Sourcify's 24 `fields=all` fields from the
 * normalized entities — verified_contract + compilation + code + sourcefile (+ blob
 * for the spilled tail).
 *
 * Composition is the same move Sourcify's own server makes: their Postgres stores
 * ten normalized tables and assembles stdJsonInput / stdJsonOutput / signatures per
 * request. The composition rules here were measured against 120 verbatim
 * `fields=all` records (etl/composecheck.mjs), not assumed:
 *   - stdJsonInput  = { language, sources, settings }, parts byte-equal (120/120)
 *   - JSON.stringify(metadata object) IS the compiler's metadata string (120/120)
 *   - evm.*.object  = recompiled bytecode without the 0x prefix (120/120)
 *   - signatures    = derived from the ABI, in ABI order (120/120)
 *
 * Every piece except the verified_contract itself is content-addressed and
 * immutable, so this module caches by hash: the OpenZeppelin file that appears in
 * hundreds of contracts costs one read per server instance, ever. The read FAN-OUT
 * is counted and reported, never hidden — that is the honest price of serving a
 * normalized model from a database with no server-side joins.
 */
import crypto from "node:crypto";
import { keccak256, toBytes } from "viem";
import { eq } from "@arkiv-network/sdk/query";
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
/**
 * Keyed by `${kind}:${hash}` — safe because these entities are content-addressed
 * and immutable. Bounded LRU so a scan cannot balloon the process.
 */
const CACHE_MAX = 800;
const cache = new Map<string, unknown>();
const cacheGet = (k: string) => {
  if (!cache.has(k)) return undefined;
  const v = cache.get(k);
  cache.delete(k); cache.set(k, v); // refresh recency
  return v;
};
const cacheSet = (k: string, v: unknown) => {
  cache.set(k, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
};

/** One read-fanout ledger per request. */
export type ReadLedger = { reads: number; cached: number; unavailable: string[] };
export const newLedger = (): ReadLedger => ({ reads: 0, cached: 0, unavailable: [] });

// ------------------------------------------------------------- entity reads
async function fetchByHash(kind: string, hash: string, ledger: ReadLedger): Promise<{ payload: Uint8Array; key: string } | null> {
  const q = arkiv
    .select({ key: true, owner: true, payload: true })
    .where(eq("ds", str(DATASET)), eq("kind", str(kind)), eq("hash", str(hash)))
    .limit(2);
  const withOwner = PUBLISHER ? q.ownedBy(PUBLISHER as `0x${string}`) : q;
  const page = await withOwner.fetch();
  ledger.reads++;
  const e = page.entities[0];
  if (!e?.payload) return null;
  return { payload: e.payload, key: e.key as string };
}

/** All parts of one spilled component, reassembled and VERIFIED against its hash. */
async function reassemble(spill: { hash: string; parts: number; bytes: number }, ledger: ReadLedger): Promise<unknown | undefined> {
  const ck = `blob:${spill.hash}`;
  const hit = cacheGet(ck);
  if (hit !== undefined) { ledger.cached++; return hit; }
  const q = arkiv
    .select({ key: true, payload: true, attributes: { part: true, parts: true } })
    .where(eq("ds", str(DATASET)), eq("kind", str("blob")), eq("hash", str(spill.hash)))
    .limit(200);
  const page = await (PUBLISHER ? q.ownedBy(PUBLISHER as `0x${string}`) : q).fetch();
  ledger.reads++;
  const byPart = new Map<number, Uint8Array>();
  for (const e of page.entities) {
    const raw = e.attributes?.part as { value?: unknown } | number | undefined;
    const part = Number(typeof raw === "object" && raw ? raw.value : raw);
    if (Number.isInteger(part) && e.payload && !byPart.has(part)) byPart.set(part, e.payload);
  }
  // The reader contract (review finding): exactly `parts` distinct indexes AND a
  // hash match, or an explicit unavailable — never a silently shorter component.
  if (byPart.size !== spill.parts) {
    ledger.unavailable.push(`blob ${spill.hash.slice(0, 14)}…: ${byPart.size}/${spill.parts} parts`);
    return undefined;
  }
  const ordered = [...byPart.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  const whole = Buffer.concat(ordered);
  const digest = "0x" + crypto.createHash("sha256").update(whole).digest("hex");
  if (digest !== spill.hash) {
    ledger.unavailable.push(`blob ${spill.hash.slice(0, 14)}…: hash mismatch after reassembly`);
    return undefined;
  }
  const value = JSON.parse(whole.toString("utf8"));
  cacheSet(ck, value);
  return value;
}

const isSpill = (v: unknown): v is { $spill: { hash: string; parts: number; bytes: number } } =>
  !!v && typeof v === "object" && "$spill" in (v as Record<string, unknown>);

/** A stored component, following its $spill stub when the payload budget forced one. */
async function resolve<T>(v: T, ledger: ReadLedger): Promise<T | undefined> {
  if (!isSpill(v)) return v;
  return (await reassemble(v.$spill, ledger)) as T | undefined;
}

async function getSourceContent(hash: string, ledger: ReadLedger): Promise<string | undefined> {
  const ck = `sourcefile:${hash}`;
  const hit = cacheGet(ck);
  if (hit !== undefined) { ledger.cached++; return hit as string; }
  const got = await fetchByHash("sourcefile", hash, ledger);
  if (!got) { ledger.unavailable.push(`sourcefile ${hash.slice(0, 14)}…`); return undefined; }
  const parsed = JSON.parse(Buffer.from(got.payload).toString("utf8")) as { content: unknown };
  const content = await resolve(parsed.content, ledger);
  if (typeof content !== "string") { ledger.unavailable.push(`sourcefile ${hash.slice(0, 14)}… body`); return undefined; }
  cacheSet(ck, content);
  return content;
}

async function getCodeHex(hash: string | null | undefined, ledger: ReadLedger): Promise<string | null> {
  if (!hash) return null;
  const ck = `code:${hash}`;
  const hit = cacheGet(ck);
  if (hit !== undefined) { ledger.cached++; return hit as string; }
  const got = await fetchByHash("code", hash, ledger);
  if (!got) { ledger.unavailable.push(`code ${hash.slice(0, 14)}…`); return null; }
  const hex = "0x" + Buffer.from(got.payload).toString("hex");
  cacheSet(ck, hex);
  return hex;
}

// ------------------------------------------------------------- derivations
/** ABI type string with tuples expanded — what the 4-byte hash is taken over. */
const typeOf = (t: { type?: string; components?: unknown[] }): string =>
  t.type?.startsWith("tuple")
    ? `(${((t.components ?? []) as { type?: string; components?: unknown[] }[]).map(typeOf).join(",")})${t.type.slice(5)}`
    : (t.type ?? "");

/** `signatures`, derived from the ABI in ABI order — measured identical 120/120. */
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

/** Which top-level fields force which extra reads. */
const NEEDS_COMPILATION: FieldName[] = [
  "metadata", "storageLayout", "transientStorageLayout", "userdoc", "devdoc",
  "sourceIds", "sources", "stdJsonInput", "stdJsonOutput", "creationBytecode", "runtimeBytecode",
];

/**
 * Compose the requested top-level fields for one verified_contract row. Returns the
 * body in Sourcify's shape plus the read ledger. Fields whose stored parts are
 * missing (v1 payload not yet patched, expired blob, sourcefile gap) come back
 * null, and the gap is NAMED in the ledger — the response stays Sourcify-shaped
 * while the provenance headers carry the truth.
 */
export async function composeFields(row: Row, wanted: FieldName[], ledger: ReadLedger): Promise<Json> {
  const p = (row.payload ?? {}) as Json;
  const out: Json = {};
  const want = new Set(wanted);

  // Straight from the verified_contract payload (1 read, already done).
  const direct: Partial<Record<FieldName, unknown>> = {
    match: p.match ?? null, creationMatch: p.creationMatch ?? null, runtimeMatch: p.runtimeMatch ?? null,
    chainId: p.chainId, address: p.address, verifiedAt: p.verifiedAt, matchId: p.matchId,
    abi: p.abi, compilation: p.compilation, deployment: p.deployment,
    proxyResolution: p.proxyResolution, additionalInput: p.additionalInput ?? null,
  };
  for (const [k, v] of Object.entries(direct)) if (want.has(k as FieldName)) out[k] = v;

  if (want.has("signatures")) out.signatures = deriveSignatures((p.abi as unknown[]) ?? []);

  if (!NEEDS_COMPILATION.some((f) => want.has(f))) return out;

  // The compilation entity — one dereference for every heavy field at once.
  const cpPayload = (await dereferenceByKey(row.attributes?.compilationref, ledger)) as Json | null;
  const isV2 = cpPayload?.schema === "sourcify.compilation.v2";
  if (!cpPayload || !isV2) {
    for (const f of NEEDS_COMPILATION) if (want.has(f)) out[f] = null;
    ledger.unavailable.push(cpPayload ? "compilation payload is v1 — v2 write not yet landed" : "compilation entity unreachable");
    return out;
  }

  const need = async <T,>(k: string): Promise<T | undefined> => (await resolve(cpPayload[k] as T, ledger));

  if (want.has("metadata")) out.metadata = (await need("metadata")) ?? null;
  if (want.has("storageLayout")) out.storageLayout = (await need("storageLayout")) ?? null;
  if (want.has("transientStorageLayout")) out.transientStorageLayout = (await need("transientStorageLayout")) ?? null;
  if (want.has("userdoc")) out.userdoc = (await need("userdoc")) ?? null;
  if (want.has("devdoc")) out.devdoc = (await need("devdoc")) ?? null;
  if (want.has("sourceIds")) out.sourceIds = (await need("sourceIds")) ?? null;

  // sources: dereference every unique file hash, in parallel, through the cache.
  const wantsSources = want.has("sources") || want.has("stdJsonInput");
  let sources: Record<string, { content: string }> | null = null;
  if (wantsSources) {
    const map = ((await need<Record<string, string>>("sources")) ?? {}) as Record<string, string>;
    const entries = await Promise.all(Object.entries(map).map(async ([path, hash]) => {
      const content = await getSourceContent(hash, ledger);
      return [path, content] as const;
    }));
    sources = {};
    for (const [path, content] of entries) if (content !== undefined) sources[path] = { content };
    if (want.has("sources")) out.sources = sources;
  }

  // Bytecodes: onchain from the vc's code refs, recompiled from the compilation's.
  const codeRefs = (p.codeRefs ?? {}) as Record<string, string | null>;
  const wantsCreation = want.has("creationBytecode");
  const wantsRuntime = want.has("runtimeBytecode");
  const wantsSjo = want.has("stdJsonOutput");
  const [creationOnchain, creationRecompiled, runtimeOnchain, runtimeRecompiled] = await Promise.all([
    wantsCreation ? getCodeHex(codeRefs.creationOnchain, ledger) : null,
    wantsCreation || wantsSjo ? getCodeHex((cpPayload.recompiledCreationHash as string) ?? null, ledger) : null,
    wantsRuntime ? getCodeHex(codeRefs.runtimeOnchain, ledger) : null,
    wantsRuntime || wantsSjo ? getCodeHex((cpPayload.recompiledRuntimeHash as string) ?? null, ledger) : null,
  ]);
  const cbArt = ((await need<Json>("creationCodeArtifacts")) ?? {}) as Json;
  const rbArt = ((await need<Json>("runtimeCodeArtifacts")) ?? {}) as Json;

  if (wantsCreation) {
    out.creationBytecode = {
      onchainBytecode: creationOnchain, recompiledBytecode: creationRecompiled,
      sourceMap: cbArt.sourceMap ?? null, linkReferences: cbArt.linkReferences ?? null,
      cborAuxdata: cbArt.cborAuxdata ?? null,
      transformations: p.creationTransformations ?? null, transformationValues: p.creationTransformationValues ?? null,
    };
  }
  if (wantsRuntime) {
    out.runtimeBytecode = {
      onchainBytecode: runtimeOnchain, recompiledBytecode: runtimeRecompiled,
      sourceMap: rbArt.sourceMap ?? null, linkReferences: rbArt.linkReferences ?? null,
      immutableReferences: rbArt.immutableReferences ?? null, cborAuxdata: rbArt.cborAuxdata ?? null,
      transformations: p.runtimeTransformations ?? null, transformationValues: p.runtimeTransformationValues ?? null,
    };
  }

  if (want.has("stdJsonInput")) {
    out.stdJsonInput = {
      language: cpPayload.language,
      sources: sources ?? {},
      settings: (cpPayload.compilerSettings as Json) ?? {},
    };
  }

  if (wantsSjo) {
    const fqn = String(cpPayload.fullyQualifiedName ?? "");
    const cut = fqn.lastIndexOf(":");
    const [fqPath, fqName] = cut >= 0 ? [fqn.slice(0, cut), fqn.slice(cut + 1)] : [fqn, fqn];
    const metadata = (await need("metadata")) ?? null;
    out.stdJsonOutput = {
      sources: (await need("sourceIds")) ?? {},
      contracts: {
        [fqPath]: {
          [fqName]: {
            abi: p.abi ?? [],
            // The compiler's canonical string — JSON.stringify(parsed) reproduces it
            // byte-for-byte (measured 120/120, composecheck.mjs).
            metadata: metadata == null ? null : JSON.stringify(metadata),
            userdoc: (await need("userdoc")) ?? {},
            devdoc: (await need("devdoc")) ?? {},
            storageLayout: (await need("storageLayout")) ?? null,
            transientStorageLayout: (await need("transientStorageLayout")) ?? null,
            evm: {
              bytecode: {
                object: strip0x(creationRecompiled),
                sourceMap: cbArt.sourceMap ?? null,
                linkReferences: cbArt.linkReferences ?? null,
              },
              deployedBytecode: {
                object: strip0x(runtimeRecompiled),
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
async function dereferenceByKey(entityKey: unknown, ledger: ReadLedger): Promise<Record<string, unknown> | null> {
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
  // Only a v2 payload is safely cacheable: v1 will be patched in place.
  if (payload && (payload as Json).schema === "sourcify.compilation.v2") cacheSet(ck, payload);
  return payload;
}
