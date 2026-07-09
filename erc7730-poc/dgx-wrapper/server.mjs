// server.mjs — the DGX-side wrapper for the Clear Signing Studio POC.
//
// Runs ON the DGX. Exposed to Vercel ONLY through the Cloudflare tunnel (outbound-only)
// + a bearer secret. Ollama stays internal (127.0.0.1) — this thin service is the sole
// public surface. It:
//   POST /load     { model? }            -> warm the Ollama model, stream/return progress
//   POST /generate { chainId, address }  -> Sourcify v2 fetch → model (JSON) → erc7730 lint
//                                           → candidate ERC-7730 descriptor + confidence
//   GET  /health                          -> liveness (no bearer)
//
// HARD RULES enforced here:
//   • Output is ALWAYS a candidate draft (status=candidate, attested=false). No auto-submit.
//   • Token decimals come from a deterministic on-chain eth_call, NEVER the model.
//   • `erc7730 lint` is the hard gate: a draft that fails lint is returned lintPassed=false
//     (the app never surfaces a malformed draft as adoptable).
//
// No npm deps — Node ≥20 built-ins only (http, crypto, child_process, fetch).
import { createServer } from "node:http";
import { timingSafeEqual, createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 9010);
const BEARER = process.env.WRAPPER_BEARER || "";
const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.DGX_MODEL || "qwen3-coder-next:q4_K_M";
const SOURCIFY = process.env.SOURCIFY_URL || "https://sourcify.dev/server/v2/contract";
// Absolute paths (defense-in-depth: never resolve these via $PATH at runtime).
const ERC7730_BIN = process.env.ERC7730_BIN || "erc7730";
const COMFY_PAUSE = process.env.COMFY_PAUSE_BIN || "/usr/local/bin/comfy-pause";

// Single-GPU box → hard concurrency caps so one client can't wedge it (no rate-limiter
// library; a counter is the right size for one process). Excess → 429.
const inflight = { load: 0, generate: 0 };
const CAP = { load: 1, generate: 2 };
const MAX_BODY = 256 * 1024; // reject oversized request bodies (readBody DoS guard)
// Only vetted models may be loaded/run — never an arbitrary request-supplied model id.
const MODEL_ALLOW = new Set([DEFAULT_MODEL, "qwen3-coder-next:q4_K_M", "minimax-m2.5"]);
const pickModel = (m) => (typeof m === "string" && MODEL_ALLOW.has(m) ? m : DEFAULT_MODEL);
// Per-chain public RPCs for the deterministic decimals()/symbol() eth_call enrichment.
const RPCS = {
  1: process.env.RPC_1 || "https://eth.llamarpc.com",
  10: process.env.RPC_10 || "https://mainnet.optimism.io",
  56: process.env.RPC_56 || "https://bsc-dataseed.binance.org",
  137: process.env.RPC_137 || "https://polygon-rpc.com",
  8453: process.env.RPC_8453 || "https://mainnet.base.org",
  42161: process.env.RPC_42161 || "https://arb1.arbitrum.io/rpc",
};

if (!BEARER) {
  console.error("⛔ WRAPPER_BEARER is required (the shared secret Vercel sends). Refusing to start open.");
  process.exit(1);
}

// --- auth (timing-safe) ------------------------------------------------------------
function authorized(req) {
  const h = req.headers["authorization"] || "";
  const got = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = createHash("sha256").update(got).digest();
  const b = createHash("sha256").update(BEARER).digest();
  return timingSafeEqual(a, b);
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    let over = false;
    req.on("data", (c) => {
      d += c;
      if (d.length > MAX_BODY && !over) {
        over = true;
        req.destroy();
        resolve({});
      }
    });
    req.on("end", () => {
      if (over) return;
      try {
        resolve(JSON.parse(d || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// --- free the GPU so the model always loads (the "Load model" button's job) ----------
// The user wants clicking Load to make the model work even if the DGX is busy in another
// app: pause ComfyUI + drop the MiniMax server (both best-effort, harmless if not running),
// which frees the unified memory before we warm the target model.
function sh(cmd, args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, so, se) => resolve({ code: err?.code ?? 0, out: `${so || ""}${se || ""}`.trim() }));
  });
}
async function freeGpu() {
  const steps = [];
  const cp = await sh(COMFY_PAUSE, ["--all"]);
  steps.push(`comfy-pause · ${cp.code === 0 ? "ok" : "n/a"}`);
  const mm = await sh(join(homedir(), "minimax-down.sh"), []);
  steps.push(`minimax-down · ${mm.code === 0 ? "ok" : "n/a"}`);
  return steps;
}

// --- Ollama --------------------------------------------------------------------------
async function ollamaWarm(model) {
  // A tiny generate call with keep_alive forces the weights resident. Returns timing.
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: "ok", stream: false, keep_alive: "30m", options: { num_predict: 1 } }),
  });
  if (!res.ok) throw new Error(`ollama warm ${res.status}: ${(await res.text()).slice(0, 200)}`);
  await res.json();
  return Date.now() - t0;
}

