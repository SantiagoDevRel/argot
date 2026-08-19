"use client";

import { useCallback, useEffect, useState } from "react";

type Tab = "parity" | "query" | "entity";

const TABS: { id: Tab; label: string; blurb: string }[] = [
  {
    id: "parity",
    label: "1 · Same question, two databases",
    blurb: "Sourcify's hottest endpoint, answered by Postgres and by Arkiv, diffed field by field.",
  },
  {
    id: "query",
    label: "2 · What Sourcify cannot answer",
    blurb: "Filters that are one predicate against Arkiv and no URL at all against sourcify.dev.",
  },
  {
    id: "entity",
    label: "3 · The entity itself",
    blurb: "The raw Arkiv record: typed attributes, payload, key, owner.",
  },
];

const j = (v: unknown) => JSON.stringify(v, null, 2);

function num(v: unknown) {
  return typeof v === "number" ? v.toLocaleString("en-US") : (v as string | undefined);
}

function Kpi({ k, v }: { k: string; v?: string }) {
  return (
    <div className="kpi">
      <div className="k">{k}</div>
      <div className="v">{v ?? "—"}</div>
    </div>
  );
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("parity");
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">[ ARKIV ] × Sourcify — proof of concept</div>
        <h1>Sourcify&apos;s read path, served from Arkiv</h1>
        <p className="lede">
          One complete chain of Sourcify (Unichain, chain 130) written into Arkiv entities on the
          Cheesecake devnet. The lookup below hits Arkiv, not Postgres — and is diffed live against
          the real sourcify.dev, so the claim can be checked rather than believed.
        </p>
      </header>

      <div className="kpis" style={{ marginBottom: 18 }}>
        <Kpi k="Arkiv chain head" v={stats?.chainHeadBlock as string | undefined} />
        <Kpi k="Sourcify contracts in Arkiv" v={num(stats?.sourcifyContracts)} />
        <Kpi k="Compilations (deduped)" v={num(stats?.sourcifyCompilations)} />
        <Kpi k="Entities on Cheesecake" v={num(stats?.entitiesOnChain)} />
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="lede" style={{ marginTop: -8, marginBottom: 16, fontSize: 13 }}>
        {TABS.find((t) => t.id === tab)?.blurb}
      </p>

      {tab === "parity" && <Parity />}
      {tab === "query" && <Query />}
      {tab === "entity" && <EntityView />}
    </div>
  );
}

/* ------------------------------------------------------------------ parity */

function SampleButtons({ onPick }: { onPick: (a: string) => void }) {
  const [samples, setSamples] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/query?limit=4")
      .then((r) => r.json())
      .then((b) => setSamples((b.results ?? []).map((x: { address?: string }) => x.address).filter(Boolean)))
      .catch(() => {});
  }, []);
  if (!samples.length) return null;
  return (
    <>
      {samples.slice(0, 3).map((a) => (
        <button key={a} className="ghost" onClick={() => onPick(a)} title={a}>
          {a.slice(0, 8)}…
        </button>
      ))}
    </>
  );
}

