// ─── storage.js ───────────────────────────────────────────────
// Active group resolution + localStorage helpers
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// Active disease group — selected at build time. build.js writes one of:
//   window.ACTIVE_GROUP_ID = 'dialysis';
//   window.ACTIVE_GROUP_ID = 'early-ckd';
// into the {{DISEASE_INIT}} placeholder, which runs BEFORE this script
// because it is appended at the end of the same <script> tag... wait —
// actually init.js appends DOMContentLoaded later, but ACTIVE_GROUP_ID is
// resolved at the top of `<script>` (this module), so the disease-init
// block must be inlined ABOVE storage.js. build.js places the disease-init
// in {{DISEASE_INIT}} which the shell.html template positions BEFORE
// {{CORE_JS}}. Phase 3 made that ordering explicit; the legacy monolith
// inlined a hardcoded 'dialysis' before this module so the fallback
// preserves byte-identical behavior when the legacy HTML loads.
const ACTIVE_GROUP_ID = (typeof window !== 'undefined' && window.ACTIVE_GROUP_ID) || 'dialysis';
const GROUP = (window.GROUPS || {})[ACTIVE_GROUP_ID];
if (!GROUP) {
  throw new Error('[hospital-lab] active group "' + ACTIVE_GROUP_ID +
    '" not loaded — check build.js DISEASES config or sync-patterns.js');
}
// Expose for cross-module ad-hoc reference (export-formats/renal-platform
// reads window.ACTIVE_GROUP).
if (typeof window !== 'undefined') window.ACTIVE_GROUP = GROUP;

const STORAGE_KEYS = {
  patients: GROUP.storageKey.patients,   // 'patients_dialysis'
  settings: 'hd_settings',                // shell-global
  // labData 不再在 localStorage（2026-05-13 搬到 IDB labData store）。
  // GROUP.storageKey.labs 留著給 indexeddb-cache.js 的一次性 migration IIFE
  // 找舊 localStorage key 用。
  // Hotfix v2 (2026-05-05): per-group sort + filter UI state.
  patientSort:    GROUP.storageKey.patients + '_sort',    // {column, dir}
  patientFilters: GROUP.storageKey.patients + '_filters', // {col: value, ...}
};

// One-time migration from legacy hd_* keys (one-release fallback per the
// disease-group refactor plan). Legacy keys are preserved as backup.
(function migrateLegacyStorage() {
  if (!localStorage.getItem(STORAGE_KEYS.patients) && localStorage.getItem('hd_patients')) {
    localStorage.setItem(STORAGE_KEYS.patients, localStorage.getItem('hd_patients'));
  }
})();

/** Load patients from localStorage. Returns array of patient objects. */
function loadPatients() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.patients)) || []; }
  catch { return []; }
}
function savePatients(list) {
  localStorage.setItem(STORAGE_KEYS.patients, JSON.stringify(list));
}

/**
 * Load lab data from IDB labData store (2026-05-13 從 localStorage 搬來).
 * Returns { chartno: { chartno, <testId>: [{date,value},...], _lastUpdate } }
 * 注意：async — 所有 call site 必須 await。
 */
async function loadLabData() {
  try { return await labDataGetAll(); }
  catch (e) { console.warn('[loadLabData] IDB read failed:', e); return {}; }
}

/**
 * Persist the lab-data map. Iterates entries and writes one IDB record per
 * chartno (keyPath=chartno). 注意：async — 所有 call site 必須 await。
 */
async function saveLabData(data) {
  if (!data || typeof data !== 'object') return;
  for (const [cn, lab] of Object.entries(data)) {
    if (!cn || !lab || typeof lab !== 'object') continue;
    try { await labDataPut(cn, lab); }
    catch (e) { console.warn(`[saveLabData] put failed for ${cn}:`, e); }
  }
}

/** Load settings */
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.settings)) || {
      baseUrl: 'http://ernode.vghb12.vhtt.gov.tw:8000',
      opsid: '',
    };
  } catch {
    return { baseUrl: 'http://ernode.vghb12.vhtt.gov.tw:8000', opsid: '' };
  }
}
function saveSettingsData(s) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(s));
}

// ─── Machine source (vhtt / vhyl) ──────────────────────────────────────────────
// Which physical machine this install belongs to — feeds resolveRef so it reads
// machine-specific reference ranges (refHistory). Per TASK_BRIEF §3.2 the reporter
// keeps it in localStorage (it can't see the viewer's chrome.storage). The key is
// NOT disease-namespaced: it's machine-wide and shared across the three HTMLs (same
// file:// origin). When unset, getMachineSource() → null so resolveRef matches only
// the '*' universal ref (= zero regression). Set once via a first-run modal.
function getMachineSource() {
  try {
    const m = localStorage.getItem('currentMachine');
    return (m === 'vhtt' || m === 'vhyl') ? m : null;
  } catch (_) { return null; }
}
function setMachineSource(m) {
  if (m !== 'vhtt' && m !== 'vhyl') return;
  try { localStorage.setItem('currentMachine', m); } catch (_) {}
}
