-- NOT APPLIED. Additive, idempotent referrer-host column.
-- Review before applying to the Mason App project.

alter table public.enquiries
  add column if not exists referrer text;
