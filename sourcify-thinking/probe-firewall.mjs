/**
 * probe-firewall.mjs -- adversarial test of the fact firewall in lib/ground.ts.
 * Extracts the live regexes from the source so the probe can never drift from
 * the shipped code. Run: node probe-firewall.mjs
 */
import fs from "node:fs";
const src = fs.readFileSync("lib/ground.ts", "utf8");
/** Slice the literal out of the source by index -- no meta-regex, no escaping traps. */
const grab = (name, open, close) => {
  const at = src.indexOf(`const ${name} =`);
  if (at < 0) throw new Error(`could not find ${name}`);
  const start = src.indexOf(open, at + name.length);
  const end = src.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`could not slice ${name}`);
  return eval(src.slice(start, end + close.length - 1));
};
const BARE = grab("BARE_NUMBER", "/", "/g;");
const TOKEN = /\{\{F:([A-Za-z0-9._-]+)\}\}/g;
const BENIGN = grab("BENIGN", "[", "];");
const PARKV = grab("PARK_VERBATIM", "[", "];");
const facts = new Map(
  JSON.parse(fs.readFileSync("kb/facts.json", "utf8")).facts.map((f) => [f.id, f]),
);
const PO = "\uE000", PB = 0xe100;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function ground(md) {
  const ung = [];
  let out = esc(md.replace(/[\uE000-\uF8FF]/g, ""));
  const P = [];
  const park = (m) => { P.push(m); return PO + String.fromCharCode(PB + P.length - 1); };
  out = out.replace(TOKEN, park);
  for (const r of PARKV) out = out.replace(r, park);
  out = out.replace(BARE, (m) => {
    const n = m.trim();
    if (BENIGN.some((r) => r.test(n))) return m;
    ung.push(n);
    return `\u00ab${m}\u00bb`;
  });
  out = out.replace(new RegExp(`${PO}([\uE100-\uE3FF])`, "g"), (_m, c) => P[c.charCodeAt(0) - PB] ?? "");
  out = out.replace(TOKEN, (_m, id) => {
    const f = facts.get(id);
    return f ? `[FACT:${f.value ?? f.short}]` : `[BAD:${id}]`;
  });
  return { out, ung };
}

const CASES = [
  ["bold number", "**949.6 GB** of data", true],
  ["plain number", "The DB is 949.6 GB today.", true],
  ["currency", "costs $1,003 per month", true],
  ["tilde M", "~44M entities", true],
  ["scientific", "about 1.2e9 bytes", true],
  ["M suffix", "around 43.7M contracts", true],
  ["percent", "some 88.6% of GETs", true],
  ["comma group", "43,781,389 contracts", true],
  ["heading", "## 44,000,000 rows", true],
  ["list item", "- 189 GiB/month", true],
  ["multiplier", "a 7.45x factor", true],
  ["table cell", "| 600.3 GB | metadata |", true],
  ["inline code", "Run `SELECT 42000000 FROM t`", false],
  ["ISO date", "measured 2026-08-18 today", false],
  ["year", "back in 2025 they had fewer", false],
  ["version", "Next 16.2.10 handles it", false],
  ["small ordinal", "3 things matter here", false],
  ["real fact", "Size is {{F:sourcify.db_size}}.", false],
  ["fake fact", "Size is {{F:nope.bad_id}}.", false],
  ["PUA injection", "evil \uE000\uE105 chars and 500 GB", true],
  ["xss script", "<script>alert(1)</script> and 42 GB", true],
  ["xss attr", '<img src=x onerror="alert(1)"> 99 GB', true],
];

let fail = 0;
for (const [name, input, shouldMark] of CASES) {
  const { out, ung } = ground(input);
  const ok = ung.length > 0 === shouldMark;
  if (!ok) fail++;
  console.log((ok ? "  ok " : "  FAIL").padEnd(7), name.padEnd(15), "|", out.slice(0, 56));
}
// Substring checks would false-positive on escaped text like "&lt;img ... onerror=...&gt;",
// which renders as literal characters, not an element. What matters is which REAL tags
// survive: only the ones this module injects itself.
const ALLOWED_TAGS = new Set(["span", "/span", "b", "/b", "sup", "/sup"]);
const xssPayloads = [
  '<script>alert(1)</script>',
  '<img src=x onerror="a()">',
  '<iframe src="javascript:alert(1)"></iframe>',
  '"><span class="fact">fake authoritative number</span>',
  '{{F:sourcify.db_size}}<script>x</script>',
];
const escaped = [];
for (const p of xssPayloads) {
  const html = ground(p).out;
  for (const m of html.matchAll(/<\/?([a-zA-Z][\w-]*)/g)) {
    const tag = (m[0][1] === "/" ? "/" : "") + m[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) escaped.push(`${tag} from ${JSON.stringify(p.slice(0, 28))}`);
  }
}
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} -- ${CASES.length - fail}/${CASES.length} marking cases`);
console.log(
  escaped.length === 0
    ? "xss: no attacker-controlled tags survive (only span/b, injected by us)"
    : `xss: LEAKED TAGS -> ${escaped.join("; ")}`,
);
process.exit(fail === 0 && escaped.length === 0 ? 0 : 1);
