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

// Active disease group — Step 1 hardcodes 'dialysis'; the disease-tab UI
// (Step 3) will switch this at runtime. Storage keys for patients/labs come
// from the active group module; settings stays shell-global.
const ACTIVE_GROUP_ID = 'dialysis';
const GROUP = (window.GROUPS || {})[ACTIVE_GROUP_ID];
if (!GROUP) {
  throw new Error('[hospital-lab-data] active group "' + ACTIVE_GROUP_ID +
    '" not loaded — run `node sync-patterns.js`');
}

const STORAGE_KEYS = {
  patients: GROUP.storageKey.patients,   // 'patients_dialysis'
  settings: 'hd_settings',                // shell-global
  labData:  GROUP.storageKey.labs,        // 'labs_dialysis'
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
  if (!localStorage.getItem(STORAGE_KEYS.labData) && localStorage.getItem('hd_labData')) {
    localStorage.setItem(STORAGE_KEYS.labData, localStorage.getItem('hd_labData'));
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

/** Load lab data from localStorage. Returns { chartno: { testId: [{date,value},...] } } */
function loadLabData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.labData)) || {}; }
  catch { return {}; }
}
function saveLabData(data) {
  localStorage.setItem(STORAGE_KEYS.labData, JSON.stringify(data));
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
