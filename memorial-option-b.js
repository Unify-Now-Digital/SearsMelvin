(function () {
    'use strict';

    var phoneQuery = window.matchMedia('(max-width: 767px)');
    var WA_NUMBER = '442038352548';
    var WA_PLACEHOLDERS = {
        '': true,
        Memorial: true,
        'Product not found': true,
        'This memorial is not listed': true,
        'Error loading product': true
    };

    function text(id) {
        var element = document.getElementById(id);
        return element ? element.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    function canonicalPageUrl() {
        var canon = document.querySelector('link[rel="canonical"]');
        var href = canon && canon.getAttribute('href');
        if (href) {
            try {
                var parsed = new URL(href, 'https://searsmelvin.co.uk');
                if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                    return parsed.origin + parsed.pathname;
                }
            } catch (e) { /* fall through */ }
        }
        var path = (window.location && window.location.pathname) || '/';
        return 'https://searsmelvin.co.uk' + path;
    }

    function productNameForPrefill() {
        var name = text('productName');
        return WA_PLACEHOLDERS[name] ? '' : name;
    }

    function whatsappMessage() {
        var url = canonicalPageUrl();
        var name = productNameForPrefill();
        if (name) return "Hi, I'm interested in the " + name + " memorial: " + url;
        return "Hi, I'd like some help choosing a memorial: " + url;
    }

    function applyWhatsAppPrefill() {
        var href = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(whatsappMessage());
        document.querySelectorAll('a[data-sm-whatsapp]').forEach(function (link) {
            link.setAttribute('href', href);
        });
    }

    function selectedExtras() {
        var extras = [];
        document.querySelectorAll('input[name="addon"]:checked').forEach(function (input) {
            var card = input.closest('.addon-card');
            var label = card && card.querySelector('.addon-name');
            extras.push(label ? label.textContent.trim().toLowerCase() : input.value);
        });
        var inscription = document.getElementById('inscriptionInput');
        if (inscription && inscription.value.trim()) extras.push('inscription added');
        return extras.length ? extras.join(', ') : 'no extras';
    }

    function mirrorChoices() {
        var colour = text('selectedColourName');
        var chosen = document.getElementById('pdpBChosenColour');
        var barColour = document.getElementById('mobileBarColour');
        var line = document.getElementById('pdpBChoicesLine');
        var total = document.getElementById('pdpBTotal');
        if (chosen) chosen.textContent = colour;
        if (barColour) barColour.textContent = colour;
        if (line) line.textContent = [text('productName'), colour, selectedExtras()].filter(Boolean).join(' · ');
        if (total) total.textContent = text('priceTotal') || '—';
        mirrorStone();
        applyWhatsAppPrefill();
    }

    function mirrorStone() {
        var target = document.getElementById('mobileBarStone');
        var checked = document.querySelector('#stoneColourOptions input[name="colour"]:checked');
        var swatch = checked && checked.closest('.colour-option') && checked.closest('.colour-option').querySelector('.colour-swatch');
        if (!target || !swatch) return;
        var style = window.getComputedStyle(swatch);
        target.style.backgroundColor = style.backgroundColor;
        target.style.backgroundImage = style.backgroundImage;
        var image = swatch.querySelector('img');
        if (image && image.currentSrc) target.style.backgroundImage = 'url("' + image.currentSrc.replace(/"/g, '%22') + '")';
        target.style.backgroundSize = 'cover';
        target.style.backgroundPosition = 'center';
    }

    function selectTab(tab, focus) {
        if (!phoneQuery.matches) return;
        var tabs = Array.from(document.querySelectorAll('.pdp-b-tabs [role="tab"]'));
        tabs.forEach(function (item) {
            var selected = item === tab;
            item.setAttribute('aria-selected', selected ? 'true' : 'false');
            item.tabIndex = selected ? 0 : -1;
            var panel = document.getElementById(item.getAttribute('aria-controls'));
            if (panel) panel.hidden = !selected;
        });
        if (focus) tab.focus();
    }

    function setupTabs() {
        var tabs = Array.from(document.querySelectorAll('.pdp-b-tabs [role="tab"]'));
        tabs.forEach(function (tab, index) {
            tab.addEventListener('click', function () { selectTab(tab, false); });
            tab.addEventListener('keydown', function (event) {
                var next = null;
                if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
                if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
                if (event.key === 'Home') next = tabs[0];
                if (event.key === 'End') next = tabs[tabs.length - 1];
                if (!next) return;
                event.preventDefault();
                selectTab(next, true);
            });
        });
        if (phoneQuery.matches && tabs[0]) selectTab(tabs[0], false);
    }

    document.addEventListener('click', function (event) {
        var link = event.target.closest('a[data-sm-whatsapp]');
        if (!link) return;
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'whatsapp_click', link_location: link.dataset.smWhatsapp });
    });

    document.addEventListener('change', function (event) {
        if (event.target.matches('input[name="colour"], input[name="addon"]')) mirrorChoices();
    });
    document.addEventListener('input', function (event) {
        if (event.target.id === 'inscriptionInput') mirrorChoices();
    });

    function start() {
        setupTabs();
        ['selectedColourName', 'priceTotal', 'productName', 'addonsLabel'].forEach(function (id) {
            var element = document.getElementById(id);
            if (element) new MutationObserver(mirrorChoices).observe(element, { childList: true, subtree: true, characterData: true });
        });
        var addonsGrid = document.getElementById('addonsGrid');
        if (addonsGrid) new MutationObserver(mirrorChoices).observe(addonsGrid, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'checked'] });
        var canon = document.querySelector('link[rel="canonical"]');
        if (canon) new MutationObserver(applyWhatsAppPrefill).observe(canon, { attributes: true, attributeFilter: ['href'] });
        mirrorChoices();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
}());
