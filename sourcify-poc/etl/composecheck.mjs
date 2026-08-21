/**
 * composecheck.mjs — can stdJsonInput / stdJsonOutput / signatures / metadata be
 * COMPOSED from normalized parts, byte-faithfully? Tested against sample-all-130.ndjson
 * (fields=all verbatim, deterministic sample), not assumed.
 */
import fs from "node:fs";
import path from "node:path";
import { keccak256, toBytes } from "viem";

const DIR = path.join(import.meta.dirname, "data");
const rows = fs.readFileSync(path.join(DIR, "sample-all-130.ndjson"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
console.log(`${rows.length} fields=all records\n`);

const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b); // key-order-sensitive on purpose first
const canon = (x) => Array.isArray(x) ? x.map(canon) : x && typeof x === "object"
  ? Object.fromEntries(Object.entries(x).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k, canon(v)])) : x;
const deepCanon = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const stats = {};
const hit = (k, ok) => { stats[k] ??= { ok: 0, bad: 0, badAddrs: [] }; ok ? stats[k].ok++ : (stats[k].bad++, stats[k].badAddrs.length < 3 && stats[k].badAddrs.push(cur)); };
let cur = "";

let multiPath = 0, multiName = 0, additionalInputNonNull = 0, transientNonNull = 0;
let evmKeys = new Set(), sjoContractKeys = new Set();

for (const r of rows) {
  cur = r.address;
  const sjo = r.stdJsonOutput ?? {};
  const sji = r.stdJsonInput ?? {};
  const c = r.compilation ?? {};

  // ---- stdJsonInput == { language, sources, settings } from parts?
  hit("sji.keys(language,sources,settings)", deep(Object.keys(sji).sort(), ["language","settings","sources"].sort()));
  hit("sji.language==compilation.language", sji.language === c.language);
  hit("sji.sources==sources (deep)", deep(sji.sources, r.sources));
  hit("sji.settings==compilerSettings (deep)", deep(sji.settings, c.compilerSettings));
  hit("sji.settings==compilerSettings (canon)", deepCanon(sji.settings, c.compilerSettings));

  // ---- stdJsonOutput structure
  const paths = Object.keys(sjo.contracts ?? {});
  if (paths.length > 1) multiPath++;
  const [fqPath, fqName] = (() => { const i = (c.fullyQualifiedName ?? "").lastIndexOf(":"); return [c.fullyQualifiedName?.slice(0,i), c.fullyQualifiedName?.slice(i+1)]; })();
  hit("sjo.contracts has fqn path", !!sjo.contracts?.[fqPath]);
  const names = Object.keys(sjo.contracts?.[fqPath] ?? {});
  if (names.length > 1) multiName++;
  const unit = sjo.contracts?.[fqPath]?.[fqName];
  hit("sjo.contracts[path][name] exists", !!unit);
  if (unit) {
    for (const k of Object.keys(unit)) sjoContractKeys.add(k);
    hit("sjo.abi==abi", deep(unit.abi, r.abi));
    hit("sjo.userdoc==userdoc", deep(unit.userdoc, r.userdoc));
    hit("sjo.devdoc==devdoc", deep(unit.devdoc, r.devdoc));
    hit("sjo.storageLayout==storageLayout", deep(unit.storageLayout, r.storageLayout));
    hit("sjo.transient==transient", deep(unit.transientStorageLayout ?? null, r.transientStorageLayout ?? null));
    // metadata: raw compiler string vs top-level parsed object
    if (typeof unit.metadata === "string") {
      hit("meta: parse(raw)==metadata obj", deepCanon(JSON.parse(unit.metadata), r.metadata));
      hit("meta: stringify(obj)==raw BYTE", JSON.stringify(r.metadata) === unit.metadata);
    }
    if (unit.evm) for (const k of Object.keys(unit.evm)) evmKeys.add(k);
    // evm composition vs bytecode fields
    hit("evm.bytecode.object==recompiledCreation", unit.evm?.bytecode?.object === r.creationBytecode?.recompiledBytecode);
    hit("evm.deployedBytecode.object==recompiledRuntime", unit.evm?.deployedBytecode?.object === r.runtimeBytecode?.recompiledBytecode);
    hit("evm.bytecode.sourceMap==creation.sourceMap", (unit.evm?.bytecode?.sourceMap ?? null) === (r.creationBytecode?.sourceMap ?? null));
    hit("evm.deployedBytecode.sourceMap==runtime.sourceMap", (unit.evm?.deployedBytecode?.sourceMap ?? null) === (r.runtimeBytecode?.sourceMap ?? null));
    hit("evm.bytecode.linkReferences==creation.linkReferences", deep(unit.evm?.bytecode?.linkReferences ?? null, r.creationBytecode?.linkReferences ?? null));
    hit("evm.deployedBytecode.immutableReferences==runtime.immutableReferences", deep(unit.evm?.deployedBytecode?.immutableReferences ?? null, r.runtimeBytecode?.immutableReferences ?? null));
  }
  // sjo.sources == sourceIds?
  hit("sjo.sources==sourceIds (deep)", deep(sjo.sources, r.sourceIds));

  // ---- signatures derivable from ABI?
  const sig = (x) => `${x.name}(${(x.inputs ?? []).map(t => t.internalType && t.type === "tuple" ? t.type : t.type).join(",")})`;
  // proper tuple expansion:
  const typeOf = (t) => t.type?.startsWith("tuple")
    ? `(${(t.components ?? []).map(typeOf).join(",")})${t.type.slice(5)}`
    : t.type;
  const sigOf = (x) => `${x.name}(${(x.inputs ?? []).map(typeOf).join(",")})`;
  const mine = { function: [], event: [], error: [] };
  for (const x of r.abi ?? []) {
    if (x.type !== "function" && x.type !== "event" && x.type !== "error") continue;
    const s = sigOf(x);
    const h = keccak256(toBytes(s));
    mine[x.type].push({ signature: s, signatureHash32: h, signatureHash4: h.slice(0, 10) });
  }
  const theirs = r.signatures ?? {};
  const setOf = (arr) => new Set((arr ?? []).map(x => x.signature + "|" + x.signatureHash32));
  for (const k of ["function", "event", "error"]) {
    const a = setOf(theirs[k]), b = setOf(mine[k]);
    hit(`signatures.${k} set==derived`, a.size === b.size && [...a].every(x => b.has(x)));
  }
  // order stability: is theirs sorted somehow?
  if ((theirs.function ?? []).length > 1) {
    const list = theirs.function.map(x => x.signature);
    hit("signatures.function sorted-asc", deep(list, [...list].sort()));
  }

  if (r.additionalInput != null) additionalInputNonNull++;
  if (r.transientStorageLayout != null) transientNonNull++;
}

console.log("check".padEnd(55) + "ok".padStart(6) + "bad".padStart(6) + "  example bad addrs");
for (const [k, v] of Object.entries(stats)) {
  console.log(k.padEnd(55) + String(v.ok).padStart(6) + String(v.bad).padStart(6) + (v.bad ? "  " + v.badAddrs.join(",") : ""));
}
console.log(`\nmultiPath ${multiPath} | multiName ${multiName} | additionalInput!=null ${additionalInputNonNull} | transient!=null ${transientNonNull}`);
console.log("stdJsonOutput.contracts[p][n] keys:", [...sjoContractKeys].join(", "));
console.log("evm keys:", [...evmKeys].join(", "));
