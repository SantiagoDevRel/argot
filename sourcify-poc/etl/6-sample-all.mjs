/**
 * 6-sample-all.mjs — pull `fields=all` VERBATIM for a deterministic sample.
 *
 * stdJsonInput and stdJsonOutput are composed at read time (Sourcify composes
 * them too — neither exists as a stored blob in its Postgres). Composition can
 * drift from the real thing in a hundred quiet ways, so this file collects the
 * ground truth to diff against: every Nth address of the list, reproducible,
 * saved whole. 7-transform-full.mjs and the parity route both test against it.
 */
import fs from "node:fs";
import path from "node:path";

const CHAIN = process.env.CHAIN ?? "130";
const N = Number(process.env.N ?? 120);
const DIR = path.join(import.meta.dirname, "data");
const OUT = path.join(DIR, `sample-all-${CHAIN}.ndjson`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = fs.readFileSync(path.join(DIR, `list-${CHAIN}.ndjson`), "utf8").split("\n").filter(Boolean).map(JSON.parse);
const step = Math.max(1, Math.floor(list.length / N));
const sample = Array.from({ length: N }, (_, i) => list[i * step]).filter(Boolean);
const have = new Set(
  fs.existsSync(OUT)
    ? fs.readFileSync(OUT, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).address.toLowerCase())
    : [],
);
console.log(`sample: every ${step}th of ${list.length} -> ${sample.length} contracts, ${have.size} already fetched`);

const out = fs.createWriteStream(OUT, { flags: "a" });
let done = 0;
for (const [i, c] of sample.entries()) {
  if (have.has(c.address.toLowerCase())) continue;
  const url = `https://sourcify.dev/server/v2/contract/${CHAIN}/${c.address}?fields=all`;
  let j = null;
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (r.status === 429) { await sleep(2000 * (t + 1)); continue; }
      if (!r.ok) break;
      j = await r.json(); break;
    } catch { await sleep(1500 * (t + 1)); }
  }
  if (!j) { console.error(`\nFAILED ${c.address}`); continue; }
  out.write(JSON.stringify(j) + "\n");
  done++;
  process.stdout.write(`\r${i + 1}/${sample.length}   `);
  await sleep(200);
}
out.end();
console.log(`\ndone: ${done} new records`);
