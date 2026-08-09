begin;

-- Legacy memorial records contain personal and cemetery data and have no
-- organisation key. They cannot be safely exposed through a multi-tenant
-- browser role, so keep them backend-only until they are migrated.
drop policy if exists "Allow all access to memorials" on public.memorials;
revoke all on table public.memorials from public, anon, authenticated;
grant select, insert, update, delete on table public.memorials to service_role;

-- Inbox routing metadata is backend plumbing. Public catalogue visitors never
-- need direct Data API access to account or contact routing records.
drop policy if exists anon_select_contact_handles on public.contact_handles;
drop policy if exists anon_select_inbox_channel_accounts on public.inbox_channel_accounts;
revoke all on table public.contact_handles from public, anon, authenticated;
revoke all on table public.inbox_channel_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.contact_handles to service_role;
grant select, insert, update, delete on table public.inbox_channel_accounts to service_role;

commit;
