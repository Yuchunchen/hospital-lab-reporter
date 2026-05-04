#!/usr/bin/env node
'use strict';

/**
 * sync-patterns.js — Inline catalog + reporter manifest + resolver into
 * hospital-lab-data.html between the __HOSPITAL_LAB_PATTERNS_BEGIN__ /
 * __HOSPITAL_LAB_PATTERNS_END__ markers, preserving the single-file design.
 *
 * Source of truth: hospital-lab-patterns repo
 *   https://github.com/Yuchunchen/hospital-lab-patterns
 *
 * Run after every change in ../hospital-lab-patterns:
 *   node sync-patterns.js
 *   # then refresh the HTML in your browser
 */

const fs   = require('fs');
const path = require('path');

const PATTERNS_DIR = path.resolve(__dirname, '..', 'hospital-lab-patterns', 'patterns');
const HTML_FILE    = path.join(__dirname, 'hospital-lab-data.html');

const BEGIN = '// __HOSPITAL_LAB_PATTERNS_BEGIN__';
const END   = '// __HOSPITAL_LAB_PATTERNS_END__';

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
  '//   1. Edit ../hospital-lab-patterns/patterns/{catalog,reporter}.js',
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

const catalogSrc  = read('catalog.js');
const manifestSrc = read('reporter.js');

const blockBody = banner + catalogSrc + manifestSrc + resolverAndAliases;
const replacementBlock = BEGIN + '\n' + blockBody + END;

let html = fs.readFileSync(HTML_FILE, 'utf8');

if (html.includes(BEGIN) && html.includes(END)) {
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  const re = new RegExp(escapeRegex(BEGIN) + '[\\s\\S]*?' + escapeRegex(END), 'm');
  html = html.replace(re, replacementBlock);
  console.log('✓ Updated existing pattern block (markers present)');
} else {
  console.error('✗ Markers not found — please add manually around your data block:');
  console.error('  ' + BEGIN);
  console.error('  ... your catalog + manifest + aliases ...');
  console.error('  ' + END);
  process.exit(1);
}

fs.writeFileSync(HTML_FILE, html, 'utf8');
console.log('  ↳ ' + HTML_FILE);
console.log('');
console.log('✓ Sync complete. Refresh the HTML in your browser to load new patterns.');
