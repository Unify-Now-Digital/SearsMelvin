-- NOT APPLIED.
-- This file has not been run against the Mason App database.
-- There is no migration runner. A person applies it by hand.
--
-- Removes only the flower-vase clause from nine Sears Melvin product rows
-- (short_description, description, included_features).
-- Photos may still show a vase. Whether to change a photograph is separate.
-- Each update matches the current text, so a row that has already changed is left alone.

-- the-charnwood
-- short before: A full-cover kerb memorial with an ogee headstone and integrated flower-vase area.
-- short after:  A full-cover kerb memorial with an ogee headstone.
-- desc before:  The Charnwood combines an ogee-topped headstone with a solid full-cover ledger and raised kerb frame. A dedicated flower-vase area at the foot provides a defined position for floral tributes within the coordinated design.
-- desc after:   The Charnwood combines an ogee-topped headstone with a solid full-cover ledger and raised kerb frame.
-- features before: ["Ogee-topped headstone","Full-cover ledger","Raised kerb frame","Flower-vase area"]
-- features after:  ["Ogee-topped headstone","Full-cover ledger","Raised kerb frame"]
UPDATE public.products
SET short_description = 'A full-cover kerb memorial with an ogee headstone.',
    description = 'The Charnwood combines an ogee-topped headstone with a solid full-cover ledger and raised kerb frame.',
    included_features = '["Ogee-topped headstone","Full-cover ledger","Raised kerb frame"]'::jsonb
WHERE organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND slug = 'the-charnwood'
  AND short_description = 'A full-cover kerb memorial with an ogee headstone and integrated flower-vase area.';

-- the-inveresk
-- short before: A compact kerb memorial with a Celtic cross, rounded tablet and integrated flower vase.
-- short after:  A compact kerb memorial with a Celtic cross and rounded tablet.
-- desc before:  The Inveresk combines a rounded inscription tablet with an integrated Celtic cross at the head of a compact kerb surround. A flower-vase insert is positioned within the top rail for a practical floral tribute.
-- desc after:   The Inveresk combines a rounded inscription tablet with an integrated Celtic cross at the head of a compact kerb surround.
-- features before: ["Integrated Celtic cross","Rounded inscription tablet","Compact kerb surround","Flower-vase insert"]
-- features after:  ["Integrated Celtic cross","Rounded inscription tablet","Compact kerb surround"]
UPDATE public.products
SET short_description = 'A compact kerb memorial with a Celtic cross and rounded tablet.',
    description = 'The Inveresk combines a rounded inscription tablet with an integrated Celtic cross at the head of a compact kerb surround.',
    included_features = '["Integrated Celtic cross","Rounded inscription tablet","Compact kerb surround"]'::jsonb
WHERE organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND slug = 'the-inveresk'
  AND short_description = 'A compact kerb memorial with a Celtic cross, rounded tablet and integrated flower vase.';

-- the-dalemain
-- short before: Shown in polished black granite, with an open-book tablet, full kerb surround and flower vase.
-- short after:  Shown in polished black granite, with an open-book tablet and full kerb surround.
-- desc before:  The Dalemain combines a raised open-book tablet with a complete kerb surround, stepped head plinth and flower vase. The sloping pages provide a broad surface for a divided or continuous personalised inscription.
-- desc after:   The Dalemain combines a raised open-book tablet with a complete kerb surround and stepped head plinth. The sloping pages provide a broad surface for a divided or continuous personalised inscription.
-- features before: ["Open-book tablet","Full kerb surround","Raised foot cover","Flower vase"]
-- features after:  ["Open-book tablet","Full kerb surround","Raised foot cover"]
UPDATE public.products
SET short_description = 'Shown in polished black granite, with an open-book tablet and full kerb surround.',
    description = 'The Dalemain combines a raised open-book tablet with a complete kerb surround and stepped head plinth. The sloping pages provide a broad surface for a divided or continuous personalised inscription.',
    included_features = '["Open-book tablet","Full kerb surround","Raised foot cover"]'::jsonb
