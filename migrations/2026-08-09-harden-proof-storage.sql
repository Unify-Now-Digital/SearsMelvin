begin;

create or replace function public.user_has_organization()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as membership
    where membership.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.user_has_organization() from public, anon;
grant execute on function public.user_has_organization() to authenticated, service_role;

drop policy if exists "Users can upload own proof renders" on storage.objects;
drop policy if exists "Users can read own proof renders" on storage.objects;
drop policy if exists "Users can delete own proof renders" on storage.objects;

create policy "Organisation users can upload own proof renders"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'proof-renders'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.user_has_organization()
);

create policy "Organisation users can read own proof renders"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'proof-renders'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.user_has_organization()
);

create policy "Organisation users can delete own proof renders"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'proof-renders'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.user_has_organization()
);

update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    ]::text[]
where id = 'proof-renders';

commit;
