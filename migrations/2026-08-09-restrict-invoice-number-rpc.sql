begin;

create or replace function public.get_next_invoice_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not public.user_has_organization() then
    raise exception 'Organisation membership is required'
      using errcode = '42501';
  end if;

  return 'INV-' || pg_catalog.lpad(
    pg_catalog.nextval('public.invoice_number_seq'::pg_catalog.regclass)::text,
    6,
    '0'
  );
end;
$$;

revoke execute on function public.get_next_invoice_number() from public, anon;
grant execute on function public.get_next_invoice_number() to authenticated, service_role;

commit;
