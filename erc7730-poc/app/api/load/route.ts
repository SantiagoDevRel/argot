import { LOAD_STEPS } from "@/lib/data";
import { dgxConfigured, dgxFetch } from "@/lib/dgx";

// POST /api/load { code, model } -> boot the DGX model.
// The route is already cookie-gated by proxy.ts; we also re-check the code as
// defense in depth before firing any DGX work.
// DEMO mode (no DGX_URL): returns the canned boot steps the client replays.
// LIVE mode (DGX_URL set): proxies to the DGX wrapper (Cloudflare tunnel + bearer)
// which starts Ollama qwen3-coder-next and returns real progress steps.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (body?.code !== "123") {
    return Response.json({ error: "invalid access code" }, { status: 401 });
  }

  if (dgxConfigured()) {
    try {
      const res = await dgxFetch("/load", { model: "qwen3-coder-next:q4_K_M" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return Response.json({ error: `dgx wrapper ${res.status}`, detail: text.slice(0, 300) }, { status: 502 });
      }
      const data = await res.json();
      // Wrapper returns { model, steps? }. Fall back to canned steps for the animation
      // if it only signals readiness.
      return Response.json({ model: data.model ?? "qwen3-coder-next", steps: data.steps ?? LOAD_STEPS, live: true });
    } catch (e) {
      return Response.json({ error: "dgx unreachable", detail: String(e).slice(0, 200) }, { status: 502 });
    }
  }

  return Response.json({ model: "qwen3-coder-next", steps: LOAD_STEPS, live: false });
}
