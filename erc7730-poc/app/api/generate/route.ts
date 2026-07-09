import { JSON_TEXT, CONFIDENCE, INPUT_CHIPS } from "@/lib/data";
import { dgxConfigured, dgxFetch } from "@/lib/dgx";

// POST /api/generate { chainId, address } -> candidate ERC-7730 descriptor.
// Cookie-gated by proxy.ts. The descriptor is ALWAYS a candidate: status=candidate,
// attested=false — authorship stays with the dApp; nothing is auto-submitted.
//
// DEMO mode (no DGX_URL): returns the seed descriptor + confidence + resolved inputs.
// LIVE mode (DGX_URL set): the DGX wrapper fetches Sourcify v2 inputs -> qwen3-coder-next
// (schema-constrained) -> `erc7730 lint` gate -> returns the draft. Token decimals are
// resolved deterministically on-chain by the wrapper (eth_call), never model-inferred.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const address: string = body?.address ?? "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
  const chainId: string = String(body?.chainId ?? "1");

  if (dgxConfigured()) {
    try {
      const res = await dgxFetch("/generate", { chainId, address });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return Response.json({ error: `dgx wrapper ${res.status}`, detail: text.slice(0, 300) }, { status: 502 });
      }
      const data = await res.json();
      return Response.json({
        chainId,
        address,
        inputs: data.inputs ?? INPUT_CHIPS.map((c) => ({ id: c.id, title: c.title, sub: c.sub, enrichment: !!c.enrichment })),
        descriptor: data.descriptor,
        confidence: data.confidence ?? [],
        lintPassed: data.lintPassed ?? false,
        status: "candidate",
        attested: false,
        generatedBy: data.generatedBy ?? "qwen3-coder-next",
        live: true,
      });
    } catch (e) {
      return Response.json({ error: "dgx unreachable", detail: String(e).slice(0, 200) }, { status: 502 });
    }
  }

  return Response.json({
    chainId,
    address,
    inputs: INPUT_CHIPS.map((c) => ({ id: c.id, title: c.title, sub: c.sub, enrichment: !!c.enrichment })),
    descriptor: JSON_TEXT,
    confidence: CONFIDENCE,
    lintPassed: true,
    status: "candidate",
    attested: false,
    generatedBy: "qwen3-coder-next",
    live: false,
  });
}
