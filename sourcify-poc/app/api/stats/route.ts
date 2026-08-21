/**
 * GET /api/stats
 *
 * Two cheap live facts from the chain, and the per-type counts from the writer.
 *
 * The counts are NOT computed live, and that is the point rather than a shortcut.
 * Arkiv has no COUNT, so "how many verified contracts are there?" can only be
 * answered by walking every page of matches at 200 per page. For our ~16,600
 * entities that is about 85 round trips against a metered public RPC; the first
 * version of this route did exactly that and hit Vercel's 60-second function
 * timeout. At Sourcify's real 44.4M records the same question is ~222,000
 * requests.
 *
 * So the counts come from the writer, which knew them exactly, and the response
 * says so. Sourcify does not compute their stats page live either — they keep a
 * materialised view — which is the honest shape of the ask: aggregation belongs in
 * an indexer beside the network, not in the query path.
 */
import { NextResponse } from "next/server";
import { arkiv, PUBLISHER } from "@/lib/arkiv";
import counts from "@/kb/counts.json";
import progress from "@/kb/progress.json";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const PAGE = 200;

export async function GET() {
  let chainHeadBlock: string | null = null;
  let entitiesOnChain: number | null = null;

  // Two requests, not ninety.
  try {
    chainHeadBlock = (await arkiv.getBlockNumber()).toString();
  } catch { /* leave null; the page shows a dash */ }
  try {
    entitiesOnChain = (await arkiv.request({ method: "arkiv_getEntityCount" } as never)) as number;
  } catch { /* the same */ }

  const total = counts.verified_contract + counts.compilation + counts.signature;

  return NextResponse.json({
    chainHeadBlock,
    entitiesOnChain,
    sourcifyContracts: counts.verified_contract,
    sourcifyCompilations: counts.compilation,
    sourcifySignatures: counts.signature,
    transactions: counts.transactions,
    writtenAt: counts.writtenAt,
    publisher: PUBLISHER || counts.publisher,
    countsAreLive: false,
    // The 100% pass, as of the last deploy — see etl/progress.mjs.
    v2: progress,
    // What asking the chain for these same numbers would cost.
    countCostRoundTrips: Math.ceil(total / PAGE) + 3,
    countCostAtSourcifyScale: Math.ceil(44_391_604 / PAGE),
  });
}
