// ─── export-utils.js ───────────────────────────────────────────────
// downloadBlob + exportCombinedCSV (group exporter delegate)
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT — combined long-format CSV
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Export all tracked patients × YYYYMM as a single long-format CSV.
 * Layout (header, rows) lives in GROUP.exporter.formatAll (groups/dialysis.js).
 */
function exportCombinedCSV() {
  if (!GROUP.exporter || typeof GROUP.exporter.formatAll !== 'function') {
    showToast('此疾病模組尚未提供 CSV 匯出', 'error'); return;
  }
  let patients = loadPatients();
  if (patients.length === 0) { showToast('尚無病患可匯出', 'error'); return; }

  // Phase 1.5: respect ticked subset; null = export everyone.
  const selected = getSelectedChartNos();
  if (selected) {
    const wanted = new Set(selected);
    patients = patients.filter(p => wanted.has(p.chartno || p.chartNo));
    if (!patients.length) {
      showToast('勾選的病患都不在清單中', 'error'); return;
    }
  }

  const labData  = loadLabData();
  const csv      = GROUP.exporter.formatAll(patients, labData);
  // BOM so Excel opens UTF-8 without garbling Chinese display labels.
  const blob     = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const filename = GROUP.exporter.filename
    ? GROUP.exporter.filename()
    : `dialysis_export_${todayStr()}.csv`;
  downloadBlob(blob, filename);
  const scope = selected ? `${patients.length} 位勾選` : `${patients.length} 位全部`;
  showToast(`CSV 已匯出（${scope}）`, 'success');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
