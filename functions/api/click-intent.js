// /api/click-intent — fail-soft capture of ad click IDs for chat/call matching.
import { checkRateLimit, getClientAddress, hardenedJson, isSameOriginRequest, readBoundedJson, RequestValidationError, supabaseHeaders } from "./_security.js";
import { cleanAttribution } from "./submit.js";

function cleanPath(value) {
  if (typeof value !== "string") return null;
  const path = value.trim().split("?")[0].split("#")[0];
  return /^\/[\w\-./~%]*$/.test(path) ? path.slice(0, 300) : null;
}

function cleanEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase().slice(0, 200);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function cleanPhone(value) {
  if (typeof value !== "string") return null;
  const phone = value.trim().replace(/[^\d+]/g, "").slice(0, 20);
  return phone || null;
}

function noContent() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { Allow: "POST, OPTIONS", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function onRequestPost({ request, env }) {
  if (!isSameOriginRequest(request)) return hardenedJson({ ok: false, error: "Forbidden" }, 403);
  let data;
  try {
    data = await readBoundedJson(request, 4 * 1024, { allowTextPlain: true });
  } catch (error) {
    const status = error instanceof RequestValidationError ? error.status : 400;
    return hardenedJson({ ok: false, error: "Invalid request" }, status);
  }

  const attribution = cleanAttribution(data);
  const kind = data.kind === "chat" || data.kind === "call" ? data.kind : null;
  const hasClickId = attribution.gclid || attribution.gbraid || attribution.wbraid;
  const hasUtm = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].some((key) => attribution[key]);
  if (!kind || (kind === "chat" && !hasClickId && !hasUtm)) return noContent();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) {
    console.error(JSON.stringify({ message: "click_intent_config_missing" }));
    return noContent();
  }
  const ipLimit = await checkRateLimit(env, request, "click-intent-ip", getClientAddress(request), {
    maxAttempts: 60,
    windowSeconds: 3600,
    blockSeconds: 3600,
    failClosed: false,
  });
  if (!ipLimit.allowed) return noContent();

  const row = {
    organization_id: env.SM_ORG_ID,
    kind,
    gclid: attribution.gclid || null,
    gbraid: attribution.gbraid || null,
    wbraid: attribution.wbraid || null,
    landing_page: cleanPath(data.landing_page),
    page: cleanPath(data.page),
    email: kind === "chat" ? cleanEmail(data.email) : null,
    phone: kind === "chat" ? cleanPhone(data.phone) : null,
    user_agent: (request.headers.get("User-Agent") || "").slice(0, 300) || null,
  };
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    if (attribution[key]) row[key] = attribution[key];
  }
  try {
    const url = `${env.SUPABASE_URL}/rest/v1/click_intents`;
    const options = {
      method: "POST",
      headers: { ...supabaseHeaders(env), Prefer: "return=minimal" },
      body: JSON.stringify(row),
    };
    let response = await fetch(url, options);
    if (response.status === 400) {
      const { utm_source, utm_medium, utm_campaign, utm_term, utm_content, ...legacyRow } = row;
      response = await fetch(url, { ...options, body: JSON.stringify(legacyRow) });
    }
    if (!response.ok) console.error(JSON.stringify({ message: "click_intent_insert_failed", status: response.status }));
  } catch {
    console.error(JSON.stringify({ message: "click_intent_insert_failed" }));
  }
  return noContent();
}
