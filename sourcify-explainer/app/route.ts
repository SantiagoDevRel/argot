/**
 * The explainer is authored as one self-contained HTML file so it survives being
 * opened offline in a meeting room. Next serves it verbatim; the only reason this
 * is an app at all rather than a static file is the gate in proxy.ts, and a gate
 * that runs in the browser is not a gate.
 */
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
// force-DYNAMIC, deliberately. With force-static Next prerendered this route and
// Vercel served it straight from the CDN (`X-Vercel-Cache: HIT`), which skipped the
// proxy entirely and left the page ungated on the public domain. A gate that a cache
// can step over is not a gate.
export const dynamic = "force-dynamic";

export async function GET() {
  const html = fs.readFileSync(path.join(process.cwd(), "content", "index.html"), "utf8");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Never let a shared cache hold gated content.
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
