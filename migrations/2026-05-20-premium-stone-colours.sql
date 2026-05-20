-- Premium stone colours + extend the standard (free) colour set.
--
-- Standard (no surcharge):  Black Galaxy, Black, Rustenberg Grey, Grey
-- Premium (surcharge by product type, applied in the configurator):
--   Vizag Blue, Indian Aurora, Emerald Pearl, Ruby Red, Bahama Blue, Tropical Green
--
-- Premium surcharge is charged per product category in memorial.html:
--   Kerb Sets            +£350
--   Cremation Memorials  +£90
--   everything else      +£125

-- 1. Flag column (defaults to standard).
ALTER TABLE public.stone_colours
  ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false;

-- 2. Mark the six showcase colours premium; keep the originals standard.
UPDATE public.stone_colours SET is_premium = true
WHERE slug IN ('vizag-blue', 'indian-aurora', 'emerald-pearl', 'ruby-red', 'bahama-blue', 'tropical-green');

UPDATE public.stone_colours SET is_premium = false
WHERE slug IN ('black-galaxy', 'rustenberg-grey');

-- 3. Add two more standard colours: a deep solid Black and a mid Grey.
--    Inserted at temporary high display_order values; step 4 sets the final order.
--    created_at is set explicitly so the insert doesn't depend on a column default.
INSERT INTO public.stone_colours (id, name, slug, hex_primary, hex_secondary, display_order, is_active, is_premium, created_at)
SELECT gen_random_uuid(), 'Black', 'black', '#0d0d0d', '#1c1c1c', 101, true, false, now()
WHERE NOT EXISTS (SELECT 1 FROM public.stone_colours WHERE slug = 'black');

INSERT INTO public.stone_colours (id, name, slug, hex_primary, hex_secondary, display_order, is_active, is_premium, created_at)
SELECT gen_random_uuid(), 'Grey', 'grey', '#8a8a8a', '#9a9a9a', 102, true, false, now()
WHERE NOT EXISTS (SELECT 1 FROM public.stone_colours WHERE slug = 'grey');

-- 4. Order standard colours first, premium after. Applied top-down so no two
--    rows ever share a display_order mid-migration (safe under a unique index).
UPDATE public.stone_colours SET display_order = 10 WHERE slug = 'tropical-green';
UPDATE public.stone_colours SET display_order = 9  WHERE slug = 'bahama-blue';
UPDATE public.stone_colours SET display_order = 8  WHERE slug = 'ruby-red';
UPDATE public.stone_colours SET display_order = 7  WHERE slug = 'emerald-pearl';
UPDATE public.stone_colours SET display_order = 6  WHERE slug = 'indian-aurora';
UPDATE public.stone_colours SET display_order = 5  WHERE slug = 'vizag-blue';
UPDATE public.stone_colours SET display_order = 4  WHERE slug = 'grey';
UPDATE public.stone_colours SET display_order = 3  WHERE slug = 'rustenberg-grey';
UPDATE public.stone_colours SET display_order = 2  WHERE slug = 'black';
UPDATE public.stone_colours SET display_order = 1  WHERE slug = 'black-galaxy';
