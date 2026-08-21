import { createPublicClient } from "@arkiv-network/sdk";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/attr";
import { http } from "viem";
const KIND = process.argv[2];
const PUB = "0x4691f23a5Da293D31e93f129287402063E95AD21";
const c = createPublicClient({ chain: cheesecake, transport: http("https://rpc.cheesecake.db-chain.devnet.gobas.me") });
let page = await c.select({ key:true, attributes:true })
  .where(eq("ds", str("sourcify")), eq("kind", str(KIND))).ownedBy(PUB).limit(200).fetch();
let n=0,p=0;
for(;;){ p++; n+=page.entities.length; if(!page.hasNextPage()) break; page=await page.next(); }
console.log(`${KIND}: ${n} entities on chain (${p} pages / RPC calls)`);
