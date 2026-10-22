-- NOT APPLIED

alter table public.enquiries
  add column if not exists consent_ad_user_data text,
  add column if not exists consent_ad_personalization text,
  add column if not exists consent_captured_at timestamptz;

alter table public.brochure_downloads
  add column if not exists consent_ad_user_data text,
  add column if not exists consent_ad_personalization text,
  add column if not exists consent_captured_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.enquiries'::regclass and conname = 'enquiries_consent_ad_user_data_check') then
    alter table public.enquiries add constraint enquiries_consent_ad_user_data_check
      check (consent_ad_user_data in ('granted', 'denied', 'unknown')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.enquiries'::regclass and conname = 'enquiries_consent_ad_personalization_check') then
    alter table public.enquiries add constraint enquiries_consent_ad_personalization_check
      check (consent_ad_personalization in ('granted', 'denied', 'unknown')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.brochure_downloads'::regclass and conname = 'brochure_downloads_consent_ad_user_data_check') then
    alter table public.brochure_downloads add constraint brochure_downloads_consent_ad_user_data_check
      check (consent_ad_user_data in ('granted', 'denied', 'unknown')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.brochure_downloads'::regclass and conname = 'brochure_downloads_consent_ad_personalization_check') then
    alter table public.brochure_downloads add constraint brochure_downloads_consent_ad_personalization_check
      check (consent_ad_personalization in ('granted', 'denied', 'unknown')) not valid;
  end if;
end
$$;

create table if not exists public.sm_offline_upload_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  order_number text not null,
  transaction_id text not null,
  conversion_action text not null,
  sent_at timestamptz not null default now(),
  status text not null check (status in ('sent', 'validated', 'failed', 'skipped_duplicate')),
  request_id text,
  click_id_type text check (click_id_type in ('gclid', 'gbraid', 'wbraid', 'none')),
  consent_ad_user_data text,
  consent_ad_personalization text,
  error text,
  created_at timestamptz default now()
);

create unique index if not exists sm_offline_upload_log_sent_conversion_transaction_uidx
  on public.sm_offline_upload_log (conversion_action, transaction_id)
  where status = 'sent';

create index if not exists sm_offline_upload_log_order_number_idx
  on public.sm_offline_upload_log (order_number);

alter table public.sm_offline_upload_log enable row level security;
revoke all on public.sm_offline_upload_log from anon, authenticated;
