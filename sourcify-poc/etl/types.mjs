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
const K = "0x" + "ab".repeat(32);

const cases = [
  ["str",     () => A.str("hello")],
  ["bool",    () => A.bool(true)],
  ["i32",     () => A.i32(42)],
  ["u64",     () => A.u64(42n)],
  ["u256",    () => A.u256(42n)],
  ["dec",     () => A.dec("4.5")],
  ["addr",    () => A.addr("0x4691f23a5da293d31e93f129287402063e95ad21")],
  ["bytes32", () => A.bytes32(K)],
  ["key",     () => A.key(K)],
  ["bare number (inferred)", () => 42],
  ["bare bigint (inferred)", () => 42n],
  ["bare string (inferred)", () => "hi"],
];

console.log("attribute type support on Cheesecake (chain 7733102), via eth_call\n");
for (const [label, mk] of cases) {
  let attributes;
  try { attributes = { ds: A.str("probe"), v: mk() }; }
  catch (e) { console.log(`  LOCAL-THROW  ${label.padEnd(24)} ${String(e.message).slice(0,70)}`); continue; }
  try {
    const built = await wc.advanced.buildMutation(
      { creates: [{ payload: jsonToPayload({ t: 1 }), contentType: "application/json", attributes, expires: ExpirationTime.fromDays(30) }] },
      { currentBlock: head },
    );
    await pc.call({ to: built.to, data: built.data, account: account.address });
    console.log(`  OK           ${label}`);
  } catch (e) {
    console.log(`  REVERT       ${label}`);
  }
}
