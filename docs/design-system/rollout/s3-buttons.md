# S3 buttons

Stage S3 restyles buttons and button-like links to the brand button system.
Header layout, footer layout, cards, prices, labels, and form fields stay as they are.
Submit buttons take the button shape. The fields around them do not.

Public pages keep loading `tokens.css`. They do not load `components.css`.
`components.css` also styles cards, forms, and the header, so linking it would pull those stages forward.
The button rules live at the end of `site-upgrades.css` and use the same tokens.

## Shape

| Role | Ground | Text | Hover |
|---|---|---|---|
| Primary | Ink | Linen | Bronze ground, linen text |
| Secondary | Transparent, 1px bronze border | Ink | Sand ground |
| On ink | Soft bronze | Ink | Linen ground |
| Second action on ink | Transparent, soft-bronze border | Linen | Linen ground, ink text |
| Disabled | Sand | Ink muted | Stays sand |

Corners are 2px. The font is DM Sans 500 at `--sm-text-sm` (15px). The height is 48px. Labels lose `text-transform: uppercase`. The HTML label text is unchanged. Focus stays the S2 ring: 2px bronze, 2px outside the control.

The shortlist heart (`.save-btn`) is a 44px square with 2px corners. It is not a circle.

## What did not change

GTM click triggers (container v26) match `tel:` links, `mailto:` links, and a class containing `shortlist-btn-`. They do not match button label text. Those classes, the tel text `020 3835 2548`, `#quoteForm`, the brochure hooks, and the gclid capture are unchanged. `/memorials` still has no form.

## Contact paths for the live check

After S3 is on the live site, walk each path. Do not send a real lead.

1. Header phone, desktop: `tel:+442038352548`, visible text `020 3835 2548`.
2. Header phone inside the mobile menu, same number.
3. Mobile bottom nav phone on small screens, same number.
4. Showroom banner phone, same number.
5. Footer phone, same number.
6. Body phone links on `/contact` (the call card), product pages (`Call 020 3835 2548`), and in page copy on terms, privacy, and FAQ.
7. Header “Get a quote” (`a.nav-cta`) to `/contact`.
8. Home hero “Get in Touch” to `/contact`, and “Request a Quote” in the closing band.
9. `/quote` email lookup (`#lookupBtn`). It posts to `/api/customer-order`. An empty email must not post.
10. `/contact` form (`#contactForm`). It posts to `/api/submit` and pushes `sm_lead_submit`. An empty form must not post.
11. Brochure email form on `/brochure` (`form[data-brochure-email-form]`, `#brochureEmail`). It posts to `/api/brochure`. The download link is `a[data-brochure-link]`.
12. Brochure hooks on the home page and `/memorials` (`data-brochure-link` / the brochure email block).
13. Email links: `mailto:info@searsmelvin.co.uk` in the footer, on `/contact`, and in the brochure page. There is no WhatsApp link.
14. Product “Request your quote” opens `#quoteForm` on the product page. Submitting pushes `sm_quote_submit`.
15. Shortlist on `/memorials`: the square heart (`.save-btn`), then Copy link (`.shortlist-btn-copy`) and Email (`.shortlist-btn-email`), then the shortlist enquiry button. The enquiry posts as a form on `/memorials` and must not be a second form in the catalogue grid.
