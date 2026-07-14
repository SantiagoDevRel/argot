"use client";

import { useEffect } from "react";
import type { DbRow } from "@/lib/data";

// The Arkiv entity inspector. Click a contract / status / attester in the Database tab and
// this opens the exact on-chain entity, HIGHLIGHTING the field you clicked so you can see
// where it lives. Reads the real attribute set for live rows; synthesizes it for the seed.
export type EntityFocus = "contract" | "address" | "status" | "attester" | null;
export type EntityView = { row: DbRow; focus: EntityFocus } | null;

// tooltip for the confidence attribute — where the number comes from (never a mystery number)
const CONF_TIP =
  "Confidence = how grounded the descriptor's intent & field labels are in the contract's on-chain NatSpec (@notice/@param). Higher = NatSpec-backed; lower = inferred from source. A generation-quality signal for candidates — not a trust guarantee (trust comes from review + attestation).";

// which attribute keys light up for a given click
const FOCUS_KEYS: Record<Exclude<EntityFocus, null>, string[]> = {
  contract: ["contract", "address"],
  address: ["address"],
  status: ["status", "attested"],
  attester: ["attester"],
};

// Preferred display order + friendly presence. Live rows carry all of these; seed rows are
// synthesized from the row fields below.
const ORDER = ["dataset", "type", "chainId", "chain", "address", "contract", "selector", "fn", "status", "attested", "attester", "sourcifyVerified", "generatedBy", "source", "confidence", "descriptorHash"];

function attrsFor(row: DbRow): { key: string; value: string }[] {
  const map = new Map<string, string>();
  // synthesized baseline from the row (always present)
  map.set("contract", row.contract);
  map.set("address", row.addr);
  map.set("chain", row.chain);
  map.set("selector", row.sel);
  map.set("fn", row.fn);
  map.set("status", row.status);
  map.set("attested", row.status === "attested" ? "true" : "false");
  if (row.att) map.set("attester", row.att);
  map.set("confidence", String(row.conf));
  // overlay the real on-chain attributes when present (live rows) — richer + authoritative
  for (const a of row.attrs ?? []) map.set(a.key, String(a.value));
  const keys = [...new Set([...ORDER, ...map.keys()])].filter((k) => map.has(k) && k !== "addrShort" && k !== "chainAddress");
  return keys.map((k) => ({ key: k, value: map.get(k)! }));
}