WHERE organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND slug = 'the-dalemain'
  AND short_description = 'Shown in polished black granite, with an open-book tablet, full kerb surround and flower vase.';

-- the-hartwell
-- short before: A polished kerb memorial with a round-top headstone, sloping plinth and twin flower vases.
-- short after:  A polished kerb memorial with a round-top headstone and sloping plinth.
-- desc before:  The Hartwell combines a round-topped inscription tablet with a gently sloping head plinth and full rectangular kerb frame. Two flower vases positioned at the foot create a balanced arrangement for floral tributes.
-- desc after:   The Hartwell combines a round-topped inscription tablet with a gently sloping head plinth and full rectangular kerb frame.
-- features before: ["Round-top headstone","Sloping head plinth","Full kerb frame","Twin flower vases"]
-- features after:  ["Round-top headstone","Sloping head plinth","Full kerb frame"]
UPDATE public.products
SET short_description = 'A polished kerb memorial with a round-top headstone and sloping plinth.',
    description = 'The Hartwell combines a round-topped inscription tablet with a gently sloping head plinth and full rectangular kerb frame.',
    included_features = '["Round-top headstone","Sloping head plinth","Full kerb frame"]'::jsonb
WHERE organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND slug = 'the-hartwell'
  AND short_description = 'A polished kerb memorial with a round-top headstone, sloping plinth and twin flower vases.';

-- the-holkham
-- short before: A full-cover kerb memorial with a Romanesque arch, symbolic railings and turned vase.
-- short after:  A full-cover kerb memorial with a Romanesque arch and symbolic railings.
-- desc before:  The Holkham combines a tall Romanesque archway with open railing details arranged beneath it. A solid full-cover ledger, raised kerb frame and turned flower vase complete the coordinated religious composition.
-- desc after:   The Holkham combines a tall Romanesque archway with open railing details arranged beneath it. A solid full-cover ledger and raised kerb frame complete the coordinated religious composition.
-- features before: ["Romanesque archway","Open railing details","Full-cover ledger","Turned flower vase"]
-- features after:  ["Romanesque archway","Open railing details","Full-cover ledger"]
UPDATE public.products
SET short_description = 'A full-cover kerb memorial with a Romanesque arch and symbolic railings.',
    description = 'The Holkham combines a tall Romanesque archway with open railing details arranged beneath it. A solid full-cover ledger and raised kerb frame complete the coordinated religious composition.',
    included_features = '["Romanesque archway","Open railing details","Full-cover ledger"]'::jsonb
WHERE organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND slug = 'the-holkham'
  AND short_description = 'A full-cover kerb memorial with a Romanesque arch, symbolic railings and turned vase.';

-- the-ickworth
-- short before: A double kerb memorial with arched twin tablets, doves, balustrades and vase finials.
-- short after:  A double kerb memorial with arched twin tablets, doves and balustrades.
-- desc before:  The Ickworth combines two arched inscription tablets with dove details and an elaborate balustraded kerb surround. Turned vase finials mark the foot corners, creating a symmetrical companion memorial across the full grave width.
-- desc after:   The Ickworth combines two arched inscription tablets with dove details and an elaborate balustraded kerb surround.
-- features before: ["Twin arched tablets","Dove details","Balustraded kerbs","Turned vase finials"]
-- features after:  ["Twin arched tablets","Dove details","Balustraded kerbs"]
UPDATE public.products
SET short_description = 'A double kerb memorial with arched twin tablets, doves and balustrades.',
    description = 'The Ickworth combines two arched inscription tablets with dove details and an elaborate balustraded kerb surround.',
    included_features = '["Twin arched tablets","Dove details","Balustraded kerbs"]'::jsonb
WHERE organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND slug = 'the-ickworth'
  AND short_description = 'A double kerb memorial with arched twin tablets, doves, balustrades and vase finials.';

