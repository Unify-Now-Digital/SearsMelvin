const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let googleJwksCache = null;

export class GoogleVerificationUnavailable extends Error {}

function decodeBase64Url(value) {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid Google credential");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getGoogleJwks(forceRefresh = false) {
  if (!forceRefresh && googleJwksCache && googleJwksCache.expiresAt > Date.now()) {
    return googleJwksCache.keys;
  }

  let response;
  try {
    response = await fetch(GOOGLE_JWKS_URL, { headers: { "Accept": "application/json" } });
  } catch {
    throw new GoogleVerificationUnavailable("Could not load Google signing keys");
  }
  if (!response.ok) throw new GoogleVerificationUnavailable("Could not load Google signing keys");

  let body;
  try { body = await response.json(); }
  catch { throw new GoogleVerificationUnavailable("Invalid Google signing keys"); }
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new GoogleVerificationUnavailable("Invalid Google signing keys");
  }

  const cacheControl = response.headers.get("Cache-Control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSeconds = Math.min(Number(maxAgeMatch?.[1]) || 3600, 21600);
  googleJwksCache = { keys: body.keys, expiresAt: Date.now() + maxAgeSeconds * 1000 };
  return body.keys;
}

export async function verifyGoogleIdToken(credential, expectedAudience) {
  if (typeof credential !== "string" || credential.length > 12000) {
    throw new Error("Invalid Google credential");
  }
  const parts = credential.split(".");
  if (parts.length !== 3) throw new Error("Invalid Google credential");

  let header, payload;
  try {
    header = decodeJwtPart(parts[0]);
    payload = decodeJwtPart(parts[1]);
  } catch {
    throw new Error("Invalid Google credential");
  }
  if (header.alg !== "RS256" || !header.kid || (header.typ && header.typ !== "JWT")) {
    throw new Error("Invalid Google credential");
  }

  let keys = await getGoogleJwks();
  let jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) {
    keys = await getGoogleJwks(true);
    jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA");
  }
  if (!jwk) throw new Error("Invalid Google credential");

  let signatureValid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    throw new Error("Invalid Google credential");
  }
  if (!signatureValid) throw new Error("Invalid Google credential");

  const now = Math.floor(Date.now() / 1000);
  const audienceMatches = payload.aud === expectedAudience
    || (Array.isArray(payload.aud) && payload.aud.includes(expectedAudience));
  if (!audienceMatches || (payload.azp && payload.azp !== expectedAudience)) {
    throw new Error("Invalid Google credential");
  }
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error("Invalid Google credential");
  }
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) {
    throw new Error("Invalid Google credential");
  }
  if (!Number.isFinite(Number(payload.iat))
      || Number(payload.iat) > now + 120
      || Number(payload.iat) < now - 7200
      || Number(payload.exp) > now + 7200
      || Number(payload.exp) <= Number(payload.iat)) {
    throw new Error("Invalid Google credential");
  }
  if (payload.nbf != null && Number(payload.nbf) > now + 120) {
    throw new Error("Invalid Google credential");
  }
  if (typeof payload.sub !== "string" || !/^\d{6,32}$/.test(payload.sub)) {
    throw new Error("Invalid Google credential");
  }
  return payload;
}
