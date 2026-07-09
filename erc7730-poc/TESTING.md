# How to test Clear Signing Studio (live demo walkthrough)

**URL:** https://arkiv-sourcify.vercel.app · **Access code:** `123` (no username)

The app is a gated internal demo: it drafts a **candidate** ERC-7730 clear-signing descriptor
from a Sourcify-verified contract (live, on the DGX), stores descriptors as **queryable Arkiv
entities**, and shows why a queryable store beats a flat registry. Everything a wallet would
trust is a **candidate the dApp owner reviews/attests** — nothing here is authoritative.

## 0. Open the gate
Go to the URL → you land on a password screen → type **`123`** → "Open the studio". (The gate is
server-side: without the code you can't see the app or reach the DGX.)

## 1. CREATE tab — generate a descriptor live (the hero flow)
This is where the DGX actually runs.

1. **Pick a contract.** Either click an **EXAMPLE** chip (Uniswap / Aave / Lido) or paste a
   contract address in the box. Keep the chain on **Ethereum** for the examples below.
2. **Load the model.** Click **"Load model"** → a small box asks for the code → type **`123`** →
   press →. The DGX **frees the GPU** (pauses other work) and **warms qwen3-coder-next** — the log
   shows real steps ("freeing GPU · comfy-pause · ok … ready ✓ · <ms>"). Wait for the pill top-right
   to read **"qwen3-coder-next · ready ✓"** (~30–40s the first time). *This always works even if the
   DGX is busy with something else — that's the point of the free-then-warm step.*
3. **Generate.** Click the orange **"Generate"** button. It fetches the contract's Sourcify inputs,
   runs the model, and gates the output on `erc7730 lint`. After ~15–60s the **OUTPUT** panel fills
   with the **real descriptor JSON**, a green **`erc7730 lint ✓`** badge, per-field **confidence**
   bars, and a **`candidate · unattested`** tag. **Copy JSON** copies it.
4. Try **"Regenerate"** or a different contract to see it re-run.

**Contracts that generate cleanly (good for a demo):**
- WETH — `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`
- DAI — `0x6B175474E89094C44Da98b954EedeAC495271d0F`
- USDC — `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (a proxy — watch it bind to the implementation)
- 1inch Router V5 — `0x1111111254EEB25477B68fb85Ed929f73A960582` (complex struct params)

> **Honest note for the meeting:** simple contracts lint-pass reliably; complex bespoke ones
> (obscure routers/vaults) sometimes fail the structural gate and show `erc7730 lint ✗ — draft
> rejected`. That's expected and by design — the linter refuses malformed drafts, and the whole
> point is that these are **candidates for human review**, not authoritative descriptors.

## 2. DATABASE tab — the queryability proof
Click **DATABASE**. This is the "why Arkiv" story: the descriptors are **live Arkiv entities**
(green **"live · Braga"** badge; they were written on-chain, not mocked).
- Toggle **Graph** / **Table**.
- Filter by **status** (Candidate / Attested), **chain**, or type in the search box.
- In the graph, hover a contract / entity / attester node to see the connections a flat registry
  can't show: descriptors by attester, coverage across chains, candidate vs attested.

## 3. HOW tab — the architecture one-pager
Click **HOW** for the 6-stage pipeline (Sourcify → DGX → erc7730 lint → Arkiv entity → owner
adopts → attestation) + the "why it matters" cards. Use this to explain the flow to a stakeholder.

## What to say / not say
- **Lead with queryability** ("the Web3 database"), **"Arkiv entities"** (not "records").
- Descriptors are **always candidate drafts** — "each app reviews, adopts, and attests; nothing is
  auto-submitted to the official registry." Never frame it as "Arkiv/Sourcify generates official
  descriptors."
- Don't publish Arkiv's internal timeline.

## If something looks off
- **Gate loops / can't get in:** the code is exactly `123`. Cookie lasts 7 days.
- **"Load model" spins forever:** the DGX may be down. Check `https://arkiv-dgx.santiagodevrel.dev/health`
  → should return `{"ok":true,…}`. If not, the wrapper service needs a restart (`systemctl --user
  restart dgx-wrapper` on the DGX).
- **Database shows "seed" instead of "live · Braga":** the Braga testnet was unreachable; the tab
  falls back to the seed set (same shape) so the demo still works.
