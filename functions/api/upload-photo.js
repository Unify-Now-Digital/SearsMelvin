/**
 * Photo Upload API — /api/upload-photo
 *
 * Multipart POST. One file per request.
 * Uploads to the private `enquiry-photos` bucket via the Supabase service-role
 * key and returns the storage path. The bucket is private; admin generates
 * signed URLs at read time.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const BUCKET = "enquiry-photos";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) {
    return json({ ok: false, error: "Server configuration error" }, 500);
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
    const body = await uploadRes.text();
    console.error(`Storage upload failed ${uploadRes.status}: ${body}`);
    return json({ ok: false, error: "Upload failed" }, 502);
  }

  return json({ ok: true, path });
}

// DELETE /api/upload-photo?path=<storage path>
// Used by the contact form when a customer removes a preview before submitting.
// Path must live under the customer's org prefix; we reject anything trying to
// escape the bucket layout we wrote in onRequestPost.
export async function onRequestDelete({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SM_ORG_ID) {
    return json({ ok: false, error: "Server configuration error" }, 500);
  }
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "";
  if (!path) return json({ ok: false, error: "Missing path" }, 400);
  // Defence in depth: only allow paths under the configured org prefix and reject traversal.
  if (path.includes("..") || !path.startsWith(`${env.SM_ORG_ID}/`)) {
    return json({ ok: false, error: "Invalid path" }, 400);
  }
  const delRes = await fetch(
    `${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    },
  );
  if (!delRes.ok && delRes.status !== 404) {
    console.error(`Storage delete failed ${delRes.status}: ${await delRes.text()}`);
    return json({ ok: false, error: "Delete failed" }, 502);
  }
  return json({ ok: true });
}

function sanitiseFilename(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80) || "upload";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
