const MAX_JSON_BYTES = 16 * 1024;

export class RequestValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RequestValidationError";
    this.status = status;
  }
}

export async function readBoundedJson(request, maxBytes = MAX_JSON_BYTES) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestValidationError("Content-Type must be application/json", 415);
  }

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestValidationError("Request body too large", 413);
  }
  if (!request.body) throw new RequestValidationError("Invalid JSON", 400);

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Request body too large");
        throw new RequestValidationError("Request body too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON object required");
    }
    return parsed;
  } catch {
    throw new RequestValidationError("Invalid JSON", 400);
  }
}

export function isSameOriginRequest(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

export function getClientAddress(request) {
  const value = (request.headers.get("CF-Connecting-IP") || "unknown").trim();
  return value.length > 0 && value.length <= 64 ? value : "unknown";
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function checkRateLimit(env, request, scope, identifier, options) {
  const maxAttempts = Math.min(Math.max(Number(options.maxAttempts) || 1, 1), 10000);
  const windowSeconds = Math.min(Math.max(Number(options.windowSeconds) || 60, 10), 86400);
  const blockSeconds = Math.min(Math.max(Number(options.blockSeconds) || windowSeconds, 10), 604800);
  const keyHash = await sha256Hex(`${scope}:${identifier}`);

  let response;
  try {
    response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/check_portal_rate_limit`, {
      method: "POST",
      headers: supabaseHeaders(env),
      body: JSON.stringify({
        p_key_hash: keyHash,
        p_max_attempts: maxAttempts,
        p_window_seconds: windowSeconds,
        p_block_seconds: blockSeconds,
      }),
    });
  } catch {
    return { allowed: !options.failClosed, retryAfter: 0, keyHash };
  }

  if (!response.ok) return { allowed: !options.failClosed, retryAfter: 0, keyHash };
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  return {
    allowed: row?.allowed === true,
    retryAfter: Math.max(Number(row?.retry_after_seconds) || 0, 0),
    keyHash,
  };
}

export function rateLimitResponse(json, retryAfter) {
  return json(
    { ok: false, error: "Too many attempts. Please try again later." },
    429,
    { "Retry-After": String(Math.max(Math.ceil(retryAfter) || 1, 1)) },
  );
}

export function queueSecurityEvent(context, env, request, event) {
  const task = writeSecurityEvent(env, request, event);
  if (typeof context.waitUntil === "function") context.waitUntil(task);
  else void task;
}

async function writeSecurityEvent(env, request, event) {
  try {
    const [ipHash, userAgentHash] = await Promise.all([
      sha256Hex(getClientAddress(request)),
      sha256Hex((request.headers.get("User-Agent") || "unknown").slice(0, 512)),
    ]);
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/portal_security_events`, {
      method: "POST",
      headers: { ...supabaseHeaders(env), "Prefer": "return=minimal" },
      body: JSON.stringify({
        event_type: String(event.eventType || "unknown").slice(0, 80),
        actor_type: String(event.actorType || "anonymous").slice(0, 32),
        success: event.success === true,
        identifier_hash: event.identifierHash || null,
        ip_hash: ipHash,
        user_agent_hash: userAgentHash,
        request_id: (request.headers.get("CF-Ray") || "").slice(0, 64) || null,
        metadata: sanitiseMetadata(event.metadata),
      }),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ message: "security_event_write_failed", status: response.status }));
    }
  } catch {
    console.error(JSON.stringify({ message: "security_event_write_failed" }));
  }
}

function sanitiseMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, raw] of Object.entries(value).slice(0, 12)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    if (typeof raw === "boolean" || typeof raw === "number" || raw === null) output[key] = raw;
    else if (typeof raw === "string") output[key] = raw.slice(0, 160);
  }
  return output;
}

export function hardenedJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      ...extraHeaders,
    },
  });
}

export function supabaseHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
}
