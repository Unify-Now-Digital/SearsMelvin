# Notes for agents

Read `BRAND.md` before any visual work.

`tokens.css` is the only file that may hold a raw colour value. Run `node scripts/check-tokens.mjs` when you change the look of a page. Public pages load `tokens.css` for colour. Do not link `components.css` from an existing page until a later stage says so. `/styleguide` is the reference. It is noindex, and it does not load Tag Manager.
