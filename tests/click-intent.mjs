import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { onRequestPost } from "../functions/api/click-intent.js";

const require = createRequire(import.meta.url);
const up = require("../site-upgrades.js");
const { clickIntentBody } = up;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";
const NOW = Date.parse("2026-11-03T12:02:00Z");
const CHAT_CONTACT = { email: "  Vashti@Example.com ", phone: "07700 900123", name: "Vashti Allen" };

assert.deepEqual(clickIntentBody("chat", {}, { name: "Ellie Napoli" }, 1, "/contact"), { kind: "chat", page: "/contact", ts: 1 });
assert.equal("name" in clickIntentBody("chat", {}, { name: "Ellie Napoli" }, 1, "/contact"), false);
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

// iPhone Safari on /memorials. Saved attribution is empty.
const freshSeconds = Math.floor(NOW / 1000);
const urlAttribution = up.resolveClickIntentAttribution(
  {},
  "?gclid=UrlGclid_1&gbraid=UrlBraid.1&wbraid=UrlWbraid.1",
  `_gcl_aw=GCL.${freshSeconds}.CookieGclid_1`,
  NOW,
);
assert.deepEqual(urlAttribution, { gclid: "UrlGclid_1", gbraid: "UrlBraid.1", wbraid: "UrlWbraid.1" });
const urlPayload = up.clickIntentPayload("chat", {}, "?gclid=UrlGclid_1&wbraid=UrlWbraid.1", "", CHAT_CONTACT, NOW, "/memorials");
assert.equal(urlPayload.kind, "chat");
assert.equal(urlPayload.page, "/memorials");
assert.equal(urlPayload.gclid, "UrlGclid_1");
assert.equal(urlPayload.wbraid, "UrlWbraid.1");
assert.equal(urlPayload.email, "vashti@example.com");
assert.equal(urlPayload.phone, "07700900123");
assert.equal("name" in urlPayload, false, "name is personal data and is not collected");
assert.match(urlPayload.event_id, UUID);

const cookieOnly = up.resolveClickIntentAttribution(
  { landing_page: "/memorials" },
  "",
  `_ga=GA1.1.1.1; _gcl_aw=GCL.${freshSeconds}.CookieGclid_1`,
  NOW,
);
assert.deepEqual(cookieOnly, { gclid: "CookieGclid_1", landing_page: "/memorials" });
const encodedCookie = up.readGclAwGclid(`_gcl_aw=${encodeURIComponent(`GCL.${freshSeconds}.Encoded-Gclid_1`)}`, NOW);
assert.equal(encodedCookie, "Encoded-Gclid_1");
assert.deepEqual(
  up.resolveClickIntentAttribution({}, "?wbraid=Wide.1&gclid=bad%20id", `_gcl_aw=GCL.${freshSeconds}.CookieGclid_1`, NOW),
  { wbraid: "Wide.1", gclid: "CookieGclid_1" },
);
assert.equal(up.readGclAwGclid("_gcl_aw=not-a-gcl-value", NOW), "");
const staleSeconds = freshSeconds - Math.floor(up.ATTR_TTL_MS / 1000) - 10;
assert.equal(up.readGclAwGclid(`_gcl_aw=GCL.${staleSeconds}.StaleGclid`, NOW), "");
const savedFirst = { gclid: "StoredGclid", utm_source: "google" };
assert.equal(
  up.resolveClickIntentAttribution(savedFirst, "?gclid=UrlGclid_1", `_gcl_aw=GCL.${freshSeconds}.CookieGclid_1`, NOW),
  savedFirst,
);
const barePayload = up.clickIntentPayload("chat", {}, "", "", { name: "Ellie Napoli", email: "ellie@example.com" }, NOW, "/memorials");
assert.equal(barePayload.page, "/memorials");
assert.equal(barePayload.email, "ellie@example.com");
assert.equal(barePayload.gclid, undefined);
assert.equal("name" in barePayload, false);
assert.equal(up.clickIntentPayload("email", { gclid: "x" }, "", "", {}, NOW, "/memorials"), null);
const firstId = up.clickIntentEventId();
const secondId = up.clickIntentEventId();
assert.match(firstId, UUID);
assert.notEqual(firstId, secondId);

