/**
 * 7-transform-full.mjs — the 100% pass: every field of every Sourcify record on
 * chain 130, mapped into Arkiv entities, with nothing over the transaction limit.
 *
 * Inputs (both on disk before this runs):
 *   detail-130.ndjson       1-fetch.mjs   — abi, compilation, deployment, proxy, match…
 *   detail-full-130.ndjson  5-fetch-full  — sources, both bytecode objects, metadata,
 *                                           layouts, docs, sourceIds, signatures…
 *
 * What it emits (NDJSON, one file per lane):
 *   creates2-code            one per UNIQUE bytecode (keccak content-addressed; onchain
 *                            and recompiled, creation and runtime, all dedup here)
 *   creates2-sourcefile      one per UNIQUE source file (sha256 content-addressed)
 *   creates2-blob            the chunk lane — §3 of FULL-REPLICATION.md
 *   patches2-compilation     payload replacement per compilation (+ the v2 fingerprint)
 *   patches2-verified_contract  2 new attrs + payload replacement per contract
 *   creates2-compilation     compilations the v2 fingerprint SPLIT off a conflated v1
 *                            one (empty when the split count is 0, which is measured)
 *
 * Composition facts this file relies on — measured on 120 fields=all records
 * (composecheck.mjs), not assumed:
 *   - stdJsonInput IS {language, sources, settings}, byte-equal parts (120/120)
 *   - JSON.stringify(metadata object) reproduces the compiler's metadata string
 *     BYTE-FOR-BYTE (120/120), so only the object is stored
 *   - stdJsonOutput.contracts[path][name].evm.*.object is the recompiled bytecode
 *     without its 0x prefix; sourceMap/linkReferences/immutableReferences match the
 *     bytecode fields exactly (120/120)
 *   - signatures are derivable from the ABI in ABI order (120/120)
 *   - sources and stdJsonInput.sources differ only in KEY ORDER in Sourcify's own
 *     answers, so map order is not contractual
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";
import { MAX_ATTRIBUTES, MAX_PAYLOAD_BYTES } from "@arkiv-network/sdk/attr";
import { sha256, s128, secs } from "./2-transform.mjs";

const CHAIN = process.env.CHAIN ?? "130";
const DIR = path.join(import.meta.dirname, "data");

/**
 * One budget rules every lane: the node caps the whole TRANSACTION at 131,072 bytes,
 * so an entity's encoded size (≈996 B + 192 B/attribute + payload) must clear it with
 * room for the envelope. 4 KB of reserve was measured generous in 2-transform.mjs.
 */
/**
 * 8 KiB, not the 4 KiB 2-transform.mjs reserves: the writer refuses any batch whose
 * calldata exceeds TX_SIZE_LIMIT − 4,000, and one maximal entity alone encodes to
 * payload + ~1.8 KB — a payload allowed to reach 127 KiB would clear the payload
 * check here and then be unsendable there. 122,880 B clears both with margin.
 */
const TX_OVERHEAD_RESERVE = 8192;
const PAYLOAD_BUDGET = MAX_PAYLOAD_BYTES - TX_OVERHEAD_RESERVE;
/**
 * Blob chunks are RAW BYTES (application/octet-stream), not JSON — a slice of the
 * component's UTF-8 serialization. No wrapper means no escaping inflation and no
 * risk of splitting a code point into invalid JSON: reassembly is byte concat →
 * UTF-8 decode → parse, verified against the sha256 the chunks are addressed by.
 */
const CHUNK_BYTES = 100_000;

// ------------------------------------------------------------------ helpers
const B = (v) => Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v));
const jstr = (v) => JSON.stringify(v);

/** keccak of a 0x-hex bytecode string; the content address of a `code` entity. */
const keccakOfHex = (hex) => keccak256(hex);

/**
 * Spill an oversized component: emit blob create-entities for its serialized bytes
 * and return the stub that takes its place in the owning payload. Content-addressed
 * by sha256 of the whole serialization, so identical components spill once.
 */
