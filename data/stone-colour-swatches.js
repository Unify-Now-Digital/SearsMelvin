/*
 * Stone colour swatch photo URL.
 *
 * Product pages use stone_colours.image_url when it is a safe image URL.
 * An empty or unsafe value returns "" so the swatch keeps its CSS gradient.
 * There is no preview-only map: the 19 live photos are stored on the rows.
 */
(function (root) {
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

    function renderedSwatchUrl(value) {
        var safe = safeSwatchUrl(value);
        if (!safe || safe.startsWith('/')) return safe;
        try {
            var url = new URL(safe);
            if (!url.hostname.endsWith('.supabase.co') || !url.pathname.startsWith('/storage/v1/object/public/')) return safe;
            url.pathname = url.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
            url.search = '?width=144&quality=70&resize=contain';
            return url.href;
        } catch (e) {
            return safe;
        }
    }

    function stoneColourImageUrl(colour) {
        return renderedSwatchUrl(colour && colour.image_url);
    }

    var api = { safeSwatchUrl: safeSwatchUrl, stoneColourImageUrl: stoneColourImageUrl };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.stoneColourImageUrl = stoneColourImageUrl;
})(typeof globalThis !== 'undefined' ? globalThis : this);
