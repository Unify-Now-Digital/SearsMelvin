/**
 * Quotes API — /api/quotes
 *
 * GET  ?token=xxx        → retrieve a single quote by edit token
 * GET  ?email=xxx        → retrieve all quotes for an email address
 * POST { token, product } → update a quote's product configuration
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ ok: false, error: "Server configuration error" }, 500);
  }

  const url = new URL(request.url);

  if (request.method === "GET") {
    const token = url.searchParams.get("token");
    const email = url.searchParams.get("email");

    if (token) {
      return getQuoteByToken(env, token);
    }
    if (email) {
      return getQuotesByEmail(env, email);
    }
    return json({ ok: false, error: "Missing token or email parameter" }, 400);
  }

  if (request.method === "POST") {
    let data;
    try { data = await request.json(); }
    catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
    return updateQuote(env, data);
  }

  return json({ ok: false, error: "Method not allowed" }, 405);
}

async function getQuoteByToken(env, token) {
  const headers = sbHeaders(env);
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?edit_token=eq.${encodeURIComponent(token)}&order_type=eq.quote&select=*&limit=1`,
    { headers },
  );
  if (!res.ok) return json({ ok: false, error: "Database error" }, 500);
  const rows = await res.json();
  if (rows.length === 0) return json({ ok: false, error: "Quote not found" }, 404);
  const order = rows[0];
  return json({
    ok: true,
    quote: {
      id: order.id,
      name: order.customer_name,
      email: order.customer_email,
      phone: order.customer_phone,
      location: order.location,
      product: order.product_config ? safeParse(order.product_config) : null,
      value: order.value,
      notes: order.notes || null,
      status: order.status || "pending",
      created_at: order.created_at,
    },
  });
}

async function getQuotesByEmail(env, email) {
  const headers = sbHeaders(env);
  // Select only core columns that always exist — use select=* to be resilient
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?customer_email=eq.${encodeURIComponent(email)}&order_type=eq.quote&select=*&order=created_at.desc&limit=20`,
    { headers },
  );
  if (!res.ok) {
    // If query fails, try without order_type filter (column may not exist or no quotes)
    const fallbackRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/orders?customer_email=eq.${encodeURIComponent(email)}&select=*&order=created_at.desc&limit=20`,
      { headers },
    );
    if (!fallbackRes.ok) {
      const errText = await fallbackRes.text();
      return json({ ok: false, error: "Database error", detail: errText }, 500);
    }
    const allRows = await fallbackRes.json();
    // Filter to quotes client-side
    const rows = allRows.filter(r => r.order_type === "quote");
    return json({ ok: true, quotes: rows.map(mapOrderToQuote) });
  }
  const rows = await res.json();
  return json({ ok: true, quotes: rows.map(mapOrderToQuote) });
}

function mapOrderToQuote(order) {
  return {
    id: order.id,
    name: order.customer_name,
    product: order.sku || null,
    colour: order.color || null,
    value: order.value,
    location: order.location || null,
    status: order.status || "pending",
    notes: order.notes || null,
    created_at: order.created_at,
    config: order.product_config ? safeParse(order.product_config) : null,
  };
}

async function updateQuote(env, data) {
  const { token, product, message } = data;
  if (!token) return json({ ok: false, error: "Missing edit token" }, 400);

  const headers = sbHeaders(env);

  // Verify token exists
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?edit_token=eq.${encodeURIComponent(token)}&order_type=eq.quote&select=id&limit=1`,
    { headers },
  );
  if (!checkRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const checkRows = await checkRes.json();
  if (checkRows.length === 0) return json({ ok: false, error: "Quote not found" }, 404);

  const orderId = checkRows[0].id;
  const updates = {};
  if (product) {
    updates.product_config = JSON.stringify(product);
    if (product.name) updates.sku = product.name;
    if (product.colour) updates.color = product.colour;
    if (product.price) updates.value = parseFloat(product.price);
    if (product.permit_fee !== undefined) updates.permit_fee = parseFloat(product.permit_fee) || 0;
    if (product.inscription) updates.inscription_text = product.inscription;
  }
  if (message !== undefined) updates.notes = message;
  updates.updated_at = new Date().toISOString();

  const patchRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`,
    {
      method: "PATCH",
      headers: { ...headers, "Prefer": "return=minimal" },
      body: JSON.stringify(updates),
    },
  );
  if (!patchRes.ok) return json({ ok: false, error: "Failed to update quote" }, 500);

  // Sync invoice amount if product price changed
  if (product && product.price) {
    const newAmount = parseFloat(product.price) + parseFloat(product.permit_fee || 0);
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/invoices?order_id=eq.${orderId}&status=eq.pending`,
      {
        method: "PATCH",
        headers: { ...headers, "Prefer": "return=minimal" },
        body: JSON.stringify({ amount: newAmount }),
      },
    );
  }

  return json({ ok: true });
}

function sbHeaders(env) {
  return {
    "apikey": env.SUPABASE_SERVICE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}

function safeParse(str) {
  try { return JSON.parse(str); }
  catch { return null; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
