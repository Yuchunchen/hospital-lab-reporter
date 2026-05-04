'use strict';

/**
 * patients.js — JSON file-based patient CRUD storage.
 *
 * Stores patient list in data/patients.json.
 * Thread-safe for single-process use (2-5 user team).
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PATIENTS_FILE = path.join(DATA_DIR, 'patients.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATIENTS
// ═══════════════════════════════════════════════════════════════════════════════

function loadPatients() {
  ensureDataDir();
  if (!fs.existsSync(PATIENTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(PATIENTS_FILE, 'utf-8'));
  } catch (_) {
    return [];
  }
}

function savePatients(list) {
  ensureDataDir();
  fs.writeFileSync(PATIENTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

function getPatient(chartno) {
  return loadPatients().find(p => p.chartno === chartno) || null;
}

function addPatient(patient) {
  const list = loadPatients();
  if (list.find(p => p.chartno === patient.chartno)) {
    throw new Error(`病歷號 ${patient.chartno} 已存在`);
  }
  list.push(patient);
  savePatients(list);
  return patient;
}

function updatePatient(chartno, updates) {
  const list = loadPatients();
  const idx = list.findIndex(p => p.chartno === chartno);
  if (idx < 0) throw new Error(`病歷號 ${chartno} 不存在`);

  // Merge updates (don't allow changing chartno)
  const { chartno: _, ...safeUpdates } = updates;
  list[idx] = { ...list[idx], ...safeUpdates };
  savePatients(list);
  return list[idx];
}

function deletePatient(chartno) {
  const list = loadPatients();
  const idx = list.findIndex(p => p.chartno === chartno);
  if (idx < 0) throw new Error(`病歷號 ${chartno} 不存在`);
  const removed = list.splice(idx, 1)[0];
  savePatients(list);
  return removed;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS = {
  baseUrl: 'http://ernode.vghb12.vhtt.gov.tw:8000',
  opsid: '',
};

function loadSettings() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  ensureDataDir();
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

module.exports = {
  loadPatients,
  savePatients,
  getPatient,
  addPatient,
  updatePatient,
  deletePatient,
  loadSettings,
  saveSettings,
};
