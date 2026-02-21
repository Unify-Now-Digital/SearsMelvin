/**
 * Sears Melvin Memorials — Contact Form Worker
 *
 * Handles submissions from contact.html
 *   1. Sends detailed notification email to info@searsmelvin.co.uk
 *   2. Sends personalised confirmation email to the customer
 *   3. Creates a task in ClickUp Orders list
 */

const CLICKUP_LIST_ID = "901207633256";
const BUSINESS_EMAIL  = "info@searsmelvin.co.uk";
const FROM_EMAIL      = "enquiries@searsmelvin.co.uk";
const BUSINESS_NAME   = "Sears Melvin Memorials";

export default {
  async fetch(request, env) {

    const corsHeaders = {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid request" }, 400, corsHeaders);
    }

    const {
      first_name,
      last_name,
      email,
      phone,
      enquiry_type,
      cemetery,
      grave_number,
      message,
      contact_pref,
      appointment,
    } = data;

    if (!first_name || !email) {
      return json({ ok: false, error: "Missing required fields" }, 400, corsHeaders);
    }

    const fullName = `${first_name} ${last_name || ""}`.trim();

    const submittedAt = new Date().toLocaleString("en-GB", {
      timeZone: "Europe/London",
      dateStyle: "medium",
      timeStyle: "short",
    });

    const enquiryLabel = {
      new_memorial:  "New Memorial",
      renovation:    "Renovation / Repair",
      additional:    "Additional Inscription",
      other:         "General Enquiry",
    }[enquiry_type] || enquiry_type || "Not specified";

    const contactPrefLabel = {
      email:       "Email",
      phone:       "Phone call",
      appointment: "Book a showroom visit",
    }[contact_pref] || contact_pref || "Email";

    // ── 1. Notification email to the business ──────────────────────────────
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:   BUSINESS_EMAIL,
      subject: `New ${enquiryLabel} Enquiry — ${fullName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; color: #1a1a1a;">
          <div style="background: #2C2C2C; padding: 1.5rem 2rem; border-radius: 6px 6px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 1.25rem;">New Website Enquiry</h2>
            <p style="color: rgba(255,255,255,0.6); margin: 0.25rem 0 0; font-size: 0.875rem;">${submittedAt}</p>
          </div>
          <div style="background: white; padding: 2rem; border: 1px solid #eee; border-top: none; border-radius: 0 0 6px 6px;">
            <table style="width:100%; border-collapse:collapse;">
              <tr><td style="padding:10px 0; color:#888; width:160px; font-size:0.875rem; border-bottom:1px solid #f5f5f5;">Enquiry Type</td>
                  <td style="padding:10px 0; border-bottom:1px solid #f5f5f5;"><strong style="color: #8B7355;">${enquiryLabel}</strong></td></tr>
              <tr><td style="padding:10px 0; color:#888; font-size:0.875rem; border-bottom:1px solid #f5f5f5;">Name</td>
                  <td style="padding:10px 0; border-bottom:1px solid #f5f5f5;"><strong>${fullName}</strong></td></tr>
              <tr><td style="padding:10px 0; color:#888; font-size:0.875rem; border-bottom:1px solid #f5f5f5;">Email</td>
                  <td style="padding:10px 0; border-bottom:1px solid #f5f5f5;"><a href="mailto:${email}" style="color:#8B7355;">${email}</a></td></tr>
              <tr><td style="padding:10px 0; color:#888; font-size:0.875rem; border-bottom:1px solid #f5f5f5;">Phone</td>
                  <td style="padding:10px 0; border-bottom:1px solid #f5f5f5;">${phone || "Not provided"}</td></tr>
              ${cemetery ? `<tr><td style="padding:10px 0; color:#888; font-size:0.875rem; border-bottom:1px solid #f5f5f5;">Cemetery</td>
                  <td style="padding:10px 0; border-bottom:1px solid #f5f5f5;">${cemetery}</td></tr>` : ""}
              ${grave_number ? `<tr><td style="padding:10px 0; color:#888; font-size:0.875rem; border-bottom:1px solid #f5f5f5;">Grave Number</td>
                  <td style="padding:10px 0; border-bottom:1px solid #f5f5f5;">${grave_number}</td></tr>` : ""}
              <tr><td style="padding:10px 0; color:#888; font-size:0.875rem; border-bottom:1px solid #f5f5f5;">Prefers to be contacted by</td>
                  <td style="padding:10px 0; border-bottom:1px solid #f5f5f5;">${contactPrefLabel}</td></tr>
              ${appointment ? `<tr><td style="padding:10px 0; color:#888; font-size:0.875rem; border-bottom:1px solid #f5f5f5;">Appointment Request</td>
                  <td style="padding:10px 0; border-bottom:1px solid #f5f5f5;">${appointment}</td></tr>` : ""}
              <tr><td style="padding:10px 0; color:#888; font-size:0.875rem; vertical-align:top;">Message</td>
                  <td style="padding:10px 0;">${message ? message.replace(/\n/g, "<br>") : "No message provided"}</td></tr>
            </table>
            <div style="margin-top:1.5rem; padding-top:1.5rem; border-top:1px solid #eee;">
              <a href="mailto:${email}" style="display:inline-block; padding:0.75rem 1.5rem; background:#2C2C2C; color:white; text-decoration:none; border-radius:4px; font-size:0.875rem;">Reply to ${first_name}</a>
            </div>
          </div>
        </div>
      `,
    });

    // ── 2. Confirmation email to the customer ──────────────────────────────
    await sendEmail(env.RESEND_API_KEY, {
      from: `${BUSINESS_NAME} <${FROM_EMAIL}>`,
      to:   email,
      subject: `We've received your enquiry — ${BUSINESS_NAME}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; color: #1a1a1a;">
          <div style="background: #2C2C2C; padding: 2rem; border-radius: 6px 6px 0 0; text-align: center;">
            <p style="color: rgba(255,255,255,0.5); font-size: 0.75rem; letter-spacing: 0.15em; text-transform: uppercase; margin: 0 0 0.5rem;">Sears Melvin Memorials</p>
            <h2 style="color: white; margin: 0; font-size: 1.75rem; font-weight: 300;">Thank you, ${first_name}.</h2>
          </div>
          <div style="background: white; padding: 2rem; border: 1px solid #eee; border-top: none; border-radius: 0 0 6px 6px; text-align: center;">
            <p style="color:#444; line-height:1.8; margin-bottom: 1.5rem;">
              We've received your enquiry and one of our team will be in contact 
              within 24 hours${contact_pref === "phone" ? " by phone" : ""}.
            </p>
            <p style="color:#444; line-height:1.8; margin-bottom: 2rem;">
              If you have any urgent questions in the meantime, please call us on 
              <strong>01268 208 559</strong>.
            </p>
            <div style="background: #FAF8F5; border-radius: 6px; padding: 1.5rem; margin-bottom: 2rem; text-align: left;">
              <p style="font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #888; margin: 0 0 0.75rem;">Your enquiry summary</p>
              <p style="margin: 0.25rem 0; font-size: 0.9rem; color: #444;"><strong>Type:</strong> ${enquiryLabel}</p>
              ${cemetery ? `<p style="margin: 0.25rem 0; font-size: 0.9rem; color: #444;"><strong>Cemetery:</strong> ${cemetery}</p>` : ""}
            </div>
            <p style="color:#999; font-size:0.875rem; line-height:1.6;">
              With care,<br>
              <strong style="color: #2C2C2C;">The Sears Melvin Team</strong>
            </p>
            <hr style="border:none; border-top:1px solid #eee; margin:2rem 0;">
            <p style="color:#bbb; font-size:0.75rem;">
              Sears Melvin Memorials · South London & Beyond · 01268 208 559
            </p>
          </div>
        </div>
      `,
    });

    // ── 3. Create task in ClickUp Orders list ──────────────────────────────
    const taskDescription = [
      `ENQUIRY TYPE: ${enquiryLabel}`,
      `NAME: ${fullName}`,
      `EMAIL: ${email}`,
      `PHONE: ${phone || "Not provided"}`,
      cemetery    ? `CEMETERY: ${cemetery}`        : null,
      grave_number ? `GRAVE NUMBER: ${grave_number}` : null,
      `CONTACT PREFERENCE: ${contactPrefLabel}`,
      appointment ? `APPOINTMENT: ${appointment}`  : null,
      "",
      `MESSAGE:`,
      message || "No message provided",
      "",
      `SUBMITTED: ${submittedAt}`,
    ].filter(l => l !== null).join("\n");

    await createClickUpTask(env.CLICKUP_API_KEY, {
      name:        `New ${enquiryLabel} — ${fullName}`,
      description: taskDescription,
    });

    return json({ ok: true }, 200, corsHeaders);
  },
};


async function sendEmail(apiKey, { from, to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) console.error("Resend error:", await res.text());
}


async function createClickUpTask(apiKey, { name, description }) {
  const res = await fetch(`https://api.clickup.com/api/v2/list/${CLICKUP_LIST_ID}/task`, {
    method: "POST",
    headers: {
      "Authorization": apiKey,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) console.error("ClickUp error:", await res.text());
}


function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
