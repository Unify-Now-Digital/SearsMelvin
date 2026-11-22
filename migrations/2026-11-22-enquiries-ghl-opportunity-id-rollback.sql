-- NOT APPLIED. Rollback for 2026-11-22-enquiries-ghl-opportunity-id.sql.
-- Drops ONLY the optional partial index. No data is lost.
-- NEVER drop public.enquiries.ghl_opportunity_id or ghl_synced_at: those columns
-- pre-date this PR and hold live data from other Mason sync paths.

drop index if exists public.enquiries_ghl_opportunity_id_idx;
