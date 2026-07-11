// hybrid-erc7730.mjs — the HYBRID generator: deterministic STRUCTURE + LLM INTENT.
//
// The backtest surfaced the honest truth: the deterministic incumbent (`erc7730 generate`)
// beats the LLM on every STRUCTURAL metric (lint-pass, fnRecall, fieldExact) because it
// reads paths/types straight from the ABI and never hallucinates them — but it produces
// ZERO intent (it structurally can't). The LLM is the opposite: real intent, shakier
// structure. The hybrid takes the best of each:
//
//   1. deterministic skeleton  ← `erc7730 generate` (correct paths, addressName/raw formats)
//   2. LLM enrichment          ← a model adds an `intent` per function and, WITHOUT touching
//                                paths, upgrades obvious raw→tokenAmount/duration/date and
//                                improves labels, guided by ABI + NatSpec.
//   3. deterministic merge      ← intent + safe format upgrades grafted onto the skeleton;
//                                paths are NEVER model-changed (that's where the LLM fails).
//   4. lint gate + score        ← same metrics as every other generator (apples-to-apples).
//
//   DGX_URL/Ollama local:  ERC7730_BIN=~/erc7730-venv/bin/erc7730 \
//     node eval/hybrid-erc7730.mjs --model qwen3-coder-next:q4_K_M --limit 60
//
// Runs on the DGX (erc7730 CLI + Ollama + Sourcify local). --model picks the enrichment LLM.
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
const MODEL = opt("--model", "qwen3-coder-next:q4_K_M");
const ERC7730_BIN = process.env.ERC7730_BIN || "erc7730";
const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const SOURCIFY = process.env.SOURCIFY_URL || "https://sourcify.dev/server/v2/contract";
const GEN = "hybrid";

// Formats the LLM may UPGRADE a deterministic `raw`/`amount` field to (never a downgrade,
// never touches addressName). Anything else is ignored → keep the deterministic format.
const UPGRADE_TO = new Set(["tokenAmount", "duration", "date", "amount"]);