export default function EntityModal({ data, onClose }: { data: EntityView; onClose: () => void }) {
  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [data, onClose]);

  if (!data) return null;
  const { row, focus } = data;
  const attrs = attrsFor(row);
  const hot = new Set(focus ? FOCUS_KEYS[focus] : []);
  const attested = row.status === "attested";
  const HL = "#FE7446";
  // Live entities have a real 0x…64-hex Arkiv key → link to the Braga explorer entity view.
  // Seed-fallback rows (ids like "e1") don't exist on-chain, so no link.
  const isLiveEntity = /^0x[0-9a-fA-F]{64}$/.test(row.id);
  const explorerUrl = isLiveEntity ? `https://explorer.braga.hoodi.arkiv.network/entity/${row.id}` : null;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(12px,4vw,40px)", background: "rgba(6,7,13,.82)", backdropFilter: "blur(6px)", animation: "fadeUp .2s ease both" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(680px, 94vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", background: "#0C0F1B", border: "1px solid #232A45", borderRadius: 16, boxShadow: "0 30px 90px rgba(0,0,0,.6)", overflow: "hidden", animation: "appIn .28s ease both" }}
      >
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: "1px solid #1A2036", flex: "none" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ font: "700 13px var(--font-mono)", color: "#EFEDE6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.contract}</span>
              <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, border: `1px ${attested ? "solid rgba(74,82,224,.55)" : "dashed rgba(254,116,70,.55)"}`, color: attested ? "#A6AAFF" : "#FE7446", background: attested ? "rgba(24,30,169,.2)" : "rgba(254,116,70,.07)", font: "600 9.5px var(--font-mono)" }}>{row.status}</span>
            </div>
            <span style={{ display: "block", font: "400 10.5px var(--font-mono)", color: "#6B7290", marginTop: 3 }}>Arkiv entity · descriptor for <span style={{ color: "#9BA2B8" }}>{row.fn}</span></span>
          </div>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="u-hoverborder"
              style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "rgba(62,207,142,.1)", border: "1px solid rgba(62,207,142,.45)", borderRadius: 8, color: "#3ECF8E", font: "600 10.5px var(--font-mono)", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              View in explorer ↗
            </a>
          )}
          <button onClick={onClose} className="u-hoverborder" style={{ flex: "none", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid #232A45", borderRadius: 8, color: "#9BA2B8", font: "600 15px var(--font-mono)", cursor: "pointer" }}>✕</button>
        </div>

        {/* body — the entity as Arkiv stores it, focused field highlighted */}
        <div style={{ overflow: "auto", padding: "14px 18px 18px", minHeight: 0 }}>
          {focus && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, font: "500 10.5px var(--font-mono)", color: HL }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: HL, boxShadow: `0 0 8px ${HL}` }} />
              you clicked <b style={{ color: "#EFEDE6", fontWeight: 700 }}>{focus}</b> — highlighted below in the entity
            </div>
          )}

          {/* entity key */}
          <div style={{ background: "#080B14", border: "1px solid #1A2036", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ font: "500 9px var(--font-mono)", letterSpacing: ".12em", color: "#565E7E", textTransform: "uppercase", marginBottom: 4 }}>entity key</div>
            <div style={{ font: "500 11px var(--font-mono)", color: "#A6AAFF", wordBreak: "break-all" }}>{row.id}</div>
          </div>

          {/* attributes */}
          <div style={{ font: "500 9px var(--font-mono)", letterSpacing: ".12em", color: "#565E7E", textTransform: "uppercase", margin: "4px 2px 7px" }}>attributes</div>
          <div style={{ background: "#080B14", border: "1px solid #1A2036", borderRadius: 10, overflow: "hidden" }}>
            {attrs.map((a, i) => {
              const on = hot.has(a.key);
              return (
                <div
                  key={a.key}
                  title={a.key === "confidence" ? CONF_TIP : undefined}
                  style={{
                    display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "baseline",
                    padding: "8px 12px", borderBottom: i < attrs.length - 1 ? "1px solid #10142A" : "none",
                    background: on ? "rgba(254,116,70,.12)" : "transparent",
                    borderLeft: on ? `3px solid ${HL}` : "3px solid transparent",
                    transition: "background .2s", cursor: a.key === "confidence" ? "help" : "default",
                  }}
                >
                  <span style={{ font: "500 10.5px var(--font-mono)", color: on ? HL : "#6B7290", display: "inline-flex", alignItems: "center", gap: 5 }}>{a.key}{a.key === "confidence" && <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 12, height: 12, borderRadius: "50%", border: "1px solid #3A4160", color: "#6B7290", font: "700 8px var(--font-mono)" }}>i</span>}</span>
                  <span style={{ font: "500 11.5px var(--font-mono)", color: on ? "#FFE7DD" : valueColor(a.key), wordBreak: "break-all" }}>{a.value}</span>
                </div>
              );
            })}
          </div>

          <p style={{ font: "400 10.5px/1.6 var(--font-sans)", color: "#565E7E", margin: "12px 2px 0" }}>
            Every field is an indexed attribute you can query — that’s the point of storing descriptors in Arkiv (the Web3 database) instead of a flat file. The clear-signing descriptor JSON is the entity’s payload, hashed above as <span style={{ color: "#6B7290" }}>descriptorHash</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

function valueColor(key: string): string {
  if (key === "attester") return "#C9CEDF";
  if (key === "status" || key === "attested") return "#A6AAFF";
  if (key === "address" || key === "selector" || key === "descriptorHash") return "#A6AAFF";
  return "#C9CEDF";
}
