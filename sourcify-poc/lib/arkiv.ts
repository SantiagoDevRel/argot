/**
 * The Arkiv read path. Everything the POC serves comes through here.
 *
 * Two things this file is careful about:
 *  - The API key never leaves the server. Cheesecake meters anonymous callers at
 *    50 requests/hour, which a single page-load would burn, so the browser talks
 *    to our routes and our routes talk to Arkiv.
 *  - Ordering is done in JavaScript. The SDK marks server-side orderBy deprecated
 *    ("not supported by the network"), so anything that looks sorted was sorted here.
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { cheesecake } from "@arkiv-network/sdk/chains";
import { eq, gte, lte, startsWith, MAX_LIMIT } from "@arkiv-network/sdk/query";
// Typed attributes match on TYPE as well as value: a bare bigint is inferred as u256,
// so `eq("chainid", 130n)` silently misses a chainid written as u64 and the query just
// returns nothing. The constructors here must mirror the writer's exactly.
import { addr, i32, str, u64 } from "@arkiv-network/sdk/attr";
import type { Expression } from "@arkiv-network/sdk/query";
import { http } from "viem";

export const RPC = process.env.ARKIV_RPC ?? "https://rpc.cheesecake.db-chain.devnet.gobas.me";
export const DATASET = "sourcify";
/** Only entities written by this address are trusted as Sourcify data. */
export const PUBLISHER = (process.env.ARKIV_PUBLISHER ?? "").toLowerCase();

const apiKey = process.env.ARKIV_API_KEY;
export const arkiv = createPublicClient({
  chain: cheesecake,
  // retryCount 0: on a 429 the Bouncer answers with `Retry-After` of up to an hour
  // and viem's default retry HONORS it — the function then sits silent until
  // Vercel's 60 s timeout. Failing fast turns that into a readable 502 instead.
  transport: http(RPC, {
    retryCount: 0,
    timeout: 15_000,
    ...(apiKey ? { fetchOptions: { headers: { "X-Api-Key": apiKey } } } : {}),
  }),
});

export const SELECT = { key: true, owner: true, attributes: true, payload: true } as const;

export type Filters = {
  chainId?: string; address?: string; match?: string; compiler?: string;
  compilerVersion?: string; language?: string; isProxy?: string;
  minFns?: string; maxFns?: string; optimizer?: string; namePrefix?: string;
  verifiedAfter?: string; deployer?: string; hash?: string;
  abiHash?: string; runtimeCodeHash?: string; creationCodeHash?: string;
};

/** Translate the UI's filter bag into an Arkiv predicate. Unset fields are simply absent. */
export function buildPredicate(f: Filters, kind = "verified_contract") {
  const p: Expression[] = [eq("ds", str(DATASET)), eq("kind", str(kind))];
  if (f.chainId) p.push(eq("chainid", u64(BigInt(f.chainId))));
  if (f.address) p.push(eq("address", addr(f.address.toLowerCase() as `0x${string}`)));
  if (f.match) p.push(eq("match", str(f.match)));
  if (f.compiler) p.push(eq("compiler", str(f.compiler)));
  if (f.compilerVersion) p.push(startsWith("compilerversion", f.compilerVersion));
  if (f.language) p.push(eq("language", str(f.language)));
  if (f.isProxy) p.push(eq("isproxy", f.isProxy === "true"));
  if (f.optimizer) p.push(eq("optimizer", f.optimizer === "true"));
  if (f.namePrefix) p.push(startsWith("name", f.namePrefix));
  if (f.deployer) p.push(eq("deployer", addr(f.deployer.toLowerCase() as `0x${string}`)));
  // content-addressed lanes (sourcefile / code / blob) are found by this, never by key
  if (f.hash) p.push(eq("hash", str(f.hash)));
  if (f.abiHash) p.push(eq("abihash", str(f.abiHash)));
  if (f.runtimeCodeHash) p.push(eq("runtimecodehash", str(f.runtimeCodeHash)));
  if (f.creationCodeHash) p.push(eq("creationcodehash", str(f.creationCodeHash)));
  if (f.minFns) p.push(gte("fncount", i32(Number(f.minFns))));
  if (f.maxFns) p.push(lte("fncount", i32(Number(f.maxFns))));
  if (f.verifiedAfter) p.push(gte("verifiedat", u64(BigInt(Math.floor(new Date(f.verifiedAfter).getTime() / 1000)))));
  // `where()` is variadic, so a flat list of predicates is the whole conjunction.
  return p;
}

