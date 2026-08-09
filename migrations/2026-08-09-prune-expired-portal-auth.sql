-- Keep expired authentication material out of the database without requiring
-- pg_cron. Each new auth record performs a small, index-backed cleanup pass.

create index if not exists admin_sessions_expires_at_idx
  on public.admin_sessions (expires_at);
create index if not exists partner_sessions_expires_at_idx
  on public.partner_sessions (expires_at);
create index if not exists password_reset_tokens_expires_at_idx
  on public.password_reset_tokens (expires_at);

create or replace function public.prune_expired_portal_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.admin_sessions
  where ctid in (
    select ctid from public.admin_sessions
    where expires_at <= pg_catalog.clock_timestamp()
    order by expires_at limit 100
  );

  delete from public.partner_sessions
  where ctid in (
    select ctid from public.partner_sessions
    where expires_at <= pg_catalog.clock_timestamp()
    order by expires_at limit 100
  );

  delete from public.password_reset_tokens
  where ctid in (
    select ctid from public.password_reset_tokens
    where expires_at <= pg_catalog.clock_timestamp()
       or (used and coalesce(used_at, created_at) < pg_catalog.clock_timestamp() - interval '7 days')
    order by expires_at limit 100
  );

  delete from public.customer_portal_tokens
  where ctid in (
    select ctid from public.customer_portal_tokens
    where expires_at <= pg_catalog.clock_timestamp()
    order by expires_at limit 100
  );

  return null;
end;
$$;

revoke all on function public.prune_expired_portal_auth()
  from public, anon, authenticated;
grant execute on function public.prune_expired_portal_auth() to service_role;

drop trigger if exists prune_expired_portal_auth_admin on public.admin_sessions;
create trigger prune_expired_portal_auth_admin
after insert on public.admin_sessions
for each statement execute function public.prune_expired_portal_auth();

drop trigger if exists prune_expired_portal_auth_partner on public.partner_sessions;
create trigger prune_expired_portal_auth_partner
after insert on public.partner_sessions
for each statement execute function public.prune_expired_portal_auth();

drop trigger if exists prune_expired_portal_auth_reset on public.password_reset_tokens;
create trigger prune_expired_portal_auth_reset
after insert on public.password_reset_tokens
for each statement execute function public.prune_expired_portal_auth();

drop trigger if exists prune_expired_portal_auth_customer on public.customer_portal_tokens;
create trigger prune_expired_portal_auth_customer
after insert on public.customer_portal_tokens
for each statement execute function public.prune_expired_portal_auth();
