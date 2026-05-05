'use strict';

/**
 * groups/dialysis.js — 透析（血液透析）疾病群組模組
 *
 * Revision 1 (2026-05-04):
 *   - patientFields trimmed to dialysisDays + shift (defaults 未設定);
 *     demographics (name/sex/age) auto-filled on every API fetch.
 *   - monthlyDetection cluster key = exact 生效時間 (effectiveTime).
 *     Classified as monthly when the cluster's test ids overlap with the
 *     monthly-required panel by ≥ minMonthlyOverlapRatio AND ≥ 1 BUN
 *     entry is present.
 *   - resolveBUN sorts by 簽收時間 (signOffTime): earliest = pre, latest = post.
 *   - exporter produces a combined long-format CSV — one row per
 *     (chartNo × YYYYMM), 4 cols per test in value/unit/lower/higher order,
 *     URR last.
 *   - Same-month multiple monthly draws → take the earliest effectiveTime.
 *
 * Auto-inlined into hospital-lab-data.html between
 *   __HOSPITAL_LAB_GROUPS_BEGIN__ / __HOSPITAL_LAB_GROUPS_END__
 * by sync-patterns.js. Browser registry: window.GROUPS.dialysis.
 */

// ─── Helper: normalize labManifest entries ──────────────────────────────────
// Manifest mixes string and object forms; this returns a normalized object
// with default periodicity = 'monthly'.
function resolveManifestEntry(entry) {
  if (typeof entry === 'string') return { id: entry, periodicity: 'monthly' };
  return Object.assign({ periodicity: 'monthly' }, entry);
}

