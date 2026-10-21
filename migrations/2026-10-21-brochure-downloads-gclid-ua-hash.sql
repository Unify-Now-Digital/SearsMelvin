-- 2026-10-21 — add privacy-safe attribution to brochure download counts.
--
-- NOT YET APPLIED (apply after 2026-10-11 file). Idempotent. Adds only the
-- Google click ID and a SHA-256 hex hash of the user agent; no raw user agent,
-- IP address or other PII is stored. Inserts use the Worker's service key.
-- RLS remains enabled and anon/authenticated have no SELECT or INSERT access.

alter table public.brochure_downloads
  add column if not exists gclid text,
  add column if not exists ua_hash text;

alter table public.brochure_downloads enable row level security;
revoke all on public.brochure_downloads from anon, authenticated;

-- Drop first because the projected columns change.
drop view if exists public.brochure_download_counts;
create view public.brochure_download_counts
with (security_invoker = true) as
select organization_id,
       date_trunc('day', created_at)::date as day,
       source,
       count(*)                            as downloads,
       count(*) filter (where email_given) as with_email,
       count(*) filter (where gclid is not null) as with_gclid
from public.brochure_downloads
group by 1, 2, 3;

revoke all on public.brochure_download_counts from anon, authenticated;

create or replace view public.brochure_download_daily
with (security_invoker = true) as
select organization_id,
       date_trunc('day', created_at)::date as day,
       count(*) as downloads
from public.brochure_downloads
group by 1, 2;

revoke all on public.brochure_download_daily from anon, authenticated;

-- Sears Melvin count query:
--   select day, downloads
--   from public.brochure_download_daily
--   where organization_id = '3770972d-1bbd-417b-b413-297e844db285'
--   order by day desc;
