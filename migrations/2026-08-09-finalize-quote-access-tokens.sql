-- Run only after the Worker reads quote_access_tokens. New quote inserts are
-- atomically hashed and their plaintext edit_token is erased in the same DB
-- transaction. Existing emailed links continue to work.

create or replace function public.capture_quote_access_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_type = 'quote' and new.edit_token is not null then
    insert into public.quote_access_tokens (
      order_id, organization_id, token_hash, expires_at, created_at, updated_at
    ) values (
      new.id,
      new.organization_id,
      'sha256:' || pg_catalog.encode(extensions.digest(new.edit_token, 'sha256'), 'hex'),
      coalesce(new.created_at, pg_catalog.clock_timestamp()) + interval '90 days',
      coalesce(new.created_at, pg_catalog.clock_timestamp()),
      pg_catalog.clock_timestamp()
    )
    on conflict (order_id) do update set
      organization_id = excluded.organization_id,
      token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at;

    update public.orders set edit_token = null where id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.capture_quote_access_token()
  from public, anon, authenticated;
grant execute on function public.capture_quote_access_token() to service_role;

drop trigger if exists capture_quote_access_token_after_write on public.orders;
create trigger capture_quote_access_token_after_write
after insert or update of edit_token on public.orders
for each row
when (new.order_type = 'quote' and new.edit_token is not null)
execute function public.capture_quote_access_token();

-- Catch any quotes created between the additive migration and Worker deploy.
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
where order_type = 'quote' and edit_token is not null
on conflict (order_id) do update set
  organization_id = excluded.organization_id,
  token_hash = excluded.token_hash,
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at;

-- The additive migration already copied these values, so this removes only the
-- plaintext representation—not the customer's access.
update public.orders
set edit_token = null
where order_type = 'quote' and edit_token is not null;

create or replace function public.prune_expired_quote_access_tokens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.quote_access_tokens
  where ctid in (
    select ctid from public.quote_access_tokens
    where expires_at <= pg_catalog.clock_timestamp()
    order by expires_at limit 100
  );
  return null;
end;
$$;

revoke all on function public.prune_expired_quote_access_tokens()
  from public, anon, authenticated;
grant execute on function public.prune_expired_quote_access_tokens() to service_role;

drop trigger if exists prune_expired_quote_access_tokens_after_insert
  on public.quote_access_tokens;
create trigger prune_expired_quote_access_tokens_after_insert
after insert on public.quote_access_tokens
for each statement execute function public.prune_expired_quote_access_tokens();
