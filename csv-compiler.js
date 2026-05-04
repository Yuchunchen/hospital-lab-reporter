'use strict';

/**
 * csv-compiler.js — Monthly CSV report compilation for hemodialysis patients.
 *
 * Compiles lab data for all patients into a wide-format CSV:
 *   One row per patient, columns = all specified lab tests.
 *
 * Column order (per requirements):
 *   chartno, name, date, WBC, RBC, Hb, HCT, MCV, Platelet,
 *   Total_Protein, Albumin, AST, ALT, ALP, T_Bilirubin,
 *   Cholesterol, LDL, Triglyceride, Glucose_AC,
 *   BUN_pre, BUN_post, Creatinine, Uric_Acid,
 *   Na, K, Cl, Ca, P,
 *   Iron, TIBC, TSAT, Ferritin, iPTH, HbA1c,
 *   HBsAg, Anti_HBs, Anti_HCV, AFP, HIV, RPR,
 *   URR, CaxP
 *
 * Monthly tests: filled from the target month's data.
 * Yearly/one-time tests (HBsAg, Anti-HBs, Anti-HCV, AFP, HIV, RPR):
 *   Only filled when performed during the target month.
 */

const { fetchAllOrders, extractLabValues, computeDerivedValues } = require('./fetcher');
const { loadPatients, loadSettings } = require('./patients');

// ─── CSV Column Definitions ─────────────────────────────────────────────────
// Each entry maps a CSV column header to the test ID used in extractLabValues.
// The test IDs come from both TEST_MAP (shared with hospital-lab-viewer)
// and DIALYSIS_TESTS (BUN_pre, BUN_post).

const CSV_COLUMNS = [
  { header: 'chartno',       source: '_chartno' },
  { header: 'name',          source: '_name' },
  { header: 'gender',        source: '_gender' },
  { header: 'age',           source: '_age' },
  { header: 'schedule',      source: '_schedule' },
  { header: 'shift',         source: '_shift' },
  { header: 'date',          source: '_date' },
  // 血液常規
  { header: 'WBC',           source: 'WBC' },
  { header: 'RBC',           source: 'RBC' },
  { header: 'Hb',            source: 'Hb' },
  { header: 'HCT',           source: 'HCT' },
  { header: 'MCV',           source: 'MCV' },
  { header: 'Platelet',      source: 'Platelet' },
  // 蛋白質
  { header: 'Total_Protein', source: 'TP' },
  { header: 'Albumin',       source: 'Albumin' },
  // 肝功能
  { header: 'AST_GOT',       source: 'GOT' },
  { header: 'ALT_GPT',       source: 'GPT' },
  { header: 'ALP',           source: 'ALP',    fallback: 'ALKP' },
  { header: 'T_Bilirubin',   source: 'TBIL' },
  // 血脂
  { header: 'Cholesterol',   source: 'CHOL' },
  { header: 'LDL',           source: 'LDL' },
  { header: 'Triglyceride',  source: 'TG' },
  // 血糖
  { header: 'Glucose_AC',    source: 'Glucose', fallback: 'GluAC' },
  // 腎功能
  { header: 'BUN_pre',       source: 'BUN_pre' },
  { header: 'BUN_post',      source: 'BUN_post' },
  { header: 'Creatinine',    source: 'CREAT' },
  { header: 'Uric_Acid',     source: 'UA' },
  // 電解質
  { header: 'Na',            source: 'NA',      fallback: 'Na' },
  { header: 'K',             source: 'K' },
  { header: 'Cl',            source: 'Cl' },
  { header: 'Ca',            source: 'Ca',      fallback: 'FreeCa' },
  { header: 'P',             source: 'P' },
  // 鐵代謝
  { header: 'Iron',          source: 'FE',      fallback: 'Fe' },
  { header: 'TIBC',          source: 'TIBC' },
  { header: 'TSAT',          source: 'TSAT' },
  { header: 'Ferritin',      source: 'Ferritin' },
  // 副甲狀腺
  { header: 'iPTH',          source: 'iPTH' },
  // 血糖
  { header: 'HbA1c',         source: 'HbA1C',   fallback: 'HbA1c' },
  // 肝炎 / 感染 (yearly or one-time — only when performed that month)
  { header: 'HBsAg',         source: 'HBsAg',   periodic: true },
  { header: 'Anti_HBs',      source: 'AntiHBs',  fallback: 'Anti-HBs', periodic: true },
  { header: 'Anti_HCV',      source: 'AntiHCV',  fallback: 'HCV', periodic: true },
  { header: 'AFP',           source: 'AFP',      periodic: true },
  { header: 'HIV',           source: 'HIV',      periodic: true },
  { header: 'RPR',           source: 'RPR',      periodic: true },
  // 計算值
  { header: 'URR',           source: 'URR' },
  { header: 'CaxP',          source: 'CaxP' },
];

