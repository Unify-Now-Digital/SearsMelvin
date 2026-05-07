-- Update kerb-set sizes to current spec, displayed in feet AND centimetres.
--
-- Previous (from 2026-04-30-seed-product-sizes.sql):
--   Standard  6'6" × 4'0"
--   Large     7'0" × 4'0"
--
-- New:
--   Standard  6'6" × 2'6"  (198cm × 76cm)
--   Large     7'0" × 3'0"  (213cm × 91cm)

UPDATE public.product_sizes ps
SET dimensions = '6''6" × 2''6" (198cm × 76cm)'
FROM public.products p
JOIN public.product_categories pc ON pc.id = p.category_id
WHERE ps.product_id = p.id
  AND pc.slug = 'kerb-sets'
  AND ps.size_code = 'standard';

UPDATE public.product_sizes ps
SET dimensions = '7''0" × 3''0" (213cm × 91cm)'
FROM public.products p
JOIN public.product_categories pc ON pc.id = p.category_id
WHERE ps.product_id = p.id
  AND pc.slug = 'kerb-sets'
  AND ps.size_code = 'large';
