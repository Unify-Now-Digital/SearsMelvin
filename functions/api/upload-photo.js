/**
 * Photo Upload API — /api/upload-photo
 *
 * Multipart POST. One file per request.
 * Uploads to the private `enquiry-photos` bucket via the Supabase service-role
 * key and returns the storage path. The bucket is private; admin generates
 * signed URLs at read time.
 */

import {
  RequestValidationError,
  checkRateLimit,
  getClientAddress,
  hardenedJson,
  isSameOriginRequest,
  queueSecurityEvent,
  rateLimitResponse,
  readBoundedJson,
} from "./_security.js";

const BUCKET = "enquiry-photos";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Allow": "POST, DELETE, OPTIONS" } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isSameOriginRequest(request)) return json({ ok: false, error: "Forbidden" }, 403);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) {
    return json({ ok: false, error: "Server configuration error" }, 500);
  }
  const limit = await checkRateLimit(env, request, "enquiry-photo-upload-ip", getClientAddress(request), {
    maxAttempts: 20,
    windowSeconds: 3600,
    blockSeconds: 3600,
    failClosed: true,
  });
  if (!limit.allowed) {
    queueSecurityEvent(context, env, request, {
      eventType: "photo_upload_rate_limited",
      actorType: "anonymous",
      success: false,
      metadata: { retry_after: limit.retryAfter },
    });
    return rateLimitResponse(json, limit.retryAfter);
  }
  const dailyLimit = await checkRateLimit(env, request, "enquiry-photo-upload-daily-ip", getClientAddress(request), {
    maxAttempts: 40,
    windowSeconds: 86400,
    blockSeconds: 86400,
    failClosed: true,
  });
  if (!dailyLimit.allowed) return rateLimitResponse(json, dailyLimit.retryAfter);
  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES + 1024 * 1024) {
    return json({ ok: false, error: "Request body too large" }, 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Expected multipart/form-data" }, 400);
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return json({ ok: false, error: "Missing 'file' field" }, 400);
  }
  if (file.size > MAX_BYTES) {
    return json({ ok: false, error: "File exceeds 10 MB" }, 413);
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mime)) {
    return json({ ok: false, error: "Unsupported image type" }, 415);
  }
  if (!await hasExpectedImageSignature(file, mime)) {
    return json({ ok: false, error: "File content does not match its image type" }, 415);
  }

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const safeName = sanitiseFilename(file.name || "upload");
  const path = `${env.SM_ORG_ID}/${yyyy}/${mm}/${crypto.randomUUID()}-${safeName}`;

  const uploadRes = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": mime,
        "x-upsert": "false",
      },
      body: file.stream(),
      // @ts-ignore — Cloudflare Workers requires this when streaming a body.
      duplex: "half",
    },
  );

  if (!uploadRes.ok) {
    console.error(JSON.stringify({ message: "storage_upload_failed", status: uploadRes.status }));
    return json({ ok: false, error: "Upload failed" }, 502);
  }

  queueSecurityEvent(context, env, request, {
    eventType: "enquiry_photo_uploaded",
    actorType: "anonymous",
    success: true,
    metadata: { bytes: file.size, mime },
  });
  const [deleteToken, submissionToken] = await Promise.all([
    createObjectToken(env, "delete", path),
    createObjectToken(env, "submit", path),
  ]);
  return json({ ok: true, path, deleteToken, submissionToken });
}

// DELETE /api/upload-photo with { path, deleteToken }
// Used by the contact form when a customer removes a preview before submitting.
// The HMAC capability means merely learning an object's path is not enough to
// delete it. Path and token are sent in the body so they do not enter URL logs.
export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isSameOriginRequest(request)) return json({ ok: false, error: "Forbidden" }, 403);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) {
    return json({ ok: false, error: "Server configuration error" }, 500);
  }
  const limit = await checkRateLimit(env, request, "enquiry-photo-delete-ip", getClientAddress(request), {
    maxAttempts: 40,
    windowSeconds: 3600,
    blockSeconds: 3600,
    failClosed: true,
  });
  if (!limit.allowed) return rateLimitResponse(json, limit.retryAfter);
  let data;
  try { data = await readBoundedJson(request, 4096); }
  catch (error) {
    const status = error instanceof RequestValidationError ? error.status : 400;
    return json({ ok: false, error: error instanceof RequestValidationError ? error.message : "Invalid JSON" }, status);
  }
  const path = typeof data.path === "string" ? data.path : "";
  const deleteToken = typeof data.deleteToken === "string" ? data.deleteToken : "";
  if (!path || !/^[0-9a-f]{64}$/.test(deleteToken)) {
    return json({ ok: false, error: "Invalid deletion capability" }, 403);
  }
  const expectedPath = new RegExp(
    "^" + escapeRegex(env.SM_ORG_ID) + "/\\d{4}/(?:0[1-9]|1[0-2])/[0-9a-f-]{36}-[A-Za-z0-9_.-]{1,80}$",
  );
  if (!expectedPath.test(path)) {
    return json({ ok: false, error: "Invalid path" }, 400);
  }
  const expectedToken = await createObjectToken(env, "delete", path);
  if (!timingSafeEqual(expectedToken, deleteToken)) {
    return json({ ok: false, error: "Invalid deletion capability" }, 403);
  }
  const delRes = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    },
  );
  if (!delRes.ok && delRes.status !== 404) {
    console.error(JSON.stringify({ message: "storage_delete_failed", status: delRes.status }));
    return json({ ok: false, error: "Delete failed" }, 502);
  }
  queueSecurityEvent(context, env, request, {
    eventType: "enquiry_photo_deleted",
    actorType: "anonymous",
    success: true,
  });
  return json({ ok: true });
}

async function createObjectToken(env, purpose, path) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SUPABASE_SERVICE_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`enquiry-photo-${purpose}:${path}`),
  );
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

async function hasExpectedImageSignature(file, mime) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value);
  }
  if (mime === "image/webp") {
    return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
      && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  }
  if (mime === "image/heic") {
    const brand = new TextDecoder().decode(bytes.slice(4, 12));
    return /^ftyp(?:heic|heix|hevc|hevx|mif1|msf1)$/.test(brand);
  }
  return false;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitiseFilename(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80) || "upload";
}

function json(data, status = 200) {
  return hardenedJson(data, status);
}
