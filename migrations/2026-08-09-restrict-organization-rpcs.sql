-- SECURITY DEFINER RPCs perform their own membership/admin checks, but they
-- must not inherit PostgreSQL's default EXECUTE grant to PUBLIC/anon.

alter function public.get_organization_members_with_identity(uuid) set search_path = '';
alter function public.user_is_admin_of_org(uuid) set search_path = '';
alter function public.user_is_member_of_org(uuid) set search_path = '';

revoke execute on function public.add_organization_member_by_email(uuid, text) from public, anon;
revoke execute on function public.change_member_role(uuid, uuid, text) from public, anon;
revoke execute on function public.create_organization(text) from public, anon;
revoke execute on function public.delete_conversations(uuid[]) from public, anon;
revoke execute on function public.delete_organization(uuid) from public, anon;
revoke execute on function public.get_customer_messages(uuid, uuid) from public, anon;
revoke execute on function public.get_inquiries_pipeline(uuid, text[], timestamptz, timestamptz) from public, anon;
revoke execute on function public.get_next_invoice_number() from public, anon;
revoke execute on function public.get_organization_members_with_identity(uuid) from public, anon;
revoke execute on function public.get_unlinked_messages(text, text, uuid) from public, anon;
revoke execute on function public.remove_organization_member(uuid, uuid) from public, anon;
revoke execute on function public.user_has_organization() from public, anon;
revoke execute on function public.user_is_admin_of_org(uuid) from public, anon;
revoke execute on function public.user_is_member_of_org(uuid) from public, anon;

grant execute on function public.add_organization_member_by_email(uuid, text) to authenticated, service_role;
grant execute on function public.change_member_role(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.create_organization(text) to authenticated, service_role;
grant execute on function public.delete_conversations(uuid[]) to authenticated, service_role;
grant execute on function public.delete_organization(uuid) to authenticated, service_role;
grant execute on function public.get_customer_messages(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_inquiries_pipeline(uuid, text[], timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.get_next_invoice_number() to authenticated, service_role;
grant execute on function public.get_organization_members_with_identity(uuid) to authenticated, service_role;
grant execute on function public.get_unlinked_messages(text, text, uuid) to authenticated, service_role;
grant execute on function public.remove_organization_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.user_has_organization() to authenticated, service_role;
grant execute on function public.user_is_admin_of_org(uuid) to authenticated, service_role;
grant execute on function public.user_is_member_of_org(uuid) to authenticated, service_role;

