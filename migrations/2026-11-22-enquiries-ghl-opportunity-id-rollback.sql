-- DATA LOSS WARNING: removes saved GHL opportunity ids and sync timestamps.
-- NOT APPLIED. Review before applying to the Mason App project.

drop index if exists public.enquiries_ghl_opportunity_id_idx;

alter table public.enquiries
  drop column if exists ghl_opportunity_id,
  drop column if exists ghl_synced_at;
