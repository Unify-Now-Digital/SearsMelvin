/**
 * Borough and cemetery pages at /areas, /areas/<borough> and
 * /areas/<borough>/<cemetery>. Copy and coordinates come from
 * data/boroughs.json. The About document supplies the header, footer,
 * consent defaults and GTM container.
 *
 * data/boroughs.cjs is the loader. Pages compiles Functions with Wrangler 3,
 * which rejects `import … with { type: "json" }`.
 */

import areaData from "../data/boroughs.cjs";
import { publishableKey, publicSupabaseUrl, supabaseKeyHeaders } from "./api/_supabase-keys.js";

const BASE = "https://searsmelvin.co.uk";
const SM_ORG_ID = "3770972d-1bbd-417b-b413-297e844db285";
const SHOWROOM = areaData.showroom;
const MILES = 3958.7613;

const STEPS = [
  ["Choose the design", "Look through the memorials and choose a design."],
  ["We check the rules", "We check what the cemetery allows before the stone is made."],
  ["We apply for the permit", "We prepare the application and send it to the cemetery."],
  ["Fixing", "The memorial is fixed after the cemetery has agreed."],
];

const QUESTIONS = [
  ["Do I need a permit?", "Most cemeteries need a permit before a memorial is placed. We handle the application with the cemetery for you."],
  ["Can you place a memorial at any cemetery?", "We check the cemetery's rules first. What can be placed depends on that cemetery."],
  ["How long does it take?", "It depends on the cemetery."],
];

const AREA_CSS = `
.area-page { width: min(72rem, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0 4rem; }
.area-crumbs ol { display: flex; flex-wrap: wrap; gap: 0.35rem 0.5rem; list-style: none; margin: 0 0 1rem; padding: 0; }
.area-crumbs li:not(:last-child)::after { content: "/"; margin-left: 0.5rem; color: var(--sm-color-text-muted); }
.area-hero { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(16rem, 0.85fr); gap: 2rem; align-items: start; }
.area-hero h1 { font-family: var(--sm-font-display); font-weight: var(--sm-weight-display); font-size: var(--sm-text-3xl); line-height: 1.1; margin: 0 0 0.75rem; }
.area-hero p { max-width: 40rem; }
.area-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; margin: 1rem 0; padding: 0; }
.area-chips a, .area-chips span { display: inline-flex; align-items: center; min-height: 44px; padding: 0.25rem 0.75rem; border: 1px solid var(--sm-color-border-decorative); border-radius: var(--sm-radius-sm); color: var(--sm-color-text); text-decoration: none; background: var(--sm-color-bg-panel); }
.area-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 1rem 0 0; }
.area-map { position: relative; height: 240px; min-height: 240px; background: var(--sm-color-bg-surface); border: 1px solid var(--sm-color-border-decorative); border-radius: var(--sm-radius-sm); overflow: hidden; }
.area-map-hold, .area-map-canvas { position: absolute; inset: 0; height: 240px; }
.area-map-hold { display: flex; align-items: center; justify-content: center; }
.area-map-hold a { min-height: 44px; display: inline-flex; align-items: center; }
.area-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; list-style: none; margin: 0; padding: 0; }
.area-card { border: 1px solid var(--sm-color-border-decorative); border-radius: var(--sm-radius-sm); background: var(--sm-color-bg-panel); padding: 1rem 1rem 0.75rem; }
.area-card h3 { font-family: var(--sm-font-display); font-weight: var(--sm-weight-display); font-size: var(--sm-text-card-title); line-height: 1.2; margin: 0.2rem 0 0.5rem; }
.area-num { color: var(--sm-color-text-muted); font-size: 0.9rem; }
.area-tag { display: inline-block; margin: 0 0 0.5rem; padding: 0.1rem 0.45rem; border: 1px solid var(--sm-color-border-decorative); border-radius: var(--sm-radius-sm); font-size: 0.85rem; }
.area-card p { margin: 0.15rem 0; }
.area-card .area-links { display: flex; flex-wrap: wrap; gap: 0.75rem 1rem; margin-top: 0.5rem; }
.area-card .area-links a { min-height: 44px; display: inline-flex; align-items: center; }
.area-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; }
.area-steps li { margin: 0; padding-top: 0.75rem; border-top: 1px solid var(--sm-color-border-decorative); }
.area-step-num { display: block; font-family: var(--sm-font-display); font-size: 1.5rem; }
.area-products { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
.area-products a.product-card { display: block; text-decoration: none; color: inherit; }
.area-products .product-image { aspect-ratio: 4 / 5; }
.area-products .product-image img { width: 100%; height: 100%; object-fit: contain; }
.area-faq details { border-bottom: 1px solid var(--sm-color-border-decorative); }
.area-faq summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 500; }
.area-band { background: var(--sm-color-bg-inverse); color: var(--sm-color-text-inverse); padding: 2.5rem 1.5rem; border-radius: var(--sm-radius-sm); margin: 2.5rem 0; }
.area-band h2, .area-band p { color: var(--sm-color-text-inverse); }
.area-band a { color: var(--sm-color-text-inverse); }
.area-band-quote { display: inline-flex; align-items: center; min-height: 44px; padding: 0.75rem 1.25rem; background: var(--sm-color-bg); color: var(--sm-color-text); text-decoration: none; border-radius: var(--sm-radius-sm); }
.area-details { width: 100%; border-collapse: collapse; }
.area-details th, .area-details td { text-align: left; vertical-align: top; padding: 0.7rem 0; border-bottom: 1px solid var(--sm-color-border-decorative); }
.area-details th { width: 9rem; font-weight: 500; }
.area-section { margin-top: 2.5rem; }
@media (max-width: 860px) {
  .area-hero, .area-cards, .area-steps { grid-template-columns: 1fr 1fr; }
  .area-hero { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .area-cards, .area-steps, .area-products { grid-template-columns: 1fr; }
}
`;

