"use strict";
// Secure endpoint to clear the server-side in-memory cache.
// Intended to be called by a Google Apps Script webhook when the sheet updates.

const serverCache = require('../../lib/serverCache');

export default function handler(req, res) {
  // Only allow POST for safety
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  const secret = process.env.CLEAR_CACHE_SECRET || null;
  const provided = req.headers['x-tt-secret'] || req.headers['x-tt-secret'.toLowerCase()];

  if (secret) {
    if (!provided || provided !== secret) {
      console.warn('[clear-cache] Unauthorized attempt to clear cache');
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
  } else {
    console.warn('[clear-cache] CLEAR_CACHE_SECRET not set — allowing clear-cache without secret');
  }

  try {
    serverCache.clearAll();
    console.log('[clear-cache] Cleared server cache via API');
    return res.status(200).json({ success: true, message: 'Cache cleared' });
  } catch (err) {
    console.error('[clear-cache] Error clearing cache', err);
    return res.status(500).json({ success: false, error: 'Failed to clear cache' });
  }
}
