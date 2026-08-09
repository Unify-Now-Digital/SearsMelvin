import { hardenedJson, isSameOriginRequest } from "./_security.js";

function publicValue(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength ? value : "";
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Allow": "GET, OPTIONS",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function onRequestGet({ request, env }) {
  if (!isSameOriginRequest(request)) {
    return hardenedJson({ ok: false, error: "Cross-origin request rejected" }, 403);
  }

  // These three values are intentionally public browser identifiers. Secrets such
  // as Stripe's secret key and Google OAuth refresh tokens must never be added here.
  return hardenedJson({
    stripePublishableKey: publicValue(env.STRIPE_PUBLISHABLE_KEY, 256),
    googleMapsKey: publicValue(env.GOOGLE_MAPS_KEY, 256),
    googleClientId: publicValue(env.GOOGLE_CLIENT_ID, 512),
  });
}
