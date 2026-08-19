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

const TABS = [
  { id: "basics", label: "Sourcify 101" },
  { id: "load", label: "Load model" },
  { id: "fit", label: "What fits in Arkiv" },
  { id: "need", label: "What we need" },
  { id: "ask", label: "Ask" },
];

const EXAMPLES = [
  "How should we actually do this migration?",
  "What fits in Arkiv and what stays off-chain?",
  "What do we still not know?",
  "Is 4byte the right pilot?",
  "Could they run their own Arkiv node?",
];

/** Minimal markdown -> HTML. Input is ALREADY escaped and span-injected by ground(). */
function mdToHtml(s: string): string {
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

  for (const raw of s.split("\n")) {
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
  const [tab, setTab] = useState("basics");
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
      return { f, score: words.reduce((a, w) => a + (hay.includes(w) ? 1 : 0), 0) };
    })
      .filter((x) => x.score === words.length)
      .slice(0, 12)
      .map((x) => x.f);
  }, [find]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setTab("ask");
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
      if (body.error) setErr(body.error);
      else {
        setHtml(mdToHtml(body.html as string));
        setSources((body.sources ?? []) as Source[]);
        const w: string[] = [];
        const un = body.warnings?.ungroundedNumbers ?? [];
        const bad = body.warnings?.unknownFactIds ?? [];
        if (un.length)
          w.push(
            `${un.length} number${un.length > 1 ? "s" : ""} here could not be traced to a measured fact and are highlighted — treat them as the model's own arithmetic.`,
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
        <h1>Sourcify, and what we would actually be migrating</h1>
        <p className="lede">
          Every Sourcify figure here was measured from their public endpoints &mdash; no database access,
          no dataset download. Start on the left for the technical basics; ask the assistant anything at
          the end.
        </p>
        <div className="stamp">
          Measured {AS_OF} &middot; {FACTS.length}{" "}facts in the knowledge base &middot; figures move daily
        </div>
      </header>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              window.scrollTo(0, 0);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ==================== SOURCIFY 101 ==================== */}
      {tab === "basics" ? (
        <div>
          <h2>What Sourcify is, technically</h2>
          <p className="sublede">
            The five things worth knowing before we argue about where their data should live.
          </p>

          <h3>1. What verification actually is</h3>
          <p className="prose">
            A contract on chain is bytecode &mdash; unreadable. Verification proves that a given piece of
            source code compiles to <em>exactly</em> that bytecode. Sourcify is the only major verifier
            that also checks the metadata hash the compiler embeds, which is what makes an exact match a
            cryptographic proof rather than a strong hint.
          </p>
          <div className="flow">
            <div className="step">
              <span className="n">1</span>
              <b>Submit</b>
              <span>source files + the exact compiler version and settings</span>
            </div>
            <div className="arr">&rarr;</div>
            <div className="step">
              <span className="n">2</span>
              <b>Recompile</b>
              <span>Sourcify runs that compiler itself</span>
            </div>
            <div className="arr">&rarr;</div>
            <div className="step">
              <span className="n">3</span>
              <b>Transform</b>
              <span>account for legitimate differences</span>
            </div>
            <div className="arr">&rarr;</div>
            <div className="step">
              <span className="n">4</span>
              <b>Compare</b>
              <span>against the bytecode actually deployed</span>
            </div>
          </div>
          <p className="prose">
            Step 3 is the one that shapes the schema. A recompile never matches byte for byte, because
            some differences are expected: <b>constructor arguments</b> appended at deploy time,
            <b> library addresses</b> linked in, <b>immutable values</b> written at construction, the
            <b> metadata hash</b> itself, and library call protection. Sourcify records exactly which
            transformations it applied and with what values &mdash; that is what lives in
            <code>verified_contracts</code>.
          </p>
          <div className="two">
            <div className="box ok">
              <span className="cap">Exact match &mdash; 29.1%</span>
              <p>
                The embedded metadata hash matches too. The source is provably byte-for-byte what was
                deployed, down to comments and whitespace.
              </p>
            </div>
            <div className="box warn">
              <span className="cap">Partial match &mdash; 70.9%</span>
              <p>
                The compiled bytecode matches on chain but the metadata hash does not. Behaviour is
                identical; comments, variable names or file paths may differ.
              </p>
            </div>
          </div>

          <h3>2. The schema is a link, not a row</h3>
          <p className="prose">
            This is the single most important thing to understand before proposing a data model.
            <b> A verified contract is not a record &mdash; it is a join.</b> One side describes what is on
            chain, the other describes a compilation, and the middle records how to get from one to the
            other.
          </p>
          <div className="join">
            <div className="jbox">
              <span className="jt">contract_deployments</span>
              <span className="js">what is on chain</span>
              <span className="jf">chain_id &middot; address &middot; tx_hash &middot; block &middot; deployer</span>
            </div>
            <div className="jmid">
              <span className="jt">verified_contracts</span>
              <span className="js">the link + transformations</span>
              <span className="jf">deployment_id &middot; compilation_id &middot; creation/runtime values</span>
            </div>
            <div className="jbox">
              <span className="jt">compiled_contracts</span>
              <span className="js">one compilation</span>
              <span className="jf">compiler &middot; version &middot; settings &middot; ABI &middot; artifacts</span>
            </div>
          </div>
          <p className="prose">
            Underneath both sides, <code>code</code> and <code>sources</code> are pure
            content-addressed stores keyed by hash. <code>ERC20.sol</code> is stored once no matter how
            many contracts include it. <b>They already do content addressing</b> &mdash; that part of the
            model maps onto hash-addressed storage with no translation at all.
          </p>

          <h3>3. What they store per contract</h3>
          <p className="prose">
            Far more than source and ABI, which is why one verification costs ~25.5 KiB:
          </p>
          <div className="chips">
            {[
              "source files", "standard JSON input", "compiler + every setting", "ABI",
              "NatSpec userdoc", "NatSpec devdoc", "storage layout", "transient storage layout",
              "creation bytecode", "runtime bytecode", "as-deployed bytecode", "source maps",
              "link references", "immutable references", "CBOR auxdata positions",
              "transformations applied", "deployment details", "function signatures",
              "event signatures", "error signatures",
            ].map((c) => (
              <span className="chip" key={c}>
                {c}
              </span>
            ))}
          </div>

          <h3>4. The ten tables</h3>
          <p className="prose">
            Seven come from the <b>Verifier Alliance</b> schema, shared with Blockscout and Routescan;
            three are Sourcify&rsquo;s own. Those ten are what gets exported. Row counts are exact,
            read from the Parquet footers.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>What it holds</th>
                  <th className="r">Rows</th>
                  <th className="r">Live bytes</th>
                  <th>Shape</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="k">code</td><td>Deduplicated bytecode, keyed by hash</td><td className="m">40,163,166</td><td className="m">212.5 GB</td><td><span className="pill p-stop">blob</span></td></tr>
                <tr><td className="k">sourcify_matches</td><td>Match records + Solidity metadata</td><td className="m">74,196,213</td><td className="m">196.1 GB</td><td><span className="pill p-stop">blob</span></td></tr>
                <tr><td className="k">compiled_contracts</td><td>One row per compilation: settings, ABI, artifacts</td><td className="m">5,716,510</td><td className="m">98.2 GB</td><td><span className="pill p-stop">blob</span></td></tr>
                <tr><td className="k">compiled_contracts_signatures</td><td>Which signatures appear in which compilation</td><td className="m">175,489,918</td><td className="m">51.9 GB</td><td><span className="pill p-ok">index</span></td></tr>
                <tr><td className="k">verified_contracts</td><td>The link: deployment &harr; compilation + transformations</td><td className="m">44,391,604</td><td className="m">46.5 GB</td><td><span className="pill p-ok">index</span></td></tr>
                <tr><td className="k">sources</td><td>Deduplicated source files, keyed by hash</td><td className="m">6,329,026</td><td className="m">35.7 GB</td><td><span className="pill p-stop">blob</span></td></tr>
                <tr><td className="k">contract_deployments</td><td>Chain, address, tx hash, block, deployer</td><td className="m">44,303,315</td><td className="m">22.6 GB</td><td><span className="pill p-ok">index</span></td></tr>
                <tr><td className="k">compiled_contracts_sources</td><td>Which sources belong to which compilation</td><td className="m">36,586,086</td><td className="m">13.4 GB</td><td><span className="pill p-ok">index</span></td></tr>
                <tr><td className="k">contracts</td><td>Creation + runtime code hash pair</td><td className="m">24,662,400</td><td className="m">13.2 GB</td><td><span className="pill p-ok">index</span></td></tr>
                <tr><td className="k">signatures</td><td>Function, event, error signature text + hashes</td><td className="m">9,920,797</td><td className="m">2.8 GB</td><td><span className="pill p-ok">index</span></td></tr>
              </tbody>
            </table>
          </div>
          <p className="prose">
            Not exported, and easy to forget: <code>verification_jobs</code> and
            <code> verification_jobs_ephemeral</code> (in-flight state), a signature-stats materialized
            view, and migration bookkeeping. <code>session</code> and <code>sourcify_sync</code> were
            dropped in March and July 2026, so older schema diagrams are stale. And the 75-byte
            similarity lookup is an <b>expression index on <code>code</code></b>, not a table.
          </p>

          <h3>5. How data gets in, and how it gets out</h3>
          <div className="two">
            <div className="box">
              <span className="cap">In &mdash; three paths</span>
              <ul className="facts tight">
                <li><b>Direct requests</b> from developers and tools.</li>
                <li><b>The Monitor</b> watches selected chains, reads the metadata hash out of new bytecode and pulls sources from IPFS.</li>
                <li><b>Similarity imports</b> &mdash; bulk jobs that verify by matching the first 75 bytes of bytecode against something already verified. This is what produces the multi-million-contract single-day spikes.</li>
              </ul>
            </div>
            <div className="box">
              <span className="cap">Out &mdash; four channels</span>
              <ul className="facts tight">
                <li><b>Parquet bulk export</b>, daily, S3-compatible, append-only.</li>
                <li><b>BigQuery mirror</b> via Analytics Hub, fed by Datastream CDC.</li>
                <li><b>The API</b> at <code>sourcify.dev/server</code>, one contract at a time.</li>
                <li><b>The browser UI</b> at <code>repo.sourcify.dev</code>.</li>
              </ul>
            </div>
          </div>

          <div className="callout">
            <p>
              <b>Two things that constrain any proposal.</b> First, they share the Verifier Alliance
              schema with Blockscout and Routescan, so they <b>cannot unilaterally change the table
              structure</b> &mdash; that is why 139 GB of duplicated metadata sits unfixed in their own
              open issue. Second, their BigQuery pipeline is fed by GCP Datastream, whose supported-source
              list is closed, so moving the database off Cloud SQL breaks their analytics. That is the
              hidden lock-in, and it is not about price.
            </p>
          </div>

          <p className="prose">
            One more piece of context worth having in the room: Sourcify is a <b>non-profit</b>. It
            started inside the Ethereum Foundation and spun out into the Argot Collective in 2025
            alongside the Solidity project. It is Foundry&rsquo;s default verifier when no Etherscan key
            is set, Hardhat v3 verifies everywhere by default, and every verification Sourcify makes is
            forwarded on to Blockscout, Routescan and Etherscan. This is infrastructure a lot of the
            ecosystem leans on, which is exactly why the ownership question matters.
          </p>
        </div>
      ) : null}

      {/* ==================== LOAD MODEL ==================== */}
      {tab === "load" ? (
        <div>
          <h2>The load model, in engineering units</h2>
          <p className="sublede">
            What we would actually be absorbing, per second rather than per day. Everything here is
            measured or derived from measured figures &mdash; and the one number missing is the one that
            matters most.
          </p>

          <h3>Write side &mdash; what lands</h3>
          <div className="metrics">
            <div className="met"><span className="mv">0.40</span><span className="mu">verifications/s</span><span className="mn">organic steady state (34,639/day)</span></div>
            <div className="met"><span className="mv">4.2</span><span className="mu">rows/s</span><span className="mn">10.4 rows per verification, ~360k/day</span></div>
            <div className="met"><span className="mv">10.2</span><span className="mu">KiB/s</span><span className="mn">sustained new data, ~904 MB/day</span></div>
            <div className="met hot"><span className="mv">32</span><span className="mu">verifications/s peak</span><span className="mn">bulk import &mdash; <b>80&times;</b> the organic rate</span></div>
          </div>
          <p className="prose">
            The organic write load is <b>trivially small</b>. The number to design against is the burst:
            their similarity-import jobs hit 32/s and 334 rows/s, and that is what produced a
            2.77-million-contract single day. <b>Size for the burst, not the average.</b>
          </p>

          <h3>Read side &mdash; what has to be served</h3>
          <div className="metrics">
            <div className="met"><span className="mv">174</span><span className="mu">req/s average</span><span className="mn">all APIs, 15M/day</span></div>
            <div className="met"><span className="mv">81</span><span className="mu">req/s &mdash; 4byte</span><span className="mn">47% of all traffic, one small table</span></div>
            <div className="met"><span className="mv">93</span><span className="mu">req/s &mdash; everything else</span><span className="mn">contract lookups and the rest</span></div>
            <div className="met"><span className="mv">401</span><span className="mu">DB tx/s</span><span className="mn">2.31 database transactions per request</span></div>
          </div>
          <div className="callout warn">
            <p>
              <b>These are averages, and averages are the wrong number.</b> We do not have their peak
              requests/second, p95/p99 latency, or cache-hit ratio &mdash; none of it is in the public
              dataset. That is the most important thing to get from Sourcify, and it is question one on
              the list going to Kaan.
            </p>
          </div>

          <h3>Egress &mdash; the number their own review says decides it</h3>
          <div className="metrics">
            <div className="met"><span className="mv">13.6</span><span className="mu">TB/month</span><span className="mn">leaving the database</span></div>
            <div className="met"><span className="mv">453</span><span className="mu">GB/day</span><span className="mn">same figure, daily</span></div>
            <div className="met"><span className="mv">5.2</span><span className="mu">MB/s</span><span className="mn">sustained &mdash; about 42 Mbit/s</span></div>
            <div className="met"><span className="mv">~30</span><span className="mu">KB per request</span><span className="mn">average read out of Postgres</span></div>
          </div>
          <p className="prose">
            Inside Google Cloud that egress costs <b>zero</b>. Anywhere else it is roughly $1,400/month
            &mdash; more than their entire database bill. Their own conclusion: a move only pays if this
            drops by about <b>95%</b>, which they described as <em>redesigning how contracts are served</em>.
            That sentence is the opening, and it is not about storage price.
          </p>

          <h3>Storage &mdash; not the pressure</h3>
          <div className="metrics">
            <div className="met"><span className="mv">949.6</span><span className="mu">GB live</span><span className="mn">whole database on disk</span></div>
            <div className="met"><span className="mv">10.0</span><span className="mu">KiB/s growth</span><span className="mn">24.7 GiB/month organic</span></div>
            <div className="met"><span className="mv">296</span><span className="mu">GiB/year</span><span className="mn">at the current organic rate</span></div>
            <div className="met"><span className="mv">25.5</span><span className="mu">KiB per verification</span><span className="mn">measured across 11 days</span></div>
          </div>
          <p className="prose">
            Worth saying out loud in the room: the widely quoted <b>189 GiB/month</b> is 7.7&times; too
            high. It was measured across a window containing a bulk import.
          </p>

          <h3>Unit economics &mdash; what we would have to beat</h3>
          <div className="metrics">
            <div className="met"><span className="mv">$1,003</span><span className="mu">/month</span><span className="mn">their whole Cloud SQL fleet</span></div>
            <div className="met"><span className="mv">$373</span><span className="mu">/month</span><span className="mn">the production database alone</span></div>
            <div className="met"><span className="mv">$0.00033</span><span className="mu">per verification</span><span className="mn">what one write costs them</span></div>
            <div className="met"><span className="mv">$0.39</span><span className="mu">per GB/month</span><span className="mn">stored</span></div>
          </div>
          <div className="callout">
            <p>
              <b>Do not lead with price.</b> They already ran a cost comparison in July across Neon,
              Supabase, Crunchy, Aiven, Hetzner and Scaleway and concluded &ldquo;don&rsquo;t
              migrate&rdquo; &mdash; and the same dataset already sits in cloud storage as Parquet for
              about $5/month. That argument is closed. It never evaluated Arkiv, though, so nothing was
              decided about us.
            </p>
          </div>

          <h3>Three sizes for the same data</h3>
          <ul className="facts">
            <li><b className="m">1,269 GB</b> raw uncompressed &mdash; what the data actually is.</li>
            <li><b className="m">949.6 GB</b> live Postgres &mdash; compresses big values, adds indexes and dead space.</li>
            <li><b className="m">170.4 GB</b> Parquet + zstd &mdash; the public export, <b>7.45&times;</b> smaller than raw.</li>
          </ul>

          <div className="callout warn">
            <p>
              <b>The append-only trap.</b> The Parquet export never rewrites a full file, so updated rows
              are appended and the old version stays. <code>sourcify_matches</code> shows <b>74.2M rows
              in the export against 42.7M live</b> &mdash; 42.4% of that file is superseded versions.
              <b> It cannot be replayed as a backfill</b> without deduplicating by primary key first.
            </p>
          </div>
        </div>
      ) : null}

      {/* ==================== FIT ==================== */}
      {tab === "fit" ? (
        <div>
          <h2>What fits in Arkiv, and what does not</h2>
          <p className="sublede">
            Answered with measured per-column byte sizes rather than intuition.
          </p>
          <div className="split">
            <div className="sbox ok">
              <span className="sn">4.1%</span>
              <span className="sl">index-shaped &mdash; 52.7 GB</span>
              <p>
                Small rows, 58&ndash;620 bytes, across six tables. Identity and relationships: the things
                you filter and look up by. <b>This is the Arkiv-shaped part.</b>
              </p>
            </div>
            <div className="sbox stop">
              <span className="sn">95.9%</span>
              <span className="sl">blob-shaped &mdash; 1,216 GB</span>
              <p>
                Seven very large columns: source text, bytecode, compilation artifacts, metadata JSON.
                <b> Stays content-addressed by hash</b> &mdash; which is how Sourcify already stores it.
              </p>
            </div>
          </div>

          <h3>The heavy columns</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Column</th><th className="r">Avg / value</th><th className="r">Heaviest block</th><th className="r">Total raw</th><th>Verdict</th></tr>
              </thead>
              <tbody>
                <tr><td className="k">sourcify_matches.metadata</td><td className="m">8,090 B</td><td className="m">189,538 B</td><td className="m">600.3 GB</td><td>exceeds a whole Arkiv transaction at the tail</td></tr>
                <tr><td className="k">code.code</td><td className="m">7,898 B</td><td className="m">18,219 B</td><td className="m">317.2 GB</td><td>EIP-170 caps runtime at 24,576 B, so bounded</td></tr>
                <tr><td className="k">sources.content</td><td className="m">16,427 B</td><td className="m">41,440 B</td><td className="m">104.0 GB</td><td>no protocol cap; flattened files reach MBs</td></tr>
                <tr><td className="k">compiled_contracts.runtime_code_artifacts</td><td className="m">17,653 B</td><td className="m">33,365 B</td><td className="m">100.9 GB</td><td>source maps, storage layout</td></tr>
                <tr><td className="k">compiled_contracts.compilation_artifacts</td><td className="m">12,152 B</td><td className="m">27,457 B</td><td className="m">69.5 GB</td><td>ABI, NatSpec</td></tr>
              </tbody>
            </table>
          </div>

          <h3>So where do the blobs actually go?</h3>
          <p className="prose">
            The fair question, and the answer &ldquo;leave them where they are&rdquo; is not good enough
            &mdash; because <b>where they are today is inside Postgres</b>. Source text is
            <code> sources.content</code>, bytecode is <code>code.code</code>, artifacts and metadata are
            JSON columns. <code>repo.sourcify.dev</code> is not a file server: it redirects to
            <code> sourcify.dev/server/repository</code>, which reads out of the database. IPFS via
            Filebase is a pinning mirror of sources; the Parquet export is a daily derived snapshot.
          </p>
          <div className="metrics">
            <div className="met"><span className="mv">189 B</span><span className="mu">default response</span><span className="mn">the head record &mdash; what Arkiv would hold</span></div>
            <div className="met"><span className="mv">11.9 KB</span><span className="mu">?fields=sources</span><span className="mn">source text, served inline from Postgres</span></div>
            <div className="met"><span className="mv">75 KB</span><span className="mu">?fields=all &mdash; USDC</span><span className="mn">everything for one ordinary contract</span></div>
            <div className="met hot"><span className="mv">4.56 MB</span><span className="mu">?fields=all &mdash; Uniswap V3</span><span className="mn">one contract, one response</span></div>
          </div>
          <p className="prose">
            That range is the whole story. <b>The queryable head is 189 bytes; the payload behind it can be
            four thousand times bigger</b> &mdash; and every byte of it is read out of Postgres on request.
            At ~30 KB average per request across 13.6 TB/month, <b>their egress essentially is blob
            payload</b>. That is why their own review said a move only pays if egress drops ~95%, and why
            they called the fix <em>redesigning how contracts are served</em> rather than a storage price.
          </p>
          <div className="scroll">
            <table>
              <thead><tr><th>Option</th><th>Verdict</th><th>Why</th></tr></thead>
              <tbody>
                <tr><td className="k">Arkiv</td><td><span className="pill p-stop">no</span></td>
                  <td>Nothing in the blob set is ever <em>queried</em> &mdash; it is fetched by hash once you already know the contract. Putting 96% of the bytes behind a query engine buys nothing and inherits every size limit.</td></tr>
                <tr><td className="k">Leave in Postgres</td><td><span className="pill p-stop">no</span></td>
                  <td>This is the status quo, and it is precisely what makes the database 949.6 GB and the egress 13.6 TB/month. Taking only the index and changing nothing else solves nothing for them.</td></tr>
                <tr><td className="k">Content-addressed object storage + CDN</td><td><span className="pill p-ok">the realistic tier</span></td>
                  <td>They already run this exact pattern: the Parquet export sits in cloud storage, 242 GiB for about $5/month. Keyed by the same hashes the schema already uses. This is what actually collapses the egress.</td></tr>
                <tr><td className="k">IPFS pinning</td><td><span className="pill p-warn">keep as mirror</span></td>
                  <td>They already publish sources this way via Filebase. Good for openness and independent replication; note their open issue about not being able to <em>delete</em> from it.</td></tr>
                <tr><td className="k">Decentralized blob layer</td><td><span className="pill p-blue">the real decision</span></td>
                  <td>Walrus, Filecoin or similar, if the goal is that no single provider holds the bytes. This is a genuine open choice we have not made &mdash; and it is the one that decides whether this is &ldquo;a cheaper cache&rdquo; or an actual decentralization story.</td></tr>
              </tbody>
            </table>
          </div>
          <div className="callout">
            <p>
              <b>The hash is what makes this work.</b> Because the head entity carries the content hash,
              the blob tier is swappable without touching the index &mdash; object storage today, a
              decentralized layer later, IPFS alongside, all addressing the same bytes. That is the
              argument against &ldquo;it is just a cache&rdquo;: a cache is keyed by location, this is
              keyed by content.
            </p>
          </div>

          <h3>The proposal</h3>
          <ul className="facts">
            <li><b>Not a row-for-row copy.</b> Arkiv has no joins, so a faithful copy would need several round trips per lookup.</li>
            <li><b>One denormalised head entity per verified contract</b>, keyed by <code>chainId:address</code>, carrying the attributes people filter on &mdash; chain, address, match type, compiler, version, language, name, code hashes, timestamp &mdash; plus <b>hash references</b> to the heavy artifacts.</li>
            <li>At ~44M entities of ~600&ndash;800 bytes that is <b className="m">~30 GB</b> of entity payload. The other <b className="m">1,216 GB</b> never moves.</li>
            <li className="warn"><b>The open question is the per-entity ceiling.</b> A transaction caps at 128 KB; there is no documented per-entity limit, and their heaviest metadata blocks average ~186 KB. That is a question for this room.</li>
          </ul>
        </div>
      ) : null}

      {/* ==================== NEED ==================== */}
      {tab === "need" ? (
        <div>
          <h2>What we need from engineering</h2>
          <p className="sublede">
            The data-model work is not blocked &mdash; we can build the corpus, the mapping and the
            adapter from public data today. What is blocked is any promise about reads.
          </p>
          <ul className="facts">
            <li>
              <b>Read capacity.</b> We have no benchmark at all. The public endpoint&rsquo;s quota is a
              gateway policy, not a measurement of the engine. Their traffic is in the millions of
              requests per day. <b>Everything else is downstream of this answer.</b>
            </li>
            <li>
              <b>Would Sourcify run their own node?</b> Public endpoint versus their own node or indexer
              changes the proposal fundamentally &mdash; and a self-hosted read replica speaks directly to
              their egress problem. Arguably the highest-leverage question here.
            </li>
            <li>
              <b>Per-entity payload ceiling</b>, and the chunking story above it. Their heaviest metadata
              blocks average ~186 KB against a 128 KB transaction cap.
            </li>
            <li>
              <b>Does prefix matching fit 75-byte bytecode search</b> at tens of millions of entities, and
              is it index-backed? They solve this today with a Postgres expression index.
            </li>
            <li>
              <b>Query surface, stated conservatively.</b> For prefix, inequality, ordering, projection,
              cursor stability and page limits &mdash; is each <em>in the SDK</em>, <em>implemented</em>,
              <em>verified on the deployed build</em>, or <em>planned</em>?
            </li>
            <li>
              <b>Ownership.</b> Contract-account or multisig ownership that can still update, delete and
              extend. An EF-funded non-profit cannot put a public good behind one private key.
            </li>
            <li>
              <b>Durability, not API semantics.</b> Disk retention, snapshot and restore, full-sync
              reconstruction, behaviour across network resets and releases.
            </li>
          </ul>
          <div className="callout">
            <p>
              <b>The ask.</b> One named technical owner for the Sourcify POC, and agreement on a staged
              benchmark &mdash; <b>100k representative entities, then 1M</b> &mdash; before anyone quotes a
              number for the full corpus.
            </p>
          </div>
        </div>
      ) : null}

      {/* ==================== ASK ==================== */}
      {tab === "ask" ? (
        <div>
          <h2>Ask</h2>
          <p className="sublede">
            Facts, tradeoffs, architecture. Numbers come from the knowledge base and are highlighted;
            anything the model works out itself is marked, and it will tell you plainly when we do not
            know.
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
              <span className="hint">Cmd/Ctrl + Enter &middot; hard questions take ~30s</span>
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
                  <div className="cap">Sources &mdash; {sources.length} facts cited &middot; numbered markers in the text point here</div>
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

          <h3>Or search the facts directly</h3>
          <p className="prose">Instant, local, no network.</p>
          <input
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="schema, egress, chains, growth, 4byte, unknown&hellip;"
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
                  Nothing matches. That may itself be the answer &mdash; ask the assistant above and it
                  will tell you who can resolve it.
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <footer>
        Sourcify figures measured {AS_OF} from public endpoints and moving daily &mdash; restate the date
        when quoting.
        <br />
        Arkiv-side figures are provisional: that network is under construction and nothing here is a
        capability commitment.
      </footer>
    </div>
  );
}
