/**
 * topup.mjs — close every gap audit-coverage.mjs found: for each address the live
 * feed has and our files do not, fetch BOTH passes (v1 fields + full fields) and
 * append. Also appends the address to list-130.ndjson so later runs know it.
 * Resumable and idempotent: run it after any audit, it only touches gaps.
 */
import fs from "node:fs";
import path from "node:path";

const CHAIN = process.env.CHAIN ?? "130";
const DIR = path.join(import.meta.dirname, "data");
const BASE = "https://sourcify.dev/server/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const V1_FIELDS = "abi,compilation,deployment,proxyResolution,runtimeMatch,creationMatch,verifiedAt,matchId,sources";
const FULL_FIELDS = "sources,creationBytecode,runtimeBytecode,metadata,storageLayout,transientStorageLayout,userdoc,devdoc,sourceIds,signatures,additionalInput";

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(1000 * (i + 1)); }
  }
}

const audit = JSON.parse(fs.readFileSync(path.join(DIR, `audit-${CHAIN}.json`), "utf8"));
const targets = [...new Set([...audit.missingV1, ...audit.missingFull, ...audit.missingTransform])];
console.log(`${targets.length} addresses to close (audited ${audit.auditedAt})`);

const has = (f) => new Set(fs.existsSync(path.join(DIR, f))
  ? fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).address.toLowerCase())
  : []);
const inV1 = has(`detail-${CHAIN}.ndjson`);
const inFull = has(`detail-full-${CHAIN}.ndjson`);
const inList = has(`list-${CHAIN}.ndjson`);

const outV1 = fs.createWriteStream(path.join(DIR, `detail-${CHAIN}.ndjson`), { flags: "a" });
const outFull = fs.createWriteStream(path.join(DIR, `detail-full-${CHAIN}.ndjson`), { flags: "a" });
const outList = fs.createWriteStream(path.join(DIR, `list-${CHAIN}.ndjson`), { flags: "a" });

let done = 0, gone = 0;
for (const a of targets) {
  // BOTH passes fetched back-to-back so their matchIds cannot drift apart —
  // the staleJoin guard in 7-transform-full.mjs would reject a drifted pair.
  const needV1 = !inV1.has(a), needFull = !inFull.has(a);
  const v1 = needV1 ? await getJson(`${BASE}/contract/${CHAIN}/${a}?fields=${V1_FIELDS}`) : true;
  const full = needFull ? await getJson(`${BASE}/contract/${CHAIN}/${a}?fields=${FULL_FIELDS}`) : true;
  if (!v1 || !full) { gone++; console.log(`  404 ${a} — in the feed, no record (their inconsistency, logged)`); continue; }
  if (needV1) outV1.write(JSON.stringify(v1) + "\n");
  if (needFull) outFull.write(JSON.stringify(full) + "\n");
  if (!inList.has(a)) {
    const src = typeof v1 === "object" ? v1 : full;
    outList.write(JSON.stringify({ match: src.match, creationMatch: src.creationMatch, runtimeMatch: src.runtimeMatch, chainId: src.chainId, address: src.address, verifiedAt: src.verifiedAt, matchId: src.matchId }) + "\n");
  }
  done++;
  process.stdout.write(`\r${done}/${targets.length}   `);
  await sleep(150);
}
outV1.end(); outFull.end(); outList.end();
console.log(`\nclosed ${done}, gone(404) ${gone} — re-run 7-transform-full.mjs now`);
