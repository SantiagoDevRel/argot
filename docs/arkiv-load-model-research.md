# Arkiv Load-Model Research (Phase 0 · source: local bucket + public docs/SDK)

> Subagent research 2026-06-30. Every number tagged by network phase. **Honest bottom line:** almost every production-relevant SLA number (rate limits, concurrent readers, read throughput/latency) is **undocumented** — this is a pre-mainnet chain and those gaps are real findings, not research misses.
>
> ⚠️ **Version caveat:** the published SDK (`@arkiv-network/sdk` v0.6.7/0.6.8) DOES expose `orderBy` (`asc()`/`desc()`) and `changeOwnership` — which **contradicts** the arkiv-sync repo note that orderBy "was removed / is non-functional in 0.7.0". Drift to resolve with product.

## READ
| Feature | Finding | Phase | Source |
|---|---|---|---|
| Query operators (WHERE) | SQL-like: `&&` (AND), `\|\|` (OR), `!` (NOT), `=`, `!=`, `<`, `>`, `<=`, `>=`, `~` (glob). Query by attribute + by owner (`.ownedBy`) + creator (`.createdBy`); by key via `getEntity`. | Braga / current SDK | docs.arkiv.network/start-here/fundamentals |
| Server-side ORDER BY | **CONTESTED.** Docs: "sort by any numeric attribute". SDK source exposes `QueryOptionsOrderBy` + `asc()`/`desc()` → API exists. BUT arkiv-sync hard-rules "NEVER `.orderBy()` (non-functional, removed in 0.7.0) → sort client-side". Range queries only recently landed via radix-tree in op-reth. → API present, functional reliability on Braga unverified. | Braga (disputed) | SDK GitHub `@43e079f`; indexer/CLAUDE.md L45; handoff L305 |
| Indexes | Indexed retrieval on attributes. Range/order backed by radix tree (recent). Attributes = `{key, value}` array — no schema, no type inference. | Braga | handoff L84, L305 |
| Pagination | Cursor-based, **max 200 results/page** (hard). Needs `.limit()`. | Braga | docs |
| Read latency | **tens to hundreds of ms — explicitly NOT sub-10ms.** No published SLA. | Braga | handoff L91 |
| Read throughput | Stress: read "feeling good", write "no-good". No published reqs/s. **Target gate (unscheduled): 500 q/s @ p99, 10M entities = commercial blocker #1, NOT met.** | Braga → target | handoff L304, L262 |
| RPC rate limits | **UNDOCUMENTED.** Open whether mainnet gives dedicated RPC per API key or shared. Hub v1 (self-serve keys + faucet) pending. | Unknown | handoff L349, L256 |
| Concurrency ceiling | **TBD / undocumented.** | Unknown | — |
| Egress | **No egress pricing** — pricing is storage-time only (bytes × time). Reads "no gas" → egress effectively free at protocol level, but no public read-throughput guarantee. | Braga | handoff L93; indexer README L10 |

**Sourcify baseline:** ~15M req/day (~175 req/s avg, higher peaks), needs ms for Foundry/Hardhat/Remix. Arkiv today = tens-hundreds ms + no documented rate/concurrency ceiling → **the 15M-req/day profile is UNPROVEN on any Arkiv phase.**

## WRITE
| Feature | Finding | Phase | Source |
|---|---|---|---|
| Batch (ops/tx) | **Protocol cap = 1000 ops/`mutateEntities` tx** (>1000 rejected; SDK clamps to 1000). Atomic. | Braga (measured) | indexer/README L190 |
| **Gas per entity (MEASURED)** | 1000-entity tx ≈ **55–93k gas total → ~55–93 gas/entity** amortized (~22k base + tens per extra entity). Measured on Braga 2026-06-16. <0.16% of a 60M-gas block. | Braga (measured) | indexer/README L190 |
| Cost per event (MEASURED) | **≈ 1–3 ×10⁻⁸ GLM/event** on Braga. 1 GLM ≈ tens of millions of events. | Braga (measured) | indexer/README L124 |
| Write throughput | Per-wallet = batchSize/blockTime. 1000/tx @ ~2s → **~150–500 ev/s per wallet**. Limit = 1000-op cap × ~2s cadence (single nonce), NOT gas. Multi-wallet pool (N nonces) designed, not built. | Braga (measured/derived) | indexer/README L190-191 |
| Update semantics | **FULL-REPLACE.** `updateEntity` replaces the whole entity — omitted attrs are dropped. Send the complete record. | Braga / SDK | indexer/CLAUDE.md L44 |
| Write maturity | Stress "no-good" (known bottleneck). arki-v3: ~70% of write time in EVM bytecode → moving to a direct precompile (~70% speedup, in progress). | Braga → v3 | handoff L303 |
| **Cost of 4M writes** | 4M ÷ 1000 = **4,000 txs** ≈ ~0.3B gas total (~5 Braga blocks, spread over time); GLM ≈ **~0.04–0.12 GLM** (testnet economics — mainnet fee spec in draft). **Time** single-wallet ~150–500 ev/s ≈ **2.2–7.4h**; multi-wallet drops linearly. | Braga math; mainnet TBD | derived |

**Open economic question (§5):** who pays gas for 4M writes + ongoing on mainnet? Sourcify = public good, no revenue. Fee spec in draft → Marcos.

