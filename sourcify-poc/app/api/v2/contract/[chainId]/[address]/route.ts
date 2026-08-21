/**
 * GET /api/v2/contract/{chainId}/{address}
 *
 * Sourcify's hottest endpoint (~70% of contract-API traffic), answered from Arkiv
 * instead of Postgres — now for the WHOLE record: all 24 `fields=all` fields,
 * including the composed ones (stdJsonInput, stdJsonOutput, signatures), assembled
 * from the normalized entities exactly the way Sourcify assembles them from its
 * normalized tables.
 *
 * Semantics mirror Sourcify's, verified against their live server:
 *   - no `fields`  -> the 7-field minimal response, one Arkiv read
 *   - `fields=all` -> everything
 *   - `fields=a,b` / dot-notation (`creationBytecode.sourceMap`) -> projection
 *   - `fields` with `omit` -> 400; unknown selector -> 400 invalid_parameter
 *
 * The read fan-out is REPORTED, not hidden: x-arkiv-reads counts the point reads
 * this response cost (median full record ≈ 8; a 100-file contract costs its file
 * count on first touch, then the content-addressed cache eats it). Anything the
 * chain could not provide (expired blob, not-yet-patched v1 payload) is named in
 * x-arkiv-unavailable while the body stays Sourcify-shaped.
 *
 * `fields=compilationEntity` is still the one addition beyond Sourcify's own API —
 * the deduplicated compilation ENTITY summary (see git history for why it is not
 * folded into `compilation`).
 */
import { NextResponse } from "next/server";
import { dereferenceCompilation, lookup } from "@/lib/arkiv";
import { ALL_FIELDS, MINIMAL, composeFields, newLedger, type FieldName } from "@/lib/full";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TOP = new Set<string>(ALL_FIELDS);

/** Split selectors into top-level fetch set + nested projection paths. */
function parseSelectors(raw: string): { top: FieldName[]; nested: Map<string, Set<string>>; bad: string[] } {
  const top = new Set<FieldName>();
  const nested = new Map<string, Set<string>>();
  const bad: string[] = [];
  for (const sel of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [head, ...rest] = sel.split(".");
    if (!TOP.has(head)) { bad.push(sel); continue; }
    top.add(head as FieldName);
    if (rest.length) {
      if (!nested.has(head)) nested.set(head, new Set());
      nested.get(head)!.add(rest.join("."));
    }
  }
  return { top: [...top], nested, bad };
}

const project = (obj: Record<string, unknown>, keep: Set<string>) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => keep.has(k)));

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

  // Resolve the projection to a top-level want-list + nested key filters.
  let want: FieldName[] = MINIMAL;
  let nested = new Map<string, Set<string>>();
  const wantsCompilationEntity = (fields ?? "").split(",").map((s) => s.trim()).includes("compilationEntity");
  if (fields === "all") {
    want = [...ALL_FIELDS];
  } else if (fields) {
    const cleaned = fields.split(",").map((s) => s.trim()).filter((s) => s !== "compilationEntity").join(",");
    const parsed = parseSelectors(cleaned);
    if (parsed.bad.length) {
      return NextResponse.json({ customCode: "invalid_parameter", message: `invalid field selector(s): ${parsed.bad.join(", ")}`, errorId: crypto.randomUUID() }, { status: 400 });
    }
    want = [...new Set([...MINIMAL, ...parsed.top])];
    nested = parsed.nested;
  } else if (omit) {
    const parsed = parseSelectors(omit);
    if (parsed.bad.length) {
      return NextResponse.json({ customCode: "invalid_parameter", message: `invalid omit selector(s): ${parsed.bad.join(", ")}`, errorId: crypto.randomUUID() }, { status: 400 });
    }
    const drop = new Set(parsed.top.filter((f) => !parsed.nested.has(f)));
    want = ALL_FIELDS.filter((f) => !drop.has(f));
  }

  try {
    const t0 = Date.now();
    const { row, wire, ms, blockNumber } = await lookup(chainId, address);
    if (!row?.payload) {
      return NextResponse.json({ error: "Contract not verified" }, { status: 404 });
    }
    const ledger = newLedger();
    ledger.reads = 1; // the lookup itself
    const body = await composeFields(row, want, ledger) as Record<string, unknown>;

    // Nested projection: keep only the requested sub-keys of a dotted selector,
    // unless the whole field was also requested bare.
    for (const [head, keys] of nested) {
      if (body[head] && typeof body[head] === "object") {
        body[head] = project(body[head] as Record<string, unknown>, keys);
      }
    }

    let compilationMs: number | null = null;
    if (wantsCompilationEntity) {
      const t1 = Date.now();
      const compilation = await dereferenceCompilation(row.attributes?.compilationref);
      compilationMs = Date.now() - t1;
      ledger.reads++;
      body.compilationEntity = summarizeCompilation(compilation);
    }

    return NextResponse.json(body, {
      headers: {
        "x-arkiv-entity-key": row.key,
        "x-arkiv-owner": row.owner,
        "x-arkiv-block": blockNumber ?? "",
        "x-arkiv-query": wire,
        "x-arkiv-ms": String(Date.now() - t0),
        "x-arkiv-reads": String(ledger.reads),
        "x-arkiv-cache-hits": String(ledger.cached),
        ...(ledger.unavailable.length ? { "x-arkiv-unavailable": ledger.unavailable.slice(0, 8).join("; ") } : {}),
        "server-timing": `arkiv;dur=${ms}` + (compilationMs !== null ? `, arkiv-compilation;dur=${compilationMs}` : ""),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "arkiv read failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