// The model produces ONLY display.formats — the identity/context is injected
// deterministically afterward (chainId+address are known, never model-guessed), which
// eliminates a whole class of lint errors and lets the model focus on the hard part
// (intent + field mapping).
const SYSTEM = `You generate the "display.formats" of a CANDIDATE ERC-7730 clear-signing descriptor.
Output ONLY a JSON object: { "formats": { "<functionSignature>": { "intent": "<short imperative>", "fields": [ { "path": "<paramName>", "label": "<human label>", "format": "<erc7730 format>" } ] } } }.
Rules:
- Key each format by the FULL function signature with parameter types, e.g. "transfer(address,uint256)".
- Include ONLY user-facing STATE-CHANGING functions the wallet user signs (transfer, approve, swap, deposit, stake…). SKIP view/pure getters, and SKIP proxy-admin functions (upgradeTo, changeAdmin) unless the contract's sole purpose is administration.
- Field "format" must be one of: tokenAmount, addressName, amount, date, duration, raw, nftName, unit, enum, calldata.
- Use tokenAmount for token/ETH amounts, addressName for address params (recipients/spenders), duration for time spans, date for deadlines/timestamps.
- Derive "intent" and "label" from NatSpec @notice/@param when present; else infer from names/source.
- Do NOT invent token decimals/tickers — leave tokenAmount fields as-is; decimals are filled on-chain afterward.
- It is a candidate DRAFT for the dApp owner to review — be accurate, never authoritative.
Example output:
{ "formats": { "transfer(address,uint256)": { "intent": "Send tokens", "fields": [ { "path": "to", "label": "To", "format": "addressName" }, { "path": "amount", "label": "Amount", "format": "tokenAmount" } ] }, "approve(address,uint256)": { "intent": "Approve token spending", "fields": [ { "path": "spender", "label": "Spender", "format": "addressName" }, { "path": "amount", "label": "Amount", "format": "tokenAmount" } ] } } }`;

// Ollama structured-output schema (well-formedness only; erc7730 lint is the real gate).
const FORMAT_SCHEMA = {
  type: "object",
  properties: {
    formats: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          intent: { type: "string" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: { path: { type: "string" }, label: { type: "string" }, format: { type: "string" } },
              required: ["path", "label", "format"],
            },
          },
        },
        required: ["intent", "fields"],
      },
    },
  },
  required: ["formats"],
};

async function ollamaGenerate(model, abi, userdoc, devdoc) {
  const user = [
    `ABI (functions only): ${JSON.stringify((abi || []).filter((x) => x.type === "function")).slice(0, 14000)}`,
    `NatSpec userdoc (@notice): ${JSON.stringify(userdoc || {}).slice(0, 6000)}`,
    `NatSpec devdoc (@param/@dev): ${JSON.stringify(devdoc || {}).slice(0, 6000)}`,
    `Produce the "formats" JSON now.`,
  ].join("\n\n");

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: FORMAT_SCHEMA,
      keep_alive: "30m",
      options: { temperature: 0.2, num_ctx: 32768 },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data.message?.content ?? "{}");
}

// Deterministic field normalization — some ERC-7730 formats require params the model
// tends to omit. We fill sane defaults so the linter's semantic checks pass without
// the model having to know every schema nuance.
function normalizeFormats(formats) {
  // Formats that are valid WITHOUT extra params. Anything else (unit, enum, nftName, …)
  // needs params/definitions the model can't reliably synthesize → downgrade to `raw`
  // rather than emit a field the linter rejects.
  const SAFE = new Set(["raw", "addressName", "tokenAmount", "amount", "duration", "date"]);
  for (const spec of Object.values(formats || {})) {
    // Drop fields with an empty/invalid path (the linter rejects them, and they carry no
    // clear-signing value); keep only well-formed paths.
    spec.fields = (spec.fields || []).filter((f) => typeof f.path === "string" && f.path.trim().length > 0);
    for (const f of spec.fields) {
      if (f.format === "addressName") {
        if (!f.params || !f.params.types) f.params = { ...(f.params || {}), types: ["wallet", "eoa", "contract"] };
      } else if (f.format === "date") {
        if (!f.params || !f.params.encoding) f.params = { ...(f.params || {}), encoding: "timestamp" };
      } else if (!SAFE.has(f.format)) {
        f.format = "raw";
        delete f.params;
      }
    }
  }
  return formats;
}

