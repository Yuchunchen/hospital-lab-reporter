// ─── indexeddb-cache.js ───────────────────────────────────────────────
// IndexedDB-backed caches (LabReporterOrdersCache)
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// RAW ORDERS CACHE (for incremental fetch, 2026-05-08)
// LAB DATA CACHE (replaces localStorage labs_<group>, 2026-05-13)
// ═══════════════════════════════════════════════════════════════════════════════
// IndexedDB `LabReporterOrdersCache` 容納兩個 store：
//   orders   (keyPath=chartno) — incremental fetch baseline，
//                                { chartno, orders: [...], ts }
//   labData  (keyPath=chartno) — 解析後的 lab values（取代 localStorage
//                                labs_dialysis / labs_ckd / ...），單一 store
//                                跨 disease group 共用。Shape:
//                                { chartno, <testId>: [...], _lastUpdate }
//
// orders store 是 2026-05-08 從 localStorage 搬來的（quota 5MB 在 30 人就吃緊）。
// labData store 是 2026-05-13 搬來的（CKD UACR sub-page enrichment 後每人 ~250KB，
// 20 人就爆 quota，validation 期間實測過 QuotaExceededError）。
// enrichCache (sub-page text by ordapno) 維持在 localStorage — 體積小、cache 本身
// 已 disease-neutral，不在這次 migration 範圍。

const ORDERS_DB_NAME = 'LabReporterOrdersCache';
const ORDERS_DB_VER  = 2;
const ORDERS_STORE   = 'orders';
const LABDATA_STORE  = 'labData';
let _ordersDb = null;

function openOrdersDB() {
  if (_ordersDb) return Promise.resolve(_ordersDb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(ORDERS_DB_NAME, ORDERS_DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ORDERS_STORE)) {
        db.createObjectStore(ORDERS_STORE, { keyPath: 'chartno' });
      }
      if (!db.objectStoreNames.contains(LABDATA_STORE)) {
        db.createObjectStore(LABDATA_STORE, { keyPath: 'chartno' });
      }
    };
    req.onsuccess = () => { _ordersDb = req.result; res(_ordersDb); };
    req.onerror   = () => rej(req.error);
  });
}

async function ordersCacheGet(chartno) {
  if (!chartno) return null;
  const db = await openOrdersDB();
  return new Promise((res, rej) => {
    const r = db.transaction(ORDERS_STORE, 'readonly').objectStore(ORDERS_STORE).get(chartno);
    r.onsuccess = () => {
      const row = r.result;
      res(row ? { orders: row.orders || [], ts: row.ts || 0 } : null);
    };
    r.onerror = () => rej(r.error);
  });
}

