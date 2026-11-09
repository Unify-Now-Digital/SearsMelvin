# Sears Melvin Memorials — brand book

Bronze & Linen. Version A. Approved for the web on 8 November 2026.

Read this file before you change anything a person can see. That includes pages, components, email, and images.

Write in short sentences. Use the words in this book.

## 1. Rules

1. This file is the reference for all visual work.
2. Every pull request that changes a visual must follow this file.
3. If you change a brand rule, update this file in the same pull request.
4. In code, only `tokens.css` may hold a raw colour value. A raw colour is a hex value, an `rgb()` value, or an `hsl()` value.
5. You may write a colour’s hex in this book, so a person can read it. Do not copy that hex into any other file.
6. Components use semantic tokens (`--sm-color-*`). They do not use primitives (`--sm-ref-*`).
7. Run `node scripts/check-tokens.mjs` before you open a visual pull request. It must pass.
8. The check reports raw colours outside `tokens.css`. Stage S1 cleared the page CSS. The check does not fail on a leftover yet. That guard is a later stage.
9. Public pages load `tokens.css` so the colour tokens resolve. Do not load `components.css` on a public page until a later stage.
10. `/styleguide` is the visual reference. It is `noindex`. It does not load Tag Manager. It is not in the sitemap.
11. Opening hours are 10am to 3pm (days TBC). The showroom phone is 020 3835 2548. Keep that number as one unbroken string.

## Scope

This book covers every Sears Melvin surface, brought in by phases.

1. The public website.
2. The customer portal.
3. Quote PDFs.
4. Emails.
5. Ads.

Stage S1 maps colour on the public pages. Those pages load `tokens.css`. They do not load `components.css`. Later stages change type, buttons, and layout. Do not change a surface until its stage says so.

## Approval

1. Only Arin approves a brand change.
2. A brand change updates this file in the same pull request.
3. Do not ship a new colour, a new logo layout, or a new photography rule without that update.

## Tone of voice

Be calm and plain. Do not push a family.

1. Write short sentences.
2. Use the words a family already knows.
3. Show the guide price. Say what it includes.
4. Do not use an exclamation mark.
5. Do not use hype.
6. Do not make a claim you cannot prove.

### Do

1. Do write “Request a quote”.
2. Do write “From £1,875, including lettering”.
3. Do write “Time to choose, space to remember.”

### Don’t

1. Do not write “GET YOUR FREE QUOTE NOW!”.
2. Do not write “Only £1,875 – amazing value!”.
3. Do not write “Only 2 left” or “Hurry”.

Words to avoid:

1. deal
2. hurry
3. cheap
4. best

## 2. The brand in one page

The brand is warm, calm, and clear.

1. Page ground is linen. Header ground is linen.
2. Footer ground is ink. The primary button is ink.
3. Headings use Cormorant Garamond. Body, prices, and buttons use DM Sans.
4. Corners are 2px.
5. Buttons use sentence case.
6. The stacked logo is approved. It is Cormorant Garamond 500, with the thin rules beside MEMORIALS. Use that file by default, including the site header on desktop and tablet. The no-rules file is only for small sizes where the rules fade. Show the logo on `/styleguide` only, until a later phase changes the live header. Do not use a horizontal layout.
7. The shortlist heart is square.
8. Do not use an arched photo frame.
9. Opening hours are 10am to 3pm (days TBC). The showroom phone is 020 3835 2548.

## 3. Colours

Use these roles. Do not add a new colour without a change to this book and to `tokens.css` in the same pull request.

| Name | Hex | Role |
|---|---|---|
| Ink | #302C27 | Main text. Footer ground. Primary button. |
| Linen | #FBF9F5 | Page ground. Header ground. |
| Bronze | #7A6449 | Links, rules, and control borders on linen or white. |
| Sand | #DDD1C0 | Cards, panels, and quiet dividers. |
| Soft bronze | #B19A7B | Text and rules on ink only. A soft-bronze fill takes ink text. |
| White | #FFFFFF | Photo wells and inputs. |
| Dark bronze | #5A4A36 | Small text and links on sand. |
| Deeper bronze | #6B5840 | A darker bronze for linen, when you need more than 5.33:1. Not the sand text colour. |
| Ink muted | #5C554C | Secondary text. |
| Inverse muted | #CFC6B8 | Secondary text on ink. Use the solid colour. |
| Quiet sand | #EFE8DE | A large quiet panel, when sand is too strong. |
| Error | #9E3A2E | Form error only. |
| Success | #3F6E4E | Form success only. |
| Warning | #6B4E16 | Form and status warning text only. 7.32:1 on linen. 5.12:1 on sand. |
| Error surface | #F8E8E6 | Error message ground. Error text on it is 5.70:1. |
| Success surface | #E7F2EB | Success message ground. Success text on it is 5.15:1. |
| Warning surface | #F8EED9 | Warning message ground. Warning text on it is 6.68:1. |
| Ink hover | #463F37 | Hover for an ink fill, until the button stage. |

