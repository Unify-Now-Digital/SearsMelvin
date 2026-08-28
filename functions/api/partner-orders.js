/**
 * Partner portal data API — /api/partner-orders
 *
 * Uses the existing Mason App orders, jobs, people, invoices, proof, permit,
 * payment and catalogue tables. External partners are constrained by partner
 * id. The configured Sears Melvin account is constrained to the SM
 * organisation and can see direct orders plus its own internally-created
 * orders, but not orders belonging to other partners.
 */

import { upsertPerson } from "./submit.js";
import {
  RequestValidationError,
  checkRateLimit,
  getClientAddress,
  hardenedJson,
  isSameOriginRequest,
  queueSecurityEvent,
  rateLimitResponse,
  readBoundedJson,
  supabaseHeaders,
} from "./_security.js";
import { actorFromStaff, publicStaff, staffFromSessionToken } from "./_partner-staff.js";

const PARTNER_COOKIE = "__Host-sm_partner_session";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SPEC_PREAPPROVAL_EVENTS = new Set([
  "spec_preapproval_requested",
  "spec_preapproval_approved",
  "spec_preapproval_changes_required",
]);
const WORKFLOW_EVENT_TYPES = [
  ...SPEC_PREAPPROVAL_EVENTS,
  "material_ordered",
  "material_received",
  "physical_spec_changed",
  "permit_phase_updated",
  "payment_requested",
];
const PAID_INVOICE_STATUSES = new Set(["paid", "partial", "completed", "succeeded", "complete"]);
const PAID_STRIPE_STATUSES = new Set(["paid", "succeeded", "complete", "paid_out"]);
const PAID_PAYMENT_STATUSES = new Set(["matched", "confirmed", "paid", "succeeded", "complete"]);
const PAID_ORDER_STATUSES = new Set(["partial", "completed"]);
const PAID_ORDER_STAGES = new Set(["deposit_paid"]);

// Canonical 7-step permit spine locked 28 Aug 2026. Stored values reuse the
// live order_permits.permit_phase / orders.permit_status vocabulary where it
// already exists, and add match_form + resolve_issues rather than collapsing.
export const PERMIT_SPINE = [
  {
    key: "match_form",
    label: "Match form",
    storedValue: "match_form",
    aliases: ["form_needed", "pending"],
    timestampField: null,
  },
  {
    key: "send_to_customer",
    label: "Send to customer",
    storedValue: "form_sent",
    aliases: ["with_customer"],
    timestampField: "sent_at",
  },
  {
    key: "receive_signed",
    label: "Receive back signed from the correct person",
    storedValue: "customer_completed",
    aliases: [],
    timestampField: "returned_at",
  },
  {
    key: "complete_details",
    label: "Complete memorial and our details",
    storedValue: "completing",
    aliases: [],
    timestampField: null,
  },
  {
    key: "send_to_cemetery",
    label: "Send to cemetery",
    storedValue: "submitted",
    aliases: [],
    timestampField: "submitted_at",
  },
  {
    key: "resolve_issues",
    label: "Resolve any issues",
    storedValue: "resolve_issues",
    aliases: ["rejected"],
    timestampField: null,
  },
  {
    key: "confirm_approval",
    label: "Confirm approval",
    storedValue: "approved",
    aliases: ["not_required"],
    timestampField: "approved_at",
  },
];
const PERMIT_SPINE_BY_KEY = new Map(PERMIT_SPINE.map((step) => [step.key, step]));
const PERMIT_SPINE_BY_STORED = new Map();
for (const step of PERMIT_SPINE) {
  PERMIT_SPINE_BY_STORED.set(step.storedValue, step);
  for (const alias of step.aliases) PERMIT_SPINE_BY_STORED.set(alias, step);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Allow": "GET, POST, OPTIONS" } });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !UUID_PATTERN.test(String(env.SM_ORG_ID || ""))) {
    return json({ ok: false, error: "Server config error" }, 500);
  }
  if (!isSameOriginRequest(request)) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  const broadLimit = await checkRateLimit(env, request, "partner-orders-ip", getClientAddress(request), {
    maxAttempts: 600,
    windowSeconds: 300,
    blockSeconds: 300,
    failClosed: true,
  });
  if (!broadLimit.allowed) return rateLimitResponse(json, broadLimit.retryAfter);

  const token = getCookie(request, PARTNER_COOKIE)
    || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "Authentication required" }, 401);

  const partner = await getPartnerFromToken(env, token);
  if (!partner) return json({ ok: false, error: "Invalid or expired session" }, 401);

  const partnerLimit = await checkRateLimit(env, request, "partner-orders-account", String(partner.id), {
    maxAttempts: 300,
    windowSeconds: 300,
    blockSeconds: 300,
    failClosed: true,
  });
  if (!partnerLimit.allowed) {
    queueSecurityEvent(context, env, request, {
      eventType: "partner_orders_rate_limited",
      actorType: "partner",
      success: false,
      metadata: { partner_id: partner.id, retry_after: partnerLimit.retryAfter },
    });
    return rateLimitResponse(json, partnerLimit.retryAfter);
  }
  const workspace = getWorkspace(env, partner);

  const url = new URL(request.url);
  if (request.method === "GET") {
    if (url.searchParams.get("resource") === "catalog") return getCatalog(env);
    if (url.searchParams.get("resource") === "invoices") return getPartnerInvoices(env, partner, workspace);
    if (url.searchParams.get("resource") === "sales") return getSalesQueue(env, partner, workspace);
    const orderId = url.searchParams.get("id");
    if (orderId) {
      if (!UUID_PATTERN.test(orderId)) return json({ ok: false, error: "Invalid order ID" }, 400);
      return getOrderDetail(env, partner, workspace, orderId);
    }
    return listOrders(env, partner, workspace, url.searchParams);
  }

  if (request.method === "POST") {
    let data;
    try { data = await readBoundedJson(request); }
    catch (error) {
      const status = error instanceof RequestValidationError ? error.status : 400;
      return json({ ok: false, error: error instanceof RequestValidationError ? error.message : "Invalid JSON" }, status);
    }

    if (data.action === "create") return createOrder(env, partner, workspace, data);
    if (data.action === "comment") return addComment(env, partner, workspace, data);
    if (data.action === "approve-proof") return updateProof(env, partner, workspace, data, "approved");
    if (data.action === "request-proof-changes") return updateProof(env, partner, workspace, data, "changes_requested");
    if (data.action === "record-spec-preapproval") return recordSpecPreapproval(env, partner, workspace, data);
    if (data.action === "update-material") return updateMaterial(env, partner, workspace, data);
    if (data.action === "set-sales-follow-up") return setSalesFollowUp(env, workspace, data);
    if (data.action === "update-permit") return updatePermit(env, partner, workspace, data);
    if (data.action === "request-payment") return requestPayment(env, partner, workspace, data);
    return json({ ok: false, error: "Unknown action" }, 400);
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}

async function getPartnerInvoices(env, partner, workspace) {
  const headers = sbHeaders(env);
  const select = "id,order_id,invoice_number,customer_name,amount,status,due_date,issue_date,payment_date,stripe_status,paid_at,hosted_invoice_url,amount_paid,amount_remaining,intended_deposit_pence,locked_at,created_at,orders!inner(order_number,person_name)";
  const base = `${env.SUPABASE_URL}/rest/v1/invoices?deleted_at=is.null&is_test=eq.false&select=${select}&order=created_at.desc&limit=500`;
  // Two explicit internal queries keep external partner invoices out without
  // relying on an embedded-resource OR filter that is difficult to audit.
  const urls = workspace.mode === "internal"
    ? [
        `${base}&orders.organization_id=eq.${encodeURIComponent(workspace.organizationId)}&orders.is_test=eq.false&orders.partner_id=is.null`,
        `${base}&orders.organization_id=eq.${encodeURIComponent(workspace.organizationId)}&orders.is_test=eq.false&orders.partner_id=eq.${encodeURIComponent(partner.id)}`,
      ]
    : [`${base}&orders.organization_id=eq.${encodeURIComponent(workspace.organizationId)}&orders.is_test=eq.false&orders.partner_id=eq.${encodeURIComponent(partner.id)}`];
  const responses = await Promise.all(urls.map((url) => fetch(url, { headers })));
  if (responses.some((response) => !response.ok)) return json({ ok: false, error: "Unable to load invoices" }, 500);
  const rows = (await Promise.all(responses.map((response) => response.json()))).flat();
  const uniqueRows = Array.from(new Map(rows.map((invoice) => [invoice.id, invoice])).values())
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const invoices = uniqueRows.map((invoice) => ({
    ...mapInvoice(invoice),
    orderId: invoice.order_id,
    orderRef: invoice.orders?.order_number
      ? `ORD-${String(invoice.orders.order_number).padStart(6, "0")}`
      : null,
    deceasedName: invoice.orders?.person_name || null,
  }));
  return json({ ok: true, invoices, workspace: publicWorkspace(workspace) });
}

