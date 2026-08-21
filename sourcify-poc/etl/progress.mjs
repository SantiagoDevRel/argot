/**
 * progress.mjs — summarise the v2 write checkpoint into kb/progress.json, which
 * the app bundles and /api/stats serves. Run it before a deploy; the page then
 * says how far the 100% pass has landed, as of when.
 */
import fs from "node:fs";
import path from "node:path";

const CHAIN = process.env.CHAIN ?? "130";
const DIR = path.join(import.meta.dirname, "data");
const ckpt = JSON.parse(fs.readFileSync(path.join(DIR, `written-full-${CHAIN}.json`), "utf8"));
const count = (f) => fs.existsSync(path.join(DIR, f)) ? fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).length : 0;

const lanes = {
  blob: { done: Object.keys(ckpt.done.blob ?? {}).length, total: count(`creates2-blob-${CHAIN}.ndjson`) },
  code: { done: Object.keys(ckpt.done.code ?? {}).length, total: count(`creates2-code-${CHAIN}.ndjson`) },
  sourcefile: { done: Object.keys(ckpt.done.sourcefile ?? {}).length, total: count(`creates2-sourcefile-${CHAIN}.ndjson`) },
  compilation: { done: Object.keys(ckpt.done.cp ?? {}).length, total: count(`patches2-compilation-${CHAIN}.ndjson`) },
  verified_contract: { done: Object.keys(ckpt.done.vc ?? {}).length, total: count(`patches2-verified_contract-${CHAIN}.ndjson`) },
};
const out = {
  chain: CHAIN,
  updatedAt: new Date().toISOString(),
  txsSent: ckpt.txs.length,
  txsPlanned: Number(process.env.TXS_PLANNED ?? 2495),
  lanes,
  // Contracts whose WHOLE record is on-chain (their vc patch landed, which the
  // writers only do after the compilation, sources and bytecodes it needs).
  completeContracts: Object.keys(ckpt.done.vc ?? {}),
  anonymousRateLimit: !process.env.ARKIV_API_KEY,
};
fs.writeFileSync(path.join(import.meta.dirname, "..", "kb", "progress.json"), JSON.stringify(out, null, 2));
console.log(`progress: ${out.txsSent}/${out.txsPlanned} txs · complete contracts ${out.completeContracts.length} · ` +
  Object.entries(lanes).map(([k, v]) => `${k} ${v.done}/${v.total}`).join(" · "));
