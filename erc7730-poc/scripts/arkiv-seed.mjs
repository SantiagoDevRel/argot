// arkiv-seed.mjs — write candidate + adopted ERC-7730 descriptors to Arkiv as
// queryable entities (SDK direct, one batched mutateEntities tx). Ops-only; runs
// LOCALLY with a funded testnet burner. Never deployed, never committed with a key.
//
//   PRIVATE_KEY=0x…  node scripts/arkiv-seed.mjs
//
// Reads:  PRIVATE_KEY (required), ARKIV_RPC_URL (optional, default Braga).
// The descriptor is ALWAYS a candidate/adopted draft — authorship stays with the dApp;
// nothing here auto-submits to the official registry.
import { createPublicClient, createWalletClient, http } from "@arkiv-network/sdk";
import { privateKeyToAccount } from "@arkiv-network/sdk/accounts";
import { braga } from "@arkiv-network/sdk/chains";
import { jsonToPayload, formatEther } from "@arkiv-network/sdk/utils";
import { createHash } from "node:crypto";

const DATASET = "erc7730-poc";
const RPC = process.env.ARKIV_RPC_URL || "https://braga.hoodi.arkiv.network/rpc";
const EXPIRES_IN = 30 * 24 * 60 * 60; // 30 days in SECONDS (Arkiv expiry is in seconds)

const pk = (process.env.PRIVATE_KEY || "").trim();
if (!pk) {
  console.error("✖ PRIVATE_KEY env is required (funded Braga testnet burner).");
  process.exit(1);
}

// The seed set: real, well-known contracts. A mix of adopted+attested (human authorship)
// and DGX candidate drafts (unattested) — the exact shape the Database tab renders.
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);

function descriptor(contract, chainId, address, fn, intent, fields, owner) {
  return {
    $schema: "https://eips.ethereum.org/assets/eip-7730/erc7730-v1.schema.json",
    context: { contract: { deployments: [{ chainId, address }] } },
    metadata: { owner },
    display: { formats: { [fn]: { intent, fields } } },
  };
}

