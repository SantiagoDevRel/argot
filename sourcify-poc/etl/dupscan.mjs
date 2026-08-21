import { createPublicClient } from "@arkiv-network/sdk";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/attr";
import { http } from "viem";
const PUB = "0x4691f23a5Da293D31e93f129287402063E95AD21";
const c = createPublicClient({ chain: cheesecake, transport: http("https://rpc.cheesecake.db-chain.devnet.gobas.me") });
const g=(a,k)=>{const v=a?.[k]; return v&&typeof v==='object'&&'value' in v?v.value:v;};
let page = await c.select({ key:true, attributes:true })
  .where(eq("ds", str("sourcify")), eq("kind", str("compilation"))).ownedBy(PUB).limit(200).fetch();
const fps=new Map(); let n=0;
for(;;){ for(const e of page.entities){ n++; const fp=String(g(e.attributes,'fp')); fps.set(fp,(fps.get(fp)||0)+1);} if(!page.hasNextPage()) break; page=await page.next(); }
const dupes=[...fps.values()].filter(v=>v>1);
console.log(`compilation entities: ${n}`);
console.log(`distinct fingerprints: ${fps.size}`);
console.log(`fingerprints written more than once: ${dupes.length}  (max copies: ${Math.max(0,...dupes)})`);
console.log(`extra duplicate entities: ${n - fps.size}`);
