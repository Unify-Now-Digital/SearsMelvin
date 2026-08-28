-- 2026-08-28 — partner portal permit spine (Arin Melvin locked process).
--
-- NOT YET APPLIED. This repo has no migration runner and no state table.
-- A file in migrations/ is not proof it has been applied. Review against the
-- Mason App project (bfwohzcugtwbhhxdqgme) before running.
--
-- Why this exists
-- ---------------
-- The partner dashboard now records a 7-step permit spine. Display maps old
-- stored values onto that spine without rewriting rows. New writes use:
--
--   match_form | form_sent | customer_completed | completing |
--   submitted | resolve_issues | approved
--
-- Live evidence (21 Jun 2026 public schema + partner code already in use):
--   order_permits.permit_phase was
--     form_needed · with_customer · completing · submitted · approved
--     (spec also asked to add rejected, not_required)
--   Partner code already treated
--     form_sent, with_customer, customer_completed, completing,
--     submitted, approved, pending
--
-- This migration only ADDS missing labels. It does not rewrite existing
-- order_permits or orders.permit_status rows. The Worker maps old → new
-- at read time (see PERMIT_SPINE in functions/api/partner-orders.js).
--
-- Apply after confirming the column type:
--   select data_type, udt_name
--   from information_schema.columns
--   where table_schema='public' and table_name='order_permits'
--     and column_name='permit_phase';

do $$
declare
  enum_name text;
  missing text;
begin
  select t.typname
    into enum_name
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'order_permits'
    and a.attname = 'permit_phase'
    and t.typtype = 'e';

  if enum_name is null then
    raise notice 'order_permits.permit_phase is not an enum; no ADD VALUE needed';
    return;
  end if;

  foreach missing in array array[
    'match_form',
    'form_needed',
    'form_sent',
    'with_customer',
    'customer_completed',
    'completing',
    'submitted',
    'resolve_issues',
    'rejected',
    'approved',
    'not_required',
    'pending'
  ]
  loop
    execute format('alter type %I add value if not exists %L', enum_name, missing);
  end loop;
end $$;
