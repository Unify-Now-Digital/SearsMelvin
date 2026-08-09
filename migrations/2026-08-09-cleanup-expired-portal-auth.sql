-- One-time cleanup to accompany the ongoing prune_expired_portal_auth triggers.
-- Active sessions and unexpired setup/reset links are deliberately preserved.

delete from public.admin_sessions
where expires_at <= pg_catalog.clock_timestamp();

delete from public.partner_sessions
where expires_at <= pg_catalog.clock_timestamp();

delete from public.password_reset_tokens
where expires_at <= pg_catalog.clock_timestamp()
   or (used and coalesce(used_at, created_at) < pg_catalog.clock_timestamp() - interval '7 days');

delete from public.customer_portal_tokens
where expires_at <= pg_catalog.clock_timestamp();
