/**
 * GET /api/v2/contract/{chainId}/{address}
 *
 * Sourcify's hottest endpoint (~70% of contract-API traffic), answered from Arkiv
 * instead of Postgres. The response shape is Sourcify v2's, including the `fields`
 * projection, because the whole point is that a caller cannot tell the difference.
 *
 * `fields` is applied HERE rather than by the database: Arkiv returns a whole
 * payload, so projection is the adapter's job. That is a real difference from
 * Postgres and it is stated rather than hidden.
 */
import { NextResponse } from "next/server";
import { lookup } from "@/lib/arkiv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sourcify's minimal record: what you get when you pass no `fields`. */
const MINIMAL = ["match", "creationMatch", "runtimeMatch", "chainId", "address", "verifiedAt", "matchId"];

function project(payload: Record<string, unknown>, fields?: string | null, omit?: string | null) {
  if (fields === "all") return payload;
  if (omit) {
    const drop = new Set(omit.split(",").map((s) => s.trim()));
    return Object.fromEntries(Object.entries(payload).filter(([k]) => !drop.has(k)));
  }
  const want = new Set([...MINIMAL, ...(fields ? fields.split(",").map((s) => s.trim()) : [])]);
  return Object.fromEntries(Object.entries(payload).filter(([k]) => want.has(k)));
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ chainId: string; address: string }> },
) {
  const { chainId, address } = await ctx.params;
  const url = new URL(req.url);
  const fields = url.searchParams.get("fields");
  const omit = url.searchParams.get("omit");
  if (fields && omit) {
    return NextResponse.json({ error: "fields and omit are mutually exclusive" }, { status: 400 });
  }

  try {
    const { row, wire, ms, blockNumber } = await lookup(chainId, address);
    if (!row?.payload) {
      return NextResponse.json({ error: "Contract not verified" }, { status: 404 });
    }
    const body = project(row.payload as Record<string, unknown>, fields, omit);
    return NextResponse.json(body, {
      headers: {
        // Provenance, so a reviewer can check the claim rather than take it.
        "x-arkiv-entity-key": row.key,
        "x-arkiv-owner": row.owner,
        "x-arkiv-block": blockNumber ?? "",
        "x-arkiv-query": wire,
        "x-arkiv-ms": String(ms),
        "server-timing": `arkiv;dur=${ms}`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "arkiv read failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
