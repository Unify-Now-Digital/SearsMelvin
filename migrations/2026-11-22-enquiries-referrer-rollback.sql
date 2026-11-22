-- NOT APPLIED. Rollback for 2026-11-22-enquiries-referrer.sql.
-- WARNING: this deletes any referrer hosts already captured on enquiries. Only
-- run it if the column needs to be removed; there is no way back from here.

alter table public.enquiries
  drop column if exists referrer;
