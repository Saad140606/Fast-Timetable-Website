"use strict";
// Simple in-memory cache for serverless endpoints.
// Note: In Vercel serverless, module-scoped memory may be reused for warm
// invocations but is not guaranteed long-term. This cache is intended for
// short TTLs (seconds) to reduce immediate duplicate requests.

const CACHE_TTL_MS = Number(process.env.SERVER_CACHE_TTL_MS) || 30000; // default 30s

const cache = {
  schedule: {},
  search: {},
  week: null,
  lastFetchTime: {
    schedule: {},
    search: {},
    week: 0
  }
};

function _now() { return Date.now(); }

function isValid(kind, key) {
  const now = _now();
  if (kind === 'week') {
    return cache.week !== null && (now - cache.lastFetchTime.week) < CACHE_TTL_MS;
  }
  const map = kind === 'search' ? cache.search : cache.schedule;
  const times = kind === 'search' ? cache.lastFetchTime.search : cache.lastFetchTime.schedule;
  return map[key] && (now - (times[key] || 0)) < CACHE_TTL_MS;
}

function get(kind, key) {
  if (kind === 'week') return cache.week;
  return (kind === 'search') ? cache.search[key] : cache.schedule[key];
}

function set(kind, key, value) {
  const now = _now();
  if (kind === 'week') {
    cache.week = value;
    cache.lastFetchTime.week = now;
    return;
  }
  if (kind === 'search') {
    cache.search[key] = value;
    cache.lastFetchTime.search[key] = now;
    return;
  }
  cache.schedule[key] = value;
  cache.lastFetchTime.schedule[key] = now;
}

function clearAll() {
  cache.schedule = {};
  cache.search = {};
  cache.week = null;
  cache.lastFetchTime = { schedule: {}, search: {}, week: 0 };
}

module.exports = {
  isValid,
  get,
  set,
  clearAll,
  CACHE_TTL_MS
};