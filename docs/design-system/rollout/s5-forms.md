# S5 forms

Stage S5 sets the field chrome. Submit buttons stay on the S3 rules.
The header search field, hidden inputs, and radios keep their own behaviour.
`/memorials` still has no form.

## Fields

The ground is white. The border is 1px bronze. The corner is 2px.
The control is 48px tall. The text is `--sm-text-md` (17px, 18px from 769px), so a phone does not zoom.
The label sits above the field, in DM Sans 500, in sentence case.
Placeholder text is ink muted.
Focus keeps the S2 ring and turns the border ink.

## States

An invalid field uses a 2px error border. The error text uses `--sm-color-error`.
A success panel uses a 2px success border.
A filter checkbox mark is a 22px square inside a row at least 44px tall. Radios stay round.

## What did not change

Field `id` and `name` values, submit handlers, and the click-id store (`gclid`, `gbraid`, `wbraid` in `sm_attr`) are unchanged.
Posts still go to `/api/submit`, `/api/customer-order`, and `/api/brochure`.
