"use client";

import { useEffect, type ReactNode } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export type ModalChip = {
  id: string;
  title: string;
  sub?: string;
  enrichment?: boolean;
  detail?: string; // static fallback (pre-generate)
  link?: string | null; // Sourcify human contract page ("View on Sourcify")
  apiLink?: string | null; // exact v2-API deep-link for THIS field's data
  full?: Any; // real data from /api/inputs or /api/generate
  loading?: boolean; // real data still being fetched
};

// Full-screen input inspector. Opens over the studio, scrolls INTERNALLY (the page never
// grows), and links back to Sourcify so every input's provenance is one click away.
export default function InputModal({ chip, onClose }: { chip: ModalChip | null; onClose: () => void }) {
  useEffect(() => {
    if (!chip) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [chip, onClose]);

  if (!chip) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(12px, 4vw, 40px)",
        background: "rgba(6,7,13,.82)",
        backdropFilter: "blur(6px)",
        animation: "fadeUp .2s ease both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(940px, 94vw)",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          background: "#0C0F1B",
          border: "1px solid #232A45",
          borderRadius: 16,
          boxShadow: "0 30px 90px rgba(0,0,0,.6)",
          overflow: "hidden",
          animation: "appIn .28s ease both",
        }}
      >
        {/* header (sticky) */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: "1px solid #1A2036", flex: "none" }}>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ font: "700 13px var(--font-mono)", letterSpacing: ".04em", color: "#EFEDE6" }}>{chip.title}</span>
              {chip.enrichment ? (
                <span style={{ font: "500 8.5px var(--font-mono)", letterSpacing: ".08em", color: "#B9B6A8", border: "1px solid rgba(239,237,230,.22)", borderRadius: 4, padding: "1.5px 6px" }}>eth_call</span>
              ) : (
                <span style={{ font: "500 8.5px var(--font-mono)", letterSpacing: ".08em", color: "#8F94FF", border: "1px solid rgba(143,148,255,.3)", borderRadius: 4, padding: "1.5px 6px" }}>from Sourcify</span>
              )}
            </div>
            {chip.sub && <span style={{ font: "400 10.5px var(--font-mono)", color: "#6B7290", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{chip.sub}</span>}
          </div>
          {chip.link && (
            <a
              href={chip.link}
              target="_blank"
              rel="noopener noreferrer"
              className="u-hoverborder"
              style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "rgba(24,30,169,.22)", border: "1px solid #2A32D8", borderRadius: 8, color: "#A6AAFF", font: "600 10.5px var(--font-mono)", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              View on Sourcify ↗
            </a>
          )}
          <button onClick={onClose} className="u-hoverborder" style={{ flex: "none", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "1px solid #232A45", borderRadius: 8, color: "#9BA2B8", font: "600 15px var(--font-mono)", cursor: "pointer" }}>
            ✕
          </button>
        </div>

        {/* body (the ONLY scroller — the page underneath stays put) */}
        <div style={{ overflow: "auto", padding: "16px 18px", minHeight: 0 }}>
          {chip.apiLink && (
            <a href={chip.apiLink} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 12, font: "500 10px var(--font-mono)", color: "#6B7290", textDecoration: "none", borderBottom: "1px dashed #2A3155", paddingBottom: 1 }}>
              exact {chip.title} JSON from the Sourcify v2 API ↗
            </a>
          )}
          <Body chip={chip} />
        </div>
      </div>
    </div>
  );
}

