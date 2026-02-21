/**
 * Sears Melvin Memorials — Contact Form Worker
 * Deployed on Cloudflare Workers
 *
 * What this does when someone submits the enquiry form:
 *   1. Sends a notification email to info@searsmelvin.co.uk
 *   2. Sends a confirmation email to the customer
 *   3. Creates a task in your ClickUp Orders list
 */

// ─── YOUR SECRETS (set these in Cloudflare dashboard, NOT here) ───────────────
// RESEND_API_KEY      → from resend.com dashboard
// CLICKUP_API_KEY     → from ClickUp → Settings → Apps → API Token
// ─────────────────────────────────────────────────────────────────────────────

const CLICKUP_LIST_ID = "901207633256"; // Your Orders list ID
const BUSINESS_EMAIL  = "info@searsmelvin.co.uk";
const FROM_EMAIL      = "enquiries@searsmelvin.co.uk"; // Must be verified in Resend
const BUSINESS_NAME   = "Sears Melvin Memorials";

export default {
  async fetch(request, env) {

    // Allow the form on searsmelvin.co.uk (and www) to call this worker
    const allowedOrigins = ["https://searsmelvin.co.uk", "https://www.searsmelvin.co.uk"];
    const requestOrigin  = request.headers.get("Origin") || "";
    const corsHeaders = {
      "Access-Control-Allow-Origin":  allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle browser pre-flight check
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // ── 1. Parse the form data ──────────────────────────────────────────────
    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid request" }, 400, corsHeaders);
    }

    const { name, email, phone, message, enquiry_type } = data;

    // Basic validation
    if (!name || !email || !message) {
      return json({ ok: false, error: "Missing required fields" }, 400, corsHeaders);
    }

    const submittedAt = new Date().toLocaleString("en-GB", {
      timeZone: "Europe/London",
      dateStyle: "medium",
      timeStyle: "short",
    });

    // ── 2. Send notification email to the business (critical) ──────────────
    try {
      await sendEmail(env.RESEND_API_KEY, {
        from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
        to:   BUSINESS_EMAIL,
        subject: `New Enquiry — ${name}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; color: #1a1a1a;">
            <h2 style="color: #2C2C2C;">New Website Enquiry</h2>
            <table style="width:100%; border-collapse:collapse;">
              <tr><td style="padding:8px 0; color:#666; width:100px;">Name</td>
                  <td style="padding:8px 0;"><strong>${name}</strong></td></tr>
              <tr><td style="padding:8px 0; color:#666;">Email</td>
                  <td style="padding:8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
              <tr><td style="padding:8px 0; color:#666;">Phone</td>
                  <td style="padding:8px 0;">${phone || "Not provided"}</td></tr>
              ${enquiry_type ? `<tr><td style="padding:8px 0; color:#666;">Enquiry Type</td>
                  <td style="padding:8px 0;">${enquiry_type.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</td></tr>` : ""}
              <tr><td style="padding:8px 0; color:#666; vertical-align:top;">Message</td>
                  <td style="padding:8px 0;">${message.replace(/\n/g, "<br>")}</td></tr>
              <tr><td style="padding:8px 0; color:#666;">Submitted</td>
                  <td style="padding:8px 0;">${submittedAt}</td></tr>
            </table>
          </div>
        `,
      });
    } catch (err) {
      console.error("Failed to send business notification email:", err);
      return json({ ok: false, error: "Failed to send notification email" }, 500, corsHeaders);
    }

    // ── 3. Send confirmation email to the customer (non-critical) ──────────
    try {
      await sendEmail(env.RESEND_API_KEY, {
        from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
        to:   email,
        subject: `We've received your enquiry — ${BUSINESS_NAME}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; color: #1a1a1a;">
            <h2 style="color: #2C2C2C;">Thank you, ${name.split(" ")[0]}.</h2>
            <p style="color:#444; line-height:1.7;">
              We've received your enquiry and one of our team will be in contact
              within 24 hours.
            </p>
            <p style="color:#444; line-height:1.7;">
              If you have any urgent questions in the meantime, please call us on
              <strong>01268 208 559</strong>.
            </p>
            <p style="color:#888; margin-top:2rem; font-size:0.9rem;">
              With care,<br>
              <strong>The Sears Melvin Team</strong>
            </p>
            <hr style="border:none; border-top:1px solid #eee; margin:2rem 0;">
            <p style="color:#aaa; font-size:0.8rem;">
              Sears Melvin Memorials · South London & Beyond<br>
              ${BUSINESS_EMAIL}
            </p>
          </div>
        `,
      });
    } catch (err) {
      console.error("Failed to send customer confirmation email:", err);
      // Non-critical: enquiry is still received even if confirmation email fails
    }

    // ── 4. Create task in ClickUp Orders list (non-critical) ────────────────
    try {
      await createClickUpTask(env.CLICKUP_API_KEY, {
        name:        `New Enquiry — ${name}`,
        description: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || "Not provided"}\nEnquiry Type: ${enquiry_type || "Not specified"}\n\nMessage:\n${message}\n\nSubmitted: ${submittedAt}`,
        listId:      CLICKUP_LIST_ID,
      });
    } catch (err) {
      console.error("Failed to create ClickUp task:", err);
      // Non-critical: don't fail the request if task creation fails
    }

    // ── 5. Return success to the website ───────────────────────────────────
    return json({ ok: true }, 200, corsHeaders);
  },
};


// ─── Helper: Send email via Resend ───────────────────────────────────────────
async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
}


// ─── Helper: Create task in ClickUp ──────────────────────────────────────────
async function createClickUpTask(apiKey, { name, description, listId }) {
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: "POST",
    headers: {
      "Authorization": apiKey,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ name, description }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ClickUp error: ${err}`);
  }
}


// ─── Helper: Return JSON response ────────────────────────────────────────────
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
