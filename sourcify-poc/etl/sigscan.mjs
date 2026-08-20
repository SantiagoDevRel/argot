import fs from "node:fs"; import path from "node:path";
import { toFunctionSelector, toEventSelector } from "viem";
const rows = fs.readFileSync(path.join(import.meta.dirname,"data/detail-130.ndjson"),"utf8")
  .split("\n").filter(Boolean).map(JSON.parse);
const sigOf = (it) => `${it.name}(${(it.inputs??[]).map(i=>i.type).join(",")})`;
const bySel = new Map();  // selector -> Set(text)
let total=0;
for (const r of rows) for (const it of r.abi ?? []) {
  if (!it.name || !["function","event","error"].includes(it.type)) continue;
  const text = sigOf(it);
  let sel; try { sel = it.type==="event" ? toEventSelector(text) : toFunctionSelector(text); } catch { continue; }
  const short = it.type==="event" ? sel : sel.slice(0,10);
  if (!bySel.has(short)) bySel.set(short,{ texts:new Set(), type:it.type });
  bySel.get(short).texts.add(text); total++;
}
const collisions=[...bySel.values()].filter(v=>v.texts.size>1);
const payloads=[...bySel.entries()].map(([s,v])=>JSON.stringify({selector:s,type:v.type,signatures:[...v.texts]}).length).sort((a,b)=>a-b);
console.log(`ABI entries scanned        : ${total.toLocaleString()}`);
console.log(`distinct selectors         : ${bySel.size.toLocaleString()}`);
console.log(`selectors with >1 text     : ${collisions.length} (${(collisions.length/bySel.size*100).toFixed(2)}% — real 4-byte collisions)`);
console.log(`payload bytes  p50 ${payloads[Math.floor(payloads.length*.5)]}  p99 ${payloads[Math.floor(payloads.length*.99)]}  max ${payloads.at(-1)}  (limit 131,072)`);
console.log(`total payload              : ${(payloads.reduce((a,b)=>a+b,0)/1e6).toFixed(2)} MB for ${bySel.size.toLocaleString()} entities`);
console.log("");
console.log(`Sourcify's full dictionary is 9,920,797 signature rows.`);
const perEntity = payloads.reduce((a,b)=>a+b,0)/payloads.length;
console.log(`at ${Math.round(perEntity)} B/entity that is ~${(9920797*perEntity/1e9).toFixed(1)} GB of payload if every row were its own entity,`);
console.log(`or ~${(9920797*perEntity/1e9*0.35).toFixed(1)} GB grouped by selector (collision ratio observed here).`);
fs.writeFileSync(path.join(import.meta.dirname,"data/entities-signature-130.ndjson"),
  [...bySel.entries()].map(([s,v])=>JSON.stringify({
    kind:"signature", selector:s,
    attributes:{ ds:"sourcify", kind:"signature", selector:s, sigtype:v.type, variants:v.texts.size },
    payload:{ schema:"sourcify.signature.v1", selector:s, type:v.type, signatures:[...v.texts] },
  })).join("\n")+"\n");
console.log(`\nwrote data/entities-signature-130.ndjson`);
