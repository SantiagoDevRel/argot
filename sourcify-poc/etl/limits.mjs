import * as attr from "@arkiv-network/sdk/attr";
import * as q from "@arkiv-network/sdk/query";
import * as utils from "@arkiv-network/sdk/utils";
const show = (o, label) => {
  console.log(`\n--- ${label} ---`);
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (typeof v === "number" || typeof v === "bigint") console.log(`  ${k} = ${v.toLocaleString("en-US")}`);
  }
  console.log("  fns:", Object.keys(o).filter(k => typeof o[k] === "function").join(", "));
};
show(attr, "@arkiv-network/sdk/attr");
show(q, "@arkiv-network/sdk/query");
show(utils, "@arkiv-network/sdk/utils");
