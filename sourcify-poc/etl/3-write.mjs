/**
 * 3-write.mjs — push the transformed entities to Arkiv (Cheesecake).
 *
 * Phases A and B exist because B references A:
 *   A. compilation entities        -> collect their on-chain keys
 *   B. verified_contract entities  -> carry `compilationRef` as a typed `key`
 *      attribute pointing at the phase-A entity. That is the join, expressed in
 *      the data model rather than reconstructed by the reader.
 * Signature (phase C) and sourcefile (phase 0, run first below) entities carry no
 * such reference and can be written in any order relative to A/B.
 *
 * WHY THE ADVANCED PATH. The everyday `mutateEntities` bundles send + wait +
 * decode, which is 4-ish RPC calls per batch. The anonymous budget on this devnet
 * is 50 requests PER HOUR, so the convenient path would spend the whole hour on
 * twenty batches. `advanced.buildMutation` encodes locally (zero calls) and
 * `eth_sendRawTransaction` costs exactly one, so a batch costs one request.
 *
 * Everything is checkpointed after each transaction, so the run is resumable and
 * can be spread over several hourly windows. `MAX_TXS` bounds one wave.
 *
 * DRY RUN IS THE DEFAULT — pass --send to broadcast.
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { addr, bool, i32, key, str, u64 } from "@arkiv-network/sdk/attr";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SEND = process.argv.includes("--send");
const CHAIN = process.env.CHAIN ?? "130";
const DAYS = Number(process.env.DAYS ?? 60); // two months — a deliberate lifetime, not a demo default
const MAX_TXS = Number(process.env.MAX_TXS ?? 0); // 0 = no cap
// Blocks are 2s and the producer takes only a few transactions each, so firing a whole
// backfill as fast as the loop can encode fills the mempool and the node starts answering
// "txpool is full". Pace the sends to roughly what a block can absorb.
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS ?? 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * The SDK wraps node errors, so the useful text is never on `.message` — that just says
 * "Transaction failed: Execution error without revert data". "txpool is full" lives
 * several `cause` levels down. Flatten the whole chain before matching, or the retry
 * silently never fires.
 */
const errorText = (e) => {
  const parts = [];
  for (let cur = e, depth = 0; cur && depth < 8; cur = cur.cause, depth++) {
    for (const k of ["message", "details", "shortMessage", "metaMessages"]) {
      const v = cur?.[k];
      if (typeof v === "string") parts.push(v);
      else if (Array.isArray(v)) parts.push(v.join(" "));
    }
  }
  return parts.join(" | ");
};
const DIR = path.join(import.meta.dirname, "data");
const CKPT = path.join(DIR, `written-${CHAIN}.json`);

// Measured cost of one entity: ~996 B of calldata as a floor, +192 B per attribute,
// plus the payload roughly 1:1. So a 25-attribute index record costs ~4.6 KB before
// any data at all, and batching is bounded by bytes rather than by count.
// Calldata is 16 gas per non-zero byte against a 36,000,000 block. Target about a
// third of a block per transaction: big enough that a whole chain fits in a few
// dozen requests, small enough that one fat contract cannot push a batch over.
// MEASURED, not the EVM calldata rate. A real batch of 8 entities burned 1,119,088 gas
// against ~30 KB of calldata: Arkiv charges entity storage on top of the 16 gas/byte the
// EVM charges for calldata, so the true rate is roughly 4.7x the naive estimate. Sizing
// batches on 16 would build transactions that exceed the block limit and revert.
const GAS_PER_BYTE = Number(process.env.GAS_PER_BYTE ?? 80);
const BLOCK_GAS = 36_000_000;
// MEASURED THE HARD WAY: the node rejects a transaction over 131,072 bytes with
// "oversized data: transaction size N, limit 131072" — the SAME number as
// MAX_PAYLOAD_BYTES. So the cap is not on the payload, it is on the whole transaction,
// and payload + attribute encoding + envelope all share that one budget. A batch must
// therefore stay well under it, and an entity whose payload approaches 128 KiB cannot be
// written at all, because the transaction carrying it would not fit.
const TX_SIZE_LIMIT = 131_072;
const BATCH_BYTE_BUDGET = Number(process.env.BATCH_BYTES ?? 105_000);
const BATCH_MAX = Number(process.env.BATCH_MAX ?? 400);

const read = (f) =>
  fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const vcs = read(`entities-verified_contract-${CHAIN}.ndjson`);
