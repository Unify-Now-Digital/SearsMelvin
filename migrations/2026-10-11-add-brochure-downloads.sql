-- 2026-10-11 — brochure download log for /api/brochure.
--
-- NOT YET APPLIED. Review before running against the Mason App project
-- (bfwohzcugtwbhhxdqgme). Idempotent. Until it is applied, /api/brochure
-- inserts fail open (logged as brochure_download_log_failed) and downloads
-- still work; GA4 (via GTM `brochure_download`) and Workers logs still count.
--
-- One row per brochure download click or "Email me a copy" request. No email
-- address or IP is stored — only whether an email was given. Written by the
-- Worker with the service key; no anon/authenticated access.
create table if not exists public.brochure_downloads (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  organization_id uuid not null references public.organizations(id),
  source          text not null check (source in ('header','home','product','listing','brochure_page')),
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  email_given     boolean not null default false,
  page_path       text
);

create index if not exists brochure_downloads_org_created_idx
  on public.brochure_downloads (organization_id, created_at desc);

alter table public.brochure_downloads enable row level security;
revoke all on public.brochure_downloads from anon, authenticated;

-- Simple admin count view (service role / SQL editor only).
create or replace view public.brochure_download_counts
with (security_invoker = true) as
select organization_id,
       date_trunc('day', created_at)::date as day,
       source,
       count(*)                              as downloads,
       count(*) filter (where email_given)   as with_email
from public.brochure_downloads
group by 1, 2, 3;

revoke all on public.brochure_download_counts from anon, authenticated;

-- Count query (Sears Melvin only), e.g. last 30 days by source:
--   select source, sum(downloads) as downloads, sum(with_email) as with_email
--   from public.brochure_download_counts
--   where organization_id = '3770972d-1bbd-417b-b413-297e844db285'
--     and day >= current_date - 30
--   group by source order by downloads desc;