export type Row = {
  key: string; owner: string;
  attributes: Record<string, unknown>;
  payload: Record<string, unknown> | null;
};

function toRow(e: any): Row {
  let payload: Record<string, unknown> | null = null;
  try { payload = e.toJson?.() ?? null; } catch {
    // Not JSON — the code and blob lanes store RAW bytes (application/octet-stream).
    // Surface what it is instead of a null that reads like "empty".
    const bytes: Uint8Array | undefined = e.payload;
    payload = bytes?.length
      ? { $binary: { bytes: bytes.length, head: "0x" + Buffer.from(bytes.slice(0, 32)).toString("hex") + (bytes.length > 32 ? "…" : "") } }
      : null;
  }
  return { key: e.key, owner: e.owner, attributes: normalise(e.attributes ?? {}), payload };
}

/** Attribute values arrive tagged. Flatten to plain JSON so the UI and JSON.stringify behave. */
function normalise(a: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    const raw = v && typeof v === "object" && "value" in (v as any) ? (v as any).value : v;
    out[k] = typeof raw === "bigint" ? raw.toString() : raw;
  }
  return out;
}

export async function query(f: Filters, limit = 50, kind = "verified_contract") {
  const t0 = Date.now();
  let q = arkiv.select(SELECT).where(buildPredicate(f, kind)).limit(Math.min(limit, MAX_LIMIT));
  if (PUBLISHER) q = q.ownedBy(PUBLISHER as `0x${string}`);
  // The literal query the network receives. Shown in the UI so nothing is hand-waved.
  const wire = q.toString();
  const res = await q.fetch();
  const rows = res.entities.map(toRow);
  // Sorted here, not by the network — see the note at the top of this file.
  rows.sort((a, b) => Number(b.attributes.verifiedat ?? 0) - Number(a.attributes.verifiedat ?? 0));
  return { rows, wire, ms: Date.now() - t0, blockNumber: res.blockNumber?.toString() ?? null, truncated: rows.length >= limit };
}

/** The hot path: one contract, the way Sourcify's `GET /v2/contract/{chain}/{address}` answers. */
export async function lookup(chainId: string, address: string) {
  const { rows, wire, ms, blockNumber } = await query({ chainId, address }, 1);
  return { row: rows[0] ?? null, wire, ms, blockNumber };
}

/**
 * Follows a verified_contract's `compilationref` -- a typed `key` attribute written
 * in 3-write.mjs (phase B) that points straight at its compilation entity -- rather
 * than re-deriving the join with a second query. `getEntity` is the SDK's direct
 * by-key read (see lib/arkiv.ts's sibling `query()`, which uses `select().where()`
 * for everything that is NOT a known key); a `key` attribute's value IS an entity
 * key, so that is the right tool here, not another predicate query.
 *
 * Returns null rather than throwing when the ref is missing, dangling (the linked
 * entity expired or the key is malformed), or -- the same authenticity check `query()`
 * applies via `.ownedBy()` -- not owned by the trusted publisher. A raw `key` attribute
 * has no owner filter built in, so that check has to happen here, after the fetch.
 */
export async function dereferenceCompilation(compilationKey: unknown): Promise<Row["payload"] | null> {
  if (typeof compilationKey !== "string" || !compilationKey) return null;
  let entity;
  try {
    entity = await arkiv.getEntity(compilationKey as `0x${string}`);
  } catch {
    return null;
  }
  if (PUBLISHER && entity.owner?.toLowerCase() !== PUBLISHER) return null;
  return toRow(entity).payload;
}
