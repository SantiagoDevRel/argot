/**
 * GET /api/entity?key=0x…
 *
 * One entity, by its key. This exists because Cheesecake has no block explorer —
 * the indexer on that host is a gas-price tracker, and no explorer subdomain
 * answers. So "here is the record, go look at it yourself" has nowhere to point,
 * and the honest fix is to be that surface rather than to link at nothing.
 *
 * `getEntity` is a direct read with no owner filter of its own, so the same
 * authenticity check the predicate queries get through `.ownedBy()` is applied
 * here by hand.
 */
import { NextResponse } from "next/server";
import { arkiv, PUBLISHER } from "@/lib/arkiv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const key = (new URL(req.url).searchParams.get("key") ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    return NextResponse.json({ error: "key must be 0x + 64 hex" }, { status: 400 });
  }

  const t0 = Date.now();
  try {
    const e = await arkiv.getEntity(key as `0x${string}`);
    if (PUBLISHER && e.owner?.toLowerCase() !== PUBLISHER) {
      return NextResponse.json(
        { error: "that entity exists but is not owned by this dataset's publisher" },
        { status: 404 },
      );
    }
    const attributes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e.attributes ?? {})) {
      const raw = v && typeof v === "object" && "value" in (v as object) ? (v as { value: unknown }).value : v;
      attributes[k] = typeof raw === "bigint" ? raw.toString() : raw;
    }
    let payload: unknown = null;
    try { payload = e.toJson?.() ?? null; } catch { payload = null; }

    return NextResponse.json({
      ms: Date.now() - t0,
      results: [{ entityKey: e.key, owner: e.owner, attributes, payload }],
      count: 1,
      arkivQuery: `getEntity(${key})`,
    });
  } catch {
    return NextResponse.json({ error: "no entity with that key" }, { status: 404 });
  }
}
