-- NOT YET APPLIED. Adds bounded campaign attribution to click intents.
-- Idempotent; service-role inserts remain protected by the existing RLS policy.

alter table public.click_intents
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_term text,
  add column if not exists utm_content text;

alter table public.click_intents enable row level security;
revoke all on public.click_intents from anon, authenticated;
