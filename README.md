# 🟦 [Sourcify](https://sourcify.dev) x [Arkiv](https://arkiv.network) 🟧 integration

> Can Sourcify's contract-verification database be fully moved into Arkiv? (a decentralized queryable database)

Research, design, and two working
proofs of concepts.

**Start here:** [`CLAUDE.md`](./CLAUDE.md) is the maintained entry point (north star, phase
status, hard rules). This file is a map of what lives where and how to run the apps —

# Overview 

Sourcify holds
**43.8M verified contracts** across 377 chains as of 19 Aug 2026.

Sourcify has a Postgres DB, but **uses BigQuery as a public queryable *mirror***

## Working docs

All research/design/planning `.md` files now live in [`docs/`](./docs) — see
[`docs/README.md`](./docs/README.md) for the full index.

## Folders

| Folder | What it is |
|---|---|
| [`sourcify-poc/`](./sourcify-poc) | **The main POC.** Sourcify's read path served from Arkiv, with a real backfilled chain and a live parity diff against sourcify.dev. ETL scripts + a Next.js UI. Run instructions below. |
| [`sourcify-thinking/`](./sourcify-thinking) | A grounded Q&A assistant over this repo's research, for quick internal lookups. Run instructions below. |
| [`sourcify-explainer/`](./sourcify-explainer) | A single self-contained HTML explainer of the data model, served through a gated Next.js route so it stays internal. `npm install && npm run dev` (port 3012); edit `content/index.html` directly. |
| [`sourcify-lab/`](./sourcify-lab) | Python scripts + their outputs (`measure.py`, `column_sizes.py`, `exact_rows.py`) measuring Sourcify's real load model from public Parquet exports — no dataset download, no Sourcify API calls. |
| [`erc7730-poc/`](./erc7730-poc) | "Clear Signing Studio" — a separate, deployed POC for the adjacent ERC-7730 auto-gen idea (DGX-generated candidate descriptors, stored as queryable Arkiv entities). Has its own [`README`](./erc7730-poc/README.md); `npm install && npm run dev`. |

---

## Running `sourcify-poc/`

The main POC: a full backfilled Sourcify chain living in Arkiv entities, served through
an API that matches Sourcify v2's shape, plus a UI (filters, entity browser, live parity
diff). Full details, the entity schema, the byte-budget model and known gotchas are in
[`sourcify-poc/README.md`](./sourcify-poc/README.md) — this is the short version.

```bash
# 1. ETL: fetch a chain from Sourcify, transform to Arkiv entities, write them (or dry-run)
cd sourcify-poc/etl
npm install
CHAIN=130 DELAY_MS=100 node 1-fetch.mjs      # pulls from sourcify.dev, resumable
node 2-transform.mjs                          # local only, no network — prints the byte budget report
node 3-write.mjs                              # DRY RUN by default: encodes, zero RPC calls
node 3-write.mjs --send                       # broadcasts to Cheesecake

# 2. Serve the app
cd ../
npm install
npm run dev       # http://localhost:3011/?pw=123
```

Needs a `.env.local` (gitignored) with `ARKIV_RPC`, `ARKIV_PRIVATE_KEY` (for the ETL's
`--send`), `ARKIV_API_KEY`, `ARKIV_PUBLISHER`, `GATE_TOKEN`, `GATE_PASSWORD` — see
[`sourcify-poc/README.md`](./sourcify-poc/README.md#environment) for what each one does and
where to get GLM/API keys on Cheesecake. The gate is a server-side proxy check (`proxy.ts`);
`?pw=<GATE_PASSWORD>` on any page sets the unlock cookie.

## Running `sourcify-thinking/`

A DevRel Q&A assistant: ask it something about this repo's research and it answers grounded
in a knowledge base built from the working docs above (`kb/facts.json`, `kb/context-pack.json`),
not from general model knowledge.

```bash
cd sourcify-thinking
npm install
npm run dev        # http://localhost:3007
```

Needs `ANTHROPIC_API_KEY` (the assistant's model calls) and `GATE_TOKEN` (production; a
dev-only fallback token is used automatically when `GATE_TOKEN` is unset and
`NODE_ENV !== "production"`). The gate here is a cookie set by `POST /api/gate` after
visiting `/gate` and entering the access code, checked on every request by `proxy.ts`.

If the knowledge base needs rebuilding after the source docs change:

```bash
npm run kb          # node scripts/build-kb.mjs && node scripts/build-context.mjs, then commit kb/
```

---

## What NOT to touch without asking Santiago

Two gate-related issues were found in a prior review and are intentionally still open —
they are Santiago's to fix, not incidental cleanup for an unrelated change:

- The `_next/` exclusion in `sourcify-thinking/proxy.ts` and `erc7730-poc/proxy.ts`'s
  matcher (compare against `sourcify-poc/proxy.ts`, which deliberately does NOT exclude
  `_next/` — see the comment above its `matcher`).
- The hardcoded fallback gate password (`"123"` in `sourcify-poc/proxy.ts` and
  `sourcify-thinking/app/api/gate/route.ts`).
