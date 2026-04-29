const CORS = {
  'Access-Control-Allow-Origin': 'https://searsmelvin.co.uk',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const { amount, name, email, cemetery, product, invoiceId } = body;
  const parsedAmount = Number(amount);
  if (!parsedAmount || parsedAmount <= 0) {
    return new Response(JSON.stringify({ error: 'Invalid amount' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const params = new URLSearchParams({
    amount:                               String(Math.round(parsedAmount * 100)),
    currency:                             'gbp',
    'automatic_payment_methods[enabled]': 'true',
    'metadata[customer_name]':            name       || '',
    'metadata[customer_email]':           email      || '',
    'metadata[cemetery]':                 cemetery   || '',
    'metadata[product]':                  product    || '',
    'metadata[invoice_id]':               invoiceId  || '',
    description:                          `Deposit + permit — ${product || 'Memorial'} — ${name || ''}`,
  });

  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const pi = await res.json();

  if (pi.error) {
    return new Response(JSON.stringify({ error: pi.error.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ clientSecret: pi.client_secret }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
