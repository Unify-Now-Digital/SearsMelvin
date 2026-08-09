-- Portal authentication records are server-only.
--
-- These tables are accessed exclusively by Cloudflare Pages Functions using
-- SUPABASE_SERVICE_KEY. The public web client must never be able to read
-- password hashes/session/reset tokens or change partner approval state.
--
-- PostgreSQL permissive RLS policies are OR-combined, so a `USING (false)`
-- policy does not cancel an earlier `USING (true)` policy. Remove the unsafe
-- allow policies and revoke the underlying Data API privileges as a second
-- layer of protection.

drop policy if exists allow_anon_admin_sessions on public.admin_sessions;
drop policy if exists allow_anon_partner_sessions on public.partner_sessions;
drop policy if exists allow_anon_partners on public.partners;
drop policy if exists allow_anon_password_reset_tokens on public.password_reset_tokens;

revoke all privileges on table public.admin_sessions from anon, authenticated;
revoke all privileges on table public.partner_sessions from anon, authenticated;
revoke all privileges on table public.partners from anon, authenticated;
revoke all privileges on table public.password_reset_tokens from anon, authenticated;

notify pgrst, 'reload schema';
