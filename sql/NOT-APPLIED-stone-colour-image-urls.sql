-- =============================================================================
-- NOT APPLIED. Do not run this until Arin approves.
--
-- Prepared 2026-11-07. This file has not been executed. It is not a migration
-- and nothing in this repository applies it. Production stone_colours.image_url
-- must stay NULL until this script is deliberately run by a person.
--
-- A read-only check on 2026-11-07 (project bfwohzcugtwbhhxdqgme) found these
-- 19 rows with image_url NULL. Names and slugs matched that read. The WebP
-- files are already in the public bucket. Colour names are unchanged.
--
-- The UPDATE matches id + name + slug, and only where image_url is still NULL
-- (the value read on that date). If any of the 19 rows does not match, the
-- script raises and the transaction rolls back.
-- Rollback: sql/NOT-APPLIED-stone-colour-image-urls-rollback.sql
-- =============================================================================

BEGIN;

UPDATE public.stone_colours AS c
SET image_url = v.image_url
FROM (VALUES
  ('d00e0d6c-ec8a-4008-b392-a176b02e9d1c'::uuid, 'Black',             'black',             'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black.webp'),
  ('1ea47443-9e4a-460b-84fe-6676338842ca'::uuid, 'Balmoral Red',      'balmoral-red',      'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/balmoral-red.webp'),
  ('98cafdfe-09a9-40c2-a2fc-a030cebcc646'::uuid, 'Blue Pearl',        'blue-pearl',        'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/blue-pearl.webp'),
  ('c513bbe2-d6b5-4f00-bdd8-9726610f2748'::uuid, 'Tropical Green',    'tropical-green',    'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/tropical-green.webp'),
  ('f16d547d-9315-44b0-998b-6e29c9cfaf41'::uuid, 'Paradiso',          'paradiso',          'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/paradiso.webp'),
  ('0b55588e-9bab-4980-96a5-01021f8f296e'::uuid, 'Ruby-Red',          'ruby-red',          'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/ruby-red.webp'),
  ('5cf29e51-4364-4198-92ec-761cb1d9eb95'::uuid, 'S-A Dark Grey',     'sa-dark-grey',      'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/sa-dark-grey.webp'),
  ('dba07948-49f8-4cdd-8563-e5b7c2110c8c'::uuid, 'Karin Grey',        'karin-grey',        'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/karin-grey.webp'),
  ('1a54c259-accf-4495-b0d9-96f2fe6332f0'::uuid, 'Black Galaxy',      'black-galaxy',      'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black-galaxy.webp'),
  ('01ad78e3-9701-4017-a5b6-877576c86fae'::uuid, 'Yorkstone',         'yorkstone',         'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/yorkstone.webp'),
  ('b225f959-018e-45a7-91b8-50be78e240e8'::uuid, 'Bahama Blue',       'bahama-blue',       'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/bahama-blue.webp'),
  ('ec529bc2-ec0a-4520-89ee-52a6761a881d'::uuid, 'Cats Eye Brown',    'cats-eye-brown',    'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/cats-eye-brown.webp'),
  ('20343815-4daa-449e-bda7-dd05a3a22af0'::uuid, 'Imperial Red',      'imperial-red',      'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/imperial-red.webp'),
  ('72b21479-11a4-4c1b-abf7-b2005f7fc3bc'::uuid, 'Cera Grey',         'cera-grey',         'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/cera-grey.webp'),
  ('0367edc2-9c20-4dc2-b9bf-551508c18ba0'::uuid, 'Indian Light Grey', 'indian-light-grey', 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/indian-light-grey.webp'),
  ('697212de-9d03-430e-ac37-2312094fb40c'::uuid, 'Indian Dark Grey',  'indian-dark-grey',  'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/indian-dark-grey.webp'),
  ('15bbb6c9-f58b-48a5-8529-35784ac33d6d'::uuid, 'China Pink',        'china-pink',        'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/china-pink.webp'),
  ('f313d0ae-5183-4291-ae9d-08df8a1f6fd8'::uuid, 'Crystal White',     'crystal-white',     'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/crystal-white.webp'),
  ('d5d8cd20-bbfd-4c47-b0f9-ccbf0b6816e0'::uuid, 'Avon Grey',         'avon-grey',         'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/avon-grey.webp')
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
    '01ad78e3-9701-4017-a5b6-877576c86fae'::uuid,
    'b225f959-018e-45a7-91b8-50be78e240e8'::uuid,
    'ec529bc2-ec0a-4520-89ee-52a6761a881d'::uuid,
    '20343815-4daa-449e-bda7-dd05a3a22af0'::uuid,
    '72b21479-11a4-4c1b-abf7-b2005f7fc3bc'::uuid,
    '0367edc2-9c20-4dc2-b9bf-551508c18ba0'::uuid,
    '697212de-9d03-430e-ac37-2312094fb40c'::uuid,
    '15bbb6c9-f58b-48a5-8529-35784ac33d6d'::uuid,
    'f313d0ae-5183-4291-ae9d-08df8a1f6fd8'::uuid,
    'd5d8cd20-bbfd-4c47-b0f9-ccbf0b6816e0'::uuid
  )
  AND image_url IS NOT NULL;

  IF updated <> 19 THEN
    RAISE EXCEPTION 'Expected 19 stone_colours rows with image_url, found %. Rolled back.', updated;
  END IF;
END $$;

COMMIT;
