# Claude Design prompt — ERC-7730 × Arkiv POC ("Clear Signing Studio")

> 2026-07-08. Paste into Claude Design to generate the visual/interactive design; then implement it faithfully on the Next.js scaffold at `argot/erc7730-poc/`. The API contract (`/api/load`, `/api/generate`) and the pwd-`123` gate are locked, so the design won't change the plumbing.
> **Before any public publish:** share with Alexey (brand owner). Internal pitch first (Sourcify CTO on hold).

---

Design a single, self-contained, highly polished INTERACTIVE web app (React + Tailwind) — a gated internal demo called **"Arkiv × Sourcify — Clear Signing Studio"** (ERC-7730 clear-signing descriptors). It must feel like a premium Arkiv developer product: technical, clean, modern, with delightful micro-interactions. Top priority: visually beautiful + interactive. Desktop-first, responsive.

**BRAND SYSTEM (strict):**
- Colors: Arkiv Blue `#181EA9` (primary, structural, leads everything), Arkiv Orange `#FE7446` (the single "spark" accent — CTAs/highlights only, used sparingly), neutrals Ink (near-black), Sand (warm off-white), Stone (muted gray). Dark-first canvas (deep ink) with blue as the structural color and orange as the one spark. Ensure AA contrast everywhere.
- Type: IBM Plex Mono for headings, labels, data and code (technical/monospaced feel); a clean sans (Inter) for longer body text.
- Motion: smooth, purposeful micro-interactions; a subtle "wow", nothing gimmicky.
- Voice: developer-honest, concise. Use "Arkiv entities" (NEVER "records"), "the Web3 database", lead with queryability. NEVER imply Arkiv/Sourcify authors official descriptors — generated descriptors are CANDIDATE DRAFTS that each app reviews, adopts, and attests.

**GATE (entry):** a minimal unlock screen — one password field, "Enter access code to open the studio", accepts `123`, no username. After unlock, reveal the app with a soft transition.

**TOP BAR:** product name (left) + a segmented control with 3 tabs: Create · Database · How. Top-right: a status pill for the DGX model — "Model: idle" → "loading…" → "qwen3-coder-next · ready ✓".

**TAB 1 — CREATE** (the hero, two panels: INPUTS → [Generate] → OUTPUT with an animated flow between them):
- Contract selector at top: chain dropdown + address field + a few example quick-picks (e.g. "Uniswap V3 Router").
- A gated "Load model" button (requires the access code): on click, stream a progress log — "freeing GPU… pulling qwen3-coder-next (51GB)… warming… ready ✓" — with a progress bar. Only when ready does "Generate" enable.
- INPUTS panel = 5 expandable source chips labeled "from Sourcify": Identity (chainId 1 · 0x68b3…Fc45), ABI (42 functions), NatSpec (@notice + @param · partial), Source (8 files · ~120 KB), Proxy (not a proxy). PLUS a separate "enrichment" chip: Token decimals (USDC 6 · WETH 18 · resolved on-chain). Visually make clear that 5 chips come from Sourcify and decimals come from on-chain enrichment (not from the LLM).
- "Generate" → animate the input chips flowing into a central glowing "DGX" node → the OUTPUT panel reveals the ERC-7730 descriptor JSON with syntax highlighting (typewriter/reveal), a green "erc7730 lint ✓" stamp, per-field confidence badges (intent 92% · amountIn 98% · recipient 95%), and a "candidate · unattested" tag.
- Sample output:
```json
{
  "context": { "contract": { "deployments": [ { "chainId": 1, "address": "0x68b3…Fc45" } ] } },
  "metadata": { "owner": "Uniswap Labs" },
  "display": { "formats": {
    "swapExactTokensForTokens(uint256,uint256,address[],address)": {
      "intent": "Swap tokens on Uniswap",
      "fields": [
        { "path": "amountIn",     "label": "Amount to swap",   "format": "tokenAmount" },
        { "path": "amountOutMin", "label": "Minimum received", "format": "tokenAmount" },
        { "path": "to",           "label": "Recipient",        "format": "addressName" }
      ] } } }
}
```

**TAB 2 — DATABASE** (the queryability proof):
- Header: "Arkiv entities — the queryable clear-signing store."
- Toggle between Graph view and Table view.
  - Graph: nodes = descriptor entities linked to their contract + attester; hover highlights connections; candidate nodes = orange dashed, attested nodes = blue solid.
  - Table columns: Contract · Chain · Selector · Status (candidate/attested) · Attester · Confidence.
- Filter row: Status (Candidate | Attested) · Chain (dropdown) · search by address — with live filtering.
- Small caption: "Lead with queryability — lookups a flat registry can't do: by attester, coverage gaps, stale bindings." Include ~6–8 realistic rows/nodes (mix of candidate + attested, a few chains).

**TAB 3 — HOW** (architecture one-pager, clean + visual):
- A horizontal animated flow, 6 stages with icons + short labels: Sourcify (verified ABI + NatSpec + source) → DGX · qwen3-coder-next (local/offline) → erc7730 lint (hard gate) → Arkiv entity (candidate · queryable) → App owner reviews + adopts → Attestation → trusted → wallet clear-signs.
- Below: three short "why" cards — Queryable (Arkiv = the Web3 database) · Candidate-first & safe (never authoritative; the owner adopts + attests; nothing auto-submitted) · Local (generated offline on the DGX, linter-gated).

**DELIVERABLE:** one self-contained interactive React component, no load-bearing external CDNs, realistic placeholder data as above, smooth tab transitions and generate/load animations.
