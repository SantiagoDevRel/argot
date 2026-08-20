/**
 * Server-side gate. The page is rendered only after the cookie is verified here,
 * so nothing gated ever reaches the bundle — a JS prompt over a static page is
 * theatre, since "view source" defeats it.
 *
 * Fail-closed: a missing GATE_TOKEN locks everyone out rather than letting
 * everyone in.
 */
import { NextRequest, NextResponse } from "next/server";

const COOKIE = "sx_gate";
// No fallback. A default of "123" meant a deploy that forgot GATE_PASSWORD opened to
// anyone who guessed the most obvious string in the world, and it would look like a
// working gate the whole time. Missing config now locks the door rather than propping
// it open — same fail-closed rule GATE_TOKEN already follows below.
const PASSWORD = process.env.GATE_PASSWORD;

export function proxy(req: NextRequest) {
  const token = process.env.GATE_TOKEN;
  const { pathname, searchParams } = req.nextUrl;

  if (pathname === "/gate") return NextResponse.next();

  if (!token || !PASSWORD) {
    return new NextResponse("Gate misconfigured: GATE_TOKEN or GATE_PASSWORD is not set.", {
      status: 503, headers: { "content-type": "text/plain" },
    });
  }
  if (req.cookies.get(COOKIE)?.value === token) return NextResponse.next();

  // One-shot unlock: /?pw=123 sets the cookie and drops the query string.
  if (searchParams.get("pw") === PASSWORD) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("pw");
    const res = NextResponse.redirect(url);
    res.cookies.set(COOKIE, token, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 12,
    });
    return res;
  }

  const wantsJson = pathname.startsWith("/api/");
  return wantsJson
    ? NextResponse.json({ error: "locked" }, { status: 401 })
    : new NextResponse(GATE_HTML, { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
}

export const config = {
  // `_next/` is deliberately NOT excluded. Excluding it served the client bundle —
  // and every line of copy compiled into it — to anyone without the cookie, while the
  // page HTML and the APIs were correctly gated. A static asset is served before any
  // rewrite, which is exactly the trap. Post-auth requests carry the cookie, so the
  // app still loads; the 401 page is self-contained inline HTML and needs no assets.
  matcher: ["/((?!__nextjs|favicon.ico|robots.txt).*)"],
};

const GATE_HTML = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Locked</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0b0f;color:#e8eaf0;
font:15px/1.6 "IBM Plex Mono",ui-monospace,Menlo,monospace}
form{width:min(320px,90vw)}
.e{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#FE7446;margin-bottom:10px}
h1{font-size:19px;margin:0 0 18px;font-weight:600}
input,button{width:100%;padding:10px 12px;font:inherit;border-radius:6px;border:1px solid #282c38;
background:#13151c;color:#e8eaf0;box-sizing:border-box}
button{margin-top:10px;background:#181EA9;border-color:#4c53f0;cursor:pointer;font-weight:600}
</style>
<form method="GET"><div class="e">[ ARKIV ] &times; Sourcify</div>
<h1>Internal &mdash; enter the code</h1>
<input name="pw" type="password" autofocus autocomplete="current-password" placeholder="code">
<button>Unlock</button></form>`;
