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
    `${env.SUPABASE_URL}/rest/v1/orders?edit_token=eq.${encodeURIComponent(token)}&order_type=eq.quote&select=*,people(first_name,last_name,email,phone)&limit=1`,
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
      name: [order.people?.first_name, order.people?.last_name].filter(Boolean).join(" ") || null,
      email: order.people?.email || null,
      phone: order.people?.phone || null,
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
  const normalised = email.trim().toLowerCase();
  // Filter on the embedded `people.email` via PostgREST resource embedding.
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?order_type=eq.quote&select=*,people!inner(first_name,last_name,email,phone)&people.email=eq.${encodeURIComponent(normalised)}&order=created_at.desc&limit=20`,
    { headers },
  );
  if (!res.ok) {
    const errText = await res.text();
    return json({ ok: false, error: "Database error", detail: errText }, 500);
  }
  const rows = await res.json();
  return json({ ok: true, quotes: rows.map(mapOrderToQuote) });
}

function mapOrderToQuote(order) {
  return {
    id: order.id,
    name: [order.people?.first_name, order.people?.last_name].filter(Boolean).join(" ") || null,
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

  // Verify token exists and fetch full order for email notifications
  const checkRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?edit_token=eq.${encodeURIComponent(token)}&order_type=eq.quote&select=*,people(first_name,last_name,email,phone)&limit=1`,
    { headers },
  );
  if (!checkRes.ok) return json({ ok: false, error: "Database error" }, 500);
  const checkRows = await checkRes.json();
  if (checkRows.length === 0) return json({ ok: false, error: "Quote not found" }, 404);

  const order = checkRows[0];
  const orderId = order.id;
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

  // Send notification emails about the update
  if (env.RESEND_API_KEY) {
    const customerName = [order.people?.first_name, order.people?.last_name].filter(Boolean).join(" ");
    const customerEmail = order.people?.email || "";
    const productName = (product && product.name) || order.sku || "Memorial";
    const changes = buildChangesSummary(order, product, message);

    // Notify the business
    try {
      await sendEmail(env.RESEND_API_KEY, {
        from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
        to: "info@searsmelvin.co.uk",
        subject: `Quote updated by customer — ${customerName || customerEmail}`,
        html: quoteUpdateBusinessEmail({ name: customerName, email: customerEmail, productName, changes }),
      });
    } catch (err) {
      console.error("Quote update business email failed:", err);
    }

    // Confirm to the customer
    if (customerEmail) {
      try {
        await sendEmail(env.RESEND_API_KEY, {
          from: "Sears Melvin Memorials <info@searsmelvin.co.uk>",
          to: customerEmail,
          subject: "Your quote has been updated — Sears Melvin Memorials",
          html: quoteUpdateCustomerEmail({ firstName: customerName.split(" ")[0] || "there", productName, changes }),
        });
      } catch (err) {
        console.error("Quote update customer email failed:", err);
      }
    }
  }

  return json({ ok: true });
}

function buildChangesSummary(order, product, message) {
  const lines = [];
  const oldConfig = order.product_config ? safeParse(order.product_config) : {};
  if (product) {
    if (product.colour && product.colour !== (oldConfig.colour || order.color)) lines.push(`Stone colour → ${product.colour}`);
    if (product.size && product.size !== oldConfig.size) lines.push(`Size → ${product.size}`);
    if (product.font && product.font !== oldConfig.font) lines.push(`Font → ${product.font === 'script' ? 'Script' : 'Traditional'}`);
    if (product.letterColour && product.letterColour !== oldConfig.letterColour) lines.push(`Lettering → ${product.letterColour}`);
    if (product.inscription !== undefined && product.inscription !== oldConfig.inscription) lines.push(`Inscription updated`);
  }
  if (message !== undefined && message !== (order.notes || "")) lines.push(`Notes updated`);
  return lines.length > 0 ? lines : ["Quote details updated"];
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

function esc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

function quoteUpdateBusinessEmail({ name, email, productName, changes }) {
  const changeList = changes.map(c => `<li style="padding:3px 0;color:#1A1A1A;">${esc(c)}</li>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <tr><td style="background:#2C2C2C;padding:18px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;">Memorials</span></span></td>
      <td align="right"><span style="background:#8B7355;color:#fff;padding:4px 11px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Quote Updated</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px 28px;">
    <h2 style="font-family:Georgia,serif;font-size:20px;color:#2C2C2C;font-weight:normal;margin:0 0 16px;">Customer Updated Their Quote</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:16px;">
      <tr><td style="color:#999;padding:5px 0;width:100px;">Customer</td><td style="color:#1A1A1A;font-weight:600;">${esc(name || "—")}</td></tr>
      <tr><td style="color:#999;padding:5px 0;">Email</td><td><a href="mailto:${esc(email)}" style="color:#8B7355;">${esc(email || "—")}</a></td></tr>
      <tr><td style="color:#999;padding:5px 0;">Memorial</td><td style="color:#1A1A1A;">${esc(productName)}</td></tr>
    </table>
    <div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;">
      <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:8px;">Changes Made</div>
      <ul style="margin:0;padding:0 0 0 16px;font-size:13px;">${changeList}</ul>
    </div>
  </td></tr>
  <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:12px 28px;text-align:center;">
    <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; info@searsmelvin.co.uk</span>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function quoteUpdateCustomerEmail({ firstName, productName, changes }) {
  const changeList = changes.map(c => `<li style="padding:3px 0;color:#1A1A1A;">${esc(c)}</li>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F5F3F0;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3F0;padding:24px 0;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
  <tr><td style="background:#2C2C2C;padding:20px 28px;">
    <span style="font-family:Georgia,serif;font-size:18px;color:#fff;">Sears Melvin <span style="opacity:0.55;">Memorials</span></span>
  </td></tr>
  <tr><td style="padding:32px 28px 0;">
    <h2 style="font-family:Georgia,serif;font-size:22px;color:#2C2C2C;font-weight:normal;margin:0 0 12px;">Quote updated, ${esc(firstName)}.</h2>
    <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 20px;">
      We've received your changes to your <strong style="color:#2C2C2C;">${esc(productName)}</strong> quote. Our team will review the updates and be in touch if anything needs adjusting.
    </p>
  </td></tr>
  <tr><td style="padding:0 28px 28px;">
    <div style="background:#F5F3F0;border-radius:8px;padding:16px 20px;">
      <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#8B7355;font-weight:700;margin-bottom:8px;">What changed</div>
      <ul style="margin:0;padding:0 0 0 16px;font-size:13px;">${changeList}</ul>
    </div>
  </td></tr>
  <tr><td style="background:#F5F3F0;border-top:1px solid #E0DCD5;padding:14px 28px;text-align:center;">
    <span style="font-size:11px;color:#BBB;">Sears Melvin Memorials &middot; <a href="mailto:info@searsmelvin.co.uk" style="color:#BBB;">info@searsmelvin.co.uk</a></span>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}
