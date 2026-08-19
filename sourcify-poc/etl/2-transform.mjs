/**
 * 2-transform.mjs — Sourcify record -> Arkiv entities.
 *
 * The design decision this file encodes: Sourcify's ten tables do NOT become ten
 * entity types. They become TWO, because that is what the read path actually needs.
 *
 *   verified_contract   one per (chain, address). The lookup answer + everything
 *                       worth filtering on, as typed attributes.
 *   compilation         deduplicated by compilation fingerprint, exactly as
 *                       Sourcify's `compiled_contracts` is. Referenced from
 *                       verified_contract through a `key` attribute -- the join.
 *
 * Sources and stdJsonOutput are NOT here. Not by preference: MAX_PAYLOAD_BYTES is
 * 131,072 and the median Sourcify `fields=all` record is 958,252 bytes. The
 * protocol settles that argument.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { MAX_ATTRIBUTES, MAX_PAYLOAD_BYTES, MAX_STRING_BYTES } from "@arkiv-network/sdk/attr";

const CHAIN = process.env.CHAIN ?? "130";
const DIR = path.join(import.meta.dirname, "data");
const IN = path.join(DIR, `detail-${CHAIN}.ndjson`);
const OUT_VC = path.join(DIR, `entities-verified_contract-${CHAIN}.ndjson`);
const OUT_CP = path.join(DIR, `entities-compilation-${CHAIN}.ndjson`);

const sha256 = (s) => "0x" + crypto.createHash("sha256").update(s).digest("hex");
/** String attributes are capped at 128 bytes on-chain. Truncate visibly, never silently. */
const s128 = (v) => {
  const t = String(v ?? "");
  if (Buffer.byteLength(t) <= MAX_STRING_BYTES) return t;
  let cut = t;
  while (Buffer.byteLength(cut) > MAX_STRING_BYTES - 1) cut = cut.slice(0, -1);
  return cut + "\u2026";
};
const secs = (iso) => Math.floor(new Date(iso).getTime() / 1000) || 0;
/**
 * i32 is a signed 32-bit attribute and `x | 0` wraps silently past 2,147,483,647:
 * 3e9 optimizer runs would land in the index as a negative number and quietly break
 * every range filter over it. Unichain's largest is 1e9 — inside the range, but only
 * by 2x — so this clamps and reports instead of wrapping.
 */
let clampedRuns = 0;
const i32safe = (n) => {
  const v = Math.trunc(Number(n) || 0);
  if (v > 2147483647) { clampedRuns++; return 2147483647; }
  if (v < -2147483648) { clampedRuns++; return -2147483648; }
  return v;
};

