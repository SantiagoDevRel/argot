/**
 * GET /api/query — the part Sourcify's API cannot answer.
 *
 * Sourcify exposes lookups by (chain, address) and a chain feed. It has no public
 * filter surface: "every proxy on this chain compiled with 0.8.x that has more than
 * 40 functions" is not a URL you can build against sourcify.dev. Against Arkiv it is
 * one predicate, because those fields are indexed attributes rather than columns
 * behind an API nobody exposed.
 */
import { NextResponse } from "next/server";
import { query, type Filters } from "@/lib/arkiv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEYS = [
  "chainId", "address", "match", "compiler", "compilerVersion", "language",
  "isProxy", "minFns", "maxFns", "optimizer", "namePrefix", "verifiedAfter", "deployer",
] as const;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const f: Filters = {};
  for (const k of KEYS) {
    const v = sp.get(k);
    if (v) (f as Record<string, string>)[k] = v;
  }
  const limit = Math.min(Number(sp.get("limit") ?? 50) || 50, 200);
  const kind = sp.get("kind") ?? "verified_contract";

  try {
    const { rows, wire, ms, blockNumber, truncated } = await query(f, limit, kind);
    return NextResponse.json({
      count: rows.length,
      truncated,
      ms,
      blockNumber,
      arkivQuery: wire,
      filters: f,
      results: rows.map((r) => ({ entityKey: r.key, owner: r.owner, ...r.attributes })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "arkiv query failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
