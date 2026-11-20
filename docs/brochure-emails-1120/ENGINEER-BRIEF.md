# Engineer brief — on-brand brochure emails

Date: 20 November 2026, Europe/Madrid (UTC+1).

This is a design brief and a draft only. Do not commit from this folder. Do not merge. Do not deploy. Do not send a real email. Wait for Arin's words in Engineer's chat.

Suggested pull request: a new draft PR. Base it on `cursor/phone-chat-back-a906` (combined release PR 278) if that branch is still current. If PR 278 has moved, base it on the current PR 278 head, or on main if that is safer. A separate draft is safer than adding this work to PR 278, because this work changes email send logic and templates. If you prefer one release, you may add it to PR 278. The success-state change can live in either pull request.

## 1. Why this work is needed

The live brochure form (main `67ce3614`) posts to `/api/submit` with `channel: contact` and `enquiry_type: brochure`.

1. The family receives the generic enquiry receipt. That email has no brochure link and no brochure attachment. The subject is "{Type} enquiry — Sears Melvin Memorials".
2. An older family email already exists in `functions/api/brochure.js` (`brochureEmailHtml`, subject "Your Sears Melvin brochure", with a download link). The new form does not call `/api/brochure` with `action: email`, so that template is unused.
3. The staff email to info@ uses subject "New Enquiry — [Name] — Brochure". It does not show the source (`from= home`, header, listing, product, brochure page) or the originating page. Ad attribution is not in the email.
4. The on-page success state says "Thank you. Your brochure is ready." and shows a download button. It does not say that a copy is in the family's inbox. After this change, that line must be true.
5. The generic enquiry receipt and the staff alert (and the quote and appointment emails) are off brand. They use a dark `#2C2C2C` / `#1A1A1A` header, accent `#8B7355`, ground `#F5F3F0`, 10px corners, uppercase badges, Georgia and Arial only, no stacked logo, faded footer text, and the showroom number as `+44 20 3835 2548`.

## 2. Goal

1. On a brochure enquiry, send the new family brochure email instead of the generic receipt.
2. Pass the source through the form, store it, and show it on the staff alert.
3. Apply the new on-brand templates.
4. Improve the on-page success state a little.
5. Keep tracking unchanged, including the `brochure_download` event.
6. Do not attach the PDF. The family email must link to `/assets/sears-melvin-brochure.pdf?v=10.1`.

## 3. Brand rules for every email

Use tables and inline CSS. Do not use a background image. Set an explicit colour on every text node. Prefer `color-scheme: light`.

1. Ground: linen `#FBF9F5`. Card: white, with a sand `#DDD1C0` 1px border and 2px corners.
2. Text: ink `#302C27`. Secondary text: ink muted `#5C554C`. Links: bronze `#7A6449`, with an underline. On ink, use linen `#FBF9F5` or inverse muted `#CFC6B8`. Accent text on ink may use soft bronze `#B19A7B`.
3. Headings: `'Cormorant Garamond', Georgia, 'Times New Roman', serif`. Body, labels, and buttons: `'DM Sans', Arial, Helvetica, sans-serif`. You may load the Google Fonts stylesheet in the head. Many clients will ignore it, so the fallbacks must hold the layout.
4. Primary button: ink fill, linen text, sentence case, 2px corners, DM Sans 500. Do not use uppercase. Do not use a letter-spacing track.
5. Header: linen ground, centred stacked logo with the side rules. Use the hosted PNG `https://searsmelvin.co.uk/images/brand/logo/sears-melvin-stacked-ink.png` at width 240 and height 61. Do not use the old square `sm-logo.png` mark. Do not use SVG in email. Link the logo to `https://searsmelvin.co.uk`.
6. Footer: ink ground. Do not fade white over ink.
7. The showroom number is `020 3835 2548`, as one unbroken string (`white-space: nowrap`). The `tel` href is `tel:+442038352548`.
8. From address stays `Sears Melvin Memorials <info@searsmelvin.co.uk>`.
9. Do not use an emoji. Do not use an exclamation mark. Do not make a claim that is not already on the site. Allowed examples already on the site: "Prices include VAT.", "Our fixers are NAMM-qualified and RQMF registered.", "We reply within one working day.", Finchley showroom, Monday to Friday, 10am to 3pm, and the address 1 The Market Place, Falloden Way, London NW11 6LB.
10. Send a plain-text part as well as HTML. Extend `sendEmail` in `functions/api/submit.js` so Resend receives `text` and `html`.

