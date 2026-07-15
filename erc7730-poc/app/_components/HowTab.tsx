"use client";

import { type CSSProperties, useState } from "react";

type Stage = {
  icon: string;
  iconColor: string;
  bg: string;
  border: string;
  glow: string; // the illumination color for the L→R sweep + hover
  title: string;
  sub: string;
  role: string; // one-line "what this stage is"
  detail: string; // the hover explanation
  items: string[]; // concrete inputs/outputs surfaced on hover
};

const STAGES: Stage[] = [
  {
    icon: "{ }", iconColor: "#A6AAFF", bg: "rgba(24,30,169,.22)", border: "1px solid rgba(74,82,224,.45)", glow: "#4A52E0",
    title: "Sourcify", sub: "verified-contract inputs",
    role: "The verified source of truth — everything the generator reads, keyed by chainId + address (no Etherscan key).",
    detail:
      "Sourcify has already verified the bytecode against the published source. We pull every input the model needs in one call — nothing is scraped or guessed.",
    items: [
      "Verified ABI (the function signatures)",
      "NatSpec @notice / @param (human intent per function)",
      "Full Solidity source + compiler metadata",
      "Proxy resolution → the implementation's real logic",
      "Verification match (exact / partial)",
    ],
  },
  {
    icon: "◉", iconColor: "#EFEDE6", bg: "radial-gradient(circle at 35% 30%, #2A32D8, #181EA9 75%)", border: "1px solid #4A52E0", glow: "#2A32D8",
    title: "DGX · qwen3-coder-next", sub: "local · offline generation",
    role: "A local coder model drafts ONLY the hard, semantic part — what each function does and which fields to show.",
    detail:
      "Runs fully offline on the DGX; sources never leave the box. It reads the ABI, NatSpec, AND the relevant Solidity function bodies — so the intent is grounded in what the code actually does, not just parameter names — then emits display.formats (intent + field mapping) as schema-constrained JSON. The deterministic parts are injected in code, never model-guessed.",
    items: [
      "Reads: ABI + NatSpec + the relevant Solidity function bodies",
      "Output: intent per function (\"Swap tokens\", \"Approve USDC\")",
      "Output: field map → tokenAmount / addressName / duration / date / raw",
      "Injected in code: contract identity + context; decimals via on-chain eth_call",
    ],
  },
  {
    icon: "✓", iconColor: "#3ECF8E", bg: "rgba(62,207,142,.08)", border: "1px solid rgba(62,207,142,.45)", glow: "#3ECF8E",
    title: "erc7730 lint", sub: "hard structural gate",
    role: "Ledger's official linter is the gate — a draft that fails is never surfaced as adoptable.",
    detail:
      "Every draft is validated by python-erc7730 (the same linter Ledger uses). On failure, the exact errors are fed back to the model in a self-repair loop (up to 2 passes) to fix paths/formats. Structure only — semantic truth is a human's job, which is why the output stays a candidate.",
    items: [
      "Validates paths, formats, schema conformance",
      "Self-repair: linter errors → model → corrected draft",
      "Fails → dropped (a malformed descriptor is never shown)",
      "Passes → a well-formed, adoptable candidate",
    ],
  },
  {
    icon: "◆", iconColor: "#FE7446", bg: "rgba(254,116,70,.07)", border: "1px dashed rgba(254,116,70,.6)", glow: "#FE7446",
    title: "Arkiv entity", sub: "candidate · queryable",
    role: "This is where OUR part ends: the lint-passing draft is written to Arkiv as a candidate entity — a proposal we seed for the app to review, never authoritative.",
    detail:
      "Everything up to here is us: Sourcify inputs → local generation → lint → we store the draft as a queryable Arkiv entity (status = candidate, attested = false). It's a coverage seed, not an official descriptor. From here the contract's owner takes over — nothing is auto-submitted, and authorship is never ours.",
    items: [
      "WE produced this — a candidate proposal, not an official descriptor",
      "Stored as a queryable entity (query by coverage gap · attester · stale binding)",
      "status = candidate · attested = false (always, at first)",
      "Live on Braga — the Database tab reads it in real time",
    ],
  },
  {
    icon: "✎", iconColor: "#D9D6C8", bg: "rgba(239,237,230,.05)", border: "1px solid rgba(239,237,230,.22)", glow: "#D9D6C8",
    title: "App owner", sub: "reviews + adopts",
    role: "The team that owns the contract reviews the candidate and adopts it — the model only proposes.",
    detail:
      "Authorship stays with the dApp. Nothing is auto-submitted to the registry and nothing is auto-attested. A human with authority over the contract confirms the intent is actually true before it can be trusted.",
    items: [
      "Human review of intent + field mapping",
      "Adopts, edits, or rejects the candidate",
      "Authorship stays with the dApp — never Arkiv/Sourcify",
    ],
  },
  {
    icon: "✦", iconColor: "#EFEDE6", bg: "#181EA9", border: "1px solid #4A52E0", glow: "#6E76FF",
    title: "Attestation", sub: "trusted → wallet clear-signs",
    role: "An authority signs an attestation — only then do wallets trust the descriptor and clear-sign with it.",
    detail:
      "The owner (or an auditor like Ledger) cryptographically vouches for the descriptor. The entity records WHO signed — attested by uniswap.eth, circle.eth, ledger.eth — so trust is legible and queryable. Wallets honor attestations from keys they trust, so the user finally sees a human-readable transaction instead of blind hex.",
    items: [
      "A signer (owner / auditor) attests → the entity shows \"attested by: <ens>\"",
      "Wallets clear-sign only what a key they trust attested",
      "Query it: \"show me everything ledger.eth attested\"",
      "Result: readable tx, not blind hex — the user knows what they sign",
    ],
  },
];

