"use client";

import { useState } from "react";

export default function Gate() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/gate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setErr(body.error ?? "Could not unlock.");
    setBusy(false);
  }

  return (
    <div className="wrap" style={{ maxWidth: 420, paddingTop: 120 }}>
      <div className="eyebrow">[ ARKIV ] &times; Sourcify</div>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Access code</h1>
      <p className="lede" style={{ fontSize: 14.5, marginBottom: 18 }}>
        Internal working material. Ask Santiago if you need the code.
      </p>
      <form onSubmit={submit}>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          placeholder="Code"
          aria-label="Access code"
          style={{
            width: "100%",
            fontSize: 16,
            padding: "11px 13px",
            borderRadius: 3,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            color: "var(--ink)",
          }}
        />
        <button type="submit" disabled={busy || !code} style={{ marginTop: 12, width: "100%" }}>
          {busy ? "Checking" : "Unlock"}
        </button>
      </form>
      {err ? <div className="errbar">{err}</div> : null}
    </div>
  );
}
