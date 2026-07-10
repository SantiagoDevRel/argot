// GET/POST /api/inputs { chainId, address } -> the RICH Sourcify inputs for a contract
// (full ABI signatures, source files, NatSpec, proxy, on-chain token decimals) + a Sourcify
// provenance deep-link per input. Model-free + DGX-free: pure Sourcify v2 + eth_call, so the
// input inspector works instantly on contract select, before any Generate. Cookie-gated by proxy.ts.
export const dynamic = "force-dynamic";

const SOURCIFY = "https://sourcify.dev/server/v2/contract";
const RPCS: Record<number, string[]> = {
  1: ["https://ethereum-rpc.publicnode.com", "https://rpc.ankr.com/eth"],
  10: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
  56: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"],
  137: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  42161: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function ethCall(rpc: string, to: string, data: string): Promise<string | null> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal: AbortSignal.timeout(9000),
  });
  const j = await res.json();
  return j?.result ?? null;
}
function hexToAscii(hex: string | null): string | null {
  try {
    const h = (hex || "").replace(/^0x/, "");
    let bytes = h;
    if (h.length >= 128) bytes = h.slice(128, 128 + parseInt(h.slice(64, 128), 16) * 2);
    const s = Buffer.from(bytes, "hex").toString("utf8").replace(/[^\x20-\x7e]/g, "").trim();
    return s || null;
  } catch {
    return null;
  }
}
async function tokenMeta(chainId: number, addr: string) {
  const rpcs = RPCS[chainId];
  if (!rpcs) return null;
  for (const rpc of rpcs) {
    try {
      const decHex = await ethCall(rpc, addr, "0x313ce567");
      const decimals = decHex && decHex !== "0x" ? parseInt(decHex, 16) : null;
      if (decimals == null || Number.isNaN(decimals) || decimals > 255) continue;
      const symHex = await ethCall(rpc, addr, "0x95d89b41").catch(() => null);
      return { address: addr, decimals, decHex, symHex, symbol: hexToAscii(symHex), rpc };
    } catch {
      /* next rpc */
    }
  }
  return null;
}

async function build(chainId: number, address: string) {
  const sres = await fetch(`${SOURCIFY}/${chainId}/${address}?fields=abi,userdoc,devdoc,metadata,proxyResolution`, { signal: AbortSignal.timeout(15000) });
  if (!sres.ok) return { error: `sourcify ${sres.status}`, status: sres.status };
  const sourcify = await sres.json();

  let abi = sourcify.abi, userdoc = sourcify.userdoc, devdoc = sourcify.devdoc, boundImpl: string | null = null;
  const implRaw = sourcify.proxyResolution?.isProxy ? sourcify.proxyResolution.implementations?.[0]?.address : null;
  const impl = /^0x[0-9a-fA-F]{40}$/.test(String(implRaw || "")) ? implRaw : null;
  if (impl) {
    try {
      const ires = await fetch(`${SOURCIFY}/${chainId}/${impl}?fields=abi,userdoc,devdoc`, { signal: AbortSignal.timeout(15000) });
      if (ires.ok) {
        const iso = await ires.json();
        if (Array.isArray(iso.abi) && iso.abi.length) {
          abi = iso.abi; userdoc = iso.userdoc; devdoc = iso.devdoc; boundImpl = impl;
        }
      }
    } catch { /* fall back to proxy abi */ }
  }

  const fns = (Array.isArray(abi) ? abi : []).filter((x: Any) => x.type === "function");
  const abiSigs = fns.map((f: Any) => `${f.name}(${(f.inputs || []).map((i: Any) => i.type).join(",")})`);
  const sourceFiles = Object.keys(sourcify.metadata?.sources || {});
  const notice = userdoc?.methods || {};
  const params = devdoc?.methods || {};
  const meta = await tokenMeta(chainId, address);
  const ct = sourcify.metadata?.settings?.compilationTarget;
  const name = (ct && Object.values(ct)[0]) || sourcify.metadata?.output?.devdoc?.title || "Contract";
  const sBase = `${SOURCIFY}/${chainId}/${address}`;
  const repo = `https://repo.sourcify.dev/${chainId}/${address}`; // human-facing verified-contract page

  return {
    inputs: [
      { id: "identity", title: "Identity", enrichment: false, sub: `chainId ${chainId} · ${address.slice(0, 6)}…${address.slice(-4)}`, link: repo, apiLink: `${sBase}?fields=match,metadata`, full: { contract: name, chainId, address, match: sourcify.match || sourcify.runtimeMatch || "match", verifiedAt: sourcify.verifiedAt || null, compiler: sourcify.metadata?.compiler?.version || null } },
      { id: "abi", title: "ABI", enrichment: false, sub: `${abiSigs.length} functions${boundImpl ? " · via impl" : ""}`, link: repo, apiLink: `${sBase}?fields=abi`, full: { functions: abiSigs } },
      { id: "natspec", title: "NatSpec", enrichment: false, sub: Object.keys(notice).length ? `@notice · ${Object.keys(notice).length} methods` : "absent — source-inferred", link: repo, apiLink: `${sBase}?fields=userdoc,devdoc`, full: { notice, params } },
      { id: "source", title: "Source", enrichment: false, sub: `${sourceFiles.length} files`, link: repo, apiLink: `${sBase}?fields=sources`, full: { files: sourceFiles } },
      { id: "proxy", title: "Proxy", enrichment: false, sub: boundImpl ? `proxy — bound to ${boundImpl.slice(0, 6)}…` : sourcify.proxyResolution?.isProxy ? "proxy" : "not a proxy", link: repo, apiLink: `${sBase}?fields=proxyResolution`, full: sourcify.proxyResolution || { isProxy: false } },
      { id: "decimals", title: "Token decimals", enrichment: true, sub: meta?.decimals != null ? `${meta.decimals}${meta.symbol ? " · " + meta.symbol : ""} · eth_call` : "not a token / n/a", link: null, apiLink: null, full: meta ? { method: "eth_call (deterministic — never model-inferred)", rpc: meta.rpc, to: meta.address, calls: [{ fn: "decimals()", selector: "0x313ce567", rawResult: meta.decHex, decoded: meta.decimals }, { fn: "symbol()", selector: "0x95d89b41", rawResult: meta.symHex, decoded: meta.symbol }] } : { note: "no ERC-20 token detected at this address" } },
    ],
  };
}

async function handle(chainId: string, address: string) {
  const cid = Number(chainId || 1);
  const addr = String(address || "").toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return Response.json({ error: "bad address" }, { status: 400 });
  try {
    const out = await build(cid, addr);
    return Response.json(out, { status: (out as Any).error ? 502 : 200 });
  } catch (e) {
    return Response.json({ error: "inputs failed", detail: String(e).slice(0, 160) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return handle(body?.chainId, body?.address);
}
export async function GET(request: Request) {
  const u = new URL(request.url);
  return handle(u.searchParams.get("chainId") || "1", u.searchParams.get("address") || "");
}
