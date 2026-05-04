'use strict';

/**
 * lab-mapping.js
 *
 * Shared mapping bridge — imports TEST_MAP from hospital-lab-viewer/mapping.js
 * and adds dialysis-specific extensions (BUN pre/post filter, computed values).
 *
 * Both hospital-lab-reporter and hospital-lab-viewer use the same regex patterns,
 * so updates to mapping.js propagate to both projects automatically.
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

// ─── Import shared TEST_MAP from sibling project ─────────────────────────────

let TEST_MAP = [];
try {
  const mappingPath = path.resolve(__dirname, '..', 'hospital-lab-viewer', 'mapping.js');
  let code = fs.readFileSync(mappingPath, 'utf-8');

  // Remove 'use strict'; so it can run in vm context
  code = code.replace(/^'use strict';\s*/m, '');
  // Append extraction line
  code += '\n_result_TEST_MAP = TEST_MAP;';

  const sandbox = { _result_TEST_MAP: null };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  TEST_MAP = sandbox._result_TEST_MAP || [];
  console.log('[lab-mapping] Loaded ' + TEST_MAP.length + ' test patterns from hospital-lab-viewer/mapping.js');
} catch (err) {
  console.warn('[lab-mapping] Could not load hospital-lab-viewer/mapping.js:', err.message);
  console.warn('[lab-mapping] Falling back to empty TEST_MAP.');
}

// ─── Dialysis-specific test definitions ──────────────────────────────────────

const DIALYSIS_TESTS = [
  // ── BUN pre/post ───────────────────────────────────────────────────────────
  {
    id: 'BUN_pre',
    label: 'BUN(洗前)',
    pattern: /BUN:\s*([\d.]+)/,
    unit: 'mg/dL',
    ref: '7-25',
    hi: 25,
    lo: 7,
    filter: 'composite',
  },
  {
    id: 'BUN_post',
    label: 'BUN(洗後)',
    pattern: /BUN:\s*([\d.]+)/,
    unit: 'mg/dL',
    ref: '',
    hi: null,
    lo: null,
    filter: 'standalone_bun',
  },
  // ── 血液常規 (CBC extras not in shared TEST_MAP) ──────────────────────────
  {
    id: 'RBC',
    label: 'RBC',
    pattern: /RBC:\s*([\d.]+)/,
    unit: '×10⁶/µL',
    ref: '4.0-5.5',
    hi: 5.5,
    lo: 4.0,
  },
  {
    id: 'HCT',
    label: 'HCT',
    pattern: /(?:Hct|HCT):\s*([\d.]+)/,
    unit: '%',
    ref: '36-46',
    hi: 46,
    lo: 36,
  },
  {
    id: 'MCV',
    label: 'MCV',
    pattern: /MCV:\s*([\d.]+)/,
    unit: 'fL',
    ref: '80-100',
    hi: 100,
    lo: 80,
  },
  // ── 蛋白質 ────────────────────────────────────────────────────────────────
  {
    id: 'TP',
    label: 'Total Protein',
    pattern: /Total protein\(serum\):\s*([\d.]+)/,
    unit: 'g/dL',
    ref: '6.0-8.3',
    hi: 8.3,
    lo: 6.0,
  },
  // ── 電解質 (extras) ───────────────────────────────────────────────────────
  {
    id: 'Cl',
    label: 'Cl',
    pattern: /Cl\(Serum\):\s*([\d.]+)/,
    unit: 'mEq/L',
    ref: '98-106',
    hi: 106,
    lo: 98,
  },
  {
    id: 'Ca',
    label: 'Ca',
    pattern: /Calcium\(Serum\):\s*([\d.]+)/,
    unit: 'mg/dL',
    ref: '8.4-10.2',
    hi: 10.2,
    lo: 8.4,
  },
  {
    id: 'P',
    label: 'P',
    pattern: /Phosphorus:\s*([\d.]+)/,
    unit: 'mg/dL',
    ref: '2.5-4.5',
    hi: 4.5,
    lo: 2.5,
  },
  // ── 鐵代謝 ────────────────────────────────────────────────────────────────
  {
    id: 'TIBC',
    label: 'TIBC',
    pattern: /TIBC:\s*([\d.]+)/,
    unit: 'µg/dL',
    ref: '250-370',
    hi: 370,
    lo: 250,
  },
  {
    id: 'TSAT',
    label: 'TSAT',
    pattern: /SAT:\s*([\d.]+)/,
    unit: '%',
    ref: '20-50',
    hi: 50,
    lo: 20,
  },
  {
    id: 'Ferritin',
    label: 'Ferritin',
    pattern: /(?:Ferritin|FERRITIN):\s*([\d.]+)/,
    unit: 'ng/mL',
    ref: '200-500',
    hi: 500,
    lo: 200,
  },
  // ── 副甲狀腺 ──────────────────────────────────────────────────────────────
  {
    id: 'iPTH',
    label: 'iPTH',
    pattern: /i-PTH:\s*([\d.]+)/,
    unit: 'pg/mL',
    ref: '150-300',
    hi: 300,
    lo: 150,
  },
  // ── 肝炎 / 感染 ──────────────────────────────────────────────────────────
  {
    id: 'HBsAg',
    label: 'HBsAg',
    pattern: /HBsAg.*?:\s*([\d.]+)/,
    unit: '',
    ref: '',
    hi: null,
    lo: null,
  },
  {
    id: 'AntiHBs',
    label: 'Anti-HBs',
    pattern: /Anti-HBs.*?:\s*([\d.]+)/,
    unit: 'mIU/mL',
    ref: '>10',
    hi: null,
    lo: 10,
  },
  {
    id: 'AntiHCV',
    label: 'Anti-HCV',
    pattern: /(?:HCV|Anti-HCV).*?:\s*([\d.]+)/,
    unit: '',
    ref: '',
    hi: null,
    lo: null,
  },
  {
    id: 'HIV',
    label: 'HIV',
    pattern: /HIV.*?:\s*([\d.]+)/,
    unit: '',
    ref: '',
    hi: null,
    lo: null,
  },
  {
    id: 'RPR',
    label: 'RPR',
    pattern: /RPR.*?:\s*([\d.]+)/,
    unit: '',
    ref: '',
    hi: null,
    lo: null,
  },
];

