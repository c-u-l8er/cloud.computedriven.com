#!/usr/bin/env node
// M0 acceptance check: every locally-referenced asset actually exists on disk.
//
//   node tools/check-assets.mjs
//
// WHY
//
// An outside reviewer noticed the review tarball referenced `/amp-nav.js` and
// `/fonts/*.woff2` without containing them, and could not tell whether the site
// was deployable or whether the nav would render as an empty custom element.
// The files were present in the repo -- the tarball excludes them deliberately
// to save 120 KB -- but "I checked once by hand" is not an acceptance criterion.
//
// The failure this guards against is specific and quiet: a missing amp-nav.js
// does not break the page. `<amp-nav>` is an unregistered custom element, so it
// renders as an empty inline box and the site looks fine while the portfolio
// navigation is simply gone.
//
// Exit code is the number of missing assets, so it works as a gate.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (e === "fonts" || e === "tools" || e.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sources = walk(SITE).filter((p) => /\.(html|css)$/.test(p));

// Local, root-relative references only. External URLs are a different question
// and a strict CSP problem, not a packaging one.
const PATTERNS = [
  /(?:href|src)\s*=\s*["'](\/[^"'#?]+)["']/g,
  /url\(\s*["']?(\/[^"')?#]+)["']?\s*\)/g,
];

const refs = new Map(); // asset path -> [referrers]
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const p = m[1];
      // Extensionless routes are Pages' own rewriting, not files on disk.
      if (!/\.[a-z0-9]+$/i.test(p)) continue;
      if (!refs.has(p)) refs.set(p, []);
      refs.get(p).push(file.slice(SITE.length + 1));
    }
  }
}

let missing = 0;
const rows = [...refs.entries()].sort();
for (const [asset, referrers] of rows) {
  const onDisk = join(SITE, asset);
  const ok = existsSync(onDisk);
  const size = ok ? `${(statSync(onDisk).size / 1024).toFixed(1)} KB` : "—";
  if (!ok) missing++;
  console.log(
    `  ${ok ? "ok  " : "MISS"}  ${asset.padEnd(34)} ${size.padStart(9)}   ${
      [...new Set(referrers)].length
    } page(s)`
  );
}

console.log("");
if (missing) {
  console.error(`  ${missing} referenced asset(s) missing — the site is NOT deployable\n`);
  process.exit(missing);
}
console.log(`  ok       ${rows.length} referenced assets all present\n`);
