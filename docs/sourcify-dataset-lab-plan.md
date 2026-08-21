# Sourcify Dataset Lab — plan v2 (answering matthias, 2026-08-07)

> **Ask (matthias, #arkiv-ecosystem thread, 2026-08-07 10:20):** "is there a chance that you could set up a
> postgres db with the content they provide through parquet download? … how many new contracts per day ·
> how many matches of contracts deployed that have been verified earlier · actual data volume vs data
> needed for indexes · etc."
>
> **Short answer: yes — but the cheapest version of it is not the one that was asked for.** Two of the three
> questions need no Postgres (DuckDB over the Parquet answers them in hours). The third is *already
> published* by Sourcify at table granularity, and the missing piece is a ten-row read-only query on **their**
> database — not a 640 GB load on ours. Our own Postgres still earns its place, for a different job.
>
> **v2** — v1 was reviewed by codex (GPT-5) and three load-bearing claims of mine were wrong. Every
> correction below was re-verified by me against primary sources before being accepted. See §7.

---

## 0. What we already know — measured today, not estimated

Pulled 2026-08-07 from the public export bucket (`sourcify-production-parquet-export`, anonymous read).
`v2/stats.json`, generated `2026-08-07T02:43:51Z`, is Sourcify's own size report published next to the data.

| Table | Parquet (GB) | Postgres `pg_total_relation_size` (GB) | Ratio | Files |
|---|---:|---:|---:|---:|
| `sourcify_matches` | 56.16 | 195.26 | 3.5× | 739 |
| `compiled_contracts` | 38.55 | 97.77 | 2.5× | 570 |
| `code` | 37.89 | 211.66 | 5.6× | 401 |
| `sources` | 17.43 | 35.55 | 2.0× | 630 |
| `compiled_contracts_signatures` | 5.89 | 51.63 | 8.8× | 175 |
| `contract_deployments` | 5.13 | 22.30 | 4.4× | 44 |
| `verified_contracts` | 4.04 | 46.08 | 11.4× | 45 |
| `contracts` | 2.08 | 13.14 | 6.3× | 25 |
| `compiled_contracts_sources` | 1.94 | 13.29 | 6.9× | 37 |
| `signatures` | 0.52 | 2.80 | 5.4× | 10 |
| **Ten exported tables** | **169.62 GB** (158.0 GiB) | **689.48 GB** (642.1 GiB) | **4.07×** | 2,676 |
| *whole database* (`pg_database_size`) | — | *939.88 GB (875.3 GiB)* | — | — |

Also established: daily, **append-only**, files partitioned by **row range** and *ordered* (clustered) by
`created_at` — `created_at` is **not** a partition key. S3-compatible endpoint `export.sourcify.dev` over
`https://storage.googleapis.com`. A continuously-updated **BigQuery mirror** exists (Analytics Hub, dataset
`sourcify`, `europe-west1`, tables prefixed `public_`).

### Finding 1 — the size numbers are already `pg_total_relation_size`

Verified in the exporter's source: [`main.py:381`](https://github.com/sourcifyeth/parquet-export/blob/staging/main.py#L381)
runs `pg_total_relation_size(<table>)` per table, [`main.py:386`](https://github.com/sourcifyeth/parquet-export/blob/staging/main.py#L386)
runs `pg_database_size(current_database())` for the total. **So the per-table column above already includes
heap + TOAST + indexes.** Half of matthias's question 3 is answered by a file Sourcify publishes daily. What
is missing is only the **heap / TOAST / index split** — and the honest way to get that is §3-Q3, not a load.

### Finding 2 — there are 233 GiB in that database that nobody exports

`939.88 GB` is the **whole database**; the ten exported tables sum to `689.48 GB`. The gap is
**250.4 GB / 233.2 GiB (26.6% of the database)** — materialized views (`signature_stats`, refreshed nightly
by `pg_cron`), verification job/session tables, catalogs, bloat. **Any migration estimate built on the
export alone is missing a quarter of the real database.** That is a finding for the Aug 24 meeting on its own,
and a question for Kaan.

### Finding 3 — the widely-quoted "5.5× smaller" is a mismatched comparison

Sourcify's own doc says the download is "roughly 5.5× smaller than the live database" — that is
`pg_database_size ÷ parquet_total` = 5.54×, i.e. the *whole DB* against the *export*. Apples-to-apples for
the ten exported tables it is **4.07×**. Small thing, but we quote numbers to a CTO; use 4.07× and explain
the difference. (v1 of this plan made exactly this mistake.)

### What I dropped from v1

I inferred from the uneven ratios (2.0× on `sources`, 11.4× on `verified_contracts`) that the figures had to
include indexes. The inference happened to land on the right answer, but it was not sound: PostgreSQL row
overhead (~23 B header + line pointer + alignment padding) and Parquet's dictionary/RLE+zstd encoding on
low-cardinality columns can produce that spread with **no indexes at all**. The claim now rests on the
exporter's source, not on the ratio. **Ratios suggest; source code decides.**

---

## 1. The three questions, mapped to the cheapest instrument that answers them

| # | Question | Instrument | Why |
|---|---|---|---|
| Q1 | new contracts per day | **DuckDB over Parquet** | `created_at` group-by over 2 columns of a 5 GB table. Postgres adds nothing. |
| Q2 | matches of contracts deployed that were verified earlier | **DuckDB over Parquet** (see §2) | analytical self-join — but the question needs splitting first. |
| Q3 | data volume **vs** index volume | **A 10-row query on *Sourcify's* Postgres** ✅ | it's their number; `pg_table_size` / `pg_indexes_size` / `pg_total_relation_size` per table, read-only, ~30 seconds of Kaan's time, zero GB moved. |

The exact query to send Kaan:

```sql
SELECT relname AS table,
       pg_relation_size(c.oid)                      AS heap_main,
       pg_table_size(c.oid)                         AS table_incl_toast,
       pg_indexes_size(c.oid)                       AS indexes,
       pg_total_relation_size(c.oid)                AS total
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','m')
ORDER BY total DESC;
```

Report the headline as **`pg_indexes_size ÷ pg_table_size`**, not "heap vs indexes":
`pg_relation_size` is the main fork only and excludes TOAST/FSM/VM, which would understate the base and
inflate the index share. (`relkind` includes `'m'` so the materialized views behind Finding 2 show up too.)

**Then why build our own Postgres at all?** Because it answers a *different* question that no read-only
query can: **what does this data cost with a different index set**. That is the direct analogue of "which
attributes do we annotate in Arkiv, and what do the annotations cost" — and annotations are what we pay for.
Our load is an *experiment bench*, not a measuring tape. Reframed that way it stays in the plan (Stage D)
without blocking anything.

### Q2 is under-defined — it has to be split into three

"Matches of contracts deployed that have been verified earlier" can mean three different things with three
different answers, and Sourcify's similarity verification does **not** work by `code_hash` equality — it
finds candidates by the **first 75 bytes of the runtime bytecode** and then tries a real verification:

1. **Exact reuse** — a new verification whose normalized `code_hash` / `source_hash` is already stored.
   *This is the dedup leverage number, and it's the one that matters for Arkiv sizing.*
2. **Similarity opportunity** — same leading 75 runtime bytes as something verified earlier.
3. **Similarity actually succeeded** — needs job/log provenance that is almost certainly **not in the
   snapshot**. If we want it, we ask Sourcify.

And "earlier" must be declared: the export's `created_at` is **Sourcify ingestion time**, not on-chain
deployment time (the export carries `block_number`, not a block timestamp). For our purpose ingestion time
is the right clock anyway — it *is* the write rate an Arkiv-backed Sourcify would have to sustain — but it
gets stated out loud, not assumed.

### The questions I'm adding (they're what the Arkiv PoC actually needs)

matthias wrote "etc." — this is the "etc.":

- **Q4 — payload size distribution.** p50/p90/p99/max of `sources.content`, `code.code`,
  `compiled_contracts.compilation_artifacts` / `compiler_settings`, `sourcify_matches.metadata`
  → answers Kaan's own "what's the heaviest data stored", and tells us what fraction of records exceeds one
  Arkiv entity payload and must be chunked / content-addressed.
- **Q5 — mutation rate.** `sourcify_matches` is ordered by `updated_at`: rows get rewritten. How many
  rows/day are **updates** vs **inserts**? Append-only vs mutable changes the Arkiv design entirely.
- **Q6 — dedup leverage** (= Q2.1): how much of a day's write is a *new blob* vs a *pointer*.
- **Q7 — growth curve → November 2026**, when their Google credits expire. Rows/day and bytes/day over the
  last 90/365 days, extrapolated. This is the number that sizes any proposal.
- **Q8 — chain concentration** (top-N share) → partitioning / sharding strategy.
- **Q9 — write fan-out per verification:** rows, bytes, index entries and **WAL** generated by one
  verification. WAL is the thing people forget and it is the closest analogue to on-chain write cost.
- **Q10 — bursts, not averages:** p95/p99 per minute and per hour, retries, concurrency. A daily average
  sizes nothing; the peak does.
- **Q11 — the read workload:** endpoint mix behind those ~15M req/day, filters, selectivity, page sizes,
  result bytes, cache-hit ratio, p99. **Not in the Parquet — must come from Sourcify.**
- **Q12 — which indexes are actually used:** `pg_stat_user_indexes` + `pg_stat_statements` on their side.
  The migrations tell us what exists; only the stats tell us what *earns its keep* — and that, not the
  migration list, is the Arkiv annotation set.
- **Q13 — hot set by age:** what share of the data is re-read after 1 / 7 / 30 / 365 days.
- **Q14 — the 233 GiB** (Finding 2): what is it, and does it have to migrate too?

---

## 2. Where it runs

**The DGX Spark, not the laptop.** Verified today:

| | Laptop | DGX Spark |
|---|---|---|
| Free disk | 288 GB ❌ | **2.8 TB free** (3.7 TB nvme) ✅ |
| RAM | — | 121 GB |
| Cores | — | 20 |
| Docker | yes | yes ✅ |

`duckdb` / `psql` / `aws` are not installed on the DGX yet (Docker is) — trivial. The DGX also runs the
ERC-7730 generator, ComfyUI and the LoRA work: **hard-cap the lab and keep the Parquet lake on a separate
path from the Postgres volume**, so either can be dropped without touching the other.

---

## 3. Execution — 4 stages

### Stage A — zero-download answers (today, ~1h)
The Parquet is public over plain HTTPS and GCS honours **HTTP range requests** (verified: a real object
returns `206 Partial Content`), so DuckDB `httpfs` reads footer + only the needed column chunks — projection
pushdown is real. Globbing over HTTPS is not supported, so pass the explicit file list (already enumerated:
2,676 objects via the GCS JSON API).
- Row counts per table from Parquet footers (metadata only).
- **First verification of the whole plan:** confirm from the footer schema that `sourcify_matches` really has
  no `chain_id` column (see Stage D) — 1 minute, and it decides the loader's shape.
- Q1 first pass on `contract_deployments` + `verified_contracts`.
- **Instrument the reads** (bytes actually transferred) so we can state the cost honestly instead of guessing.
- **Out:** first real daily-rate number, same day.

### Stage B — the local lake (day 1, mostly wall-clock)
`aws s3 sync s3://sourcify-production-parquet-export/v2/ … --endpoint-url https://storage.googleapis.com
--no-sign-request` → 158 GiB once, then daily.
- ⚠️ **`sync` bytes ≠ new data.** The newest file per table is *rewritten* until it fills, so `sync`
  re-downloads that whole object. The **logical** delta = compare footer row counts / ETags between runs.
  Never report transferred bytes as "new data per day".
- **Out:** local, repeatable lake + a daily job that records the *logical* delta.

### Stage C — the analytics pass (day 1–2, DuckDB)
One committed, re-runnable SQL file per question (Q1, Q2.1–2.2, Q4–Q8), each emitting CSV + chart.
Use `parquet_metadata()` per column (compressed vs uncompressed bytes) to explain *where* the 4.07× comes
from — that also settles the ratio question without loading anything.
- **Out:** `dataset-facts.md` — every number with its method and its caveat.

### Stage D — the experiment bench (day 2–4, Postgres) — index economics, not Q3
Purpose: measure a **clean rebuild** and test **alternative index sets** → the Arkiv annotation analogue.
1. Postgres 17 in Docker on the DGX, bind-mounted straight to nvme (no Docker overlay, no persisted CSV).
2. **Staging tables that mirror the Parquet exactly**, then transform into the real schema. A direct `COPY`
   into the current schema fails in both directions — verified:
   - `sourcify_matches.chain_id` is **`NOT NULL`** since migration `20260527085037`, but the export config
     ([`config.py:139-153`](https://github.com/sourcifyeth/parquet-export/blob/staging/config.py#L139-L163))
     does **not** export it → derive it via `verified_contracts → contract_deployments`.
   - `signatures.signature_hash_4` is **`GENERATED ALWAYS AS … STORED`** and the export **does** ship it →
     must be dropped on insert.
   - `sourcify_matches` can contain **repeated ids**; only the row with the greatest `updated_at` is current
     → dedupe before insert.
3. `bytea`: prefer [`pg_parquet`](https://github.com/CrunchyData/pg_parquet) into staging **if it builds on
   ARM64** (the DGX is aarch64 — check first, it's a real gate); otherwise emit `'\x' || hex(blob)` from
   DuckDB. Note a DuckDB BLOB's default text render (`\xAA\xBB…`) is **not** PostgreSQL hex format, and
   `COPY BINARY` is a PostgreSQL wire protocol, not raw bytes. Session in UTC; JSON text → `jsonb`;
   reset sequences at the end.
4. **Defer PK / UNIQUE / FK / CHECK**, load, dedupe, then build indexes and validate constraints. The
   migrations create them up-front; loading hundreds of millions of rows with FK triggers armed is the
   documented way to make the load swap or die.
5. Tuning for the bulk load: staging `UNLOGGED`, 4–6 parallel loads, `shared_buffers≈16GB`,
   `work_mem=64–128MB`, `maintenance_work_mem≈4GB`, `max_parallel_maintenance_workers=4`,
   `max_wal_size=64–128GB`, `checkpoint_timeout=30min`, `checkpoint_completion_target=0.9`,
   `wal_compression=on`, generous `/dev/shm`.
6. **Pilot one full file per table before promising a timeline.** The reference size is ~642 GiB for the ten
   tables — but Parquet + staging + final + WAL + sort temp coexist, and that is what fills a disk.
- ❌ **Killed from v1: the "5–10% slice" escape hatch.** Index size does not scale linearly (B-tree depth,
  cardinality, TOAST thresholds, bloat) and a time-sliced sample is biased — worse, it would omit exactly the
  index-heavy outliers that make the question interesting. Samples are for **estimating duration**, never for
  the ratio.

---

## 4. Deliverables

1. **`argot/sourcify-lab/`** — sync script, DuckDB SQL per question, staging→schema loader, measurement
   script, report generator. Reproducible by the team, not a one-off notebook.
2. **`dataset-facts.md`** — every number with method + caveat.
3. **A show artifact (`.html`, per this project's presentation rule)** — charts, ready for **Aug 24** and Kaan.
4. **A Slack reply to matthias** — drafted by me, sent by Santiago, leading with §0 (which is already
   deliverable today) instead of making him wait four days for the first number.
5. **The Arkiv sizing model** — writes/day, bytes/day, WAL/verification, dedup ratio, payload distribution vs
   entity limits, annotation set, mutation rate → the input the PoC (~early Sept) was missing.

---

## 5. Things to raise, not silently assume

- **Egress is on Sourcify's bill.** Public bucket, no requester-pays → a 158 GiB pull is ~$17–19 of Google
  egress **against the credits that expire in November**. Small, but pulling it silently is bad partnership.
  Pull **once**, then delta.
- **Send Kaan the §1 query.** It answers Q3 exactly, in 30 seconds, with no data movement. Plus: the 233 GiB
  (Finding 2), and — the big one — **Q11/Q12 telemetry**.
- **BigQuery = QA control, not architecture.** v1 called using it a "bad look"; that was posturing. It costs
  Sourcify nothing, answers Q1/Q2 in minutes, and an independent second computation of the same number is
  *quality control*. It just must never become the instrument of record.
- **Two different clocks** — `created_at` is Sourcify ingestion, not on-chain deployment. Stated in every
  chart, so nobody reads it as chain activity.
- **This is a load model, not a migration.** Nothing here commits Arkiv to anything.

## 6. The biggest risk — say it before matthias finds it

**A snapshot is an inventory, not a workload.** The Parquet gives growth, distribution, payload sizes and
dedup — it does **not** contain the read mix, the bursts, the retries, the job/queue behaviour, or enough
provenance to answer Q2.3. A report built only on it can be a flawless *storage report* and still be useless
for sizing a **continuously running** Arkiv deployment.

→ Mitigation, and it is a hard dependency, not a nice-to-have: **ask Sourcify for 7–14 days of API/DB
telemetry** (endpoint mix, p95/p99, `pg_stat_statements`, `pg_stat_user_indexes`). Everything the Parquet
can answer, we answer ourselves and fast; everything it cannot, we ask for **now** so it arrives before the
PoC — not after we've promised numbers we can't compute.

## 7. Review trail

v1 → v2 after a codex (GPT-5) critique with web-search verification. Corrections **I re-verified myself
against primary sources** before accepting: the `pg_total_relation_size` / `pg_database_size` source lines,
the 642.13 GiB vs 875.33 GiB arithmetic and the 233.2 GiB gap, the `chain_id NOT NULL` migration vs the
export config, the `signature_hash_4` generated column, and the `signature_stats` materialized view.
Also adopted: `pg_indexes_size ÷ pg_table_size` as the correct frame, "clustering key" not "partition key",
`sync`-bytes ≠ logical delta, the three-way split of Q2, staging-then-transform, deferring constraints, and
killing the sampling escape hatch. Rejected nothing.

## 8. Timeline against the real deadlines

| When | What |
|---|---|
| **Today** | §0 findings → reply to matthias · Stage A · the §5 asks to Kaan (query + telemetry + 233 GiB) |
| **Day 1** | Stage B sync running · Stage C on the small tables |
| **Day 2–3** | Stage C complete · Stage D pilot, then load |
| **Day 4** | `dataset-facts.md` + HTML artifact |
| **Aug 24** | Sourcify meeting — go in with measured numbers |
| **~Early Sept** | The PoC Kaan expects, sized on real data |
| **Nov 2026** | Their Google credits expire — the soft deadline behind all of this |
