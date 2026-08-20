"use client";

import { useCallback, useEffect, useState } from "react";

type Tab = "parity" | "query" | "fourbyte" | "explorer";

const TABS: { id: Tab; label: string; blurb: string }[] = [
  {
    id: "parity",
    label: "1 · Same question, two databases",
    blurb: "Sourcify's most-used endpoint, answered by Postgres and by Arkiv, diffed field by field at the same projection.",
  },
  {
    id: "query",
    label: "2 · Questions Sourcify has no URL for",
    blurb: "Not that Postgres could not answer these — that the public API exposes no way to ask them. Against Arkiv each one is a single predicate.",
  },
  {
    id: "fourbyte",
    label: "3 · The 4-byte service",
    blurb: "Selector to signature: the cheapest thing Sourcify runs, and the best fit for this database.",
  },
  {
    id: "explorer",
    label: "4 · Browse the entities",
    blurb: "What is physically stored on the chain: typed attributes and the payload, one record at a time.",
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

/** A hash or key, kept readable without hiding what it is. */
function Mono({ children, wrap }: { children: React.ReactNode; wrap?: boolean }) {
  return <span className={wrap ? "mono wrapall" : "mono"}>{children}</span>;
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("parity");
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">[ ARKIV ] × Sourcify — proof of concept</div>
        <h1>Sourcify&apos;s read path, served from Arkiv</h1>
        <p className="lede">
          One complete chain of Sourcify — Unichain, 2,801 verified contracts and every 4-byte selector
          in them — written into Arkiv entities on the Cheesecake devnet. The lookup below hits Arkiv,
          not Postgres, and is diffed live against the real sourcify.dev so the claim can be checked
          rather than believed.
        </p>
      </header>

      <div className="kpis" style={{ marginBottom: 18 }}>
        <Kpi k="Arkiv chain head" v={stats?.chainHeadBlock as string | undefined} />
        <Kpi k="Contracts in Arkiv" v={num(stats?.sourcifyContracts)} />
        <Kpi k="4-byte selectors" v={num(stats?.sourcifySignatures)} />
        <Kpi k="Entities on Cheesecake" v={num(stats?.entitiesOnChain)} />
      </div>
      {stats?.countCostRoundTrips ? (
        <p className="note" style={{ marginTop: -6, marginBottom: 18 }}>
          The three counts above come from the writer, not from the chain — and that is the aggregation
          limit, not a shortcut. Arkiv has no <code>COUNT</code>, so asking it how many entities match means
          walking every page of 200 and adding them up: <strong>{num(stats.countCostRoundTrips)} round trips</strong>{" "}
          for this small slice, and about <strong>{num(stats.countCostAtSourcifyScale)}</strong> for
          Sourcify&apos;s real 44.4M. The first version of this endpoint did count live and hit the
          60-second function timeout. Head block and total entity count, right of them, <em>are</em> live —
          those are one request each.
        </p>
      ) : null}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="lede" style={{ marginTop: -8, marginBottom: 16, fontSize: 13 }}>
        {TABS.find((t) => t.id === tab)?.blurb}
      </p>

      {tab === "parity" && <Parity />}
      {tab === "query" && <Query />}
      {tab === "fourbyte" && <FourByte />}
      {tab === "explorer" && <Explorer />}
    </div>
  );
}

/* ------------------------------------------------------------------ parity */

function SampleButtons({ onPick }: { onPick: (a: string) => void }) {
  const [samples, setSamples] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/query?chainId=130&limit=4")
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

const GROUP_LABEL: Record<string, string> = {
  identity: "Identity — the whole default response",
  abi: "ABI",
  compilation: "Compilation",
  deployment: "Deployment",
};

function Parity() {
  const [address, setAddress] = useState("");
  const [depth, setDepth] = useState<"identity" | "full">("identity");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const run = useCallback(async (addr: string, d: "identity" | "full") => {
    setBusy(true); setErr(null); setRes(null);
    try {
      const r = await fetch(`/api/parity?chainId=130&address=${addr}&depth=${d}`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.statusText);
      setRes(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }, []);

  const groups: string[] = res
    ? [...new Set((res.fields as { group: string }[]).map((f) => f.group))]
    : [];

  return (
    <>
      <div className="panel">
        <h2>GET /v2/contract/130/&#123;address&#125;</h2>
        <p className="sub">
          Sourcify&apos;s dominant read path — they have not published a request breakdown, so this page
          does not put a number on it. Paste a Unichain address, or pick a sample.
        </p>
        <div className="row">
          <div style={{ flex: "1 1 340px" }}>
            <label htmlFor="addr">Contract address</label>
            <input id="addr" value={address} onChange={(e) => setAddress(e.target.value.trim())}
                   placeholder="0x…" style={{ width: "100%" }} />
          </div>
          <div>
            <label htmlFor="depth">Compare</label>
            <select id="depth" value={depth} onChange={(e) => setDepth(e.target.value as "identity" | "full")}>
              <option value="identity">identity — 7 fields</option>
              <option value="full">+ ABI, compilation, deployment</option>
            </select>
          </div>
          <button onClick={() => run(address, depth)} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(address)}>
            {busy ? "asking both…" : "Ask both databases"}
          </button>
          <SampleButtons onPick={(a) => { setAddress(a); run(a, depth); }} />
        </div>
        <p className="note">
          <strong>Why seven fields?</strong> Because seven is the entire record Sourcify returns when you
          do not pass <code>fields</code> — <code>match</code>, <code>creationMatch</code>,{" "}
          <code>runtimeMatch</code>, <code>chainId</code>, <code>address</code>, <code>verifiedAt</code>,{" "}
          <code>matchId</code>. It is not a sample of the answer, it is the answer, and it is what most of
          that 70% receives. Switch the dropdown to compare the ABI, the compilation and the deployment
          as well.
        </p>
        {err && <p className="err">{err}</p>}
      </div>

      {res && (
        <>
          <div className="panel">
            <h2>Verdict</h2>
            <span className={`verdict ${res.verdict}`}>{String(res.verdict).replace(/_/g, " ")}</span>
            <div className="kpis" style={{ marginTop: 14 }}>
              <Kpi k="Fields compared" v={String(res.comparedFields ?? 0)} />
              <Kpi k="Mismatches" v={String(res.mismatches?.length ?? 0)} />
              <Kpi k="Sourcify (Postgres)" v={res.sourcify?.ms != null ? `${res.sourcify.ms} ms` : undefined} />
              <Kpi k="Arkiv (Cheesecake)" v={res.arkiv?.ms != null ? `${res.arkiv.ms} ms` : undefined} />
            </div>

            <div className="cmplegend">
              <span>field</span><span>sourcify.dev</span><span>arkiv</span><span />
            </div>
            {groups.map((g) => (
              <div key={g} style={{ marginTop: 10 }}>
                <div className="grouphead">{GROUP_LABEL[g] ?? g}</div>
                <div className="cmp">
                  {(res.fields as { field: string; sourcify: string | null; arkiv: string | null; equal: boolean; group: string }[])
                    .filter((f) => f.group === g)
                    .map((f) => (
                      <div key={f.field} className={`cmprow ${f.equal ? "" : "isbad"}`}>
                        <div className="cmpk">{f.field}</div>
                        <div className="cmpv"><Mono wrap>{f.sourcify ?? "—"}</Mono></div>
                        <div className="cmpv"><Mono wrap>{f.arkiv ?? "—"}</Mono></div>
                        <div className={`cmpe ${f.equal ? "ok" : "bad"}`}>{f.equal ? "=" : "≠"}</div>
                      </div>
                    ))}
                </div>
              </div>
            ))}

            <p className="note">
              Arkiv&apos;s timing includes a round trip to a public devnet RPC behind Cloudflare. It is not
              a like-for-like latency benchmark against Sourcify&apos;s production Postgres, and is shown
              for shape, not for a win.
            </p>
          </div>

          <div className="panel">
            <h2>Provenance</h2>
            <p className="sub">Where Arkiv&apos;s answer physically came from.</p>
            <dl className="prov">
              <dt>entity key</dt><dd><Mono wrap>{res.arkiv?.entityKey ?? "—"}</Mono></dd>
              <dt>owner</dt><dd><Mono wrap>{res.arkiv?.owner ?? "—"}</Mono></dd>
              <dt>read at block</dt><dd><Mono>{res.arkiv?.blockNumber ?? "—"}</Mono></dd>
              <dt>query sent</dt><dd className="wire"><Mono wrap>{res.arkiv?.query ?? "—"}</Mono></dd>
            </dl>
          </div>

          <div className="panel">
            <div className="rowhead">
              <h2 style={{ margin: 0 }}>The two answers, side by side</h2>
              <button className="ghost" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "hide" : "show"}
              </button>
            </div>
            <p className="sub">
              Both projected to exactly what Sourcify was asked for. Arkiv stores more than this — the whole
              record is on the Browse tab — but showing its full payload against Sourcify&apos;s seven-field
              default would look like a difference and would only be a difference in what was requested.
            </p>
            {showRaw && (
              <div className="grid2" style={{ marginTop: 12 }}>
                <div>
                  <div className="grouphead">sourcify.dev <span className="pill">HTTP {res.sourcify?.httpStatus}</span></div>
                  <pre>{j(res.sourcify?.body)}</pre>
                </div>
                <div>
                  <div className="grouphead">arkiv <span className="pill">entity payload</span></div>
                  <pre>{j(res.arkiv?.body)}</pre>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- query */

const PRESETS: {
  label: string;
  sourcify: string;
  arkiv: string;
  why: string;
  f: Record<string, string>;
}[] = [
  {
    label: "Proxies on this chain",
    sourcify: "No endpoint — and nothing stored to query either.",
    arkiv: "isproxy = bool(true)",
    why: "Sourcify works out proxy status per request and never stores it, so this is not a column you could query even with direct access to their database. Here it is decided once while indexing and written as a bool.",
    f: { chainId: "130", isProxy: "true" },
  },
  {
    label: "Built with solc 0.8.30",
    sourcify: "No endpoint — the column exists, the URL does not.",
    arkiv: "compilerversion startsWith '0.8.30'",
    why: "This is the clearest of the four, and the one worth being precise about. Sourcify's Postgres holds compiler_version and could answer instantly — the public API just exposes no parameter for it, so no consumer can ask. What moving the field into an indexed attribute buys is the query surface, not raw capability. That distinction matters: the honest claim is 'now it is askable', not 'now it is possible'.",
    f: { chainId: "130", compilerVersion: "0.8.30" },
  },
  {
    label: "Large surface — 40+ functions",
    sourcify: "No endpoint — and the number exists nowhere.",
    arkiv: "fncount >= i32(40)",
    why: "Function count is not stored by anybody. It is derived from the ABI while indexing and written as an i32, which is what makes a range comparison possible at all.",
    f: { chainId: "130", minFns: "40" },
  },
  {
    label: "Exact matches with the optimizer on",
    sourcify: "No endpoint — and it is two conditions at once.",
    arkiv: "match = 'exact_match' AND optimizer = bool(true)",
    why: "Two dimensions in one question. Combining conditions is the ordinary thing an index is for, and it is exactly what a lookup-by-address API cannot offer.",
    f: { chainId: "130", match: "exact_match", optimizer: "true" },
  },
];

function Query() {
  const [f, setF] = useState<Record<string, string>>(PRESETS[0].f);
  const [active, setActive] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async (filters: Record<string, string>) => {
    setBusy(true); setErr(null);
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      const r = await fetch(`/api/query?${qs}&limit=50`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.statusText);
      setRes(b);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { run(f); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const P = PRESETS[active];

  return (
    <>
      <div className="panel">
        <h2>Pick a question</h2>
        <div className="row" style={{ marginBottom: 14 }}>
          {PRESETS.map((p, i) => (
            <button key={p.label} className={i === active ? "" : "ghost"}
                    onClick={() => { setActive(i); setF(p.f); run(p.f); }}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="versus">
          <div className="vs vs-no">
            <div className="vshead">Against sourcify.dev</div>
            <div className="vsbody">{P.sourcify}</div>
          </div>
          <div className="vs vs-yes">
            <div className="vshead">Against Arkiv</div>
            <div className="vsbody mono wire">{P.arkiv}</div>
          </div>
        </div>
        <p className="note">{P.why}</p>
      </div>

      <div className="panel">
        <h2>Or build one</h2>
        <p className="sub">Every field here is an indexed attribute on the entity.</p>
        <div className="row">
          <div><label>chainId</label><input value={f.chainId ?? ""} onChange={(e) => set("chainId", e.target.value)} style={{ width: 90 }} /></div>
          <div>
            <label>match</label>
            <select value={f.match ?? ""} onChange={(e) => set("match", e.target.value)}>
              <option value="">any</option><option value="exact_match">exact_match</option><option value="match">match</option>
            </select>
          </div>
          <div>
            <label>isProxy</label>
            <select value={f.isProxy ?? ""} onChange={(e) => set("isProxy", e.target.value)}>
              <option value="">any</option><option value="true">true</option><option value="false">false</option>
            </select>
          </div>
          <div>
            <label>optimizer</label>
            <select value={f.optimizer ?? ""} onChange={(e) => set("optimizer", e.target.value)}>
              <option value="">any</option><option value="true">true</option><option value="false">false</option>
            </select>
          </div>
          <div><label>compiler starts with</label><input value={f.compilerVersion ?? ""} onChange={(e) => set("compilerVersion", e.target.value)} placeholder="0.8." style={{ width: 120 }} /></div>
          <div><label>name starts with</label><input value={f.namePrefix ?? ""} onChange={(e) => set("namePrefix", e.target.value)} placeholder="ERC" style={{ width: 110 }} /></div>
          <div><label>min functions</label><input value={f.minFns ?? ""} onChange={(e) => set("minFns", e.target.value)} style={{ width: 90 }} /></div>
          <button onClick={() => run(f)} disabled={busy}>{busy ? "querying…" : "Run"}</button>
        </div>
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
              Pages cap at 200 (<code>MAX_LIMIT</code>) and results come back unordered — the SDK marks
              server-side <code>orderBy</code> deprecated because the network does not implement it.
              Anything sorted here was sorted in JavaScript after the fetch.
            </p>
          </div>

          <div className="panel">
            <h2>Results</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr><th>address</th><th>name</th><th>match</th><th>compiler</th><th>fns</th><th>proxy</th><th>verified</th></tr>
                </thead>
                <tbody>
                  {res.results?.map((r: {
                    entityKey: string; address?: string; name?: string; match?: string;
                    compilerversion?: string; fncount?: number; isproxy?: boolean; verifiedat?: string;
                  }) => (
                    <tr key={r.entityKey}>
                      <td>{r.address}</td>
                      <td>{r.name || "—"}</td>
                      <td>{r.match}</td>
                      <td>{r.compilerversion}</td>
                      <td>{r.fncount}</td>
                      <td>{String(r.isproxy)}</td>
                      <td>{r.verifiedat ? new Date(Number(r.verifiedat) * 1000).toISOString().slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- 4 bytes */

const SAMPLE_SELECTORS = ["0xa9059cbb", "0x095ea7b3", "0x23b872dd", "0x70a08231"];

function FourByte() {
  const [sel, setSel] = useState("0xa9059cbb");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async (s: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/signature?selector=${s}`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.statusText);
      setRes(b);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { run(sel); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <>
      <div className="panel">
        <h2>Selector → signature</h2>
        <p className="sub">
          What a wallet does before it shows you what you are about to sign. Sourcify runs this as a
          separate service at roughly 7 million requests a day; here it is one equality on an indexed
          attribute.
        </p>
        <div className="row">
          <div>
            <label htmlFor="sel">4-byte selector</label>
            <input id="sel" value={sel} onChange={(e) => setSel(e.target.value.trim())} style={{ width: 190 }} />
          </div>
          <button onClick={() => run(sel)} disabled={busy}>{busy ? "looking up…" : "Resolve"}</button>
          {SAMPLE_SELECTORS.map((s) => (
            <button key={s} className="ghost" onClick={() => { setSel(s); run(s); }}>{s}</button>
          ))}
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      {res && (
        <>
          <div className="panel">
            <h2>The query that went to the network</h2>
            <pre className="wire">{res.arkivQuery}</pre>
            <div className="kpis" style={{ marginTop: 12 }}>
              <Kpi k="Matches" v={String(res.count ?? 0)} />
              <Kpi k="Round trip" v={`${res.ms} ms`} />
              <Kpi k="Read at block" v={res.blockNumber ?? undefined} />
              <Kpi k="Payload size" v="86 B median" />
            </div>
          </div>
          <div className="panel">
            <h2>Result</h2>
            <pre>{j(res.results)}</pre>
            <p className="note">
              A selector is four bytes, so collisions are real: different function texts can hash to the
              same value. The entity holds the whole candidate set rather than picking one — in our slice,
              2 of 12,674 selectors have more than one.
            </p>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- explorer */

const KINDS = [
  { id: "verified_contract", label: "verified_contract", note: "One per (chain, address) — 25 typed attributes and the lookup answer as payload." },
  { id: "compilation", label: "compilation", note: "Deduplicated by compilation fingerprint, the way Postgres dedupes compiled_contracts." },
  { id: "signature", label: "signature", note: "One per 4-byte selector — the smallest entity here, 86 bytes of payload at the median." },
];

function EntityCard({ e, index }: { e: Record<string, unknown>; index: number }) {
  const [open, setOpen] = useState(index === 0);
  const attrs = (e.attributes ?? {}) as Record<string, unknown>;
  const title =
    (attrs.name as string) || (attrs.selector as string) || (attrs.address as string) || `entity ${index + 1}`;
  const sub = (attrs.address as string) || (attrs.compilerversion as string) || (attrs.sigtype as string) || "";
  const payloadBytes = e.payload ? JSON.stringify(e.payload).length : 0;

  return (
    <div className={`ecard ${open ? "open" : ""}`}>
      <button className="ehead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="echev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="etitle">{title || "—"}</span>
        <span className="esub">{sub}</span>
        <span className="ebadge">{Object.keys(attrs).length} attrs · {payloadBytes.toLocaleString()} B</span>
      </button>
      {open && (
        <div className="ebody">
          <dl className="prov">
            <dt>entity key</dt><dd><Mono wrap>{String(e.entityKey)}</Mono></dd>
            <dt>owner</dt><dd><Mono wrap>{String(e.owner)}</Mono></dd>
          </dl>

          <div className="grouphead" style={{ marginTop: 14 }}>
            Attributes <span className="pill">searchable</span>
          </div>
          <div className="attrs">
            {Object.entries(attrs).map(([k, v]) => (
              <div className="attr" key={k}>
                <span className="ak">{k}</span>
                <span className="av"><Mono wrap>{String(v)}</Mono></span>
              </div>
            ))}
          </div>

          <div className="grouphead" style={{ marginTop: 14 }}>
            Payload <span className="pill">opaque to the database</span>
          </div>
          <pre>{j(e.payload)}</pre>
        </div>
      )}
    </div>
  );
}

function Explorer() {
  const [kind, setKind] = useState("verified_contract");
  const [limit, setLimit] = useState("20");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async (k: string, n: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/query?kind=${k}&limit=${n}&withPayload=1`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.statusText);
      setRes(b);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { run(kind, limit); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const note = KINDS.find((k) => k.id === kind)?.note;

  return (
    <>
      <div className="panel">
        <h2>Entities on Cheesecake</h2>
        <p className="sub">
          Every record below was written by this project and read back from the chain. Open one to see the
          split the whole design turns on: <strong>attributes are searchable, the payload is not</strong>.
        </p>
        <div className="row">
          <div>
            <label htmlFor="kind">Entity type</label>
            <select id="kind" value={kind} onChange={(e) => { setKind(e.target.value); run(e.target.value, limit); }}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lim">How many</label>
            <select id="lim" value={limit} onChange={(e) => { setLimit(e.target.value); run(kind, e.target.value); }}>
              {["10", "20", "50"].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button onClick={() => run(kind, limit)} disabled={busy}>{busy ? "loading…" : "Reload"}</button>
        </div>
        <p className="note">{note}</p>
        {err && <p className="err">{err}</p>}
      </div>

      {res && (
        <>
          <div className="panel">
            <div className="kpis">
              <Kpi k="Showing" v={String(res.count ?? 0)} />
              <Kpi k="Round trip" v={`${res.ms} ms`} />
              <Kpi k="Read at block" v={res.blockNumber ?? undefined} />
              <Kpi k="Page cap" v="200" />
            </div>
            <pre className="wire" style={{ marginTop: 12 }}>{res.arkivQuery}</pre>
          </div>

          <div className="elist">
            {res.results?.map((e: Record<string, unknown>, i: number) => (
              <EntityCard key={String(e.entityKey)} e={e} index={i} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
