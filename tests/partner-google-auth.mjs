import assert from "node:assert/strict";

import { onRequest as partnerAuth } from "../functions/api/partner-auth.js";

const clientId = "test-client.apps.googleusercontent.com";
const now = Math.floor(Date.now() / 1000);
const keyPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
Object.assign(publicJwk, { kid: "partner-google-test", alg: "RS256", use: "sig" });

function base64url(value) {
  const input = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return input.toString("base64url");
}

async function token(overrides = {}) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: publicJwk.kid }));
  const payload = base64url(JSON.stringify({
    iss: "https://accounts.google.com",
    aud: clientId,
    azp: clientId,
    sub: "123456789012345678901",
    iat: now,
    exp: now + 3600,
    email: "staff@searsmelvin.co.uk",
    email_verified: true,
    hd: "searsmelvin.co.uk",
    ...overrides,
  }));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-service-role-key",
  GOOGLE_CLIENT_ID: clientId,
  SM_INTERNAL_PARTNER_ID: "1",
};
const originalFetch = globalThis.fetch;
const sessions = [];
let internalMagicDeletes = 0;
let magicTokenPosts = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes("/rest/v1/rpc/check_portal_rate_limit")) {
    return Response.json([{ allowed: true, retry_after_seconds: 0 }]);
  }
  if (url === "https://www.googleapis.com/oauth2/v3/certs") {
    return Response.json({ keys: [publicJwk] }, { headers: { "Cache-Control": "max-age=300" } });
  }
  if (url.includes("/rest/v1/partners?id=eq.1")) {
    return Response.json([{ id: 1, email: "info@searsmelvin.co.uk", name: "Sears Melvin Team", company: "Sears Melvin" }]);
  }
  if (url.includes("/rest/v1/partners?email=eq.info%40searsmelvin.co.uk")) {
    return Response.json([{ id: 1, email: "info@searsmelvin.co.uk", name: "Sears Melvin Team", company: "Sears Melvin" }]);
  }
  if (url.includes("/rest/v1/partner_magic_link_tokens?partner_id=eq.1") && init.method === "DELETE") {
    internalMagicDeletes++;
    return new Response(null, { status: 204 });
  }
  if (url.includes("/rest/v1/partner_magic_link_tokens?token_hash=eq.")) {
    return Response.json([{ id: 91, partner_id: 1 }]);
  }
  if (url.includes("/rest/v1/partner_magic_link_tokens?id=eq.91") && init.method === "DELETE") {
    internalMagicDeletes++;
    return new Response(null, { status: 204 });
  }
  if (url.endsWith("/rest/v1/partner_magic_link_tokens") && init.method === "POST") {
    magicTokenPosts++;
    return new Response(null, { status: 201 });
  }
  if (url.endsWith("/rest/v1/partner_sessions") && init.method === "POST") {
    sessions.push(JSON.parse(init.body));
    return new Response(null, { status: 201 });
  }
  if (url.includes("/rest/v1/portal_security_events")) return new Response(null, { status: 201 });
  throw new Error(`Unexpected test fetch: ${url}`);
};

async function login(credential) {
  return post({ action: "google-login", credential });
}

async function post(payload) {
  const pending = [];
  const response = await partnerAuth({
    env,
    waitUntil(task) { pending.push(task); },
    request: new Request("https://searsmelvin.co.uk/api/partner-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Origin": "https://searsmelvin.co.uk" },
      body: JSON.stringify(payload),
    }),
  });
  await Promise.allSettled(pending);
  return response;
}

try {
  const allowed = await login(await token());
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers.get("Set-Cookie") || "", /^__Host-sm_partner_session=.*HttpOnly; Secure; SameSite=Strict$/);
  assert.equal((await allowed.json()).partner.id, 1);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].partner_id, 1);
  assert.match(sessions[0].token, /^sha256:[a-f0-9]{64}$/);

  const consumerGmail = await login(await token({ email: "staff@gmail.com", hd: undefined }));
  assert.equal(consumerGmail.status, 403);

  const forgedDomainHint = await login(await token({ email: "staff@example.com", hd: "searsmelvin.co.uk" }));
  assert.equal(forgedDomainHint.status, 403);

  const wrongAudience = await login(await token({ aud: "attacker.apps.googleusercontent.com", azp: "attacker.apps.googleusercontent.com" }));
  assert.equal(wrongAudience.status, 401);

  const unverified = await login(await token({ email_verified: false }));
  assert.equal(unverified.status, 401);
  assert.equal(sessions.length, 1);

  const internalMagicRequest = await post({ action: "request-magic-link", email: "info@searsmelvin.co.uk" });
  assert.equal(internalMagicRequest.status, 200);
  assert.equal((await internalMagicRequest.json()).ok, true);
  assert.equal(internalMagicDeletes, 1);
  assert.equal(magicTokenPosts, 0);

  const oldInternalMagicLink = await post({ action: "consume-magic-link", token: "b".repeat(64) });
  assert.equal(oldInternalMagicLink.status, 400);
  assert.equal(internalMagicDeletes, 2);
  assert.equal(sessions.length, 1);

  console.log("partner Google Workspace auth tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
