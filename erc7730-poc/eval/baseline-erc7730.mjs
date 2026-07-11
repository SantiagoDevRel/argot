// baseline-erc7730.mjs — the DETERMINISTIC incumbent baseline (Ledger `python-erc7730`).
//
// The delta that matters: beating a blank page proves nothing; the market question is
// beating the incumbent. This runs the SAME held-out corpus (same deterministic shuffle,
// same --limit, same Sourcify inputs incl. proxy→impl resolution) through
// `erc7730 generate` (ABI → placeholder labels, no NatSpec intent) and scores it with the
// SAME metrics as the DGX models → an apples-to-apples delta.
//
//   node eval/baseline-erc7730.mjs --limit 60           # (ERC7730_BIN + Sourcify reachable)
//
// Runs offline on CPU (no GPU) — safe to run alongside a GPU eval sweep.
//
// PATH NORMALIZATION (documented, fair): the ground-truth registry writes calldata field
// paths BARE (`desc.amount`, `caller` — 85% of GT); `erc7730 generate` emits the canonical
// root-selector form (`#.guy`, `@.from`). Those are semantically the same reference. We strip
// the leading `#.`/`@.` selector from the baseline's paths before scoring so the path-match is
// fair — WITHOUT it the deterministic baseline scores ~0 on fieldExact purely from a prefix
// mismatch, which would unfairly flatter our model. GT is left as-authored.
import { readFileSync, writeFileSync, mkdtempSync, writeFileSync as wf, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { scoreDescriptor } from "./metrics.mjs";
import { featuresFromDescriptor } from "./extract.mjs";

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const LIMIT = Number(opt("--limit", "0"));
const ERC7730_BIN = process.env.ERC7730_BIN || "erc7730";
const SOURCIFY = process.env.SOURCIFY_URL || "https://sourcify.dev/server/v2/contract";
const GEN = "erc7730";

// Strip the ERC-7730 root selector prefix so baseline paths compare fairly to bare GT paths.
function normPath(p) { return typeof p === "string" ? p.replace(/^[#@]\./, "") : p; }
function normalizeFeatures(feat) {
  for (const fn of feat.functions ?? []) for (const f of fn.fields ?? []) f.path = normPath(f.path);
  return feat;
}

// Fetch the SAME inputs the DGX wrapper uses (ABI, proxy→impl resolution) for a fair delta.
async function sourcifyInputs(chainId, address) {
  const sres = await fetch(`${SOURCIFY}/${chainId}/${address}?fields=abi,proxyResolution`);
  if (!sres.ok) throw new Error(`sourcify ${sres.status}`);
  const s = await sres.json();
  let abi = s.abi;
  const implRaw = s.proxyResolution?.isProxy ? s.proxyResolution.implementations?.[0]?.address : null;
  if (/^0x[0-9a-fA-F]{40}$/.test(String(implRaw || ""))) {
    try {
      const ires = await fetch(`${SOURCIFY}/${chainId}/${implRaw}?fields=abi`);
      if (ires.ok) { const iso = await ires.json(); if (Array.isArray(iso.abi) && iso.abi.length) abi = iso.abi; }
    } catch { /* fall back to proxy ABI */ }
  }
  return Array.isArray(abi) ? abi : [];
}

// erc7730 generate → descriptor JSON (deterministic). Then lint it as the hard gate,
// mirroring the wrapper (add the $schema + metadata the raw generate output omits).
function baselineDescriptor(chainId, address, abi) {
  const dir = mkdtempSync(join(tmpdir(), "erc7730-bl-"));
  const abiFile = join(dir, "abi.json");
  wf(abiFile, JSON.stringify(abi));
  try {
    const out = execFileSync(ERC7730_BIN, ["generate", "--chain-id", String(chainId), "--address", address, "--abi", abiFile], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }).toString();
    // `erc7730 generate` embeds raw NatSpec/comments that can contain literal control
    // chars (newlines/tabs) inside JSON string values → strict JSON.parse throws. Strip
    // control chars (U+0000–U+001F): between tokens they're ignorable whitespace, inside
    // strings they're the offenders; either way removal yields valid, equivalent JSON.
    const desc = JSON.parse(out.replace(/[\u0000-\u001F]/g, " "));
    // Ensure a lint-able shape (generate can omit $schema/metadata that lint requires).
    desc.$schema = desc.$schema || "https://eips.ethereum.org/assets/eip-7730/erc7730-v1.schema.json";
    if (!desc.metadata || !Object.keys(desc.metadata).length) desc.metadata = { owner: desc.context?.$id || "Contract" };
    return desc;
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

function lint(descriptor) {
  const dir = mkdtempSync(join(tmpdir(), "erc7730-lint-"));
  const file = join(dir, "calldata-candidate.json");
  wf(file, JSON.stringify(descriptor, null, 2));
  try {
    execFileSync(ERC7730_BIN, ["lint", file], { timeout: 30000 });
    return true; // exit 0 = pass (warnings, e.g. missing Etherscan key for ABI xcheck, are OK)
  } catch { return false; }
  finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

function aggregate(results) {
  const bucketize = (rows) => {
    if (rows.length === 0) return null;
    const m = (k) => rows.reduce((s, r) => s + (r.score[k] ?? 0), 0) / rows.length;
    return {
      n: rows.length,
      linterPass: +(rows.filter((r) => r.lintPassed).length / rows.length).toFixed(3),
      fnRecall: +m("fnRecall").toFixed(3),
      fieldExactMatch: +m("fieldExactMatch").toFixed(3),
      intentMatch: +m("intentMatch").toFixed(3),
      fieldExactOnHit: +m("fieldExactMatchOnHit").toFixed(3),
      intentOnHit: +m("intentMatchOnHit").toFixed(3),
    };
  };
  return { all: bucketize(results), standard: bucketize(results.filter((r) => r.bucket === "standard")), longTail: bucketize(results.filter((r) => r.bucket === "long-tail")) };
}

async function main() {
  const corpus = JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8"));
  const fewshot = new Set(corpus.fewshotFiles);
  let testSet = corpus.descriptors.filter((d) => !fewshot.has(d.file) && d.functions.length > 0 && d.kind === "calldata");
  const rank = (s) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 12), 16);
  testSet.sort((a, b) => rank(a.file) - rank(b.file));
  if (LIMIT > 0) testSet = testSet.slice(0, LIMIT);

  console.log(`baseline: gen=erc7730 (deterministic/Ledger) · ${testSet.length} held-out descriptors`);
  const results = [];
  let done = 0;
  for (const gt of testSet) {
    const { chainId, address } = gt.deployments[0];
    try {
      const abi = await sourcifyInputs(chainId, address);
      if (!abi.length) throw new Error("no abi");
      const descriptor = baselineDescriptor(chainId, address, abi);
      const lintPassed = lint(descriptor);
      if (!lintPassed) {
        results.push({ id: gt.id, bucket: gt.bucket, lintPassed: false, score: { fnRecall: 0, fieldExactMatch: 0, intentMatch: 0, formatExact: 0, fieldExactMatchOnHit: 0, intentMatchOnHit: 0 } });
      } else {
        const feat = normalizeFeatures(featuresFromDescriptor(descriptor));
        const s = scoreDescriptor(gt, feat);
        results.push({ id: gt.id, bucket: gt.bucket, lintPassed: true, score: {
          fnRecall: s.fnRecall, fieldExactMatch: s.fieldExactMatch, intentMatch: s.intentMatch, formatExact: s.formatExact,
          fieldExactMatchOnHit: s.fieldExactMatchOnHit, intentMatchOnHit: s.intentMatchOnHit } });
      }
    } catch (e) {
      results.push({ id: gt.id, bucket: gt.bucket, lintPassed: false, score: { fnRecall: 0, fieldExactMatch: 0, intentMatch: 0, formatExact: 0, fieldExactMatchOnHit: 0, intentMatchOnHit: 0 }, error: String(e).slice(0, 80) });
    }
    if (++done % 10 === 0) {
      process.stdout.write(`  ${done}/${testSet.length}\n`);
      writeFileSync(join(HERE, `report-${GEN}.json`), JSON.stringify({ generator: GEN, model: "python-erc7730 generate", corpusCommit: corpus.commit, nTest: results.length, partial: true, bimodal: aggregate(results), results }, null, 2));
    }
  }

  const agg = aggregate(results);
  writeFileSync(join(HERE, `report-${GEN}.json`), JSON.stringify({ generator: GEN, model: "python-erc7730 generate", corpusCommit: corpus.commit, nTest: results.length, bimodal: agg, results }, null, 2));
  const line = (label, b) => b && console.log(`  ${label.padEnd(10)} n=${String(b.n).padStart(3)}  lint=${(b.linterPass * 100).toFixed(0).padStart(3)}%  fnRecall=${b.fnRecall}  fieldExact=${b.fieldExactMatch}(onHit ${b.fieldExactOnHit})  intent=${b.intentMatch}(onHit ${b.intentOnHit})`);
  console.log(`\nbimodal results (gen=${GEN}, deterministic baseline):`);
  line("ALL", agg.all); line("standard", agg.standard); line("long-tail", agg.longTail);
  console.log("wrote", join(HERE, `report-${GEN}.json`));
}
main();
