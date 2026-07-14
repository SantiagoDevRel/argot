"use client";

import { type Dispatch, type SetStateAction, type CSSProperties } from "react";
import type { DbRow } from "@/lib/data";
import type { EntityFocus } from "./EntityModal";

type Hover = { t: string; k: string } | null;
type Props = {
  db: DbRow[];
  onOpen: (row: DbRow, focus: EntityFocus) => void;
  live: boolean;
  dbView: "graph" | "table";
  setDbView: (v: "graph" | "table") => void;
  fStatus: string;
  setFStatus: (s: string) => void;
  fChain: string;
  setFChain: (s: string) => void;
  q: string;
  setQ: (s: string) => void;
  dbChainOpen: boolean;
  setDbChainOpen: Dispatch<SetStateAction<boolean>>;
  hover: Hover;
  setHover: (h: Hover) => void;
};

const CONX = 176,
  ENTX = 490,
  ATTX = 806;

export default function DatabaseTab(p: Props) {
  const query = p.q.trim().toLowerCase();
  const rows = p.db.filter(
    (r) =>
      (p.fStatus === "all" || r.status === p.fStatus) &&
      (p.fChain === "all" || r.chain === p.fChain) &&
      (!query || r.addr.toLowerCase().includes(query) || r.contract.toLowerCase().includes(query) || r.fn.toLowerCase().includes(query))
  );
  const rowsSet = new Set(rows.map((r) => r.id));
  const attTotal = p.db.filter((r) => r.status === "attested").length;

  // graph geometry
  const consList: { name: string; addrs: string[] }[] = [];
  const seen: Record<string, { name: string; addrs: string[] }> = {};
  p.db.forEach((r) => {
    if (!seen[r.contract]) {
      seen[r.contract] = { name: r.contract, addrs: [] };
      consList.push(seen[r.contract]);
    }
    if (!seen[r.contract].addrs.includes(r.addr)) seen[r.contract].addrs.push(r.addr);
  });
  const conPos: Record<string, number> = {};
  consList.forEach((c, i) => (conPos[c.name] = 74 + i * 65));
  const attNames: string[] = [];
  p.db.forEach((r) => {
    if (r.att && !attNames.includes(r.att)) attNames.push(r.att);
  });
  const attPos: Record<string, number> = {};
  attNames.forEach((a, i) => (attPos[a] = 104 + i * 84));
  const entPos: Record<string, number> = {};
  p.db.forEach((r, i) => (entPos[r.id] = 46 + i * 54));

  const hv = p.hover;
  const entHL = (r: DbRow) => !!(hv && ((hv.t === "e" && hv.k === r.id) || (hv.t === "c" && hv.k === r.contract) || (hv.t === "a" && hv.k === r.att)));
  const edge = (x1: number, y1: number, x2: number, y2: number) => `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;

  const statusOpts: [string, string][] = [
    ["all", "All"],
    ["candidate", "Candidate"],
    ["attested", "Attested"],
  ];
  const dbChains = ["all", "Ethereum", "Arbitrum", "Polygon", "Base"];

  return (
    <div style={{ animation: "fadeUp .45s ease both" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <h2 style={{ font: "700 19px var(--font-mono)", letterSpacing: ".01em", color: "#EFEDE6", margin: 0 }}>
          Arkiv entities — <span style={{ color: "#A6AAFF" }}>the queryable clear-signing store.</span>
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 9, font: "500 10.5px var(--font-mono)", color: "#6B7290" }}>
          <span>
            {rows.length} of {p.db.length} Arkiv entities · {attTotal} attested
          </span>
          <span
            title={p.live ? "queried live from Arkiv (Braga testnet)" : "seed set — testnet unreachable"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              borderRadius: 999,
              border: `1px solid ${p.live ? "rgba(62,207,142,.4)" : "#232A45"}`,
              color: p.live ? "#3ECF8E" : "#6B7290",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.live ? "#3ECF8E" : "#565E7E", boxShadow: p.live ? "0 0 7px #3ECF8E" : "none" }} />
            {p.live ? "live · Braga" : "seed"}
          </span>
        </div>
      </div>
      <p style={{ font: "400 12px/1.65 var(--font-sans)", color: "#9BA2B8", margin: "8px 0 18px", maxWidth: 700 }}>
        Lead with queryability — lookups a flat registry can’t do: descriptors by attester, coverage gaps across chains, stale bindings after redeploys.
      </p>

      {/* controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", background: "#0C0F1B", border: "1px solid #232A45", borderRadius: 9, padding: 3 }}>
          {(["graph", "table"] as const).map((v) => (
            <button
              key={v}
              onClick={() => p.setDbView(v)}
              style={{ padding: "6px 16px", background: p.dbView === v ? "#181EA9" : "transparent", border: "none", borderRadius: 6, color: p.dbView === v ? "#FFFFFF" : "#6B7290", font: "600 11px var(--font-mono)", letterSpacing: ".06em", cursor: "pointer", transition: "all .25s", textTransform: "capitalize" }}
            >
              {v}
            </button>
          ))}
        </div>
        <span style={{ width: 1, height: 22, background: "#1E2440" }} />
        {statusOpts.map(([v, l]) => (
          <button
            key={v}
            onClick={() => p.setFStatus(v)}
            className="u-pick"
            style={{ padding: "7px 13px", background: p.fStatus === v ? "rgba(24,30,169,.35)" : "transparent", border: `1px solid ${p.fStatus === v ? "#4A52E0" : "#232A45"}`, borderRadius: 999, color: p.fStatus === v ? "#EFEDE6" : "#6B7290", font: "500 11px var(--font-mono)", cursor: "pointer", transition: "all .2s" }}
          >
            {l}
          </button>
        ))}
        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              p.setDbChainOpen((v) => !v);
            }}
            className="u-hoverborder"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 13px", background: "#0C0F1B", border: "1px solid #232A45", borderRadius: 999, color: "#9BA2B8", font: "500 11px var(--font-mono)", cursor: "pointer", transition: "border-color .25s" }}
          >
            {p.fChain === "all" ? "All chains" : p.fChain}
            <span style={{ color: "#6B7290", fontSize: 7, display: "inline-block", transform: p.dbChainOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .25s" }}>▼</span>
          </button>
          {p.dbChainOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 150, background: "#0F1322", border: "1px solid #2A3155", borderRadius: 11, padding: 5, zIndex: 35, boxShadow: "0 18px 44px rgba(0,0,0,.6)", animation: "fadeUp .18s ease both" }}>
              {dbChains.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    p.setFChain(v);
                    p.setDbChainOpen(false);
                  }}
                  className="u-menuitem"
                  style={{ display: "block", width: "100%", padding: "8px 10px", background: p.fChain === v ? "rgba(24,30,169,.4)" : "transparent", border: "none", borderRadius: 7, color: "#EFEDE6", font: "500 12px var(--font-mono)", cursor: "pointer", textAlign: "left" }}
                >
                  {v === "all" ? "All chains" : v}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          value={p.q}
          onChange={(e) => p.setQ(e.target.value)}
          spellCheck={false}
          placeholder="search address / contract…"
          className="u-input"
          style={{ flex: 1, minWidth: 200, maxWidth: 320, padding: "8px 13px", background: "#0C0F1B", border: "1px solid #232A45", borderRadius: 999, color: "#EFEDE6", font: "500 11.5px var(--font-mono)", outline: "none" }}
        />
      </div>

      {p.dbView === "graph" ? (
        <div style={{ background: "#0C0F1B", border: "1px solid #1E2440", borderRadius: 16, padding: 8, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 14, right: 18, display: "flex", gap: 14, font: "500 9.5px var(--font-mono)", color: "#6B7290", zIndex: 2 }}>
            <Legend swatch={<span style={{ width: 9, height: 9, borderRadius: "50%", border: "1.5px dashed #FE7446" }} />} label="candidate" />
            <Legend swatch={<span style={{ width: 9, height: 9, borderRadius: "50%", background: "#181EA9", border: "1.5px solid #6E74F0" }} />} label="attested" />
            <Legend swatch={<span style={{ width: 9, height: 9, borderRadius: 3, background: "#141830", border: "1.5px solid #4A52E0" }} />} label="contract" />
            <Legend swatch={<span style={{ width: 8, height: 8, background: "#141830", border: "1.5px solid #8F94FF", transform: "rotate(45deg)" }} />} label="attester" />
          </div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ position: "relative", width: 980, height: 470, margin: "0 auto" }}>
              <svg width="980" height="470" viewBox="0 0 980 470" style={{ display: "block" }}>
                {/* edges */}
                {p.db.map((r) => {
                  const ey = entPos[r.id],
                    cy = conPos[r.contract];
                  const hl = entHL(r),
                    vis = rowsSet.has(r.id);
                  const col = r.status === "attested" ? "#4A52E0" : "#FE7446";
                  const o = !vis ? 0 : hv ? (hl ? 0.95 : 0.1) : 0.55;
                  return (
                    <g key={"ge" + r.id}>
                      <path d={edge(ENTX - 12, ey, CONX + 10, cy)} style={{ fill: "none", stroke: hl ? col : "#262E52", strokeWidth: hl ? 1.8 : 1.1, strokeDasharray: r.status === "candidate" ? "5 5" : "none", opacity: o, transition: "stroke .25s, opacity .25s, stroke-width .25s" }} />
                      {r.att && <path d={edge(ENTX + 12, ey, ATTX - 10, attPos[r.att])} style={{ fill: "none", stroke: hl ? "#8F94FF" : "#262E52", strokeWidth: hl ? 1.8 : 1.1, opacity: o, transition: "stroke .25s, opacity .25s, stroke-width .25s" }} />}
                    </g>
                  );
                })}
                {/* contract nodes */}
                {consList.map((c) => {
                  const y = conPos[c.name];
                  const connected = p.db.filter((r) => r.contract === c.name);
                  const vis = connected.some((r) => rowsSet.has(r.id));
                  const hl = !!(hv && ((hv.t === "c" && hv.k === c.name) || (hv.t === "e" && connected.some((r) => r.id === hv.k)) || (hv.t === "a" && connected.some((r) => r.att === hv.k))));
                  const o = !vis ? 0.08 : hv ? (hl ? 1 : 0.2) : 0.92;
                  return (
                    <g key={"c" + c.name} onClick={() => { const f = p.db.find((x) => x.contract === c.name); if (f) p.onOpen(f, "contract"); }} onMouseEnter={() => p.setHover({ t: "c", k: c.name })} onMouseLeave={() => p.setHover(null)} style={{ cursor: "pointer", opacity: o, transition: "opacity .25s" }}>
                      <rect x={CONX - 7} y={y - 7} width={14} height={14} rx={4} style={{ fill: "#141830", stroke: "#4A52E0", strokeWidth: 1.4 }} />
                    </g>
                  );
                })}
                {/* attester nodes */}
                {attNames.map((a) => {
                  const y = attPos[a];
                  const connected = p.db.filter((r) => r.att === a);
                  const vis = connected.some((r) => rowsSet.has(r.id));
                  const hl = !!(hv && ((hv.t === "a" && hv.k === a) || (hv.t === "e" && connected.some((r) => r.id === hv.k)) || (hv.t === "c" && connected.some((r) => r.contract === hv.k))));
                  const o = !vis ? 0.08 : hv ? (hl ? 1 : 0.2) : 0.92;
                  return (
                    <g key={"a" + a} onClick={() => { const f = p.db.find((x) => x.att === a); if (f) p.onOpen(f, "attester"); }} onMouseEnter={() => p.setHover({ t: "a", k: a })} onMouseLeave={() => p.setHover(null)} style={{ cursor: "pointer", opacity: o, transition: "opacity .25s" }}>
                      <rect x={ATTX - 6} y={y - 6} width={12} height={12} rx={2} transform={`rotate(45 ${ATTX} ${y})`} style={{ fill: "#141830", stroke: "#8F94FF", strokeWidth: 1.4 }} />
                    </g>
                  );
                })}
                {/* entity nodes */}
                {p.db.map((r) => {
                  const y = entPos[r.id],
                    vis = rowsSet.has(r.id),
                    hl = entHL(r);
                  const o = !vis ? 0.08 : hv ? (hl ? 1 : 0.18) : 0.92;
                  return (
                    <g key={"e" + r.id} onClick={() => p.onOpen(r, null)} onMouseEnter={() => p.setHover({ t: "e", k: r.id })} onMouseLeave={() => p.setHover(null)} style={{ cursor: "pointer", opacity: o, transition: "opacity .25s" }}>
                      <circle cx={ENTX} cy={y} r={hl ? 12 : 9} style={{ fill: r.status === "attested" ? "#181EA9" : "rgba(254,116,70,.1)", stroke: r.status === "attested" ? "#6E74F0" : "#FE7446", strokeWidth: 1.6, strokeDasharray: r.status === "attested" ? "none" : "4 4", animation: r.status === "candidate" && vis ? "march 1.4s linear infinite" : "none", transition: "r .2s" }} />
                    </g>
                  );
                })}
              </svg>
              {/* contract labels */}
              {consList.map((c) => {
                const y = conPos[c.name];
                const connected = p.db.filter((r) => r.contract === c.name);
                const vis = connected.some((r) => rowsSet.has(r.id));
                const hl = !!(hv && ((hv.t === "c" && hv.k === c.name) || (hv.t === "e" && connected.some((r) => r.id === hv.k)) || (hv.t === "a" && connected.some((r) => r.att === hv.k))));
                const o = !vis ? 0.08 : hv ? (hl ? 1 : 0.2) : 0.92;
                return (
                  <div key={"cl" + c.name} onClick={() => { const f = p.db.find((x) => x.contract === c.name); if (f) p.onOpen(f, "contract"); }} onMouseEnter={() => p.setHover({ t: "c", k: c.name })} onMouseLeave={() => p.setHover(null)} style={{ position: "absolute", left: 0, top: y - 11, width: CONX - 18, textAlign: "right", opacity: o, transition: "opacity .25s", cursor: "pointer" }}>
                    <div style={{ font: "600 11px var(--font-mono)", color: "#C9CEDF", whiteSpace: "nowrap" }}>{c.name}</div>
                    <div style={{ font: "400 9px var(--font-mono)", color: "#565E7E", whiteSpace: "nowrap", marginTop: 1 }}>{c.addrs.length > 1 ? c.addrs.length + " deployments" : c.addrs[0]}</div>
                  </div>
                );
              })}
              {/* attester labels */}
              {attNames.map((a) => {
                const y = attPos[a];
                const connected = p.db.filter((r) => r.att === a);
                const vis = connected.some((r) => rowsSet.has(r.id));
                const hl = !!(hv && ((hv.t === "a" && hv.k === a) || (hv.t === "e" && connected.some((r) => r.id === hv.k)) || (hv.t === "c" && connected.some((r) => r.contract === hv.k))));
                const o = !vis ? 0.08 : hv ? (hl ? 1 : 0.2) : 0.92;
                return (
                  <div key={"al" + a} onClick={() => { const f = p.db.find((x) => x.att === a); if (f) p.onOpen(f, "attester"); }} onMouseEnter={() => p.setHover({ t: "a", k: a })} onMouseLeave={() => p.setHover(null)} style={{ position: "absolute", left: ATTX + 18, top: y - 6, opacity: o, transition: "opacity .25s", cursor: "pointer", font: "600 10.5px var(--font-mono)", color: "#C9CEDF", whiteSpace: "nowrap" }}>
                    {a}
                  </div>
                );
              })}
              {/* entity fn labels */}
              {p.db.map((r) => {
                const y = entPos[r.id],
                  vis = rowsSet.has(r.id),
                  hl = entHL(r);
                const o = !vis ? 0.08 : hv ? (hl ? 1 : 0.18) : 0.92;
                return (
                  <div key={"el" + r.id} onClick={() => p.onOpen(r, null)} onMouseEnter={() => p.setHover({ t: "e", k: r.id })} onMouseLeave={() => p.setHover(null)} style={{ position: "absolute", left: ENTX + 19, top: y - 6, opacity: o, transition: "opacity .25s", cursor: "pointer", font: "500 9.5px var(--font-mono)", color: "#9BA2B8", whiteSpace: "nowrap" }}>
                    {r.fn}
                  </div>
                );
              })}
            </div>
          </div>
          {rows.length === 0 && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", font: "500 12px var(--font-mono)", color: "#6B7290", background: "rgba(7,8,15,.55)" }}>no Arkiv entities match — adjust filters</div>}
        </div>
      ) : (
        <div style={{ background: "#0C0F1B", border: "1px solid #1E2440", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ ...tableGrid, padding: "12px 18px", borderBottom: "1px solid #1A2036", font: "600 9.5px var(--font-mono)", letterSpacing: ".15em", color: "#565E7E" }}>
            <span>CONTRACT</span>
            <span>CHAIN</span>
            <span>SELECTOR</span>
            <span>STATUS</span>
            <span>ATTESTER</span>
            <span>CONFIDENCE</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="u-row" style={{ ...tableGrid, padding: "12px 18px", borderBottom: "1px solid #10142A", alignItems: "center", transition: "background .2s" }}>
              <span onClick={() => p.onOpen(r, "contract")} title="Open the Arkiv entity (highlights the contract address)" style={{ minWidth: 0, cursor: "pointer" }}>
                <span className="u-link" style={{ display: "block", font: "600 12px var(--font-mono)", color: "#EFEDE6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.contract}</span>
                <span style={{ display: "block", font: "400 10px var(--font-mono)", color: "#565E7E", marginTop: 2 }}>{r.addr}</span>
              </span>
              <span style={{ font: "500 11.5px var(--font-mono)", color: "#9BA2B8" }}>{r.chain}</span>
              <span onClick={() => p.onOpen(r, null)} title="Open the Arkiv entity" style={{ minWidth: 0, cursor: "pointer" }}>
                <span style={{ display: "block", font: "500 11px var(--font-mono)", color: "#A6AAFF" }}>{r.sel}</span>
                <span style={{ display: "block", font: "400 10px var(--font-mono)", color: "#565E7E", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.fn}</span>
              </span>
              <span>
                <span onClick={() => p.onOpen(r, "status")} title="Open the entity (highlights status)" style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, border: `1px ${r.status === "candidate" ? "dashed rgba(254,116,70,.55)" : "solid rgba(74,82,224,.55)"}`, color: r.status === "candidate" ? "#FE7446" : "#A6AAFF", background: r.status === "candidate" ? "rgba(254,116,70,.07)" : "rgba(24,30,169,.2)", font: "600 10px var(--font-mono)", cursor: "pointer" }}>{r.status}</span>
              </span>
              <span onClick={() => r.att && p.onOpen(r, "attester")} title={r.att ? "Open the entity (highlights the attester)" : undefined} style={{ font: "500 11.5px var(--font-mono)", color: r.att ? "#C9CEDF" : "#3A4160", cursor: r.att ? "pointer" : "default" }}>{r.att || "—"}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 48, height: 3, borderRadius: 99, background: "#1A2036", overflow: "hidden", display: "inline-block" }}>
                  <span style={{ display: "block", height: "100%", width: r.conf + "%", background: r.status === "candidate" ? "#FE7446" : "#4A52E0" }} />
                </span>
                <span style={{ font: "600 11px var(--font-mono)", color: "#C9CEDF" }}>{r.conf}%</span>
              </span>
            </div>
          ))}
          {rows.length === 0 && <div style={{ padding: 38, textAlign: "center", font: "500 12px var(--font-mono)", color: "#6B7290" }}>no Arkiv entities match — adjust filters</div>}
        </div>
      )}
    </div>
  );
}

function Legend({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {swatch}
      {label}
    </span>
  );
}

const tableGrid: CSSProperties = { display: "grid", gridTemplateColumns: "1.7fr .75fr 1.6fr .95fr 1fr 1fr", gap: 10 };
