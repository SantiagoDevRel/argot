# Clear Signing Studio — Arkiv × Sourcify (ERC-7730 POC)

Internal demo for the ERC-7730 × Arkiv concept: a **DGX-generated candidate ERC-7730
clear-signing descriptor** drafted from a Sourcify-verified contract, gated by a linter,
and stored as a **queryable Arkiv entity**. Descriptors are always **candidate drafts** —
each app reviews, adopts, and attests; nothing is auto-submitted.

> Context + rationale: [`../erc7730-poc-spec.md`](../erc7730-poc-spec.md) ·
> [`../erc7730-viability-assessment.md`](../erc7730-viability-assessment.md) ·
> [`../sourcify-cto-conversation.md`](../sourcify-cto-conversation.md)

## Run

```bash
npm install
npm run dev          # http://localhost:3000 (or next free port)
```

**Access code: `123`** (no username). The same code gates the "Load model" button.

## The three tabs

- **Create** — pick a verified contract → the 5 Sourcify inputs (ABI · NatSpec · Source ·
  Identity · Proxy) + a separate on-chain **enrichment** chip (token decimals via `eth_call`,
  never model-inferred) → **Load model** (gated) → **Generate** → a candidate ERC-7730 JSON with
  `erc7730 lint ✓`, per-field confidence, and a `candidate · unattested` tag.
- **Database** — the descriptors + attestations as **queryable Arkiv entities** (interactive
  graph + table), filterable by status / chain / address. Candidate = orange dashed,
  attested = solid blue.
- **How** — the 6-stage pipeline (Sourcify → DGX → erc7730 lint → Arkiv entity → app owner
  adopts → attestation) + the why cards.

## Architecture (mock now, DGX-live later)

The UI is wired to two endpoints whose **contract is identical to the real DGX path**, so
going live is a swap, not a rewrite:

| Endpoint | Now (mock) | Live |
|---|---|---|
| `POST /api/load` `{code}` | returns the boot steps the client replays | proxies (Cloudflare tunnel + bearer) to the DGX wrapper → starts Ollama `qwen3-coder-next`, streams progress |
| `POST /api/generate` `{chainId,address}` | returns the seed descriptor + confidence + inputs + `lintPassed` | fetch Sourcify v2 inputs → `qwen3-coder-next` (schema-constrained) → `erc7730 lint` gate → return the draft |

**DGX model:** `qwen3-coder-next:q4_K_M` (51 GB, fits the Spark with headroom, on-demand
Ollama load = the "Load model" button). MiniMax-M2.5 is reserved for the offline eval batch.
The DGX is exposed only via a bearer-gated wrapper (Ollama stays internal).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · inline styles + CSS keyframes
(design ported 1:1 from Claude Design; brand: Arkiv Blue `#181EA9` leads, Orange `#FE7446`
spark, IBM Plex Mono + Inter).

## Structure

```
app/
  layout.tsx          fonts + metadata
  page.tsx            renders <Studio/>
  globals.css         brand tokens + all keyframes + hover utilities
  _components/
    Studio.tsx        gate + header + state machine (client)
    CreateTab.tsx     inputs → DGX node → output (the hero generate flow)
    DatabaseTab.tsx   queryable entities: graph + table
    HowTab.tsx        the 6-stage pipeline + why cards
  api/
    load/route.ts     mock DGX boot
    generate/route.ts mock candidate descriptor
lib/data.ts           mock data + JSON tokenizer + helpers
```

## Done (2026-07-08)

- **Deployed live** → https://arkiv-sourcify.vercel.app (santiago-prod), server-side gate.
- **Server gate** — `proxy.ts` (Next 16; middleware→proxy) + `/api/gate` cookie (pwd `123`,
  no username) fronting the whole site + the DGX-touching routes. `GATE_TOKEN` in Vercel env.
- **Real Arkiv entities** — `scripts/arkiv-seed.mjs` wrote 8 descriptors to Braga (one
  `mutateEntities` tx); the Database tab reads them live via `/api/entities` (`lib/arkiv.ts`).
- **Eval harness** — `eval/` (ground truth + metrics + bimodal orchestrator). See `eval/README.md`.
- **DGX live path** — `dgx-wrapper/` written; `lib/dgx.ts` swaps `/api/load`+`/api/generate`
  to live when `DGX_URL` is set.

## Deferred (needs the free GPU)

- Warm qwen3-coder-next + run the wrapper end-to-end; set `DGX_URL`+`DGX_BEARER` on Vercel.
- The eval batch run (real accuracy + baseline deltas) — `node eval/run-eval.mjs --gen dgx`.
- codex audit of the DGX security wiring + the eval result.

## Roadmap

- ✅ **Feed relevant Solidity source to the generator (better intent) — DONE (2026-07-15).**
  `buildUserMsg` now passes ABI + NatSpec **+ the relevant Solidity source** (`src-extract.mjs`
  pulls the state-changing function bodies + struct/enum defs, capped at 12 KB — not the full
  source, which would blow the context on big routers). **Measured A/B (n=30, same held-out
  contracts, one experimental wrapper on :9011 vs the baseline on :9010):**

  | metric | ABI+NatSpec | +relevant source | Δ |
  |---|---|---|---|
  | lint-pass | 50% | **57%** | +7pp |
  | fnRecall | 0.372 | **0.435** | +0.06 |
  | fieldExact | 0.054 | **0.104** | ~2× |
  | intent | 0.097 | **0.119** | +23% |

  Consistent win on all four (lint did NOT drop — the concern about a bigger prompt hurting
  structure didn't materialize; only the long-tail lint dipped ~1 contract, noise). Promoted to
  the live wrapper. The model now grounds intent in what the code *does*, not just param names.
