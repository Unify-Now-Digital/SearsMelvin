-- =============================================================================
-- NOT APPLIED. Do not run this until Arin approves.
--
-- Prepared 2026-11-07. This file has not been executed. It is not a migration
-- and nothing in this repository applies it. Production stone_colours.image_url
-- must stay NULL until this script is deliberately run by a person.
--
-- A read-only check on 2026-11-07 (project bfwohzcugtwbhhxdqgme) found 23
-- active stone_colours rows, every image_url NULL. These 10 ids, names and
-- slugs matched that read. The WebP files are already in the public bucket.
--
-- The UPDATE matches id + name + slug together. If any of the 10 rows does
-- not match, the script raises and the transaction rolls back.
-- Rollback: sql/NOT-APPLIED-stone-colour-image-urls-rollback.sql
-- =============================================================================

BEGIN;

UPDATE public.stone_colours AS c
SET image_url = v.image_url
FROM (VALUES
  ('d00e0d6c-ec8a-4008-b392-a176b02e9d1c'::uuid, 'Black',          'black',          'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black.webp'),
  ('1ea47443-9e4a-460b-84fe-6676338842ca'::uuid, 'Balmoral Red',   'balmoral-red',   'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/balmoral-red.webp'),
  ('98cafdfe-09a9-40c2-a2fc-a030cebcc646'::uuid, 'Blue Pearl',     'blue-pearl',     'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/blue-pearl.webp'),
  ('c513bbe2-d6b5-4f00-bdd8-9726610f2748'::uuid, 'Tropical Green', 'tropical-green', 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/tropical-green.webp'),
  ('f16d547d-9315-44b0-998b-6e29c9cfaf41'::uuid, 'Paradiso',       'paradiso',       'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/paradiso.webp'),
  ('0b55588e-9bab-4980-96a5-01021f8f296e'::uuid, 'Ruby-Red',       'ruby-red',       'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/ruby-red.webp'),
  ('5cf29e51-4364-4198-92ec-761cb1d9eb95'::uuid, 'S-A Dark Grey',  'sa-dark-grey',   'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/sa-dark-grey.webp'),
  ('dba07948-49f8-4cdd-8563-e5b7c2110c8c'::uuid, 'Karin Grey',     'karin-grey',     'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/karin-grey.webp'),
  ('1a54c259-accf-4495-b0d9-96f2fe6332f0'::uuid, 'Black Galaxy',   'black-galaxy',   'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black-galaxy.webp'),
  ('01ad78e3-9701-4017-a5b6-877576c86fae'::uuid, 'Yorkstone',      'yorkstone',      'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/yorkstone.webp')
) AS v(id, name, slug, image_url)
WHERE c.id = v.id
  AND c.name = v.name
  AND c.slug = v.slug
  AND c.image_url IS NULL;

DO $$
DECLARE
  updated int;
BEGIN
  SELECT count(*) INTO updated
  FROM public.stone_colours
  WHERE id IN (
    'd00e0d6c-ec8a-4008-b392-a176b02e9d1c'::uuid,
    '1ea47443-9e4a-460b-84fe-6676338842ca'::uuid,
    '98cafdfe-09a9-40c2-a2fc-a030cebcc646'::uuid,
    'c513bbe2-d6b5-4f00-bdd8-9726610f2748'::uuid,
    'f16d547d-9315-44b0-998b-6e29c9cfaf41'::uuid,
    '0b55588e-9bab-4980-96a5-01021f8f296e'::uuid,
    '5cf29e51-4364-4198-92ec-761cb1d9eb95'::uuid,
    'dba07948-49f8-4cdd-8563-e5b7c2110c8c'::uuid,
    '1a54c259-accf-4495-b0d9-96f2fe6332f0'::uuid,
    '01ad78e3-9701-4017-a5b6-877576c86fae'::uuid
  )
  AND image_url IS NOT NULL;

  IF updated <> 10 THEN
    RAISE EXCEPTION 'Expected 10 stone_colours rows with image_url, found %. Rolled back.', updated;
  END IF;
END $$;

COMMIT;
