-- Atomic quote submission RPC.
--
-- The website quote form (functions/api/submit.js → /api/submit, channel=quote)
-- used to make ~4 sequential PostgREST round trips before responding: look up
-- the person, write the person, write the order, write the enquiry. This
-- function does the whole thing in ONE call inside a single transaction, so the
-- worker makes one network round trip and the save is all-or-nothing.
--
-- It mirrors the previous JS orchestration exactly:
--   • people     — deduped by email (lower-cased). Never sets is_customer; when
--                  the email already exists it refreshes name/phone but NOT
--                  organization_id (a contact registered under another tenant
--                  keeps theirs — same rule the JS upsert followed).
--   • orders     — order_type='quote'; product_config stored as a JSON *string*
--                  (text column, matching JSON.stringify on write / safeParse on
--                  read); edit_token supplied by the caller.
--   • enquiries  — channel='quote'; details stored as JSONB; linked via order_id.
--   • cemetery   — uses the supplied cemetery_id, else a best-effort name match
--                  (exact ilike → prefix → contains), else null.
--
-- Returns the new ids as jsonb (the caller already holds the edit_token).
--
-- NOTE for whoever applies this: it only touches columns the app already
-- reads/writes, and uses %TYPE anchors + ::text id comparisons so it works
-- whether the id columns are uuid or bigint. Verify with a real quote
-- submission after applying (see PR description).

create or replace function public.create_quote(payload jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_org         public.people.organization_id%type := (payload->>'organization_id')::uuid;
  v_email       text  := lower(trim(payload->>'email'));
  v_first       text  := nullif(payload->>'first_name', '');
  v_last        text  := nullif(payload->>'last_name', '');
  v_phone       text  := nullif(payload->>'phone', '');
  v_name        text  := nullif(payload->>'name', '');
  v_message     text  := nullif(payload->>'message', '');
  v_source_page text  := nullif(payload->>'source_page', '');
  v_location    text  := nullif(payload->>'location', '');
  v_cem_in      text  := nullif(payload->>'cemetery_id', '');
  v_edit_token  text  := payload->>'edit_token';
  v_product     jsonb := payload->'product';
  v_person_id   public.people.id%type;
  v_order_id    public.orders.id%type;
  v_enq_id      public.enquiries.id%type;
  v_cemetery_id public.cemeteries.id%type;
begin
  if v_email is null or v_email = '' then
    raise exception 'create_quote: email is required';
  end if;

  -- 1. Person upsert (dedupe by email). Done as select-then-insert/update with a
  --    unique-violation fallback so it does not depend on the name of the
  --    email unique index. organization_id is never changed for an existing row.
  select id into v_person_id from public.people where email = v_email limit 1;
  if v_person_id is null then
    begin
      insert into public.people (organization_id, email, first_name, last_name, phone)
      values (v_org, v_email, v_first, v_last, v_phone)
      returning id into v_person_id;
    exception when unique_violation then
      select id into v_person_id from public.people where email = v_email limit 1;
    end;
  else
    update public.people set
      first_name = coalesce(v_first, first_name),
      last_name  = coalesce(nullif(v_last, '-'), last_name),
      phone      = coalesce(v_phone, phone)
    where id = v_person_id;
  end if;

  -- 2. Resolve cemetery: prefer the supplied id, else best-effort name match.
  if v_cem_in is not null then
    select c.id into v_cemetery_id
    from public.cemeteries c
    where c.id::text = v_cem_in
    limit 1;
  elsif v_location is not null and char_length(v_location) >= 3 then
    select c.id into v_cemetery_id
    from public.cemeteries c
    where c.is_active = true
      and (c.name ilike v_location
           or c.name ilike v_location || '%'
           or c.name ilike '%' || v_location || '%')
    order by (c.name ilike v_location) desc,
             (c.name ilike v_location || '%') desc
    limit 1;
  end if;

  -- 3. Order — the durable quote record.
  insert into public.orders (
    organization_id, person_id, customer_name, person_name, order_type,
    sku, color, value, permit_fee, location, edit_token,
    product_config, notes, inscription_text
  ) values (
    v_org, v_person_id,
    coalesce(v_name, 'Website lead'), v_name, 'quote',
    nullif(v_product->>'name', ''),
    nullif(v_product->>'colour', ''),
    nullif(v_product->>'price', '')::numeric,
    nullif(v_product->>'permit_fee', '')::numeric,
    v_location,
    v_edit_token,
    v_product::text,
    v_message,
    nullif(v_product->>'inscription', '')
  )
  returning id into v_order_id;

  -- 4. Enquiry — CRM inbox record, linked to the order.
  insert into public.enquiries (
    organization_id, person_id, channel, source_page, message,
    location, cemetery_id, details, order_id
  ) values (
    v_org, v_person_id, 'quote', v_source_page, v_message,
    v_location, v_cemetery_id, v_product, v_order_id
  )
  returning id into v_enq_id;

  return jsonb_build_object(
    'person_id',  v_person_id,
    'order_id',   v_order_id,
    'enquiry_id', v_enq_id
  );
end;
$$;

-- Only the server-side service role may call this (the worker uses the service
-- key). Keep it away from anon/authenticated.
revoke all on function public.create_quote(jsonb) from public;
grant execute on function public.create_quote(jsonb) to service_role;

-- Make PostgREST pick up the new function immediately.
notify pgrst, 'reload schema';