function Parity() {
  const [address, setAddress] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async (addr: string) => {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch(`/api/parity?chainId=130&address=${addr}`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.statusText);
      setRes(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <>
      <div className="panel">
        <h2>GET /v2/contract/130/&#123;address&#125;</h2>
        <p className="sub">
          Roughly 70% of Sourcify&apos;s contract-API traffic is this one call. Paste a Unichain
          address, or pick a sample.
        </p>
        <div className="row">
          <div style={{ flex: "1 1 420px" }}>
            <label htmlFor="addr">Contract address</label>
            <input
              id="addr"
              value={address}
              onChange={(e) => setAddress(e.target.value.trim())}
              placeholder="0x…"
              style={{ width: "100%" }}
            />
          </div>
          <button
            onClick={() => run(address)}
            disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(address)}
          >
            {busy ? "asking both…" : "Ask both databases"}
          </button>
          <SampleButtons
            onPick={(a) => {
              setAddress(a);
              run(a);
            }}
          />
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      {res && (
        <>
          <div className="panel">
            <h2>Verdict</h2>
            <span className={`verdict ${res.verdict}`}>{String(res.verdict).replace(/_/g, " ")}</span>
            <div className="kpis" style={{ marginTop: 14 }}>
              <Kpi k="Sourcify (Postgres)" v={res.sourcify?.ms != null ? `${res.sourcify.ms} ms` : undefined} />
              <Kpi k="Arkiv (Cheesecake)" v={res.arkiv?.ms != null ? `${res.arkiv.ms} ms` : undefined} />
              <Kpi k="Fields compared" v={String(res.fields?.length ?? 0)} />
              <Kpi k="Mismatches" v={String(res.mismatches?.length ?? 0)} />
            </div>
            <div className="scroll" style={{ marginTop: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th>field</th>
                    <th>sourcify.dev</th>
                    <th>arkiv</th>
                    <th>=</th>
                  </tr>
                </thead>
                <tbody>
                  {res.fields?.map((f: { field: string; sourcify: string | null; arkiv: string | null; equal: boolean }) => (
                    <tr key={f.field}>
                      <td>{f.field}</td>
                      <td>{f.sourcify ?? "—"}</td>
                      <td>{f.arkiv ?? "—"}</td>
                      <td className={f.equal ? "ok" : "bad"}>{f.equal ? "yes" : "NO"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              Arkiv&apos;s timing includes a network round trip to a public devnet RPC behind
              Cloudflare. It is not a like-for-like latency benchmark against Sourcify&apos;s
              production Postgres, and is shown for shape, not for a win.
            </p>
          </div>

          <div className="panel">
            <h2>Provenance</h2>
            <p className="sub">Where Arkiv&apos;s answer physically came from.</p>
            <pre>
              {`entity key   ${res.arkiv?.entityKey ?? "—"}
owner        ${res.arkiv?.owner ?? "—"}
read @ block ${res.arkiv?.blockNumber ?? "—"}
query        `}
              <span className="wire">{res.arkiv?.query ?? "—"}</span>
            </pre>
          </div>

          <div className="grid2">
            <div className="panel">
              <h2>
                sourcify.dev says <span className="pill">HTTP {res.sourcify?.httpStatus}</span>
              </h2>
              <pre>{j(res.sourcify?.body)}</pre>
            </div>
            <div className="panel">
              <h2>
                Arkiv says <span className="pill">from entity payload</span>
              </h2>
              <pre>{j(res.arkiv?.body)}</pre>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- query */

const PRESETS: { label: string; why: string; f: Record<string, string> }[] = [
  {
    label: "Proxies on Unichain",
    why: "proxyResolution is computed per-request by Sourcify and never indexed, so there is no way to ask this of the public API.",
    f: { chainId: "130", isProxy: "true" },
  },
  {
    label: "Compiled with solc 0.8.30",
    why: "Sourcify stores compilerVersion but exposes no filter for it. Here it is an indexed string attribute.",
    f: { chainId: "130", compilerVersion: "0.8.30" },
  },
  {
    label: "Large surface (40+ functions)",
    why: "Function count is not a column anywhere — it is derived from the ABI at index time and stored as i32, so it supports ranges.",
    f: { chainId: "130", minFns: "40" },
  },
  {
    label: "Exact matches, optimizer on",
    why: "Two dimensions at once. The public API offers neither, and combining them is exactly what an index is for.",
    f: { chainId: "130", match: "exact_match", optimizer: "true" },
  },
];

function Query() {
  const [f, setF] = useState<Record<string, string>>({ chainId: "130", isProxy: "true" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [why, setWhy] = useState(PRESETS[0].why);

  const run = useCallback(async (filters: Record<string, string>) => {
    setBusy(true);
    setErr(null);
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      const r = await fetch(`/api/query?${qs}&limit=50`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.statusText);
      setRes(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    run(f);
    // Run once on mount with the default preset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <>
      <div className="panel">
        <h2>Filters</h2>
        <p className="sub">
          Every field below is an indexed attribute on the entity, not a column sitting behind an API
          nobody exposed.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="ghost"
              onClick={() => {
                setF(p.f);
                setWhy(p.why);
                run(p.f);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="row">
          <div>
            <label>chainId</label>
            <input value={f.chainId ?? ""} onChange={(e) => set("chainId", e.target.value)} style={{ width: 90 }} />
          </div>
          <div>
            <label>match</label>
            <select value={f.match ?? ""} onChange={(e) => set("match", e.target.value)}>
              <option value="">any</option>
              <option value="exact_match">exact_match</option>
              <option value="match">match</option>
            </select>
          </div>
          <div>
            <label>isProxy</label>
            <select value={f.isProxy ?? ""} onChange={(e) => set("isProxy", e.target.value)}>
              <option value="">any</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
          <div>
            <label>optimizer</label>
            <select value={f.optimizer ?? ""} onChange={(e) => set("optimizer", e.target.value)}>
              <option value="">any</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
          <div>
            <label>compilerVersion starts with</label>
            <input
              value={f.compilerVersion ?? ""}
              onChange={(e) => set("compilerVersion", e.target.value)}
              placeholder="0.8."
              style={{ width: 130 }}
            />
          </div>
          <div>
            <label>name starts with</label>
            <input
              value={f.namePrefix ?? ""}
              onChange={(e) => set("namePrefix", e.target.value)}
              placeholder="ERC"
              style={{ width: 110 }}
            />
          </div>
          <div>
            <label>min functions</label>
            <input value={f.minFns ?? ""} onChange={(e) => set("minFns", e.target.value)} style={{ width: 90 }} />
          </div>
          <button onClick={() => run(f)} disabled={busy}>
            {busy ? "querying…" : "Run against Arkiv"}
          </button>
        </div>
        <p className="note">{why}</p>
        {err && <p className="err">{err}</p>}
      </div>

      {res && (
        <>
          <div className="panel">
            <h2>The query that went to the network</h2>
            <pre className="wire">{res.arkivQuery}</pre>
            <div className="kpis" style={{ marginTop: 12 }}>
              <Kpi k="Results" v={`${res.count}${res.truncated ? " (page cap)" : ""}`} />
              <Kpi k="Round trip" v={`${res.ms} ms`} />
              <Kpi k="Read at block" v={res.blockNumber ?? undefined} />
              <Kpi k="Sourcify equivalent" v="none" />
            </div>
            <p className="note">
              Page size is capped at 200 by the network (<code>MAX_LIMIT</code>) and results come back
              unordered — the SDK marks server-side <code>orderBy</code> deprecated because the network
              does not implement it. Anything sorted here was sorted in JavaScript after the fetch.
            </p>
          </div>

          <div className="panel">
            <h2>Results</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>address</th>
                    <th>name</th>
                    <th>match</th>
                    <th>compiler</th>
                    <th>fns</th>
                    <th>proxy</th>
                    <th>verified</th>
                  </tr>
                </thead>
                <tbody>
                  {res.results?.map(
                    (r: {
                      entityKey: string;
                      address?: string;
                      name?: string;
                      match?: string;
                      compilerVersion?: string;
                      fnCount?: number;
                      isProxy?: boolean;
                      verifiedAt?: string;
                    }) => (
                      <tr key={r.entityKey}>
                        <td>{r.address}</td>
                        <td>{r.name || "—"}</td>
                        <td>{r.match}</td>
                        <td>{r.compilerVersion}</td>
                        <td>{r.fnCount}</td>
                        <td>{String(r.isProxy)}</td>
                        <td>
                          {r.verifiedAt
                            ? new Date(Number(r.verifiedAt) * 1000).toISOString().slice(0, 10)
                            : "—"}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ entity */

function EntityView() {
  const [res, setRes] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/query?limit=1")
      .then((r) => r.json())
      .then((b) => setRes(b.results?.[0] ?? null))
      .catch((e) => setErr(String(e)));
  }, []);
  return (
    <div className="panel">
      <h2>One verified_contract entity, as stored</h2>
      <p className="sub">
        Attributes are typed — <code>u64</code>, <code>addr</code>, <code>bool</code>, <code>i32</code>,{" "}
        <code>str</code> — which is what makes them filterable. The payload is the Sourcify record
        itself.
      </p>
      {err && <p className="err">{err}</p>}
      <pre>{res ? j(res) : "loading…"}</pre>
      <p className="note">
        Hard limits this entity lives inside, read from the SDK rather than from docs:{" "}
        <code>MAX_ATTRIBUTES = 32</code>, <code>MAX_STRING_BYTES = 128</code>,{" "}
        <code>MAX_PAYLOAD_BYTES = 131,072</code>. The last one is why sources are not in here.
      </p>
    </div>
  );
}