async function getCatalog(env) {
  const headers = sbHeaders(env);
  const orgFilter = env.SM_ORG_ID ? `&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}` : "";
  const [productsRes, cemeteriesRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/products?is_active=eq.true&is_listed=eq.true${orgFilter}&select=id,name,slug,short_description,base_price,image_url,sku,inscription_chars_included,inscription_price_per_char,product_sizes(id,size_name,size_code,dimensions,price_adjustment,is_default,display_order)&order=display_order.asc,name.asc&limit=200`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/cemeteries?is_active=eq.true&is_test=eq.false${orgFilter}&select=id,name,area,postcode,address,permit_fee,processing_weeks,kerb_allowed,lawn_section,cremation_section,governing_body,regulation_notes,max_height_mm,max_width_mm,allowed_typefaces&order=display_order.asc,name.asc&limit=250`, { headers }),
  ]);

  if (!productsRes.ok || !cemeteriesRes.ok) {
    return json({ ok: false, error: "Unable to load the memorial catalogue" }, 500);
  }

  const products = (await productsRes.json()).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku,
    description: p.short_description,
    basePrice: numberOrNull(p.base_price),
    imageUrl: p.image_url,
    inscriptionCharsIncluded: p.inscription_chars_included,
    inscriptionPricePerChar: numberOrNull(p.inscription_price_per_char),
    sizes: (p.product_sizes || []).sort((a, b) => (a.display_order || 0) - (b.display_order || 0)).map((s) => ({
      id: s.id,
      name: s.size_name,
      code: s.size_code,
      dimensions: s.dimensions,
      adjustment: numberOrNull(s.price_adjustment) || 0,
      isDefault: Boolean(s.is_default),
    })),
  }));

  const cemeteries = (await cemeteriesRes.json()).map((c) => ({
    id: c.id,
    name: c.name,
    area: c.area,
    postcode: c.postcode,
    address: c.address,
    permitFee: numberOrNull(c.permit_fee),
    processingWeeks: c.processing_weeks,
    governingBody: c.governing_body,
    kerbAllowed: c.kerb_allowed,
    lawnSection: c.lawn_section,
    cremationSection: c.cremation_section,
    regulationNotes: c.regulation_notes,
    maxHeightMm: c.max_height_mm,
    maxWidthMm: c.max_width_mm,
    allowedTypefaces: c.allowed_typefaces || [],
  }));

  return json({ ok: true, products, cemeteries });
}

async function listOrders(env, partner, workspace, params) {
  const headers = sbHeaders(env);
  const status = clean(params.get("status"), 40);
  const search = clean(params.get("search"), 100)?.toLowerCase();
  const limit = Math.min(Math.max(parseInt(params.get("limit") || "100", 10) || 100, 1), 100);

  let url = `${env.SUPABASE_URL}/rest/v1/orders?select=*,people(id,first_name,last_name,email,phone,is_customer),jobs(stage,stage_status,paid_at,wake_at),order_proofs(state,render_url,approved_at,created_at)&order_proofs.state=in.(sent,approved,changes_requested)&order=created_at.desc&limit=${limit}${orderScopeQuery(workspace, partner)}`;
  if (status && status !== "all" && status !== "needs_action") {
    url += `&status=eq.${encodeURIComponent(status)}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) return json({ ok: false, error: "Unable to load orders" }, 500);
  let rows = await res.json();

  if (search) {
    rows = rows.filter((row) => searchableOrderText(row).includes(search));
  }

  const evidence = await getWorkflowEvidence(env, rows.map((row) => row.id));
  let orders = rows.map((row) => mapOrder(row, workspace, evidence.get(row.id)));
  if (status === "needs_action") orders = orders.filter((order) => order.actionOwner === workspace.actionOwner);

  const totalValue = orders.reduce((sum, order) => sum + (numberOrNull(order.value) || 0), 0);
  const needsAction = orders.filter((order) => order.actionOwner === workspace.actionOwner).length;
  const completed = rows.filter((row) => row.status === "completed" || row.jobs?.stage === "complete").length;
  const inProduction = rows.filter((row) => row.jobs?.stage === "in_production" || row.status === "in_production").length;

  return json({
    ok: true,
    partner: publicPartner(partner),
    workspace: publicWorkspace(workspace),
    orders,
    stats: { total: rows.length, totalValue, needsAction, completed, inProduction },
  });
}

async function getSalesQueue(env, partner, workspace) {
  if (workspace.mode !== "internal") return json({ ok: false, error: "Sales workspace is restricted to Sears Melvin staff" }, 403);
  const headers = sbHeaders(env);
  const select = [
    "id", "stage", "stage_status", "wake_at", "created_at", "updated_at",
    "people(first_name,last_name,email,phone)",
    "inbox_conversations(id,channel,status,unread_count,last_message_at,last_inbound_at,last_outbound_at,enquiry_stage,order_id)",
    "enquiries(channel,sub_type,source_page,contact_pref,location,appointment_at,appointment_kind,status,created_at,order_id)",
  ].join(",");
  const url = `${env.SUPABASE_URL}/rest/v1/jobs?organization_id=eq.${encodeURIComponent(workspace.organizationId)}&stage=in.(enquired,quoted,invoiced)&exit_reason=is.null&select=${select}&order=created_at.desc&limit=250`;
  const response = await fetch(url, { headers });
  if (!response.ok) return json({ ok: false, error: "Unable to load the sales queue" }, 500);
  let rows = await response.json();
  const linkedOrderIds = Array.from(new Set(rows.map((row) => row.enquiries?.order_id || row.inbox_conversations?.order_id).filter((id) => UUID_PATTERN.test(String(id)))));
  if (linkedOrderIds.length) {
    const ordersResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=in.(${linkedOrderIds.join(",")})&organization_id=eq.${encodeURIComponent(workspace.organizationId)}&select=id,partner_id`, { headers });
    if (!ordersResponse.ok) return json({ ok: false, error: "Unable to verify the sales workspace scope" }, 500);
    const linkedOrders = new Map((await ordersResponse.json()).map((order) => [order.id, order]));
    rows = rows.filter((row) => {
      const linkedId = row.enquiries?.order_id || row.inbox_conversations?.order_id;
      if (!linkedId) return true;
      const order = linkedOrders.get(linkedId);
      return Boolean(order && (order.partner_id == null || String(order.partner_id) === String(partner.id)));
    });
  }
  const sales = rows.map(mapSalesJob).sort((a, b) => a.priorityRank - b.priorityRank || String(a.nextActionAt || a.createdAt).localeCompare(String(b.nextActionAt || b.createdAt)));
  return json({
    ok: true,
    sales,
    stats: {
      total: sales.length,
      smAction: sales.filter((item) => item.waitingOn === "sm").length,
      due: sales.filter((item) => item.followUpState === "overdue" || item.followUpState === "today").length,
      noNextAction: sales.filter((item) => !item.nextActionAt).length,
      incompleteHistory: sales.filter((item) => item.contactHistoryIncomplete).length,
    },
  });
}

function mapSalesJob(row) {
  const conversation = row.inbox_conversations || {};
  const enquiry = row.enquiries || {};
  const lastInbound = conversation.last_inbound_at || null;
  const lastOutbound = conversation.last_outbound_at || null;
  const wakeAt = row.wake_at || null;
  const now = new Date();
  const wakeDate = wakeAt ? new Date(wakeAt) : null;
  const dueToday = wakeDate && wakeDate.toDateString() === now.toDateString();
  const overdue = wakeDate && wakeDate < now && !dueToday;
  const reliablyAwaitingSm = Number(conversation.unread_count || 0) > 0
    || Boolean(lastInbound && lastOutbound && new Date(lastInbound) > new Date(lastOutbound));
  const reliablyAwaitingExternal = Boolean(lastOutbound && (!lastInbound || new Date(lastOutbound) >= new Date(lastInbound)));
  const waitingOn = overdue || dueToday || reliablyAwaitingSm ? "sm" : (reliablyAwaitingExternal ? "family_fd" : "unclear");
  const followUpState = overdue ? "overdue" : (dueToday ? "today" : (wakeAt ? "scheduled" : "missing"));
  const priorityRank = reliablyAwaitingSm ? 1 : (overdue ? 2 : (dueToday ? 3 : (!wakeAt ? 4 : (reliablyAwaitingExternal ? 5 : 6))));
  return {
    id: row.id,
    customerName: [row.people?.first_name, row.people?.last_name].filter(Boolean).join(" ") || "Unlinked enquiry",
    email: row.people?.email || null,
    phone: row.people?.phone || null,
    stage: row.stage,
    stageStatus: row.stage_status || null,
    source: enquiry.source_page || enquiry.channel || conversation.channel || null,
    contactPreference: enquiry.contact_pref || null,
    lastInboundAt: lastInbound,
    lastOutboundAt: lastOutbound,
    nextActionAt: wakeAt,
    waitingOn,
    followUpState,
    contactHistoryIncomplete: Boolean(lastInbound && !lastOutbound),
    priorityRank,
    createdAt: row.created_at,
  };
}

