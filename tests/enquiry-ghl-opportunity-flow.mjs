// End-to-end (mocked fetch): /api/submit saves the GHL opportunity id onto the
// enquiry row for contact, quote (waitUntil) and appointment submissions;
// brochure stays note-only; a failed write-back (or, defensively, a schema
// without the columns) never fails
// the lead. No live GHL or Supabase calls.
import assert from "node:assert/strict";
import { onRequestPost, createGHLOpportunity } from "../functions/api/submit.js";

const env = {
  RESEND_API_KEY: "test-resend-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: "00000000-0000-4000-8000-000000000001",
  GHL_API_KEY: "test-ghl-key",
  GHL_LOCATION_ID: "loc-test",
};

const calls = [];
const opts = { writeBack: "ok", ghlCreate: "ok", existing: [] };
const realError = console.error;
const realWarn = console.warn;
const logs = [];
console.error = (...a) => logs.push(a.join(" "));
console.warn = (...a) => logs.push(a.join(" "));

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method, body });
  if (url.includes("/rpc/check_portal_rate_limit")) return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  if (url.includes("/rest/v1/people?email=eq.")) return Response.json([{ id: "person-1", is_customer: false, is_test: false }]);
  if (url.includes("/rest/v1/people")) return new Response(null, { status: 204 });
  if (url.includes("/rest/v1/cemeteries")) return Response.json([]);
  if (url.includes("/rest/v1/products?")) {
    return Response.json([{
      id: "product-1", name: "The Castell", slug: "the-castell", base_price: 1450,
      image_url: "/images/castell.jpg", inscription_chars_included: 80, inscription_price_per_char: 1.95,
      product_categories: { name: "Lawn Headstones", slug: "lawn-headstones" },
    }]);
  }
  if (url.includes("/rest/v1/stone_colours?")) return Response.json([{ name: "Black", slug: "black", is_premium: false, tier: "standard" }]);
  if (url.includes("/rest/v1/product_addons?") || url.includes("/rest/v1/product_sizes?")) return Response.json([]);
  if (url.includes("/rpc/create_quote")) return Response.json({ ok: true, enquiry_id: "enq-quote" });
  if (url.includes("/rest/v1/enquiries") && method === "POST") return Response.json([{ id: "enq-1" }]);
  if (url.includes("/rest/v1/enquiries") && method === "PATCH" && body && "ghl_opportunity_id" in body) {
    if (opts.writeBack === "500") return new Response("boom", { status: 500 });
    if (opts.writeBack === "throw") throw new Error("network down");
    if (opts.writeBack === "missing") {
      return Response.json({ code: "PGRST204", message: "Could not find the 'ghl_opportunity_id' column of 'enquiries' in the schema cache" }, { status: 400 });
    }
    if (opts.writeBack === "missing-filter") {
      return Response.json({ code: "42703", message: "column enquiries.ghl_opportunity_id does not exist" }, { status: 400 });
    }
    return new Response(null, { status: 204 });
  }
  if (url.includes("/rest/v1/enquiries")) return new Response(null, { status: 204 });
  if (url === "https://api.resend.com/emails") return Response.json({ id: "email-1" });
  if (url.includes("googleapis.com") || url.includes("oauth2")) return new Response("no", { status: 500 });
  if (url.includes("/customFields")) return Response.json({ customFields: [] });
  if (url.endsWith("/contacts/") && method === "POST") return Response.json({ contact: { id: "ghl-1" } });
  if (url.includes("/opportunities/search")) return Response.json({ opportunities: opts.existing });
  if (url.endsWith("/opportunities/") && method === "POST") {
    if (opts.ghlCreate === "500") return new Response(null, { status: 500 });
    if (opts.ghlCreate === "no-id") return Response.json({ opportunity: {} }, { status: 201 });
    return Response.json({ opportunity: { id: "opp-new" } }, { status: 201 });
  }
  if (url.includes("/opportunities/") && method === "PUT") return Response.json({ opportunity: { id: "opp-open" } });
  if (url.includes("/contacts/")) return Response.json({ ok: true });
  throw new Error(`Unexpected fetch: ${method} ${url}`);
};

const pending = [];
let ip = 20;
async function post(body, o = {}) {
  calls.length = 0;
  pending.length = 0;
  logs.length = 0;
  Object.assign(opts, { writeBack: "ok", ghlCreate: "ok", existing: [] }, o);
  const res = await onRequestPost({
    env,
    waitUntil: (p) => pending.push(p),
    request: new Request("https://searsmelvin.co.uk/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://searsmelvin.co.uk", "CF-Connecting-IP": `203.0.113.${ip++}` },
      body: JSON.stringify(body),
    }),
  });
  const json = await res.json();
  // The response is returned before any background work settles.
  await Promise.all(pending);
  return { status: res.status, json };
}
const writeBacks = () => calls.filter((c) => c.method === "PATCH" && c.url.includes("/rest/v1/enquiries") && c.body && "ghl_opportunity_id" in c.body);
const contactBody = { channel: "contact", enquiry_type: "question", name: "TEST Contact", email: "test+contact@unifydigital.uk", message: "Please call." };
const quoteBody = { channel: "quote", name: "TEST Quote", email: "test+quote@unifydigital.uk", product: { name: "The Castell", slug: "the-castell", colour: "Black", price: "1450" } };

