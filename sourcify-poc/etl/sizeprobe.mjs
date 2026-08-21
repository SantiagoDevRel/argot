/**
 * sizeprobe.mjs — measure, per real Unichain contract, how big each PART of the
 * Sourcify record is: metadata, bytecode, sources (bundle AND per file), artifacts.
 * Deterministic sample: every Nth address of the list, so it is reproducible.
 */
import fs from "node:fs"; import path from "node:path";
const N = Number(process.env.N ?? 40);
const DIR = path.join(import.meta.dirname, "data");
const list = fs.readFileSync(path.join(DIR,"list-130.ndjson"),"utf8").trim().split("\n").map(JSON.parse);
const step = Math.floor(list.length / N);
const sample = Array.from({length:N},(_,i)=>list[i*step]).filter(Boolean);
const B = (v) => v==null ? null : Buffer.byteLength(typeof v==="string"?v:JSON.stringify(v));
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const out=[];
for (const [i,c] of sample.entries()) {
  const url=`https://sourcify.dev/server/v2/contract/130/${c.address}?fields=all`;
  let j=null;
  for(let t=0;t<4;t++){ try{ const r=await fetch(url,{headers:{accept:"application/json"}}); if(!r.ok) break; j=await r.json(); break;}catch{ await sleep(1500*(t+1)); } }
  if(!j){ process.stdout.write(`\r${i+1}/${sample.length} FAILED ${c.address}   `); continue; }
  const files = Object.values(j.sources??{}).map(s=>B(s?.content??"")).filter(x=>x!=null);
  out.push({
    address:c.address,
    all: B(j),
    metadata: B(j.metadata),
    abi: B(j.abi),
    sourcesBundle: B(j.sources),
    sourceFileMax: files.length?Math.max(...files):null,
    sourceFileCount: files.length,
    creationBytecode: B(j.creationBytecode?.onchainBytecode),
    runtimeBytecode: B(j.runtimeBytecode?.onchainBytecode),
    runtimeArtifacts: B({sourceMap:j.runtimeBytecode?.sourceMap,link:j.runtimeBytecode?.linkReferences,imm:j.runtimeBytecode?.immutableReferences,cbor:j.runtimeBytecode?.cborAuxdata}),
    storageLayout: B(j.storageLayout),
    userdoc: B(j.userdoc), devdoc: B(j.devdoc),
    stdJsonInput: B(j.stdJsonInput), stdJsonOutput: B(j.stdJsonOutput),
  });
  process.stdout.write(`\r${i+1}/${sample.length} ${(out.at(-1).all/1e3).toFixed(0)} kB   `);
  await sleep(150);
}
fs.writeFileSync(path.join(DIR,"sizeprobe-130.json"), JSON.stringify({sampledAt:new Date().toISOString(),n:out.length,step,rows:out},null,1));
const LIMIT=131072;
const stat=(k)=>{const v=out.map(r=>r[k]).filter(x=>x!=null).sort((a,b)=>a-b); if(!v.length) return null;
  return {n:v.length,p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v.at(-1),over:v.filter(x=>x>LIMIT).length};};
console.log(`\n\nsample n=${out.length} (every ${step}th of ${list.length}) — limit ${LIMIT.toLocaleString()} B\n`);
console.log("component".padEnd(20)+"p50".padStart(12)+"p95".padStart(12)+"max".padStart(12)+"  over limit");
for(const k of ["all","metadata","abi","sourcesBundle","sourceFileMax","creationBytecode","runtimeBytecode","runtimeArtifacts","storageLayout","userdoc","devdoc","stdJsonInput","stdJsonOutput"]){
  const s=stat(k); if(!s) {console.log(k.padEnd(20)+"  (absent)"); continue;}
  console.log(k.padEnd(20)+s.p50.toLocaleString().padStart(12)+s.p95.toLocaleString().padStart(12)+s.max.toLocaleString().padStart(12)+`  ${s.over}/${s.n}`);
}