async function getWorkflowEvidence(env, orderIds) {
  const result = new Map(orderIds.map((id) => [id, { permits: [], invoices: [], payments: [], events: [], options: [] }]));
  if (!orderIds.length) return result;
  const headers = sbHeaders(env);
  const ids = orderIds.filter((id) => UUID_PATTERN.test(String(id))).join(",");
  if (!ids) return result;
  const base = `${env.SUPABASE_URL}/rest/v1`;
  const filter = `order_id=in.(${ids})`;
  const eventTypes = WORKFLOW_EVENT_TYPES.join(",");
  const requests = [
    ["permits", fetch(`${base}/order_permits?${filter}&select=order_id,permit_phase,sent_at,returned_at,approved_at,submitted_at,updated_at&order=updated_at.desc`, { headers })],
    ["invoices", fetch(`${base}/invoices?${filter}&deleted_at=is.null&is_test=eq.false&select=id,order_id,status,stripe_status,paid_at,payment_date,amount_paid,created_at`, { headers })],
    ["payments", fetch(`${base}/order_payments?${filter}&select=order_id,status,received_at,created_at`, { headers })],
    ["events", fetch(`${base}/order_events?${filter}&event_type=in.(${eventTypes})&select=order_id,event_type,created_at&order=created_at.desc`, { headers })],
    ["options", fetch(`${base}/order_additional_options?${filter}&select=order_id,cost`, { headers })],
  ];
  const responses = await Promise.all(requests.map(([, request]) => request));
  await Promise.all(responses.map(async (response, index) => {
    if (!response.ok) return;
    const key = requests[index][0];
    for (const row of await response.json()) {
      if (result.has(row.order_id)) result.get(row.order_id)[key].push(row);
    }
  }));
  const invoiceIds = [];
  const invoiceOrder = new Map();
  for (const [orderId, evidence] of result) {
    for (const invoice of evidence.invoices || []) {
      if (invoice.id) {
        invoiceIds.push(invoice.id);
        invoiceOrder.set(invoice.id, orderId);
      }
    }
  }
  if (invoiceIds.length) {
    const ledgerRes = await fetch(
      `${base}/payments?invoice_id=in.(${invoiceIds.join(",")})&select=id,invoice_id,amount,date,reference,created_at`,
      { headers },
    );
    if (ledgerRes.ok) {
      for (const row of await ledgerRes.json()) {
        const orderId = invoiceOrder.get(row.invoice_id);
        if (orderId && result.has(orderId)) {
          result.get(orderId).payments.push({
            order_id: orderId,
            status: "paid",
            received_at: row.date || row.created_at || null,
            source: "payments",
          });
        }
      }
    }
  }
  return result;
}

async function fetchLedgerPaymentsForInvoices(env, invoices) {
  const ids = (invoices || []).map((invoice) => invoice.id).filter((id) => UUID_PATTERN.test(String(id)));
  if (!ids.length) return [];
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/payments?invoice_id=in.(${ids.join(",")})&select=id,invoice_id,amount,date,reference,created_at`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  return (await res.json()).map((row) => ({
    id: row.id || null,
    status: "paid",
    received_at: row.date || row.created_at || null,
    source: "payments",
    invoice_id: row.invoice_id,
    amount: numberOrNull(row.amount),
    reference: row.reference || null,
  }));
}

async function getOrderDetail(env, partner, workspace, orderId) {
  const headers = sbHeaders(env);
  const row = await ownedOrder(env, partner, workspace, orderId, "*,people(id,first_name,last_name,email,phone,is_customer),jobs(stage,stage_status,paid_at,wake_at)");
  if (!row) return json({ ok: false, error: "Order not found" }, 404);

  const base = `${env.SUPABASE_URL}/rest/v1`;
  const encodedId = encodeURIComponent(row.id);
  const internal = workspace.mode === "internal";
  const emptyRows = () => Promise.resolve(new Response("[]", { headers: { "Content-Type": "application/json" } }));
  const permitSelect = internal
    ? "id,permit_phase,sent_at,returned_at,spec_plot_ref,submitted_at,approved_at,notes,created_at,updated_at"
    : "id,permit_phase,sent_at,returned_at,spec_plot_ref,submitted_at,approved_at,created_at,updated_at";
  const proofSelect = internal
    ? "id,inscription_text,font_style,additional_instructions,render_url,state,sent_at,approved_at,approved_by,changes_requested_at,changes_note,created_at,updated_at"
    : "id,inscription_text,font_style,render_url,state,sent_at,approved_at,changes_requested_at,changes_note,created_at,updated_at";
  const requests = [
    internal ? emptyRows() : fetch(`${base}/partner_comments?order_id=eq.${encodedId}&partner_id=eq.${encodeURIComponent(partner.id)}&select=id,comment,created_at&order=created_at.asc`, { headers }),
    fetch(`${base}/order_proofs?order_id=eq.${encodedId}&state=in.(sent,approved,changes_requested)&select=${proofSelect}&order=created_at.desc&limit=20`, { headers }),
    fetch(`${base}/order_permits?order_id=eq.${encodedId}&select=${permitSelect}&order=created_at.desc&limit=10`, { headers }),
    internal
      ? fetch(`${base}/order_payments?order_id=eq.${encodedId}&select=id,amount,currency,payment_type,reference,status,received_at,created_at&order=received_at.desc&limit=50`, { headers })
      : emptyRows(),
    internal ? fetch(`${base}/order_additional_options?order_id=eq.${encodedId}&select=id,name,description,cost&order=created_at.asc`, { headers }) : emptyRows(),
    internal
      ? fetch(`${base}/order_events?order_id=eq.${encodedId}&select=id,event_type,summary,detail,created_at&order=created_at.desc&limit=50`, { headers })
      : fetch(`${base}/order_events?order_id=eq.${encodedId}&event_type=in.(${WORKFLOW_EVENT_TYPES.join(",")})&select=event_type,created_at&order=created_at.desc&limit=50`, { headers }),
    fetch(`${base}/invoices?order_id=eq.${encodedId}&deleted_at=is.null&is_test=eq.false&select=id,invoice_number,customer_name,amount,status,due_date,issue_date,payment_date,stripe_status,paid_at,hosted_invoice_url,amount_paid,amount_remaining,intended_deposit_pence,locked_at&order=created_at.desc&limit=10`, { headers }),
  ];

  const responses = await Promise.all(requests);
  const [comments, proofs, permits, orderPayments, options, events, invoices] = await Promise.all(
    responses.map(async (res) => res.ok ? res.json() : []),
  );

  if (invoices.length === 0 && row.invoice_id) {
    const invoiceRes = await fetch(`${base}/invoices?id=eq.${encodeURIComponent(row.invoice_id)}&deleted_at=is.null&is_test=eq.false&select=id,invoice_number,customer_name,amount,status,due_date,issue_date,payment_date,stripe_status,paid_at,hosted_invoice_url,amount_paid,amount_remaining,intended_deposit_pence,locked_at&limit=1`, { headers });
    if (invoiceRes.ok) invoices.push(...await invoiceRes.json());
  }

  const ledgerPayments = await fetchLedgerPaymentsForInvoices(env, invoices);
  const payments = [...orderPayments, ...ledgerPayments];
  const latestProof = proofs[0] || null;
  const latestPermit = permits[0] || null;
  const evidence = { permits, invoices, payments, events, options };
  const order = mapOrder(row, workspace, evidence);
  return json({
    ok: true,
    workspace: publicWorkspace(workspace),
    order,
    comments,
    proofs,
    permits,
    payments: [
      ...orderPayments.map((payment) => ({ ...payment, amount: numberOrNull(payment.amount) })),
      ...ledgerPayments.map((payment) => ({
        id: payment.id,
        amount: payment.amount,
        status: payment.status,
        received_at: payment.received_at,
        reference: payment.reference,
        source: payment.source,
      })),
    ],
    options: options.map((option) => ({ ...option, cost: numberOrNull(option.cost) })),
    events,
    invoices: invoices.map(mapInvoice),
    workflow: deriveWorkflow(row, latestProof, latestPermit, invoices, payments, workspace, events),
  });
}

async function createOrder(env, partner, workspace, data) {
  const customerName = clean(data.customerName, 160);
  const customerEmail = clean(data.customerEmail, 254)?.toLowerCase();
  const customerPhone = clean(data.customerPhone, 60);
  const deceasedName = clean(data.deceasedName, 160);
  const productId = clean(data.productId, 80);
  const sizeId = clean(data.sizeId, 80);
  const cemeteryId = clean(data.cemeteryId, 80);
  const plotReference = clean(data.plotReference, 160);
  const material = clean(data.material, 120);
  const colour = clean(data.colour, 120);
  const inscriptionText = clean(data.inscriptionText, 4000);
  const inscriptionFont = clean(data.inscriptionFont, 120);
  const inscriptionLayout = clean(data.inscriptionLayout, 120);
  const notes = clean(data.notes, 3000);
  const billingParty = ["family", "partner"].includes(data.billingParty) ? data.billingParty : "family";

  if ([customerName, customerEmail, customerPhone, deceasedName, productId, sizeId, cemeteryId, plotReference, material, colour, inscriptionText, inscriptionFont, inscriptionLayout, notes].some((value) => value === null)) {
    return json({ ok: false, error: "One or more fields are invalid or too long" }, 400);
  }
  if (!customerName || !customerEmail || !deceasedName || !productId) {
    return json({ ok: false, error: "Customer, deceased and memorial details are required" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return json({ ok: false, error: "Enter a valid customer email address" }, 400);
  }
  if (!UUID_PATTERN.test(productId) || (sizeId && !UUID_PATTERN.test(sizeId)) || (cemeteryId && !UUID_PATTERN.test(cemeteryId))) {
    return json({ ok: false, error: "Select a valid memorial, size and cemetery" }, 400);
  }

  const headers = sbHeaders(env);
  let person;
  try {
    person = await upsertPerson(env, { name: customerName, email: customerEmail, phone: customerPhone });
  } catch (err) {
    console.error("Partner customer upsert failed", err);
    return json({ ok: false, error: "Unable to register the customer" }, 500);
  }
  if (!person) return json({ ok: false, error: "Unable to register the customer" }, 500);

  const orgFilter = env.SM_ORG_ID ? `&organization_id=eq.${encodeURIComponent(env.SM_ORG_ID)}` : "";
  const productRes = await fetch(`${env.SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&is_active=eq.true&is_listed=eq.true${orgFilter}&select=id,name,slug,sku,base_price,image_url,product_sizes(id,size_name,size_code,dimensions,price_adjustment,is_default)&limit=1`, { headers });
  if (!productRes.ok) return json({ ok: false, error: "Unable to verify the selected memorial" }, 500);
  const products = await productRes.json();
  if (products.length === 0) return json({ ok: false, error: "The selected memorial is no longer available" }, 409);
  const product = products[0];
  const sizes = product.product_sizes || [];
  const size = sizes.find((item) => item.id === sizeId) || sizes.find((item) => item.is_default) || sizes[0] || null;

  let cemetery = null;
  if (cemeteryId) {
    const cemeteryRes = await fetch(`${env.SUPABASE_URL}/rest/v1/cemeteries?id=eq.${encodeURIComponent(cemeteryId)}&is_active=eq.true${orgFilter}&select=id,name,address,postcode,permit_fee,processing_weeks&limit=1`, { headers });
    if (cemeteryRes.ok) cemetery = (await cemeteryRes.json())[0] || null;
  }

  const estimatedValue = (numberOrNull(product.base_price) || 0) + (numberOrNull(size?.price_adjustment) || 0);
  const config = {
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    size: size?.size_name || null,
    size_code: size?.size_code || null,
    dimensions: size?.dimensions || null,
    material: material || null,
    colour: colour || null,
    price: estimatedValue,
    cemetery: cemetery?.name || null,
    plot_reference: plotReference || null,
    billing_party: billingParty,
    submitted_by_partner: partner.company || partner.name,
    workspace_mode: workspace.mode,
  };

  const orderBody = {
    organization_id: env.SM_ORG_ID,
    // These three denormalised fields are still required by the current
    // orders contract; person_id remains the canonical contact link.
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone || null,
    person_id: person.id,
    person_name: deceasedName,
    order_type: "New Memorial",
    product_id: product.id,
    // Mason App currently treats orders.sku as the grave / plot reference.
    // Product identity is held by product_id and the snapshot config below.
    sku: plotReference || null,
    material: material || null,
    color: colour || null,
    value: estimatedValue || null,
    location: cemetery?.name || clean(data.location, 240) || null,
    cemetery_id: cemetery?.id || null,
    partner_id: partner.id,
    status: "pending",
    priority: "medium",
    notes: notes || null,
    product_config: JSON.stringify(config),
    inscription_text: inscriptionText || null,
    inscription_status: inscriptionText ? "received" : "pending",
    inscription_font: inscriptionFont || null,
    inscription_layout: inscriptionLayout || null,
    permit_status: "pending",
    stone_status: "NA",
    proof_status: "Not_Received",
    permit_fee: cemetery?.permit_fee || 0,
    is_test: false,
  };

  const orderRes = await fetch(`${env.SUPABASE_URL}/rest/v1/orders?select=*,people(id,first_name,last_name,email,phone,is_customer),jobs(stage,stage_status)`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify(orderBody),
  });
  if (!orderRes.ok) {
    console.error("Partner order insert failed", await orderRes.text());
    return json({ ok: false, error: "Unable to create the order" }, 500);
  }

  const created = (await orderRes.json())[0];

  // Create the workflow job only after the order exists. That ordering avoids
  // leaving an orphan production job if validation ever rejects the order.
  const jobRes = await fetch(`${env.SUPABASE_URL}/rest/v1/jobs`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({
      organization_id: env.SM_ORG_ID,
      person_id: person.id,
      source: "manual",
      stage: "enquired",
      stage_status: "Partner order submitted",
    }),
  });
  if (jobRes.ok) {
    const jobId = (await jobRes.json())[0]?.id || null;
    if (jobId) {
      created.job_id = jobId;
      await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(created.id)}`, {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ job_id: jobId }),
      });
    }
  } else {
    console.error("Partner order job insert failed", await jobRes.text());
  }
  const eventType = workspace.mode === "internal" ? "internal_order_submitted" : "partner_order_submitted";
  const eventSummary = workspace.mode === "internal"
    ? "Order created through the Sears Melvin workspace"
    : `Order submitted by ${partner.company || partner.name}`;
  await insertEvent(env, created, eventType, eventSummary, {
    partner_id: partner.id,
    actor_type: workspace.mode === "internal" ? "internal_shared" : "partner",
    ...actorFromStaff(workspace.staff),
  });
  return json({ ok: true, order: mapOrder(created, workspace), workspace: publicWorkspace(workspace) }, 201);
}

