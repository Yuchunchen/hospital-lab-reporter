#!/usr/bin/env node
'use strict';

/**
 * build.js — Assemble core/ + groups/<disease>.js + patterns + export-formats
 * (+ optional lib/) into a single standalone hospital-lab-<disease>.html file.
 *
 *   node build.js dialysis        → hospital-lab-dialysis.html
 *   node build.js ckd             → hospital-lab-ckd.html
 *   node build.js                 → builds every disease in DISEASES
 *
 * Phase 3 (2026-05-08) introduced:
 *   - body.html placeholders {{HEADER_TITLE}} + {{ACTION_BUTTONS}} so each
 *     disease swaps its own header text + export buttons without touching
 *     the shared body markup.
 *   - {{DISEASE_INIT}} now runs BEFORE {{CORE_JS}} so storage.js can read
 *     window.ACTIVE_GROUP_ID; storage.js falls back to 'dialysis' if unset
 *     (preserves legacy hospital-lab-data.html behavior).
 *   - {{LIB}} placeholder so a disease can pull in third-party JS (SheetJS
 *     for the renal-platform xlsx export).
 *
 * The output is a throwaway artifact (no markers, no in-place editing) — the
 * build re-reads from sibling repo + core/ + groups/ + export-formats/ + lib/
 * each time. Legacy hospital-lab-data.html stays as a reference until users
 * migrate.
 */

const fs   = require('fs');
const path = require('path');

const ROOT          = __dirname;
const CORE_DIR      = path.join(ROOT, 'core');
const GROUPS_DIR    = path.join(ROOT, 'groups');
const FORMATS_DIR   = path.join(ROOT, 'export-formats');
const LIB_DIR       = path.join(ROOT, 'lib');
const PATTERNS_DIR  = path.resolve(ROOT, '..', 'hospital-lab-patterns', 'patterns');

// ─── Disease catalogue ───────────────────────────────────────────────────────
// Each entry owns its title, group module id, the right-side action-button
// markup, an optional list of third-party libs to inline, and the disease-
// init JS that sets window.ACTIVE_GROUP_ID.

const DISEASES = {
  dialysis: {
    title: '洗腎室檢驗資料管理',
    headerTitle: '洗腎室檢驗資料管理',
    groupId: 'dialysis',
    libs: [],
    exportFormats: ['kiditi-csv'],
    actionButtons: [
      '            <button class="btn btn-primary" id="btnRefreshList" onclick="refreshExistingPatients()"',
      '              style="padding:12px 32px; font-size:1.15em; font-weight:600; box-shadow:0 2px 6px rgba(52,152,219,0.35); margin-right:16px;">全部更新</button>',
      '            <button class="btn btn-warning" id="btnExportKiDiTi" onclick="exportKiDiTiCSV()"',
      '              style="padding:12px 32px; font-size:1.15em; font-weight:600; box-shadow:0 2px 6px rgba(230,126,34,0.35);">匯出KiDiTi資料</button>',
      '            <button class="btn btn-warning" id="btnExportCSV" onclick="exportCombinedCSV()"',
      '              style="padding:12px 32px; font-size:1.15em; font-weight:600; box-shadow:0 2px 6px rgba(230,126,34,0.35);">匯出csv</button>',
    ].join('\n'),
  },

  ckd: {
    title: '初期慢性腎臟病檢驗資料管理',
    headerTitle: '初期慢性腎臟病檢驗資料管理',
    groupId: 'early-ckd',
    libs: ['xlsx.mini.min.js'],
    exportFormats: ['renal-platform-xlsx'],
    actionButtons: [
      '            <button class="btn btn-primary" id="btnRefreshList" onclick="refreshExistingPatients()"',
      '              style="padding:12px 32px; font-size:1.15em; font-weight:600; box-shadow:0 2px 6px rgba(52,152,219,0.35); margin-right:16px;">全部更新</button>',
      '            <button class="btn btn-warning" id="btnExportRenalPlatform" onclick="exportRenalPlatformXlsx()"',
      '              style="padding:12px 32px; font-size:1.15em; font-weight:600; box-shadow:0 2px 6px rgba(230,126,34,0.35);">匯出腎平台資料</button>',
      '            <button class="btn btn-warning" id="btnExportCSV" onclick="exportCombinedCSV()"',
      '              style="padding:12px 32px; font-size:1.15em; font-weight:600; box-shadow:0 2px 6px rgba(230,126,34,0.35);">匯出csv</button>',
    ].join('\n'),
  },
};