const cps = read(`entities-compilation-${CHAIN}.ndjson`);
// The 4-byte lane. Sourcify runs signature resolution as a separate service, but it is
// the single best-shaped thing here for a key-value store: one entity per selector,
// median payload 86 bytes, and the lookup is one equality on an indexed attribute.
const sigs = fs.existsSync(path.join(DIR, `entities-signature-${CHAIN}.ndjson`))
  ? read(`entities-signature-${CHAIN}.ndjson`) : [];
// Per-file source entities, deduplicated by sha256 in 2-transform.mjs. No `key`
// attribute links a compilation to these -- the join is the path -> hash map already
// sitting on the compilation's payload, so unlike phase A/B below, order doesn't matter.
const sfs = fs.existsSync(path.join(DIR, `entities-sourcefile-${CHAIN}.ndjson`))
  ? read(`entities-sourcefile-${CHAIN}.ndjson`) : [];

/** Re-apply the attribute types the NDJSON round trip flattened to plain JSON. */
const typeVc = (a, compilationKey) => ({
  ds: str(a.ds), kind: str(a.kind),
  chainid: u64(BigInt(a.chainId)), address: addr(a.address), chainaddr: str(a.chainAddr),
  match: str(a.match), creationmatch: str(a.creationMatch), runtimematch: str(a.runtimeMatch),
  compiler: str(a.compiler), compilerversion: str(a.compilerVersion), language: str(a.language),
  name: str(a.name), verifiedat: u64(BigInt(a.verifiedAt)), matchid: u64(BigInt(a.matchId)),
  isproxy: bool(a.isProxy), proxytype: str(a.proxyType), abihash: str(a.abiHash),
  fncount: i32(a.fnCount), evtcount: i32(a.evtCount),
  optimizer: bool(a.optimizer), optimizerruns: i32(a.optimizerRuns), evmversion: str(a.evmVersion),
  blocknumber: u64(BigInt(a.blockNumber)), deployer: addr(a.deployer),
  ...(compilationKey ? { compilationref: key(compilationKey) } : { compilationfp: str(a.compilationFp) }),
});
const typeSig = (a) => ({
  ds: str(a.ds), kind: str(a.kind), selector: str(a.selector),
  sigtype: str(a.sigtype), variants: i32(a.variants),
});
const typeSf = (a) => ({
  ds: str(a.ds), kind: str(a.kind), hash: str(a.hash), bytes: i32(a.bytes),
});
const typeCp = (a) => ({
  ds: str(a.ds), kind: str(a.kind), fp: str(a.fp),
  compiler: str(a.compiler), compilerversion: str(a.compilerVersion), language: str(a.language),
  name: str(a.name), evmversion: str(a.evmVersion),
  optimizer: bool(a.optimizer), optimizerruns: i32(a.optimizerRuns), usecount: i32(a.useCount),
});

const mkCreate = (attributes, payload) => ({
  payload: jsonToPayload(payload),
  contentType: "application/json",
  attributes,
  expires: ExpirationTime.fromDays(DAYS),
});

/**
 * Encoded size of one create, from the measured cost model: a ~996 byte floor, ~192 bytes
 * per attribute, and the payload roughly 1:1. Guessing this low is not a rounding error —
 * it builds a transaction over the 131,072 byte limit that the node rejects outright.
 */
const encodedSize = (c) => 996 + 192 * Math.max(Object.keys(c.attributes).length - 1, 0) + c.payload.length;

