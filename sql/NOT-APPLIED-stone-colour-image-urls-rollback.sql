-- =============================================================================
-- NOT APPLIED. Rollback for sql/NOT-APPLIED-stone-colour-image-urls.sql.
--
-- Prepared 2026-11-07. This file has not been executed. It is not a migration.
--
-- A read-only check on 2026-11-07 found image_url NULL on all 19 rows this
-- update would change. previous_image_url below is that current value, so
-- the rollback restores NULL. It only touches a row that still holds the
-- exact URL the update wrote. A later, different image_url is left alone.
-- If the restored values do not match, it raises and rolls back.
-- =============================================================================

BEGIN;

UPDATE public.stone_colours AS c
SET image_url = v.previous_image_url
FROM (VALUES
  ('d00e0d6c-ec8a-4008-b392-a176b02e9d1c'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black.webp',             NULL::text),
  ('1ea47443-9e4a-460b-84fe-6676338842ca'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/balmoral-red.webp',      NULL::text),
  ('98cafdfe-09a9-40c2-a2fc-a030cebcc646'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/blue-pearl.webp',        NULL::text),
  ('c513bbe2-d6b5-4f00-bdd8-9726610f2748'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/tropical-green.webp',    NULL::text),
  ('f16d547d-9315-44b0-998b-6e29c9cfaf41'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/paradiso.webp',          NULL::text),
  ('0b55588e-9bab-4980-96a5-01021f8f296e'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/ruby-red.webp',          NULL::text),
  ('5cf29e51-4364-4198-92ec-761cb1d9eb95'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/sa-dark-grey.webp',      NULL::text),
  ('dba07948-49f8-4cdd-8563-e5b7c2110c8c'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/karin-grey.webp',        NULL::text),
  ('1a54c259-accf-4495-b0d9-96f2fe6332f0'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black-galaxy.webp',      NULL::text),
  ('01ad78e3-9701-4017-a5b6-877576c86fae'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/yorkstone.webp',         NULL::text),
  ('b225f959-018e-45a7-91b8-50be78e240e8'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/bahama-blue.webp',       NULL::text),
  ('ec529bc2-ec0a-4520-89ee-52a6761a881d'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/cats-eye-brown.webp',    NULL::text),
  ('20343815-4daa-449e-bda7-dd05a3a22af0'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/imperial-red.webp',      NULL::text),
  ('72b21479-11a4-4c1b-abf7-b2005f7fc3bc'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/cera-grey.webp',         NULL::text),
  ('0367edc2-9c20-4dc2-b9bf-551508c18ba0'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/indian-light-grey.webp', NULL::text),
  ('697212de-9d03-430e-ac37-2312094fb40c'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/indian-dark-grey.webp',  NULL::text),
  ('15bbb6c9-f58b-48a5-8529-35784ac33d6d'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/china-pink.webp',        NULL::text),
  ('f313d0ae-5183-4291-ae9d-08df8a1f6fd8'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/crystal-white.webp',     NULL::text),
  ('d5d8cd20-bbfd-4c47-b0f9-ccbf0b6816e0'::uuid, 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/avon-grey.webp',         NULL::text)
) AS v(id, written_image_url, previous_image_url)
WHERE c.id = v.id
  AND c.image_url = v.written_image_url;

DO $$
DECLARE
  restored int;
BEGIN
  -- previous_image_url is NULL for every row in the read above.
  SELECT count(*) INTO restored
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
  AND image_url IS NULL;

  IF restored <> 19 THEN
    RAISE EXCEPTION 'Expected those 19 image_url values restored to NULL, found %. Rolled back.', restored;
  END IF;
END $$;

COMMIT;
