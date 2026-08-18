"use client";

import { useMemo, useState } from "react";
import factsDoc from "@/kb/facts.json";

interface Fact {
  id: string;
  statement: string;
  scope?: string;
  asOf?: string;
  confidence: "measured" | "stated" | "unknown";
  source?: { label?: string; url?: string };
  tags?: string[];
}
const FACTS = (factsDoc as { facts: Fact[] }).facts;
const AS_OF = (factsDoc as { generatedAt: string }).generatedAt;

interface Source {
  id: string;
  statement: string;
  confidence: Fact["confidence"];
  asOf?: string;
  source?: { label?: string; url?: string } | null;
}

const EXAMPLES = [
  "How should we actually do this migration?",
  "What fits in Arkiv and what has to stay off-chain?",
  "How big is their database, really?",
  "What do we still not know?",
  "What should we ask Sourcify for?",
  "Could they run their own Arkiv node?",
];

/** Minimal markdown -> HTML. Input is ALREADY html-escaped and span-injected by ground(). */
function mdToHtml(s: string): string {
  const lines = s.split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const inline = (t: string) =>
    t
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      out.push(`<h3>${inline(h[2])}</h3>`);
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

export default function Home() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [html, setHtml] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [warn, setWarn] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [find, setFind] = useState("");

  const hits = useMemo(() => {
    const t = find.trim().toLowerCase();
    if (!t) return [];
    const words = t.split(/\s+/);
    return FACTS.map((f) => {
      const hay = `${f.id} ${f.statement} ${f.scope ?? ""} ${(f.tags ?? []).join(" ")}`.toLowerCase();
      const score = words.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0);
      return { f, score };
    })
      .filter((x) => x.score === words.length)
      .slice(0, 12)
      .map((x) => x.f);
  }, [find]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setErr("");
    setWarn([]);
    setHtml("");
    setSources([]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = await res.json();
      if (body.error) {
        setErr(body.error);
      } else {
        setHtml(mdToHtml(body.html as string));
        setSources((body.sources ?? []) as Source[]);
        const w: string[] = [];
        const un = body.warnings?.ungroundedNumbers ?? [];
        const bad = body.warnings?.unknownFactIds ?? [];
        if (un.length)
          w.push(
            `${un.length} number${un.length > 1 ? "s" : ""} in this answer could not be traced to a measured fact and are highlighted. Treat them as the model's own arithmetic.`,
          );
        if (bad.length) w.push(`Referenced fact ids that do not exist: ${bad.join(", ")}.`);
        setWarn(w);
      }
    } catch {
      setErr("Network error reaching the assistant.");
    }
    setBusy(false);
  }

  return (
    <div className="wrap">
      <header>
        <div className="eyebrow">[ ARKIV ] &times; SOURCIFY &middot; INTERNAL</div>
        <h1>What we measured about Sourcify, and what we need to decide</h1>
        <p className="lede">
          Every Sourcify number here was measured from public endpoints &mdash; no database access, no
          dataset download. Ask the assistant anything: it answers from these measurements, shows its
          sources, and tells you plainly when we do not know.
        </p>
        <div className="stamp">
          Measured {AS_OF} &middot; {FACTS.length} facts in the knowledge base &middot; figures move daily
        </div>
      </header>

      <section style={{ marginTop: 0 }}>
        <h2>Ask</h2>
        <p className="sublede">
          Facts, tradeoffs, architecture &mdash; ask it the way you would ask a colleague. Numbers come
          from the knowledge base and are highlighted; anything it works out itself is marked.
        </p>
        <div className="ask">
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(q);
            }}
            placeholder="e.g. How should we shard the backfill, and what breaks first?"
          />
          <div className="askrow">
            <button onClick={() => ask(q)} disabled={busy || !q.trim()}>
              {busy ? "Thinking" : "Ask"}
            </button>
            {html || err ? (
              <button
                className="ghost"
                onClick={() => {
                  setHtml("");
                  setSources([]);
                  setErr("");
                  setWarn([]);
                }}
              >
                Clear
              </button>
            ) : null}
            <span className="hint">Cmd/Ctrl + Enter</span>
          </div>
          <div className="examples">
            {EXAMPLES.map((x) => (
              <button
                key={x}
                onClick={() => {
                  setQ(x);
                  ask(x);
                }}
              >
                {x}
              </button>
            ))}
          </div>
        </div>

        {err ? <div className="errbar">{err}</div> : null}

        {html ? (
          <div className="answer">
            <div dangerouslySetInnerHTML={{ __html: html }} />
            {warn.map((w) => (
              <div className="warnbar" key={w}>
                {w}
              </div>
            ))}
            {sources.length ? (
              <div className="sources">
                <div className="cap">Sources &mdash; {sources.length} facts cited</div>
                {sources.map((s) => (
                  <div className="src" key={s.id}>
                    <span className={`pill p-${s.confidence}`}>{s.confidence}</span>
                    <span>
                      {s.statement}{" "}
                      {s.source?.url ? (
                        <a href={s.source.url} target="_blank" rel="noopener">
                          {s.source.label ?? s.source.url}
                        </a>
                      ) : s.source?.label ? (
                        <span style={{ color: "var(--faint)" }}>{s.source.label}</span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section>
        <h2>The numbers</h2>
        <p className="sublede">Measured {AS_OF} from Sourcify&rsquo;s own public endpoints.</p>
        <div className="kpis">
          <div className="kpi">
            <span className="lbl">Verified contracts</span>
            <span className="num">43,781,389</span>
            <span className="sub">29.1% exact / 70.9% partial. Grew ~4&times; in eight months.</span>
          </div>
          <div className="kpi">
            <span className="lbl">Live database</span>
            <span className="num">949.6 GB</span>
            <span className="sub">Growing ~25 GiB/month organically, not the 189 often quoted</span>
          </div>
          <div className="kpi">
            <span className="lbl">Organic writes</span>
            <span className="num">~34k/day</span>
            <span className="sub">One verification = ~10.4 rows and ~25.5 KiB</span>
          </div>
          <div className="kpi">
            <span className="lbl">Index-shaped data</span>
            <span className="num">4.1%</span>
            <span className="sub">52.7 GB of 1,269 GB raw. The rest is blobs.</span>
          </div>
        </div>
      </section>

      <section>
        <h2>The finding that shapes the whole design</h2>
        <ul className="facts">
          <li>
            Sourcify&rsquo;s data splits cleanly in two. <b>4.1% (52.7 GB)</b> is index-shaped: small
            rows of 58&ndash;620 bytes that you filter and look things up by.
          </li>
          <li>
            <b>95.9% (1,216 GB)</b> is blob-shaped &mdash; source code, bytecode, compilation artifacts
            and metadata JSON, concentrated in seven columns.
          </li>
          <li>
            So &ldquo;what goes in Arkiv&rdquo; is not a judgement call. Arkiv holds the queryable
            identity and relationships; the blobs stay content-addressed by hash, which is{" "}
            <b>how Sourcify already stores them</b>.
          </li>
          <li>
            And the dedup works for us: 43.78M contracts resolve to only <b>5.7M distinct
            compilations</b> and <b>6.3M source files</b>. Blob storage scales with the small number.
          </li>
        </ul>
        <div className="callout">
          <p>
            The proposal is <b>not</b> a row-for-row copy. It is one denormalised head entity per
            verified contract keyed by <code>chainId:address</code> &mdash; roughly 44M entities,
            ~30 GB &mdash; carrying the attributes people filter on plus hash references to the heavy
            artifacts. Ask the assistant &ldquo;what fits in Arkiv&rdquo; for the full reasoning.
          </p>
        </div>
      </section>

      <section>
        <h2>What we need from engineering</h2>
        <p className="sublede">
          The data-model work is not blocked &mdash; we can build the corpus, the mapping and the
          adapter from public data today. What is blocked is any promise about reads.
        </p>
        <ul className="facts">
          <li>
            <b>Read capacity.</b> We have no benchmark at all. The public endpoint&rsquo;s quota is a
            gateway policy, not a measurement of the engine. Sourcify&rsquo;s target is in the millions
            of requests per day.
          </li>
          <li>
            <b>Would Sourcify run their own node?</b> Public endpoint versus their own node or indexer
            changes the proposal fundamentally &mdash; and a self-hosted read replica speaks directly to
            their egress problem.
          </li>
          <li>
            <b>Per-entity payload ceiling.</b> We know a transaction caps at 128 KB. We do not have a
            per-entity number, and their heaviest metadata blocks average ~186 KB.
          </li>
          <li>
            <b>Does prefix matching fit 75-byte bytecode search</b> at tens of millions of entities, and
            is it index-backed?
          </li>
          <li>
            <b>Ownership and durability.</b> Contract-account ownership that can still update and
            delete; and disk retention, snapshot/restore, behaviour across resets.
          </li>
        </ul>
      </section>

      <section>
        <h2>Search the facts</h2>
        <p className="sublede">
          Instant, local, no network. Every fact carries its scope, date, source and confidence.
        </p>
        <input
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="rows, egress, chains, growth, 4byte, unknown&hellip;"
          aria-label="Search facts"
        />
        {find.trim() ? (
          <div className="hits">
            {hits.length ? (
              hits.map((f) => (
                <div className="hit" key={f.id}>
                  <div className="top">
                    <span className={`pill p-${f.confidence}`}>{f.confidence}</span>
                    <span className="id">{f.id}</span>
                  </div>
                  <div>{f.statement}</div>
                  {f.scope ? <div className="scope">Scope: {f.scope}</div> : null}
                  {f.source?.url ? (
                    <a href={f.source.url} target="_blank" rel="noopener">
                      {f.source.label ?? f.source.url}
                    </a>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="empty">
                Nothing matches. That may itself be the answer &mdash; try the assistant above, which
                will tell you who can resolve it.
              </div>
            )}
          </div>
        ) : null}
      </section>

      <footer>
        Sourcify figures measured 2026-08-18 from public endpoints and moving daily &mdash; restate the
        date when quoting.
        <br />
        Arkiv-side figures are provisional: that network is under construction and nothing here is a
        capability commitment.
      </footer>
    </div>
  );
}
