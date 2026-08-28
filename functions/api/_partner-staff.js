/**
 * Named Sears Melvin staff identity for the partner workspace.
 *
 * Live UI is https://partner.searsmelvin.co.uk. Google Workspace sign-in still
 * maps onto the shared internal partner row (order scope), but the signed-in
 * person is Arin / Matthew / Aylin / Karen — not an anonymous shared login.
 * This is a static directory, not a second CMS.
 */

export const PARTNER_PORTAL_ORIGIN = "https://partner.searsmelvin.co.uk";

const SM_STAFF_BY_EMAIL = {
  "arin@searsmelvin.co.uk": { name: "Arin", role: "admin" },
  "matthew@searsmelvin.co.uk": { name: "Matthew", role: "admin" },
  "aylin@searsmelvin.co.uk": { name: "Aylin", role: "operations" },
  "karen@searsmelvin.co.uk": { name: "Karen", role: "operations" },
};

export function staffFromEmail(email, extras = {}) {
  const normalised = String(email || "").trim().toLowerCase();
  if (!normalised.endsWith("@searsmelvin.co.uk")) return null;
  const known = SM_STAFF_BY_EMAIL[normalised];
  const given = String(extras.given_name || extras.name || "").trim().split(/\s+/)[0];
  return {
    email: normalised,
    name: known?.name || given || titleCaseLocal(normalised),
    role: known?.role || "operations",
  };
}

export function staffFromGooglePayload(payload) {
  return staffFromEmail(payload?.email, payload);
}

export function encodePartnerSessionToken(randomToken, staff) {
  if (!staff?.email || !randomToken) return randomToken;
  return `${randomToken}.${toBase64Url(JSON.stringify({
    email: staff.email,
    name: staff.name,
    role: staff.role,
  }))}`;
}

export function staffFromSessionToken(token) {
  if (typeof token !== "string") return null;
  const separator = token.indexOf(".");
  if (separator < 0) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(token.slice(separator + 1)));
    const staff = staffFromEmail(parsed?.email, parsed);
    return staff?.name ? staff : null;
  } catch {
    return null;
  }
}

export function publicStaff(staff) {
  if (!staff?.email || !staff?.name) return null;
  return {
    email: staff.email,
    name: staff.name,
    role: staff.role === "admin" ? "admin" : "operations",
  };
}

export function actorFromStaff(staff) {
  const published = publicStaff(staff);
  if (!published) return {};
  return {
    actor_type: "sears_melvin_staff",
    actor_email: published.email,
    actor_name: published.name,
    actor_role: published.role,
  };
}

function titleCaseLocal(email) {
  const local = email.split("@")[0] || "Staff";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function toBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}
