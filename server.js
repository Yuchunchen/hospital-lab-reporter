'use strict';

/**
 * server.js — Hospital Lab Reporter API + Web UI
 *
 * Express server that:
 *   1. Provides a REST API for lab/imaging data with 7-day caching
 *   2. Provides patient list CRUD (JSON file storage)
 *   3. Serves the web UI
 *
 * Shares regex patterns with hospital-lab-viewer via mapping.js
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  formatChartNo,
  fetchAllOrders,
  extractLabValues,
  computeDerivedValues,
  extractImageReports,
} = require('./fetcher');
const {
  loadPatients,
  getPatient,
  addPatient,
  updatePatient,
  deletePatient,
  loadSettings,
  saveSettings,
} = require('./patients');
const { getCacheStatus, invalidateCache } = require('./cache');
const { compileMonthlyCSV } = require('./csv-compiler');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static web UI
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════════════════════
// API: LAB & IMAGE REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/reports
 *
 * Fetch lab and/or imaging reports for a patient.
 *
 * Query params:
 *   chartno    (required) - Patient chart number
 *   type       (optional) - "lab", "image", or "all" (default: "all")
 *   start_date (optional) - Start date YYYY-MM-DD
 *   end_date   (optional) - End date YYYY-MM-DD
 *   refresh    (optional) - "true" to bypass cache
 *
 * Response JSON:
 * {
 *   chartno, patient_info, from_cache, fetched_at,
 *   lab_data: { testId: [{ date, value, orderDatetime, reportDatetime }] },
 *   image_reports: [{ orderName, orderDate, reportText, reportDatetime, date }],
 *   cache_status: { ... }
 * }
 */
