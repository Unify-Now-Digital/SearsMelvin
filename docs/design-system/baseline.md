# Design system baseline

This file records the first visual and tracking baseline for searsmelvin.co.uk.
The pages, CSS, and JavaScript of the site are unchanged.
The check date is 8 November 2026.
The host is https://searsmelvin.co.uk.

## Pages

The capture uses these 8 pages.

1. Home. Path `/`. File slug `home`.
2. Memorials list. Path `/memorials`. File slug `memorials`.
3. The Castell. Path `/memorials/the-castell`. This is a lawn headstone.
4. The Hartwell. Path `/memorials/the-hartwell`. This is a kerb set.
5. The Petworth Heart. Path `/memorials/the-petworth-heart`. This is a heart memorial.
6. Quote page. Path `/quote`.
7. Contact and showroom. Path `/contact`.
8. About. Path `/about`. This is the content page.

The tracking test also opens `/brochure`.
That page is not one of the 8 screenshots.
It is there so the brochure hooks can be checked.

## Screenshot files

The reference PNG files are in `tests/visual/baseline/`.
Each width has its own folder.

1. `1280/` uses a viewport of 1280 by 800.
2. `744/` uses a viewport of 744 by 1024.
3. `375/` uses a viewport of 375 by 812.

Each file is a full-page PNG.
The tool is Playwright 1.56.1 with Chromium.
`optipng -o1` shrinks each file without changing a pixel.
The compare reads those pixels. It does not use a lossy quantiser.

The capture does these things before it takes the shot.

1. It sets `cookieConsent` to `accepted`, so the cookie bar stays hidden.
2. It blocks the chat widget and analytics hosts, so those layers do not cover the page.
3. It scrolls the full page, so lazy images start to load.
4. It scrolls back to the top.
5. It waits until every image with a src has loaded (`complete` and `naturalWidth > 0`).
6. It waits for `document.fonts.ready`.
7. It waits for the network to go idle.
8. It turns animations and transitions off, and it hides the caret.
9. It freezes the installations carousel at `translate3d(0,0,0)`.

Masks: none.
The carousel is frozen. It is not masked.
The family quotes are static text. They are not masked.
No Cloudflare beacon and no live review widget is painted on these pages.

Compare two capture folders with `node tests/visual/compare.mjs <actual-dir> [expected-dir]`.
The default threshold is 0.1.
The default `maxDiffPixels` is 0.
Do not raise either value to hide a change.

## Run the screenshots again

1. Open a terminal at the repo root.
2. Run `npm --prefix tests/visual install`.
3. Run `npx --prefix tests/visual playwright install chromium`.
4. Install `optipng` if you want smaller PNG files. The pixels stay the same.
5. Run `npm --prefix tests/visual run baseline`.
6. The script reads `BASE_URL`. The default is `https://searsmelvin.co.uk`.
7. The script writes the PNG files to `tests/visual/baseline/`.

Use a preview host without replacing the reference files.

1. Set `BASE_URL` to the preview URL.
2. Set `VISUAL_OUT` to `tests/visual/preview`.
3. Run `npm --prefix tests/visual run baseline`.
4. Read the new PNG files from `tests/visual/preview/`.
5. Leave `tests/visual/baseline/` as the reference set.

## Run the tracking test again

1. Open a terminal at the repo root.
2. Run `npm --prefix tests/visual install` if you have not installed Playwright.
3. Run `npx --prefix tests/visual playwright install chromium` if Chromium is missing.
4. Run `npm --prefix tests/visual run tracking`.
5. Set `BASE_URL` when you want to check a preview host.

The test does not submit the quote form.
The test aborts requests to `/api/submit`, `/api/brochure`, `/api/quotes`, `/api/click-intent`, and `/api/upload-photo`.
On 8 November 2026 the live run sent none of those requests.

This test is not part of `.github/workflows/tests.yml`.
That workflow runs `tests/*.mjs` only.
Run this check by hand.

## Tracking results

The command exits with an error while any check below is a fail.
The three fails are gaps on the live site.
This PR does not change the site to close them.

1. GTM-KRDX4BQ5 loads. Pass. `gtm.js?id=GTM-KRDX4BQ5` returned HTTP 200 on the 8 pages and on `/brochure`.
2. GA4 G-RF3LYJMFVE is configured. Pass. The home page configured that measurement id after cookie consent was accepted.
3. Click-to-call value is 150. Pass. Live GTM v26 sends 150 for the Ads click-to-call tag and 150 GBP for the GA4 `click_to_call` event. The test did not click a tel link.
4. `view_item_list` on `/memorials`. Fail. The product grid rendered. `dataLayer` did not receive `view_item_list`. The events seen were `gtm.js`, `consent_update`, `gtm.dom`, and `gtm.load`.
5. `select_item` on a product card click. Fail. The test clicked a visible product card and blocked navigation. `dataLayer` received `gtm.click` and `gtm.linkClick`. It did not receive `select_item`.
6. `filter_select` on a filter change. Fail. The test clicked the first memorial-type filter. `dataLayer` did not receive `filter_select`.
7. `shortlist-btn-` classes. Pass. `/memorials` has `.shortlist-btn-copy` and `.shortlist-btn-email`.
8. Tel links show `020 3835 2548` as unbroken text. Pass. Every `tel:` link on the checked pages uses `tel:+442038352548`. Each link has the full number in one text node. A span or paragraph around that node is still one text node.
9. `#quoteForm` and the brochure hooks exist. Pass. `#quoteForm` is on the three product pages. The home page and `/memorials` have `data-brochure-source`. `/brochure` has `data-brochure-link` and `data-brochure-email-form`.
10. `/memorials` has no form. Pass. The list has 0 `form` elements after the grid renders.

`view_item_list`, `select_item`, and `filter_select` are not in the page source.
They are not GTM tag ids.
See `docs/design-system/baseline-gtm-diff.md`.

## GTM drift

The GTM diff is in `docs/design-system/baseline-gtm-diff.md`.
Refresh it with `node scripts/gtm-baseline-diff.mjs`.
That script does not change GTM.
That script does not update `docs/gtm-snapshot.json`.

1. On 8 November 2026 Arin confirmed the click-to-call value.
2. The confirmed value is 150 GBP.
3. The snapshot in `docs/gtm-snapshot.json` now matches live v26.
4. The drift is resolved.
5. The Google Ads click-to-call tag uses 150.
6. The GA4 `click_to_call` event sends 150 GBP.
7. The Ads user-provided data tag listens for `sm_quote_submit`.
