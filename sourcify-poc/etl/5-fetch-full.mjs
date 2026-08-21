/**
 * 5-fetch-full.mjs — the SECOND detail pass: everything 1-fetch.mjs deliberately
 * left out, for the 100% replication.
 *
 * 1-fetch.mjs pulls the lookup fields (abi, compilation, deployment, sources…).
 * This pass pulls the rest of the record: both bytecode objects (onchain +
 * recompiled + sourceMap/linkReferences/cborAuxdata/immutableReferences +
 * transformations), metadata, storageLayout, transientStorageLayout, userdoc,
 * devdoc, sourceIds, signatures, additionalInput.
 *
 * What it does NOT fetch: stdJsonInput and stdJsonOutput. Sourcify itself does not
 * store either — both are COMPOSED at read time from the normalized tables
 * (sources + settings for the input; artifacts + code for the output). We do the
 * same, and 6-sample-all.mjs pulls `fields=all` for a deterministic sample so the
 * composition can be verified against the real thing instead of assumed.
 *
 * Same manners as 1-fetch.mjs: resumable (append + skip), one request at a time,
 * courtesy delay. Roughly 160 MB and ~25 minutes for the full chain.
 */
import fs from "node:fs";
import path from "node:path";

const CHAIN = process.env.CHAIN ?? "130";
const BASE = "https://sourcify.dev/server/v2";
const FIELDS = [
  // `sources` is here too: 1-fetch.mjs was supposed to carry it, but the on-disk
  // detail-130.ndjson predates that field joining its list (the transform's own
  // warning caught it — 0 sourcefile entities from 2,801 rows). This pass owns it now.
  "sources",
  "creationBytecode", "runtimeBytecode", "metadata", "storageLayout",
  "transientStorageLayout", "userdoc", "devdoc", "sourceIds", "signatures",
  "additionalInput",
].join(",");
const DELAY_MS = Number(process.env.DELAY_MS ?? 120);

const DIR = path.join(import.meta.dirname, "data");
const LIST = path.join(DIR, `list-${CHAIN}.ndjson`);
const OUT = path.join(DIR, `detail-full-${CHAIN}.ndjson`);

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

const list = fs.readFileSync(LIST, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const have = new Set(
  fs.existsSync(OUT)
    ? fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).address.toLowerCase())
    : [],
);
console.log(`${list.length} contracts on chain ${CHAIN}, ${have.size} already fetched`);

const out = fs.createWriteStream(OUT, { flags: "a" });
let done = have.size, bytes = 0;
const t0 = Date.now();
for (const c of list) {
  const a = c.address.toLowerCase();
  if (have.has(a)) continue;
  const j = await getJson(`${BASE}/contract/${CHAIN}/${c.address}?fields=${FIELDS}`);
  if (!j) { console.error(`\n404 ${c.address} — verified in the list but no record; skipping`); continue; }
  const line = JSON.stringify(j);
  out.write(line + "\n");
  bytes += line.length; done++;
  const rate = (done - have.size) / ((Date.now() - t0) / 60000);
  process.stdout.write(`\r${done}/${list.length}  ${(bytes / 1e6).toFixed(1)} MB new  ${rate.toFixed(0)}/min   `);
  await sleep(DELAY_MS);
}
out.end();
console.log(`\ndone: ${done}/${list.length} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