async function addComment(env, partner, workspace, data) {
  if (workspace.mode === "internal") {
    return json({ ok: false, error: "Internal notes are not connected yet" }, 409);
  }
  const orderId = clean(data.orderId, 80);
  const comment = clean(data.comment, 3000);
  if (!orderId || !comment) return json({ ok: false, error: "Order and comment are required" }, 400);
  if (!UUID_PATTERN.test(orderId)) return json({ ok: false, error: "Invalid order ID" }, 400);
  const order = await ownedOrder(env, partner, workspace, orderId, "id");
  if (!order) return json({ ok: false, error: "Order not found" }, 404);

  const headers = sbHeaders(env);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/partner_comments`, {
    method: "POST",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({ order_id: orderId, partner_id: partner.id, comment }),
  });
  if (!res.ok) return json({ ok: false, error: "Unable to add the message" }, 500);
  return json({ ok: true, comment: (await res.json())[0] });
}

async function updateProof(env, partner, workspace, data, nextState) {
  if (!workspace.proofDecisionEnabled) {
    return json({ ok: false, error: "Proof decisions are unavailable until authorised approvers are configured" }, 403);
  }
  const orderId = clean(data.orderId, 80);
  const note = clean(data.note, 2000);
  if (!orderId) return json({ ok: false, error: "Order is required" }, 400);
  if (!UUID_PATTERN.test(orderId)) return json({ ok: false, error: "Invalid order ID" }, 400);
  if (nextState === "changes_requested" && !note) {
    return json({ ok: false, error: "Describe the changes required" }, 400);
  }

  const order = await ownedOrder(env, partner, workspace, orderId, "id,organization_id");
  if (!order) return json({ ok: false, error: "Order not found" }, 404);
  const headers = sbHeaders(env);
  const proofRes = await fetch(`${env.SUPABASE_URL}/rest/v1/order_proofs?order_id=eq.${encodeURIComponent(orderId)}&state=eq.sent&select=id,state&order=created_at.desc&limit=1`, { headers });
  if (!proofRes.ok) return json({ ok: false, error: "Unable to load the proof" }, 500);
  const proof = (await proofRes.json())[0];
  if (!proof) return json({ ok: false, error: "No proof is ready for review" }, 409);
  const now = new Date().toISOString();
  const patch = nextState === "approved"
    // approved_by's current enum cannot represent a funeral director. Leave
    // it null and preserve the actual partner actor in order_events instead
    // of mislabelling them as staff or customer.
    ? { state: "approved", approved_at: now, approved_by: null, changes_requested_at: null, changes_note: null }
    : { state: "changes_requested", changes_requested_at: now, changes_note: note, approved_at: null, approved_by: null };

  const updateRes = await fetch(`${env.SUPABASE_URL}/rest/v1/order_proofs?id=eq.${proof.id}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!updateRes.ok) return json({ ok: false, error: "Unable to update the proof" }, 500);

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ inscription_status: nextState }),
  });
  await insertEvent(
    env,
    order,
    nextState === "approved" ? "proof_approved" : "proof_changes_requested",
    nextState === "approved"
      ? (workspace.mode === "internal" ? "Proof approved from the Sears Melvin internal workspace" : "Proof approved by partner")
      : (workspace.mode === "internal" ? "Sears Melvin requested proof changes" : "Partner requested proof changes"),
    {
      partner_id: partner.id,
      partner_name: partner.company || partner.name,
      actor_type: workspace.mode === "internal" ? "sears_melvin_internal_workspace" : "partner",
      ...(note ? { note } : {}),
      ...actorFromStaff(workspace.staff),
    },
  );

  return json({ ok: true, proof: (await updateRes.json())[0] });
}

