"use client";

import { type CSSProperties } from "react";

type Stage = { icon: string; iconColor: string; bg: string; border: string; title: string; sub: string; delay: string };

const STAGES: Stage[] = [
  { icon: "{ }", iconColor: "#A6AAFF", bg: "rgba(24,30,169,.22)", border: "1px solid rgba(74,82,224,.45)", title: "Sourcify", sub: "verified ABI · NatSpec · source", delay: ".02s" },
  { icon: "◉", iconColor: "#EFEDE6", bg: "radial-gradient(circle at 35% 30%, #2A32D8, #181EA9 75%)", border: "1px solid #4A52E0", title: "DGX · qwen3-coder-next", sub: "local · offline", delay: ".11s" },
  { icon: "✓", iconColor: "#3ECF8E", bg: "rgba(62,207,142,.08)", border: "1px solid rgba(62,207,142,.45)", title: "erc7730 lint", sub: "hard gate", delay: ".2s" },
  { icon: "◆", iconColor: "#FE7446", bg: "rgba(254,116,70,.07)", border: "1px dashed rgba(254,116,70,.6)", title: "Arkiv entity", sub: "candidate · queryable", delay: ".29s" },
  { icon: "✎", iconColor: "#D9D6C8", bg: "rgba(239,237,230,.05)", border: "1px solid rgba(239,237,230,.22)", title: "App owner", sub: "reviews + adopts", delay: ".38s" },
  { icon: "✦", iconColor: "#EFEDE6", bg: "#181EA9", border: "1px solid #4A52E0", title: "Attestation", sub: "trusted → wallet clear-signs", delay: ".47s" },
];

const CARDS = [
  { color: "#A6AAFF", hover: "#4A52E0", title: "QUERYABLE", body: "Arkiv is the Web3 database. Every descriptor is an entity you can query — by attester, by coverage gap, by stale binding — not a blob in a flat registry." },
  { color: "#FE7446", hover: "rgba(254,116,70,.5)", title: "CANDIDATE-FIRST & SAFE", body: "Generated descriptors are never authoritative. Each lands as a candidate draft; the app owner reviews, adopts, and attests. Nothing is auto-submitted." },
  { color: "#A6AAFF", hover: "#4A52E0", title: "LOCAL", body: "qwen3-coder-next runs on the DGX, fully offline. Sources never leave the box, and every draft must pass the erc7730 linter before it becomes an entity." },
];

export default function HowTab() {
  return (
    <div style={{ animation: "fadeUp .45s ease both", maxWidth: 1240, margin: "0 auto" }}>
      <h2 style={{ font: "700 19px var(--font-mono)", color: "#EFEDE6", margin: "0 0 7px" }}>From verified source to clear-signed transaction</h2>
      <p style={{ font: "400 12.5px/1.65 var(--font-sans)", color: "#9BA2B8", margin: "0 0 24px", maxWidth: 640 }}>
        Six stages. The model only drafts — <span style={{ color: "#EFEDE6" }}>every descriptor stays a candidate until the app that owns the contract adopts and attests it.</span>
      </p>

      <div style={{ background: "#0C0F1B", border: "1px solid #1E2440", borderRadius: 18, padding: "30px 22px", display: "flex", alignItems: "stretch", overflowX: "auto" }}>
        {STAGES.map((s, i) => (
          <div key={s.title} style={{ display: "contents" }}>
            <div style={{ flex: 1, minWidth: 118, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 9, animation: `fadeUp .5s ${s.delay} ease both` }}>
              <div style={{ width: 46, height: 46, borderRadius: s.title === "DGX · qwen3-coder-next" ? "50%" : 12, background: s.bg, border: s.border, display: "flex", alignItems: "center", justifyContent: "center", font: "600 14px var(--font-mono)", color: s.iconColor, boxShadow: s.title === "Attestation" || s.title.startsWith("DGX") ? "0 0 22px rgba(24,30,169,.5)" : "none" }}>
                {s.icon}
              </div>
              <div style={{ font: "600 11.5px/1.35 var(--font-mono)", color: "#EFEDE6" }}>{s.title}</div>
              <div style={{ font: "400 9.5px/1.55 var(--font-mono)", color: "#6B7290" }}>{s.sub}</div>
            </div>
            {i < STAGES.length - 1 && (
              <div style={{ flex: "none", width: 30, display: "flex", alignItems: "center", marginTop: -24 }}>
                <div style={{ width: "100%", height: 2, background: "repeating-linear-gradient(90deg,#3A4160 0 5px,transparent 5px 11px)", animation: "dashMove .9s linear infinite" }} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 13, marginTop: 15 }}>
        {CARDS.map((c, i) => (
          <div key={c.title} className="u-card" style={{ ...cardStyle, animation: `fadeUp .5s ${0.56 + i * 0.08}s ease both` }}>
            <div style={{ font: "700 10.5px var(--font-mono)", letterSpacing: ".16em", color: c.color }}>{c.title}</div>
            <div style={{ font: "400 12.5px/1.7 var(--font-sans)", color: "#9BA2B8" }}>{c.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = { background: "#0C0F1B", border: "1px solid #1E2440", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 9, transition: "border-color .3s" };
