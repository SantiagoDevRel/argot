# Sourcify × Arkiv — Product questions for Marcos

> **To:** Marcos (Head of Product, Arkiv) · **From:** Santiago (DevRel) · **When:** ecosystem meeting
> **Context in one line:** Sourcify (Ethereum Foundation, contract verification — ~4M contracts, ~15M req/day) is our first integration target. They want to leave BigQuery and make their DB decentralized. I ran the technical analysis of whether Arkiv can handle their load; these are the product decisions / roadmap I need from you to move forward.

## Analysis TL;DR
- ✅ **What Arkiv already does well for them:** dirt-cheap writes (4M contracts ≈ 0.04–0.12 GLM, 2–7h on testnet), reads with no egress fee, SQL-like query, and the "queryable index + heavy data referenced" pattern fits them.
- ❌ **3 blockers for a real migration** — all are product decisions, not research. Below as P0/P1.

## Questions (prioritized)

### 🔴 P0 — block a CTO's "yes"
1. **Ownership by multisig/contract.** Today every mutation is signed with an **EOA** private key. A Safe/multisig (contract, no key) can't sign → if an org loses that key, it loses control of all its data. **Is there (or is there a roadmap for) functional contract/threshold ownership — ERC-1271 / account abstraction — where the owner is a multisig that can still update/delete?** No CTO signs off on "1 key = the whole DB".
2. **Permanence for write-once data.** Sourcify needs a verification to be **permanent**. Arkiv today requires a TTL on every entity (`expiresIn`, renewable via `extendEntity`) and has no permanence primitive. **Is the blessed path "Arkiv as a renewable queryable index + the immutable data in calldata/IPFS"? Or is native permanence on the roadmap?** I need to know what to recommend.
3. **Mainnet economics.** 4M writes + continuous growth. Sourcify is a public good **with no revenue**. On testnet gas is trivial, but the mainnet fee spec ($GLM) is in draft. **What's the real fee model, and is there a grant/subsidy path for an EF public good?** This decides whether the deal is even possible.

### 🟠 P1 — define the design and the scale promise
4. **Read SLA.** Their profile is ~15M req/day with low latency (Foundry/Hardhat/Remix). Today = tens–hundreds of ms, and the internal 500 q/s @ p99 / 10M-entity gate is unmet. **Can the new testnet / mainnet sustain that profile, and by when? Expected rate limits and concurrency?**
5. **Server-side ORDER BY.** The SDK exposes `orderBy`/`asc`/`desc` and the docs advertise it, but field guidance says "never, sort client-side". **Is it functional server-side on the new testnet, or still not?** (Directly impacts how listings are served.)
6. **RPC access.** **Does mainnet give a dedicated RPC per API key or shared? Documented rate limits?** (Hub v1 with self-serve keys is still pending.)
7. **Payload size.** Source bundles often exceed the block limit (120 kb). **Is there a hard per-entity cap, and what's the recommended chunking boundary (FileDB) for source-code-sized blobs?**

## What each answer unblocks
- P0 resolved → I can design the real migration architecture and take it to the Sourcify CTO at the **mid-August** follow-up.
- P1 resolved → I can size the sidecar/PoC and the Foundry/Hardhat tutorial without promising numbers that don't hold.

> **Framing note:** the "ERC-7730 descriptor auto-gen" is an adjacent potential (coverage gap), not the core. The core is the DB migration. Let's not mix it into the Sourcify conversation as if it were a request to them.
