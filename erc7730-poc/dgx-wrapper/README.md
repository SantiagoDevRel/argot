# DGX wrapper — the live generation path for the gated POC

A thin, bearer-gated Node service that runs **on the DGX** and is the **only** thing exposed
publicly (Ollama stays on `127.0.0.1`). Vercel's `/api/load` + `/api/generate` proxy to it
through the existing Cloudflare tunnel. This is a **sanctioned exception** to the
"DGX-not-in-the-public-request-path" rule — scoped to this pwd-`123`-gated demo only, never
public SLA traffic.

```
 browser (gated 123)
   │  POST /api/load · /api/generate     (cookie-gated by proxy.ts)
   ▼
 Vercel serverless  ── Authorization: Bearer $DGX_BEARER ──►  Cloudflare tunnel (outbound-only)
                                                                  │  arkiv-dgx.santiagodevrel.dev
                                                                  ▼
                                                        dgx-wrapper (127.0.0.1:9010)
                                                          ├─ /load     → Ollama warm (qwen3-coder-next)
                                                          └─ /generate → Sourcify v2 → Ollama (JSON)
                                                                          → eth_call decimals()
                                                                          → erc7730 lint (HARD GATE)
```

## Endpoint contract (identical to the Vercel mock, so going live is a swap)

| Route | Body | Returns |
|---|---|---|
| `POST /load` | `{ model? }` | `{ model, ready, steps[] }` |
| `POST /generate` | `{ chainId, address, model? }` | `{ descriptor, confidence[], lintPassed, inputs[], status:"candidate", attested:false }` |
| `GET /health` | — | `{ ok, model }` (no bearer) |

All routes except `/health` require `Authorization: Bearer <WRAPPER_BEARER>` (timing-safe).

## Hard rules baked in

- Output is **always** a candidate draft (`status:"candidate"`, `attested:false`). Never auto-submitted, never auto-attested.
- **Token decimals** come from a deterministic on-chain `eth_call` to `decimals()`, **never** the model.
- `erc7730 lint` is the **hard gate**: a draft that fails lint returns `lintPassed:false`; the app never presents a malformed draft as adoptable.

## Run on the DGX

Prereqs: Node ≥20, Ollama serving `qwen3-coder-next:q4_K_M`, and `python-erc7730` (`pipx install erc7730`, the CLI on PATH).

```bash
# copy this folder to the DGX (e.g. ~/dgx-wrapper), then:
export WRAPPER_BEARER="$(cat /path/to/dgx-wrapper-bearer.txt)"   # from laptop .secrets/
export DGX_MODEL="qwen3-coder-next:q4_K_M"
export ERC7730_BIN="erc7730"
node server.mjs                # listens on 127.0.0.1:9010
```

Or as a systemd service — see `dgx-wrapper.service` (set `WRAPPER_BEARER` in an env file
`~/dgx-wrapper/env`, chmod 600, never committed).

## Expose via the existing Cloudflare tunnel (reuse `dgx-mcp`)

The `dgx-mcp` tunnel (`c03b6e0a-8e08-4019-b997-cc066957d648`, zone `santiagodevrel.dev`) is
already outbound-only on the DGX. Add ONE ingress rule + ONE DNS CNAME via the CF API
(token in laptop `.secrets/cloudflare-api-token.txt`), no manual dashboard steps:

1. **Ingress** (tunnel config, prepend before the catch-all `http_status:404`):
   `{ "hostname": "arkiv-dgx.santiagodevrel.dev", "service": "http://127.0.0.1:9010" }`
2. **DNS**: `CNAME arkiv-dgx → c03b6e0a-8e08-4019-b997-cc066957d648.cfargotunnel.com` (proxied).
3. Wait ~10–15 min for the Universal SSL cert on a fresh hostname (TLS fails until then — not a misconfig).

Verify: `curl https://arkiv-dgx.santiagodevrel.dev/health` → `{ "ok": true, … }`.

## Wire Vercel (the swap to live)

Once `/health` is green, set the two envs on the Vercel project and redeploy:

```bash
vercel env add DGX_URL production      # https://arkiv-dgx.santiagodevrel.dev
vercel env add DGX_BEARER production   # contents of .secrets/dgx-wrapper-bearer.txt
vercel deploy --prod --yes
```

`lib/dgx.ts` flips to live automatically when `DGX_URL` is present (`dgxConfigured()`); with
it unset the app stays in the safe demo/mock mode. **Bearer + URL live only in Vercel env,
never in the repo or the client bundle.**

## Status — LIVE (2026-07-09)

Running on the DGX as a **systemd user service** (`dgx-wrapper.service`, lingering enabled →
survives reboot), exposed at **https://arkiv-dgx.santiagodevrel.dev** via the `dgx-mcp`
Cloudflare tunnel. Verified end-to-end from production: `/health` ok, bearer enforced (401
without), `/load` frees the GPU + warms qwen3-coder-next (~30s), `/generate` produces
lint-passing candidate descriptors (WETH/USDC/DAI ✓, proxy resolution ✓). Vercel is wired
live (`DGX_URL` + `DGX_BEARER` set) — the browser flow load→generate shows the real descriptor.

**Hardening applied** (from the codex + llm-app-security audits): timing-safe bearer (was
already), **concurrency caps** (1 load / 2 generate → 429), **model allowlist**, **256 KB body
cap**, absolute binary paths, temp-dir cleanup, redacted error/lint output to the client,
`chainId` validation, and a **fail-closed `GATE_TOKEN`** in prod. Residual (accepted for a
gated demo): no Cloudflare Access layer, and the linter validates structure not semantic
truth (hence descriptors are always `candidate`, owner-reviewed).