async function ordersCachePut(chartno, orders) {
  if (!chartno) return;
  const db = await openOrdersDB();
  return new Promise((res, rej) => {
    const r = db.transaction(ORDERS_STORE, 'readwrite').objectStore(ORDERS_STORE)
                .put({ chartno, orders, ts: Date.now() });
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}

async function ordersCacheDelete(chartno) {
  if (!chartno) return;
  const db = await openOrdersDB();
  return new Promise((res, rej) => {
    const r = db.transaction(ORDERS_STORE, 'readwrite').objectStore(ORDERS_STORE)
                .delete(chartno);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}

// ─── labData CRUD ──────────────────────────────────────────────────────────
// 單一 store、跨 group 共用、keyPath=chartno。Stored record shape:
//   { chartno, <testId>: [{date, value, dateObj, ...}, ...], ..., _lastUpdate }

async function labDataGet(chartno) {
  if (!chartno) return null;
  const db = await openOrdersDB();
  return new Promise((res, rej) => {
    const r = db.transaction(LABDATA_STORE, 'readonly').objectStore(LABDATA_STORE).get(chartno);
    r.onsuccess = () => res(r.result || null);
    r.onerror   = () => rej(r.error);
  });
}

// 回傳 { [chartno]: labRecord }，取代舊 loadLabData() 的 in-memory map。
// labRecord 內的 chartno 屬性無害（call site 都是用 outer key 索引）。
async function labDataGetAll() {
  const db = await openOrdersDB();
  return new Promise((res, rej) => {
    const r = db.transaction(LABDATA_STORE, 'readonly').objectStore(LABDATA_STORE).getAll();
    r.onsuccess = () => {
      const out = {};
      for (const row of (r.result || [])) {
        if (row && row.chartno) out[row.chartno] = row;
      }
      res(out);
    };
    r.onerror = () => rej(r.error);
  });
}

async function labDataPut(chartno, lab) {
  if (!chartno) return;
  const db = await openOrdersDB();
  // 把 chartno 寫進 record（keyPath 必要）。
  // _lastUpdate：caller 通常已設好（saveLabData / migration newer-wins 都需要原值）；
  // 若 lab 沒帶 _lastUpdate，補一個 now 才不會破壞 UI 的「最後更新」欄。
  const record = Object.assign({}, lab, { chartno });
  if (record._lastUpdate == null) record._lastUpdate = Date.now();
  return new Promise((res, rej) => {
    const r = db.transaction(LABDATA_STORE, 'readwrite').objectStore(LABDATA_STORE).put(record);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}

// confirmRemovePatient 呼叫：只在 chartno 不在任何 group 的 patient list
// 才實際從 IDB 刪除。同一病人若同時在 dialysis + ckd，刪 ckd 那邊不該
// 連帶清掉 dialysis 還在用的 lab record。掃 localStorage 所有
// patients_* key（reporter 兩個 HTML 共用同一 origin，localStorage 可見）。
async function labDataDelete(chartno) {
  if (!chartno) return;
  let stillInUse = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('patients_')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let list;
      try { list = JSON.parse(raw); } catch { continue; }
      if (!Array.isArray(list)) continue;
      if (list.some(p => p && (p.chartno === chartno || p.chartNo === chartno))) {
        stillInUse = true;
        break;
      }
    }
  } catch (e) {
    console.warn('[labDataDelete] cross-group scan failed:', e);
  }
  if (stillInUse) {
    console.log(`[labDataDelete] ${chartno} 仍在其他 group，保留 IDB record`);
    return;
  }
  const db = await openOrdersDB();
  return new Promise((res, rej) => {
    const r = db.transaction(LABDATA_STORE, 'readwrite').objectStore(LABDATA_STORE)
                .delete(chartno);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}

// ─── One-time migrations ───────────────────────────────────────────────────

// 2026-05-08：丟棄 legacy localStorage ordersCache（baseline 資料，下次 fetch 自動補）。
(function dropLegacyOrdersCache() {
  try {
    if (localStorage.getItem('ordersCache_dialysis')) {
      localStorage.removeItem('ordersCache_dialysis');
    }
  } catch (_) { /* ignore */ }
})();

// 2026-05-13：把 labs_<group> 從 localStorage 搬到 IDB labData store。
// 每個 disease HTML 各自跑一次；store 跨 group 共用，同一 chartno 若先被
// 另一個 group migrate 過，用 _lastUpdate newer-wins 決定要不要覆寫。
// 保留 labs_<group>_legacy 作 backup（給一個 release 的回退空間）。
(function migrateLabsToIDB() {
  const groupId = (typeof window !== 'undefined' && window.ACTIVE_GROUP_ID) || 'dialysis';
  const lsKey = `labs_${groupId}`;
  let lsData;
  try { lsData = localStorage.getItem(lsKey); } catch (_) { return; }
  if (!lsData) return;

  (async () => {
    try {
      const obj = JSON.parse(lsData);
      if (!obj || typeof obj !== 'object') return;
      let migrated = 0;
      for (const [cn, lab] of Object.entries(obj)) {
        if (!cn || !lab || typeof lab !== 'object') continue;
        const existing = await labDataGet(cn);
        const incomingTs = lab._lastUpdate || 0;
        const existingTs = existing ? (existing._lastUpdate || 0) : 0;
        if (!existing || incomingTs >= existingTs) {
          await labDataPut(cn, lab);
          migrated++;
        }
      }
      console.log(`[migration] migrated ${migrated} labs from ${lsKey} → IDB`);
      try {
        localStorage.setItem(lsKey + '_legacy', lsData);
        localStorage.removeItem(lsKey);
      } catch (e) {
        console.warn(`[migration] backup/cleanup failed for ${lsKey}:`, e);
      }
    } catch (e) {
      console.warn(`[migration] failed migrating ${lsKey}:`, e);
    }
  })();
})();