/**
 * Get the date range for a given month.
 * @param {number} year  - Gregorian year (e.g. 2026)
 * @param {number} month - 1-based month (1=Jan, 12=Dec)
 * @returns {{ startDate: Date, endDate: Date }}
 */
function getMonthRange(year, month) {
  const startDate = new Date(year, month - 1, 1, 0, 0, 0);
  const endDate = new Date(year, month, 0, 23, 59, 59); // last day of month
  return { startDate, endDate };
}

/**
 * Find the value for a test within the target month.
 * Returns the most recent value in that month, or empty string if none.
 *
 * @param {Array} entries - Array of { date, value, ... } sorted newest first
 * @param {string} monthPrefix - "YYYY-MM" prefix to match
 * @returns {string|number} The value or ''
 */
function findMonthValue(entries, monthPrefix) {
  if (!entries || !Array.isArray(entries)) return '';
  for (const e of entries) {
    if (e.date && e.date.startsWith(monthPrefix)) {
      return e.value;
    }
  }
  return '';
}

/**
 * Compile CSV data for all patients for a given month.
 *
 * @param {number} year
 * @param {number} month (1-based)
 * @param {object} options - { forceRefresh: boolean }
 * @returns {Promise<{ csv: string, rows: Array, errors: Array }>}
 */
async function compileMonthlyCSV(year, month, options = {}) {
  const patients = loadPatients();
  const settings = loadSettings();

  if (!settings.opsid) {
    throw new Error('請先設定操作人員代號 (OPSID)');
  }

  const { startDate, endDate } = getMonthRange(year, month);
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const rows = [];
  const errors = [];

  for (const patient of patients) {
    try {
      // Fetch orders (uses cache)
      const { orders, patientInfo } = await fetchAllOrders(
        patient.chartno,
        settings.baseUrl,
        settings.opsid,
        options.forceRefresh || false
      );

      // Extract lab values for the target month
      // For regular tests, limit to the month range
      // For periodic tests (yearly/one-time), also limit to the month
      let labData = extractLabValues(orders, startDate, endDate);
      labData = computeDerivedValues(labData);

      // Also extract without date filter for periodic tests that
      // use ALL_TIME_IDS (the extractor already handles this)
      // But we only want values FROM this month for periodic tests
      // So we re-extract with the month range for everything

      // Build row
      const row = {};
      for (const col of CSV_COLUMNS) {
        if (col.source.startsWith('_')) {
          // Meta fields
          switch (col.source) {
            case '_chartno':  row[col.header] = patient.chartno; break;
            case '_name':     row[col.header] = patient.name || (patientInfo && patientInfo.name) || ''; break;
            case '_gender':   row[col.header] = patient.gender || (patientInfo && patientInfo.gender) || ''; break;
            case '_age':      row[col.header] = patient.age || (patientInfo && patientInfo.age) || ''; break;
            case '_schedule': row[col.header] = patient.schedule || ''; break;
            case '_shift':    row[col.header] = patient.shift || ''; break;
            case '_date':     row[col.header] = monthPrefix; break;
            default:          row[col.header] = '';
          }
        } else {
          // Lab test value
          let value = findMonthValue(labData[col.source], monthPrefix);
          // Try fallback ID if primary didn't match
          if (value === '' && col.fallback) {
            value = findMonthValue(labData[col.fallback], monthPrefix);
          }
          row[col.header] = value;
        }
      }

      rows.push(row);
    } catch (err) {
      errors.push({ chartno: patient.chartno, name: patient.name, error: err.message });
      // Still add a row with just patient info
      const row = {};
      for (const col of CSV_COLUMNS) {
        if (col.source === '_chartno') row[col.header] = patient.chartno;
        else if (col.source === '_name') row[col.header] = patient.name;
        else if (col.source === '_date') row[col.header] = monthPrefix;
        else if (col.source === '_schedule') row[col.header] = patient.schedule || '';
        else if (col.source === '_shift') row[col.header] = patient.shift || '';
        else row[col.header] = '';
      }
      rows.push(row);
    }
  }

  // Build CSV string
  const headers = CSV_COLUMNS.map(c => c.header);
  const csvLines = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map(h => {
      const v = row[h];
      if (v === '' || v == null) return '';
      const s = String(v);
      // Escape if contains comma, quote, or newline
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    });
    csvLines.push(values.join(','));
  }

  const csv = '﻿' + csvLines.join('\n'); // BOM for Excel UTF-8

  return { csv, rows, errors, month: monthPrefix, patientCount: patients.length };
}

module.exports = {
  CSV_COLUMNS,
  compileMonthlyCSV,
  getMonthRange,
};
