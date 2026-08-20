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
const probe = async (name) => {
  const local = A.isValidAttributeName(name);
  try {
    const b = await wc.advanced.buildMutation({ creates:[{ payload: jsonToPayload({t:1}), contentType:"application/json",
      attributes: { ds: A.str("p"), [name]: A.str("v") }, expires: ExpirationTime.fromDays(30) }] }, { currentBlock: head });
    await pc.call({ to:b.to, data:b.data, account: account.address });
    console.log(`  node OK      sdk ${local?"ok ":"NO "}  ${name}`);
  } catch { console.log(`  node REVERT  sdk ${local?"ok ":"NO "}  ${name}   <-- SDK and node DISAGREE`); }
};
for (const n of ["lower","with_underscore","with-dash","with.dot","camelCase","UPPER","a1digit","_leading","trailing_","x"]) await probe(n);
