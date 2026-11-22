-- NOT APPLIED. Additive, idempotent GHL opportunity write-back columns.
-- Review before applying to the Mason App project.

alter table public.enquiries
  add column if not exists ghl_opportunity_id text;

alter table public.enquiries
  add column if not exists ghl_synced_at timestamptz;

create index if not exists enquiries_ghl_opportunity_id_idx
  on public.enquiries (ghl_opportunity_id)
  where ghl_opportunity_id is not null;
