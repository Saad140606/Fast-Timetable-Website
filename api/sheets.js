/**
 * API-side sheets helper (my notes)
 *
 * This file provides the API-facing wrappers for fetching and parsing
 * Google Sheets GViz JSON. I keep a thin API layer here that mirrors the
 * parsing logic in `lib/sheets.js` so frontend endpoints get consistent
 * results. Use `.env.local` to configure the `SHEET_ID` and `SHEET_DAY_GIDS`.
 */

const https = require('https');

// Configuration for Google Sheets
const SHEET_CONFIG = {
  SHEET_ID: process.env.SHEET_ID,
  BASE_URL: 'https://docs.google.com/spreadsheets/d',
  TIMEOUT: 15000,

  // Map day IDs to day names (GID = 0 is the default first sheet)
  DAYS: {
    0: 'Monday',
    1: 'Tuesday',
    2: 'Wednesday',
    3: 'Thursday',
    4: 'Friday'
  },

  // GID values for each day sheet - loaded from SHEET_DAY_GIDS env var (JSON string)
  // Format: {"Monday":"GIDVALUE","Tuesday":"GIDVALUE",...}
  DAY_GIDS: {
    'Monday': '0',
    'Tuesday': '0',
    'Wednesday': '0',
    'Thursday': '0',
    'Friday': '0'
  }
};

try {
  const envGids = process.env.SHEET_DAY_GIDS || process.env.SHEET_DAY_GIDS;
  if (envGids) {
    const parsed = JSON.parse(envGids);
    SHEET_CONFIG.DAY_GIDS = Object.assign({}, SHEET_CONFIG.DAY_GIDS, parsed);
    console.log('[api/sheets] Using DAY_GIDS from SHEET_DAY_GIDS env var:', SHEET_CONFIG.DAY_GIDS);
  }
} catch (e) {
  console.warn('[api/sheets] Failed to parse SHEET_DAY_GIDS, using defaults:', e.message);
}

