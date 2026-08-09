-- Expiring, hashed, tenant-scoped order tracking capabilities. The raw token is
-- delivered to the customer but is never persisted or recoverable from the DB.

create table if not exists public.order_tracking_tokens (
  order_id uuid primary key references public.orders(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_tracking_tokens_org_expiry_idx
  on public.order_tracking_tokens (organization_id, expires_at);

alter table public.order_tracking_tokens enable row level security;
revoke all on public.order_tracking_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.order_tracking_tokens to service_role;

comment on table public.order_tracking_tokens is
  'Service-role-only 30-day order links. Only SHA-256 token digests are stored.';

create or replace function public.prune_expired_order_tracking_tokens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.order_tracking_tokens
  where ctid in (
    select ctid from public.order_tracking_tokens
    where expires_at <= pg_catalog.clock_timestamp()
    order by expires_at limit 100
  );
  return null;
end;
$$;

revoke all on function public.prune_expired_order_tracking_tokens()
  from public, anon, authenticated;
grant execute on function public.prune_expired_order_tracking_tokens() to service_role;

drop trigger if exists prune_expired_order_tracking_tokens_after_insert
  on public.order_tracking_tokens;
create trigger prune_expired_order_tracking_tokens_after_insert
after insert on public.order_tracking_tokens
for each statement execute function public.prune_expired_order_tracking_tokens();
