/**
 * 3-write.mjs — push the transformed entities to Arkiv (Cheesecake).
 *
 * Two phases, because the second references the first:
 *   A. compilation entities        -> collect their on-chain keys
 *   B. verified_contract entities  -> carry `compilationRef` as a typed `key`
 *      attribute pointing at the phase-A entity. That is the join, expressed in
 *      the data model rather than reconstructed by the reader.
 *
 * DRY RUN IS THE DEFAULT. `buildMutation` encodes a batch with zero RPC calls, so
 * the exact calldata and its gas can be measured before a single wei is spent.
 * Pass --send to actually broadcast.
 */
import fs from "node:fs";
import path from "node:path";
import { createWalletClient, createPublicClient } from "@arkiv-network/sdk";
import { addr, bool, i32, key, str, u64 } from "@arkiv-network/sdk/attr";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SEND = process.argv.includes("--send");
const CHAIN = process.env.CHAIN ?? "130";
const LIMIT = Number(process.env.LIMIT ?? 0);        // 0 = everything
const EXPIRES = ExpirationTime.fromDays(Number(process.env.DAYS ?? 30));
const DIR = path.join(import.meta.dirname, "data");
const CKPT = path.join(DIR, `written-${CHAIN}.json`);

// Calldata is 16 gas per non-zero byte and a block holds 36,000,000. Cap a batch
// well under that so one oversized contract can never wedge the run.
const GAS_PER_BYTE = 16, BLOCK_GAS = 36_000_000, BATCH_BYTE_BUDGET = 180_000, BATCH_MAX = 60;

const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const vcs = read(`entities-verified_contract-${CHAIN}.ndjson`);
const cps = read(`entities-compilation-${CHAIN}.ndjson`);
const slice = LIMIT ? vcs.slice(0, LIMIT) : vcs;

/** Re-apply the attribute types the NDJSON round-trip flattened. */
const typeVc = (a, compilationKey) => ({
  ds: str(a.ds), kind: str(a.kind),
  chainId: u64(BigInt(a.chainId)), address: addr(a.address), chainAddr: str(a.chainAddr),
  match: str(a.match), creationMatch: str(a.creationMatch), runtimeMatch: str(a.runtimeMatch),
  compiler: str(a.compiler), compilerVersion: str(a.compilerVersion), language: str(a.language),
  name: str(a.name), verifiedAt: u64(BigInt(a.verifiedAt)), matchId: u64(BigInt(a.matchId)),
  isProxy: bool(a.isProxy), proxyType: str(a.proxyType), abiHash: str(a.abiHash),
  fnCount: i32(a.fnCount), evtCount: i32(a.evtCount),
  optimizer: bool(a.optimizer), optimizerRuns: i32(a.optimizerRuns), evmVersion: str(a.evmVersion),
  blockNumber: u64(BigInt(a.blockNumber)), deployer: addr(a.deployer),
  ...(compilationKey ? { compilationRef: key(compilationKey) } : { compilationFp: str(a.compilationFp) }),
});
const typeCp = (a) => ({
  ds: str(a.ds), kind: str(a.kind), fp: str(a.fp),
  compiler: str(a.compiler), compilerVersion: str(a.compilerVersion), language: str(a.language),
  name: str(a.name), evmVersion: str(a.evmVersion),
  optimizer: bool(a.optimizer), optimizerRuns: i32(a.optimizerRuns), useCount: i32(a.useCount),
});

const mkCreate = (attributes, payload) => ({
  payload: jsonToPayload(payload), contentType: "application/json", attributes, expires: EXPIRES,
});

