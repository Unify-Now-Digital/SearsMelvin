/* Microsoft Clarity, loaded only after analytics consent.
   Masking runs always and makes no network request.
   The project id is read at runtime from /api/config (clarityProjectId).
   It is never stored in this file, the DOM, storage or logs. */
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
    if (injected) sendConsent(latest);
    else schedule();
  }

  root.addEventListener('sm-cookie-consent', function (e) { onChoice(e && e.detail); });
  onChoice(readStored());
})(window);
