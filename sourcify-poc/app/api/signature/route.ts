/**
 * GET /api/signature?selector=0xa9059cbb
 *
 * Sourcify's 4-byte service, answered from Arkiv — and, on the same request, asked of
 * Sourcify's own 4-byte service so the two answers can be put side by side.
 *
 * This is the shape the database is actually good at: one equality on an indexed
 * attribute, one round trip, a payload measured at 86 bytes median. No join, no
 * ordering, no aggregation needed — which is why it belongs in scope rather than in
 * the "separate service" pile.
 *
 * A selector is not unique: several different function texts can hash to the same four
 * bytes. The entity therefore holds the whole candidate set, and the response returns
 * all of them rather than picking one.
 *
 * On the COMPARISON being fair. Their dictionary is ~9.9M signatures consolidated from
 * openchain, 4byte.directory and etherface — every chain, verified or not. Ours is the
 * selectors of one chain's verified ABIs. So they will often know texts we do not, and
 * that is scope, not disagreement. What would be a real defect is the other direction:
 * a name we return that they do not have. The verdict below distinguishes the two.
 */
import { NextResponse } from "next/server";
import { arkiv, DATASET, PUBLISHER } from "@/lib/arkiv";
import { eq, startsWith } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/attr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Their live 4-byte API. The website at 4byte.sourcify.dev says it is the same API as
 * openchain.xyz, which is where the `?function=` / `?event=` shape comes from; verified
 * against the running service rather than taken from docs.
 */
const FOURBYTE = "https://api.4byte.sourcify.dev/signature-database/v1/lookup";

type Sourcify = {
  url: string | null;
  httpStatus: number | null;
  ms: number | null;
  names: string[] | null;
  /** Their API answers one selector at a time; there is no prefix search to call. */
  supported: boolean;
  body: unknown;
};

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const selector = (sp.get("selector") ?? "").toLowerCase().trim();
  const prefix = sp.get("prefix");

  const isFn = /^0x[0-9a-f]{8}$/.test(selector);
  const isEvent = /^0x[0-9a-f]{64}$/.test(selector);

  if (!prefix && !isFn && !isEvent) {
    return NextResponse.json(
      { error: "selector must be 0x + 8 hex (function/error) or 0x + 64 hex (event)" },
      { status: 400 },
    );
  }

  // A 4-byte value is a function OR an error selector; a 32-byte one is an event topic.
  // Their API splits those into two parameters, so pick by width.
  const sourcifyUrl = prefix ? null : `${FOURBYTE}?${isEvent ? "event" : "function"}=${selector}`;

  const t0 = Date.now();

  const askSourcify = async (): Promise<Sourcify> => {
    if (!sourcifyUrl) {
      return { url: null, httpStatus: null, ms: null, names: null, supported: false, body: null };
    }
    const t = Date.now();
    try {
      const r = await fetch(sourcifyUrl, { headers: { accept: "application/json" }, cache: "no-store" });
      const body = r.ok ? await r.json() : null;
      // { ok, result: { function: { "0x…": [{ name, … }] }, event: { … } } }
      const bucket = (body as { result?: Record<string, Record<string, { name?: string }[]>> })
        ?.result?.[isEvent ? "event" : "function"]?.[selector];
      const names = Array.isArray(bucket)
        ? bucket.map((c) => c?.name).filter((n): n is string => typeof n === "string")
        : null;
      return { url: sourcifyUrl, httpStatus: r.status, ms: Date.now() - t, names, supported: true, body };
    } catch {
      return { url: sourcifyUrl, httpStatus: null, ms: Date.now() - t, names: null, supported: true, body: null };
    }
  };

  const askArkiv = async () => {
    let q = arkiv
      .select({ key: true, owner: true, attributes: true, payload: true })
      .where(
        eq("ds", str(DATASET)),
        eq("kind", str("signature")),
        prefix ? startsWith("selector", prefix.toLowerCase()) : eq("selector", str(selector)),
      )
      .limit(prefix ? 50 : 5);
    if (PUBLISHER) q = q.ownedBy(PUBLISHER as `0x${string}`);
    const wire = q.toString();
    const t = Date.now();
    const res = await q.fetch();
    return { wire, res, ms: Date.now() - t };
  };

  try {
    const [sourcify, a] = await Promise.all([askSourcify(), askArkiv()]);

    const results: Record<string, unknown>[] = a.res.entities.map((e) => {
      let payload: Record<string, unknown> | null = null;
      try { payload = e.toJson?.() ?? null; } catch { payload = null; }
      return { entityKey: e.key, ...payload };
    });

    const arkivNames = [
      ...new Set(results.flatMap((r) => (Array.isArray(r.signatures) ? (r.signatures as string[]) : []))),
    ];
    const theirs = sourcify.names ?? [];
    const onlyArkiv = arkivNames.filter((n) => !theirs.includes(n));
    const onlySourcify = theirs.filter((n) => !arkivNames.includes(n));
    const shared = arkivNames.filter((n) => theirs.includes(n));

    const verdict =
      !sourcify.supported ? "no_sourcify_equivalent"
      : sourcify.names == null ? "sourcify_unreachable"
      : arkivNames.length === 0 ? "not_in_our_slice"
      : onlyArkiv.length > 0 ? "we_know_something_they_do_not"
      : onlySourcify.length > 0 ? "same_plus_their_wider_dictionary"
      : "identical";

    return NextResponse.json({
      selector: prefix ? null : selector,
      count: results.length,
      ms: a.ms,
      blockNumber: a.res.blockNumber?.toString() ?? null,
      arkivQuery: a.wire,
      results,
      sourcify,
      comparison: { arkivNames, sourcifyNames: sourcify.names, shared, onlyArkiv, onlySourcify, verdict },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "arkiv query failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
