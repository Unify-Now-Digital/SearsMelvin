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
        return isMobile() ? 100 : 24;
    }

    // LeadConnector paints the bubble inside a closed shadow tree and
    // places it from its own position prop (middle-right on this account).
    // Setting that prop to bottom-right, then pinning the host to a
    // zero-size corner, is what actually moves the bubble.
    var CHAT_INNER = 18;
    /* The painted bubble sits about 2px higher than this model. Asking for
       14px leaves a real gap under 18px and clear of the nav. */
    var CHAT_NAV_GAP = 14;
    var CHAT_PROMPT_H = 176;
    var CHAT_PROMPT_W = 360;
    var CHAT_BUBBLE = 84;

    function shownRect(el) {
        if (!el || !el.getBoundingClientRect) return null;
        // Cheap geometry test first: most catalogue cards are off-screen, so
        // skip their computed style. Same result as checking style first
        // (display:none has no box; visibility:hidden is still checked).
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        if (r.bottom <= 0 || r.top >= window.innerHeight) return null;
        var cs;
        try { cs = getComputedStyle(el); } catch (e) { return null; }
        if (cs.display === 'none' || cs.visibility === 'hidden') return null;
        if (el.closest && (el.closest(".hero-buttons") || el.closest(".still-questions"))) {
            return { top: r.top - 40, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height + 40 };
        }
        return r;
    }

    function quoteLabel(el) {
        var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return text === 'Request your quote' || text === 'Get a quote' || text === 'Send me the brochure';
    }

    function widgetBox(hostBottom, withPrompt) {
        var vh = window.innerHeight;
        var vw = window.innerWidth;
        var bottomY = vh - hostBottom - CHAT_INNER;
        var height = withPrompt ? CHAT_PROMPT_H : CHAT_BUBBLE;
        var width = withPrompt ? CHAT_PROMPT_W : CHAT_BUBBLE;
        var right = vw - 8;
        return { top: bottomY - height, bottom: bottomY, left: right - width, right: right };
    }

    function overlaps(a, b) {
        return a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    }

    // #listingStoneInline (the sticky /memorials colour strip), #phoneColourSlot
    // (the product-page phone colour picker) and the home .hero h1 are static
    // content, not controls, but a live audit found the launcher landing on
    // top of them on short phones. liftClear() already walks this same list
    // to clear quote/brochure controls, so the fix is to list them here too.
    // .product-price covers the /memorials catalogue cards scrolling behind
    // the fixed bubble; shownRect already discards the ~140 off-screen ones.
    // One placement pass reads the page once. liftClear() can ask for the
    // blockers up to ~17 times per pass and nothing moves in between (all
    // writes happen after the reads), so the list is cached for the pass.
    var blockerCache = null;
    function chatBlockers() {
        if (blockerCache) return blockerCache;
        blockerCache = collectChatBlockers();
        return blockerCache;
    }

    function collectChatBlockers() {
        var nodes = [];
        var chrome = [
            document.querySelector('.mobile-bottom-bar.is-visible'),
            document.querySelector('.price-summary')
        ];
        var i;
        for (i = 0; i < chrome.length; i++) {
            var rect = shownRect(chrome[i]);
            if (rect) nodes.push(rect);
        }
        var controls = document.querySelectorAll('a, button');
        for (i = 0; i < controls.length; i++) {
            var control = controls[i];
            if (!quoteLabel(control)) continue;
            if (control.closest && control.closest('#cookieConsent, #quoteOverlay, .quote-overlay, nav, #navbar')) continue;
            var box = shownRect(control);
            if (box) nodes.push(box);
        }
        var extras = document.querySelectorAll('#brochureRequestStatus, .sm-brochure-field-error, #enquiryType, #phone, .contact-method, .form-textarea, .form-submit, .sm-brochure-request button[type="submit"], .type-browse-list a, .area-chips a, .area-chips span, .area-actions a, a.sm-btn, a.sm-brochure-link, .hero-buttons a, .hero-image-label, .timeline-calculator, .category-card, .site-trust-item, .still-questions a, #listingStoneInline, #phoneColourSlot, .hero h1' + (window.innerWidth <= 767 ? ', .product-price' : ''));
        for (i = 0; i < extras.length; i++) {
            var extra = shownRect(extras[i]);
            if (extra) nodes.push(extra);
        }
        return nodes;
    }

    function phoneWidth() {
        return window.innerWidth <= 768;
    }

    function stackBottom(withPrompt) {
        if (window.innerWidth > 1024) return clearance(withPrompt);
        var vh = window.innerHeight;
        var chrome = null;
        var pieces = [
            shownRect(document.querySelector('.mobile-bottom-bar.is-visible')),
            shownRect(document.querySelector('.price-summary'))
        ];
        if (phoneWidth()) pieces.push(shownRect(document.querySelector('.mobile-bottom-nav')));
        for (var i = 0; i < pieces.length; i++) {
            var rect = pieces[i];
            if (!rect || rect.bottom < vh - 30) continue;
            if (!chrome || rect.top < chrome.top) chrome = rect;
        }
        var bottom = chrome ? Math.max(0, Math.ceil((vh - chrome.top) + CHAT_NAV_GAP - CHAT_INNER)) : 16;
        return liftClear(bottom, withPrompt, 0.85);
    }

    function chatHits(hostBottom, withPrompt) {
        var box = widgetBox(hostBottom, withPrompt);
        var blockers = chatBlockers();
        for (var i = 0; i < blockers.length; i++) {
            if (overlaps(box, blockers[i])) return true;
        }
        return false;
    }

    // Move up only as far as a control we can actually clear. Jumping to the
    // cap used to park the bubble on a higher field (the contact enquiry
    // type) when a lower control wanted more room than the cap allows.
    function liftClear(bottom, withPrompt, capRatio) {
        var vh = window.innerHeight;
        var cap = Math.round(vh * capRatio);
        var guard = 0;
        while (guard < 8 && chatHits(bottom, withPrompt)) {
            var blockers = chatBlockers();
            var box = widgetBox(bottom, withPrompt);
            var next = bottom;
            for (var j = 0; j < blockers.length; j++) {
                if (!overlaps(box, blockers[j])) continue;
                var needed = Math.ceil(vh - CHAT_INNER - (blockers[j].top - 16));
                if (needed <= cap && needed > next) next = needed;
            }
            if (next <= bottom) return bottom;
            bottom = next;
            guard++;
        }
        return bottom;
    }

    function clearance(withPrompt) {
        return liftClear(16, withPrompt, 0.55);
    }

    function isChatWidgetEl(el) {
        if (!el || el.nodeType !== 1) return false;
        var id = (el.id || '').toLowerCase();
        var cls = (el.className && el.className.toString ? el.className.toString() : '').toLowerCase();
        var tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'chat-widget' || tag === 'lc-chat-widget') return true;
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

    var placingChat = false;

    var CHAT_OPEN_Z = 2000;

    // Space taken by the product price bar or the phone bottom nav. Used
    // only for the open panel box, not for closed bubble placement.
    function openChromeBottom() {
        var vh = window.innerHeight;
        var chrome = null;
        var pieces = [
            shownRect(document.querySelector('.mobile-bottom-bar.is-visible')),
            shownRect(document.querySelector('.price-summary'))
        ];
        if (phoneWidth()) pieces.push(shownRect(document.querySelector('.mobile-bottom-nav')));
        for (var i = 0; i < pieces.length; i++) {
            var rect = pieces[i];
            if (!rect || rect.bottom < vh - 30) continue;
            if (!chrome || rect.top < chrome.top) chrome = rect;
        }
        return chrome ? Math.max(0, Math.ceil(vh - chrome.top)) : 0;
    }

    function setImportant(el, name, value) {
        if (el.style.getPropertyValue(name) === value && el.style.getPropertyPriority(name) === 'important') return;
        el.style.setProperty(name, value, 'important');
    }

    function setRootVar(name, value) {
        var root = document.documentElement.style;
        if (root.getPropertyValue(name) === value) return;
        root.setProperty(name, value);
    }

    function finishPlacing() {
        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(function () { placingChat = false; });
        } else {
            placingChat = false;
        }
    }

    // Legacy chat iframes/hosts and the corner heuristic. Same final styles as
    // before; the write is skipped when already set so watching these nodes
    // cannot loop on our own writes. Each pinned node is remembered so
    // watchChatWidget can observe late third-party style/class rewrites.
    var legacyPinned = [];
    function pinLegacy(el, bottom) {
        setImportant(el, 'bottom', bottom + 'px');
        setImportant(el, 'right', '24px');
        if (legacyPinned.indexOf(el) === -1) legacyPinned.push(el);
    }

    function pinChatHostOpen(el, openBottom) {
        if (el.position !== 'bottom-right') el.position = 'bottom-right';
        if (el.classList && !el.classList.contains('sm-chat-open')) el.classList.add('sm-chat-open');
        setRootVar('--sm-chat-open-bottom', openBottom + 'px');
        setImportant(el, 'position', 'fixed');
        setImportant(el, 'margin', '0');
        setImportant(el, 'transform', 'none');
        setImportant(el, 'pointer-events', 'auto');
        setImportant(el, 'z-index', String(CHAT_OPEN_Z));
        setImportant(el, 'top', '0px');
        setImportant(el, 'left', '0px');
        setImportant(el, 'right', '0px');
        setImportant(el, 'bottom', openBottom + 'px');
        setImportant(el, 'width', 'auto');
        setImportant(el, 'height', 'calc(100dvh - ' + openBottom + 'px)');
    }

    function pinChatHost(el, bottom) {
        if (el.position !== 'bottom-right') el.position = 'bottom-right';
        if (el.classList && el.classList.contains('sm-chat-open')) el.classList.remove('sm-chat-open');
        var px = Math.round(bottom) + 'px';
        setRootVar('--sm-chat-bottom', px);
        setImportant(el, 'position', 'fixed');
        setImportant(el, 'top', 'auto');
        setImportant(el, 'left', 'auto');
        setImportant(el, 'right', '0px');
        setImportant(el, 'bottom', px);
        setImportant(el, 'width', '0px');
        setImportant(el, 'height', '0px');
        setImportant(el, 'margin', '0');
        setImportant(el, 'transform', 'translateZ(0)');
        setImportant(el, 'pointer-events', 'auto');
        setImportant(el, 'z-index', '70');
    }

    function applyWidgetPosition() {
        if (placingChat) return;
        placingChat = true;
        blockerCache = null;
        try {
            placeChatWidget();
        } finally {
            blockerCache = null;
        }
    }

    function placeChatWidget() {
        var open = false;
        try {
            var hosts = document.querySelectorAll('chat-widget');
            if (hosts.length) {
                var phone = phoneWidth();
                var withPrompt = !phone;
                var h;
                for (h = 0; h < hosts.length; h++) {
                    if (hosts[h].active) open = true;
                }
                if (open && phone) {
                    var openBottom = openChromeBottom();
                    // Do not re-apply the 0x0 closed pin, and do not change
                    // --sm-chat-bottom, so the bubble returns to the same spot.
                    for (h = 0; h < hosts.length; h++) {
                        if (!hosts[h].active && hosts[h].showPrompt !== false) hosts[h].showPrompt = false;
                        pinChatHostOpen(hosts[h], openBottom);
                    }
                } else if (open) {
                    // The desktop card already works with the closed corner pin.
                    var closedBottom = parseFloat(document.documentElement.style.getPropertyValue('--sm-chat-bottom'));
                    if (isNaN(closedBottom)) closedBottom = 16;
                    for (h = 0; h < hosts.length; h++) pinChatHost(hosts[h], closedBottom);
                } else {
                    var bottom = stackBottom(withPrompt);
                    var hidePrompt = withPrompt && chatHits(bottom, true);
                    if (hidePrompt) {
                        bottom = stackBottom(false);
                    }
                    for (var p = 0; p < hosts.length; p++) {
                        if ((phone || hidePrompt) && hosts[p].showPrompt !== false) hosts[p].showPrompt = false;
                        pinChatHost(hosts[p], bottom);
                    }
                }
            }
        } catch (e) {}
        if (open) {
            finishPlacing();
            return;
        }
        var bottomLegacy = pickWidgetBottom();
        var nodes = document.body ? document.body.children : [];
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (!isChatWidgetEl(el) || (el.tagName && el.tagName.toLowerCase() === 'chat-widget')) continue;
            pinLegacy(el, bottomLegacy);
        }
        var deeper = document.querySelectorAll('iframe[src*="leadconnector"], iframe[src*="msgsndr"], iframe[title*="hat"], lc-chat-widget, [data-widget-id="69ff236b0d119858db377c07"]');
        for (var j = 0; j < deeper.length; j++) {
            if (deeper[j].tagName && deeper[j].tagName.toLowerCase() === 'CHAT-WIDGET') continue;
            pinLegacy(deeper[j], bottomLegacy);
        }
        finishPlacing();
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
            pinLegacy(node, bottomLegacy);
        }
    }

    function watchChatWidget() {
        // Nothing below does any layout work until LeadConnector has put its
        // chat host (or a legacy chat iframe) on the page. Before that, the old
        // code re-measured the whole page on every DOM/class change, which
        // starved phones while the catalogue grid was building.
        var HOST_SELECTOR = 'chat-widget, lc-chat-widget, iframe[src*="leadconnector"], iframe[src*="msgsndr"], [data-widget-id="69ff236b0d119858db377c07"]';
        var hostReady = false;
        var framePending = false;
        var watchedHosts = [];
        var hostObserver = window.MutationObserver ? new MutationObserver(function () { schedulePosition(); }) : null;

        // Every signal (mutation, resize, scroll, poll, click) shares one
        // placement per animation frame.
        function schedulePosition() {
            if (!hostReady || framePending) return;
            framePending = true;
            var run = function () {
                framePending = false;
                applyWidgetPosition();
                watchHosts();
            };
            if (window.requestAnimationFrame) window.requestAnimationFrame(run);
            else setTimeout(run, 0);
        }

        // LeadConnector writes inline styles on its own host late, so watch
        // style/class on the host itself (not on the whole page).
        function liveNodes(list) {
            var out = [];
            for (var i = 0; i < list.length; i++) {
                if (list[i] && list[i].isConnected) out.push(list[i]);
            }
            return out;
        }

        function watchHosts() {
            if (!hostObserver) return;
            var i;
            var dropDead = false;
            for (i = 0; i < watchedHosts.length; i++) {
                if (!watchedHosts[i] || !watchedHosts[i].isConnected) { dropDead = true; break; }
            }
            // Drop replaced or removed chat nodes so the lists cannot grow
            // without bound and so their observers do not keep them alive.
            legacyPinned = liveNodes(legacyPinned);
            if (dropDead) {
                hostObserver.disconnect();
                watchedHosts = [];
            }
            var found = document.querySelectorAll(HOST_SELECTOR);
            var hosts = [];
            for (i = 0; i < found.length; i++) hosts.push(found[i]);
            for (i = 0; i < legacyPinned.length; i++) {
                if (hosts.indexOf(legacyPinned[i]) === -1) hosts.push(legacyPinned[i]);
            }
            for (i = 0; i < hosts.length; i++) {
                if (watchedHosts.indexOf(hosts[i]) !== -1) continue;
                watchedHosts.push(hosts[i]);
                hostObserver.observe(hosts[i], { attributes: true, attributeFilter: ['style', 'class'] });
            }
        }

        function startHostPolls() {
            // Reapply periodically for the first 10s after the host appears.
            // GHL often sets inline styles after our observer runs, so re-pin
            // to win the last-write race.
            var ticks = 0;
            var poll = setInterval(function () {
                schedulePosition();
                if (++ticks >= 20) clearInterval(poll);
            }, 500);
            // The widget's active flag is a property, not a light-DOM
            // attribute, so the observer can miss an open or close. Watch that
            // flag and only re-apply when it changes. While it is open,
            // applyWidgetPosition keeps the open box and does not re-apply the
            // zero-size closed pin.
            var lastChatOpen = null;
            setInterval(function () {
                var hosts = document.querySelectorAll('chat-widget');
                var isOpen = false;
                for (var i = 0; i < hosts.length; i++) {
                    if (hosts[i].active) isOpen = true;
                }
                if (lastChatOpen === isOpen) return;
                lastChatOpen = isOpen;
                schedulePosition();
            }, 250);
        }

        function discoverHost() {
            if (!document.querySelector(HOST_SELECTOR)) return false;
            watchHosts();
            if (!hostReady) {
                hostReady = true;
                startHostPolls();
            }
            schedulePosition();
            return true;
        }

        var observer = new MutationObserver(function (records) {
            if (!hostReady) {
                discoverHost();
                return;
            }
            for (var i = 0; i < records.length; i++) {
                if (records[i].addedNodes && records[i].addedNodes.length) { watchHosts(); break; }
            }
            schedulePosition();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        discoverHost();
        window.addEventListener('resize', schedulePosition);
        window.addEventListener('scroll', schedulePosition, { passive: true });
        // A click on the host also syncs straight away.
        document.addEventListener('click', function (ev) {
            var t = ev.target;
            if (!t || !t.closest || !t.closest('chat-widget')) return;
            discoverHost();
            setTimeout(schedulePosition, 0);
            setTimeout(schedulePosition, 100);
        }, true);
    }

    // The home brochure button is fixed. Raise it while it covers a caption,
    // the install date, or a category card's price line.
    function placeBrochureFab() {
        var fab = document.querySelector('.sm-brochure-fab');
        if (!fab) return;
        var base = window.innerWidth <= 768 ? 86 : 24;
        var targets = document.querySelectorAll('.hero-image-label, .timeline-calculator, .category-info');
        var bottom = base;
        var guard = 0;
        while (guard < 5) {
            fab.style.setProperty('bottom', bottom + 'px', 'important');
            var fr = fab.getBoundingClientRect();
            var next = bottom;
            for (var i = 0; i < targets.length; i++) {
                var el = targets[i];
                var shown = shownRect(el);
                if (!shown) continue;
                var overlaps = fr.left < shown.right && fr.right > shown.left && fr.top < shown.bottom && fr.bottom > shown.top;
                if (!overlaps) continue;
                var needed = Math.ceil(window.innerHeight - shown.top + 8);
                if (needed > next) next = needed;
            }
            if (next === bottom || next > window.innerHeight * 0.72) break;
            bottom = next;
            guard++;
        }
        fab.style.setProperty('bottom', bottom + 'px', 'important');
    }

    // The chat widget pulls Roboto from fonts.bunny.net as a render-blocking
    // stylesheet. Park those sheets until the page is idle so they are not
    // part of the first long tasks. The widget itself still starts at 1s.
    function delayBunnyFonts() {
        function park(link) {
            if (!link || !link.getAttribute) return;
            var href = link.getAttribute('href') || '';
            if (href.indexOf('fonts.bunny.net') === -1) return;
            if (link.getAttribute('data-sm-bunny')) return;
            link.setAttribute('data-sm-bunny', '1');
            link.media = 'print';
            var apply = function () { link.media = 'all'; };
            if (window.requestIdleCallback) requestIdleCallback(apply, { timeout: 4000 });
            else setTimeout(apply, 3000);
        }
        function scan(root) {
            if (!root || !root.querySelectorAll) return;
            var links = root.querySelectorAll('link[href*="fonts.bunny.net"]');
            for (var i = 0; i < links.length; i++) park(links[i]);
        }
        scan(document);
        if (!window.MutationObserver || !document.documentElement) return;
        new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                var nodes = records[i].addedNodes;
                if (!nodes) continue;
                for (var j = 0; j < nodes.length; j++) {
                    var node = nodes[j];
                    if (!node || node.nodeType !== 1) continue;
                    if (node.tagName === 'LINK') park(node);
                    else scan(node);
                }
            }
        }).observe(document.documentElement, { childList: true, subtree: true });
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
        // Option A owns its own spacing. Leave that footer alone.
        if (document.body && document.body.classList.contains('memorial-page')) return;
        var footer = document.querySelector('footer');
        if (footer && footer.classList.contains('footer-b')) return;
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
            'footer:not(.footer-b){padding:1.5rem 2rem 1.25rem!important;}',
            'footer:not(.footer-b) .footer-container{align-items:center!important;gap:1rem 2rem!important;}',
            'footer:not(.footer-b) .footer-contact{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:0 0.55rem!important;line-height:1.5!important;margin-top:0.35rem!important;}',
            'footer:not(.footer-b) .footer-contact a{display:inline!important;min-height:0!important;padding:0!important;line-height:1.5!important;}',
            'footer:not(.footer-b) .footer-contact-sep{color:rgba(255,255,255,0.25)!important;}',
            'footer:not(.footer-b) .footer-links{gap:0.4rem 1rem!important;}',
            'footer:not(.footer-b) .footer-links a{min-height:32px!important;padding:0 0.25rem!important;}',
            'footer:not(.footer-b) .footer-copy{margin-top:0.75rem!important;padding-top:0.85rem!important;}',
            'footer:not(.footer-b) .footer-legal{margin-top:0.35rem!important;line-height:1.5!important;}',
            'footer:not(.footer-b) .footer-accreditations{margin-top:0.6rem!important;padding-top:0!important;border-top:0!important;gap:0.6rem!important;}',
            'footer:not(.footer-b) .footer-accreditations .accred-badge{padding:0.2rem 0.6rem!important;font-size:0.72rem!important;}',
            '@media (max-width:768px){footer:not(.footer-b) .footer-contact{justify-content:center!important;}}',
            '@media (hover:none) and (pointer:coarse){footer:not(.footer-b) .footer-contact a{display:inline-block!important;min-height:44px!important;padding:0.55rem 0!important;line-height:1.2!important;}}'
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
        if (footer && !footer.classList.contains('footer-b')) {
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
            ':where(a,button,input,select,textarea,summary):focus-visible{outline:3px solid #7A6449!important;outline-offset:3px!important;}',
            '@media (max-width:768px){',
            'body:not(.memorial-page) nav:not(.mobile-bottom-nav):not(.type-browse){min-height:68px!important;padding:0.75rem 1rem!important;}',
            'body:not(.memorial-page) nav:not(.mobile-bottom-nav) .mobile-menu-btn{width:44px!important;height:44px!important;padding:8px!important;align-items:center!important;justify-content:center!important;}',
            'body:not(.memorial-page) footer:not(.footer-b){padding:1.25rem 1rem 1rem!important;}',
            'body:not(.memorial-page) footer:not(.footer-b) .footer-container{width:100%!important;max-width:100%!important;box-sizing:border-box!important;gap:1rem!important;}',
            'html,body{overflow-x:clip!important;}',
            'body:not(.memorial-page) footer:not(.footer-b) .footer-links{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:0.25rem 0.75rem!important;width:100%!important;max-width:360px!important;margin-inline:0!important;padding-inline:0!important;box-sizing:border-box!important;}',
            'body:not(.memorial-page) footer:not(.footer-b) .footer-links a{display:flex!important;align-items:center!important;min-height:44px!important;padding:0.35rem 0.25rem!important;}',
            'body:not(.memorial-page) footer:not(.footer-b) .sm-footer-secondary{display:none!important;}',
            'body:not(.memorial-page) footer:not(.footer-b) .sm-footer-contact{order:1!important;}body:not(.memorial-page) footer:not(.footer-b) .sm-footer-track{order:2!important;}body:not(.memorial-page) footer:not(.footer-b) .sm-footer-terms{order:3!important;}body:not(.memorial-page) footer:not(.footer-b) .sm-footer-privacy{order:4!important;}',
            'body:not(.memorial-page) footer:not(.footer-b) .footer-copy{margin-top:0.5rem!important;padding-top:0.75rem!important;}',
            'body:not(.memorial-page) footer:not(.footer-b) .footer-legal{font-size:0.875rem!important;line-height:1.45!important;margin-top:0.45rem!important;}',
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
        var button = document.querySelector('.mobile-menu-btn');
        var menu = document.getElementById('mobileNav');
        if (!button || !menu || button.getAttribute('data-sm-menu-state')) return;

        function sync() {
            var open = menu.classList.contains('active');
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
            document.body.classList.toggle('sm-menu-open', open);
        }

        sync();
        if (window.MutationObserver) {
            new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ['class'] });
        }
        button.addEventListener('click', function () {
            // The existing inline handler toggles the panel first; this keeps
            // its accessible state in step without rewriting every template.
            sync();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape' || !menu.classList.contains('active')) return;
            if (typeof window.toggleMobileMenu === 'function') window.toggleMobileMenu();
        });
        document.addEventListener('click', function (e) {
            if (!menu.classList.contains('active')) return;
            if (menu.contains(e.target) || button.contains(e.target)) return;
            if (typeof window.toggleMobileMenu === 'function') window.toggleMobileMenu();
        });
        button.setAttribute('data-sm-menu-state', '1');
    }

    // Phone menu, option B. One row style, brochure as a normal row, and the
    // quote and call actions as a pair. The number stays one text node.
    function shapePhoneMenu() {
        var menu = document.getElementById('mobileNav');
        if (!menu || menu.getAttribute('data-sm-phone-menu')) return;

        var brochure = menu.querySelector('a.nav-brochure');
        if (brochure && !brochure.querySelector('.sm-menu-note')) {
            var note = document.createElement('small');
            note.className = 'sm-menu-note';
            note.textContent = 'Free PDF';
            brochure.appendChild(note);
        }

        var tel = menu.querySelector('a[href^="tel:"]');
        if (tel && !tel.querySelector('svg')) {
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('class', 'sm-menu-phone');
            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2');
            svg.appendChild(path);
            tel.insertBefore(svg, tel.firstChild);
        }

        if (!menu.querySelector('.sm-menu-hours')) {
            var hours = document.createElement('p');
            hours.className = 'sm-menu-hours';
            hours.textContent = 'Showroom: Monday to Friday, 10am to 3pm';
            menu.appendChild(hours);
        }
        menu.setAttribute('data-sm-phone-menu', '1');
    }

    // Option A phone trust bar (inner pages only, <=767px): swap the full
    // sentences for short labels and the desktop icons for smaller bronze
    // ones, so the bar fits a single 30px row. The home page (bare .hero)
    // and the single-product page keep the shared markup untouched, as do
    // widths above the breakpoint. The full sentence stays readable to
    // screen readers via a visually-hidden .sm-trust-sr span (not an
    // aria-label on .site-trust-item — that's a plain div, and ARIA 1.2
    // does not expose aria-label on elements without a role). The row
    // gets tabindex/role=group/aria-label so keyboard users who can't
    // scroll with touch can still reach items past the visible edge.
    // Originals are saved per item so the swap can be undone exactly when
    // the viewport grows back past 767px (tests/header-offset.mjs resizes
    // one tab across both sides of that line and expects the sentences
    // back).
    var TRUST_BAR_ITEMS = {
        '30-year fixing guarantee': { short: '30-year guarantee', icon: 'shield' },
        'fixing included': { short: 'Fixing included', icon: 'spanner' },
        'we help with your permit': { short: 'Permit help', icon: 'clipboard' },
        'we reply within one working day': { short: '1-day reply', icon: 'clock' }
    };
    var TRUST_BAR_ICON_PATHS = {
        shield: '<path d="M12 3.2L5 6.2v6.1c0 4.6 3.1 7.8 7 9.2 3.9-1.4 7-4.6 7-9.2V6.2l-7-3z"/><path d="M8.6 12.2l2.3 2.3 4.6-4.8"/>',
        spanner: '<path d="M15.2 5.2a3.6 3.6 0 0 0-5 5L5 15.4V19h3.6l5.2-5.2a3.6 3.6 0 0 0 5-5l-2.4 2.4-1.6-1.6 2.4-2.4z"/>',
        clipboard: '<path d="M8.5 4.5h7v2h-7z"/><path d="M10 3.5h4v2h-4z"/><rect x="6.5" y="5.5" width="11" height="15" rx="1.4"/><path d="M9.2 13.2l2 2 3.8-3.9"/>',
        clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.6V12l3.3 2"/>'
    };

    function buildTrustBarIcon(name) {
        var holder = document.createElement('div');
        holder.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
            'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            (TRUST_BAR_ICON_PATHS[name] || '') + '</svg>';
        return holder.firstChild;
    }

    function shapeInnerPhoneTrustBar() {
        if (document.body.classList.contains('memorial-page')) return;
        if (document.querySelector('.hero')) return;
        var path = window.location.pathname;
        if (path === '/' || path === '') return;

        var bar = document.querySelector('.site-trust-bar');
        if (!bar || bar.getAttribute('data-sm-trust-bound')) return;
        bar.setAttribute('data-sm-trust-bound', '1');

        var items = bar.querySelectorAll('.site-trust-item');
        if (!items.length) return;
        var row = bar.querySelector('.site-trust-row');

        function apply() {
            if (row) {
                row.setAttribute('tabindex', '0');
                row.setAttribute('role', 'group');
                row.setAttribute('aria-label', 'Our promises');
            }
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var span = item.querySelector('span:not(.sm-trust-sr)');
                if (!span) continue;
                if (!item.getAttribute('data-sm-trust-original')) {
                    item.setAttribute('data-sm-trust-original', item.innerHTML);
                }
                var full = (span.textContent || '').trim();
                var info = TRUST_BAR_ITEMS[full.toLowerCase()];
                if (!info) continue;
                var svg = item.querySelector('svg');
                var icon = buildTrustBarIcon(info.icon);
                if (svg && svg.parentNode === item) item.replaceChild(icon, svg);
                else item.insertBefore(icon, item.firstChild);
                span.textContent = info.short;
                span.setAttribute('aria-hidden', 'true');
                if (!item.querySelector('.sm-trust-sr')) {
                    var sr = document.createElement('span');
                    sr.className = 'sm-trust-sr';
                    sr.textContent = full;
                    item.appendChild(sr);
                }
            }
        }

        function restore() {
            if (row) {
                row.removeAttribute('tabindex');
                row.removeAttribute('role');
                row.removeAttribute('aria-label');
            }
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var original = item.getAttribute('data-sm-trust-original');
                if (original) {
                    item.innerHTML = original;
                    item.removeAttribute('aria-label');
                }
            }
        }

        var mq = window.matchMedia('(max-width: 767px)');
        function sync() {
            if (mq.matches) apply();
            else restore();
        }
        sync();
        if (mq.addEventListener) mq.addEventListener('change', sync);
        else if (mq.addListener) mq.addListener(sync);
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
                '.sm-skip-link:focus{left:0;top:0;outline:2px solid #7A6449;outline-offset:2px;}';
            document.head.appendChild(style);
        }

        var link = document.createElement('a');
        link.className = 'sm-skip-link';
        link.href = '#' + main.id;
        link.textContent = 'Skip to content';
        document.body.insertBefore(link, document.body.firstChild);
    }

    // The type row is a horizontal scroller. The fade sits on the visible
    // right edge and drops once the last chip is in view.
    function syncTypeChips() {
        var list = document.querySelector('.type-browse-list');
        var nav = list && list.closest ? list.closest('.type-browse') : null;
        if (!list || !nav || list.getAttribute('data-sm-chips')) return;
        list.setAttribute('data-sm-chips', '1');
        function sync() {
            var max = list.scrollWidth - list.clientWidth;
            var atEnd = max <= 2 || list.scrollLeft >= max - 2;
            nav.classList.toggle('is-scrolled-end', atEnd);
        }
        list.addEventListener('scroll', sync, { passive: true });
        window.addEventListener('resize', sync);
        if (window.ResizeObserver) new ResizeObserver(sync).observe(list);
        sync();
    }

    function init() {
        watchChatWidget();
        delayBunnyFonts();
        placeBrochureFab();
        var fabFrame = false;
        function scheduleFab() {
            if (fabFrame) return;
            fabFrame = true;
            var run = function () {
                fabFrame = false;
                placeBrochureFab();
            };
            if (window.requestAnimationFrame) window.requestAnimationFrame(run);
            else setTimeout(run, 0);
        }
        window.addEventListener('scroll', scheduleFab, { passive: true });
        window.addEventListener('resize', scheduleFab);
        syncTypeChips();
        ensureShortlistBadge();
        updateShortlistBadge();
        // Kept synchronous: the skip link must be first in the focus order and
        // the footer must have its final shape before first paint (no CLS).
        ensureSkipLink();
        ensureFooterDisclosures();
        compactFooter();
        applyPublicResponsiveBaseline();
        keepMobileMenuStateAccessible();
        shapePhoneMenu();
        shapeInnerPhoneTrustBar();
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
