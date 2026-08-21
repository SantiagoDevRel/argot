# Full replication — every Sourcify field, on Arkiv

> Design + build record for the v2 pass: Unichain (chain 130) replicated **100%** — all 24
> fields of `fields=all`, all ten Postgres tables' worth of data — into Arkiv entities on
> Cheesecake. Written 2026-08-21. This version reflects what was BUILT and MEASURED, after an
> adversarial review pass (two reviewers, 19 findings) reshaped the first draft.
> Working doc (English, per ARGOT rules). The show surfaces are the POC app and the explainer.

## 0. The one idea

Sourcify's API returns 24 fields, but its **database does not store 24 blobs** — it stores ten
normalized tables and *composes* the API response at read time. `stdJsonInput`, `stdJsonOutput`
and `signatures` do not exist as stored objects anywhere in their Postgres.

So "replicate 100%" has a precise meaning: **replicate the ten tables, then compose the same
24 answers.** Copying the API response verbatim into storage would replicate a *cache*, not the
database — and would store the median contract 5× over.

## 1. Where each of the 24 fields lives

attr = typed, indexed, filterable · payload = stored bytes · entity = own deduplicated entity ·
composed = assembled at read time (exactly what Sourcify does for the same field).

| field | lives | detail |
|-------|-------|--------|
| chainId, address, match, creationMatch, runtimeMatch, matchId, verifiedAt | attr (`verified_contract`) | the identity — Sourcify's default response, one read |
| abi | payload (vc) + attr digest | `abihash`, `fncount`, `evtcount` indexed |
| compilation | payload (vc) + `compilation` entity | deduplicated, `key`-ref join |
| deployment | payload (vc) | deployer + blockNumber also attrs |
| proxyResolution | attr + payload (vc) | Sourcify computes per request, stores nothing |
| sources | `sourcefile` entities | one per unique sha256; compilation carries path→hash |
| metadata, storageLayout, transientStorageLayout, userdoc, devdoc, sourceIds | payload (`compilation`) | per-compilation, dedup with it; `sourceIds` is compiler-assigned, NOT derivable |
| creationBytecode, runtimeBytecode | `code` entities + payloads | onchain code refs on vc attrs; recompiled refs + sourceMap/linkReferences/cborAuxdata/immutableReferences on compilation; transformations on vc |
| additionalInput | payload (vc) | null on all 3,131 Unichain contracts, handled anyway |
| stdJsonInput | **composed** | `{language, sources, settings}` — measured byte-equal parts, 120/120 |
| stdJsonOutput | **composed** | sourceIds + abi + metadata-string + docs + layouts + `evm.*` = recompiled code without `0x` — all shapes measured, 120/120 |
| signatures | **composed** from abi | ABI order, tuple-expanded keccak — measured identical 120/120; plus 12,674 standalone `signature` entities for the 4-byte service |

**"Which do we show?" — all 24.** The route serves Sourcify's exact `fields`/`omit` semantics
(invalid selector → 400 `invalid_parameter`, `fields`+`omit` → 400, dot-notation projection),
defaulting to the identity fields like Sourcify does.

## 2. Entity model v2 (six kinds), as built

```
verified_contract  3,131 (2,801 patched + 330 created for post-v1 verifications)
                   +creationcodehash +runtimecodehash (+compilationfp re-set) → 28/32 attrs
                   payload += transformations, code refs, additionalInput
compilation        1,505 (1,346 patched + 159 created)
                   payload += metadata, layouts, docs, sourceIds, code artifacts,
                   recompiled-code refs, sources path→sha256 map
sourcefile         6,119 unique files, 45.4 MB, sha256 content-addressed
code               4,927 unique bytecodes, 43.3 MB RAW bytes (octet-stream)
signature          12,674 (v1, unchanged)
blob               375 chunks carrying 190 spilled components, 28.6 MB
```

### The fingerprint fix — a real bug, measured