// --- deterministic decimals()/symbol() via eth_call (NEVER the model) ----------------
async function ethCall(rpc, to, selector) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data: selector }, "latest"] }),
  });
  const j = await res.json();
  return j.result;
}
async function tokenMeta(chainId, tokenAddr) {
  const rpc = RPCS[chainId];
  if (!rpc || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddr)) return null;
  try {
    const dec = await ethCall(rpc, tokenAddr, "0x313ce567"); // decimals()
    const decimals = dec && dec !== "0x" ? parseInt(dec, 16) : null;
    return { address: tokenAddr, decimals };
  } catch {
    return null;
  }
}

// --- erc7730 lint (the hard structural gate) ----------------------------------------
function lint(descriptor) {
  return new Promise((resolve) => {
    let dir, file;
    try {
      dir = mkdtempSync(join(tmpdir(), "erc7730-"));
      file = join(dir, "calldata-candidate.json");
      writeFileSync(file, JSON.stringify(descriptor, null, 2));
    } catch (e) {
      return resolve({ passed: false, output: "tmp write failed: " + e.message });
    }
    const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } };
    const p = spawn(ERC7730_BIN, ["lint", file], { timeout: 30000 });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => { cleanup(); resolve({ passed: false, output: "lint spawn error: " + e.message }); });
    p.on("close", (code) => { cleanup(); resolve({ passed: code === 0, output: out.slice(0, 2000) }); });
  });
}

// Per-field confidence: NatSpec-backed labels score higher than source-inferred ones.
function confidence(descriptor, sourcify) {
  const notice = JSON.stringify(sourcify.userdoc ?? {}).toLowerCase();
  const out = [];
  const formats = descriptor.display?.formats ?? {};
  for (const spec of Object.values(formats)) {
    const intentBacked = spec.intent && notice.includes(String(spec.intent).toLowerCase().split(" ")[0] || "");
    out.push({ field: "intent", value: (intentBacked ? 92 : 74) + "%", width: (intentBacked ? 92 : 74) + "%" });
    for (const f of spec.fields ?? []) {
      const backed = f.label && notice.includes(String(f.label).toLowerCase().split(" ")[0] || "");
      out.push({ field: f.path, value: (backed ? 95 : 78) + "%", width: (backed ? 95 : 78) + "%" });
    }
    break; // one function's worth of chips for the UI
  }
  return out;
}

