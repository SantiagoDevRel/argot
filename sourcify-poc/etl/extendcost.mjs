/**
 * What does keeping an entity alive actually cost? The explainer asserted ~2,000 gas
 * per renewal without measuring it, which a reviewer correctly called inconsistent
 * with the measured create cost. Measure it.
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/attr";
import { ExpirationTime } from "@arkiv-network/sdk/utils";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.ARKIV_RPC;
const pc = createPublicClient({ chain: cheesecake, transport: http(RPC) });
const account = privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY);
const wc = createWalletClient({ chain: cheesecake, transport: http(RPC), account });

// Grab some of our own entities to extend.
const res = await pc.select({ key: true }).where(eq("ds", str("sourcify")), eq("kind", str("signature"))).limit(50).fetch();
const keys = res.entities.map((e) => e.key);
console.log(`extending ${keys.length} entities we own`);

const head = await pc.getBlockNumber();
const extensions = keys.map((entityKey) => ({ entityKey, expires: ExpirationTime.fromDays(90) }));

// Encode locally first: this is the calldata an extension actually costs.
const built = await wc.advanced.buildMutation({ extensions }, { currentBlock: head });
const calldata = (built.data.length - 2) / 2;
console.log(`calldata for ${keys.length} extensions: ${calldata.toLocaleString()} B  (${Math.round(calldata / keys.length)} B each)`);

const nonce = await pc.getTransactionCount({ address: account.address });
const { txHash } = await wc.advanced.sendMutation(
  { extensions },
  { currentBlock: head, txParams: { nonce, gas: 30_000_000n, maxFeePerGas: 1_000_000n, maxPriorityFeePerGas: 1n } },
);
console.log("tx", txHash);
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const p = await wc.advanced.pingTransaction(txHash);
  if (p.status !== "pending") { console.log("status", p.status, "block", p.blockNumber); break; }
}
const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [txHash] }) });
const rec = (await r.json()).result;
if (rec) {
  const gasUsed = parseInt(rec.gasUsed, 16);
  console.log(`\ngasUsed for ${keys.length} extensions: ${gasUsed.toLocaleString()}`);
  console.log(`PER ENTITY PER RENEWAL: ${Math.round(gasUsed / keys.length).toLocaleString()} gas`);
  const perYear = 365 / 60; // two-month lifetime
  const total = (gasUsed / keys.length) * 50_108_114 * perYear;
  console.log(`\nfor 50,108,114 entities at ${perYear.toFixed(1)} renewals/yr:`);
  console.log(`  ${(total / 1e12).toFixed(2)} trillion gas/yr`);
  console.log(`  ${((total / 36e6) * 2 / 3600).toFixed(0)} hours/yr of FULL block utilisation`);
  fs.writeFileSync("data/extend-cost.json", JSON.stringify({
    entities: keys.length, calldata, gasUsed, perEntity: Math.round(gasUsed / keys.length), txHash,
  }, null, 2));
}