/** Pack creates into batches bounded by encoded bytes, not by count. */
function pack(creates) {
  const out = []; let cur = [], bytes = 0;
  for (const c of creates) {
    const b = c.payload.length + 1200; // payload + typed-attribute encoding, measured
    if (cur.length && (bytes + b > BATCH_BYTE_BUDGET || cur.length >= BATCH_MAX)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(c); bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

// buildMutation lives on the WALLET client only, so the dry run needs one too. It
// never broadcasts, so an ephemeral key is fine and no funds are involved. Passing
// currentBlock explicitly makes the whole dry run cost ZERO RPC calls -- which
// matters, because the anonymous budget on this devnet is 50 requests per hour.
const RPC = process.env.ARKIV_RPC || undefined;
const transport = http(RPC, process.env.ARKIV_API_KEY ? { fetchOptions: { headers: { "X-Api-Key": process.env.ARKIV_API_KEY } } } : undefined);
const publicClient = createPublicClient({ chain: cheesecake, transport });

const DRY_BLOCK = BigInt(process.env.HEAD_BLOCK ?? 254_070);
let currentBlock = DRY_BLOCK;
const account = privateKeyToAccount(
  SEND ? process.env.ARKIV_PRIVATE_KEY : "0x" + "11".repeat(32),
);
const client = createWalletClient({ chain: cheesecake, transport, account });

if (SEND) {
  if (!process.env.ARKIV_PRIVATE_KEY) throw new Error("ARKIV_PRIVATE_KEY not set");
  currentBlock = await publicClient.getBlockNumber();
  const bal = await publicClient.getBalance({ address: account.address });
  console.log(`head block ${currentBlock} | wallet ${account.address} | ${Number(bal) / 1e18} GLM`);
  if (bal === 0n) throw new Error(`${account.address} has no GLM -- fund it at the internal faucet`);
} else {
  console.log(`DRY RUN -- encoding only, zero RPC calls (assumed head block ${currentBlock})`);
}

async function run(label, creates, keySink) {
  const batches = pack(creates);
  let gas = 0n, bytes = 0n, n = 0;
  console.log(`\n${label}: ${creates.length} entities in ${batches.length} batches`);
  for (const [i, batch] of batches.entries()) {
    const built = await client.advanced.buildMutation({ creates: batch }, { currentBlock });
    const calldata = (built.data.length - 2) / 2;
    const g = BigInt(Math.ceil(calldata * GAS_PER_BYTE));
    gas += g; bytes += BigInt(calldata);
    if (SEND) {
      const res = await client.mutateEntities({ creates: batch });
      keySink?.(batch, res.createdEntities);
      n += res.createdEntities.length;
      process.stdout.write(`\r  batch ${i + 1}/${batches.length} sent  tx ${res.txHash.slice(0, 12)}…  ${n} written   `);
    } else {
      process.stdout.write(`\r  batch ${i + 1}/${batches.length} encoded  ${calldata.toLocaleString()} B  ${g.toLocaleString()} gas (${((Number(g) / BLOCK_GAS) * 100).toFixed(1)}% of a block)   `);
    }
  }
  const glm = Number(gas) * 7 / 1e18; // gas price observed at 7 wei
  console.log(`\n  ${label}: ${bytes.toLocaleString()} B calldata, ${gas.toLocaleString()} gas, ~${glm.toExponential(2)} GLM at 7 wei, ${batches.length} txs`);
  return { gas, bytes, batches: batches.length };
}

// --- phase A: compilations
const cpKeyByFp = new Map();
const cpCreates = cps.map((c) => mkCreate(typeCp(c.attributes), c.payload));
const a = await run("compilation", cpCreates, (batch, keys) =>
  batch.forEach((_, j) => cpKeyByFp.set(cps[[...cpKeyByFp.keys()].length].fingerprint, keys[j])));

// --- phase B: verified contracts (joined to phase A when we really wrote them)
const vcCreates = slice.map((v) => mkCreate(typeVc(v.attributes, SEND ? cpKeyByFp.get(v.attributes.compilationFp) : null), v.payload));
const b = await run("verified_contract", vcCreates, () => {});

const total = a.gas + b.gas;
console.log(`
=== TOTAL for chain ${CHAIN} (${slice.length} contracts, ${cps.length} compilations) ===
calldata      ${(Number(a.bytes + b.bytes) / 1e6).toFixed(2)} MB
gas           ${total.toLocaleString()}   (${(Number(total) / BLOCK_GAS).toFixed(1)} blocks' worth of the 36,000,000 limit)
cost @ 7 wei  ${(Number(total) * 7 / 1e18).toExponential(3)} GLM
transactions  ${a.batches + b.batches}
mode          ${SEND ? "SENT" : "DRY RUN (encode only, zero RPC writes) — pass --send to broadcast"}
`);
if (SEND) fs.writeFileSync(CKPT, JSON.stringify({ chain: CHAIN, at: new Date().toISOString(), compilations: [...cpKeyByFp] }, null, 2));
