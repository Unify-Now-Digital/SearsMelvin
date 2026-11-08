#!/usr/bin/env node
// Compare two full-page screenshot trees.
//
//   node tests/visual/compare.mjs <actual-dir> [expected-dir]
//
// expected-dir defaults to tests/visual/baseline, next to this file.
// A pixel counts as different only when pixelmatch's colour distance
// is above the threshold. The default threshold is 0.1.
// The default maxDiffPixels is 0. Do not raise either value to hide a change.
//
//   VISUAL_THRESHOLD=0.1 VISUAL_MAX_DIFF_PIXELS=0 node tests/visual/compare.mjs preview baseline
//
// Masks applied by the capture: none.

import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch");

const threshold = process.env.VISUAL_THRESHOLD === undefined ? 0.1 : Number(process.env.VISUAL_THRESHOLD);
const maxDiffPixels = process.env.VISUAL_MAX_DIFF_PIXELS === undefined ? 0 : Number(process.env.VISUAL_MAX_DIFF_PIXELS);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".png")) out.push(full);
  }
  return out.sort();
}

function loadPng(file) {
  return PNG.sync.read(readFileSync(file));
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const actualDir = path.resolve(process.argv[2] || "");
  const expectedDir = path.resolve(process.argv[3] || path.join(scriptDir, "baseline"));
  if (!process.argv[2]) {
    console.error("Usage: node tests/visual/compare.mjs <actual-dir> [expected-dir]");
    process.exit(2);
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    console.error("VISUAL_THRESHOLD must be a number from 0 to 1.");
    process.exit(2);
  }
  if (!Number.isInteger(maxDiffPixels) || maxDiffPixels < 0) {
    console.error("VISUAL_MAX_DIFF_PIXELS must be an integer >= 0.");
    process.exit(2);
  }

  const expected = walk(expectedDir);
  if (!expected.length) {
    console.error(`No PNG files in ${expectedDir}`);
    process.exit(2);
  }

  let failed = 0;
  console.log(`threshold ${threshold}; maxDiffPixels ${maxDiffPixels}; masks none`);
  for (const expectedFile of expected) {
    const rel = path.relative(expectedDir, expectedFile);
    const actualFile = path.join(actualDir, rel);
    let actual;
    let reference;
    try {
      actual = loadPng(actualFile);
      reference = loadPng(expectedFile);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${rel} ${error.message}`);
      continue;
    }
    if (actual.width !== reference.width || actual.height !== reference.height) {
      failed += 1;
      console.log(`FAIL ${rel} size ${actual.width}x${actual.height} vs ${reference.width}x${reference.height}`);
      continue;
    }
    const diff = pixelmatch(reference.data, actual.data, null, reference.width, reference.height, {
      threshold,
    });
    if (diff > maxDiffPixels) {
      failed += 1;
      console.log(`FAIL ${rel} diffPixels ${diff}`);
    } else {
      console.log(`PASS ${rel} diffPixels ${diff}`);
    }
  }
  console.log(failed ? `${failed} file(s) failed` : `${expected.length} file(s) passed`);
  process.exit(failed ? 1 : 0);
}

main();