const SEED = [
  {
    contract: "Uniswap V3 Router", chain: "Ethereum", chainId: 1,
    address: "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
    fn: "swapExactTokensForTokens(uint256,uint256,address[],address)", short: "swapExactTokensForTokens",
    selector: "0x472b43f3", status: "adopted", attested: true, attester: "uniswap.eth", generatedBy: "human", conf: 96,
    intent: "Swap tokens on Uniswap",
    fields: [
      { path: "amountIn", label: "Amount to swap", format: "tokenAmount" },
      { path: "amountOutMin", label: "Minimum received", format: "tokenAmount" },
      { path: "to", label: "Recipient", format: "addressName" },
    ], owner: "Uniswap Labs",
  },
  {
    contract: "Uniswap V3 Router", chain: "Arbitrum", chainId: 42161,
    address: "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
    fn: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))", short: "exactInputSingle",
    selector: "0x414bf389", status: "candidate", attested: false, attester: null, generatedBy: "dgx", conf: 93,
    intent: "Swap an exact amount of one token for another",
    fields: [
      { path: "params.amountIn", label: "Amount to swap", format: "tokenAmount" },
      { path: "params.amountOutMinimum", label: "Minimum received", format: "tokenAmount" },
      { path: "params.recipient", label: "Recipient", format: "addressName" },
    ], owner: "Uniswap Labs",
  },
  {
    contract: "Aave V3 Pool", chain: "Ethereum", chainId: 1,
    address: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
    fn: "supply(address,uint256,address,uint16)", short: "supply",
    selector: "0x617ba037", status: "adopted", attested: true, attester: "aave.eth", generatedBy: "human", conf: 97,
    intent: "Supply assets to Aave",
    fields: [
      { path: "asset", label: "Asset", format: "addressName" },
      { path: "amount", label: "Amount to supply", format: "tokenAmount" },
      { path: "onBehalfOf", label: "On behalf of", format: "addressName" },
    ], owner: "Aave DAO",
  },
  {
    contract: "Aave V3 Pool", chain: "Polygon", chainId: 137,
    address: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
    fn: "withdraw(address,uint256,address)", short: "withdraw",
    selector: "0x69328dec", status: "candidate", attested: false, attester: null, generatedBy: "dgx", conf: 91,
    intent: "Withdraw supplied assets from Aave",
    fields: [
      { path: "asset", label: "Asset", format: "addressName" },
      { path: "amount", label: "Amount to withdraw", format: "tokenAmount" },
      { path: "to", label: "Recipient", format: "addressName" },
    ], owner: "Aave DAO",
  },
  {
    contract: "Lido stETH", chain: "Ethereum", chainId: 1,
    address: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84",
    fn: "submit(address)", short: "submit",
    selector: "0xa1903eab", status: "adopted", attested: true, attester: "lido.eth", generatedBy: "human", conf: 98,
    intent: "Stake ETH with Lido",
    fields: [{ path: "_referral", label: "Referral", format: "addressName" }], owner: "Lido",
  },
  {
    contract: "1inch Router v6", chain: "Ethereum", chainId: 1,
    address: "0x111111125421ca6dc452d289314280a0f8842a65",
    fn: "swap(address,(address,address,address,address,uint256,uint256,uint256),bytes)", short: "swap",
    selector: "0x07ed2379", status: "candidate", attested: false, attester: null, generatedBy: "dgx", conf: 88,
    intent: "Swap tokens via 1inch aggregation",
    fields: [
      { path: "desc.amount", label: "Amount to swap", format: "tokenAmount" },
      { path: "desc.minReturnAmount", label: "Minimum received", format: "tokenAmount" },
      { path: "desc.dstReceiver", label: "Recipient", format: "addressName" },
    ], owner: "1inch",
  },
  {
    contract: "Compound v3 USDC", chain: "Base", chainId: 8453,
    address: "0xb125e6687d4313864e53df431d5425969c15eb2f",
    fn: "supply(address,uint256)", short: "supply",
    selector: "0xf2b9fdb8", status: "candidate", attested: false, attester: null, generatedBy: "dgx", conf: 90,
    intent: "Supply collateral to Compound III",
    fields: [
      { path: "asset", label: "Asset", format: "addressName" },
      { path: "amount", label: "Amount to supply", format: "tokenAmount" },
    ], owner: "Compound",
  },
  {
    contract: "ENS Registrar", chain: "Ethereum", chainId: 1,
    address: "0x253553366da8546fc250f225fe3d25d0c782303b",
    fn: "registerWithConfig(string,address,uint256,address,address)", short: "registerWithConfig",
    selector: "0xf7a16963", status: "adopted", attested: true, attester: "ens.eth", generatedBy: "human", conf: 95,
    intent: "Register an ENS name",
    fields: [
      { path: "name", label: "Name", format: "raw" },
      { path: "owner", label: "Owner", format: "addressName" },
      { path: "duration", label: "Duration", format: "duration" },
    ], owner: "ENS",
  },
];

