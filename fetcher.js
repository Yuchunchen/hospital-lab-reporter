'use strict';

/**
 * fetcher.js — Fetches and parses lab/imaging orders from ernode API.
 *
 * Uses cheerio for HTML parsing (same logic as hospital-lab-data.html JS).
 * Integrates with cache.js for 7-day caching of raw responses.
 */

const cheerio = require('cheerio');
const fetch = require('node-fetch');
const { getCache, setCache } = require('./cache');

// ═══════════════════════════════════════════════════════════════════════════════
// CHART NUMBER FORMATTING
// ═══════════════════════════════════════════════════════════════════════════════

function formatChartNo(raw) {
  const s = raw.trim();
  if (!s) throw new Error('請輸入病歷號');
  const last = s[s.length - 1];
  if (!/[a-zA-Z]/.test(last)) throw new Error('病歷號須以英文字母結尾 (如 810385G)');
  const letter = last.toUpperCase();
  const digitStr = s.slice(0, -1).replace(/\D/g, '');
  if (!digitStr) throw new Error('病歷號中未找到數字');
  if (digitStr.length > 9) throw new Error('數字部分最多 9 碼');
  return digitStr.padStart(9, '0') + letter;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Parse RESDTTM: "20260414203800" -> Date */
function parseDateResdttm(str) {
  if (!str || str.length < 8) return null;
  const y = +str.slice(0, 4), m = +str.slice(4, 6) - 1, d = +str.slice(6, 8);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  return new Date(y, m, d);
}

/** Parse Taiwan calendar date: "115/04/14 19:36" -> Date */
function parseDateTaiwan(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;
  return new Date(+match[1] + 1911, +match[2] - 1, +match[3]);
}

/** Format Date as YYYY-MM-DD */
function toSortableDate(d) {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTML PARSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse patient info from ernode HTML header.
 * Header: "全部醫囑 000123456A 王小明 M 51 歲"
 */
function parsePatientInfo($, chartno) {
  const headerEl = $('table.Header');
  if (!headerEl.length) return null;
  const text = headerEl.text();
  const rest = chartno && text.includes(chartno) ? text.split(chartno)[1] : text;
  const m = rest.match(/\s+(.+?)\s+([MF])\s+(\d+)\s*歲/);
  if (!m) return null;
  return {
    chartno,
    name: m[1].trim(),
    gender: m[2] === 'M' ? '男' : '女',
    genderCode: m[2],
    age: m[3],
  };
}

/**
 * Parse a single page of order results.
 * Returns { orders[], nextUrl, total, patientInfo }
 */
function parseOrdersPage(html, chartno, baseUrl) {
  const $ = cheerio.load(html);
  const grid = $('table.Grid');
  if (!grid.length) return { orders: [], nextUrl: null, total: 0, patientInfo: null };

  const patientInfo = parsePatientInfo($, chartno);
  const orders = [];

  grid.find('tr.Row').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 6) return;

    const getHidden = (name) => $(row).find(`input[name="${name}"]`).val()?.trim() || '';

    orders.push({
      ordseq:      getHidden('ORDSEQ'),
      comKey:      getHidden('COM_KEY'),
      ordapno:     getHidden('ORDAPNO'),
      resdttm:     getHidden('RESDTTM'),
      pfcode:      getHidden('PFCODE'),
      ordType:     getHidden('ORDTYPE'),
      orderName:   $(cells[0]).text().trim(),
      status:      $(cells[1]).text().trim(),
      reportText:  $(cells[2]).text().trim(),
      dept:        $(cells[3]).text().trim(),
      orderDate:   $(cells[4]).text().trim(),
      receiveDate: $(cells[5]).text().trim(),
    });
  });

  // Pagination: find ">>" link
  let nextUrl = null;
  $('a').each((_, a) => {
    if ($(a).text().trim() === '>>' && !nextUrl) {
      const href = $(a).attr('href');
      if (href) nextUrl = baseUrl + href;
    }
  });

  // Total count
  const footerText = $('tr.Footer').text() || '';
  const totalMatch = footerText.match(/總筆數：(\d+)/);
  const total = totalMatch ? +totalMatch[1] : 0;

  return { orders, nextUrl, total, patientInfo };
}

