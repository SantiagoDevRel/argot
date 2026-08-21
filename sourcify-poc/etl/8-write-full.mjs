/**
 * 8-write-full.mjs — push the v2 (100%) pass to Arkiv: create the new lanes
 * (code, sourcefile, blob, split-off compilations), PATCH the entities that are
 * already on-chain (compilation payloads grow; verified_contracts gain two
 * attributes and a payload).
 *
 * Same manners as 3-write.mjs, which this copies deliberately (that file's send
 * loop has 568 real transactions behind it and no isMain guard, so importing it
 * would run it): advanced path (one RPC per batch), byte-packed batches, 2.5s
 * pacing, txpool backpressure = wait and re-send the same nonce, checkpoint after
 * every transaction, DRY RUN by default.
 *
 * What is new here:
 *  - phase K recovers the on-chain entity keys the local checkpoint no longer has
 *    (one cursor-paginated, attribute-only sweep; ~21 reads for the whole chain).
 *  - PATCHES: a patch names the entityKey, sets only the new attributes, and
 *    replaces the payload. Content types are kept (patch semantics).
 *  - No key bookkeeping for code/sourcefile/blob: they are content-addressed, so
 *    readers find them by `kind + hash` query, never by entity key.
 *  - Compilations the v2 fingerprint split off a conflated v1 one are CREATED, and
 *    their keys discovered afterwards by querying their `fp` attribute — content
 *    addressing again, instead of receipt bookkeeping.
 *  - Every verified_contract patch re-sets `compilationref`, unconditionally: it is
 *    idempotent, self-heals any ref the resolution outage left dangling, and costs
 *    ~200 bytes per contract.
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { addr, bool, i32, key, str, u64 } from "@arkiv-network/sdk/attr";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SEND = process.argv.includes("--send");
const CHAIN = process.env.CHAIN ?? "130";
const DAYS = Number(process.env.DAYS ?? 60);
const MAX_TXS = Number(process.env.MAX_TXS ?? 0);
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS ?? 2500);
const GAS_PER_BYTE = Number(process.env.GAS_PER_BYTE ?? 80);
const BLOCK_GAS = 36_000_000;
const TX_SIZE_LIMIT = 131_072;
const BATCH_BYTE_BUDGET = Number(process.env.BATCH_BYTES ?? 105_000);
const BATCH_MAX = Number(process.env.BATCH_MAX ?? 400);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const CKPT = path.join(DIR, `written-full-${CHAIN}.json`);
const read = (f) => fs.existsSync(path.join(DIR, f))
  ? fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];

const codes = read(`creates2-code-${CHAIN}.ndjson`);
const sfs = read(`creates2-sourcefile-${CHAIN}.ndjson`);
const blobs = read(`creates2-blob-${CHAIN}.ndjson`);
const cps = read(`patches2-compilation-${CHAIN}.ndjson`);
const vcs = read(`patches2-verified_contract-${CHAIN}.ndjson`);
if (!vcs.length) throw new Error("no patches2-* files — run 7-transform-full.mjs first");

// ---------------------------------------------------------------- checkpoint
const ckpt = fs.existsSync(CKPT)
  ? JSON.parse(fs.readFileSync(CKPT, "utf8"))
  : { chain: CHAIN, keys: null, cpKeyByFp2: {}, done: { blob: {}, code: {}, sourcefile: {}, cp: {}, vc: {} }, txs: [] };
const save = () => { ckpt.updatedAt = new Date().toISOString(); fs.writeFileSync(CKPT, JSON.stringify(ckpt, null, 2)); };

// ---------------------------------------------------------------- clients
const RPC = process.env.ARKIV_RPC || undefined;
/**
 * retryCount 0, deliberately: on 429 the Bouncer sends `Retry-After: <up to 3600s>`
 * and viem's default retry HONORS it — the process sits in a silent 13-minute wait
 * per attempt, which reads as a hang. Throw instead, and let rateRetry() own the
 * waiting, visibly.
 */
