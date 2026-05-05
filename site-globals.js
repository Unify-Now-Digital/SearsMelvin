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

    // Companies Act 2006 s.1202 disclosure — must appear on the website.
    // Injecting site-wide so every page footer carries the registered details
    // without per-file edits. Update VAT number here once registered.
    function ensureFooterDisclosures() {
        var footer = document.querySelector('footer');
        if (!footer) return;

        // 1) Add Terms + Privacy to the footer link list, if not already there.
        var linkList = footer.querySelector('.footer-links');
        if (linkList && !linkList.querySelector('a[href="/terms"]')) {
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = '/terms';
            a.textContent = 'Terms';
            li.appendChild(a);
            linkList.appendChild(li);
        }
        if (linkList && !linkList.querySelector('a[href="/privacy"]')) {
            var liP = document.createElement('li');
            var aP = document.createElement('a');
            aP.href = '/privacy';
            aP.textContent = 'Privacy';
            liP.appendChild(aP);
            linkList.appendChild(liP);
        }

        // 2) Add the legal disclosure block, if not already present.
        if (footer.querySelector('.footer-legal')) return;
        var copy = footer.querySelector('.footer-copy');
        var disclosure = document.createElement('p');
        disclosure.className = 'footer-legal';
        disclosure.style.cssText = 'font-size:0.75rem;line-height:1.6;width:100%;text-align:center;margin-top:0.75rem;color:rgba(255,255,255,0.45);';
        disclosure.innerHTML =
            'Sears Melvin Ltd. Registered in England &amp; Wales, company no. 16191330. ' +
            'Registered office: Unit 16, Dorewards Hall, Dorewards Chase, Braintree CM7 5LS, United Kingdom. ' +
            'Trading as Sears Melvin Memorials.';
        if (copy && copy.parentNode) {
            copy.parentNode.insertBefore(disclosure, copy.nextSibling);
        } else {
            var container = footer.querySelector('.footer-container') || footer;
            container.appendChild(disclosure);
        }
    }

    function ensureSkipLink() {
        if (document.querySelector('a.sm-skip-link')) return;
        var main = document.querySelector('main');
        if (!main) return;
        if (!main.id) main.id = 'main';

        var style = document.getElementById('sm-skip-link-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'sm-skip-link-style';
            // Visually hidden until focused — uses absolute positioning so it
            // doesn't reflow page layout. WCAG 2.4.1 Bypass Blocks.
            style.textContent =
                '.sm-skip-link{position:absolute;left:-9999px;top:0;background:#2C2C2C;color:#FAF8F5;' +
                'padding:.75rem 1rem;font-family:inherit;font-size:.875rem;letter-spacing:.05em;' +
                'text-transform:uppercase;text-decoration:none;border-radius:0 0 3px 0;z-index:10000;}' +
                '.sm-skip-link:focus{left:0;top:0;outline:2px solid #8B7355;outline-offset:2px;}';
            document.head.appendChild(style);
        }

        var link = document.createElement('a');
        link.className = 'sm-skip-link';
        link.href = '#' + main.id;
        link.textContent = 'Skip to content';
        document.body.insertBefore(link, document.body.firstChild);
    }

    function init() {
        watchChatWidget();
        ensureShortlistBadge();
        updateShortlistBadge();
        ensureSkipLink();
        ensureFooterDisclosures();
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
