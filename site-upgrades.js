/*
 * Small progressive enhancements shared by public pages:
 *  - Google review stars/count on elements with [data-sm-reviews] (hidden until configured)
 *  - Brochure: /brochure download + "email me a copy" ([data-sm-brochure]), direct
 *    download buttons elsewhere ([data-brochure-source]), cover thumbnail +
 *    "<N> pages · <X> MB" meta, and `brochure_download` tracking (GTM dataLayer,
 *    optional Google Ads conversion, first-party log via /api/brochure)
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
        // Fail safe: only explicit preview/local hosts count as non-production,
        // so trailing-dot FQDNs, searsmelvin.pages.dev or any new domain hide placeholders.
        var h = String(host || '').toLowerCase().replace(/\.$/, '');
        if (PRODUCTION_HOSTS.indexOf(h) !== -1) return true;
        var preview = h === 'localhost' || h === '127.0.0.1' || /^[a-z0-9-]+\.searsmelvin\.pages\.dev$/.test(h) || /\.workers\.dev$/.test(h);
        return !preview;
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


    // ---- Brochure ---------------------------------------------------------
    var BROCHURE_SOURCES = ['header', 'home', 'product', 'listing', 'brochure_page'];
    var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    // Google Ads click IDs, captured alongside UTMs for offline conversion import.
    // Tracking contract: docs/TRACKING.md (click-ID capture, 90 days, first touch).
    var CLICK_KEYS = ['gclid', 'gbraid', 'wbraid'];
    var ATTR_KEYS = CLICK_KEYS.concat(UTM_KEYS);
    var ATTR_STORE = 'sm_attr';
    var ATTR_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days, matches Google Ads click window

    function normaliseSource(s) {
        s = String(s || '').toLowerCase();
        return BROCHURE_SOURCES.indexOf(s) !== -1 ? s : 'brochure_page';
    }

    function brochureMetaLabel(pages, bytes) {
        if (!(Number.isInteger(pages) && pages > 0 && typeof bytes === 'number' && bytes > 0)) return '';
        var mb = bytes / (1024 * 1024);
        return pages + ' page' + (pages === 1 ? '' : 's') + ' · ' + (mb < 0.1 ? '0.1' : mb.toFixed(1)) + ' MB';
    }

    function readUtm(search) {
        var out = {};
        var q = String(search || '').replace(/^\?/, '');
        if (!q) return out;
        q.split('&').forEach(function (pair) {
            var i = pair.indexOf('='); if (i < 1) return;
            var k = decodeURIComponent(pair.slice(0, i)).toLowerCase();
            if (UTM_KEYS.indexOf(k) === -1) return;
            var v; try { v = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')); } catch (_e) { return; }
            v = v.trim().slice(0, 100);
            if (v) out[k] = v;
        });
        return out;
    }

    // Click IDs + UTMs from a query string. Click IDs are opaque tokens, so
    // only a safe charset is kept (max 200 chars).
    function readAttribution(search) {
        var out = {};
        var q = String(search || '').replace(/^\?/, '');
        if (!q) return out;
        q.split('&').forEach(function (pair) {
            var i = pair.indexOf('='); if (i < 1) return;
            var k; try { k = decodeURIComponent(pair.slice(0, i)).toLowerCase(); } catch (_e) { return; }
            if (ATTR_KEYS.indexOf(k) === -1) return;
            var v; try { v = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')); } catch (_e) { return; }
            v = v.trim();
            if (CLICK_KEYS.indexOf(k) !== -1) { v = v.slice(0, 200); if (!/^[\w\-.~]+$/.test(v)) return; }
            else v = v.slice(0, 100);
            if (v) out[k] = v;
        });
        return out;
    }

    // Merge fresh params into the stored record. First touch wins for 90 days:
    // a later visit with only UTMs (or nothing) keeps the stored record. A new
    // ad click (any click ID) replaces it wholesale and restarts the 90 days.
    // Expired records drop.
    function mergeAttribution(stored, fresh, now) {
        var valid = stored && typeof stored === 'object' && typeof stored.ts === 'number' && (now - stored.ts) < ATTR_TTL_MS;
        var hasClick = CLICK_KEYS.some(function (k) { return !!fresh[k]; });
        if (valid && !hasClick) return stored;
        if (!Object.keys(fresh).length) return null;
        var rec = { ts: now };
        ATTR_KEYS.forEach(function (k) { if (fresh[k]) rec[k] = fresh[k]; });
        return rec;
    }

    function attributionFields(rec) {
        var out = {};
        if (!rec) return out;
        ATTR_KEYS.forEach(function (k) { if (typeof rec[k] === 'string' && rec[k]) out[k] = rec[k]; });
        return out;
    }

    function adsConversionTarget(ads) {
        if (!ads) return null;
        var id = ads.conversionId, label = ads.brochureConversionLabel;
        if (typeof id !== 'string' || !/^AW-\d{6,}$/.test(id)) return null;
        if (typeof label !== 'string' || !/^[\w-]{4,}$/.test(label)) return null;
        return id + '/' + label;
    }

    // Everything one download sends. Pure so tests can pin it.
    // Tracking contract: docs/TRACKING.md (brochure_download, attribution).
    function brochureEvents(cfg, source, emailGiven) {
        var src = normaliseSource(source);
        var events = [{ event: 'brochure_download', source: src, email_given: !!emailGiven }];
        var target = adsConversionTarget(cfg && cfg.googleAds);
        return { source: src, dataLayer: events, adsSendTo: target };
    }

    function brochureMetaHtml(cfg) {
        var thumb = safeHttpUrl(cfg.brochureThumbUrl);
        var label = brochureMetaLabel(cfg.brochurePages, cfg.brochureBytes);
        return (thumb ? '<img class="sm-brochure-thumb" src="' + esc(thumb) + '" alt="Sears Melvin brochure cover" width="72" height="102" loading="lazy">' : '') +
            (label ? '<span class="sm-brochure-meta">PDF · ' + esc(label) + '</span>' : '');
    }


    // Floating "Brochure" button: shown on every public page except /brochure itself.
    function fabAllowed(path) {
        var p = String(path || '/').toLowerCase().replace(/\/+$/, '').replace(/\.html$/, '');
        return p !== '/brochure' && p.indexOf('/admin') !== 0;
    }
    function fabHtml() {
        return '<a class="sm-brochure-fab" href="/brochure" aria-label="View our brochure">' +
            '<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="18" height="18"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>' +
            '<span>Brochure</span></a>';
    }

    var api = { fabAllowed: fabAllowed, fabHtml: fabHtml, normaliseSource: normaliseSource, brochureMetaLabel: brochureMetaLabel, readUtm: readUtm, adsConversionTarget: adsConversionTarget, brochureEvents: brochureEvents, brochureMetaHtml: brochureMetaHtml, readAttribution: readAttribution, mergeAttribution: mergeAttribution, attributionFields: attributionFields, ATTR_TTL_MS: ATTR_TTL_MS, esc: esc, isProductionHost: isProductionHost, reviewsConfigured: reviewsConfigured, reviewsHtml: reviewsHtml, visibleTeam: visibleTeam, teamHtml: teamHtml, safeHttpUrl: safeHttpUrl };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof document === 'undefined') return;
    root.SMUpgrades = api;

    // Capture on every page load so the landing page records the click,
    // then persist for 90 days (localStorage) for later form submits.
    function storedAttribution() {
        var stored = null;
        try { stored = JSON.parse(localStorage.getItem(ATTR_STORE) || 'null'); } catch (_e) {}
        var rec = mergeAttribution(stored, readAttribution(location.search), Date.now());
        try {
            if (rec) localStorage.setItem(ATTR_STORE, JSON.stringify(rec));
            else localStorage.removeItem(ATTR_STORE);
        } catch (_e) {}
        return attributionFields(rec);
    }
    storedAttribution();
    api.getAttribution = storedAttribution;


    function sessionUtm() {
        var fresh = readUtm(location.search), stored = {};
        try { stored = JSON.parse(sessionStorage.getItem('sm_utm') || '{}') || {}; } catch (_e) {}
        if (Object.keys(fresh).length) { stored = fresh; try { sessionStorage.setItem('sm_utm', JSON.stringify(fresh)); } catch (_e) {} }
        return stored;
    }

    function logBrochure(body) {
        var json = JSON.stringify(body);
        try {
            if (navigator.sendBeacon && navigator.sendBeacon('/api/brochure', new Blob([json], { type: 'application/json' }))) return;
        } catch (_e) {}
        try { fetch('/api/brochure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json, keepalive: true }); } catch (_e) {}
    }

    // Fire analytics for one download. `logged` = the server already recorded it
    // (the email path logs on the server, so no beacon then).
    function trackBrochureDownload(cfg, source, emailGiven, logged) {
        var ev = brochureEvents(cfg, source, emailGiven);
        root.dataLayer = root.dataLayer || [];
        ev.dataLayer.forEach(function (e) { root.dataLayer.push(e); });
        if (ev.adsSendTo) {
            // gtag() is defined inline on every page (consent mode); GTM forwards it.
            if (typeof root.gtag === 'function') root.gtag('event', 'conversion', { send_to: ev.adsSendTo });
            else root.dataLayer.push(['event', 'conversion', { send_to: ev.adsSendTo }]);
        }
        if (!logged) logBrochure({ action: 'download', source: ev.source, utm: sessionUtm(), email_given: !!emailGiven, page: location.pathname });
    }

    function initBrochure(cfg) {
        var url = safeHttpUrl(cfg.brochurePdfUrl);
        sessionUtm();
        // Header nav links keep going to /brochure but tell it where the click came from.
        document.querySelectorAll('a.nav-brochure, .mobile-nav a[href="/brochure"]').forEach(function (a) {
            a.setAttribute('href', '/brochure?from=header');
        });
        if (!url) return;
        // Home / product / listing buttons become direct downloads with cover + size.
        document.querySelectorAll('a[data-brochure-source]').forEach(function (a) {
            var src = normaliseSource(a.getAttribute('data-brochure-source'));
            a.setAttribute('href', url);
            a.setAttribute('download', '');
            a.classList.add('sm-brochure-dl');
            a.insertAdjacentHTML('afterbegin', brochureMetaHtml(cfg).replace(/<span class="sm-brochure-meta">[^<]*<\/span>/, ''));
            var label = brochureMetaLabel(cfg.brochurePages, cfg.brochureBytes);
            if (label) a.insertAdjacentHTML('beforeend', ' <span class="sm-brochure-meta">PDF · ' + esc(label) + '</span>');
            a.addEventListener('click', function () { trackBrochureDownload(cfg, src, false, false); });
        });
        document.querySelectorAll('[data-sm-brochure]').forEach(function (el) {
            var ready = el.querySelector('[data-brochure-ready]');
            var pending = el.querySelector('[data-brochure-pending]');
            if (!ready) return;
            var from = (location.search.match(/[?&]from=([a-z_]+)/) || [])[1];
            var src = from ? normaliseSource(from) : 'brochure_page';
            var meta = ready.querySelector('[data-brochure-meta]');
            // Static cover/meta in the HTML reserves layout; only fill if absent.
            if (meta && !meta.querySelector('img')) meta.innerHTML = brochureMetaHtml(cfg);
            ready.querySelectorAll('a[data-brochure-link]').forEach(function (a) {
                a.setAttribute('href', url);
                a.addEventListener('click', function () { trackBrochureDownload(cfg, src, false, false); });
            });
            var form = ready.querySelector('form[data-brochure-email-form]');
            if (form) form.addEventListener('submit', function (e) {
                e.preventDefault();
                var input = form.querySelector('input[type="email"]');
                var status = form.querySelector('[data-brochure-email-status]');
                var btn = form.querySelector('button[type="submit"]');
                var email = (input && input.value || '').trim();
                if (!email || (input.checkValidity && !input.checkValidity())) { if (status) status.textContent = 'Please enter a valid email address, or just download it below.'; return; }
                if (btn) btn.disabled = true;
                if (status) status.textContent = 'Sending…';
                fetch('/api/brochure', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'email', email: email, source: src, utm: sessionUtm(), attribution: storedAttribution(), page: location.pathname }) })
                    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok && b.ok, b: b }; }); })
                    .then(function (res) {
                        if (res.ok) {
                            trackBrochureDownload(cfg, src, true, true);
                            if (status) status.textContent = 'Thank you — we’ve emailed the brochure to ' + email + '. You can also download it now.';
                            form.reset();
                        } else if (status) status.textContent = (res.b && res.b.error) || 'Sorry, we couldn’t send that just now. Please use “Just download”.';
                    })
                    .catch(function () { if (status) status.textContent = 'Sorry, we couldn’t send that just now. Please use “Just download”.'; })
                    .then(function () { if (btn) btn.disabled = false; });
            });
            ready.hidden = false;
            if (pending) pending.hidden = true;
        });
    }

    function initFab() {
        if (!fabAllowed(location.pathname) || document.querySelector('.sm-brochure-fab')) return;
        var wrap = document.createElement('div');
        wrap.innerHTML = fabHtml();
        var a = wrap.firstChild;
        a.addEventListener('click', function () {
            (root.dataLayer = root.dataLayer || []).push({ event: 'brochure_fab_click', page_path: location.pathname });
        });
        document.body.appendChild(a);
    }

    function init() {
        var cfg = root.SM_SITE_CONFIG || {};
        document.querySelectorAll('[data-sm-reviews]').forEach(function (el) {
            var html = reviewsHtml(cfg.googleReviews);
            if (html) { el.innerHTML = html; el.hidden = false; } else { el.hidden = true; }
        });
        initBrochure(cfg);
        initFab();
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
