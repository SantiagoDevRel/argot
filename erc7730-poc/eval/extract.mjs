// extract.mjs — turn a raw ERC-7730 descriptor JSON into the feature shape the metrics
// score against: { functions:[{ name, signature, intent, fields:[{path,label,format}] }] }.
// Shared by run-eval.mjs (to parse generated descriptors the SAME way corpus.mjs parsed
// the ground truth) so scoring is apples-to-apples.

function resolveField(f, defs) {
  let label = f.label;
  let format = f.format;
  if (f.$ref) {
    const key = String(f.$ref).replace("$.display.definitions.", "");
    const def = defs[key];
    if (def) {
      label = label ?? def.label;
      format = format ?? def.format;
    }
  }
  return { path: f.path ?? null, label: label ?? null, format: format ?? null };
}

function fnName(sig) {
  const m = String(sig).match(/^([A-Za-z0-9_]+)\s*\(/);
  return (m ? m[1] : String(sig)).toLowerCase();
}

export function featuresFromDescriptor(json) {
  if (!json || typeof json !== "object") return { functions: [] };
  const defs = json.display?.definitions ?? {};
  const formats = json.display?.formats ?? {};
  const functions = Object.entries(formats).map(([sig, spec]) => ({
    signature: sig,
    name: fnName(sig),
    intent: typeof spec?.intent === "string" ? spec.intent : spec?.intent?.[Object.keys(spec?.intent ?? {})[0]] ?? null,
    fields: Array.isArray(spec?.fields) ? spec.fields.map((f) => resolveField(f, defs)) : [],
  }));
  return { functions };
}
