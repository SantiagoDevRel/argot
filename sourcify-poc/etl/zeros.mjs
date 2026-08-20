import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import * as A from "@arkiv-network/sdk/attr";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const t = http(process.env.ARKIV_RPC);
const pc = createPublicClient({ chain: cheesecake, transport: t });
const account = privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY);
const wc = createWalletClient({ chain: cheesecake, transport: t, account });
const head = BigInt(process.env.HEAD || 256001);
const cases = [
  ["i32(0)",            () => A.i32(0)],
  ["i32(1)",            () => A.i32(1)],
  ["i32(-1)",           () => A.i32(-1)],
  ["u64(0n)",           () => A.u64(0n)],
  ["u256(0n)",          () => A.u256(0n)],
  ["str('')",           () => A.str("")],
  ["bool(false)",       () => A.bool(false)],
  ["dec('0')",          () => A.dec("0")],
  ["addr(zero addr)",   () => A.addr("0x0000000000000000000000000000000000000000")],
  ["i32(1000000000)",   () => A.i32(1000000000)],
  ["u64(1787169059n)",  () => A.u64(1787169059n)],
];
console.log("zero / edge values on Cheesecake\n");
for (const [label, mk] of cases) {
  let attributes;
  try { attributes = { ds: A.str("probe"), v: mk() }; }
  catch (e) { console.log(`  LOCAL-THROW  ${label.padEnd(20)} ${String(e.message).slice(0,60)}`); continue; }
  try {
    const built = await wc.advanced.buildMutation(
      { creates: [{ payload: jsonToPayload({ t: 1 }), contentType: "application/json", attributes, expires: ExpirationTime.fromDays(30) }] },
      { currentBlock: head });
    await pc.call({ to: built.to, data: built.data, account: account.address });
    console.log(`  OK           ${label}`);
  } catch { console.log(`  REVERT       ${label}   <-- rejected by the node`); }
}
