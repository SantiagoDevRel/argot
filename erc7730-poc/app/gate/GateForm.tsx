"use client";

import { useState } from "react";

// Password-only gate form. POSTs the code to /api/gate; on success the cookie is set
// server-side and we hard-navigate to the studio (proxy.ts then lets us through).
export default function GateForm() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [anim, setAnim] = useState("none");

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (res.ok) {
        window.location.replace("/");
        return;
      }
    } catch {
      /* fall through to error */
    }
    setBusy(false);
    setErr(true);
    setAnim("none");
    setTimeout(() => setAnim("shake .45s ease"), 20);
  };

  return (
    <div
      style={{
        width: 340,
        maxWidth: "88vw",
        marginTop: 30,
        background: "#0C0F1B",
        border: "1px solid #1E2440",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 24px 70px rgba(0,0,0,.5)",
        animation: anim,
      }}
    >
      <div style={{ font: "600 9.5px var(--font-mono)", letterSpacing: ".18em", color: "#8F94FF", marginBottom: 9 }}>ACCESS CODE</div>
      <input
        type="password"
        value={code}
        onChange={(e) => {
          setCode(e.target.value);
          setErr(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        autoFocus
        placeholder="•••"
        className="u-input"
        style={{
          width: "100%",
          padding: "11px 13px",
          background: "#080B14",
          border: "1px solid #232A45",
          borderRadius: 10,
          color: "#EFEDE6",
          font: "600 15px var(--font-mono)",
          letterSpacing: ".3em",
          outline: "none",
        }}
      />
      <button
        onClick={submit}
        disabled={busy}
        className="u-btn u-btn-blue"
        style={{
          width: "100%",
          marginTop: 10,
          padding: "11px 0",
          background: "#181EA9",
          border: "1px solid #2A32D8",
          borderRadius: 10,
          color: "#FFFFFF",
          font: "700 12.5px var(--font-mono)",
          letterSpacing: ".09em",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.7 : 1,
          transition: "transform .18s, box-shadow .3s, background .25s",
        }}
      >
        {busy ? "Opening…" : "Open the studio →"}
      </button>
      <div style={{ font: "400 10.5px/1.6 var(--font-sans)", color: err ? "#FE7446" : "#6B7290", marginTop: 11, transition: "color .25s" }}>
        {err ? "That code didn’t match — try again." : "Enter access code to open the studio."}
      </div>
    </div>
  );
}