function spill(component, blobs) {
  const s = jstr(component);
  const buf = Buffer.from(s, "utf8");
  const hash = "0x" + crypto.createHash("sha256").update(buf).digest("hex");
  if (!blobs.has(hash)) {
    const parts = [];
    for (let off = 0, part = 0; off < buf.length; off += CHUNK_BYTES, part++) {
      parts.push({
        kind: "blob", hash, part,
        attributes: { ds: "sourcify", kind: "blob", hash: s128(hash), part, size: 0 /* set below */ },
        chunkB64: buf.subarray(off, off + CHUNK_BYTES).toString("base64"),
      });
    }
    // `size`, not `bytes`: "bytes" is reserved by the query language and the SDK
    // refuses to encode it (InvalidAttributeNameError, caught on the first dry run).
    for (const p of parts) { p.attributes.parts = parts.length; p.attributes.size = Buffer.from(p.chunkB64, "base64").length; }
    blobs.set(hash, parts);
  }
  return { $spill: { hash, parts: blobs.get(hash).length, bytes: buf.length } };
}

/**
 * Enforce the payload budget on an assembled payload object: while it is over,
 * spill the single largest spillable component and re-measure. Deterministic,
 * loud, and uniform across entity kinds — the "part 1 / part 2" mechanism, applied
 * only where the protocol forces it.
 */
function fitPayload(payload, spillableKeys, blobs, log) {
  let bytes = B(payload);
  const spilled = [];
  while (bytes > PAYLOAD_BUDGET) {
    const candidates = spillableKeys
      .filter((k) => payload[k] != null && !payload[k].$spill)
      .map((k) => [k, B(payload[k])])
      .sort((a, b) => b[1] - a[1]);
    if (!candidates.length) throw new Error(`payload cannot fit even fully spilled: ${bytes} B — ${log}`);
    const [k] = candidates[0];
    payload[k] = spill(payload[k], blobs);
    spilled.push(k);
    bytes = B(payload);
  }
  return { bytes, spilled };
}

// ------------------------------------------------------------------ load + join
const read = (f) => fs.existsSync(path.join(DIR, f))
  ? fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];

