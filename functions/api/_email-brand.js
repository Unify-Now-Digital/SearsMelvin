/**
 * Bronze & Linen email shell.
 * Tables and inline CSS. Explicit colour on every text node. No images as backgrounds.
 * A provider id means the message was accepted for sending. It does not mean
 * delivered, received, or opened. This module never reads delivery events.
 */
// Loaded for the greeting only. Called when the email is built, after both modules have finished loading.
import { splitName } from "./submit.js";
const SITE = "https://searsmelvin.co.uk";
const LOGO = `${SITE}/images/brand/logo/sears-melvin-stacked-ink.png`;
const COVER = `${SITE}/assets/sears-melvin-brochure-cover.jpg?v=10.1`;
const PDF = "/assets/sears-melvin-brochure.pdf?v=10.1";
const PHONE_DISPLAY = "020 3835 2548";
const PHONE_TEL = "tel:+442038352548";
const ADDRESS = "1 The Market Place, Falloden Way, London NW11 6LB";
const SHOWROOM = "Visit our Finchley showroom, Monday to Friday, 10am to 3pm.";
const FIXERS = "Our fixers are NAMM-qualified and RQMF registered.";
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = "'DM Sans',Arial,Helvetica,sans-serif";

const INK = "#302C27";
const LINEN = "#FBF9F5";
const BRONZE = "#7A6449";
const SAND = "#DDD1C0";
const MUTED = "#5C554C";
const INVERSE = "#CFC6B8";
const SOFT = "#B19A7B";
const QUIET = "#EFE8DE";
const WHITE = "#FFFFFF";

export const BROCHURE_SOURCES = ["header", "home", "product", "listing", "brochure_page"];
const SOURCE_LABELS = {
  header: "Header",
  home: "Home",
  product: "Product",
  listing: "Listing",
  brochure_page: "Brochure page",
};

const INTERNAL_TEST_HOSTS = new Set(["example.com", "example.org", "unifydigital.uk", "searsmelvin.co.uk"]);

export function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function cleanBrochureSource(value) {
  const s = String(value || "").toLowerCase();
  return BROCHURE_SOURCES.includes(s) ? s : "";
}

export function cleanPagePath(value) {
  const path = String(value || "").split("?")[0].split("#")[0];
  return /^\/[\w\-./~%]{0,299}$/.test(path) ? path.slice(0, 300) : "";
}

export function cleanSlug(value) {
  const s = String(value || "").toLowerCase().trim();
  return /^[a-z0-9-]{1,120}$/.test(s) ? s : "";
}