async function recordSpecPreapproval(env, partner, workspace, data) {
  if (workspace.mode !== "internal") return json({ ok: false, error: "Only Sears Melvin can record cemetery pre-approval" }, 403);
  const orderId = clean(data.orderId, 80);
  const outcome = clean(data.outcome, 40);
  const method = clean(data.method, 20);
  const contact = clean(data.contact, 160);
  const note = clean(data.note, 2000);
  const confirmedException = data.confirmedException === true;
  if (!orderId || !UUID_PATTERN.test(orderId)) return json({ ok: false, error: "Select a valid order" }, 400);
  if (!['requested', 'approved', 'changes_required'].includes(outcome)) return json({ ok: false, error: "Select a valid pre-approval outcome" }, 400);
  if (!['phone', 'email'].includes(method) || !contact) return json({ ok: false, error: "Record how and with whom the cemetery check was made" }, 400);
  if (outcome === "changes_required" && !note) return json({ ok: false, error: "Describe the cemetery changes required" }, 400);

  const order = await ownedOrder(env, partner, workspace, orderId, "id,organization_id,product_id,custom_product_name,product_config,material,color,cemetery_id,location,sku,stone_status");
  if (!order) return json({ ok: false, error: "Order not found" }, 404);
  const afterMaterialOrder = ["Ordered", "In Stock"].includes(String(order.stone_status || ""));
  if (outcome === "changes_required" && afterMaterialOrder && !confirmedException) {
    return json({ ok: false, error: "Material is already committed. Confirm the exception and record the reason before continuing" }, 409);
  }

  const config = order.product_config ? safeParse(order.product_config) : null;
  const eventType = `spec_preapproval_${outcome}`;
  const summaries = {
    requested: "Cemetery physical-specification pre-approval requested",
    approved: "Cemetery approved the physical memorial specification",
    changes_required: afterMaterialOrder
      ? "Cemetery required a physical-specification change after material commitment"
      : "Cemetery required changes to the physical memorial specification",
  };
  const detail = {
    outcome,
    method,
    contact,
    ...(note ? { note } : {}),
    actor_type: "sears_melvin_internal_workspace",
    exception_after_material_order: Boolean(outcome === "changes_required" && afterMaterialOrder),
    ...actorFromStaff(workspace.staff),
    specification: {
      product_id: order.product_id || null,
      product_name: config?.name || order.custom_product_name || null,
      size: config?.size || null,
      dimensions: config?.dimensions || null,
      material: order.material || config?.material || null,
      colour: order.color || config?.colour || null,
      cemetery_id: order.cemetery_id || null,
      cemetery: config?.cemetery || order.location || null,
      plot_reference: config?.plot_reference || order.sku || null,
    },
  };
  const event = await insertEventStrict(env, order, eventType, summaries[outcome], detail);
  if (!event) return json({ ok: false, error: "Unable to record the cemetery decision" }, 500);
  return json({ ok: true, event });
}

async function updateMaterial(env, partner, workspace, data) {
  if (workspace.mode !== "internal") return json({ ok: false, error: "Only Sears Melvin can update material status" }, 403);
  const orderId = clean(data.orderId, 80);
  const nextStatus = clean(data.status, 40);
  if (!orderId || !UUID_PATTERN.test(orderId)) return json({ ok: false, error: "Select a valid order" }, 400);
  if (!["Ordered", "In Stock"].includes(nextStatus)) return json({ ok: false, error: "Select a valid material status" }, 400);

  const order = await ownedOrder(env, partner, workspace, orderId, "*,jobs(stage,stage_status,paid_at)");
  if (!order) return json({ ok: false, error: "Order not found" }, 404);
  const evidence = await getWorkflowEvidence(env, [orderId]);
  const orderEvidence = evidence.get(orderId) || {};
  const workflow = deriveWorkflow(
    order,
    null,
    (orderEvidence.permits || [])[0] || null,
    orderEvidence.invoices || [],
    orderEvidence.payments || [],
    workspace,
    orderEvidence.events || [],
  );
  if (nextStatus === "Ordered" && !workflow.materialDecisionReady) {
    return json({ ok: false, error: "Record payment and cemetery physical-specification approval before ordering material" }, 409);
  }
  if (nextStatus === "In Stock" && !["Ordered", "In Stock"].includes(String(order.stone_status || ""))) {
    return json({ ok: false, error: "Record the material as ordered before marking it received" }, 409);
  }

  const headers = sbHeaders(env);
  const alreadySet = String(order.stone_status || "") === nextStatus;
  if (!alreadySet) {
    const update = await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}${orderScopeQuery(workspace, partner)}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ stone_status: nextStatus }),
    });
    if (!update.ok || (await update.json()).length === 0) return json({ ok: false, error: "Unable to update material status" }, 500);
  }

  const eventType = nextStatus === "Ordered" ? "material_ordered" : "material_received";
  const matchingEvent = (orderEvidence.events || []).some((event) => event.event_type === eventType);
  if (!matchingEvent) {
    const event = await insertEventStrict(
      env,
      order,
      eventType,
      nextStatus === "Ordered" ? "Material ordered; internal production timeline started" : "Material received into stock",
      { actor_type: "sears_melvin_internal_workspace", previous_status: order.stone_status || "NA", new_status: nextStatus, ...actorFromStaff(workspace.staff) },
    );
    if (!event) return json({ ok: false, error: "Material status changed, but its activity entry could not be recorded. Retry to repair the history" }, 500);
  }

  if (nextStatus === "Ordered" && order.job_id && !["in_production", "fixed", "complete"].includes(String(order.jobs?.stage || ""))) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(order.job_id)}&organization_id=eq.${encodeURIComponent(workspace.organizationId)}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ stage: "in_production", stage_status: "Material ordered" }),
    });
  }
  return json({ ok: true, status: nextStatus });
}