v1 deduplicated compilations by `sha256(compiler, version, language, fqn, settings)`. On this
one chain that key **conflated 99 groups of genuinely different compilations** (one split 5
ways) — same name and settings, different sources or artifacts. Sourcify itself keys
`compiled_contracts` by OUTPUT code hashes, because identical inputs do not guarantee identical
artifacts (solc-js vs native builds of one version string is a documented divergence class).
v2 fingerprint = `sha256(compiler, version, language, fqn, settings, sorted source hashes,
recompiled creation+runtime keccaks, artifacts hash)` — inputs AND outputs, so "shared
compilation ⇒ shared docs" holds by construction. (Review finding, applied.)

### Consistency across fetch passes

The two fetch passes ran at different times against a live service; a contract re-verified in
between would merge into a chimera record. The transform refuses to join rows whose `matchId`
disagrees and emits them to `refetch-130.json` (review finding, applied; 0 hit on this run —
2 rows excluded for missing counterparts instead).

## 3. Chunking — the "part 1 / part 2" mechanism

The node caps the **whole transaction** at 131,072 bytes. Budgets, as built:

- Payload budget = `MAX_PAYLOAD_BYTES − 8,192` (the writer refuses calldata over
  `131,072 − 4,000`; one maximal entity encodes to payload + ~1.8 KB, so 4 KiB of reserve
  admits entities the send would then reject — review finding, applied).
- The spill rule is **per assembled entity, not per component**: while a payload exceeds the
  budget, the largest spillable component is evicted to the blob lane and replaced by a
  `{"$spill": {hash, parts, bytes}}` stub, repeating until it fits (review finding, applied —
  the per-component rule would have let aggregates overflow with nothing spilling).
