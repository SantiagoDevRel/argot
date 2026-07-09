// Server-only Arkiv read helper. Public query (no wallet) over the shared testnet DB,
// scoped to our POC dataset. Maps descriptor entities → the DbRow shape the Database
// tab renders. Reads are cheap + public; writes happen out-of-band via scripts/arkiv-seed.mjs.
// (Imported only by the /api/entities route handler → server-only by construction.)
import { createPublicClient, http } from "@arkiv-network/sdk";
import { braga } from "@arkiv-network/sdk/chains";
import type { DbRow } from "./data";

const DATASET = "erc7730-poc";
const RPC = process.env.ARKIV_RPC_URL || "https://braga.hoodi.arkiv.network/rpc";

type Attr = { key: string; value: string | number };

function attr(attrs: Attr[], k: string): string | undefined {
  const v = attrs.find((a) => a.key === k)?.value;
  return v == null ? undefined : String(v);
}

export type EntitiesResult = { rows: DbRow[]; live: boolean; network: string; count: number };

export async function queryDescriptors(): Promise<EntitiesResult> {
  const pub = createPublicClient({ chain: braga, transport: http(RPC) });
  const res = await pub.query(`dataset = "${DATASET}" && kind = "descriptor"`, {
    includeData: { attributes: true, payload: false, metadata: false },
    resultsPerPage: 100,
  });

  const rows: DbRow[] = res.entities.map((e: { key: string; attributes?: Attr[] }) => {
    const attrs = (e.attributes ?? []) as Attr[];
    const attested = attr(attrs, "attested") === "true";
    return {
      id: e.key,
      contract: attr(attrs, "contract") ?? "—",
      addr: attr(attrs, "addrShort") ?? "—",
      chain: attr(attrs, "chain") ?? "—",
      sel: attr(attrs, "selector") ?? "—",
      fn: attr(attrs, "fn") ?? "—",
      status: attested ? "attested" : "candidate",
      att: attr(attrs, "attester") ?? null,
      conf: Number(attr(attrs, "confidence") ?? 0),
    };
  });

  // Deterministic order for a stable graph layout (Arkiv has no server-side ORDER BY).
  rows.sort((a, b) => a.contract.localeCompare(b.contract) || a.fn.localeCompare(b.fn));
  return { rows, live: true, network: "braga", count: rows.length };
}