function fetchGVizData(gid) {
  return new Promise((resolve, reject) => {
    const url = `${SHEET_CONFIG.BASE_URL}/${SHEET_CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`;

    https.get(url, { timeout: SHEET_CONFIG.TIMEOUT }, (response) => {
      let buffer = '';

      response.on('data', (chunk) => {
        buffer += chunk;
      });

      response.on('end', () => {
        try {
          const jsonStart = buffer.indexOf('{');
          const jsonEnd = buffer.lastIndexOf('}') + 1;

          if (jsonStart === -1 || jsonEnd <= jsonStart) {
            reject(new Error('Invalid GViz response format - could not find JSON'));
            return;
          }

          const jsonString = buffer.substring(jsonStart, jsonEnd);
          const parsed = JSON.parse(jsonString);
          resolve(parsed);
        } catch (error) {
          reject(new Error(`Failed to parse GViz response: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      reject(new Error(`Network error fetching from Google Sheets: ${error.message}`));
    });
  });
}

function parseClassroomData(gvizData) {
  if (!gvizData.table || !gvizData.table.rows || gvizData.table.rows.length < 3) {
    return { classrooms: [], timeSlots: [] };
  }

  const rows = gvizData.table.rows;
  const classrooms = [];
  const timeSlots = [];

  // Row 0 contains slot numbers (skip)
  // Row 1 contains times like "08:00-08:50"
  if (rows.length > 1 && rows[1].c) {
    rows[1].c.forEach((cell, idx) => {
      if (idx > 0 && cell && (cell.v !== null && cell.v !== undefined)) {
        const raw = String(cell.v).trim();
        if (!raw) return;

        timeSlots.push({ index: idx, time: raw, label: raw });
      }
    });
  }

  // Extract classrooms starting from row 2
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row.c || row.c.length === 0) continue;

    const classroomName = row.c[0]?.v;
    if (!classroomName) continue;


    const classroom = { name: String(classroomName).trim(), schedule: [], classes: new Set() };

    // iterate columns and support merged cells (colSpan)
    for (let j = 1; j < row.c.length; j++) {
      const cell = row.c[j];
      const classInfo = cell && (cell.v !== null && cell.v !== undefined) ? String(cell.v).trim() : '';

      // detect colspan metadata if provided by GViz (common keys: colSpan, colspan)
      let span = 1;
      try {
        if (cell && cell.p) {
          span = cell.p.colSpan || cell.p.colspan || cell.p.span || 1;
          span = Number(span) || 1;
        }
      } catch (e) {
        span = 1;
      }

      // Note: We no longer use fallback heuristic. Google Sheets provides explicit colspan if cells are merged.

      // Fill schedule entries for this cell across its span
      for (let s = 0; s < span; s++) {
        const colIndex = j + s;
        const slotInfo = timeSlots.find(ts => ts.index === colIndex);
        if (!slotInfo) continue;
        const timeLabel = slotInfo.time;
        classroom.schedule.push({
          timeIndex: colIndex,
          time: timeLabel,
          class: classInfo,
          code: extractClassCode(classInfo)
        });

        const ccode = extractClassCode(classInfo);
        if (ccode) classroom.classes.add(ccode);
      }

      // advance j over spanned columns
      if (span > 1) j += (span - 1);
    }

    classroom.classes = Array.from(classroom.classes).sort();
    classrooms.push(classroom);
  }

  return { classrooms, timeSlots };
}

function extractClassCode(classString) {
  if (!classString) return '';
  const match = classString.match(/\b([A-Z]{2,4}-\d{1,2}[A-Z]?)\b/);
  return match ? match[1] : '';
}

function searchClasses(classrooms, query) {
  if (!query || query.trim().length === 0) return [];

  const searchTerm = query.toLowerCase().trim();
  const resultsMap = {}; // key: classroom-classtext, value: array of slots
  
  // First pass: collect all matching slots grouped by classroom and class text
  classrooms.forEach(classroom => {
    classroom.schedule.forEach((slot, slotIndex) => {
      if (slot.class.toLowerCase().includes(searchTerm) ||
          slot.code.toLowerCase().includes(searchTerm) ||
          classroom.name.toLowerCase().includes(searchTerm)) {
        
        const key = `${classroom.name}|${slot.class}`;
        if (!resultsMap[key]) {
          resultsMap[key] = [];
        }
        resultsMap[key].push({ ...slot });
      }
    });
  });
  
  // Second pass: merge adjacent slots ONLY for lab classes, keep non-lab classes separate
  const results = [];
  Object.entries(resultsMap).forEach(([key, slots]) => {
    const [classroomName, classText] = key.split('|');
    
    // Check if this is a lab class (contains "lab" in the text)
    const isLab = classText.toLowerCase().includes('lab');
    
    // Sort slots by timeIndex to ensure they're in chronological order
    slots.sort((a, b) => (a.timeIndex || 0) - (b.timeIndex || 0));
    
    if (!isLab) {
      // For non-lab classes: create a separate result for each slot
      slots.forEach(slot => {
        results.push({
          classroom: classroomName,
          class: classText,
          code: slot.code,
          time: slot.time,
          description: `${slot.code} @ ${classroomName} at ${slot.time}`
        });
      });
    } else {
      // For lab classes: merge adjacent slots
      let i = 0;
      while (i < slots.length) {
        const startSlot = slots[i];
        let endSlot = startSlot;
        let j = i + 1;
        
        // Find all consecutive slots with same class text
        // Check if the next slot's column is immediately after the current slot's column
        while (j < slots.length && slots[j] && endSlot && 
               (slots[j].timeIndex || 0) === ((endSlot.timeIndex || 0) + 1)) {
          endSlot = slots[j];
          j++;
        }
        
        // Create merged result
        const startTime = startSlot.time;
        const endTime = endSlot.time;
        
        // If multiple consecutive slots, format as time range
        let mergedTime;
        if (startSlot === endSlot) {
          mergedTime = startTime;
        } else {
          // Extract start of startTime and end of endTime
          const startPart = startTime.split('-')[0].trim();
          const endPart = endTime.split('-')[1].trim();
          mergedTime = `${startPart}-${endPart}`;
        }
        
        results.push({
          classroom: classroomName,
          class: classText,
          code: startSlot.code,
          time: mergedTime,
          description: `${startSlot.code} @ ${classroomName} at ${mergedTime}`
        });
        
        i = j;
      }
    }
  });

  return results.sort((a, b) => {
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    return a.time.localeCompare(b.time);
  });
}

function getAllClasses(classrooms) {
  const classes = new Set();

  classrooms.forEach(classroom => {
    classroom.schedule.forEach(slot => {
      if (slot.code) classes.add(slot.code);
    });
  });

  return Array.from(classes).sort();
}

async function getDaySchedule(dayId) {
  try {
    const day = parseInt(dayId);
    if (isNaN(day) || day < 0 || day > 4) throw new Error(`Invalid day ID: ${dayId}. Must be 0-4 (Monday-Friday)`);

    const dayName = SHEET_CONFIG.DAYS[day];
    const gid = SHEET_CONFIG.DAY_GIDS[dayName] || '0';
    console.log(`[getDaySchedule] Fetching ${dayName} (day=${day}, gid=${gid})`);

    const gvizData = await fetchGVizData(gid);
    const { classrooms, timeSlots } = parseClassroomData(gvizData);
    const allClasses = getAllClasses(classrooms);

    // Normalize time headers (array of strings) and classroom schedules to
    // match frontend expectations (each classroom.schedule is an array of
    // slot strings, aligned with timeHeaders)
    const timeHeaders = timeSlots
      .sort((a, b) => a.index - b.index)
      .map(ts => ts.time);

    const normalizedClassrooms = classrooms.map(room => {
      // create an array of empty strings sized to timeHeaders
      const sched = new Array(timeHeaders.length).fill('');
      room.schedule.forEach(s => {
        const pos = (typeof s.timeIndex === 'number') ? s.timeIndex - 1 : -1;
        if (pos >= 0 && pos < sched.length) sched[pos] = s.class || '';
      });
      return {
        name: room.name,
        schedule: sched
      };
    });

    return {
      success: true,
      day: dayName,
      dayId: day,
      gid: gid,
      timestamp: new Date().toISOString(),
      data: {
        // `classroomsDetailed` keeps the full slot objects (timeIndex/time/class/code)
        classroomsDetailed: classrooms,
        // `classrooms` kept for simple UIs: array of { name, schedule: [string,...] }
        classrooms: normalizedClassrooms,
        timeSlots: timeSlots,
        timeHeaders: timeHeaders,
        fetchedAt: new Date().toISOString(),
        allClasses: allClasses,
        totalClassrooms: normalizedClassrooms.length,
        totalClasses: allClasses.length
      }
    };
  } catch (error) {
    console.error('[getDaySchedule] Error:', error.message);
    return { success: false, error: error.message, timestamp: new Date().toISOString() };
  }
}

async function searchAcrossAllDays(query, day = null) {
  try {
    const allResults = {};

    const runSearchForDay = async (d) => {
      const result = await getDaySchedule(d);
      if (result.success) {
        const dayName = result.day;
        // Prefer detailed classrooms (objects with timeIndex/time/class)
        const sourceClassrooms = result.data.classroomsDetailed || result.data.classrooms || [];
        const classes = searchClasses(sourceClassrooms, query);
        const classesWithDay = classes.map(ci => Object.assign({}, ci, { dayNum: d }));
        if (classesWithDay.length > 0) allResults[dayName] = classesWithDay;
      }
    };

    if (day === 'all' || day === null) {
      const promises = [];
      for (let d = 0; d < 5; d++) promises.push(runSearchForDay(d));
      await Promise.all(promises);
    } else {
      const dNum = parseInt(day);
      if (!isNaN(dNum) && dNum >= 0 && dNum <= 4) await runSearchForDay(dNum);
      else throw new Error('Invalid day parameter for search - must be 0-4 or "all"');
    }

    return { success: true, query: query, results: allResults, totalMatches: Object.values(allResults).reduce((sum, arr) => sum + arr.length, 0), timestamp: new Date().toISOString() };
  } catch (error) {
    console.error('[searchAcrossAllDays] Error:', error.message);
    return { success: false, error: error.message, timestamp: new Date().toISOString() };
  }
}

module.exports = {
  getDaySchedule,
  searchAcrossAllDays,
  searchClasses,
  getAllClasses,
  parseClassroomData,
  extractClassCode
};
