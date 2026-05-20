#!/usr/bin/env node
'use strict';

/**
 * sync-patterns.js — Inline two auto-generated blocks into
 * hospital-lab-data.html, preserving the single-file design:
 *
 *   1. Patterns block (catalog + reporter manifest + resolver),
 *      sourced from sibling repo ../hospital-lab-patterns/patterns/.
 *      Bracketed by __HOSPITAL_LAB_PATTERNS_BEGIN__ / END__.
 *
 *   2. Groups block (concatenated groups/*.js from this repo).
 *      Bracketed by __HOSPITAL_LAB_GROUPS_BEGIN__ / END__.
 *      Each group module exposes itself via window.GROUPS[id].
 *
 * Run after editing patterns repo or any groups/*.js:
 *   node sync-patterns.js
 *   # then refresh the HTML in your browser
 */

const fs   = require('fs');
const path = require('path');

const PATTERNS_DIR = path.resolve(__dirname, '..', 'hospital-lab-patterns', 'patterns');
const GROUPS_DIR   = path.join(__dirname, 'groups');
const HTML_FILE    = path.join(__dirname, 'hospital-lab-data.html');

const BEGIN = '// __HOSPITAL_LAB_PATTERNS_BEGIN__';
const END   = '// __HOSPITAL_LAB_PATTERNS_END__';

const GROUPS_BEGIN = '// __HOSPITAL_LAB_GROUPS_BEGIN__';
const GROUPS_END   = '// __HOSPITAL_LAB_GROUPS_END__';

if (!fs.existsSync(PATTERNS_DIR)) {
  console.error('✗ patterns repo not found at: ' + PATTERNS_DIR);
  process.exit(1);
}
if (!fs.existsSync(HTML_FILE)) {
  console.error('✗ hospital-lab-data.html not found at: ' + HTML_FILE);
  process.exit(1);
}

function read(name) { return fs.readFileSync(path.join(PATTERNS_DIR, name), 'utf8'); }

const banner = [
  '// ════════════════════════════════════════════════════════════════════════════',
  '// AUTO-GENERATED BLOCK — DO NOT EDIT BETWEEN THE __PATTERNS__ MARKERS',
  '//',
  '// Source of truth: hospital-lab-patterns repo (catalog.js + reporter.js)',
  '//   https://github.com/Yuchunchen/hospital-lab-patterns',
  '//',
  '// To update:',
  '//   1. Edit ../hospital-lab-patterns/patterns/{catalog,reporter,computed}.js',
  '//   2. git commit + git push',
  '//   3. cd hospital-lab-reporter && node sync-patterns.js',
  '//   4. Reload hospital-lab-data.html in your browser',
  '//',
  '// Synced at: ' + new Date().toISOString(),
  '// ════════════════════════════════════════════════════════════════════════════',
  '',
].join('\n');

const resolverAndAliases = [
  '',
  '// ─── Resolver: merge each manifest entry on top of its catalog entry ──',
  'function _resolveManifest(manifest, cat) {',
  '  var byId = new Map(cat.map(function (e) { return [e.id, e]; }));',
  '  var out = [];',
  '  manifest.forEach(function (m) {',
  '    var id = typeof m === "string" ? m : m.id;',
  '    var base = byId.get(id);',
  '    if (!base) {',
  '      console.warn("[hospital-lab-data] manifest references unknown id: " + id);',
  '      return;',
  '    }',
  '    out.push(typeof m === "string"',
  '      ? Object.assign({}, base)',
  '      : Object.assign({}, base, m));',
  '  });',
  '  return out;',
  '}',
  '',
  '// ─── Backwards-compat aliases — names the rest of this HTML expects ──',
  'var LAB_CATEGORIES = CATEGORIES;',
  'var LAB_TESTS      = _resolveManifest(REPORTER_MANIFEST, CATALOG);',
  'var COMPUTED_TESTS = REPORTER_COMPUTED;',
  '',
].join('\n');

const catalogSrc      = read('catalog.js');
const manifestSrc     = read('reporter.js');
const normalizersSrc  = fs.existsSync(path.join(PATTERNS_DIR, 'normalizers.js'))
  ? read('normalizers.js')
  : '';
