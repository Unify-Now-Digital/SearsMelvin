/*
 * Small progressive enhancements shared by public pages:
 *  - Google review stars/count on elements with [data-sm-reviews] (hidden until configured)
 *  - Brochure download link on /brochure ([data-sm-brochure])
 *  - Meet-the-team rendering on /about ([data-sm-team])
 * Pure helpers are exported on window.SMUpgrades and via module.exports for tests.
 */
(function (root) {
    var PRODUCTION_HOSTS = ['searsmelvin.co.uk', 'www.searsmelvin.co.uk'];

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function isProductionHost(host) {
        return PRODUCTION_HOSTS.indexOf(String(host || '').toLowerCase()) !== -1;
    }

    // Only a finite rating in 0..5 AND a positive integer count count as "set".
    function reviewsConfigured(r) {
        if (!r) return false;
        var rating = r.rating, count = r.count;
        return typeof rating === 'number' && isFinite(rating) && rating > 0 && rating <= 5 &&
            typeof count === 'number' && Number.isInteger(count) && count > 0;
    }

    function safeHttpUrl(u) {
        if (typeof u !== 'string') return null;
        if (/^\/(?!\/)/.test(u)) return u;
        return /^https:\/\//i.test(u) ? u : null;
    }

    function visibleTeam(team, host) {
        if (!Array.isArray(team)) return [];
        var prod = isProductionHost(host);
        return team.filter(function (m) {
            return m && m.name && (!m.placeholder || !prod);
        });
    }

    var STAR = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

    function reviewsHtml(r) {
        if (!reviewsConfigured(r)) return '';
        var full = Math.round(r.rating);
        var stars = '';
        for (var i = 0; i < 5; i++) stars += '<span class="sm-star' + (i < full ? ' on' : '') + '">' + STAR + '</span>';
        var label = r.rating.toFixed(1) + ' on Google · ' + r.count + ' review' + (r.count === 1 ? '' : 's');
        var url = safeHttpUrl(r.url);
        var inner = '<span class="sm-stars" aria-hidden="true">' + stars + '</span><span class="sm-reviews-label">' + esc(label) + '</span>';
        return url
            ? '<a class="sm-reviews" href="' + esc(url) + '" target="_blank" rel="noopener" aria-label="' + esc(label) + '">' + inner + '</a>'
            : '<span class="sm-reviews" aria-label="' + esc(label) + '">' + inner + '</span>';
    }

    function teamHtml(members) {
        return members.map(function (m) {
            var photo = safeHttpUrl(m.photo);
            var img = photo
                ? '<img src="' + esc(photo) + '" alt="' + esc(m.name) + '" loading="lazy">'
                : '<div class="sm-team-photo-empty" aria-hidden="true"></div>';
            return '<div class="sm-team-card' + (m.placeholder ? ' is-placeholder' : '') + '">' +
                (m.placeholder ? '<span class="sm-placeholder-badge">PLACEHOLDER</span>' : '') +
                '<div class="sm-team-photo">' + img + '</div>' +
                '<h3>' + esc(m.name) + '</h3>' +
                '<p class="sm-team-role">' + esc(m.role) + '</p>' +
                '<p class="sm-team-line">' + esc(m.line) + '</p></div>';
        }).join('');
    }

    var api = { esc: esc, isProductionHost: isProductionHost, reviewsConfigured: reviewsConfigured, reviewsHtml: reviewsHtml, visibleTeam: visibleTeam, teamHtml: teamHtml, safeHttpUrl: safeHttpUrl };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document === 'undefined') return;
    root.SMUpgrades = api;

    function init() {
        var cfg = root.SM_SITE_CONFIG || {};
        document.querySelectorAll('[data-sm-reviews]').forEach(function (el) {
            var html = reviewsHtml(cfg.googleReviews);
            if (html) { el.innerHTML = html; el.hidden = false; } else { el.hidden = true; }
        });
        document.querySelectorAll('[data-sm-brochure]').forEach(function (el) {
            var url = safeHttpUrl(cfg.brochurePdfUrl);
            var ready = el.querySelector('[data-brochure-ready]');
            var pending = el.querySelector('[data-brochure-pending]');
            if (url && ready) {
                var a = ready.querySelector('a[data-brochure-link]');
                if (a) a.setAttribute('href', url);
                ready.hidden = false;
                if (pending) pending.hidden = true;
            }
        });
        document.querySelectorAll('[data-sm-team]').forEach(function (section) {
            var members = visibleTeam(root.SM_TEAM, location.hostname);
            var grid = section.querySelector('[data-sm-team-grid]');
            if (!members.length || !grid) { section.hidden = true; return; }
            grid.innerHTML = teamHtml(members);
            section.hidden = false;
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
