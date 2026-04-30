-- Seed default sizes for active products by category.
--
-- Background: every product page rendered "No sizes available" because
-- public.product_sizes is empty. Until per-product sizing is curated, fall
-- back to category-typical defaults so the size selector at least renders
-- usable options. Cremation, Children's and Churchyard remain empty
-- (these are typically bespoke and shouldn't have a fixed size list).
--
-- Idempotent: skips any product that already has a size row, so re-running
-- the migration is safe.

-- Lawn Headstones — 3'0" × 2'0" (default), 2'6" × 2'0"
INSERT INTO public.product_sizes (product_id, size_name, size_code, dimensions, price_adjustment, display_order, is_default)
SELECT p.id, 'Standard', 'standard', '3''0" × 2''0"', 0, 0, true
FROM public.products p
JOIN public.product_categories pc ON pc.id = p.category_id
WHERE pc.slug = 'lawn-headstones' AND p.is_active = true
  AND NOT EXISTS (SELECT 1 FROM public.product_sizes ps WHERE ps.product_id = p.id);

INSERT INTO public.product_sizes (product_id, size_name, size_code, dimensions, price_adjustment, display_order, is_default)
SELECT p.id, 'Compact', 'compact', '2''6" × 2''0"', 0, 1, false
FROM public.products p
JOIN public.product_categories pc ON pc.id = p.category_id
WHERE pc.slug = 'lawn-headstones' AND p.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.product_sizes ps
    WHERE ps.product_id = p.id AND ps.size_code = 'compact'
  );

-- Kerb Sets — 6'6" × 4'0" (default), 7'0" × 4'0"
INSERT INTO public.product_sizes (product_id, size_name, size_code, dimensions, price_adjustment, display_order, is_default)
SELECT p.id, 'Standard', 'standard', '6''6" × 4''0"', 0, 0, true
FROM public.products p
JOIN public.product_categories pc ON pc.id = p.category_id
WHERE pc.slug = 'kerb-sets' AND p.is_active = true
  AND NOT EXISTS (SELECT 1 FROM public.product_sizes ps WHERE ps.product_id = p.id);

INSERT INTO public.product_sizes (product_id, size_name, size_code, dimensions, price_adjustment, display_order, is_default)
SELECT p.id, 'Large', 'large', '7''0" × 4''0"', 0, 1, false
FROM public.products p
JOIN public.product_categories pc ON pc.id = p.category_id
WHERE pc.slug = 'kerb-sets' AND p.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.product_sizes ps
    WHERE ps.product_id = p.id AND ps.size_code = 'large'
  );

-- Heart Memorials — 3'0" (single default option)
INSERT INTO public.product_sizes (product_id, size_name, size_code, dimensions, price_adjustment, display_order, is_default)
SELECT p.id, 'Standard', 'standard', '3''0"', 0, 0, true
FROM public.products p
JOIN public.product_categories pc ON pc.id = p.category_id
WHERE pc.slug = 'heart-memorials' AND p.is_active = true
  AND NOT EXISTS (SELECT 1 FROM public.product_sizes ps WHERE ps.product_id = p.id);

-- Book Memorials — 3'0" (single default option)
INSERT INTO public.product_sizes (product_id, size_name, size_code, dimensions, price_adjustment, display_order, is_default)
SELECT p.id, 'Standard', 'standard', '3''0"', 0, 0, true
FROM public.products p
JOIN public.product_categories pc ON pc.id = p.category_id
WHERE pc.slug = 'book-memorials' AND p.is_active = true
  AND NOT EXISTS (SELECT 1 FROM public.product_sizes ps WHERE ps.product_id = p.id);

-- Cremation Memorials, Children's Memorials, Churchyard Memorials — left empty
-- on purpose; these are bespoke and the front-end already handles the
-- "No sizes available" state by hiding the selector.
