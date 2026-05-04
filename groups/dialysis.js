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

// 功能旗標：BUN 前/後是否依報告時間判定。預設 true（Step 2 新行為）；
// 切為 false 時退回 legacy 路徑（依 orderName 是否含逗號判斷 pre）。
// 留作緊急回滾用，僅作為 code-only 旗標。
const DIALYSIS_FLAGS = {
  useReportTimeBUN: true,
};

const DIALYSIS_GROUP = {
  id: 'dialysis',
  label: '透析',
  flags: DIALYSIS_FLAGS,

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

  // BUN 前/後判定（Step 2 - 已啟用為主要來源）
  //
  // 策略：
  //   - 先依 (reportDateTime + value) 去重（extractLabValues 會把每筆 BUN
  //     order 同時推到 BUN_pre 與 BUN_post 兩個 testId，這裡合併視同一筆）
  //   - 0 筆 → 兩者皆 null
  //   - 1 筆 → 預設為洗腎前（post = null）
  //   - 2 筆且 reportDateTime 不同 → 早 = 前；晚 = 後
  //   - 2 筆且 reportDateTime 相同（罕見，多半因為解析後同分鐘）：
  //       tie-break：值較小的視為 post（洗腎後 BUN 通常 6–25，遠低於洗腎前
  //       60–90）。若值也相同 → 取陣列原本順序（pre = 第一筆）。
  //   - 3+ 筆 → min/max by reportDateTime，中間筆 console.warn（臨床罕見）
  //   - 至少一筆缺 reportDateTime → console.warn；
  //       若 useReportTimeBUN=false 或全部都缺，退回 legacy 規則：
  //       orderName 含逗號 = pre；orderName == "BUN" = post。
  resolveBUN(bunEntries) {
    if (!bunEntries || bunEntries.length === 0) return { pre: null, post: null };

    // 1. 去重 — 同一筆 BUN order 在 BUN_pre/BUN_post 兩個 testId 各出現一次
    const dedup = [];
    const seen  = new Set();
    for (const e of bunEntries) {
      const key = (e.reportDateTime || e.date || '') + '|' + (e.value != null ? e.value : '');
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(e);
    }

    if (dedup.length === 1) return { pre: dedup[0], post: null };

    // 2. 偵測 reportDateTime 是否完整
    const missingTime = dedup.filter(e => !e.reportDateTime).length;
    const allMissing  = missingTime === dedup.length;

    if (allMissing || !DIALYSIS_FLAGS.useReportTimeBUN) {
      if (allMissing && DIALYSIS_FLAGS.useReportTimeBUN) {
        try { console.warn('[dialysis.resolveBUN] all entries missing reportDateTime — falling back to legacy orderName rule'); } catch (_) {}
      }
      return resolveBUNByLegacyOrderName(dedup);
    }

    if (missingTime > 0) {
      try { console.warn('[dialysis.resolveBUN] some entries missing reportDateTime — those default to "pre"', dedup); } catch (_) {}
    }

    // 3. 依 reportDateTime 排序（缺 time 的視為 0 → 排到最前 = pre）
    const sorted = [...dedup].sort((a, b) => {
      const ta = a.reportDateTime ? new Date(a.reportDateTime).getTime() : 0;
      const tb = b.reportDateTime ? new Date(b.reportDateTime).getTime() : 0;
      return ta - tb;
    });

    // 4. 3+ 筆：中間筆警告
    if (sorted.length > 2) {
      try { console.warn('[dialysis.resolveBUN] 3+ BUN entries on cluster — taking earliest as pre, latest as post', sorted); } catch (_) {}
    }

    let pre  = sorted[0];
    let post = sorted[sorted.length - 1];

    // 5. tie-break：第一與最後的 reportDateTime 相同 → 用值大小判斷
    //    （post 通常比 pre 小很多）
    if (pre.reportDateTime && post.reportDateTime &&
        pre.reportDateTime === post.reportDateTime &&
        pre !== post) {
      const pv = Number(pre.value), sv = Number(post.value);
      if (Number.isFinite(pv) && Number.isFinite(sv) && pv !== sv) {
        if (sv > pv) {
          // post 居然比較大 — 對調
          const tmp = pre; pre = post; post = tmp;
        }
      }
      // 值也相同 → 維持陣列順序
    }

    return { pre, post };
  },

  // 從 localStorage 的 stored 結構（{testId: [{date, value, reportDateTime, orderName, ...}, ...]}）
  // 解析每個 BUN 叢集的 pre/post/URR。回傳：
  //   { 'YYYY-MM-DD': { pre, post, urr, preDate, postDate } }
  // key 為叢集起始日（startDate）；preDate/postDate 為 pre/post 各自的
  // entry.date，因為 lab table 是依日期欄位渲染，pre/post 可能落在不同
  // 日期欄。urr 只在 pre + post 都存在且 pre.value > 0 時計算。
  resolveBunClustersFromStored(labDataForPatient) {
    const out = {};
    if (!labDataForPatient) return out;

    const W = this.monthlyDetection.clusterDayWindow;
    // 把 BUN_pre 與 BUN_post 兩個 testId 的條目合併（dedupe 在 resolveBUN 處理）
    const all = []
      .concat(labDataForPatient.BUN_pre  || [])
      .concat(labDataForPatient.BUN_post || [])
      .concat(labDataForPatient.BUN      || []);
    if (all.length === 0) return out;

    // 排序：reportDateTime 優先，否則用 date
    all.sort((a, b) => {
      const ta = a.reportDateTime ? new Date(a.reportDateTime).getTime()
                                  : (a.date ? new Date(a.date).getTime() : 0);
      const tb = b.reportDateTime ? new Date(b.reportDateTime).getTime()
                                  : (b.date ? new Date(b.date).getTime() : 0);
      return ta - tb;
    });

    // 依日期叢集
    const clusters = [];
    let cur = null;
    for (const e of all) {
      const d = e.date || (e.reportDateTime ? e.reportDateTime.slice(0, 10) : null);
      if (!d) continue;
      const dt = new Date(d);
      if (!cur || (dt - new Date(cur.endDate)) / 86400000 > W) {
        cur = { startDate: d, endDate: d, entries: [] };
        clusters.push(cur);
      } else {
        if (d > cur.endDate) cur.endDate = d;
      }
      cur.entries.push(e);
    }

    for (const c of clusters) {
      const { pre, post } = this.resolveBUN(c.entries);
      const slot = {
        pre,
        post,
        preDate:  pre  ? (pre.date  || (pre.reportDateTime  || '').slice(0, 10)) : null,
        postDate: post ? (post.date || (post.reportDateTime || '').slice(0, 10)) : null,
        urr: null,
      };
      const pv = pre  ? Number(pre.value)  : NaN;
      const sv = post ? Number(post.value) : NaN;
      if (Number.isFinite(pv) && Number.isFinite(sv) && pv > 0) {
        slot.urr = +((1 - sv / pv) * 100).toFixed(1);
      }
      out[c.startDate] = slot;
    }
    return out;
  },

  // 月檢偵測（針對未來 raw lab rows 介面）
  // 輸入：該病人所有 raw lab rows（含 testId / orderDate / reportDateTime / value / unit）
  // 輸出：[{ drawDate: 'YYYY-MM-DD', labs: { TESTID: row } }, ...]
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

    // 把 localStorage 的 {testId: [{date, value, reportDateTime, ...}, ...]} 結構
    // 轉為 draws 陣列。日期叢集後，BUN_pre / BUN_post / URR 透過
    // resolveBunClustersFromStored() 決定（與 lab table 同一個來源）。
    buildDraws(labDataForPatient) {
      if (!labDataForPatient) return [];

      const dateToLabs = new Map();
      for (const id in labDataForPatient) {
        if (id === 'BUN_pre' || id === 'BUN_post' || id === 'BUN') continue;
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

      // BUN pre/post + URR — 走 Step 2 的 resolver。對齊到「叢集起始日」。
      const bunByStart = DIALYSIS_GROUP.resolveBunClustersFromStored(labDataForPatient);
      for (const c of clusters) {
        const slot = bunByStart[c.startDate];
        c.computed = {};
        if (slot) {
          if (slot.pre)  c.labs.BUN_pre  = { value: slot.pre.value,  date: slot.preDate  };
          if (slot.post) c.labs.BUN_post = { value: slot.post.value, date: slot.postDate };
          if (slot.urr != null) c.computed.URR = slot.urr;
        }
      }

      // 也要把 BUN cluster 起始日不在 dateToLabs 的補上（純 BUN cluster）
      const seenStarts = new Set(clusters.map(c => c.startDate));
      for (const startDate in bunByStart) {
        if (seenStarts.has(startDate)) continue;
        const slot = bunByStart[startDate];
        const labs = {};
        if (slot.pre)  labs.BUN_pre  = { value: slot.pre.value,  date: slot.preDate  };
        if (slot.post) labs.BUN_post = { value: slot.post.value, date: slot.postDate };
        const computed = {};
        if (slot.urr != null) computed.URR = slot.urr;
        clusters.push({ startDate, endDate: startDate, labs, computed });
      }

      // 重新排序（最後加入的純 BUN cluster 可能亂序）
      clusters.sort((a, b) => a.startDate.localeCompare(b.startDate));

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

// Legacy fallback：依 orderName 是否含逗號判斷 pre/post。僅在
// useReportTimeBUN=false 或所有條目均缺 reportDateTime 時使用。
function resolveBUNByLegacyOrderName(entries) {
  let pre = null, post = null;
  for (const e of entries) {
    const name = (e.orderName || '').trim();
    if (!post && name === 'BUN') post = e;
    else if (!pre && name.includes(',')) pre = e;
  }
  // 若還沒判斷出 pre：取剩下任一筆
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
