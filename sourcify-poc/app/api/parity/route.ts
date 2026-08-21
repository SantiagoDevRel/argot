/**
 * GET /api/parity?chainId=130&address=0x…&depth=identity|full
 *
 * Asks the same question of both databases and diffs the answers field by field.
 *
 * On DEPTH, because "why only seven fields?" is the right question to ask of any
 * parity claim. Seven is not a sample — it is the entire record Sourcify returns
 * when you do not pass `fields`. That default response is what ~70% of their
 * traffic actually receives, so agreeing on all seven is agreeing on the whole
 * answer. But it is a thin claim on its own, so `depth=full` asks Sourcify for the
 * ABI, the compilation and the deployment too and compares those as well.
 *
 * Both sides are always compared at the SAME projection. Showing Sourcify's
 * seven-field default next to Arkiv's whole stored payload would look like a
 * difference and would only be a difference in what was asked for.
 */
import { NextResponse } from "next/server";
import { lookup } from "@/lib/arkiv";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SOURCIFY = "https://sourcify.dev/server/v2";

/** The seven fields of Sourcify's default lookup response. */
const IDENTITY = ["match", "creationMatch", "runtimeMatch", "chainId", "address", "verifiedAt", "matchId"];

type Cmp = { field: string; sourcify: string | null; arkiv: string | null; equal: boolean; group: string };

const norm = (k: string, v: unknown) =>
  v == null ? null : k === "address" || k === "deployer" ? String(v).toLowerCase() : String(v);

/** Order-independent digest, so two equal ABIs never differ over key order. */
const digest = (v: unknown): string | null => {
  if (v == null) return null;
  const canon = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(canon)
    : x && typeof x === "object"
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, canon(val)]))
      : x;
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(canon(v))).digest("hex").slice(0, 16);
};

const at = (o: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const chainId = sp.get("chainId") ?? "130";
  const address = sp.get("address") ?? "";
  const deep = sp.get("depth") === "full";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "address must be 0x + 40 hex" }, { status: 400 });
  }

  const fields = deep ? "?fields=abi,compilation,deployment" : "";
  // The exact URL we call, returned so the page can render it as a link. A reviewer
  // clicking it hits Sourcify's own server and sees the response we compared against,
  // which is a stronger claim than any screenshot of it.
  const sourcifyUrl = `${SOURCIFY}/contract/${chainId}/${address}${fields}`;
  const t0 = Date.now();
  const [sourcify, arkivRes] = await Promise.allSettled([
    (async () => {
      const r = await fetch(sourcifyUrl, {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      return { status: r.status, body: r.ok ? await r.json() : null, ms: Date.now() - t0 };
    })(),
    lookup(chainId, address),
  ]);

  const s = sourcify.status === "fulfilled" ? sourcify.value : null;
  const a = arkivRes.status === "fulfilled" ? arkivRes.value : null;
  const sBody = (s?.body ?? null) as Record<string, unknown> | null;
  const aBody = (a?.row?.payload ?? null) as Record<string, unknown> | null;

  const fieldsOut: Cmp[] = IDENTITY.map((k) => {
    const sv = norm(k, sBody?.[k]);
    const av = norm(k, aBody?.[k]);
    return { field: k, sourcify: sv, arkiv: av, equal: sv === av, group: "identity" };
  });

  if (deep) {
    // The ABI is compared as a canonical digest: it is a few thousand bytes and what
    // matters is whether they are the same ABI, not how it is laid out.
    const sAbi = digest(sBody?.abi);
    const aAbi = digest(aBody?.abi);
    fieldsOut.push({ field: "abi (digest)", sourcify: sAbi, arkiv: aAbi, equal: sAbi === aAbi, group: "abi" });
    const abiLen = (v: unknown) => (Array.isArray(v) ? String(v.length) : null);
    fieldsOut.push({ field: "abi entries", sourcify: abiLen(sBody?.abi), arkiv: abiLen(aBody?.abi), equal: abiLen(sBody?.abi) === abiLen(aBody?.abi), group: "abi" });

    for (const path of ["compilation.compiler", "compilation.compilerVersion", "compilation.language", "compilation.name", "compilation.fullyQualifiedName"]) {
      const sv = norm(path, at(sBody, path));
      const av = norm(path, at(aBody, path));
      fieldsOut.push({ field: path, sourcify: sv, arkiv: av, equal: sv === av, group: "compilation" });
    }
    for (const path of ["deployment.transactionHash", "deployment.blockNumber", "deployment.transactionIndex", "deployment.deployer"]) {
      const sv = norm(path.split(".").pop()!, at(sBody, path));
      const av = norm(path.split(".").pop()!, at(aBody, path));
      fieldsOut.push({ field: path, sourcify: sv, arkiv: av, equal: sv === av, group: "deployment" });
    }
  }

  const mismatches = fieldsOut.filter((f) => !f.equal);
  // A field null on BOTH sides compares equal, so a shape change could leave every
  // comparison vacuously true. Require the identity fields to have actually been there.
  const REQUIRED = ["match", "chainId", "address", "matchId"];
  const compared = fieldsOut.filter((f) => f.sourcify !== null && f.arkiv !== null);
  const missingRequired = REQUIRED.filter((k) => !compared.some((f) => f.field === k));

  return NextResponse.json({
    chainId, address,
    depth: deep ? "full" : "identity",
    verdict:
      !aBody ? "not_in_arkiv"
      : !sBody ? "not_in_sourcify"
      : missingRequired.length > 0 ? "inconclusive"
      : mismatches.length === 0 ? "identical"
      : "mismatch",
    comparedFields: compared.length,
    missingRequired,
    mismatches: mismatches.map((m) => m.field),
    fields: fieldsOut,
    sourcify: { httpStatus: s?.status ?? null, ms: s?.ms ?? null, url: sourcifyUrl, body: sBody },
    arkiv: {
      ms: a?.ms ?? null,
      entityKey: a?.row?.key ?? null,
      owner: a?.row?.owner ?? null,
      blockNumber: a?.blockNumber ?? null,
      query: a?.wire ?? null,
      // Projected to exactly what Sourcify was asked for, so the two panels are
      // comparable. The full stored payload is on the Explorer tab.
      body: aBody
        ? Object.fromEntries(Object.entries(aBody).filter(([k]) =>
            deep ? [...IDENTITY, "abi", "compilation", "deployment"].includes(k) : IDENTITY.includes(k)))
        : null,
    },
    errors: {
      sourcify: sourcify.status === "rejected" ? String(sourcify.reason) : null,
      arkiv: arkivRes.status === "rejected" ? String(arkivRes.reason) : null,
    },
  });
}
