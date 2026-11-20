# S1 palette switch

Stage S1 maps every raw colour in the page CSS onto a Bronze & Linen token.
The check before this stage was 174 unique raw colours, 952 hits, 18 files.
After this stage the same check is 0.

Public pages load `tokens.css`. They do not load `components.css`.
Type, spacing, corners, selectors, classes, and ids are unchanged.

## How a colour was chosen

1. Stone swatches keep material tokens. A black granite chip stays black.
2. Faded white text on ink is solid inverse muted, so it clears 4.5:1.
3. White hex text on an ink control is linen.
4. Cream page ground is linen. The old warm panel is quiet sand, the nearest panel token.
5. The old divider `#E0DCD5` is the sand border token.
6. Shadows keep their offset and blur. The paint is a `color-mix` of the matching token.
7. A gold star is dark bronze.
8. New semantic tokens are in `tokens.css` and in `BRAND.md`.

## Mapping

| Old value | Token | Where used | Count |
|---|---|---|---|
| `#cccccc` | `var(--sm-color-text-inverse-muted)` | about.html (4), brochure.html (4), care-guide.html (4), contact.html (4), faq.html (4), index.html (4), memorial.html (4), memorials.html (4), privacy.html (4), quote.html (4), resources.html (4), terms.html (4), track.html (4), admin-products.html (3), admin.html (3) | 58 |
| `rgba(0,0,0,0.15)` | `color-mix(in srgb, var(--sm-color-text) 15%, transparent)` | admin-products.html (6), memorial.html (6), memorials.html (6), care-guide.html (3), index.html (3), quote.html (3), about.html (2), brochure.html (2), contact.html (2), faq.html (2), privacy.html (2), resources.html (2), terms.html (2), 404.html (1), admin.html (1), site-upgrades.css (1), track.html (1) | 45 |
| `rgba(255,255,255,0.6)` | `var(--sm-color-text-inverse-muted)` | index.html (5), about.html (3), admin-products.html (3), brochure.html (3), care-guide.html (3), contact.html (3), faq.html (3), memorial.html (3), memorials.html (3), privacy.html (3), quote.html (3), resources.html (3), terms.html (3) | 41 |
| `#ffffff` | `var(--sm-color-text-inverse)` | admin-products.html (3), memorial.html (3), about.html (2), brochure.html (2), care-guide.html (2), contact.html (2), faq.html (2), index.html (2), memorials.html (2), privacy.html (2), quote.html (2), resources.html (2), site-upgrades.css (2), terms.html (2), track.html (2), accreditations.css (1), admin.html (1) | 34 |
| `#e0dcd5` | `var(--sm-color-border-decorative)` | site-upgrades.css (13), accreditations.css (2), 404.html (1), about.html (1), admin-products.html (1), admin.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1), track.html (1) | 31 |
| `#595959` | `var(--sm-color-text-muted)` | site-upgrades.css (9), about.html (2), brochure.html (2), privacy.html (2), terms.html (2), 404.html (1), accreditations.css (1), admin-products.html (1), admin.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), memorials.html (1), quote.html (1), resources.html (1), track.html (1) | 30 |
| `#1a1a1a` | `var(--sm-color-bg-inverse)` | about.html (3), admin-products.html (2), brochure.html (2), care-guide.html (2), contact.html (2), faq.html (2), index.html (2), memorial.html (2), memorials.html (2), privacy.html (2), resources.html (2), terms.html (2), admin.html (1), quote.html (1), site-upgrades.css (1), track.html (1) | 29 |
| `#2b2a27` | `var(--sm-color-text)` | 404.html (2), about.html (2), brochure.html (2), care-guide.html (2), contact.html (2), faq.html (2), index.html (2), memorial.html (2), memorials.html (2), privacy.html (2), quote.html (2), resources.html (2), terms.html (2), track.html (2) | 28 |
| `rgba(0,0,0,0.08)` | `color-mix(in srgb, var(--sm-color-text) 8%, transparent)` | index.html (7), memorial.html (5), faq.html (3), resources.html (2), about.html (1), admin-products.html (1), brochure.html (1), care-guide.html (1), contact.html (1), memorials.html (1), privacy.html (1), quote.html (1), terms.html (1), track.html (1) | 27 |
| `#6b5840` | `var(--sm-color-text-accent-strong)` | site-upgrades.css (8), about.html (2), 404.html (1), accreditations.css (1), admin-products.html (1), admin.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1), track.html (1) | 26 |
| `#a69070` | `var(--sm-color-text-accent-inverse)` | admin-products.html (2), admin.html (2), care-guide.html (2), contact.html (2), faq.html (2), index.html (2), memorial.html (2), memorials.html (2), quote.html (2), resources.html (2), track.html (2), about.html (1), brochure.html (1), privacy.html (1), terms.html (1) | 26 |
| `#e8e4dd` | `var(--sm-color-bg-panel-quiet)` | site-upgrades.css (5), index.html (3), admin-products.html (2), track.html (2), 404.html (1), about.html (1), admin.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), memorial.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1) | 25 |
| `rgba(0,0,0,0.1)` | `color-mix(in srgb, var(--sm-color-text) 10%, transparent)` | memorial.html (4), index.html (3), admin-products.html (2), care-guide.html (2), contact.html (2), memorials.html (2), quote.html (2), about.html (1), brochure.html (1), faq.html (1), privacy.html (1), resources.html (1), terms.html (1) | 23 |
| `#3d3d3d` | `var(--sm-color-ink-hover)` | 404.html (1), about.html (1), admin-products.html (1), admin.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), site-upgrades.css (1), terms.html (1), track.html (1) | 17 |
| `#767676` | `var(--sm-color-text-muted)` | contact.html (2), faq.html (2), memorial.html (2), about.html (1), admin-products.html (1), brochure.html (1), care-guide.html (1), index.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1) | 16 |
| `rgba(0,0,0,0.5)` | `color-mix(in srgb, var(--sm-color-text) 50%, transparent)` | admin-products.html (2), memorials.html (2), about.html (1), admin.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1) | 16 |
| `#7a6449` | `var(--sm-color-text-accent)` | memorials.html (2), 404.html (1), about.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1), track.html (1) | 15 |
| `rgba(0,0,0,0.05)` | `color-mix(in srgb, var(--sm-color-text) 5%, transparent)` | index.html (2), quote.html (2), about.html (1), admin-products.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), memorial.html (1), memorials.html (1), privacy.html (1), resources.html (1), terms.html (1) | 15 |
| `#bb4444` | `var(--sm-color-error)` | admin-products.html (5), memorials.html (5), memorial.html (3), care-guide.html (1), contact.html (1) | 15 |
| `#f7f4ee` | `var(--sm-color-bg)` | 404.html (1), about.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1), track.html (1) | 14 |
| `rgba(255,255,255,0.1)` | `color-mix(in srgb, var(--sm-color-bg-surface) 10%, transparent)` | index.html (2), about.html (1), admin-products.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), memorial.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1) | 14 |
| `rgba(139,115,85,0.3)` | `color-mix(in srgb, var(--sm-color-text-accent) 30%, transparent)` | care-guide.html (2), about.html (1), admin-products.html (1), brochure.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1) | 14 |
| `#2c2c2c` | `var(--sm-color-text)` | site-upgrades.css (12), admin-products.html (1), admin.html (1) | 14 |
| `rgba(0,0,0,0.04)` | `color-mix(in srgb, var(--sm-color-text) 4%, transparent)` | admin.html (4), care-guide.html (3), resources.html (3), track.html (2), contact.html (1), faq.html (1) | 14 |
| `rgba(250,248,245,0.95)` | `color-mix(in srgb, var(--sm-color-bg) 95%, transparent)` | about.html (1), admin-products.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1) | 13 |
| `rgba(0,0,0,0.06)` | `color-mix(in srgb, var(--sm-color-text) 6%, transparent)` | quote.html (3), memorials.html (2), resources.html (2), admin-products.html (1), care-guide.html (1), contact.html (1), index.html (1), memorial.html (1), site-upgrades.css (1) | 13 |
| `rgba(255,255,255,0.45)` | `var(--sm-color-text-inverse-muted)` | about.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorial.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1) | 12 |
| `#4a7c59` | `var(--sm-color-success)` | memorial.html (2), admin-products.html (1), admin.html (1), care-guide.html (1), contact.html (1), faq.html (1), index.html (1), memorials.html (1), quote.html (1), resources.html (1), track.html (1) | 12 |
| `#ffffff` | `var(--sm-color-bg-surface)` | site-upgrades.css (5), memorial.html (4), about.html (1), admin.html (1) | 11 |
| `rgba(128,128,128,0.25)` | `color-mix(in srgb, var(--sm-color-text-accent-inverse) 25%, transparent)` | about.html (1), brochure.html (1), care-guide.html (1), contact.html (1), faq.html (1), memorials.html (1), privacy.html (1), quote.html (1), resources.html (1), terms.html (1) | 10 |
| `#444444` | `var(--sm-color-text)` | about.html (2), brochure.html (2), privacy.html (2), terms.html (2) | 8 |
| `rgba(0,0,0,0.12)` | `color-mix(in srgb, var(--sm-color-text) 12%, transparent)` | index.html (2), admin-products.html (1), contact.html (1), faq.html (1), memorial.html (1), memorials.html (1), site-upgrades.css (1) | 8 |
| `#c0392b` | `var(--sm-color-error)` | admin-products.html (3), admin.html (1), memorial.html (1), quote.html (1), track.html (1) | 7 |
| `rgba(0,0,0,0.2)` | `color-mix(in srgb, var(--sm-color-text) 20%, transparent)` | admin-products.html (2), memorial.html (2), memorials.html (2), index.html (1) | 7 |
| `#155724` | `var(--sm-color-success)` | track.html (3), admin.html (2), quote.html (2) | 7 |
| `#d4edda` | `var(--sm-color-success-surface)` | track.html (3), admin.html (2), quote.html (2) | 7 |
| `rgba(255,255,255,0.7)` | `var(--sm-color-text-inverse-muted)` | index.html (4), care-guide.html (1), faq.html (1), resources.html (1) | 7 |
| `#8b7355` | `var(--sm-color-text-accent)` | admin-products.html (3), admin.html (2), site-upgrades.css (1) | 6 |
| `#2c2c2c` | `var(--sm-color-bg-inverse)` | admin-products.html (2), site-upgrades.css (2), admin.html (1), memorials.html (1) | 6 |
| `#1a1a1a` | `var(--sm-color-text)` | site-upgrades.css (3), admin-products.html (1), admin.html (1), memorial.html (1) | 6 |
| `#856404` | `var(--sm-color-warning)` | admin.html (4), quote.html (1), track.html (1) | 6 |
| `#fff3cd` | `var(--sm-color-warning-surface)` | admin.html (2), quote.html (1), site-upgrades.css (1), track.html (1) | 5 |
| `#1a1a1a` | `var(--sm-color-material-black)` | memorial.html (4), care-guide.html (1) | 5 |
| `rgba(139,115,85,0.05)` | `color-mix(in srgb, var(--sm-color-text-accent) 5%, transparent)` | memorial.html (3), index.html (1), quote.html (1) | 5 |
| `#faf8f5` | `var(--sm-color-text-inverse)` | site-upgrades.css (3), about.html (1) | 4 |
| `#555049` | `var(--sm-color-text-muted)` | site-upgrades.css (3), about.html (1) | 4 |
| `#faf8f5` | `var(--sm-color-bg)` | accreditations.css (1), admin-products.html (1), admin.html (1), site-upgrades.css (1) | 4 |
| `#e8665a` | `var(--sm-color-error)` | admin-products.html (2), memorials.html (2) | 4 |
| `#666666` | `currentColor` | admin-products.html (1), contact.html (1), index.html (1), memorials.html (1) | 4 |
| `rgba(139,115,85,0.08)` | `color-mix(in srgb, var(--sm-color-text-accent) 8%, transparent)` | care-guide.html (2), contact.html (1), index.html (1) | 4 |
| `#b8943f` | `var(--sm-color-material-gold)` | memorial.html (4) | 4 |
| `#c9a96e` | `var(--sm-color-text-accent-inverse)` | about.html (1), care-guide.html (1), site-upgrades.css (1) | 3 |
| `#4caf50` | `var(--sm-color-success)` | admin-products.html (1), care-guide.html (1), memorials.html (1) | 3 |
| `#d4cfc6` | `var(--sm-color-bg-panel)` | index.html (2), admin-products.html (1) | 3 |
| `rgba(255,255,255,0.2)` | `color-mix(in srgb, var(--sm-color-bg-surface) 20%, transparent)` | admin-products.html (1), memorial.html (1), memorials.html (1) | 3 |
| `#721c24` | `var(--sm-color-error)` | track.html (2), admin.html (1) | 3 |
| `#f8d7da` | `var(--sm-color-error-surface)` | track.html (2), admin.html (1) | 3 |
| `rgba(255,255,255,0.3)` | `color-mix(in srgb, var(--sm-color-bg-surface) 30%, transparent)` | admin.html (1), care-guide.html (1), index.html (1) | 3 |
| `#c9a227` | `var(--sm-color-warning)` | memorial.html (2), care-guide.html (1) | 3 |
| `#2c2c2c` | `var(--sm-color-border-strong)` | site-upgrades.css (3) | 3 |
| `#0c5460` | `var(--sm-color-text)` | track.html (3) | 3 |
| `#d1ecf1` | `var(--sm-color-bg-panel-quiet)` | track.html (3) | 3 |
| `rgba(255,255,255,0.68)` | `var(--sm-color-text-inverse-muted)` | accreditations.css (1), site-upgrades.css (1) | 2 |
| `#5a4a35` | `var(--sm-color-text-accent-on-panel)` | accreditations.css (2) | 2 |
| `rgba(0,0,0,0.4)` | `color-mix(in srgb, var(--sm-color-text) 40%, transparent)` | admin-products.html (1), memorials.html (1) | 2 |
| `#555555` | `var(--sm-color-border-inverse)` | admin-products.html (1), admin.html (1) | 2 |
| `rgba(44,44,44,0.035)` | `color-mix(in srgb, var(--sm-color-text) 3.5%, transparent)` | admin.html (2) | 2 |
| `#f5f3f0` | `var(--sm-color-bg)` | admin.html (1), track.html (1) | 2 |
| `rgba(139,115,85,0.1)` | `color-mix(in srgb, var(--sm-color-text-accent) 10%, transparent)` | care-guide.html (1), memorial.html (1) | 2 |
| `rgba(139,115,85,0.15)` | `color-mix(in srgb, var(--sm-color-text-accent) 15%, transparent)` | care-guide.html (1), index.html (1) | 2 |
| `rgba(44,44,44,0.2)` | `color-mix(in srgb, var(--sm-color-text) 20%, transparent)` | contact.html (1), index.html (1) | 2 |
| `rgba(0,0,0,0.3)` | `color-mix(in srgb, var(--sm-color-text) 30%, transparent)` | faq.html (1), index.html (1) | 2 |
| `#ddd9d0` | `var(--sm-color-material-cream-shade)` | memorial.html (2) | 2 |
| `#e8e4dc` | `var(--sm-color-material-cream)` | memorial.html (2) | 2 |
| `#9a9a9a` | `var(--sm-color-material-grey-mid)` | memorial.html (2) | 2 |
| `#3a3a3a` | `var(--sm-color-material-black-soft)` | memorial.html (2) | 2 |
| `#6a6a6a` | `var(--sm-color-material-grey-dark)` | memorial.html (2) | 2 |
| `#3a6b47` | `var(--sm-color-material-green)` | memorial.html (2) | 2 |
| `#3a5a8a` | `var(--sm-color-material-blue)` | memorial.html (2) | 2 |
| `#6b2d4f` | `var(--sm-color-material-purple)` | memorial.html (2) | 2 |
| `#e3d3b4` | `var(--sm-color-text-inverse-muted)` | site-upgrades.css (2) | 2 |
| `rgba(90,74,53,0.35)` | `color-mix(in srgb, var(--sm-color-text-accent-on-panel) 35%, transparent)` | accreditations.css (1) | 1 |
| `#292345` | `var(--sm-color-mark-rqmf)` | accreditations.css (1) | 1 |
| `#fff5f5` | `var(--sm-color-error-surface)` | admin.html (1) | 1 |
| `#fffef5` | `var(--sm-color-warning-surface)` | admin.html (1) | 1 |
| `#7c7770` | `var(--sm-color-text-muted)` | admin.html (1) | 1 |
| `rgba(192,57,43,0.055)` | `color-mix(in srgb, var(--sm-color-error) 5.5%, transparent)` | admin.html (1) | 1 |
| `rgba(192,57,43,0.2)` | `color-mix(in srgb, var(--sm-color-error) 20%, transparent)` | admin.html (1) | 1 |
| `rgba(139,115,85,0.12)` | `color-mix(in srgb, var(--sm-color-text-accent) 12%, transparent)` | admin.html (1) | 1 |
| `#bdb5aa` | `var(--sm-color-border-decorative)` | admin.html (1) | 1 |
| `#99958f` | `var(--sm-color-text-muted)` | admin.html (1) | 1 |
| `#fdfcfb` | `var(--sm-color-bg-surface)` | admin.html (1) | 1 |
| `#d7d2ca` | `var(--sm-color-border-decorative)` | admin.html (1) | 1 |
| `#4285f4` | `var(--sm-color-mark-google)` | admin.html (1) | 1 |
| `#d7dce1` | `var(--sm-color-border-decorative)` | admin.html (1) | 1 |
| `#4c5157` | `var(--sm-color-text-muted)` | admin.html (1) | 1 |
| `#d8dce0` | `var(--sm-color-border-decorative)` | admin.html (1) | 1 |
| `rgba(44,44,44,0.045)` | `color-mix(in srgb, var(--sm-color-text) 4.5%, transparent)` | admin.html (1) | 1 |
| `rgba(66,133,244,0.045)` | `color-mix(in srgb, var(--sm-color-mark-google) 4.5%, transparent)` | admin.html (1) | 1 |
| `rgba(66,133,244,0.18)` | `color-mix(in srgb, var(--sm-color-mark-google) 18%, transparent)` | admin.html (1) | 1 |
| `rgba(74,124,89,0.12)` | `color-mix(in srgb, var(--sm-color-success) 12%, transparent)` | admin.html (1) | 1 |
| `rgba(139,115,85,0.28)` | `color-mix(in srgb, var(--sm-color-text-accent) 28%, transparent)` | admin.html (1) | 1 |
| `rgba(255,255,255,0.98)` | `color-mix(in srgb, var(--sm-color-bg-surface) 98%, transparent)` | admin.html (1) | 1 |
| `#a58b67` | `var(--sm-color-rule-accent-inverse)` | admin.html (1) | 1 |
| `rgba(255,255,255,0.52)` | `var(--sm-color-text-inverse-muted)` | admin.html (1) | 1 |
| `rgba(255,255,255,0.65)` | `var(--sm-color-text-inverse-muted)` | admin.html (1) | 1 |
| `#c9b393` | `var(--sm-color-text-accent-inverse)` | admin.html (1) | 1 |
| `#d7c3a7` | `var(--sm-color-text-inverse-muted)` | admin.html (1) | 1 |
| `rgba(255,255,255,0.35)` | `color-mix(in srgb, var(--sm-color-bg-surface) 35%, transparent)` | admin.html (1) | 1 |
| `rgba(255,255,255,0.45)` | `color-mix(in srgb, var(--sm-color-bg-surface) 45%, transparent)` | admin.html (1) | 1 |
| `rgba(196,174,143,0.035)` | `color-mix(in srgb, var(--sm-color-text-accent-inverse) 3.5%, transparent)` | admin.html (1) | 1 |
| `rgba(196,174,143,0.055)` | `color-mix(in srgb, var(--sm-color-text-accent-inverse) 5.5%, transparent)` | admin.html (1) | 1 |
| `rgba(196,174,143,0.28)` | `color-mix(in srgb, var(--sm-color-text-accent-inverse) 28%, transparent)` | admin.html (1) | 1 |
| `#171716` | `var(--sm-color-bg-inverse)` | admin.html (1) | 1 |
| `#242321` | `var(--sm-color-bg-inverse)` | admin.html (1) | 1 |
| `#35322f` | `var(--sm-color-bg-inverse)` | admin.html (1) | 1 |
| `rgba(44,44,44,0.08)` | `color-mix(in srgb, var(--sm-color-text) 8%, transparent)` | admin.html (1) | 1 |
| `rgba(44,44,44,0.14)` | `color-mix(in srgb, var(--sm-color-text) 14%, transparent)` | admin.html (1) | 1 |
| `rgba(107,88,64,0.16)` | `color-mix(in srgb, var(--sm-color-text-accent-strong) 16%, transparent)` | admin.html (1) | 1 |
| `rgba(44,44,44,0.1)` | `color-mix(in srgb, var(--sm-color-text) 10%, transparent)` | admin.html (1) | 1 |
| `rgba(139,115,85,0.18)` | `color-mix(in srgb, var(--sm-color-text-accent) 18%, transparent)` | admin.html (1) | 1 |
| `rgba(201,162,39,0.1)` | `color-mix(in srgb, var(--sm-color-text-accent-inverse) 10%, transparent)` | care-guide.html (1) | 1 |
| `#2196f3` | `var(--sm-color-text-accent)` | care-guide.html (1) | 1 |
| `#e3f2fd` | `var(--sm-color-bg-panel-quiet)` | care-guide.html (1) | 1 |
| `#bf360c` | `var(--sm-color-error)` | care-guide.html (1) | 1 |
| `#fff3e0` | `var(--sm-color-warning-surface)` | care-guide.html (1) | 1 |
| `#ff9800` | `var(--sm-color-warning)` | care-guide.html (1) | 1 |
| `#fff8e1` | `var(--sm-color-warning-surface)` | care-guide.html (1) | 1 |
| `#e8f5e9` | `var(--sm-color-success-surface)` | care-guide.html (1) | 1 |
| `#e0e0e0` | `var(--sm-color-material-white-shade)` | care-guide.html (1) | 1 |
| `#f5f5f5` | `var(--sm-color-material-white)` | care-guide.html (1) | 1 |
| `#a0522d` | `var(--sm-color-material-red-light)` | care-guide.html (1) | 1 |
| `#8b4513` | `var(--sm-color-material-red)` | care-guide.html (1) | 1 |
| `#aaaaaa` | `var(--sm-color-material-grey-light)` | care-guide.html (1) | 1 |
| `#888888` | `var(--sm-color-material-grey)` | care-guide.html (1) | 1 |
| `#333333` | `var(--sm-color-material-black-mid)` | care-guide.html (1) | 1 |
| `rgba(139,115,85,0.04)` | `color-mix(in srgb, var(--sm-color-text-accent) 4%, transparent)` | care-guide.html (1) | 1 |
| `rgba(255,255,255,0.12)` | `color-mix(in srgb, var(--sm-color-bg-surface) 12%, transparent)` | care-guide.html (1) | 1 |
| `rgba(255,255,255,0.55)` | `var(--sm-color-text-inverse-muted)` | care-guide.html (1) | 1 |
| `rgba(0,0,0,0.03)` | `color-mix(in srgb, var(--sm-color-text) 3%, transparent)` | care-guide.html (1) | 1 |
| `rgba(74,124,89,0.1)` | `color-mix(in srgb, var(--sm-color-success) 10%, transparent)` | contact.html (1) | 1 |
| `rgba(139,115,85,0.03)` | `color-mix(in srgb, var(--sm-color-text-accent) 3%, transparent)` | contact.html (1) | 1 |
| `rgba(0,0,0,0.02)` | `color-mix(in srgb, var(--sm-color-text) 2%, transparent)` | contact.html (1) | 1 |
| `rgba(74,124,89,0.2)` | `color-mix(in srgb, var(--sm-color-success) 20%, transparent)` | contact.html (1) | 1 |
| `#7a5a00` | `var(--sm-color-warning)` | contact.html (1) | 1 |
| `#f0d58a` | `var(--sm-color-warning)` | contact.html (1) | 1 |
| `#fff8e6` | `var(--sm-color-warning-surface)` | contact.html (1) | 1 |
| `rgba(255,255,255,0.92)` | `color-mix(in srgb, var(--sm-color-bg-surface) 92%, transparent)` | index.html (1) | 1 |
| `rgba(255,255,255,0.25)` | `var(--sm-color-text-inverse-muted)` | index.html (1) | 1 |
| `rgba(255,255,255,0.5)` | `var(--sm-color-text-inverse-muted)` | index.html (1) | 1 |
| `#f5f2ed` | `var(--sm-color-bg)` | index.html (1) | 1 |
| `#f9f7f4` | `var(--sm-color-bg)` | index.html (1) | 1 |
| `rgba(255,255,255,0.05)` | `color-mix(in srgb, var(--sm-color-bg-surface) 5%, transparent)` | index.html (1) | 1 |
| `rgba(255,255,255,0.08)` | `color-mix(in srgb, var(--sm-color-bg-surface) 8%, transparent)` | index.html (1) | 1 |
| `rgba(255,255,255,0.9)` | `var(--sm-color-text-inverse)` | index.html (1) | 1 |
| `#d8d2c8` | `var(--sm-color-bg-panel)` | index.html (1) | 1 |
| `#efeae2` | `var(--sm-color-bg-panel-quiet)` | index.html (1) | 1 |
| `rgba(60,50,40,0.12)` | `color-mix(in srgb, var(--sm-color-text) 12%, transparent)` | index.html (1) | 1 |
| `rgba(0,0,0,0.65)` | `color-mix(in srgb, var(--sm-color-text) 65%, transparent)` | memorial.html (1) | 1 |
| `#1c1915` | `var(--sm-color-border-strong)` | memorial.html (1) | 1 |
| `#4ade80` | `var(--sm-color-success)` | memorial.html (1) | 1 |
| `rgba(0,0,0,0.6)` | `color-mix(in srgb, var(--sm-color-text) 60%, transparent)` | memorial.html (1) | 1 |
| `#2d2d2d` | `var(--sm-color-material-char-light)` | memorial.html (1) | 1 |
| `#252525` | `var(--sm-color-material-char)` | memorial.html (1) | 1 |
| `#d4af37` | `var(--sm-color-material-gold-light)` | memorial.html (1) | 1 |
| `#c8c8c8` | `var(--sm-color-material-grey-pale)` | memorial.html (1) | 1 |
| `#909090` | `var(--sm-color-material-grey-silver)` | memorial.html (1) | 1 |
| `#5a9b67` | `var(--sm-color-material-green-light)` | memorial.html (1) | 1 |
| `#d4a843` | `var(--sm-color-material-gold-mid)` | memorial.html (1) | 1 |
| `#5a7ab0` | `var(--sm-color-material-blue-light)` | memorial.html (1) | 1 |
| `#8b4d6f` | `var(--sm-color-material-purple-light)` | memorial.html (1) | 1 |
| `#3b6347` | `var(--sm-color-success)` | site-upgrades.css (1) | 1 |
| `rgba(26,26,26,0.72)` | `color-mix(in srgb, var(--sm-color-text) 72%, transparent)` | site-upgrades.css (1) | 1 |
| `#c9a96e` | `var(--sm-color-focus)` | site-upgrades.css (1) | 1 |
| `rgba(26,26,26,0.18)` | `color-mix(in srgb, var(--sm-color-text) 18%, transparent)` | site-upgrades.css (1) | 1 |
| `rgba(250,248,245,0.18)` | `color-mix(in srgb, var(--sm-color-bg) 18%, transparent)` | site-upgrades.css (1) | 1 |
| `rgba(227,211,180,0.4)` | `color-mix(in srgb, var(--sm-color-bg-panel) 40%, transparent)` | site-upgrades.css (1) | 1 |
| `#7a6449` | `var(--sm-color-border-control)` | site-upgrades.css (1) | 1 |
| `rgba(0,0,0,0.25)` | `color-mix(in srgb, var(--sm-color-text) 25%, transparent)` | site-upgrades.css (1) | 1 |
| `rgba(255,255,255,0.7)` | `color-mix(in srgb, var(--sm-color-bg-surface) 70%, transparent)` | site-upgrades.css (1) | 1 |
| `#c9c2b6` | `var(--sm-color-bg-panel)` | site-upgrades.css (1) | 1 |
| `#6b5200` | `var(--sm-color-warning)` | site-upgrades.css (1) | 1 |
| `#d4af37` | `var(--sm-color-text-accent-on-panel)` | site-upgrades.css (1) | 1 |
| `#e0dcd5` | `var(--sm-color-bg-panel)` | site-upgrades.css (1) | 1 |
| `rgba(139,115,85,0.2)` | `color-mix(in srgb, var(--sm-color-text-accent) 20%, transparent)` | track.html (1) | 1 |
| `#666666` | `var(--sm-color-text-muted)` | track.html (1) | 1 |

Total rows: 186. Total replacements: 952.

## Contrast fixes in the same stage

These were colour-only. Element sizes did not change.

1. Home timeline numbers sat in deeper bronze on ink (2.04:1). They are now soft bronze on ink (5.13:1). The circle edge uses the same soft bronze.
2. The shortlist toast link was deeper bronze on ink. It is now soft bronze.
3. The showroom banner divider was sand at 40% opacity (1.24:1). It is now solid ink muted.
