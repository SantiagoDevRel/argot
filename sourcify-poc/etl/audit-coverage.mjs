/**
 * audit-coverage.mjs — is our copy of chain 130 actually COMPLETE, against the
 * live feed, right now?
 *
 * Walks Sourcify's cursor feed from scratch (never trusting the on-disk list),
 * then reconciles four sets: the live feed, list-130.ndjson, detail-130.ndjson
 * (v1 fields) and detail-full-130.ndjson (v2 fields). Every discrepancy is
 * named with its address — no "roughly complete".
 */
import fs from "node:fs";
import path from "node:path";

const CHAIN = process.env.CHAIN ?? "130";
const DIR = path.join(import.meta.dirname, "data");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(1000 * (i + 1)); }
  }
}

// ---- the live feed, walked whole
const live = new Map(); // addr -> {matchId, match}
let after = "";
let pages = 0;
for (;;) {
  const u = `https://sourcify.dev/server/v2/contracts/${CHAIN}?sort=asc&limit=200${after ? `&afterMatchId=${after}` : ""}`;
  const j = await getJson(u);
  const rows = j.results ?? [];
  if (!rows.length) break;
  for (const r of rows) {
    const a = r.address.toLowerCase();
    // one address can be re-verified: keep the LATEST matchId, count once
    if (!live.has(a) || BigInt(r.matchId) > BigInt(live.get(a).matchId)) live.set(a, { matchId: r.matchId, match: r.match });
  }
  after = rows[rows.length - 1].matchId;
  pages++;
  process.stdout.write(`\rfeed: ${pages} pages, ${live.size} distinct addresses   `);
  await sleep(120);
}
console.log();

const load = (f, key = "address") => new Set(
  fs.existsSync(path.join(DIR, f))
    ? fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)[key].toLowerCase())
    : [],
);
const list = load(`list-${CHAIN}.ndjson`);
const v1 = load(`detail-${CHAIN}.ndjson`);
const full = load(`detail-full-${CHAIN}.ndjson`);
const vcs = load(`patches2-verified_contract-${CHAIN}.ndjson`);

const diff = (a, b) => [...a].filter((x) => !b.has(x));
const liveSet = new Set(live.keys());

console.log(`
live feed (distinct addresses) : ${live.size}
list-${CHAIN}.ndjson             : ${list.size}
detail v1                      : ${v1.size}
detail full (v2 fields)        : ${full.size}
transformed (v2 vc lane)       : ${vcs.size}

missing from v1 vs live        : ${diff(liveSet, v1).length}  ${diff(liveSet, v1).slice(0, 8).join(" ")}
missing from full vs live      : ${diff(liveSet, full).length}  ${diff(liveSet, full).slice(0, 8).join(" ")}
missing from TRANSFORM vs live : ${diff(liveSet, vcs).length}  ${diff(liveSet, vcs).slice(0, 8).join(" ")}
in our files but NOT live      : ${diff(v1, liveSet).length}  ${diff(v1, liveSet).slice(0, 5).join(" ")}
`);

fs.writeFileSync(path.join(DIR, `audit-${CHAIN}.json`), JSON.stringify({
  auditedAt: new Date().toISOString(),
  liveDistinct: live.size,
  local: { list: list.size, v1: v1.size, full: full.size, transformed: vcs.size },
  missingV1: diff(liveSet, v1),
  missingFull: diff(liveSet, full),
  missingTransform: diff(liveSet, vcs),
  extraLocal: diff(v1, liveSet),
}, null, 1));
console.log(`written data/audit-${CHAIN}.json`);
