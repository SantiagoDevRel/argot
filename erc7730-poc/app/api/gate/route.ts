import { NextResponse } from "next/server";

// POST /api/gate { code } -> validates the access code and sets an httpOnly cookie.
// Password-only (no username). The cookie value is a server-only token; presence of a
// valid cookie is what proxy.ts checks to unlock the site + the DGX-touching routes.
const COOKIE = "css_gate";
const FALLBACK_TOKEN = "arkiv-sourcify-poc-gate";
const CODE = "123";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (body?.code !== CODE) {
    return NextResponse.json({ error: "invalid access code" }, { status: 401 });
  }
  const token = process.env.GATE_TOKEN || FALLBACK_TOKEN;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}
