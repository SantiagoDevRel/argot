/**
 * Is the string the UI prints as "the query that went to the network" actually the
 * string that goes to the network? Intercept fetch and compare, rather than assume.
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { str, u64 } from "@arkiv-network/sdk/attr";
import { http } from "viem";

const RPC = process.env.ARKIV_RPC;
let captured = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  try {
    const body = JSON.parse(opts.body);
    const calls = Array.isArray(body) ? body : [body];
    for (const c of calls) if (c.method === "arkiv_query") captured = c;
  } catch {}
  return realFetch(url, opts);
};

const c = createPublicClient({ chain: cheesecake, transport: http(RPC) });
const q = c.select({ key: true, attributes: true })
  .where(eq("ds", str("sourcify")), eq("kind", str("verified_contract")), eq("chainid", u64(130n)))
  .limit(3);

const printed = q.toString();
await q.fetch();

console.log("WHAT THE UI PRINTS:");
console.log("  " + printed);
console.log("");
console.log("WHAT THE RPC ACTUALLY CARRIED (arkiv_query param 0):");
console.log("  " + (captured?.params?.[0] ?? "<not captured>"));
console.log("");
console.log("identical:", printed === captured?.params?.[0] ? "YES — the printed string IS the wire query" : "NO — they differ");
console.log("");
console.log("full RPC params:");
console.log(JSON.stringify(captured?.params, null, 2).slice(0, 700));
