# Sourcify CTO conversation — ERC-7730 ownership/storage model (primary source)

> **2026-07-08 · async chat.** Santiago (Arkiv DevRel) ↔ **Kaan Uzdogan** (Sourcify CTO; co-author of EIP-7730).
> **Why this matters:** it is the first primary-source statement of how Sourcify/the working group actually think about the ERC-7730 descriptor lifecycle — and it reshapes the ARGOT plan. Meeting-ready context. Quotes are verbatim.

## The question Santiago asked
> "I'm trying to understand the ownership/storage model for ERC-7730 descriptors. Is Sourcify itself storing/serving the descriptors, or does each descriptor have to come from the dApp / contract owner?"

## Kaan's reply (verbatim)
> "So the ERC7730 (ie. EIP) defines how the descriptors should be written, how the formatting etc should be done. It's registry agnostic.
>
> The ERC was initially authored by Ledger, as well as the registry was living under Ledger's Github. Recently it moved to the EF's @ethereum. Currently it's there on Github but our intention is to move this onchain and make it permissionless. But the trust will come from attestations: For example Ledger can attest to some descriptors' correctness with a key and use those on their wallets.
>
> To answer your question, the descriptors need to come from dapps themselves. Right now it has to be a PR and needs to be reviewed. We're yet to implement a process there. But it's not only Sourcify.
>
> The DSL is something we are thinking about designing, or help design, to streamline the whole process. Meaning, when you're writing the contract you'll also write how this function should be clear sign and it should automatically give you an ERC7730 descriptor.
>
> The descriptors are required to be able to clear sign transactions under the ERC7730 model."

## Key takeaways (what he actually said)
1. **The EIP is registry-agnostic** — it defines the descriptor format, not where descriptors live.
2. **History:** authored by Ledger; registry was under Ledger's GitHub; recently moved to the EF's `@ethereum` org; currently on GitHub.
3. **🎯 Intention: move the registry ONCHAIN and make it PERMISSIONLESS**, with **trust coming from attestations** (e.g. Ledger attests to a descriptor's correctness with a key and honors those on its wallets).
4. **Descriptors come from the dApps themselves.** Today = a PR that must be reviewed; **"we're yet to implement a process there"**; **"it's not only Sourcify"** (multi-party: EF / Ledger / working group).
5. **The DSL** is early ("thinking about designing, or help design") and is **write-time**: as you write the contract you also declare how each function should clear-sign, and it auto-produces an ERC-7730 descriptor.
6. **Descriptors are required** to clear-sign under the ERC-7730 model.

## What it means for Arkiv (our interpretation)
- **The strongest Arkiv angle is NOT the LLM auto-gen — it's the onchain, permissionless, QUERYABLE registry Kaan described.** "Decentralized + queryable store of descriptors + attestations" is Arkiv's core value prop ("the Web3 database"). This reconnects the ERC-7730 thread to the DB-migration/queryability **north star** rather than being a side project.
- **Their attestation trust model DE-RISKS the security concern.** A permissionless registry assumes untrusted entries; wallets only clear-sign **attested** descriptors (else blind-sign). So a candidate/auto-generated descriptor sitting unattested in the store is **not a footgun by itself** — which is exactly the "candidate tier, adopted + attested by the owner" design we already converged on.
- **The DSL does NOT pre-empt the long-tail idea.** The DSL is forward-looking (new contracts, owner writes annotations at author-time). It does **nothing** for the ~38.5M already-deployed contracts whose owners will not come back to annotate. A **candidate-generation layer for that existing long tail is complementary**, not competitive.
- **Authorship = the dApps.** Never position Arkiv/Sourcify as authoring official descriptors. Arkiv contributes **candidates + the queryable store**; owners review, adopt, attest.
- **The submission/review process is unbuilt** ("yet to implement") and multi-party → room to contribute tooling, but our counterpart is the working group, not Sourcify alone.

## Follow-ups (sent / to send)
1. On moving the registry onchain — **where would it live and how would it be queried**? (The Arkiv-shaped question; he opened the door.)
2. The DSL is great for new contracts going forward — **how are you thinking about the millions of already-deployed contracts** whose owners won't come back to annotate? Is closing that backlog a goal, or out of scope?

## Sources
- Kaan Uzdogan is listed as an author of EIP-7730 — https://eips.ethereum.org/EIPS/eip-7730
- Registry now under EF: https://github.com/ethereum/clear-signing-erc7730-registry
- Sourcify H1-2026 recap (founding WG member; H2 = descriptor DSL + registry maintenance): https://docs.sourcify.dev/blog/recap-2026-h1/
