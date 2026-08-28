-- 2026-08-26 — two findings from the tooling audit.
--
-- NOT YET APPLIED. Review before running against the Mason App project
-- (bfwohzcugtwbhhxdqgme). Both statements are idempotent.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `cemeteries_public_read` was granted to `authenticated` only.
--
-- The public website talks to PostgREST with the *anon* key, so the policy
-- named "public read" never applied to the public. Every browser-side cemetery
-- query on searsmelvin.co.uk returned `[]`:
--
--   * /permit-checker      — the whole page is non-functional (its only job is
--                            looking up a cemetery's permit fee + timescale)
--   * /memorials/<slug>    — the quote form's cemetery picker is empty, so
--                            `_selectedCemeteryFee` stays 0 and every quote
--                            email reads "Permit fee not yet determined"
--   * /contact             — cemetery dropdown empty
--
-- Measured impact over the 120 days to 2026-08-26: 81 enquiries (53 with a
-- free-typed cemetery) and 30 quote orders (21 with one) — and zero of either
-- with a resolved `cemetery_id`.
--
-- The replacement is scoped rather than `using (true)`: `cemeteries` is shared
-- between tenants (Sears Melvin owns 6 rows, the other tenant ~134), so an
-- unscoped grant would publish the other tenant's cemeteries and permit fees on
-- the Sears Melvin site. Anon gets Sears Melvin's active, non-test rows only.
-- Staff access is unchanged: `cemeteries_org_select` still covers authenticated
-- users via user_is_member_of_org().
drop policy if exists cemeteries_public_read on public.cemeteries;

create policy cemeteries_public_read
  on public.cemeteries
  for select
  to anon
  using (
    is_active
    and coalesce(is_test, false) = false
    and organization_id = '3770972d-1bbd-417b-b413-297e844db285'::uuid  -- Sears Melvin
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `activity_log_write` trusts a caller-supplied user id.
--
-- The function is SECURITY DEFINER, executable by `authenticated` over
-- /rest/v1/rpc/activity_log_write, and inserts `p_user_id` verbatim without
-- ever consulting auth.uid(). Any signed-in user can therefore write audit-log
-- entries attributed to any other user, which makes activity_logs unreliable
-- as an audit trail (6,633 rows today).
--
-- Fix: ignore the caller's claim and stamp the authenticated identity. The
-- parameter is kept so existing callers keep type-checking; the service role
-- (which has no auth.uid()) may still pass one explicitly for system writes.
create or replace function public.activity_log_write(
  p_user_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_changes jsonb,
  p_context jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid;
begin
  -- A signed-in caller is always logged as themselves. Only the service role
  -- (auth.uid() is null) may attribute a write to another user.
  v_user_id := coalesce(auth.uid(), p_user_id);

  insert into public.activity_logs (user_id, entity_type, entity_id, action, changes, context)
  values (
    v_user_id,
    p_entity_type,
    p_entity_id,
    p_action,
    coalesce(p_changes, '{}'::jsonb),
    coalesce(p_context, '{}'::jsonb)
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. create_quote resolves the cemetery without an organization filter.
--
-- See migrations/2026-05-20-create-quote-rpc.sql. Its fallback name lookup
-- searches every tenant's cemeteries, so a free-typed name could attach another
-- tenant's cemetery id (and permit fee) to a Sears Melvin quote. The Worker-side
-- equivalent (lookupCemeteryIdByName in functions/api/submit.js) is fixed in
-- code; the RPC needs the same `and c.organization_id = v_org` predicate added
-- to its lookup. Left out of this migration deliberately: it means re-declaring
-- the whole function, which should be done from the current definition rather
-- than the checked-in one in case it has drifted.
