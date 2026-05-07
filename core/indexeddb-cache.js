// ─── indexeddb-cache.js ───────────────────────────────────────────────
// IndexedDB-backed raw orders cache (LabReporterOrdersCache)
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// RAW ORDERS CACHE (for incremental fetch, 2026-05-08)
// ═══════════════════════════════════════════════════════════════════════════════
// IndexedDB `LabReporterOrdersCache` / store `orders` (keyPath=chartno):
//   { chartno, orders: [...], ts }
// Used as the baseline for fetchIncremental. Migrated from localStorage on
// 2026-05-08 — 30 patients × ~100KB approached the 5MB localStorage cap; per-
// origin IndexedDB quota is several hundred MB, so quota concerns disappear.
// enrichCache_dialysis (sub-page text by ordapno) stays in localStorage — it's
// smaller and out of scope for this migration.

const ORDERS_DB_NAME = 'LabReporterOrdersCache';
const ORDERS_DB_VER  = 1;
const ORDERS_STORE   = 'orders';
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

// One-time migration: drop the legacy localStorage ordersCache. Anything in
// it is throwaway baseline data — first fetch after upgrade re-populates the
// IndexedDB store via fetchAllOrders.
(function dropLegacyOrdersCache() {
  try {
    if (localStorage.getItem('ordersCache_dialysis')) {
      localStorage.removeItem('ordersCache_dialysis');
    }
  } catch (_) { /* ignore */ }
})();
