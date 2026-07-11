# ERC-7730 backtest — the credibility number

The eval that turns the mid-August Sourcify CTO meeting from *"here's an idea others
already built"* into *"here's the measured delta, the safe architecture, and why Arkiv."*
It **regenerates** the hand-written registry descriptors from their contracts and measures
how close a DGX-generated candidate gets — **bimodally** (standard vs long-tail) and vs
baselines.

> It is a **BENCHMARK, not training.** Few-shot examples are held **out** of the test set
> (`corpus.mjs`), so no contract used as a prompt example is ever scored → no data leakage.

## Ground truth

`ethereum/clear-signing-erc7730-registry` @ `a2b33ffe` — **367 production descriptors**
(247 calldata + 120 eip712), excluding `tests/` + `testsv2/`. Many factor their
`display.formats` into a shared `common-*.json` via `includes`; the loader resolves those
(→ **1124 function/message formats** total). Bucketing (majority of a descriptor's
functions being well-known token/standard verbs) → **~202 standard / ~165 long-tail**.

```bash
# 1. clone the registry once (shallow)
git clone --depth 1 https://github.com/ethereum/clear-signing-erc7730-registry.git \
  ~/Downloads/clear-signing-erc7730-registry

# 2. build the corpus manifest + few-shot / held-out split
node eval/corpus.mjs                 # → eval/corpus.json  (REGISTRY_DIR overridable)
```

## Metrics (`metrics.mjs`, self-tested)

Per held-out descriptor, matching generated functions to ground truth by name:

- **linter-pass** — did `erc7730 lint` accept the generated draft (the hard structural gate;
  runs in the DGX wrapper). Malformed drafts score 0 and are never surfaced.
- **fnRecall** — fraction of ground-truth functions the generator produced.
- **fieldExactMatch** — fraction of ground-truth fields whose `path` is present **and**
  `format` matches (the strict field-mapping metric).
- **intentMatch** — token-Jaccard of the generated vs ground-truth intent string (offline
  proxy; the DGX run can add Qwen3-Embedding cosine for a semantic number).
- **formatExact** — format agreement over matched paths.

```bash
node eval/metrics.mjs                 # self-test → PASS
```

## Run the backtest

```bash
node eval/run-eval.mjs --gen mock                 # pipeline check, no model (validates scoring)
node eval/run-eval.mjs --gen dgx --model qwen3-coder-next:q4_K_M   # LIVE (needs the DGX wrapper)
node eval/run-eval.mjs --gen dgx --model minimax-m2.5              # max-quality offline number
```

`--gen dgx` POSTs each contract to the **DGX wrapper** (`DGX_URL` + `DGX_BEARER`), which
fetches the Sourcify v2 inputs, runs the model schema-constrained, gates on `erc7730 lint`,
and returns the descriptor JSON. Output → `eval/report-<gen>.json` + a bimodal summary:

```
  ALL        n=…  lint=…%  fnRecall=…  fieldExact=…  intent=…  format=…
  standard   n=…  …
  long-tail  n=…  …
```

### Baselines (the DELTA that matters)

Beating a blank page proves nothing; the market question is beating the incumbents. Run the
same corpus through each baseline (offline on the DGX) and diff the report:

| Baseline | Kind | How |
|---|---|---|
| `erc7730 generate` | deterministic (Ledger) | `python-erc7730`, ABI → placeholder labels, no NatSpec |
| `clearsig generate` | deterministic (Cyfrin) | Sourcify-fed, proxy-traversing |
| `hardhat-descriptor` | LLM incumbent (Claude, cloud) | npm plugin, compiled artifacts → LLM intents |

Each becomes a `--gen <baseline>` adapter (a thin wrapper that shells the tool per contract
and returns the descriptor JSON). The report then shows Arkiv/DGX **delta vs both the
deterministic and the LLM incumbents**, bimodally.

## NatSpec prevalence (the prerequisite measurement)

