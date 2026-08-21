# ERC-7730 × Arkiv — POC spec (v1)

> **2026-07-08.** Direction validated by the Sourcify CTO conversation ([`sourcify-cto-conversation.md`](./sourcify-cto-conversation.md)) and the audited viability assessment ([`erc7730-viability-assessment.md`](./erc7730-viability-assessment.md)). Built on Santiago's proposed flow + refinements. Meeting-ready context to show at a future Arkiv meeting.
> **Brand:** lead with **queryability**; "Arkiv entities" (not "records"); use *expiry/expiration* not "TTL"; Arkiv/DGX produce **candidate drafts**, never authoritative descriptors (authorship stays with the dApp).

## What the POC proves (one line)
That **Arkiv is the queryable, permissionless, attestation-aware store for ERC-7730 descriptors** — exactly the "onchain + permissionless + trust from attestations" registry the Sourcify CTO said they want — and that a **DGX-generated candidate draft** can seed the enormous coverage-gap long tail, with a **measured accuracy delta** vs the ground-truth registry.

## Why now / why this shape
- Kaan (Sourcify CTO): *"our intention is to move this [registry] onchain and make it permissionless … trust will come from attestations."* → Arkiv-shaped problem.
- Descriptors **come from dApps**, via PR + review, and *"we're yet to implement a process there."* → the store + candidate + lifecycle is unbuilt.
- The DSL is **write-time / new contracts** → the **existing 38.5M-contract long tail** (only a few hundred descriptors exist) is uncovered → candidate generation is complementary.

---

## Two acts

### Act 1 (lead) — Arkiv as the queryable ERC-7730 registry
Model descriptors + attestations as **Arkiv entities** and answer the lookups a flat GitHub repo / IPFS cannot:

| Lookup | Arkiv query (WHERE) | Why it beats a repo/IPFS |
|---|---|---|
| Descriptor for a contract (wallet lookup) | `dataset='erc7730' && kind='descriptor' && chainAddress='1:0x…' && attested='true'` | direct, indexed, attestation-filtered |
| Coverage gaps (long tail) | verified contract entities with **no** matching descriptor entity | drives the whole value story |
| By attester (trust) | `… && attester='0x<LedgerKey>'` | wallets pick trust by attester |
| Stale bindings (security) | descriptor whose `proxyImpl` ≠ the current resolved implementation | a queryability killer feature |
| By function selector (reuse) | `… && selector='0x…'` | dedup / reuse across contracts |

**Entities (sketch):**
- `descriptor` — key `erc7730:desc:v1:<chainId>:<address>:<hash>`; attrs `dataset, kind, chainId, address, chainAddress, selector(s), descriptorHash, status(candidate|adopted), attested(bool), attester, sourcifyVerified, proxyImpl, generatedBy(dgx|human), confidence`; payload = the ERC-7730 JSON (or a content-hash ref if large).
- `attestation` — key `erc7730:att:v1:<descriptorHash>:<attester>`; attrs `descriptorHash, attester, chainAddress, attestedAtMs`; payload = attestation ref (EAS/ERC-8176 hash).
- Reuse the `verified_contract` index from [`arkiv-mapping-design.md`](./arkiv-mapping-design.md) for the coverage-gap join.

