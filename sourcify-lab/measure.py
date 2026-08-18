#!/usr/bin/env python3
"""
sourcify-lab / measure.py  —  everything we can state about Sourcify's load
model WITHOUT asking Sourcify for anything and WITHOUT downloading the dataset.

Three public, unauthenticated sources:
  1. https://stats.sourcify.dev/data.json            per-chain DAILY cumulative
                                                     verification counts (~4.6 MB)
  2. https://storage.googleapis.com/sourcify-production-parquet-export/v2/stats.json
                                                     per-table bytes, live DB +
                                                     Parquet, regenerated daily
  3. the GCS bucket object listing                   Parquet file manifest

Run:  python measure.py            (writes sourcify-verifications-daily.csv)

Caveats that must travel with these numbers:
  * The daily series is CUMULATIVE per chain and chains start on different dates,
    so the global curve is built by forward-filling each chain's last known value.
  * Timestamps are Sourcify INGESTION time, not on-chain deployment time.
    This is "verified per day", not "deployed per day".
  * Parquet file names encode an EXPORT ROW COUNTER, not live row counts. The v2
    export is append-only and never rewrites full files, so the counter drifts
    ABOVE the live table (see README). Do not quote it as a row count.
  * `database.totalBytes` is pg_database_size(); per-table values are
    pg_total_relation_size() and already include indexes and TOAST.
"""
import json, csv, urllib.request
from collections import defaultdict

STATS = "https://stats.sourcify.dev/data.json"
EXPORT = "https://storage.googleapis.com/sourcify-production-parquet-export/v2/stats.json"
GB = 1e9
GiB = 1024 ** 3


def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.load(r)


def global_curve(chains):
    """Forward-filled global cumulative series across all chains."""
    per = {c: dict(zip(v["dates"], zip(v["total"], v["full"], v["partial"])))
           for c, v in chains.items()}
    dates = sorted({d for v in chains.values() for d in v["dates"]})
    last = defaultdict(lambda: (0, 0, 0))
    out = []
    for d in dates:
        t = f = p = 0
        for c in chains:
            if d in per[c]:
                last[c] = per[c][d]
            a, b, e = last[c]
            t += a; f += b; p += e
        out.append((d, t, f, p))
    return out


def main():
    stats = get(STATS)
    exp = get(EXPORT)
    series = global_curve(stats["chains"])
    d, total, full, partial = series[-1]

    print(f"stats.sourcify.dev lastUpdated : {stats['lastUpdated']}")
    print(f"export stats generatedAt       : {exp['generatedAt']}")
    print(f"\nVERIFIED CONTRACTS ({d})       : {total:,}")
    print(f"  exact match                  : {full:,} ({full/total*100:.1f}%)")
    print(f"  partial match                : {partial:,} ({partial/total*100:.1f}%)")
    print(f"  chains with >=1 contract     : {sum(1 for v in stats['chains'].values() if v['total'] and v['total'][-1] > 0)}")

    print("\nWRITE LOAD (new verifications per day, trailing average)")
    for n in (7, 30, 90, 365):
        if len(series) > n:
            r = (series[-1][1] - series[-1 - n][1]) / n
            print(f"  last {n:>3}d : {r:>10,.0f} /day   ({series[-1-n][0]} -> {d})")

    jumps = sorted(((series[i][1] - series[i-1][1], series[i][0])
                    for i in range(1, len(series))), reverse=True)[:5]
    print("\nBULK BACKFILLS (single-day jumps — these inflate any trailing average)")
    for j, dt in jumps:
        print(f"  {dt}  +{j:,}")

    db, pq = exp["database"], exp["parquet"]
    ten = sum(t["bytes"] for t in db["tables"].values())
    print(f"\nSTORAGE ({exp['generatedAt'][:10]})")
    print(f"  pg_database_size()           : {db['totalBytes']/GB:>8.1f} GB")
    print(f"  10 exported tables           : {ten/GB:>8.1f} GB  ({ten/db['totalBytes']*100:.1f}%)")
    print(f"  not exported (gap)           : {(db['totalBytes']-ten)/GB:>8.1f} GB  ({(db['totalBytes']-ten)/db['totalBytes']*100:.1f}%)")
    print(f"  Parquet (zstd)               : {pq['totalBytes']/GB:>8.1f} GB in {pq['fileCount']:,} files")
    print(f"  ratio exported/Parquet       : {ten/pq['totalBytes']:.2f}x   whole-DB/Parquet: {db['totalBytes']/pq['totalBytes']:.2f}x")

    sig = db["tables"]["signatures"]["bytes"] + db["tables"]["compiled_contracts_signatures"]["bytes"]
    print(f"\n4BYTE SLICE (the pilot candidate)")
    print(f"  signatures + compiled_contracts_signatures : {sig/GB:.1f} GB = {sig/db['totalBytes']*100:.2f}% of the database")
    print(f"  serves >7M of >15M requests/day            = ~47% of traffic on ~6% of the data")

    with open("sourcify-verifications-daily.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "cum_total", "cum_full", "cum_partial", "new_per_day"])
        for i, (dt, t, f, p) in enumerate(series):
            w.writerow([dt, t, f, p, t - series[i-1][1] if i else 0])
    print(f"\nwrote sourcify-verifications-daily.csv ({len(series)} rows)")


if __name__ == "__main__":
    main()
