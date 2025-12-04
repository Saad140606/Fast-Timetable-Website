/**
 * API route for timetable data (my notes)
 *
 * I implemented this endpoint to return parsed schedule data and to support
 * search across days. It uses helpers from `lib/sheets.js` to fetch and
 * structure the data. The endpoint accepts `action` queries: `fetch`,
 * `search`, and `days`.
 * 
 * Cache: Responses from Google Sheets are cached for 30 seconds to speed up
 * repeated searches and schedule fetches. Cache is invalidated after TTL.
 */

import { getDaySchedule, searchAcrossAllDays } from '../../lib/sheets';
const serverCache = require('../../lib/serverCache');

function getCacheKey(action, params) {
  if (action === 'search') {
    return `${params.query}:${params.day}`;
  }
  return String(params.day);
}

function normalizeDayParam(dayParam) {
  if (dayParam === undefined || dayParam === null) return undefined;
  const s = String(dayParam).toLowerCase();
  if (s === 'all' || s === 'week') return 'all';
  if (s === 'today') {
    const now = new Date().getDay(); // 0=Sun,1=Mon..6=Sat
    return (now === 0 || now === 6) ? 0 : now - 1;
  }
  const n = parseInt(s, 10);
  if (!isNaN(n)) {
    // map Saturday(6) or Sunday(0) to Monday(0) if they appear
    if (n === 6 || n === 0) return 0;
    return n;
  }
  return undefined;
}

export default async function handler(req, res) {
  const { action } = req.query;
  const rawDay = req.query.day;
  const query = req.query.query;

  try {
    if (action === 'fetch') {
      const dayParam = normalizeDayParam(rawDay);
      if (dayParam === undefined) {
        return res.status(400).json({ success: false, error: 'Missing or invalid day parameter' });
      }

      if (dayParam === 'all') {
        // Check cache first
        if (serverCache.isValid('week')) {
          return res.status(200).json({ success: true, week: serverCache.get('week'), cached: true, timestamp: new Date().toISOString() });
        }

        // return the full week schedules grouped by day
        const week = {};
        for (let d = 0; d < 5; d++) {
          const r = await getDaySchedule(d);
          if (r.success) week[r.day] = r.data;
        }
        serverCache.set('week', 'all', week);
        return res.status(200).json({ success: true, week, cached: false, timestamp: new Date().toISOString() });
      }

          // Check cache for single day
      const cacheKey = String(dayParam);
          if (serverCache.isValid('schedule', cacheKey)) {
            const cached = serverCache.get('schedule', cacheKey);
            return res.status(200).json({ ...cached, cached: true });
          }

      // numeric day fetch
      const result = await getDaySchedule(dayParam);
      if (result.success) {
            serverCache.set('schedule', cacheKey, result);
      }
      return res.status(result.success ? 200 : 400).json({ ...result, cached: false });
    }

    if (action === 'search' && query) {
      const dayParam = normalizeDayParam(rawDay);
      const cacheKey = getCacheKey('search', { query, day: dayParam || 'all' });

      // Check cache first - instant response
          if (serverCache.isValid('search', cacheKey)) {
            const cached = serverCache.get('search', cacheKey);
            return res.status(200).json({ ...cached, cached: true });
          }

      // Fetch fresh data
      let result;
      if (dayParam === 'all' || dayParam === undefined) {
        result = await searchAcrossAllDays(query, 'all');
      } else {
        result = await searchAcrossAllDays(query, dayParam);
      }
          serverCache.set('search', cacheKey, result);
      return res.status(result.success ? 200 : 400).json({ ...result, cached: false });
    }

    if (action === 'days') {
      return res.status(200).json({
        success: true,
        days: [
          { id: 0, name: 'Monday' },
          { id: 1, name: 'Tuesday' },
          { id: 2, name: 'Wednesday' },
          { id: 3, name: 'Thursday' },
          { id: 4, name: 'Friday' }
        ]
      });
    }

    // Default response with API documentation
    res.status(200).json({
      success: true,
      api: 'Timetable Schedule API',
      endpoints: {
        'GET /api/schedule?action=fetch&day=<0-4>|today|all': 'Fetch schedule for a specific day or full week',
        'GET /api/schedule?action=search&query=<classCode>&day=<0-4|today|all>': 'Search for classes (optionally constrained to a day)',
        'GET /api/schedule?action=days': 'Get list of available days'
      },
      example: {
        search: '/api/schedule?action=search&query=BCS-1G&day=2',
        fetch: '/api/schedule?action=fetch&day=0',
        fetchWeek: '/api/schedule?action=fetch&day=all'
      }
    });
  } catch (error) {
    console.error('[API] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}