## STORAGE
| Feature | Finding | Phase | Source |
|---|---|---|---|
| Max payload/entity | No documented per-entity cap (payload `Uint8Array`). Effective ceiling = **120 kb block limit** (an entity can't exceed what fits in a block, which is shared). | Braga | handoff L91 |
| Large blobs (source) | Not inline if large — Arkiv ships **"FileDB"** (file-chunking middleware) because large files must be split across many entities. Source bundles (>120 kb) → chunk via FileDB or **reference off-chain (IPFS) + queryable index/hash in Arkiv.** Validates §4 design. | Braga | WebSearch FileDB; §4 |
| **TTL / expiry** | **Every entity MUST have a finite lifespan.** `expiresIn` in **seconds, required**; auto-expires; renewable via `extendEntity()`. **No permanence primitive** — repo verbatim: "Never say 'permanent'; TTLs expire". Internally: `expiresAtBlock`. | Braga / SDK | indexer/CLAUDE.md L43,L52 |
| Write-once permanence | **Not guaranteeable on-chain today.** For Sourcify's immutable data: (a) perpetual `extendEntity` renewals (ongoing cost), or (b) §4 pattern — heavy data in the source chain's calldata/logs (permanent) + Arkiv as a **renewable queryable index** (address → txHash). | Braga | §4 |
| Storage cost | **Time-based: bytes × lifetime.** No query/read fee. "Over-allocating expiration wastes fees — start short, extend". | Braga | handoff L85,L93 |
| Cross-testnet migration | **Entities do NOT migrate across testnets.** Braga decommissions ~Sep 2026; data written to Braga is lost at sunset. | Braga → sunset | handoff L258 |

## OWNERSHIP / ACCESS-CONTROL
| Feature | Finding | Phase | Source |
|---|---|---|---|
| Entity owner | Each entity has `owner` (`0x…`) + `creator` (`0x…`). Writes require a WalletClient with a private key; reads = key-less PublicClient. | Braga / SDK | SDK `Entity` |
| **Owner = multisig/contract?** | **Type-level: yes; functionally: NO today (inferred).** `changeOwnership({newOwner: Hex})` accepts any address (a Safe is a valid Hex). BUT all mutations are signed with an **EOA private key** via WalletClient. A Safe/multisig is a contract **with no private key → it cannot sign an Arkiv tx.** No AA/ERC-1271 documented. → You can *set* a contract as owner, but it **couldn't then update/delete/extend.** = the §3 catch, UNRESOLVED → Marcos. | Braga / SDK (inferred) | SDK `changeOwnership.ts`; §3 |
| Access-control | **Owner-scoped, EOA-signature.** Store = **one shared PUBLIC DB** — no native namespacing, no private data (hard constraint, no roadmap). Convention: tag `project` attr + owner-scope every read. No row-level ACL beyond owner address. | Braga | indexer/CLAUDE.md L46 |
| Key loss | ownership = 1 EOA key with no documented multisig path → **losing the key = losing all write/update/delete/extend control** over all its entities (they only expire on TTL). = single point of failure §3. | Braga | §3 |

## Questions for Arkiv Product (Marcos)
1. **Ownership multisig/contract:** can a Safe/contract be a functional owner that can *still update/delete* (ERC-1271 / AA / threshold)? Today it looks EOA-signature-only. (§3 — hardest blocker for a CTO.)
2. **Write-once permanence:** guaranteed path to keep immutable data alive without perpetual `extendEntity` renewals? Is the "Arkiv-renewable-index + data in calldata" pattern (§4) blessed?
3. **Mainnet economics:** who pays gas for 4M writes + ongoing? Real fee spec ($GLM, currently draft)? Grant/subsidy for a public good?
4. **ORDER BY reality:** SDK exposes `orderBy`/`asc`/`desc` and docs advertise it, but guidance says "never, sort client-side". Does it work server-side on the new testnet?
5. **Read SLA:** can Sept testnet / mainnet serve ~15M req/day (rate limits, concurrency, p99)? The 500 q/s @ p99 / 10M gate is unmet + unscheduled.
6. **RPC access:** dedicated RPC per API key vs shared? Documented rate limits? (Hub v1 with self-serve keys pending.)
7. **Max payload:** hard per-entity cap below 120 kb? Recommended chunking boundary (FileDB) for source-code-sized blobs?

## What is legacy-Braga and WILL change with the new L2
- **All measured numbers (55–93 gas/entity, 1–3×10⁻⁸ GLM/ev, ~2s block, 120 kb block, ~150–500 ev/s/wallet) are Braga-measured** → almost certainly change: Braga sunsets ~Sep 2026, chain mid-pivot OP Stack L3 → vanilla L2 (op-geth→op-reth done; arki-v3 in-proc EntityDB + precompile targeting ~70% write speedup).
- **1000-ops/tx cap** = current measured cap on Braga; may change.
- **`expiresIn` seconds + no permanence** = current-architecture constraint; could shift with the new L2's DA/storage.
- **Centralized sequencer at launch** → any latency/throughput/ordering number is single-sequencer, not decentralized-network.
- **Mutable network identity:** Braga (chainId `60138453102`) is the documented testnet, but notes also reference a new **"Zeppelin"** staging testnet → re-verify live network/RPC/faucet at docs.arkiv.network (§14 freshness) before quoting.
- **Do NOT publish Arkiv's timeline** (Braga sunset / Sept testnet / Oct mainnet) — internal, no public source (§8).

**Sources:** local — `handoff.md`, `projects/indexer/{README.md,CLAUDE.md}`, memory `reference_arkiv_ecosystem_sdk_state.md`; public — [docs.arkiv.network/start-here/fundamentals](https://docs.arkiv.network/start-here/fundamentals/), [Arkiv-Network/arkiv-sdk-js](https://github.com/Arkiv-Network/arkiv-sdk-js), [@arkiv-network/sdk (npm)](https://www.npmjs.com/package/@arkiv-network/sdk), FileDB usecase.
