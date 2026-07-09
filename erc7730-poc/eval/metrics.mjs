// metrics.mjs — scoring for the ERC-7730 backtest. Pure functions, self-tested.
// Compares a GENERATED descriptor's per-function fields/intent against the ground-truth
// descriptor. Structural linter-pass is scored separately (the real `erc7730 lint` runs
// in the DGX wrapper; here we only score field/intent fidelity + coverage).

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Token Jaccard on words — a cheap, dependency-free intent similarity. The DGX run can
// additionally report embedding cosine (Qwen3-Embedding) for a semantic number; this is
// the offline proxy that needs no model.
export function tokenSim(a, b) {
  const sa = new Set(norm(a).split(" ").filter(Boolean));
  const sb = new Set(norm(b).split(" ").filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// Score one function's generated fields vs ground-truth fields (matched by `path`).
// Returns: pathRecall, pathPrecision, formatExact (over matched), labelSim (over matched),
// and fieldExactMatch = fraction of GT fields whose path is present AND format equals.
export function scoreFields(gtFields, genFields) {
  const gt = gtFields.filter((f) => f.path);
  const gen = genFields.filter((f) => f.path);
  const genByPath = new Map(gen.map((f) => [f.path, f]));
  if (gt.length === 0) return { pathRecall: 1, pathPrecision: gen.length === 0 ? 1 : 0, formatExact: 1, labelSim: 1, fieldExactMatch: 1, nGt: 0 };

  let matched = 0, formatOk = 0, labelSum = 0, exact = 0;
  for (const f of gt) {
    const g = genByPath.get(f.path);
    if (!g) continue;
    matched++;
    const fmtOk = norm(f.format) === norm(g.format);
    if (fmtOk) formatOk++;
    labelSum += tokenSim(f.label, g.label);
    if (fmtOk) exact++;
  }
  return {
    pathRecall: matched / gt.length,
    pathPrecision: gen.length ? matched / gen.length : 0,
    formatExact: matched ? formatOk / matched : 0,
    labelSim: matched ? labelSum / matched : 0,
    fieldExactMatch: exact / gt.length,
    nGt: gt.length,
  };
}

// Score a whole generated descriptor vs ground truth. Matches functions by name.
export function scoreDescriptor(gt, gen) {
  const genByName = new Map((gen.functions ?? []).map((f) => [f.name, f]));
  const per = [];
  for (const gf of gt.functions ?? []) {
    const g = genByName.get(gf.name);
    if (!g) {
      per.push({ name: gf.name, present: false, intentSim: 0, fieldExactMatch: 0, pathRecall: 0, formatExact: 0 });
      continue;
    }
    const fs = scoreFields(gf.fields ?? [], g.fields ?? []);
    per.push({ name: gf.name, present: true, intentSim: tokenSim(gf.intent, g.intent), ...fs });
  }
  const n = per.length || 1;
  const matched = per.filter((p) => p.present);
  const m = matched.length || 1;
  const avg = (k) => per.reduce((s, p) => s + (p[k] ?? 0), 0) / n;
  const avgMatched = (k) => matched.reduce((s, p) => s + (p[k] ?? 0), 0) / m;
  return {
    // coverage: did we describe the same functions the dApp chose to clear-sign?
    fnRecall: matched.length / n,
    // quality over ALL gt functions (unmatched count as 0) — the strict view
    intentMatch: avg("intentSim"),
    fieldExactMatch: avg("fieldExactMatch"),
    formatExact: avg("formatExact"),
    // quality over MATCHED functions only — "when it describes the same function, how good"
    intentMatchOnHit: avgMatched("intentSim"),
    fieldExactMatchOnHit: avgMatched("fieldExactMatch"),
    formatExactOnHit: avgMatched("formatExact"),
    per,
  };
}

// --- self-test (node eval/metrics.mjs) ---
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("metrics.mjs")) {
  const gt = {
    functions: [
      { name: "swap", intent: "Swap tokens on Uniswap", fields: [
        { path: "amountIn", label: "Amount to swap", format: "tokenAmount" },
        { path: "to", label: "Recipient", format: "addressName" },
      ] },
    ],
  };
  const perfect = scoreDescriptor(gt, gt);
  const partial = scoreDescriptor(gt, {
    functions: [{ name: "swap", intent: "Swap on Uniswap", fields: [
      { path: "amountIn", label: "Amount", format: "tokenAmount" },
      { path: "to", label: "Recipient", format: "raw" }, // wrong format
    ] }],
  });
  const miss = scoreDescriptor(gt, { functions: [] });
  const ok =
    perfect.fieldExactMatch === 1 && perfect.intentMatch === 1 && perfect.fnRecall === 1 &&
    partial.fieldExactMatch === 0.5 && partial.formatExact === 0.5 && partial.intentMatch > 0 && partial.intentMatch < 1 &&
    miss.fnRecall === 0 && miss.fieldExactMatch === 0;
  console.log("metrics self-test:", ok ? "PASS ✓" : "FAIL ✗");
  console.log("  perfect:", JSON.stringify({ f: perfect.fieldExactMatch, i: perfect.intentMatch, r: perfect.fnRecall }));
  console.log("  partial:", JSON.stringify({ f: partial.fieldExactMatch, fmt: partial.formatExact, i: Number(partial.intentMatch.toFixed(2)) }));
  console.log("  miss:   ", JSON.stringify({ f: miss.fieldExactMatch, r: miss.fnRecall }));
  if (!ok) process.exit(1);
}
