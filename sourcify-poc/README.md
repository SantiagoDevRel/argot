# sourcify-poc — Sourcify's read path, served from Arkiv

A working proof of concept: one complete Sourcify chain lives in Arkiv entities on the
Cheesecake devnet, and Sourcify's hottest endpoint is answered from there instead of from
Postgres — with a live parity diff against the real sourcify.dev that is allowed to fail.

Companion: [`../sourcify-explainer`](../sourcify-explainer) explains the data model, the
limits and the scope. This folder is the thing that runs.

---

## What is real here

| | |
|---|---|
| Source data | live `sourcify.dev/server/v2`, chain **130 (Unichain)**, all **2,988** contracts |
| Target | **Arkiv Cheesecake devnet**, chain `7733102`, `https://rpc.cheesecake.db-chain.devnet.gobas.me` |
| SDK | `@arkiv-network/sdk@0.8.0-advanced.2` — the version carrying the new frozen contract (typed attributes). `0.7.0` is the old string/numeric shape and will not do. |
| Entity types | `verified_contract` (25 typed attributes) and `compilation` (deduplicated, referenced by a `key` attribute) |
| Not stored on-chain | sources, bytecode, stdJsonOutput — see *The size wall* below |

## What is deliberately NOT here

- **Compilation and bytecode matching.** That is Sourcify's verifier. The question this POC
  answers is whether Arkiv can be the *database* behind it, not whether we can rewrite it.
- **`POST /v2/verify`.** The migration plan is dual-write behind the existing verifier.
- **The 4-byte signature service.** Separate service, separate traffic.
- **Permanence.** Entities are written with a 30-day lifetime. That is a product question.

---

## The size wall

Measured on 19 Aug 2026 over real Unichain contracts. `MAX_PAYLOAD_BYTES` is **131,072**.

| what | median bytes | vs the limit |
|---|---:|---|
| minimal lookup response | 192 | 0.1% |
| our index payload (ABI + compilation + deployment) | 10,130 | 7.7% |
| metadata alone | 32,295 | 25% |
| sources alone | 306,979 | **2.3× over** |
| `fields=all` | 958,252 | **7.3× over** |

So the split between an on-chain index and a content-addressed blob tier is not a design
preference — the protocol enforces it. And even without the limit, calldata costs 16 gas per
byte against a 36,000,000 block, so one full record is 42% of a block.

---

## Running it

### 1. Fetch (resumable, ~25 min for a full chain)

```bash
cd etl
npm install
CHAIN=130 DELAY_MS=100 node 1-fetch.mjs
```

Two passes: the cursor-paginated list, then one field-scoped detail call per contract.
Both append and skip what is already on disk, so a killed run costs one request.

### 2. Transform

```bash
node 2-transform.mjs
```

Prints the attribute budget, the payload size distribution and how many records would exceed
`MAX_PAYLOAD_BYTES`. Fails loudly rather than truncating silently.

### 3. Write — dry run first

```bash
node 3-write.mjs                 # encodes only, ZERO RPC calls, reports exact gas
node 3-write.mjs --send          # broadcasts
```

The dry run uses `client.advanced.buildMutation`, which encodes a batch locally. That is how
the gas figures above were produced without spending anything — and it matters, because the
anonymous RPC budget on this devnet is **50 requests per hour**.

Batches are packed by encoded bytes rather than by count, capped so no single transaction
exceeds roughly 18% of a block.

### 4. Serve

```bash
npm install
npm run dev      # http://localhost:3011/?pw=123
```

---

## Environment

`.env.local` (gitignored, and excluded from deploys by the deny-all `.vercelignore`):

```
ARKIV_RPC=https://rpc.cheesecake.db-chain.devnet.gobas.me
ARKIV_CHAIN_ID=7733102
ARKIV_PRIVATE_KEY=0x…        # needs GLM from the internal faucet
ARKIV_API_KEY=…              # from devnet.hub.arkiv.network/api-keys — see below
ARKIV_PUBLISHER=0x…          # only entities owned by this address are trusted
GATE_TOKEN=…                 # generated; the gate fails closed without it
GATE_PASSWORD=123
```

### You will need two things from the Arkiv side

1. **GLM on Cheesecake.** `https://internal-faucet.cheesecake.db-chain.devnet.gobas.me/` —
   password lives in Passbolt. Nothing carries over between networks: every network gets its
   own faucet, indexer and Bouncer, so Braga and FLAN keys are dead here.
2. **An API key.** `https://devnet.hub.arkiv.network/api-keys`, one key per connected wallet.
   Without it reads are metered at 50/hour per IP, which a single page-load of this app
   exhausts. The key is server-side only — the browser talks to our routes, our routes talk
   to Arkiv.

---

## Endpoints

| route | what it is |
|---|---|
| `GET /api/v2/contract/{chainId}/{address}` | Sourcify v2's hottest endpoint (~70% of contract traffic), answered from Arkiv. Supports `fields` and `omit`. Response headers carry the entity key, owner, read block and the literal query. |
| `GET /api/parity?chainId=&address=` | Asks both databases and diffs them field by field. Verdict is one of `identical` / `mismatch` / `not_in_arkiv` / `not_in_sourcify`. |
| `GET /api/query?...` | The filters Sourcify's public API does not expose: proxy status, compiler version prefix, function-count ranges, optimizer settings. Returns the literal Arkiv query it ran. |
| `GET /api/stats` | What is actually in Arkiv now, counted by walking every page. |

---

## Things that will bite you

- **Server-side ordering does not exist.** The SDK marks `orderBy` deprecated in as many
  words: *"not supported by the network"*. Anything sorted is sorted in JavaScript after the
  fetch. This is what blocks the listing endpoint (`/v2/contracts/{chain}?sort=`), not the
  lookup.
- **Pages cap at 200** (`MAX_LIMIT`). Counting anything means walking pages.
- **String attributes cap at 128 bytes.** `fullyQualifiedName` can exceed that on deeply
  nested paths; the transform truncates visibly and reports how many it touched.
- **32 attributes max.** We use 25. Every new filter costs one.
- **Anyone can write entities claiming to be Sourcify.** Authenticity is
  `owner == ARKIV_PUBLISHER` plus the `ds=sourcify` marker, checked on read. A consumer that
  skips the owner check is trusting a public write surface.
- **`buildMutation` is on the wallet client only**, not the public client.
