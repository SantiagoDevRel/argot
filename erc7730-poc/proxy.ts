import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Server-side gate (Next 16 renamed `middleware` → `proxy`). Password-only, no
// username: a cookie set by /api/gate after the code check fronts the WHOLE site,
// including the clean production domain (santiago-prod's native Vercel Auth does NOT
// protect that domain — see reference_vercel_private_static). This is the real gate;
// it also protects the DGX-touching API routes so the bearer can never be reached
// unauthenticated.
const COOKIE = "css_gate";
const FALLBACK_TOKEN = "arkiv-sourcify-poc-gate";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The gate surface + its API must stay reachable while locked.
  if (pathname === "/gate" || pathname === "/api/gate") {
    return NextResponse.next();
  }

  const token = process.env.GATE_TOKEN || FALLBACK_TOKEN;
  const authed = request.cookies.get(COOKIE)?.value === token;
  if (authed) return NextResponse.next();

  // Locked: API → 401 JSON; pages → redirect to the gate.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/gate";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals + favicon (assets must not be gated
  // or the gate page itself can't load its CSS/JS).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
