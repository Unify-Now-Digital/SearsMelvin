-- Stripe may deliver the same event concurrently. The provider PaymentIntent
-- reference is the idempotency key and must exist at most once.

create unique index if not exists payments_stripe_reference_unique_idx
  on public.payments (reference)
  where reference is not null;

