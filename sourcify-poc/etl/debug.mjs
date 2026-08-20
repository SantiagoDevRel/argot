import fs from "node:fs"; import path from "node:path";
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { bool, i32, str } from "@arkiv-network/sdk/attr";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const t = http(process.env.ARKIV_RPC);
const pc = createPublicClient({ chain: cheesecake, transport: t });
const account = privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY);
const wc = createWalletClient({ chain: cheesecake, transport: t, account });
const head = BigInt(process.env.HEAD || 256001);

const cps = fs.readFileSync(path.join(import.meta.dirname, "data/entities-compilation-130.ndjson"), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const a = cps[0].attributes;

const variants = {
  "full (as written)": {
    ds: str(a.ds), kind: str(a.kind), fp: str(a.fp),
    compiler: str(a.compiler), compilerVersion: str(a.compilerVersion), language: str(a.language),
    name: str(a.name), evmVersion: str(a.evmVersion),
    optimizer: bool(a.optimizer), optimizerRuns: i32(a.optimizerRuns), useCount: i32(a.useCount),
  },
  "no empty-string values": Object.fromEntries(Object.entries({
    ds: a.ds, kind: a.kind, fp: a.fp, compiler: a.compiler, compilerVersion: a.compilerVersion,
    language: a.language, name: a.name, evmVersion: a.evmVersion,
  }).filter(([, v]) => v !== "").map(([k, v]) => [k, str(v)])),
  "minimal 2 attrs": { ds: str("sourcify"), kind: str("compilation") },
  "minimal + i32 zero": { ds: str("sourcify"), kind: str("compilation"), useCount: i32(0) },
  "minimal + bool": { ds: str("sourcify"), kind: str("compilation"), optimizer: bool(false) },
};

for (const [label, attributes] of Object.entries(variants)) {
  const built = await wc.advanced.buildMutation(
    { creates: [{ payload: jsonToPayload({ t: 1 }), contentType: "application/json", attributes, expires: ExpirationTime.fromDays(30) }] },
    { currentBlock: head },
  );
  try {
    await pc.call({ to: built.to, data: built.data, account: account.address });
    console.log(`OK      ${label}`);
  } catch (e) {
    const m = (e.shortMessage || e.message || "").split("\n").slice(0, 3).join(" | ");
    console.log(`REVERT  ${label}  ->  ${m.slice(0, 190)}`);
  }
}
