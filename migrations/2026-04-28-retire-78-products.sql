-- ============================================================
-- Retire 78 legacy products by prefixing slugs with `_retired_`
-- ============================================================
--
-- Why: the legacy `websitev4` detail page does NOT filter by
-- `is_active = true`, so retired products remain reachable via
-- their original slug URLs. Renaming the slug breaks the lookup
-- (the public detail query is `slug = eq.<slug>`), so old URLs
-- return "Product not found" cleanly without requiring a
-- code/deploy change on websitev4.
--
-- This repo (SearsMelvin) already filters by is_active=true on
-- every product query, so the rename is purely defensive here.
--
-- Run in: Supabase Dashboard → SQL Editor.
-- Reversible: see "ROLLBACK" block at the bottom.
-- Idempotent: re-running is a no-op (excludes already-prefixed slugs).
-- ============================================================

BEGIN;

-- 1. Sanity check: how many products will be touched?
--    Expected: 78. Adjust the WHERE clause below if the
--    "retired" criterion is something other than is_active = false.
SELECT COUNT(*) AS will_be_renamed
FROM products
WHERE is_active = false
  AND slug NOT LIKE '\_retired\_%' ESCAPE '\';

-- 2. Preview the rows (uncomment if you want to inspect first):
-- SELECT id, name, slug, is_active
-- FROM products
-- WHERE is_active = false
--   AND slug NOT LIKE '\_retired\_%' ESCAPE '\'
-- ORDER BY name;

-- 3. Apply the rename. Defensive: also forces is_active = false
--    in case any retired product slipped through with is_active = true.
UPDATE products
SET slug      = '_retired_' || slug,
    is_active = false
WHERE is_active = false
  AND slug NOT LIKE '\_retired\_%' ESCAPE '\';

-- 4. Verify the new state.
SELECT COUNT(*) AS retired_count
FROM products
WHERE slug LIKE '\_retired\_%' ESCAPE '\';

COMMIT;

-- ============================================================
-- ROLLBACK (run only if you need to undo the rename)
-- ============================================================
-- BEGIN;
-- UPDATE products
-- SET slug = SUBSTRING(slug FROM LENGTH('_retired_') + 1)
-- WHERE slug LIKE '\_retired\_%' ESCAPE '\';
-- COMMIT;
