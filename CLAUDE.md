# ARGOT v1 — Sourcify × Arkiv · entry point

> **Read this first, then open [`sourcify-arkiv-dossier.md`](./sourcify-arkiv-dossier.md) (master doc).**
> Precedence: the parent repo CLAUDE.md (`../CLAUDE.md` → Arkiv brand rules) and the global one win. This is ARGOT-specific context.

## 🌐 Language rule (this project)
**Every file / document / `.md` in this folder MUST be written in English.** Chat/conversation can be in Spanish, but anything persisted to disk (docs, notes, code, comments, one-pagers, tutorials) is English-only. No exceptions.

## 🎨 Presentation rule (this project)
**Anything meant to be SHOWN/presented** (to Marcos, Sourcify, stakeholders, tutorials, demos, decks) = a **self-contained interactive HTML artifact** with visuals/charts/diagrams — NOT a raw `.md`. Santiago will not open a markdown file to present it.
- **Markdown = internal working docs only** (dossier, research, notes). **HTML = the show layer.**
- Each show doc gets a `*.html` sibling of the working `.md`.
- Prefer a **single self-contained file** (inline CSS/SVG, no build, works offline in a live meeting — avoid hard CDN dependencies for anything load-bearing).
- On-brand: blue leads / orange spark, mono headings (IBM Plex Mono), clean/modern. Still English (language rule).

## What this is
Arkiv's **first integration target** (Santiago = Sr. DevRel) **and** the first usecase for his **DGX Spark**. Two intertwined goals:
1. **North star:** get **Sourcify** (Ethereum Foundation project, open-source contract verification; **~11M contracts**, ~15M req/day; repo now `argotorg/sourcify`) to **leave BigQuery and migrate its DB to Arkiv** = a database that is decentralized **and** queryable (BigQuery gives query but is centralized/Google; IPFS gives decentralization but is not queryable; Arkiv = both).
2. **Knowledge system** on the DGX (DevRel second brain) to consult/iterate/share with freshness.

## Status (Phase 0 — research, in progress)
- ✅ Wedge and north star defined + verified against primary sources.
- ✅ Arkiv load-model research done (sourced) → **verdict: full migration NOT viable today** (3 blockers: permanence, ownership, read-scale). Gas is NOT the problem. Tiered-index pattern (§4) validated as the viable path.
- ✅ **ERC-7730 auto-gen add-on viability (2026-07-08, audited)** → [`erc7730-viability-assessment.md`](./erc7730-viability-assessment.md). **GO WITH CONDITIONS but harder — concept is OCCUPIED at POC level** (LLM+Sourcify+queryable-store already shipped/prize-winning on The Graph). Arkiv's wedge narrows to production-scale + queryability-vs-The-Graph + open/local DGX generation. **Pawel (CEO) wants a POC** → POC = produce the 5 de-risking answers in the doc. Partly supersedes §6 of the dossier.
- ✅ **POC "Clear Signing Studio" DEPLOYED LIVE (2026-07-08)** → **https://arkiv-sourcify.vercel.app** (santiago-prod, gate pwd `123` server-side). Real Arkiv writes (8 descriptor entities on Braga, one `mutateEntities` tx, SDK direct) read live by the Database tab. Eval harness built over the **367 ground-truth descriptors** (bimodal, no-leakage) + NatSpec sample. DGX live path written (`dgx-wrapper/`) but **not run — GPU was busy**. Details → [`erc7730-poc/README.md`](./erc7730-poc/README.md), spec build-status in [`erc7730-poc-spec.md`](./erc7730-poc-spec.md).
- ⏭️ **Deferred (needs free GPU):** run the eval batch (real accuracy + baseline deltas), warm qwen3-coder-next + wrapper e2e, flip Vercel to live (`DGX_URL`+`DGX_BEARER`), codex audit of DGX security + eval.
- ⏭️ **Next step (parallel): one-pager of 7 product questions for Marcos** (ecosystem meeting ~2 weeks) → [`marcos-product-questions.md`](./marcos-product-questions.md).

