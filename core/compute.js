// ─── compute.js ───────────────────────────────────────────────
// computeDerivedValues — pairs BUN_pre/BUN_post (URR) and Ca/P (CaxP) by
// date and stores the derived series under each COMPUTED_TESTS id.
//
// Extracted from hospital-lab-data.html (Phase 1 restructure, 2026-05-08).
// Companion to lab-extract.js — runs immediately after extractLabValues in
// the fetchAndStore pipeline.

/**
 * Compute derived values (URR, Ca*P) from extracted lab data.
 * Adds entries to the results object under computed test IDs.
 */
function computeDerivedValues(results) {
  for (const ct of COMPUTED_TESTS) {
    results[ct.id] = [];

    if (ct.id === 'URR') {
      // Pair BUN_pre and BUN_post by same date
      const preMap = {};
      for (const e of (results['BUN_pre'] || [])) {
        if (!preMap[e.date]) preMap[e.date] = e.value;
      }
      for (const e of (results['BUN_post'] || [])) {
        const pre = preMap[e.date];
        if (pre != null) {
          const v = ct.compute(pre, e.value);
          if (v != null) {
            results[ct.id].push({ date: e.date, value: v, dateObj: e.dateObj });
          }
        }
      }
    } else if (ct.id === 'CaxP') {
      // Pair Ca and P by same date
      const caMap = {};
      for (const e of (results['Ca'] || [])) {
        if (!caMap[e.date]) caMap[e.date] = e.value;
      }
      for (const e of (results['P'] || [])) {
        const ca = caMap[e.date];
        if (ca != null) {
          const v = ct.compute(ca, e.value);
          if (v != null) {
            results[ct.id].push({ date: e.date, value: v, dateObj: e.dateObj });
          }
        }
      }
    }

    results[ct.id].sort((a, b) => b.date.localeCompare(a.date));
  }
  return results;
}
