import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { readBoundedJson, RequestValidationError } from "../functions/api/_security.js";
import { onRequest as customerOrder } from "../functions/api/customer-order.js";
import { onRequest as quotes } from "../functions/api/quotes.js";
import { onRequestPost as stripe } from "../functions/api/stripe.js";
import { onRequestPost as stripeWebhook } from "../functions/api/stripe-webhook.js";
import { onRequestPost as submit } from "../functions/api/submit.js";
import { onRequestDelete as deletePhoto, onRequestPost as uploadPhoto } from "../functions/api/upload-photo.js";
import { onRequestGet as getPublicConfig } from "../functions/api/config.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: "3770972d-1bbd-417b-b413-297e844db285",
  RESEND_API_KEY: "test-resend-key",
  STRIPE_SECRET_KEY: "test-stripe-key",
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes("/rest/v1/rpc/check_portal_rate_limit")) {
    return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  }
  if (url.includes("/rest/v1/portal_security_events")) {
    return new Response(null, { status: 201 });
  }
  if (url.includes("/storage/v1/object/enquiry-photos/") && init.method === "POST") {
    return Response.json({ Key: "test" });
  }
  throw new Error(`Unexpected test fetch: ${url}`);
};

try {
  assert.equal(existsSync(new URL("../functions/api/stripe 2.js", import.meta.url)), false);
  const partnerHtml = readFileSync(new URL("../partner.html", import.meta.url), "utf8");
  const publicMemorialFunction = readFileSync(new URL("../functions/memorials/[slug].js", import.meta.url), "utf8");
  const publicSitemapFunction = readFileSync(new URL("../functions/sitemap.xml.js", import.meta.url), "utf8");
  const securityHeaders = readFileSync(new URL("../_headers", import.meta.url), "utf8");
  const quotesApi = readFileSync(new URL("../functions/api/quotes.js", import.meta.url), "utf8");
  const customerOrderApi = readFileSync(new URL("../functions/api/customer-order.js", import.meta.url), "utf8");
  assert.equal(partnerHtml.includes('id="reqPassword"'), false);
  assert.equal(publicMemorialFunction.includes("env.SUPABASE_SERVICE_KEY"), false);
  assert.equal(publicSitemapFunction.includes("env.SUPABASE_SERVICE_KEY"), false);
  assert.equal(securityHeaders.includes("'unsafe-eval'"), false);
  assert.equal(quotesApi.includes("edit_token=eq"), false);
  assert.equal(customerOrderApi.includes("tracking_token=eq"), false);

  const valid = await readBoundedJson(new Request("https://searsmelvin.co.uk/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  }));
  assert.deepEqual(valid, { ok: true });

  await assert.rejects(
    readBoundedJson(new Request("https://searsmelvin.co.uk/api/test", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    })),
    error => error instanceof RequestValidationError && error.status === 415,
  );

  await assert.rejects(
    readBoundedJson(new Request("https://searsmelvin.co.uk/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "20000" },
      body: "{}",
    })),
    error => error instanceof RequestValidationError && error.status === 413,
  );

  const crossOrigin = await customerOrder({
    env,
    request: new Request("https://searsmelvin.co.uk/api/customer-order", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://attacker.invalid" },
      body: JSON.stringify({ action: "send-portal-link", email: "victim@example.com" }),
    }),
  });
  assert.equal(crossOrigin.status, 403);

  const crossOriginConfig = await getPublicConfig({
    env,
    request: new Request("https://searsmelvin.co.uk/api/config", {
      headers: { "Origin": "https://attacker.invalid" },
    }),
  });
  assert.equal(crossOriginConfig.status, 403);

  const retiredCustomerGet = await customerOrder({
    env,
    request: new Request("https://searsmelvin.co.uk/api/customer-order?token=secret", {
      headers: { "Origin": "https://searsmelvin.co.uk" },
    }),
  });
  assert.equal(retiredCustomerGet.status, 405);

  const retiredEmailLookup = await quotes({
    env,
    request: new Request("https://searsmelvin.co.uk/api/quotes?email=victim%40example.com", {
      headers: { "Origin": "https://searsmelvin.co.uk" },
    }),
  });
  assert.equal(retiredEmailLookup.status, 405);

  const oldPaymentPayload = await stripe({
    env,
    waitUntil() {},
    request: new Request("https://searsmelvin.co.uk/api/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://searsmelvin.co.uk" },
      body: JSON.stringify({
        amount: 0.01,
        invoiceId: "00000000-0000-4000-8000-000000000001",
        email: "victim@example.com",
      }),
    }),
  });
  assert.equal(oldPaymentPayload.status, 400);

  const oversizedSubmission = await submit({
    env,
    waitUntil() {},
    request: new Request("https://searsmelvin.co.uk/api/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(70 * 1024),
        "Origin": "https://searsmelvin.co.uk",
      },
      body: "{}",
    }),
  });
  assert.equal(oversizedSubmission.status, 413);

  const forgedPhotoSubmission = await submit({
    env,
    waitUntil() {},
    request: new Request("https://searsmelvin.co.uk/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://searsmelvin.co.uk" },
      body: JSON.stringify({
        channel: "contact",
        name: "Test Person",
        email: "test@example.com",
        message: "Test enquiry",
        photo_urls: [`${env.SM_ORG_ID}/2026/08/00000000-0000-4000-8000-000000000001-photo.png`],
        photo_tokens: ["0".repeat(64)],
      }),
    }),
  });
  assert.equal(forgedPhotoSubmission.status, 403);

  const form = new FormData();
  form.append("file", new Blob(["not a png"], { type: "image/png" }), "fake.png");
  const disguisedImage = await uploadPhoto({
    env,
    waitUntil() {},
    request: new Request("https://searsmelvin.co.uk/api/upload-photo", {
      method: "POST",
      headers: { "Origin": "https://searsmelvin.co.uk" },
      body: form,
    }),
  });
  assert.equal(disguisedImage.status, 415);

  const pathOnlyDelete = await deletePhoto({
    env,
    waitUntil() {},
    request: new Request("https://searsmelvin.co.uk/api/upload-photo", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "Origin": "https://searsmelvin.co.uk" },
      body: JSON.stringify({
        path: `${env.SM_ORG_ID}/2026/08/00000000-0000-4000-8000-000000000001-photo.png`,
      }),
    }),
  });
  assert.equal(pathOnlyDelete.status, 403);

  const unsignedWebhook = await stripeWebhook({
    env: {},
    request: new Request("https://searsmelvin.co.uk/api/stripe-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "payment_intent.succeeded" }),
    }),
  });
  assert.equal(unsignedWebhook.status, 503);

  console.log("security smoke tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
