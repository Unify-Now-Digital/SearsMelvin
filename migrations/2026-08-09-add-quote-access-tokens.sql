-- Transitional first step: copy existing quote capabilities into a protected,
-- hashed table. Plaintext columns remain temporarily so the currently deployed
-- Worker keeps serving old links until the matching code is deployed.

create table if not exists public.quote_access_tokens (
  order_id uuid primary key references public.orders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_access_tokens_org_expiry_idx
  on public.quote_access_tokens (organization_id, expires_at);

alter table public.quote_access_tokens enable row level security;
revoke all on public.quote_access_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.quote_access_tokens to service_role;

insert into public.quote_access_tokens (
  order_id, organization_id, token_hash, expires_at, created_at, updated_at
)
select
  id,
  organization_id,
  'sha256:' || pg_catalog.encode(extensions.digest(edit_token, 'sha256'), 'hex'),
  coalesce(created_at, pg_catalog.clock_timestamp()) + interval '90 days',
  coalesce(created_at, pg_catalog.clock_timestamp()),
  pg_catalog.clock_timestamp()
from public.orders
where order_type = 'quote'
  and edit_token is not null
on conflict (order_id) do update set
  organization_id = excluded.organization_id,
  token_hash = excluded.token_hash,
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at;

comment on table public.quote_access_tokens is
  'Service-role-only quote links. Raw capabilities are never stored after the transition migration completes.';
