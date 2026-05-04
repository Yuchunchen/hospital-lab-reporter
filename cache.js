'use strict';

/**
 * cache.js — File-based cache for ernode API HTML responses.
 *
 * Caches raw HTML pages fetched from the ernode server for 7 days.
 * This minimizes load on the hospital data server, which serves
 * HTML pages that can be slow to generate.
 *
 * Cache structure:
 *   data/cache/{chartno}.json
 *   {
 *     chartno: "000810385G",
 *     fetched_at: "2026-04-30T10:00:00.000Z",
 *     expires_at: "2026-05-07T10:00:00.000Z",
 *     orders: [ ... raw order objects ... ],
 *     patient_info: { ... }
 *   }
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'data', 'cache');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Ensure cache directory exists
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheFilePath(chartno) {
  return path.join(CACHE_DIR, `${chartno}.json`);
}

/**
 * Get cached data for a chartno, or null if expired/missing.
 */
function getCache(chartno) {
  ensureCacheDir();
  const fp = cacheFilePath(chartno);
  if (!fs.existsSync(fp)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const expiresAt = new Date(data.expires_at);
    if (expiresAt <= new Date()) {
      // Expired — delete and return null
      try { fs.unlinkSync(fp); } catch (_) {}
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`[cache] Error reading cache for ${chartno}:`, err.message);
    return null;
  }
}

/**
 * Save fetched orders to cache.
 */
function setCache(chartno, orders, patientInfo) {
  ensureCacheDir();
  const now = new Date();
  const data = {
    chartno,
    fetched_at: now.toISOString(),
    expires_at: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
    orders,
    patient_info: patientInfo,
  };

  try {
    fs.writeFileSync(cacheFilePath(chartno), JSON.stringify(data), 'utf-8');
  } catch (err) {
    console.warn(`[cache] Error writing cache for ${chartno}:`, err.message);
  }
}

/**
 * Invalidate (delete) cache for a chartno.
 */
function invalidateCache(chartno) {
  const fp = cacheFilePath(chartno);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (_) {}
}

/**
 * Get cache status (hit/miss, age, expiry) for a chartno.
 */
function getCacheStatus(chartno) {
  ensureCacheDir();
  const fp = cacheFilePath(chartno);
  if (!fs.existsSync(fp)) return { status: 'miss' };

  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const fetchedAt = new Date(data.fetched_at);
    const expiresAt = new Date(data.expires_at);
    const now = new Date();

    if (expiresAt <= now) return { status: 'expired', fetched_at: data.fetched_at };

    return {
      status: 'hit',
      fetched_at: data.fetched_at,
      expires_at: data.expires_at,
      age_hours: Math.round((now - fetchedAt) / (1000 * 60 * 60) * 10) / 10,
      order_count: data.orders ? data.orders.length : 0,
    };
  } catch (_) {
    return { status: 'error' };
  }
}

module.exports = { getCache, setCache, invalidateCache, getCacheStatus };
