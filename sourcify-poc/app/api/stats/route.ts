/** GET /api/stats — what is actually in Arkiv right now, counted by querying it. */
import { NextResponse } from "next/server";
import { arkiv, DATASET, PUBLISHER } from "@/lib/arkiv";
import { eq } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/attr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [entityCount, head] = await Promise.all([
      arkiv.request({ method: "arkiv_getEntityCount" } as never) as Promise<number>,
      arkiv.getBlockNumber(),
    ]);
    // Walk every page rather than trusting one page's length.
    let contracts = 0;
    for await (const _e of arkiv.select({ key: true }).where(eq("ds", str(DATASET)), eq("kind", str("verified_contract")))) contracts++;
    let compilations = 0;
    for await (const _e of arkiv.select({ key: true }).where(eq("ds", str(DATASET)), eq("kind", str("compilation")))) compilations++;
    return NextResponse.json({
      chainHeadBlock: head.toString(),
      entitiesOnChain: entityCount,
      sourcifyContracts: contracts,
      sourcifyCompilations: compilations,
      publisher: PUBLISHER || null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
