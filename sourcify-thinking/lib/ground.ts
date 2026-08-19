import factsDoc from "@/kb/facts.json";

export type Confidence = "measured" | "stated" | "unknown";

export interface Fact {
  id: string;
  statement: string;
  short?: string;
  value?: number | string;
  unit?: string;
  scope?: string;
  asOf?: string;
  source?: { label?: string; url?: string };
  confidence: Confidence;
  tags?: string[];
  extra?: Record<string, unknown>;
}

export const FACTS: Fact[] = (factsDoc as { facts: Fact[] }).facts;
export const FACTS_BY_ID = new Map(FACTS.map((f) => [f.id, f]));
export const KB_AS_OF = (factsDoc as { generatedAt: string }).generatedAt;

/**
 * The ledger the model sees. Deliberately compact and stable: it is the cached
 * prefix, so nothing volatile (timestamps, the question) belongs in here.
 */
export function renderLedger(): string {
  return FACTS.map((f) => {
    const bits = [`[${f.id}] (${f.confidence})`, f.statement];
    if (f.scope) bits.push(`SCOPE: ${f.scope}`);
    if (f.asOf) bits.push(`AS OF: ${f.asOf}`);
    if (f.source?.label) bits.push(`SOURCE: ${f.source.label}${f.source.url ? ` <${f.source.url}>` : ""}`);
    return bits.join(" | ");
  }).join("\n");
}

const TOKEN = /\{\{F:([A-Za-z0-9._-]+)\}\}/g;

/**
 * Any numeral the model typed, wherever it sits.
 *
 * The earlier version required the number to be preceded by whitespace or an
 * opening bracket, which silently missed the most common case of all:
 * `**949.6 GB**`. Models bold their figures constantly, so bolded numbers were
 * sailing through unmarked. Also missed `$1,003`, `~44M` and `1.2e9`.
 *
 * Now: a digit run not glued to a word character, plus optional magnitude or
 * percent suffix, so `43.7M` and `88.6%` are captured whole.
 */
const BARE_NUMBER =
  /(?<![\w])(\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?(?:%|\s?(?:[KMGTPkmgtp]i?[Bb]?|bn|x|×))?)(?![\w])/g;

/** Numerals that are never quantitative claims: years, versions, list markers. */
const BENIGN = [/^\d{4}$/, /^v?\d+(\.\d+)+$/, /^\d{1,2}$/];

/** Spans parked verbatim before the number scan: dates and inline code. */
const PARK_VERBATIM = [
  /\d{4}-\d{2}-\d{2}/g, // ISO dates -- "2026-08-18" must not read as three numbers
  /`[^`\n]*`/g, // inline code -- a SQL literal is not a claim
];

/** Sentinel for parked tokens: private-use chars, so it contains no digits and no HTML. */
const PARK_OPEN = "";
const PARK_BASE = 0xe100;

export interface Grounded {
  html: string;
  used: Fact[];
  unknownIds: string[];
  ungroundedNumbers: string[];
}

export function ground(markdown: string): Grounded {
  const used: Fact[] = [];
  const unknownIds: string[] = [];
  const ungrounded: string[] = [];

  // 1. Escape the model's text. {{F:id}} survives intact (no HTML characters).
  //    Strip private-use characters first: the parking sentinel lives in that
  //    range, so model output containing them could corrupt the restore step.
  let out = escapeHtml(markdown.replace(/[-]/g, ""));

  // 2. Park the fact tokens BEFORE scanning for bare numbers. Scanning after
  //    substitution was a real bug: it flagged our own measured values as
  //    "unverified". The sentinel deliberately contains no digits.
  const parked: string[] = [];
  const park = (m: string) => {
    parked.push(m);
    return PARK_OPEN + String.fromCharCode(PARK_BASE + parked.length - 1);
  };
  out = out.replace(TOKEN, park);
  for (const re of PARK_VERBATIM) out = out.replace(re, park);

  // 3. Anything numeric left is the model's own. Mark it rather than removing
  //    it: in a live meeting a visible chip beats a blocked answer.
  out = out.replace(BARE_NUMBER, (m: string) => {
    const n = m.trim();
    if (BENIGN.some((re) => re.test(n))) return m;
    ungrounded.push(n);
    return `<span class="ungrounded" title="Not traced to a fact in the knowledge base — the model's own arithmetic or estimate, not a measurement.">${m}</span>`;
  });

  // 4. Restore the tokens, then render each one from the ledger.
  out = out.replace(
    new RegExp(`${PARK_OPEN}([\\uE100-\\uE3FF])`, "g"),
    (_m, ch: string) => parked[ch.charCodeAt(0) - PARK_BASE] ?? "",
  );

  out = out.replace(TOKEN, (_m, id: string) => {
    const f = FACTS_BY_ID.get(id);
    if (!f) {
      unknownIds.push(id);
      return `<span class="bad">[unknown fact: ${escapeHtml(id)}]</span>`;
    }
    let idx = used.findIndex((u) => u.id === f.id);
    if (idx < 0) idx = used.push(f) - 1;
    const tip = `${f.statement}${f.scope ? `\n\nScope: ${f.scope}` : ""}${f.asOf ? `\nAs of: ${f.asOf}` : ""}`;

    // A fact WITH a value is a quantity: substitute it inline, which is the whole
    // point of the firewall. A fact WITHOUT one is a claim or a definition --
    // inlining its label mid-sentence produced garbage like "reads out of Postgres
    // blobs live in Postgres today", so those render as a footnote marker instead.
    if (f.value === undefined) {
      return `<sup class="cite" data-fact="${escapeHtml(f.id)}" title="${escapeHtml(tip)}">${idx + 1}</sup>`;
    }
    const shown = `${fmt(f.value)}${f.unit ? (f.unit.startsWith("%") ? f.unit : ` ${f.unit}`) : ""}`;
    return `<b class="fact" data-fact="${escapeHtml(f.id)}" title="${escapeHtml(tip)}">${escapeHtml(shown)}</b>`;
  });

  return { html: out, used, unknownIds, ungroundedNumbers: ungrounded };
}

function fmt(v: number | string): string {
  return typeof v === "number" ? v.toLocaleString("en-US") : v;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
