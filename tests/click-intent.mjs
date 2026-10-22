import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { onRequestPost } from "../functions/api/click-intent.js";

const require = createRequire(import.meta.url);
const { clickIntentBody } = require("../site-upgrades.js");

assert.equal(clickIntentBody("chat", {}, {}, 1, "/contact"), null);
assert.deepEqual(clickIntentBody("call", {}, {}, 2, "/contact"), { kind: "call", page: "/contact", ts: 2 });
assert.deepEqual(clickIntentBody("chat", { utm_source: "newsletter" }, {}, 3, "/contact"), { kind: "chat", utm_source: "newsletter", page: "/contact", ts: 3 });
assert.equal(clickIntentBody("email", { gclid: "click-1" }, {}, 1, "/contact"), null);
assert.deepEqual(
  clickIntentBody("call", { gclid: "click-1", landing_page: "/quote?x=1" }, { email: "x@example.com", phone: "020 123" }, 123, "/contact?x=1"),
  { kind: "call", gclid: "click-1", landing_page: "/quote", page: "/contact", ts: 123 },
);
assert.deepEqual(
  clickIntentBody("call", { gclid: "click-2", utm_source: " google ", utm_campaign: "x".repeat(110) }, {}, 789, "/"),
  { kind: "call", gclid: "click-2", utm_source: "google", utm_campaign: "x".repeat(100), page: "/", ts: 789 },
);
assert.deepEqual(
  clickIntentBody("chat", { wbraid: "wide.1" }, { contact: { email: "  PERSON@Example.COM  ", phone: "+44 (0)20 1234-5678" } }, 456, "/"),
  { kind: "chat", wbraid: "wide.1", page: "/", ts: 456, email: "person@example.com", phone: "+4402012345678" },
);

const env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_KEY: "service-secret", SM_ORG_ID: "11111111-1111-1111-1111-111111111111" };
function request(body, headers = {}) {
  const contentType = headers["Content-Type"] || "application/json";
  return new Request("https://searsmelvin.co.uk/api/click-intent", {
    method: "POST",
    headers: { "Content-Type": contentType, Origin: "https://searsmelvin.co.uk", ...headers },
    body: JSON.stringify(body),
  });
}

const originalFetch = globalThis.fetch;
const originalError = console.error;
try {
  let calls = [];
  let logs = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    if (String(args[0]).includes("check_portal_rate_limit")) return Response.json([{ allowed: true }]);
    return new Response(null, { status: 500 });
  };
  console.error = (...args) => logs.push(args.join(" "));

  const forbidden = await onRequestPost({ request: request({ kind: "call", gclid: "x" }, { Origin: "https://evil.example" }), env });
  assert.equal(forbidden.status, 403);

  const ignored = await onRequestPost({ request: request({ kind: "chat" }), env });
  assert.equal(ignored.status, 204);
  assert.equal(calls.length, 0, "chat without click ID or UTM must not call Supabase");

  const callAccepted = await onRequestPost({ request: request({ kind: "call", page: "/contact" }, { "Content-Type": "text/plain;charset=UTF-8" }), env });
  assert.equal(callAccepted.status, 204);
  assert.equal(calls.filter(([url]) => String(url).endsWith("/rest/v1/click_intents")).length, 1, "call without click ID is inserted");
  assert.equal(JSON.parse(calls.at(-1)[1].body).gclid, null);

  calls = [];
  const accepted = await onRequestPost({ request: request({ kind: "chat", gclid: "click-secret", email: " Person@Example.com ", phone: "+44 (0)20 1234", page: "/contact?bad=1" }, { "User-Agent": "test-agent" }), env });
  assert.equal(accepted.status, 204);
  const inserts = calls.filter(([url]) => String(url).endsWith("/rest/v1/click_intents"));
  assert.equal(inserts.length, 1);
  assert.match(String(inserts[0][0]), /\/rest\/v1\/click_intents$/);
  const row = JSON.parse(inserts[0][1].body);
  assert.equal(row.email, "person@example.com");
  assert.equal(row.phone, "+440201234");
  assert.equal(row.page, "/contact");
  const logText = logs.join(" ");
  assert.match(logText, /click_intent_insert_failed/);
  for (const secret of ["click-secret", "service-secret", "person@example.com", "+440201234"]) {
    assert.doesNotMatch(logText, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "failure logs must redact click IDs, credentials, and PII");
  }

  calls = [];
  let insertCount = 0;
  globalThis.fetch = async (...args) => {
    calls.push(args);
    if (String(args[0]).includes("check_portal_rate_limit")) return Response.json([{ allowed: true }]);
    insertCount += 1;
    return new Response(null, { status: insertCount === 1 ? 400 : 201 });
  };
  await onRequestPost({ request: request({ kind: "call", gclid: "click", utm_source: "google", utm_medium: "cpc" }), env });
  const retryInserts = calls.filter(([url]) => String(url).endsWith("/rest/v1/click_intents"));
  assert.equal(retryInserts.length, 2, "a lagging UTM migration retries once");
  assert.equal(JSON.parse(retryInserts[0][1].body).utm_source, "google");
  assert.ok(!("utm_source" in JSON.parse(retryInserts[1][1].body)));
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
