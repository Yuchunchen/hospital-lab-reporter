// ─── init.js ───────────────────────────────────────────────
// DOMContentLoaded — load settings into UI, render patient list
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  loadSettingsUI();
  renderPatientList();
  // First-run 院區 picker — shown once when no currentMachine is stored. Feeds
  // resolveRef; until set, colouring uses the '*' universal ref (zero regression).
  if (!getMachineSource()) showMachineFirstRun();
});

// ─── First-run machine picker (vhtt / vhyl) ─────────────────────────────────
// Reuses the .modal-overlay shell in body.html (#machineModal). Two-step
// (pick → confirm) so a vhyl user doesn't mis-pick vhtt (brief §11.5). The key
// is shared across the three HTMLs (same file:// origin) — set it once anywhere
// and the others stay silent.
function renderMachinePick() {
  const body = document.getElementById('machineModalBody');
  if (!body) return;
  body.innerHTML =
    '<p style="margin-bottom:12px;line-height:1.5;color:#4a5568;font-size:13px;">' +
      '用來判讀檢驗值的正常範圍 — 不同院區試劑校正不同。設定一次後不再詢問（可在設定分頁更改）。</p>' +
    '<div style="display:flex;gap:10px;">' +
      '<button class="btn btn-primary" style="flex:1" onclick="pickMachine(\'vhtt\')">臺東分院 (vhtt)</button>' +
      '<button class="btn btn-primary" style="flex:1" onclick="pickMachine(\'vhyl\')">玉里分院 (vhyl)</button>' +
    '</div>';
}
function showMachineFirstRun() {
  renderMachinePick();
  const modal = document.getElementById('machineModal');
  if (modal) modal.classList.remove('hidden');
}
function pickMachine(m) {
  const body = document.getElementById('machineModalBody');
  if (!body) return;
  const label = m === 'vhtt' ? '臺東分院 (vhtt)' : '玉里分院 (vhyl)';
  body.innerHTML =
    '<p style="margin-bottom:12px;line-height:1.5;font-size:13px;">你選的是 <strong>' + label + '</strong>，確認？</p>' +
    '<div style="display:flex;gap:10px;">' +
      '<button class="btn btn-secondary" style="flex:1" onclick="renderMachinePick()">重選</button>' +
      '<button class="btn btn-primary" style="flex:1" onclick="confirmMachine(\'' + m + '\')">確認</button>' +
    '</div>';
}
function confirmMachine(m) {
  setMachineSource(m);
  const modal = document.getElementById('machineModal');
  if (modal) modal.classList.add('hidden');
}
