import { createPublicClient } from "@arkiv-network/sdk";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { str, u64 } from "@arkiv-network/sdk/attr";
import { http } from "viem";
const RPC = "https://rpc.cheesecake.db-chain.devnet.gobas.me";
const PUB = "0x4691f23a5Da293D31e93f129287402063E95AD21";
const c = createPublicClient({ chain: cheesecake, transport: http(RPC) });
let page = await c.select({ key:true, owner:true, attributes:true })
  .where(eq("ds", str("sourcify")), eq("kind", str("verified_contract")), eq("chainid", u64(130n)))
  .ownedBy(PUB).limit(200).fetch();
let total=0, withRef=0, withFp=0, pages=0, dupAddr=new Map();
for(;;){
  pages++;
  for(const e of page.entities){
    total++;
    const a=e.attributes||{};
    const get=(k)=>{const v=a[k]; return v&&typeof v==='object'&&'value' in v?v.value:v;};
    if(get('compilationref')) withRef++; else if(get('compilationfp')) withFp++;
    const ad=String(get('address')||'').toLowerCase();
    dupAddr.set(ad,(dupAddr.get(ad)||0)+1);
  }
  process.stdout.write(`\rpages ${pages} total ${total} ref ${withRef} fp ${withFp}   `);
  if(!page.hasNextPage()) break;
  page = await page.next();
}
const dups=[...dupAddr.values()].filter(v=>v>1).length;
console.log(`\n\nTOTAL verified_contract entities on chain (owner=publisher, chain 130): ${total}`);
console.log(`  with compilationref (join resolved): ${withRef}  (${(withRef/total*100).toFixed(1)}%)`);
console.log(`  with compilationfp fallback only   : ${withFp}  (${(withFp/total*100).toFixed(1)}%)`);
console.log(`  distinct addresses: ${dupAddr.size}   addresses appearing >1 time (duplicate writes): ${dups}`);
console.log(`  pages walked: ${pages} (= RPC requests)`);
