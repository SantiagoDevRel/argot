# ERC-7730 auto-gen as add-on value for the Arkiv × Sourcify partnership — Viability Assessment

> **Phase 0 deliverable · 2026-07-08 (v2, audited).** Requested after Pawel (Arkiv CEO) liked the ERC-7730 idea and asked to see a POC.
> **Method:** two independent research engines in parallel — a Claude multi-agent workflow (5 web-research lanes → adversarial per-claim verification → synthesis; 55 agents) **and** codex (gpt-5.5, web on). Then a **codex read-only audit** of the drafted report, whose central finding was **verified by hand against primary sources** and forced a **material correction** to the thesis (see "AUDIT CORRECTION" below). Every load-bearing fact carries a primary source + fetch date (2026-07-08). Numbers are LIVE-mutable — **verify before quoting, never hardcode**.
> **Language:** English (project rule). Internal working doc; the HTML show artifact for Pawel/Sourcify is a separate build.

---

## 🟢 2026-07-08 UPDATE — Sourcify CTO validated the direction (see [`sourcify-cto-conversation.md`](./sourcify-cto-conversation.md))
The Sourcify CTO (Kaan, EIP-7730 co-author) confirmed: descriptors **come from the dApps**; the EIP is **registry-agnostic** and **their intention is to move the registry ONCHAIN + permissionless with trust from attestations**; the DSL is **write-time (new contracts only)**. **Impact on this assessment:** (1) a *stronger, north-star-aligned* Arkiv play surfaced — **Arkiv as the queryable, permissionless, attestation-aware registry** (bigger than the LLM sidecar); (2) the **attestation trust model de-risks criterion (E)** — an unattested candidate is not a footgun by itself; (3) the DSL does **not** pre-empt the long-tail candidate idea (it covers new contracts, not the ~38.5M existing ones). POC direction → [`erc7730-poc-spec.md`](./erc7730-poc-spec.md).

## 🔴 AUDIT CORRECTION (what v1 got wrong)
The first synthesis claimed the *surviving wedge* was "the semantic/intent layer (reading NatSpec/source to draft human-readable intent) — unmet by any shipped tool." **That is false.** Verified 2026-07-08:
- **`hardhat-descriptor`** (npm, v0.3.0, published 2026-06-01) — *"Hardhat 3 plugin that uses **Claude** to generate ERC-7730 clear-signing descriptors from your compiled contracts."* `descriptor.provider` opts into "richer, **LLM-authored intents**, field formats, and EIP-712 support" (Anthropic/Gemini/Groq/OpenAI). `descriptor submit` **opens a draft PR to `ethereum/clear-signing-erc7730-registry`.**
- **ClearSignKit** (ETHGlobal Cannes; won **Ledger Clear-Signing ERC-7730 1st place** + Hardhat best-project) — AI generation from ABIs, explicitly **"Replaced Etherscan with Sourcify API,"** analyzes **NatSpec + source code**, and stores results in **"an open, queryable repository of verified schemas … using The Graph's GRC-20 Knowledge Graph."**

**So the LLM intent layer is shipped, AND the "queryable decentralized candidate store" is already a prize-winning hackathon build — on The Graph, not Arkiv.** The idea is **validated by the ecosystem** (Ledger paid a prize for exactly this) but **more occupied than v1 assumed**. This does not kill the project; it **relocates the wedge** from "novel idea" to "**production-scale + Arkiv-queryability-differentiated + open/local generation**," and it raises a headline strategic question (below).

---

## TL;DR — Verdict: **GO WITH CONDITIONS** (harder conditions than v1)

The naive framing ("we'll LLM-generate descriptors from Sourcify and store them queryably") is **already built and won a Ledger prize**. A defensible Arkiv version still exists, but it is a **"productionize + differentiate," not a "first-mover,"** play — and only worth it if the differentiation is real:

