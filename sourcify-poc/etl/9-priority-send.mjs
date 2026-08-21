/**
 * 9-priority-send.mjs — land a handful of contracts COMPLETELY, first.
 *
 * The full v2 send is lane-ordered (all blobs, then all code, then …), which is
 * right for throughput and wrong for show-and-tell: at ~45 anonymous transactions
 * per hourly window, nothing is END-TO-END live for days. This script takes a few
 * addresses and writes EVERYTHING they need — their source files, their bytecodes,
 * their compilation, their contract patch — so `parity depth=all` turns
 * `identical` for them today, while 8-write-full.mjs keeps crawling the rest.
 *
 * Shares written-full-130.json with the main writer: anything landed here is
 * skipped there, and vice versa. Run while the main writer is STOPPED (one nonce
 * sequence, one owner).
 *
 *   ADDRESSES=0xa,0xb node 9-priority-send.mjs --send
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
const DAYS = Number(process.env.DAYS ?? 59);
const ADDRESSES = (process.env.ADDRESSES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
if (!ADDRESSES.length) throw new Error("ADDRESSES env var required (comma-separated)");
const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS ?? 2500);
const GAS_PER_BYTE = 80;
const TX_SIZE_LIMIT = 131_072;
const BATCH_BYTE_BUDGET = 105_000;

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
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const vcs = read(`patches2-verified_contract-${CHAIN}.ndjson`).filter((v) => ADDRESSES.includes(v.address));
if (vcs.length !== ADDRESSES.length) throw new Error(`only ${vcs.length}/${ADDRESSES.length} addresses found in the vc lane`);
const fp2s = new Set(vcs.map((v) => v.fp2));
const cps = read(`patches2-compilation-${CHAIN}.ndjson`).filter((c) => fp2s.has(c.fp2));
const neededSf = new Set(cps.flatMap((c) => Object.values(c.payload.sources ?? {})));
const neededCode = new Set([
  ...vcs.flatMap((v) => Object.values(v.payload.codeRefs ?? {})),
  ...cps.flatMap((c) => [c.payload.recompiledCreationHash, c.payload.recompiledRuntimeHash]),
].filter(Boolean));
const sfs = read(`creates2-sourcefile-${CHAIN}.ndjson`).filter((s) => neededSf.has(s.hash));
const codes = read(`creates2-code-${CHAIN}.ndjson`).filter((c) => neededCode.has(c.hash));

const ckpt = JSON.parse(fs.readFileSync(CKPT, "utf8"));
ckpt.done.orphan ??= {};
const save = () => { ckpt.updatedAt = new Date().toISOString(); fs.writeFileSync(CKPT, JSON.stringify(ckpt, null, 2)); };
if (!ckpt.keys) throw new Error("checkpoint has no swept keys — run 8-write-full.mjs --send once first");

console.log(`${vcs.length} contracts -> ${cps.length} compilations, ${sfs.length} source files, ${codes.length} bytecodes`);

// ---------------------------------------------------------------- clients
const transport = http(process.env.ARKIV_RPC || undefined, {
  retryCount: 0, timeout: 20_000,
  ...(process.env.ARKIV_API_KEY ? { fetchOptions: { headers: { "X-Api-Key": process.env.ARKIV_API_KEY } } } : {}),
});
const publicClient = createPublicClient({ chain: cheesecake, transport });
const account = privateKeyToAccount(SEND ? process.env.ARKIV_PRIVATE_KEY : "0x" + "11".repeat(32));
const client = createWalletClient({ chain: cheesecake, transport, account });
let rpcCalls = 0;

async function rateRetry(label, fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      const msg = errorText(e);
      if (attempt < 200 && /429|ANON_RATE_LIMITED|rate.?limit|too many|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg)) {
        console.log(`  ${label}: rate-limited — sleeping 5 min (attempt ${attempt + 1})`);
        await sleep(5 * 60_000);
        continue;
      }
      throw e;
    }
  }
}

let currentBlock = 300_000n, nonce = 0;
if (SEND) {
  currentBlock = await rateRetry("head", () => publicClient.getBlockNumber()); rpcCalls++;
  nonce = await rateRetry("nonce", () => publicClient.getTransactionCount({ address: account.address })); rpcCalls++;
  console.log(`head ${currentBlock} | nonce ${nonce}`);
}

// ---------------------------------------------------------------- ops (same typing as 8-write-full)
const mkCreate = (attributes, payload, contentType = "application/json") => ({
  payload, contentType, attributes, expires: ExpirationTime.fromDays(DAYS),
});
const b64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const typeCp = (a) => ({
  ds: str(a.ds), kind: str(a.kind), fp: str(a.fp),
  compiler: str(a.compiler), compilerversion: str(a.compilerVersion), language: str(a.language),
  name: str(a.name), evmversion: str(a.evmVersion),
  optimizer: bool(a.optimizer), optimizerruns: i32(a.optimizerRuns), usecount: i32(a.useCount),
});

const items = [];
for (const s of sfs) if (!ckpt.done.sourcefile[s.hash]) items.push({
  lane: "sourcefile", id: s.hash,
  create: mkCreate({ ds: str("sourcify"), kind: str("sourcefile"), hash: str(s.attributes.hash), size: i32(s.attributes.size) }, jsonToPayload(s.payload)),
});
for (const c of codes) if (!ckpt.done.code[c.hash]) items.push({
  lane: "code", id: c.hash,
  create: mkCreate({ ds: str("sourcify"), kind: str("code"), hash: str(c.attributes.hash), size: i32(c.attributes.size) }, b64(c.hexB64), "application/octet-stream"),
});

// compilations: patch the on-chain v1 entity when this fp2 is its primary claimant
// (same deterministic rule as 8-write-full), create otherwise.
const byFp1 = new Map();
for (const c of read(`patches2-compilation-${CHAIN}.ndjson`)) (byFp1.get(c.fp1) ?? byFp1.set(c.fp1, []).get(c.fp1)).push(c);
for (const g of byFp1.values()) g.sort((a, b) => b.attributes.useCount - a.attributes.useCount || (a.fp2 < b.fp2 ? -1 : 1));
const cpCreated = [];
for (const c of cps) {
  if (ckpt.done.cp[c.fp2]) continue;
  const group = byFp1.get(c.fp1) ?? [];
  const onchainKey = ckpt.keys.cpByFp1[c.fp1];
  const isPrimary = group[0]?.fp2 === c.fp2 && onchainKey;
  if (isPrimary) {
    items.push({ lane: "cp", id: c.fp2, cpKey: onchainKey, patch: {
      entityKey: onchainKey,
      set: { fp: str(c.attributes.fp), usecount: i32(c.attributes.useCount) },
      payload: jsonToPayload(c.payload),
    }});
  } else {
    cpCreated.push(c);
    items.push({ lane: "cp", id: c.fp2, create: mkCreate(typeCp(c.attributes), jsonToPayload(c.payload)) });
  }
}

const encodedSize = (op) => 996 + 192 * Math.max(Object.keys(op.attributes ?? op.set ?? {}).length - 1, 0) + (op.payload?.length ?? 0);
function pack(list) {
  const out = []; let cur = [], bytes = 0;
  for (const it of list) {
    const b = encodedSize(it.create ?? it.patch);
    if (cur.length && bytes + b > BATCH_BYTE_BUDGET) { out.push(cur); cur = []; bytes = 0; }
    cur.push(it); bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function sendBatches(label, batches) {
  for (const [i, batch] of batches.entries()) {
    const ops = {
      creates: batch.filter((b) => b.create).map((b) => b.create),
      patches: batch.filter((b) => b.patch).map((b) => b.patch),
    };
    if (!ops.creates?.length) delete ops.creates;
    if (!ops.patches?.length) delete ops.patches;
    const built = await client.advanced.buildMutation(ops, { currentBlock });
    const calldata = (built.data.length - 2) / 2;
    if (calldata > TX_SIZE_LIMIT - 4_000) throw new Error(`batch over the tx limit: ${calldata}`);
    if (!SEND) { console.log(`  ${label} ${i + 1}/${batches.length}: ${calldata.toLocaleString()} B (dry)`); continue; }
    const txHash = await rateRetry(`${label} ${i + 1}`, async () => {
      const { txHash } = await client.advanced.sendMutation(ops, {
        currentBlock,
        txParams: { nonce, gas: BigInt(Math.ceil(calldata * GAS_PER_BYTE)) + 5_000_000n, maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n },
      });
      nonce++;
      return txHash;
    });
    rpcCalls++;
    for (const b of batch) ckpt.done[b.lane][b.id] = txHash;
    ckpt.txs.push({ phase: `priority-${label}`, txHash, count: batch.length });
    save();
    console.log(`  ${label} ${i + 1}/${batches.length}: sent ${txHash.slice(0, 14)}… (${calldata.toLocaleString()} B)`);
    await sleep(SEND_DELAY_MS);
  }
}

await sendBatches("creates", pack(items.filter((x) => x.create && x.lane !== "cp")));
await sendBatches("compilation", pack(items.filter((x) => x.lane === "cp")));

// resolve keys for every touched fp2 (patched -> known; created -> discover by fp attr)
if (SEND) {
  for (const it of items) if (it.lane === "cp" && it.cpKey) ckpt.cpKeyByFp2[it.id] = it.cpKey;
  for (const c of cpCreated) {
    if (ckpt.cpKeyByFp2[c.fp2]) continue;
    await sleep(4000);
    const page = await rateRetry("discover", () => publicClient
      .select({ key: true })
      .where(eq("ds", str("sourcify")), eq("kind", str("compilation")), eq("fp", str(c.attributes.fp)))
      .ownedBy(account.address).limit(2).fetch());
    rpcCalls++;
    if (page.entities.length >= 1) ckpt.cpKeyByFp2[c.fp2] = page.entities[0].key;
  }
  save();
}

// vc patches, refs resolved
const vcItems = vcs.filter((v) => !ckpt.done.vc[v.address]).map((v) => {
  const ref = SEND ? ckpt.cpKeyByFp2[v.fp2] : undefined;
  return { lane: "vc", id: v.address, patch: {
    entityKey: SEND ? ckpt.keys.vcByAddr[v.address] : "0x" + "00".repeat(32),
    set: {
      creationcodehash: str(v.attributes.creationCodeHash),
      runtimecodehash: str(v.attributes.runtimeCodeHash),
      compilationfp: str(v.attributes.compilationFp),
      ...(ref ? { compilationref: key(ref) } : {}),
    },
    payload: jsonToPayload(v.payload),
  }};
});
await sendBatches("contracts", pack(vcItems));

console.log(`\npriority pass ${SEND ? "SENT" : "dry"} — ${rpcCalls} rpc calls. Restart 8-write-full.mjs --send for the rest.`);
