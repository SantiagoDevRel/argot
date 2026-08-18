#!/usr/bin/env node
/**
 * build-kb.mjs -- generate kb/facts.json from the MEASURED outputs in
 * ../sourcify-lab, plus a curated set of facts that came from reading primary
 * sources (blog posts, GitHub issues, our own Cheesecake test run).
 *
 * The point: the assistant's numbers are generated from the same artefacts the
 * briefing was built from, so the two can never drift apart. Nothing numeric is
 * typed by hand twice.
 *
 * Every fact carries:
 *   id          stable, referenced by the model as {{F:id}} -- never a literal
 *   statement   one sentence a human can read on its own
 *   value/unit  the quantity, rendered by the SERVER not the model
 *   scope       what population/environment it describes (guards against
 *               "right number, wrong metric")
 *   asOf        snapshot date -- these move daily
 *   source      label + url
 *   confidence  measured | stated | unknown
 *   tags        for the client-side search
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(here, "..", "..", "sourcify-lab");
const OUT = path.resolve(here, "..", "kb", "facts.json");

const AS_OF = "2026-08-18";
const facts = [];
const add = (f) => {
  if (facts.some((x) => x.id === f.id)) throw new Error(`duplicate fact id: ${f.id}`);
  facts.push({ asOf: AS_OF, confidence: "measured", ...f });
};

const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(LAB, p), "utf8"));
const GB = 1e9;
const num = (n, d = 0) => Number(n.toFixed(d));

// ---------------------------------------------------------------- lab outputs
const rowsDoc = readJSON("exact-row-counts.json");
const rows = rowsDoc.rows;
const cols = readJSON("column-sizes.json");

const PARQUET_SRC = {
  label: "Parquet footers, 2,687 files (sourcify-lab/exact_rows.py)",
  url: "https://storage.googleapis.com/sourcify-production-parquet-export/v2/stats.json",
};

for (const [table, n] of Object.entries(rows)) {
  add({
    id: `rows.${table}`,
    statement: `The Sourcify Parquet export contains ${n.toLocaleString("en-US")} rows in the ${table} table.`,
    value: n,
    unit: "rows",
    scope: `EXPORT rows in ${table}, not live database rows -- the v2 export is append-only and retains superseded versions`,
    source: PARQUET_SRC,
    tags: ["rows", "count", table, "parquet", "export"],
  });
}

const totalRows = Object.values(rows).reduce((a, b) => a + b, 0);
add({
  id: "rows.total",
  statement: `Across all ten exported tables the Parquet export contains ${totalRows.toLocaleString("en-US")} rows.`,
  value: totalRows,
  unit: "rows",
  scope: "sum of the ten exported tables, export population",
  source: PARQUET_SRC,
  tags: ["rows", "total", "export"],
});

// per-column sizes
let rawTotal = 0;
for (const [table, d] of Object.entries(cols)) rawTotal += d.uncompressed_bytes;
add({
  id: "size.raw_uncompressed",
  statement: `Summing every column chunk, Sourcify's exported data is ${num(rawTotal / GB, 0)} GB of raw uncompressed content.`,
  value: num(rawTotal / GB, 1),
  unit: "GB",
  scope: "raw uncompressed column bytes across the ten exported tables",
  source: { label: "Parquet footers, column metadata (sourcify-lab/column_sizes.py)", url: PARQUET_SRC.url },
  tags: ["size", "raw", "uncompressed", "total"],
});

const HEAVY = [
  ["sourcify_matches", "metadata"],
  ["code", "code"],
  ["sources", "content"],
  ["compiled_contracts", "runtime_code_artifacts"],
  ["compiled_contracts", "compilation_artifacts"],
  ["compiled_contracts", "creation_code_artifacts"],
];
for (const [t, c] of HEAVY) {
  const v = cols[t]?.columns?.[c];
  if (!v) continue;
  add({
    id: `col.${t}.${c}`,
    statement: `${t}.${c} averages ${Math.round(v.avg_bytes_per_value).toLocaleString("en-US")} bytes per value and totals ${num(v.uncompressed_bytes / GB, 1)} GB raw; its heaviest row group averages ${Math.round(v.heaviest_rowgroup_avg_bytes).toLocaleString("en-US")} bytes per value.`,
    value: num(v.avg_bytes_per_value, 0),
    unit: "bytes per value (average)",
    scope: `column ${c} of ${t}; the heaviest-block figure is the worst row-group average, a LOWER bound on the true single-object maximum -- Parquet statistics store min/max values, not lengths`,
    source: { label: "Parquet column metadata (sourcify-lab/column_sizes.py)", url: PARQUET_SRC.url },
    tags: ["column", "size", "bytes", t, c, "blob"],
    extra: {
      total_gb: num(v.uncompressed_bytes / GB, 1),
      heaviest_block_bytes: num(v.heaviest_rowgroup_avg_bytes, 0),
    },
  });
}

// index-shaped vs blob-shaped
const INDEX_TABLES = [
  "verified_contracts", "contract_deployments", "contracts",
  "signatures", "compiled_contracts_signatures", "compiled_contracts_sources",
];
let indexBytes = 0;
for (const t of INDEX_TABLES) indexBytes += cols[t]?.uncompressed_bytes ?? 0;
const blobBytes = rawTotal - indexBytes;
add({
  id: "split.index_shaped",
  statement: `Only ${num(indexBytes / GB, 1)} GB (${num((indexBytes / rawTotal) * 100, 1)}% of raw bytes) of Sourcify's data is index-shaped: small rows of 58 to 620 bytes across six tables.`,
  value: num((indexBytes / rawTotal) * 100, 1),
  unit: "% of raw bytes",
  scope: "sum of verified_contracts, contract_deployments, contracts, signatures, compiled_contracts_signatures, compiled_contracts_sources",
  source: { label: "derived from Parquet column metadata", url: PARQUET_SRC.url },
  tags: ["split", "index", "arkiv", "architecture", "mapping"],
  extra: { gb: num(indexBytes / GB, 2) },
});
add({
  id: "split.blob_shaped",
  statement: `${num(blobBytes / GB, 1)} GB (${num((blobBytes / rawTotal) * 100, 1)}% of raw bytes) is blob-shaped: a handful of very large text and JSON columns.`,
  value: num((blobBytes / rawTotal) * 100, 1),
  unit: "% of raw bytes",
  scope: "raw uncompressed bytes not in the six index-shaped tables",
  source: { label: "derived from Parquet column metadata", url: PARQUET_SRC.url },
  tags: ["split", "blob", "ipfs", "architecture", "mapping", "off-chain"],
  extra: { gb: num(blobBytes / GB, 1) },
});

// bytes per row for the index tables
for (const t of INDEX_TABLES) {
  const b = cols[t]?.uncompressed_bytes;
  if (!b || !rows[t]) continue;
  add({
    id: `bpr.${t}`,
    statement: `${t} averages ${Math.round(b / rows[t])} bytes per row (${num(b / GB, 2)} GB across ${rows[t].toLocaleString("en-US")} rows).`,
    value: Math.round(b / rows[t]),
    unit: "bytes per row",
    scope: `raw uncompressed bytes / export rows for ${t}`,
    source: { label: "Parquet column metadata", url: PARQUET_SRC.url },
    tags: ["bytes", "row", t, "index"],
  });
}

// ---------------------------------------------------------------- curated
const CURATED = JSON.parse(fs.readFileSync(path.join(here, "curated-facts.json"), "utf8"));
for (const f of CURATED) add(f);

// ---------------------------------------------------------------- write
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const byConfidence = facts.reduce((a, f) => ((a[f.confidence] = (a[f.confidence] || 0) + 1), a), {});
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: AS_OF, count: facts.length, facts }, null, 2));
console.log(`kb/facts.json: ${facts.length} facts`, byConfidence);
