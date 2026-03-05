const CORS = {
  'Access-Control-Allow-Origin': 'https://searsmelvin.co.uk',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || '',
    googleMapsKey:        env.GOOGLE_MAPS_KEY        || '',
  }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
