// src-extract.mjs — pull the RELEVANT slice of verified Solidity source for the model:
// the bodies of the state-changing functions (+ struct/enum defs). NOT the whole source
// (big routers blow the model's context). Gives the model real logic to ground the intent
// when NatSpec is sparse. Heuristic (regex + brace-balance), capped — good enough to test
// whether source context lifts intent quality; not a full Solidity parser.
export function extractRelevantSource(sources, abi) {
  try {
    const src = Object.values(sources || {})
      .map((f) => (typeof f === "string" ? f : (f && f.content) || ""))
      .join("\n\n");
    if (!src) return "";
    const changing = new Set(
      (abi || [])
        .filter((x) => x.type === "function" && x.stateMutability !== "view" && x.stateMutability !== "pure")
        .map((x) => x.name)
        .filter(Boolean)
    );
    const out = [];
    const seen = new Set();
    // struct/enum defs (clarify tuple/array params) — non-nested braces only, good enough
    let m;
    const typeRe = /\b(struct|enum)\s+(\w+)\s*\{[^{}]*\}/g;
    while ((m = typeRe.exec(src))) {
      const k = m[1] + m[2];
      if (!seen.has(k)) { seen.add(k); out.push(m[0]); }
    }
    // first concrete body of each state-changing function (brace-balanced)
    for (const name of changing) {
      const re = new RegExp("function\\s+" + name.replace(/[^A-Za-z0-9_]/g, "") + "\\s*\\(", "g");
      let fm;
      while ((fm = re.exec(src))) {
        const i = src.indexOf("{", fm.index);
        const semi = src.indexOf(";", fm.index);
        if (i < 0 || (semi >= 0 && semi < i)) { // interface/abstract decl (no body)
          if (semi > 0) out.push(src.slice(fm.index, semi + 1));
          break;
        }
        let depth = 0, j = i;
        for (; j < src.length; j++) {
          if (src[j] === "{") depth++;
          else if (src[j] === "}") { depth--; if (depth === 0) { j++; break; } }
        }
        const body = src.slice(fm.index, j);
        if (body.length < 4000) out.push(body); // skip pathological huge bodies
        break;
      }
    }
    return out.join("\n\n").slice(0, 12000);
  } catch {
    return "";
  }
}