/**
 * Fetch all pages of orders from ernode API.
 * Uses cache if available (7-day TTL).
 *
 * @param {string} chartno - Formatted chart number
 * @param {string} baseUrl - ernode base URL
 * @param {string} opsid   - operator ID
 * @param {boolean} forceRefresh - bypass cache
 * @returns {Promise<{orders: Array, patientInfo: Object, fromCache: boolean}>}
 */
async function fetchAllOrders(chartno, baseUrl, opsid, forceRefresh = false) {
  // Check cache first
  if (!forceRefresh) {
    const cached = getCache(chartno);
    if (cached) {
      console.log(`[fetcher] Cache hit for ${chartno} (fetched ${cached.fetched_at})`);
      return {
        orders: cached.orders,
        patientInfo: cached.patient_info,
        fromCache: true,
        fetchedAt: cached.fetched_at,
        expiresAt: cached.expires_at,
      };
    }
  }

  // Fetch from ernode
  console.log(`[fetcher] Fetching ${chartno} from ernode...`);
  let url = `${baseUrl}/order/get_lab_orders?chartno=${chartno}&opsid=${opsid}`;
  const allOrders = [];
  let page = 0, total = 0, patientInfo = null;

  while (url) {
    page++;
    if (page > 50) break; // safety limit

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`ernode HTTP ${resp.status}`);
    const html = await resp.text();

    const result = parseOrdersPage(html, chartno, baseUrl);
    if (page === 1) {
      if (result.total) total = result.total;
      if (result.patientInfo) patientInfo = result.patientInfo;
    }
    allOrders.push(...result.orders);

    if (!result.nextUrl || (total && allOrders.length >= total)) break;
    url = result.nextUrl;
  }

  // Save to cache
  setCache(chartno, allOrders, patientInfo);
  console.log(`[fetcher] Cached ${allOrders.length} orders for ${chartno}`);

  return {
    orders: allOrders,
    patientInfo,
    fromCache: false,
    fetchedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAB VALUE EXTRACTION (uses shared TEST_MAP + dialysis extensions)
// ═══════════════════════════════════════════════════════════════════════════════

const { TEST_MAP, DIALYSIS_TESTS, COMPUTED_TESTS, ALL_TIME_IDS } = require('./lab-mapping');

/**
 * Extract lab values from orders using shared TEST_MAP patterns.
 *
 * @param {Array} orders       - Raw order records
 * @param {Date|null} startDate - Start of date range (optional)
 * @param {Date|null} endDate   - End of date range (optional)
 * @returns {Object} { testId: [{ date, value, orderDatetime, reportDatetime }, ...] }
 */
function extractLabValues(orders, startDate = null, endDate = null) {
  // Merge shared TEST_MAP patterns (those with a pattern) with dialysis-specific ones
  const allTests = [
    ...TEST_MAP.filter(t => t.pattern && !t.computed),
    ...DIALYSIS_TESTS,
  ];

  const results = {};
  for (const t of allTests) results[t.id] = [];

  const defaultCutoff = new Date();
  defaultCutoff.setMonth(defaultCutoff.getMonth() - 12);
  defaultCutoff.setHours(0, 0, 0, 0);

  for (const order of orders) {
    if (order.ordType && order.ordType !== 'LAB') continue;
    if (!order.reportText) continue;

    const dateObj = parseDateResdttm(order.resdttm) || parseDateTaiwan(order.orderDate);
    if (!dateObj) continue;

    const text = order.reportText;
    const dateStr = toSortableDate(dateObj);
    const orderName = order.orderName || '';
    const isComposite = orderName.includes(',');
    const isStandaloneBun = orderName.split(/[\n\r]/)[0].trim() === 'BUN';

    for (const test of allTests) {
      // Date filtering
      if (startDate && endDate) {
        if (dateObj < startDate || dateObj > endDate) {
          if (!ALL_TIME_IDS.has(test.id)) continue;
        }
      } else {
        if (!ALL_TIME_IDS.has(test.id) && dateObj < defaultCutoff) continue;
      }

      // BUN filter logic (dialysis-specific)
      if (test.filter === 'composite' && !isComposite) continue;
      if (test.filter === 'standalone_bun' && !isStandaloneBun) continue;

      const match = text.match(test.pattern);
      if (!match) continue;

      let value = match[1];
      const isQualitative = test.qualitative || false;

      if (!isQualitative) {
        value = parseFloat(value);
        if (isNaN(value)) continue;
        if (typeof test.normalize === 'function') {
          value = test.normalize(value);
        }
      }

      // Deduplicate
      const existing = results[test.id];
      if (!existing.find(e => e.date === dateStr && e.value === value)) {
        existing.push({
          date: dateStr,
          value,
          orderDatetime: order.orderDate || '',
          reportDatetime: order.resdttm || '',
        });
      }
    }
  }

  // Sort newest first
  for (const id in results) {
    results[id].sort((a, b) => b.date.localeCompare(a.date));
  }

  return results;
}

/**
 * Compute derived values (URR, Ca×P).
 */
function computeDerivedValues(results) {
  for (const ct of COMPUTED_TESTS) {
    results[ct.id] = [];

    if (ct.id === 'URR') {
      const preMap = {};
      for (const e of (results['BUN_pre'] || [])) {
        if (!preMap[e.date]) preMap[e.date] = e;
      }
      for (const e of (results['BUN_post'] || [])) {
        const pre = preMap[e.date];
        if (pre && pre.value && pre.value !== 0) {
          const v = ct.compute(pre.value, e.value);
          if (v != null) {
            results[ct.id].push({
              date: e.date, value: v,
              orderDatetime: e.orderDatetime || '',
              reportDatetime: e.reportDatetime || '',
            });
          }
        }
      }
    } else if (ct.id === 'CaxP') {
      const caMap = {};
      for (const e of (results['Ca'] || [])) {
        if (!caMap[e.date]) caMap[e.date] = e;
      }
      for (const e of (results['P'] || [])) {
        const ca = caMap[e.date];
        if (ca) {
          const v = ct.compute(ca.value, e.value);
          if (v != null) {
            results[ct.id].push({
              date: e.date, value: v,
              orderDatetime: e.orderDatetime || '',
              reportDatetime: e.reportDatetime || '',
            });
          }
        }
      }
    }

    results[ct.id].sort((a, b) => b.date.localeCompare(a.date));
  }

  return results;
}

/**
 * Extract imaging (RAD) reports from orders.
 */
function extractImageReports(orders, startDate = null, endDate = null) {
  const results = [];

  for (const order of orders) {
    if (order.ordType !== 'RAD') continue;

    const dateObj = parseDateResdttm(order.resdttm) || parseDateTaiwan(order.orderDate);
    if (!dateObj) continue;

    if (startDate && endDate) {
      if (dateObj < startDate || dateObj > endDate) continue;
    }

    results.push({
      orderName: order.orderName || '',
      orderDate: order.orderDate || '',
      reportText: order.reportText || '',
      reportDatetime: order.resdttm || '',
      date: toSortableDate(dateObj),
      status: order.status || '',
      dept: order.dept || '',
    });
  }

  results.sort((a, b) => b.date.localeCompare(a.date));
  return results;
}


module.exports = {
  formatChartNo,
  parseDateResdttm,
  parseDateTaiwan,
  toSortableDate,
  fetchAllOrders,
  extractLabValues,
  computeDerivedValues,
  extractImageReports,
};