const DIALYSIS_GROUP = {
  id: 'dialysis',
  label: '透析',

  storageKey: {
    patients: 'patients_dialysis',
    labs:     'labs_dialysis',
  },

  // Revision 1: only two user-editable fields. Demographics (name/sex/age)
  // come from the API on every fetch and are not user-editable. Legacy
  // fields (startDate, frequency, access, primaryDx, note) are dropped —
  // old records may still carry them in localStorage but the UI ignores them.
  patientFields: [
    { key: 'dialysisDays', label: '洗腎日期', type: 'select',
      options: ['未設定', '一三五', '二四六'], default: '未設定' },
    { key: 'shift', label: '班別', type: 'select',
      options: ['未設定', '上午', '下午', '夜班'], default: '未設定' },
  ],

  // Lab manifest — order aligned with vhtt 病人定期檢查記錄 (2019.11.07).
  // ID = catalog id; displayLabel overrides for paper-form-style header text.
  // periodicity drives "monthly required" set used by monthlyDetection.
  labManifest: [
    // ── 血液 — monthly ──
    'WBC', 'RBC', 'Hb', 'HCT', 'MCV', 'Platelet',
    // ── 蛋白質 — monthly ──
    'TP', 'Albumin',
    // ── 肝功能 — monthly ──
    { id: 'GOT',  displayLabel: 'AST' },
    { id: 'GPT',  displayLabel: 'ALT' },
    'ALP',
    { id: 'TBIL', displayLabel: 'TBili' },
    // ── 血脂 — monthly ──
    { id: 'CHOL', displayLabel: 'TCho' },
    'LDL', 'TG',
    // ── 血糖 — monthly ──
    'GluAC',
    // ── 腎功能 (BUN + renal) — monthly ──
    { id: 'BUN_pre',  displayLabel: 'BUN (BD)' },
    { id: 'BUN_post', displayLabel: 'BUN (AD)' },
    'CREAT', 'UA',
    // ── 電解質 — monthly ──
    'Na', 'K', 'Cl', 'Ca', 'P',
    // ── 鐵代謝 — monthly ──
    'Fe', 'TIBC', 'TSAT', 'Ferritin',
    // ── 副甲狀腺 — monthly ──
    'iPTH',
    // ── 糖化血色素 — monthly for everyone (not DM-only) ──
    'HbA1c',
    // ── 年度肝炎 / 終身指標 — annual ──
    { id: 'HBsAg',   periodicity: 'annual' },
    { id: 'AntiHBs', periodicity: 'annual', displayLabel: 'Anti-HBS' },
    { id: 'AntiHCV', periodicity: 'annual', displayLabel: 'Anti-HCV' },
    { id: 'AFP',     periodicity: 'annual', displayLabel: 'α-FP' },
    // ── 入院只做一次 — on-admission ──
    { id: 'HIV', periodicity: 'on-admission' },
    { id: 'RPR', periodicity: 'on-admission', displayLabel: 'VDRL/RPR' },
  ],

  // Derived values appended after the per-test columns.
  computed: ['URR'],

  // Revision 1: 月檢識別由「生效時間 + 重疊比例 + requireBUN」決定。
  // 不再使用 ±N 天的時間視窗（實作上 cluster key 直接是 exact effectiveTime）。
  monthlyDetection: {
    minMonthlyOverlapRatio: 0.5,
    requireBUN: true,
  },

  // BUN testIds. Revision 1 hotfix (2026-05-05): extractLabValues now
  // post-processes BUN_pre[] / BUN_post[] so each draw appears once in the
  // correct bucket, classified by signOffTime (Method A) with orderName
  // fallback (Method B). The two arrays are no longer mirror images.
  // BUN (legacy single-bucket id) is kept for back-compat with stale records.
  _bunIds: ['BUN_pre', 'BUN_post', 'BUN'],

  // Build a date → entry lookup over the cleaned BUN_pre[] / BUN_post[]
  // arrays. After the hotfix these arrays hold one canonical entry per date,
  // which lets us pair pre/post across separate effectiveTime clusters
  // (洗前 panel and 洗後 single-BUN order have different 生效時間).
  _indexBunByDate(labDataForPatient) {
    const pre = {}, post = {};
    if (!labDataForPatient) return { pre, post };
    for (const e of (labDataForPatient.BUN_pre || [])) {
      if (e && e.date && !pre[e.date]) pre[e.date] = e;
    }
    for (const e of (labDataForPatient.BUN_post || [])) {
      if (e && e.date && !post[e.date]) post[e.date] = e;
    }
    return { pre, post };
  },

  // Resolve BUN pre/post within a single cluster (i.e. entries that already
  // share the same 生效時間). Sort by 簽收時間 (signOffTime): earliest = pre,
  // latest = post. Falls back to the legacy orderName rule when no
  // signOffTime data is available (e.g. pre-revision-1 storage records).
  resolveBUN(bunEntries) {
    if (!bunEntries || bunEntries.length === 0) return { pre: null, post: null };

    // Dedupe — same physical draw appears in BUN_pre and BUN_post arrays.
    const seen = new Set();
    const dedup = [];
    for (const e of bunEntries) {
      const k = (e.signOffTime || e.reportDateTime || e.date || '') + '|' + (e.value != null ? e.value : '');
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(e);
    }

    if (dedup.length === 1) return { pre: dedup[0], post: null };

    const missingTime = dedup.filter(e => !e.signOffTime).length;
    const allMissing  = missingTime === dedup.length;

    if (allMissing) {
      try { console.warn('[dialysis.resolveBUN] all entries missing signOffTime — falling back to legacy orderName rule'); } catch (_) {}
      return resolveBUNByLegacyOrderName(dedup);
    }
    if (missingTime > 0) {
      try { console.warn('[dialysis.resolveBUN] some entries missing signOffTime — those default to "pre"', dedup); } catch (_) {}
    }

    const sorted = [...dedup].sort((a, b) => {
      const ta = a.signOffTime ? new Date(a.signOffTime).getTime() : 0;
      const tb = b.signOffTime ? new Date(b.signOffTime).getTime() : 0;
      return ta - tb;
    });

    if (sorted.length > 2) {
      try { console.warn('[dialysis.resolveBUN] 3+ BUN entries on cluster — taking earliest as pre, latest as post', sorted); } catch (_) {}
    }

    let pre  = sorted[0];
    let post = sorted[sorted.length - 1];

    // Tie-break — same signOffTime: post is usually much smaller (6–25)
    // than pre (60–90). If reversed, swap.
    if (pre.signOffTime && post.signOffTime &&
        pre.signOffTime === post.signOffTime &&
        pre !== post) {
      const pv = Number(pre.value), sv = Number(post.value);
      if (Number.isFinite(pv) && Number.isFinite(sv) && pv !== sv && sv > pv) {
        const tmp = pre; pre = post; post = tmp;
      }
    }
    return { pre, post };
  },

  // Bucket every stored entry by its cluster key (= exact effectiveTime ISO).
  // Entries missing effectiveTime fall back to a date-based bucket (with
  // a one-shot console.warn) — this only happens for pre-revision-1 records
  // that haven't been refetched.
  _flattenEntriesByCluster(labDataForPatient) {
    const buckets = new Map();
    let warnedMissing = false;
    for (const id in labDataForPatient) {
      if (id.startsWith('_')) continue; // _lastUpdate etc.
      const arr = labDataForPatient[id];
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        let key;
        if (e.effectiveTime) {
          key = e.effectiveTime;
        } else {
          key = 'date:' + (e.date || '');
          if (!warnedMissing) {
            try { console.warn('[dialysis] entries missing effectiveTime — bucketing by date as fallback. Refetch to populate.'); } catch (_) {}
            warnedMissing = true;
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

  // Detect monthly draws from stored lab data (per patient).
  // Returns [{ effectiveTime, drawDate, yyyymm, labs: {testId: entry}, computed: {URR?} }].
  // Only clusters that pass the monthly-required overlap + BUN-presence gate
  // are returned. Sorted ascending by effectiveTime (then drawDate).
  //
  // Revision 1 hotfix: 洗前 (composite panel) and 洗後 (standalone BUN) have
  // different 生效時間, so they live in separate effectiveTime clusters. The
  // monthly cluster is the pre cluster (passes overlap thanks to the full
  // panel); the matching BUN_post is looked up by date from the cleaned
  // BUN_post[] array.
  detectMonthlyDrawsFromStored(labDataForPatient) {
    if (!labDataForPatient) return [];
    const monthlyReq = monthlyRequiredIds(this);
    const minRatio   = this.monthlyDetection.minMonthlyOverlapRatio;
    const reqBUN     = this.monthlyDetection.requireBUN;
    const buckets    = this._flattenEntriesByCluster(labDataForPatient);
    const bunIdx     = this._indexBunByDate(labDataForPatient);

    const draws = [];
    for (const [, bucket] of buckets) {
      const ids = new Set(Object.keys(bucket.byTestId));

      // Overlap with monthly-required panel
      let overlap = 0;
      for (const id of ids) if (monthlyReq.has(id)) overlap++;
      const ratio = monthlyReq.size > 0 ? overlap / monthlyReq.size : 0;
      if (ratio < minRatio) continue;

      const hasBUN = this._bunIds.some(b => ids.has(b));
      if (reqBUN && !hasBUN) continue;

      // drawDate / yyyymm — prefer effectiveTime, fall back to any entry's date.
      let drawDateIso = null;
      if (bucket.effectiveTime) {
        drawDateIso = bucket.effectiveTime.slice(0, 10);
      } else {
        for (const id in bucket.byTestId) {
          const e0 = bucket.byTestId[id][0];
          if (e0 && e0.date) { drawDateIso = e0.date; break; }
        }
        drawDateIso = drawDateIso || '';
      }

      // BUN pre: prefer the cleaned date-indexed pre, fall back to whatever
      // sat in this cluster's BUN_pre / BUN bucket (legacy data path).
      const pre = bunIdx.pre[drawDateIso]
        || (bucket.byTestId.BUN_pre && bucket.byTestId.BUN_pre[0])
        || (bucket.byTestId.BUN     && bucket.byTestId.BUN[0])
        || null;
      // BUN post: cross-cluster lookup by date (post lives in its own cluster).
      const post = bunIdx.post[drawDateIso] || null;

      // Collect non-BUN labs (one entry per testId — they share the cluster
      // key, so any duplicate is a parser-side dedupe miss).
      const labs = {};
      for (const id in bucket.byTestId) {
        if (this._bunIds.indexOf(id) >= 0) continue;
        labs[id] = bucket.byTestId[id][0];
      }
      if (pre)  labs.BUN_pre  = pre;
      if (post) labs.BUN_post = post;

      // URR
      const computed = {};
      const pv = pre  ? Number(pre.value)  : NaN;
      const sv = post ? Number(post.value) : NaN;
      if (Number.isFinite(pv) && Number.isFinite(sv) && pv > 0) {
        computed.URR = +((1 - sv / pv) * 100).toFixed(1);
      }

      const yyyymm = drawDateIso ? drawDateIso.slice(0, 4) + drawDateIso.slice(5, 7) : '';

      draws.push({
        effectiveTime: bucket.effectiveTime,
        drawDate: drawDateIso,
        yyyymm,
        labs,
        computed,
      });
    }
    draws.sort((a, b) => {
      const ka = a.effectiveTime || a.drawDate || '';
      const kb = b.effectiveTime || b.drawDate || '';
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return draws;
  },

  // Group monthly draws by YYYYMM, take the one with smallest effectiveTime
  // per month. Returns { 'YYYYMM': draw }.
  pickEarliestPerMonth(monthlyDraws) {
    const out = {};
    for (const d of (monthlyDraws || [])) {
      if (!d.yyyymm) continue;
      const cur = out[d.yyyymm];
      if (!cur) { out[d.yyyymm] = d; continue; }
      const ka = cur.effectiveTime || cur.drawDate || '';
      const kb = d.effectiveTime   || d.drawDate   || '';
      if (kb < ka) out[d.yyyymm] = d;
    }
    return out;
  },

  // Lab-table BUN cluster map for the labview tab.
  // Revision 1 hotfix: built directly from the cleaned BUN_pre[] / BUN_post[]
  // arrays (one canonical entry per date) so pre/post pair correctly even
  // when 洗前 and 洗後 sit in separate effectiveTime clusters.
  resolveBunClustersFromStored(labDataForPatient) {
    const out = {};
    if (!labDataForPatient) return out;
    const { pre: preIdx, post: postIdx } = this._indexBunByDate(labDataForPatient);
    const allDates = new Set([...Object.keys(preIdx), ...Object.keys(postIdx)]);
    for (const date of allDates) {
      const pre  = preIdx[date]  || null;
      const post = postIdx[date] || null;
      const slot = {
        pre, post,
        preDate:  pre  ? pre.date  : null,
        postDate: post ? post.date : null,
        urr: null,
        effectiveTime: (pre && pre.effectiveTime) || (post && post.effectiveTime) || null,
      };
      const pv = pre  ? Number(pre.value)  : NaN;
      const sv = post ? Number(post.value) : NaN;
      if (Number.isFinite(pv) && Number.isFinite(sv) && pv > 0) {
        slot.urr = +((1 - sv / pv) * 100).toFixed(1);
      }
      out[date] = slot;
    }
    return out;
  },

  // ─── CSV exporter — combined long format ────────────────────────────────
  // One row per (chartNo × YYYYMM). 4 cols per test (value/unit/lower/higher),
  // URR appended at the end. Empty cells stay empty (no carry-forward).
  exporter: {
    interval: 'monthly',

    filename(today) {
      const t = today instanceof Date ? today : new Date();
      const yyyymmdd = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`;
      return `dialysis_export_${yyyymmdd}.csv`;
    },

    formatAll(patients, allLabData, opts) {
      opts = opts || {};
      const catalog         = opts.catalog         || (typeof CATALOG          !== 'undefined' ? CATALOG          : []);
      const computedCatalog = opts.computedCatalog || (typeof REPORTER_COMPUTED !== 'undefined' ? REPORTER_COMPUTED : []);
      const catById  = new Map(catalog.map(e => [e.id, e]));
      const compById = new Map(computedCatalog.map(e => [e.id, e]));
      const manifest = DIALYSIS_GROUP.labManifest.map(resolveManifestEntry);
      const computedIds = DIALYSIS_GROUP.computed;

      const labelOf = entry => entry.displayLabel
        || (catById.get(entry.id) && (catById.get(entry.id).shortLabel || catById.get(entry.id).displayName))
        || entry.id;
      const unitOf = id => {
        const c = catById.get(id) || compById.get(id);
        return c && c.unit ? c.unit : '';
      };
      const hiOf = id => {
        const c = catById.get(id) || compById.get(id);
        if (!c) return '';
        if (c.hi != null) return c.hi;
        if (c.refHi != null) return c.refHi;
        return '';
      };
      const loOf = id => {
        const c = catById.get(id) || compById.get(id);
        if (!c) return '';
        if (c.lo != null) return c.lo;
        if (c.refLo != null) return c.refLo;
        return '';
      };
      const csvCell = v => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };

      // Header — id, YYYYMM, then 4 cols per test, then 4 cols per computed.
      const header = ['id', 'YYYYMM'];
      for (const entry of manifest) {
        const lbl = labelOf(entry);
        header.push(`${lbl} value`, `${lbl} unit`, `${lbl} lower`, `${lbl} higher`);
      }
      for (const id of computedIds) {
        const lbl = (compById.get(id) && compById.get(id).label) || id;
        header.push(`${lbl} value`, `${lbl} unit`, `${lbl} lower`, `${lbl} higher`);
      }
      const lines = [header.map(csvCell).join(',')];

      // Rows: sort patients by chartNo, then per-patient sort YYYYMM ascending.
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
        const draws  = DIALYSIS_GROUP.detectMonthlyDrawsFromStored(labData);
        const byMonth = DIALYSIS_GROUP.pickEarliestPerMonth(draws);
        const months = Object.keys(byMonth).sort();
        for (const yyyymm of months) {
          const draw = byMonth[yyyymm];
          const row = [cn, yyyymm];
          for (const entry of manifest) {
            const cell = draw.labs && draw.labs[entry.id];
            const val  = cell && cell.value != null ? cell.value : '';
            const unit = (cell && cell.unit) || unitOf(entry.id);
            row.push(val, unit, loOf(entry.id), hiOf(entry.id));
          }
          for (const id of computedIds) {
            const val = draw.computed && draw.computed[id] != null ? draw.computed[id] : '';
            row.push(val, unitOf(id), loOf(id), hiOf(id));
          }
          lines.push(row.map(csvCell).join(','));
        }
      }
      return lines.join('\n');
    },
  },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

// Cached set of testIds that count as "monthly required" for the overlap
// test. Manifest is fixed at module load — safe to memo.
let _monthlyReqIdsCache = null;
function monthlyRequiredIds(group) {
  if (!_monthlyReqIdsCache) {
    _monthlyReqIdsCache = new Set(
      group.labManifest
        .map(resolveManifestEntry)
        .filter(e => e.periodicity === 'monthly')
        .map(e => e.id)
    );
  }
  return _monthlyReqIdsCache;
}

// Legacy fallback for resolveBUN — only used when every BUN entry in a
// cluster is missing signOffTime (i.e. records written before revision 1).
function resolveBUNByLegacyOrderName(entries) {
  let pre = null, post = null;
  for (const e of entries) {
    const name = (e.orderName || '').trim();
    if (!post && name === 'BUN') post = e;
    else if (!pre && name.includes(',')) pre = e;
  }
  if (!pre) pre = entries.find(e => e !== post) || null;
  return { pre, post };
}

// ─── exports ─────────────────────────────────────────────────────────────────
// Browser registry (preferred): window.GROUPS.dialysis
// Node CommonJS fallback for headless tests.

if (typeof window !== 'undefined') {
  window.GROUPS = window.GROUPS || {};
  window.GROUPS.dialysis = DIALYSIS_GROUP;
  window.resolveManifestEntry = window.resolveManifestEntry || resolveManifestEntry;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DIALYSIS_GROUP, resolveManifestEntry };
}
