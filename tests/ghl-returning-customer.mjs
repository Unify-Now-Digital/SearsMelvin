// Returning paid customers must not get a second GHL opportunity (8 Oct 2026).
// A contact with ANY won opportunity gets a tag + note; no opportunity write.
// No network: fetch is stubbed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideWebsiteOpportunityAction,
  upsertWebsiteOpportunity,
  returningCustomerNote,
  RETURNING_CUSTOMER_TAG,
} from "../functions/api/_ghl-opportunity.js";

// ── Pure decision ───────────────────────────────────────────────────────────
assert.deepEqual(decideWebsiteOpportunityAction(null), { action: "create", reason: "lookup-failed" });
assert.deepEqual(decideWebsiteOpportunityAction([]), { action: "create", reason: "no-open-or-won" });
assert.deepEqual(
  decideWebsiteOpportunityAction([{ id: "o1", status: "open", pipelineStageId: "st-q" }]),
  { action: "update", existing: { id: "o1", pipelineStageId: "st-q" } },
);
// Won beats open: the duplicate shape seen on 1 Oct (open New card + won Invoiced card).
assert.deepEqual(
  decideWebsiteOpportunityAction([
    { id: "dup", status: "open", pipelineStageId: "st-new" },
    { id: "w1", status: "won", name: "The Charnwood — Example", pipelineStageId: "st-inv" },
  ]),
  { action: "returning-customer", won: { id: "w1", name: "The Charnwood — Example" } },
);
assert.equal(decideWebsiteOpportunityAction([{ id: "w", status: "WON" }]).action, "returning-customer");
// Lost/abandoned alone: a new enquiry is a new card (unchanged behaviour).
assert.equal(decideWebsiteOpportunityAction([{ id: "l", status: "lost" }]).action, "create");
assert.equal(decideWebsiteOpportunityAction([{ id: "a", status: "abandoned" }]).action, "create");

const note = returningCustomerNote({
  won: { id: "w1", name: "The Charnwood — Example" },
  enquiry: { type: "quote request", title: "The Charnwood — Example", guidePrice: 5140, message: "Second stone please" },
  submittedAt: "2026-10-01T14:08:05Z",
});
assert.match(note, /Returning customer/);
assert.match(note, /2026-10-01 14:08 UTC/);
assert.match(note, /£5140\.00 \(guide only/);
assert.match(note, /Second stone please/);
assert.match(note, /\[w1\]/);
assert.match(note, /no new opportunity was created/);

// ── End-to-end with stubbed fetch ───────────────────────────────────────────
function stub(opportunities, { searchOk = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    calls.push({ method, url: u, body: init.body ? JSON.parse(init.body) : undefined });
    if (u.includes("/opportunities/search?")) {
      if (!searchOk) return new Response("nope", { status: 500 });
      return Response.json({ opportunities, meta: { total: opportunities.length } });
    }
    return Response.json({ ok: true });
  };
  return calls;
}
const env = { GHL_API_KEY: "test", GHL_LOCATION_ID: "loc" };
const args = {
  contactId: "c1", name: "The Charnwood — Example", monetaryValue: 5140,
  pipelineId: "pipe", defaultStageId: "st-new", enquiry: { type: "quote request", message: "hi" },
  submittedAt: new Date("2026-10-01T14:08:05Z"),
};
const realFetch = globalThis.fetch;
try {
  // Returning paid customer → tag + note, zero opportunity writes.
  let calls = stub([{ id: "w1", status: "won", name: "The Charnwood — Example" }]);
  let d = await upsertWebsiteOpportunity(env, args);
  assert.equal(d.action, "returning-customer");
  const search = new URL(calls[0].url);
  assert.equal(search.searchParams.get("status"), "all", "must search all statuses, not just open");
  assert.equal(search.searchParams.get("contact_id"), "c1");
  const writes = calls.filter((c) => c.method !== "GET");
  assert.equal(writes.filter((c) => c.url.includes("/opportunities")).length, 0, "no opportunity write for a won contact");
  const tag = writes.find((c) => c.url.endsWith("/contacts/c1/tags"));
  assert.deepEqual(tag.body, { tags: [RETURNING_CUSTOMER_TAG] });
  const noteCall = writes.find((c) => c.url.endsWith("/contacts/c1/notes"));
  assert.match(noteCall.body.body, /Returning customer/);

  // Open card only → updated in place, stage preserved (unchanged behaviour).
  calls = stub([{ id: "o1", status: "open", pipelineStageId: "st-quoted" }]);
  d = await upsertWebsiteOpportunity(env, args);
  assert.equal(d.action, "update");
  const put = calls.find((c) => c.method === "PUT");
  assert.ok(put.url.endsWith("/opportunities/o1"));
  assert.equal(put.body.pipelineStageId, "st-quoted");
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);

  // Nothing yet → one New card.
  calls = stub([]);
  d = await upsertWebsiteOpportunity(env, args);
  assert.equal(d.action, "create");
  const post = calls.find((c) => c.method === "POST");
  assert.ok(post.url.endsWith("/opportunities/"));
  assert.equal(post.body.pipelineStageId, "st-new");
  assert.equal(post.body.status, "open");

  // Search fails → fail open (create), as before.
  calls = stub([], { searchOk: false });
  d = await upsertWebsiteOpportunity(env, args);
  assert.equal(d.action, "create");
} finally {
  globalThis.fetch = realFetch;
}

// ── Wiring: submit.js must route through the guarded upsert ─────────────────
const submit = readFileSync(new URL("../functions/api/submit.js", import.meta.url), "utf8");
assert.ok(submit.includes('from "./_ghl-opportunity.js"'), "submit.js must import _ghl-opportunity.js");
assert.ok(!/status:\s*"open",\s*\n\s*limit:/.test(submit), "submit.js must not search open-only opportunities");
assert.ok(!submit.includes("services.leadconnectorhq.com/opportunities"), "opportunity writes live in _ghl-opportunity.js only");

console.log("ghl-returning-customer: ok");