// computed.js exposes COMPUTATIONS + HELPERS as top-level consts; core/compute.js
// dispatches against COMPUTATIONS at runtime, so it must be inlined here.
const computedSrc     = read('computed.js');

const blockBody = banner + catalogSrc + normalizersSrc + manifestSrc + computedSrc + resolverAndAliases;
const replacementBlock = BEGIN + '\n' + blockBody + END;

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

let html = fs.readFileSync(HTML_FILE, 'utf8');

// ─── 1. Patterns block ────────────────────────────────────────────────────
if (html.includes(BEGIN) && html.includes(END)) {
  const re = new RegExp(escapeRegex(BEGIN) + '[\\s\\S]*?' + escapeRegex(END), 'm');
  html = html.replace(re, replacementBlock);
  console.log('✓ Updated patterns block (markers present)');
} else {
  console.error('✗ Patterns markers not found — please add manually:');
  console.error('  ' + BEGIN);
  console.error('  ... your catalog + manifest + aliases ...');
  console.error('  ' + END);
  process.exit(1);
}

// ─── 2. Groups block ──────────────────────────────────────────────────────
if (!fs.existsSync(GROUPS_DIR)) {
  console.warn('! groups/ directory not found at: ' + GROUPS_DIR + ' — skipping groups block');
} else if (!html.includes(GROUPS_BEGIN) || !html.includes(GROUPS_END)) {
  console.error('✗ Groups markers not found — please add manually:');
  console.error('  ' + GROUPS_BEGIN);
  console.error('  ' + GROUPS_END);
  process.exit(1);
} else {
  const groupFiles = fs.readdirSync(GROUPS_DIR)
    .filter(f => f.endsWith('.js'))
    .sort();

  const groupsBanner = [
    '// ════════════════════════════════════════════════════════════════════════════',
    '// AUTO-GENERATED BLOCK — DO NOT EDIT BETWEEN THE __GROUPS__ MARKERS',
    '//',
    '// Source: groups/*.js in this repo (alpha-sorted, concatenated)',
    '//',
    '// To update:',
    '//   1. Edit groups/<id>.js',
    '//   2. node sync-patterns.js',
    '//   3. Reload hospital-lab-data.html in your browser',
    '//',
    '// Synced at: ' + new Date().toISOString(),
    '// Files:    ' + (groupFiles.length ? groupFiles.join(', ') : '(none)'),
    '// ════════════════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');

  const groupsBody = groupFiles
    .map(f => '\n// ─── groups/' + f + ' ' + '─'.repeat(60 - f.length) + '\n' +
              fs.readFileSync(path.join(GROUPS_DIR, f), 'utf8'))
    .join('\n');

  const groupsReplacement = GROUPS_BEGIN + '\n' + groupsBanner + groupsBody + '\n' + GROUPS_END;
  const groupsRe = new RegExp(escapeRegex(GROUPS_BEGIN) + '[\\s\\S]*?' + escapeRegex(GROUPS_END), 'm');
  html = html.replace(groupsRe, groupsReplacement);
  console.log('✓ Updated groups block (' + groupFiles.length + ' file' +
    (groupFiles.length === 1 ? '' : 's') + ')');
}

fs.writeFileSync(HTML_FILE, html, 'utf8');
console.log('  ↳ ' + HTML_FILE);
console.log('');

// ─── 3. Phase 1 build pipeline ───────────────────────────────────────────
// build.js produces the new hospital-lab-<disease>.html files. Run it from
// the same sync entry-point so a single command keeps both legacy and new
// outputs current. Skip silently if build.js is absent (older checkouts).
const BUILD_SCRIPT = path.join(__dirname, 'build.js');
if (fs.existsSync(BUILD_SCRIPT)) {
  try {
    const { buildOne, DISEASES } = require(BUILD_SCRIPT);
    for (const id of Object.keys(DISEASES)) buildOne(id);
  } catch (e) {
    console.error('! build.js failed:', e && e.message ? e.message : e);
    process.exitCode = 1;
  }
}

console.log('');
console.log('✓ Sync complete. Refresh the HTML in your browser to load new patterns / groups.');
