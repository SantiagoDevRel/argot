/**
 * GET /api/graph?address=0x…
 *
 * One contract as the entities that physically hold it, as a tree:
 * verified_contract → compilation → unique source files (→ blob parts if any),
 * and the bytecodes it references. This is the picture "Browse the entities"
 * cannot give one card at a time: how the pieces point at each other.
 */
import { NextResponse } from "next/server";
import { lookup } from "@/lib/arkiv";
import { buildGraph, newLedger } from "@/lib/full";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const chainId = sp.get("chainId") ?? "130";
  const address = (sp.get("address") ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: "address must be 0x + 40 hex" }, { status: 400 });
  }
  try {
    const t0 = Date.now();
    const { row, blockNumber } = await lookup(chainId, address);
    if (!row?.payload) return NextResponse.json({ error: "Contract not verified in Arkiv" }, { status: 404 });
    const ledger = newLedger();
    ledger.reads = 1;
    const graph = await buildGraph(row, ledger);
    return NextResponse.json({ chainId, address, graph, blockNumber, reads: { arkiv: ledger.reads, cacheHits: ledger.cached, unavailable: ledger.unavailable, ms: Date.now() - t0 } });
  } catch (e) {
    return NextResponse.json({ error: "arkiv read failed", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
