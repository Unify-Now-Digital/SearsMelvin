/*
 * Public site configuration for marketing upgrades (brochure, Google reviews).
 * Loaded on public pages before site-upgrades.js. No secrets here.
 *
 * Every value below is deliberately empty until Arin supplies a real one.
 * Nothing is rendered for an empty value, so no invented numbers ever show.
 */
(function () {
    window.SM_SITE_CONFIG = {
        // TODO(Arin): add the real brochure PDF to /assets/ (e.g. /assets/sears-melvin-brochure.pdf)
        // and set its path here. While null, /brochure shows a "being prepared" note
        // and offers a quote / consultation instead of a download.
        brochurePdfUrl: null,

        // TODO(Arin): set the real Google Business Profile figures and review link.
        // Stars + count stay hidden on the home page until rating AND count are set.
        googleReviews: {
            rating: null,      // e.g. 4.9 (number, 0–5)
            count: null,       // e.g. 37 (integer)
            url: null          // e.g. "https://g.page/r/.../review"
        }
    };
})();
