# ARGOT v1 — Sourcify → Arkiv · Integration Dossier (living doc)

> **Status:** Phase 0 (research). Living markdown doc — NO infra yet.
> **North star:** get Sourcify to **leave BigQuery and migrate its database to Arkiv** = its database made **decentralized and queryable** (both at once: BigQuery gives query but is Google/centralized; IPFS gives decentralization but is not queryable; Arkiv gives both).
> **Next internal milestone:** updates in ~2 weeks → bring the "open questions" to **Marcos (Head of Product, Arkiv)** at the ecosystem meeting.
> **External milestone:** technical meeting with the **Sourcify CTO, mid-August 2026** — arrive with answers, not questions.

---

## 0. What Sourcify is (context)
Ethereum Foundation project, open-source contract verification. Run by **Lea + Kaan**. Reason for being: *"avoid data silos inherent in proprietary explorers"* → ideologically aligned with decentralization.
- **Infra today:** Postgres on Google Cloud (backend) + IPFS mirror + **public BigQuery dataset** (query) + Parquet/GCS export.
- **Scale:** **~11M contracts** (end-2025; the earlier "~4M" was outdated) · API v2 ~15M requests/day (mostly reads). **API v1 permanent shutdown 2026-07-07.** Repo is now **`argotorg/sourcify`** (Argot maintains Sourcify).
- **Stated pains (meeting):** distribution + integration with tooling (Foundry, Hardhat, Remix).
- **Data nature:** **write-once / immutable** — verified source code never changes. (Key for the storage design, see §4.)

## 1. What ERC-7730 / Clear Signing is (the wedge)
A standard JSON file that tells a wallet how to display a tx in human language instead of hex ("clear signing" = what you see is what you sign). **For a descriptor to enter the registry, the contract must be verified on Sourcify first** → Sourcify is the gateway. Sourcify is a contributor to the working group (open spec + neutral registry + attestation framework). Creating descriptors today is **manual = bottleneck** (see DGX idea §6).

**Strategy:** wedge (ERC-7730, bounded scope, demoable now) → north star (full migration off BigQuery as Arkiv matures toward mainnet).

## 2. Load model — real numbers
> Full detail with sources → [`arkiv-load-model-research.md`](./arkiv-load-model-research.md). Numbers = **evolving benchmarks**, Braga-measured; almost all change with the new L2.