Approved copy, HTML, and plain-text files are in `/workspace/brochure-emails-1120/`. Use them. Screenshots of the mockups are in the same folder.

## 4. Family brochure email

Use this template when `enquiry_type` is `brochure` and the family has an email address.

1. Subject: `Your Sears Melvin brochure`.
2. Opening: "Hello {first name}," then "Thank you for asking for our brochure. Here is your copy, to read at your own pace."
3. Show the brochure cover, linked to the PDF. Then the primary button "Download the brochure", also linked to the PDF. Then the line "PDF · 30 pages · 2.3 MB".
4. One line on what is inside, then the quiet VAT line, as in `COPY.md`.
5. A quiet "request a quote" link and the showroom phone. Then the Finchley showroom line and address. Sign off "With care, The Sears Melvin team".
6. Do not attach the PDF.
7. The PDF href is `https://searsmelvin.co.uk/assets/sears-melvin-brochure.pdf?v=10.1`. You may keep the existing email UTM query: `utm_source=brochure_email&utm_medium=email&utm_campaign=brochure_v10&utm_content={source}`. The quote link may keep the same campaign. Do not fire a `brochure_download` event from the email.
8. Replace the unused `brochureEmailHtml` in `functions/api/brochure.js` with this template, so any remaining `action: email` call uses the same design.

Files: `family-brochure-email.html`, `family-brochure-email.txt`, `family-brochure-email-desktop.png`, `family-brochure-email-390.png`.

## 5. Staff brochure alert to info@

1. Subject: `Brochure request: {Name}`. Use `formatNameForSubject` for the name, as today.
2. Opening, reason first: "{Name} has asked for the brochure."
3. Fields, in this order:
   1. Name
   2. Phone, as a `tel` link, or "Not given" if there is no number
   3. Email, as a `mailto` link
   4. Source — the `from` value, written in sentence case: Home, Header, Listing, Product, Brochure page. If the visitor came from a product, write "{Product name} (product)".
   5. Page — the originating path, linked to the live site, for example `/`, `/memorials`, `/memorials/the-castell`, `/brochure`
   6. Ad — only when attribution exists. Use `deriveLeadSource`. If the source is Google Ads and `utm_campaign` is present, write `Google Ads · {campaign}`. If there is no click id and no UTM, omit the Ad row.
   7. Time — UK time, Europe/London. Keep the current `en-GB` `dateStyle: "medium"` and `timeStyle: "short"` format, and add the words "UK time". Example: `20 Nov 2026, 12:15 UK time`.
4. Quick reply: an ink "Reply by email" button (`mailto`) and an outlined "Call" button (`tel`) when a number exists.
5. "Open in HighLevel" as a text link, when a contact id exists. Use `https://app.gohighlevel.com/v2/location/{GHL_LOCATION_ID}/contacts/detail/{contactId}`. Use the same location id as `createGHLContact` (`env.GHL_LOCATION_ID`).
6. This link is feasible if the staff email waits for `createGHLContact`. Today the staff email and the HighLevel call run in parallel, so the id may not exist when the email is built. Create or find the contact first, then send the staff email. If HighLevel fails, still send the staff email, and omit the link. Do not delay the family email for HighLevel.

Important: `tests/email-subjects.mjs` pins the phrase `New Enquiry — ` because Gmail filters use it. This subject change will break a filter that keys only on that phrase. Update the test. In the pull request, tell Arin that the info@ filter may need a new rule for `Brochure request:`. Do not change the staff subject for other enquiry types in this pull request, unless Arin asks. Those can stay `New Enquiry — {Name} — {Type}`.

Files: `staff-brochure-email.html`, `staff-brochure-email.txt`, `staff-brochure-email-desktop.png`, `staff-brochure-email-390.png`.

## 6. Pass and store the source

Today the form already sends `source_page`, but it is `location.pathname` on `/brochure`, so it is always `/brochure`. The `from` query (`home`, `header`, `listing`, `product`, `brochure_page`) is used only for `brochure_request` and `brochure_download`. It is not in the payload and not in the staff email.