-- the-pevensey
-- short before: A polished double kerb memorial with a twin-panel headstone and central flower-vase block.
-- short after:  A polished double kerb memorial with a twin-panel headstone.
-- desc before:  The Pevensey places two adjoining ogee-topped inscription panels at the head of a double-width kerb frame. A raised central section and integrated vase block connect the panels and provide a balanced position for floral tributes.
-- desc after:   The Pevensey places two adjoining ogee-topped inscription panels at the head of a double-width kerb frame. A raised central section connects the panels.
-- features before: ["Twin inscription panels","Double-width kerb frame","Central vase block","Shared memorial base"]
-- features after:  ["Twin inscription panels","Double-width kerb frame","Shared memorial base"]
UPDATE public.products
SET short_description = 'A polished double kerb memorial with a twin-panel headstone.',
    description = 'The Pevensey places two adjoining ogee-topped inscription panels at the head of a double-width kerb frame. A raised central section connects the panels.',
    included_features = '["Twin inscription panels","Double-width kerb frame","Shared memorial base"]'::jsonb
WHERE organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND slug = 'the-pevensey'
  AND short_description = 'A polished double kerb memorial with a twin-panel headstone and central flower-vase block.';

-- the-zennor
-- short before: Shown in multicolour red granite, with an ogee headstone, dark corner blocks and foot vases.
-- short after:  Shown in multicolour red granite, with an ogee headstone and dark corner blocks.
-- desc before:  The Zennor combines an ogee-topped headstone and full kerb surround in multicolour red granite. Contrasting dark bands finish the raised foot corners, where integrated flower-vase positions support balanced floral tributes.
-- desc after:   The Zennor combines an ogee-topped headstone and full kerb surround in multicolour red granite. Contrasting dark bands finish the raised foot corners.
-- features before: ["Ogee-topped headstone","Full kerb surround","Contrasting corner blocks","Integrated foot vases"]
-- features after:  ["Ogee-topped headstone","Full kerb surround","Contrasting corner blocks"]
UPDATE public.products
SET short_description = 'Shown in multicolour red granite, with an ogee headstone and dark corner blocks.',
    description = 'The Zennor combines an ogee-topped headstone and full kerb surround in multicolour red granite. Contrasting dark bands finish the raised foot corners.',
    included_features = '["Ogee-topped headstone","Full kerb surround","Contrasting corner blocks"]'::jsonb
WHERE organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND slug = 'the-zennor'
  AND short_description = 'Shown in multicolour red granite, with an ogee headstone, dark corner blocks and foot vases.';

-- the-lyveden
-- short before: Shown in Bahama Blue granite, with a tulip-shaped tablet and flower vases on the base.
-- short after:  Shown in Bahama Blue granite, with a tulip-shaped tablet.
-- desc before:  The Lyveden forms the upright inscription tablet as a stylised tulip with curved petal-like shoulders. Shown in Bahama Blue granite, flower-vase positions on the base create a balanced setting for floral tributes.
-- desc after:   The Lyveden forms the upright inscription tablet as a stylised tulip with curved petal-like shoulders. Shown in Bahama Blue granite.
-- features before: ["Tulip-shaped tablet","Petal-like shoulders","Base flower vases","Bahama Blue granite shown"]
-- features after:  ["Tulip-shaped tablet","Petal-like shoulders","Bahama Blue granite shown"]
UPDATE public.products
SET short_description = 'Shown in Bahama Blue granite, with a tulip-shaped tablet.',
    description = 'The Lyveden forms the upright inscription tablet as a stylised tulip with curved petal-like shoulders. Shown in Bahama Blue granite.',
    included_features = '["Tulip-shaped tablet","Petal-like shoulders","Bahama Blue granite shown"]'::jsonb
WHERE organization_id = '3770972d-1bbd-417b-b413-297e844db285'
  AND slug = 'the-lyveden'
  AND short_description = 'Shown in Bahama Blue granite, with a tulip-shaped tablet and flower vases on the base.';
