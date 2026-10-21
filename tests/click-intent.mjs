import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { onRequestPost } from "../functions/api/click-intent.js";

const require = createRequire(import.meta.url);
const { clickIntentBody } = require("../site-upgrades.js");

assert.equal(clickIntentBody("chat", {}, {}, 1, "/contact"), null);
assert.equal(clickIntentBody("email", { gclid: "click-1" }, {}, 1, "/contact"), null);
assert.deepEqual(
  clickIntentBody("call", { gclid: "click-1", landing_page: "/quote?x=1" }, { email: "x@example.com", phone: "020 123" }, 123, "/contact?x=1"),
  { kind: "call", gclid: "click-1", landing_page: "/quote", page: "/contact", ts: 123 },
);
assert.deepEqual(
  clickIntentBody("chat", { wbraid: "wide.1" }, { contact: { email: "  PERSON@Example.COM  ", phone: "+44 (0)20 1234-5678" } }, 456, "/"),
  { kind: "chat", wbraid: "wide.1", page: "/", ts: 456, email: "person@example.com", phone: "+4402012345678" },
);

const env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "service-secret", SM_ORG_ID: "11111111-1111-1111-1111-111111111111" };
function request(body, headers = {}) {
  return new Request("https://searsmelvin.co.uk/api/click-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://searsmelvin.co.uk", ...headers },
    body: JSON.stringify(body),
  });
}

const originalFetch = globalThis.fetch;
const originalError = console.error;
try {
  let calls = [];
  let logs = [];
  globalThis.fetch = async (...args) => { calls.push(args); return new Response(null, { status: 500 }); };
  console.error = (...args) => logs.push(args.join(" "));

  const forbidden = await onRequestPost({ request: request({ kind: "call", gclid: "x" }, { Origin: "https://evil.example" }), env });
  assert.equal(forbidden.status, 403);

  const ignored = await onRequestPost({ request: request({ kind: "call" }), env });
  assert.equal(ignored.status, 204);
  assert.equal(calls.length, 0, "no click ID must not call Supabase");

  const accepted = await onRequestPost({ request: request({ kind: "chat", gclid: "click-secret", email: " Person@Example.com ", phone: "+44 (0)20 1234", page: "/contact?bad=1" }, { "User-Agent": "test-agent" }), env });
  assert.equal(accepted.status, 204);
  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /\/rest\/v1\/click_intents$/);
  const row = JSON.parse(calls[0][1].body);
  assert.equal(row.email, "person@example.com");
  assert.equal(row.phone, "+440201234");
  assert.equal(row.page, "/contact");
  const logText = logs.join(" ");
  assert.match(logText, /click_intent_insert_failed/);
  for (const secret of ["click-secret", "service-secret", "person@example.com", "+440201234"]) {
    assert.doesNotMatch(logText, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "failure logs must redact click IDs, credentials, and PII");
  }
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalError;
}

const hookFiles = execSync("git grep -l 'function chatSubmitted' -- '*.html'").toString().trim().split("\n").filter(Boolean);
assert.ok(hookFiles.length > 0);
for (const file of hookFiles) {
  const html = readFileSync(file, "utf8");
  const hook = html.slice(html.indexOf("function chatSubmitted"), html.indexOf("function hookChat"));
  assert.match(hook, /SMUpgrades\.clickIntent\('chat'/, `${file}: chat intent missing`);
  assert.equal((hook.match(/event: 'sm_chat_submit'/g) || []).length, 1, `${file}: sm_chat_submit must remain exactly once`);
}

console.log("click-intent: ok");
