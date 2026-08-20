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
const probe = async (label, attributes) => {
  try {
    const b = await wc.advanced.buildMutation({ creates:[{ payload: jsonToPayload({t:1}), contentType:"application/json", attributes, expires: ExpirationTime.fromDays(30) }] }, { currentBlock: head });
    await pc.call({ to:b.to, data:b.data, account: account.address });
    console.log("  OK      " + label);
  } catch(e){ console.log("  REVERT  " + label); }
};
await probe("lowercase name   {ds, usecount:i32}", { ds: A.str("p"), usecount: A.i32(0) });
await probe("camelCase name   {ds, useCount:i32}", { ds: A.str("p"), useCount: A.i32(0) });
await probe("camelCase str    {ds, compilerVersion:str}", { ds: A.str("p"), compilerVersion: A.str("0.8.30") });
await probe("lowercase str    {ds, compilerversion:str}", { ds: A.str("p"), compilerversion: A.str("0.8.30") });
await probe("repeat: {ds, useCount:i32} again", { ds: A.str("p"), useCount: A.i32(0) });
await probe("repeat: {ds, usecount:i32} again", { ds: A.str("p"), usecount: A.i32(0) });
