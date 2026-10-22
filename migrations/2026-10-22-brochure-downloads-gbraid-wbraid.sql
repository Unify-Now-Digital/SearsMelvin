-- NOT YET APPLIED. Adds the remaining privacy-safe Google click IDs.
-- Idempotent; RLS and public-role revokes remain enforced as in 2026-10-21.

alter table public.brochure_downloads
  add column if not exists gbraid text,
  add column if not exists wbraid text;

alter table public.brochure_downloads enable row level security;
revoke all on public.brochure_downloads from anon, authenticated;
