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
        if (el.getAttribute && el.getAttribute('data-widget-id') === '69ff236b0d119858db377c07') return true;
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
        var deeper = document.querySelectorAll('iframe[src*="leadconnector"], iframe[src*="msgsndr"], iframe[title*="hat"], lc-chat-widget, [data-widget-id="69ff236b0d119858db377c07"]');
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

        function hasFooterLink(list, word) {
            if (!list) return false;
            var anchors = list.querySelectorAll('a');
            for (var i = 0; i < anchors.length; i++) {
                var href = (anchors[i].getAttribute('href') || '').toLowerCase();
                var text = (anchors[i].textContent || '').trim().toLowerCase();
                if (href.indexOf(word) !== -1 || text === word) return true;
            }
            return false;
        }

        // 1) Keep the four practical footer destinations present on every
        // public page. Individual templates used to vary slightly.
        var linkList = footer.querySelector('.footer-links');
        if (linkList && !hasFooterLink(linkList, 'contact')) {
            var contactLi = document.createElement('li');
            var contactA = document.createElement('a');
            contactA.href = '/contact';
            contactA.textContent = 'Contact';
            contactLi.appendChild(contactA);
            linkList.insertBefore(contactLi, linkList.firstChild);
        }
        if (linkList && !hasFooterLink(linkList, 'terms')) {
            var li = document.createElement('li');
            var a = document.createElement('a');
            a.href = '/terms';
            a.textContent = 'Terms';
            li.appendChild(a);
            linkList.appendChild(li);
        }
        if (linkList && !hasFooterLink(linkList, 'privacy')) {
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

    // Compact the footer site-wide. Each page ships its own footer markup
    // and CSS, so we centralise the spacing/structure tweaks here rather
    // than touching 11 files.
    function compactFooter() {
        // The memorial product page has a purpose-built responsive footer.
        // Do not inject the generic footer rules over its mobile layout.
        if (document.body && document.body.classList.contains('memorial-page')) return;
        var footer = document.querySelector('footer');
        if (footer) {
            var contact = footer.querySelector('.footer-contact');
            if (contact && !contact.getAttribute('data-sm-compact')) {
                var brs = contact.querySelectorAll('br');
                for (var b = 0; b < brs.length; b++) {
                    var sep = document.createElement('span');
                    sep.className = 'footer-contact-sep';
                    sep.setAttribute('aria-hidden', 'true');
                    sep.textContent = '·';
                    brs[b].parentNode.replaceChild(sep, brs[b]);
                }
                contact.setAttribute('data-sm-compact', '1');
            }
        }

        if (document.getElementById('sm-footer-compact-style')) return;
        var style = document.createElement('style');
        style.id = 'sm-footer-compact-style';
        style.textContent = [
            'footer{padding:1.5rem 2rem 1.25rem!important;}',
            '.footer-container{align-items:center!important;gap:1rem 2rem!important;}',
            '.footer-contact{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:0 0.55rem!important;line-height:1.5!important;margin-top:0.35rem!important;}',
            '.footer-contact a{display:inline!important;min-height:0!important;padding:0!important;line-height:1.5!important;}',
            '.footer-contact-sep{color:rgba(255,255,255,0.25)!important;}',
            '.footer-links{gap:0.4rem 1rem!important;}',
            '.footer-links a{min-height:32px!important;padding:0 0.25rem!important;}',
            '.footer-copy{margin-top:0.75rem!important;padding-top:0.85rem!important;}',
            '.footer-legal{margin-top:0.35rem!important;line-height:1.5!important;}',
            '.footer-accreditations{margin-top:0.6rem!important;padding-top:0!important;border-top:0!important;gap:0.6rem!important;}',
            '.footer-accreditations .accred-badge{padding:0.2rem 0.6rem!important;font-size:0.72rem!important;}',
            '@media (max-width:768px){.footer-contact{justify-content:center!important;}}',
            '@media (hover:none) and (pointer:coarse){.footer-contact a{display:inline-block!important;min-height:44px!important;padding:0.55rem 0!important;line-height:1.2!important;}}'
        ].join('');
        document.head.appendChild(style);
    }

    // The public pages were built as individual documents, but they all share
    // the same header and footer patterns. Apply the small-screen rules once
    // here so visitors receive the same hierarchy, spacing and touch targets
    // wherever they enter the site. The memorial detail page owns its more
    // specialised conversion layout and is deliberately left alone.
    function applyPublicResponsiveBaseline() {
        if (document.body && document.body.classList.contains('memorial-page')) return;

        var footer = document.querySelector('footer');
        if (footer) {
            var links = footer.querySelectorAll('.footer-links a');
            for (var i = 0; i < links.length; i++) {
                var link = links[i];
                var href = (link.getAttribute('href') || '').toLowerCase();
                var text = (link.textContent || '').trim().toLowerCase();
                var item = link.closest ? link.closest('li') : link;
                var destination = '';
                if (href.indexOf('contact') !== -1 || text === 'contact') destination = 'contact';
                else if (href.indexOf('track') !== -1 || text === 'track order') destination = 'track';
                else if (href.indexOf('terms') !== -1 || text === 'terms') destination = 'terms';
                else if (href.indexOf('privacy') !== -1 || text === 'privacy') destination = 'privacy';
                var essential = destination !== '';
                if (item && destination) item.classList.add('sm-footer-' + destination);
                if (!essential) {
                    if (item) item.classList.add('sm-footer-secondary');
                }
            }
        }

        if (document.getElementById('sm-public-responsive-style')) return;
        var style = document.createElement('style');
        style.id = 'sm-public-responsive-style';
        style.textContent = [
            ':where(a,button,input,select,textarea,summary):focus-visible{outline:3px solid #8B7355!important;outline-offset:3px!important;}',
            '@media (max-width:768px){',
            'body:not(.memorial-page) nav:not(.mobile-bottom-nav){min-height:68px!important;padding:0.75rem 1rem!important;}',
            'body:not(.memorial-page) nav:not(.mobile-bottom-nav) .mobile-menu-btn{width:44px!important;height:44px!important;padding:8px!important;align-items:center!important;justify-content:center!important;}',
            'body:not(.memorial-page) footer{padding:1.25rem 1rem 1rem!important;}',
            'body:not(.memorial-page) footer .footer-container{width:100%!important;max-width:100%!important;box-sizing:border-box!important;gap:1rem!important;}',
            'html,body{overflow-x:clip!important;}',
            'body:not(.memorial-page) footer .footer-links{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:0.25rem 0.75rem!important;width:100%!important;max-width:360px!important;margin-inline:0!important;padding-inline:0!important;box-sizing:border-box!important;}',
            'body:not(.memorial-page) footer .footer-links a{display:flex!important;align-items:center!important;min-height:44px!important;padding:0.35rem 0.25rem!important;}',
            'body:not(.memorial-page) footer .sm-footer-secondary{display:none!important;}',
            'body:not(.memorial-page) footer .sm-footer-contact{order:1!important;}body:not(.memorial-page) footer .sm-footer-track{order:2!important;}body:not(.memorial-page) footer .sm-footer-terms{order:3!important;}body:not(.memorial-page) footer .sm-footer-privacy{order:4!important;}',
            'body:not(.memorial-page) footer .footer-copy{margin-top:0.5rem!important;padding-top:0.75rem!important;}',
            'body:not(.memorial-page) footer .footer-legal{font-size:0.7rem!important;line-height:1.45!important;margin-top:0.45rem!important;}',
            '}',
            '@media (max-width:480px){',
            'body:not(.memorial-page) nav:not(.mobile-bottom-nav) .nav-accred{display:none!important;}',
            'body:not(.memorial-page) nav:not(.mobile-bottom-nav) .nav-accred-label{display:none!important;}',
            'body:not(.memorial-page) .site-trust-bar{padding:0.6rem 1rem!important;}',
            'body:not(.memorial-page) .site-trust-row{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:0.6rem 0.75rem!important;}',
            'body:not(.memorial-page) .site-trust-item{flex-direction:row!important;justify-content:flex-start!important;gap:0.45rem!important;font-size:0.82rem!important;line-height:1.2!important;font-weight:600!important;text-align:left!important;}',
            'body:not(.memorial-page) .site-trust-item svg{width:20px!important;height:20px!important;}',
            '}'
        ].join('');
        document.head.appendChild(style);
    }

    function keepMobileMenuStateAccessible() {
        if (document.body && document.body.classList.contains('memorial-page')) return;
        var button = document.querySelector('.mobile-menu-btn');
        var menu = document.getElementById('mobileNav');
        if (!button || !menu || button.getAttribute('data-sm-menu-state')) return;

        function sync() {
            button.setAttribute('aria-expanded', menu.classList.contains('active') ? 'true' : 'false');
        }

        sync();
        button.addEventListener('click', function () {
            // The existing inline handler toggles the panel first; this keeps
            // its accessible state in step without rewriting every template.
            sync();
        });
        button.setAttribute('data-sm-menu-state', '1');
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
        compactFooter();
        applyPublicResponsiveBaseline();
        keepMobileMenuStateAccessible();
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