const transport = http(RPC, {
  retryCount: 0,
  timeout: 20_000,
  ...(process.env.ARKIV_API_KEY
    ? { fetchOptions: { headers: { "X-Api-Key": process.env.ARKIV_API_KEY } } }
    : {}),
});
const publicClient = createPublicClient({ chain: cheesecake, transport });
const account = privateKeyToAccount(SEND ? process.env.ARKIV_PRIVATE_KEY : "0x" + "11".repeat(32));
const client = createWalletClient({ chain: cheesecake, transport, account });

let currentBlock = BigInt(process.env.HEAD_BLOCK ?? 300_000);
let nonce = 0;
let rpcCalls = 0;

/**
 * MEASURED, the hard way: WITHOUT an API key, the Bouncer meters EVERYTHING —
 * including eth_sendRawTransaction — at 50 requests/hour per IP, answering
 * `429 ANON_RATE_LIMITED` with a ratelimit header. So anonymously this script is a
 * CRAWLER: ~45 transactions per hourly window, sleeping through the rest, fully
 * checkpointed. With ARKIV_API_KEY set it is a ~100-minute run. Every RPC touch
 * goes through this wrapper so an hour-long window never kills the process.
 */
async function rateRetry(label, fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      const msg = errorText(e);
      if (attempt < 200 && /429|ANON_RATE_LIMITED|rate.?limit|too many|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg)) {
        const wait = 5 * 60_000;
        console.log(`\n  ${label}: rate-limited (${msg.slice(0, 80)}) — sleeping ${wait / 60000} min (attempt ${attempt + 1})`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

if (SEND) {
  if (!process.env.ARKIV_PRIVATE_KEY) throw new Error("ARKIV_PRIVATE_KEY not set");
  currentBlock = await rateRetry("head", () => publicClient.getBlockNumber());                       rpcCalls++;
  const bal = await rateRetry("balance", () => publicClient.getBalance({ address: account.address }));  rpcCalls++;
  nonce = await rateRetry("nonce", () => publicClient.getTransactionCount({ address: account.address })); rpcCalls++;
  console.log(`head ${currentBlock} | ${account.address} | ${Number(bal) / 1e18} GLM | nonce ${nonce}`);
  if (bal === 0n) throw new Error(`${account.address} has no GLM — fund it at the internal faucet`);
  if (!process.env.ARKIV_API_KEY) console.warn("!! no ARKIV_API_KEY — anonymous crawl mode, ~45 txs per hourly window");
} else {
  console.log(`DRY RUN — encoding only, zero RPC calls (assumed head ${currentBlock})`);
}

// ---------------------------------------------------------------- phase K: keys
/**
 * One attribute-only sweep per kind, cursor-paginated at the 200 cap. The maps this
 * builds (address -> key, v1 fp -> key) are what lets a patch name its target. Only
 * needed — and only run — when sending.
 */
/**
 * Review finding applied: the chain is known to carry DUPLICATE entities for one
 * identity — 4-repair-refs.mjs already counted compilation orphans from crashed v1
 * runs. So the sweep collects ALL keys per identity, picks the lexicographically
 * smallest as canonical (deterministic across resumed runs), and returns the rest
 * as orphans to be retired.
 */
async function sweepKeys() {
  const vcAll = new Map(), cpAll = new Map();
  for (const [kind, into, attrName] of [["verified_contract", vcAll, "address"], ["compilation", cpAll, "fp"]]) {
    let page = await publicClient
      .select({ key: true, attributes: { [attrName]: true } })
      .where(eq("ds", str("sourcify")), eq("kind", str(kind)))
      .ownedBy(account.address)
      .limit(200)
      .fetch();
    rpcCalls++;
    for (;;) {
      for (const e of page.entities) {
        const raw = e.attributes?.[attrName];
        const v = raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
        if (typeof v === "string") (into.get(v.toLowerCase()) ?? into.set(v.toLowerCase(), []).get(v.toLowerCase())).push(e.key);
      }
      if (!page.hasNextPage()) break;
      page = await page.next(); rpcCalls++;
    }
  }
  const canonical = (all) => {
    const map = {}, orphans = [];
    for (const [id, keys] of all) {
      keys.sort();
      map[id] = keys[0];
      orphans.push(...keys.slice(1));
    }
    return { map, orphans };
  };
  const vc = canonical(vcAll), cp = canonical(cpAll);
  if (vc.orphans.length || cp.orphans.length) {
    console.warn(`  duplicates on-chain: ${vc.orphans.length} verified_contract + ${cp.orphans.length} compilation orphans — will be retired (ds -> sourcify-orphan)`);
  }
  return { vcByAddr: vc.map, cpByFp1: cp.map, orphans: [...vc.orphans, ...cp.orphans], sweptAt: new Date().toISOString() };
}
if (SEND && !ckpt.keys) {
  console.log("sweeping on-chain entity keys…");
  ckpt.keys = await sweepKeys();
  save();
}
if (SEND) {
  console.log(`keys: ${Object.keys(ckpt.keys.vcByAddr).length} verified_contracts, ${Object.keys(ckpt.keys.cpByFp1).length} compilations (swept ${ckpt.keys.sweptAt})`);
}
const vcKeyOf = (a) => ckpt.keys?.vcByAddr[a.toLowerCase()];
const cpKeyOfFp1 = (fp) => ckpt.keys?.cpByFp1[fp.toLowerCase()];
const DUMMY_KEY = ("0x" + "00".repeat(32));

// ---------------------------------------------------------------- op builders
const mkCreate = (attributes, payload, contentType = "application/json") => ({
  payload, contentType, attributes, expires: ExpirationTime.fromDays(DAYS),
});
/** Encoded size of one op — the measured model. Patches carry the same shape of cost. */
const encodedSize = (op) => 996 + 192 * Math.max(Object.keys(op.attributes ?? op.set ?? {}).length - 1, 0) + (op.payload?.length ?? 0);

const big = (v) => BigInt(v);
const typeVcCreate = (a, compilationKey) => ({
  ds: str(a.ds), kind: str(a.kind),
  chainid: u64(big(a.chainId)), address: addr(a.address), chainaddr: str(a.chainAddr),
  match: str(a.match), creationmatch: str(a.creationMatch), runtimematch: str(a.runtimeMatch),
  compiler: str(a.compiler), compilerversion: str(a.compilerVersion), language: str(a.language),
  name: str(a.name), verifiedat: u64(big(a.verifiedAt)), matchid: u64(big(a.matchId)),
  isproxy: bool(a.isProxy), proxytype: str(a.proxyType), abihash: str(a.abiHash),
  fncount: i32(a.fnCount), evtcount: i32(a.evtCount),
  optimizer: bool(a.optimizer), optimizerruns: i32(a.optimizerRuns), evmversion: str(a.evmVersion),
  blocknumber: u64(big(a.blockNumber)), deployer: addr(a.deployer),
  creationcodehash: str(a.creationCodeHash), runtimecodehash: str(a.runtimeCodeHash),
  // Never mint a ref to a key that was not resolved — fall back to the fp join,
  // the same degradation 3-write.mjs uses when a receipt never resolves.
  ...(compilationKey ? { compilationref: key(compilationKey) } : { compilationfp: str(a.compilationFp) }),
});
const typeCp = (a) => ({
  ds: str(a.ds), kind: str(a.kind), fp: str(a.fp),
  compiler: str(a.compiler), compilerversion: str(a.compilerVersion), language: str(a.language),
  name: str(a.name), evmversion: str(a.evmVersion),
  optimizer: bool(a.optimizer), optimizerruns: i32(a.optimizerRuns), usecount: i32(a.useCount),
});

// ---------------------------------------------------------------- send loop
let txBudgetLeft = MAX_TXS || Infinity;
function pack(items, sizeOf) {
  const out = [];
  let cur = [], bytes = 0;
  for (const it of items) {
    const b = sizeOf(it);
    if (cur.length && (bytes + b > BATCH_BYTE_BUDGET || cur.length >= BATCH_MAX)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(it); bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** `ops` per batch item: {create} or {patch}. Mixed batches are fine — one tx applies creates then patches. */
async function runPhase(label, batches, onSent) {
  let gas = 0n, bytes = 0n, sent = 0;
  console.log(`\n${label}: ${batches.length} batches`);
  for (const [i, batch] of batches.entries()) {
    if (txBudgetLeft <= 0) { console.log(`\n  ${label}: tx budget reached, stopping (resumable)`); break; }
    const ops = {
      creates: batch.filter((b) => b.create).map((b) => b.create),
      patches: batch.filter((b) => b.patch).map((b) => b.patch),
    };
    if (!ops.creates.length) delete ops.creates;
    if (!ops.patches.length) delete ops.patches;
    const built = await client.advanced.buildMutation(ops, { currentBlock });
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
    let txHash;
    for (let attempt = 0; ; attempt++) {
      try {
        ({ txHash } = await client.advanced.sendMutation(ops, {
          currentBlock,
          txParams: { nonce, gas: g + 5_000_000n, maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n },
        }));
        nonce++;
        break;
      } catch (e) {
        const msg = errorText(e);
        /**
         * "nonce too low" after OUR send usually means the earlier attempt LANDED and
         * only the SDK's response failed — this account is the sole signer, sending
         * sequentially, so a consumed nonce is our transaction. Confirm against the
         * chain and move on instead of re-sending the same nonce forever (the first
         * run of this script looped exactly there).
         */
        if (/nonce too low/i.test(msg)) {
          const chainNonce = await rateRetry("nonce-check", () => publicClient.getTransactionCount({ address: account.address })); rpcCalls++;
          if (chainNonce > nonce) {
            process.stdout.write(`\n  ${i + 1}/${batches.length} nonce ${nonce} already consumed on-chain (chain says ${chainNonce}) — counting it as sent   `);
            txHash = `0x-consumed-nonce-${nonce}`;
            nonce = chainNonce;
            break;
          }
        }
        // Rate-limit is backpressure with an HOUR-long clock: sleep big, never die.
        if (attempt < 200 && /429|ANON_RATE_LIMITED|too many|rate.?limit/i.test(msg)) {
          process.stdout.write(`\n  ${i + 1}/${batches.length} rate-limited — sleeping 5 min (window resets hourly)   `);
          await sleep(5 * 60_000);
          continue;
        }
        if (attempt < 30 && /txpool is full|already known|nonce too low|replacement|future transaction/i.test(msg)) {
          const wait = Math.min(3000 * (attempt + 1), 30000);
          process.stdout.write(`\n  ${i + 1}/${batches.length} backpressure [${msg.slice(0, 180)}] — waiting ${wait}ms   `);
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
    await sleep(SEND_DELAY_MS);
  }
  console.log(`\n  ${label}: ${bytes.toLocaleString()} B, ${gas.toLocaleString()} gas, ${SEND ? sent + " txs sent" : batches.length + " txs would be sent"}`);
  return { gas, bytes, sent };
}

// ---------------------------------------------------------------- phase O: retire orphans
// A retired duplicate keeps its bytes but leaves the dataset: every reader filters
// eq(ds, "sourcify"), so flipping `ds` removes it from every query without a delete
// and without touching any read path.
const pendingOrphans = (SEND ? (ckpt.keys?.orphans ?? []) : []).filter((k) => !ckpt.done.orphan?.[k]);
ckpt.done.orphan ??= {};
const orphanBatches = pack(pendingOrphans.map((k) => ({
  id: k, lane: "orphan",
  patch: { entityKey: k, set: { ds: str("sourcify-orphan") } },
})), (x) => encodedSize(x.patch));

// ---------------------------------------------------------------- phase A: new content-addressed lanes
const b64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));

const pendingBlobs = blobs.filter((b) => !ckpt.done.blob[`${b.hash}:${b.attributes.part}`]);
const blobBatches = pack(pendingBlobs.map((b) => ({
  id: `${b.hash}:${b.attributes.part}`, lane: "blob",
  create: mkCreate(
    // `size`, not `bytes` — "bytes" is reserved by the query language.
    { ds: str("sourcify"), kind: str("blob"), hash: str(b.attributes.hash), part: i32(b.attributes.part), parts: i32(b.attributes.parts), size: i32(b.attributes.size) },
    b64(b.chunkB64), "application/octet-stream",
  ),
})), (x) => encodedSize(x.create));

const pendingCodes = codes.filter((c) => !ckpt.done.code[c.hash]);
const codeBatches = pack(pendingCodes.map((c) => ({
  id: c.hash, lane: "code",
  create: mkCreate(
    { ds: str("sourcify"), kind: str("code"), hash: str(c.attributes.hash), size: i32(c.attributes.size) },
    b64(c.hexB64), "application/octet-stream",
  ),
})), (x) => encodedSize(x.create));

const pendingSfs = sfs.filter((s) => !ckpt.done.sourcefile[s.hash]);
const sfBatches = pack(pendingSfs.map((s) => ({
  id: s.hash, lane: "sourcefile",
  create: mkCreate(
    { ds: str("sourcify"), kind: str("sourcefile"), hash: str(s.attributes.hash), size: i32(s.attributes.size) },
    jsonToPayload(s.payload),
  ),
})), (x) => encodedSize(x.create));

const markDone = (lane) => (batch, txHash) => { for (const b of batch) if (b.lane === lane || !b.lane) ckpt.done[lane][b.id] = txHash; };
const OR = await runPhase("orphan-retire", orphanBatches, markDone("orphan"));
const BL = await runPhase("blob", blobBatches, markDone("blob"));
const CO = await runPhase("code", codeBatches, markDone("code"));
const SF = await runPhase("sourcefile", sfBatches, markDone("sourcefile"));

// ---------------------------------------------------------------- phase B: compilations
/**
 * Partition: a v1 fingerprint that exists on-chain is PATCHED by its highest-useCount
 * v2 claimant; every other row (split siblings, fingerprints the chain has never
 * seen) is CREATED. The claimant rule is deterministic, so a resumed run partitions
 * identically.
 */
const byFp1 = new Map();
for (const c of cps) (byFp1.get(c.fp1) ?? byFp1.set(c.fp1, []).get(c.fp1)).push(c);
for (const g of byFp1.values()) g.sort((a, b) => b.attributes.useCount - a.attributes.useCount || (a.fp2 < b.fp2 ? -1 : 1));

const cpPatchRows = [], cpCreateRows = [];
for (const [fp1, group] of byFp1) {
  const onchainKey = SEND ? cpKeyOfFp1(fp1) : DUMMY_KEY;
  group.forEach((row, idx) => {
    if (idx === 0 && onchainKey) cpPatchRows.push({ row, entityKey: onchainKey });
    else cpCreateRows.push(row);
  });
}
console.log(`\ncompilations: ${cpPatchRows.length} patches, ${cpCreateRows.length} creates (${[...byFp1.values()].filter((g) => g.length > 1).length} v1 fingerprints split)`);

const pendingCpCreates = cpCreateRows.filter((c) => !ckpt.done.cp[c.fp2]);
const cpCreateBatches = pack(pendingCpCreates.map((c) => ({
  id: c.fp2, lane: "cp",
  create: mkCreate(typeCp(c.attributes), jsonToPayload(c.payload)),
})), (x) => encodedSize(x.create));
const CPC = await runPhase("compilation-create", cpCreateBatches, (batch, txHash) => { for (const b of batch) ckpt.done.cp[b.id] = txHash; });

const pendingCpPatches = cpPatchRows.filter((c) => !ckpt.done.cp[c.row.fp2]);
const cpPatchBatches = pack(pendingCpPatches.map((c) => ({
  id: c.row.fp2, lane: "cp",
  patch: {
    entityKey: c.entityKey,
    set: { fp: str(c.row.attributes.fp), usecount: i32(c.row.attributes.useCount) },
    payload: jsonToPayload(c.row.payload),
  },
})), (x) => encodedSize(x.patch));
const CPP = await runPhase("compilation-patch", cpPatchBatches, (batch, txHash) => {
  for (const b of batch) ckpt.done.cp[b.id] = txHash;
  for (const c of cpPatchRows) if (!ckpt.cpKeyByFp2[c.row.fp2] && ckpt.done.cp[c.row.fp2]) ckpt.cpKeyByFp2[c.row.fp2] = c.entityKey;
});

/**
 * Discover the keys of created compilations by the attribute that names them —
 * content addressing instead of receipt bookkeeping. One read per created
 * fingerprint, only ever paid once (the map is checkpointed).
 */
if (SEND) {
  for (const c of cpPatchRows) if (ckpt.done.cp[c.row.fp2]) ckpt.cpKeyByFp2[c.row.fp2] = c.entityKey;
  const undiscovered = cpCreateRows.filter((c) => ckpt.done.cp[c.fp2] && !ckpt.cpKeyByFp2[c.fp2]);
  if (undiscovered.length) {
    console.log(`\ndiscovering ${undiscovered.length} created compilation keys…`);
    // Creates land when their transaction does; give the last batch a moment.
    await sleep(6000);
    // These are METERED reads — on the anonymous tier a burst this size can 429.
    // A failure here is not fatal: the fp stays unresolved, the contracts that need
    // it are SKIPPED below (not mis-pointed), and a resumed run picks them up.
    for (const c of undiscovered) {
      try {
        const page = await publicClient
          .select({ key: true })
          .where(eq("ds", str("sourcify")), eq("kind", str("compilation")), eq("fp", str(c.attributes.fp)))
          .ownedBy(account.address)
          .limit(2)
          .fetch();
        rpcCalls++;
        if (page.entities.length === 1) ckpt.cpKeyByFp2[c.fp2] = page.entities[0].key;
        else console.warn(`  fp ${c.attributes.fp.slice(0, 18)}…: ${page.entities.length} entities found — leaving unresolved`);
      } catch (e) {
        console.warn(`  discovery stopped (${errorText(e).slice(0, 60)}) — ${Object.keys(ckpt.cpKeyByFp2).length} resolved so far, rest on the resumed run`);
        break;
      }
      await sleep(250);
    }
    save();
  }
}

// ---------------------------------------------------------------- phase C: verified contracts
const vcPatchRows = [], vcCreateRows = [];
for (const v of vcs) {
  const k = SEND ? vcKeyOf(v.address) : DUMMY_KEY;
  if (k) vcPatchRows.push({ row: v, entityKey: k });
  else if (SEND) vcCreateRows.push(v);
  else vcPatchRows.push({ row: v, entityKey: DUMMY_KEY });
}
const cpRefOf = (fp2) => (SEND ? ckpt.cpKeyByFp2[fp2] : DUMMY_KEY);

/**
 * A contract whose v2 compilation key is UNRESOLVED (a discovery read failed) is
 * skipped, not patched ref-less: patching the payload while the old ref points at a
 * compilation that now belongs to a different fingerprint would serve the wrong
 * contract's docs — the exact wrongness the fingerprint fix exists to end.
 */
let vcSkippedNoRef = 0;
const pendingVcPatches = vcPatchRows.filter((v) => {
  if (ckpt.done.vc[v.row.address]) return false;
  if (SEND && !cpRefOf(v.row.fp2)) { vcSkippedNoRef++; return false; }
  return true;
});
if (vcSkippedNoRef) console.warn(`  ${vcSkippedNoRef} verified_contract patches deferred — their compilation key is not resolved yet (resumable)`);
const vcPatchBatches = pack(pendingVcPatches.map((v) => {
  const ref = cpRefOf(v.row.fp2);
  return {
    id: v.row.address, lane: "vc",
    patch: {
      entityKey: v.entityKey,
      set: {
        creationcodehash: str(v.row.attributes.creationCodeHash),
        runtimecodehash: str(v.row.attributes.runtimeCodeHash),
        compilationfp: str(v.row.attributes.compilationFp),
        ...(ref ? { compilationref: key(ref) } : {}),
      },
      payload: jsonToPayload(v.row.payload),
    },
  };
}), (x) => encodedSize(x.patch));
const VCP = await runPhase("verified_contract-patch", vcPatchBatches, (batch, txHash) => { for (const b of batch) ckpt.done.vc[b.id] = txHash; });

const pendingVcCreates = vcCreateRows.filter((v) => !ckpt.done.vc[v.address]);
const vcCreateBatches = pack(pendingVcCreates.map((v) => ({
  id: v.address, lane: "vc",
  create: mkCreate(typeVcCreate(v.attributes, cpRefOf(v.fp2)), jsonToPayload(v.payload)),
})), (x) => encodedSize(x.create));
const VCC = await runPhase("verified_contract-create", vcCreateBatches, (batch, txHash) => { for (const b of batch) ckpt.done.vc[b.id] = txHash; });

// ---------------------------------------------------------------- summary
const phases = [OR, BL, CO, SF, CPC, CPP, VCP, VCC];
const totalGas = phases.reduce((a, p) => a + p.gas, 0n);
const totalBytes = phases.reduce((a, p) => a + p.bytes, 0n);
const totalTxs = SEND ? phases.reduce((a, p) => a + p.sent, 0) : blobBatches.length + codeBatches.length + sfBatches.length + cpCreateBatches.length + cpPatchBatches.length + vcPatchBatches.length + vcCreateBatches.length;
console.log(`
=== chain ${CHAIN} · v2 full replication ===
lanes                   : ${blobs.length} blobs, ${codes.length} codes, ${sfs.length} source files, ${cps.length} compilations, ${vcs.length} contracts
calldata encoded        : ${(Number(totalBytes) / 1e6).toFixed(2)} MB
gas                     : ${totalGas.toLocaleString()} (${(Number(totalGas) / BLOCK_GAS).toFixed(1)} blocks' worth)
cost @ 7 wei            : ${(Number(totalGas) * 7 / 1e18).toExponential(3)} GLM
transactions            : ${totalTxs}${MAX_TXS ? ` (cap ${MAX_TXS})` : ""}  (~${(totalTxs * (SEND_DELAY_MS / 1000) / 60).toFixed(0)} min at ${SEND_DELAY_MS}ms pacing)
rpc calls used          : ${rpcCalls}
mode                    : ${SEND ? "SENT" : "DRY RUN — pass --send to broadcast"}
`);
if (SEND) {
  save();
  // Refresh the counts the app's /api/stats serves (counting live costs ~87 round
  // trips and once timed out a Vercel function — see that route's comment).
  const countsPath = path.join(import.meta.dirname, "..", "kb", "counts.json");
  const prev = fs.existsSync(countsPath) ? JSON.parse(fs.readFileSync(countsPath, "utf8")) : {};
  fs.writeFileSync(countsPath, JSON.stringify({
    ...prev,
    chain: CHAIN, chainName: prev.chainName ?? "Unichain",
    verified_contract: Object.keys(ckpt.done.vc).length,
    compilation: Object.keys(ckpt.done.cp).length,
    sourcefile: Object.keys(ckpt.done.sourcefile).length,
    code: Object.keys(ckpt.done.code).length,
    blob: Object.keys(ckpt.done.blob).length,
    transactions: (prev.transactions ?? 0) + phases.reduce((a, p) => a + p.sent, 0),
    v2WrittenAt: new Date().toISOString(),
    publisher: account.address,
  }, null, 2));
  console.log("kb/counts.json refreshed");
}
