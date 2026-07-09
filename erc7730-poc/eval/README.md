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

## Status (2026-07-08)

Corpus + metrics + pipeline **built and verified locally** (mock generator end-to-end;
metrics self-test PASS; NatSpec sample run). The **live DGX generation + baseline runs are
DEFERRED** until the GPU is free — they are offline batch jobs (the right use of a 1-GPU box;
never an SLA). Running them fills in the real numbers with zero code changes.
