#!/usr/bin/env node
// Render status.json into the public pages, or verify they have not drifted.
//
//   node tools/render-status.mjs           write
//   node tools/render-status.mjs --verify  exit 1 if any page disagrees
//
// WHY THIS EXISTS
//
// Statuses hand-copied across pages drift, and they drift in the flattering
// direction. This tree has the receipts: a law count published as 116 while the
// suite derived 118, and a ladder rung that changed the day after it was
// written down. So no page hand-writes a rung. They are written between
// sentinels from one file, and --verify is a release gate.
//
// Zero dependencies on purpose -- a status renderer that needs an install step
// is a status renderer that stops being run.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, "..");
const VERIFY = process.argv.includes("--verify");

const status = JSON.parse(readFileSync(join(SITE, "status.json"), "utf8"));

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const RUNG_ORDER = ["live", "staged", "local", "spec"];
const byRung = (a, b) =>
  RUNG_ORDER.indexOf(a.rung) - RUNG_ORDER.indexOf(b.rung) ||
  a.label.localeCompare(b.label);

function counts() {
  const c = {};
  for (const r of Object.keys(status.rungs)) c[r] = 0;
  for (const cap of status.capabilities) c[cap.rung]++;
  return c;
}

// --- the blocks -------------------------------------------------------------

function renderBanner() {
  const c = counts();
  const total = status.capabilities.length;
  return `<p class="banner" role="status">
  <strong>Nothing here is deployed.</strong>
  Of ${total} capabilities, <b>${c.local}</b> run and are tested on a developer machine
  and <b>${c.spec}</b> are written down and not built.
  <b>${c.live}</b> are serving the public.
  <a href="/status">The full table</a> says which is which, as of ${esc(status.as_of)}.
</p>`;
}

function renderTable() {
  const rows = [...status.capabilities].sort(byRung).map(
    (c) => `    <tr>
      <th scope="row">${esc(c.label)}</th>
      <td><span class="rung rung-${esc(c.rung)}">${esc(c.rung)}</span></td>
      <td>${esc(c.note)}</td>
      <td><code>${esc(c.evidence)}</code></td>
    </tr>`
  );
  return `<table class="status">
  <caption>Capability rungs, as of ${esc(status.as_of)} — ${esc(status.round)}</caption>
  <thead>
    <tr><th scope="col">Capability</th><th scope="col">Rung</th><th scope="col">What that means here</th><th scope="col">Where to check</th></tr>
  </thead>
  <tbody>
${rows.join("\n")}
  </tbody>
</table>`;
}

function renderLegend() {
  const items = RUNG_ORDER.map(
    (r) =>
      `  <dt><span class="rung rung-${r}">${r}</span></dt>\n  <dd>${esc(status.rungs[r])}</dd>`
  );
  return `<dl class="legend">\n${items.join("\n")}\n</dl>`;
}

function renderBattery() {
  const b = status.battery;
  return `<table>
  <caption><code>${esc(b.command)}</code> — ${b.total} checks, mostly negative, as of ${esc(b.as_of)}</caption>
  <thead>
    <tr><th scope="col">Run</th><th scope="col">Passed</th><th scope="col">Failed</th><th scope="col">What it demonstrates</th></tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">Normal</th>
      <td class="num">${b.normal_passed}</td>
      <td class="num">${b.normal_failed}</td>
      <td>Cross-tenant reads, writes, updates and deletes all refuse.</td>
    </tr>
    <tr>
      <th scope="row">Sabotaged</th>
      <td class="num">${b.sabotage_passed}</td>
      <td class="num">${b.sabotage_failed}</td>
      <td>With the naive function installed, an unscoped query returns <code>0</code> rows and reports success. The battery catches it.</td>
    </tr>
    <tr>
      <th scope="row">Regression proof</th>
      <td class="num">${b.total - b.regression_failed}</td>
      <td class="num">${b.regression_failed}</td>
      <td>With migrations ${esc(b.regression_removed)} removed, the checks added for those defects fail — so they are load-bearing, not decorative.</td>
    </tr>
    <tr>
      <th scope="row">Concurrency</th>
      <td class="num">${b.concurrency_passed ?? "—"}</td>
      <td class="num">${b.concurrency_failed ?? "—"}</td>
      <td>Two real sessions, hand-stepped to a deliberate interleaving — <code>${esc(b.concurrency_command ?? "")}</code>. Simultaneous first logins resolve to one principal; simultaneous quota requests cannot oversubscribe. Serial correctness is not concurrent correctness.</td>
    </tr>
    <tr>
      <th scope="row">Worker suite</th>
      <td class="num">${b.worker_tests}</td>
      <td class="num">${b.worker_failed}</td>
      <td>Token verification, tenant context, credential scoping, provider refinement and storage admission — <code>${esc(b.worker_command)}</code>. No account, no network, no dependencies.</td>
    </tr>
    <tr>
      <th scope="row">Worker mutations</th>
      <td class="num">${b.worker_mutations_caught}</td>
      <td class="num">${b.worker_mutations_total - b.worker_mutations_caught}</td>
      <td>Each vector breaks one security decision in a copy of the source and re-runs the unmodified suite. A surviving mutation is an untested decision.</td>
    </tr>
  </tbody>
</table>`;
}

