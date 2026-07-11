// harvest.mjs — coverage + distillation harvester. Runs ON THE DGX (local wrapper +
// Sourcify). Lists verified Sourcify contracts, generates a lint-gated candidate ERC-7730
// descriptor for each via the DGX wrapper, and writes the lint-PASSING ones to a JSONL.
//
// One pass, two outputs:
//   • COVERAGE (Lever D): each lint-passing descriptor → a row the laptop seeder writes to
//     Arkiv as a queryable CANDIDATE entity (authorship stays with the dApp; never attested).
//   • DISTILLATION (Lever B): each row also carries an SFT {system,user,assistant} pair
//     (contract inputs → the valid formats the model produced) → a training corpus for a
//     later QLoRA. The registry ground truth stays HELD-OUT (this harvests the long tail),
//     so training on this never leaks into the eval.
//
//   DGX_URL=http://127.0.0.1:9010 DGX_BEARER=<bearer> \
//     node scripts/harvest.mjs --model gpt-oss:120b --count 500 --chain 1 --out harvest-gptoss.jsonl
//
// Idempotent-ish: appends; skips addresses already present in --out. Cursor-paginates
// Sourcify so re-runs advance. NEVER writes keys/secrets. Descriptors are inert data.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MODEL = opt("--model", "qwen3-coder-next:q4_K_M");
const COUNT = Number(opt("--count", "200"));
const CHAIN = Number(opt("--chain", "1"));
const CONCURRENCY = Number(opt("--concurrency", "2")); // wrapper caps generate at 2
const OUT = opt("--out", `harvest-${MODEL.replace(/[^a-z0-9]+/gi, "-")}.jsonl`);
const DGX_URL = (process.env.DGX_URL || "http://127.0.0.1:9010").replace(/\/$/, "");
const BEARER = process.env.DGX_BEARER || "";
const SOURCIFY = process.env.SOURCIFY_URL || "https://sourcify.dev/server/v2/contract";
const LIST = `https://sourcify.dev/server/v2/contracts/${CHAIN}`;

// Mirror of the wrapper's prompt so the SFT completion pairs are faithful to what a
// fine-tuned model must reproduce. (Kept in sync with dgx-wrapper/server.mjs SYSTEM.)
const SYSTEM = `You generate the "display.formats" of a CANDIDATE ERC-7730 clear-signing descriptor. Output ONLY { "formats": { "<functionSignature>": { "intent": "<short imperative>", "fields": [ { "path": "<paramName>", "label": "<human label>", "format": "<erc7730 format>" } ] } } }. Key by FULL signature with param types. Include only user-facing state-changing functions. Formats: tokenAmount, addressName, amount, date, duration, raw. Paths DOT notation (struct member "desc.amount"; array element "arr.[]").`;
const buildUserMsg = (abi, userdoc, devdoc) => [
  `ABI (functions only): ${JSON.stringify((abi || []).filter((x) => x.type === "function")).slice(0, 14000)}`,
  `NatSpec userdoc (@notice): ${JSON.stringify(userdoc || {}).slice(0, 6000)}`,
  `NatSpec devdoc (@param/@dev): ${JSON.stringify(devdoc || {}).slice(0, 6000)}`,
  `Produce the "formats" JSON now.`,
].join("\n\n");

async function listContracts(target, seen) {
  const out = [];
  let cursor = "";
  while (out.length < target) {
    const url = `${LIST}?limit=200&sort=desc${cursor ? `&afterMatchId=${cursor}` : ""}`;
    let j;
    try { const r = await fetch(url); if (!r.ok) break; j = await r.json(); } catch { break; }
    const rows = j.results || [];
    if (!rows.length) break;
    for (const r of rows) {
      const addr = String(r.address || "").toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(addr) && !seen.has(`${CHAIN}:${addr}`)) out.push(addr);
    }
    cursor = rows[rows.length - 1].matchId;
    if (!cursor) break;
  }
  return out.slice(0, target);
}