```bash
node eval/natspec-prevalence.mjs 150     # sample; scale offline on the DGX
```

⚠️ **Selection bias to state out loud:** measured on the *corpus* deployments (contracts that
already earned a hand-written descriptor) NatSpec is high (~95% @notice on a 30-sample). But
those are curated/well-documented by construction. The real long-tail — *random* verified
contracts — is ~39% @notice / ~45% @param (assessment's 150-contract sample). The headline
accuracy is bounded by the *long-tail* prevalence, not the corpus's.

## Files

| File | What |
|---|---|
| `corpus.mjs` | load 367 descriptors, resolve `includes`, bucket, few-shot/held-out split → `corpus.json` |
| `extract.mjs` | descriptor JSON → scored feature shape (shared, so generated == ground-truth parsing) |
| `metrics.mjs` | field/intent/format scoring (self-tested) |
| `run-eval.mjs` | orchestrator: `--gen mock\|dgx\|<baseline>` → bimodal report + deltas |
| `natspec-prevalence.mjs` | Sourcify v2 @notice/@param prevalence sampler |

## Scope — calldata only

The DGX wrapper is a **calldata** descriptor generator (it drafts `display.formats` for a
contract's functions from the ABI). **eip712** descriptors describe signed typed-data messages
— a different generation task — so the benchmark runs the **247 calldata** ground-truth
descriptors only (eip712 is out of scope for this generator, not a failure).

## Result (2026-07-11) — model sweep + deterministic baseline (supersedes the 2026-07-09 run)

**The headline:** a robust, locally-served model — **`gpt-oss:120b`** (65 GB, Ollama) —
reaches **82% lint-pass / 0.594 fnRecall / 0.325 fieldExact / 0.204 intent** over the **full
n=60** held-out sample, **beating the deterministic incumbent, the live model, and MiniMax's
fragile partial — with zero crashes.** This replaces the earlier "MiniMax 87% but only over
~15 survivors before OOM" story with a real, complete number from a model that finishes the
batch on this single-GPU box.

### Full head-to-head (n=60, identical held-out calldata contracts, deterministic shuffle)
| Generator | lint-pass | fnRecall | fieldExact (onHit) | intent (onHit) | robust? |
|---|---|---|---|---|---|
| **`gpt-oss:120b`** ⭐ | **82%** | **0.594** | **0.325 (0.427)** | **0.204 (0.256)** | ✅ full 60, no crash |
| `erc7730 generate` (Ledger, deterministic) | 60% | 0.497 | 0.211 (0.212) | **0.000** | ✅ |
| `qwen3-coder-next` (the LIVE app model) | 50% | 0.372 | 0.082 (0.09) | 0.124 (0.128) | ✅ |
| `qwen3.5:122b-a10b` (general MoE) | 20% | 0.155 | 0.047 | 0.030 | ✅ but weak at schema JSON |
| `hybrid` (deterministic skeleton + qwen intent) | 18% | 0.097 | 0.006 | 0.009 | ⚠️ see limitation below |

`gpt-oss:120b` bimodal: **standard 91% lint / 0.687 fnRecall / 0.494 fieldExact**;
**long-tail 70% lint / 0.481 fnRecall / 0.118 fieldExact**.

### The honest reframe (what the deterministic baseline taught us)
The deterministic Ledger `erc7730 generate` (**60% lint / 0.497 fnRecall / 0.211 fieldExact**)
**beats the live qwen-coder on every STRUCTURAL metric** — it reads paths/types straight from
the ABI and never hallucinates them. Its one gap: it produces **zero intent** (a deterministic
tool structurally can't say *what* a call does). So the LLM's value was never structural
accuracy — it's **semantic intent**. The winning move is a model strong enough to beat the
deterministic structure *and* add intent: `gpt-oss:120b` does exactly that (its fieldExact
0.325 already exceeds the deterministic 0.211, and it adds intent 0.204).

> **Baseline path-normalization (documented, fair):** the registry writes calldata paths
> **bare** (`desc.amount`); `erc7730 generate` emits the `#.`/`@.` root-selector form. Those
> are the same reference — `baseline-erc7730.mjs` strips the selector for **scoring only**
> (else the deterministic baseline scores ~0 on fieldExact from a prefix mismatch, unfairly
> flattering our model). The linted descriptor keeps the selector the linter requires.

### The hybrid: explored, dominated, deprioritized
Hypothesis: graft the deterministic skeleton's structure onto LLM intent. It **underperforms
(18%)** because `erc7730 generate` emits **`nested_fields`** for tuple/struct params, and the
flat merge/normalize adds an illegal `format` to those container fields → *"Extra inputs are
not permitted"* on the tuple-heavy long tail (96% of the corpus). It's fixable with a
nested-field-aware merge, but **architecturally dominated**: its ceiling is its own
deterministic skeleton (60%), which `gpt-oss:120b` (82%) already exceeds — so it can't change
the recommendation. Kept in the repo (`hybrid-erc7730.mjs`) as an explored adapter with this
documented limitation.

### Coverage at scale (Lever D) + distillation dataset (Lever B groundwork)
- **101** `gpt-oss:120b` lint-passing candidate descriptors harvested over recent verified
  Sourcify mainnet contracts (58.7% pass-rate on the heterogeneous long tail vs 82% on the
  curated registry) and written to **Arkiv Braga in one `mutateEntities` tx**
  (`0x673bca20e026a20aac447b2eda2774eb86fa51c57df319ed3be7d879a81c70c5`, dataset
  `erc7730-harvest`) — **12.6× the 8 curated demo entities**, all queryable, all `candidate`
  / `attested:false`. Pipeline: `scripts/harvest.mjs` (DGX) → `scripts/arkiv-harvest-seed.mjs`
  (laptop, funded burner). The curated demo dataset (`erc7730-poc`) is untouched.
- Those same 101 rows carry **SFT `{system,user,assistant}` pairs** = a distillation dataset
  ready for QLoRA. codex validated the recipe (Qwen2.5-Coder-7B LoRA on GB10, ~30-90 min via
  the NVIDIA Unsloth-on-Spark playbook); the **fine-tune itself is deferred** — the ARM64 env
  setup risk on an unattended box, plus a 7B's low ceiling vs the 82% `gpt-oss:120b` headline,
  didn't justify it tonight. Dataset + recipe are ready to run deliberately.

### How to reproduce
```bash
# on the DGX (wrapper live, models pulled): the model sweep
node run-eval.mjs --gen dgx --model gpt-oss:120b --limit 60
node baseline-erc7730.mjs --limit 60            # deterministic Ledger baseline (CPU, no GPU)
node hybrid-erc7730.mjs --model qwen3-coder-next:q4_K_M --limit 60   # explored hybrid
```

---

## Result (2026-07-09) — prior run (superseded by the sweep above)

### Head-to-head (same representative sample, post-tuning)
| Model | lint-pass | fnRecall | fieldOnHit | Notes |
|---|---|---|---|---|
| **qwen3-coder-next** (n=60, full) | **48%** | 0.34 | 0.08 | stable — completes batches; the LIVE app model |
| **MiniMax-M2.5** (n=15 before crash) | **87%** | 0.67 | 0.35 | notably higher quality, BUT the 101GB server **crashed on a heavy prompt at ~contract 15** and couldn't finish |

**Read:** a stronger model roughly **doubles** valid-draft rate and fnRecall — the concept scales with
model quality. But MiniMax-M2.5 at Q3/101GB is **operationally fragile on this single-GPU box** (crashes
mid-batch on the largest prompts; the memory note `reference_dgx_bigmodel_load_oom` warns it can freeze
the box). Production would need a more robust serving setup (smaller quant, prompt chunking, or
crash-recovery), not a bigger claim. The **live app runs qwen** (stable). MiniMax is an offline
quality-ceiling probe.

### After tuning — qwen3-coder-next, 60-contract representative sample
**`erc7730 lint`-pass ≈ 48%, fnRecall ≈ 0.34** (up from 20% / 0.14 pre-tuning — a 2.4× jump).
The fix that moved it: the model kept writing array paths as `foo[]` instead of the
ERC-7730-required `foo.[]`, which the linter rejects — a **deterministic path normalization**
(`foo[` → `foo.[`) + struct/array path guidance + a tuple few-shot in the prompt fixed a whole
class of failures (1inch V5, Aave gateway, etc. now pass). On the correctly-bucketed long-tail
bespoke contracts (n=27) it reaches **82% lint-pass / 0.53 fnRecall**. The `standard` bucket
number stays low ONLY because the verb-based bucket mislabels complex ERC-4626 vaults as
"standard" (see caveat below) — the OVERALL 48% is the honest headline.

### Pre-tuning baseline — qwen3-coder-next, 211 calldata held-out (full)
**overall lint-pass ≈ 20%, fnRecall ≈ 0.14** — the "before" number, kept for the delta.
The registry is 96% bespoke/complex (DeFi vaults/routers/bridges with tuple/array params);
17 of 211 also 404'd on Sourcify.

> **Bucketing caveat:** a verb-based "standard" split is misleading here — `deposit`/`withdraw`/
> `mint`/`swap` verbs put complex ERC-4626 vaults and bridges in the "standard" bucket, inverting
> the numbers. Re-bucketing by *pure token methods only* (transfer/approve/…) gives the n=8 above.
> **The defensible headline is the OVERALL number, not a simple-vs-complex split.**

**What this means (the honest de-risking answer the POC was built to produce):** with proper ERC-7730
tooling (deterministic path/format normalization + a targeted prompt), a **small local coder model
gets to ~48% valid-draft on a hard, representative sample** — good enough to seed candidates for the
simpler majority, not good enough to trust unreviewed. That fits the pitch exactly: the value is
Arkiv as the **queryable candidate store + attestation-aware registry + human-reviewed candidate
tier**, with the LLM as a **coverage seeder**, never authoritative. Remaining levers: **MiniMax-M2.5**
(stronger model, running), more few-shot, and better handling of deeply-nested tuple/array params.

## How the batch ran

Corpus + metrics + pipeline built and verified; ran as an offline batch on the DGX
(checkpointing every 10 to `report-dgx.json`). Interim/shape notes:
- **Lint-pass is bimodal.** Simple/standard contracts (ERC-20s, single-token, plain functions)
  lint-pass reliably; complex bespoke long-tail (routers with tuple/array params, `MarketAllocation[]`,
  aggregation routers) frequently fail the structural gate — exactly the assessment's predicted
  "strong on standard, weak on the bespoke long tail." A draft that fails `erc7730 lint` scores 0
  (never surfaced), so the reported quality is over *adoptable* drafts.
- **Coverage (fnRecall) is low on the long tail** — the local qwen3-coder-next often describes a
  different subset of functions than the hand-written registry chose. This is the real gap a
  bigger model (MiniMax-M2.5, run offline next) + few-shot tuning would move. **Do not oversell
  the number; the honest story is "valid drafts for the simple majority, human review for the tail."**

**Gotcha fixed (codex audit):** the wrapper returns `descriptor` as a JSON *string*; the eval must
`JSON.parse` it before feature extraction, or every result scores empty (`fnRecall=0`). Fixed in
`dgxGenerate`. Also: score by name (overloads can collide — a known limitation), and the test set is
deterministically shuffled so a `--limit`/interrupted-run sample is representative, not alphabetical.

**Still to run (offline, next):** MiniMax-M2.5 for the max-quality number, and the deterministic +
LLM baselines (`erc7730 generate`, `clearsig`, `hardhat-descriptor`) for the delta story.
