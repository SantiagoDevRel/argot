import GateForm from "./GateForm";

// Server-rendered gate surface. proxy.ts redirects every locked request here.
export const metadata = { title: "Clear Signing Studio — Access" };

export default function GatePage() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#07080F",
        backgroundImage:
          "radial-gradient(720px 440px at 16% 6%, rgba(24,30,169,.34), transparent 65%),radial-gradient(560px 400px at 88% 98%, rgba(254,116,70,.07), transparent 60%),repeating-linear-gradient(90deg, rgba(155,162,184,.03) 0 1px, transparent 1px 76px),repeating-linear-gradient(0deg, rgba(155,162,184,.03) 0 1px, transparent 1px 76px)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", animation: "fadeUp .6s ease both" }}>
        <div
          style={{
            position: "relative",
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "linear-gradient(135deg,#181EA9,#2A32D8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "700 20px var(--font-mono)",
            color: "#EFEDE6",
            boxShadow: "0 0 20px rgba(24,30,169,.55)",
          }}
        >
          A
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              width: 11,
              height: 11,
              borderRadius: "50%",
              background: "#FE7446",
              border: "2px solid #07080F",
              boxShadow: "0 0 10px rgba(254,116,70,.8)",
            }}
          />
        </div>
        <div style={{ font: "700 21px/1.2 var(--font-mono)", letterSpacing: ".04em", color: "#EFEDE6", textAlign: "center", marginTop: 18 }}>
          Clear Signing Studio
        </div>
        <div style={{ font: "500 10px var(--font-mono)", letterSpacing: ".22em", color: "#6B7290", marginTop: 7 }}>
          ARKIV × SOURCIFY · INTERNAL DEMO
        </div>
        <GateForm />
        <div style={{ font: "400 10px var(--font-mono)", color: "#454B66", marginTop: 22 }}>
          Arkiv — the Web3 database · descriptors here are candidate drafts
        </div>
      </div>
    </div>
  );
}
