import assert from "node:assert/strict";

import { onRequest as partnerOrders } from "../functions/api/partner-orders.js";

const orderId = "00000000-0000-4000-8000-000000000011";
const productId = "00000000-0000-4000-8000-000000000012";
const cemeteryId = "00000000-0000-4000-8000-000000000013";
const jobId = "00000000-0000-4000-8000-000000000014";
const orgId = "00000000-0000-4000-8000-000000000015";
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: orgId,
  SM_INTERNAL_PARTNER_ID: "1",
};

const originalFetch = globalThis.fetch;
const writtenEvents = [];
const orderPatches = [];

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes("/rest/v1/rpc/check_portal_rate_limit")) return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  if (url.includes("/rest/v1/partner_sessions?token=eq.")) return Response.json([{ partner_id: 1 }]);
  if (url.includes("/rest/v1/partners?id=eq.1")) return Response.json([{ id: 1, email: "info@searsmelvin.co.uk", name: "Sears Melvin Team", company: "Sears Melvin", status: "approved" }]);
  if (url.includes(`/rest/v1/orders?id=eq.${orderId}`) && init.method !== "PATCH") {
    return Response.json([{
      id: orderId,
      organization_id: orgId,
      product_id: productId,
      product_config: JSON.stringify({ name: "Lawn memorial", size: "2ft 6in", dimensions: "30 x 24 x 3", cemetery: "Test Cemetery", plot_reference: "A12" }),
      material: "Granite",
      color: "Black",
      cemetery_id: cemeteryId,
      location: "Test Cemetery",
      sku: "A12",
      stone_status: "NA",
      status: "pending",
      person_name: "Example Person",
      permit_status: "pending",
      proof_status: "not_started",
      job_id: jobId,
      jobs: { stage: "confirmed", paid_at: "2026-08-01T10:00:00Z" },
    }]);
  }
  if (url.includes("/rest/v1/order_permits?order_id=in.")) return Response.json([]);
  if (url.includes("/rest/v1/invoices?order_id=in.")) return Response.json([{ order_id: orderId, status: "paid", paid_at: "2026-08-01T10:00:00Z" }]);
  if (url.includes("/rest/v1/order_payments?order_id=in.")) return Response.json([]);
  if (url.includes("/rest/v1/order_events?order_id=in.")) return Response.json([{ order_id: orderId, event_type: "spec_preapproval_approved", created_at: "2026-08-02T10:00:00Z" }]);
  if (url.includes("/rest/v1/order_additional_options?order_id=in.")) return Response.json([]);
  if (url.includes(`/rest/v1/orders?id=eq.${orderId}`) && init.method === "PATCH") {
    orderPatches.push(JSON.parse(init.body));
    return Response.json([{ id: orderId, stone_status: orderPatches.at(-1).stone_status }]);
  }
  if (url.endsWith("/rest/v1/order_events") && init.method === "POST") {
    const event = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...JSON.parse(init.body) };
    writtenEvents.push(event);
    return Response.json([event], { status: 201 });
  }
  if (url.includes(`/rest/v1/jobs?id=eq.${jobId}`) && init.method === "PATCH") return new Response(null, { status: 204 });
  throw new Error(`Unexpected test fetch: ${url} ${init.method || "GET"}`);
};

async function post(body) {
  return partnerOrders({
    env,
    waitUntil() {},
    request: new Request("https://searsmelvin.co.uk/api/partner-orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://searsmelvin.co.uk",
        "Cookie": "__Host-sm_partner_session=test-session",
      },
      body: JSON.stringify(body),
    }),
  });
}

try {
  const preapproval = await post({
    action: "record-spec-preapproval",
    orderId,
    outcome: "approved",
    method: "phone",
    contact: "Cemetery office",
    note: "Size and fixing confirmed",
  });
  assert.equal(preapproval.status, 200);
  assert.equal(writtenEvents[0].event_type, "spec_preapproval_approved");
  assert.equal(writtenEvents[0].detail.specification.product_id, productId);
  assert.equal(writtenEvents[0].detail.specification.cemetery_id, cemeteryId);

  const material = await post({ action: "update-material", orderId, status: "Ordered" });
  assert.equal(material.status, 200);
  assert.deepEqual(orderPatches.at(-1), { stone_status: "Ordered" });
  assert.equal(writtenEvents.at(-1).event_type, "material_ordered");
  console.log("partner operational action tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
