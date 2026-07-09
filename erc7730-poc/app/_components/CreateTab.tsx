"use client";

import { useState, type Dispatch, type SetStateAction, type CSSProperties } from "react";
import type { Chain, Pick, InputChip } from "@/lib/data";
import type { LogLine } from "./Studio";
import InputModal, { type ModalChip } from "./InputModal";

type Model = "idle" | "loading" | "ready";
type Gen = "idle" | "flowing" | "revealing" | "done";
type JsonLine = { n: string; toks: { t: string; c: string }[] };

type Props = {
  chains: Chain[];
  picks: Pick[];
  chip: InputChip[];
  chain: string;
  setChain: (s: string) => void;
  chainOpen: boolean;
  setChainOpen: Dispatch<SetStateAction<boolean>>;
  address: string;
  setAddress: (s: string) => void;
  addrShort: string;
  genInputs: ModalChip[] | null;
  model: Model;
  prog: number;
  log: LogLine[];
  authOpen: boolean;
  setAuthOpen: Dispatch<SetStateAction<boolean>>;
  authCode: string;
  setAuthCode: (s: string) => void;
  authErr: boolean;
  setAuthErr: (b: boolean) => void;
  submitAuth: () => void;
  gen: Gen;
  lines: number;
  badges: boolean;
  copied: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  jsonLines: JsonLine[];
  confidence: { field: string; value: string; width: string }[];
  lintPassed: boolean;
};

