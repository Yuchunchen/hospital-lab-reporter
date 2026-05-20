// ─── compute.js ───────────────────────────────────────────────
// Registry-driven derived-value dispatcher.
//
// 2026-05-20: rewritten from the hardcoded URR / Ca×P if-else into a generic
// dispatcher over the COMPUTATIONS registry inlined from patterns/computed.js.
// The reporter still asks COMPUTED_TESTS (= REPORTER_COMPUTED) for the rows
// to render; each id is looked up in COMPUTATIONS for the actual formula.
//
// Why: CKD staging (eGFR, GFRStage, UACRStage, UPCRStage, KDIGORisk,
// TaiwanCKD, EarlyCKD) shares the same per-date pairing shape as URR / CaxP,
// and the formulas already live in patterns/computed.js. Hardcoding 9
// branches here would copy logic that the patterns repo owns.
//
// Per-date pairing model:
//   - `needs` whose id starts with `__patient.` are patient-static
//     (age, gender). They're pulled from the patient argument once.
//   - Other needs are date-series in `results` (lab values or previously
//     computed staging strings, e.g. EarlyCKD needs ['eGFR', 'TaiwanCKD']).
//   - The first lab need is the ANCHOR: its dates drive the output dates.
//     Other needs fill in at matching dates; missing → null. Each
//     computation's compute() decides whether nulls are acceptable
//     (TaiwanCKD tolerates missing UACR/UPCR; KDIGORisk does not).
//
// Dialysis URR is still re-derived per cluster by groups/dialysis.js
// (resolveBunClustersFromStored). Lab-view overrides results['URR'] with
// the cluster-based map, so the dispatcher's per-date URR is harmless.

/**
 * Compute derived values from extracted lab data.
 * Iterates COMPUTED_TESTS (render manifest) and dispatches each id to the
 * matching entry in COMPUTATIONS (formula registry).
 *
 * @param {object} results - extracted lab values, mutated in place
 * @param {object} [patient] - {age, gender} for patient-static needs
 */
function computeDerivedValues(results, patient) {
  const registry = (typeof COMPUTATIONS !== 'undefined' && Array.isArray(COMPUTATIONS))
    ? new Map(COMPUTATIONS.map(c => [c.id, c]))
    : new Map();

  for (const ct of COMPUTED_TESTS) {
    results[ct.id] = [];
    const comp = registry.get(ct.id);
    if (!comp || typeof comp.compute !== 'function') continue;
    results[ct.id] = _computeSeries(results, comp, patient);
  }
  return results;
}

function _computeSeries(results, comp, patient) {
  const needs = Array.isArray(comp.needs) ? comp.needs : [];
  const labNeeds = needs.filter(n => !String(n).startsWith('__patient.'));
  const ptNeeds  = needs.filter(n =>  String(n).startsWith('__patient.'));

  // Patient-static args (age, gender). Missing field = skip the whole series.
  const ptArgs = {};
  for (const n of ptNeeds) {
    const field = n.slice('__patient.'.length);
    const v = patient ? patient[field] : null;
    if (v == null || v === '') return [];
    ptArgs[field] = v;
  }

  // No lab inputs (e.g. theoretical patient-only formula) — nothing to pair.
  if (labNeeds.length === 0) return [];

  // Anchor by the first lab need; matching dates fetch the rest.
  // The anchor entry's effectiveTime / signOffTime propagates to the
  // computed entry so groups/early-ckd.js _flattenEntriesByCluster()
  // clusters staging values in the same draw bucket as the source labs.
  const anchorNeed = labNeeds[0];
  const seriesByDate = Object.create(null);
  for (const e of (results[anchorNeed] || [])) {
    if (!e || !e.date || e.value == null) continue;
    if (!seriesByDate[e.date]) {
      seriesByDate[e.date] = {
        __dateObj:       e.dateObj || null,
        __effectiveTime: e.effectiveTime || null,
        __signOffTime:   e.signOffTime || null,
      };
    }
    if (!(anchorNeed in seriesByDate[e.date])) {
      seriesByDate[e.date][anchorNeed] = e.value;
    }
  }
  for (const needId of labNeeds.slice(1)) {
    for (const e of (results[needId] || [])) {
      if (!e || !e.date || e.value == null) continue;
      const slot = seriesByDate[e.date];
      if (!slot) continue;                                // anchor absent
      if (!(needId in slot)) slot[needId] = e.value;      // first wins
    }
  }

  const out = [];
  for (const date of Object.keys(seriesByDate).sort()) {
    const slot = seriesByDate[date];
    const args = Object.assign({}, ptArgs);
    for (const needId of labNeeds) {
      args[needId] = (needId in slot) ? slot[needId] : null;
    }
    let v;
    try { v = comp.compute(args); }
    catch (err) {
      console.warn('[compute] ' + comp.id + ' on ' + date + ' failed:', err);
      continue;
    }
    if (v == null) continue;
    if (typeof v === 'number' && !isFinite(v)) continue;
    out.push({
      date,
      value: v,
      dateObj:       slot.__dateObj || new Date(date),
      effectiveTime: slot.__effectiveTime || null,
      signOffTime:   slot.__signOffTime || null,
    });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));      // newest first
  return out;
}