// --- the auth surface -------------------------------------------------------
//
// Sign-in is the one control a visitor tries before reading anything, so it is
// the worst possible place for a hand-written status. It appears in the header
// of every page and in the foot of every page -- fourteen copies of one fact --
// and the fact is `portal_login`'s rung. So the header tag and the footer note
// are generated from status.json like everything else, and the day portal
// sign-in leaves `spec` they change on every page in one command rather than in
// fourteen edits, thirteen of which would be made and one of which would not.

function cap(key) {
  const c = status.capabilities.find((c) => c.key === key);
  if (!c) throw new Error(`status.json has no capability "${key}" — the auth blocks name it`);
  return c;
}

// The chain a sign-in actually has to walk. Listed by key so a relabelled
// capability follows its label here instead of silently dropping out.
const SIGNIN_CHAIN = [
  "keycloak_realm",
  "portal_login",
  "token_verification",
  "identity_mapping",
  "stable_org_identity",
];

function renderAuthCta(page) {
  const c = cap("portal_login");
  const tag = c.rung === "live" ? "" : ` <span class="tag">${esc(c.rung)}</span>`;
  const current = page === "auth.html" ? ' aria-current="page"' : "";
  return `<a class="site-auth" href="/auth"${current}>Sign in${tag}</a>`;
}

function renderFootAuth() {
  const c = cap("portal_login");
  const note =
    c.rung === "live"
      ? "Accounts, organizations, and enrolling a machine into a fleet."
      : `There is no sign-in yet — <code>portal_login</code> stands at <b>${esc(c.rung)}</b>. The auth page says what has to exist before there is a door here, and <a href="/status">the status table</a> carries the rung.`;
  return `<div class="foot-auth">
  <a class="foot-auth-cta" href="/auth">Sign in &rarr;</a>
  <p class="foot-auth-note">${note}</p>
</div>`;
}

function renderSignin() {
  const rows = SIGNIN_CHAIN.map(cap).map(
    (c) => `    <tr>
      <th scope="row">${esc(c.label)}</th>
      <td><span class="rung rung-${esc(c.rung)}">${esc(c.rung)}</span></td>
      <td>${esc(c.note)}</td>
    </tr>`
  );
  return `<table>
  <caption>What a sign-in has to walk through, and where each part stands as of ${esc(status.as_of)}</caption>
  <thead>
    <tr><th scope="col">Part</th><th scope="col">Rung</th><th scope="col">What that means here</th></tr>
  </thead>
  <tbody>
${rows.join("\n")}
  </tbody>
</table>`;
}

const BLOCKS = {
  banner: renderBanner,
  table: renderTable,
  legend: renderLegend,
  battery: renderBattery,
  authcta: renderAuthCta,
  footauth: renderFootAuth,
  signin: renderSignin,
};

// --- apply ------------------------------------------------------------------

// 404.html and auth.html carry no rung table, but they do carry the header's
// auth control and the footer's, so they are in the gate for the same reason
// the others are: a page the renderer does not know about is a page that drifts.
const PAGES = [
  "index.html",
  "architecture.html",
  "security.html",
  "pricing.html",
  "status.html",
  "auth.html",
  "404.html",
];

let drifted = 0;
let wrote = 0;

for (const page of PAGES) {
  const path = join(SITE, page);
  let html;
  try {
    html = readFileSync(path, "utf8");
  } catch {
    console.error(`  missing  ${page}`);
    drifted++;
    continue;
  }

  let next = html;
  for (const [name, render] of Object.entries(BLOCKS)) {
    const re = new RegExp(
      `(<!-- STATUS:${name}:BEGIN -->)([\\s\\S]*?)(<!-- STATUS:${name}:END -->)`,
      "g"
    );
    // Renderers take the page name so a block can mark itself current on the
    // page it points at. Most ignore it; the header's auth control does not.
    next = next.replace(re, (_m, open, _body, close) => `${open}\n${render(page)}\n${close}`);
  }

  if (next === html) continue;
  if (VERIFY) {
    console.error(`  DRIFT    ${page} — regenerate with: node tools/render-status.mjs`);
    drifted++;
  } else {
    writeFileSync(path, next);
    console.log(`  wrote    ${page}`);
    wrote++;
  }
}

if (VERIFY) {
  if (drifted) {
    console.error(`\n  ${drifted} page(s) disagree with status.json\n`);
    process.exit(1);
  }
  console.log(`  ok       ${PAGES.length} pages agree with status.json`);
} else {
  console.log(`  ok       ${wrote} page(s) updated from status.json`);
}
