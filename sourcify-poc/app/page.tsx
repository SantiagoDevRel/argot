"use client";

import { useCallback, useEffect, useState } from "react";

type Tab = "parity" | "record" | "query" | "fourbyte" | "explorer";

const TABS: { id: Tab; label: string; blurb: string }[] = [
  {
    id: "parity",
    label: "1 · Same question, two databases",
    blurb: "Sourcify's most-used endpoint, answered by Postgres and by Arkiv, diffed field by field at the same projection — up to all 24 fields=all fields.",
  },
  {
    id: "record",
    label: "2 · The whole record",
    blurb: "Every fields=all field of one contract — sources, bytecodes, metadata, stdJsonInput/Output — served from Arkiv entities, with per-field status and the read fan-out on display.",
  },
  {
    id: "query",
    label: "3 · Questions Sourcify has no URL for",
    blurb: "Not that Postgres could not answer these — that the public API exposes no way to ask them. Against Arkiv each one is a single predicate.",
  },
  {
    id: "fourbyte",
    label: "4 · The 4-byte service",
    blurb: "Selector to signature: the cheapest thing Sourcify runs, and the best fit for this database.",
  },
  {
    id: "explorer",
    label: "5 · Browse the entities",
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

/**
 * The spine of every tab: Sourcify on the left, Arkiv on the right, always in that
 * order and always the same colours. The comparison used to be a section you had to
 * go find; making it the layout means nobody has to ask which side is which.
 */
function Duo({
  tone = "neutral", left, right,
}: {
  tone?: "neutral" | "win" | "lose";
  left: { big?: string; cap: React.ReactNode };
  right: { big?: string; cap: React.ReactNode };
}) {
  return (
    <div className={`duo ${tone === "neutral" ? "" : tone}`}>
      <div className="l">
        <div className="side">sourcify.dev</div>
        {left.big && <div className="big">{left.big}</div>}
        <div className="cap">{left.cap}</div>
      </div>
      <div className="r">
        <div className="side">on arkiv</div>
        {right.big && <div className="big">{right.big}</div>}
        <div className="cap">{right.cap}</div>
      </div>
    </div>
  );
}

/** The long explanation, available but not shouting. */
function Why({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="why">
      <summary>{label}</summary>
      <div className="body">{children}</div>
    </details>
  );
}

/** A hash or key, kept readable without hiding what it is. */
function Mono({ children, wrap }: { children: React.ReactNode; wrap?: boolean }) {
  return <span className={wrap ? "mono wrapall" : "mono"}>{children}</span>;
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("parity");
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  // Set when a provenance key is clicked: the Browse tab opens on that one entity.
  // Cheesecake has no block explorer to link at, so this app is the explorer.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const inspect = (key: string) => { setFocusKey(key); setTab("explorer"); };
  // Set by the Record tab's "compare all 24" button: parity opens pre-filled, at depth=all.
  const [parityPreset, setParityPreset] = useState<{ address: string; depth: "identity" | "full" | "all" } | null>(null);
  const compareAll = (address: string) => { setParityPreset({ address, depth: "all" }); setTab("parity"); };

  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">[ ARKIV ] × Sourcify — proof of concept</div>
        <h1>Sourcify&apos;s read path, served from Arkiv</h1>
        <p className="lede">
          One whole chain of Sourcify, living in Arkiv — and diffed against their live API on every
          request, so nothing here has to be taken on trust.
        </p>
      </header>

      <div className="kpis" style={{ marginBottom: 18 }}>
        <Kpi k="Arkiv chain head" v={stats?.chainHeadBlock as string | undefined} />
        <Kpi k="Contracts in Arkiv" v={num(stats?.sourcifyContracts)} />
        <Kpi k="4-byte selectors" v={num(stats?.sourcifySignatures)} />
        <Kpi k="Entities on Cheesecake" v={num(stats?.entitiesOnChain)} />
      </div>
      {stats?.countCostRoundTrips ? (
        <Why label={`those counts are not live — and that is the point (${num(stats.countCostRoundTrips)} round trips)`}>
          <p>
            Arkiv has no <code>COUNT</code>. Asking how many entities match means walking every page of
            200 and adding them up — {num(stats.countCostRoundTrips)} round trips for this small slice,
            about {num(stats.countCostAtSourcifyScale)} at Sourcify&apos;s real 44.4M.
          </p>
          <p>
            The first version of this endpoint counted live and hit the 60-second function timeout, so
            the counts come from the writer instead. Head block and total entities <em>are</em> live —
            one request each.
          </p>
        </Why>
      ) : null}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "parity" && <Parity onInspect={inspect} preset={parityPreset} onPresetConsumed={() => setParityPreset(null)} />}
      {tab === "record" && <FullRecord onCompareAll={compareAll} />}
      {tab === "query" && <Query />}
      {tab === "fourbyte" && <FourByte />}
      {tab === "explorer" && <Explorer focusKey={focusKey} onClearFocus={() => setFocusKey(null)} />}
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
  content: "Whole record — every fields=all field, as canonical digests",
  "byte-exact": "Byte-exact probes",
};

function Parity({ onInspect, preset, onPresetConsumed }: {
  onInspect: (key: string) => void;
  preset?: { address: string; depth: "identity" | "full" | "all" } | null;
  onPresetConsumed?: () => void;
}) {
  const [address, setAddress] = useState(preset?.address ?? "");
  const [depth, setDepth] = useState<"identity" | "full" | "all">(preset?.depth ?? "identity");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const run = useCallback(async (addr: string, d: "identity" | "full" | "all") => {
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

  // Arriving from the Record tab's "compare all 24" button: run immediately.
  useEffect(() => {
    if (preset?.address) { run(preset.address, preset.depth); onPresetConsumed?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups: string[] = res
    ? [...new Set((res.fields as { group: string }[]).map((f) => f.group))]
    : [];

  return (
    <>
      <div className="panel">
        <h2>GET /v2/contract/130/&#123;address&#125;</h2>
        <Duo
          left={{ cap: <>Their busiest read. A join across the deployment, the compilation and the match.</> }}
          right={{ cap: <>One equality on indexed attributes. Same response shape, same field names.</> }}
        />
        <div className="row">
          <div style={{ flex: "1 1 340px" }}>
            <label htmlFor="addr">Contract address</label>
            <input id="addr" value={address} onChange={(e) => setAddress(e.target.value.trim())}
                   placeholder="0x…" style={{ width: "100%" }} />
          </div>
          <div>
            <label htmlFor="depth">Compare</label>
            <select id="depth" value={depth} onChange={(e) => setDepth(e.target.value as "identity" | "full" | "all")}>
              <option value="identity">identity — 7 fields</option>
              <option value="full">+ ABI, compilation, deployment</option>
              <option value="all">everything — all 24 fields=all fields</option>
            </select>
          </div>
          <button onClick={() => run(address, depth)} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(address)}>
            {busy ? "asking both…" : "Ask both databases"}
          </button>
          <SampleButtons onPick={(a) => { setAddress(a); run(a, depth); }} />
        </div>
        <Why label="why seven fields is the whole record, not a sample">
          <p>
            Seven is everything Sourcify returns when you do not pass <code>fields</code>:{" "}
            <code>match</code>, <code>creationMatch</code>, <code>runtimeMatch</code>,{" "}
            <code>chainId</code>, <code>address</code>, <code>verifiedAt</code>, <code>matchId</code>.
            Not a sample of the answer — the answer.
          </p>
          <p>Switch the dropdown to compare the ABI, the compilation and the deployment too: 18 fields.</p>
        </Why>
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
              {res.reads && <Kpi k="Arkiv point reads" v={`${res.reads.arkiv}${res.reads.cacheHits ? ` (+${res.reads.cacheHits} cached)` : ""}`} />}
            </div>
            {res.reads?.unavailable?.length ? (
              <p className="err" style={{ marginTop: 10 }}>
                unavailable on-chain: {res.reads.unavailable.join(" · ")}
              </p>
            ) : null}

            <div className="cmplegend">
              <span>field</span><span>sourcify.dev</span><span>arkiv</span><span />
            </div>
            {groups.map((g) => (
              <div key={g} style={{ marginTop: 10 }}>
                <div className="grouphead">{GROUP_LABEL[g] ?? g}</div>
                <div className="cmp">
                  {(res.fields as { field: string; sourcify: string | null; arkiv: string | null; equal: boolean; group: string; sourcifyBytes?: number; arkivBytes?: number }[])
                    .filter((f) => f.group === g)
                    .map((f) => (
                      <div key={f.field} className={`cmprow ${f.equal ? "" : "isbad"}`}>
                        <div className="cmpk">{f.field}</div>
                        <div className="cmpv"><Mono wrap>{f.sourcify ?? "—"}</Mono>{f.sourcifyBytes ? <span className="pill">{f.sourcifyBytes.toLocaleString()} B</span> : null}</div>
                        <div className="cmpv"><Mono wrap>{f.arkiv ?? "—"}</Mono>{f.arkivBytes ? <span className="pill">{f.arkivBytes.toLocaleString()} B</span> : null}</div>
                        <div className={`cmpe ${f.equal ? "ok" : "bad"}`}>{f.equal ? "=" : "≠"}</div>
                      </div>
                    ))}
                </div>
              </div>
            ))}

            <Why label="about those timings">
              <p>
                Arkiv&apos;s number includes a round trip to a public devnet RPC behind Cloudflare. It is
                not a like-for-like benchmark against Sourcify&apos;s production Postgres — shown for
                shape, not for a win.
              </p>
            </Why>
          </div>

          <div className="panel">
            <h2>The two requests</h2>
            <div className="reqs">
              <div className="l">
                <div className="who">sourcify.dev <span className="verb">GET</span></div>
                <a className="url" href={res.sourcify?.url} target="_blank" rel="noopener">
                  {res.sourcify?.url}
                </a>
                <div className="hint">Opens their server. Same response this page compared against.</div>
              </div>
              <div className="r">
                <div className="who">on arkiv <span className="verb">arkiv_query</span></div>
                <span className="q">{res.arkiv?.query ?? "—"}</span>
                <div className="hint">Byte-identical to what the SDK puts on the wire.</div>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>Provenance</h2>
            <p className="sub">Where Arkiv&apos;s answer physically came from.</p>
            <p className="sub" style={{ marginTop: -6 }}>
              The key opens that record on the Browse tab. There is no block explorer for this
              network to link at &mdash; the indexer on that host is a gas-price tracker &mdash; so
              this app is the explorer.
            </p>
            <dl className="prov">
              <dt>entity key</dt>
              <dd>
                {res.arkiv?.entityKey ? (
                  <button className="keylink" onClick={() => onInspect(res.arkiv.entityKey)}>
                    <Mono wrap>{res.arkiv.entityKey}</Mono>
                  </button>
                ) : "—"}
              </dd>
              <dt>owner</dt><dd><Mono wrap>{res.arkiv?.owner ?? "—"}</Mono></dd>
              <dt>read at block</dt><dd><Mono>{res.arkiv?.blockNumber ?? "—"}</Mono></dd>
            </dl>
          </div>

          <div className="panel">
            <div className="rowhead">
              <h2 style={{ margin: 0 }}>The two answers, side by side</h2>
              <button className="ghost" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "hide" : "show"}
              </button>
            </div>
            <p className="sub">Both projected to exactly what Sourcify was asked for.</p>
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

/* ------------------------------------------------------------- full record */

/**
 * Five contracts written end-to-end FIRST by the priority pass (9-priority-send.mjs),
 * so the whole-record view has something complete to show while the bulk send crawls.
 * They are quick-picks, not the limit — any address on the chain works.
 */
const DEMO_CONTRACTS: { addr: string; name: string; why: string }[] = [
  { addr: "0x61d62ed33a3811e6e34083d9b88eadddce7cf6df", name: "ideo", why: "single file" },
  { addr: "0xcefdebb8feb23ab45b7902d81a98e47156464801", name: "DiamondLoupeFacet", why: "proxy facet" },
  { addr: "0xb401ccda43c36935e6059c02103e9541fba3337e", name: "FeeForwarder", why: "13 source files" },
  { addr: "0x87071e6eb50420e21a1f6d29cf64c0983b5b0954", name: "MiniVault", why: "3 files" },
  { addr: "0xe6743fec6cb4bb28c04e1fa74e2e19e309f2f740", name: "HelloWorld", why: "tiny" },
];

const bytesOf = (v: unknown) => (v == null ? 0 : new TextEncoder().encode(JSON.stringify(v)).length);
const kb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/** Which fields only exist once the v2 write landed their compilation/code/sources. */
const V2_FIELDS = new Set([
  "metadata", "storageLayout", "transientStorageLayout", "userdoc", "devdoc", "sourceIds",
  "sources", "creationBytecode", "runtimeBytecode", "stdJsonInput", "stdJsonOutput",
]);

function FieldCard({ name, value, pendingV2, composed }: {
  name: string; value: unknown; pendingV2: boolean; composed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const size = bytesOf(value);
  const isNull = value == null || (typeof value === "object" && value !== null && Object.keys(value as object).length === 0 && !Array.isArray(value));
  const status = value != null
    ? (composed ? "composed at read time" : "served from Arkiv")
    : pendingV2 ? "pending — v2 write still landing" : "null (same as Sourcify)";
  const tone = value != null ? (composed ? "compose" : "ok") : pendingV2 ? "pend" : "nul";
  return (
    <div className={`fcard ${tone}`}>
      <button className="fhead" onClick={() => !isNull && setOpen((v) => !v)} aria-expanded={open}>
        <span className="fname">{name}</span>
        <span className={`fstatus ${tone}`}>{status}</span>
        <span className="fsize">{value != null ? kb(size) : "—"}</span>
        <span className="fchev">{isNull ? "" : open ? "▾" : "▸"}</span>
      </button>
      {open && value != null && (
        <pre className="fbody">{typeof value === "string"
          ? (value.length > 4000 ? value.slice(0, 4000) + `\n… (${kb(size)} total)` : value)
          : JSON.stringify(value, null, 2).slice(0, 4000) + (size > 4000 ? `\n… (${kb(size)} total)` : "")}</pre>
      )}
    </div>
  );
}

function FullRecord({ onCompareAll }: { onCompareAll: (address: string) => void }) {
  const [address, setAddress] = useState(DEMO_CONTRACTS[0].addr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [res, setRes] = useState<any>(null);
  const [hdr, setHdr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async (a: string) => {
    setBusy(true); setErr(null); setRes(null);
    try {
      const r = await fetch(`/api/v2/contract/130/${a}?fields=all`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.statusText);
      setRes(b);
      setHdr({
        reads: r.headers.get("x-arkiv-reads") ?? "",
        cached: r.headers.get("x-arkiv-cache-hits") ?? "",
        unavailable: r.headers.get("x-arkiv-unavailable") ?? "",
        key: r.headers.get("x-arkiv-entity-key") ?? "",
        block: r.headers.get("x-arkiv-block") ?? "",
      });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { run(address); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // hdr starts empty — the first render happens before any fetch has populated it.
  const unavailable = hdr.unavailable ?? "";
  const pendingV2 = unavailable.includes("v2 write not yet landed") || unavailable.includes("unreachable");
  const presentCount = res ? Object.values(res).filter((v) => v != null).length : 0;
  const totalBytes = res ? bytesOf(res) : 0;
  const sources = (res?.sources ?? null) as Record<string, { content: string }> | null;

  const GROUPS: { title: string; fields: string[]; composed?: string[] }[] = [
    { title: "Identity — the default response", fields: ["match", "creationMatch", "runtimeMatch", "chainId", "address", "verifiedAt", "matchId"] },
    { title: "Interface", fields: ["abi", "signatures"], composed: ["signatures"] },
    { title: "Compilation, metadata & docs", fields: ["compilation", "metadata", "userdoc", "devdoc", "storageLayout", "transientStorageLayout", "sourceIds"] },
    { title: "Bytecode — onchain and recompiled", fields: ["creationBytecode", "runtimeBytecode"] },
    { title: "Deployment & proxy", fields: ["deployment", "proxyResolution", "additionalInput"] },
    { title: "The compiler's own I/O — composed like Sourcify composes it", fields: ["stdJsonInput", "stdJsonOutput"], composed: ["stdJsonInput", "stdJsonOutput"] },
  ];

  return (
    <>
      <div className="panel">
        <h2>GET /v2/contract/130/&#123;address&#125;?fields=all</h2>
        <Duo
          left={{ cap: <>One SQL join across eight tables, assembled by their server.</> }}
          right={{ cap: <>Point reads over content-addressed entities, assembled by this adapter — fan-out on display, never hidden.</> }}
        />
        <div className="row">
          <div style={{ flex: "1 1 340px" }}>
            <label htmlFor="raddr">Contract address</label>
            <input id="raddr" value={address} onChange={(e) => setAddress(e.target.value.trim())} style={{ width: "100%" }} />
          </div>
          <button onClick={() => run(address)} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(address)}>
            {busy ? "assembling…" : "Fetch the whole record"}
          </button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {DEMO_CONTRACTS.map((d) => (
            <button key={d.addr} className="ghost" title={d.addr}
                    onClick={() => { setAddress(d.addr); run(d.addr); }}>
              {d.name} · {d.why}
            </button>
          ))}
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      {res && (
        <>
          <div className="panel">
            <div className="kpis">
              <Kpi k="Fields present" v={`${presentCount} / 24`} />
              <Kpi k="Whole record" v={kb(totalBytes)} />
              <Kpi k="Arkiv point reads" v={`${hdr.reads}${hdr.cached && hdr.cached !== "0" ? ` (+${hdr.cached} cached)` : ""}`} />
              <Kpi k="Read at block" v={hdr.block || undefined} />
            </div>
            {pendingV2 && (
              <p className="note" style={{ marginTop: 12 }}>
                This contract&apos;s heavy fields are still landing — the v2 write is being paced by the
                devnet&apos;s anonymous 50-requests/hour meter. Fields below marked <em>pending</em> flip to
                served automatically as their entities arrive; the five quick-pick contracts were written
                end-to-end first.
              </p>
            )}
            {unavailable && !pendingV2 && <p className="err" style={{ marginTop: 12 }}>unavailable: {unavailable}</p>}
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={() => onCompareAll(address)}>Compare all 24 fields vs sourcify.dev →</button>
              <a className="ghost" style={{ padding: "8px 14px", textDecoration: "none" }}
                 href={`/api/v2/contract/130/${address}?fields=all`} target="_blank" rel="noopener">
                raw JSON
              </a>
            </div>
          </div>

          {GROUPS.map((g) => (
            <div className="panel" key={g.title}>
              <div className="grouphead">{g.title}</div>
              <div className="flist">
                {g.fields.map((f) => (
                  <FieldCard key={f} name={f} value={res[f]}
                             pendingV2={pendingV2 && V2_FIELDS.has(f)}
                             composed={g.composed?.includes(f)} />
                ))}
              </div>
            </div>
          ))}

          <div className="panel">
            <div className="grouphead">
              Source files {sources ? <span className="pill">{Object.keys(sources).length} files</span> : null}
            </div>
            {sources && Object.keys(sources).length ? (
              <div className="flist">
                {Object.entries(sources).map(([p, s]) => (
                  <FieldCard key={p} name={p} value={s?.content ?? null} pendingV2={false} />
                ))}
              </div>
            ) : (
              <p className="note">
                {pendingV2
                  ? "Source bodies live as content-addressed sourcefile entities — this contract's are still landing."
                  : "No sources returned."}
              </p>
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
        <Duo
          tone="win"
          left={{ big: "no URL", cap: <>The columns mostly exist in their Postgres. The public API exposes no parameter, so no consumer can ask.</> }}
          right={{ big: "1 predicate", cap: <>Each of these is one condition on an indexed attribute — and they combine.</> }}
        />
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
            <Why label="pages cap at 200, and nothing comes back ordered">
              <p>
                <code>MAX_LIMIT</code> is 200, and the SDK marks server-side <code>orderBy</code>
                deprecated because the network does not implement it. Anything sorted here was sorted in
                JavaScript after the fetch — which is exactly why the listing feed does not work.
              </p>
            </Why>
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

/** What the two answers add up to, said plainly rather than as a status code. */
const VERDICT: Record<string, string> = {
  identical: "Same answer, both services.",
  same_plus_their_wider_dictionary:
    "Everything we return, they confirm. They also know texts outside our one-chain slice.",
  we_know_something_they_do_not:
    "We return a text they do not confirm — worth a look, since our source is their own verified ABIs.",
  not_in_our_slice: "Not in our slice: this selector is not in Unichain's verified ABIs.",
  sourcify_unreachable: "Their service did not answer, so there is nothing to compare against.",
  no_sourcify_equivalent: "Prefix search has no equivalent on their API — this one is Arkiv only.",
};

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
        <Duo
          tone="win"
          left={{ big: "~7M/day", cap: <>A separate service on its own Postgres, consolidating openchain, 4byte.directory and etherface.</> }}
          right={{ big: "86 B", cap: <>Median payload. One equality, one round trip — the whole 9.9M-row dictionary is about <strong>1 GB</strong>.</> }}
        />
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
            <h2>The two requests</h2>
            <div className="reqs">
              <div className="l">
                <div className="who">api.4byte.sourcify.dev <span className="verb">GET</span></div>
                {res.sourcify?.url ? (
                  <a className="url" href={res.sourcify.url} target="_blank" rel="noopener">
                    {res.sourcify.url}
                  </a>
                ) : (
                  <span className="q">no equivalent — their API has no prefix search</span>
                )}
                <div className="hint">Opens their 4-byte service. Same answer this page compared against.</div>
              </div>
              <div className="r">
                <div className="who">on arkiv <span className="verb">arkiv_query</span></div>
                <span className="q">{res.arkivQuery}</span>
                <div className="hint">Byte-identical to what the SDK puts on the wire.</div>
              </div>
            </div>
            <div className="kpis" style={{ marginTop: 14 }}>
              <Kpi k="Sourcify (4-byte service)" v={res.sourcify?.ms != null ? `${res.sourcify.ms} ms` : undefined} />
              <Kpi k="Arkiv (Cheesecake)" v={res.ms != null ? `${res.ms} ms` : undefined} />
              <Kpi k="Matches" v={String(res.count ?? 0)} />
              <Kpi k="Read at block" v={res.blockNumber ?? undefined} />
            </div>
            <Why label="about those timings">
              <p>
                Both are measured from this server on the same request, so the comparison is at least
                fair in shape — but Arkiv&apos;s number includes a round trip to a public devnet RPC
                behind Cloudflare, and theirs hits a production service. Shown for shape, not for a win.
              </p>
            </Why>
          </div>
          <div className="panel">
            <h2>Both answers, side by side</h2>
            <div className="reqs">
              <div className="l">
                <div className="who">sourcify says</div>
                {res.sourcify?.names?.length ? (
                  <ul className="names">{res.sourcify.names.map((n: string) => <li key={n}>{n}</li>)}</ul>
                ) : (
                  <span className="q">{res.sourcify?.supported === false ? "not asked" : "nothing"}</span>
                )}
              </div>
              <div className="r">
                <div className="who">arkiv says</div>
                {res.comparison?.arkivNames?.length ? (
                  <ul className="names">
                    {res.comparison.arkivNames.map((n: string) => (
                      <li key={n} className={res.sourcify?.names?.includes(n) ? "same" : "only"}>{n}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="q">not in our slice</span>
                )}
              </div>
            </div>
            <p className={`sigverdict ${res.comparison?.verdict}`}>{VERDICT[res.comparison?.verdict] ?? ""}</p>
            <Why label="why their dictionary is bigger, and why that is scope not disagreement">
              <p>
                Theirs is ~9.9M signatures consolidated from openchain, 4byte.directory and etherface —
                every chain, verified or not. Ours is the selectors of one chain&apos;s verified ABIs. So
                they will know texts we do not, and that is the slice, not a defect. The defect would be
                the other direction: a name we return that they cannot confirm.
              </p>
              <p>
                A selector is also only four bytes, so collisions are real: different function texts can
                hash to the same value. The entity holds the whole candidate set rather than picking one.
              </p>
            </Why>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- explorer */

const KINDS = [
  { id: "verified_contract", label: "verified_contract", note: "One per (chain, address) — 27 typed attributes and the lookup answer as payload." },
  { id: "compilation", label: "compilation", note: "Deduplicated by compilation fingerprint, the way Postgres dedupes compiled_contracts — carries metadata, layouts, docs, artifacts and the path→hash source map." },
  { id: "signature", label: "signature", note: "One per 4-byte selector — the smallest entity here, 86 bytes of payload at the median." },
  { id: "sourcefile", label: "sourcefile", note: "One per UNIQUE source file, sha256 content-addressed — OpenZeppelin's ERC20.sol exists on-chain exactly once." },
  { id: "code", label: "code", note: "One per unique bytecode, keccak content-addressed — onchain and recompiled, creation and runtime, all dedup here." },
  { id: "blob", label: "blob", note: "The chunk lane: a component too big for one transaction, split into parts and reassembled (and hash-verified) at read time." },
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

function Explorer({ focusKey, onClearFocus }: { focusKey: string | null; onClearFocus: () => void }) {
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

  const lookup = useCallback(async (key: string) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/entity?key=${key}`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? r.statusText);
      setRes(b);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (focusKey) lookup(focusKey);
    else run(kind, limit);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [focusKey]);

  const note = KINDS.find((k) => k.id === kind)?.note;

  return (
    <>
      <div className="panel">
        <h2>Entities on Cheesecake</h2>
        <Duo
          left={{ big: "10 tables", cap: <>The whole normalized schema — one verification is a join across eight of them.</> }}
          right={{ big: "6 entity kinds", cap: <>Typed attributes you can filter on, plus payloads the database never looks inside — same normalization, content-addressed.</> }}
        />
        {focusKey && (
          <p className="note" style={{ marginTop: 0, marginBottom: 14 }}>
            Showing one entity, opened from its provenance line.{" "}
            <button className="keylink" onClick={() => { onClearFocus(); run(kind, limit); }}>
              Back to browsing all of them
            </button>
          </p>
        )}
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
