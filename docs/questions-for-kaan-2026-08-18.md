# Message to Kaan — 2026-08-18

Paste-ready, to send today ahead of the joint Arkiv x Sourcify meeting on Monday.

**Design principle:** anything derivable from public data, we derived. What is left is either a
number only Sourcify holds, or a figure of theirs that we want confirmed. Asking him to *verify*
costs a minute per item; asking him to *analyse* costs an afternoon he does not have.

Rendered version with the full supporting data: `sourcify-arkiv-briefing.html`.
Everything below is reproducible via `sourcify-lab/measure.py` and `sourcify-lab/exact_rows.py`.

---

## The message

> Hi Kaan — ahead of Monday I went through the public dataset properly so we would not spend your time
> on anything we can measure ourselves. Most of this is me asking you to sanity-check numbers I derived
> rather than to produce new ones.
>
> **1. Are these right?** From `stats.sourcify.dev/data.json`, the Parquet export stats and the Parquet
> file footers, as of 18 Aug: **43,781,389** verified contracts (29.1% exact / 70.9% partial),
> **267** supported chains of 420 configured, **949.6 GB** live database, **170.4 GB** of Parquet across
> 2,687 files, and roughly **34k** new verifications/day over the last 30 days excluding bulk imports.
> _source: your public stats + export stats.json — effort: eyeball it_
>
> **2. Your 4byte counter looks stale.** `api.4byte.sourcify.dev/signature-database/v1/stats` returns
> 9,340,765 signatures with `refreshed_at: 2026-07-06`. Counting the Parquet footers today I get
> **9,920,797**. Is that view just on a slow refresh?
> _source: your /stats endpoint vs signatures/*.parquet — effort: one minute_
>
> **3. The export keeps superseded rows — can you confirm?** The v2 export is append-only, so I read
> **74,196,213** rows in `sourcify_matches` against the **42,733,948** you measured live in issue #2924.
> I read that as ~31.5M superseded versions retained in older files, mostly from `metadata` updates.
> `compiled_contracts` shows the same pattern at 9.7%. If that is right, anyone building off the export
> has to deduplicate by primary key first — probably worth a line in the docs.
> _source: parquet footers vs your issue #2924 — effort: confirm or correct_
>
> **4. Which "15M requests/day" is the real one?** The 2025 recap says over 15M/day across *all* Sourcify
> APIs, with 4byte alone above 7M. The May 2026 v1-brownout post says v2 is "already serving 15M+
> requests/day", which reads as the contract API on its own. Those imply very different targets and I
> would rather not quote it wrong on Monday.
> _source: your two blog posts — effort: one line_
>
> **5. Growth cause.** 11M at end-2025, 38.5M by July, 43.78M now. How much of that is organic
> verification versus your similarity-import backfills? I can see a **+2,774,661 single day on 17 July**
> in the stats data, so I assume the backfills are a large share.
> _source: your stats data.json — effort: one line_
>
> **6. What is in the other 27%?** The ten exported tables are 692.9 GB against a `pg_database_size` of
> 949.6 GB, so ~257 GB is outside them. I know that includes other relations and catalogs, but I do not
> want to guess how much is real data versus bloat.
> _unit: GB per non-exported relation + dead-tuple estimate — effort: one query_
>
> **7. Index versus content.** How much of the 949.6 GB is indexes rather than rows? `pg_total_relation_size`
> gives me the totals but not the split, and measuring it on our own copy would reflect our index choices
> and none of your history.
> _unit: pg_table_size / pg_indexes_size per table — ten rows — effort: one query_
>
> **8. The read workload — the one thing the dataset cannot show.** A snapshot is an inventory, not a
> workload. Whatever you already have would be plenty: requests/day by route, peak RPS, p95/p99,
> cache-hit ratio, response bytes. An existing dashboard screenshot beats a custom analysis.
> _unit: route-level counts + peaks — effort: export what exists_
>
> **9. What is actually mutable.** Your own analysis says 75–80% of the database is immutable
> content-addressed blobs, but `sourcify_matches.metadata` is updated in place. Roughly what is the split
> of inserts versus updates versus deletes per day? And do you have a real deletion requirement, given
> the open issue on removing sources from Filebase pinning?
> _unit: rows inserted / updated / deleted per day — effort: rough answer is fine_
>
> Two framing questions so we do not waste Monday: what would a useful September test look like from your
> side — and would you be open to a shadow run with no production cutover, where we mirror a slice and
> compare our answers against yours?

---

## Notes for Santiago, not for Kaan

- **Q1, Q8 and Q9 are the ones that matter.** Q8 decides whether any serving proposition is possible at
  all; Q9 decides whether an append-oriented model fits their data; Q1 is the cheap credibility opener.
- **Q2 and Q3 are gifts.** Both are things wrong or undocumented on *their* side that we found by doing
  the work. They cost him nothing and they establish that we read the dataset properly.
- **Q4 is a correction dressed as a question.** Their own two posts disagree. Ask, do not correct.
- **Do not ask about cost.** They ran that evaluation in July (#2866) and concluded don't migrate — but
  note that review compared *hosted Postgres providers*, not Arkiv. Kaan closed it himself with "it seems
  still too expensive to me... can be opened later". That sentence is the opening; re-litigating the
  decision is not.
- **ERC-7730 is deliberately not in this message.** The shipped Clear Signing design is attestations over
  a mirrorable off-chain registry, which differs from the on-chain permissionless registry he described
  in July. Worth resolving, but it is adjacent to the database conversation and asking now costs focus.
  Send it as a separate follow-up after Monday.
- **Keep in reserve for Monday:** issue #2924 — compiler metadata duplicated ~8.5 times, roughly 139 GB,
  unfixable because the shared Verifier Alliance schema has no slot for it. Raise it as a question about
  their cost, never as a pitch.
