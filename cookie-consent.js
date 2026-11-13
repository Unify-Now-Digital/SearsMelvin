/* Cookie choice card.
   Phone (768px and below): inset card above the bottom nav. No visible heading.
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

  function syncNavOffset() {
    var navBox = shownBox(doc.querySelector('.mobile-bottom-nav'));
    var height = navBox ? Math.round(navBox.height) : 0;
    doc.documentElement.style.setProperty('--ck-nav', height + 'px');
    if (banner.classList.contains('is-manage') || root.innerWidth > 768) return;
    if (banner.style.display === 'none') return;
    var dot = shownBox(doc.querySelector('.mobile-bottom-nav .nav-icon-bg'));
    if (!dot || dot.bottom < 0 || dot.top > root.innerHeight) return;
    var card = banner.getBoundingClientRect();
    if (!card.height) return;
    var need = Math.ceil(card.bottom - (dot.top - 12));
    if (need > 0 && need < root.innerHeight / 2) {
      doc.documentElement.style.setProperty('--ck-nav', (height + need) + 'px');
    }
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