async function setSalesFollowUp(env, workspace, data) {
  if (workspace.mode !== "internal") return json({ ok: false, error: "Sales follow-ups are restricted to Sears Melvin staff" }, 403);
  const jobId = clean(data.jobId, 80);
  const wakeAt = clean(data.wakeAt, 80);
  if (!jobId || !UUID_PATTERN.test(jobId) || !wakeAt) return json({ ok: false, error: "Select a valid sales record and follow-up date" }, 400);
  const timestamp = new Date(wakeAt);
  if (Number.isNaN(timestamp.getTime())) return json({ ok: false, error: "Select a valid follow-up date" }, 400);
  const max = Date.now() + 366 * 24 * 60 * 60 * 1000;
  if (timestamp.getTime() > max) return json({ ok: false, error: "Follow-up must be within the next year" }, 400);
  const headers = sbHeaders(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}&organization_id=eq.${encodeURIComponent(workspace.organizationId)}&stage=in.(enquired,quoted,invoiced)&exit_reason=is.null`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=representation" },
    body: JSON.stringify({ wake_at: timestamp.toISOString() }),
  });
  if (!response.ok || (await response.json()).length === 0) return json({ ok: false, error: "Unable to schedule the follow-up" }, 500);
  return json({ ok: true, wakeAt: timestamp.toISOString() });
}

async function updatePermit(env, partner, workspace, data) {
  if (workspace.mode !== "internal") return json({ ok: false, error: "Only Sears Melvin can record permit progress" }, 403);
  const orderId = clean(data.orderId, 80);
  const spineKey = clean(data.spineKey || data.phase, 40);
  const note = clean(data.note, 2000);
  const cemeteryRoute = clean(data.cemeteryRoute, 20);
  const cemeteryAddress = clean(data.cemeteryAddress, 240);
  if (!orderId || !UUID_PATTERN.test(orderId)) return json({ ok: false, error: "Select a valid order" }, 400);
  const step = PERMIT_SPINE_BY_KEY.get(spineKey) || PERMIT_SPINE_BY_STORED.get(spineKey);
  if (!step) return json({ ok: false, error: "Select a valid permit step" }, 400);
  if (step.key === "send_to_cemetery" && cemeteryRoute && !["email", "post"].includes(cemeteryRoute)) {
    return json({ ok: false, error: "Say whether the permit went by email or by post" }, 400);
  }
  if (step.key === "resolve_issues" && !note) {
    return json({ ok: false, error: "Describe the cemetery issue and how it is being resolved" }, 400);
  }

  const order = await ownedOrder(env, partner, workspace, orderId, "id,organization_id,permit_status");
  if (!order) return json({ ok: false, error: "Order not found" }, 404);

  const headers = sbHeaders(env);
  const existingRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/order_permits?order_id=eq.${encodeURIComponent(orderId)}&select=id,permit_phase,sent_at,returned_at,submitted_at,approved_at,notes&order=created_at.desc&limit=1`,
    { headers },
  );
  if (!existingRes.ok) return json({ ok: false, error: "Unable to load the permit record" }, 500);
  const existing = (await existingRes.json())[0] || null;
  const now = new Date().toISOString();
  const patch = {
    permit_phase: step.storedValue,
    ...(step.timestampField ? { [step.timestampField]: existing?.[step.timestampField] || now } : {}),
  };
  if (note || cemeteryRoute || cemeteryAddress) {
    const previousNotes = existing?.notes ? `${existing.notes}\n` : "";
    const extras = [
      note,
      cemeteryRoute ? `Sent to cemetery by ${cemeteryRoute}${cemeteryAddress ? ` · ${cemeteryAddress}` : ""}` : "",
    ].filter(Boolean).join(" · ");
    patch.notes = `${previousNotes}${extras}`.slice(0, 4000);
  }

  let permit;
  if (existing?.id) {
    const updateRes = await fetch(`${env.SUPABASE_URL}/rest/v1/order_permits?id=eq.${encodeURIComponent(existing.id)}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify(patch),
    });
    if (!updateRes.ok) return json({ ok: false, error: "Unable to update permit progress. The permit_phase value may need the pending enum migration." }, 500);
    permit = (await updateRes.json())[0] || null;
  } else {
    const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/order_permits`, {
      method: "POST",
      headers: { ...headers, "Prefer": "return=representation" },
      body: JSON.stringify({ order_id: orderId, ...patch }),
    });
    if (!insertRes.ok) return json({ ok: false, error: "Unable to create the permit record. The permit_phase value may need the pending enum migration." }, 500);
    permit = (await insertRes.json())[0] || null;
  }
  if (!permit) return json({ ok: false, error: "Unable to record permit progress" }, 500);

  await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}${orderScopeQuery(workspace, partner)}`, {
    method: "PATCH",
    headers: { ...headers, "Prefer": "return=minimal" },
    body: JSON.stringify({ permit_status: step.storedValue }),
  });

  const event = await insertEventStrict(
    env,
    order,
    "permit_phase_updated",
    `Permit: ${step.label}`,
    {
      actor_type: "sears_melvin_internal_workspace",
      spine_key: step.key,
      permit_phase: step.storedValue,
      previous_phase: existing?.permit_phase || order.permit_status || null,
      ...(note ? { note } : {}),
      ...(cemeteryRoute ? { cemetery_route: cemeteryRoute } : {}),
      ...(cemeteryAddress ? { cemetery_address: cemeteryAddress } : {}),
      ...actorFromStaff(workspace.staff),
    },
  );
  if (!event) return json({ ok: false, error: "Permit progress saved, but its activity entry could not be recorded. Retry to repair the history" }, 500);
  return json({ ok: true, permit, step: { key: step.key, label: step.label, storedValue: step.storedValue } });
}

async function requestPayment(env, partner, workspace, data) {
  const orderId = clean(data.orderId, 80);
  if (!orderId || !UUID_PATTERN.test(orderId)) return json({ ok: false, error: "Select a valid order" }, 400);
  const order = await ownedOrder(env, partner, workspace, orderId, "id,organization_id,job_id,status,stage,invoice_id,product_config,jobs(stage,stage_status,paid_at)");
  if (!order) return json({ ok: false, error: "Order not found" }, 404);

  const evidence = await getWorkflowEvidence(env, [orderId]);
  const orderEvidence = evidence.get(orderId) || {};
  const workflow = deriveWorkflow(
    order,
    null,
    (orderEvidence.permits || [])[0] || null,
    orderEvidence.invoices || [],
    orderEvidence.payments || [],
    workspace,
    orderEvidence.events || [],
  );
  if (workflow.paymentConfirmed) {
    return json({ ok: false, error: "Payment is already recorded for this order" }, 409);
  }

  const headers = sbHeaders(env);
  const alreadyRequested = (orderEvidence.events || []).some((event) => event.event_type === "payment_requested");
  if (!alreadyRequested) {
    const event = await insertEventStrict(
      env,
      order,
      "payment_requested",
      "Payment requested — raise the invoice in the admin app / Make. This portal does not create or email invoices.",
      {
        partner_id: partner.id,
        actor_type: workspace.mode === "internal" ? "sears_melvin_internal_workspace" : "partner",
        billing_party: safeParse(order.product_config)?.billing_party || null,
        ...actorFromStaff(workspace.staff),
      },
    );
    if (!event) return json({ ok: false, error: "Unable to record the payment request" }, 500);
  }

  const jobStage = String(order.jobs?.stage || "");
  if (order.job_id && ["enquired", "quoted"].includes(jobStage)) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/jobs?id=eq.${encodeURIComponent(order.job_id)}&organization_id=eq.${encodeURIComponent(workspace.organizationId)}`, {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify({ stage: "invoiced", stage_status: "Payment requested from partner portal" }),
    });
  }

  return json({
    ok: true,
    invoicing: "external",
    message: "Payment requested. Sears Melvin raises the invoice in the admin app / Make. This website does not create, send or email invoices, and does not take the card payment from this screen.",
  });
}

async function ownedOrder(env, partner, workspace, orderId, select) {
  const headers = sbHeaders(env);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=${select}&limit=1${orderScopeQuery(workspace, partner)}`, { headers });
  if (!res.ok) return null;
  return (await res.json())[0] || null;
}

async function insertEvent(env, order, eventType, summary, detail = {}) {
  try {
    await insertEventStrict(env, order, eventType, summary, detail);
  } catch (err) {
    console.error("Partner order event failed", err);
  }
}

async function insertEventStrict(env, order, eventType, summary, detail = {}) {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/order_events`, {
      method: "POST",
      headers: { ...sbHeaders(env), "Prefer": "return=representation" },
      body: JSON.stringify({ order_id: order.id, event_type: eventType, summary, detail }),
    });
    if (!response.ok) return null;
    return (await response.json())[0] || null;
  } catch (err) {
    console.error("Partner order event failed", err);
    return null;
  }
}

function mapOrder(row, workspace = { mode: "partner", actionOwner: "partner" }, evidence = {}) {
  const config = row.product_config ? safeParse(row.product_config) : null;
  const latestProof = (row.order_proofs || []).slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;
  const stage = derivePortalStage(row, latestProof);
  const latestPermit = (evidence.permits || []).slice().sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")))[0] || null;
  const workflow = deriveWorkflow(row, latestProof, latestPermit, evidence.invoices || [], evidence.payments || [], workspace, evidence.events || []);
  const action = deriveAction(row, stage, latestProof, workspace, workflow);
  const commercialValue = (numberOrNull(row.value) || 0)
    + (numberOrNull(row.renovation_service_cost) || 0)
    + (evidence.options || []).reduce((sum, option) => sum + (numberOrNull(option.cost) || 0), 0);
  return {
    id: row.id,
    ref: row.order_number ? `ORD-${String(row.order_number).padStart(6, "0")}` : `SM-${String(row.id).slice(0, 8).toUpperCase()}`,
    orderNumber: row.order_number || null,
    partnerId: row.partner_id || null,
    origin: row.partner_id ? (workspace.mode === "internal" ? "Sears Melvin workspace" : "Partner") : "Sears Melvin direct",
    customerName: [row.people?.first_name, row.people?.last_name].filter(Boolean).join(" ") || null,
    customerEmail: row.people?.email || null,
    customerPhone: row.people?.phone || null,
    deceasedName: row.person_name || null,
    product: config?.name || row.custom_product_name || row.sku || null,
    productId: row.product_id || null,
    productImageUrl: row.product_photo_url || null,
    material: row.material || config?.material || null,
    colour: row.color || config?.colour || null,
    size: config?.size || null,
    cemetery: config?.cemetery || row.location || null,
    cemeteryId: row.cemetery_id || null,
    plotReference: config?.plot_reference || null,
    billingParty: config?.billing_party || null,
    location: row.location || null,
    value: commercialValue,
    permitFee: numberOrNull(row.permit_fee),
    totalPayable: commercialValue + (numberOrNull(row.permit_fee) || 0),
    status: row.status || "pending",
    stage,
    stageStatus: row.jobs?.stage_status || null,
    progress: row.progress || 0,
    priority: row.priority || "medium",
    proofStatus: latestProof?.state || row.proof_status || "Not_Received",
    permitStatus: row.permit_status || "pending",
    stoneStatus: row.stone_status || "NA",
    inscriptionText: row.inscription_text || config?.inscription || null,
    inscriptionStatus: row.inscription_status || "pending",
    inscriptionFont: row.inscription_font || null,
    inscriptionLayout: row.inscription_layout || null,
    proofUrl: latestProof?.render_url || row.proof_url || null,
    estimatedCompletion: row.estimated_completion || null,
    dueDate: row.due_date || null,
    installationDate: row.installation_date || null,
    notes: workspace.mode === "internal" ? row.notes || null : null,
    workflow,
    nextAction: action.label,
    actionOwner: action.owner,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    confirmedAt: workflow.confirmedAt,
  };
}

function deriveStage(row) {
  if (row.status === "completed") return "complete";
  if (row.installation_date) return "installation";
  if (["Ordered", "In Stock"].includes(row.stone_status)) return "in_production";
  if (row.deposit_date) return "confirmed";
  if (row.proof_url || row.inscription_status === "proof_ready") return "proof_approval";
  return "submitted";
}