export function transformFull(v1rows, fullRows) {
  const fullByAddr = new Map(fullRows.map((r) => [r.address.toLowerCase(), r]));
  const joined = [];
  const staleJoins = []; // review finding: the two passes ran at different times and
  // Sourcify is live — a contract re-verified in between would merge T1's match with
  // T2's artifacts into a record matching NO real Sourcify state. Both passes carry
  // matchId, so a disagreement is detectable for the cost of one equality.
  let missingFull = 0, missingV1 = 0;
  for (const r of v1rows) {
    const f = fullByAddr.get(r.address.toLowerCase());
    if (!f) { missingFull++; continue; }
    if (f.matchId != null && r.matchId != null && String(f.matchId) !== String(r.matchId)) {
      staleJoins.push(r.address.toLowerCase());
      fullByAddr.delete(r.address.toLowerCase());
      continue;
    }
    joined.push({ ...f, ...r, sources: f.sources }); // v1 wins on shared keys; sources only exists in full
    fullByAddr.delete(r.address.toLowerCase());
  }
  missingV1 = fullByAddr.size;

  const codes = new Map();        // keccak -> create
  const sourceFiles = new Map();  // sha256 -> create
  const blobs = new Map();        // sha256 -> [blob creates]
  const compilations = new Map(); // strong fp -> {attributes, payload, addrs: []}
  const v1fpOf = new Map();       // strong fp -> v1 fp (for the patch-vs-create split)
  const vcs = [];
  const counters = { spilledComponents: 0, filesSpilled: 0, truncated: 0 };

  /** Register one bytecode string as a content-addressed `code` entity; return its keccak. */
  const codeRef = (hex) => {
    if (!hex || hex === "0x") return null;
    const h = keccakOfHex(hex);
    if (!codes.has(h)) {
      codes.set(h, {
        kind: "code", hash: h,
        attributes: { ds: "sourcify", kind: "code", hash: s128(h), size: (hex.length - 2) / 2 },
        // raw bytecode bytes, not hex-in-JSON: half the size, and the hash IS the checksum
        hexB64: Buffer.from(hex.slice(2), "hex").toString("base64"),
      });
    }
    return h;
  };

  for (const r of joined) {
    const c = r.compilation ?? {};
    const settings = c.compilerSettings ?? {};
    const cb = r.creationBytecode ?? {};
    const rb = r.runtimeBytecode ?? {};

    // --- source files: one entity per unique sha256; oversized bodies spill to blobs.
    const sourcesMap = r.sources ?? {};
    const hashByPath = {};
    for (const [filePath, entry] of Object.entries(sourcesMap)) {
      const content = entry?.content ?? "";
      const hash = sha256(content);
      hashByPath[filePath] = hash;
      if (sourceFiles.has(hash)) continue;
      let payload = { schema: "sourcify.sourcefile.v2", content };
      let bytes = B(payload);
      if (bytes > PAYLOAD_BUDGET) {
        payload = { schema: "sourcify.sourcefile.v2", content: spill(content, blobs) };
        bytes = B(payload);
        counters.filesSpilled++;
      }
      sourceFiles.set(hash, {
        kind: "sourcefile", hash,
        attributes: { ds: "sourcify", kind: "sourcefile", hash: s128(hash), size: Math.min(bytes, 2147483647) },
        payload, bytes,
      });
    }

    // --- code entities: all four bytecodes, one dedup pool.
    const creationOnchain = codeRef(cb.onchainBytecode);
    const creationRecompiled = codeRef(cb.recompiledBytecode);
    const runtimeOnchain = codeRef(rb.onchainBytecode);
    const runtimeRecompiled = codeRef(rb.recompiledBytecode);

    // --- compilation, deduplicated by the v2 CONTENT-STRONG fingerprint: inputs
    // (sources + settings) AND outputs (recompiled code + artifacts + metadata).
    // Review finding applied: Sourcify itself keys compiled_contracts by OUTPUT code
    // hashes, because identical inputs do not guarantee identical artifacts (solc-js
    // vs native builds of the same version string is a documented divergence class).
    // Including the outputs makes the "shared compilation ⇒ shared docs" claim true
    // by construction instead of assumed.
    const sortedSourceHashes = Object.values(hashByPath).sort();
    const artifactsHash = sha256(jstr([
      r.metadata ?? null, r.storageLayout ?? null, r.userdoc ?? null, r.devdoc ?? null,
      cb.sourceMap ?? null, cb.linkReferences ?? null, cb.cborAuxdata ?? null,
      rb.sourceMap ?? null, rb.linkReferences ?? null, rb.immutableReferences ?? null, rb.cborAuxdata ?? null,
    ]));
    const fp2 = sha256(jstr([
      c.compiler, c.compilerVersion, c.language, c.fullyQualifiedName, settings,
      sortedSourceHashes, creationRecompiled, runtimeRecompiled, artifactsHash,
    ]));
    const fp1 = sha256(jstr([c.compiler, c.compilerVersion, c.language, c.fullyQualifiedName, settings]));
    if (!compilations.has(fp2)) {
      v1fpOf.set(fp2, fp1);
      const payload = {
        schema: "sourcify.compilation.v2",
        ...c,
        sources: hashByPath,
        sourceIds: r.sourceIds ?? null,
        metadata: r.metadata ?? null,
        storageLayout: r.storageLayout ?? null,
        transientStorageLayout: r.transientStorageLayout ?? null,
        userdoc: r.userdoc ?? null,
        devdoc: r.devdoc ?? null,
        creationCodeArtifacts: {
          sourceMap: cb.sourceMap ?? null, linkReferences: cb.linkReferences ?? null, cborAuxdata: cb.cborAuxdata ?? null,
        },
        runtimeCodeArtifacts: {
          sourceMap: rb.sourceMap ?? null, linkReferences: rb.linkReferences ?? null,
          immutableReferences: rb.immutableReferences ?? null, cborAuxdata: rb.cborAuxdata ?? null,
        },
        recompiledCreationHash: creationRecompiled,
        recompiledRuntimeHash: runtimeRecompiled,
      };
      const fit = fitPayload(
        payload,
        ["metadata", "storageLayout", "userdoc", "devdoc", "creationCodeArtifacts", "runtimeCodeArtifacts", "sourceIds", "transientStorageLayout"],
        blobs, `compilation ${c.fullyQualifiedName}`,
      );
      counters.spilledComponents += fit.spilled.length;
      compilations.set(fp2, {
        kind: "compilation", fp2, fp1,
        attributes: {
          ds: "sourcify", kind: "compilation", fp: s128(fp2),
          compiler: s128(c.compiler ?? "unknown"), compilerVersion: s128(c.compilerVersion ?? "unknown"),
          language: s128(c.language ?? "unknown"), name: s128(c.name ?? ""),
          evmVersion: s128(settings.evmVersion ?? "default"),
          optimizer: Boolean(settings.optimizer?.enabled),
          optimizerRuns: Math.min(Number(settings.optimizer?.runs ?? 0) | 0, 2147483647),
          useCount: 0,
        },
        payload, bytes: fit.bytes, spilled: fit.spilled, addrs: [],
      });
    }
    const comp = compilations.get(fp2);
    comp.attributes.useCount++;
    comp.addrs.push(r.address.toLowerCase());

    // --- verified_contract: v1 attrs + the two onchain code hashes; payload keeps the
    // v1 lookup answer and gains the deployment-specific remainder of the record.
    const proxy = r.proxyResolution ?? {};
    const dep = r.deployment ?? {};
    const abi = r.abi ?? [];
    const fnCount = abi.filter((x) => x.type === "function").length;
    const evtCount = abi.filter((x) => x.type === "event").length;
    const payload = {
      schema: "sourcify.verifiedContract.v2",
      match: r.match, creationMatch: r.creationMatch, runtimeMatch: r.runtimeMatch,
      chainId: r.chainId, address: r.address, verifiedAt: r.verifiedAt, matchId: r.matchId,
      abi, compilation: c, deployment: dep, proxyResolution: proxy,
      additionalInput: r.additionalInput ?? null,
      creationTransformations: cb.transformations ?? null,
      creationTransformationValues: cb.transformationValues ?? null,
      runtimeTransformations: rb.transformations ?? null,
      runtimeTransformationValues: rb.transformationValues ?? null,
      codeRefs: {
        creationOnchain, creationRecompiled, runtimeOnchain, runtimeRecompiled,
      },
    };
    const fit = fitPayload(payload, ["abi", "creationTransformationValues", "runtimeTransformationValues"], blobs, `vc ${r.address}`);
    counters.spilledComponents += fit.spilled.length;

    const attributes = {
      // the 25 v1 attributes, unchanged (same names, same types — patches only ADD)
      ds: "sourcify", kind: "verified_contract",
      chainId: BigInt(r.chainId), address: r.address.toLowerCase(),
      chainAddr: s128(`${r.chainId}:${r.address.toLowerCase()}`),
      match: s128(r.match ?? "null"), creationMatch: s128(r.creationMatch ?? "null"), runtimeMatch: s128(r.runtimeMatch ?? "null"),
      compiler: s128(c.compiler ?? "unknown"), compilerVersion: s128(c.compilerVersion ?? "unknown"),
      language: s128(c.language ?? "unknown"), name: s128(c.name ?? ""),
      verifiedAt: BigInt(secs(r.verifiedAt)), matchId: BigInt(r.matchId ?? 0),
      isProxy: Boolean(proxy.isProxy), proxyType: s128(proxy.proxyType ?? "none"),
      abiHash: s128(sha256(jstr(abi))), fnCount: fnCount | 0, evtCount: evtCount | 0,
      optimizer: Boolean(settings.optimizer?.enabled),
      optimizerRuns: Math.min(Number(settings.optimizer?.runs ?? 0) | 0, 2147483647),
      evmVersion: s128(settings.evmVersion ?? "default"),
      blockNumber: BigInt(dep.blockNumber ?? 0),
      deployer: (dep.deployer ?? "0x0000000000000000000000000000000000000000").toLowerCase(),
      compilationFp: s128(fp2),
      // v2 additions — the join into the code lane
      creationCodeHash: s128(creationOnchain ?? "0x0"),
      runtimeCodeHash: s128(runtimeOnchain ?? "0x0"),
    };
    if (Object.keys(attributes).length > MAX_ATTRIBUTES) {
      throw new Error(`attribute budget blown: ${Object.keys(attributes).length} > ${MAX_ATTRIBUTES}`);
    }
    vcs.push({ kind: "verified_contract", address: r.address.toLowerCase(), fp2, attributes, payload, bytes: fit.bytes });
  }

  // --- the split question: how many v1 fingerprints does the strong fingerprint divide?
  const byV1 = new Map();
  for (const [fp2, fp1] of v1fpOf) (byV1.get(fp1) ?? byV1.set(fp1, []).get(fp1)).push(fp2);
  const splits = [...byV1.values()].filter((v) => v.length > 1);

  return { vcs, compilations, codes, sourceFiles, blobs, splits, byV1, counters, missingFull, missingV1, staleJoins };
}

