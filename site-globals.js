(function () {
    var SHORTLIST_KEY = 'sm_shortlist';
    var MOBILE_BREAKPOINT = 768;

    function isMobile() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    function pickWidgetBottom() {
        if (document.body.classList.contains('has-mobile-bottom-bar') && isMobile()) {
            return 160;
        }
        var consent = document.getElementById('cookieConsent');
        var consentVisible = consent && getComputedStyle(consent).display !== 'none';
        if (consentVisible) return isMobile() ? 190 : 120;
        return isMobile() ? 100 : 24;
    }

    function isChatWidgetEl(el) {
        if (!el || el.nodeType !== 1) return false;
        var id = (el.id || '').toLowerCase();
        var cls = (el.className && el.className.toString ? el.className.toString() : '').toLowerCase();
        var tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'lc-chat-widget') return true;
        if (id.indexOf('lc_') === 0 || id.indexOf('lc-') === 0) return true;
        if (cls.indexOf('lc-') === 0 || cls.indexOf('lc_') === 0) return true;
        if (cls.indexOf('leadconnector') !== -1) return true;
        if (el.getAttribute && el.getAttribute('data-widget-id') === '69f5bdefa4b26c5126799210') return true;
        if (tag === 'iframe') {
            var src = (el.getAttribute('src') || '').toLowerCase();
            var title = (el.getAttribute('title') || '').toLowerCase();
            if (src.indexOf('leadconnector') !== -1 || src.indexOf('msgsndr') !== -1) return true;
            if (title.indexOf('chat') !== -1) return true;
        }
        return false;
    }

    function applyWidgetPosition() {
        var bottom = pickWidgetBottom();
        var nodes = document.body ? document.body.children : [];
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (isChatWidgetEl(el)) {
                el.style.setProperty('bottom', bottom + 'px', 'important');
                el.style.setProperty('right', '24px', 'important');
            }
        }
        var deeper = document.querySelectorAll('iframe[src*="leadconnector"], iframe[src*="msgsndr"], iframe[title*="hat"], lc-chat-widget, [data-widget-id="69f5bdefa4b26c5126799210"]');
        for (var j = 0; j < deeper.length; j++) {
            deeper[j].style.setProperty('bottom', bottom + 'px', 'important');
            deeper[j].style.setProperty('right', '24px', 'important');
        }
        // Heuristic fallback: any small fixed element pinned to the bottom-right
        // corner is almost certainly the chat bubble (regardless of class/tag).
        var direct = document.body ? document.body.children : [];
        for (var k = 0; k < direct.length; k++) {
            var node = direct[k];
            if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'LINK') continue;
            var cs;
            try { cs = getComputedStyle(node); } catch (_e) { continue; }
            if (cs.position !== 'fixed') continue;
            var b = parseInt(cs.bottom, 10);
            var r = parseInt(cs.right, 10);
            if (isNaN(b) || isNaN(r)) continue;
            if (b > 80 || r > 80) continue;
            var w = node.offsetWidth || 0;
            var h = node.offsetHeight || 0;
            if (w === 0 || h === 0) continue;
            if (w > 140 || h > 140) continue;
            // Don't touch our own injected favourites badge or known nav elements
            if (node.id === 'shortlistNavBtn') continue;
            if (node.classList && (node.classList.contains('mobile-bottom-nav') || node.classList.contains('floating-actions') || node.classList.contains('cookie-consent'))) continue;
            node.style.setProperty('bottom', bottom + 'px', 'important');
            node.style.setProperty('right', '24px', 'important');
        }
    }

    function watchChatWidget() {
        applyWidgetPosition();
        var observer = new MutationObserver(function () {
            applyWidgetPosition();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        window.addEventListener('resize', applyWidgetPosition);
        // Reapply periodically for the first 10s — GHL widget often sets inline
        // styles after our observer runs, so re-pin to win the last-write race.
        var ticks = 0;
        var poll = setInterval(function () {
            applyWidgetPosition();
            if (++ticks >= 20) clearInterval(poll);
        }, 500);
    }

    function readShortlist() {
        try {
            var raw = localStorage.getItem(SHORTLIST_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function ensureShortlistBadge() {
        if (document.getElementById('shortlistNavBtn')) return;
        if (document.querySelector('.shortlist-nav-btn')) return;

        var nav = document.querySelector('nav');
        if (!nav) return;
        var mobileMenuBtn = nav.querySelector('.mobile-menu-btn');
        var anchor = mobileMenuBtn || nav.lastElementChild;
        if (!anchor) return;

        var btn = document.createElement('a');
        btn.id = 'shortlistNavBtn';
        btn.className = 'shortlist-nav-btn-global';
        btn.href = '/memorials?openShortlist=1';
        btn.setAttribute('aria-label', 'View favourites');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><span id="shortlistNavCount">0</span>';
        nav.insertBefore(btn, anchor);
    }

    function updateShortlistBadge() {
        var btn = document.getElementById('shortlistNavBtn');
        var countEl = document.getElementById('shortlistNavCount');
        if (!btn || !countEl) return;
        var count = readShortlist().length;
        countEl.textContent = count;
        if (count > 0) btn.classList.add('has-items');
        else btn.classList.remove('has-items');
    }

    function init() {
        watchChatWidget();
        ensureShortlistBadge();
        updateShortlistBadge();
        window.addEventListener('storage', function (e) {
            if (e.key === SHORTLIST_KEY) updateShortlistBadge();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
