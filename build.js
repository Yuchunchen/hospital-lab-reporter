#!/usr/bin/env node
'use strict';

/**
 * build.js — Assemble core/ + groups/<disease>.js + patterns + export-formats
 * into a single standalone hospital-lab-<disease>.html file.
 *
 *   node build.js dialysis        → hospital-lab-dialysis.html
 *   node build.js                 → builds every disease in DISEASES
 *
 * The output is a throwaway artifact (no markers, no in-place editing) — the
 * build re-reads from sibling repo + core/ + groups/ + export-formats/ each
 * time. Legacy hospital-lab-data.html stays as a reference until users
 * migrate.
 */

const fs   = require('fs');
const path = require('path');

const ROOT          = __dirname;
const CORE_DIR      = path.join(ROOT, 'core');
const GROUPS_DIR    = path.join(ROOT, 'groups');
const FORMATS_DIR   = path.join(ROOT, 'export-formats');
const PATTERNS_DIR  = path.resolve(ROOT, '..', 'hospital-lab-patterns', 'patterns');

// ─── Disease catalogue ───────────────────────────────────────────────────────
// Phase 1 ships dialysis only; future phases (ckd / dm / esrd) add entries
// here and any disease-specific export-formats they need.
const DISEASES = {
  dialysis: {
    title: '洗腎室檢驗資料管理',
    groupId: 'dialysis',
    exportFormats: ['kiditi-csv'],
  },
};

// ─── core/ load order ────────────────────────────────────────────────────────
// Top-level fn declarations hoist so order is mostly cosmetic — but module
// IIFEs (the dropLegacyOrdersCache one in indexeddb-cache.js, the
// migrateLegacyStorage one in storage.js) must run BEFORE anything that
// touches their state. init.js MUST be last so the DOMContentLoaded handler
// sees every helper.
const CORE_ORDER = [
  'storage.js',
  'chart-format.js',
  'date-utils.js',
  'fetch.js',
  'indexeddb-cache.js',
  'enrichment.js',
  'lab-extract.js',
  'compute.js',
  'ui-tabs.js',
  'ui-patient-list.js',
  'ui-remove-patient.js',
  'ui-patient-crud.js',
  'ui-lab-view.js',
  'ui-settings.js',
  'export-utils.js',
  'init.js',
];

// ─── Patterns block construction (mirrors sync-patterns.js) ─────────────────
function readPattern(name) {
  return fs.readFileSync(path.join(PATTERNS_DIR, name), 'utf8');
}

function buildPatternsBlock() {
  const banner = [
    '// ════════════════════════════════════════════════════════════════════════════',
    '// PATTERNS BLOCK (built by build.js, source: hospital-lab-patterns repo)',
    '//   Synced at: ' + new Date().toISOString(),
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
    '      console.warn("[hospital-lab build] manifest references unknown id: " + id);',
    '      return;',
    '    }',
    '    out.push(typeof m === "string"',
    '      ? Object.assign({}, base)',
    '      : Object.assign({}, base, m));',
    '  });',
    '  return out;',
    '}',
    '',
    '// ─── Backwards-compat aliases — names the rest of the app expects ──',
    'var LAB_CATEGORIES = CATEGORIES;',
    'var LAB_TESTS      = _resolveManifest(REPORTER_MANIFEST, CATALOG);',
    'var COMPUTED_TESTS = REPORTER_COMPUTED;',
    '',
  ].join('\n');

  const catalogSrc     = readPattern('catalog.js');
  const manifestSrc    = readPattern('reporter.js');
  const normalizersSrc = fs.existsSync(path.join(PATTERNS_DIR, 'normalizers.js'))
    ? readPattern('normalizers.js')
    : '';

  return banner + catalogSrc + normalizersSrc + manifestSrc + resolverAndAliases;
}

