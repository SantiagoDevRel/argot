/**
 * GET /api/record?address=0x…
 *
 * The whole-record VIEW: every fields=all field of one contract, composed from
 * Arkiv entities, plus what the Sourcify-shaped route cannot carry in its body —
 * per-field PROVENANCE (which entities built each field, with keys, hashes and
 * byte sizes), the read ledger, and the URLs on both sides so every datum is one
 * click from where it came from.
 */
import { NextResponse } from "next/server";
import { lookup } from "@/lib/arkiv";
import { ALL_FIELDS, composeFields, newLedger } from "@/lib/full";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCIFY = "https://sourcify.dev/server/v2";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const chainId = sp.get("chainId") ?? "130";
  const address = (sp.get("address") ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: "address must be 0x + 40 hex" }, { status: 400 });
  }
  try {
    const t0 = Date.now();
    const { row, wire, ms, blockNumber } = await lookup(chainId, address);
    if (!row?.payload) return NextResponse.json({ error: "Contract not verified in Arkiv" }, { status: 404 });
    const ledger = newLedger();
    ledger.reads = 1;
    const record = await composeFields(row, [...ALL_FIELDS], ledger);
    const sizes = Object.fromEntries(Object.entries(record).map(([k, v]) => [k, v == null ? 0 : Buffer.byteLength(JSON.stringify(v))]));
    const links = Object.fromEntries(ALL_FIELDS.map((f) => [f, {
      sourcify: `${SOURCIFY}/contract/${chainId}/${address}?fields=${f}`,
      arkiv: `/api/v2/contract/${chainId}/${address}?fields=${f}`,
    }]));
    return NextResponse.json({
      chainId, address,
      record, sizes, links,
      provenance: ledger.prov,
      reads: { arkiv: ledger.reads, cacheHits: ledger.cached, unavailable: ledger.unavailable, ms: Date.now() - t0, lookupMs: ms },
      entity: { key: row.key, owner: row.owner, blockNumber, query: wire },
      sourcifyRepo: `https://repo.sourcify.dev/${chainId}/${address}`,
      sourcifyAll: `${SOURCIFY}/contract/${chainId}/${address}?fields=all`,
    });
  } catch (e) {
    return NextResponse.json({ error: "arkiv read failed", detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
