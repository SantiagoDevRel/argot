# argot — Sourcify × Arkiv

Can Sourcify's contract-verification database (~11M contracts, ~15M req/day, currently
BigQuery) move onto Arkiv — a database that is decentralized *and* queryable? This repo
is the research, the design, and two working proofs of concept for that question.

**Start here:** [`CLAUDE.md`](./CLAUDE.md) is the maintained entry point (north star, phase
status, hard rules). This file is a map of what lives where and how to run the apps —
it does not replace CLAUDE.md, it points at it.

## Working docs (root)

| File | What it is |
|---|---|
| [`sourcify-arkiv-dossier.md`](./sourcify-arkiv-dossier.md) | Master doc — north star, wedge, load-model verdict, ownership, tiered index, phase plan |
| [`arkiv-load-model-research.md`](./arkiv-load-model-research.md) | Arkiv's read/write/storage/ownership limits, sourced |
| [`sourcify-data-model-research.md`](./sourcify-data-model-research.md) | Sourcify's Postgres schema, v2 API, distribution, tooling |
| [`arkiv-mapping-design.md`](./arkiv-mapping-design.md) (+ `.html`) | Sourcify → Arkiv entity schema, hot/cold index, query patterns, migration plan |
| [`marcos-product-questions.md`](./marcos-product-questions.md) (+ `.html`) | One-pager of open product questions for Arkiv's Head of Product |
| [`erc7730-viability-assessment.md`](./erc7730-viability-assessment.md) | Viability of an ERC-7730 clear-signing auto-gen add-on |
| [`erc7730-poc-spec.md`](./erc7730-poc-spec.md) | Spec for the `erc7730-poc/` app below |
| [`erc7730-poc-design-prompt.md`](./erc7730-poc-design-prompt.md) | The visual-design brief `erc7730-poc/` was built from |
| [`sourcify-cto-conversation.md`](./sourcify-cto-conversation.md) | Primary-source notes from Sourcify's CTO on the ERC-7730 ownership model |
| [`sourcify-dataset-lab-plan.md`](./sourcify-dataset-lab-plan.md) | Plan behind the measurements in `sourcify-lab/` |
| [`questions-for-kaan-2026-08-18.md`](./questions-for-kaan-2026-08-18.md) | Prepared questions for the mid-August Sourcify CTO meeting |
| [`index.html`](./index.html) | Landing hub linking the HTML show artifacts + working docs |
| [`sourcify-arkiv-briefing.html`](./sourcify-arkiv-briefing.html) | Standalone briefing deck (show artifact) |

Per [`CLAUDE.md`](./CLAUDE.md)'s presentation rule: `.md` files are internal working
docs; anything meant to be shown to Marcos/Sourcify/stakeholders has a self-contained
`.html` sibling.

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
