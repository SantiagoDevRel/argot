# Questions for Kaan — 2026-08-18

Paste-ready. Written to be sent today, ahead of the joint Arkiv × Sourcify meeting on Monday.

**Design principle:** every question we could answer ourselves from public data, we already answered
(see `sourcify-arkiv-briefing.html` and `sourcify-lab/measure.py`). What is left is only what the public
dataset structurally cannot tell us. Saying that out loud is what makes these read as engineering rather
than discovery.

---

## The message

> Hi Kaan — before Monday I went through the public dataset properly so we would not waste your time on
> things we can measure ourselves.
>
> From `stats.sourcify.dev/data.json` and the Parquet export stats I have: 43.78M verified contracts as of
> today (29.1% exact / 70.9% partial) across 377 chains, ~34k new verifications/day organically over the
> last 30 days, 949.6 GB live database of which the ten exported tables are 692.9 GB, 170.4 GB of Parquet,
> and a ~7.7x compilation reuse factor. So none of that is a question.
>
> What I cannot get from public data is below. Most of it is a single read-only query or a dashboard export
> on your side.
>
> **1. Read workload.** This is the one that actually decides everything. What does the request mix look
> like — requests/day per endpoint, cache-hit rate, peak requests/second, p99 latency? A snapshot of the
> dataset is an inventory; it says nothing about how it is served.
>
> **2. Index vs content split.** How much of the 949 GB is indexes rather than rows? I know the
> `pg_total_relation_size` totals per table from your export stats, but not the split. It is one read-only
> query returning ten rows (`pg_table_size` / `pg_indexes_size` / `pg_total_relation_size`). I did not want
> to measure this on a copy — a fresh copy has our index choices and none of your bloat, so the number
> would be wrong and too low.
>
> **3. The 27% that never gets exported.** The ten exported tables are 692.9 GB against a
> `pg_database_size` of 949.6 GB, so ~257 GB never leaves. I know the signature stats materialized view
> and the verification jobs tables are in there, but that does not account for the whole gap. What else is
> in it — and how much of it is bloat rather than data?
>
> **4. Egress composition.** Marco's conclusion in #2866 was that moving the database only pays if egress
> drops by roughly 95%, which he described as redesigning how contracts are served. To even reason about
> that: of the 13.6 TB/month, what is the split by endpoint and by field — sources vs bytecode vs metadata?
>
> **5. What is actually mutable.** The analysis says 75–80% of the database is immutable content-addressed
> blobs and JSON, but `sourcify_matches.metadata` is updated in place and re-verifications overwrite. Rows
> updated per day vs inserted per day? And separately — do you have a real deletion requirement, given
> #2605 on removing sources from Filebase pinning?
>
> **6. The 15M requests/day figure.** Reading the 2025 recap I take it as all Sourcify APIs combined, with
> 4byte alone above 7M of it. Your summary doc reads as if `sourcify.dev/server` serves the 15M on its own.
> Which is it? It changes the target by roughly a factor of two and I would rather not quote it wrong on
> Monday.
>
> **7. The export row counter.** File ranges in the v2 export imply ~74.2M rows in `sourcify_matches`, but
> #2924 measures 42.7M live. Same pattern on `compiled_contracts` (5.72M implied vs 5.16M measured). I
> assume superseded rows stay in the append-only files — can you confirm? It matters because it means the
> export cannot be replayed as a backfill without de-duplicating by primary key first.
>
> **8. ERC-7730 direction.** When we spoke in July you said the intention was to move the registry on-chain
> and make it permissionless, with trust coming from attestations. Reading the Clear Signing launch post,
> the shipped design is EAS attestations over a mirrorable off-chain registry — descriptors stay in the
> GitHub repo. Has the direction changed, or are those two stages of the same plan?

---

## Notes for Santiago, not for Kaan

- **Q1, Q4 and Q5 are the ones that matter.** Q1 decides whether any serving proposition is possible at
  all; Q4 is the bar Marco himself set (~95% egress reduction); Q5 decides whether an append-oriented
  model fits their data at all.
- **Q6 is a correction dressed as a question.** His own summary is loose here. Do not frame it as a
  correction — the doc's warning that 15M must never be read as contract lookups is right, and it is worth
  being right quietly.
- **Q8 changed under us.** The July conversation on file says "move it on-chain". The shipped May 2026
  design is attestations over an off-chain mirrorable registry. Do not walk into Monday assuming an
  on-chain descriptor registry is a committed roadmap item.
- **Do not ask about cost.** They ran that evaluation in July (#2866) and concluded don't migrate. Kaan
  closed it himself with "it seems still too expensive to me… can be opened later". That sentence is the
  opening; asking him to re-litigate the decision is not.
- **The thing to keep in reserve for Monday:** #2924 — 139 GB of duplicated metadata they cannot normalise
  because the Verifier Alliance schema has no slot for it. It is a content-addressing problem written in
  their own issue tracker eight days ago. Raise it as a question, never as a pitch.
