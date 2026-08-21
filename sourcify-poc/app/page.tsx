"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Tab = "parity" | "record" | "model" | "query" | "fourbyte" | "explorer";

const TABS: { id: Tab; label: string; blurb: string }[] = [
  {
    id: "parity",
    label: "Same question, two databases",
    blurb: "Sourcify's most-used endpoint, answered by Postgres and by Arkiv, diffed field by field at the same projection — up to all 24 fields=all fields.",
  },
  {
    id: "record",
    label: "The whole record",
    blurb: "Every fields=all field of one contract — sources, bytecodes, metadata, stdJsonInput/Output — served from Arkiv entities, with per-field status and the read fan-out on display.",
  },
  {
    id: "model",
    label: "The data model",
    blurb: "How Sourcify's ten tables become six entity kinds, one real contract drawn as the entities that hold it, and how a composed field is rebuilt from them.",
  },
  {
    id: "query",
    label: "Questions Sourcify has no URL for",
    blurb: "Not that Postgres could not answer these — that the public API exposes no way to ask them. Against Arkiv each one is a single predicate.",
  },
  {
    id: "fourbyte",
    label: "The 4-byte service",
    blurb: "Selector to signature: the cheapest thing Sourcify runs, and the best fit for this database.",
  },
  {
    id: "explorer",
    label: "Browse the entities",
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
      {stats?.v2 ? (() => {
        const v2 = stats.v2 as { txsSent: number; txsPlanned: number; updatedAt: string; completeContracts: string[]; lanes: Record<string, { done: number; total: number }>; anonymousRateLimit: boolean };
        const pct = Math.min(100, Math.round((v2.txsSent / v2.txsPlanned) * 100));
        return (
          <div className="v2bar">
            <div className="v2head">
              <span>{pct >= 100
                ? <><strong>The 100% pass has landed.</strong> Every field of every contract on Unichain is served from Arkiv entities — v1 (20 Aug) wrote the lookup answer, v2 wrote the rest.</>
                : <><strong>The 100% pass is landing.</strong> v1 (20 Aug) wrote the lookup answer; v2 writes every other field — sources, bytecodes, metadata, docs.</>}</span>
              <span className="pill">{v2.txsSent.toLocaleString()} / {v2.txsPlanned.toLocaleString()} txs · {pct}% · as of {new Date(v2.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
            </div>
            <div className="v2track"><span style={{ width: `${pct}%` }} /></div>
            <div className="v2lanes">
              {Object.entries(v2.lanes).map(([k, l]) => (
                <span key={k} className="v2lane"><span className="k">{k}</span> {l.done.toLocaleString()}/{l.total.toLocaleString()}</span>
              ))}
              <span className="v2lane"><span className="k">complete contracts</span> {v2.completeContracts.length}</span>
            </div>
            {v2.anonymousRateLimit && pct < 100 && <div className="hint">Paced by the devnet&apos;s anonymous meter (50 requests/hour per IP, sends included) — ~45 transactions an hour. With an API key the remainder lands in ~100 minutes.</div>}
          </div>
        );
      })() : null}
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
        {TABS.map((t, i) => (
          <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            <span className="tab-n">{String(i + 1).padStart(2, "0")}</span>
            <span className="tab-t">{t.label}</span>
          </button>
        ))}
      </div>

      {(() => { const i = TABS.findIndex((t) => t.id === tab); const t = TABS[i]; return (
        <div className="tabintro">
          <div className="eyebrow"><span>Tab {String(i + 1).padStart(2, "0")} of {String(TABS.length).padStart(2, "0")}</span><span className="wire">·</span><span>{t.label}</span></div>
          <p className="blurb">{t.blurb}</p>
        </div>
      ); })()}

      {tab === "parity" && <Parity onInspect={inspect} preset={parityPreset} onPresetConsumed={() => setParityPreset(null)} />}
      {tab === "record" && <FullRecord onCompareAll={compareAll} onInspect={inspect} />}
      {tab === "model" && <DataModel onInspect={inspect} />}
      {tab === "query" && <Query />}
      {tab === "fourbyte" && <FourByte />}
      {tab === "explorer" && <Explorer focusKey={focusKey} onClearFocus={() => setFocusKey(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ parity */

function _SampleButtons({ onPick }: { onPick: (a: string) => void }) {
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

/**
 * Named quick-picks, the same on every tab. The first two are the contracts anyone
 * in the room knows; all seven were written end-to-end by the priority pass
 * (9-priority-send.mjs), so their whole record is on-chain while the bulk send
 * crawls the rate limit. Any other address on the chain works too.
 */
const FEATURED: { addr: string; name: string; why: string }[] = [
  { addr: "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789", name: "EntryPoint", why: "ERC-4337 · 14 files" },
  { addr: "0xef740bf23acae26f6492b10de645d6b98dc8eaf3", name: "UniversalRouter", why: "Uniswap · 93 files" },
  { addr: "0xcefdebb8feb23ab45b7902d81a98e47156464801", name: "DiamondLoupeFacet", why: "proxy facet" },
  { addr: "0xb401ccda43c36935e6059c02103e9541fba3337e", name: "FeeForwarder", why: "13 files" },
  { addr: "0x87071e6eb50420e21a1f6d29cf64c0983b5b0954", name: "MiniVault", why: "3 files" },
  { addr: "0x61d62ed33a3811e6e34083d9b88eadddce7cf6df", name: "ideo", why: "single file" },
  { addr: "0xe6743fec6cb4bb28c04e1fa74e2e19e309f2f740", name: "HelloWorld", why: "tiny" },
];

/** The top-level fields=all name a parity row belongs to (rows like "abi (digest)" fold to "abi"). */
const topField = (row: string) => row.replace(/\s.*$/, "").split(".")[0];
const sourcifyFieldUrl = (address: string, field: string) => `https://sourcify.dev/server/v2/contract/130/${address}?fields=${field}`;
const arkivFieldUrl = (address: string, field: string) => `/api/v2/contract/130/${address}?fields=${field}`;

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
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {FEATURED.map((d) => (
            <button key={d.addr} className="ghost" title={d.addr} onClick={() => { setAddress(d.addr); run(d.addr, depth); }}>
              {d.name} · {d.why}
            </button>
          ))}
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
              <div className="note" style={{ marginTop: 10 }}>
                <strong>Why the heavy fields differ for this contract:</strong> its full record has not landed on-chain
                yet. The first write (20 Aug, &ldquo;v1&rdquo;) stored only the lookup answer; the 100% pass
                (&ldquo;v2&rdquo;: sources, bytecodes, metadata, docs) is being written now, paced by the devnet&rsquo;s
                anonymous 50-requests/hour meter. The named quick-picks above were written end-to-end first and
                compare <em>identical</em>. Detail: {res.reads.unavailable.join(" · ")}
              </div>
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
                        <div className="cmpv">
                          {f.sourcify != null
                            ? <a className="vlink" href={sourcifyFieldUrl(res.address, topField(f.field))} target="_blank" rel="noopener" title="open this field on sourcify.dev"><Mono wrap>{f.sourcify}</Mono></a>
                            : <Mono wrap>—</Mono>}
                          {f.sourcifyBytes ? <span className="pill">{f.sourcifyBytes.toLocaleString()} B</span> : null}
                        </div>
                        <div className="cmpv">
                          {f.arkiv != null
                            ? <a className="vlink" href={arkivFieldUrl(res.address, topField(f.field))} target="_blank" rel="noopener" title="open this field as served from Arkiv"><Mono wrap>{f.arkiv}</Mono></a>
                            : <Mono wrap>—</Mono>}
                          {f.arkivBytes ? <span className="pill">{f.arkivBytes.toLocaleString()} B</span> : null}
                        </div>
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

const bytesOf = (v: unknown) => (v == null ? 0 : new TextEncoder().encode(JSON.stringify(v)).length);
const kb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
/** The one-colour-per-kind modifier the stylesheet keys on. */
const KMOD: Record<string, string> = { verified_contract: "vc", compilation: "cp", sourcefile: "sf", code: "code", blob: "blob", signature: "sig", group: "" };

/** Which fields only exist once the v2 write landed their compilation/code/sources. */
const V2_FIELDS = new Set([
  "metadata", "storageLayout", "transientStorageLayout", "userdoc", "devdoc", "sourceIds",
  "sources", "creationBytecode", "runtimeBytecode", "stdJsonInput", "stdJsonOutput",
]);

/** Sourcify's own response order — the flat list their API returns. */
const SOURCIFY_ORDER = [
  "matchId", "creationMatch", "runtimeMatch", "verifiedAt", "creationBytecode", "runtimeBytecode",
  "deployment", "sources", "compilation", "abi", "metadata", "storageLayout", "transientStorageLayout",
  "userdoc", "devdoc", "sourceIds", "additionalInput", "stdJsonInput", "stdJsonOutput", "signatures",
  "proxyResolution", "match", "chainId", "address",
];

/**
 * Our reading groups. Sourcify does not group anything — its response is the flat
 * list above. The grouping is ours, for the eye, and the toggle shows it is.
 */
const GROUPS: { title: string; fields: string[] }[] = [
  { title: "Identity — what the default lookup returns", fields: ["match", "creationMatch", "runtimeMatch", "chainId", "address", "verifiedAt", "matchId"] },
  { title: "Interface", fields: ["abi", "signatures"] },
  { title: "Compilation, metadata & docs", fields: ["compilation", "metadata", "userdoc", "devdoc", "storageLayout", "transientStorageLayout", "sourceIds"] },
  { title: "Bytecode — onchain and recompiled", fields: ["creationBytecode", "runtimeBytecode"] },
  { title: "Deployment & proxy", fields: ["deployment", "proxyResolution", "additionalInput"] },
  { title: "The compiler's own I/O — composed, the way Sourcify composes it", fields: ["stdJsonInput", "stdJsonOutput"] },
];
const COMPOSED = new Set(["signatures", "stdJsonInput", "stdJsonOutput"]);

type ProvEntry = { kind: string; key?: string; hash?: string; bytes: number; parts?: number; note?: string };

/** Chips grouped per kind: one chip per entity when few, a counted chip when many. */
function ProvChips({ items, onInspect, trailing }: { items?: ProvEntry[]; onInspect: (key: string) => void; trailing?: string }) {
  if (!items?.length) return null;
  const byKind = new Map<string, ProvEntry[]>();
  for (const p of items) (byKind.get(p.kind) ?? byKind.set(p.kind, []).get(p.kind)!).push(p);
  return (
    <div className="fprov">
      <span className="fprov-l">built from</span>
      {[...byKind.entries()].flatMap(([kind, list]) =>
        list.length <= 3
          ? list.map((p, i) => (
              <button key={`${kind}${i}`} className={`fprov-chip ${KMOD[kind] ?? ""}`} title={`${p.key ?? p.hash ?? ""}${p.note ? ` — ${p.note}` : ""}`}
                      onClick={() => p.key && onInspect(p.key)} disabled={!p.key}>
                <span>{kind}{p.note ? ` · ${p.note}` : ""}</span><span className="n">{kb(p.bytes)}{p.parts ? ` · ${p.parts} parts` : ""}</span>
              </button>
            ))
          : [(
              <button key={kind} className={`fprov-chip ${KMOD[kind] ?? ""}`} title={list.map((p) => p.note ?? p.hash ?? "").join("\n")}
                      onClick={() => list[0].key && onInspect(list[0].key!)} disabled={!list[0].key}>
                <span>{kind}</span><span className="n">× {list.length} · {kb(list.reduce((a, p) => a + p.bytes, 0))}</span>
              </button>
            )],
      )}
      {trailing && <span className="fprov-more">{trailing}</span>}
    </div>
  );
}

function FieldCard({ name, value, pendingV2, composed, prov, links, onInspect }: {
  name: string; value: unknown; pendingV2: boolean; composed?: boolean; prov?: ProvEntry[];
  links?: { sourcify: string; arkiv: string }; onInspect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const size = bytesOf(value);
  const isNull = value == null;
  const status = value != null
    ? (composed ? "composed at read time" : "served from Arkiv")
    : pendingV2 ? "pending — v2 write still landing" : "null (same as Sourcify)";
  const tone = value != null ? (composed ? "compose" : "ok") : pendingV2 ? "pend" : "nul";
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const LIMIT = 6000;
  return (
    <div className={`fcard ${tone}`}>
      <button className="fhead" onClick={() => !isNull && setOpen((v) => !v)} aria-expanded={open}>
        <span className="fname">{name}</span>
        <span className={`fstatus ${tone}`}>{status}</span>
        <span className="fsize">{value != null ? kb(size) : "—"}</span>
        <span className="fchev">{isNull ? "" : open ? "▾" : "▸"}</span>
      </button>
      {prov?.length ? <ProvChips items={prov} onInspect={onInspect} /> : null}
      {open && value != null && (
        <>
          <div className="flinks">
            {links && <a href={links.sourcify} target="_blank" rel="noopener">this field on sourcify.dev ↗</a>}
            {links && <a href={links.arkiv} target="_blank" rel="noopener">this field served from Arkiv ↗</a>}
            {text.length > LIMIT && (
              <button className="keylink" onClick={() => setFull((v) => !v)}>
                {full ? "show less" : `show all ${kb(size)}`}
              </button>
            )}
          </div>
          <pre className="fbody">{full || text.length <= LIMIT ? text : text.slice(0, LIMIT) + `\n… ${kb(size - LIMIT)} more — "show all" above, or open the link`}</pre>
        </>
      )}
    </div>
  );
}

/** Arkiv's limits, from the SDK constants and the measured transaction cap. */
const LIMITS: { k: string; v: number; unit: string; note: string; uses: (ctx: { biggest: number; attrs: number }) => number | null }[] = [
  { k: "largest entity payload this record needed", v: 122_880, unit: "B", note: "131,072 B per transaction minus ~8 KB of envelope + attributes", uses: (c) => c.biggest },
  { k: "one transaction", v: 131_072, unit: "B", note: "the node rejects anything larger — payload, attributes and envelope share it", uses: (c) => c.biggest + 1_800 },
  { k: "one blob chunk", v: 100_000, unit: "B", note: "a spilled component is cut into raw-byte parts of this size", uses: () => null },
  { k: "attributes on the contract entity", v: 32, unit: "", note: "27 spent; every new filter costs one", uses: (c) => c.attrs },
  { k: "one string attribute", v: 128, unit: "B", note: "hashes are 66 B; long names truncate visibly", uses: () => 66 },
  { k: "rows per query page", v: 200, unit: "", note: "no COUNT, no ORDER BY — pages are walked", uses: () => null },
];

function CapacityPanel({ record, prov }: { record: Record<string, unknown> | null; prov: Record<string, ProvEntry[]> }) {
  const pieces = Object.values(prov).flat();
  const biggest = pieces.reduce((m, p) => (p.bytes > (m?.bytes ?? 0) ? p : m), null as ProvEntry | null);
  const spilled = pieces.filter((p) => p.kind === "blob");
  const wholeBytes = record ? bytesOf(record) : 0;
  const ctx = { biggest: biggest?.bytes ?? 0, attrs: 27 };
  return (
    <div className="panel">
      <div className="eyebrow">capacity — what this record uses of the protocol&apos;s limits</div>
      <p className="caption">B = bytes. This record as one JSON blob is <strong>{kb(wholeBytes)}</strong>; it fits because it is stored as {pieces.length} pieces
        across {new Set(pieces.map((p) => p.key ?? p.hash)).size} entities, each under the cap of one transaction.</p>
      <div className="caps">
        {LIMITS.map((l) => {
          const used = l.uses(ctx);
          const pct = used == null ? null : Math.min(100, Math.round((used / l.v) * 100));
          const state = pct == null ? "" : used! > l.v ? "over" : pct >= 70 ? "warn" : "";
          return (
            <div className={`cap ${state}`} key={l.k}>
              <span className="cap-k">{l.k}</span>
              <span className="cap-v">{used != null ? `${used.toLocaleString()} ${l.unit} ` : ""}<span className="lim">/ {l.v.toLocaleString()} {l.unit}</span></span>
              <span className="cap-bar"><i style={{ "--pct": `${pct ?? 0}%` } as React.CSSProperties} /></span>
              <span className="cap-note">{l.note}</span>
            </div>
          );
        })}
      </div>
      <p className="caption" style={{ marginTop: 10 }}>
        {biggest ? <>Largest piece: <strong>{biggest.kind}</strong> at {kb(biggest.bytes)}{biggest.note ? ` (${biggest.note})` : ""}. </> : null}
        {spilled.length
          ? <>{spilled.length} component{spilled.length > 1 ? "s" : ""} exceeded one transaction and was split into blob chunks — reassembled in order and verified against its sha256 before being served.</>
          : <>Nothing here exceeded one transaction, so the chunk lane was not needed. Across the whole chain it carries 40 of 6,119 source files and 51 of 3,129 metadatas.</>}
      </p>
    </div>
  );
}

function FullRecord({ onCompareAll, onInspect }: { onCompareAll: (address: string) => void; onInspect: (key: string) => void }) {
  const [address, setAddress] = useState(FEATURED[0].addr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flat, setFlat] = useState(false);

  const run = useCallback(async (a: string) => {
    setBusy(true); setErr(null); setRes(null);
    try {
      const r = await fetch(`/api/record?chainId=130&address=${a}`);
      const b = await r.json();
      if (!r.ok) throw new Error(b.detail ? `${b.error}: ${b.detail}` : b.error ?? r.statusText);
      setRes(b);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { run(address); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const unavailable: string[] = res?.reads?.unavailable ?? [];
  const pendingV2 = unavailable.some((u) => u.includes("v2 write not yet landed") || u.includes("unreachable"));
  const record = (res?.record ?? null) as Record<string, unknown> | null;
  const presentCount = record ? Object.values(record).filter((v) => v != null).length : 0;
  const totalBytes = record ? bytesOf(record) : 0;
  const sources = (record?.sources ?? null) as Record<string, { content: string }> | null;
  const entityCount = res ? new Set(Object.values(res.provenance as Record<string, ProvEntry[]>).flat().map((p) => p.key ?? p.hash)).size : 0;

  const card = (f: string) => (
    <FieldCard key={f} name={f} value={record?.[f]} pendingV2={pendingV2 && V2_FIELDS.has(f)}
               composed={COMPOSED.has(f)} prov={res?.provenance?.[f]} links={res?.links?.[f]} onInspect={onInspect} />
  );

  return (
    <>
      <div className="panel">
        <h2>GET /v2/contract/130/&#123;address&#125;?fields=all</h2>
        <Duo
          left={{ cap: <>One SQL join across eight tables, assembled by their server.</> }}
          right={{ cap: <>Point reads over content-addressed entities, assembled by this adapter — every field says which entities built it.</> }}
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
          {FEATURED.map((d) => (
            <button key={d.addr} className={d.addr === address ? "" : "ghost"} title={d.addr}
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
              <Kpi k="Entities it lives in" v={String(entityCount)} />
              <Kpi k="Arkiv reads" v={`${res.reads.arkiv}${res.reads.cacheHits ? ` (+${res.reads.cacheHits} cached)` : ""} · ${res.reads.ms} ms`} />
            </div>
            {pendingV2 && (
              <p className="note" style={{ marginTop: 12 }}>
                <strong>This contract&apos;s heavy fields are still landing.</strong> The first write (20 Aug, &ldquo;v1&rdquo;) stored the
                lookup answer; the 100% pass (&ldquo;v2&rdquo;: sources, bytecodes, metadata, docs) is being written now at the
                devnet&apos;s anonymous pace of ~45 transactions an hour. The named quick-picks were written end-to-end first.
                Fields marked <em>pending</em> flip to served automatically as their entities arrive.
              </p>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={() => onCompareAll(address)}>Compare all 24 fields vs sourcify.dev →</button>
              <a className="ghost btnlink" href={res.sourcifyAll} target="_blank" rel="noopener">same record on sourcify.dev ↗</a>
              <a className="ghost btnlink" href={res.sourcifyRepo} target="_blank" rel="noopener">repo.sourcify.dev ↗</a>
              <a className="ghost btnlink" href={`/api/v2/contract/130/${address}?fields=all`} target="_blank" rel="noopener">raw JSON from Arkiv ↗</a>
              <button className="keylink" onClick={() => onInspect(res.entity.key)}>the verified_contract entity →</button>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="toggle">
                <input type="checkbox" checked={flat} onChange={(e) => setFlat(e.target.checked)} />
                show in Sourcify&apos;s own order (flat, no groups)
              </label>
              <span className="caption">Groups are ours, for reading. Sourcify&apos;s response is a flat list of 24 keys.</span>
            </div>
          </div>

          {flat ? (
            <div className="panel">
              <div className="eyebrow">All 24 fields, in the order sourcify.dev returns them</div>
              <div className="flist">{SOURCIFY_ORDER.map((f) => card(f))}</div>
            </div>
          ) : GROUPS.map((g) => (
            <div className="panel" key={g.title}>
              <div className="eyebrow">{g.title}</div>
              <div className="flist">{g.fields.map((f) => card(f))}</div>
            </div>
          ))}

          <div className="panel">
            <div className="eyebrow">
              Source files {sources ? <span className="pill">{Object.keys(sources).length} files · one sourcefile entity each</span> : null}
            </div>
            {sources && Object.keys(sources).length ? (
              <div className="flist">
                {Object.entries(sources).map(([p, s]) => {
                  const prov = (res.provenance?.sources as ProvEntry[] | undefined)?.filter((x) => x.note === p);
                  return <FieldCard key={p} name={p} value={s?.content ?? null} pendingV2={false} prov={prov} onInspect={onInspect} />;
                })}
              </div>
            ) : (
              <p className="caption">{pendingV2 ? "Source bodies live as content-addressed sourcefile entities — this contract's are still landing." : "No sources returned."}</p>
            )}
          </div>

          <CapacityPanel record={record} prov={res.provenance ?? {}} />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------- data model */

const TABLES: { id: string; label: string; n: string }[] = [
  { id: "contract_deployments", label: "contract_deployments", n: "chain, address, tx, deployer" },
  { id: "verified_contracts", label: "verified_contracts", n: "the link + transformations" },
  { id: "sourcify_matches", label: "sourcify_matches", n: "matchId, metadata, verifiedAt" },
  { id: "contracts", label: "contracts", n: "creation + runtime code hashes" },
  { id: "compiled_contracts", label: "compiled_contracts", n: "compiler, settings, artifacts" },
  { id: "compiled_contracts_sources", label: "compiled_contracts_sources", n: "compilation → file paths" },
  { id: "sources", label: "sources", n: "file bodies, deduped by hash" },
  { id: "code", label: "code", n: "bytecode, deduped by hash" },
  { id: "signatures", label: "signatures", n: "4-byte selector dictionary" },
  { id: "compiled_contracts_signatures", label: "compiled_contracts_signatures", n: "selector → compilation join" },
];
const KIND_NODES: { id: string; label: string; n: string }[] = [
  { id: "verified_contract", label: "verified_contract", n: "3,131 · 27 typed attrs · the lookup answer" },
  { id: "compilation", label: "compilation", n: "1,505 · deduped by content fingerprint" },
  { id: "sourcefile", label: "sourcefile", n: "6,119 unique files · sha256" },
  { id: "code", label: "code", n: "4,927 unique bytecodes · keccak" },
  { id: "signature", label: "signature", n: "12,674 · one per selector" },
  { id: "blob", label: "blob", n: "375 chunks · the oversized tail" },
];
const LINKS: [string, string][] = [
  ["contract_deployments", "verified_contract"], ["verified_contracts", "verified_contract"],
  ["sourcify_matches", "verified_contract"], ["sourcify_matches", "compilation"], ["contracts", "verified_contract"],
  ["compiled_contracts", "compilation"], ["compiled_contracts", "code"], ["compiled_contracts_sources", "compilation"],
  ["sources", "sourcefile"], ["sources", "blob"], ["code", "code"], ["signatures", "signature"],
  ["compiled_contracts_signatures", "verified_contract"],
];
const MAP_DETAIL: Record<string, { t: string; n: string; h: string[]; r: string[][] }> = {
  "t:contract_deployments": { t: "contract_deployments → verified_contract", n: "The deployment identity becomes typed, indexed attributes — which is what makes them filterable.", h: ["column", "lands as", "why"], r: [["chain_id", "attr chainid (u64)", "numeric → range queries"], ["address", "attr address (addr)", "the primary lookup"], ["deployer", "attr deployer (addr)", "“everything this deployer shipped”"], ["block_number", "attr blocknumber (u64)", "ranges"], ["transaction_hash, transaction_index", "payload.deployment", "returned, never filtered on"]] },
  "t:verified_contracts": { t: "verified_contracts → verified_contract", n: "The central link IS the entity — one per (chain, address).", h: ["column", "lands as", "why"], r: [["creation_match, runtime_match", "attrs (str)", "exact vs partial filtering"], ["transformations + values", "payload", "returned by the bytecode fields"], ["deployment_id, compilation_id", "entity key + compilationref (key attr)", "the foreign keys: one is identity, one a native pointer"]] },
  "t:sourcify_matches": { t: "sourcify_matches → two places", n: "Identity numbers stay on the contract; the metadata JSON moves to the compilation, where it deduplicates.", h: ["column", "lands as", "why"], r: [["id (matchId)", "attr matchid (u64)", "the cursor Sourcify pages by"], ["created (verifiedAt)", "attr verifiedat (u64)", "date ranges"], ["metadata json", "compilation payload", "stored once per compilation"]] },
  "t:contracts": { t: "contracts → folded into verified_contract", n: "A pure join table needs no entity of its own.", h: ["column", "lands as", "why"], r: [["creation_code_hash", "attr creationcodehash", "join into the code lane"], ["runtime_code_hash", "attr runtimecodehash", "“every deployment of this exact bytecode”"]] },
  "t:compiled_contracts": { t: "compiled_contracts → compilation (+ code)", n: "Deduplicated by a CONTENT fingerprint over inputs AND outputs — v1's weaker key conflated 99 distinct compilations on this chain.", h: ["column", "lands as", "why"], r: [["compiler, version, language, name", "attrs (echoed on the contract)", "startsWith('0.8.') across a minor line"], ["fully_qualified_name, compiler_settings", "payload", "returned whole"], ["compilation_artifacts (abi, docs, storageLayout, sourceIds)", "abi on the contract · rest on compilation payload", "abi rides the hot path"], ["creation/runtime code artifacts", "payload", "sourceMap, linkReferences, cborAuxdata, immutableReferences"], ["code hashes", "payload refs → code entities", "recompiled bytecode, content-addressed"]] },
  "t:compiled_contracts_sources": { t: "compiled_contracts_sources → the path→hash map", n: "Attributes cap at 32 and a compilation can reference 93 files, so the join is a small map on the compilation payload — exactly how Sourcify's table references into its deduplicated sources.", h: ["column", "lands as", "why"], r: [["compilation_id, path, source_hash", "payload.sources = { path: sha256 }", "a few hundred bytes even for many files"]] },
  "t:sources": { t: "sources → sourcefile (+ blob for the tail)", n: "One entity per UNIQUE file body — OpenZeppelin's ERC20.sol exists on-chain exactly once.", h: ["column", "lands as", "why"], r: [["source_hash", "attr hash (sha256)", "what readers query by"], ["content", "sourcefile payload", "45.4 MB across 6,119 unique files"], ["content over ~123 KB", "blob parts", "40 files of 6,119 — the chunk lane"]] },
  "t:code": { t: "code → code", n: "The most direct translation: content-addressed bytecode on both sides. A factory's clones collapse to one entity.", h: ["column", "lands as", "why"], r: [["code_hash_keccak", "attr hash (keccak)", "chain-native address"], ["code", "payload, raw bytes", "octet-stream — half the bytes of hex"]] },
  "t:signatures": { t: "signatures → signature", n: "One entity per selector — the best-shaped workload here (86-byte median payload, one equality).", h: ["column", "lands as", "why"], r: [["signature_hash_4", "attr selector", "the lookup key"], ["signature, hash_32", "payload · candidate set", "collisions are real"]] },
  "t:compiled_contracts_signatures": { t: "compiled_contracts_signatures → derived", n: "Not stored: the signatures field is recomputed from the ABI at read time — Sourcify composes it too.", h: ["column", "lands as", "why"], r: [["the 175M-row join", "nothing", "derivable data is composed, not replicated"]] },
  "k:verified_contract": { t: "verified_contract ← four tables", n: "One per (chain, address). 27 of 32 attributes spent. The payload answers the default lookup in one read.", h: ["absorbs", "as", "note"], r: [["contract_deployments", "attrs + payload.deployment", "indexed identity"], ["verified_contracts", "the entity + payload", "matches as attrs"], ["sourcify_matches", "attrs matchid, verifiedat", "metadata → compilation"], ["contracts", "attrs creationcodehash, runtimecodehash", "join into code"]] },
  "k:compilation": { t: "compilation ← three tables", n: "Deduplicated by inputs + outputs. Carries settings, metadata, docs, layouts, artifacts, sourceIds, the path→hash source map, refs to recompiled code.", h: ["absorbs", "as", "note"], r: [["compiled_contracts", "attrs + payload", "the dedup Sourcify already does"], ["compiled_contracts_sources", "payload.sources map", "path → sha256"], ["sourcify_matches.metadata", "payload.metadata", "JSON.stringify(metadata) IS the compiler's string — 120/120"]] },
  "k:sourcefile": { t: "sourcefile ← sources", n: "Unique file bodies, content-addressed, immutable — so a cache never invalidates.", h: ["absorbs", "as", "note"], r: [["sources", "one entity per unique hash", "queried by attr hash"]] },
  "k:code": { t: "code ← code", n: "Onchain + recompiled, creation + runtime — one dedup pool.", h: ["absorbs", "as", "note"], r: [["code", "one entity per keccak", "runtime onchain == runtime recompiled when nothing was transformed — then they are the same entity"]] },
  "k:signature": { t: "signature ← signatures", n: "12,674 selectors from this chain's verified ABIs — written in the v1 pass.", h: ["absorbs", "as", "note"], r: [["signatures (our slice)", "one entity per selector", "median payload 86 B"]] },
  "k:blob": { t: "blob — no Postgres equivalent", n: "The chunk lane the 131,072-byte transaction cap forces: a component too big for one transaction is split into ~100 KB raw-byte parts, found by kind+hash, reassembled in order and verified against its sha256 before anything is served.", h: ["carries", "as", "note"], r: [["190 oversized components", "375 chunk entities · 28.6 MB", "the tail, not the norm"]] },
};
/** The kind a map selection colours everything with: the kind itself, or a table's first target. */
const selKind = (sel: string | null) => !sel ? "" : sel.startsWith("k:") ? KMOD[sel.slice(2)] ?? "" : KMOD[LINKS.find(([t]) => `t:${t}` === sel)?.[1] ?? ""] ?? "";

function SchemaMap() {
  const [sel, setSel] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; lit: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const draw = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const out: { d: string; lit: boolean }[] = [];
    for (const [t, k] of LINKS) {
      const a = root.querySelector<HTMLElement>(`[data-id="t:${t}"]`)?.getBoundingClientRect();
      const b = root.querySelector<HTMLElement>(`[data-id="k:${k}"]`)?.getBoundingClientRect();
      if (!a || !b) continue;
      const x1 = a.right - rr.left, y1 = a.top - rr.top + a.height / 2;
      const x2 = b.left - rr.left, y2 = b.top - rr.top + b.height / 2;
      if (x2 - x1 < 40) continue;
      const mx = (x1 + x2) / 2;
      out.push({ d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, lit: !!sel && (`t:${t}` === sel || `k:${k}` === sel) });
    }
    setPaths(out);
    setSize({ w: root.clientWidth, h: root.clientHeight });
  }, [sel]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (ref.current) ro.observe(ref.current);
    const t = setTimeout(draw, 400);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [draw]);

  const connected = (id: string) => !!sel && LINKS.some(([t, k]) => (`t:${t}` === sel && `k:${k}` === id) || (`k:${k}` === sel && `t:${t}` === id));
  const kmod = selKind(sel);
  const cls = (id: string, base: string) => {
    const lit = connected(id);
    return `${base} ${sel === id ? `sel ${kmod}` : ""} ${lit ? `lit ${kmod}` : ""} ${sel && sel !== id && !lit ? "dim" : ""}`;
  };
  const d = sel ? MAP_DETAIL[sel] : null;

  return (
    <>
      <div className="klegend">
        <span className="vc">verified_contract</span><span className="cp">compilation</span><span className="sf">sourcefile</span>
        <span className="code">code</span><span className="sig">signature</span><span className="blob">blob</span>
      </div>
      <div className="smap" ref={ref}>
        <div className="smap-col">
          <div className="eyebrow">Postgres — 10 tables</div>
          {TABLES.map((t) => (
            <button key={t.id} data-id={`t:${t.id}`} className={cls(`t:${t.id}`, "smap-node")} onClick={() => setSel(sel === `t:${t.id}` ? null : `t:${t.id}`)}>
              <span>{t.label}</span><span className="n">{t.n}</span>
            </button>
          ))}
        </div>
        <div className="smap-col">
          <div className="eyebrow blue">Arkiv — 6 entity kinds</div>
          {KIND_NODES.map((k) => (
            <button key={k.id} data-id={`k:${k.id}`} className={cls(`k:${k.id}`, `smap-node k ${KMOD[k.id]}`)} onClick={() => setSel(sel === `k:${k.id}` ? null : `k:${k.id}`)}>
              <span>{k.label}</span><span className="n">{k.n}</span>
            </button>
          ))}
        </div>
        <svg className={`smap-svg ${kmod}`} viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden="true">
          {paths.map((p, i) => <path key={i} className={sel ? (p.lit ? "lit" : "dim") : ""} d={p.d} />)}
        </svg>
      </div>
      {d ? (
        <div className={`smap-detail ${kmod}`}>
          <div className="eyebrow blue">{d.t}</div>
          <p>{d.n}</p>
          <div className="scroll">
            <table>
              <thead><tr>{d.h.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{d.r.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className={j < 2 ? "mono" : ""}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      ) : <p className="caption" style={{ marginTop: 8 }}>Click any table or entity kind to see where its data physically lives on the other side.</p>}
    </>
  );
}

type GNode = { id: string; kind: string; key?: string; hash?: string; label: string; bytes?: number; attrs?: number; components?: { name: string; bytes: number; spilled?: { hash: string; parts: number; bytes: number } }[]; children: GNode[] };

/** The join that produced each child, written on the edge. */
const edgeLabel = (parent: GNode, child: GNode) => {
  if (child.kind === "compilation") return "compilationref (key attr)";
  if (child.id === "sources") return "payload.sources → path: sha256";
  if (child.id === "codes") return "codeRefs + recompiled hashes → keccak";
  if (child.kind === "sourcefile") return "hash = sha256(content)";
  if (child.kind === "code") return "hash = keccak(bytecode)";
  if (child.kind === "blob") return `$spill → parts[] · hash = sha256`;
  return parent.kind;
};

function GraphNodeView({ n, depth, onInspect }: { n: GNode; depth: number; onInspect: (key: string) => void }) {
  const [open, setOpen] = useState(depth < 1 || n.kind === "compilation");
  const [showComp, setShowComp] = useState(false);
  const isGroup = n.kind === "group";
  const kindOfGroup = isGroup ? (n.children[0]?.kind ?? "sourcefile") : n.kind;
  const kmod = KMOD[kindOfGroup] ?? "";
  const sizeSum = isGroup ? n.children.reduce((a, c) => a + (c.bytes ?? 0), 0) : (n.bytes ?? 0);
  return (
    <>
      <button className={`enode ${kmod} ${n.label.includes("not landed") ? "dim" : ""}`}
              onClick={() => (isGroup || n.children.length ? setOpen((v) => !v) : n.key ? onInspect(n.key) : undefined)}
              title={n.key ?? n.hash ?? ""} aria-expanded={n.children.length ? open : undefined}>
        <span className="ekind">{isGroup ? kindOfGroup : n.kind}</span>
        <span className="ekey">{isGroup ? n.label : `${n.label}${n.key ? ` · ${n.key.slice(0, 10)}…` : n.hash ? ` · ${n.hash.slice(0, 10)}…` : ""}`}</span>
        {isGroup && <span className="ecount">× {n.children.length}</span>}
        <span className="esize">{kb(sizeSum)}{n.attrs ? ` · ${n.attrs} attrs` : ""}{n.children.length ? (open ? " ▾" : " ▸") : ""}</span>
      </button>
      {!isGroup && n.key && (
        <div className="enode-actions">
          <button className="keylink small" onClick={() => onInspect(n.key!)}>open this entity in the browser →</button>
          {n.components?.length ? <button className="keylink small" onClick={() => setShowComp((v) => !v)}>{showComp ? "hide payload breakdown" : "payload breakdown"}</button> : null}
        </div>
      )}
      {showComp && n.components?.length ? (
        <div className="ecomps">
          {n.components.map((c) => (
            <div className={`ecomp ${c.spilled ? "spilled" : ""}`} key={c.name}>
              <span className="ecomp-k">{c.name}</span>
              <span className="ecomp-bar"><i style={{ width: `${Math.max(2, Math.min(100, (c.bytes / 122880) * 100))}%` }} /></span>
              <span className="ecomp-v">{kb(c.bytes)}{c.spilled ? ` → spilled to ${c.spilled.parts} chunks` : ""}</span>
            </div>
          ))}
          <div className="caption">bars are relative to the ~123 KB payload cap of one entity</div>
        </div>
      ) : null}
      {open && n.children.length ? (
        <ul className="echildren">
          {n.children.map((c) => (
            <li className="ebranch" key={c.id}>
              <span className="eedge">{edgeLabel(n, c)}</span>
              <GraphNodeView n={c} depth={depth + 1} onInspect={onInspect} />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

const COMPOSE_STEPS: Record<string, string[]> = {
  stdJsonOutput: ["verified_contract — follow compilationref; take abi", "compilation — sourceIds, metadata (re-serialized byte-exact), docs, layouts, code artifacts", "code × 2 — recompiled creation + runtime bytecode, hex without 0x", "assemble { sources: sourceIds, contracts: { path: { name: { abi, metadata, userdoc, devdoc, storageLayout, evm } } } }"],
  stdJsonInput: ["verified_contract — follow compilationref", "compilation — language + compilerSettings + the path → sha256 map", "sourcefile × N — batched by hash (≤20 per query), bodies reassembled from blob parts if spilled", "assemble { language, sources: { path: { content } }, settings }"],
  signatures: ["verified_contract — take payload.abi", "derive function/event/error signatures: keccak over the canonical text, tuples expanded", "assemble { function[], event[], error[] } in ABI order (Sourcify's order is its DB row order — compared as sets)"],
};

function ComposeFlow({ field, prov, result, reads, onInspect }: { field: string; prov?: ProvEntry[]; result: unknown; reads: number; onInspect: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const rb = bytesOf(result);
  return (
    <div className="compose">
      <div className="compose-from">
        <div className="eyebrow">read, in this order</div>
        <ol className="compose-steps">{COMPOSE_STEPS[field].map((s, i) => <li key={i}><span>{s}</span></li>)}</ol>
        {prov?.length ? <ProvChips items={prov} onInspect={onInspect} /> : <p className="caption">not landed yet for this contract</p>}
      </div>
      <div className="compose-arrow"><span>composed at read time</span><span>{reads} Arkiv reads for the whole record</span></div>
      <div className="compose-result">
        <div className="eyebrow blue">the field</div>
        <div className="compose-field">{field}</div>
        <div className="esize">{kb(rb)}{result != null ? " · identical to sourcify.dev on the parity tab" : " · pending"}</div>
        <p className="caption">Sourcify&apos;s server does the same assembly from its Postgres tables — neither side stores this as a blob.</p>
        {result != null && <button className="keylink small" onClick={() => setOpen((v) => !v)}>{open ? "hide result" : "show result"}</button>}
        {open && <pre className="fbody">{JSON.stringify(result, null, 2).slice(0, 5000)}{rb > 5000 ? "\n…" : ""}</pre>}
      </div>
    </div>
  );
}

function DataModel({ onInspect }: { onInspect: (key: string) => void }) {
  const [address, setAddress] = useState(FEATURED[0].addr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [graph, setGraph] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rec, setRec] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async (a: string) => {
    setBusy(true); setErr(null); setGraph(null); setRec(null);
    try {
      const [g, r] = await Promise.all([
        fetch(`/api/graph?chainId=130&address=${a}`).then(async (x) => { const b = await x.json(); if (!x.ok) throw new Error(b.detail ?? b.error); return b; }),
        fetch(`/api/record?chainId=130&address=${a}`).then(async (x) => { const b = await x.json(); if (!x.ok) throw new Error(b.detail ?? b.error); return b; }),
      ]);
      setGraph(g); setRec(r);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { run(address); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const sourcesGroup = graph?.graph?.children?.find((c: GNode) => c.kind === "compilation")?.children?.find((c: GNode) => c.id === "sources");
  const codesGroup = graph?.graph?.children?.find((c: GNode) => c.id === "codes");

  return (
    <>
      <div className="panel">
        <h2>Ten tables → six entity kinds</h2>
        <p className="caption">Sourcify&apos;s Postgres on the left, what we write on Cheesecake on the right. The normalization mirrors theirs:
          what they deduplicate, we deduplicate; what they compose at read time, we compose. The long-form version lives in the explainer.</p>
        <SchemaMap />
      </div>

      <div className="panel">
        <h2>One real contract, as the entities that hold it</h2>
        <p className="caption">Every node is a real entity on Cheesecake; the join that produced it is written on the edge. Click a node to expand it,
          &ldquo;open this entity&rdquo; to see it raw in the browser tab.</p>
        <div className="row">
          <div style={{ flex: "1 1 340px" }}>
            <label htmlFor="gaddr">Contract address</label>
            <input id="gaddr" value={address} onChange={(e) => setAddress(e.target.value.trim())} style={{ width: "100%" }} />
          </div>
          <button onClick={() => run(address)} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(address)}>{busy ? "walking the graph…" : "Draw it"}</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {FEATURED.map((d) => (
            <button key={d.addr} className={d.addr === address ? "" : "ghost"} title={d.addr} onClick={() => { setAddress(d.addr); run(d.addr); }}>{d.name}</button>
          ))}
        </div>
        {err && <p className="err">{err}</p>}
        {graph && (
          <>
            <div className="kpis" style={{ marginTop: 12 }}>
              <Kpi k="Arkiv reads to walk it" v={`${graph.reads.arkiv}${graph.reads.cacheHits ? ` (+${graph.reads.cacheHits} cached)` : ""}`} />
              <Kpi k="Read at block" v={graph.blockNumber ?? undefined} />
              <Kpi k="Unique source files" v={String(sourcesGroup?.children?.length ?? 0)} />
              <Kpi k="Unique bytecodes" v={String(codesGroup?.children?.length ?? 0)} />
            </div>
            <div className="klegend" style={{ marginTop: 12 }}>
              <span className="vc">verified_contract</span><span className="cp">compilation</span><span className="sf">sourcefile</span>
              <span className="code">code</span><span className="blob">blob</span>
            </div>
            <div className="egraph">
              <GraphNodeView n={graph.graph} depth={0} onInspect={onInspect} />
            </div>
            {graph.reads.unavailable?.length ? <p className="caption">Still landing: {graph.reads.unavailable.join(" · ")}</p> : null}
          </>
        )}
      </div>

      {rec && (
        <div className="panel">
          <h2>How a composed field is rebuilt</h2>
          <p className="caption">Three fields are never stored as blobs — by Sourcify either. They are assembled from the pieces above on every request.
            Left: what is read, in order. Right: the field, as the API returns it.</p>
          {["stdJsonOutput", "stdJsonInput", "signatures"].map((f) => (
            <div key={f} style={{ marginTop: 14 }}>
              <ComposeFlow field={f} prov={rec.provenance?.[f]} result={rec.record?.[f]} reads={rec.reads.arkiv} onInspect={onInspect} />
            </div>
          ))}
        </div>
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

/** Every pointer an entity carries, so the browser can follow it: key refs and content hashes. */
function referencesOf(attrs: Record<string, unknown>, payload: Record<string, unknown> | null) {
  const refs: { label: string; kind: string; key?: string; hash?: string }[] = [];
  if (typeof attrs.compilationref === "string") refs.push({ label: "compilationref → compilation", kind: "compilation", key: attrs.compilationref });
  const p = payload ?? {};
  const codeRefs = (p.codeRefs ?? {}) as Record<string, string | null>;
  for (const [k, h] of Object.entries(codeRefs)) if (h) refs.push({ label: `codeRefs.${k} → code`, kind: "code", hash: h });
  for (const k of ["recompiledCreationHash", "recompiledRuntimeHash"]) if (typeof p[k] === "string") refs.push({ label: `${k} → code`, kind: "code", hash: p[k] as string });
  const sources = (p.sources ?? null) as Record<string, string> | null;
  if (sources && typeof sources === "object") {
    const entries = Object.entries(sources).filter(([, v]) => typeof v === "string" && v.startsWith("0x"));
    for (const [path, h] of entries.slice(0, 12)) refs.push({ label: `sources["${path}"] → sourcefile`, kind: "sourcefile", hash: h });
    if (entries.length > 12) refs.push({ label: `… ${entries.length - 12} more source files`, kind: "sourcefile" });
  }
  for (const [k, v] of Object.entries(p)) {
    const sp = (v as { $spill?: { hash: string; parts: number } } | null)?.$spill;
    if (sp) refs.push({ label: `${k} → blob ×${sp.parts} (spilled)`, kind: "blob", hash: sp.hash });
    const inner = (v as { content?: { $spill?: { hash: string; parts: number } } } | null)?.content?.$spill;
    if (inner) refs.push({ label: `content → blob ×${inner.parts} (spilled)`, kind: "blob", hash: inner.hash });
  }
  return refs;
}

function EntityCard({ e, index, onKey, onHash }: {
  e: Record<string, unknown>; index: number;
  onKey: (key: string) => void; onHash: (kind: string, hash: string) => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const attrs = (e.attributes ?? {}) as Record<string, unknown>;
  const refs = referencesOf(attrs, (e.payload ?? null) as Record<string, unknown> | null);
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
                <span className="av">
                  {k === "compilationref" && typeof v === "string"
                    ? <button className="keylink" onClick={() => onKey(v)} title="follow the key"><Mono wrap>{v}</Mono> ↗</button>
                    : <Mono wrap>{String(v)}</Mono>}
                </span>
              </div>
            ))}
          </div>

          {refs.length ? (
            <>
              <div className="grouphead" style={{ marginTop: 14 }}>
                Points at <span className="pill">{refs.length} references — click to follow</span>
              </div>
              <div className="refs">
                {refs.map((r, i) => (
                  <button key={i} className={`refchip ${r.kind}`} disabled={!r.key && !r.hash}
                          title={r.key ?? r.hash ?? ""}
                          onClick={() => (r.key ? onKey(r.key) : r.hash ? onHash(r.kind, r.hash) : undefined)}>
                    {r.label}{r.hash ? <span className="refhash">{r.hash.slice(0, 12)}…</span> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}

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

  const follow = useCallback(async (k: string, hash: string) => {
    setBusy(true); setErr(null); setKind(k);
    try {
      const r = await fetch(`/api/query?kind=${k}&hash=${hash}&limit=5&withPayload=1`);
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
          right={{ big: "6 entity kinds", cap: <>Typed attributes you can filter on, plus payloads the database never looks inside — same normalization, content-addressed. Every reference an entity carries is a button here: follow a <code>compilationref</code> key, a source hash, a bytecode hash, a blob spill.</> }}
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
              <EntityCard key={String(e.entityKey)} e={e} index={i} onKey={lookup} onHash={follow} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