export function cleanLabel(value, max = 120) {
  const s = String(value || "").replace(/[\u0000-\u001f<>"]/g, " ").replace(/\s+/g, " ").trim();
  if (!s || s.includes("@")) return "";
  return s.slice(0, max);
}

/** An all-lowercase given name is capitalised. Anything with capitals is left as typed. */
export function greetingName(name) {
  const token = String(name || "").trim().split(/\s+/)[0] || "";
  if (!/^[A-Za-z][A-Za-z'’-]{0,40}$/.test(token)) return "";
  if (token !== token.toLowerCase()) return token;
  return token.charAt(0).toUpperCase() + token.slice(1);
}

export function brochureSourceLabel(source, productName) {
  const clean = cleanBrochureSource(source) || "brochure_page";
  const product = cleanLabel(productName, 120);
  if (clean === "product" && product) return `${product} (product)`;
  return SOURCE_LABELS[clean];
}

export function brochureEmailLinks(source) {
  const content = cleanBrochureSource(source) || "brochure_page";
  const pdf = `${SITE}${PDF}&utm_source=brochure_email&utm_medium=email&utm_campaign=brochure_v10&utm_content=${content}`;
  const quote = `${SITE}/quote?utm_source=brochure_email&utm_medium=email&utm_campaign=brochure_v10`;
  return { pdf, quote, cover: COVER };
}

/**
 * Test sends only. Production mail never consults this. Rejects any address
 * whose host is outside the internal allowlist.
 */
export function internalBrochureTestRecipient(value) {
  const to = String(value || "").trim().toLowerCase();
  if (!to) return "";
  const host = to.split("@")[1] || "";
  if (!INTERNAL_TEST_HOSTS.has(host)) {
    throw new Error("BROCHURE_TEST_TO is not an internal address");
  }
  return to;
}

export function brochureSentStamp(date) {
  const when = date instanceof Date ? date : new Date(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(when);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric",
  }).format(when);
  return `${time} on ${day}`;
}

/**
 * Provider acceptance only. `accepted` is true when Resend returned an id.
 * The wording is "sent". It never says delivered, received, or opened.
 */
export function brochureStaffStatusLine({ accepted, email, at }) {
  const address = String(email || "").trim();
  if (accepted && address) {
    return `Brochure sent to ${address} at ${brochureSentStamp(at || new Date())} UK time`;
  }
  return "Brochure email failed: please send it manually";
}

export function adAttributionLine(attribution, leadSource) {
  const a = attribution && typeof attribution === "object" ? attribution : {};
  const present = ["gclid", "gbraid", "wbraid", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]
    .some((key) => typeof a[key] === "string" && a[key].trim());
  if (!present) return "";
  const campaign = typeof a.utm_campaign === "string" ? cleanLabel(a.utm_campaign, 100) : "";
  if (leadSource === "Google Ads" && campaign) return `Google Ads · ${campaign}`;
  return cleanLabel(leadSource, 40);
}

export function telHref(phone) {
  const raw = String(phone || "").trim();
  const compact = raw.replace(/[^\d+]/g, "");
  if (compact.startsWith("+") && /^\+\d{8,15}$/.test(compact)) return `tel:${compact}`;
  const digits = compact.replace(/^\+44/, "0");
  if (/^0\d{9,10}$/.test(digits)) return `tel:+44${digits.slice(1)}`;
  return "";
}

export function pageHref(path) {
  const clean = cleanPagePath(path);
  return clean ? `${SITE}${clean}` : "";
}

export function pageLabel(path) {
  const clean = cleanPagePath(path);
  if (!clean) return "";
  return `searsmelvin.co.uk${clean === "/" ? "/" : clean}`;
}

export function ghlContactUrl(locationId, contactId) {
  const location = String(locationId || "");
  const contact = String(contactId || "");
  if (!/^[\w-]+$/.test(location) || !/^[\w-]+$/.test(contact)) return "";
  return `https://app.gohighlevel.com/v2/location/${location}/contacts/detail/${contact}`;
}

export function brochureContactNote({ source, productName, page }) {
  const lines = ["Brochure request", `Source: ${brochureSourceLabel(source, productName)}`];
  const clean = cleanPagePath(page);
  if (clean) lines.push(`Page: ${clean}`);
  const product = cleanLabel(productName, 120);
  if (product) lines.push(`Product: ${product}`);
  return lines.join("\n");
}

function fontHead(title) {
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&amp;family=DM+Sans:wght@400;500&amp;display=swap" rel="stylesheet">
</head>`;
}

function logoRow() {
  return `<tr>
    <td align="center" style="background-color:${LINEN};padding:28px 24px 20px;border-bottom:1px solid ${SAND};">
      <a href="${SITE}" style="text-decoration:none;">
        <img src="${LOGO}" width="240" height="61" alt="Sears Melvin Memorials" style="display:block;border:0;width:240px;height:auto;margin:0 auto;">
      </a>
    </td>
  </tr>`;
}

function familyFooter() {
  return `<tr>
    <td align="center" style="background-color:${INK};padding:20px 24px;">
      <p style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:1.6;color:${LINEN};">Sears Melvin Memorials &middot; <a href="${SITE}" style="color:${SOFT};text-decoration:underline;">searsmelvin.co.uk</a></p>
      <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${INVERSE};">${FIXERS}</p>
    </td>
  </tr>`;
}

function staffFooter() {
  return `<tr>
    <td align="center" style="background-color:${INK};padding:16px 24px;">
      <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${INVERSE};">Sears Melvin Memorials &middot; info@searsmelvin.co.uk</p>
    </td>
  </tr>`;
}

function shell({ title, preheader, rows, footer }) {
  return `<!DOCTYPE html>
<html lang="en">
${fontHead(title)}
<body style="margin:0;padding:0;background-color:${LINEN};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${LINEN};">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${LINEN};">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${WHITE};border:1px solid ${SAND};border-radius:2px;">
          ${logoRow()}
          ${rows}
          ${footer}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function p(text, { margin = "0 0 16px", size = "16px", color = INK, weight = "400" } = {}) {
  return `<p style="margin:${margin};font-family:${SANS};font-size:${size};font-weight:${weight};line-height:1.65;color:${color};">${text}</p>`;
}

function inkButton(href, label) {
  return `<td align="center" bgcolor="${INK}" style="background-color:${INK};border-radius:2px;">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font-family:${SANS};font-size:15px;font-weight:500;line-height:1.3;color:${LINEN};text-decoration:none;border-radius:2px;">${esc(label)}</a>
  </td>`;
}

function fieldRow(label, valueHtml, last) {
  const edge = last ? `border-top:1px solid ${SAND};border-bottom:1px solid ${SAND};` : `border-top:1px solid ${SAND};`;
  return `<tr>
    <td width="130" style="padding:8px 0;${edge}color:${MUTED};vertical-align:top;font-family:${SANS};font-size:15px;line-height:1.5;">${esc(label)}</td>
    <td style="padding:8px 0;${edge}color:${INK};font-family:${SANS};font-size:15px;line-height:1.5;">${valueHtml}</td>
  </tr>`;
}

function linkOrText(href, label) {
  if (!href) return esc(label);
  return `<a href="${esc(href)}" style="color:${BRONZE};text-decoration:underline;">${esc(label)}</a>`;
}

function phoneCell(phone, empty) {
  const shown = String(phone || "").trim();
  if (!shown) return esc(empty);
  const href = telHref(shown);
  return href ? linkOrText(href, shown) : esc(shown);
}

function emailCell(email) {
  const shown = String(email || "").trim();
  if (!shown) return esc("Not given");
  return linkOrText(`mailto:${shown}`, shown);
}

export function familyBrochureEmail({ firstName, source } = {}) {
  const hello = greetingName(firstName) || greetingName(String(firstName || "").split(" ")[0]);
  const links = brochureEmailLinks(source);
  const greeting = hello ? `Hello ${hello},` : "Hello,";
  const pdfHref = links.pdf;
  const quoteHref = links.quote;
  const html = shell({
    title: "Your Sears Melvin brochure",
    preheader: "Your copy of our memorial brochure, to read at your own pace.",
    footer: familyFooter(),
    rows: `
          <tr>
            <td style="padding:32px 36px 8px;">
              ${p(esc(greeting), { margin: "0 0 18px" })}
              ${p("Thank you for asking for our brochure. Here is your copy, to read at your own pace.", { margin: "0 0 24px" })}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 36px 8px;">
              <a href="${esc(pdfHref)}" style="text-decoration:none;">
                <img src="${COVER}" width="160" alt="Sears Melvin memorial brochure cover" style="display:block;border:1px solid ${SAND};border-radius:2px;width:160px;max-width:50%;height:auto;margin:0 auto;">
              </a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:22px 36px 6px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${INK}" style="background-color:${INK};border-radius:2px;">
                    <a href="${esc(pdfHref)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:500;line-height:1.3;color:${LINEN};text-decoration:none;border-radius:2px;">Download the brochure</a>
                  </td>
                </tr>
              </table>
              <p style="margin:10px 0 0;font-family:${SANS};font-size:13px;line-height:1.5;color:${MUTED};">PDF &middot; 30 pages &middot; 2.3 MB</p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 36px 8px;">
              ${p("It includes our memorial designs with guide prices, what is included, and how ordering works.", { margin: "0 0 8px" })}
              ${p("Prices in the brochure are guide prices and include VAT.", { margin: "0", size: "13px", color: MUTED })}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 36px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid ${SAND};font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 36px 28px;">
              ${p(`When you are ready, you can <a href="${esc(quoteHref)}" style="color:${BRONZE};text-decoration:underline;">request a quote</a>, or call us on <a href="${PHONE_TEL}" style="color:${BRONZE};text-decoration:underline;white-space:nowrap;">${PHONE_DISPLAY}</a>.`, { margin: "0 0 16px" })}
              ${p(`${SHOWROOM}<br>${ADDRESS}`, { margin: "0 0 22px" })}
              ${p("With care,<br>The Sears Melvin team", { margin: "0" })}
            </td>
          </tr>`,
  });
  const text = [
    greeting,
    "",
    "Thank you for asking for our brochure. Here is your copy, to read at your own pace.",
    "",
    "Download the brochure:",
    pdfHref,
    "",
    "It includes our memorial designs with guide prices, what is included, and how ordering works.",
    "Prices in the brochure are guide prices and include VAT.",
    "",
    `When you are ready, you can request a quote at ${quoteHref}`,
    `or call us on ${PHONE_DISPLAY}.`,
    "",
    SHOWROOM,
    ADDRESS,
    "",
    "With care,",
    "The Sears Melvin team",
    "",
    "searsmelvin.co.uk",
    FIXERS,
  ].join("\n");
  return { subject: "Your Sears Melvin brochure", html, text };
}

function actionRow({ email, contactUrl }) {
  const mail = String(email || "").trim();
  const buttons = mail
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${inkButton(`mailto:${mail}`, "Reply by email")}</tr></table>`
    : "";
  const highlevel = contactUrl
    ? `<p style="margin:16px 0 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${INK};"><a href="${esc(contactUrl)}" style="color:${BRONZE};text-decoration:underline;">Open in HighLevel</a></p>`
    : "";
  if (!buttons && !highlevel) return "";
  return `<tr><td style="padding:22px 36px 28px;">${buttons}${highlevel}</td></tr>`;
}

export function staffBrochureEmail({
  name, email, phone, source, productName, page, adLine, submittedAt, statusLine, contactUrl,
} = {}) {
  const who = cleanLabel(name, 120) || "A visitor";
  const status = statusLine || brochureStaffStatusLine({ accepted: false });
  const sourceLabel = brochureSourceLabel(source, productName);
  const href = pageHref(page);
  const label = pageLabel(page);
  const rows = [
    fieldRow("Name", esc(who)),
    fieldRow("Phone", phoneCell(phone, "Not given")),
    fieldRow("Email", emailCell(email)),
    fieldRow("Source", esc(sourceLabel)),
  ];
  if (label) rows.push(fieldRow("Page", linkOrText(href, label)));
  if (adLine) rows.push(fieldRow("Ad", esc(adLine)));
  const time = submittedAt ? `${submittedAt} UK time` : "";
  if (time) rows.push(fieldRow("Time", esc(time), true));
  else if (rows.length) {
    const last = rows.pop();
    rows.push(last.replace(`border-top:1px solid ${SAND};`, `border-top:1px solid ${SAND};border-bottom:1px solid ${SAND};`));
  }
  const subjectName = who;
  const html = shell({
    title: `Brochure request: ${subjectName}`,
    preheader: status,
    footer: staffFooter(),
    rows: `
          <tr>
            <td style="background-color:${QUIET};padding:14px 36px;border-bottom:1px solid ${SAND};">
              ${p(esc(status), { margin: "0", size: "15px", weight: "500" })}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 36px 8px;">
              <h1 style="margin:0 0 8px;font-family:${SERIF};font-weight:500;font-size:28px;line-height:1.2;color:${INK};">Brochure request</h1>
              ${p(`${esc(who)} has asked for the brochure.`, { margin: "0 0 22px" })}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join("")}</table>
            </td>
          </tr>
          ${actionRow({ email, contactUrl })}`,
  });
  const textLines = [
    status,
    "",
    `${who} has asked for the brochure.`,
    "",
    `Name: ${who}`,
    `Phone: ${String(phone || "").trim() || "Not given"}`,
    `Email: ${String(email || "").trim() || "Not given"}`,
    `Source: ${sourceLabel}`,
  ];
  if (href) textLines.push(`Page: ${href}`);
  if (adLine) textLines.push(`Ad: ${adLine}`);
  if (time) textLines.push(`Time: ${time}`);
  textLines.push("");
  if (email) textLines.push(`Reply by email: mailto:${String(email).trim()}`);
  if (contactUrl) textLines.push(`Open in HighLevel: ${contactUrl}`);
  return { html, text: textLines.join("\n") };
}

function detailRows(fields) {
  const rows = [];
  for (const [label, value] of fields) {
    if (!value) continue;
    rows.push([label, esc(value)]);
  }
  return rows.map(([label, value], index) => fieldRow(label, value, index === rows.length - 1)).join("");
}

function messageBlock(message) {
  const text = String(message || "").trim();
  if (!text) return "";
  return `
          <tr>
            <td style="padding:8px 36px 8px;">
              <p style="margin:18px 0 8px;font-family:${SANS};font-size:13px;font-weight:500;color:${MUTED};">Your message</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:${QUIET};border-radius:2px;padding:14px 16px;font-family:${SANS};font-size:15px;line-height:1.65;color:${INK};">${esc(text).replace(/\n/g, "<br>")}</td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function shortlistBlock(items, heading) {
  if (!Array.isArray(items) || !items.length) return "";
  const rows = items.map((item) => {
    const name = esc(item.name);
    const linked = item.url
      ? `<a href="${esc(item.url)}" style="color:${INK};font-weight:500;text-decoration:underline;">${name}</a>`
      : name;
    const price = item.price ? ` <span style="color:${MUTED};">&middot; ${esc(item.price)}</span>` : "";
    const view = item.url ? `<br><a href="${esc(item.url)}" style="color:${BRONZE};text-decoration:underline;">View memorial</a>` : "";
    return `<tr><td style="padding:7px 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${INK};">${linked}${price}${view}</td></tr>`;
  }).join("");
  return `
          <tr>
            <td style="padding:8px 36px 0;">
              <p style="margin:12px 0 6px;font-family:${SANS};font-size:13px;font-weight:500;color:${MUTED};">${esc(heading)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
            </td>
          </tr>`;
}

function photoBlock(urls) {
  if (!Array.isArray(urls) || !urls.length) return "";
  const cells = urls.map((url) => `
    <td width="50%" valign="top" style="padding:6px;">
      <a href="${esc(url)}" style="text-decoration:none;">
        <img src="${esc(url)}" alt="Enquiry photo" width="260" style="display:block;width:100%;max-width:260px;height:auto;border:1px solid ${SAND};border-radius:2px;">
      </a>
    </td>`);
  let table = "";
  for (let i = 0; i < cells.length; i += 2) {
    table += `<tr>${cells[i] || ""}${cells[i + 1] || `<td width="50%">&nbsp;</td>`}</tr>`;
  }
  return `
          <tr>
            <td style="padding:8px 30px 0;">
              <p style="margin:12px 0 6px;font-family:${SANS};font-size:13px;font-weight:500;color:${MUTED};">Photos attached</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${table}</table>
            </td>
          </tr>`;
}

export function familyEnquiryEmail({
  name, email, phone, message, enquiryTypeLabel, location, graveNumber, contactPref, photoCount, shortlistItems,
} = {}) {
  const hello = greetingName(splitName(name).first_name);
  const title = hello ? `Thank you, ${hello}.` : "Thank you.";
  const prefs = { email: "Email", phone: "Phone call", appointment: "Appointment" };
  const fields = [
    ["Name", cleanLabel(name, 120) || String(name || "").trim()],
    ["Email", String(email || "").trim()],
    ["Phone", String(phone || "").trim() || "Not provided"],
    ["Enquiry type", enquiryTypeLabel || ""],
    ["Cemetery", location || ""],
    ["Grave", graveNumber || ""],
    ["Preferred reply", contactPref ? (prefs[contactPref] || contactPref) : ""],
    ["Photos attached", photoCount > 0 ? String(photoCount) : ""],
  ];
  const html = shell({
    title: "We have received your enquiry",
    preheader: "We have received your enquiry and will be in touch within one working day.",
    footer: familyFooter(),
    rows: `
          <tr>
            <td style="padding:32px 36px 8px;">
              <h1 style="margin:0 0 16px;font-family:${SERIF};font-weight:500;font-size:28px;line-height:1.2;color:${INK};">${esc(title)}</h1>
              ${p("We have received your enquiry and one of the team will be in touch within one working day.")}
              ${p("A copy of what you sent is below.", { margin: "0 0 22px", color: MUTED })}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${detailRows(fields)}</table>
            </td>
          </tr>
          ${shortlistBlock(shortlistItems, "Memorials you shortlisted")}
          ${messageBlock(message)}
          <tr>
            <td style="padding:24px 36px 28px;">
              ${p(`If you need us sooner, call <a href="${PHONE_TEL}" style="color:${BRONZE};text-decoration:underline;white-space:nowrap;">${PHONE_DISPLAY}</a>.`)}
              ${p(`${SHOWROOM}<br>${ADDRESS}`, { margin: "0 0 22px" })}
              ${p("With care,<br>The Sears Melvin team", { margin: "0" })}
            </td>
          </tr>`,
  });
  const text = [
    title,
    "",
    "We have received your enquiry and one of the team will be in touch within one working day.",
    "",
    "A copy of what you sent is below.",
    "",
    ...fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`),
    "",
  ];
  if (Array.isArray(shortlistItems) && shortlistItems.length) {
    text.push("Memorials you shortlisted:");
    for (const item of shortlistItems) text.push(`- ${item.name}${item.url ? ` ${item.url}` : ""}`);
    text.push("");
  }
  if (String(message || "").trim()) {
    text.push("Your message:");
    text.push(String(message).trim());
    text.push("");
  }
  text.push(
    `If you need us sooner, call ${PHONE_DISPLAY}.`,
    "",
    SHOWROOM,
    ADDRESS,
    "",
    "With care,",
    "The Sears Melvin team",
    "",
    "searsmelvin.co.uk",
    FIXERS,
  );
  return {
    subject: "We have received your enquiry — Sears Melvin Memorials",
    html,
    text: text.join("\n"),
  };
}

export function staffEnquiryEmail({
  name, email, phone, message, enquiryTypeLabel, location, graveNumber, contactPref,
  photoCount, photoUrls, shortlistItems, submittedAt, sourcePage, adLine, contactUrl,
} = {}) {
  const who = String(name || "").trim() || "A visitor";
  const prefs = { email: "Email", phone: "Phone call", appointment: "Appointment" };
  const page = pageLabel(sourcePage);
  const built = [
    fieldRow("Name", esc(who)),
    fieldRow("Phone", phoneCell(phone, "Not given")),
    fieldRow("Email", emailCell(email)),
  ];
  for (const [label, value] of [
    ["Enquiry type", enquiryTypeLabel || ""],
    ["Cemetery", location || ""],
    ["Grave", graveNumber || ""],
    ["Preferred reply", contactPref ? (prefs[contactPref] || contactPref) : ""],
  ]) {
    if (value) built.push(fieldRow(label, esc(value)));
  }
  if (page) built.push(fieldRow("Page", linkOrText(pageHref(sourcePage), page)));
  if (adLine) built.push(fieldRow("Ad", esc(adLine)));
  if (photoCount > 0) built.push(fieldRow("Photos attached", esc(String(photoCount))));
  if (submittedAt) built.push(fieldRow("Time", esc(`${submittedAt} UK time`), true));
  const heading = enquiryTypeLabel ? `${enquiryTypeLabel} enquiry` : "Enquiry";
  const html = shell({
    title: heading,
    preheader: `${who} sent an enquiry.`,
    footer: staffFooter(),
    rows: `
          <tr>
            <td style="padding:28px 36px 8px;">
              <h1 style="margin:0 0 8px;font-family:${SERIF};font-weight:500;font-size:28px;line-height:1.2;color:${INK};">${esc(heading)}</h1>
              ${p(`${esc(who)} sent an enquiry.`, { margin: "0 0 22px" })}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${built.join("")}</table>
            </td>
          </tr>
          ${shortlistBlock(shortlistItems, "Memorials shortlisted")}
          ${messageBlock(message)}
          ${photoBlock(photoUrls)}
          ${actionRow({ email, contactUrl })}`,
  });
  const text = [
    `${who} sent an enquiry.`,
    "",
    `Name: ${who}`,
    `Phone: ${String(phone || "").trim() || "Not given"}`,
    `Email: ${String(email || "").trim() || "Not given"}`,
  ];
  if (enquiryTypeLabel) text.push(`Enquiry type: ${enquiryTypeLabel}`);
  if (location) text.push(`Cemetery: ${location}`);
  if (graveNumber) text.push(`Grave: ${graveNumber}`);
  if (sourcePage && pageHref(sourcePage)) text.push(`Page: ${pageHref(sourcePage)}`);
  if (adLine) text.push(`Ad: ${adLine}`);
  if (submittedAt) text.push(`Time: ${submittedAt} UK time`);
  if (Array.isArray(shortlistItems) && shortlistItems.length) {
    text.push("", "Memorials shortlisted:");
    for (const item of shortlistItems) text.push(`- ${item.name}${item.url ? ` ${item.url}` : ""}`);
  }
  if (String(message || "").trim()) text.push("", "Your message:", String(message).trim());
  if (email) text.push("", `Reply by email: mailto:${String(email).trim()}`);
  if (contactUrl) text.push(`Open in HighLevel: ${contactUrl}`);
  return { html, text: text.join("\n") };
}
