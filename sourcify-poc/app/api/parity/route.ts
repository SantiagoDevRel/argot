/**
 * GET /api/parity?chainId=130&address=0x…
 *
 * Asks the same question of both databases and diffs the answers field by field.
 *
 * This is the only claim that matters to Sourcify: not "Arkiv is fast" or "Arkiv is
 * decentralised", but "for this contract, the record Arkiv returns is the record you
 * return". A mismatch is reported, never smoothed over — a parity check that cannot
 * fail is not a check.
 */
import { NextResponse } from "next/server";
import { lookup } from "@/lib/arkiv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCIFY = "https://sourcify.dev/server/v2";
/** The fields both sides are expected to agree on, byte for byte. */
const COMPARED = ["match", "creationMatch", "runtimeMatch", "chainId", "address", "verifiedAt", "matchId"];

const norm = (k: string, v: unknown) =>
  v == null ? null : k === "address" ? String(v).toLowerCase() : String(v);

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const chainId = sp.get("chainId") ?? "130";
  const address = sp.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "address must be 0x + 40 hex" }, { status: 400 });
  }

  const t0 = Date.now();
  const [sourcify, arkivRes] = await Promise.allSettled([
    (async () => {
      const r = await fetch(`${SOURCIFY}/contract/${chainId}/${address}`, {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      return { status: r.status, body: r.ok ? await r.json() : null, ms: Date.now() - t0 };
    })(),
    lookup(chainId, address),
  ]);

  const s = sourcify.status === "fulfilled" ? sourcify.value : null;
  const a = arkivRes.status === "fulfilled" ? arkivRes.value : null;
  const sBody = s?.body ?? null;
  const aBody = (a?.row?.payload ?? null) as Record<string, unknown> | null;

  const fields = COMPARED.map((k) => {
    const sv = norm(k, sBody?.[k]);
    const av = norm(k, aBody?.[k]);
    return { field: k, sourcify: sv, arkiv: av, equal: sv === av };
  });
  const mismatches = fields.filter((f) => !f.equal);
  // A field null on BOTH sides compares equal, so a shape change on either side
  // could leave every comparison vacuously true and report "identical" over
  // nothing at all. Require the identity fields to have actually been present.
  const REQUIRED = ["match", "chainId", "address", "matchId"];
  const compared = fields.filter((f) => f.sourcify !== null && f.arkiv !== null);
  const missingRequired = REQUIRED.filter(
    (k) => !compared.some((f) => f.field === k),
  );

  return NextResponse.json({
    chainId, address,
    verdict:
      !aBody ? "not_in_arkiv"
      : !sBody ? "not_in_sourcify"
      : missingRequired.length > 0 ? "inconclusive"
      : mismatches.length === 0 ? "identical"
      : "mismatch",
    comparedFields: compared.length,
    missingRequired,
    mismatches: mismatches.map((m) => m.field),
    fields,
    sourcify: { httpStatus: s?.status ?? null, ms: s?.ms ?? null, body: sBody },
    arkiv: {
      ms: a?.ms ?? null,
      entityKey: a?.row?.key ?? null,
      owner: a?.row?.owner ?? null,
      blockNumber: a?.blockNumber ?? null,
      query: a?.wire ?? null,
      body: aBody,
    },
    errors: {
      sourcify: sourcify.status === "rejected" ? String(sourcify.reason) : null,
      arkiv: arkivRes.status === "rejected" ? String(arkivRes.reason) : null,
    },
  });
}