/** Pack by encoded bytes rather than by count, so one fat record cannot blow a batch. */
function pack(items, sizeOf) {
  const out = [];
  let cur = [], bytes = 0;
  for (const it of items) {
    const b = sizeOf(it);
    if (cur.length && (bytes + b > BATCH_BYTE_BUDGET || cur.length >= BATCH_MAX)) {
      out.push(cur); cur = []; bytes = 0;
    }
    cur.push(it); bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

// ---------------------------------------------------------------- checkpoint
const ckpt = fs.existsSync(CKPT)
  ? JSON.parse(fs.readFileSync(CKPT, "utf8"))
  : { chain: CHAIN, compilationKeys: {}, writtenAddresses: [], txs: [] };
const writtenAddr = new Set(ckpt.writtenAddresses);
const save = () => {
  ckpt.writtenAddresses = [...writtenAddr];
  ckpt.updatedAt = new Date().toISOString();
  fs.writeFileSync(CKPT, JSON.stringify(ckpt, null, 2));
};

// ---------------------------------------------------------------- clients
const RPC = process.env.ARKIV_RPC || undefined;
const transport = http(RPC, process.env.ARKIV_API_KEY
  ? { fetchOptions: { headers: { "X-Api-Key": process.env.ARKIV_API_KEY } } }
  : undefined);
const publicClient = createPublicClient({ chain: cheesecake, transport });
const account = privateKeyToAccount(SEND ? process.env.ARKIV_PRIVATE_KEY : "0x" + "11".repeat(32));
const client = createWalletClient({ chain: cheesecake, transport, account });

let currentBlock = BigInt(process.env.HEAD_BLOCK ?? 254_070);
let nonce = 0;
let rpcCalls = 0;

if (SEND) {
  if (!process.env.ARKIV_PRIVATE_KEY) throw new Error("ARKIV_PRIVATE_KEY not set");
  currentBlock = await publicClient.getBlockNumber();                    rpcCalls++;
  const bal = await publicClient.getBalance({ address: account.address }); rpcCalls++;
  nonce = await publicClient.getTransactionCount({ address: account.address }); rpcCalls++;
  console.log(`head ${currentBlock} | ${account.address} | ${Number(bal) / 1e18} GLM | nonce ${nonce}`);
  if (bal === 0n) throw new Error(`${account.address} has no GLM — fund it at the internal faucet`);
} else {
  console.log(`DRY RUN — encoding only, zero RPC calls (assumed head ${currentBlock})`);
}

let txBudgetLeft = MAX_TXS || Infinity;

async function runPhase(label, batches, onSent) {
  let gas = 0n, bytes = 0n, sent = 0;
  console.log(`\n${label}: ${batches.length} batches`);
  for (const [i, batch] of batches.entries()) {
    if (txBudgetLeft <= 0) { console.log(`\n  ${label}: tx budget reached, stopping (resumable)`); break; }
    const creates = batch.map((b) => b.create);
    const built = await client.advanced.buildMutation({ creates }, { currentBlock });
    const calldata = (built.data.length - 2) / 2;
    if (calldata > TX_SIZE_LIMIT - 4_000) {
      throw new Error(`batch ${i + 1} encodes to ${calldata} B, over the ${TX_SIZE_LIMIT} B transaction limit — lower BATCH_BYTES`);
    }
    const g = BigInt(Math.ceil(calldata * GAS_PER_BYTE));
    gas += g; bytes += BigInt(calldata);

    if (!SEND) {
      process.stdout.write(`\r  ${i + 1}/${batches.length} encoded ${calldata.toLocaleString()} B ${(Number(g) / BLOCK_GAS * 100).toFixed(1)}% of a block   `);
      continue;
    }
    // One request: no fee lookup, no nonce lookup, no receipt poll.
    // A full mempool is backpressure, not an error: wait for it to drain and re-send the
    // same nonce rather than losing the batch and leaving a hole in the sequence.
    let txHash;
    for (let attempt = 0; ; attempt++) {
      try {
        ({ txHash } = await client.advanced.sendMutation(
          { creates },
          {
            currentBlock,
            txParams: { nonce, gas: g + 5_000_000n, maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n },
          },
        ));
        nonce++;
        break;
      } catch (e) {
        const msg = errorText(e);
        if (attempt < 20 && /txpool is full|already known|nonce too low|replacement|future transaction/i.test(msg)) {
          const wait = Math.min(3000 * (attempt + 1), 30000);
          process.stdout.write(`
  ${i + 1}/${batches.length} backpressure (${msg.slice(0, 40)}) — waiting ${wait}ms   `);
          await sleep(wait);
          continue;
        }
        throw e;
      }
    }
    rpcCalls++; txBudgetLeft--; sent++;
    ckpt.txs.push({ phase: label, txHash, count: batch.length });
    onSent?.(batch, txHash);
    save();
    process.stdout.write(`\r  ${i + 1}/${batches.length} sent ${txHash.slice(0, 14)}… (${sent} txs, ${rpcCalls} rpc)   `);
  }
  console.log(`\n  ${label}: ${bytes.toLocaleString()} B, ${gas.toLocaleString()} gas, ${SEND ? sent + " txs sent" : batches.length + " txs would be sent"}`);
  return { gas, bytes, sent };
}

// ------------------------------------------------------------- phase 0: sourcefile
// Dedup here is scoped to THIS chain's checkpoint file (written-${CHAIN}.json) --
// consistent with how compilation and signature entities already dedupe, but not a
// GLOBAL dedup across chains or across separate runs of this script.
//
// TODO(santiago): a source file is chain-agnostic by construction (its key is a
// content hash, nothing about chainId), so the same OpenZeppelin ERC20.sol written
// while backfilling chain 1 will be written AGAIN, byte-for-byte, while backfilling
// chain 130 -- the per-chain checkpoint has no way to know it already exists on-chain.
// Closing that gap needs one of two real design decisions, not a default I should
// pick silently:
//   (a) a shared checkpoint keyed by hash alone, outside the per-chain file, so every
//       chain's run consults the same "already written" set; or
//   (b) a live existence-check query (`kind='sourcefile' && hash=…`) before each
//       write, which is correct without shared state but costs one more RPC call per
//       unique file against the 50 requests/hour anonymous budget this devnet enforces.
// (a) is cheaper per run but means the checkpoint file is no longer purely per-chain
// state; (b) keeps every run self-contained but is not free. Your call.
const writtenHash = new Set(ckpt.writtenSourceHashes ?? []);
const pendingSfs = sfs.filter((s) => !writtenHash.has(s.hash));
const sfBatches = pack(
  pendingSfs.map((s) => ({ src: s, create: mkCreate(typeSf(s.attributes), s.payload) })),
  (x) => encodedSize(x.create),
);
const S = await runPhase("sourcefile", sfBatches, (batch) => {
  for (const b of batch) writtenHash.add(b.src.hash);
  ckpt.writtenSourceHashes = [...writtenHash];
});

// ------------------------------------------------------------- phase A
const pendingCps = cps.filter((c) => !ckpt.compilationKeys[c.fingerprint]);
const cpBatches = pack(
  pendingCps.map((c) => ({ src: c, create: mkCreate(typeCp(c.attributes), c.payload) })),
  (x) => encodedSize(x.create),
);
const A = await runPhase("compilation", cpBatches, () => {});

// The created keys come back only from the receipt, so after sending we resolve
// them in one pass rather than one call per batch.
if (SEND && A.sent > 0) {
  console.log("  resolving created compilation keys from receipts…");
  for (const t of ckpt.txs.filter((t) => t.phase === "compilation" && !t.resolved)) {
    const res = await client.advanced.getMutationResult(t.txHash); rpcCalls++;
    if (res.status === "success") { t.keys = res.createdEntities; t.resolved = true; }
  }
  // Map fingerprints to keys in the order they were batched.
  let idx = 0;
  for (const t of ckpt.txs.filter((t) => t.phase === "compilation" && t.resolved)) {
    for (const k of t.keys) { const c = pendingCps[idx++]; if (c) ckpt.compilationKeys[c.fingerprint] = k; }
  }
  save();
  console.log(`  ${Object.keys(ckpt.compilationKeys).length} compilation keys known`);
}

// ------------------------------------------------------------- phase B
const pendingVcs = vcs.filter((v) => !writtenAddr.has(v.address.toLowerCase()));
const vcBatches = pack(
  pendingVcs.map((v) => ({
    src: v,
    create: mkCreate(typeVc(v.attributes, ckpt.compilationKeys[v.attributes.compilationFp]), v.payload),
  })),
  (x) => encodedSize(x.create),
);
const B = await runPhase("verified_contract", vcBatches, (batch) => {
  for (const b of batch) writtenAddr.add(b.src.address.toLowerCase());
});

// ------------------------------------------------------------- phase C: 4-byte
const doneSelectors = new Set(ckpt.writtenSelectors ?? []);
const pendingSigs = sigs.filter((x) => !doneSelectors.has(x.selector));
const sigBatches = pack(
  pendingSigs.map((x) => ({ src: x, create: mkCreate(typeSig(x.attributes), x.payload) })),
  (x) => encodedSize(x.create),
);
const C = await runPhase("signature", sigBatches, (batch) => {
  for (const b of batch) doneSelectors.add(b.src.selector);
  ckpt.writtenSelectors = [...doneSelectors];
});

const totalGas = A.gas + B.gas + C.gas + S.gas;
console.log(`
=== chain ${CHAIN} ===
pending before this run : ${pendingCps.length} compilations, ${pendingVcs.length} contracts, ${pendingSigs.length} selectors, ${pendingSfs.length} source files
calldata encoded        : ${(Number(A.bytes + B.bytes + C.bytes + S.bytes) / 1e6).toFixed(2)} MB
gas                     : ${totalGas.toLocaleString()} (${(Number(totalGas) / BLOCK_GAS).toFixed(1)} blocks' worth)
cost @ 7 wei            : ${(Number(totalGas) * 7 / 1e18).toExponential(3)} GLM
rpc calls used          : ${rpcCalls}${MAX_TXS ? ` (tx cap ${MAX_TXS})` : ""}
written so far          : ${writtenAddr.size}/${vcs.length} contracts, ${doneSelectors.size}/${sigs.length} selectors, ${writtenHash.size}/${sfs.length} source files
mode                    : ${SEND ? "SENT" : "DRY RUN — pass --send to broadcast"}
`);
if (SEND) save();