function Body({ chip }: { chip: ModalChip }) {
  const full = chip.full;
  if (!full && chip.loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, font: "500 12px var(--font-mono)", color: "#8A91A8", padding: "6px 0" }}>
        <span style={{ width: 14, height: 14, border: "2px solid transparent", borderTopColor: "#8F94FF", borderRadius: "50%", display: "inline-block", animation: "spin .8s linear infinite" }} />
        fetching from Sourcify…
      </div>
    );
  }
  // No real data (unverified on Sourcify / bad address) → static explainer.
  if (!full) {
    return (
      <p style={{ font: "400 12.5px/1.7 var(--font-sans)", color: "#9BA2B8", margin: 0 }}>
        {chip.detail || "This contract isn't verified on Sourcify for the selected chain — no source-of-truth data to show."}
      </p>
    );
  }

  if (chip.id === "decimals" && Array.isArray(full.calls)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Note>{full.method}</Note>
        <KV k="RPC" v={full.rpc} mono />
        <KV k="Contract" v={full.to} mono />
        {full.calls.map((c: Any, i: number) => (
          <div key={i} style={{ background: "#080B14", border: "1px solid #1A2036", borderRadius: 10, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ font: "600 11.5px var(--font-mono)", color: "#A6AAFF" }}>{c.fn}</div>
            <KV k="selector" v={c.selector} mono />
            <KV k="raw result" v={c.rawResult || "—"} mono wrap />
            <KV k="decoded" v={String(c.decoded ?? "—")} mono accent />
          </div>
        ))}
      </div>
    );
  }
  if (chip.id === "decimals") return <Note>{full.note || "no token detected at this address"}</Note>;

  if (Array.isArray(full.functions)) return <MonoList items={full.functions} empty="no functions" />;
  if (Array.isArray(full.files)) return <MonoList items={full.files} empty="no source files listed" />;

  if (chip.id === "natspec") {
    const notice = full.notice || {};
    const params = full.params || {};
    const keys = Array.from(new Set([...Object.keys(notice), ...Object.keys(params)]));
    if (!keys.length) return <Note>No NatSpec on this contract — the model infers intent from the source instead.</Note>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {keys.map((fn) => (
          <div key={fn} style={{ background: "#080B14", border: "1px solid #1A2036", borderRadius: 10, padding: "11px 13px" }}>
            <div style={{ font: "600 11px var(--font-mono)", color: "#A6AAFF", marginBottom: 5, wordBreak: "break-all" }}>{fn}</div>
            {notice[fn]?.notice && <div style={{ font: "400 11.5px/1.6 var(--font-sans)", color: "#C9CEDF" }}>“{notice[fn].notice}”</div>}
            {params[fn]?.params && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                {Object.entries(params[fn].params).map(([p, txt]) => (
                  <div key={p} style={{ font: "400 10.5px var(--font-mono)", color: "#8A91A8" }}>
                    <span style={{ color: "#6B7290" }}>@param</span> <span style={{ color: "#C9CEDF" }}>{p}</span> — {String(txt)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (chip.id === "identity" || chip.id === "proxy") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {Object.entries(full).map(([k, v]) => (
          <KV key={k} k={k} v={typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")} mono={k.toLowerCase().includes("address") || k === "implementations"} />
        ))}
      </div>
    );
  }

  // generic fallback: pretty JSON
  return (
    <pre style={{ margin: 0, font: "400 11px/1.6 var(--font-mono)", color: "#C9CEDF", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(full, null, 2)}</pre>
  );
}

function MonoList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <Note>{empty}</Note>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {items.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 10, font: "400 11.5px/1.7 var(--font-mono)", color: "#C9CEDF", padding: "3px 8px", borderRadius: 6, background: i % 2 ? "transparent" : "rgba(255,255,255,.015)", wordBreak: "break-all" }}>
          <span style={{ color: "#3A4160", flex: "none", width: 28, textAlign: "right", userSelect: "none" }}>{i + 1}</span>
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

function KV({ k, v, mono, wrap, accent }: { k: string; v: string; mono?: boolean; wrap?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span style={{ flex: "none", width: 88, font: "500 10px var(--font-mono)", letterSpacing: ".04em", color: "#6B7290", textTransform: "none" }}>{k}</span>
      <span style={{ font: `${mono ? "500 11px var(--font-mono)" : "400 12px var(--font-sans)"}`, color: accent ? "#3ECF8E" : "#C9CEDF", wordBreak: wrap ? "break-all" : "normal", minWidth: 0 }}>{v}</span>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p style={{ font: "400 12px/1.7 var(--font-sans)", color: "#9BA2B8", margin: 0 }}>{children}</p>;
}
