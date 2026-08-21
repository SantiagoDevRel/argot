/**
 * verify-sample.mjs — after the full send: pick N random contracts from the vc
 * lane and ask the DEPLOYED parity route for depth=all. Every one should come
 * back `identical` against live sourcify.dev. Prints the verdict per contract
 * and fails loudly on anything else — this is the evidence behind "100%".
 *
 *   BASE=https://sourcify-poc.vercel.app PW=123 N=25 node verify-sample.mjs
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "https://sourcify-poc.vercel.app";
const PW = process.env.PW ?? "123";
const N = Number(process.env.N ?? 25);
const SEED = Number(process.env.SEED ?? 42);
const DIR = path.join(import.meta.dirname, "data");

const vcs = fs.readFileSync(path.join(DIR, "patches2-verified_contract-130.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
// deterministic shuffle so a re-run checks the same sample
let s = SEED;
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const sample = [...vcs].sort(() => rnd() - 0.5).slice(0, N);

const gate = await fetch(`${BASE}/?pw=${PW}`, { redirect: "manual" });
const cookie = (gate.headers.get("set-cookie") ?? "").split(";")[0];
if (!cookie) throw new Error("no gate cookie — wrong password or gate changed");

let ok = 0;
const bad = [];
for (const [i, v] of sample.entries()) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/parity?chainId=130&address=${v.address}&depth=all`, { headers: { cookie } });
  const j = await r.json().catch(() => ({ verdict: `http ${r.status}` }));
  const line = `${String(i + 1).padStart(2)}/${N} ${v.address} ${String(v.attributes.name ?? "").slice(0, 24).padEnd(24)} -> ${j.verdict} (${j.comparedFields ?? "?"} fields, ${Date.now() - t0} ms)` +
    (j.mismatches?.length ? ` mismatches: ${j.mismatches.join(",")}` : "") + (j.reads?.unavailable?.length ? ` unavailable: ${j.reads.unavailable[0]}` : "");
  console.log(line);
  if (j.verdict === "identical") ok++; else bad.push({ address: v.address, verdict: j.verdict, mismatches: j.mismatches, unavailable: j.reads?.unavailable });
}
console.log(`\nidentical: ${ok}/${N}`);
if (bad.length) { console.log(JSON.stringify(bad, null, 1)); process.exitCode = 1; }
