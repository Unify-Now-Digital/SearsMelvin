# S2 base type, links, and focus

Stage S2 sets the base type, the sentence links, and a visible focus ring.
Header, footer, buttons, forms, cards, labels, prices, and stars keep their current shape.
Those are later stages.

Public pages already load `tokens.css`.
This stage adds the rules in `site-upgrades.css`.
It does not change selectors, ids, or names.

## Fonts

The pages load Cormorant Garamond 300, 400, 500, and 600, plus italic 400.
They load DM Sans 400 and 500.
Both use `font-display: swap`.
The pages already preconnect to the font hosts.
DM Sans 600 is no longer requested. The brand does not use it.

## Scale

| Role | Before | After |
|---|---|---|
| H1 | Cormorant 400. `clamp(2.5rem, 6vw, 4.5rem)`. Line-height 1.2. Tracking −0.02em. | Cormorant 600. `--sm-text-3xl`. Line-height 1.1. Tracking −0.01em. |
| H2 | Cormorant 400. `clamp(2rem, 4vw, 3rem)`. Line-height 1.2. | Cormorant 500. `--sm-text-2xl`. Line-height 1.15. |
| H3 | Cormorant 400. `clamp(1.25rem, 2vw, 1.5rem)`. Line-height 1.2. | Cormorant 500. `--sm-text-xl`. Line-height 1.15. |
| H4 | Cormorant 400. No size of its own. Line-height 1.2. | Cormorant 600. `--sm-text-lg` (20px). Line-height 1.25. |
| Body | DM Sans. 16px on most text, 1rem on paragraphs. Line-height 1.6. | DM Sans 400. `--sm-text-md` (17px, 18px from 769px). Line-height 1.65. Measure 68ch. |
| Buttons and prices | DM Sans, often weight 600. | DM Sans 500. Size and shape unchanged. |
| Card titles | Cormorant, about 1.2rem. | Same size. The card stage owns them. |

## Links

A link in a sentence is bronze and underlined on linen or white.
Hover turns it ink and thickens the underline.
The offset is 0.18em.
Menus, the footer, the phone button, and a product card keep their current colour and have no new underline.

## Focus

`:focus-visible` draws a 2px ring, 2px outside the control.
The ring is bronze on a light ground (5.33:1 on linen, 3.72:1 on sand).
The ring is soft bronze on ink (5.13:1).
The outline does not change the box.
A focused control keeps 8px of clear space under the sticky header.
