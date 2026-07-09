# Sourcify → Arkiv — Mapping & Migration Design (Step 2)

> Synthesis of the Sourcify data model ([`sourcify-data-model-research.md`](./sourcify-data-model-research.md)) + Arkiv constraints ([`arkiv-load-model-research.md`](./arkiv-load-model-research.md)), cross-checked by a subagent (facts) and codex (design). This is the technical backbone for the mid-August CTO meeting; it later becomes an HTML artifact.

## Design principle
**Do NOT mirror Sourcify's Postgres row-for-row.** Arkiv = a materialized, **queryable index** over Sourcify v2 data:
- **queryable index** — entities with indexed attributes for the common lookups;
- **large artifacts referenced by content hash** → IPFS / GCS-Parquet / FileDB (Sourcify already content-addresses sources by keccak256 → natural fit);
- **immutable cold records retrievable by Arkiv tx hash** (Santiago's §4 hot/cold).

"Move the whole DB into entities" is the trap — it breaks on TTL, ordering, EOA ownership, field projection, and large blobs (see *What breaks*).

## Entities

### 1. `verified_contract` — hot index (primary entity)
**Key:** `sourcify:vc:v1:<chainId>:<lowercaseAddress>`
**Indexed attributes** (chosen for Sourcify's real lookups — by chainId+address, by code hash, by compiler, by match):
`dataset=sourcify`, `schema=sourcify.verifiedContract.v1`, `kind=verified_contract`, `chainId`, `address`, `chainAddress` (`1:0x…`), `match`, `creationMatch`, `runtimeMatch`, `runtimeCodeHash`, `creationCodeHash`, `metadataHash`, `compiler`, `compilerVersion`, `compilerKey` (`solc:0.8.24+commit…`), `language`, `contractName`, `fullyQualifiedName`, `verifiedAtMs`, `matchIdSort` (zero-padded for client sort), `isProxy`, `proxyType`.
**Payload** (compact — hashes + refs, NOT the full source bundle): ids, match fields, `deployment{txHash,block,index,deployer}`, `compilation{…,compilerSettingsHash}`, `hashes{runtime,creation,metadata,abi,sourcesRoot,stdJsonInput}`, `artifactRefs{sourcifyApi, repoV2Path, ipfsMetadataCid, sourceManifestRef, coldTxHash}`, `abiInline` (only if small) or `abiRef`.
**TTL:** 30–90 days, renewed on API hits / popularity.

### 2. `cold_pointer` — the §4 cold tier
**Key:** `sourcify:cold:v1:<chainId>:<address>` — tiny, always-renewed.
**Attrs:** `dataset`, `kind=cold_pointer`, `chainAddress`, `runtimeCodeHash`, `compilerKey`, `match`.
**Payload:** `coldTxHash`, `payloadHash`, `artifactBundleHash`, `sourceManifestRef`.
The cold record itself = the original Arkiv tx calldata/log; retrieved via `eth_getTransactionByHash(coldTxHash)`. Cheaper expiry, **but still needs renewal — NOT true permanence** (→ Marcos Q2).

### 3. `proxy_snapshot` — separate, short-TTL
**Key:** `sourcify:proxy:v1:<chainId>:<address>`
Sourcify resolves proxies **on-read** (not stored) → embedding this in the immutable entity goes stale. **Attrs:** `chainAddress`, `isProxy`, `proxyType`, `implementation` (`1:0x…`), `resolvedAtMs`. Short TTL.

### Large-data policy
`sources`, `stdJsonInput/Output`, full bytecodes, sourceMaps, storageLayouts, metadata → **not first-class payload unless small**. Store hashes + refs in Arkiv; canonical blobs stay in Sourcify IPFS / RepositoryV2 / GCS-Parquet. If Arkiv must hold bytes → FileDB chunk manifests, treated as artifact storage (TTL cost), not the query path. (Source bundles run 100KB–1MB+ vs the ~120KB block → this is mandatory, not optional.)

### Don't over-index
Do NOT attach every source path or 4-byte selector to the verified_contract entity (attribute explosion). Use separate `signature`/`selector` entities **only if** that lookup is product-critical.

## Worked example — a REAL Sourcify contract → a REAL Arkiv entity
Live-fetched from Sourcify v2 (`GET /v2/contract/1/0x70b17e4764CEBD2f892F536c865f14f0E2C6f514`, 2026-06-30). Values below marked *(live)* come straight from the API; *(derived)* = computed for the index; *(ref)* = pointer to canonical blob storage.

**Entity key:** `sourcify:vc:v1:1:0x70b17e4764cebd2f892f536c865f14f0e2c6f514`

**Indexed attributes:**
```json
[
  {"key":"dataset","value":"sourcify"},
  {"key":"kind","value":"verified_contract"},
  {"key":"chainId","value":"1"},                                        // live
  {"key":"address","value":"0x70b17e4764cebd2f892f536c865f14f0e2c6f514"}, // live
  {"key":"chainAddress","value":"1:0x70b17e4764cebd2f892f536c865f14f0e2c6f514"},
  {"key":"match","value":"exact_match"},          // live
  {"key":"creationMatch","value":"exact_match"},  // live
  {"key":"runtimeMatch","value":"exact_match"},   // live
  {"key":"compiler","value":"solc"},                          // live
  {"key":"compilerVersion","value":"0.6.6+commit.6c089d02"},  // live
  {"key":"compilerKey","value":"solc:0.6.6+commit.6c089d02"},
  {"key":"language","value":"Solidity"},                      // live
  {"key":"contractName","value":"GetFlashLoan"},              // live
  {"key":"fullyQualifiedName","value":"MyContract1.sol:GetFlashLoan"}, // live
  {"key":"verifiedAtMs","value":"1723114723000"},   // derived from verifiedAt 2024-08-08T10:58:43Z
  {"key":"matchIdSort","value":"0000000000203404"}, // derived from matchId 203404 (client-side sort key)
  {"key":"isProxy","value":"false"},   // live (proxyResolution.isProxy)
  {"key":"proxyType","value":"none"},
  {"key":"runtimeCodeHash","value":"0x…"},  // derived: keccak256(on-chain runtime bytecode)
  {"key":"creationCodeHash","value":"0x…"}  // derived
]
```

**Payload (compact — hashes + refs, not the source bundle):**
```json
{
  "schema": "sourcify.verifiedContract.v1",
  "matchId": "203404",                              // live
  "verifiedAt": "2024-08-08T10:58:43Z",             // live
  "deployment": {                                    // live
    "transactionHash": "0xedb13400df274331ef94e2449bf1130399223ebd243ce38147e0d0094e228492",
    "blockNumber": "12351176", "transactionIndex": "143",
    "deployer": "0x7664F6994a05aab5433f1f3E0511c8Ec69BF119E"
  },
  "compilation": {                                   // live
    "name": "GetFlashLoan", "fullyQualifiedName": "MyContract1.sol:GetFlashLoan",
    "compilerSettingsHash": "0x…"  // derived hash of {optimizer:off/runs:200, evmVersion:istanbul, bytecodeHash:ipfs}
  },
  "hashes": { "runtimeCodeHash":"0x…", "creationCodeHash":"0x…", "metadataHash":"ipfs://…", "abiHash":"0x…" },
  "artifactRefs": {   // ref — canonical blobs stay in Sourcify
    "sourcifyApi": "https://sourcify.dev/server/v2/contract/1/0x70b17e…?fields=all",
    "repoV2Path": "contracts/exact_match/1/0x70b17e4764CEBD2f892F536c865f14f0E2C6f514",
    "ipfsMetadataCid": "Qm…", "coldTxHash": "0x…"
  }
}
```

**The lookup it answers:** `GET /v2/contract/1/0x70b17e…` becomes, in Arkiv:
```
dataset='sourcify' && kind='verified_contract' && chainAddress='1:0x70b17e4764cebd2f892f536c865f14f0e2c6f514'
```
This is a real contract, mapped to a real, queryable Arkiv entity — the concrete "this is how your data lives in Arkiv" to show the CTO.

## Query patterns — Sourcify lookup → Arkiv WHERE
```
GET /v2/contract/{chainId}/{address}   → dataset='sourcify' && kind='verified_contract' && chainAddress='1:0xabc…'
GET /v2/contract/all-chains/{address}  → dataset='sourcify' && kind='verified_contract' && address='0xabc…'
by runtime code hash (find clones)     → … && runtimeCodeHash='0x…'
by compiler (exact)                    → … && compilerKey='solc:0.8.24+commit.e11b9ed9'
by compiler family (glob)              → … && compilerKey ~ 'solc:0.8.*'
exact matches on a chain               → … && chainId='8453' && match='exact_match'
proxies                                → kind='proxy_snapshot' && isProxy='true' && proxyType='EIP1967Proxy'
```
Listing `GET /v2/contracts/{chainId}?sort&limit&afterMatchId` → query by `chainId`, **sort client-side** by `matchIdSort`/`verifiedAtMs`. Do NOT rely on Arkiv server ORDER BY.

## The real architecture: a Sourcify-compatible API adapter in front of Arkiv
Every gap below is absorbed by a thin **adapter** that speaks Sourcify v2 semantics: it does field projection (`fields`/`omit`), manages pagination + sort, enforces owner+hash authenticity, and renews TTLs on read. **Arkiv = queryable index + cold store; adapter = Sourcify v2 API.** This is what keeps Foundry/Hardhat/Remix working unchanged (they speak two flows: verify = POST std-JSON → poll; lookup = GET `/v2/contract/…`).

## What breaks (be honest for the CTO)
- **TTL vs archival** — renewable index, not permanence. → Marcos Q2.
- **EOA ownership** — a single EOA owning ~11M public-good records = CTO-level blocker. Multi-EOA pointers cut key-loss risk but ≠ multisig. → Marcos Q1.
- **Field projection** — Sourcify `fields`/`omit`; Arkiv returns whole payloads → projection moves to the adapter.
- **Listings/pagination** — Arkiv ≤200/page + no reliable server sort → list UX adapter-managed (client-side sort). → Marcos Q5.
- **Data authenticity** — one shared public DB → consumers must require `owner == SourcifyArkivEOA` + `dataset='sourcify'` + verify hashes, else fake "Sourcify" records are trivial.
- **`sourcify_matches` is not append-only** (current state = latest `updated_at`) + Arkiv full-replace updates → prefer immutable artifact bundles + a latest-state index entity.
- **`runtimeCodeHash` fanout** (clones can be huge) — Arkiv finds them, but no server counts/ordering → ranking needs a sidecar.

## Migration plan (dual-write → backfill → cutover)
1. **Dual-write** — every new Sourcify verification also writes its Arkiv entity (through the adapter). Zero risk: Sourcify's Postgres stays canonical. Proves the write path on live traffic.
2. **Backfill** — stream the ~11M existing records from the Parquet export (GCS, `export.sourcify.dev`) → transform → batch-write to Arkiv (1000-op txs, multi-wallet pool). ~11k txs, ~0.1–0.3 GLM (testnet), hours. Idempotent by entity key (re-runnable).
3. **Shadow-read** — the adapter serves reads from Arkiv but cross-checks a % of traffic against Sourcify; compare hashes; measure parity + latency before trusting it.
4. **Cutover** — flip reads to Arkiv-first once parity + read SLA hold; Postgres becomes fallback. Full off-BigQuery only after mainnet + permanence + ownership are resolved (Marcos P0).

## The adapter — API sketch (the real thing to build)
A thin service speaking Sourcify v2 semantics, Arkiv behind it:
- `GET /v2/contract/{chainId}/{address}` → Arkiv query by `chainAddress` → hydrate payload → apply `fields`/`omit` projection → resolve refs (IPFS/FileDB) on demand → verify owner + hashes → renew TTL on hit.
- `GET /v2/contracts/{chainId}` → Arkiv query by `chainId` → client-side sort by `matchIdSort`/`verifiedAtMs` → cursor pagination (≤200).
- `POST /v2/verify/...` → existing Sourcify verifier runs; on success the adapter **dual-writes** the Arkiv entity.
- **Integrity gate:** every served record requires `owner == SourcifyArkivEOA` + `dataset='sourcify'` + hash check (defends the shared public DB against fake "Sourcify" records).
- Result: **Foundry / Hardhat / Remix keep working unchanged** — they still speak Sourcify v2.

## Telemetry-first (DevRel remit — instrument BEFORE any pilot)
Capture from day 1, because product feedback > vanity for early product: per-query latency (Arkiv vs Sourcify baseline), TTL-renewal rate + cost, hot-set hit ratio, parity mismatches (Arkiv vs canonical), lookup mix (chainAddress vs codeHash vs listing), backfill write throughput, error taxonomy. This is the evidence you bring back to Marcos/Seweryn — and what proves the integration with numbers, not vibes.

## Volume-adjusted cost (~11M contracts, not 4M)
Initial index ≈ 11M ÷ 1000 = **~11,000 txs ≈ ~0.1–0.3 GLM** (testnet economics), hours with a multi-wallet pool. Gas stays cheap; the real pressure is **TTL renewals + read SLA + storage-time cost**, not the write. Mainnet fee spec still draft → Marcos Q3.

## Open decisions → map to the Marcos one-pager
Q1 ownership multisig · Q2 permanence path (is this renewable-index design blessed?) · Q3 economics of 11M writes + ongoing renewals · Q4/Q5 read SLA + server ORDER BY. This design is **contingent on those answers** — it's the "here's how I'd build it" that his answers refine.

## Reusable lesson
For decentralized data products: **"queryable index + content-addressed blob refs + renewable cold pointer"** is the real Arkiv pattern; **"move the whole DB into entities" is the trap.**