const PARTICLES = [
  { px: "34px", py: "-28px", d: "0s" },
  { px: "-30px", py: "-20px", d: ".05s" },
  { px: "28px", py: "26px", d: ".1s" },
  { px: "-32px", py: "22px", d: ".15s" },
  { px: "40px", py: "4px", d: ".08s" },
  { px: "-38px", py: "-6px", d: ".12s" },
];
export default function CreateTab(p: Props) {
  const [modalChip, setModalChip] = useState<ModalChip | null>(null);
  // Merge the static input chips with the REAL per-contract data from /api/generate (full
  // ABI, source files, NatSpec, proxy, decimals + a Sourcify provenance link) once available.
  const realById = new Map((p.genInputs ?? []).map((i) => [i.id, i]));
  const openChip = (c: InputChip) => {
    const real = realById.get(c.id);
    setModalChip({ id: c.id, title: c.title, enrichment: c.enrichment, detail: c.detail, sub: real?.sub ?? c.sub, link: real?.link ?? null, full: real?.full });
  };

  const flowing = p.gen === "flowing";
  const revealing = p.gen === "revealing";
  const genDone = p.gen === "done";
  const genIdle = p.gen === "idle";
  const genBusy = flowing || revealing;

  // DGX node visuals
  let nodeBorder = "dashed #2A3155",
    nodeAnim = "none",
    nodeSubText = "offline",
    nodeSubC = "#565E7E";
  if (p.model === "loading") {
    nodeBorder = "solid #4A52E0";
    nodeSubText = "loading…";
    nodeSubC = "#8F94FF";
  }
  if (p.model === "ready") {
    nodeBorder = "solid #4A52E0";
    nodeAnim = "nodePulse 2.6s ease-in-out infinite";
    nodeSubText = "qwen3-coder-next";
    nodeSubC = "#A6AAFF";
  }
  if (flowing) {
    nodeBorder = "solid #FE7446";
    nodeAnim = "sparkPulse 1.2s ease-in-out infinite";
  }

  const chipAnim = (i: number) => (flowing ? `chipFlash .9s ${i * 0.11}s ease` : "none");

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      {/* contract row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              p.setChainOpen((v) => !v);
            }}
            className="u-hoverborder"
            style={pillBtn}
          >
            <span style={{ width: 8, height: 8, borderRadius: 2.5, background: "#4A52E0", boxShadow: "0 0 7px rgba(74,82,224,.7)" }} />
            {p.chain}
            <span style={{ color: "#6B7290", fontSize: 8, display: "inline-block", transform: p.chainOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .25s" }}>▼</span>
          </button>
          {p.chainOpen && (
            <div style={dropdown}>
              {p.chains.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    p.setChain(c.name);
                    p.setChainOpen(false);
                  }}
                  className="u-menuitem"
                  style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 10px",
                    background: p.chain === c.name ? "rgba(24,30,169,.4)" : "transparent",
                    border: "none",
                    borderRadius: 7,
                    color: "#EFEDE6",
                    font: "500 12px var(--font-mono)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {c.name}
                  <span style={{ color: "#6B7290", fontSize: 10 }}>{c.id}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          value={p.address}
          onChange={(e) => p.setAddress(e.target.value)}
          spellCheck={false}
          placeholder="contract address 0x…"
          className="u-input"
          style={{ flex: 1, minWidth: 250, padding: "10px 14px", background: "#0C0F1B", border: "1px solid #232A45", borderRadius: 10, color: "#EFEDE6", font: "500 12.5px var(--font-mono)", outline: "none" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ font: "500 9.5px var(--font-mono)", letterSpacing: ".14em", color: "#454B66" }}>EXAMPLES</span>
          {p.picks.map((pk) => {
            const active = p.address === pk.addr;
            return (
              <button
                key={pk.label}
                onClick={() => {
                  p.setAddress(pk.addr);
                  p.setChain(pk.chain);
                }}
                className="u-pick"
                style={{
                  padding: "7px 12px",
                  background: active ? "rgba(24,30,169,.32)" : "transparent",
                  border: `1px solid ${active ? "#4A52E0" : "#232A45"}`,
                  borderRadius: 999,
                  color: active ? "#EFEDE6" : "#8A91A8",
                  font: "500 11px var(--font-mono)",
                  cursor: "pointer",
                  transition: "all .2s",
                }}
              >
                {pk.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3-column workbench */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,1fr) 230px minmax(330px,1.14fr)", alignItems: "stretch", gap: 0 }}>
        {/* INPUTS */}
        <section style={{ background: "#0C0F1B", border: "1px solid #1E2440", borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div style={{ font: "700 11.5px var(--font-mono)", letterSpacing: ".16em", color: "#9BA2B8" }}>INPUTS</div>
            <div style={{ font: "400 10px var(--font-mono)", color: "#454B66" }}>resolved for {p.addrShort}</div>
          </div>

          <div style={{ position: "relative", border: "1px solid rgba(74,82,224,.28)", borderRadius: 13, padding: "14px 10px 10px" }}>
            <div style={fieldset}>FROM SOURCIFY · 5 SOURCES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {p.chip.filter((c) => !c.enrichment).map((c, i) => (
                <ChipRow key={c.id} c={c} sub={realById.get(c.id)?.sub ?? c.sub} anim={chipAnim(i)} onOpen={() => openChip(c)} />
              ))}
            </div>
          </div>

          <div style={{ position: "relative", border: "1px dashed rgba(239,237,230,.18)", borderRadius: 13, padding: "14px 10px 10px" }}>
            <div style={{ ...fieldset, color: "#B9B6A8" }}>ON-CHAIN ENRICHMENT · NOT FROM THE LLM</div>
            {p.chip.filter((c) => c.enrichment).map((c) => (
              <ChipRow key={c.id} c={c} sub={realById.get(c.id)?.sub ?? c.sub} anim={chipAnim(5)} onOpen={() => openChip(c)} enrichment />
            ))}
          </div>
        </section>

        <InputModal chip={modalChip} onClose={() => setModalChip(null)} />

        {/* DGX column */}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "30px 0", minHeight: 430 }}>
          {/* flow lines + core */}
          <div style={{ position: "relative", width: "100%", height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* left line + packets */}
            <div style={{ position: "absolute", left: -150, right: "calc(50% + 62px)", top: 60, height: 1, background: "linear-gradient(90deg, transparent 0 32%, rgba(74,82,224,.45))" }}>
              {flowing &&
                [0, 0.1, 0.22, 0.34, 0.46, 0.58].map((d, i) => (
                  <span key={i} style={{ position: "absolute", top: -3.5, left: 0, width: 8, height: 8, borderRadius: "50%", background: "#FE7446", boxShadow: "0 0 12px #FE7446", animation: `travel 1.1s ease-in ${d}s both` }} />
                ))}
            </div>
            {/* right line + packets */}
            <div style={{ position: "absolute", left: "calc(50% + 62px)", right: -150, top: 60, height: 1, background: "linear-gradient(90deg, rgba(74,82,224,.45), transparent 70%)", opacity: revealing || genDone ? 1 : 0.18, transition: "opacity .6s" }}>
              {revealing &&
                [0, 0.4].map((d, i) => (
                  <span key={i} style={{ position: "absolute", top: -3, left: 0, width: 7, height: 7, borderRadius: "50%", background: "#4A52E0", boxShadow: "0 0 10px #4A52E0", animation: `travel .8s linear ${d}s infinite` }} />
                ))}
            </div>
            {/* core */}
            <div
              style={{
                position: "relative",
                width: 104,
                height: 104,
                borderRadius: "50%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                background: "radial-gradient(circle at 35% 30%, rgba(74,82,224,.32), rgba(12,15,27,.95) 72%)",
                border: `1px ${nodeBorder}`,
                transition: "border-color .5s, background .5s",
                animation: nodeAnim,
              }}
            >
              {p.model === "loading" && <span style={{ position: "absolute", inset: -8, border: "2px solid transparent", borderTopColor: "#4A52E0", borderRadius: "50%", animation: "spin .9s linear infinite" }} />}
              {flowing && (
                <>
                  <div style={{ position: "absolute", inset: 6, borderRadius: "50%", border: "1.5px solid rgba(254,116,70,.85)", animation: "coreSpark .8s cubic-bezier(.16,1,.3,1) both" }} />
                  {PARTICLES.map((pt, i) => (
                    <span
                      key={i}
                      style={{ position: "absolute", left: "50%", top: "50%", width: 3.5, height: 3.5, margin: -2, borderRadius: "50%", background: "#FE7446", boxShadow: "0 0 8px rgba(254,116,70,.9)", ["--px" as string]: pt.px, ["--py" as string]: pt.py, animation: `particle .75s cubic-bezier(.16,1,.3,1) ${pt.d} both` } as CSSProperties}
                    />
                  ))}
                </>
              )}
              <span style={{ font: "700 16px var(--font-mono)", letterSpacing: ".12em", color: "#EFEDE6" }}>DGX</span>
              <span style={{ font: "500 8px var(--font-mono)", letterSpacing: ".04em", color: nodeSubC, transition: "color .4s" }}>{nodeSubText}</span>
            </div>
          </div>

          {/* load / generate control */}
          {p.model === "idle" && (
            <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
              <button onClick={() => p.setAuthOpen((v) => !v)} className="u-btn u-btn-blue" style={{ ...btnBlueSm }}>
                Load model
              </button>
              <span style={{ font: "400 9.5px var(--font-mono)", color: "#454B66" }}>gated · access code required</span>
              {p.authOpen && (
                <div style={{ position: "absolute", bottom: "calc(100% + 10px)", left: "50%", transform: "translateX(-50%)", width: 212, background: "#0F1322", border: "1px solid #2A3155", borderRadius: 12, padding: 12, zIndex: 30, boxShadow: "0 18px 48px rgba(0,0,0,.65)", animation: "fadeUp .2s ease both" }}>
                  <div style={{ font: "600 9px var(--font-mono)", letterSpacing: ".16em", color: "#8F94FF", marginBottom: 8 }}>ACCESS CODE REQUIRED</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="password"
                      value={p.authCode}
                      onChange={(e) => {
                        p.setAuthCode(e.target.value);
                        p.setAuthErr(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") p.submitAuth();
                        if (e.key === "Escape") p.setAuthOpen(false);
                      }}
                      autoFocus
                      placeholder="•••"
                      style={{ flex: 1, minWidth: 0, padding: "8px 10px", background: "#080B14", border: `1px solid ${p.authErr ? "#FE7446" : "#2A3155"}`, borderRadius: 8, color: "#EFEDE6", font: "600 13px var(--font-mono)", letterSpacing: ".24em", outline: "none", transition: "border-color .25s" }}
                    />
                    <button onClick={p.submitAuth} className="u-btn u-btn-blue" style={{ flex: "none", width: 36, background: "#181EA9", border: "1px solid #2A32D8", borderRadius: 8, color: "#FFFFFF", font: "700 13px var(--font-mono)", cursor: "pointer" }}>
                      →
                    </button>
                  </div>
                  <div style={{ font: "400 10px/1.5 var(--font-sans)", color: p.authErr ? "#FE7446" : "#565E7E", marginTop: 8, transition: "color .25s" }}>
                    {p.authErr ? "That code didn’t match." : "Gated — same code that opened the studio."}
                  </div>
                </div>
              )}
            </div>
          )}

          {p.model === "loading" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%", padding: "0 18px" }}>
              <div style={{ width: "100%", height: 5, background: "#141830", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${p.prog}%`, background: "linear-gradient(90deg,#181EA9,#4A52E0)", borderRadius: 99, boxShadow: "0 0 12px rgba(74,82,224,.8)", transition: "width .55s ease" }} />
              </div>
              <div style={{ font: "500 10.5px var(--font-mono)", color: "#8A91A8" }}>loading · {p.prog}%</div>
            </div>
          )}

          {p.model === "ready" && (
            <button onClick={p.onGenerate} disabled={genBusy} className="u-btn u-btn-orange" style={{ padding: "12px 28px", background: "#FE7446", border: "1px solid #FE7446", borderRadius: 11, color: "#1A0C05", font: "700 13px var(--font-mono)", letterSpacing: ".09em", cursor: genBusy ? "default" : "pointer", boxShadow: "0 0 24px rgba(254,116,70,.35)", opacity: genBusy ? 0.55 : 1, transition: "transform .18s, box-shadow .3s, opacity .3s" }}>
              {genBusy ? "Generating…" : genDone ? "Regenerate" : "Generate"}
            </button>
          )}

          {p.log.length > 0 && (
            <div style={{ width: "100%", background: "#080B14", border: "1px solid #1A2036", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
              {p.log.slice(-8).map((l, i) => (
                <div key={i} style={{ font: "400 9.5px/1.5 var(--font-mono)", color: l.c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", animation: "lineIn .25s ease both" }}>
                  {l.t}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* OUTPUT */}
        <section style={{ background: "#0C0F1B", border: `1px solid ${revealing || genDone ? "rgba(74,82,224,.55)" : "#1E2440"}`, borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 12, minWidth: 0, boxShadow: genDone ? "0 0 44px rgba(24,30,169,.22)" : "none", transition: "border-color .6s, box-shadow .6s" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ font: "700 11.5px var(--font-mono)", letterSpacing: ".16em", color: "#9BA2B8" }}>OUTPUT</div>
            <div style={{ font: "400 10px var(--font-mono)", color: "#454B66", flex: 1 }}>erc7730.json</div>
            {genDone && (
              <>
                {p.lintPassed ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(62,207,142,.1)", border: "1px solid rgba(62,207,142,.45)", color: "#3ECF8E", font: "600 10px var(--font-mono)", animation: "popIn .4s ease both" }}>erc7730 lint ✓</span>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(240,90,90,.1)", border: "1px solid rgba(240,90,90,.5)", color: "#F05A5A", font: "600 10px var(--font-mono)", animation: "popIn .4s ease both" }}>erc7730 lint ✗ — draft rejected</span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(254,116,70,.07)", border: "1px dashed rgba(254,116,70,.55)", color: "#FE7446", font: "600 10px var(--font-mono)", animation: "popIn .4s .14s ease both" }}>candidate · unattested</span>
              </>
            )}
          </div>

          {genIdle ? (
            <div style={{ flex: 1, minHeight: 330, border: "1px dashed #232A45", borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center" }}>
              <span style={{ font: "600 24px var(--font-mono)", color: "#333A5C" }}>{"{ }"}</span>
              <span style={{ font: "600 12px var(--font-mono)", color: "#8A91A8" }}>no descriptor yet</span>
              <span style={{ font: "400 11.5px/1.65 var(--font-sans)", color: "#6B7290", maxWidth: 300 }}>Load qwen3-coder-next on the DGX, then Generate to draft a candidate ERC-7730 descriptor from the Sourcify sources.</span>
            </div>
          ) : (
            <>
              <div style={{ background: "#080B14", border: "1px solid #1A2036", borderRadius: 12, padding: "13px 13px 13px 8px", overflow: "auto", minHeight: 300, maxHeight: "min(58vh, 520px)", flex: 1 }}>
                {flowing && (
                  <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", font: "500 11px var(--font-mono)", color: "#6B7290" }}>
                    <span style={{ width: 12, height: 12, border: "2px solid transparent", borderTopColor: "#FE7446", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />
                    model drafting…
                  </div>
                )}
                {p.jsonLines.slice(0, p.lines).map((ln) => (
                  <div key={ln.n} style={{ display: "flex", font: "400 11.5px/1.8 var(--font-mono)", whiteSpace: "pre", animation: "lineIn .18s ease both" }}>
                    <span style={{ width: 28, flex: "none", textAlign: "right", paddingRight: 12, color: "#2E3554", userSelect: "none" }}>{ln.n}</span>
                    <span>
                      {ln.toks.map((tk, i) => (
                        <span key={i} style={{ color: tk.c }}>
                          {tk.t}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
                {revealing && <span style={{ display: "inline-block", width: 7, height: 14, background: "#FE7446", marginLeft: 40, animation: "blink .85s step-end infinite" }} />}
              </div>

              {genDone && (
                <>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {(p.badges ? p.confidence : []).slice(0, 6).map((b, i) => (
                      <span key={b.field + i} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "linear-gradient(100deg, #0E1220 42%, rgba(159,168,255,.14) 50%, #0E1220 58%)", backgroundSize: "250% 100%", border: "1px solid #232A45", borderRadius: 8, animation: `popIn .45s ease ${i * 0.13}s both, sheen 3.4s linear infinite` }}>
                        <span style={{ font: "500 10.5px var(--font-mono)", color: "#8A91A8" }}>{b.field}</span>
                        <span style={{ width: 42, height: 3, borderRadius: 99, background: "#1A2036", overflow: "hidden", display: "inline-block" }}>
                          <span style={{ display: "block", height: "100%", width: b.width, background: "#4A52E0" }} />
                        </span>
                        <span style={{ font: "600 10.5px var(--font-mono)", color: "#A6AAFF" }}>{b.value}</span>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ font: "400 10.5px/1.6 var(--font-sans)", color: "#6B7290", maxWidth: 400 }}>
                      Candidate draft — <span style={{ color: "#B9BFD4" }}>the app team reviews, adopts, and attests</span> before any wallet trusts it. Nothing is submitted automatically.
                    </div>
                    <button onClick={p.onCopy} className="u-hoverborder" style={{ padding: "7px 14px", background: "transparent", border: "1px solid #232A45", borderRadius: 8, color: "#9BA2B8", font: "600 10.5px var(--font-mono)", cursor: "pointer", transition: "all .2s" }}>
                      {p.copied ? "copied ✓" : "copy JSON"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ChipRow({ c, sub, anim, onOpen, enrichment }: { c: InputChip; sub: string; anim: string; onOpen: () => void; enrichment?: boolean }) {
  return (
    <button
      onClick={onOpen}
      className="u-hoverborder"
      style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "9px 12px", background: "#0E1220", border: "1px solid #232A45", borderRadius: 10, cursor: "pointer", textAlign: "left", animation: anim, transition: "border-color .2s" }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
          background: enrichment ? "rgba(239,237,230,.07)" : "rgba(24,30,169,.3)",
          border: `1px solid ${enrichment ? "rgba(239,237,230,.22)" : "rgba(74,82,224,.42)"}`,
          color: enrichment ? "#D9D6C8" : "#A6AAFF",
          font: `600 ${c.icon.length > 1 ? 9.5 : 11}px var(--font-mono)`,
        }}
      >
        {c.icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, font: "600 12px var(--font-mono)", color: "#EFEDE6" }}>
          {c.title}
          {enrichment && <span style={{ font: "500 8.5px var(--font-mono)", letterSpacing: ".08em", color: "#B9B6A8", border: "1px solid rgba(239,237,230,.2)", borderRadius: 4, padding: "1.5px 5px" }}>eth_call</span>}
        </span>
        <span style={{ display: "block", font: "400 10.5px var(--font-mono)", color: "#8A91A8", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
      </span>
      <span style={{ flex: "none", font: "500 9px var(--font-mono)", letterSpacing: ".08em", color: "#6B7290", border: "1px solid #232A45", borderRadius: 6, padding: "3px 8px" }}>view →</span>
    </button>
  );
}

const pillBtn: CSSProperties = { display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", background: "#0C0F1B", border: "1px solid #232A45", borderRadius: 10, color: "#EFEDE6", font: "500 12.5px var(--font-mono)", cursor: "pointer", transition: "border-color .25s" };
const dropdown: CSSProperties = { position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 196, background: "#0F1322", border: "1px solid #2A3155", borderRadius: 11, padding: 5, zIndex: 35, boxShadow: "0 18px 44px rgba(0,0,0,.6)", animation: "fadeUp .18s ease both" };
const fieldset: CSSProperties = { position: "absolute", top: -8, left: 12, background: "#0C0F1B", padding: "0 7px", font: "600 9px var(--font-mono)", letterSpacing: ".18em", color: "#8F94FF" };
const btnBlueSm: CSSProperties = { padding: "10px 22px", background: "#181EA9", border: "1px solid #2A32D8", borderRadius: 10, color: "#FFFFFF", font: "700 12px var(--font-mono)", letterSpacing: ".08em", cursor: "pointer", transition: "transform .18s, box-shadow .3s, background .25s" };
