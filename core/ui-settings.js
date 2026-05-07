// ─── ui-settings.js ───────────────────────────────────────────────
// Settings tab: load / save base URL + OPSID
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

function loadSettingsUI() {
  const s = loadSettings();
  document.getElementById('settingBaseUrl').value = s.baseUrl || '';
  document.getElementById('settingOpsid').value = s.opsid || '';
}

function saveSettings() {
  const baseUrl = document.getElementById('settingBaseUrl').value.trim().replace(/\/+$/, '');
  const opsid = document.getElementById('settingOpsid').value.trim();
  saveSettingsData({ baseUrl: baseUrl || 'http://ernode.vghb12.vhtt.gov.tw:8000', opsid });
  showToast('設定已儲存', 'success');
}