Do not darken the brand bronze (#7A6449). Use dark bronze on sand instead.

### Stone materials

A stone swatch shows the granite or marble. It is not a brand colour. The hex lives on `--sm-color-material-*` in `tokens.css`. Use it only on a swatch. Do not use it for text, a button, or the page ground.

### Third-party marks

| Name | Hex | Token | Use |
|---|---|---|---|
| Google blue | #4285F4 | `--sm-color-mark-google` | The Google sign-in control only. |
| RQMF navy | #292345 | `--sm-color-mark-rqmf` | The RQMF logo chip only. |

These are not brand colours. Do not use them on a Sears Melvin button or heading.

### Do

1. Use ink for body text on linen, sand, and white.
2. Use dark bronze for small bronze-coloured text on sand.
3. Use soft bronze for text on ink.
4. Use ink text on a soft-bronze fill.
5. Use error and success only on forms.

### Don’t

1. Do not use soft bronze as text on linen or white.
2. Do not use sand as text.
3. Do not use bronze as text on ink.
4. Do not use bronze as small text on sand.
5. Do not use linen text on a soft-bronze fill.
6. Do not use error red or success green as decoration.
7. Do not fade white over ink for legal text. Faded white fails contrast.

## 4. Contrast

Text must reach WCAG 2.2 AA. Small text needs 4.5:1. Large text needs 3:1. A control boundary and a focus ring need 3:1.

Allowed text pairs:

1. Ink on linen is 13.18:1.
2. Ink on white is 13.86:1.
3. Ink on sand is 9.21:1.
4. Ink on quiet sand is 11.4:1.
5. Linen on ink is 13.18:1.
6. Inverse muted on ink is 8.2:1.
7. Bronze on linen is 5.33:1.
8. Bronze on white is 5.61:1.
9. Dark bronze on sand is 5.66:1.
10. Dark bronze on linen is 8.09:1.
11. Soft bronze on ink is 5.13:1.
12. Ink on soft bronze is 5.13:1.
13. Linen on bronze is 5.33:1. This is the primary button hover.
14. Ink muted on linen is 6.99:1.
15. Ink muted on sand is 4.88:1.
16. Error on linen is 6.45:1. Error on white is 6.78:1.
17. Success on linen is 5.62:1. Success on white is 5.91:1.
18. Warning on linen is 7.32:1. Warning on white is 7.70:1. Warning on sand is 5.12:1.
19. Warning on the warning surface is 6.68:1.
20. Success on the success surface is 5.15:1.
21. Error on the error surface is 5.70:1.

These pairs fail for small text. Do not use them for words:

1. Bronze on ink is 2.47:1.
2. Soft bronze on linen is 2.57:1.
3. Bronze on sand is 3.72:1. It can be a focus ring. It cannot be small text.
4. Linen on soft bronze is 2.57:1.
5. Sand on linen is 1.43:1. Sand may be a divider. It may not be text or a control border.

Check contrast on the pairs you change. Record the result in the pull request.

## 5. Type

Load the faces once.

1. Cormorant Garamond 500 and 600 for headings. The logo lock-up is Cormorant Garamond 500.
2. Cormorant Garamond italic 400 for a short quote.
3. Cormorant Garamond 300 only at 32px or larger.
4. DM Sans 400 for body text.
5. DM Sans 500 for buttons, prices, and labels.
6. Do not use DM Sans 600 or 700. The browser will fake the bold.

Sizes:

1. H1 uses `--sm-text-3xl`. Weight 600. Line-height about 1.1.
2. H2 uses `--sm-text-2xl`. Weight 500. Line-height about 1.15.
3. H3 uses `--sm-text-xl`. Weight 500.
4. H4 uses `--sm-text-lg` (20px). Weight 600.
5. Body uses `--sm-text-md`. That is 17px on a phone and 18px on a desktop. Line-height 1.65. Keep the line length near 68 characters.
6. Small text uses `--sm-text-sm` (15px).
7. Labels use `--sm-text-xs` (13px).
8. A card price uses `--sm-text-price` (22px). A product-page price uses `--sm-text-price-lead` (28px).
9. A short quote uses `--sm-text-quote` (22px) in italic.

### Do

1. Set headings in Cormorant.
2. Set prices, buttons, and body text in DM Sans.
3. Keep one idea in a sentence.

### Don’t

1. Do not set a price in light Cormorant.
2. Do not use weight 300 below 32px.
3. Do not use italic for long text. Italic is for a short quote only.

## 6. Spacing

Use the nine steps. The base is 4px.

1. `--sm-space-1` is 4px.
2. `--sm-space-2` is 8px.
3. `--sm-space-3` is 12px.
4. `--sm-space-4` is 16px.
5. `--sm-space-5` is 24px.
6. `--sm-space-6` is 32px.
7. `--sm-space-7` is 48px.
8. `--sm-space-8` is 64px.
9. `--sm-space-9` is 96px.

The page gutter (`--sm-gutter`) is 20px at 375px wide, and it grows to 64px on a wide screen.

A touch target is at least 44px. A control is 48px tall.

## 7. Corners

Corners are 2px (`--sm-radius-sm`).

Use 2px on buttons, inputs, cards, badges, chips, photo frames, and the shortlist heart.

### Do

1. Keep the shortlist heart square.
2. Memorial photo frames are 4:5. Homepage category wells stay square.
3. Keep radio buttons round. A round radio is a control, not a photo frame.

### Don’t

1. Do not use a pill shape on a new component.
2. Do not use a 6px card corner.
3. Do not use an arched top, a tombstone crop, or a half-round photo frame.
4. Do not make the shortlist heart a circle.

## 8. Buttons

One shape. Colour shows which action matters.

1. Primary (`sm-btn--primary`). Ink ground, linen text. Hover turns the ground bronze and keeps linen text. Use one primary button in a view.
2. Secondary (`sm-btn--secondary`). Transparent ground, ink text, 1px bronze border. Hover fills the ground with sand.
3. Inverse (`sm-btn--inverse`). Soft-bronze ground, ink text. Use it on ink (footer, price panel, mobile bar). Hover fills the ground with linen.
4. Text (`sm-btn--text`). Bronze text with an underline. Hover turns the text ink. Use it for a low-priority action.
5. Call (`sm-btn--call` on linen, `sm-btn--call-inverse` on ink). The phone action.

Shared rules:

1. Font is DM Sans 500 at `--sm-text-sm` (15px).
2. Write the label in sentence case. Example: “Request a quote”.
3. Height is 48px. Padding is `--sm-space-3` by `--sm-space-5`. Corner is 2px.
4. The icon sits in its own element, before the text.
5. Disabled keeps the shape. Use a sand ground and ink-muted text. Add a short reason next to the control.
6. Loading keeps the width. Show a spinner and the words “Sending…”.
7. Focus is a 2px ring, 2px outside the control. Use bronze on a light ground. Use soft bronze on ink.

### Do

1. Use sentence case.
2. Give the page one clear primary action.
3. Keep a phone button as a real link. See section 19.

### Don’t

1. Do not set button labels in capitals.
2. Do not use a second filled ink button beside the primary.
3. Do not put linen text on a soft-bronze button.
4. Do not draw an empty box for a low-priority action. Use the text button.

## 9. Links

1. On linen or white, the link is bronze and underlined.
2. On sand, the link is dark bronze and underlined.
3. On ink, the link is linen and underlined. Hover turns it soft bronze.
4. Hover on a light ground turns the link ink and thickens the underline.
5. A menu can drop the underline when the group is clearly a menu. The current page still needs a mark (a bronze underline).

### Do

1. Underline links in a sentence.
2. Keep the underline offset near 0.18em.

### Don’t

1. Do not rely on colour alone.
2. Do not use brand bronze for a link on sand.

## 10. Labels, badges, and chips

Labels (the small line above a heading):

1. DM Sans 500, `--sm-text-xs`, capitals, letter-spacing 0.25em.
2. Use 0.14em when the space is narrow.
3. Ink on linen or sand. Bronze on linen only. Soft bronze on ink only.

Badges:

1. 2px corners. DM Sans 500. `--sm-text-xs`.
2. Neutral: sand ground, ink text.
3. Accent: ink ground, soft-bronze text.
4. Outline: bronze border, ink text.
5. Trust chips keep the classes `site-trust-chip` and `nav-accred-chip`.

Chips (filters):

1. 2px corners. 44px tall. Sentence case.
2. Default is white with a bronze border.
3. Hover is sand.
4. Selected is ink with linen text.

### Do

1. Use a badge for a fact, such as “Fixing included”.
2. Keep accreditation text as text, not as a link.

### Don’t

1. Do not use a badge for pressure.
2. Do not set a form label in capitals. Capitals are for the small eyebrow label only.

## 11. Prices

1. Use DM Sans 500. Do not use Cormorant for a price.
2. Write “From £1,450”. Use tabular figures.
3. Add one line in muted text that says what is included or extra. Example: “Cemetery permit fees are extra and vary by cemetery.”
4. The guide-price panel on a product page uses an ink ground, a linen price, and a soft-bronze label.
5. Do not add a cemetery permit fee to the customer’s guide total.

### Do

1. Say what the price includes.
2. Keep the permit line in muted text, not in the price figure.

### Don’t

1. Do not hide the price.
2. Do not style the price in a light display face.

## 12. Cards

1. A memorial card photo well is a 4:5 frame on linen (`--sm-color-bg`). Centre the stone and use `object-fit: contain`. Do not tint the memorial photo. A homepage category well stays a white square.
2. The info panel is sand. Padding is `--sm-space-4`. The card corner is 2px.
3. The edge is 1px sand. The shadow is `--sm-shadow-sm`. Hover uses `--sm-shadow-md`. Do not lift the card.
4. The title is Cormorant 500, `--sm-text-card-title`, ink. At 375px the memorial card title uses the next smaller step, `--sm-text-lg`. Do not clip or truncate the name.
5. The category label is ink on sand.
6. “View details” is dark bronze on sand.
7. The whole card is one link. Keep `href` and the data attributes `data-id`, `data-slug`, `data-name`, `data-price-value`, and `data-type`.
8. The shortlist heart is a separate button. It is square, 44×44px, with 2px corners. Keep the class `save-btn` beside `sm-save`.

### Do

1. Keep the heart outside the card link, so the heart and the card do not fight.
2. Show the empty heart as white with a bronze border. Show the saved heart as ink with a linen mark.

### Don’t

1. Do not round the heart into a circle.
2. Do not put the heart inside the product link.
3. Do not tint, duotone, or crop the stone photo into a curve.

## 13. Forms

1. The field ground is white.
2. The border is 1px bronze (5.33:1 on linen, 5.61:1 on white).
3. The field is 48px tall. The corner is 2px.
4. The text is at least 17px, so a phone does not zoom in.
5. The label sits above the field. Use sentence case. Use DM Sans 500.
6. Placeholder text uses ink muted.
7. Focus adds a 2px bronze ring, 2px outside the field, and turns the border ink.
8. Error uses a 2px error border and a text message. Link the message with `aria-describedby`. Do not use colour as the only cue.
9. Success uses a 2px success border and a text message.
10. The checkbox is square, 22px, inside a row at least 44px tall. The radio stays round.
11. Keep every live `id`, `name`, and submit handler.

### Do

1. Put the label above the field.
2. Explain the error in words.

### Don’t

1. Do not use a pale grey border on a field.
2. Do not add a new form on a `/memorials` page. A form submit there can be counted as a lead. The quote form on the product page stays as it is.
3. Do not use red or green outside form states.

## 14. Header

This is the live header. The ground is linen and the logo is the stacked ink file.

1. Ground is linen. Add a 1px sand rule under it.
2. The stacked logo and the nav are ink. The logo is at least 240px wide. Use the logo with rules. On a 1× screen, switch to the no-rules file below 262px. On a 2× screen, switch below 131px.
3. Desktop height is 80px. Mobile height is 68px.
4. Nav links are DM Sans 500 at 15px. Hover and the current page use a bronze underline.
5. The phone action is `sm-btn--call`. “Get a quote” is the one primary button.
6. On a phone, put the phone action and the quote action in the ink bottom bar.
7. Icon buttons are 44px and square.
8. Focus on linen uses bronze.

Keep these live hooks when you later change the real header: `#navbar`, `.mobile-menu-btn`, `#mobileNav`, `.nav-brochure`, `#shortlistNavBtn`, `.shortlist-nav-btn`, and the search classes.

### Do

1. Match the fascia: linen ground, ink logo.
2. The live header uses the stacked ink logo. `/styleguide` keeps the clear-space sample.

### Don’t

1. Do not change the live header in a token or component pull request.
2. Do not use an ink header. Ink is the footer and the primary button.
3. Do not use a horizontal layout.

## 15. Footer

1. Ground is ink. Text is linen.
2. Secondary and legal text uses inverse muted, as a solid colour (8.2:1).
3. The stacked logo on ink is the soft-bronze file.
4. Links are linen. Hover turns them soft bronze and adds an underline.
5. Section headings are soft-bronze labels.
6. You may show the showroom address: 1 The Market Place, Falloden Way, NW11 6LB.
7. Opening hours are 10am to 3pm (days TBC). Write that sentence. Do not invent the days.
8. The showroom phone is 020 3835 2548. It is the active showroom landline. Write it as one unbroken string.

Keep these live classes when you later change the real footer: `.footer-container`, `.footer-links`, `.footer-contact`, `.footer-legal`, `.footer-copy`.

### Do

1. Use a solid muted colour for legal text.
2. Write the hours as 10am to 3pm (days TBC).
3. Write the showroom phone as 020 3835 2548.

### Don’t

1. Do not invent the days. The days stay TBC.
2. Do not split the showroom phone into separate pieces.
3. Do not set legal text in white at 45% opacity.

## 16. Quote panel

1. Ground is sand. Corner is 2px. Add a 3px bronze rule on the left.
2. The quote is Cormorant italic 400, about 22px, in ink.
3. The name is DM Sans 500. The place is ink muted.
4. Stars are dark bronze, so they pass on sand.
5. Use a real review, word for word. Sarah M. of Islington, David R. of Barnet, and Angela K. of Enfield on the home page are real. Do not change their words. Do not call them placeholders.

### Do

1. Keep the published wording.
2. Limit italic to the short quote.

### Don’t

1. Do not invent a family, a place, or a sentence.
2. Do not colour the stars gold.

## 17. Logo

The approved logo is the stacked lock-up. It is Cormorant Garamond 500, with the thin rules beside MEMORIALS. Arin approved the rules on 8 November 2026. Use this file by default, including the site header on desktop and tablet.

1. Use `/images/brand/logo/sears-melvin-stacked-ink.svg` on linen, or `/images/brand/logo/sears-melvin-stacked-bronze.svg` on linen.
2. Use `/images/brand/logo/sears-melvin-stacked-soft-bronze.svg` on ink.
3. Do not draw the stacked logo narrower than 240px. Check that the 500 weight still reads at that width.
4. Leave clear space on all sides. The clear space is the cap height of the S.
5. The live header uses the stacked ink logo. `/styleguide` still shows the clear-space sample.
6. Do not redraw the logo in CSS.

The no-rules files are the small-size fallback only: `sears-melvin-stacked-ink-no-rules.svg`, `sears-melvin-stacked-bronze-no-rules.svg`, and `sears-melvin-stacked-soft-bronze-no-rules.svg`, each with a 400px PNG and an 800px PNG. Switch to that file only where the rules would render thinner than about 1px or would fade.

The rules are a 1-by-42 unit stroke in a viewBox 261.742 units wide. Measured in headless Chrome on linen, by the ink coverage of the left rule in the rendered PNG: the rule is one full-ink device pixel at 262px wide on a 1× screen and at 131px wide on a 2× screen. Below those widths the darkest pixel falls to about half strength and the line fades. At 240px on a 1× screen the rule is about 0.9px and faded, so use the no-rules file even though 240px is still the minimum width. At 240px on a 2× screen the rule is about 1.8 device pixels and stays full ink, so keep the rules.

At 375px the rules stay. They measure about 1.4 device pixels at 1× and about 2.9 device pixels at 2×, both at full ink. Keep the rules at that width, including a 375px mobile header when the logo itself is drawn at 375px.

Do not use a horizontal layout.

1. Do not add a horizontal logo file.
2. Do not show a horizontal logo on a page or on `/styleguide`.

The `source-exact` pack is an archive. Do not use it as the master.

Favicons and app icons belong with the logo, in `/images/brand/logo/favicon/`. The mark is the SM monogram in Cormorant, ink on linen, in a square. The same files are copied to the site root as `/favicon.ico` (16, 32 and 48), `/favicon-48.png`, and `/favicon.svg`, because Google requests `/favicon.ico`. Also keep `favicon-light.svg`, `favicon-light-16.png`, `favicon-light-32.png`, the dark alternatives, `favicon-48.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, and `site.webmanifest`. Every page links the ico, the 48px PNG, and the SVG. The Apple touch icon stays on the public pages. `/styleguide` shows the full set and does not link the Apple touch icon or the manifest. The schema logo is the 512px PNG. The share image is separate.

### Do

1. Use the stacked ink logo on a linen header.
2. Use the stacked soft-bronze logo on an ink footer.
3. Keep the clear-space box visible on `/styleguide`.

### Don’t

1. Do not shrink the logo below 240px.
2. Do not use the no-rules file where the rules still read. That is 262px and above at 1×, and 131px and above at 2×.
3. Do not use a horizontal layout.
4. Do not put soft bronze on linen. It fails contrast.
5. The live header uses the stacked ink logo, and the live pages use the brand favicons.

## 18. Photography

Arin approved this standard on 8 November 2026.

The standard is a 4:5 frame on linen. The reference image is `/images/brand/photo-standard.png`. Show that file on `/styleguide`.

1. Use a 4:5 frame.
2. The frame ground is linen. In CSS, use the token `--sm-color-bg`. Do not type the hex in a component.
3. Centre the stone on a common baseline.
4. Make the stone about 80% of the frame height.
5. Add a soft ground shadow.
6. Keep the whole memorial in the frame. A wide kerb set needs more side space.
7. Keep the stone colour, the shape, and the surface detail.
8. Clean the background only. Do not change the camera angle.
9. Memorial cards and the product-page main image use this frame. Homepage category cards keep the white square well.

### Do

1. Keep the reference image uncropped.
2. Use `--sm-color-bg` for the linen ground.

### Don’t

1. Do not tint the stone.
2. Do not crop a memorial with a curved top.
3. Do not apply this frame to a homepage category card.

## 19. Motion and focus

1. Move colour and shadow. A hover lasts about 150ms. A card shadow lasts about 250ms.
2. Do not lift a card.
3. A pressed button may move 1px. Remove that move when the person asks for less motion.
4. Every control has a visible `:focus-visible` ring. The ring is 2px, with a 2px offset.
5. The ring is bronze on linen, white, and sand. The ring is soft bronze on ink.
6. Do not let a sticky bar cover a focused control.

## 20. Names the tracking must keep

Visual work must not break measurement. When you add an `sm-` class, keep the old class beside it.

1. Any class that contains `shortlist-btn-` must stay. Tag Manager listens for it. Example: `shortlist-btn-copy sm-btn sm-btn--secondary`.
2. The card heart keeps `save-btn`.
3. A phone link is a real `<a href="tel:…">`. The visible number is one text node: `020 3835 2548`. Do not split the digits into spans. Do not put the number in CSS `content`.
4. Do not add a `<form>` on a `/memorials` path. Keep the product quote form’s id.
5. Brochure links keep `data-brochure-source`. The brochure page keeps its email and download hooks.
6. Do not load Tag Manager on `/styleguide`.

## 21. How to change the system

Follow these steps.

1. Read this file.
2. Change `tokens.css` if the value is shared.
3. Change `components.css` if the pattern is shared. Use `sm-` classes and tokens only.
4. Show the change on `/styleguide`.
5. Run `node scripts/check-tokens.mjs`.
6. Screenshot the changed screen at 1280, 744, and 375.
7. Run the tracking check if a page, a link, a form, or a class hook changed.
8. Update this file if the rule changed.
9. Do not merge a visual change that this file forbids.