> **🚨 VERDICT:** full migration (4M contracts + 15M req/day onto Arkiv TODAY) **NOT viable yet** — 3 hard blockers: **permanence** (no primitive, mandatory TTL), **ownership** (EOA-signature only, a multisig can't sign), **read-scale** (15M req/day unproven; 500 q/s gate unmet). Gas is NOT a problem (4M writes ≈ 0.04–0.12 GLM, 2–7h). Viable path = tiered-index pattern §4, not a DB replacement. → wedge → migration confirmed.

### READ (~15M req/day, mostly reads)
| Feature | Arkiv Braga (measured/doc) | Testnet Sept | Mainnet Oct | BigQuery |
|---|---|---|---|---|
| Latency | tens–hundreds ms (NOT sub-10ms) | _TBD_ (changes) | _TBD_ | ms |
| Throughput | read "feeling good"; gate 500 q/s @ p99 / 10M ent = **unmet** | _TBD_ | _TBD_ | high |
| Rate limits | **undocumented** | _TBD_ | _TBD_ | GCP quota |
| Concurrency | **undocumented** | _TBD_ | _TBD_ | high |
| Egress | **no fee** (pricing = storage×time; reads no gas) | _TBD_ | _TBD_ | charges egress |
| Query/patterns | SQL-like WHERE (`&&`/`\|\|`/`!`/comparators/glob), by owner/creator; pagination max 200/page; 🚩 server-side ORDER BY **contested** | _TBD_ | _TBD_ | full SQL |

### WRITE (gas is NOT the problem)
- Batch cap **1000 ops/tx** (measured). Gas **55–93/entity**. Cost/event **~1–3×10⁻⁸ GLM**. Throughput **~150–500 ev/s** per wallet (multi-wallet pool designed, not built).
- **4M writes ≈ 4,000 txs ≈ 0.04–0.12 GLM (testnet), 2.2–7.4h.** Update = **full-replace**. Write-side is a known bottleneck (arki-v3 refactor ~70% speedup in progress).
- 🚩 **Mainnet economics undefined** (fee spec in draft) → who pays ongoing? Marcos.

### STORAGE
- **120 kb block limit** → large source bundles go chunked (FileDB) or referenced to IPFS + queryable index in Arkiv (**validates §4**).
- 🚩 **Mandatory TTL (`expiresIn` in seconds), no permanence primitive** → clashes with Sourcify's permanence → solution = tiered-index pattern §4. Entities **do NOT migrate across testnets** (Braga lost at sunset).

## 3. Product concern: OWNERSHIP (Santiago's catch — ❌ CONFIRMED blocker)
Asking "1 wallet, 1 private key holding the whole DB" = catastrophic single point of failure. No CTO signs that.
- **Finding (research):** every Arkiv mutation is signed with an **EOA private key**. A Gnosis Safe/multisig is a contract **with no private key → it cannot sign an Arkiv tx**. You can *set* a contract as `owner` (address level) but it **couldn't then update/delete/extend**. No ERC-1271/AA documented. → the catch is real and **unresolved**.
- **Needed:** functional multisig/threshold. Question #1 for Marcos.

## 4. Tiered storage design (Santiago's idea — solves TTL vs permanence)
Sourcify data = immutable → ideal write-once pattern.
- **Hot** (queried often) → live queryable entity in Arkiv.
- **Cold** (no calls in X time) → stop paying to keep it "alive"; the data lives fixed forever in the block/tx where it was written, retrieved by reference.
- **To resolve:** you need a **lightweight permanent index** (address → tx hash) to be able to do `eth_getTransactionByHash`; the heavy data in calldata/logs. Arkiv = that index. Turns the 🚩 TTL into a feature.

## 5. Open questions for Arkiv Product (Marcos) — ecosystem meeting ~2 weeks
1. **Ownership multisig:** can a Safe/contract be a functional owner that can *still update/delete* (ERC-1271/AA/threshold)? Today = EOA-signature only. (§3 — hardest blocker for a CTO.)
2. **Write-once permanence:** guaranteed path to keep immutable data alive without perpetual `extendEntity` renewals? Is the §4 pattern (Arkiv-renewable-index + data in calldata) blessed?
3. **Mainnet economics:** who pays gas for 4M writes + ongoing? Real fee spec ($GLM, currently draft)? Grant/subsidy for a public good?
4. **ORDER BY reality:** SDK exposes it and docs advertise it, but field guidance says "never, sort client-side". Does it work server-side on the new testnet?
5. **Read SLA:** can Sept testnet / mainnet serve ~15M req/day (rate limits, concurrency, p99)? 500 q/s @ p99 / 10M gate unmet + unscheduled.
6. **RPC access:** dedicated RPC per API key vs shared? Documented rate limits? (Hub v1 pending.)
7. **Max payload:** hard per-entity cap below 120 kb? Chunking boundary (FileDB) for source-code-sized blobs?

## 6. POTENTIAL: DGX as an intelligence appliance over Arkiv (brainstorm, ranked)
> A single DGX does NOT serve 15M req/day of production, but DOES serve a low-QPS / high-value intelligence layer on top of Arkiv. (DGX rule: fine to expose for an agent/demo, not for a production SLA.)

### 🥇 POTENTIAL — Agent that auto-drafts ERC-7730 descriptors from the verified ABI
**Mechanics:** read Sourcify's verified ABI → a local LLM infers the `format` of each parameter (`to`→`addressName`, `value`→`tokenAmount`, `deadline`→`date`…) + the `intent` (Send/Swap/Approve) → build valid ERC-7730 JSON → validate with the official linter (`erc7730 lint`) → tag with a confidence score. Pattern **LLM drafts, human verifies**. Attacks a REAL bottleneck: today each descriptor is hand-written (~20-40 min), which is why millions of contracts have none.
**Why it fits:** Sourcify provides verification → DGX generates intelligence → Arkiv makes it queryable (`find_clear_signing_descriptor`, coverage-gap list).

**Input & accuracy:** Sourcify has the **full verified source code + NatSpec** (`@notice`/`@param`), not just the ABI → best possible input (structure + intent). Accuracy is **bimodal**: ~90%+ on standard patterns (ERC-20/721/1155, approvals, swaps), low/needs-human on the custom long tail (rare `enum`s, `tokenAmount` with external tokens). DGX model = **MiniMax-M2.5** (best local coder + native tool-calling → valid JSON); GPT-120B OOMs. **The harness > the model:** feed source+NatSpec + constrain to the schema + validate with `erc7730 lint` + confidence score. **Real eval:** auto-generate over N contracts that ALREADY have a hand-written descriptor in the registry → diff vs ground-truth = measured accuracy (good PoC for August).

**⚠️ Ownership subtlety (open question, NOT resolved):** descriptor authorship today belongs to **each app** (the owner attests the meaning of its functions), NOT to Sourcify (which is only the verification gate). So auto-gen does NOT replace that authorship — it's a **candidate / bootstrapping layer for the long tail**, in a **separate trust tier**:
- **Tier 1 (authoritative):** descriptor written + attested by the app OWNER.
- **Tier 2 (candidate):** auto-generated (DGX), labeled "draft/heuristic"; an app adopts it and "promotes" it to Tier 1.

Puts Arkiv in a **slot nobody claims yet** (between Sourcify's verification and the Ledger/EF registry's curation) without stepping on anyone. **Pitch framing:** "Arkiv fills the coverage gap with candidate descriptors that apps adopt" — NOT "Arkiv/Sourcify generates descriptors" (that creates friction: "that's the apps' job").
*Security risk:* a bad auto-generated descriptor could induce signing something malicious → the confidence tiering is mandatory, not optional.

### 🥈 POTENTIAL — Natural-language query
Translates text ("verified contracts on Base without clear signing") → Arkiv queries. Cool for devs, lower priority.

### 🥉 POTENTIAL — 24/7 monitoring agent
Detects stale-bindings, coverage gaps, proxies that changed post-descriptor → alerts.

## 7. Phase plan
- **Phase 0 — Research ✅ (largely done):** Arkiv load model + Sourcify data model (both sourced) + Step 2 mapping design (`arkiv-mapping-design.md`, with a real worked example) + migration plan + adapter sketch + telemetry. Show artifacts built: `marcos-product-questions.html`, `arkiv-mapping-design.html`. Open: resolve the Marcos P0 answers.
- **Phase 1 — Knowledge system:** MCP server over this folder (simple: keyword + live fetch). Upgrade to a RAG (embeddings/reranker on DGX) only if the corpus grows. DGX builds / cloud serves / shareable with Shantelle.
- **Phase 2 — Sidecar prototype + tutorials** for the August meeting (coverage gaps on Safe/Aave/1inch + Foundry/Hardhat tutorial). The **adapter** (`arkiv-mapping-design.md` → "The adapter") is the real thing to prototype — but gated on Marcos P0.

## 8. Do not publish
Arkiv's timeline (Braga sunset / Sept testnet / Oct mainnet) = internal, no canonical public source. Do not put it in tutorials.
