/*
 * Public site configuration for marketing upgrades (brochure, Google reviews).
 * Loaded on public pages before site-upgrades.js. No secrets here.
 *
 * Every value below is deliberately empty until Arin supplies a real one.
 * Nothing is rendered for an empty value, so no invented numbers ever show.
 */
(function () {
    window.SM_SITE_CONFIG = {
        // Brochure v5 (generated from the live SM catalogue, Oct 2026).
        // brochurePages / brochureBytes must match the real file: tests/brochure.mjs
        // checks them against assets/sears-melvin-brochure.pdf. After swapping the
        // PDF run `node scripts/brochure-meta.mjs` and copy the numbers here.
        brochurePdfUrl: '/assets/sears-melvin-brochure.pdf',
        brochureThumbUrl: '/assets/sears-melvin-brochure-cover.jpg',
        brochurePages: 21,
        brochureBytes: 2357623,

        // Google tracking. The site loads GTM (GTM-KRDX4BQ5) only; no GA4
        // measurement ID or Google Ads tag is present in this repo. Every
        // download pushes a `brochure_download` dataLayer event (param `source`)
        // that a GTM GA4 event tag can pick up.
        // TODO(Arin): if you want a direct Ads conversion, set the real values
        // from Google Ads → Goals → Conversions (e.g. 'AW-123456789' and 'AbC-dEfGhIj').
        // While either is null no conversion is fired. Never guess these.
        googleAds: {
            conversionId: null,
            brochureConversionLabel: null
        },

        // TODO(Arin): set the real Google Business Profile figures and review link.
        // Stars + count stay hidden on the home page until rating AND count are set.
        googleReviews: {
            rating: null,      // e.g. 4.9 (number, 0–5)
            count: null,       // e.g. 37 (integer)
            url: null          // e.g. "https://g.page/r/.../review"
        }
    };
})();
