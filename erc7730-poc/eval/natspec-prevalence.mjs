// natspec-prevalence.mjs — measure how many verified contracts actually carry
// intent-bearing NatSpec (@notice / @param). This is the prerequisite number for any
// accuracy claim: where NatSpec is absent (~60% per the assessment's 150-contract sample)
// the generator infers from raw source, at lower accuracy. We sample from the ground-truth
// corpus' real deployments (chainId+address) and hit the Sourcify v2 lookup.
//
//   node eval/natspec-prevalence.mjs [N]        (default N=40; scale up offline on the DGX)
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SOURCIFY = "https://sourcify.dev/server/v2/contract";
const N = Number(process.argv[2] || 40);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rank = (s) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 12), 16);

async function fetchDoc(chainId, address) {
  const url = `${SOURCIFY}/${chainId}/${address}?fields=userdoc,devdoc,abi,proxyResolution`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (res.status === 404) return { verified: false };
    if (!res.ok) return { error: res.status };
    const j = await res.json();
    const userMethods = j.userdoc?.methods ? Object.keys(j.userdoc.methods).length : 0;
    const devMethods = j.devdoc?.methods ? Object.values(j.devdoc.methods) : [];
    const devWithParams = devMethods.filter((m) => m && m.params && Object.keys(m.params).length > 0).length;
    const abiFns = Array.isArray(j.abi) ? j.abi.filter((x) => x.type === "function").length : 0;
    return {
      verified: !!j.match || !!j.matchId,
      hasNotice: userMethods > 0 || !!j.userdoc?.notice,
      noticeMethods: userMethods,
      hasParam: devWithParams > 0,
      paramMethods: devWithParams,
      abiFns,
      isProxy: !!j.proxyResolution?.isProxy,
    };
  } catch (e) {
    return { error: String(e).slice(0, 80) };
  }
}

async function main() {
  const corpus = JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8"));
  // one deployment per descriptor, deterministic sample
  const targets = corpus.descriptors
    .filter((d) => d.kind === "calldata" && d.deployments.length)
    .map((d) => ({ id: d.id, bucket: d.bucket, ...d.deployments[0] }))
    .sort((a, b) => rank(a.address + a.chainId) - rank(b.address + b.chainId))
    .slice(0, N);

  console.log(`sampling ${targets.length} verified contracts on Sourcify v2 for NatSpec prevalence…`);
  const rows = [];
  for (const t of targets) {
    const r = await fetchDoc(t.chainId, t.address);
    rows.push({ ...t, ...r });
    process.stdout.write(r.verified ? (r.hasNotice ? "N" : r.error ? "!" : ".") : "x");
    await sleep(250); // be polite to Sourcify
  }
  console.log();

  const verified = rows.filter((r) => r.verified);
  const withNotice = verified.filter((r) => r.hasNotice);
  const withParam = verified.filter((r) => r.hasParam);
  const errors = rows.filter((r) => r.error);
  const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "—");

  const summary = {
    sampled: rows.length,
    verifiedOnSourcify: verified.length,
    errors: errors.length,
    noticePrevalence: pct(withNotice.length, verified.length),
    paramPrevalence: pct(withParam.length, verified.length),
    note: "sample from the ground-truth corpus' real deployments; scale N offline on the DGX for the headline number",
  };
  writeFileSync(join(HERE, "natspec-prevalence.json"), JSON.stringify({ summary, rows }, null, 2));

  console.log("NatSpec prevalence (sample):");
  console.log("  verified on Sourcify:", verified.length, "/", rows.length, `(${errors.length} errors)`);
  console.log("  @notice (userdoc):   ", withNotice.length, "/", verified.length, "=", summary.noticePrevalence);
  console.log("  @param  (devdoc):    ", withParam.length, "/", verified.length, "=", summary.paramPrevalence);
  console.log("  wrote eval/natspec-prevalence.json");
}

main();
