// ─── fetch.js ───────────────────────────────────────────────
// ernode HTML scraping + stable-frontier incremental fetch
//
// Extracted verbatim from hospital-lab-data.html (Phase 1 restructure,
// 2026-05-08). Functions stay top-level; the build concatenates every
// core/*.js into a single <script> block, so cross-module calls Just Work
// the way they did in the monolith.

// ═══════════════════════════════════════════════════════════════════════════════
// API FETCHING & HTML PARSING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse patient info from the ernode HTML header.
 * Header text example: "全部醫囑 000123456A 王小明 M 51 歲"
 */
function parsePatientInfo(doc, chartno) {
  const headerText = doc.querySelector('table.Header')?.textContent || '';
  const rest = chartno ? headerText.split(chartno)[1] || '' : headerText;
  const m = rest.match(/\s+(.+?)\s+([MF])\s+(\d+)\s*歲/);
  if (!m) return null;
  return {
    chartno,
    name:   m[1].trim(),
    gender: m[2] === 'M' ? '男' : '女',
    genderCode: m[2],
    age:    m[3],
  };
}

/**
 * Parse a single page of order results from the ernode API HTML.
 * Returns { orders[], nextUrl, total, patientInfo }.
 */
function parseOrdersPage(html, chartno, baseUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const grid = doc.querySelector('table.Grid');
  if (!grid) return { orders: [], nextUrl: null, total: 0, patientInfo: null };

  const patientInfo = parsePatientInfo(doc, chartno);
  const orders = [];

  grid.querySelectorAll('tr.Row').forEach(row => {
    if (row.cells.length < 6) return;
    const h = name => row.querySelector(`input[name="${name}"]`)?.value?.trim() || '';
    const orderDateRaw   = row.cells[4]?.textContent.trim() || '';   // 生效時間
    const receiveDateRaw = row.cells[5]?.textContent.trim() || '';   // 簽收時間
    const effectiveDt = parseDateTaiwan(orderDateRaw);
    const signOffDt   = parseDateTaiwan(receiveDateRaw);
    orders.push({
      ordseq:     h('ORDSEQ'),
      comKey:     h('COM_KEY'),
      ordapno:    h('ORDAPNO'),
      resdttm:    h('RESDTTM'),
      pfcode:     h('PFCODE'),
      ordType:    h('ORDTYPE'),
      orderName:  row.cells[0]?.textContent.trim() || '',
      status:     row.cells[1]?.textContent.trim() || '',
      reportText: row.cells[2]?.textContent.trim() || '',
      dept:       row.cells[3]?.textContent.trim() || '',
      orderDate:  orderDateRaw,
      receiveDate: receiveDateRaw,
      // Revision 1: explicit named fields per the lab-orders page columns.
      // effectiveTime = 生效時間 (cluster anchor for monthly draws);
      // signOffTime  = 簽收時間 (BUN pre/post sort key — pre signs off
      // mid-morning, post signs off afternoon/evening).
      effectiveTime: effectiveDt ? effectiveDt.toISOString() : null,
      signOffTime:   signOffDt   ? signOffDt.toISOString()   : null,
    });
  });

  // Pagination: find ">>" link
  let nextUrl = null;
  doc.querySelectorAll('a').forEach(a => {
    if (a.textContent.trim() === '>>' && !nextUrl) {
      const href = a.getAttribute('href');
      nextUrl = href ? baseUrl + href : null;
    }
  });

  const footerText = doc.querySelector('tr.Footer')?.textContent || '';
  const totalMatch = footerText.match(/總筆數：(\d+)/);
  const total = totalMatch ? +totalMatch[1] : 0;

  return { orders, nextUrl, total, patientInfo };
}

/**
 * Fetch all pages of lab orders for a given chart number.
 * @param {string} chartno - Formatted chart number (e.g. "000810385G")
 * @param {Function} onProgress - Callback(fetched, total)
 * @returns {Promise<{orders: Array, patientInfo: Object}>}
 */
async function fetchAllOrders(chartno, onProgress) {
  const settings = loadSettings();
  const baseUrl = settings.baseUrl;
  let url = `${baseUrl}/order/get_lab_orders?chartno=${chartno}&opsid=${settings.opsid}`;
  const all = [];
  let page = 0, total = 0, patientInfo = null;

  while (url) {
    page++;
    if (page > 50) break; // safety limit

    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const result = parseOrdersPage(html, chartno, baseUrl);
    if (page === 1) {
      if (result.total) total = result.total;
      if (result.patientInfo) patientInfo = result.patientInfo;
    }
    all.push(...result.orders);

    if (onProgress) onProgress(all.length, total || '?');
    if (!result.nextUrl || (total && all.length >= total)) break;
    url = result.nextUrl;
  }

  return { orders: all, patientInfo };
}

/**
 * Stable-frontier incremental fetch. ernode returns orders newest-first;
 * signed-off reports (正式報告/更正報告) are immutable, only 未執行 orders
 * can change (later get a report). So once we hit a page where every order
 * is known AND its status is unchanged, every page beyond is also unchanged.
 *
 * Common case (no new orders) = 1 API call instead of 5–15.
 *
 * @param {string} chartno
 * @param {Array}  cachedOrders - prior orders (will have status updates
 *                                applied in-place; clone before passing if
 *                                the caller needs to keep the original).
 * @param {Function} onProgress - (fetched, total) => void
 */
async function fetchIncremental(chartno, cachedOrders, onProgress) {
  const settings = loadSettings();
  const baseUrl = settings.baseUrl;

  const knownMap = new Map();
  cachedOrders.forEach((o, i) => knownMap.set(o.ordseq, { idx: i, status: o.status }));

  const newOrders = [];
  let url = `${baseUrl}/order/get_lab_orders?chartno=${chartno}&opsid=${settings.opsid}`;
  let page = 0, total = 0, patientInfo = null;

  while (url) {
    page++;
    if (page > 50) break;

    const resp = await fetch(url, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();
    const result = parseOrdersPage(html, chartno, baseUrl);
    if (page === 1) {
      if (result.total) total = result.total;
      if (result.patientInfo) patientInfo = result.patientInfo;
    }

    let allKnown = true;
    for (const order of result.orders) {
      const known = knownMap.get(order.ordseq);
      if (!known) {
        newOrders.push(order);
        allKnown = false;
      } else if (known.status !== order.status) {
        // Typically 未執行 → 正式報告 — overwrite cached entry with new data.
        cachedOrders[known.idx] = order;
        allKnown = false;
      }
      // else: known + unchanged → stable hit
    }

    if (onProgress) onProgress(cachedOrders.length + newOrders.length, total || '?');
    if (allKnown || !result.nextUrl) break;
    url = result.nextUrl;
  }

  // newOrders are newer (came from earlier pages) → prepend to keep newest-first.
  const merged = newOrders.concat(cachedOrders);
  return { orders: merged, patientInfo, pagesChecked: page };
}