// ─── core/ load order ────────────────────────────────────────────────────────
// Top-level fn declarations hoist so order is mostly cosmetic, but module
// IIFEs (the dropLegacyOrdersCache one in indexeddb-cache.js, the
// migrateLegacyStorage one in storage.js) and the storage.js
// `const ACTIVE_GROUP_ID = ...` expression must run AFTER the disease-init
// block writes window.ACTIVE_GROUP_ID. shell.html positions
// {{DISEASE_INIT}} above {{CORE_JS}} to satisfy that.
//
// init.js MUST be last so the DOMContentLoaded handler sees every helper.
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

// ─── Library block (per-disease vendor JS, e.g. SheetJS) ─────────────────────
function buildLibBlock(libs) {
  if (!libs || !libs.length) return '';
  const banner = [
    '// ════════════════════════════════════════════════════════════════════════════',
    '// VENDOR LIBS (built by build.js, source: lib/*)',
    '//   Loaded: ' + libs.join(', '),
    '// ════════════════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');
  const body = libs
    .map(name => {
      const file = path.join(LIB_DIR, name);
      if (!fs.existsSync(file)) {
        throw new Error('[build] missing lib: ' + name + ' — expected at ' + file);
      }
      return '\n// ─── lib/' + name + ' ' + '─'.repeat(Math.max(2, 50 - name.length)) + '\n' +
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

// ─── Disease init block ─────────────────────────────────────────────────────
// Sets window.ACTIVE_GROUP_ID before storage.js runs. Must execute as
// top-level JS inside the same <script> tag, BEFORE the core block.
function buildDiseaseInit(disease) {
  return [
    '// ════════════════════════════════════════════════════════════════════════════',
    '// DISEASE INIT — disease: ' + disease.groupId,
    '// ════════════════════════════════════════════════════════════════════════════',
    'window.ACTIVE_GROUP_ID = ' + JSON.stringify(disease.groupId) + ';',
  ].join('\n');
}

// ─── Build orchestration ────────────────────────────────────────────────────
function buildOne(diseaseId) {
  const disease = DISEASES[diseaseId];
  if (!disease) throw new Error('[build] unknown disease: ' + diseaseId);

  const shell  = fs.readFileSync(path.join(CORE_DIR, 'shell.html'), 'utf8');
  const styles = fs.readFileSync(path.join(CORE_DIR, 'styles.css'), 'utf8');
  let bodyHtml = fs.readFileSync(path.join(CORE_DIR, 'body.html'), 'utf8');

  // Body-level placeholders (header text + per-disease action buttons).
  bodyHtml = bodyHtml
    .replace('{{HEADER_TITLE}}',   disease.headerTitle || disease.title)
    .replace('{{ACTION_BUTTONS}}', disease.actionButtons || '');

  const out = shell
    .replace('{{TITLE}}',          disease.title)
    .replace('{{STYLES}}',         styles)
    .replace('{{BODY_HTML}}',      bodyHtml)
    .replace('{{PATTERNS}}',       buildPatternsBlock())
    .replace('{{GROUPS}}',         buildGroupsBlock())
    .replace('{{DISEASE_INIT}}',   buildDiseaseInit(disease))
    .replace('{{CORE_JS}}',        buildCoreBlock())
    .replace('{{LIB}}',            buildLibBlock(disease.libs))
    .replace('{{EXPORT_FORMATS}}', buildExportFormats(disease.exportFormats));

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
