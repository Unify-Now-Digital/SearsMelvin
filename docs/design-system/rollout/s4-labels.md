# S4 labels, prices, and stars

Stage S4 sets the small labels, the prices, and the review stars.
Form fields, card frames, the header, and the footer keep their layout.
The rules are at the end of `site-upgrades.css`. Public pages still do not load `components.css`.

No price figure, review sentence, JSON-LD block, or `data-price-value` attribute is changed.

## Labels

Eyebrows and category lines use DM Sans 500 at `--sm-text-xs` (13px), in capitals.
The tracking is `--sm-tracking-label` (0.25em). A category on a card uses the compact 0.14em, because the card is narrow.

Ink is the label colour on linen. Small bronze text on sand uses dark bronze, `--sm-color-text-accent-on-panel` (`#5A4A36`, 5.66:1 on sand). A label on an ink band uses soft bronze.

## Prices

A card price is DM Sans 500 at `--sm-text-price` (22px), with tabular figures.
The “From” prefix and a struck was-price stay DM Sans at `--sm-text-sm`, in muted ink.
The product guide total is DM Sans 500 at `--sm-text-price-lead` (28px).
The guide-price bar is ink, the figure is linen, and the “Guide total” label is soft bronze.
The permit line stays muted and is not added to the figure.

## Stars

Review stars are dark bronze, 16px. They are not gold.
The review sentences are unchanged. The stars keep whatever accessible name they already have.
