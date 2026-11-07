-- =============================================================================
-- NOT APPLIED. Rollback for sql/NOT-APPLIED-stone-colour-image-urls.sql.
--
-- Prepared 2026-11-07. This file has not been executed. It is not a migration.
-- Run it only to undo that update: it sets image_url back to NULL where the
-- id still holds the exact URL that update wrote. A later, different image_url
-- on the same id is left alone. If fewer than 10 rows match, it raises and
-- rolls back.
-- =============================================================================

BEGIN;

UPDATE public.stone_colours AS c
SET image_url = NULL
FROM (VALUES
  ('d00e0d6c-ec8a-4008-b392-a176b02e9d1c'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black.webp'),
  ('1ea47443-9e4a-460b-84fe-6676338842ca'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/balmoral-red.webp'),
  ('98cafdfe-09a9-40c2-a2fc-a030cebcc646'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/blue-pearl.webp'),
  ('c513bbe2-d6b5-4f00-bdd8-9726610f2748'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/tropical-green.webp'),
  ('f16d547d-9315-44b0-998b-6e29c9cfaf41'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/paradiso.webp'),
  ('0b55588e-9bab-4980-96a5-01021f8f296e'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/ruby-red.webp'),
  ('5cf29e51-4364-4198-92ec-761cb1d9eb95'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/sa-dark-grey.webp'),
  ('dba07948-49f8-4cdd-8563-e5b7c2110c8c'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/karin-grey.webp'),
  ('1a54c259-accf-4495-b0d9-96f2fe6332f0'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black-galaxy.webp'),
  ('01ad78e3-9701-4017-a5b6-877576c86fae'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/yorkstone.webp')
) AS v(id, image_url)
WHERE c.id = v.id
  AND c.image_url = v.image_url;

DO $$
DECLARE
  still_set int;
BEGIN
  SELECT count(*) INTO still_set
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

  IF still_set <> 0 THEN
    RAISE EXCEPTION 'Expected those 10 image_url values to be NULL, % still set. Rolled back.', still_set;
  END IF;
END $$;

COMMIT;
