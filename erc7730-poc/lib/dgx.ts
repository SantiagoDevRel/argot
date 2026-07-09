// Server-only helper to reach the DGX wrapper (Cloudflare tunnel + bearer).
// The bearer and URL live ONLY in server env (Vercel), never in the client bundle.
//
//   DGX_URL     e.g. https://arkiv-dgx.santiagodevrel.dev   (the wrapper base)
//   DGX_BEARER  the shared secret the wrapper checks
//
// When DGX_URL is unset the app runs in DEMO mode (mock endpoints) — flipping to live
// is purely an env change + redeploy, no code change. The endpoint contract is identical.

export function dgxConfigured(): boolean {
  return !!process.env.DGX_URL;
}

export async function dgxFetch(path: string, body: unknown, timeoutMs = 120_000) {
  const base = process.env.DGX_URL!;
  const bearer = process.env.DGX_BEARER ?? "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(base.replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}
