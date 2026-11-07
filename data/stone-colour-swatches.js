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

    function stoneColourImageUrl(colour) {
        return safeSwatchUrl(colour && colour.image_url);
    }

    var api = { stoneColourImageUrl: stoneColourImageUrl };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.stoneColourImageUrl = stoneColourImageUrl;
})(typeof globalThis !== 'undefined' ? globalThis : this);
