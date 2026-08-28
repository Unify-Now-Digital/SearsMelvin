import assert from "node:assert/strict";

import { onRequest as partnerOrders } from "../functions/api/partner-orders.js";

const orderId = "00000000-0000-4000-8000-000000000011";
const unpaidOrderId = "00000000-0000-4000-8000-000000000021";
const productId = "00000000-0000-4000-8000-000000000012";
const cemeteryId = "00000000-0000-4000-8000-000000000013";
const jobId = "00000000-0000-4000-8000-000000000014";
const unpaidJobId = "00000000-0000-4000-8000-000000000024";
const orgId = "00000000-0000-4000-8000-000000000015";
const proofId = "00000000-0000-4000-8000-000000000016";
const permitId = "00000000-0000-4000-8000-000000000017";
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  SM_ORG_ID: orgId,
  SM_INTERNAL_PARTNER_ID: "1",
};

const originalFetch = globalThis.fetch;
const writtenEvents = [];
const orderPatches = [];
const permitWrites = [];
const jobPatches = [];
const proofPatches = [];
const fetchLog = [];

function orderRow(id, extra = {}) {
  return {
    id,
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
    job_id: extra.job_id || jobId,
    jobs: extra.jobs || { stage: "confirmed", paid_at: "2026-08-01T10:00:00Z" },
    ...extra,
  };
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const method = init.method || "GET";
  fetchLog.push({ url, method, body: init.body || null });
  if (url.includes("/rest/v1/rpc/check_portal_rate_limit")) return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  if (url.includes("/rest/v1/partner_sessions?token=eq.")) return Response.json([{ partner_id: 1 }]);
  if (url.includes("/rest/v1/partners?id=eq.1")) return Response.json([{ id: 1, email: "info@searsmelvin.co.uk", name: "Sears Melvin Team", company: "Sears Melvin", status: "approved" }]);
  if (url.includes(`/rest/v1/orders?id=eq.${unpaidOrderId}`) && method !== "PATCH") {
    return Response.json([orderRow(unpaidOrderId, { job_id: unpaidJobId, jobs: { stage: "enquired" } })]);
  }
  if (url.includes(`/rest/v1/orders?id=eq.${orderId}`) && method !== "PATCH") {
    return Response.json([orderRow(orderId)]);
  }
  if (url.includes("/rest/v1/order_permits?order_id=in.")) return Response.json([]);
  if (url.includes("/rest/v1/order_permits?order_id=eq.") && method === "GET") {
    return Response.json(permitWrites.length ? [permitWrites.at(-1)] : []);
  }
  if (url.includes("/rest/v1/invoices?order_id=in.")) {
    const paid = url.includes(orderId);
    return Response.json(paid ? [{ id: "inv-1", order_id: orderId, status: "partial", paid_at: "2026-08-01T10:00:00Z" }] : []);
  }
  if (url.includes("/rest/v1/order_payments?order_id=in.") || url.includes("/rest/v1/order_payments?order_id=eq.")) return Response.json([]);
  if (url.includes("/rest/v1/payments?invoice_id=in.")) {
    return Response.json([{ id: "pay-1", invoice_id: "inv-1", amount: 450, date: "2026-08-01", reference: "pi_test" }]);
  }
  if (url.includes("/rest/v1/order_events?order_id=in.")) {
    const events = writtenEvents.filter((event) => url.includes(event.order_id));
    return Response.json(events.map((event) => ({ order_id: event.order_id, event_type: event.event_type, created_at: event.created_at })));
  }
  if (url.includes("/rest/v1/order_additional_options?order_id=in.")) return Response.json([]);
  if (url.includes(`/rest/v1/orders?id=eq.${orderId}`) && method === "PATCH") {
    orderPatches.push(JSON.parse(init.body));
    return Response.json([{ id: orderId, ...orderPatches.at(-1) }]);
  }
  if (url.includes(`/rest/v1/orders?id=eq.${unpaidOrderId}`) && method === "PATCH") {
    orderPatches.push(JSON.parse(init.body));
    return Response.json([{ id: unpaidOrderId, ...orderPatches.at(-1) }]);
  }
  if (url.endsWith("/rest/v1/order_events") && method === "POST") {
    const event = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...JSON.parse(init.body) };
    writtenEvents.push(event);
    return Response.json([event], { status: 201 });
  }
  if (url.includes(`/rest/v1/jobs?id=eq.${jobId}`) && method === "PATCH") {
    jobPatches.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  }
  if (url.includes(`/rest/v1/jobs?id=eq.${unpaidJobId}`) && method === "PATCH") {
    jobPatches.push(JSON.parse(init.body));
    return new Response(null, { status: 204 });
  }
  if (url.endsWith("/rest/v1/order_permits") && method === "POST") {
    const permit = { id: permitId, created_at: new Date().toISOString(), ...JSON.parse(init.body) };
    permitWrites.push(permit);
    return Response.json([permit], { status: 201 });
  }
  if (url.includes(`/rest/v1/order_permits?id=eq.${permitId}`) && method === "PATCH") {
    const permit = { id: permitId, ...permitWrites.at(-1), ...JSON.parse(init.body) };
    permitWrites.push(permit);
    return Response.json([permit]);
  }
  if (url.includes("/rest/v1/order_proofs?order_id=eq.") && url.includes("state=eq.sent")) {
    return Response.json([{ id: proofId, state: "sent" }]);
  }
  if (url.includes(`/rest/v1/order_proofs?id=eq.${proofId}`) && method === "PATCH") {
    const proof = { id: proofId, ...JSON.parse(init.body) };
    proofPatches.push(proof);
    return Response.json([proof]);
  }
  throw new Error(`Unexpected test fetch: ${url} ${method}`);
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
  const unpaidSpec = await post({
    action: "record-spec-preapproval",
    orderId: unpaidOrderId,
    outcome: "requested",
    method: "phone",
    contact: "Cemetery office",
    note: "Checking size before payment",
  });
  assert.equal(unpaidSpec.status, 200, await unpaidSpec.text());
  assert.equal(writtenEvents.at(-1).event_type, "spec_preapproval_requested");
  assert.equal(writtenEvents.at(-1).order_id, unpaidOrderId);

  const preapproval = await post({
    action: "record-spec-preapproval",
    orderId,
    outcome: "approved",
    method: "phone",
    contact: "Cemetery office",
    note: "Size and fixing confirmed",
  });
  assert.equal(preapproval.status, 200);
  assert.equal(writtenEvents.at(-1).event_type, "spec_preapproval_approved");
  assert.equal(writtenEvents.at(-1).detail.specification.product_id, productId);
  assert.equal(writtenEvents.at(-1).detail.specification.cemetery_id, cemeteryId);

  const material = await post({ action: "update-material", orderId, status: "Ordered" });
  assert.equal(material.status, 200);
  assert.equal(orderPatches.at(-1).stone_status, "Ordered");
  assert.equal(writtenEvents.at(-1).event_type, "material_ordered");

  const permit = await post({
    action: "update-permit",
    orderId,
    spineKey: "send_to_customer",
    note: "Form emailed to next of kin",
  });
  assert.equal(permit.status, 200, await permit.clone().text());
  const permitBody = await permit.json();
  assert.equal(permitBody.step.storedValue, "form_sent");
  assert.equal(permitBody.step.label, "Send to customer");
  assert.equal(permitWrites.at(-1).permit_phase, "form_sent");
  assert.equal(writtenEvents.at(-1).event_type, "permit_phase_updated");
  assert.ok(orderPatches.some((patch) => patch.permit_status === "form_sent"));

  const issues = await post({
    action: "update-permit",
    orderId,
    spineKey: "resolve_issues",
    note: "Cemetery asked for a revised plot sketch",
  });
  assert.equal(issues.status, 200);
  assert.equal(permitWrites.at(-1).permit_phase, "resolve_issues");

  const beforePaymentRequest = fetchLog.length;
  const payment = await post({ action: "request-payment", orderId: unpaidOrderId });
  assert.equal(payment.status, 200, await payment.clone().text());
  const paymentBody = await payment.json();
  assert.equal(paymentBody.invoicing, "external");
  assert.equal(writtenEvents.at(-1).event_type, "payment_requested");
  assert.deepEqual(jobPatches.at(-1), { stage: "invoiced", stage_status: "Payment requested from partner portal" });
  const paymentFetches = fetchLog.slice(beforePaymentRequest);
  assert.equal(paymentFetches.some((entry) => entry.url.includes("/rest/v1/invoices") && entry.method === "POST"), false);
  assert.equal(paymentFetches.some((entry) => entry.url.includes("api.resend.com")), false);
  assert.equal(paymentFetches.some((entry) => entry.url.includes("gohighlevel") || entry.url.includes("leadconnector")), false);

  const proof = await post({ action: "approve-proof", orderId });
  assert.equal(proof.status, 200, await proof.clone().text());
  assert.equal(proofPatches.at(-1).state, "approved");
  assert.equal(writtenEvents.at(-1).event_type, "proof_approved");
  assert.equal(writtenEvents.at(-1).detail.actor_type, "sears_melvin_internal_workspace");

  console.log("partner operational action tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