try {
  // 1) Contact enquiry: new GHL card → write-back by enquiry id, only if null.
  {
    const r = await post(contactBody);
    assert.equal(r.json.ok, true);
    const wb = writeBacks();
    assert.equal(wb.length, 1);
    assert.match(wb[0].url, /\/rest\/v1\/enquiries\?id=eq\.enq-1&ghl_opportunity_id=is\.null$/);
    assert.equal(wb[0].url.includes("email"), false, "matched by id, never email");
    assert.equal(wb[0].body.ghl_opportunity_id, "opp-new");
    assert.ok(!Number.isNaN(Date.parse(wb[0].body.ghl_synced_at)));
    const createIdx = calls.findIndex((c) => c.method === "POST" && c.url.endsWith("/opportunities/"));
    assert.ok(createIdx >= 0 && createIdx < calls.indexOf(wb[0]), "write-back runs after the GHL create");
  }

  // 2) Quote background (waitUntil) path: id from create_quote RPC.
  {
    const r = await post(quoteBody);
    assert.equal(r.json.ok, true);
    const wb = writeBacks();
    assert.equal(wb.length, 1);
    assert.match(wb[0].url, /id=eq\.enq-quote&ghl_opportunity_id=is\.null$/);
    assert.equal(wb[0].body.ghl_opportunity_id, "opp-new");
  }

  // 3) Existing open card is reused (PUT) → that card's id is linked.
  {
    const r = await post(quoteBody, { existing: [{ id: "opp-open", status: "open", pipelineStageId: "s1" }] });
    assert.equal(r.json.ok, true);
    assert.equal(writeBacks()[0]?.body.ghl_opportunity_id, "opp-open");
  }

  // 4) Returning (won) customer: no opportunity, so no write-back.
  {
    const r = await post(contactBody, { existing: [{ id: "opp-won", status: "won", name: "Won job" }] });
    assert.equal(r.json.ok, true);
    assert.equal(writeBacks().length, 0);
  }

  // 5) GHL create fails → no write-back, lead still saved.
  for (const body of [contactBody, quoteBody]) {
    const r = await post(body, { ghlCreate: "500" });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(writeBacks().length, 0);
  }

  // 6) No opportunity id in GHL's response → no write-back.
  {
    const r = await post(quoteBody, { ghlCreate: "no-id" });
    assert.equal(r.json.ok, true);
    assert.equal(writeBacks().length, 0);
  }

  // 7) Write-back fails (500 / network) → submission still succeeds, PII-free log.
  for (const mode of ["500", "throw"]) {
    for (const body of [contactBody, quoteBody]) {
      const r = await post(body, { writeBack: mode });
      assert.equal(r.json.ok, true);
      assert.equal(writeBacks().length, 1);
      const line = logs.find((l) => l.includes("enquiry_ghl_opportunity_id_save_failed"));
      assert.ok(line, `logged for ${mode}`);
      assert.equal(/@|TEST|opp-new|enq-/.test(line), false, "no PII or ids in the log");
    }
  }

  // 8) Defensive: a schema without the columns (PGRST204 body / 42703 filter) → skip gracefully.
  //    (The columns already exist in Mason App; this guards stale/preview DBs.)
  for (const mode of ["missing", "missing-filter"]) {
    const r = await post(contactBody, { writeBack: mode });
    assert.equal(r.json.ok, true);
    assert.ok(logs.some((l) => l.includes("enquiry_ghl_opportunity_columns_missing")));
    assert.equal(logs.some((l) => l.includes("enquiry_ghl_opportunity_id_save_failed")), false);
  }

  // 9) Appointment path.
  {
    const r = await post({
      channel: "appointment", name: "TEST Appt", email: "test+appt@unifydigital.uk", phone: "07000 000000",
      appointment_type: "phone", appointment_date: "2026-12-01", appointment_time: "10:00", notes: "Call me",
    });
    assert.equal(r.json.ok, true);
    const wb = writeBacks();
    assert.equal(wb.length, 1);
    assert.match(wb[0].url, /id=eq\.enq-1&ghl_opportunity_id=is\.null$/);
  }

  // 10) Brochure stays note-only: no opportunity, no write-back.
  {
    const r = await post({ ...contactBody, enquiry_type: "brochure", name: "TEST Brochure", message: "Brochure request", brochure_source: "home", source_page: "/" });
    assert.equal(r.json.ok, true);
    assert.equal(calls.some((c) => c.url.includes("/opportunities")), false);
    assert.equal(writeBacks().length, 0);
  }

  // 11) createGHLOpportunity direct: no enquiryId → GHL create still happens, no PATCH.
  {
    calls.length = 0;
    Object.assign(opts, { writeBack: "ok", ghlCreate: "ok", existing: [] });
    const res = await createGHLOpportunity(env, { contactId: "ghl-1", name: "X", monetaryValue: 0, enquiry: {}, source: "Website enquiry" });
    assert.equal(res.opportunityId, "opp-new");
    assert.equal(writeBacks().length, 0);
  }
} finally {
  console.error = realError;
  console.warn = realWarn;
}

console.log("enquiry-ghl-opportunity-flow: ok");