// ─── Computed tests ──────────────────────────────────────────────────────────

const COMPUTED_TESTS = [
  {
    id: 'URR',
    label: 'URR',
    unit: '%',
    ref: '>65%',
    hi: null,
    lo: 65,
    needs: ['BUN_pre', 'BUN_post'],
    compute: function(pre, post) {
      if (pre == null || post == null || pre === 0) return null;
      return +((1 - post / pre) * 100).toFixed(1);
    },
  },
  {
    id: 'CaxP',
    label: 'CaxP',
    unit: '',
    ref: '<55',
    hi: 55,
    lo: null,
    needs: ['Ca', 'P'],
    compute: function(ca, p) {
      if (ca == null || p == null) return null;
      return +(ca * p).toFixed(1);
    },
  },
];

// ─── Lab categories ──────────────────────────────────────────────────────────

const LAB_CATEGORIES = [
  { id: 'CBC', label: '血液常規' },
  { id: 'PROTEIN', label: '蛋白質' },
  { id: 'LIVER', label: '肝功能' },
  { id: 'LIPID', label: '血脂' },
  { id: 'SUGAR', label: '血糖' },
  { id: 'RENAL', label: '腎功能' },
  { id: 'LYTE', label: '電解質' },
  { id: 'IRON', label: '鐵代謝' },
  { id: 'PTH', label: '副甲狀腺' },
  { id: 'HEPAT', label: '肝炎 / 感染' },
  { id: 'COMPUTED', label: '計算值' },
];

// IDs that should search all-time (not limited by date range)
const ALL_TIME_IDS = new Set(['HBsAg', 'AntiHBs', 'AntiHCV', 'HIV', 'RPR', 'HCV']);

module.exports = {
  TEST_MAP: TEST_MAP,
  DIALYSIS_TESTS: DIALYSIS_TESTS,
  COMPUTED_TESTS: COMPUTED_TESTS,
  LAB_CATEGORIES: LAB_CATEGORIES,
  ALL_TIME_IDS: ALL_TIME_IDS,
};
