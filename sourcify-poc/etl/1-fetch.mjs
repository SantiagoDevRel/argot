/**
 * 1-fetch.mjs — pull a COMPLETE Sourcify chain into NDJSON.
 *
 * Two passes, because Sourcify splits them that way:
 *   list   /v2/contracts/{chain}     -> cursor-paginated feed (match, address, matchId)
 *   detail /v2/contract/{chain}/{a}  -> the field-scoped record we actually index
 *
 * Resumable: both passes append and skip what is already on disk, so a killed run
 * costs only the request in flight. Sourcify is a public good — one request at a
 * time with a courtesy delay, never a burst.
 */
import fs from "node:fs";
import path from "node:path";

const CHAIN = process.env.CHAIN ?? "130";
const BASE = "https://sourcify.dev/server/v2";
// The lookup a wallet or explorer actually needs. NOT `all`: sources are ~300 KB
// and belong in the content-addressed tier, not in a queryable index.
const FIELDS = "abi,compilation,deployment,proxyResolution,runtimeMatch,creationMatch,verifiedAt,matchId";
const DELAY_MS = Number(process.env.DELAY_MS ?? 120);

const DIR = path.join(import.meta.dirname, "data");
fs.mkdirSync(DIR, { recursive: true });
const LIST = path.join(DIR, `list-${CHAIN}.ndjson`);
const DETAIL = path.join(DIR, `detail-${CHAIN}.ndjson`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// ---- pass 1: the full list -------------------------------------------------
async function fetchList() {
  const have = readNdjson(LIST);
  if (have.length) { console.log(`list: ${have.length} already on disk, skipping pass 1`); return have; }
  const out = fs.createWriteStream(LIST, { flags: "a" });
  let after = null, total = 0;
  for (;;) {
    const url = `${BASE}/contracts/${CHAIN}?limit=200&sort=asc` + (after ? `&afterMatchId=${after}` : "");
    const page = await getJson(url);
    const rows = page?.results ?? [];
    if (!rows.length) break;
    for (const r of rows) out.write(JSON.stringify(r) + "\n");
    total += rows.length;
    after = rows[rows.length - 1].matchId;
    process.stdout.write(`\rlist: ${total} contracts (afterMatchId=${after})   `);
    if (rows.length < 200) break;
    await sleep(DELAY_MS);
  }
  out.end();
  console.log(`\nlist: done, ${total} contracts on chain ${CHAIN}`);
  return readNdjson(LIST);
}

// ---- pass 2: the detail records -------------------------------------------
async function fetchDetail(list) {
  const done = new Set(readNdjson(DETAIL).map((d) => d.address?.toLowerCase()));
  console.log(`detail: ${done.size}/${list.length} already on disk`);
  const out = fs.createWriteStream(DETAIL, { flags: "a" });
  let n = done.size, miss = 0, bytes = 0;
  const t0 = Date.now();
  for (const c of list) {
    if (done.has(c.address.toLowerCase())) continue;
    const j = await getJson(`${BASE}/contract/${CHAIN}/${c.address}?fields=${FIELDS}`);
    if (!j) { miss++; continue; }
    // carry the list fields the detail call does not echo back
    const rec = { ...j, chainId: String(CHAIN), address: c.address, match: c.match ?? j.match };
    const line = JSON.stringify(rec);
    bytes += line.length;
    out.write(line + "\n");
    n++;
    if (n % 25 === 0) {
      const rate = n / ((Date.now() - t0) / 1000 || 1);
      process.stdout.write(`\rdetail: ${n}/${list.length}  ${(bytes / 1e6).toFixed(1)} MB  ${rate.toFixed(1)}/s  miss=${miss}   `);
    }
    await sleep(DELAY_MS);
  }
  out.end();
  console.log(`\ndetail: done. ${n} records, ${(bytes / 1e6).toFixed(1)} MB, ${miss} missing`);
}

const list = await fetchList();
await fetchDetail(list);
