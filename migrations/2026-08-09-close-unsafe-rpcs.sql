begin;

-- These read functions deliberately bypass table RLS, so the organisation
-- membership check must live inside the SECURITY DEFINER boundary.
create or replace function public.get_customer_messages(
  p_person_id uuid,
  p_organization_id uuid
)
returns setof public.inbox_messages
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from public.inbox_messages as m
  join public.inbox_conversations as c
    on c.id = m.conversation_id
  where public.user_is_member_of_org(p_organization_id)
    and c.person_id = p_person_id
    and c.organization_id = p_organization_id
  order by coalesce(m.sent_at, m.created_at) asc, m.created_at asc, m.id asc;
$$;

create or replace function public.get_unlinked_messages(
  p_channel text,
  p_handle text,
  p_organization_id uuid
)
returns setof public.inbox_messages
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from public.inbox_messages as m
  join public.inbox_conversations as c
    on c.id = m.conversation_id
  where public.user_is_member_of_org(p_organization_id)
    and c.organization_id = p_organization_id
    and c.channel = p_channel
    and c.primary_handle = p_handle
    and c.person_id is null
  order by coalesce(m.sent_at, m.created_at) asc, m.created_at asc, m.id asc;
$$;

-- Reading a per-request setting needs no owner privileges.
create or replace function public.get_active_organization_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('app.active_organization_id', true), '')::uuid;
$$;

-- These are backend/trigger plumbing, not browser-callable business RPCs.
revoke execute on function public.create_inbox_from_enquiry(uuid)
  from public, anon, authenticated;
revoke execute on function public.recompute_person_is_customer(uuid)
  from public, anon, authenticated;
grant execute on function public.create_inbox_from_enquiry(uuid) to service_role;
grant execute on function public.recompute_person_is_customer(uuid) to service_role;

commit;