const CARDS = [
  { color: "#A6AAFF", title: "QUERYABLE", body: "Arkiv is the Web3 database. Every descriptor is an entity you can query — by attester, by coverage gap, by stale binding — not a blob in a flat registry." },
  { color: "#FE7446", title: "CANDIDATE-FIRST & SAFE", body: "Generated descriptors are never authoritative. Each lands as a candidate draft; the app owner reviews, adopts, and attests. Nothing is auto-submitted." },
  { color: "#A6AAFF", title: "LOCAL", body: "qwen3-coder-next runs on the DGX, fully offline. Sources never leave the box, and every draft must pass the erc7730 linter before it becomes an entity." },
];

export default function HowTab() {
  // The stage currently explained in the panel below. Hover (or tap) a node to inspect it;
  // defaults to the first stage so the panel is never empty.
  const [active, setActive] = useState(0);
  const a = STAGES[active];

  return (
    <div style={{ animation: "fadeUp .45s ease both", maxWidth: 1240, margin: "0 auto" }}>
      {/* keyframes local to this view: the L→R illumination sweep + connector fill */}
      <style>{`
        @keyframes howSweep {
          0%, 68%, 100% { box-shadow: 0 0 0 rgba(0,0,0,0); border-color: var(--howDim); }
          12% { box-shadow: 0 0 26px 2px var(--howGlow); border-color: var(--howGlow); }
        }
        @keyframes howBeam {
          0%, 70%, 100% { background-position: -140% 0; }
          15%, 55% { background-position: 140% 0; }
        }
        .howNode { transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
        .howNode:hover { transform: translateY(-3px); }
        .howStage { cursor: pointer; }
        .howStage:hover .howTitle { color: #fff; }
      `}</style>

      <h2 style={{ font: "700 19px var(--font-mono)", color: "#EFEDE6", margin: "0 0 7px" }}>From verified source to clear-signed transaction</h2>
      <p style={{ font: "400 12.5px/1.65 var(--font-sans)", color: "#9BA2B8", margin: "0 0 22px", maxWidth: 660 }}>
        Six stages, left to right. The model only drafts — <span style={{ color: "#EFEDE6" }}>every descriptor stays a candidate until the app that owns the contract adopts and attests it.</span>{" "}
        <span style={{ color: "#6B7290" }}>Hover any stage to see what it does.</span>
      </p>

      <div style={{ background: "#0C0F1B", border: "1px solid #1E2440", borderRadius: 18, padding: "30px 22px 26px", display: "flex", alignItems: "stretch", overflowX: "auto" }}>
        {STAGES.map((s, i) => {
          const isActive = i === active;
          const sweepDelay = `${i * 0.5}s`;
          return (
            <div key={s.title} style={{ display: "contents" }}>
              <div
                className="howStage"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive(i)}
                tabIndex={0}
                style={{ flex: 1, minWidth: 122, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 9, animation: `fadeUp .5s ${i * 0.09}s ease both` }}
              >
                <div
                  className="howNode"
                  style={{
                    // custom props drive the shared sweep keyframe per-node
                    ["--howGlow" as string]: s.glow,
                    ["--howDim" as string]: "rgba(74,82,224,.25)",
                    width: 48, height: 48, borderRadius: s.title.startsWith("DGX") ? "50%" : 12,
                    background: s.bg, border: s.border,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    font: "600 14px var(--font-mono)", color: s.iconColor,
                    animation: `howSweep 3s ${sweepDelay} ease-in-out infinite`,
                    ...(isActive ? { boxShadow: `0 0 26px 2px ${s.glow}`, borderColor: s.glow, transform: "translateY(-3px)" } : null),
                  }}
                >
                  {s.icon}
                </div>
                <div className="howTitle" style={{ font: "600 11.5px/1.35 var(--font-mono)", color: isActive ? "#fff" : "#EFEDE6", transition: "color .2s" }}>{s.title}</div>
                <div style={{ font: "400 9.5px/1.55 var(--font-mono)", color: isActive ? s.glow : "#6B7290", transition: "color .2s" }}>{s.sub}</div>
              </div>
              {i < STAGES.length - 1 && (
                <div style={{ flex: "none", width: 34, display: "flex", alignItems: "center", marginTop: -30 }}>
                  <div
                    style={{
                      width: "100%", height: 2, borderRadius: 2,
                      background: "linear-gradient(90deg, transparent 0%, #6E76FF 50%, transparent 100%)",
                      backgroundSize: "220% 100%",
                      animation: `howBeam 3s ${i * 0.5 + 0.25}s ease-in-out infinite`,
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* the explanation panel — updates on hover/tap of a stage */}
      <div
        style={{
          marginTop: 14, background: "#0C0F1B", border: `1px solid ${a.glow}`, borderRadius: 16,
          padding: "18px 20px", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "6px 28px",
          boxShadow: `0 0 30px -14px ${a.glow}`, transition: "border-color .3s, box-shadow .3s",
        }}
      >
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ font: "700 13px var(--font-mono)", color: a.glow }}>{a.title}</span>
          <span style={{ font: "400 11px var(--font-mono)", color: "#6B7290" }}>· {a.sub}</span>
        </div>
        <div>
          <p style={{ font: "600 12.5px/1.6 var(--font-sans)", color: "#EFEDE6", margin: "6px 0 8px" }}>{a.role}</p>
          <p style={{ font: "400 12px/1.7 var(--font-sans)", color: "#9BA2B8", margin: 0 }}>{a.detail}</p>
        </div>
        <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {a.items.map((it) => (
            <li key={it} style={{ font: "400 11.5px/1.5 var(--font-mono)", color: "#B7BCCE", display: "flex", gap: 8 }}>
              <span style={{ color: a.glow, flex: "none" }}>▸</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
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
