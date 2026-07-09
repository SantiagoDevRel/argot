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

## Result (2026-07-09) — qwen3-coder-next, 211 calldata held-out, COMPLETE

**Headline (honest, not flattering): overall `erc7730 lint`-pass ≈ 20%, fnRecall ≈ 0.14.**
The registry is **96% bespoke/complex** contracts (203 of 211 are DeFi vaults, routers,
bridges with tuple/array params); the local qwen model produces a *valid* descriptor for
those only ~19% of the time. On the tiny pure-ERC-20/721 subset (n=8) it's ~50% lint-pass /
0.375 fnRecall. 17 of 211 also 404'd on Sourcify (not verified there).

> **Bucketing caveat:** a verb-based "standard" split is misleading here — `deposit`/`withdraw`/
> `mint`/`swap` verbs put complex ERC-4626 vaults and bridges in the "standard" bucket, inverting
> the numbers. Re-bucketing by *pure token methods only* (transfer/approve/…) gives the n=8 above.
> **The defensible headline is the OVERALL number, not a simple-vs-complex split.**

**What this means (the honest de-risking answer the POC was built to produce):** a small local
coder model is **not yet good enough** to auto-generate registry-quality ERC-7730 descriptors at
scale. That *strengthens* the real pitch — the value is Arkiv as the **queryable candidate store +
attestation-aware registry + human-reviewed candidate tier**, not "the LLM nails it." The levers to
move the number (next): **MiniMax-M2.5** (much stronger, offline), **few-shot** examples in the
prompt (the held-out set is ready), and better field-path handling for tuples/arrays.

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