const sent = [];
up.dispatchClickIntent(JSON.stringify(urlPayload), {
  sendBeacon(url, data) { sent.push(["beacon", url, data]); return true; },
  fetch(url, opts) { sent.push(["fetch", url, opts]); return Promise.resolve(new Response(null, { status: 204 })); },
});
assert.deepEqual(sent.map((entry) => entry[0]), ["beacon", "fetch"], "a successful beacon still sends keepalive fetch");
assert.equal(sent[0][1], "/api/click-intent");
assert.equal(sent[1][1], "/api/click-intent");
assert.equal(sent[1][2].keepalive, true);
assert.equal(sent[1][2].body, sent[0][2]);
assert.equal(JSON.parse(sent[0][2]).event_id, urlPayload.event_id);
assert.equal(JSON.parse(sent[0][2]).page, "/memorials");
const upgradesSource = readFileSync("site-upgrades.js", "utf8");
assert.match(upgradesSource, /sendBeacon\('\/api\/click-intent', json\)/);
assert.doesNotMatch(upgradesSource, /sendBeacon\('\/api\/click-intent', json\)\) return/);

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

  calls = [];
  const bareChat = await onRequestPost({
    request: request({
      kind: "chat",
      page: "/memorials",
      email: " ellie@example.com ",
      phone: "07700 900123",
      name: "Ellie Napoli",
      event_id: "not-a-uuid",
    }, { "User-Agent": IPHONE_SAFARI }),
    env,
  });
  assert.equal(bareChat.status, 204);
  const bareInserts = calls.filter(([url]) => String(url).endsWith("/rest/v1/click_intents"));
  assert.equal(bareInserts.length, 1, "chat without click ID or UTM is still inserted");
  const bareRow = JSON.parse(bareInserts[0][1].body);
  assert.equal(bareRow.kind, "chat");
  assert.equal(bareRow.gclid, null);
  assert.equal(bareRow.page, "/memorials");
  assert.equal(bareRow.email, "ellie@example.com");
  assert.equal(bareRow.phone, "07700900123");
  assert.equal(bareRow.user_agent, IPHONE_SAFARI);
  assert.equal("name" in bareRow, false, "name is personal data and is not stored");
  assert.equal("id" in bareRow, false, "an invalid event id must not be sent as the primary key");
  assert.equal("event_id" in bareRow, false);

  calls = [];
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
  const retryId = "33333333-3333-4333-8333-333333333333";
  await onRequestPost({ request: request({ kind: "call", gclid: "click", utm_source: "google", utm_medium: "cpc", event_id: retryId }), env });
  const retryInserts = calls.filter(([url]) => String(url).endsWith("/rest/v1/click_intents"));
  assert.equal(retryInserts.length, 2, "a lagging UTM migration retries once");
  assert.equal(JSON.parse(retryInserts[0][1].body).utm_source, "google");
  assert.ok(!("utm_source" in JSON.parse(retryInserts[1][1].body)));
  assert.equal(JSON.parse(retryInserts[0][1].body).id, retryId);
  assert.equal(JSON.parse(retryInserts[1][1].body).id, retryId);

  const eventId = "22222222-2222-4222-8222-222222222222";
  const duplicateBody = {
    kind: "chat",
    gclid: "UrlGclid_1",
    page: "/memorials",
    email: "vashti@example.com",
    phone: "07700900123",
    name: "Vashti Allen",
    event_id: eventId,
  };
  calls = [];
  logs = [];
  let duplicateInserts = 0;
  globalThis.fetch = async (...args) => {
    calls.push(args);
    if (String(args[0]).includes("check_portal_rate_limit")) return Response.json([{ allowed: true }]);
    duplicateInserts += 1;
    return new Response(null, { status: duplicateInserts === 1 ? 201 : 409 });
  };
  const first = await onRequestPost({ request: request(duplicateBody, { "User-Agent": IPHONE_SAFARI }), env });
  const second = await onRequestPost({ request: request(duplicateBody, { "User-Agent": IPHONE_SAFARI }), env });
  assert.equal(first.status, 204);
  assert.equal(second.status, 204);
  const deduped = calls.filter(([url]) => String(url).endsWith("/rest/v1/click_intents"));
  assert.equal(deduped.length, 2, "the duplicate response is not retried as a second insert");
  assert.equal(JSON.parse(deduped[0][1].body).id, eventId);
  assert.equal(JSON.parse(deduped[1][1].body).id, eventId);
  assert.equal("name" in JSON.parse(deduped[0][1].body), false);
  assert.equal(logs.join(" "), "", "a primary-key conflict is the expected duplicate, not a failure");
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
