#!/usr/bin/env node
/**
 * build-context.mjs -- assemble kb/context-pack.md from the working documents in
 * ../ (the ARGOT folder). This is the REASONING the assistant needs to answer
 * "how should we architect X", which a ledger of atomic facts cannot carry.
 *
 * Hard rule enforced by the prompt, not by this script: these documents are
 * BACKGROUND ONLY. Several were written in June/July 2026 and contain figures
 * that later measurement superseded (they say ~11M verified contracts; it is
 * now 43.78M) and references to networks that no longer exist. Every quantity
 * must still come from the fact ledger, never from here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ARGOT = path.resolve(here, "..", "..");
const OUT = path.resolve(here, "..", "kb", "context-pack.json");

const DOCS = [
  ["sourcify-cto-conversation.md", "Kaan (Sourcify CTO) in his own words, July 2026. Primary source. NOTE: the ERC-7730 direction he describes here differs from what Sourcify actually shipped in May 2026 (EAS attestations over a mirrorable off-chain registry), so treat the on-chain registry as an open question, not a commitment."],
  ["arkiv-mapping-design.md", "The Sourcify->Arkiv entity mapping design. The structural thinking is current; its volume figures are not (written against ~11M contracts)."],
  ["arkiv-load-model-research.md", "What Arkiv could and could not do, with sources. WARNING: measured on Braga, a network that has since been retired. Treat every number here as historical. Its three blockers -- permanence, ownership, read-scale -- are the durable part; permanence has since been resolved."],
  ["sourcify-data-model-research.md", "Sourcify's data model and API surface, researched from primary sources."],
  ["sourcify-arkiv-dossier.md", "The master strategy document: north star, the wedge, the phase plan."],
  ["questions-for-kaan-2026-08-18.md", "The ten questions being sent to Kaan today, with the reasoning behind each and the notes on what NOT to ask."],
];

const parts = [
  `# Background documents

These are our working documents. They carry the REASONING behind the plan: why the
mapping looks the way it does, what Sourcify's CTO actually said, which blockers we
identified and why.

CRITICAL: this section is background only. Some of it was written in June and July
2026 and has been superseded by later measurement -- it refers to roughly 11 million
verified contracts when the measured figure is now far higher, and to Arkiv networks
that have since been retired. **Never take a quantity from this section.** Every
number you state must come from the fact ledger above, as a {{F:id}} token. Use these
documents for structure, argument and history; use the ledger for figures.
`,
];

for (const [file, note] of DOCS) {
  const p = path.join(ARGOT, file);
  if (!fs.existsSync(p)) {
    console.warn(`  skipped (missing): ${file}`);
    continue;
  }
  const body = fs.readFileSync(p, "utf8").trim();
  parts.push(`\n---\n\n## ${file}\n\n> ${note}\n\n${body}\n`);
  console.log(`  + ${file} (${body.split(/\s+/).length} words)`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const text = parts.join("\n");
fs.writeFileSync(OUT, JSON.stringify({ text }, null, 2));
console.log(`\nkb/context-pack.md: ${text.split(/\s+/).length} words, ~${Math.round((text.split(/\s+/).length * 4) / 3)} tokens`);
