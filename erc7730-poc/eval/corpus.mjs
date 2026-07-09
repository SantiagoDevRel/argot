// corpus.mjs — build the ERC-7730 ground-truth corpus for the backtest.
//
// Loads the 372 PRODUCTION descriptors (247 calldata + 125 eip712) from the official
// registry (ethereum/clear-signing-erc7730-registry @ a2b33ffe), excluding tests/ and
// testsv2/. For each it extracts the fields we score against (identity, function/message
// signatures, resolved field paths+labels+formats, intent, owner), buckets it
// standard vs long-tail (bimodal reporting), and emits a single corpus.json manifest +
// a deterministic few-shot / held-out split (no data leakage: a contract used as a
// prompt example is NEVER in the test set).
//
//   REGISTRY_DIR=/path/to/clear-signing-erc7730-registry node eval/corpus.mjs
//
// Default REGISTRY_DIR = ~/Downloads/clear-signing-erc7730-registry (the shallow clone).
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const REGISTRY_DIR =
  process.env.REGISTRY_DIR || join(homedir(), "Downloads", "clear-signing-erc7730-registry");
const OUT = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "corpus.json");
const FEWSHOT_K = 10; // diverse examples reserved for the prompt (held OUT of the test set)

// Standard = the descriptor's functions are dominated by well-known token/standard verbs.
// Long-tail = bespoke protocol logic (where the coverage value + accuracy risk both concentrate).
const STANDARD_FNS = new Set([
  "transfer", "transferfrom", "approve", "safetransferfrom", "setapprovalforall",
  "permit", "increaseallowance", "decreaseallowance", "mint", "burn", "deposit",
  "withdraw", "wrap", "unwrap", "swap", "supply", "borrow", "repay", "stake", "unstake",
]);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      // Exclude the test fixture folders — those are not ground-truth descriptors.
      if (e === "tests" || e === "testsv2") continue;
      out.push(...walk(p));
    } else if (/^(calldata|eip712)-.*\.json$/.test(e)) {
      out.push(p);
    }
  }
  return out;
}

// Resolve a field's {path,label,format} — following $ref into display.definitions.
function resolveField(f, defs) {
  let label = f.label;
  let format = f.format;
  if (f.$ref) {
    const key = String(f.$ref).replace("$.display.definitions.", "");
    const def = defs[key];
    if (def) {
      label = label ?? def.label;
      format = format ?? def.format;
    }
  }
  return { path: f.path ?? null, label: label ?? null, format: format ?? null };
}

function fnName(sig) {
  // "swap(address caller, (…) desc, bytes data)" -> "swap"; eip712 primaryType stays as-is.
  const m = String(sig).match(/^([A-Za-z0-9_]+)\s*\(/);
  return (m ? m[1] : String(sig)).toLowerCase();
}

// Many descriptors keep `context/metadata/deployments` in the per-deployment file but
// factor `display.formats`+`display.definitions` into a shared `common-*.json` via
// `includes`. Resolve it (descriptor's own display overrides the common file's).
function resolveIncludes(json, file) {
  if (!json.includes) return json;
  try {
    const commonPath = join(dirname(file), json.includes);
    const common = JSON.parse(readFileSync(commonPath, "utf8"));
    return {
      ...json,
      metadata: { ...(common.metadata ?? {}), ...(json.metadata ?? {}) },
      display: {
        definitions: { ...(common.display?.definitions ?? {}), ...(json.display?.definitions ?? {}) },
        formats: { ...(common.display?.formats ?? {}), ...(json.display?.formats ?? {}) },
      },
    };
  } catch {
    return json;
  }
}

function parseDescriptor(file) {
  const raw = readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const json = resolveIncludes(parsed, file);
  const kind = basename(file).startsWith("calldata") ? "calldata" : "eip712";
  const ctx = json.context ?? {};
  const deployments =
    ctx.contract?.deployments ?? ctx.eip712?.deployments ?? [];
  const defs = json.display?.definitions ?? {};
  const formats = json.display?.formats ?? {};

  const functions = Object.entries(formats).map(([sig, spec]) => ({
    signature: sig,
    name: fnName(sig),
    intent: typeof spec?.intent === "string" ? spec.intent : spec?.intent?.[Object.keys(spec.intent)[0]] ?? null,
    fields: Array.isArray(spec?.fields) ? spec.fields.map((f) => resolveField(f, defs)) : [],
  }));

  const names = functions.map((f) => f.name);
  const standardCount = names.filter((n) => STANDARD_FNS.has(n)).length;
  const bucket = names.length > 0 && standardCount / names.length >= 0.5 ? "standard" : "long-tail";

  return {
    file: file.slice(REGISTRY_DIR.length + 1).replace(/\\/g, "/"),
    id: ctx.$id ?? basename(file).replace(/\.json$/, ""),
    kind,
    owner: json.metadata?.owner ?? null,
    deployments: deployments.map((d) => ({ chainId: d.chainId, address: (d.address || "").toLowerCase() })),
    nFunctions: functions.length,
    bucket,
    functions,
  };
}

// Deterministic pseudo-random ordering from a stable hash (no Math.random → reproducible).
function stableRank(s) {
  return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 12), 16);
}

function main() {
  const files = walk(join(REGISTRY_DIR, "registry"));
  const descriptors = files.map(parseDescriptor).filter(Boolean).filter((d) => d.deployments.length > 0);

  const calldata = descriptors.filter((d) => d.kind === "calldata");
  const eip712 = descriptors.filter((d) => d.kind === "eip712");
  const standard = descriptors.filter((d) => d.bucket === "standard");
  const longtail = descriptors.filter((d) => d.bucket === "long-tail");

  // Few-shot split: pick K diverse examples (spread across buckets + kinds), held OUT of test.
  const byRank = [...descriptors].sort((a, b) => stableRank(a.file) - stableRank(b.file));
  const fewshotStd = byRank.filter((d) => d.bucket === "standard").slice(0, Math.ceil(FEWSHOT_K / 2));
  const fewshotLong = byRank.filter((d) => d.bucket === "long-tail").slice(0, Math.floor(FEWSHOT_K / 2));
  const fewshot = new Set([...fewshotStd, ...fewshotLong].map((d) => d.file));
  const testSet = descriptors.filter((d) => !fewshot.has(d.file));

  const manifest = {
    source: "ethereum/clear-signing-erc7730-registry",
    commit: "a2b33ffed92aab99cb9da2704610469a2588b520",
    generatedFrom: REGISTRY_DIR,
    counts: {
      total: descriptors.length,
      calldata: calldata.length,
      eip712: eip712.length,
      standard: standard.length,
      longTail: longtail.length,
      fewshot: fewshot.size,
      testSet: testSet.length,
    },
    fewshotFiles: [...fewshot],
    descriptors,
  };
  writeFileSync(OUT, JSON.stringify(manifest, null, 2));

  console.log("ERC-7730 ground-truth corpus");
  console.log("  registry:", REGISTRY_DIR);
  console.log("  total production descriptors:", descriptors.length, `(${calldata.length} calldata + ${eip712.length} eip712)`);
  console.log("  buckets:", standard.length, "standard /", longtail.length, "long-tail");
  console.log(`  split: ${fewshot.size} few-shot (held out) / ${testSet.length} test`);
  const totalFns = descriptors.reduce((s, d) => s + d.nFunctions, 0);
  console.log("  total function/message formats:", totalFns);
  console.log("  wrote", OUT);
}

main();
