(function () {
    'use strict';

    var phoneQuery = window.matchMedia('(max-width: 767px)');

    function text(id) {
        var element = document.getElementById(id);
        return element ? element.textContent.replace(/\s+/g, ' ').trim() : '';
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

    document.addEventListener('DOMContentLoaded', function () {
        setupTabs();
        ['selectedColourName', 'priceTotal', 'productName', 'addonsLabel'].forEach(function (id) {
            var element = document.getElementById(id);
            if (element) new MutationObserver(mirrorChoices).observe(element, { childList: true, subtree: true, characterData: true });
        });
        new MutationObserver(mirrorChoices).observe(document.getElementById('addonsGrid'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'checked'] });
        mirrorChoices();
    });
}());
