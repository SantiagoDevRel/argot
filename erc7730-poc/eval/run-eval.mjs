// run-eval.mjs — the backtest orchestrator. Regenerate a candidate descriptor for each
// held-out ground-truth contract, score it (field-exact-match, intent-match, fn-recall),
// and aggregate BIMODALLY (standard vs long-tail). It's a BENCHMARK, not training:
// few-shot examples are held OUT of the test set (built in corpus.mjs) → no data leakage.
//
//   node eval/run-eval.mjs --gen mock            # pipeline check (no model)
//   node eval/run-eval.mjs --gen dgx  --limit 20 # LIVE generation via the DGX wrapper
//   node eval/run-eval.mjs --gen dgx  --model minimax-m2.5
//
// Baselines (erc7730 / clearsig / hardhat-descriptor) run OFFLINE on the DGX and are
// merged as separate --gen adapters so the report shows DELTA vs both deterministic and
// LLM incumbents (see eval/README.md). The DGX steps are DEFERRED until the GPU is free.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { scoreDescriptor } from "./metrics.mjs";
import { featuresFromDescriptor } from "./extract.mjs";

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const GEN = opt("--gen", "mock");
const LIMIT = Number(opt("--limit", "0"));
const MODEL = opt("--model", "qwen3-coder-next:q4_K_M");

// --- generator adapters -----------------------------------------------------------
// Each returns feature-shaped { functions:[{name,intent,fields:[{path,label,format}]}] }.

// mock: derive a realistically-degraded descriptor from ground truth so the scoring +
// aggregation pipeline can be validated end-to-end with no model. NOT a real result.
function mockGenerate(gt) {
  const functions = (gt.functions ?? []).map((f, i) => ({
    name: f.name,
    intent: i % 3 === 0 ? f.intent : String(f.intent ?? "").split(" ").slice(0, 2).join(" "), // clip some intents
    fields: (f.fields ?? [])
      .filter((_, j) => j % 4 !== 3) // drop ~1 in 4 fields
      .map((x, j) => ({ path: x.path, label: x.label, format: j % 5 === 4 ? "raw" : x.format })), // perturb some formats
  }));
  return { functions };
}

// dgx: POST the contract to the wrapper; it fetches Sourcify inputs, runs the model
// (schema-constrained) + `erc7730 lint`, returns the descriptor JSON. DEFERRED (DGX busy).
async function dgxGenerate(target) {
  const base = process.env.DGX_URL;
  const bearer = process.env.DGX_BEARER ?? "";
  if (!base) throw new Error("DGX_URL not set — the DGX wrapper must be reachable for --gen dgx");
  const res = await fetch(base.replace(/\/$/, "") + "/generate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ chainId: target.chainId, address: target.address, model: MODEL, eval: true }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`dgx ${res.status}`);
  const data = await res.json();
  return { descriptorJson: data.descriptor, lintPassed: !!data.lintPassed };
}

// --- aggregation ------------------------------------------------------------------
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
  return {
    all: bucketize(results),
    standard: bucketize(results.filter((r) => r.bucket === "standard")),
    longTail: bucketize(results.filter((r) => r.bucket === "long-tail")),
  };
}

async function main() {
  const corpus = JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8"));
  const fewshot = new Set(corpus.fewshotFiles);
  let testSet = corpus.descriptors.filter((d) => !fewshot.has(d.file) && d.functions.length > 0);
  if (LIMIT > 0) testSet = testSet.slice(0, LIMIT);

  console.log(`backtest: gen=${GEN} model=${GEN === "dgx" ? MODEL : "—"} · ${testSet.length} held-out descriptors`);
  if (GEN === "dgx" && !process.env.DGX_URL) {
    console.error("⛔ --gen dgx needs DGX_URL (+ DGX_BEARER). The DGX steps are DEFERRED until the GPU is free.");
    process.exit(2);
  }

  const results = [];
  let done = 0;
  for (const gt of testSet) {
    let genFeatures, lintPassed;
    try {
      if (GEN === "mock") {
        genFeatures = mockGenerate(gt);
        lintPassed = true; // mock is well-formed by construction
      } else {
        const target = { chainId: gt.deployments[0].chainId, address: gt.deployments[0].address };
        const out = await dgxGenerate(target);
        genFeatures = featuresFromDescriptor(out.descriptorJson);
        lintPassed = out.lintPassed;
      }
    } catch (e) {
      results.push({ id: gt.id, bucket: gt.bucket, lintPassed: false, score: { fnRecall: 0, fieldExactMatch: 0, intentMatch: 0, formatExact: 0 }, error: String(e).slice(0, 80) });
      continue;
    }
    const score = scoreDescriptor(gt, genFeatures);
    results.push({ id: gt.id, bucket: gt.bucket, lintPassed, score: {
      fnRecall: score.fnRecall, fieldExactMatch: score.fieldExactMatch, intentMatch: score.intentMatch, formatExact: score.formatExact,
      fieldExactMatchOnHit: score.fieldExactMatchOnHit, intentMatchOnHit: score.intentMatchOnHit,
    } });
    // Incremental checkpoint so a long overnight run survives an interruption.
    if (++done % 10 === 0) {
      process.stdout.write(`  ${done}/${testSet.length}\n`);
      writeFileSync(join(HERE, `report-${GEN}.json`), JSON.stringify({ generator: GEN, model: GEN === "dgx" ? MODEL : null, corpusCommit: corpus.commit, nTest: results.length, partial: true, bimodal: aggregate(results), results }, null, 2));
    }
  }

  const agg = aggregate(results);
  const report = { generator: GEN, model: GEN === "dgx" ? MODEL : null, corpusCommit: corpus.commit, nTest: results.length, bimodal: agg, results };
  const outFile = join(HERE, `report-${GEN}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));

  const line = (label, b) => b && console.log(`  ${label.padEnd(10)} n=${String(b.n).padStart(3)}  lint=${(b.linterPass * 100).toFixed(0).padStart(3)}%  fnRecall=${b.fnRecall}  fieldExact=${b.fieldExactMatch}(onHit ${b.fieldExactOnHit})  intent=${b.intentMatch}(onHit ${b.intentOnHit})`);
  console.log(`\nbimodal results (gen=${GEN}):`);
  line("ALL", agg.all);
  line("standard", agg.standard);
  line("long-tail", agg.longTail);
  console.log("wrote", outFile);
  if (GEN === "mock") console.log("\n(mock generator — pipeline validation only; run --gen dgx on the free GPU for the real number)");
}

main();
