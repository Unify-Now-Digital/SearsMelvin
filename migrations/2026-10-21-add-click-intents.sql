-- DRAFT / UNAPPLIED: needs Arin's go before applying.
-- Retention: delete click_intents rows after 120 days.

create table public.click_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  kind text not null check (kind in ('chat', 'call')),
  gclid text,
  gbraid text,
  wbraid text,
  landing_page text,
  page text,
  email text,
  phone text,
  user_agent text,
  matched_ghl_contact_id text,
  matched_at timestamptz,
  created_at timestamptz default now()
);

create index click_intents_organization_created_idx
  on public.click_intents (organization_id, created_at desc);

alter table public.click_intents enable row level security;

revoke all on table public.click_intents from anon, authenticated;
