/* Cookie choice card.
   Phone (768px and below): slim full-width strip above the bottom nav.
   Memorial pages at 1024px and below use the same strip, above the phone bar.
   No visible heading on that strip.
   Desktop: bottom-left card with the heading "Your cookie choices".
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

  function quoteLabel(el) {
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return text === 'Get a quote' || text === 'Request your quote';
  }

  function syncNavOffset() {
    var navBox = shownBox(doc.querySelector('.mobile-bottom-nav'));
    var navHeight = navBox ? Math.round(navBox.height) : 0;
    doc.documentElement.style.setProperty('--ck-nav', navHeight + 'px');
    var manage = banner.classList.contains('is-manage');
    var hidden = banner.style.display === 'none';
    var memorial = !!(doc.body && doc.body.classList.contains('memorial-page'));
    var slim = root.innerWidth <= 768 || (memorial && root.innerWidth <= 1024);
    if (manage || hidden || !slim) {
      if (banner.style.bottom) banner.style.bottom = '';
      return;
    }

    var gap = 8;
    var floor = 0;
    var bar = shownBox(doc.querySelector('.mobile-bottom-bar.is-visible'));
    if (bar) floor = Math.round(bar.height);
    else if (navBox && root.innerWidth <= 768 && navBox.top < (root.innerHeight || 0) && navBox.bottom > 0) floor = navHeight;

    var vh = root.innerHeight || 0;
    var card = banner.getBoundingClientRect();
    var naturalTop = vh - floor - (card.height || 0);
    var need = floor;
    var selectors = [
      '#quoteIntro button',
      '#quoteIntro .btn',
      '.product-quote-intro button',
      '.mobile-bottom-bar.is-visible .btn-primary'
    ];
    var seen = [];

    function consider(el) {
      if (!el || seen.indexOf(el) !== -1) return;
      seen.push(el);
      var box = shownBox(el);
      if (!box || !vh) return;
      if (box.bottom <= 0 || box.top >= vh) return;
      if (card.height && box.bottom <= naturalTop + 0.5) return;
      if (box.top >= vh - floor - 0.5) return;
      var above = Math.ceil(vh - box.top + gap);
      if (above > need) need = above;
    }

    var i;
    var j;
    for (i = 0; i < selectors.length; i++) {
      var nodes = doc.querySelectorAll(selectors[i]);
      for (j = 0; j < nodes.length; j++) consider(nodes[j]);
    }
    var controls = doc.querySelectorAll('button, a');
    for (i = 0; i < controls.length; i++) {
      var control = controls[i];
      if (!quoteLabel(control)) continue;
      if (control.closest && control.closest('#cookieConsent, nav, #navbar, .mobile-bottom-nav')) continue;
      consider(control);
    }

    if (!bar && root.innerWidth <= 768) {
      var dot = shownBox(doc.querySelector('.mobile-bottom-nav .nav-icon-bg'));
      if (dot && dot.bottom >= 0 && dot.top <= vh) {
        var dotClear = Math.ceil(vh - (dot.top - 12));
        if (dotClear > floor && dotClear < vh / 2) {
          doc.documentElement.style.setProperty('--ck-nav', dotClear + 'px');
        }
        if (dotClear > need) need = dotClear;
      }
    }

    banner.style.bottom = need + 'px';
    var placed = banner.getBoundingClientRect();
    var placedIntro = shownBox(doc.querySelector('#quoteIntro button, #quoteIntro .btn'));
    if (placedIntro && placedIntro.top < placed.bottom - 0.5 && placedIntro.bottom > placed.top) {
      var corrected = Math.ceil(vh - placedIntro.top + gap);
      if (corrected > need) banner.style.bottom = corrected + 'px';
    }
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

  function hide() {
    banner.style.display = 'none';
    banner.classList.remove('is-manage');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-labelledby', 'cookieTitle');
    if (scrim) scrim.classList.remove('is-on');
    doc.body.classList.remove('sm-cookie-manage');
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
})(typeof globalThis !== 'undefined' ? globalThis : this);
