begin;

-- Product images remain publicly readable, but writes must travel through
-- trusted backend code. The old policies were assigned to PUBLIC despite their
-- names saying "Authenticated users", so anonymous visitors could mutate the
-- live catalogue image bucket.
drop policy if exists "Authenticated users can upload images" on storage.objects;
drop policy if exists "Authenticated users can update images" on storage.objects;
drop policy if exists "Authenticated users can delete images" on storage.objects;

commit;
