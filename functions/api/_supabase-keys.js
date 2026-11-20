/**
 * Supabase API key headers for the legacy JWT keys and the new
 * publishable (`sb_publishable_…`) / secret (`sb_secret_…`) keys.
 *
 * New keys are not JWTs. Send them on `apikey` only. Putting one on
 * `Authorization: Bearer` makes the platform try to verify a JWT and
 * reject the request. Legacy anon / service_role keys are JWTs, and
 * PostgREST + Storage still expect that Bearer header, so it is added
 * only when the key actually is a JWT. Both forms then work, and
 * swapping SUPABASE_SERVICE_KEY or SUPABASE_PUBLISHABLE_KEY does not
 * need another code change.
 *
 * The legacy anon JWT below is public (anon role + RLS). It is the one
 * fallback so catalogue reads keep working until SUPABASE_PUBLISHABLE_KEY
 * is set. Do not add a new key, or any secret, here.
 */

export const PUBLIC_SUPABASE_URL = "https://bfwohzcugtwbhhxdqgme.supabase.co";

export const LEGACY_PUBLIC_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmd29oemN1Z3R3YmhoeGRxZ21lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMDA0NTIsImV4cCI6MjA4Mzc3NjQ1Mn0.QbEq1y3hczoRzcCrdajPmpPNkeh5A7jkAsfHP9BSAGg";

const LEGACY_JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PUBLISHABLE_RE = /^sb_publishable_[A-Za-z0-9_-]{8,}$/;

export function isLegacyJwtKey(key) {
  return typeof key === "string" && LEGACY_JWT_RE.test(key);
}

function jwtRole(key) {
  try {
    const segment = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return payload && typeof payload.role === "string" ? payload.role : "";
  } catch {
    return "";
  }
}

function isSafePublicKey(key) {
  if (typeof key !== "string") return false;
  const value = key.trim();
  if (!value || value.length > 2000 || /[\r\n\0]/.test(value)) return false;
  if (value.startsWith("sb_secret_")) return false;
  if (value.startsWith("sb_publishable_")) return PUBLISHABLE_RE.test(value);
  if (isLegacyJwtKey(value)) return jwtRole(value) === "anon";
  return false;
}

export function publishableKey(env = {}) {
  for (const source of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]) {
    const raw = env?.[source];
    if (typeof raw !== "string" || !raw.trim()) continue;
    if (isSafePublicKey(raw)) return raw.trim();
    console.error(JSON.stringify({ message: "supabase_publishable_key_rejected", source }));
  }
  return LEGACY_PUBLIC_ANON_KEY;
}

export function publicSupabaseUrl(env = {}) {
  const raw = typeof env?.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim().replace(/\/$/, "") : "";
  if (/^https:\/\/[^\s/?#]+$/i.test(raw) && raw.length <= 200) return raw;
  return PUBLIC_SUPABASE_URL;
}

export function supabaseKeyHeaders(key, extra = {}) {
  const headers = {};
  if (extra && typeof extra === "object") {
    for (const [name, value] of Object.entries(extra)) {
      if (value != null && value !== "") headers[name] = value;
    }
  }
  if (typeof key === "string" && key) headers.apikey = key;
  if (isLegacyJwtKey(key)) headers.Authorization = `Bearer ${key}`;
  else if (headers.Authorization === `Bearer ${key}`) delete headers.Authorization;
  return headers;
}

/** apikey plus Authorization only when the source headers actually have one. */
export function supabaseAuthHeaders(headers) {
  const out = {};
  if (typeof headers?.apikey === "string" && headers.apikey) out.apikey = headers.apikey;
  if (typeof headers?.Authorization === "string" && headers.Authorization) {
    out.Authorization = headers.Authorization;
  }
  return out;
}

export function supabaseBrowserConfigScript(env) {
  const config = {
    url: publicSupabaseUrl(env),
    key: publishableKey(env),
  };
  return `window.SM_SUPABASE=${JSON.stringify(config)};window.SM_SUPABASE.headers=function(){var headers={apikey:this.key};if(${LEGACY_JWT_RE}.test(this.key))headers.Authorization="Bearer "+this.key;return headers;};`;
}
