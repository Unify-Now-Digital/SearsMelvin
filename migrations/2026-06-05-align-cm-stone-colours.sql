-- Align stone colour options with Churchill Memorials (CM).
--
-- Replaces the previous 10-colour, 2-tier set with CM's full 23-colour palette
-- across THREE tiers, shared by every memorial type:
--
--   Standard (5)              — no surcharge
--   Premium (14)              — premium surcharge (per product type, set in memorial.html)
--   Premium Natural Stone (4) — same surcharge as Premium ("mirror")
--
-- The surcharge amount itself stays in the configurator (premiumColourSurcharge()
-- in memorial.html: Kerb Sets +£350, Cremation +£90, everything else +£125), and
-- applies to any colour with is_premium = true — i.e. both premium tiers.
--
-- Swatches render as CSS gradients from hex_primary -> hex_secondary, matching the
-- existing site style. hex values are close approximations of each granite/stone.

-- 1. Tier column. 'standard' | 'premium' | 'natural-stone'.
--    is_premium is kept in sync (true for both premium tiers) so the existing
--    price logic (c.is_premium ? surcharge : 0) keeps working unchanged.
ALTER TABLE public.stone_colours
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'standard';

-- 2. Clear the old palette. No table references stone_colours (colours are stored
--    as free text on the order config), and slug is the only unique key, so a
--    full replace is safe and avoids slug/display_order collisions.
DELETE FROM public.stone_colours;

-- 3. Insert CM's palette.
INSERT INTO public.stone_colours
  (id, name, slug, hex_primary, hex_secondary, display_order, is_active, is_premium, tier, created_at)
VALUES
  -- Standard (no surcharge)
  (gen_random_uuid(), 'Black',             'black',             '#0d0d0d', '#1c1c1c',  1, true, false, 'standard',     now()),
  (gen_random_uuid(), 'Indian Dark Grey',  'indian-dark-grey',  '#3b3b3d', '#4a4a4c',  2, true, false, 'standard',     now()),
  (gen_random_uuid(), 'Indian Light Grey', 'indian-light-grey', '#9a9a9c', '#adadb0',  3, true, false, 'standard',     now()),
  (gen_random_uuid(), 'Cera Grey',         'cera-grey',         '#7c7976', '#8d8a86',  4, true, false, 'standard',     now()),
  (gen_random_uuid(), 'Avon Grey',         'avon-grey',         '#6b7176', '#7c8288',  5, true, false, 'standard',     now()),
  -- Premium
  (gen_random_uuid(), 'Bahama Blue',       'bahama-blue',       '#2a4a5a', '#3a5a6a',  6, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Balmoral Red',      'balmoral-red',      '#7a2e2a', '#8c3a34',  7, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Blue Pearl',        'blue-pearl',        '#2c3540', '#3a4756',  8, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Cats Eye Brown',    'cats-eye-brown',    '#5a4636', '#6c5644',  9, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Tropical Green',    'tropical-green',    '#2a4a3a', '#3a5a4a', 10, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Imperial Red',      'imperial-red',      '#8a2620', '#9e322a', 11, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Paradiso',          'paradiso',          '#5a4a55', '#6c5a68', 12, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Ruby-Red',          'ruby-red',          '#5a2028', '#6c2830', 13, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Samoka',            'samoka',            '#2a2a2c', '#3a3a3e', 14, true, true,  'premium',      now()),
  (gen_random_uuid(), 'China Pink',        'china-pink',        '#a86b6b', '#ba7d7d', 15, true, true,  'premium',      now()),
  (gen_random_uuid(), 'S-A Dark Grey',     'sa-dark-grey',      '#383634', '#484644', 16, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Karin Grey',        'karin-grey',        '#7a7d80', '#8c8f92', 17, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Black Galaxy',      'black-galaxy',      '#1a1a1a', '#252525', 18, true, true,  'premium',      now()),
  (gen_random_uuid(), 'Crystal White',     'crystal-white',     '#d8d8d4', '#e8e8e4', 19, true, true,  'premium',      now()),
  -- Premium Natural Stone (surcharge mirrors Premium)
  (gen_random_uuid(), 'Marble',            'marble',            '#e4e2dd', '#f0eeea', 20, true, true,  'natural-stone', now()),
  (gen_random_uuid(), 'Nabresina',         'nabresina',         '#d8cdb8', '#e6dcc8', 21, true, true,  'natural-stone', now()),
  (gen_random_uuid(), 'Portland',          'portland',          '#ddd6c4', '#e9e3d4', 22, true, true,  'natural-stone', now()),
  (gen_random_uuid(), 'Yorkstone',         'yorkstone',         '#b09a78', '#c2ac8a', 23, true, true,  'natural-stone', now());

-- ============================================================================
-- Verification (does NOT run as part of the migration — copy/paste to check).
--   -- expect 23 rows: 5 standard, 14 premium, 4 natural-stone
--   SELECT tier, count(*) FROM public.stone_colours GROUP BY tier ORDER BY tier;
--   SELECT display_order AS ord, name, slug, tier, is_premium
--   FROM public.stone_colours ORDER BY display_order;
-- ============================================================================
