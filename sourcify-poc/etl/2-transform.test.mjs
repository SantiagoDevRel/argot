/**
 * 2-transform.test.mjs — exercises transformRows() against 3 real Sourcify v2
 * `fields=all` responses committed under fixtures/. No network, no filesystem
 * writes: this only calls the pure function 2-transform.mjs exports, the same
 * one the ETL script's `main()` calls after reading detail-{CHAIN}.ndjson.
 *
 * Run with `node --test` (or `npm test` from this directory).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { transformRows, sha256, s128 } from "./2-transform.mjs";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");
const FIXTURE_FILES = ["usdc_result.json", "wbtc_result.json", "safe_result.json"];

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8"));
}

const fixtures = FIXTURE_FILES.map(loadFixture);

test("sha256() matches Node's own digest, hex-prefixed", () => {
  const expected = "0x" + crypto.createHash("sha256").update("hello").digest("hex");
  assert.equal(sha256("hello"), expected);
});

test("s128() passes short strings through and truncates long ones under the limit", () => {
  assert.equal(s128("solc"), "solc");
  const long = "x".repeat(500);
  const truncated = s128(long);
  assert.ok(Buffer.byteLength(truncated) <= 128);
  assert.ok(truncated.endsWith("…"));
});

test("transformRows() produces one verified_contract per fixture", () => {
  const { vcs } = transformRows(fixtures);
  assert.equal(vcs.length, fixtures.length);
  for (const [i, vc] of vcs.entries()) {
    assert.equal(vc.address, fixtures[i].address);
  }
});

test("verified_contract attribute count never exceeds the 32-attribute budget", () => {
  const { vcs } = transformRows(fixtures);
  for (const vc of vcs) {
    assert.ok(Object.keys(vc.attributes).length <= 32, `${vc.address} has ${Object.keys(vc.attributes).length} attributes`);
  }
});

test("compilation entities dedupe by fingerprint, not one-per-contract", () => {
  const { compilations } = transformRows(fixtures);
  // 3 distinct contracts (USDC proxy, WBTC, Safe) with different compiler settings
  // each get their own compilation -- but re-transforming the SAME row twice must
  // not create a second entity.
  const { compilations: doubled } = transformRows([...fixtures, fixtures[0]]);
  assert.equal(doubled.size, compilations.size, "re-seeing the same record must not grow the compilation set");
});

test("compilation payload carries a path -> sha256 map instead of source bodies", () => {
  const { compilations } = transformRows([fixtures[0]]); // usdc: 1 source file
  const [cp] = [...compilations.values()];
  const sourcesMap = fixtures[0].sources ?? {};
  const paths = Object.keys(sourcesMap);
  assert.ok(paths.length > 0, "fixture must actually have sources to make this test meaningful");
  assert.deepEqual(Object.keys(cp.payload.sources).sort(), paths.sort());
  for (const p of paths) {
    assert.equal(cp.payload.sources[p], sha256(sourcesMap[p].content));
  }
  // The compilation payload must NOT embed the source bodies themselves -- that's
  // the whole point of this feature (MAX_PAYLOAD_BYTES vs a ~307KB median sources
  // bundle, see README "the size wall").
  assert.equal(JSON.stringify(cp.payload).includes(sourcesMap[paths[0]].content), false);
});

test("sourcefile entities are content-addressed and deduplicated across contracts", () => {
  const { sourceFiles, sourceFileRefs } = transformRows(fixtures);
  let totalPaths = 0;
  for (const f of fixtures) totalPaths += Object.keys(f.sources ?? {}).length;
  assert.equal(sourceFileRefs, totalPaths);
  assert.ok(sourceFiles.size > 0);
  // The dedup unit is content, not (contract, path): a file byte-identical to one
  // already seen must not produce a second entity.
  assert.ok(sourceFiles.size <= sourceFileRefs);

  for (const [hash, entity] of sourceFiles) {
    assert.equal(hash, sha256(entity.payload.content));
    assert.equal(entity.attributes.hash, hash);
    assert.equal(entity.attributes.kind, "sourcefile");
    assert.equal(entity.attributes.ds, "sourcify");
  }
});

test("safe_result contributes many source files (it's a large multi-file contract)", () => {
  const safe = fixtures.find((f) => f.address?.toLowerCase() === "0xd9db270c1b5e3bd161e8c8503c55ceabee709552");
  assert.ok(safe, "safe fixture must be present");
  const { sourceFiles } = transformRows([safe]);
  const expectedFiles = Object.keys(safe.sources ?? {}).length;
  assert.ok(expectedFiles > 1, "fixture should have multiple source files");
  assert.ok(sourceFiles.size <= expectedFiles && sourceFiles.size > 0);
});

test("re-transforming an identical row twice does not duplicate sourcefile entities", () => {
  const once = transformRows([fixtures[0]]);
  const twice = transformRows([fixtures[0], fixtures[0]]);
  assert.equal(twice.sourceFiles.size, once.sourceFiles.size);
  assert.equal(twice.sourceFileRefs, once.sourceFileRefs * 2);
});

test("none of these 3 real records blow the payload or attribute budgets", () => {
  const { vcs, oversizeVc, oversizeSf, sourceFiles } = transformRows(fixtures);
  assert.deepEqual(oversizeVc, []);
  assert.deepEqual(oversizeSf, []);
  for (const vc of vcs) assert.ok(vc.bytes <= 131_072, `${vc.address} payload is ${vc.bytes} bytes`);
  for (const sf of sourceFiles.values()) assert.ok(sf.bytes <= 131_072, `sourcefile ${sf.hash} is ${sf.bytes} bytes`);
});
