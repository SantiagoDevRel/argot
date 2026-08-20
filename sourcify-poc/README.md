# sourcify-poc — Sourcify's read path, served from Arkiv

A working proof of concept: one complete Sourcify chain lives in Arkiv entities on the
Cheesecake devnet, and Sourcify's most-used endpoint is answered from there instead of from
Postgres — with a live parity diff against the real sourcify.dev that is allowed to fail.

Companion: [`../sourcify-explainer`](../sourcify-explainer) explains the data model, the
limits and the scope. This folder is the thing that runs.

---

## What is real here

| | |
|---|---|
| Source data | live `sourcify.dev/server/v2`, chain **130 (Unichain)**, all **2,801** verified contracts |
| Target | **Arkiv Cheesecake devnet**, chain `7733102`, `https://rpc.cheesecake.db-chain.devnet.gobas.me` |
| SDK | `@arkiv-network/sdk@0.8.0-advanced.2` — the version carrying the new frozen contract (typed attributes). `0.7.0` is the old string/numeric shape and will not do. |
| Entity types | `verified_contract` (25 typed attributes), `compilation` (deduplicated, referenced by a `key` attribute), `signature` (one per 4-byte selector), and `sourcefile` (one per unique source file, deduplicated by sha256) |
| Written | 2,801 contracts + 1,127 compilations + 12,674 selectors in **568 transactions**, two-month lifetime — measured before `sourcefile` existed, so that count does not include it yet |
| Not stored on-chain | bytecode, stdJsonOutput, full metadata — see *The size wall* below. Source FILES are, one small entity per unique hash; a full sources BUNDLE embedded in one payload still is not (over the limit by ~2.3×) |

## Also in scope, after a rethink

- **The 4-byte signature service.** It was set aside as "a separate service" and that was wrong: selector
  resolution is a pure key-value lookup with an 86-byte median payload, which is the shape this database is
  best at. Sourcify's whole 9.9M-row dictionary would be about 1.0 GB of payload, against 484 GB for the
  contract index.
- **Permanence, as a cost rather than a shrug.** Entities carry a two-month lifetime. Extending one was
  measured at **10,000 gas**, so keeping 50M entities alive is roughly 47 hours a year of full block
  utilisation, forever. What is still unanswered is who holds the key that does the extending.

## What is deliberately NOT here

- **Compilation and bytecode matching.** That is Sourcify's verifier. The question this POC
  answers is whether Arkiv can be the *database* behind it, not whether we can rewrite it.
- **`POST /v2/verify`.** The migration plan is dual-write behind the existing verifier.

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
preference — the protocol enforces it. And the limit is on the **whole transaction**, not just
the payload: the node rejects anything over 131,072 bytes with `oversized data: transaction
size N, limit 131072`, so payload, attribute encoding and envelope share one budget.

**One consequence worth spelling out: a whole sources BUNDLE does not fit, but individual
source FILES do.** `2-transform.mjs` hashes every file in `sources` with sha256 and writes
one small `sourcefile` entity per unique hash — deduplicated across the whole run, so a file
like OpenZeppelin's `ERC20.sol`, which shows up in a large fraction of all verified contracts,
exists on-chain exactly once. The `compilation` entity carries a `path -> hash` map in its
payload (small — a few hundred bytes even for a multi-file contract) instead of embedding
any file body, the same way Sourcify's own `compiled_contracts.sources` references into its
deduplicated `sources` table.

Real gas is roughly **80 per calldata byte**, not the 16 the EVM charges for calldata alone —
Arkiv prices entity storage on top. Sizing batches on 16 builds transactions that exceed the
block limit and revert.

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
`sources` is one of the requested fields — see *The size wall* above for why that is safe
even though a whole sources bundle does not fit on-chain.

### 2. Transform

```bash
node 2-transform.mjs
```

Prints the attribute budget, the payload size distribution and how many records would exceed
`MAX_PAYLOAD_BYTES`. Fails loudly rather than truncating silently. The mapping logic itself
(`transformRows`) is a pure function importable without touching the filesystem — see
`2-transform.test.mjs`, exercised against 3 real fixtures in `etl/fixtures/`:

```bash
npm test        # from etl/, runs `node --test`
```

### 3. Write — dry run first

```bash
node 3-write.mjs                 # encodes only, ZERO RPC calls, reports exact gas
node 3-write.mjs --send          # broadcasts
```

The dry run uses `client.advanced.buildMutation`, which encodes a batch locally. That is how
the gas figures above were produced without spending anything — and it matters, because the
anonymous RPC budget on this devnet is **50 requests per hour**.

Batches are packed by encoded bytes using the measured cost model — `996 + 192 × (attributes − 1)
+ payload` — and capped under the 131,072-byte transaction limit. Sends are paced at 2.5s and
`txpool is full` is treated as backpressure: wait, then re-send the same nonce, so the sequence
keeps no holes.

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
| `GET /api/v2/contract/{chainId}/{address}` | Sourcify v2's most-used endpoint, answered from Arkiv. Supports `fields` and `omit`. `fields=compilationEntity` is the one addition beyond Sourcify's own shape: it follows the entity's `compilationref` (a typed `key` attribute — the join `3-write.mjs` builds) to the linked `compilation` entity and returns a summary (compiler, version, optimizer settings, source file count) — opt-in, a second Arkiv read, not included by `fields=all`. Response headers carry the entity key, owner, read block and the literal query (plus a second timing header when `compilationEntity` was requested). |
| `GET /api/parity?chainId=&address=&depth=` | Asks both databases and diffs them field by field, at the same projection on both sides. `depth=identity` compares the 7 fields of Sourcify's default response; `depth=full` adds the ABI (as a canonical digest), the compilation and the deployment — 18 fields. Verdict is `identical` / `mismatch` / `inconclusive` / `not_in_arkiv` / `not_in_sourcify`. |
| `GET /api/query?...` | The filters Sourcify's public API does not expose: proxy status, compiler version prefix, function-count ranges, optimizer settings. Returns the literal Arkiv query it ran. |
| `GET /api/signature?selector=0x…` | The 4-byte service, answered from Arkiv. One equality on an indexed attribute; returns the whole candidate set, because selectors collide. |
| `GET /api/stats` | Live head block and total entity count (one request each), plus the per-type counts from the writer — because counting them live costs ~87 round trips and timed out. |

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
- **The node rejects uppercase attribute names.** `useCount` reverts; `usecount` is accepted. The
  SDK's own `isValidAttributeName` returns true for both, so nothing catches it before the gas is
  spent and the revert carries no reason.
- **Typed attributes match on TYPE as well as value.** A bare bigint is inferred as `u256`, so
  `eq("chainid", 130n)` silently returns zero rows against a `chainid` written as `u64`. No error,
  just an empty result.
- **Renewal is not free.** Extending an entity measured at 10,000 gas. At the two-month lifetime
  that is ~47 hours a year of full block utilisation for a Sourcify-sized corpus, forever.
- **`getEntity(key)` has no owner filter.** `.ownedBy()` only exists on `select().where()`
  queries. Dereferencing a `key` attribute (`lib/arkiv.ts`'s `dereferenceCompilation`) has to
  check `entity.owner === ARKIV_PUBLISHER` itself, after the fetch, or it would trust whatever
  entity currently sits at that key even if it was never written by us.