export function visibleField(value) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (!text || /^(not checked|not stated)$/i.test(text)) return "";
  return text;
}

export function areaPaths() {
  const paths = ["/areas"];
  for (const borough of areaData.boroughs) {
    paths.push(`/areas/${borough.slug}`);
    for (const cemetery of borough.cemeteries) paths.push(`/areas/${borough.slug}/${cemetery.slug}`);
  }
  return paths;
}

export function milesBetween(a, b) {
  if (!Number.isFinite(a?.latitude) || !Number.isFinite(b?.latitude)) return null;
  const rad = (deg) => deg * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatMiles(miles) {
  if (!Number.isFinite(miles)) return "";
  return `From showroom: ${miles.toFixed(1)} miles, straight line`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function jsonScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function hasGeo(place) {
  return Number.isFinite(place?.latitude) && Number.isFinite(place?.longitude);
}

function mapsHref(name, postcode, boroughName) {
  const query = postcode ? `${name}, ${postcode}` : `${name}, ${boroughName}, London`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function checkedLabel() {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(visibleField(areaData.checked));
  if (!match) return "";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = months[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : "";
}

function allCemeteries() {
  return areaData.boroughs.flatMap((borough) => borough.cemeteries.map((cemetery) => ({ ...cemetery, borough })));
}

function findCemetery(boroughSlug, cemeterySlug) {
  const borough = areaData.boroughs.find((item) => item.slug === boroughSlug);
  if (!borough) return null;
  const cemetery = borough.cemeteries.find((item) => item.slug === cemeterySlug);
  return cemetery ? { borough, cemetery } : null;
}

const SHOWROOM_MAP = "https://www.google.com/maps/search/?api=1&query=1+The+Market+Place+Falloden+Way+London+NW11+6LB";

const MAP_BOOT = `<script>
(function () {
  var root = document.querySelector(".area-map");
  if (!root) return;
  var button = root.querySelector(".area-map-show");
  var hold = root.querySelector(".area-map-hold");
  var canvas = root.querySelector(".area-map-canvas");
  var dataNode = root.querySelector(".area-map-points");
  if (!button || !hold || !canvas || !dataNode) return;
  var points = [];
  try { points = JSON.parse(dataNode.textContent); } catch (e) { points = []; }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch];
    });
  }
  function fallback() {
    var link = document.createElement("a");
    link.href = root.getAttribute("data-fallback") || ${JSON.stringify(SHOWROOM_MAP)};
    link.rel = "noopener noreferrer";
    link.textContent = "Open in Google Maps";
    hold.replaceChildren(link);
  }
  function usable(list) {
    return (list || []).filter(function (point) {
      return point && typeof point.lat === "number" && typeof point.lng === "number" &&
        typeof point.href === "string" && point.href.charAt(0) === "/" && point.href.indexOf("//") !== 0;
    });
  }
  function draw(list) {
    var places = usable(list);
    if (!places.length || !window.google || !google.maps) { fallback(); return; }
    hold.hidden = true;
    canvas.hidden = false;
    var map = new google.maps.Map(canvas, { mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
    var bounds = new google.maps.LatLngBounds();
    var open = null;
    places.forEach(function (point) {
      var position = { lat: point.lat, lng: point.lng };
      bounds.extend(position);
      var marker = new google.maps.Marker({ map: map, position: position, title: String(point.name || "") });
      var label = point.href === "/contact" ? "Visit the showroom" : "Cemetery page";
      var info = new google.maps.InfoWindow({
        content: "<p><strong>" + esc(point.name) + "</strong></p><p><a href=\\"" + esc(point.href) + "\\">" + label + "</a></p>"
      });
      marker.addListener("click", function () {
        if (open) open.close();
        info.open({ map: map, anchor: marker });
        open = info;
      });
    });
    if (places.length === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(14);
    } else {
      map.fitBounds(bounds, 48);
    }
  }
  button.addEventListener("click", function () {
    if (button.disabled) return;
    button.disabled = true;
    fetch("/api/config").then(function (res) { return res.json(); }).then(function (cfg) {
      var key = cfg && typeof cfg.googleMapsKey === "string" ? cfg.googleMapsKey : "";
      if (!key) { fallback(); return; }
      window.__smAreaMapReady = function () {
        try { draw(points); } catch (e) { fallback(); }
      };
      var script = document.createElement("script");
      script.async = true;
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&loading=async&callback=__smAreaMapReady";
      script.onerror = fallback;
      document.head.appendChild(script);
    }).catch(fallback);
  });
})();
</script>`;

function mapMarker(place, name, href) {
  if (!hasGeo(place) || !String(href || "").startsWith("/")) return null;
  return { lat: place.latitude, lng: place.longitude, name, href };
}

function mapHtml(markers, fallbackUrl) {
  const clean = markers.filter(Boolean);
  if (!clean.length) return "";
  const json = JSON.stringify(clean).replace(/</g, "\\u003c");
  return `<div class="area-map" data-fallback="${escapeHtml(fallbackUrl)}"><div class="area-map-hold"><button type="button" class="sm-btn sm-btn-secondary area-map-show">Show map</button></div><div class="area-map-canvas" hidden></div><script type="application/json" class="area-map-points">${json}</script></div>`;
}

function chipsHtml(items) {
  return `<ul class="area-chips">${items.filter(Boolean).map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function stepsHtml(heading) {
  const items = STEPS.map(([title, text], index) =>
    `<li><span class="area-step-num">${index + 1}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></li>`
  ).join("");
  return `<section class="area-section"><h2>${escapeHtml(heading)}</h2><ol class="area-steps">${items}</ol></section>`;
}

function questionsHtml() {
  const items = QUESTIONS.map(([q, a]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join("");
  return `<section class="area-section area-faq"><h2>Common questions</h2>${items}</section>`;
}

function bandHtml() {
  return `<section class="area-band"><h2>Talk it through with us</h2><p>${escapeHtml(SHOWROOM.address)}</p><p>${escapeHtml(SHOWROOM.hours)}</p><p class="area-actions"><a class="area-band-quote" href="/contact">Request a quote</a><a href="tel:+442038352548">020 3835 2548</a></p></section>`;
}

function otherAreasHtml(currentSlug) {
  const links = areaData.boroughs
    .filter((borough) => borough.slug !== currentSlug)
    .map((borough) => `<li><a href="/areas/${borough.slug}">${escapeHtml(borough.name)}</a></li>`)
    .join("");
  return `<section class="area-section"><h2>Other areas</h2><ul class="area-chips">${links}</ul></section>`;
}

function safeSlug(value) {
  const slug = String(value || "").toLowerCase();
  return /^[a-z0-9-]{1,120}$/.test(slug) ? slug : "";
}

function productImageUrl(product) {
  const raw = String(product?.image_url || "");
  if (!raw || raw.length > 2048) return "";
  try {
    const supabase = publicSupabaseUrl({});
    const url = new URL(raw, supabase);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (url.pathname.startsWith("/storage/") || url.pathname.startsWith("/rest/")) {
      const host = new URL(supabase);
      url.protocol = host.protocol;
      url.host = host.host;
    }
    return url.href;
  } catch {
    return "";
  }
}

function productsHtml(products) {
  const cards = (products || []).slice(0, 6).map((product) => {
    const slug = safeSlug(product.slug);
    const name = visibleField(product.name);
    const image = productImageUrl(product);
    if (!slug || !name || !image) return "";
    const category = visibleField(product.product_categories?.name);
    return `<a class="product-card" href="/memorials/${slug}"><div class="product-image"><img src="${escapeHtml(image)}" width="800" height="1000" alt="${escapeHtml(name)}" decoding="async" loading="lazy"></div><div class="product-info">${category ? `<span class="product-category">${escapeHtml(category)}</span>` : ""}<h3 class="product-name">${escapeHtml(name)}</h3></div></a>`;
  }).filter(Boolean);
  const grid = cards.length ? `<div class="area-products">${cards.join("")}</div>` : "";
  return `<section class="area-section"><h2>Some of our memorials</h2>${grid}<p><a href="/memorials">See all memorials</a></p></section>`;
}

function distanceLine(place) {
  const miles = milesBetween(SHOWROOM, place);
  return Number.isFinite(miles) ? formatMiles(miles) : "";
}

function cardHtml(cemetery, borough, index) {
  const postcode = visibleField(cemetery.postcode);
  const operator = visibleField(cemetery.operator);
  const burials = visibleField(cemetery.new_burials);
  const source = safeHttpUrl(cemetery.source);
  const distance = distanceLine(cemetery);
  const href = `/areas/${borough.slug}/${cemetery.slug}`;
  const bits = [
    `<p class="area-num">${index + 1}</p>`,
    `<h3>${escapeHtml(cemetery.name)}</h3>`,
    burials ? `<p class="area-tag">${escapeHtml(burials)}</p>` : "",
    postcode ? `<p>Postcode: ${escapeHtml(postcode)}</p>` : "",
    operator ? `<p>Operator: ${escapeHtml(operator)}</p>` : "",
    distance ? `<p>${escapeHtml(distance)}</p>` : "",
  ].filter(Boolean).join("");
  const links = [
    `<a href="${escapeHtml(mapsHref(cemetery.name, postcode, borough.name))}">Map</a>`,
    source ? `<a href="${escapeHtml(source)}" rel="noopener noreferrer">Official site</a>` : "",
  ].filter(Boolean).join("");
  return `<li class="area-card"><a href="${href}">${bits}</a><p class="area-links">${links}</p></li>`;
}

function crumbsHtml(items) {
  const list = items.map((item, index) => index === items.length - 1
    ? `<li aria-current="page">${escapeHtml(item.name)}</li>`
    : `<li><a href="${item.path}">${escapeHtml(item.name)}</a></li>`).join("");
  return `<nav class="area-crumbs" aria-label="Breadcrumb"><ol>${list}</ol></nav>`;
}

function heroButtons(primaryHref, primaryLabel, secondaryHref, secondaryLabel) {
  return `<p class="area-actions"><a class="sm-btn sm-btn-primary" href="${primaryHref}">${escapeHtml(primaryLabel)}</a><a class="sm-btn sm-btn-secondary" href="${escapeHtml(secondaryHref)}">${escapeHtml(secondaryLabel)}</a></p>`;
}

function pageModel(kind, borough, cemetery) {
  const checked = checkedLabel();
  if (kind === "hub") {
    const cards = areaData.boroughs.map((item) => {
      const count = item.cemeteries.length;
      const label = count === 1 ? "1 cemetery" : `${count} cemeteries`;
      return `<li class="area-card"><a href="/areas/${item.slug}"><h3>${escapeHtml(item.name)}</h3><p>${label}</p></a></li>`;
    }).join("");
    const points = [mapMarker(SHOWROOM, "Finchley showroom", "/contact")];
    for (const item of allCemeteries()) {
      points.push(mapMarker(item, item.name, `/areas/${item.borough.slug}/${item.slug}`));
    }
    return {
      path: "/areas",
      title: "Cemeteries in London | Sears Melvin",
      description: `Cemeteries in ${areaData.boroughs.map((item) => item.name).join(", ").replace(/, ([^,]*)$/, " and $1")}. Our Finchley showroom (NW11 6LB) serves families across London.`,
      h1: "Memorials for cemeteries in London",
      crumbs: [{ name: "Home", path: "/" }, { name: "Areas", path: "/areas" }],
      body: [
        `<div class="area-hero"><div>`,
        `<p>Our Finchley showroom (NW11 6LB) serves families across London.</p>`,
        `<p>Choose a borough to see the cemeteries there.</p>`,
        chipsHtml([
          `<span>${areaData.boroughs.length} boroughs</span>`,
          `<span>Finchley showroom ${escapeHtml(SHOWROOM.postcode)}</span>`,
          `<span>RQMF Registered No. 2263</span>`,
          `<span>Fixing included</span>`,
        ]),
        heroButtons("/contact", "Request a quote", "#boroughs", "See the boroughs"),
        `</div>${mapHtml(points, SHOWROOM_MAP)}</div>`,
        `<section class="area-section" id="boroughs"><h2>Boroughs</h2><ul class="area-cards">${cards}</ul></section>`,
        bandHtml(),
      ].join(""),
    };
  }

  if (kind === "borough") {
    const count = borough.cemeteries.length;
    const note = visibleField(borough.intro_note);
    const cards = borough.cemeteries.map((item, index) => cardHtml(item, borough, index)).join("");
    return {
      path: `/areas/${borough.slug}`,
      title: `Memorials for cemeteries in ${borough.name} | Sears Melvin`,
      description: `Cemeteries in ${borough.name}, with the operator and official site where those are published. Our Finchley showroom (NW11 6LB) serves families across London.`,
      h1: `Memorials for cemeteries in ${borough.name}`,
      crumbs: [
        { name: "Home", path: "/" },
        { name: "Areas", path: "/areas" },
        { name: borough.name, path: `/areas/${borough.slug}` },
      ],
      body: [
        `<div class="area-hero"><div>`,
        `<p>Our Finchley showroom (NW11 6LB) serves families across London.</p>`,
        `<p>This page lists the cemeteries in ${escapeHtml(borough.name)}, with the operator and official site where those are published.</p>`,
        note ? `<p>${escapeHtml(note)}</p>` : "",
        chipsHtml([
          `<span>${count} ${count === 1 ? "cemetery" : "cemeteries"}</span>`,
          `<span>${escapeHtml(borough.name)}</span>`,
          `<span>Finchley showroom ${escapeHtml(SHOWROOM.postcode)}</span>`,
          `<span>RQMF Registered No. 2263</span>`,
          `<span>Fixing included</span>`,
        ]),
        heroButtons("/contact", "Request a quote", "#cemeteries", "See the cemeteries"),
        `</div>${mapHtml([
          mapMarker(SHOWROOM, "Finchley showroom", "/contact"),
          ...borough.cemeteries.map((item) => mapMarker(item, item.name, `/areas/${borough.slug}/${item.slug}`)),
        ], `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Cemeteries in ${borough.name}, London`)}`)}</div>`,
        `<section class="area-section" id="cemeteries"><h2>Cemeteries in ${escapeHtml(borough.name)}</h2><ul class="area-cards">${cards}</ul></section>`,
        stepsHtml("How a memorial gets placed"),
        `<!-- products -->`,
        questionsHtml(),
        bandHtml(),
        otherAreasHtml(borough.slug),
      ].join(""),
    };
  }

  const operator = visibleField(cemetery.operator);
  const postcode = visibleField(cemetery.postcode);
  const burials = visibleField(cemetery.new_burials);
  const source = safeHttpUrl(cemetery.source);
  const distance = distanceLine(cemetery);
  const intro = [
    operator ? `${cemetery.name} is operated by ${operator}.` : `Published details for ${cemetery.name} are listed below.`,
    distance ? `The straight-line distance from our Finchley showroom (${SHOWROOM.postcode}) is ${milesBetween(SHOWROOM, cemetery).toFixed(1)} miles.` : "Our Finchley showroom (NW11 6LB) serves families across London.",
  ];
  const rows = [
    operator ? ["Operator", escapeHtml(operator)] : null,
    postcode ? ["Postcode", escapeHtml(postcode)] : null,
    ["Borough", escapeHtml(borough.name)],
    burials ? ["New burials", escapeHtml(burials)] : null,
    source ? ["Official site", `<a href="${escapeHtml(source)}" rel="noopener noreferrer">Official site</a>`] : null,
    checked ? ["Checked", escapeHtml(checked)] : null,
  ].filter(Boolean);
  const nearby = allCemeteries()
    .filter((item) => item.slug !== cemetery.slug && hasGeo(cemetery) && hasGeo(item))
    .map((item) => ({ item, miles: milesBetween(cemetery, item) }))
    .filter((item) => Number.isFinite(item.miles))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, 6);
  const nearbyHtml = nearby.length
    ? `<section class="area-section"><h2>Other cemeteries nearby</h2><ul class="area-chips">${nearby.map(({ item, miles }) => `<li><a href="/areas/${item.borough.slug}/${item.slug}">${escapeHtml(item.name)} <span>${miles.toFixed(1)} miles, straight line</span></a></li>`).join("")}</ul></section>`
    : "";
  return {
    path: `/areas/${borough.slug}/${cemetery.slug}`,
    title: `Memorials for ${cemetery.name} | Sears Melvin`,
    description: `${intro[0]} ${intro[1]}`.slice(0, 180),
    h1: `Memorials for ${cemetery.name}`,
    crumbs: [
      { name: "Home", path: "/" },
      { name: "Areas", path: "/areas" },
      { name: borough.name, path: `/areas/${borough.slug}` },
      { name: cemetery.name, path: `/areas/${borough.slug}/${cemetery.slug}` },
    ],
    body: [
      `<div class="area-hero"><div>`,
      intro.map((line) => `<p>${escapeHtml(line)}</p>`).join(""),
      chipsHtml([
        `<span>${escapeHtml(borough.name)}</span>`,
        postcode ? `<span>${escapeHtml(postcode)}</span>` : "",
        `<span>Finchley showroom ${escapeHtml(SHOWROOM.postcode)}</span>`,
        `<span>RQMF Registered No. 2263</span>`,
        `<span>Fixing included</span>`,
      ]),
      heroButtons("/contact", "Request a quote", mapsHref(cemetery.name, postcode, borough.name), "Open in Google Maps"),
      `</div>${mapHtml([
        mapMarker(SHOWROOM, "Finchley showroom", "/contact"),
        mapMarker(cemetery, cemetery.name, `/areas/${borough.slug}/${cemetery.slug}`),
      ], mapsHref(cemetery.name, postcode, borough.name))}</div>`,
      `<section class="area-section"><h2>Details</h2><table class="area-details">${rows.map(([label, value]) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`).join("")}</table></section>`,
      stepsHtml("How a memorial gets placed here"),
      `<!-- products -->`,
      nearbyHtml,
      questionsHtml(),
      bandHtml(),
      otherAreasHtml(borough.slug),
    ].join(""),
  };
}

function replaceMeta(html, attr, value) {
  const pattern = new RegExp(`(<meta\\s+${attr}\\s+content=")[^"]*(")`, "i");
  if (!pattern.test(html)) throw new Error(`area shell missing meta ${attr}`);
  return html.replace(pattern, (_match, start, end) => `${start}${escapeHtml(value)}${end}`);
}

export function renderAreaPage(shellHtml, model, products) {
  const page = model;
  const canonical = `${BASE}${page.path}`;
  let html = String(shellHtml || "");
  if (!/<header class="page-header about-hero">[\s\S]*?<\/main>/.test(html)) {
    throw new Error("area shell missing page header");
  }
  const body = page.body.replace("<!-- products -->", productsHtml(products));
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(page.title)}</title>`);
  html = replaceMeta(html, 'name="description"', page.description);
  html = replaceMeta(html, 'property="og:title"', page.title);
  html = replaceMeta(html, 'property="og:description"', page.description);
  html = replaceMeta(html, 'property="og:url"', canonical);
  html = replaceMeta(html, 'name="twitter:title"', page.title);
  html = replaceMeta(html, 'name="twitter:description"', page.description);
  html = html.replace(/<link rel="canonical" href="[^"]*">/, () => `<link rel="canonical" href="${canonical}">`);
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: page.crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: `${BASE}${crumb.path === "/" ? "/" : crumb.path}`,
    })),
  };
  if (!/<!-- Structured data: Breadcrumbs -->[\s\S]*?<\/script>/.test(html)) {
    throw new Error("area shell missing breadcrumb schema");
  }
  html = html.replace(/<!-- Structured data: Breadcrumbs -->[\s\S]*?<\/script>/, () => `<!-- Structured data: Breadcrumbs -->\n    ${jsonScript(breadcrumbLd)}`);
  const boot = body.includes("area-map-show") ? MAP_BOOT : "";
  const block = `<main class="area-page">${crumbsHtml(page.crumbs)}<h1>${escapeHtml(page.h1)}</h1>${body}${boot}</main>`;
  html = html.replace(/<header class="page-header about-hero">[\s\S]*?<\/main>/, () => block);
  html = html.replaceAll('href="/about" class="active"', 'href="/about"');
  html = html.replace(/<span class="accred-note">[^<]*NAMM[^<]*<\/span>/g, "");
  html = html.replace(/\n\s*\{ q: "How much does a headstone cost\?"[\s\S]*?\},/, "");
  html = html.replace(/\n\s*\{ q: "How does payment work\?"[\s\S]*?\},/, "");
  html = html.replace(
    '<li><a href="/memorials">Memorials</a></li>\n                <li><a href="/memorials?type=lawn-headstones">Lawn headstones</a></li>',
    '<li><a href="/memorials">Memorials</a></li>\n                <li><a href="/areas">Areas</a></li>\n                <li><a href="/memorials?type=lawn-headstones">Lawn headstones</a></li>',
  );
  if (!html.includes("</head>")) throw new Error("area shell missing head");
  html = html.replace("</head>", () => `<style>${AREA_CSS}</style>\n</head>`);
  if (!html.includes('class="area-page"') || /<title>[^<]*About Us/.test(html)) {
    throw new Error("area page did not replace the shell");
  }
  return html;
}

export function resolveAreaPath(pathname) {
  let path = String(pathname || "");
  try {
    path = new URL(path, BASE).pathname;
  } catch {
    return { redirect: "/memorials" };
  }
  path = path.replace(/\/{2,}/g, "/");
  const trailing = path.length > 1 && path.endsWith("/");
  if (trailing) path = path.slice(0, -1);
  if (path === "/areas.html") return { redirect: "/areas" };
  if (path === "/areas") return trailing ? { redirect: "/areas" } : { kind: "hub" };
  if (!path.startsWith("/areas/")) return { redirect: "/memorials" };
  let rest = path.slice("/areas/".length);
  if (rest.endsWith(".html")) rest = rest.slice(0, -5);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return { redirect: "/memorials" };
  const boroughSlug = parts[0].toLowerCase();
  const borough = areaData.boroughs.find((item) => item.slug === boroughSlug);
  if (!borough || !/^[a-z0-9-]{1,120}$/.test(boroughSlug)) return { redirect: "/memorials" };
  if (parts.length === 1) {
    if (trailing || parts[0] !== boroughSlug) return { redirect: `/areas/${boroughSlug}` };
    return { kind: "borough", borough };
  }
  const cemeterySlug = parts[1].toLowerCase();
  const found = findCemetery(boroughSlug, cemeterySlug);
  if (!found) return { redirect: "/memorials" };
  if (trailing || parts[0] !== boroughSlug || parts[1] !== cemeterySlug) {
    return { redirect: `/areas/${boroughSlug}/${cemeterySlug}` };
  }
  return { kind: "cemetery", borough: found.borough, cemetery: found.cemetery };
}

async function fetchProducts(env) {
  try {
    const base = publicSupabaseUrl(env);
    const org = encodeURIComponent(env?.SM_ORG_ID || SM_ORG_ID);
    const response = await fetch(
      `${base}/rest/v1/products?organization_id=eq.${org}&is_active=eq.true&is_listed=eq.true&category_id=not.is.null&select=name,slug,image_url,product_categories(name,slug)&order=display_order.asc&limit=24`,
      { headers: supabaseKeyHeaders(publishableKey(env || {})) },
    );
    if (!response.ok) return [];
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];
    return rows.filter((product) => safeSlug(product.slug) && productImageUrl(product)).slice(0, 6);
  } catch {
    return [];
  }
}

function unavailable() {
  return new Response("This page is temporarily unavailable.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function handleAreaRequest({ request, env }) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
    });
  }
  const resolved = resolveAreaPath(url.pathname);
  if (resolved.redirect) {
    return new Response(null, {
      status: 301,
      headers: { Location: resolved.redirect + url.search, "Cache-Control": "public, max-age=3600" },
    });
  }
  let shellHtml = "";
  try {
    const shell = await env.ASSETS.fetch(new URL("/about.html", url));
    if (!shell.ok) return unavailable();
    shellHtml = await shell.text();
  } catch {
    return unavailable();
  }
  const products = await fetchProducts(env);
  let html;
  try {
    const model = pageModel(resolved.kind, resolved.borough, resolved.cemetery);
    html = renderAreaPage(shellHtml, model, products);
  } catch {
    return unavailable();
  }
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