function derivePortalStage(row, latestProof) {
  const jobStage = row.jobs?.stage;
  if (jobStage === "complete") return "complete";
  if (jobStage === "fixed") return "installation";
  if (jobStage === "in_production") return "in_production";
  if (jobStage === "confirmed") return "confirmed";
  // Proof state is more informative to a partner than the broad early sales
  // stages (enquired / quoted / invoiced).
  if (latestProof?.render_url || latestProof?.state === "sent" || row.proof_url || row.inscription_status === "proof_ready") return "proof_approval";
  return deriveStage(row);
}

function deriveAction(row, stage, latestProof, workspace, workflow) {
  if (stage === "complete") return { owner: "none", label: "Complete" };
  const proofState = latestProof?.state || row.inscription_status;
  if (workspace.mode === "internal") {
    if (workflow?.specification?.state === "attention") return { owner: "team", label: workflow.specification.summary };
    if (["not_started", "in_progress"].includes(workflow?.specification?.state)) return { owner: "team", label: workflow.specification.summary };
    if (!workflow?.paymentConfirmed) return { owner: "external", label: workflow?.commercial?.summary || "Request payment to start the customer timeline" };
    if (workflow?.material?.state === "decision_required") return { owner: "team", label: "Order material against the cemetery-approved specification" };
    if (proofState === "changes_requested") return { owner: "team", label: "Revise the inscription proof" };
    if ((latestProof?.render_url || row.proof_url) && !["approved", "changes_requested"].includes(proofState)) {
      return workspace.proofDecisionEnabled
        ? { owner: "team", label: "Review inscription proof" }
        : { owner: "external", label: "Inscription proof awaits the authorised approver" };
    }
    if (workflow?.permit?.state !== "complete") return { owner: "team", label: workflow?.permit?.summary || "Permit information outstanding" };
    if (stage === "in_production") return { owner: "team", label: "Monitor production progress" };
    if (stage === "installation") return { owner: "team", label: "Confirm installation arrangements" };
    return { owner: "team", label: "Review order specification" };
  }
  if ((latestProof?.render_url || row.proof_url) && !["approved", "changes_requested"].includes(proofState)) {
    return workspace.proofDecisionEnabled
      ? { owner: "partner", label: "Review inscription proof" }
      : { owner: "partner", label: "Confirm the authorised proof approver with Sears Melvin" };
  }
  if (proofState === "changes_requested") return { owner: "sm", label: "Sears Melvin is revising the proof" };
  if (workflow?.permit?.state !== "complete") return { owner: "partner", label: workflow?.permit?.summary || "Confirm permit responsibility with Sears Melvin" };
  if (stage === "in_production") return { owner: "sm", label: "Memorial is in production" };
  if (stage === "installation") return { owner: "sm", label: "Installation is being arranged" };
  return { owner: "sm", label: "Sears Melvin is reviewing the order" };
}

/**
 * Map live order_permits.permit_phase / orders.permit_status values onto the
 * 7-step spine. Old stored values still display; new writes use storedValue.
 */
export function mapPermitPhase(rawPhase, latestPermit = null) {
  const stored = String(rawPhase || latestPermit?.permit_phase || "pending").toLowerCase();
  const step = PERMIT_SPINE_BY_STORED.get(stored) || PERMIT_SPINE[0];
  const currentIndex = PERMIT_SPINE.findIndex((item) => item.key === step.key);
  const approved = stored === "approved"
    || stored === "not_required"
    || (Boolean(latestPermit?.approved_at) && stored !== "resolve_issues" && stored !== "rejected");
  const steps = PERMIT_SPINE.map((item, index) => {
    const timestamp = item.timestampField ? latestPermit?.[item.timestampField] || null : null;
    let state = "upcoming";
    if (approved || index < currentIndex) state = "complete";
    else if (index === currentIndex) state = "current";
    return {
      key: item.key,
      label: item.label,
      storedValue: item.storedValue,
      state,
      timestamp,
    };
  });
  return {
    stored,
    step,
    currentIndex,
    approved,
    steps,
  };
}

function invoiceLooksPaid(invoice) {
  const status = String(invoice?.status || "").toLowerCase();
  const stripe = String(invoice?.stripe_status || "").toLowerCase();
  if (PAID_INVOICE_STATUSES.has(status) || PAID_STRIPE_STATUSES.has(stripe)) return true;
  if (invoice?.paid_at || invoice?.payment_date) return true;
  if (Number(invoice?.amount_paid) > 0) return true;
  return false;
}