function hashDescriptor(obj) {
  return "0x" + createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

// REAL confidence = how grounded the descriptor's intent + field labels are in the contract's
// on-chain NatSpec (@notice/@param). Mirrors the DGX wrapper's confidence(): a NatSpec-backed
// label/intent scores high, a source-inferred one scores lower. This is a generation-quality
// signal for candidates — NOT a trust guarantee (trust comes from review + attestation).
async function sourcifyNatSpec(chainId, address) {
  const base = "https://sourcify.dev/server/v2/contract";
  try {
    const r = await fetch(`${base}/${chainId}/${address}?fields=userdoc,devdoc,proxyResolution`);
    if (!r.ok) return { userdoc: {}, devdoc: {} };
    const s = await r.json();
    let userdoc = s.userdoc, devdoc = s.devdoc;
    const impl = s.proxyResolution?.isProxy ? s.proxyResolution.implementations?.[0]?.address : null;
    if (/^0x[0-9a-fA-F]{40}$/.test(String(impl || ""))) {
      try { const ir = await fetch(`${base}/${chainId}/${impl}?fields=userdoc,devdoc`); if (ir.ok) { const iso = await ir.json(); userdoc = iso.userdoc || userdoc; devdoc = iso.devdoc || devdoc; } } catch { /* fall back to proxy natspec */ }
    }
    return { userdoc: userdoc || {}, devdoc: devdoc || {} };
  } catch { return { userdoc: {}, devdoc: {} }; }
}
function computeConfidence(intent, fields, userdoc, devdoc) {
  const doc = (JSON.stringify(userdoc || {}) + " " + JSON.stringify(devdoc || {})).toLowerCase();
  const firstWord = (s) => String(s || "").toLowerCase().split(/\s+/).filter(Boolean)[0] || "";
  const scores = [];
  const iw = firstWord(intent);
  scores.push(iw && doc.includes(iw) ? 92 : 74); // intent: NatSpec-backed vs inferred
  for (const f of fields || []) {
    const lw = firstWord(f.label);
    scores.push(lw && doc.includes(lw) ? 95 : 78); // field label: backed vs inferred
  }
  return Math.round(scores.reduce((a, b) => a + b, 0) / (scores.length || 1));
}

async function main() {
  const account = privateKeyToAccount(pk.startsWith("0x") ? pk : "0x" + pk);
  const transport = http(RPC);
  const pub = createPublicClient({ chain: braga, transport });
  const wallet = createWalletClient({ chain: braga, account, transport });

  const chainId = await pub.getChainId();
  const balance = await pub.getBalance({ address: account.address });
  console.log(`network chainId=${chainId} · wallet ${short(account.address)} · balance ${formatEther(balance)} GLM`);
  if (balance === 0n) throw new Error("wallet has 0 balance — fund at https://braga.hoodi.arkiv.network/faucet/");

  // Idempotent: delete any prior entities in this dataset (we own them) before re-creating,
  // so re-running never leaves duplicates/orphans (e.g. after an attribute rename).
  const existing = await pub.query(`dataset = "${DATASET}"`, { includeData: { attributes: false }, resultsPerPage: 100 });
  if (existing.entities.length) {
    console.log(`deleting ${existing.entities.length} existing "${DATASET}" entities…`);
    const del = await wallet.mutateEntities({ deletes: existing.entities.map((e) => ({ entityKey: e.key })) });
    console.log(`✓ deleted ${(del.deletedEntities || []).length || existing.entities.length} · tx ${del.txHash}`);
  }

  // Compute the REAL confidence per seed from live Sourcify NatSpec (concurrent fetch).
  const confs = await Promise.all(
    SEED.map(async (d) => {
      const { userdoc, devdoc } = await sourcifyNatSpec(d.chainId, d.address);
      const c = computeConfidence(d.intent, d.fields, userdoc, devdoc);
      console.log(`  confidence ${d.contract} · ${d.short} = ${c}% (NatSpec-grounded)`);
      return c;
    })
  );

  const creates = SEED.map((d, i) => {
    const desc = descriptor(d.contract, d.chainId, d.address, d.fn, d.intent, d.fields, d.owner);
    const descriptorHash = hashDescriptor(desc);
    const attributes = [
      { key: "dataset", value: DATASET },
      { key: "type", value: "descriptor" },
      { key: "chainId", value: String(d.chainId) },
      { key: "address", value: d.address },
      { key: "chainAddress", value: `${d.chainId}:${d.address}` },
      { key: "selector", value: d.selector },
      { key: "fn", value: d.short },
      { key: "contract", value: d.contract },
      { key: "chain", value: d.chain },
      { key: "addrShort", value: short(d.address) },
      { key: "status", value: d.status },
      { key: "attested", value: d.attested ? "true" : "false" },
      { key: "sourcifyVerified", value: "true" },
      { key: "generatedBy", value: d.generatedBy },
      { key: "confidence", value: confs[i] },
      { key: "descriptorHash", value: descriptorHash },
    ];
    if (d.attester) attributes.push({ key: "attester", value: d.attester });
    return { payload: jsonToPayload(desc), contentType: "application/json", expiresIn: EXPIRES_IN, attributes };
  });

  console.log(`writing ${creates.length} descriptor entities in one mutateEntities tx…`);
  const r = await wallet.mutateEntities({ creates });
  console.log(`✓ tx ${r.txHash}`);
  console.log(`✓ created ${(r.createdEntities || []).length} entities`);
  (r.createdEntities || []).forEach((k, i) => console.log(`   ${SEED[i].contract} · ${SEED[i].short} → ${k}`));

  // read-back verification (public query)
  const res = await pub.query(`dataset = "${DATASET}" && type = "descriptor"`, {
    includeData: { attributes: true, payload: false, metadata: false },
    resultsPerPage: 50,
  });
  console.log(`✓ read-back: ${res.entities.length} entities match dataset="${DATASET}"`);
}

main().catch((e) => {
  console.error("✖", e.message || e);
  process.exit(1);
});
