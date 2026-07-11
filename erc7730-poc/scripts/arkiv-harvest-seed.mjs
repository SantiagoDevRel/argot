// arkiv-harvest-seed.mjs — write the HARVESTED lint-passing candidate descriptors
// (produced by scripts/harvest.mjs on the DGX) to Arkiv as queryable CANDIDATE entities.
// Runs LOCALLY with a funded Braga burner (key never leaves the laptop). This is Lever D:
// coverage at scale — proving both (a) the generator runs over the long tail and (b) Arkiv
// serves thousands of descriptors as a queryable Web3 database.
//
//   PRIVATE_KEY=0x…  node scripts/arkiv-harvest-seed.mjs --in harvest-gptoss.jsonl \
//     --dataset erc7730-harvest --model gpt-oss:120b
//
// Descriptors are ALWAYS candidates (status=candidate, attested=false) — authorship stays
// with the dApp. Writes under a SEPARATE dataset by default so the curated demo tab
// (dataset="erc7730-poc") is untouched; flip --dataset to merge if desired.
import { createPublicClient, createWalletClient, http } from "@arkiv-network/sdk";
import { privateKeyToAccount } from "@arkiv-network/sdk/accounts";
import { braga } from "@arkiv-network/sdk/chains";
import { jsonToPayload, formatEther } from "@arkiv-network/sdk/utils";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const IN = opt("--in", "harvest.jsonl");
const DATASET = opt("--dataset", "erc7730-harvest");
const MODEL = opt("--model", "dgx");
const BATCH = Number(opt("--batch", "400")); // stay well under the 1000/tx cap
const RPC = process.env.ARKIV_RPC_URL || "https://braga.hoodi.arkiv.network/rpc";
const EXPIRES_IN = 30 * 24 * 60 * 60;

const pk = (process.env.PRIVATE_KEY || "").trim();
if (!pk) { console.error("✖ PRIVATE_KEY env required (funded Braga burner)."); process.exit(1); }

const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const firstSig = (desc) => Object.keys(desc?.display?.formats || {})[0] || null;
const fnShort = (sig) => (sig ? String(sig).split("(")[0] : null);
const hashDescriptor = (obj) => "0x" + createHash("sha256").update(JSON.stringify(obj)).digest("hex");

function rowToEntity(row) {
  const desc = row.descriptor;
  const sig = firstSig(desc);
  const nFns = Object.keys(desc?.display?.formats || {}).length;
  const attributes = [
    { key: "dataset", value: DATASET },
    { key: "kind", value: "descriptor" },
    { key: "chainId", value: String(row.chainId) },
    { key: "address", value: row.address },
    { key: "chainAddress", value: `${row.chainId}:${row.address}` },
    { key: "contract", value: String(row.contract || "Contract").slice(0, 80) },
    { key: "addrShort", value: short(row.address) },
    { key: "fn", value: fnShort(sig) || "n/a" },
    { key: "nFunctions", value: String(nFns) },
    { key: "status", value: "candidate" },
    { key: "attested", value: "false" },
    { key: "sourcifyVerified", value: "true" },
    { key: "lintPassed", value: "true" },
    { key: "repaired", value: row.repaired ? "true" : "false" },
    { key: "generatedBy", value: MODEL },
    { key: "source", value: "harvest" },
    { key: "descriptorHash", value: hashDescriptor(desc) },
  ];
  return { payload: jsonToPayload(desc), contentType: "application/json", expiresIn: EXPIRES_IN, attributes };
}

async function main() {
  const rows = readFileSync(IN, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    .filter((r) => r.lintPassed && r.descriptor?.display?.formats && Object.keys(r.descriptor.display.formats).length);
  // de-dup by chainAddress (harvest is append-only)
  const byAddr = new Map();
  for (const r of rows) byAddr.set(`${r.chainId}:${r.address}`, r);
  const uniq = [...byAddr.values()];
  console.log(`harvest-seed: ${uniq.length} unique lint-passing candidates from ${IN} → dataset="${DATASET}" model="${MODEL}"`);

  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
  const transport = http(RPC);
  const pub = createPublicClient({ chain: braga, transport });
  const wallet = createWalletClient({ chain: braga, account, transport });
  const chainId = await pub.getChainId();
  const balance = await pub.getBalance({ address: account.address });
  console.log(`network chainId=${chainId} · wallet ${short(account.address)} · balance ${formatEther(balance)} GLM`);
  if (balance === 0n) throw new Error("wallet has 0 balance — fund at https://braga.hoodi.arkiv.network/faucet/");

  let written = 0;
  for (let off = 0; off < uniq.length; off += BATCH) {
    const chunk = uniq.slice(off, off + BATCH);
    const creates = chunk.map(rowToEntity);
    process.stdout.write(`  writing ${creates.length} entities (batch ${off / BATCH + 1})… `);
    const r = await wallet.mutateEntities({ creates });
    written += (r.createdEntities || []).length;
    console.log(`✓ tx ${r.txHash} · +${(r.createdEntities || []).length}`);
  }
  console.log(`✓ wrote ${written} candidate descriptor entities total`);

  const res = await pub.query(`dataset = "${DATASET}" && kind = "descriptor"`, {
    includeData: { attributes: true, payload: false, metadata: false }, resultsPerPage: 50,
  });
  console.log(`✓ read-back (first page): ${res.entities.length} entities match dataset="${DATASET}"`);
}
main().catch((e) => { console.error("✖", e.message || e); process.exit(1); });
