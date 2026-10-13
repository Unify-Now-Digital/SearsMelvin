-- Google Ads click IDs + UTMs on enquiries (quote, contact, shortlist,
-- appointment). Written by functions/api/submit.js; read by the daily offline
-- conversion upload (click conversions when gclid is present).
-- Nullable, no defaults, no backfill: existing rows are untouched.
alter table public.enquiries
  add column if not exists gclid        text,
  add column if not exists gbraid       text,
  add column if not exists wbraid       text,
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_term     text,
  add column if not exists utm_content  text;
