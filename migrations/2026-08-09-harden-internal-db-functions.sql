begin;

-- Fix mutable search paths. All referenced application objects are explicitly
-- schema-qualified so callers cannot redirect a SECURITY DEFINER function to
-- attacker-controlled objects.
alter function public.set_updated_at() set search_path = '';
alter function public.update_updated_at() set search_path = '';
alter function public.enquiries_set_updated_at() set search_path = '';
alter function public.jsonb_diff_rows(jsonb, jsonb, text[]) set search_path = '';
alter function public.log_activity_generic() set search_path = '';
alter function public.activity_log_write(uuid, text, uuid, text, jsonb, jsonb) set search_path = '';

create or replace function public.get_next_invoice_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  return 'INV-' || pg_catalog.lpad(
    pg_catalog.nextval('public.invoice_number_seq'::pg_catalog.regclass)::text,
    6,
    '0'
  );
end;
$$;

-- Credential decryption and credential replacement must only happen in
-- trusted backend code. An authenticated browser user must never be able to
-- decrypt or replace another organisation's provider credentials.
revoke execute on function public.get_ghl_api_key(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.get_stripe_secret_key(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.get_stripe_webhook_secret(uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.upsert_organization_stripe_credentials(
  uuid, text, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.get_ghl_api_key(uuid, text) to service_role;
grant execute on function public.get_stripe_secret_key(uuid, text, text) to service_role;
grant execute on function public.get_stripe_webhook_secret(uuid, text, text) to service_role;
grant execute on function public.upsert_organization_stripe_credentials(
  uuid, text, text, text, text, text, text, text
) to service_role;

-- These functions are internal trigger plumbing (or helpers used only by that
-- plumbing). Removing Data API execution prevents log forgery and keeps them
-- out of the externally callable RPC surface; database triggers still run.
revoke execute on function public.activity_log_write(uuid, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public.jsonb_diff_rows(jsonb, jsonb, text[])
  from public, anon, authenticated;
revoke execute on function public.enquiries_set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.log_activity_generic()
  from public, anon, authenticated;
revoke execute on function public.organization_members_last_admin_guard()
  from public, anon, authenticated;
revoke execute on function public.set_ghl_connections_updated_at()
  from public, anon, authenticated;
revoke execute on function public.set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.trg_invoice_payments_recompute_customer()
  from public, anon, authenticated;
revoke execute on function public.trg_invoices_recompute_customer()
  from public, anon, authenticated;
revoke execute on function public.trg_sync_enquiry_to_inbox()
  from public, anon, authenticated;
revoke execute on function public.update_conversation_directional_timestamps()
  from public, anon, authenticated;
revoke execute on function public.update_updated_at()
  from public, anon, authenticated;
revoke execute on function public.update_updated_at_column()
  from public, anon, authenticated;

grant execute on function public.activity_log_write(uuid, text, uuid, text, jsonb, jsonb)
  to service_role;
grant execute on function public.jsonb_diff_rows(jsonb, jsonb, text[]) to service_role;

-- These are service-only state tables. They already had deny-all RLS, but
-- removing broad table grants avoids accidental exposure if policies change.
revoke all on table public.ghl_send_idempotency from public, anon, authenticated;
revoke all on table public.oauth_state from public, anon, authenticated;
revoke all on table public.order_events from public, anon, authenticated;
revoke all on table public.quote_followups from public, anon, authenticated;

commit;
