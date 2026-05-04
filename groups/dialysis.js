'use strict';

/**
 * groups/dialysis.js — 透析（血液透析）疾病群組模組
 *
 * Step 1 v3：與 vhtt 紙本「病人定期檢查記錄」(制定 2019.11.07) 對齊。
 *   - labManifest 採紙本順序，每筆夾帶 periodicity（monthly / annual /
 *     on-admission）與 displayLabel（讓 CSV 表頭與紙本相同）。
 *   - CSV exporter 改為 form-aware wide format：每項測試 4 欄
 *     (value / unit / hi / lo)，URR 附在尾端。
 *
 * Kt/V 與 Aluminum 在本步刻意延後（user decision 2026-05-04）。
 *
 * 此檔案由 sync-patterns.js 自動內嵌進 hospital-lab-data.html 的
 * __HOSPITAL_LAB_GROUPS_BEGIN__ / __HOSPITAL_LAB_GROUPS_END__ 區塊。
 *
 * 在瀏覽器中暴露為 window.GROUPS.dialysis（registry 模式）。
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

  // 病人欄位（除了 shell 提供的 chartNo / name / age / sex 之外的）
  // 操作性欄位（體重、血流量、透析時間、A-K、EPO）依使用者指示，本步驟略過。
  patientFields: [
    { key: 'startDate', label: '開始透析日', type: 'date' },
    { key: 'frequency', label: '頻率',
      type: 'select', options: ['週三次', '週二次', '其他'] },
    { key: 'access',    label: '通路',
      type: 'select', options: ['AVF', 'AVG', '長期導管', '短期導管'] },
    { key: 'primaryDx', label: '原發病因', type: 'text' },
    { key: 'note',      label: '備註',     type: 'textarea' },
  ],

  // Lab manifest — 順序對齊 vhtt 病人定期檢查記錄 (2019.11.07)。
  //
  // ID 採 hospital-lab-patterns/catalog.js 標準命名；displayLabel 用紙本字樣。
  // 對應映射：
  //   form 'AST'   → catalog id 'GOT'
  //   form 'ALT'   → catalog id 'GPT'
  //   form 'TBili' → catalog id 'TBIL'
  //   form 'TCho'  → catalog id 'CHOL'
  //   form 'Anti-HCV' → catalog id 'AntiHCV'
  //
  // 不在本步：Kt/V、Aluminum（user 2026-05-04 決定延後）。
  // 不在本步：Mg、HDLC（紙本未列）。
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
    // ── 血脂 — monthly (依 user 指示，紙本季度條紋忽略) ──
    { id: 'CHOL', displayLabel: 'TCho' },
    'LDL', 'TG',
    // ── 血糖 — monthly ──
    'GluAC',
    // ── 腎功能 (BUN + renal) — monthly ──
    { id: 'BUN_pre',  displayLabel: 'BUN (BD)' },
    { id: 'BUN_post', displayLabel: 'BUN (AD)' },
    'CREAT', 'UA',
    // ── 電解質 — monthly (Ca = total Ca) ──
    'Na', 'K', 'Cl', 'Ca', 'P',
    // ── 鐵代謝 — monthly (依 user 指示，全為月檢) ──
    'Fe', 'TIBC', 'TSAT', 'Ferritin',
    // ── 副甲狀腺 — monthly ──
    'iPTH',
    // ── 糖化血色素 — monthly for everyone (not DM-only) ──
    'HbA1c',
    // ── 年度肝炎 / 終身指標 — annual ──
    // Aluminum 在本步延後 (2026-05-04)
    { id: 'HBsAg',   periodicity: 'annual' },
    { id: 'AntiHBs', periodicity: 'annual', displayLabel: 'Anti-HBS' },
    { id: 'AntiHCV', periodicity: 'annual', displayLabel: 'Anti-HCV' },
    { id: 'AFP',     periodicity: 'annual', displayLabel: 'α-FP' },
    // ── 入院只做一次 — on-admission ──
    { id: 'HIV', periodicity: 'on-admission' },
    { id: 'RPR', periodicity: 'on-admission', displayLabel: 'VDRL/RPR' },
  ],

  // 衍生值 — Kt/V 延後；只剩 URR (CaxP 在本 v3 也移除 — TASK_BRIEF
  // computed: ['URR'])
  computed: ['URR'],

  // 月檢識別參數
  monthlyDetection: {
    clusterDayWindow: 2,       // 同次抽血容忍天數
    minTestsForMonthly: 8,     // 至少 8 項落在 labManifest 才算月檢
    requireBUN: true,          // 必有 BUN 才算月檢
  },

  // BUN 前/後判定（基於 reportDateTime）
  //   ≥2 筆 → 依時間排序，最早 = 洗腎前，最晚 = 洗腎後
  //   1 筆  → 預設為洗腎前
  //   0 筆  → 兩者皆 null
  //
  // TODO: activate in Step 2 (BUN reportTime switchover)。
  resolveBUN(bunEntries) {
    if (!bunEntries || bunEntries.length === 0) return { pre: null, post: null };
    if (bunEntries.length === 1) return { pre: bunEntries[0], post: null };
    const sorted = [...bunEntries].sort((a, b) => {
      const ta = new Date(a.reportDateTime || a.reportDate).getTime();
      const tb = new Date(b.reportDateTime || b.reportDate).getTime();
      return ta - tb;
    });
    return { pre: sorted[0], post: sorted[sorted.length - 1] };
  },

  // 月檢偵測（針對未來 raw lab rows 介面）
  // 輸入：該病人所有 raw lab rows（含 testId / orderDate / reportDateTime / value / unit）
  // 輸出：[{ drawDate: 'YYYY-MM-DD', labs: { TESTID: row } }, ...]
  //
  // TODO: activate in Step 2 — 目前 shell 仍從 localStorage 的
  // {testId: [{date, value}, ...]} 結構讀取，由 exporter.buildDraws() 處理。
  detectMonthlyDraws(allLabs) {
    if (!allLabs || allLabs.length === 0) return [];

    const rows = [...allLabs].sort((a, b) => {
      const da = new Date(a.orderDate || a.reportDate);
      const db = new Date(b.orderDate || b.reportDate);
      return da - db;
    });

    const W = this.monthlyDetection.clusterDayWindow;
    const clusters = [];
    let cur = null;
    for (const row of rows) {
      const d = new Date(row.orderDate || row.reportDate);
      if (!cur || daysBetween(cur.endDate, d) > W) {
        cur = { startDate: d, endDate: d, rows: [] };
        clusters.push(cur);
      } else {
        cur.endDate = d;
      }
      cur.rows.push(row);
    }

    const manifestSet = new Set(this.labManifest.map(e => resolveManifestEntry(e).id));
    const out = [];
    for (const c of clusters) {
      const ids = new Set(c.rows.map(r => r.testId));
      const hits = [...ids].filter(id => manifestSet.has(id));
      const hasBUN = c.rows.some(r =>
        r.testId === 'BUN_pre' ||
        r.testId === 'BUN_post' ||
        r.testId === 'BUN'
      );
      if (hits.length < this.monthlyDetection.minTestsForMonthly) continue;
      if (this.monthlyDetection.requireBUN && !hasBUN) continue;

      const bunEntries = c.rows.filter(r =>
        r.testId === 'BUN_pre' ||
        r.testId === 'BUN_post' ||
        r.testId === 'BUN'
      );
      const { pre, post } = this.resolveBUN(bunEntries);

      const labs = {};
      for (const r of c.rows) {
        if (manifestSet.has(r.testId)) labs[r.testId] = r;
      }
      if (pre)  labs['BUN_pre']  = pre;
      if (post) labs['BUN_post'] = post;

      out.push({
        drawDate: isoDate(c.startDate),
        labs,
      });
    }
    return out;
  },

  // CSV 輸出 — form-aware wide format
  //
  // 一檔一病人；一列一個 monthly draw。
  // 欄位：
  //   chartNo, name, drawDate,
  //   <對 labManifest 每一項> value, unit, hi, lo,
  //   <對 computed 每一項>   value, unit, hi, lo
  //
  // 每月未抽到的項目 → value 留空（不向前帶值，呼應紙本斜線）。
  exporter: {
    interval: 'monthly',

    filename: (patient) =>
      `dialysis_${patient.chartNo || patient.chartno || 'unknown'}.csv`,

    // 把 localStorage 的 {testId: [{date, value}, ...]} 結構轉為 draws 陣列。
    // 用 monthlyDetection.clusterDayWindow 把日期叢集，每叢一個 draw。
    // 計算 URR（pre/post 同叢時）。
    buildDraws(labDataForPatient) {
      if (!labDataForPatient) return [];

      const dateToLabs = new Map();
      for (const id in labDataForPatient) {
        const entries = labDataForPatient[id];
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
          if (!e || !e.date) continue;
          if (!dateToLabs.has(e.date)) dateToLabs.set(e.date, {});
          dateToLabs.get(e.date)[id] = { value: e.value, date: e.date };
        }
      }

      const dates = [...dateToLabs.keys()].sort();
      const W = DIALYSIS_GROUP.monthlyDetection.clusterDayWindow;
      const clusters = [];
      let cur = null;
      for (const d of dates) {
        const dt = new Date(d);
        if (!cur || (dt - new Date(cur.endDate)) / 86400000 > W) {
          cur = { startDate: d, endDate: d, labs: {} };
          clusters.push(cur);
        } else {
          cur.endDate = d;
        }
        Object.assign(cur.labs, dateToLabs.get(d));
      }

      // Computed pass — URR per draw (only if both BUN_pre and BUN_post present)
      for (const c of clusters) {
        c.computed = {};
        const pre  = c.labs.BUN_pre  ? c.labs.BUN_pre.value  : null;
        const post = c.labs.BUN_post ? c.labs.BUN_post.value : null;
        const preN  = typeof pre  === 'number' ? pre  : parseFloat(pre);
        const postN = typeof post === 'number' ? post : parseFloat(post);
        if (Number.isFinite(preN) && Number.isFinite(postN) && preN > 0) {
          c.computed.URR = +((1 - postN / preN) * 100).toFixed(1);
        }
      }

      return clusters.map(c => ({
        drawDate: c.startDate,
        labs: c.labs,
        computed: c.computed,
      }));
    },

    format(patient, draws, opts) {
      opts = opts || {};
      const catalog        = opts.catalog        || (typeof CATALOG         !== 'undefined' ? CATALOG         : []);
      const computedCatalog = opts.computedCatalog || (typeof REPORTER_COMPUTED !== 'undefined' ? REPORTER_COMPUTED : []);

      const catById     = new Map(catalog.map(e => [e.id, e]));
      const compById    = new Map(computedCatalog.map(e => [e.id, e]));
      const manifest    = DIALYSIS_GROUP.labManifest.map(resolveManifestEntry);
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

      // Header
      const header = ['chartNo', 'name', 'drawDate'];
      for (const entry of manifest) {
        const lbl = labelOf(entry);
        header.push(`${lbl} value`, `${lbl} unit`, `${lbl} hi`, `${lbl} lo`);
      }
      for (const id of computedIds) {
        const lbl = (compById.get(id) && compById.get(id).label) || id;
        header.push(`${lbl} value`, `${lbl} unit`, `${lbl} hi`, `${lbl} lo`);
      }

      const lines = [header.map(csvCell).join(',')];

      // Newest first (matches lab-table column order)
      const sorted = [...draws].sort((a, b) => b.drawDate.localeCompare(a.drawDate));

      for (const draw of sorted) {
        const row = [
          patient.chartNo || patient.chartno || '',
          patient.name || '',
          draw.drawDate,
        ];
        for (const entry of manifest) {
          const cell = draw.labs && draw.labs[entry.id];
          const val  = cell && cell.value != null ? cell.value : '';
          const unit = (cell && cell.unit) || unitOf(entry.id);
          row.push(val, unit, hiOf(entry.id), loOf(entry.id));
        }
        for (const id of computedIds) {
          const val = draw.computed && draw.computed[id] != null ? draw.computed[id] : '';
          row.push(val, unitOf(id), hiOf(id), loOf(id));
        }
        lines.push(row.map(csvCell).join(','));
      }

      return lines.join('\n');
    },
  },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function daysBetween(d1, d2) {
  return Math.abs((new Date(d2) - new Date(d1)) / 86400000);
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
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
