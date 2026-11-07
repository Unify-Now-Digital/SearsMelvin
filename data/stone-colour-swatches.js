/*
 * Stone colour swatch photos.
 *
 * A row's image_url is always used when it is a safe image URL. Production
 * rows are NULL until Arin applies sql/NOT-APPLIED-stone-colour-image-urls.sql,
 * so the live site keeps drawing the CSS gradient.
 *
 * The map below is a preview-only fallback for those NULL rows. It is consulted
 * only when image_url is missing AND the page host is an explicit preview or
 * local host. The host rule is the same fail-closed check as
 * site-upgrades.js isProductionHost: searsmelvin.co.uk, www, the apex
 * *.pages.dev production alias, and any other host do not receive these URLs.
 * There is no separate production build of this static site, so the host gate
 * is what keeps the fallback off production.
 *
 * Tests in tests/stone-colour-swatches.mjs pin that gate.
 */
(function (root) {
    var PRODUCTION_HOSTS = ['searsmelvin.co.uk', 'www.searsmelvin.co.uk'];

    // id + slug must both match a live stone_colours row. URLs are the public
    // WebP objects already in product-images/stone-colours/.
    var PREVIEW_SWATCHES = [
        { id: 'd00e0d6c-ec8a-4008-b392-a176b02e9d1c', slug: 'black', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black.webp' },
        { id: '1ea47443-9e4a-460b-84fe-6676338842ca', slug: 'balmoral-red', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/balmoral-red.webp' },
        { id: '98cafdfe-09a9-40c2-a2fc-a030cebcc646', slug: 'blue-pearl', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/blue-pearl.webp' },
        { id: 'c513bbe2-d6b5-4f00-bdd8-9726610f2748', slug: 'tropical-green', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/tropical-green.webp' },
        { id: 'f16d547d-9315-44b0-998b-6e29c9cfaf41', slug: 'paradiso', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/paradiso.webp' },
        { id: '0b55588e-9bab-4980-96a5-01021f8f296e', slug: 'ruby-red', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/ruby-red.webp' },
        { id: '5cf29e51-4364-4198-92ec-761cb1d9eb95', slug: 'sa-dark-grey', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/sa-dark-grey.webp' },
        { id: 'dba07948-49f8-4cdd-8563-e5b7c2110c8c', slug: 'karin-grey', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/karin-grey.webp' },
        { id: '1a54c259-accf-4495-b0d9-96f2fe6332f0', slug: 'black-galaxy', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/black-galaxy.webp' },
        { id: '01ad78e3-9701-4017-a5b6-877576c86fae', slug: 'yorkstone', url: 'https://bfwohzcugtwbhhxdqgme.supabase.co/storage/v1/object/public/product-images/stone-colours/yorkstone.webp' }
    ];

    function isProductionHost(host) {
        // Fail safe: only explicit preview/local hosts count as non-production,
        // so trailing-dot FQDNs, searsmelvin.pages.dev or any new domain hide placeholders.
        var h = String(host || '').toLowerCase().replace(/\.$/, '');
        if (PRODUCTION_HOSTS.indexOf(h) !== -1) return true;
        var preview = h === 'localhost' || h === '127.0.0.1' || /^[a-z0-9-]+\.searsmelvin\.pages\.dev$/.test(h) || /\.workers\.dev$/.test(h);
        return !preview;
    }

    function safeSwatchUrl(value) {
        if (typeof value !== 'string' || value.length > 2048) return '';
        if (value.startsWith('/') && !value.startsWith('//')) return value;
        try {
            var url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
        } catch (e) {
            return '';
        }
    }

    function previewSwatchUrl(colour) {
        if (!colour || typeof colour.id !== 'string' || typeof colour.slug !== 'string') return '';
        for (var i = 0; i < PREVIEW_SWATCHES.length; i++) {
            var row = PREVIEW_SWATCHES[i];
            if (row.id === colour.id && row.slug === colour.slug) return safeSwatchUrl(row.url);
        }
        return '';
    }

    // Real image_url wins on every host. The preview map fills a gap only
    // while image_url is empty and only off production.
    function stoneColourImageUrl(colour, host) {
        var fromRow = safeSwatchUrl(colour && colour.image_url);
        if (fromRow) return fromRow;
        if (isProductionHost(host)) return '';
        return previewSwatchUrl(colour);
    }

    var api = {
        isProductionHost: isProductionHost,
        stoneColourImageUrl: stoneColourImageUrl,
        previewSwatchCount: PREVIEW_SWATCHES.length
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.stoneColourImageUrl = stoneColourImageUrl;
})(typeof globalThis !== 'undefined' ? globalThis : this);
