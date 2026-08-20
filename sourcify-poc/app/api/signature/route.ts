/**
 * GET /api/signature?selector=0xa9059cbb
 *
 * Sourcify's 4-byte service, answered from Arkiv. This is the shape the database is
 * actually good at: one equality on an indexed attribute, one round trip, a payload
 * measured at 86 bytes median. No join, no ordering, no aggregation needed — which is
 * why it belongs in scope rather than in the "separate service" pile.
 *
 * A selector is not unique: several different function texts can hash to the same four
 * bytes. The entity therefore holds the whole candidate set, and the response returns
 * all of them rather than picking one.
 */
import { NextResponse } from "next/server";
import { arkiv, DATASET, PUBLISHER } from "@/lib/arkiv";
import { eq, startsWith } from "@arkiv-network/sdk/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const selector = (sp.get("selector") ?? "").toLowerCase().trim();
  const prefix = sp.get("prefix");

  if (!prefix && !/^0x[0-9a-f]{8}$/.test(selector) && !/^0x[0-9a-f]{64}$/.test(selector)) {
    return NextResponse.json(
      { error: "selector must be 0x + 8 hex (function/error) or 0x + 64 hex (event)" },
      { status: 400 },
    );
  }

  const t0 = Date.now();
  try {
    let q = arkiv
      .select({ key: true, owner: true, attributes: true, payload: true })
      .where(
        eq("ds", DATASET),
        eq("kind", "signature"),
        prefix ? startsWith("selector", prefix.toLowerCase()) : eq("selector", selector),
      )
      .limit(prefix ? 50 : 5);
    if (PUBLISHER) q = q.ownedBy(PUBLISHER as `0x${string}`);
    const wire = q.toString();
    const res = await q.fetch();

    const results = res.entities.map((e) => {
      let payload: Record<string, unknown> | null = null;
      try { payload = e.toJson?.() ?? null; } catch { payload = null; }
      return { entityKey: e.key, ...payload };
    });

    return NextResponse.json({
      count: results.length,
      ms: Date.now() - t0,
      blockNumber: res.blockNumber?.toString() ?? null,
      arkivQuery: wire,
      results,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "arkiv query failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