async function sourcifyInputs(address) {
  const r = await fetch(`${SOURCIFY}/${CHAIN}/${address}?fields=abi,userdoc,devdoc,metadata,proxyResolution`);
  if (!r.ok) throw new Error(`sourcify ${r.status}`);
  const s = await r.json();
  let abi = s.abi, userdoc = s.userdoc, devdoc = s.devdoc;
  const implRaw = s.proxyResolution?.isProxy ? s.proxyResolution.implementations?.[0]?.address : null;
  if (/^0x[0-9a-fA-F]{40}$/.test(String(implRaw || ""))) {
    try { const ir = await fetch(`${SOURCIFY}/${CHAIN}/${implRaw}?fields=abi,userdoc,devdoc`);
      if (ir.ok) { const iso = await ir.json(); if (Array.isArray(iso.abi) && iso.abi.length) { abi = iso.abi; userdoc = iso.userdoc; devdoc = iso.devdoc; } } } catch {}
  }
  const ct = s.metadata?.settings?.compilationTarget;
  const name = (ct && Object.values(ct)[0]) || s.metadata?.output?.devdoc?.title || "Contract";
  return { abi: Array.isArray(abi) ? abi : [], userdoc, devdoc, name };
}

async function generate(address) {
  const r = await fetch(`${DGX_URL}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ chainId: CHAIN, address, model: MODEL }),
    signal: AbortSignal.timeout(290000),
  });
  if (!r.ok) throw new Error(`dgx ${r.status}`);
  return r.json();
}

function loadSeen() {
  const seen = new Set();
  if (existsSync(OUT)) for (const ln of readFileSync(OUT, "utf8").split("\n")) {
    if (!ln.trim()) continue;
    try { const o = JSON.parse(ln); seen.add(`${o.chainId}:${o.address}`); } catch {}
  }
  return seen;
}

async function main() {
  if (!BEARER) { console.error("DGX_BEARER required"); process.exit(1); }
  const seen = loadSeen();
  console.log(`harvest: model=${MODEL} chain=${CHAIN} target=${COUNT} · already have ${seen.size} · out=${OUT}`);
  const addrs = await listContracts(COUNT * 2, seen); // over-fetch; many won't lint/have fns
  console.log(`listed ${addrs.length} candidate addresses from Sourcify`);

  let kept = 0, tried = 0, i = 0;
  async function worker() {
    while (i < addrs.length && kept < COUNT) {
      const address = addrs[i++];
      tried++;
      try {
        const inputs = await sourcifyInputs(address);
        if (!inputs.abi.filter((x) => x.type === "function").length) continue;
        const res = await generate(address);
        if (!res.lintPassed) continue;
        const desc = typeof res.descriptor === "string" ? JSON.parse(res.descriptor) : res.descriptor;
        const formats = desc?.display?.formats || {};
        if (!Object.keys(formats).length) continue;
        const row = {
          chainId: CHAIN, address, contract: inputs.name, model: MODEL,
          lintPassed: true, repaired: !!res.repaired,
          descriptor: desc,
          // distillation SFT pair (chat format)
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: buildUserMsg(inputs.abi, inputs.userdoc, inputs.devdoc) },
            { role: "assistant", content: JSON.stringify({ formats }) },
          ],
        };
        appendFileSync(OUT, JSON.stringify(row) + "\n");
        kept++;
        if (kept % 25 === 0) console.log(`  kept ${kept}/${COUNT} · tried ${tried} · pass-rate ${(100 * kept / tried).toFixed(0)}%`);
      } catch { /* skip errors (404/timeouts); keep going */ }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`DONE · kept ${kept} lint-passing / tried ${tried} (pass-rate ${(100 * kept / Math.max(1, tried)).toFixed(1)}%) → ${OUT}`);
}
main().catch((e) => { console.error("✖", e.message || e); process.exit(1); });
