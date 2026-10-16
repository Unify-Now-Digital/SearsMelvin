-- Exmoor & Dartmoor kerb sets: +10% base price.
--
-- STATUS: NOT APPLIED. Migrations here are run by hand (see CLAUDE.md); this
-- file is not proof the change is live. Apply it in the Supabase SQL editor
-- (project bfwohzcugtwbhhxdqgme) only after this PR is approved.
--
-- Website prices for these products are not hard-coded in the repo. Product
-- pages (/memorials/<slug>, incl. Product JSON-LD offers.price), the
-- /memorials listing cards and price filters, the on-page calculator in
-- memorial.html, and the server-side quote total (functions/api/_quote-pricing.js,
-- PR #151) all read products.base_price + product_sizes.price_adjustment.
-- Both sizes (Standard, Large) of both products have price_adjustment = 0.00,
-- so only base_price changes.
--
-- New price = old × 1.10, rounded to the nearest whole pound (ROUND(x, 0)).
-- Both results are already exact whole pounds, so no rounding was needed:
--   The Dartmoor  (the-dartmoor)  3600.00 × 1.10 = 3960.00 -> 3960.00
--   The Exmoor    (the-exmoor)    3800.00 × 1.10 = 4180.00 -> 4180.00
--
-- Scoped to the Sears Melvin org and to the exact current price, so re-running
-- it is a no-op and it can never compound. "The Dartmoor II" (another org,
-- inactive, unlisted) is deliberately excluded.

BEGIN;

UPDATE public.products
SET base_price = 3960.00
WHERE id = '52f472a9-50d1-4447-9540-e6b24cd4b943'
  AND slug = 'the-dartmoor'
  AND organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND base_price = 3600.00;

UPDATE public.products
SET base_price = 4180.00
WHERE id = 'f474bbad-cf5f-442f-a520-83d734ecdd1e'
  AND slug = 'the-exmoor'
  AND organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND base_price = 3800.00;

COMMIT;

-- Rollback:
-- UPDATE public.products SET base_price = 3600.00 WHERE id = '52f472a9-50d1-4447-9540-e6b24cd4b943' AND base_price = 3960.00;
-- UPDATE public.products SET base_price = 3800.00 WHERE id = 'f474bbad-cf5f-442f-a520-83d734ecdd1e' AND base_price = 4180.00;
