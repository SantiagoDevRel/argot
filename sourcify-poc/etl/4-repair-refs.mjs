/**
 * 4-repair-refs.mjs — give the contracts that are missing it their compilationref.
 *
 * WHY THIS EXISTS. The first backfill asked for compilation receipts the instant the
 * last send returned, so five of forty-two transactions were still in the mempool and
 * never resolved. Phase B then looked up keys that were not there, and 92.5% of
 * verified_contract entities fell back to carrying `compilationfp` — the fingerprint
 * string — instead of `compilationref`, the typed pointer at the compilation entity.
 * The writer no longer has that bug, but rerunning it would duplicate 2,801 contracts
 * rather than repair them.
 *
 * HOW IT REPAIRS. Not by reconstructing which transaction carried which batch, which
 * would depend on the packing being byte-reproducible. Every compilation entity stores
 * its own fingerprint in its `fp` attribute, so the fingerprint -> key map can be read
 * straight off the chain — the authoritative source, no bookkeeping required. Then each
 * contract missing the pointer is patched: `set` adds the ref, `unset` drops the now
 * redundant string.
 *
 * DRY RUN BY DEFAULT. Pass --send to write.
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { key as keyAttr, str } from "@arkiv-network/sdk/attr";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SEND = process.argv.includes("--send");
const RPC = process.env.ARKIV_RPC;
const BATCH = Number(process.env.PATCH_BATCH ?? 40);
const DELAY_MS = Number(process.env.SEND_DELAY_MS ?? 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The SDK buries node errors several `cause` levels down; flatten before matching. */
const errorText = (e) => {
  const out = [];
  for (let c = e, d = 0; c && d < 8; c = c.cause, d++) {
    for (const k of ["message", "details", "shortMessage"]) if (typeof c?.[k] === "string") out.push(c[k]);
  }
  return out.join(" | ");
};
const val = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);

const pc = createPublicClient({ chain: cheesecake, transport: http(RPC) });
const account = privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY ?? "0x" + "11".repeat(32));
const wc = createWalletClient({ chain: cheesecake, transport: http(RPC), account });

// ---- 1. the fingerprint -> key map, read off the chain itself
console.log("reading compilation entities…");
const fpToKey = new Map();
let dupes = 0;
for await (const e of pc.select({ key: true, attributes: true })
  .where(eq("ds", str("sourcify")), eq("kind", str("compilation")))) {
  const fp = val(e.attributes?.fp);
  if (!fp) continue;
  if (fpToKey.has(fp)) { dupes++; continue; } // orphans from the runs that crashed
  fpToKey.set(fp, e.key);
}
console.log(`  ${fpToKey.size} distinct fingerprints on chain (${dupes} duplicate entities ignored)`);

// ---- 2. which contracts are missing the pointer
console.log("reading verified_contract entities…");
const needs = [];
let already = 0, unmappable = 0;
for await (const e of pc.select({ key: true, attributes: true })
  .where(eq("ds", str("sourcify")), eq("kind", str("verified_contract")))) {
  if (val(e.attributes?.compilationref)) { already++; continue; }
  const fp = val(e.attributes?.compilationfp);
  const target = fp && fpToKey.get(fp);
  if (!target) { unmappable++; continue; }
  needs.push({ entityKey: e.key, target, address: val(e.attributes?.address) });
}
console.log(`  ${already} already linked · ${needs.length} to repair · ${unmappable} with no matching compilation`);

if (!needs.length) { console.log("nothing to do"); process.exit(0); }
if (!SEND) {
  console.log(`\nDRY RUN — would patch ${needs.length} entities in ${Math.ceil(needs.length / BATCH)} transactions.`);
  console.log("first three:");
  for (const n of needs.slice(0, 3)) console.log(`  ${n.address}  ->  ${n.target.slice(0, 18)}…`);
  console.log("\npass --send to write");
  process.exit(0);
}

// ---- 3. patch, in batches, with the same backpressure handling as the writer
const CKPT = path.join(import.meta.dirname, "data", "repaired-refs.json");
const done = new Set(fs.existsSync(CKPT) ? JSON.parse(fs.readFileSync(CKPT, "utf8")).repaired : []);
const pending = needs.filter((n) => !done.has(n.entityKey));
console.log(`\n${pending.length} pending (${done.size} already repaired in an earlier run)`);

let nonce = await pc.getTransactionCount({ address: account.address });
const head = await pc.getBlockNumber();
let sent = 0;

for (let i = 0; i < pending.length; i += BATCH) {
  const slice = pending.slice(i, i + BATCH);
  const patches = slice.map((n) => ({
    entityKey: n.entityKey,
    set: { compilationref: keyAttr(n.target) },
    unset: ["compilationfp"],
  }));
  for (let attempt = 0; ; attempt++) {
    try {
      const { txHash } = await wc.advanced.sendMutation(
        { patches },
        { currentBlock: head, txParams: { nonce, gas: 25_000_000n, maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n } },
      );
      nonce++; sent++;
      slice.forEach((n) => done.add(n.entityKey));
      fs.writeFileSync(CKPT, JSON.stringify({ repaired: [...done], at: new Date().toISOString() }, null, 2));
      process.stdout.write(`\r  ${done.size}/${needs.length} repaired · ${sent} txs · ${txHash.slice(0, 12)}…   `);
      break;
    } catch (e) {
      const msg = errorText(e);
      if (attempt < 20 && /txpool is full|already known|nonce too low|replacement/i.test(msg)) {
        await sleep(Math.min(3000 * (attempt + 1), 30000));
        continue;
      }
      throw e;
    }
  }
  await sleep(DELAY_MS);
}
console.log(`\n\ndone — ${done.size} contracts now carry compilationref, in ${sent} transactions`);
