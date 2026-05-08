'use strict';

/**
 * groups/early-ckd.js — 初期慢性腎臟病（Early CKD）疾病群組模組
 *
 * Phase 3 (2026-05-08): first additional disease after dialysis. CKD draws
 * are simpler than dialysis — no BUN pre/post split, no exact monthly
 * cadence (門診 1–3 個月不等). One cluster per 生效時間, qualified when
 * it carries Creatinine OR BUN; same `pickEarliestPerMonth` rule when a
 * patient has multiple clusters in one calendar month.
 *
 * The renal-platform xlsx export lives in export-formats/renal-platform-
 * xlsx.js — this module just wires the manifest + draw detection + a
 * long-format CSV exporter (parallel to dialysis 匯出csv).
 *
 * Browser registry: window.GROUPS['early-ckd'].
 */

// ─── Helper: normalise labManifest entries ──────────────────────────────────
function resolveCkdManifestEntry(entry) {
  if (typeof entry === 'string') return { id: entry };
  return Object.assign({}, entry);
}

const EARLY_CKD_GROUP = {
  id: 'early-ckd',
  label: '初期慢性腎臟病',

  storageKey: {
    patients: 'patients_ckd',
    labs:     'labs_ckd',
  },

  // No CKD-specific user-editable fields (Phase 3). Demographics fill from
  // the API on every fetch; CKD stage will be a computed value once the
  // lab-view renders eGFR.
  patientFields: [],

  // Lab manifest — order roughly mirrors the renal-platform xlsx columns
  // (§3.2 of TASK_BRIEF_phase3_early_ckd.md). Catalog ids; the export
  // formatter looks each one up at write time.
  labManifest: [
    // ── 腎功能 ──
    'CREAT',
    'BUN',                                // generic BUN (not BUN_pre/post)
    'UA',
    // ── 血液 ──
    'HCT',
    // ── 血糖 ──
    'GluAC',
    'HbA1c',
    // ── 血脂 ──
    'CHOL',
    'TG',
    'LDL',
    // ── 蛋白質 ──
    'Albumin',
    // ── 尿液 (Phase 3 新加) ──
    { id: 'UrineProtein', displayLabel: 'Urine Protein' },   // mg/dL, sub-page
    { id: 'UrineOB',      displayLabel: 'OB' },              // qualitative
    { id: 'UrineGlucose', displayLabel: '尿糖' },            // qualitative
    { id: 'UrineCr',      displayLabel: 'Urine creatinine' },
    'UPCR',
    'UACR',
  ],

  // No CKD-specific derived values yet. eGFR / GFRStage / TaiwanCKD etc
  // already exist in patterns/computed.js — wiring them to the lab table
  // is a Phase 3.x follow-up, out of scope for this commit.
  computed: [],

  // CKD draw detection — much looser than dialysis:
  // any cluster carrying Creatinine OR BUN counts as a check.
  drawDetection: {
    requiredAnyOf: ['CREAT', 'BUN'],
  },

  // Bucket every stored entry by its effectiveTime (= cluster anchor).
  _flattenEntriesByCluster(labDataForPatient) {
    const buckets = new Map();
    let warned = false;
    for (const id in labDataForPatient) {
      if (id.startsWith('_')) continue;
      const arr = labDataForPatient[id];
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        let key;
        if (e.effectiveTime) {
          key = e.effectiveTime;
        } else {
          key = 'date:' + (e.date || '');
          if (!warned) {
            try { console.warn('[early-ckd] entries missing effectiveTime — bucketing by date as fallback. Refetch to populate.'); } catch (_) {}
            warned = true;
          }
        }
        if (!buckets.has(key)) buckets.set(key, { effectiveTime: e.effectiveTime || null, byTestId: {} });
        const slot = buckets.get(key).byTestId;
        if (!slot[id]) slot[id] = [];
        slot[id].push(e);
      }
    }
    return buckets;
  },

  // Returns [{ effectiveTime, drawDate, yyyymm, labs:{testId: entry} }]
  // sorted ascending by effectiveTime / drawDate.
  detectDrawsFromStored(labDataForPatient) {
    if (!labDataForPatient) return [];
    const buckets = this._flattenEntriesByCluster(labDataForPatient);
    const required = (this.drawDetection && this.drawDetection.requiredAnyOf) || [];

    const draws = [];
    for (const [, bucket] of buckets) {
      const ids = new Set(Object.keys(bucket.byTestId));

      // Qualifying check: at least one of the required test ids must be
      // present (CREAT or BUN). Loose on purpose — CKD 門診 panels vary.
      if (required.length && !required.some(id => ids.has(id))) continue;

      // drawDate from effectiveTime via local-time accessors so the
      // YYYY-MM-DD slice matches entry.date keys (same UTC-vs-TPE caveat
      // that bit dialysis groups during refactor).
      let drawDateIso = null;
      if (bucket.effectiveTime) {
        const d = new Date(bucket.effectiveTime);
        if (!isNaN(d.getTime())) {
          drawDateIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        } else {
          drawDateIso = bucket.effectiveTime.slice(0, 10);
        }
      } else {
        for (const id in bucket.byTestId) {
          const e0 = bucket.byTestId[id][0];
          if (e0 && e0.date) { drawDateIso = e0.date; break; }
        }
        drawDateIso = drawDateIso || '';
      }

      // One entry per testId per cluster; the group uses `date` key for
      // any cross-cluster pairing (none yet, but keeps shape consistent
      // with dialysis exporter).
      const labs = {};
      for (const id in bucket.byTestId) {
        labs[id] = bucket.byTestId[id][0];
      }

      const yyyymm = drawDateIso ? drawDateIso.slice(0, 4) + drawDateIso.slice(5, 7) : '';
      draws.push({
        effectiveTime: bucket.effectiveTime,
        drawDate: drawDateIso,
        yyyymm,
        labs,
      });
    }

    draws.sort((a, b) => {
      const ka = a.effectiveTime || a.drawDate || '';
      const kb = b.effectiveTime || b.drawDate || '';
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return draws;
  },

  // Reuses the same "earliest of the month wins" rule as dialysis so
  // multi-cluster months (e.g. patient drew labs twice in a month) export
  // as one row.
  pickEarliestPerMonth(draws) {
    const out = {};
    for (const d of (draws || [])) {
      if (!d.yyyymm) continue;
      const cur = out[d.yyyymm];
      if (!cur) { out[d.yyyymm] = d; continue; }
      const ka = cur.effectiveTime || cur.drawDate || '';
      const kb = d.effectiveTime   || d.drawDate   || '';
      if (kb < ka) out[d.yyyymm] = d;
    }
    return out;
  },

  // ─── Long-format CSV exporter (匯出csv 按鈕) ────────────────────────────
  // One row per (chartNo × YYYYMM). 4 cols per test (value/unit/lower/higher).
  // No URR/CaxP for CKD; the group's `computed` array is empty so the
  // computed-loop simply emits nothing.
  exporter: {
    interval: 'monthly',

    filename(today) {
      const t = today instanceof Date ? today : new Date();
      const yyyymmdd = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
      return `early-ckd_export_${yyyymmdd}.csv`;
    },

    formatAll(patients, allLabData, opts) {
      opts = opts || {};
      const catalog = opts.catalog || (typeof CATALOG !== 'undefined' ? CATALOG : []);
      const catById = new Map(catalog.map(e => [e.id, e]));
      const manifest = EARLY_CKD_GROUP.labManifest.map(resolveCkdManifestEntry);

      const labelOf = entry => entry.displayLabel
        || (catById.get(entry.id) && (catById.get(entry.id).shortLabel || catById.get(entry.id).displayName))
        || entry.id;
      const unitOf = id => {
        const c = catById.get(id);
        return c && c.unit ? c.unit : '';
      };
      const refLoOf = id => {
        const c = catById.get(id);
        if (!c) return '';
        if (c.lo != null) return c.lo;
        if (c.refLo != null) return c.refLo;
        return '';
      };
      const refHiOf = id => {
        const c = catById.get(id);
        if (!c) return '';
        if (c.hi != null) return c.hi;
        if (c.refHi != null) return c.refHi;
        return '';
      };
      const csvCell = v => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };

      const header = ['id', 'YYYYMM'];
      for (const entry of manifest) {
        const lbl = labelOf(entry);
        header.push(`${lbl} value`, `${lbl} unit`, `${lbl} lower`, `${lbl} higher`);
      }
      const lines = [header.map(csvCell).join(',')];

      const patientList = [...(patients || [])].sort((a, b) => {
        const ca = String(a.chartno || a.chartNo || '');
        const cb = String(b.chartno || b.chartNo || '');
        return ca.localeCompare(cb);
      });

      for (const p of patientList) {
        const cn = p.chartno || p.chartNo || '';
        if (!cn) continue;
        const labData = (allLabData && allLabData[cn]) || null;
        if (!labData) continue;
        const draws  = EARLY_CKD_GROUP.detectDrawsFromStored(labData);
        const byMonth = EARLY_CKD_GROUP.pickEarliestPerMonth(draws);
        const months = Object.keys(byMonth).sort();
        for (const yyyymm of months) {
          const draw = byMonth[yyyymm];
          const row = [cn, yyyymm];
          for (const entry of manifest) {
            const cell = draw.labs && draw.labs[entry.id];
            const val  = cell && cell.value != null ? cell.value : '';
            const unit = (cell && cell.unit) || unitOf(entry.id);
            row.push(val, unit, refLoOf(entry.id), refHiOf(entry.id));
          }
          lines.push(row.map(csvCell).join(','));
        }
      }
      return lines.join('\n');
    },
  },
};

// Browser registry (preferred): window.GROUPS['early-ckd']
// This file is concatenated by sync-patterns.js into the legacy
// hospital-lab-data.html and by build.js into the new built HTMLs.
if (typeof window !== 'undefined') {
  window.GROUPS = window.GROUPS || {};
  window.GROUPS['early-ckd'] = EARLY_CKD_GROUP;
}
