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

/** Digits with optional thousands separators, decimals, percent. */
const BARE_NUMBER = /(^|[\s(>[])(\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\d+(?:\.\d+)?%?)(?=$|[\s).,;:\]])/g;

/** Numerals that are never claims: years, issue refs, version/list numbers. */
const BENIGN = [/^\d{4}$/, /^v?\d+(\.\d+)*$/];

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
  let out = escapeHtml(markdown);

  // 2. Park the fact tokens BEFORE scanning for bare numbers. Scanning after
  //    substitution was a real bug: it flagged our own measured values as
  //    "unverified". The sentinel deliberately contains no digits.
  const parked: string[] = [];
  out = out.replace(TOKEN, (m) => {
    parked.push(m);
    return PARK_OPEN + String.fromCharCode(PARK_BASE + parked.length - 1);
  });

  // 3. Anything numeric left is the model's own. Mark it rather than removing
  //    it: in a live meeting a visible chip beats a blocked answer.
  out = out.replace(BARE_NUMBER, (m, pre: string, n: string) => {
    if (BENIGN.some((re) => re.test(n))) return m;
    ungrounded.push(n);
    return `${pre}<span class="ungrounded" title="Not traced to a fact in the knowledge base — the model's own arithmetic or estimate, not a measurement.">${n}</span>`;
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
    if (!used.some((u) => u.id === f.id)) used.push(f);
    const shown =
      f.value !== undefined
        ? `${fmt(f.value)}${f.unit ? (f.unit.startsWith("%") ? f.unit : ` ${f.unit}`) : ""}`
        : (f.short ?? f.id);
    const tip = `${f.statement}${f.scope ? `\n\nScope: ${f.scope}` : ""}${f.asOf ? `\nAs of: ${f.asOf}` : ""}`;
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
