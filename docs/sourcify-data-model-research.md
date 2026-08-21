# Sourcify Data Model, API, Distribution & Tooling (Phase 0 · sourced)

> Subagent research 2026-06-30. Ground-truth for mapping Sourcify → Arkiv entities.
> **Repo note:** canonical repo is now **`argotorg/sourcify`** (the `ethereum/sourcify` URL redirects there) — Argot is the org maintaining Sourcify. Schema facts trace to Sourcify's Verifier-Alliance-derived Postgres schema + the `apiv2.yaml` OpenAPI spec.
> **Volume correction:** **~11M verified contracts** by end-2025 (was ~6M Jan 2025) — the "~4M" assumption is outdated. Confirm live via `/chains` counters.

## 1. Verified-contract record schema (Postgres)
Sourcify extends the **Verifier Alliance schema** + two Sourcify tables. A verified contract = a join across ~8 tables. (Source: DeepWiki over `ethereum/sourcify` DB schema + `database-util.ts`.)

- **`sourcify_matches`** — `id`, `verified_contract_id` FK, `creation_match` (legacy `perfect`|`partial`|null), `runtime_match`, `metadata` json, timestamps.
- **`verified_contracts`** — `id`, `compilation_id` FK, `deployment_id` FK, `creation_transformations`/`creation_values` json, `runtime_transformations`/`runtime_values` json, `runtime_match`/`creation_match` bool, `runtime_metadata_match`/`creation_metadata_match` bool (these promote `match` → `exact_match`), audit cols.
- **`contract_deployments`** — `id`, `chain_id` bigint, `address` bytea, `transaction_hash`, `block_number`, `transaction_index`, `deployer`, `contract_id` FK.
- **`compiled_contracts`** — `id`, `compiler`, `version`, `language`, `name`, `fully_qualified_name` (`path:Name`), `compilation_artifacts` json (ABI, userdoc, devdoc, storageLayout, sources index), `compiler_settings` json, `creation_code_hash`/`runtime_code_hash` FK, `creation_code_artifacts`/`runtime_code_artifacts` json (sourceMap, linkReferences, immutableReferences, cborAuxdata).
- **`code`** — `code_hash` bytea PK (SHA-256), `code` bytea, `code_hash_keccak` bytea. (dedup'd bytecode)
- **`contracts`** — `id`, `creation_code_hash`/`runtime_code_hash` FK.
- **`sources`** — `source_hash` bytea PK, `source_hash_keccak`, `content` text. (dedup'd source content)
- **`compiled_contracts_sources`** — join: `compilation_id`, `source_hash`, `path`.
- Plus `compiled_contracts_signatures` / `signatures` (4-byte selectors).
- **Proxy resolution is NOT stored** — computed on-the-fly at lookup when `proxyResolution` requested.

## 2. API v2 surface
Base: `https://sourcify.dev/server`. Spec: `/api-docs/swagger.json`.
- **Verify (async):** `POST /v2/verify/{chainId}/{address}` (stdJsonInput + compilerVersion + contractIdentifier `path:Name` + optional creationTransactionHash) → `{ verificationId }`; poll `GET /v2/verify/{verificationId}`. Also `/v2/verify/metadata/...`, `/etherscan/...`, `/similarity/...`.
- **Lookup:** `GET /v2/contract/{chainId}/{address}` (with `fields=`/`omit=` selectors); `GET /v2/contract/all-chains/{address}`; `GET /v2/contracts/{chainId}` (paginated: `sort` asc/desc, `limit` 1–200 default 200, `afterMatchId` cursor).
- **Utility:** `/health`, `/version`, `/chains`.
- **`fields` selectors:** `matchId, creationMatch, runtimeMatch, verifiedAt, abi, metadata, sources, sourceIds, userdoc, devdoc, storageLayout, transientStorageLayout, additionalInput, stdJsonInput, stdJsonOutput, signatures, proxyResolution` + nested `creationBytecode.*`, `runtimeBytecode.*`, `deployment.*`, `compilation.*`, `proxyResolution.*`.
- **Match types (v2):** `exact_match` (bytecode + metadata hash match), `match` (bytecode matches, metadata differs/absent), `null`. `creationMatch`/`runtimeMatch` independent.
- **v1 shutdown 2026-07-07** (weekly brownouts before). v2 = async verify + renamed match labels.

## 3. Distribution
- **Postgres:** no public read DSN documented — access via API / Parquet / BigQuery. *(confirm any read-replica)*
- **Parquet/GCS:** endpoint `export.sourcify.dev`, bucket `sourcify-production-parquet-export`, `v2/` prefix. `aws s3 sync s3://.../v2/ ... --endpoint-url https://storage.googleapis.com --no-sign-request`. 10 tables, row-range partitioned, **daily append-only**.
- **IPFS (RepositoryV2):** `repo.sourcify.dev`, path `contracts/{full_match|partial_match}/{chainId}/{checksumAddress}/` with `metadata.json` + `sources/`. **Source filenames normalized to keccak256 hashes → content-addressable.** All pinned on IPFS (per-CID). Weekly R2 tarballs at `repo-backup.sourcify.dev` split by match type + chain + first address byte (e.g. `full_match.1.2F.tar.gz`).
- **Disk uses legacy `full_match`/`partial_match` naming** even though API says `exact_match`/`match`.
- **BigQuery:** dataset path referenced in docs but exact `project.dataset` id not surfaced. *(confirm)*

## 4. Tooling consumption
- **Foundry** (`forge verify-contract --verifier sourcify`) + **Hardhat** (`hardhat-verify`): build Solidity **standard-JSON**, POST to verify with compilerVersion + contractIdentifier + optional creationTransactionHash; lookup for "already verified".
- **Remix** (Sourcify plugin): same verify+lookup; fetches sources back into editor.
- **Blockscout / explorers**: use Sourcify as a verification backend, mirror match status.
- All ultimately = two flows: (a) verify = POST standard-JSON → poll (v2); (b) lookup = GET `/v2/contract/{chainId}/{address}`.

## 5. Volume / shape
- **~11M contracts** end-2025 (confirm 2026 via `/chains`).
- **415 chains supported** (live `/chains`, confirmed 2026-06-30; don't hardcode — grows).
- **Source bundles: few KB → 100KB–1MB+** (OZ/library imports). Direct tension with Arkiv's ~120KB block → a non-trivial fraction must be chunked/content-addressed (maps onto Sourcify's own keccak-hashed dedup'd `sources` store). *(confirm size distribution from Parquet)*

## Flattened "verified contract" record (the thing to map to Arkiv)
**Identity/deployment:** `chainId`, `address` (checksummed), `matchId`, `verifiedAt`, `transactionHash`, `blockNumber`, `transactionIndex`, `deployer`.
**Match:** `match` (exact_match|match|null), `creationMatch`, `runtimeMatch`, `creationMetadataMatch`/`runtimeMetadataMatch` (bool).
**Compilation:** `language`, `compiler`, `compilerVersion`, `compilerSettings` (json), `name`, `fullyQualifiedName`.
**Artifacts/interface:** `abi`, `metadata`, `userdoc`, `devdoc`, `storageLayout`, `transientStorageLayout`, `sources` (path→{content}, keccak-addressable), `sourceIds`.
**Bytecode (creation + runtime):** `onchainBytecode`, `recompiledBytecode`, `creationCodeHash`/`runtimeCodeHash` (SHA-256 + keccak), `sourceMap`, `linkReferences`, `cborAuxdata` (drives exact vs partial), `immutableReferences` (runtime), `transformations`/`transformationValues`.
**Derived (not stored):** `proxyResolution` (isProxy, proxyType, implementations[], error), `signatures` (function/event/error 4-byte).

## Unknowns / needs confirmation
1. Public Postgres read access (DSN/read-replica) — or API/Parquet/BigQuery only?
2. Exact BigQuery `project.dataset` id — NOT published in docs; access is via a **Google Analytics Hub** link + a Colab example (must extract the id from there). Confirmed 2026-06-30.
3. ~~Chain count~~ **415 chains** (confirmed live 2026-06-30). Contract count still ~11M (end-2025) — confirm current via stats page.
4. Source-bundle size distribution (compute from `sources`/`compiled_contracts_sources` Parquet) — how many exceed ~120KB.
5. Exact JSON shapes of `transientStorageLayout` / `additionalInput` / `stdJsonOutput`.
6. RepositoryV2 naming (`full_match` vs `exact_match`) on current IPFS/R2 artifacts before wiring an importer.

**Sources:** deepwiki.com/ethereum/sourcify · sourcify.dev/server/api-docs/swagger.json · docs.sourcify.dev/docs/repository/download-dataset · .../file-repositories · docs.sourcify.dev/blog/api-v1-brownouts · sourcify.dev stats. Fetched 2026-06-30.
