-- Opportunistic bounded retention. Running on a small sample of audit inserts
-- avoids requiring pg_cron while keeping cleanup work small and indexed.

create or replace function public.prune_portal_security_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.random() < 0.05 then
    delete from public.portal_rate_limits
    where ctid in (
      select ctid
      from public.portal_rate_limits
      where expires_at < pg_catalog.clock_timestamp()
      order by expires_at
      limit 500
    );

    delete from public.portal_security_events
    where ctid in (
      select ctid
      from public.portal_security_events
      where created_at < pg_catalog.clock_timestamp() - interval '90 days'
      order by created_at
      limit 500
    );
  end if;
  return null;
end;
$$;

revoke all on function public.prune_portal_security_data() from public, anon, authenticated;
grant execute on function public.prune_portal_security_data() to service_role;

drop trigger if exists prune_portal_security_data_after_insert
  on public.portal_security_events;
create trigger prune_portal_security_data_after_insert
after insert on public.portal_security_events
for each statement execute function public.prune_portal_security_data();