const rows = fs.readFileSync(IN, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
console.log(`in: ${rows.length} Sourcify records (chain ${CHAIN})`);

const compilations = new Map();
const vcs = [];
const oversize = [];
let truncated = 0;

for (const r of rows) {
  const c = r.compilation ?? {};
  const settings = c.compilerSettings ?? {};
  const abi = r.abi ?? [];
  const abiJson = JSON.stringify(abi);

  // --- compilation entity, deduplicated exactly like Sourcify's compiled_contracts
  const cpFingerprint = sha256(JSON.stringify([c.compiler, c.compilerVersion, c.language, c.fullyQualifiedName, settings]));
  if (!compilations.has(cpFingerprint)) {
    compilations.set(cpFingerprint, {
      kind: "compilation",
      fingerprint: cpFingerprint,
      attributes: {
        ds: "sourcify",
        kind: "compilation",
        fp: s128(cpFingerprint),
        compiler: s128(c.compiler ?? "unknown"),
        compilerVersion: s128(c.compilerVersion ?? "unknown"),
        language: s128(c.language ?? "unknown"),
        name: s128(c.name ?? ""),
        evmVersion: s128(settings.evmVersion ?? "default"),
        optimizer: Boolean(settings.optimizer?.enabled),
        optimizerRuns: Number(settings.optimizer?.runs ?? 0) | 0,
        useCount: 0, // filled below
      },
      payload: { schema: "sourcify.compilation.v1", ...c },
    });
  }
  compilations.get(cpFingerprint).attributes.useCount++;

  const proxy = r.proxyResolution ?? {};
  const dep = r.deployment ?? {};
  const fnCount = abi.filter((x) => x.type === "function").length;
  const evtCount = abi.filter((x) => x.type === "event").length;

  const attributes = {
    ds: "sourcify",                                   // authenticity marker
    kind: "verified_contract",
    chainId: BigInt(r.chainId),                       // u64 -> real numeric range queries
    address: r.address.toLowerCase(),                 // addr
    chainAddr: s128(`${r.chainId}:${r.address.toLowerCase()}`),
    match: s128(r.match ?? "null"),
    creationMatch: s128(r.creationMatch ?? "null"),
    runtimeMatch: s128(r.runtimeMatch ?? "null"),
    compiler: s128(c.compiler ?? "unknown"),
    compilerVersion: s128(c.compilerVersion ?? "unknown"),
    language: s128(c.language ?? "unknown"),
    name: s128(c.name ?? ""),
    verifiedAt: BigInt(secs(r.verifiedAt)),
    matchId: BigInt(r.matchId ?? 0),
    isProxy: Boolean(proxy.isProxy),
    proxyType: s128(proxy.proxyType ?? "none"),
    abiHash: s128(sha256(abiJson)),
    fnCount: fnCount | 0,
    evtCount: evtCount | 0,
    optimizer: Boolean(settings.optimizer?.enabled),
    optimizerRuns: i32safe(settings.optimizer?.runs),
    evmVersion: s128(settings.evmVersion ?? "default"),
    blockNumber: BigInt(dep.blockNumber ?? 0),
    deployer: (dep.deployer ?? "0x0000000000000000000000000000000000000000").toLowerCase(),
    compilationFp: s128(cpFingerprint),               // becomes a `key` ref after the compilation is written
  };
  if (Object.keys(attributes).length > MAX_ATTRIBUTES) {
    throw new Error(`attribute budget blown: ${Object.keys(attributes).length} > ${MAX_ATTRIBUTES}`);
  }
  if (s128(c.fullyQualifiedName ?? "") !== String(c.fullyQualifiedName ?? "")) truncated++;

  // Payload = the Sourcify v2 lookup answer, byte-compatible in shape.
  const payload = {
    schema: "sourcify.verifiedContract.v1",
    match: r.match, creationMatch: r.creationMatch, runtimeMatch: r.runtimeMatch,
    chainId: r.chainId, address: r.address, verifiedAt: r.verifiedAt, matchId: r.matchId,
    abi, compilation: c, deployment: dep, proxyResolution: proxy,
  };
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > MAX_PAYLOAD_BYTES) oversize.push({ address: r.address, name: c.name, bytes });
  vcs.push({ kind: "verified_contract", address: r.address, attributes, payload, bytes });
}

const w = (f, arr) => fs.writeFileSync(f, arr.map((x) => JSON.stringify(x, (k, v) => (typeof v === "bigint" ? v.toString() : v))).join("\n") + "\n");
w(OUT_VC, vcs);
w(OUT_CP, [...compilations.values()]);

const sizes = vcs.map((v) => v.bytes).sort((a, b) => a - b);
const pct = (p) => sizes[Math.floor(sizes.length * p)] ?? 0;
console.log(`
verified_contract entities : ${vcs.length}
compilation entities       : ${compilations.size}  (dedup ${(1 - compilations.size / Math.max(vcs.length,1)).toLocaleString("en-US",{style:"percent",maximumFractionDigits:1})} -- Sourcify's own ratio is ~87%)
attributes per entity      : ${Object.keys(vcs[0]?.attributes ?? {}).length} / ${MAX_ATTRIBUTES}
names truncated at 128 B   : ${truncated}
optimizer runs clamped     : ${clampedRuns}
payload bytes  p50 ${pct(0.5).toLocaleString()}  p95 ${pct(0.95).toLocaleString()}  max ${(sizes.at(-1)??0).toLocaleString()}  (limit ${MAX_PAYLOAD_BYTES.toLocaleString()})
OVER THE LIMIT             : ${oversize.length}${oversize.length ? " -> " + oversize.slice(0,5).map(o=>`${o.name} ${o.bytes.toLocaleString()}B`).join(", ") : ""}
total on-chain bytes       : ${(sizes.reduce((a,b)=>a+b,0)/1e6).toFixed(2)} MB
`);