export function deriveWorkflow(row, latestProof = null, latestPermit = null, invoices = [], payments = [], workspace = { mode: "partner", proofDecisionEnabled: false }, events = []) {
  const config = row.product_config ? safeParse(row.product_config) : null;
  const proofState = String(latestProof?.state || row.inscription_status || row.proof_status || "not_started").toLowerCase();
  const proofApproved = proofState === "approved" || Boolean(latestProof?.approved_at);
  const permitPhase = String(latestPermit?.permit_phase || row.permit_status || "pending").toLowerCase();
  const permitView = mapPermitPhase(permitPhase, latestPermit);
  const permitApproved = permitView.approved;
  const stoneState = String(row.stone_status || "NA");
  const jobStage = String(row.jobs?.stage || row.stage || "").toLowerCase();
  const complete = row.status === "completed" || ["complete", "completed"].includes(jobStage);
  const installed = complete || jobStage === "fixed";
  const specificationReady = Boolean(row.person_name && (row.product_id || row.custom_product_name || config?.name) && (row.cemetery_id || row.location));
  const liveInvoices = (invoices || []).filter((invoice) => !invoice.deleted_at);
  const invoicePaid = liveInvoices.some(invoiceLooksPaid);
  const recordedPayment = (payments || []).some((payment) => PAID_PAYMENT_STATUSES.has(String(payment.status || "").toLowerCase()));
  const paymentConfirmed = invoicePaid
    || recordedPayment
    || Boolean(row.jobs?.paid_at || row.deposit_date || row.second_payment_date)
    || PAID_ORDER_STAGES.has(String(row.stage || "").toLowerCase())
    || PAID_ORDER_STATUSES.has(String(row.status || "").toLowerCase())
    || ["confirmed", "in_production", "fixed", "complete"].includes(jobStage);
  const paymentRequested = (events || []).some((event) => event.event_type === "payment_requested");
  const paymentDates = [
    row.jobs?.paid_at,
    row.deposit_date,
    row.second_payment_date,
    ...liveInvoices.map((invoice) => invoice.paid_at || invoice.payment_date),
    ...(payments || [])
      .filter((payment) => PAID_PAYMENT_STATUSES.has(String(payment.status || "").toLowerCase()))
      .map((payment) => payment.received_at || payment.date),
  ].filter(Boolean).sort();
  const confirmedAt = paymentDates[0] || null;
  const latestSpecEvent = (events || [])
    .filter((event) => SPEC_PREAPPROVAL_EVENTS.has(event.event_type))
    .slice()
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;
  const specPreapprovalState = latestSpecEvent?.event_type?.replace("spec_preapproval_", "") || "not_started";
  const specPreapprovalApproved = specPreapprovalState === "approved";
  const materialDecisionReady = paymentConfirmed && specificationReady && specPreapprovalApproved;
  const materialException = specPreapprovalState === "changes_required" && ["Ordered", "In Stock"].includes(stoneState);
  const permitOwner = workspace.mode === "partner" ? "partner" : "team";
  const specSummary = !specificationReady
    ? "Complete the physical memorial and cemetery details before requesting pre-approval."
    : (specPreapprovalApproved
      ? "The cemetery has approved the physical memorial specification for material ordering."
      : (specPreapprovalState === "requested"
        ? "Cemetery physical-specification pre-approval is awaiting a response."
        : (specPreapprovalState === "changes_required"
          ? "The cemetery requires a physical-specification change and resubmission."
          : "Contact the cemetery for physical-specification pre-approval. This can start before payment.")));
  const specState = !specificationReady
    ? "attention"
    : (specPreapprovalApproved ? "complete" : (specPreapprovalState === "requested" ? "in_progress" : (specPreapprovalState === "changes_required" ? "attention" : "not_started")));

  const specification = {
    key: "specification",
    label: "Cemetery specification",
    state: specState,
    owner: "team",
    summary: specSummary,
    outcome: specPreapprovalState,
    decidedAt: latestSpecEvent?.created_at || null,
    actionAvailable: workspace.mode === "internal" && specificationReady,
  };
  const permitInProgress = !permitApproved && PERMIT_SPINE.some((item) => item.storedValue === permitView.stored || item.aliases.includes(permitView.stored)) && permitView.stored !== "pending";
  const permit = {
    key: "permit",
    label: "Cemetery permit",
    state: permitApproved ? "complete" : (permitInProgress ? "in_progress" : "attention"),
    owner: permitOwner,
    summary: permitApproved
      ? "Permit approval is recorded."
      : `${permitView.step.label}. ${workspace.mode === "partner" ? "Sears Melvin records progress; funeral directors can see the current step." : "Record the next permit step. Tracking is status and email, not file upload."}`,
    uploadAvailable: false,
    actionAvailable: workspace.mode === "internal" && !permitApproved,
    phase: permitView.stored,
    spineKey: permitView.step.key,
    spineLabel: permitView.step.label,
    steps: permitView.steps,
  };
  const proof = {
    key: "proof",
    label: "Design proof",
    state: proofApproved ? "complete" : (proofState === "changes_requested" ? "attention" : (["sent", "draft", "generating", "proof_ready", "awaiting_approval"].includes(proofState) ? "in_progress" : "not_started")),
    owner: proofApproved ? "none" : (proofState === "changes_requested" ? "team" : (workspace.mode === "internal" ? "team" : "authorised_approver")),
    summary: proofApproved ? "The current proof is approved." : (proofState === "changes_requested" ? "Proof changes have been requested." : (proofState === "sent" ? "The proof is awaiting an authorised decision." : "A final proof decision has not been recorded.")),
    decisionAvailable: Boolean(workspace.proofDecisionEnabled && latestProof?.state === "sent" && (latestProof?.render_url || workspace.mode === "internal")),
  };
  const material = {
    key: "material",
    label: "Material decision",
    state: materialException ? "attention" : (stoneState === "In Stock" ? "complete" : (stoneState === "Ordered" ? "in_progress" : (materialDecisionReady ? "decision_required" : "blocked"))),
    owner: "team",
    summary: materialException ? "Cemetery changes were recorded after material commitment. Review cost, feasibility and customer impact immediately." : (stoneState === "In Stock" ? "Material is recorded as received and in stock." : (stoneState === "Ordered" ? "Material is ordered; the internal production timeline has started." : (materialDecisionReady ? "Payment and cemetery physical-specification approval are recorded; material can be ordered." : "Material ordering is blocked until payment and cemetery physical-specification approval are recorded."))),
    prerequisitesMet: materialDecisionReady,
    locked: stoneState === "Ordered" || stoneState === "In Stock",
    actionAvailable: workspace.mode === "internal" && materialDecisionReady && !["Ordered", "In Stock"].includes(stoneState),
    receiveAvailable: workspace.mode === "internal" && stoneState === "Ordered",
    exception: materialException,
  };
  const production = {
    key: "production",
    label: "Production",
    state: complete || installed ? "complete" : (jobStage === "in_production" ? "in_progress" : (stoneState === "Ordered" || stoneState === "In Stock" ? "ready" : "blocked")),
    owner: "team",
    summary: jobStage === "in_production" ? "Production is underway." : (complete || installed ? "Production work is complete." : "Production follows the confirmed material decision."),
  };
  const installation = {
    key: "installation",
    label: "Installation handoff",
    state: complete ? "complete" : (row.installation_date ? "scheduled" : (permitApproved && proofApproved && (jobStage === "in_production" || stoneState === "In Stock") ? "ready" : "blocked")),
    owner: "team",
    summary: complete ? "The order is recorded as complete." : (row.installation_date ? "An installation date is recorded." : (!permitApproved ? "Formal cemetery permission is required before installation." : (!proofApproved ? "The inscription proof must be final before lettering and installation." : "Complete production and confirm fixing arrangements before scheduling."))),
  };
  const commercial = {
    key: "commercial",
    label: "Payment & confirmation",
    state: paymentConfirmed ? "complete" : (liveInvoices.length ? "in_progress" : "not_started"),
    owner: "commercial",
    summary: paymentConfirmed
      ? "The required payment is recorded and the live order workflow has started."
      : (liveInvoices.length
        ? "An invoice is issued; payment will confirm the live order."
        : (paymentRequested
          ? "Payment has been requested. Sears Melvin raises the invoice in the admin app / Make; this portal does not email the family."
          : "No invoice is linked yet. Create the order first, then request payment as a separate action.")),
    invoiceCount: liveInvoices.length,
    confirmedAt,
    paymentRequested,
    requestAvailable: !paymentConfirmed,
  };

  return {
    lanes: [commercial, specification, permit, proof, material, production, installation],
    specification,
    permit,
    proof,
    material,
    production,
    installation,
    commercial,
    materialDecisionReady,
    paymentConfirmed,
    confirmedAt,
    materialLockEnforced: material.locked,
    blockingKeys: [commercial, specification, permit, proof, material, production, installation]
      .filter((item) => ["attention", "blocked", "not_started"].includes(item.state))
      .map((item) => item.key),
  };
}

function mapInvoice(invoice) {
  return {
    id: invoice.id,
    number: invoice.invoice_number,
    addressee: invoice.customer_name,
    amount: numberOrNull(invoice.amount),
    status: invoice.status,
    stripeStatus: invoice.stripe_status,
    dueDate: invoice.due_date,
    issueDate: invoice.issue_date,
    paidAt: invoice.paid_at || invoice.payment_date || null,
    hostedUrl: invoice.hosted_invoice_url || null,
    amountPaidPence: invoice.amount_paid || 0,
    amountRemainingPence: invoice.amount_remaining,
    intendedDepositPence: invoice.intended_deposit_pence,
    locked: Boolean(invoice.locked_at),
  };
}

async function getPartnerFromToken(env, token) {
  const headers = sbHeaders(env);
  const now = new Date().toISOString();
  const tokenHash = await hashOpaqueToken(token);
  const sessions = await findPartnerSession(env, tokenHash, now, headers);
  if (sessions === null) return null;
  if (sessions.length === 0) return null;
  const partnerRes = await fetch(`${env.SUPABASE_URL}/rest/v1/partners?id=eq.${sessions[0].partner_id}&active=eq.true&status=eq.approved&select=id,email,name,company,phone,status&limit=1`, { headers });
  if (!partnerRes.ok) return null;
  const partner = (await partnerRes.json())[0] || null;
  if (!partner) return null;
  partner.staff = publicStaff(staffFromSessionToken(token));
  return partner;
}

function publicPartner(partner) {
  return {
    id: partner.id,
    name: partner.name,
    company: partner.company,
    email: partner.email,
    phone: partner.phone || null,
    staff: publicStaff(partner.staff),
  };
}

function getWorkspace(env, partner) {
  // Fail closed if the internal partner mapping is not configured: no partner
  // should silently gain the broader internal order scope.
  const internalPartnerId = String(env.SM_INTERNAL_PARTNER_ID || "").trim();
  const internal = String(partner.id) === internalPartnerId;
  const staff = publicStaff(partner.staff);
  const proofDecisionEnabled = internal || String(env.PARTNER_PROOF_DECISIONS_ENABLED || "").toLowerCase() === "true";
  return {
    mode: internal ? "internal" : "partner",
    organizationId: env.SM_ORG_ID,
    actionOwner: internal ? "team" : "partner",
    includesExternalPartnerOrders: false,
    proofDecisionEnabled,
    staff,
  };
}

function orderScopeQuery(workspace, partner) {
  if (workspace.mode !== "internal") {
    return `&organization_id=eq.${encodeURIComponent(workspace.organizationId)}&is_test=eq.false&partner_id=eq.${encodeURIComponent(partner.id)}`;
  }
  const ownOrDirect = encodeURIComponent(`(partner_id.is.null,partner_id.eq.${partner.id})`);
  return `&organization_id=eq.${encodeURIComponent(workspace.organizationId)}&is_test=eq.false&or=${ownOrDirect}`;
}

function publicWorkspace(workspace) {
  return {
    mode: workspace.mode,
    label: workspace.mode === "internal" ? "Sears Melvin internal" : "Funeral director partner",
    staff: publicStaff(workspace.staff),
    capabilities: {
      viewExternalPartnerOrders: Boolean(workspace.includesExternalPartnerOrders),
      decideProof: Boolean(workspace.proofDecisionEnabled),
      sendPartnerMessage: workspace.mode !== "internal",
      uploadPermit: false,
      recordSpecPreapproval: workspace.mode === "internal",
      recordPermitProgress: workspace.mode === "internal",
      requestPayment: true,
      updateMaterial: workspace.mode === "internal",
      scheduleSalesFollowUp: workspace.mode === "internal",
      lockMaterial: workspace.mode === "internal",
      manageNamedUsers: false,
    },
  };
}

function searchableOrderText(row) {
  const config = row.product_config ? safeParse(row.product_config) : null;
  return [row.order_number, row.person_name, row.people?.first_name, row.people?.last_name, row.people?.email, config?.name, row.sku, row.location]
    .filter(Boolean).join(" ").toLowerCase();
}

async function hashOpaqueToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return "sha256:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return "";
}

async function findPartnerSession(env, token, now, headers) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/partner_sessions?token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(now)}&select=partner_id&limit=1`,
    { headers },
  );
  return response.ok ? response.json() : null;
}

function clean(value, maxLength) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length <= maxLength ? cleaned : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function sbHeaders(env) {
  return supabaseHeaders(env);
}

function json(data, status = 200, extraHeaders = {}) {
  return hardenedJson(data, status, extraHeaders);
}
