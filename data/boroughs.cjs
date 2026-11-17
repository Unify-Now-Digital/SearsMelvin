// Wrangler 3 (the Pages Functions compiler) cannot parse
// `import ... with { type: "json" }`. This file is the bridge:
// Node and esbuild both follow a CommonJS require of the JSON.
module.exports = require("./boroughs.json");