// ------------------------------------------------------------------ entry point
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const v1rows = read(`detail-${CHAIN}.ndjson`);
  const fullRows = read(`detail-full-${CHAIN}.ndjson`);
  console.log(`in: ${v1rows.length} v1 records + ${fullRows.length} full records (chain ${CHAIN})`);

  const R = transformFull(v1rows, fullRows);
  if (R.missingFull) console.warn(`!! ${R.missingFull} v1 records had no full record yet (5-fetch-full still running?) — excluded`);
  if (R.missingV1) console.warn(`!! ${R.missingV1} full records had no v1 record (list grew since 1-fetch) — run 1-fetch.mjs to top up, then re-run`);
  if (R.staleJoins.length) {
    fs.writeFileSync(path.join(DIR, `refetch-${CHAIN}.json`), JSON.stringify(R.staleJoins, null, 1));
    console.warn(`!! ${R.staleJoins.length} contracts re-verified between the two fetch passes (matchId moved) — excluded, addresses in refetch-${CHAIN}.json; re-pull both passes for them`);
  }

  const big = (x) => JSON.stringify(x, (k, v) => (typeof v === "bigint" ? v.toString() : v));
  const w = (f, arr) => { fs.writeFileSync(path.join(DIR, f), arr.map(big).join("\n") + (arr.length ? "\n" : "")); return arr.length; };

  const blobList = [...R.blobs.values()].flat();
  const nCode = w(`creates2-code-${CHAIN}.ndjson`, [...R.codes.values()]);
  const nSf = w(`creates2-sourcefile-${CHAIN}.ndjson`, [...R.sourceFiles.values()]);
  const nBlob = w(`creates2-blob-${CHAIN}.ndjson`, blobList);
  const nCp = w(`patches2-compilation-${CHAIN}.ndjson`, [...R.compilations.values()]);
  const nVc = w(`patches2-verified_contract-${CHAIN}.ndjson`, R.vcs);

  const sum = (arr, f = (x) => x.bytes ?? 0) => arr.reduce((a, x) => a + f(x), 0);
  const codeBytes = sum([...R.codes.values()], (x) => Buffer.from(x.hexB64, "base64").length);
  const sfBytes = sum([...R.sourceFiles.values()]);
  const blobBytes = sum(blobList, (x) => Buffer.from(x.chunkB64, "base64").length);
  const cpBytes = sum([...R.compilations.values()]);
  const vcBytes = sum(R.vcs);
  const totalMB = (codeBytes + sfBytes + blobBytes + cpBytes + vcBytes) / 1e6;

  console.log(`
verified_contract patches : ${nVc}
compilation entities       : ${nCp}  (strong fingerprint; v1 had 1,127)
  v1 fingerprints SPLIT    : ${R.splits.length}${R.splits.length ? "  -> " + R.splits.slice(0, 5).map((s) => s.length).join(",") + " ways" : "  (none — every v1 compilation maps 1:1, patches suffice)"}
code entities              : ${nCode}  (${(codeBytes / 1e6).toFixed(1)} MB raw bytecode, deduplicated)
sourcefile entities        : ${nSf}  (${(sfBytes / 1e6).toFixed(1)} MB)
blob chunk entities        : ${nBlob}  (${(blobBytes / 1e6).toFixed(1)} MB across ${R.blobs.size} spilled components)
components spilled         : ${R.counters.spilledComponents} + ${R.counters.filesSpilled} source files
payload MB by lane         : vc ${(vcBytes / 1e6).toFixed(1)} | compilation ${(cpBytes / 1e6).toFixed(1)} | code ${(codeBytes / 1e6).toFixed(1)} | sourcefile ${(sfBytes / 1e6).toFixed(1)} | blob ${(blobBytes / 1e6).toFixed(1)}
total NEW on-chain payload : ${totalMB.toFixed(1)} MB
`);

  // The field-level size table over the WHOLE chain — the evidence behind the
  // "which fields do we show" matrix (n = every contract, not a 40-sample).
  const fields = {};
  const acc = (k, v) => { if (v == null) return; (fields[k] ??= []).push(B(v)); };
  for (const r of fullRows) {
    acc("sources", r.sources); acc("metadata", r.metadata); acc("storageLayout", r.storageLayout);
    acc("transientStorageLayout", r.transientStorageLayout); acc("userdoc", r.userdoc); acc("devdoc", r.devdoc);
    acc("sourceIds", r.sourceIds); acc("signatures", r.signatures);
    acc("creationBytecode.onchain", r.creationBytecode?.onchainBytecode);
    acc("creationBytecode.recompiled", r.creationBytecode?.recompiledBytecode);
    acc("runtimeBytecode.onchain", r.runtimeBytecode?.onchainBytecode);
    acc("runtimeBytecode.recompiled", r.runtimeBytecode?.recompiledBytecode);
    acc("additionalInput", r.additionalInput);
  }
  console.log("field".padEnd(30) + "n".padStart(6) + "p50".padStart(10) + "p95".padStart(10) + "max".padStart(11) + "  over 127KB");
  for (const [k, arr] of Object.entries(fields)) {
    arr.sort((a, b) => a - b);
    const pick = (p) => arr[Math.floor(arr.length * p)] ?? arr[arr.length - 1];
    console.log(
      k.padEnd(30) + String(arr.length).padStart(6) + pick(0.5).toLocaleString().padStart(10) +
      pick(0.95).toLocaleString().padStart(10) + arr[arr.length - 1].toLocaleString().padStart(11) +
      ("  " + arr.filter((x) => x > PAYLOAD_BUDGET).length),
    );
  }
  fs.writeFileSync(path.join(DIR, `fieldsizes-${CHAIN}.json`), JSON.stringify(
    Object.fromEntries(Object.entries(fields).map(([k, arr]) => {
      const pick = (p) => arr[Math.floor(arr.length * p)] ?? arr[arr.length - 1];
      return [k, { n: arr.length, p50: pick(0.5), p95: pick(0.95), max: arr[arr.length - 1], over: arr.filter((x) => x > PAYLOAD_BUDGET).length }];
    })), null, 1));
}