// ─── Groups block (concatenated alpha-sorted groups/*.js) ───────────────────
function buildGroupsBlock() {
  if (!fs.existsSync(GROUPS_DIR)) return '';
  const files = fs.readdirSync(GROUPS_DIR).filter(f => f.endsWith('.js')).sort();
  const banner = [
    '// ════════════════════════════════════════════════════════════════════════════',
    '// GROUPS BLOCK (built by build.js, source: groups/*.js)',
    '//   Files: ' + files.join(', '),
    '// ════════════════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
  const body = files
    .map(f =>
      '\n// ─── groups/' + f + ' ' + '─'.repeat(Math.max(2, 60 - f.length)) + '\n' +
      fs.readFileSync(path.join(GROUPS_DIR, f), 'utf8'))
    .join('\n');
  return banner + body;
}

// ─── Core JS block ──────────────────────────────────────────────────────────
function buildCoreBlock() {
  const banner = [
    '// ════════════════════════════════════════════════════════════════════════════',
    '// CORE JS (built by build.js, source: core/*.js, load order fixed)',
    '// ════════════════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
  const body = CORE_ORDER
    .map(name => {
      const file = path.join(CORE_DIR, name);
      if (!fs.existsSync(file)) {
        throw new Error('[build] missing core module: ' + name);
      }
      return '\n// ─── core/' + name + ' ' + '─'.repeat(Math.max(2, 60 - name.length)) + '\n' +
             fs.readFileSync(file, 'utf8');
    })
    .join('\n');
  return banner + body;
}

// ─── Export-formats block (per disease) ─────────────────────────────────────
function buildExportFormats(formats) {
  if (!formats || !formats.length) return '';
  const banner = [
    '// ════════════════════════════════════════════════════════════════════════════',
    '// EXPORT FORMATS (built by build.js, source: export-formats/*.js)',
    '//   Loaded: ' + formats.join(', '),
    '// ════════════════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
  const body = formats
    .map(name => {
      const file = path.join(FORMATS_DIR, name + '.js');
      if (!fs.existsSync(file)) {
        throw new Error('[build] missing export-format: ' + name);
      }
      return '\n// ─── export-formats/' + name + '.js ' + '─'.repeat(Math.max(2, 50 - name.length)) + '\n' +
             fs.readFileSync(file, 'utf8');
    })
    .join('\n');
  return banner + body;
}

// ─── Disease init — placeholder for Phase 3 ─────────────────────────────────
// Phase 1 keeps storage.js's hardcoded ACTIVE_GROUP_ID = 'dialysis', so the
// init block is a no-op marker. Phase 3 will switch storage.js to read from
// window.ACTIVE_GROUP_ID and this block will set it.
function buildDiseaseInit(disease) {
  return [
    '// ════════════════════════════════════════════════════════════════════════════',
    '// DISEASE INIT — disease: ' + disease.groupId,
    '// ════════════════════════════════════════════════════════════════════════════',
  ].join('\n');
}

// ─── Build orchestration ────────────────────────────────────────────────────
function buildOne(diseaseId) {
  const disease = DISEASES[diseaseId];
  if (!disease) throw new Error('[build] unknown disease: ' + diseaseId);

  const shell  = fs.readFileSync(path.join(CORE_DIR, 'shell.html'), 'utf8');
  const styles = fs.readFileSync(path.join(CORE_DIR, 'styles.css'), 'utf8');
  const body   = fs.readFileSync(path.join(CORE_DIR, 'body.html'), 'utf8');

  const out = shell
    .replace('{{TITLE}}',          disease.title)
    .replace('{{STYLES}}',         styles)
    .replace('{{BODY_HTML}}',      body)
    .replace('{{PATTERNS}}',       buildPatternsBlock())
    .replace('{{GROUPS}}',         buildGroupsBlock())
    .replace('{{CORE_JS}}',        buildCoreBlock())
    .replace('{{EXPORT_FORMATS}}', buildExportFormats(disease.exportFormats))
    .replace('{{DISEASE_INIT}}',   buildDiseaseInit(disease));

  const target = path.join(ROOT, 'hospital-lab-' + diseaseId + '.html');
  fs.writeFileSync(target, out, 'utf8');
  console.log('✓ ' + path.relative(ROOT, target) + ' (' + (out.length / 1024).toFixed(1) + ' KB)');
}

function main() {
  const arg = process.argv[2];
  const targets = arg ? [arg] : Object.keys(DISEASES);
  for (const id of targets) buildOne(id);
}

if (require.main === module) main();
module.exports = { buildOne, DISEASES };
