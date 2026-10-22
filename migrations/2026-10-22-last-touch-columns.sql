-- NOT APPLIED. Additive, idempotent last-touch attribution columns.
-- Review before applying to the Mason App project.

alter table public.enquiries
  add column if not exists last_gclid text,
  add column if not exists last_gbraid text,
  add column if not exists last_wbraid text,
  add column if not exists last_utm_source text,
  add column if not exists last_utm_medium text,
  add column if not exists last_utm_campaign text,
  add column if not exists last_utm_term text,
  add column if not exists last_utm_content text;

alter table public.brochure_downloads
  add column if not exists lead_source text,
  add column if not exists last_gclid text,
  add column if not exists last_gbraid text,
  add column if not exists last_wbraid text,
  add column if not exists last_utm_source text,
  add column if not exists last_utm_medium text,
  add column if not exists last_utm_campaign text,
  add column if not exists last_utm_term text,
  add column if not exists last_utm_content text;

alter table public.brochure_downloads enable row level security;
revoke all on public.brochure_downloads from anon, authenticated;
