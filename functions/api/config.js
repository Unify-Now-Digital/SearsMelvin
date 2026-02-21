export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || '',
    googleMapsKey:        env.GOOGLE_MAPS_KEY        || '',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