app.get('/api/reports', async (req, res) => {
  try {
    const { chartno: rawChartno, type = 'all', start_date, end_date, refresh } = req.query;

    if (!rawChartno) {
      return res.status(400).json({ error: '請提供 chartno 參數' });
    }

    let chartno;
    try {
      chartno = formatChartNo(rawChartno);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const settings = loadSettings();
    if (!settings.opsid) {
      return res.status(400).json({ error: '請先設定操作人員代號 (OPSID)' });
    }

    // Parse date range
    let startDate = null, endDate = null;
    if (start_date) startDate = new Date(start_date + 'T00:00:00');
    if (end_date) endDate = new Date(end_date + 'T23:59:59');

    // Fetch orders (with cache)
    const forceRefresh = refresh === 'true';
    const { orders, patientInfo, fromCache, fetchedAt, expiresAt } = await fetchAllOrders(
      chartno, settings.baseUrl, settings.opsid, forceRefresh
    );

    // Update patient info if we have it
    if (patientInfo) {
      try {
        const existing = getPatient(chartno);
        if (existing) {
          updatePatient(chartno, {
            name: patientInfo.name || existing.name,
            gender: patientInfo.gender || existing.gender,
            genderCode: patientInfo.genderCode || existing.genderCode,
            age: patientInfo.age || existing.age,
          });
        }
      } catch (_) {}
    }

    const response = {
      chartno,
      patient_info: patientInfo,
      from_cache: fromCache,
      fetched_at: fetchedAt,
      expires_at: expiresAt || null,
      total_orders: orders.length,
    };

    // Extract based on type parameter
    const wantLab = type === 'all' || type === 'lab';
    const wantImage = type === 'all' || type === 'image';

    if (wantLab) {
      let labData = extractLabValues(orders, startDate, endDate);
      labData = computeDerivedValues(labData);
      response.lab_data = labData;
    }

    if (wantImage) {
      response.image_reports = extractImageReports(orders, startDate, endDate);
    }

    res.json(response);
  } catch (err) {
    console.error('[API] /api/reports error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/cache-status
 *
 * Check cache status for a chartno without fetching.
 */
app.get('/api/reports/cache-status', (req, res) => {
  const { chartno: rawChartno } = req.query;
  if (!rawChartno) return res.status(400).json({ error: 'chartno required' });

  try {
    const chartno = formatChartNo(rawChartno);
    res.json(getCacheStatus(chartno));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * DELETE /api/reports/cache
 *
 * Invalidate cache for a chartno.
 */
app.delete('/api/reports/cache', (req, res) => {
  const { chartno: rawChartno } = req.query;
  if (!rawChartno) return res.status(400).json({ error: 'chartno required' });

  try {
    const chartno = formatChartNo(rawChartno);
    invalidateCache(chartno);
    res.json({ success: true, message: `Cache invalidated for ${chartno}` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: PATIENTS CRUD
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/patients — List all patients */
app.get('/api/patients', (req, res) => {
  res.json(loadPatients());
});

/** GET /api/patients/:chartno — Get one patient */
app.get('/api/patients/:chartno', (req, res) => {
  try {
    const chartno = formatChartNo(req.params.chartno);
    const patient = getPatient(chartno);
    if (!patient) return res.status(404).json({ error: '病患不存在' });
    res.json(patient);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** POST /api/patients — Add a new patient */
app.post('/api/patients', (req, res) => {
  try {
    const { chartno: rawChartno, name, schedule = '一三五', shift = '上午' } = req.body;
    if (!rawChartno || !name) {
      return res.status(400).json({ error: '請提供 chartno 和 name' });
    }
    const chartno = formatChartNo(rawChartno);
    const patient = addPatient({ chartno, name, schedule, shift });
    res.status(201).json(patient);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** PUT /api/patients/:chartno — Update a patient */
app.put('/api/patients/:chartno', (req, res) => {
  try {
    const chartno = formatChartNo(req.params.chartno);
    const updated = updatePatient(chartno, req.body);
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** DELETE /api/patients/:chartno — Delete a patient */
app.delete('/api/patients/:chartno', (req, res) => {
  try {
    const chartno = formatChartNo(req.params.chartno);
    const removed = deletePatient(chartno);
    invalidateCache(chartno);
    res.json({ success: true, removed });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/settings */
app.get('/api/settings', (req, res) => {
  res.json(loadSettings());
});

/** PUT /api/settings */
app.put('/api/settings', (req, res) => {
  const updated = saveSettings(req.body);
  res.json(updated);
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: BATCH UPDATE ALL PATIENTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/patients/update-all
 *
 * Fetch fresh data for all patients (bypasses cache).
 * Returns summary of successes/failures.
 */
app.post('/api/patients/update-all', async (req, res) => {
  const patients = loadPatients();
  const settings = loadSettings();

  if (!settings.opsid) {
    return res.status(400).json({ error: '請先設定 OPSID' });
  }

  const results = [];
  for (const p of patients) {
    try {
      const { orders, patientInfo } = await fetchAllOrders(
        p.chartno, settings.baseUrl, settings.opsid, true
      );

      if (patientInfo) {
        try {
          updatePatient(p.chartno, {
            name: patientInfo.name || p.name,
            gender: patientInfo.gender || p.gender,
            genderCode: patientInfo.genderCode || p.genderCode,
            age: patientInfo.age || p.age,
          });
        } catch (_) {}
      }

      results.push({ chartno: p.chartno, name: p.name, success: true, orderCount: orders.length });
    } catch (err) {
      results.push({ chartno: p.chartno, name: p.name, success: false, error: err.message });
    }
  }

  const success = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  res.json({ total: patients.length, success, fail, details: results });
});


// ═══════════════════════════════════════════════════════════════════════════════
// API: CSV MONTHLY REPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/csv/compile
 *
 * Compile monthly CSV report for all patients.
 * Body: { year, month, forceRefresh? }
 * If year/month not provided, uses current month.
 */
app.post('/api/csv/compile', async (req, res) => {
  try {
    const now = new Date();
    const year = req.body.year || now.getFullYear();
    const month = req.body.month || now.getMonth() + 1;
    const forceRefresh = req.body.forceRefresh || false;

    const result = await compileMonthlyCSV(year, month, { forceRefresh });

    // Save CSV to data/ for download
    const fs = require('fs');
    const csvDir = path.join(__dirname, 'data', 'csv');
    if (!fs.existsSync(csvDir)) fs.mkdirSync(csvDir, { recursive: true });

    const filename = `hemodialysis_${year}_${String(month).padStart(2, '0')}.csv`;
    fs.writeFileSync(path.join(csvDir, filename), result.csv, 'utf-8');

    res.json({
      success: true,
      filename,
      month: result.month,
      patientCount: result.patientCount,
      rowCount: result.rows.length,
      errors: result.errors,
    });
  } catch (err) {
    console.error('[API] /api/csv/compile error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/csv/download?year=2026&month=5
 *
 * Download the compiled CSV file.
 */
app.get('/api/csv/download', (req, res) => {
  const now = new Date();
  const year = req.query.year || now.getFullYear();
  const month = req.query.month || now.getMonth() + 1;
  const filename = `hemodialysis_${year}_${String(month).padStart(2, '0')}.csv`;
  const filePath = path.join(__dirname, 'data', 'csv', filename);

  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `CSV file not found: ${filename}. Please compile first.` });
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.sendFile(filePath);
});

/**
 * GET /api/csv/list
 *
 * List available CSV files.
 */
app.get('/api/csv/list', (req, res) => {
  const fs = require('fs');
  const csvDir = path.join(__dirname, 'data', 'csv');
  if (!fs.existsSync(csvDir)) return res.json([]);

  const files = fs.readdirSync(csvDir)
    .filter(f => f.endsWith('.csv'))
    .map(f => {
      const stat = fs.statSync(path.join(csvDir, f));
      return { filename: f, size: stat.size, modified: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.filename.localeCompare(a.filename));

  res.json(files);
});


// ═══════════════════════════════════════════════════════════════════════════════
// FALLBACK: serve index.html for SPA routes
// ═══════════════════════════════════════════════════════════════════════════════

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Hospital Lab Reporter API`);
  console.log(`  http://localhost:${PORT}\n`);
});
