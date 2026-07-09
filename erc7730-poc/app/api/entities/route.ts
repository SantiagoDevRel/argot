import { DB } from "@/lib/data";
import { queryDescriptors } from "@/lib/arkiv";

// GET /api/entities -> the ERC-7730 descriptor entities stored in Arkiv (live query).
// Cookie-gated by proxy.ts. Falls back to the seed set (live:false) if the testnet is
// unreachable or empty, so the Database tab always renders — honest `live` flag.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await queryDescriptors();
    if (result.rows.length > 0) return Response.json(result);
    // network reachable but no entities yet → fall back to the seed so the tab isn't blank
    return Response.json({ rows: DB, live: false, network: result.network, count: DB.length });
  } catch (e) {
    return Response.json({ rows: DB, live: false, network: "offline", count: DB.length, error: String(e).slice(0, 160) });
  }
}
