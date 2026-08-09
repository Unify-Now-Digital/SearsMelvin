-- Prevent unauthenticated Data API callers from invoking owner-privileged
-- functions. Preserve authenticated/service-role access for the connected CRM;
-- the website's quote RPC is intentionally service-role only.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', fn.signature);
  end loop;
end
$$;

revoke execute on function public.create_quote(jsonb) from authenticated;
grant execute on function public.create_quote(jsonb) to service_role;

-- Make the view enforce the querying user's permissions/RLS rather than the
-- view owner's privileges.
alter view public.v_order_line_items set (security_invoker = true);

notify pgrst, 'reload schema';
