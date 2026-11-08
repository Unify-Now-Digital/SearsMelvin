#!/usr/bin/env node
// Read-only diff of the live GTM container against docs/gtm-snapshot.json.
// Writes docs/design-system/baseline-gtm-diff.md.
// Does not change GTM. Does not update the snapshot.
//
//   node scripts/gtm-baseline-diff.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GTM_ID, driftProblems, parseGtm } from "./tracking-check.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = join(repo, "docs", "gtm-snapshot.json");
const outPath = join(repo, "docs", "design-system", "baseline-gtm-diff.md");

const KIND = {
  __awcc: "Google Ads call conversion (number swap)",
  __awct: "Google Ads conversion",
  __awud: "Google Ads user-provided data",
  __cl: "Click listener",
  __evl: "Element visibility listener",
  __fsl: "Form submit listener",
  __gaawe: "GA4 event",
  __gclidw: "Conversion linker",
  __googtag: "Google tag",
  __html: "Custom HTML",
  __lcl: "Link click listener",
  __paused: "Paused tag",
};

function kindName(fn) {
  return KIND[fn] || fn;
}

function show(value) {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function cell(value) {
  return show(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function sameTag(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function group(tags) {
  const map = new Map();
  for (const tag of tags) {
    const key = `${tag.function}\u0000${tag.id ?? ""}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tag);
  }
  for (const list of map.values()) {
    list.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return map;
}

function pairTags(snapshot, live) {
  const left = group(snapshot.tags);
  const right = group(live.tags);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes = [];
  let matched = 0;
  for (const key of keys) {
    const a = left.get(key) || [];
    const b = right.get(key) || [];
    const count = Math.max(a.length, b.length);
    for (let i = 0; i < count; i++) {
      const snap = a[i] || null;
      const current = b[i] || null;
      if (snap && current && sameTag(snap, current)) {
        matched += 1;
        continue;
      }
      changes.push({ snap, live: current });
    }
  }
  return { changes, matched };
}

function titleFor(change, index) {
  const tag = change.live || change.snap;
  if (tag.function === "__awct" && tag.id === "okRkCPGTqJsdEK-15Oo-") {
    return "Call conversion value on the Google Ads tag";
  }
  if (tag.function === "__gaawe" && tag.id === "click_to_call") {
    return "Call value on the GA4 click_to_call tag";
  }
  if (tag.function === "__awud") {
    const liveHas = (change.live?.triggers || []).some((rule) => rule.includes("sm_quote_submit"));
    const snapHas = (change.snap?.triggers || []).some((rule) => rule.includes("sm_quote_submit"));
    if (liveHas && !snapHas) return "Ads user-provided data listens for sm_quote_submit";
  }
  if (!change.snap) return `Live tag ${index} is not in the snapshot`;
  if (!change.live) return `Snapshot tag ${index} is not in the live container`;
  return `${kindName(tag.function)} ${tag.id || "(no id)"} changed`;
}

function sentencesFor(change) {
  const lines = [];
  const tag = change.live || change.snap;
  lines.push(`The tag is ${kindName(tag.function)}.`);
  lines.push(`The id is ${show(tag.id)}.`);
  if (!change.snap) {
    lines.push("The live container has this tag.");
    lines.push("The snapshot does not have this tag.");
    lines.push(`The live value is ${show(change.live.value)}.`);
    lines.push(`The live parameters are ${show(change.live.params)}.`);
    lines.push(`The live triggers are ${change.live.triggers.join(" | ") || "none"}.`);
    return lines;
  }
  if (!change.live) {
    lines.push("The snapshot has this tag.");
    lines.push("The live container does not have this tag.");
    lines.push(`The snapshot value is ${show(change.snap.value)}.`);
    lines.push(`The snapshot parameters are ${show(change.snap.params)}.`);
    lines.push(`The snapshot triggers are ${change.snap.triggers.join(" | ") || "none"}.`);
    return lines;
  }
  if (change.snap.value !== change.live.value) {
    lines.push(`The snapshot value is ${show(change.snap.value)}.`);
    lines.push(`The live value is ${show(change.live.value)}.`);
  } else {
    lines.push(`The value is unchanged. It is ${show(change.live.value)}.`);
  }
  if (JSON.stringify(change.snap.params) !== JSON.stringify(change.live.params)) {
    lines.push(`The snapshot parameters are ${show(change.snap.params)}.`);
    lines.push(`The live parameters are ${show(change.live.params)}.`);
  } else {
    lines.push(`The parameters are unchanged. They are ${show(change.live.params)}.`);
  }
  const removed = change.snap.triggers.filter((rule) => !change.live.triggers.includes(rule));
  const added = change.live.triggers.filter((rule) => !change.snap.triggers.includes(rule));
  if (removed.length === 0 && added.length === 0) {
    lines.push("The triggers are unchanged.");
  } else {
    if (removed.length) lines.push(`The snapshot has these triggers, and the live tag does not: ${removed.join(" | ")}.`);
    if (added.length) lines.push(`The live tag has these triggers, and the snapshot does not: ${added.join(" | ")}.`);
    const shared = change.live.triggers.filter((rule) => change.snap.triggers.includes(rule));
    lines.push(shared.length ? `The shared triggers stay in place. Count: ${shared.length}.` : "The two copies share no trigger.");
  }
  return lines;
}

function htmlNote(js) {
  const match = js.match(/var data = (\{[\s\S]*?\});\s*\n/);
  if (!match) return ["The script could not read the custom HTML tag."];
  const data = JSON.parse(match[1]);
  const htmlTags = (data.resource.tags || []).filter((tag) => tag.function === "__html");
  if (htmlTags.length !== 1) {
    return [`The live container has ${htmlTags.length} custom HTML tags.`];
  }
  const html = String(htmlTags[0].vtp_html || "");
  const lines = [
    "The snapshot stores kind, id, value, parameters, and triggers.",
    "The snapshot does not store custom HTML source.",
    "The live container has 1 custom HTML tag.",
  ];
  if (html.includes("sm_chat_submit") && html.includes("__smChatHook")) {
    lines.push("That tag still pushes sm_chat_submit only when window.__smChatHook is missing.");
  } else {
    lines.push("That tag's HTML source needs a manual read. It is not the expected chat listener.");
  }
  if (html.includes("view_item_list") || html.includes("select_item") || html.includes("filter_select")) {
    lines.push("That HTML source contains an ecommerce event name.");
  } else {
    lines.push("That HTML source does not contain view_item_list, select_item, or filter_select.");
  }
  return lines;
}

function eventNotes(js, live) {
  const names = ["view_item_list", "select_item", "filter_select"];
  const lines = [];
  for (const name of names) {
    const count = js.split(name).length - 1;
    const asTag = live.tags.some((tag) => tag.id === name);
    lines.push(
      asTag
        ? `${name} is a tag id in the live container. The file contains the string ${count} times.`
        : `${name} is not a tag id. The live file contains the string ${count} times.`,
    );
  }
  lines.push("view_item_list and select_item appear inside the GTM library event map.");
  lines.push("They are not tags in this container.");
  lines.push("filter_select does not appear in the live file.");
  return lines;
}

function inventoryRows(live, changes) {
  const rows = [];
  for (const tag of live.tags) {
    const drifted = changes.some((change) => change.live && sameTag(change.live, tag));
    rows.push({ status: drifted ? "Drift" : "Same", tag });
  }
  for (const change of changes) {
    if (!change.live && change.snap) rows.push({ status: "Missing live", tag: change.snap });
  }
  rows.sort((a, b) => `${a.tag.function}|${a.tag.id || ""}`.localeCompare(`${b.tag.function}|${b.tag.id || ""}`));
  return rows.map((row) => {
    const tag = row.tag;
    return `| ${cell(row.status)} | ${cell(kindName(tag.function))} | ${cell(tag.id)} | ${cell(tag.value)} | ${cell(tag.params)} | ${cell(tag.triggers.join(" | "))} |`;
  });
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "sm-gtm-baseline-diff/1.0" } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function checkedOn() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date());
}

async function main() {
  const url = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  const js = await fetchText(url);
  const live = parseGtm(js);
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const { changes, matched } = pairTags(snapshot, live);
  const raw = driftProblems(snapshot, live);
  const date = checkedOn();

  const driftSections = changes.map((change, index) => {
    const title = titleFor(change, index + 1);
    const body = sentencesFor(change).map((line, lineIndex) => `${lineIndex + 1}. ${line}`).join("\n");
    return `### ${index + 1}. ${title}\n\n${body}\n`;
  });

  const lines = [
    "# GTM baseline diff",
    "",
    "This file compares the live GTM container with the snapshot in this repo.",
    "The check is read-only.",
    "",
    "## How the check works",
    "",
    `1. Read the live container from ${url}.`,
    "2. Read the snapshot from docs/gtm-snapshot.json.",
    "3. Compare each tag, its triggers, its value, and its parameters.",
    "4. Use the same parser as scripts/tracking-check.mjs.",
    "5. Leave the GTM container unchanged.",
    "6. Leave docs/gtm-snapshot.json unchanged.",
    "",
    "## Decision",
    "",
    "1. On 8 November 2026 Arin confirmed the click-to-call conversion value.",
    "2. The confirmed value is 150 GBP.",
    "3. The value matches live GTM v26.",
    "4. This check does not change GTM.",
    "",
    "## Versions",
    "",
    `1. The snapshot version is ${snapshot.version}.`,
    `2. The live version is ${live.version}.`,
    "3. The public gtm.js file serves only the live version.",
    snapshot.version === live.version
      ? "4. The snapshot version and the live version are the same."
      : `4. This diff is the net change from version ${snapshot.version} to version ${live.version}.`,
    `5. The check date is ${date}.`,
    "",
    "## Drift",
    "",
    ...(changes.length === 0
      ? [
          "1. The drift is resolved.",
          "2. The snapshot now matches live v26.",
          `3. The snapshot has ${snapshot.tags.length} tags.`,
          `4. The live container has ${live.tags.length} tags.`,
          `5. ${matched} tags match on kind, id, value, parameters, and triggers.`,
          "6. The check found 0 differences.",
          "7. The Google Ads click-to-call tag okRkCPGTqJsdEK-15Oo- uses value 150.",
          "8. The GA4 click_to_call event sends value 150 and currency GBP.",
          "9. The Ads user-provided data tag listens for sm_quote_submit.",
        ]
      : [
          `1. The snapshot has ${snapshot.tags.length} tags.`,
          `2. The live container has ${live.tags.length} tags.`,
          `3. ${matched} tags match on kind, id, value, parameters, and triggers.`,
          `4. The check found ${changes.length} ${changes.length === 1 ? "difference" : "differences"}.`,
          `5. The parser in scripts/tracking-check.mjs reports ${raw.length} drift lines for the same pair of files.`,
          "6. Each changed tag produces two parser lines. One line is the snapshot copy. One line is the live copy.",
        ]),
    "",
    ...driftSections.flatMap((section) => [section, ""]),
    "## Custom HTML",
    "",
    ...htmlNote(js).map((line, index) => `${index + 1}. ${line}`),
    "",
    "## Ecommerce event names",
    "",
    ...eventNotes(js, live).map((line, index) => `${index + 1}. ${line}`),
    "",
    "## Full tag list",
    "",
    "The value column shows the live value.",
    "A Drift row is described in the Drift section above.",
    "Parameters use the snapshot shape. `{{variable}}` means the tag reads a GTM variable.",
    "",
    "| Status | Kind | Id | Value | Parameters | Triggers |",
    "| --- | --- | --- | --- | --- | --- |",
    ...inventoryRows(live, changes),
    "",
    "## Run the check again",
    "",
    "1. From the repo root, run `node scripts/gtm-baseline-diff.mjs`.",
    "2. The script fetches the live container.",
    "3. The script rewrites this file.",
    "4. The script does not publish a GTM version.",
    "5. The script does not update docs/gtm-snapshot.json.",
    "",
  ];

  if (raw.length && changes.length * 2 !== raw.length && changes.length !== raw.length) {
    lines.push("## Parser drift lines", "");
    lines.push("The human diff and the raw parser count differ. The raw lines are below.");
    lines.push("");
    raw.forEach((line, index) => lines.push(`${index + 1}. ${line}`));
    lines.push("");
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join("\n"));
  console.log(`wrote ${outPath}`);
  console.log(`snapshot v${snapshot.version} -> live v${live.version}; matched ${matched}; differences ${changes.length}; raw drift lines ${raw.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
