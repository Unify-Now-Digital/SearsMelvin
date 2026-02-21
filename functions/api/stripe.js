export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { amount, name, email, cemetery, product, invoiceId } = await request.json();

  const body = new URLSearchParams({
    amount:                               String(Math.round(Number(amount) * 100)),
    currency:                             'gbp',
    'automatic_payment_methods[enabled]': 'true',
    'metadata[customer_name]':            name       || '',
    'metadata[customer_email]':           email      || '',
    'metadata[cemetery]':                 cemetery   || '',
    'metadata[product]':                  product    || '',
    'metadata[invoice_id]':               invoiceId  || '',
    description:                          `50% deposit — ${product || 'Memorial'} — ${name || ''}`,
  });

  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body,
  });

  const pi = await res.json();

  if (pi.error) {
    return new Response(JSON.stringify({ error: pi.error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ clientSecret: pi.client_secret }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