**Show layer:** visualize the registry with **`arkiv-graph`** (Santiago's own published lib) — descriptors, attestations and coverage gaps as an interactive graph/tables. No custom UI needed.

### Act 2 — DGX seeds candidate drafts for the long tail (Santiago's flow, refined)
```
 verified contract (chainId+address)
        │  (do NOT rebuild Sourcify verification — CONSUME the v2 API)
        ▼
 fetch from Sourcify v2:  GET /v2/contract/{chainId}/{address}?fields=abi,sources,userdoc,devdoc,metadata,proxyResolution
        ▼
 DGX (MiniMax-M2.5 Q3, offline batch):  ABI + NatSpec + source → draft ERC-7730 JSON
   · JSON-schema/grammar-constrained decoding (after a $ref-flatten of the v2 schema)
        ▼
 HARD GATE:  `erc7730 lint` + schema validation  → malformed drafts rejected, never surfaced
        ▼
 write to Arkiv as a `descriptor` entity:  status='candidate', attested='false', generatedBy='dgx', confidence per field
        ▼
 (for the eval) diff vs ground truth + vs baselines
```
**UX skin (optional):** an "verify → generate" front-end where a user submits a contract and gets a candidate back. But the real work is *fetch → generate → land as a queryable Arkiv candidate*. The generated draft is **never auto-submitted and never auto-attested** — an owner reviews/adopts/attests (matches Kaan's model).

---

## Inputs to the DGX (what Sourcify provides)
The generator needs enough to **understand** the contract; Sourcify provides almost all of it:

| # | Input | From Sourcify? | Feeds which part of the descriptor |
|---|---|---|---|
| 1 | Contract identity (chainId + address) | user picks; Sourcify keys on it | `context.contract.deployments` |
| 2 | ABI | ✅ `abi` | functions/params/types/selectors → `display.formats` keys + field `path`s |
| 3 | NatSpec `@notice` (userdoc) | ✅ `userdoc` | the human **intent** per function |
| 4 | NatSpec `@param`/`@dev` (devdoc) | ✅ `devdoc` | per-parameter **labels** |
| 5 | Full source | ✅ `sources` | infer intent/format when NatSpec is absent (~60% of cases): token amounts, recipients, deadlines |
| 6 | Proxy resolution | ✅ `proxyResolution` | bind the descriptor to the **implementation** |
| — | Token metadata (decimals, ticker, which token) | ❌ NOT in Sourcify | `format: tokenAmount` needs decimals → token-list / on-chain **enrichment** step |
| — | Owner / branding (project name, legal, url) | ❌ owner-supplied | `metadata.owner`/`info` → blank/tentative for a candidate |

**Honest headline:** Sourcify provides everything needed to *understand* the contract (ABI + NatSpec + source + proxy). The only gaps are **token decimals/ticker** and the **owner branding metadata** — filled by a small enrichment step or left to the dApp. Visual = **5 input chips → [DGX] → 1 output (descriptor JSON, linter ✓)** + an "enrichment: token decimals" chip.

**⚠️ DGX is NOT in the public request path** ([[feedback_dgx_not_in_public_request_path]]). The deployed app does **not** call the home DGX per request. The DGX **pre-generates descriptors in an offline batch** (real outputs); the app **replays** the flow with those real, pre-computed outputs (can feel "live": pick contract → animate inputs → reveal the real output). A true-live mode only when running locally next to the DGX.

## The eval (the credibility number for the CTO meeting)
**Ground truth = the ~372 curated hand-written registry descriptors.** *(247 calldata + 125 eip712; verify live, don't hardcode.)*

- **It's a BENCHMARK, not training.** 372 is far too few to fine-tune, and we don't need to. Use a few as **few-shot** examples in the prompt; **hold out the rest as the test set.** Never evaluate on any contract whose descriptor was in the prompt → avoid data leakage (a CTO will check this).
- **Metrics (report BIMODALLY: standard ERC-20/721/1155 subset vs bespoke long tail):**
  - linter-pass rate
  - field-mapping exact-match vs ground truth
  - intent/label match (human-judged or embedding similarity)
  - human-accept rate (would an owner ship this with ≤N edits?)
  - **DELTA vs baselines** — not only the deterministic ones (`erc7730 generate`, `clearsig generate`) but the **LLM incumbents** (`hardhat-descriptor`, ClearSignKit-style). Beating a blank page proves nothing; beating the incumbents is the question.
- **Prerequisite measurement:** NatSpec prevalence on the modern corpus (codex measured ~39% `@notice` / ~45% `@param` on 150 recent contracts — confirm at scale).

## Sourcify verify flow (for reference — CONSUME, don't rebuild)
- **Verify (async):** `POST /v2/verify/{chainId}/{address}` with `stdJsonInput` (Solidity standard-JSON) + `compilerVersion` + `contractIdentifier` (`path:Name`) + optional `creationTransactionHash` → `{verificationId}`; poll `GET /v2/verify/{verificationId}`.
- **Lookup (what we actually use):** `GET /v2/contract/{chainId}/{address}?fields=abi,sources,userdoc,devdoc,metadata,proxyResolution`.
- *(v2 data model per `sourcify-data-model-research.md`, 2026-06-30 — re-confirm the live endpoints at build time; v1 shut down 2026-07-07.)*

## Tech stack (all pieces already exist)
- **Sourcify v2 API** — input (verified ABI + NatSpec + source).
- **DGX / MiniMax-M2.5 Q3** — offline batch generation (fits 128GB; Q4 does not). Never an SLA.
- **`python-erc7730` lint** — the hard structural gate.
- **Arkiv SDK (direct)** — write/read descriptor + attestation entities (batched, cheap). **NOT `arkiv-sync`** — no chain-event indexing is needed here; we write entities straight from the generation batch.
- **`arkiv-graph`** — the queryable visualization / show layer.

## Honest gates (say these out loud)
The POC runs **now** as a demo on testnet. A **production** onchain, permissionless, queryable registry at 38.5M scale hits the **same 3 Arkiv blockers** already queued for Marcos:
1. **Permanence / expiration** — descriptors should persist; Arkiv entities expire + need renewal (or the renewable-index + anchored-data pattern). → Marcos Q2.
2. **Ownership** — permissionless writes fit Arkiv's shared public DB, but *who can update/revoke an attestation* is the EOA-vs-multisig question. → Marcos Q1.
3. **Read-scale** — wallet lookups at high volume vs the unmet 500 q/s gate. → Marcos Q5.
The POC does **not** need any of these resolved — but it makes those product questions **concrete and urgent** (here is the real use case driving them).

## ✅ Build status (2026-07-08) — DEPLOYED LIVE + Arkiv-backed + eval harness built
The app is **built, deployed, and verified end-to-end** at **https://arkiv-sourcify.vercel.app** (santiago-prod, Next.js 16 + React 19). Progress this session:
- **DEPLOYED + server-side gate** — `proxy.ts` (Next 16 renamed middleware→proxy) enforces a **password-only cookie gate** (pwd `123`, no username) over the WHOLE site incl. the clean prod domain (santiago-prod's native Vercel Auth doesn't cover it) + the DGX-touching API routes. Verified on the real URL: no-cookie `/`→307 `/gate`, `/api/*`→401, `123`→cookie→200, browser smoke (gate→studio). `GATE_TOKEN` random secret in Vercel env.
- **REAL Arkiv writes + reads (live)** — `scripts/arkiv-seed.mjs` wrote **8 candidate+attested descriptor entities to Braga in one `mutateEntities` tx** (`0x2e1b0c16…`, dataset `erc7730-poc`, SDK `@arkiv-network/sdk@0.6.8` direct, NOT arkiv-sync). The **Database tab queries them live** via `/api/entities` (`lib/arkiv.ts`, public read) — verified from prod (`live:true, network:braga, count:8`) with a green "live · Braga" badge. Fallback to the seed shape if the testnet is unreachable (Braga sunset ~2026-08-08).
- **EVAL harness built + validated** — `eval/` loads the **367 production ground-truth descriptors** (247 calldata + 120 eip712 @ `a2b33ffe`, `includes` resolved → **1124 formats**, bucketed **202 standard / 165 long-tail**), few-shot/held-out split (no leakage), self-tested metrics (field-exact/intent/format), bimodal orchestrator (`--gen mock` validated end-to-end; `--gen dgx` + baselines ready). **NatSpec sample measured** (⚠ corpus contracts are curated → ~95% @notice; the real long-tail is ~39%).
- **DGX LIVE (2026-07-09)** — `dgx-wrapper/server.mjs` runs on the DGX as a systemd service, exposed at **https://arkiv-dgx.santiagodevrel.dev** via the `dgx-mcp` Cloudflare tunnel (bearer-gated). Vercel is wired live (`DGX_URL`+`DGX_BEARER`): the browser flow **load→generate shows the REAL qwen3-coder-next descriptor** (`erc7730 lint ✓`). `/load` frees the GPU (comfy-pause + minimax-down) then warms the model — clicking it always works even if the DGX is busy. Proxy resolution (impl ABI), deterministic decimals (eth_call), deterministic context injection all wired.
- **Security audited + hardened** — codex + agent-llm-app-security-reviewer both ran: verdict **SAFE to expose (gated), no CRITICAL**. Applied: concurrency caps (429), model allowlist, body cap, absolute paths, temp cleanup, redacted client errors, chainId validation, fail-closed `GATE_TOKEN`. Bearer never leaves server env; model output is inert (JSON, lint-gated, never executed).
- **Eval RUNNING** (calldata-only, 247 ground truth): honest bimodal shape — simple/standard contracts lint-pass reliably, complex bespoke long-tail often fails the structural gate + low coverage (the real gap for MiniMax + few-shot). Fixed the codex-caught bug (descriptor JSON string must be parsed before scoring). **Still to run offline:** MiniMax max-quality number + baseline deltas.
`npm run build` + `lint` green (0 errors). Details → `erc7730-poc/README.md` + `erc7730-poc/eval/README.md` + `erc7730-poc/dgx-wrapper/README.md`.

## The POC app — one self-contained, gated site, 3 toggles
**Deploy:** `arkiv-sourcify.vercel.app` — password `123`, **no username** (serverless basic-auth gate, per [[reference_vercel_private_static]]). Internal pitch first — do NOT loop in the Sourcify CTO until this is built.

1. **`Create descriptor`** — pick a contract → **inputs panel** (the 5 Sourcify inputs above as chips) → **[DGX]** → **output panel** (the ERC-7730 JSON, `erc7730 lint` ✓, per-field confidence). Real DGX outputs, pre-computed offline and replayed (see the DGX request-path note). The "here are the X inputs → here is the output" visual.
2. **`Database`** — the stored **Arkiv entities** via `arkiv-graph` (graph + table) with live filters: by contract (`getDescriptor`), by status (`candidate`/`attested`), by chain. This is the queryability proof.
3. **`How?`** — the architecture **one-pager** with visuals: `user → Sourcify v2 API → DGX (offline batch) → erc7730 lint gate → Arkiv entity → query / wallet`. Clear, on-brand (blue leads / orange spark).

**Also on hand for the meeting (not necessarily in the app):** the **eval number** (accuracy + delta vs incumbents on the ~372 ground-truth set, bimodal) and the **honest gates** mapped to the Marcos product questions ("here's the use case that makes those decisions matter").

## Locked build decisions (2026-07-08)
- **App:** Next.js (App Router, TS, Tailwind) at `argot/erc7730-poc/`; deploy `arkiv-sourcify.vercel.app`, basic-auth gate **pwd `123`, no username** (middleware).
- **DGX IS in the request path for this gated POC** (Santiago's explicit call — a sanctioned exception to [[feedback_dgx_not_in_public_request_path]], which still holds for real product traffic). A pwd-`123`-gated **"Load model"** button initializes the model on the DGX with a streamed progress bar; once loaded the page generates **live**.
- **Live model → `qwen3-coder-next:q4_K_M` (51GB) via Ollama.** Fits 115GB free with headroom (no freeze risk vs MiniMax 101GB), on-demand load (= the button), ~40 tok/s, 256K ctx, strong structured JSON. Loads in ~seconds–1min.
- **Offline eval model → MiniMax-M2.5** (SWE 80.2%, highest quality) + qwen for comparison — the backtest runs offline, where slow load/freeze doesn't hurt UX, so we also report the max-quality number.
- **Public path → Cloudflare Tunnel** (reuse the existing `dgx-mcp` infra on santiagodevrel.dev): outbound-only (home IP/ports stay private), public hostname reachable by Vercel, locked with a **bearer** (+ optional Cloudflare Access/rate-limit). Free tier. A **thin wrapper on the DGX** (checks bearer, proxies load+generate to local Ollama, runs `erc7730 lint`) is what's exposed — Ollama stays internal.
- **Endpoint contract (mock == real):** `POST /api/load {model}` → SSE progress → `{ready}`; `POST /api/generate {chainId,address}` → fetch Sourcify inputs → DGX structured JSON → `erc7730 lint` → `{descriptor, confidence, lintPassed, inputs}`.
- **Token decimals:** deterministic on-chain `eth_call` to the token's `decimals()`/`symbol()` (100% reliable, NOT LLM-guessed); manual input fallback when the token is ambiguous.
- **Owner:** open manual input (deployer address prefilled from Sourcify as a hint; brand name typed by the user).

## Still to confirm during the build
- **Arkiv network** for the entity writes (Braga sunsetting ~2026-08-08 / Zeppelin staging not GA) — re-verify live; worst case the `Database` toggle reads a stored snapshot with the same entity shape.
- **DGX smoke-test:** qwen3-coder-next structured-output on ~20 registry contracts before scaling the batch.

## Open decisions
- Lead framing: Arkiv-branded registry vs open-source tool that uses Arkiv (→ Pawel/Marcos).
- Why Arkiv over The Graph GRC-20 for the store (ClearSignKit's choice) — must be stated.
- Which testnet to build on (Braga vs Zeppelin staging — re-verify live before building).
