/* Microsoft Clarity, loaded only after analytics consent.
   Masking runs always and makes no network request.
   The project id is read at runtime from /api/config (clarityProjectId).
   It is never stored in this file, the DOM, storage or logs.
   After consent, enquiry event names and a few custom tags are sent.
   Payloads, form values, and click ids are not. */
(function (root) {
  var doc = root.document;
  if (!doc) return;

  var MASK = 'data-clarity-mask';
  var ROOT_IDS = ['contactForm', 'quoteForm', 'brochureRequest', 'appointmentForm',
    'apptFormFields', 'shortlistEnquiry', 'emailLookup', 'portalLookupForm',
    'portalView', 'orderView', 'quotesListView', 'singleQuoteView',
    'qsInscription', 'brochureThanks'];

  function mask(el) {
    if (el && el.setAttribute) el.setAttribute(MASK, 'True');
  }

  function applyMasks() {
    var i, nodes;
    for (i = 0; i < ROOT_IDS.length; i++) mask(doc.getElementById(ROOT_IDS[i]));
    nodes = doc.querySelectorAll('form');
    for (i = 0; i < nodes.length; i++) mask(nodes[i]);
    nodes = doc.querySelectorAll('input, textarea, select');
    for (i = 0; i < nodes.length; i++) {
      var f = nodes[i];
      var type = (f.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button') continue;
      if (f.closest && f.closest('[' + MASK + '="True"]')) continue;
      mask(f);
      if (f.parentElement) mask(f.parentElement);
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', applyMasks);
  else applyMasks();

  var path = (root.location && root.location.pathname) || '';
  if (/^\/(admin|admin-products|partner|track|quote)(\.html)?(\/|$)/.test(path)) return;

  var waiting = false;
  var injected = false;
  var latest = null;
  var pending = [];
  var tagsSent = false;
  var hooked = false;
  var landing = { paid: '', source: '' };
  var seen = (typeof WeakSet === 'function') ? new WeakSet() : null;

  var MIRRORED = {
    sm_quote_submit: 1,
    sm_lead_submit: 1,
    brochure_download: 1,
    brochure_request: 1,
    click_to_call: 1,
    sm_chat_submit: 1
  };

  function readStored() {
    try {
      var api = root.smCookieConsent;
      if (!api || !root.localStorage) return null;
      return api.readChoice(root.localStorage.getItem('cookieConsent'));
    } catch (e) { return null; }
  }

  function sendConsent(choice) {
    if (typeof root.clarity !== 'function') return;
    try {
      root.clarity('consentv2', {
        ad_Storage: choice.ads ? 'granted' : 'denied',
        analytics_Storage: choice.analytics ? 'granted' : 'denied'
      });
    } catch (e) {}
  }

  function inject(id) {
    if (injected) return;
    injected = true;
    (function (c, l, a, r, i, t, y) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(root, doc, 'clarity', 'script', id);
  }

  function fetchAndLoad() {
    if (typeof root.fetch !== 'function') return;
    try {
      root.fetch('/api/config', { credentials: 'same-origin' })
        .then(function (res) { return res && res.ok ? res.json() : null; })
        .then(function (cfg) {
          var id = cfg && typeof cfg.clarityProjectId === 'string' ? cfg.clarityProjectId : '';
          if (!id || !latest || !latest.analytics) return;
          inject(id);
          sendConsent(latest);
          flushEvents();
        })
        .then(null, function () {});
    } catch (e) {}
  }

  function kickIdle() {
    function run() {
      waiting = false;
      fetchAndLoad();
    }
    if (typeof root.requestIdleCallback === 'function') {
      root.requestIdleCallback(run, { timeout: 3000 });
    } else {
      root.setTimeout(run, 1);
    }
  }

  function schedule() {
    if (injected || waiting) return;
    waiting = true;
    if (doc.readyState === 'complete') kickIdle();
    else root.addEventListener('load', function onLoad() {
      if (typeof root.removeEventListener === 'function') root.removeEventListener('load', onLoad);
      kickIdle();
    });
  }

  function onChoice(choice) {
    if (!choice) return;
    latest = { analytics: !!choice.analytics, ads: !!choice.ads };
    if (!latest.analytics) {
      // Never inject on reject; tell an already-loaded Clarity.
      if (injected) sendConsent(latest);
      return;
    }
    if (injected) {
      sendConsent(latest);
      flushEvents();
    } else schedule();
  }

  function clarityReady() {
    return injected && latest && latest.analytics && typeof root.clarity === 'function';
  }

  function alreadySeen(item) {
    try {
      if (!seen || !item || (typeof item !== 'object' && typeof item !== 'function')) return false;
      if (seen.has(item)) return true;
      seen.add(item);
    } catch (e) {}
    return false;
  }

  function eventNameOf(item) {
    try {
      if (!item || typeof item !== 'object') return '';
      if (typeof item.event === 'string') return item.event;
      if (item[0] === 'event' && typeof item[1] === 'string') return item[1];
    } catch (e) {}
    return '';
  }

  function note(item) {
    var name = eventNameOf(item);
    if (!MIRRORED[name] || alreadySeen(item)) return;
    if (pending.length < 40) pending.push(name);
  }

  function enqueue(name) {
    if (!name || pending.length >= 40) return;
    pending.push(name);
    flushEvents();
  }

  function hookDataLayer() {
    var dl = root.dataLayer;
    if (!dl || typeof dl.push !== 'function') {
      root.dataLayer = [];
      dl = root.dataLayer;
    }
    if (!hooked) {
      hooked = true;
      for (var i = 0; i < dl.length; i++) note(dl[i]);
    }
    if (dl.push && dl.push.__smClarity) return;
    var orig = dl.push;
    var wrapped = function () {
      var result = orig.apply(this, arguments);
      try {
        for (var a = 0; a < arguments.length; a++) note(arguments[a]);
      } catch (e) {}
      flushEvents();
      return result;
    };
    wrapped.__smClarity = true;
    dl.push = wrapped;
  }

  function pageType(pathname) {
    var p = String(pathname || '/').toLowerCase();
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    if (p.endsWith('.html')) p = p.slice(0, -5);
    if (p === '' || p === '/' || p === '/index') return 'home';
    if (p === '/memorials') return 'memorials_list';
    if (p === '/memorials/type' || p.indexOf('/memorials/type/') === 0) return 'memorials_list';
    if (p.indexOf('/memorials/') === 0) return 'memorial_product';
    if (p === '/areas') return 'area_hub';
    if (p.indexOf('/areas/') === 0) {
      var rest = p.slice('/areas/'.length).split('/').filter(Boolean);
      if (rest.length >= 2) return 'area_cemetery';
      if (rest.length === 1) return 'area_borough';
      return 'area_hub';
    }
    if (p === '/brochure') return 'brochure';
    if (p === '/about') return 'about';
    if (p === '/faq') return 'faq';
    if (p === '/contact') return 'contact';
    return 'other';
  }

  function cleanSource(value) {
    var s = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(s)) return '';
    return s;
  }

  function queryMap(search) {
    var map = {};
    var q = String(search || '');
    var hash = q.indexOf('#');
    if (hash !== -1) q = q.slice(0, hash);
    if (q.charAt(0) === '?') q = q.slice(1);
    if (!q) return map;
    var parts = q.split('&');
    for (var i = 0; i < parts.length; i++) {
      var bit = parts[i];
      if (!bit) continue;
      var eq = bit.indexOf('=');
      var k = eq === -1 ? bit : bit.slice(0, eq);
      var v = eq === -1 ? '' : bit.slice(eq + 1);
      try {
        k = decodeURIComponent(k.replace(/\+/g, ' '));
        v = decodeURIComponent(v.replace(/\+/g, ' '));
      } catch (e) {}
      if (map[k] == null || map[k] === '') map[k] = v;
    }
    return map;
  }

  function captureLanding() {
    var stored = null;
    try {
      var raw = root.sessionStorage && root.sessionStorage.getItem('sm_clarity_landing');
      if (raw) stored = JSON.parse(raw);
    } catch (e) { stored = null; }
    if (stored && typeof stored === 'object' && stored.v === 1) {
      return {
        paid: stored.paid === 'yes' ? 'yes' : '',
        source: cleanSource(stored.source)
      };
    }
    var params;
    try { params = queryMap(root.location && root.location.search); }
    catch (e) { params = {}; }
    var gclid = params.gclid || '';
    var medium = String(params.utm_medium || '').toLowerCase();
    var paid = (gclid || params.gbraid || params.wbraid || medium === 'cpc') ? 'yes' : '';
    var source = gclid ? 'google_ads' : cleanSource(params.utm_source || '');
    var rec = { paid: paid, source: source };
    try {
      if (root.sessionStorage) {
        root.sessionStorage.setItem('sm_clarity_landing', JSON.stringify({ v: 1, paid: rec.paid, source: rec.source }));
      }
    } catch (e) {}
    return rec;
  }

  function sendTags() {
    if (tagsSent || !clarityReady()) return;
    tagsSent = true;
    try {
      root.clarity('set', 'page_type', pageType(path));
      if (landing.paid === 'yes') root.clarity('set', 'paid_landing', 'yes');
      if (landing.source) root.clarity('set', 'landing_source', landing.source);
    } catch (e) {}
  }

  function flushEvents() {
    hookDataLayer();
    var dl = root.dataLayer;
    if (dl && dl.length) {
      for (var i = 0; i < dl.length; i++) note(dl[i]);
    }
    if (!clarityReady()) return;
    sendTags();
    if (!pending.length) return;
    var batch = pending;
    pending = [];
    for (var n = 0; n < batch.length; n++) {
      try { root.clarity('event', batch[n]); } catch (e) {}
    }
  }

  function clickKind(href) {
    var h = String(href || '').replace(/^\s+/, '').toLowerCase();
    if (!h) return '';
    if (h.indexOf('wa.me') !== -1 || h.indexOf('api.whatsapp.com') !== -1 || h.indexOf('whatsapp:') !== -1) {
      return 'whatsapp_click';
    }
    // The site does not push click_to_call. GTM fires that name from the tel click.
    if (h.indexOf('tel:') === 0) return 'click_to_call';
    return '';
  }

  function onDocClick(e) {
    try {
      var node = e && e.target;
      if (!node || typeof node.closest !== 'function') return;
      var a = node.closest('a');
      if (!a || typeof a.getAttribute !== 'function') return;
      var kind = clickKind(a.getAttribute('href'));
      if (kind) enqueue(kind);
    } catch (err) {}
  }

  landing = captureLanding();
  hookDataLayer();
  doc.addEventListener('click', onDocClick);
  root.addEventListener('load', function () { hookDataLayer(); });
  root.addEventListener('sm-cookie-consent', function (e) { onChoice(e && e.detail); });
  onChoice(readStored());
})(window);
