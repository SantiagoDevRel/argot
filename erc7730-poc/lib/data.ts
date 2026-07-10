// Mock data + pure helpers for the Clear Signing Studio POC.
// Ported from the Claude Design prototype. When the DGX is wired live, /api/generate
// returns the real descriptor + confidence and this stays as the demo seed.

export type Chain = { name: string; id: string };
export type Pick = { label: string; addr: string; chain: string };
export type LoadStep = { at: number; pct: number; text: string; color: string };
export type DbRow = {
  id: string;
  contract: string;
  addr: string;
  chain: string;
  sel: string;
  fn: string;
  status: "attested" | "candidate";
  att: string | null;
  conf: number;
};

export const CHAINS: Chain[] = [
  { name: "Ethereum", id: "1" },
  { name: "Arbitrum One", id: "42161" },
  { name: "Base", id: "8453" },
  { name: "Optimism", id: "10" },
  { name: "Polygon", id: "137" },
];

export const PICKS: Pick[] = [
  { label: "Uniswap V3 Router", addr: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", chain: "Ethereum" },
  { label: "Aave V3 Pool", addr: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", chain: "Ethereum" },
  { label: "Lido stETH", addr: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", chain: "Ethereum" },
];

// Curated examples ranked by size/speed: fewer state-changing functions = smaller descriptor
// + faster generation (green = fast, orange = medium, red = big/slow). All Sourcify-verified.
export type Tier = "simple" | "medium" | "complex";
export type Example = { label: string; addr: string; chain: string; fns: number; tier: Tier; note: string };
export const EXAMPLES: Example[] = [
  { label: "ETH2 Deposit", addr: "0x00000000219ab540356cbb839cbe05303d7705fa", chain: "Ethereum", fns: 1, tier: "simple", note: "one function — deposit" },
  { label: "USDC", addr: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", chain: "Ethereum", fns: 3, tier: "simple", note: "proxy → implementation" },
  { label: "WETH", addr: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", chain: "Ethereum", fns: 5, tier: "simple", note: "wrap / unwrap ETH" },
  { label: "Aave V3 Pool", addr: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", chain: "Ethereum", fns: 5, tier: "medium", note: "supply / borrow / repay" },
  { label: "ENS Registrar", addr: "0x253553366Da8546fC250F225fe3d25d0C782303b", chain: "Ethereum", fns: 7, tier: "medium", note: "register a name" },
  { label: "DAI", addr: "0x6B175474E89094C44Da98b954EedeAC495271d0F", chain: "Ethereum", fns: 11, tier: "medium", note: "classic ERC-20 + permit" },
  { label: "1inch Router V5", addr: "0x1111111254EEB25477B68fb85Ed929f73A960582", chain: "Ethereum", fns: 28, tier: "complex", note: "aggregation router — slower" },
  { label: "Uniswap Router", addr: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", chain: "Ethereum", fns: 33, tier: "complex", note: "40+ functions — slowest" },
];
export const TIER_COLOR: Record<Tier, string> = { simple: "#3ECF8E", medium: "#FE7446", complex: "#F05A5A" };

export const JSON_TEXT = [
  "{",
  '  "context": { "contract": { "deployments": [ { "chainId": 1, "address": "0x68b3…Fc45" } ] } },',
  '  "metadata": { "owner": "Uniswap Labs" },',
  '  "display": { "formats": {',
  '    "swapExactTokensForTokens(uint256,uint256,address[],address)": {',
  '      "intent": "Swap tokens on Uniswap",',
  '      "fields": [',
  '        { "path": "amountIn",     "label": "Amount to swap",   "format": "tokenAmount" },',
  '        { "path": "amountOutMin", "label": "Minimum received", "format": "tokenAmount" },',
  '        { "path": "to",           "label": "Recipient",        "format": "addressName" }',
  "      ] } } }",
  "}",
].join("\n");

// [delayMs, progressPct, logLine, color] — the client replays these as the DGX boots.
export const LOAD_STEPS: LoadStep[] = [
  { at: 420, pct: 8, text: "▸ freeing GPU memory — 3 stale procs reaped", color: "#9BA2B8" },
  { at: 1150, pct: 14, text: "▸ pulling qwen3-coder-next (51 GB)", color: "#9BA2B8" },
  { at: 2050, pct: 36, text: "   ▹ 17.4 / 51 GB", color: "#5F6784" },
  { at: 2900, pct: 62, text: "   ▹ 32.9 / 51 GB", color: "#5F6784" },
  { at: 3750, pct: 84, text: "   ▹ 51.0 / 51 GB · sha256 ok", color: "#5F6784" },
  { at: 4400, pct: 93, text: "▸ warming — weights → HBM3e", color: "#9BA2B8" },
  { at: 5200, pct: 100, text: "▸ ready ✓ · ctx 128k · fp8", color: "#3ECF8E" },
];

export const CONFIDENCE = [
  { field: "intent", value: "92%", width: "92%" },
  { field: "amountIn", value: "98%", width: "98%" },
  { field: "recipient", value: "95%", width: "95%" },
];

export const DB: DbRow[] = [
  { id: "e1", contract: "Uniswap V3 Router", addr: "0x68b3…Fc45", chain: "Ethereum", sel: "0x472b43f3", fn: "swapExactTokensForTokens", status: "attested", att: "uniswap.eth", conf: 96 },
  { id: "e2", contract: "Uniswap V3 Router", addr: "0x68b3…Fc45", chain: "Arbitrum", sel: "0x414bf389", fn: "exactInputSingle", status: "candidate", att: null, conf: 93 },
  { id: "e3", contract: "Aave V3 Pool", addr: "0x8787…a4E2", chain: "Ethereum", sel: "0x617ba037", fn: "supply", status: "attested", att: "aave.eth", conf: 97 },
  { id: "e4", contract: "Aave V3 Pool", addr: "0x794a…Ad33", chain: "Polygon", sel: "0x69328dec", fn: "withdraw", status: "candidate", att: null, conf: 91 },
  { id: "e5", contract: "Lido stETH", addr: "0xae7a…fE84", chain: "Ethereum", sel: "0xa1903eab", fn: "submit", status: "attested", att: "lido.eth", conf: 98 },
  { id: "e6", contract: "1inch Router v6", addr: "0x1111…3302", chain: "Ethereum", sel: "0x07ed2379", fn: "swap", status: "candidate", att: null, conf: 88 },
  { id: "e7", contract: "Compound v3 USDC", addr: "0xb125…5A0F", chain: "Base", sel: "0xf2b9fdb8", fn: "supply", status: "candidate", att: null, conf: 90 },
  { id: "e8", contract: "ENS Registrar", addr: "0x2536…41d5", chain: "Ethereum", sel: "0xf7a16963", fn: "registerWithConfig", status: "attested", att: "ens.eth", conf: 95 },
];

// The 5 Sourcify inputs + the on-chain enrichment chip (shown in the Create panel).
export type InputChip = { id: string; icon: string; title: string; sub: string; detail: string; enrichment?: boolean };
export const INPUT_CHIPS: InputChip[] = [
  { id: "identity", icon: "#", title: "Identity", sub: "chainId 1 · 0x68b3…Fc45", detail: "SwapRouter02 — full match. Sources verified on Sourcify; bytecode matches the on-chain deployment." },
  { id: "abi", icon: "ƒ", title: "ABI", sub: "42 functions", detail: "swapExactTokensForTokens · exactInputSingle · multicall · unwrapWETH9 · +38 more" },
  { id: "natspec", icon: "@", title: "NatSpec", sub: "@notice + @param · partial", detail: "“@notice Swaps amountIn of one token for as much as possible of another.” Coverage: 26 / 42 functions." },
  { id: "source", icon: "</>", title: "Source", sub: "8 files · ~120 KB", detail: "SwapRouter02.sol · V3SwapRouter.sol · V2SwapRouter.sol · PaymentsExtended.sol · +4 more" },
  { id: "proxy", icon: "⇄", title: "Proxy", sub: "not a proxy", detail: "EIP-1967 implementation + admin slots are empty — this address is the logic contract itself." },
  { id: "decimals", icon: ".0", title: "Token decimals", sub: "USDC 6 · WETH 18 · resolved on-chain", detail: "decimals() read directly via eth_call — deterministic chain data that grounds token amounts. Never model-inferred.", enrichment: true },
];

// JSON syntax tokenizer → colored spans (ported from the prototype).
export type Tok = { t: string; c: string };
export function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  const re = /"[^"]*"|-?\d+(?:\.\d+)?|[{}[\]:,]|\s+|[^\s"{}[\]:,]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const s = m[0];
    let c = "#C9CEDF";
    if (s[0] === '"') c = /^\s*:/.test(line.slice(re.lastIndex)) ? "#8F94FF" : "#F2B49B";
    else if (/^-?\d/.test(s)) c = "#3ECF8E";
    else if (/^[{}[\]:,]$/.test(s)) c = "#565E7E";
    out.push({ t: s, c });
  }
  return out;
}

export function tokenizedLines() {
  return JSON_TEXT.split("\n").map((l, i) => ({ n: String(i + 1), toks: tokenize(l) }));
}

export function shortAddr(a: string): string {
  const s = (a || "").trim();
  return s.length > 12 ? s.slice(0, 6) + "…" + s.slice(-4) : s || "—";
}