- Blob chunks are **raw bytes** (~100 KB, `application/octet-stream`) of the component's UTF-8
  serialization — no JSON wrapper, no escaping inflation, no split code points. Attrs:
  `{ds, kind, hash, part, parts, size}` (`bytes` is a reserved word in the query language —
  the SDK's own validator catches it, found on the first dry run).
- **Reader contract** (review finding, applied): collect parts by `kind+hash`, dedup by part
  index, require exactly `parts` distinct indexes, concatenate, verify sha256, then parse.
  Anything less → the component reports *unavailable*, named in `x-arkiv-unavailable` — never
  a silently truncated file.

Measured over the whole population: **40 of 6,119 source files (0.65%) and 51 of 3,129
metadatas (1.6%)** need the lane. It is the escape hatch for the tail, not the design.

## 4. Write plan, as built (8-write-full.mjs)

Dry run first (`buildMutation`, zero RPC): **222.72 MB calldata · 17.82 B gas (495 blocks) ·
1.247e-7 GLM at 7 wei · 2,495 transactions**.

1. **Key recovery**: one cursor-paginated, attribute-only, `ownedBy`-filtered sweep (21 reads)
   rebuilt `address→key` and `fp→key`; it collects ALL keys per identity and retires
   duplicates by flipping `ds` to `sourcify-orphan` (0 found on this chain, lane exists).
2. **Creates**: blob → code → sourcefile (content-addressed; readers find them by `kind+hash`,
   so no key bookkeeping at all).
3. **Compilations**: highest-useCount claimant of each on-chain v1 fingerprint is PATCHED
   (payload replaced, `fp` re-set to v2, `usecount` updated); split siblings and new
   fingerprints are CREATED, keys discovered afterwards by querying their `fp` attribute.
4. **Contracts**: PATCH sets the two code-hash attrs + `compilationfp` + re-sets
   `compilationref` unconditionally (idempotent, self-heals the refs the v1 outage left
   dangling). A vc whose target compilation key is unresolved is **deferred, not mis-pointed**.
   Post-v1 contracts are CREATED whole.

### The RPC reality (the reviewer was right)

Without an API key the Bouncer meters **everything** — `eth_sendRawTransaction` included — at
**50 requests/hour per IP** (`429 ANON_RATE_LIMITED`, measured). Two consequences, both built
in: viem's default retry silently honors the up-to-13-minute `Retry-After` (reads as a hang),
so the transport runs `retryCount: 0` and a visible `rateRetry()` owns all waiting; and
anonymously this writer is a **crawler** — ~45 transactions per hourly window, checkpointed,
resumable, ~2 days for the full pass. With `ARKIV_API_KEY` set it is a ~100-minute run.
**The API key for the publisher wallet is the single unblocker** (the old
`devnet.hub.arkiv.network` is gone; the Cheesecake hub URL needs to come from the team).

### Lifetime policy (review finding, applied)

Everything v2 writes uses `DAYS=59`, so the whole graph — v1 entities patched (a patch never
moves expiry) and v2 entities created — **lives and dies together around 2026-10-19/20**. No
half-expired records serving dangling references. Extension is measured at 10,000 gas per
entity; who holds the extending key stays an open product question, on purpose.

## 5. Read plan, as built (lib/full.ts + the v2 route)

Fan-out for one full record: 1 (vc) + 1 (compilation) + the content-addressed pieces in
**batches** — `kind = sourcefile AND (hash = a OR hash = b OR …)`, 20 hashes per query, the
`or` operator being network-supported (verified live) — so a 93-file contract costs ~6
reads, not 93. That matters twice: for latency, and because the deployed app reads
Cheesecake anonymously too, against the same 50-requests/hour meter.

Every composed field carries **provenance**: the ledger records which entities (kind, key,
hash, bytes, role) built it, so the UI can show "built from" per field and draw the
entity graph of one contract (`/api/record`, `/api/graph`). This is the answer to "how do
the entities interconnect" — not a diagram of intent, the real keys read on this request. Every piece except the vc is immutable
and content-addressed, so an in-process LRU (800 entries) makes hot files free after first
touch. The response headers carry the truth: `x-arkiv-reads`, `x-arkiv-cache-hits`,
`x-arkiv-unavailable`, the entity key, owner, block and the literal query.

Composition fidelity was **measured before serving** (etl/composecheck.mjs, 120 verbatim
`fields=all` records): stdJsonInput parts byte-equal 120/120; `JSON.stringify(metadata)`
reproduces the compiler's canonical string byte-for-byte 120/120; `evm.*.object` is the
recompiled bytecode without `0x` 120/120; signatures derive from the ABI in ABI order 120/120;
Sourcify's own `sources` vs `stdJsonInput.sources` differ in key order between themselves, so
map order is not contractual. Parity `depth=all` re-checks all 24 fields against sourcify.dev
live, per contract, with a byte-exact probe on the metadata string.

## 6. The DGX question — raise the node's payload limit?

Pawel is right that `MAX_PAYLOAD_BYTES` is a node parameter. We still did not do it that way:

1. **It proves the wrong thing.** A private node with a raised limit demos "Sourcify fits a
   chain nobody runs". The chunked design runs on the shared devnet with stock parameters.
2. **The limit is not the binding constraint — the economics are.** Real cost is ~80 gas per
   calldata byte against a 36 M-gas block: a median 1 MB sources-as-one-payload record is two
   whole blocks. Raising the byte cap without raising block gas changes nothing; raising both
   is a different chain. Our own ask #5 to engineering says *leave the limit alone*.
3. **Chunking is not a workaround.** Content addressing + dedup is how Sourcify's own DB
   stores sources and code; the limit forced the better model, and the lane carries 0.55–1.7%
   of atoms, measured.

What the DGX *is* good for: a controlled experiment measuring what large payloads do to block
utilisation — data for the product conversation, run separately, never the replication path.

## 7. Status log

- 2026-08-20 — v1 write: 2,801 vc + 1,127 compilations + 12,674 signatures, 568 txs (real).
- 2026-08-21 — full fetch (420 MB, 2,986 records), 120-record `fields=all` ground truth,
  composition verified, v2 transform + dry run (numbers above), send started. Blob lane
  confirmed live on-chain (parts visible through the deployed explorer). Send proceeds in
  crawl mode pending the API key; fully checkpointed and resumable.