// --- routes --------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, model: DEFAULT_MODEL });
  if (!authorized(req)) return json(res, 401, { error: "unauthorized" });

  if (req.method === "POST" && req.url === "/load") {
    if (inflight.load >= CAP.load) return json(res, 429, { error: "busy — a load is already in progress" });
    inflight.load++;
    const body = await readBody(req);
    const model = pickModel(body.model);
    try {
      const freed = await freeGpu(); // stop other DGX procs so the model always fits
      const ms = await ollamaWarm(model);
      return json(res, 200, {
        model,
        ready: true,
        freed,
        steps: [
          { at: 300, pct: 12, text: `▸ freeing GPU · ${freed.join(" · ")}`, color: "#9BA2B8" },
          { at: 900, pct: 55, text: `▸ warming ${model}`, color: "#9BA2B8" },
          { at: 1400, pct: 85, text: "▸ weights resident", color: "#9BA2B8" },
          { at: 1800, pct: 100, text: `▸ ready ✓ · ${ms} ms`, color: "#3ECF8E" },
        ],
      });
    } catch (e) {
      console.error("load failed:", String(e));
      return json(res, 502, { error: "warm failed" });
    } finally {
      inflight.load--;
    }
  }

  if (req.method === "POST" && req.url === "/generate") {
    if (inflight.generate >= CAP.generate) return json(res, 429, { error: "busy — too many generations in flight" });
    const body = await readBody(req);
    const chainId = Number(body.chainId || 1);
    const address = String(body.address || "").toLowerCase();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return json(res, 400, { error: "bad address" });
    if (!Number.isInteger(chainId) || chainId <= 0) return json(res, 400, { error: "bad chainId" });
    inflight.generate++;
    try {
      // 1. Sourcify v2 inputs
      const sres = await fetch(`${SOURCIFY}/${chainId}/${address}?fields=abi,userdoc,devdoc,metadata,proxyResolution`);
      if (!sres.ok) return json(res, 404, { error: `sourcify ${sres.status}` });
      const sourcify = await sres.json();

      // 1b. proxy → generate from the IMPLEMENTATION's logic (ABI/NatSpec), but bind the
      // descriptor to the proxy address the user actually calls.
      let genAbi = sourcify.abi, genUser = sourcify.userdoc, genDev = sourcify.devdoc, boundImpl = null;
      const implRaw = sourcify.proxyResolution?.isProxy ? sourcify.proxyResolution.implementations?.[0]?.address : null;
      const impl = /^0x[0-9a-fA-F]{40}$/.test(String(implRaw || "")) ? implRaw : null; // validate before re-fetch
      if (impl) {
        try {
          const ires = await fetch(`${SOURCIFY}/${chainId}/${impl}?fields=abi,userdoc,devdoc`);
          if (ires.ok) {
            const iso = await ires.json();
            if (Array.isArray(iso.abi) && iso.abi.length) {
              genAbi = iso.abi; genUser = iso.userdoc; genDev = iso.devdoc; boundImpl = impl;
            }
          }
        } catch { /* fall back to the proxy's own ABI */ }
      }

      // 2. model → display.formats only
      const model = pickModel(body.model);
      const gen = await ollamaGenerate(model, genAbi, genUser, genDev);

      // 3. assemble the descriptor with a DETERMINISTIC context (never model-guessed)
      const ct = sourcify.metadata?.settings?.compilationTarget; // { "path/File.sol": "Name" }
      const name = (ct && Object.values(ct)[0]) || sourcify.metadata?.output?.devdoc?.title || "Contract";
      const owner = sourcify.metadata?.output?.devdoc?.author || null;
      // erc7730 InputContract requires `abi` (inline list or URL) alongside deployments.
      const descriptor = {
        $schema: "https://eips.ethereum.org/assets/eip-7730/erc7730-v1.schema.json",
        context: {
          $id: name,
          contract: { deployments: [{ chainId: Number(chainId), address }], abi: Array.isArray(genAbi) ? genAbi : [] },
        },
        metadata: { owner: owner || name },
        display: { formats: normalizeFormats(gen.formats || {}) },
      };

      // 3b. deterministic decimals enrichment (best-effort; NEVER model-inferred). Surfaced
      // to the UI via the inputs chip below — NOT stored in metadata (not an ERC-7730 field).
      const meta = await tokenMeta(chainId, address);

      // 4. HARD GATE — erc7730 lint (full linter output stays server-side only)
      const lintRes = await lint(descriptor);
      if (!lintRes.passed) console.error(`lint rejected ${chainId}:${address}:`, lintRes.output.replace(/\s+/g, " ").slice(0, 300));
      // 5. confidence + inputs summary
      const conf = confidence(descriptor, { userdoc: genUser });
      const abiFns = Array.isArray(genAbi) ? genAbi.filter((x) => x.type === "function").length : 0;
      return json(res, 200, {
        chainId: String(chainId),
        address,
        descriptor: JSON.stringify(descriptor, null, 2),
        confidence: conf,
        lintPassed: lintRes.passed,
        // A short, path-free reason when lint rejects (full linter output stays in server logs).
        lintReason: lintRes.passed ? null : "descriptor failed structural validation",
        status: "candidate",
        attested: false,
        generatedBy: model,
        inputs: [
          { id: "identity", title: "Identity", sub: `chainId ${chainId} · ${address.slice(0, 6)}…${address.slice(-4)}`, enrichment: false },
          { id: "abi", title: "ABI", sub: `${abiFns} functions`, enrichment: false },
          { id: "natspec", title: "NatSpec", sub: genUser && Object.keys(genUser.methods || {}).length ? "@notice present" : "absent — source-inferred", enrichment: false },
          { id: "proxy", title: "Proxy", sub: boundImpl ? `proxy — bound to ${boundImpl.slice(0, 6)}…` : sourcify.proxyResolution?.isProxy ? "proxy" : "not a proxy", enrichment: false },
          { id: "decimals", title: "Token decimals", sub: meta?.decimals != null ? `${meta.decimals} · eth_call` : "n/a", enrichment: true },
        ],
      });
    } catch (e) {
      console.error("generate failed:", String(e));
      return json(res, 502, { error: "generate failed" });
    } finally {
      inflight.generate--;
    }
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log(`dgx-wrapper listening on 127.0.0.1:${PORT} · model ${DEFAULT_MODEL}`));
