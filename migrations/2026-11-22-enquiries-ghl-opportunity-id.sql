-- NOT APPLIED. Optional, idempotent index only. Review before applying to the
-- Mason App project.
--
-- public.enquiries.ghl_opportunity_id (text) and ghl_synced_at (timestamptz)
-- ALREADY EXIST in Mason App and already hold data written by other Mason sync
-- paths. This file must never add, alter or drop those columns. The website
-- write-back (functions/api/submit.js saveEnquiryGhlOpportunityId) needs no
-- migration: deploying the JS starts writing straight away.
--
-- The partial index only speeds up lookups from a GHL opportunity id back to
-- its enquiry (e.g. matching GHL pipeline/webhook events). Skipping it is safe.

create index if not exists enquiries_ghl_opportunity_id_idx
  on public.enquiries (ghl_opportunity_id)
  where ghl_opportunity_id is not null;