1. **Concept validated, but occupied at POC level.** Deterministic ABI→descriptor scaffolders ship (Ledger `erc7730 generate`; Cyfrin `clearsig generate`, Sourcify-fed + proxy-traversing). LLM-authored intent ships (`hardhat-descriptor`, Claude, npm, with registry-PR submission). The exact "Sourcify + NatSpec + LLM + queryable decentralized store" pitch ships (ClearSignKit, on The Graph GRC-20). Ledger itself **announced** an official LLM Generator (blog 2026-05-15; repo `LedgerHQ/erc7730-generator` **404 today** = not public yet).
2. **What genuinely survives for Arkiv** (must be stated honestly, not oversold): **(a) production, Sourcify-scale coverage** of the long tail (hackathon POCs ≠ a maintained 38.5M-contract pipeline); **(b) Arkiv as the queryable store — but Arkiv must justify why over The Graph GRC-20** (ClearSignKit's choice); **(c) open, local, DGX-batch generation** (vs cloud Claude in the incumbents); **(d) eval + confidence + telemetry rigor**; **(e) Sourcify-native integration** aligned to Sourcify's own H2 roadmap.
3. **Security is still the make-or-break and still forces the design:** a wrong descriptor makes a malicious tx look benign; the LLM's inputs are adversarial (a hostile contract can name a withdrawal `deposit`); the linter checks **structure, not semantic truth.** Safe **only** as a severed candidate/draft tier — never unattended auto-PR, never auto-attest, human-reviewed, authorship stays with the project team.
4. **This remains the "adjacent potential," not the main dish.** The DB-migration north star (Sourcify off BigQuery onto Arkiv) is still the headline. Given the space is now occupied at POC level, the strategic question for Pawel is sharper: **is productionizing an already-demonstrated idea the best use of Arkiv DevRel time, or a distraction?**

**The one-sentence pitch that is TRUE (post-audit):**
> *"The ecosystem already proved it wants this (Ledger prized an LLM+Sourcify descriptor generator). No one has built the **production, Sourcify-scale, Arkiv-queryable, open/local-generated** version: a DGX-batch, linter-gated, clearly-labeled **draft** descriptor for every Sourcify-verified contract that has none — reviewed and attested by each project team, nothing auto-submitted — with Arkiv's web2-grade queryability over that candidate long tail as the differentiator versus The Graph."*

---

## What changed since the dossier (§6) — the landscape moved a lot

| Dossier assumption (June 2026) | Reality (2026-07-08, sourced) |
|---|---|
| Descriptors hand-written; auto-gen is an open bottleneck | Deterministic auto-gen **ships** (Ledger `erc7730 generate`, Cyfrin `clearsig generate`) |
| Registry = LedgerHQ single repo | Canonical repo is **`ethereum/clear-signing-erc7730-registry`**, **co-stewarded with Sourcify** |
| Sourcify is "a working-group contributor" | Sourcify is a **founding member** of the Clear Signing Working Group, ships its own tooling (`@sourcifyeth/clear-signing`, playground, test-runner); **H2-2026 roadmap = a DSL for ERC-7730 descriptors + maintaining the registry** |
| Nobody does LLM generation | **Multiple** do: `hardhat-descriptor` (Claude, npm, +registry-PR); **ClearSignKit** (Sourcify+NatSpec+LLM, queryable store on **The Graph**, **Ledger 1st-prize**); Ledger's own Generator announced (repo 404) |
| Nobody does the "queryable descriptor store" wedge | **ClearSignKit already did it on The Graph GRC-20** → Arkiv must differentiate, not claim novelty |
| ~11M verified contracts | **38.5M** (Sourcify H1-2026 recap, **published 2026-07-01**; mutable, re-check) |

---

## The 5 criteria — verdict, confidence, evidence

### (A) Sourcify / anyone does NOT already do this → **NO** (high confidence) — the concept is occupied
- **Deterministic ABI→descriptor:** Ledger `python-erc7730 generate` (from ABI; zero NatSpec; title-cased placeholder labels; substring format-guessing; v1.0.8, 2026-06-30). Cyfrin `clearsig generate` (from **verified Sourcify ABI**, auto-traverses proxies; PyPI 0.3.1, 2026-05-13).
- **LLM-authored intent:** `hardhat-descriptor` (npm 0.3.0, 2026-06-01) uses **Claude** to author intents/formats/EIP-712 from compiled artifacts and can **open a registry PR**. ClearSignKit does it from **Sourcify + NatSpec + source**.
- **The queryable store wedge:** ClearSignKit stores descriptors in a queryable decentralized repo on **The Graph GRC-20** — the Arkiv pitch, already demonstrated.
- **Only un-shipped incumbent:** Ledger's official Generator (announced 2026-05-15; repo 404).
> **Net:** there is **no clean gap**. Every layer we imagined has a public implementation; the only things not-yet-done are **production scale**, **Arkiv-as-the-store (vs The Graph)**, and **open/local generation**.

### (B) Sourcify already has ALL the data for LLM generation → **YES** (high confidence, one caveat)
`GET https://sourcify.dev/server/v2/contract/{chainId}/{address}?fields=all` returns `abi, metadata, sources, userdoc (@notice), devdoc (@dev/@param/@return), compilation, proxyResolution, stdJson, bytecode` — verified against the live API. *(No separate top-level `signatures`; they live inside `abi`.)* ClearSignKit's use of the Sourcify API confirms it in practice.
- **Caveat — NatSpec is optional/uneven.** STAN 2020 floor: ~5.36% DevDoc / 129,737 Etherscan contracts. **codex live sample 2026-07-08** (150 recent verified contracts, 5 chains): **`userdoc.notice` 38.7%**, **`devdoc` params 45.3%**. So ~40% carry intent-bearing NatSpec; for the rest the LLM infers from raw source (lower accuracy). **Measure real prevalence on the 38.5M corpus on the DGX before quoting accuracy.**

### (C) Genuine value for Sourcify (not just Arkiv) → **PARTIAL** (medium confidence)
- **For:** coverage gap is enormous (**372 descriptor files** — 247 calldata + 125 eip712; **381 production registry JSON**; **923 incl. tests**; at commit `a2b33ffe`, 2026-07-01) vs **38.5M** verified contracts. Sourcify's role is "tooling + data"; filling the long tail is on-mission.
- **Against:** (1) Sourcify's **own H2 roadmap** (ERC-7730 DSL + registry maintenance) may pre-empt a candidate layer. (2) Auditors **already** diff submissions against a `clearsig`-generate Sourcify baseline. (3) **The Graph already courted this exact use case** (ClearSignKit) — so "queryable descriptor store" is not a Sourcify-value Arkiv uniquely provides.
- **Real beneficiaries** = wallets, hardware-wallet users, protocols, auditors. Sourcify benefits **indirectly**. **Do not overclaim as a uniquely-Arkiv gift.**

### (D) Technically feasible with the DGX (single-GPU, offline batch) → **YES** (high confidence, guardrails)
- **Model fit:** MiniMax-M2.5 (230B MoE / ~10B active) **UD-Q3_K_XL ≈ 101GB fits** the Spark's 128GB unified memory (~26 tok/s); **Q4_K_M ≈ 138.5GB does NOT fit** → Q3 ceiling (smoke-test Q3 structured output first).
- **Valid output:** JSON-schema/grammar-constrained decoding for well-formedness **+ `erc7730 lint` as the hard reject gate.** Note: llama.cpp's GBNF **drops `$ref`/`oneOf`/`if-then-else`** (which ERC-7730 v2 uses heavily) → grammar ≈ well-formedness only; **the linter (after a `$ref`-flatten) is the real correctness gate.**
- **Accuracy bimodal** — strong on ERC-20/721/1155 + common swaps, weak on bespoke long tail (analog TIM: F1 1.00 method-name, ~0.29 custom). **Bimodality maps onto "candidate for the long tail."**
- **Differentiator vs incumbents:** the incumbents call **cloud Claude** (`hardhat-descriptor`) or hackathon cloud LLMs (ClearSignKit). **Open, local, DGX-batch generation over the whole long tail** is a genuine, un-built variant — and offline batch is the only correct use of a 1-GPU home box (never an SLA — [[feedback_dgx_not_in_public_request_path]]).

### (E) Secure and reliable → **PARTIAL** (high confidence) — safe only as a severed candidate tier
- **Threat is real:** a wrong descriptor "can make a malicious transaction look benign," and inputs are **adversarial** (hostile contract can name a withdrawal `deposit`; LLM can hallucinate decimals/recipient/intent/hidden approvals). **The linter validates structure/selectors/paths/max-lengths/heuristic types — NOT displayed-intent truthfulness.**
- **Trust model (corrected, less absolute than v1):** **wallets decide trust policy.** Real trust = **auditor EAS attestations** (ERC-8176-style, hash over canonicalized JSON) that a wallet opts into; **registry inclusion ≠ endorsement.** Depending on wallet/device implementation, an untrusted/unsupported descriptor falls back to **opaque/blind signing or rejection** — it is **not guaranteed** that a bad registry file can never reach any screen (that depends on the wallet). *(v1 over-claimed the Ledger on-device guarantee; softened.)*
- **Safe shape:** every output labeled `unverified draft` + per-field confidence; **human review by the authorized project maintainer/protocol team**, plus independent **auditor attestation**; **no unaffiliated auto-submit, no unattended/unreviewed auto-PR, no auto-attest.** If wired to auto-open PRs or auto-attest, it becomes a live supply-chain attack vector. **Severance must be in code, not a disclaimer.**

---

## The Gap — what Arkiv genuinely adds (rewritten post-audit)

**It is NOT the semantic/intent layer** (shipped: `hardhat-descriptor`, ClearSignKit) **and NOT the queryable-store concept** (shipped: ClearSignKit on The Graph). What remains un-built and defensible:
1. **Production, Sourcify-scale coverage** — a maintained batch pipeline that drafts candidates for the *entire* coverage-gap long tail (~38.5M − ~372), not a per-contract dev-time plugin or a hackathon demo.
2. **Arkiv-as-the-store, differentiated vs The Graph GRC-20** — the honest claim must be about **web2-grade queryability / DX** over the candidate set (lead with queryability), and Arkiv must *articulate why it beats GRC-20* for this. If it can't, this leg is weak.
3. **Open, local, DGX-batch generation** — no cloud-LLM dependency/cost per descriptor; reproducible; auditable prompts.
4. **Eval + confidence + telemetry rigor** — a measured accuracy/delta story the hackathon builds don't have.
5. **Sourcify-native alignment** — built with, not around, Sourcify's H2 DSL + registry-maintenance plans.

> **The value is now a "productionize + differentiate" story, and it is only worth the compute if (a) Arkiv can state a real advantage over The Graph GRC-20 for the store, and (b) a backtest shows the local DGX generator is competitive with the cloud incumbents.**

---

## The safe POC shape (security-forced, audit-corrected)

1. **INPUT** — Sourcify v2 API (`abi + sources + userdoc/devdoc + proxyResolution`) for coverage-gap contracts (no existing registry descriptor).
2. **GENERATE** — MiniMax-M2.5 Q3 on the DGX, **offline batch**; schema-constrained decoding (after `$ref`-flatten).
3. **HARD LINTER GATE** — `erc7730 lint` + schema; malformed drafts auto-rejected, never surfaced.
4. **DIFF vs ALL baselines** — not only deterministic (`erc7730 generate`, `clearsig generate`) but **the LLM incumbents (`hardhat-descriptor`, ClearSignKit-style)** — otherwise the POC only proves "LLM beats ABI heuristics," which is no longer the market question.
5. **LABEL + STORE** — per-field confidence; `unverified draft / candidate`; stored as **queryable Arkiv entities** — and the POC must **demonstrate the queryability advantage vs The Graph GRC-20**, not assert it.
6. **HUMAN-IN-THE-LOOP** — reviewed by the **authorized project maintainer / protocol team**; independent **auditor attestation**; that party (not Arkiv) submits. **Authorship stays with the project.**
7. **HARD NEVERs** — never an **unattended/unreviewed** auto-PR to the registry; never self-attestation; never a CAL signature; never auto-submission to any trusted set; never framed as "Arkiv/Sourcify authors official descriptors."

### The eval that makes it defensible (bring ANSWERS to mid-August)
Regenerate the ~**372 curated registry descriptors** (ground truth) and measure — **bimodally** (standard vs long tail): **linter-pass**, **field-mapping exact-match**, **intent/label match**, **human-accept rate**, and the **DELTA over both the deterministic baselines AND the LLM incumbents.** Plus: **NatSpec prevalence** on the modern corpus, and a **Q3 smoke-test** (~20 contracts). Plus a **written Arkiv-vs-The-Graph-GRC-20 differentiation** for the store.

---

## Risks (ranked, post-audit)

1. **Concept is occupied (was #1 "first-mover"; now confirmed built):** LLM+Sourcify+NatSpec descriptor generation with a queryable store **already won a Ledger prize** (ClearSignKit, The Graph) and ships on npm (`hardhat-descriptor`). Arkiv's wedge is now *productionization + differentiation*, which is a weaker, harder story. **If Arkiv can't beat The Graph GRC-20 on the store, this is thin.**
2. **Pre-emption by Sourcify's own roadmap:** H2 ERC-7730 DSL + registry maintenance may overlap or supersede.
3. **Ledger's official Generator** (announced, 404 today) may ship and set the standard, backed by the spec author.
4. **Bimodal accuracy inversion:** strong where heuristics/incumbents already win; weak on the long tail where value is highest.
5. **Adversarial-input / hallucination safety:** linter cannot catch semantic deception; mitigated ONLY by never-authoritative + human-review + never-auto-submit, **enforced in code.**
6. **NatSpec prevalence** (~40% recent) → frequent raw-source inference, lower accuracy.
7. **Q3 quant quality** untested on structured output (Q4 won't fit) → smoke-test before scaling.
8. **Positioning/brand risk:** any "Arkiv/Sourcify generates official descriptors" framing is indefensible + a supply-chain vector.
9. **Opportunity cost:** this is the adjacent potential; the DB-migration north star is the main dish.

---

## Open questions to close (as decisions, not questions)

**For Pawel / Marcos (Arkiv):**
1. Given the space is occupied at POC level, is productionizing this the best use of Arkiv DevRel time, or a distraction from the DB-migration north star? Ship as an **Arkiv-branded candidate store** or an **open-source community tool that uses Arkiv**?
2. **Why Arkiv over The Graph GRC-20** for the queryable descriptor store? (ClearSignKit chose The Graph.) We need a real, statable answer before this goes to any external.
3. Confirm live ERC numbers/status (ERC-8176 attestation vs fallbacks) + queryability framing with the brand owner (Marcos/Alexey) before the one-pager.

**For the Sourcify CTO / Lea + Kaan (mid-August):**
4. Does your H2 ERC-7730 **DSL** plan overlap/conflict with an external candidate-generation layer? Do you want an external candidate store for the long tail, or does the auditor `clearsig`-baseline already cover you?
5. Registry policy: do PR submitters need proven affiliation with the contract owner, or can any party submit for any verified contract?

**For the team (measure on the DGX before quoting):**
6. Ledger's announced Generator status/model/data-source (404 today).
7. Actual NatSpec prevalence on the 38.5M corpus.
8. Token/address metadata (decimals, ticker, collection) — the LLM can't get it from the ABI → a post-process enrichment step (token list / on-chain).

---

## Bottom line for the decision

**GO WITH CONDITIONS — but the bar is higher after the audit.** The ecosystem has **validated the demand** (Ledger prized exactly this) and **already occupies the naive version at POC level, including the queryable-store angle on The Graph.** A defensible Arkiv project exists **only** as the **production, Sourcify-scale, open/local-generated, Arkiv-queryability-differentiated** version — and it must be able to **state why Arkiv beats The Graph GRC-20** and **prove a competitive generator** in a backtest. This stays the **adjacent potential**, not the main dish.

**Cheap de-risking to do before committing DGX time (a minimal POC = producing these answers):**
1. Confirm Ledger's official Generator status/data-source.
2. Backtest the DGX generator vs **both** the deterministic **and** the LLM incumbents on the ~372 curated descriptors (bimodal delta).
3. Measure NatSpec prevalence on the modern corpus.
4. Smoke-test Q3 structured output on the DGX.
5. Write the **Arkiv-vs-The-Graph-GRC-20** differentiation for the store.

A POC that produces those five answers is what turns the mid-August Sourcify CTO meeting from "here's an idea others already built" into "here's the measured delta, the safe architecture, and why Arkiv."

---

## Sources (fetched 2026-07-08)
- EIP-7730 (Draft, Standards Track ERC; created 2024-02-07; requires EIP-155/712) — https://eips.ethereum.org/EIPS/eip-7730
- Registry (co-stewarded w/ Sourcify): https://github.com/ethereum/clear-signing-erc7730-registry · `/auditors/README.md` · `/.github/workflows/pull_request.yml` · counts via git-tree API at commit `a2b33ffe` (2026-07-01)
- Ledger `python-erc7730` (deterministic generate, zero NatSpec): https://github.com/LedgerHQ/python-erc7730 · lint: https://ledgerhq.github.io/python-erc7730/pages/lint.html
- Ledger Generator announcement (2026-05-15); repo 404: https://www.ledger.com/blog-the-evolution-of-clear-signing · https://github.com/LedgerHQ/erc7730-generator (404)
- Cyfrin `clearsig` (Sourcify-fed, proxy-traversing): https://pypi.org/project/clearsig/
- **`hardhat-descriptor`** (Claude-based LLM generator, npm, +registry-PR): https://github.com/hangleang/hardhat-descriptor · https://registry.npmjs.org/hardhat-descriptor (v0.3.0, 2026-06-01)
- **ClearSignKit** (Sourcify+NatSpec+LLM, queryable store on The Graph GRC-20, Ledger 1st prize): https://ethglobal.com/showcase/clearsignkit-ffum9
- Clear-signing trust model (wallet-decides): https://clearsigning.org/overview/
- Sourcify H1-2026 recap (38.5M, published 2026-07-01; founding WG member; H2 DSL+registry): https://docs.sourcify.dev/blog/recap-2026-h1/ · launch: https://docs.sourcify.dev/blog/clear-signing-launch/ · formatter: https://github.com/sourcifyeth/clear-signing
- Sourcify v2 API: https://docs.sourcify.dev/docs/metadata/ · https://docs.sourcify.dev/blog/apiv2-lookup-endpoints/
- NatSpec prevalence: STAN 2020 arXiv:2007.09696 · codex live sample 2026-07-08 (150 contracts: 38.7%/45.3%)
- DGX Spark specs (128GB unified, up to 200B params): https://www.nvidia.com/en-us/products/workstations/dgx-spark/
- DeFi intent-mining analog (TIM: F1 1.00 method-name / ~0.29 custom) — bimodal-accuracy grounding
