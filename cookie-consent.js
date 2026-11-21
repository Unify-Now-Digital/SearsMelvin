/* Cookie choice.
   The first layer is a slim strip under the header on every page.
   It sets its top and the page offset, and never a bottom value.
   "Manage choices" opens the second layer. Essential stays on.
   Analytics starts off and maps to analytics_storage.
   Ads starts off and maps to ad_storage, ad_user_data and ad_personalization.
   Defaults stay denied. The choice is stored in localStorage as cookieConsent.
   'accepted' and 'declined' still grant or deny everything.
   A new choice is JSON: {"analytics":true,"ads":false}.
   This file does not read or write gclid, gbraid or wbraid. */
(function (root) {
  var KEY = 'cookieConsent';

  function readChoice(raw) {
    if (raw == null || raw === '') return null;
    if (raw === 'accepted') return { analytics: true, ads: true };
    if (raw === 'declined') return { analytics: false, ads: false };
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.analytics === 'boolean' && typeof parsed.ads === 'boolean') {
        return { analytics: parsed.analytics, ads: parsed.ads };
      }
    } catch (e) {}
    return null;
  }

  function serialise(choice) {
    return JSON.stringify({ analytics: !!choice.analytics, ads: !!choice.ads });
  }

  function signals(choice) {
    var ads = choice.ads ? 'granted' : 'denied';
    var analytics = choice.analytics ? 'granted' : 'denied';
    return {
      analytics_storage: analytics,
      ad_storage: ads,
      ad_user_data: ads,
      ad_personalization: ads
    };
  }

  root.smCookieConsent = {
    KEY: KEY,
    readChoice: readChoice,
    serialise: serialise,
    signals: signals
  };

  var doc = root.document;
  if (!doc || !doc.getElementById) return;

  var banner = doc.getElementById('cookieConsent');
  if (!banner) return;
  // Bind after the parser task. The strip is already reserved in CSS, and
  // the head script has already applied a stored choice to consent mode.
  // Tests without requestIdleCallback still run this immediately.
  var bootCookie = function () {
  var scrim = doc.getElementById('cookieScrim');
  var analyticsSwitch = doc.getElementById('cookieAnalytics');
  var adsSwitch = doc.getElementById('cookieAds');
  var analyticsState = doc.getElementById('cookieAnalyticsState');
  var adsState = doc.getElementById('cookieAdsState');
  var openedFrom = 'choice';

  function gtag() {
    root.dataLayer = root.dataLayer || [];
    if (typeof root.gtag === 'function') root.gtag.apply(root, arguments);
    else root.dataLayer.push(arguments);
  }

  function pushUpdate(choice, byClick) {
    var map = signals(choice);
    gtag('consent', 'update', map);
    root.dataLayer = root.dataLayer || [];
    root.dataLayer.push({ event: 'consent_update', analytics_storage: map.analytics_storage });
    if (byClick && (choice.analytics || choice.ads)) {
      root.dataLayer.push({ event: 'consent_granted_by_click' });
    }
    try {
      root.dispatchEvent(new root.CustomEvent('sm-cookie-consent', {
        detail: { analytics: !!choice.analytics, ads: !!choice.ads }
      }));
    } catch (e) {}
  }

  function readStored() {
    try { return readChoice(root.localStorage.getItem(KEY)); }
    catch (e) { return null; }
  }

  function writeStored(choice) {
    try { root.localStorage.setItem(KEY, serialise(choice)); }
    catch (e) {}
  }

  function syncQuoteBar() {
    if (typeof root.syncMobileQuoteBar === 'function') root.syncMobileQuoteBar();
  }

  function shownBox(el) {
    if (!el) return null;
    var style = root.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    var box = el.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return box;
  }

  // Same heights as cookie-consent.css. Measuring the strip here let the
  // offset change again after fonts and the chat loaded. 108px is the
  // stacked phone strip. 76px is the packed 568–634px phone. 61px is the
  // single desktop row.
  function stackHeight() {
    if (root.matchMedia("(max-width: 390px) and (min-height: 568px) and (max-height: 634px)").matches) return 76;
    var w = root.innerWidth || 0;
    if (w <= 768) return 108;
    return 61;
  }

  function syncNavOffset() {
    var manage = banner.classList.contains('is-manage');
    var hidden = banner.style.display === 'none';
    var open = !(manage || hidden);
    doc.documentElement.setAttribute('data-sm-cookie', open ? 'open' : 'closed');
    /* Keep the inline value equal to the stylesheet so a later write cannot
       move the page. The stylesheet already reserved this height. */
    doc.documentElement.style.setProperty('--sm-cookie-stack', (open ? stackHeight() : 0) + 'px');
    if (!open) {
      banner.style.top = '';
      return;
    }
    var header = root.innerWidth <= 768 ? 68 : 80;
    banner.style.top = header + 'px';
  }

  var offsetQueued = false;
  function queueNavOffset() {
    if (offsetQueued) return;
    offsetQueued = true;
    var run = function () {
      offsetQueued = false;
      syncNavOffset();
    };
    if (root.requestAnimationFrame) {
      root.requestAnimationFrame(function () {
        run();
        root.requestAnimationFrame(syncNavOffset);
      });
    } else run();
  }

  function setSwitch(button, stateEl, on) {
    if (!button) return;
    button.setAttribute('aria-checked', on ? 'true' : 'false');
    if (stateEl) stateEl.textContent = on ? 'On' : 'Off';
  }

  function switchOn(button) {
    return !!(button && button.getAttribute('aria-checked') === 'true');
  }

  function paintSwitches(choice) {
    var analytics = !!(choice && choice.analytics);
    var ads = !!(choice && choice.ads);
    setSwitch(analyticsSwitch, analyticsState, analytics);
    setSwitch(adsSwitch, adsState, ads);
  }

  function shiftNodes() {
    var out = [];
    var kids = doc.body ? doc.body.children : [];
    var i;
    for (i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (!el || el.nodeType !== 1) continue;
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT') continue;
      var cs;
      try { cs = root.getComputedStyle(el); } catch (e) { continue; }
      if (cs.position === 'fixed' || cs.position === 'sticky' || cs.display === 'none') continue;
      out.push(el);
    }
    return out;
  }

  // The offset is removed in the same frame, and the in-flow page is held
  // with a transform so it does not jump. The transform then eases to rest.
  // A transform does not count as layout shift.
  function easeStackAway(px) {
    if (!(px > 1)) return;
    var reduce = false;
    try { reduce = root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduce) return;
    var nodes = shiftNodes();
    if (!nodes.length) return;
    var i;
    for (i = 0; i < nodes.length; i++) {
      nodes[i].style.transition = 'none';
      nodes[i].style.transform = 'translateY(' + px + 'px)';
    }
    if (nodes[0]) nodes[0].getBoundingClientRect();
    for (i = 0; i < nodes.length; i++) {
      nodes[i].style.transition = 'transform 280ms ease';
      nodes[i].style.transform = 'translateY(0)';
    }
    root.setTimeout(function () {
      var j;
      for (j = 0; j < nodes.length; j++) {
        nodes[j].style.transition = '';
        nodes[j].style.transform = '';
      }
    }, 340);
  }

  function hide() {
    var px = 0;
    if (banner.style.display !== 'none' && !banner.classList.contains('is-manage')) {
      px = Math.round(banner.getBoundingClientRect().height);
    }
    banner.style.display = 'none';
    banner.classList.remove('is-manage');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-labelledby', 'cookieTitle');
    if (scrim) scrim.classList.remove('is-on');
    doc.body.classList.remove('sm-cookie-manage');
    syncNavOffset();
    easeStackAway(px);
    syncQuoteBar();
  }

  function show(layer) {
    var manage = layer === 'manage';
    banner.style.display = 'block';
    banner.classList.toggle('is-manage', manage);
    banner.setAttribute('aria-modal', manage ? 'true' : 'false');
    banner.setAttribute('aria-labelledby', manage ? 'cookieManageTitle' : 'cookieTitle');
    if (scrim) scrim.classList.toggle('is-on', manage);
    doc.body.classList.toggle('sm-cookie-manage', manage);
    syncNavOffset();
    if (root.requestAnimationFrame) root.requestAnimationFrame(syncNavOffset);
    syncQuoteBar();
    if (manage) {
      var first = doc.getElementById('cookieAcceptAll');
      if (first) first.focus();
    }
  }

  function choose(choice, byClick) {
    writeStored(choice);
    pushUpdate(choice, byClick);
    hide();
  }

  function openManage(source) {
    openedFrom = source || 'choice';
    paintSwitches(openedFrom === 'footer' ? readStored() : null);
    show('manage');
  }

  function closeManage() {
    if (openedFrom === 'footer' && readStored()) hide();
    else show('choice');
  }

  function onToggle(button, stateEl) {
    setSwitch(button, stateEl, !switchOn(button));
  }

  function focusables() {
    var nodes = banner.querySelectorAll('a[href], button:not([disabled])');
    var visible = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getClientRects().length) visible.push(nodes[i]);
    }
    return visible;
  }

  function onKey(event) {
    if (banner.style.display === 'none') return;
    if (event.key === 'Escape' && banner.classList.contains('is-manage')) {
      event.preventDefault();
      closeManage();
      return;
    }
    if (event.key !== 'Tab' || !banner.classList.contains('is-manage')) return;
    var nodes = focusables();
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindClick(id, fn) {
    var el = doc.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  bindClick('cookieAccept', function () { choose({ analytics: true, ads: true }, true); });
  bindClick('cookieReject', function () { choose({ analytics: false, ads: false }, true); });
  bindClick('cookieAcceptAll', function () { choose({ analytics: true, ads: true }, true); });
  bindClick('cookieRejectAll', function () { choose({ analytics: false, ads: false }, true); });
  bindClick('cookieSave', function () {
    choose({ analytics: switchOn(analyticsSwitch), ads: switchOn(adsSwitch) }, true);
  });
  bindClick('cookieManage', function () { openManage('choice'); });
  if (analyticsSwitch) analyticsSwitch.addEventListener('click', function () { onToggle(analyticsSwitch, analyticsState); });
  if (adsSwitch) adsSwitch.addEventListener('click', function () { onToggle(adsSwitch, adsState); });

  var settings = doc.querySelectorAll('a.sm-cookie-settings, a[href="#cookie-settings"]');
  for (var i = 0; i < settings.length; i++) {
    settings[i].addEventListener('click', function (event) {
      event.preventDefault();
      openManage('footer');
    });
  }

  doc.addEventListener('keydown', onKey);
  root.addEventListener('resize', syncNavOffset);
  root.addEventListener('scroll', function () {
    queueNavOffset();
    // Header and font shifts can move an in-flow button after the first frame.
    root.setTimeout(queueNavOffset, 150);
    root.setTimeout(queueNavOffset, 450);
  }, { passive: true });
  root.setTimeout(queueNavOffset, 400);
  root.setTimeout(queueNavOffset, 1000);
  var quoteBar = doc.querySelector('.mobile-bottom-bar');
  if (quoteBar && typeof root.MutationObserver === 'function') {
    new root.MutationObserver(queueNavOffset).observe(quoteBar, { attributes: true, attributeFilter: ['class'] });
  }
  var brochureForm = doc.getElementById('brochureRequest');
  if (brochureForm && typeof root.MutationObserver === 'function') {
    new root.MutationObserver(queueNavOffset).observe(brochureForm, { attributes: true, subtree: true, attributeFilter: ['hidden', 'class'] });
  }
  if (typeof root.ResizeObserver === 'function' && doc.body) {
    new root.ResizeObserver(queueNavOffset).observe(doc.body);
  }
  if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') {
    doc.fonts.ready.then(queueNavOffset);
  }
  if (typeof root.IntersectionObserver === 'function') {
    var offsetObserver = new root.IntersectionObserver(queueNavOffset);
    var navEl = doc.querySelector('.mobile-bottom-nav');
    var dotEl = doc.querySelector('.mobile-bottom-nav .nav-icon-bg');
    if (navEl) offsetObserver.observe(navEl);
    if (dotEl) offsetObserver.observe(dotEl);
    var introEl = doc.getElementById('quoteIntro');
    if (introEl) offsetObserver.observe(introEl);
  }
  root.addEventListener('hashchange', function () {
    if (root.location && root.location.hash === '#cookie-settings') openManage('footer');
  });

  root.acceptCookies = function () { choose({ analytics: true, ads: true }, true); };
  root.declineCookies = function () { choose({ analytics: false, ads: false }, true); };
  root.openCookieSettings = function () { openManage('footer'); };

  var stored = readStored();
  if (!stored) {
    paintSwitches(null);
    show('choice');
  } else if (stored.analytics || stored.ads) {
    pushUpdate(stored, false);
    hide();
  } else {
    hide();
  }
  if (root.location && root.location.hash === '#cookie-settings') openManage('footer');
  };
  if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(bootCookie, { timeout: 50 });
  else bootCookie();
})(typeof globalThis !== 'undefined' ? globalThis : this);
