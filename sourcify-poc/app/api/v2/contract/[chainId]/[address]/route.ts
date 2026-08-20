/**
 * GET /api/v2/contract/{chainId}/{address}
 *
 * Sourcify's hottest endpoint (~70% of contract-API traffic), answered from Arkiv
 * instead of Postgres. The response shape is Sourcify v2's, including the `fields`
 * projection, because the whole point is that a caller cannot tell the difference.
 *
 * `fields` is applied HERE rather than by the database: Arkiv returns a whole
 * payload, so projection is the adapter's job. That is a real difference from
 * Postgres and it is stated rather than hidden.
 *
 * `fields=compilationEntity` is the one addition Sourcify's own API does not have:
 * it follows verified_contract's `compilationref` -- a typed `key` attribute written
 * in 3-write.mjs, the join the write path already builds -- to the linked compilation
 * entity, and returns a summary of it. Strictly opt-in (a second Arkiv read costs
 * time and, on the anonymous tier, part of a 50/hour budget), so it has to be asked
 * for by name; it does not ride along on `fields=all`.
 */
import { NextResponse } from "next/server";
import { dereferenceCompilation, lookup } from "@/lib/arkiv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sourcify's minimal record: what you get when you pass no `fields`. */
const MINIMAL = ["match", "creationMatch", "runtimeMatch", "chainId", "address", "verifiedAt", "matchId"];

function project(payload: Record<string, unknown>, fields?: string | null, omit?: string | null) {
  if (fields === "all") return payload;
  if (omit) {
    const drop = new Set(omit.split(",").map((s) => s.trim()));
    return Object.fromEntries(Object.entries(payload).filter(([k]) => !drop.has(k)));
  }
  const want = new Set([...MINIMAL, ...(fields ? fields.split(",").map((s) => s.trim()) : [])]);
  return Object.fromEntries(Object.entries(payload).filter(([k]) => want.has(k)));
}

/**
 * `fields=compilationEntity` is NOT one of the verified_contract payload's own keys --
 * it is a second Arkiv read, following the `compilationref` typed `key` attribute the
 * writer already sets (3-write.mjs phase B) to the compilation entity it points at.
 * Deliberately its own field name and not folded into the existing `compilation` key:
 * the payload already carries a `compilation` object (Sourcify's own compiler-settings
 * echo, embedded at write time), and that is a different thing from the deduplicated
 * compilation ENTITY this dereferences -- conflating the two would silently change what
 * `fields=compilation` has always returned.
 *
 * Summarized, not the raw entity payload: since the per-file sourcefile work landed,
 * the compilation entity's payload carries a `sources` path -> hash map that can run to
 * dozens of entries, which is more than a caller asking "what compiled this" wants by
 * default. The full compilation payload (including that map) is still one `getEntity`
 * call away for anyone who needs it -- this just isn't it.
 */
function summarizeCompilation(payload: Record<string, unknown> | null) {
  if (!payload) return null;
  const settings = (payload.compilerSettings ?? {}) as Record<string, unknown>;
  const optimizer = (settings.optimizer ?? {}) as Record<string, unknown>;
  return {
    compiler: payload.compiler ?? null,
    compilerVersion: payload.compilerVersion ?? null,
    language: payload.language ?? null,
    name: payload.name ?? null,
    fullyQualifiedName: payload.fullyQualifiedName ?? null,
    evmVersion: settings.evmVersion ?? "default",
    optimizer: Boolean(optimizer.enabled),
    optimizerRuns: optimizer.runs ?? 0,
    sourceFileCount: Object.keys((payload.sources as Record<string, unknown>) ?? {}).length,
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ chainId: string; address: string }> },
) {
  const { chainId, address } = await ctx.params;
  const url = new URL(req.url);
  const fields = url.searchParams.get("fields");
  const omit = url.searchParams.get("omit");
  if (fields && omit) {
    return NextResponse.json({ error: "fields and omit are mutually exclusive" }, { status: 400 });
  }

  try {
    const { row, wire, ms, blockNumber } = await lookup(chainId, address);
    if (!row?.payload) {
      return NextResponse.json({ error: "Contract not verified" }, { status: 404 });
    }
    const body = project(row.payload as Record<string, unknown>, fields, omit) as Record<string, unknown>;

    // Opt-in second hop: only fires when asked, so the default response shape and
    // its one-query timing are unchanged. `wire` above is the verified_contract
    // query; this is a second, separate read, timed and reported separately.
    const wantsCompilation = (fields ?? "").split(",").map((s) => s.trim()).includes("compilationEntity");
    let compilationMs: number | null = null;
    if (wantsCompilation) {
      const t0 = Date.now();
      const compilation = await dereferenceCompilation(row.attributes?.compilationref);
      compilationMs = Date.now() - t0;
      body.compilationEntity = summarizeCompilation(compilation);
    }

    return NextResponse.json(body, {
      headers: {
        // Provenance, so a reviewer can check the claim rather than take it.
        "x-arkiv-entity-key": row.key,
        "x-arkiv-owner": row.owner,
        "x-arkiv-block": blockNumber ?? "",
        "x-arkiv-query": wire,
        "x-arkiv-ms": String(ms),
        "server-timing": `arkiv;dur=${ms}` + (compilationMs !== null ? `, arkiv-compilation;dur=${compilationMs}` : ""),
        ...(compilationMs !== null ? { "x-arkiv-compilation-ms": String(compilationMs) } : {}),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "arkiv read failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
