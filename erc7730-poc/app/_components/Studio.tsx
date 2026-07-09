"use client";

import { useEffect, useRef, useState } from "react";
import {
  CHAINS,
  PICKS,
  INPUT_CHIPS,
  DB,
  JSON_TEXT,
  CONFIDENCE,
  tokenize,
  shortAddr,
  type LoadStep,
} from "@/lib/data";
import CreateTab from "./CreateTab";
import DatabaseTab from "./DatabaseTab";
import HowTab from "./HowTab";
import type { ModalChip } from "./InputModal";

type Tab = "create" | "database" | "how";
type Model = "idle" | "loading" | "ready";
type Gen = "idle" | "flowing" | "revealing" | "done";
export type LogLine = { t: string; c: string };

const CODE = "123";
const linesOf = (text: string) => text.split("\n").map((l, i) => ({ n: String(i + 1), toks: tokenize(l) }));
const MOCK_LINES = linesOf(JSON_TEXT);

export default function Studio() {
  // The gate is enforced server-side (proxy.ts + /api/gate cookie), so by the time
  // this renders the request is already authorized — no client-side gate overlay.

  // ---- shell ----
  const [tab, setTab] = useState<Tab>("create");

  // ---- create: contract ----
  const [chain, setChain] = useState("Ethereum");
  const [chainOpen, setChainOpen] = useState(false);
  const [address, setAddress] = useState(PICKS[0].addr);

  // ---- model ----
  const [model, setModel] = useState<Model>("idle");
  const [prog, setProg] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [authErr, setAuthErr] = useState(false);

  // ---- generate (real DGX descriptor in live mode; mock seed otherwise) ----
  const [gen, setGen] = useState<Gen>("idle");
  const [lines, setLines] = useState(0);
  const [badges, setBadges] = useState(false);
  const [copied, setCopied] = useState(false);
  const [genLines, setGenLines] = useState(MOCK_LINES);
  const [genConf, setGenConf] = useState(CONFIDENCE);
  const [genLint, setGenLint] = useState(true);
  const [genInputs, setGenInputs] = useState<ModalChip[] | null>(null);

  // ---- database (live Arkiv entities; seed as fallback) ----
  const [dbRows, setDbRows] = useState(DB);
  const [dbLive, setDbLive] = useState(false);
  const [dbView, setDbView] = useState<"graph" | "table">("graph");
  const [fStatus, setFStatus] = useState("all");
  const [fChain, setFChain] = useState("all");
  const [q, setQ] = useState("");
  const [dbChainOpen, setDbChainOpen] = useState(false);
  const [hover, setHover] = useState<{ t: string; k: string } | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const iv = useRef<ReturnType<typeof setInterval> | null>(null);
  const after = (ms: number, fn: () => void) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  };

  useEffect(() => {
    const onDoc = () => {
      setChainOpen(false);
      setDbChainOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => {
      document.removeEventListener("click", onDoc);
      timers.current.forEach(clearTimeout);
      if (iv.current) clearInterval(iv.current);
    };
  }, []);

  // Load the live Arkiv descriptor entities (falls back to the seed on failure).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/entities")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !Array.isArray(d?.rows) || d.rows.length === 0) return;
        setDbRows(d.rows);
        setDbLive(!!d.live);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- model load (calls /api/load, replays steps) ----
  const startLoad = async () => {
    setAuthOpen(false);
    setAuthCode("");
    setModel("loading");
    setProg(2);
    setLog([{ t: "▸ arkiv-dgx-01 · access authorized", c: "#5F6784" }]);
    let steps: LoadStep[];
    try {
      const res = await fetch("/api/load", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: CODE, model: "qwen3-coder-next" }),
      });
      const data = await res.json();
      steps = data.steps;
    } catch {
      return;
    }
    steps.forEach((s) =>
      after(s.at, () => {
        setProg(s.pct);
        setModel(s.pct >= 100 ? "ready" : "loading");
        setLog((l) => [...l, { t: s.text, c: s.color }]);
      })
    );
  };

  const submitAuth = () => {
    if (authCode.trim() === CODE) startLoad();
    else setAuthErr(true);
  };

  // ---- generate (calls /api/generate, reveals the REAL descriptor) ----
  const onGenerate = async () => {
    if (gen === "flowing" || gen === "revealing") return;
    setGen("flowing");
    setLines(0);
    setBadges(false);
    // Fire the real request; hold the "flowing" animation until it returns (live DGX can
    // take ~30–60s), with a small floor so the animation always plays for the mock path.
    const req = fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chainId: CHAINS.find((c) => c.name === chain)?.id ?? "1", address }),
    })
      .then((r) => r.json())
      .catch(() => null);
    const [data] = await Promise.all([req, new Promise((r) => setTimeout(r, 1400))]);

    const descriptor: string = data?.descriptor || JSON_TEXT;
    const revLines = linesOf(descriptor);
    setGenLines(revLines);
    setGenConf(Array.isArray(data?.confidence) && data.confidence.length ? data.confidence : CONFIDENCE);
    setGenLint(data ? !!data.lintPassed : true);
    setGenInputs(Array.isArray(data?.inputs) ? (data.inputs as ModalChip[]) : null);

    setGen("revealing");
    iv.current = setInterval(() => {
      setLines((n) => {
        const total = revLines.length;
        const next = Math.min(n + 1, total);
        if (next >= total) {
          if (iv.current) clearInterval(iv.current);
          after(280, () => setGen("done"));
          after(460, () => setBadges(true));
        }
        return next;
      });
    }, 60);
  };

  const onCopy = () => {
    try {
      navigator.clipboard?.writeText(genLines.map((l) => l.toks.map((t) => t.t).join("")).join("\n"));
    } catch {}
    setCopied(true);
    after(1400, () => setCopied(false));
  };

  const idx = { create: 0, database: 1, how: 2 }[tab];

  // model pill
  let pillText = "Model: idle",
    pillDot = "#565E7E",
    pillAnim = "none",
    pillBorder = "#232A45",
    pillColor = "#8A91A8";
  if (model === "loading") {
    pillText = "Model: loading… " + prog + "%";
    pillDot = "#FE7446";
    pillAnim = "dotPulse 1s ease-in-out infinite";
    pillColor = "#EFEDE6";
    pillBorder = "rgba(254,116,70,.35)";
  }
  if (model === "ready") {
    pillText = "qwen3-coder-next · ready ✓";
    pillDot = "#3ECF8E";
    pillColor = "#EFEDE6";
    pillBorder = "rgba(62,207,142,.4)";
  }

  return (
    <>
      {(
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            background: "#07080F",
            backgroundImage:
              "radial-gradient(900px 480px at 14% -6%, rgba(24,30,169,.2), transparent 62%),radial-gradient(700px 420px at 96% 108%, rgba(254,116,70,.05), transparent 60%),repeating-linear-gradient(90deg, rgba(155,162,184,.022) 0 1px, transparent 1px 76px),repeating-linear-gradient(0deg, rgba(155,162,184,.022) 0 1px, transparent 1px 76px)",
            animation: "appIn .7s ease both",
          }}
        >
          {/* header */}
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              padding: "13px 26px",
              borderBottom: "1px solid #1A2036",
              position: "sticky",
              top: 0,
              zIndex: 40,
              background: "rgba(7,8,15,.84)",
              backdropFilter: "blur(14px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <Logo size={30} />
              <div>
                <div style={{ font: "700 13px var(--font-mono)", letterSpacing: ".05em", color: "#EFEDE6" }}>Clear Signing Studio</div>
                <div style={{ font: "500 8.5px var(--font-mono)", letterSpacing: ".18em", color: "#6B7290", marginTop: 2 }}>ARKIV × SOURCIFY · ERC-7730</div>
              </div>
            </div>

            <div style={{ position: "relative", display: "flex", background: "#0C0F1B", border: "1px solid #232A45", borderRadius: 10, padding: 3 }}>
              <div
                style={{
                  position: "absolute",
                  top: 3,
                  bottom: 3,
                  left: 3,
                  width: 104,
                  borderRadius: 7,
                  background: "#181EA9",
                  boxShadow: "0 0 16px rgba(24,30,169,.55)",
                  transform: `translateX(${idx * 104}px)`,
                  transition: "transform .38s cubic-bezier(.5,1.3,.4,1)",
                }}
              />
              {(["create", "database", "how"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    position: "relative",
                    zIndex: 1,
                    width: 104,
                    padding: "7px 0",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    font: "600 11.5px var(--font-mono)",
                    letterSpacing: ".1em",
                    color: tab === t ? "#FFFFFF" : "#6B7290",
                    transition: "color .3s",
                  }}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 13px",
                border: `1px solid ${pillBorder}`,
                borderRadius: 999,
                background: "#0C0F1B",
                font: "500 11px var(--font-mono)",
                color: pillColor,
                transition: "border-color .4s, color .4s",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: pillDot, boxShadow: `0 0 8px ${pillDot}`, animation: pillAnim }} />
              {pillText}
            </div>
          </header>

          <main style={{ flex: 1, width: "100%", maxWidth: 1380, margin: "0 auto", padding: "24px 26px 44px" }}>
            {tab === "create" && (
              <CreateTab
                chains={CHAINS}
                picks={PICKS}
                chip={INPUT_CHIPS}
                chain={chain}
                setChain={setChain}
                chainOpen={chainOpen}
                setChainOpen={setChainOpen}
                address={address}
                setAddress={setAddress}
                addrShort={shortAddr(address)}
                genInputs={genInputs}
                model={model}
                prog={prog}
                log={log}
                authOpen={authOpen}
                setAuthOpen={setAuthOpen}
                authCode={authCode}
                setAuthCode={setAuthCode}
                authErr={authErr}
                setAuthErr={setAuthErr}
                submitAuth={submitAuth}
                gen={gen}
                lines={lines}
                badges={badges}
                copied={copied}
                onGenerate={onGenerate}
                onCopy={onCopy}
                jsonLines={genLines}
                confidence={genConf}
                lintPassed={genLint}
              />
            )}
            {tab === "database" && (
              <DatabaseTab
                db={dbRows}
                live={dbLive}
                dbView={dbView}
                setDbView={setDbView}
                fStatus={fStatus}
                setFStatus={setFStatus}
                fChain={fChain}
                setFChain={setFChain}
                q={q}
                setQ={setQ}
                dbChainOpen={dbChainOpen}
                setDbChainOpen={setDbChainOpen}
                hover={hover}
                setHover={setHover}
              />
            )}
            {tab === "how" && <HowTab />}
          </main>

          <footer
            style={{
              borderTop: "1px solid #1A2036",
              padding: "13px 26px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div style={{ font: "400 10px var(--font-mono)", color: "#454B66" }}>
              internal demo · generated descriptors are candidate drafts — each app reviews, adopts, attests
            </div>
            <div style={{ font: "500 10px var(--font-mono)", color: "#6B7290" }}>
              Arkiv — <span style={{ color: "#8F94FF" }}>the Web3 database</span>
            </div>
          </footer>
        </div>
      )}
    </>
  );
}

export function Logo({ size }: { size: number }) {
  const dot = size >= 40 ? 11 : 8;
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: size >= 40 ? 12 : 8,
        background: "linear-gradient(135deg,#181EA9,#2A32D8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `700 ${Math.round(size * 0.46)}px var(--font-mono)`,
        color: "#EFEDE6",
        boxShadow: "0 0 20px rgba(24,30,169,.55)",
        flex: "none",
      }}
    >
      A
      <span
        style={{
          position: "absolute",
          top: -dot / 3,
          right: -dot / 3,
          width: dot,
          height: dot,
          borderRadius: "50%",
          background: "#FE7446",
          border: "2px solid #07080F",
          boxShadow: "0 0 10px rgba(254,116,70,.8)",
        }}
      />
    </div>
  );
}