## Folder files
| File | What it is |
|---|---|
| `sourcify-arkiv-dossier.md` | 🎯 **master doc** — north star, ERC-7730 wedge, §2 load table + verdict, §3 ownership, §4 tiered index, §5 questions for Marcos, §6 DGX potentials, §7 phase plan |
| `arkiv-load-model-research.md` | Arkiv technical research WITH SOURCES (READ/WRITE/STORAGE/OWNERSHIP + legacy caveats) |
| `sourcify-data-model-research.md` | Sourcify data model WITH SOURCES (Postgres schema, v2 API, distribution, tooling, flattened record) |
| `arkiv-mapping-design.md` (+`.html`) | 🧩 **Step 2 design** — Sourcify→Arkiv entity schema, hot/cold index, query patterns, API adapter, migration plan, telemetry, real worked example. HTML = show artifact for the CTO |
| `marcos-product-questions.md` (+`.html`) | one-pager for the ecosystem meeting (7 product questions) — HTML is the show artifact |
| `erc7730-viability-assessment.md` | 🆕 **2026-07-08 (v2, audited)** — viability of the ERC-7730 auto-gen add-on vs 5 criteria. **Landscape moved: concept OCCUPIED at POC level** (`hardhat-descriptor` npm/Claude; **ClearSignKit** = Sourcify+NatSpec+LLM+queryable store on **The Graph GRC-20**, won Ledger 1st prize; Ledger own Generator announced/404). Verdict = **GO WITH CONDITIONS but harder**; Arkiv's wedge = production-scale + queryability-vs-The-Graph + open/local DGX gen. Requested by **Pawel (CEO)** who wants a POC. **This partly supersedes dossier §6.** |
| `sourcify-cto-conversation.md` | 🆕 **primary source** — Sourcify CTO (Kaan) reply on the ERC-7730 ownership/storage model. Descriptors come from dApps; **intention = move the registry ONCHAIN + permissionless + trust via attestations** (= an Arkiv-shaped problem); DSL = write-time/new contracts. Reshapes the plan; meeting-ready context. |
| `erc7730-poc-spec.md` | 🆕 **POC spec v1** — the two acts (Arkiv as the queryable registry + DGX candidate-seed for the long tail), Santiago's verify→generate flow refined, the ground-truth backtest over ~372 descriptors, entities/queries, tech stack (`arkiv-sync`/`arkiv-graph`/DGX), honest gates → Marcos questions. |
| `index.html` | landing hub — links both show artifacts + lists the working docs (open this to present) |

## Phase plan
- **Phase 0 — Research (now):** understand what Arkiv can/can't do vs Sourcify's load + validate the wedge. Output = markdown. No infra.
- **Phase 1 — Knowledge system:** MCP server over this folder (simple: keyword + live fetch). Upgrade to a RAG (embeddings/reranker on DGX) ONLY if the corpus grows. **Build/serve split:** DGX builds/re-indexes nightly → pushes to a cloud vector store (Supabase pgvector); a cloud MCP server serves = shareable "linktorag.com" (Shantelle uses HER OWN Claude, only consumes retrieval). DGX does not serve third-party traffic under an SLA.
- **Phase 2 — Sidecar prototype + tutorials** for the August meeting.

## Deadlines & people
- **Marcos** — Head of Product (Arkiv): bring the 7 questions at the **ecosystem meeting ~2 weeks**.
- **Lea + Kaan** — run Sourcify. **Sourcify CTO** — technical follow-up **mid-August 2026** (arrive with answers, not questions).
- **Shantelle Awomoyi** — co-owner of the metadata research action item.

## References
- **Kickoff meeting notes (Gemini):** Google Doc `12sLQppUCipKRZ-mW1DLQne1LlVmEjyKVnx1ngEuztYM` (work account `santiago.zuluaga@golem.network`, google-workspace MCP).
- **Arkiv:** docs.arkiv.network · GitHub `Arkiv-Network/arkiv-sdk-js` · npm `@arkiv-network/sdk` · local indexer `../projects/indexer` (measured gas) · context in `../handoff.md` + memory `reference_arkiv_ecosystem_sdk_state`.
- **ERC-7730 / Clear Signing:** eips.ethereum.org/EIPS/eip-7730 · ethereum.org/developers/tutorials/clear-signing · github.com/ethereum/clear-signing-erc7730-registry · docs.sourcify.dev (BigQuery/ERC-7730).
- **DGX:** models = MiniMax-M2.5 (best local coder) for auto-gen; Qwen3-Embedding-4B/8B + Qwen3-Reranker-4B for the RAG. See `project_dgx_spark` + `project_viral_editor` in memory.

## Hard rules / gotchas
- **DO NOT publish Arkiv's timeline** (Braga sunset / Sept testnet / Oct mainnet) — internal, no canonical public source.
- **ERC-7730 auto-gen = adjacent POTENTIAL, NOT the main dish.** The core is the DB migration. And the auto-gen is pitched as "Arkiv fills the coverage gap with candidates that apps adopt", NEVER "Sourcify/Arkiv generates descriptors" (authorship belongs to each app).
- **Re-verify before quoting:** (a) server-side ORDER BY (SDK exposes it, field guidance says "don't use it"); (b) live network (Braga vs new "Zeppelin" staging) — freshness check §14 of the handoff.
- **Numbers = Braga-measured, evolving** (testnet-Sept/mainnet columns). Don't fix them.
- Brand (from parent CLAUDE.md): lead with **queryability**; "the Web3 database"; **Arkiv entities** not "records"; mascot = **BLOK** not "golem". Do not conflate Arkiv ↔ Golem Network ↔ Factory ↔ Foundation.