Do this:

1. Keep the allowed source list: `header`, `home`, `product`, `listing`, `brochure_page`.
2. When `initBrochure` rewrites a brochure link, include the source and the originating path. For a header or product click, the path is the current page. For a product page, also include the memorial slug, and the product name if it is already on the page. Example: `/brochure?from=product&page=/memorials/the-castell&item=the-castell`. Sanitize the path and the slug.
3. `brochureRequestPayload` must send:
   1. `brochure_source` — the `from` value
   2. `source_page` — the originating path, not `/brochure`, unless the visitor started on the brochure page
   3. Product slug and product name, when known, inside `details`
4. `createEnquiry` already writes `source_page`. Keep that. Also store `brochure_source` and the product fields in `details`, so they are not lost.
5. Pass `brochure_source`, `source_page`, product fields, and attribution into the staff email template.
6. Do not change the `brochure_request` or `brochure_download` event names or their source values.

Note: `about.html` has a brochure link with no `data-brochure-source`. Today that records as `brochure_page`. You may add `data-brochure-source` if you also add a safe source value. Do not expand the source list unless the tests and the staff labels stay clear. `memorial.html` has no in-page `data-brochure-source="product"` link. Still record a header click on a memorial page, including that page path.

## 7. On-page success state

On `/brochure`, after a successful submit:

1. Keep hiding the form and showing `[data-brochure-thanks]`.
2. Use the copy in `COPY.md`. Use the first name from the form when you have one.
3. Keep the download button on `a[data-brochure-link]`. Keep `trackBrochureDownload` on that click. Do not change the `brochure_download` event.
4. The current CSS makes every link inside `.sm-brochure-thanks` look like the primary button. Scope the button style to `a[data-brochure-link]` only. Style "request a quote" and the phone as bronze underlined text links.
5. Give the thanks block the same quiet panel as the form (padding, quiet sand ground, sand border, 2px corners). Suggested CSS is in `success-thanks.css` in this folder.

Files: `success-1280.png`, `success-390.png`, `success-card-1280.png`, `success-card-390.png`.

## 8. Shared layout for other enquiry emails

The generic family receipt and the staff alert are off brand, as set out in section 1. Quote and appointment emails use the same chrome.

1. Extract a shared shell (header, card, footer, colours, fonts, button) that every customer and staff email uses. A module such as `functions/api/_email-brand.js` is fine.
2. Apply that shell to the family enquiry receipt. Use the copy in section 4 of `COPY.md`. Subject: `We have received your enquiry — Sears Melvin Memorials`. Keep the "one working day" line. Show a copy of the submitted details, as today. Use the showroom number `020 3835 2548`.
3. Apply the same shell to the staff enquiry alert. Keep the current subject `New Enquiry — {Name} — {Type}` for non-brochure types. Add source page, ad attribution, UK time, and the same reply links when those fields exist. Add the HighLevel link when the contact id is available, as in section 5.
4. If the change stays small and the tests still pass, apply the same shell to the quote and appointment emails. Keep their current subjects and body facts. If that widens the review, do enquiry types in this pull request and leave quote and appointment as a follow-up.

The shared family receipt mockup is `family-enquiry-email.html`, with screenshots `family-enquiry-email-desktop.png` and `family-enquiry-email-390.png`.

## 9. Tracking and tests

1. Do not change GTM. Do not change `brochure_download`, `brochure_request`, or other event names.
2. The on-page download must still log `brochure_download` with the same source values as today.
3. Update `tests/email-subjects.mjs` for the new brochure staff subject. Add or adjust tests for the family brochure template (subject, PDF link, no attachment), for source pass-through and storage, and for the success-state markup.
4. Run the existing brochure, submit, and tracking tests. They must pass.

## 10. Preview and go-live

1. Open a draft pull request with a preview. The preview must show the new success state on `/brochure`. Include the new email HTML in the pull request or in a short preview note, with the mockup screenshots from this folder if useful.
2. Nothing is live until Arin writes his approval in Engineer's chat. A suitable line is: "Merge the brochure email pull request" (use the PR number).
