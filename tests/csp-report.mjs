import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { onRequestGet, onRequestPost } from "../functions/api/csp-report.js";

const headers = readFileSync(new URL("../_headers", import.meta.url), "utf8");
const reportOnly = headers.match(/^  Content-Security-Policy-Report-Only: (.+)$/m)?.[1] || "";

assert.ok(reportOnly.includes("report-to csp-endpoint"));
assert.ok(reportOnly.includes("report-uri /api/csp-report"));
assert.ok(headers.includes('Reporting-Endpoints: csp-endpoint="/api/csp-report"'));
assert.equal(/^  Content-Security-Policy:.*report-to/m.test(headers), false);

const originalLog = console.log;
let logged = "";
console.log = (value) => { logged = value; };
try {
  const response = await onRequestPost({
    request: new Request("https://searsmelvin.co.uk/api/csp-report", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: JSON.stringify({
        "csp-report": {
          "blocked-uri": "https://blocked.example/script.js",
          "violated-directive": "script-src-elem",
          "document-uri": "https://searsmelvin.co.uk/memorials?gclid=private",
        },
      }),
    }),
  });
  assert.equal(response.status, 204);
  assert.equal(logged.includes("gclid"), false);
  assert.equal(JSON.parse(logged).csp[0].document, "/memorials");
} finally {
  console.log = originalLog;
}

assert.equal((await onRequestGet({ request: new Request("https://searsmelvin.co.uk/api/csp-report") })).status, 405);

console.log("csp report checks passed");