function normPath(p) { return typeof p === "string" ? p.replace(/^[#@]\./, "") : p; }
// A non-empty fallback intent derived from the function name — the linter REJECTS empty
// intent ("String should have at least 1 character"), so when the LLM omits one (or its
// signature key doesn't match the skeleton's) we synthesize a readable imperative.
function humanizeFn(sig) {
  const name = String(sig).split("(")[0].replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_]+/g, " ").trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Call function";
}

async function sourcifyInputs(chainId, address) {
  const r = await fetch(`${SOURCIFY}/${chainId}/${address}?fields=abi,userdoc,devdoc,proxyResolution`);
  if (!r.ok) throw new Error(`sourcify ${r.status}`);
  const s = await r.json();
  let abi = s.abi, userdoc = s.userdoc, devdoc = s.devdoc;
  const implRaw = s.proxyResolution?.isProxy ? s.proxyResolution.implementations?.[0]?.address : null;
  if (/^0x[0-9a-fA-F]{40}$/.test(String(implRaw || ""))) {
    try { const ir = await fetch(`${SOURCIFY}/${chainId}/${implRaw}?fields=abi,userdoc,devdoc`);
      if (ir.ok) { const iso = await ir.json(); if (Array.isArray(iso.abi) && iso.abi.length) { abi = iso.abi; userdoc = iso.userdoc; devdoc = iso.devdoc; } } } catch {}
  }
  return { abi: Array.isArray(abi) ? abi : [], userdoc, devdoc };
}

// deterministic skeleton (formats keyed by signature, paths already correct from the ABI).
function skeleton(chainId, address, abi) {
  const dir = mkdtempSync(join(tmpdir(), "erc7730-sk-"));
  const abiFile = join(dir, "abi.json");
  wf(abiFile, JSON.stringify(abi));
  try {
    const out = execFileSync(ERC7730_BIN, ["generate", "--chain-id", String(chainId), "--address", address, "--abi", abiFile], { timeout: 60000, maxBuffer: 16 * 1024 * 1024 }).toString();
    const desc = JSON.parse(out.replace(/[\u0000-\u001F]/g, " "));
    const formats = desc?.display?.formats || {};
    // KEEP the deterministic `#.`/`@.` root selector on paths — the linter REQUIRES it for
    // nested/array calldata refs (stripping it here made complex contracts fail lint). We
    // strip the prefix only later, at SCORING time, to compare against the bare-path GT.
    return { desc, formats };
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// LLM enrichment: intent per function + optional safe format upgrade + better labels.
// Paths are given and must be echoed unchanged (we ignore any path the model invents).
const SYSTEM = `You REFINE a deterministic ERC-7730 clear-signing skeleton. You are given a contract's ABI, its NatSpec, and a SKELETON: a set of functions, each with fields that already have correct "path" values. Your job:
- For each function, write a short imperative "intent" (what the user is signing), grounded in NatSpec/name.
- For each field, keep its "path" EXACTLY as given. You MAY set a better "label" and MAY change "format" ONLY to one of: tokenAmount (token/ETH amounts), duration (time spans), date (deadlines/timestamps), amount (plain numbers). Otherwise leave "format" as the skeleton's value. NEVER change addressName. NEVER invent, add, or drop fields or functions.
Output ONLY: { "formats": { "<signature>": { "intent": "...", "fields": [ { "path": "...", "label": "...", "format": "..." } ] } } } using the EXACT same signatures and paths as the skeleton.`;

const SCHEMA = {
  type: "object",
  properties: { formats: { type: "object", additionalProperties: {
    type: "object",
    properties: { intent: { type: "string" }, fields: { type: "array", items: {
      type: "object", properties: { path: { type: "string" }, label: { type: "string" }, format: { type: "string" } }, required: ["path"] } } },
    required: ["intent", "fields"] } } },
  required: ["formats"],
};

async function enrich(abi, userdoc, devdoc, formats) {
  const skel = Object.fromEntries(Object.entries(formats).map(([sig, spec]) => [sig, (spec.fields || []).map((f) => ({ path: f.path, format: f.format }))]));
  const user = [
    `ABI (functions only): ${JSON.stringify((abi || []).filter((x) => x.type === "function")).slice(0, 13000)}`,
    `NatSpec userdoc (@notice): ${JSON.stringify(userdoc || {}).slice(0, 5000)}`,
    `NatSpec devdoc (@param): ${JSON.stringify(devdoc || {}).slice(0, 5000)}`,
    `SKELETON (keep these signatures + paths): ${JSON.stringify(skel).slice(0, 6000)}`,
    `Return the refined { "formats": {...} } now.`,
  ].join("\n\n");
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, stream: false, format: SCHEMA, keep_alive: "30m",
      options: { temperature: 0.1, num_ctx: 32768 },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(290000),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.message?.content ?? "{}");
}

// Graft LLM intent + safe format upgrades onto the deterministic skeleton (paths fixed).
function merge(formats, llm) {
  const out = {};
  for (const [sig, spec] of Object.entries(formats)) {
    const l = (llm.formats || {})[sig] || {};
    const lFields = new Map((l.fields || []).map((f) => [normPath(f.path), f]));
    const fields = (spec.fields || []).map((f) => {
      // skeleton paths keep the `#.` selector; the LLM map is keyed bare → match on bare,
      // but KEEP the skeleton's selector-prefixed path in the output (the linter needs it).
      const lf = lFields.get(normPath(f.path));
      let format = f.format, label = f.label;
      if (lf) {
        if (typeof lf.label === "string" && lf.label.trim()) label = lf.label;
        // upgrade only raw/amount → a richer known format; never touch addressName/others
        if ((f.format === "raw" || f.format === "amount") && UPGRADE_TO.has(lf.format)) format = lf.format;
      }
      return { path: f.path, label, format };
    });
    const intent = typeof l.intent === "string" && l.intent.trim() ? l.intent.trim() : humanizeFn(sig);
    out[sig] = { intent, fields };
  }
  return out;
}

// same field normalization the wrapper applies before lint (addressName/date params, arr.[])
function normalizeFormats(formats) {
  const SAFE = new Set(["raw", "addressName", "tokenAmount", "amount", "duration", "date"]);
  for (const spec of Object.values(formats || {})) {
    spec.fields = (spec.fields || []).filter((f) => typeof f.path === "string" && f.path.trim().length > 0);
    for (const f of spec.fields) {
      f.path = f.path.replace(/(?<!\.)\[/g, ".[");
      if (f.format === "addressName") { if (!f.params?.types) f.params = { ...(f.params || {}), types: ["wallet", "eoa", "contract"] }; }
      else if (f.format === "date") { if (!f.params?.encoding) f.params = { ...(f.params || {}), encoding: "timestamp" }; }
      else if (!SAFE.has(f.format)) { f.format = "raw"; delete f.params; }
    }
  }
  return formats;
}

function buildDescriptor(skDesc, chainId, address, abi, mergedFormats) {
  return {
    $schema: "https://eips.ethereum.org/assets/eip-7730/erc7730-v1.schema.json",
    context: { $id: skDesc.context?.$id || "Contract", contract: { deployments: [{ chainId: Number(chainId), address }], abi: Array.isArray(abi) ? abi : [] } },
    metadata: { owner: skDesc.context?.$id || "Contract" },
    display: { formats: normalizeFormats(mergedFormats) },
  };
}

function lint(descriptor) {
  const dir = mkdtempSync(join(tmpdir(), "erc7730-lint-"));
  const file = join(dir, "calldata-candidate.json");
  wf(file, JSON.stringify(descriptor, null, 2));
  try { execFileSync(ERC7730_BIN, ["lint", file], { timeout: 30000 }); return true; }
  catch { return false; } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

function aggregate(results) {
  const bucketize = (rows) => {
    if (rows.length === 0) return null;
    const m = (k) => rows.reduce((s, r) => s + (r.score[k] ?? 0), 0) / rows.length;
    return { n: rows.length, linterPass: +(rows.filter((r) => r.lintPassed).length / rows.length).toFixed(3),
      fnRecall: +m("fnRecall").toFixed(3), fieldExactMatch: +m("fieldExactMatch").toFixed(3), intentMatch: +m("intentMatch").toFixed(3),
      fieldExactOnHit: +m("fieldExactMatchOnHit").toFixed(3), intentOnHit: +m("intentMatchOnHit").toFixed(3) };
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
  console.log(`hybrid: deterministic skeleton + ${MODEL} intent · ${testSet.length} held-out descriptors`);

  const results = [];
  let done = 0;
  for (const gt of testSet) {
    const { chainId, address } = gt.deployments[0];
    try {
      const { abi, userdoc, devdoc } = await sourcifyInputs(chainId, address);
      if (!abi.filter((x) => x.type === "function").length) throw new Error("no fns");
      const sk = skeleton(chainId, address, abi);
      if (!Object.keys(sk.formats).length) throw new Error("empty skeleton");
      let merged = sk.formats;
      try { const llm = await enrich(abi, userdoc, devdoc, sk.formats); merged = merge(sk.formats, llm); }
      catch { /* enrichment failed → fall back to skeleton (still structurally strong) */ merged = merge(sk.formats, { formats: {} }); }
      const descriptor = buildDescriptor(sk.desc, chainId, address, abi, merged);
      const lintPassed = lint(descriptor);
      if (!lintPassed) { results.push({ id: gt.id, bucket: gt.bucket, lintPassed: false, score: { fnRecall: 0, fieldExactMatch: 0, intentMatch: 0, formatExact: 0, fieldExactMatchOnHit: 0, intentMatchOnHit: 0 } }); }
      else {
        const feat = featuresFromDescriptor(descriptor);
        // strip the `#.`/`@.` root selector for SCORING only (GT paths are bare), while the
        // linted descriptor keeps the selector the linter requires.
        for (const fn of feat.functions ?? []) for (const f of fn.fields ?? []) f.path = normPath(f.path);
        const s = scoreDescriptor(gt, feat);
        results.push({ id: gt.id, bucket: gt.bucket, lintPassed: true, score: { fnRecall: s.fnRecall, fieldExactMatch: s.fieldExactMatch, intentMatch: s.intentMatch, formatExact: s.formatExact, fieldExactMatchOnHit: s.fieldExactMatchOnHit, intentMatchOnHit: s.intentMatchOnHit } });
      }
    } catch (e) {
      results.push({ id: gt.id, bucket: gt.bucket, lintPassed: false, score: { fnRecall: 0, fieldExactMatch: 0, intentMatch: 0, formatExact: 0, fieldExactMatchOnHit: 0, intentMatchOnHit: 0 }, error: String(e).slice(0, 80) });
    }
    if (++done % 10 === 0) { process.stdout.write(`  ${done}/${testSet.length}\n`); writeFileSync(join(HERE, `report-${GEN}.json`), JSON.stringify({ generator: GEN, model: MODEL, corpusCommit: corpus.commit, nTest: results.length, partial: true, bimodal: aggregate(results), results }, null, 2)); }
  }
  const agg = aggregate(results);
  writeFileSync(join(HERE, `report-${GEN}.json`), JSON.stringify({ generator: GEN, model: MODEL, corpusCommit: corpus.commit, nTest: results.length, bimodal: agg, results }, null, 2));
  const line = (label, b) => b && console.log(`  ${label.padEnd(10)} n=${String(b.n).padStart(3)}  lint=${(b.linterPass * 100).toFixed(0).padStart(3)}%  fnRecall=${b.fnRecall}  fieldExact=${b.fieldExactMatch}(onHit ${b.fieldExactOnHit})  intent=${b.intentMatch}(onHit ${b.intentOnHit})`);
  console.log(`\nbimodal results (gen=${GEN}, ${MODEL}):`);
  line("ALL", agg.all); line("standard", agg.standard); line("long-tail", agg.longTail);
  console.log("wrote", join(HERE, `report-${GEN}.json`));
}
main().catch((e) => { console.error("✖", e.message || e); process.exit(1); });
