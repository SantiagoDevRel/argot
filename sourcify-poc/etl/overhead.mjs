import { createWalletClient } from "@arkiv-network/sdk";
import * as A from "@arkiv-network/sdk/attr";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const wc = createWalletClient({ chain: cheesecake, transport: http(), account: privateKeyToAccount("0x"+"11".repeat(32)) });
const head = 256001n;
const enc = async (attributes, payloadBytes) => {
  const b = await wc.advanced.buildMutation({ creates: [{
    payload: jsonToPayload({ x: "y".repeat(Math.max(payloadBytes - 12, 0)) }),
    contentType: "application/json", attributes, expires: ExpirationTime.fromDays(60) }] }, { currentBlock: head });
  return (b.data.length - 2) / 2;
};
const base = { ds: A.str("sourcify") };
console.log("calldata bytes for ONE entity, by attribute count and payload size\n");
console.log("attrs  payload=0   payload=100  payload=1000  payload=10000");
for (const n of [1, 5, 10, 20, 30]) {
  const attrs = { ...base };
  for (let i = 1; i < n; i++) attrs["a" + i] = A.str("value" + i);
  const row = [];
  for (const p of [0, 100, 1000, 10000]) row.push((await enc(attrs, p)).toLocaleString().padStart(11));
  console.log(String(n).padStart(5), row.join(" "));
}
console.log("\nper-attribute marginal cost and the fixed floor:");
const a1 = await enc({ ds: A.str("sourcify") }, 0);
const a2 = await enc({ ds: A.str("sourcify"), b: A.str("x") }, 0);
console.log(`  1 attr, empty payload : ${a1.toLocaleString()} B`);
console.log(`  2 attrs, empty payload: ${a2.toLocaleString()} B   -> ~${a2 - a1} B per extra attribute`);
