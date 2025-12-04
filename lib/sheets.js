/**
 * Sheets parsing and fetch utilities (my notes)
 *
 * I wrote this module to fetch GViz JSON from Google Sheets and convert it
 * into a simple timetable structure used by the frontend. The parser trusts
 * explicit GViz metadata (like colspan) and avoids guessing to prevent
 * phantom entries. Keep logic here focused on parsing and minimal cleanup.
 *
 * Quick notes:
 * - Uses GViz JSON (docs.google.com) via HTTPS GET
 * - Reads header row for time slots and remaining rows for classroom data
 * - Expands cells only when explicit `colspan` metadata is present
 */

const https = require('https');

// Configuration for Google Sheets
// All sensitive data is loaded from .env.local
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

// Allow overriding DAY_GIDS via environment variable (JSON string)
// Example: SHEET_DAY_GIDS='{"Monday":"0","Tuesday":"123456789","Wednesday":"987654321"}'
try {
  const envGids = process.env.SHEET_DAY_GIDS;
  if (envGids) {
    const parsed = JSON.parse(envGids);
    SHEET_CONFIG.DAY_GIDS = Object.assign({}, SHEET_CONFIG.DAY_GIDS, parsed);
    console.log('[sheets] Using DAY_GIDS from SHEET_DAY_GIDS env var:', SHEET_CONFIG.DAY_GIDS);
  }
} catch (e) {
  console.warn('[sheets] Failed to parse SHEET_DAY_GIDS, using defaults:', e.message);
}

/**
 * Fetch raw data from Google Sheets via GViz API
 * @param {string} gid - Sheet GID (tab ID)
 * @returns {Promise<Object>} Parsed JSON from Google Sheets
 */
function fetchGVizData(gid) {
  return new Promise((resolve, reject) => {
    // Construct GViz API URL
    const url = `${SHEET_CONFIG.BASE_URL}/${SHEET_CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`;
    
    https.get(url, { timeout: SHEET_CONFIG.TIMEOUT }, (response) => {
      let buffer = '';
      
      response.on('data', (chunk) => {
        buffer += chunk;
      });
      
      response.on('end', () => {
        try {
          // GViz wraps response like: /*O_o*/google.visualization.Query.setResponse({...});
          // Remove wrapper to extract pure JSON
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

/**
 * Extract classroom and schedule information from raw GViz data
 * @param {Object} gvizData - Raw data from GViz API
 * @returns {Object} Structured classroom data
 */
function parseClassroomData(gvizData) {
  if (!gvizData.table || !gvizData.table.rows || gvizData.table.rows.length < 3) {
    return { classrooms: [], timeSlots: [] };
  }

  const rows = gvizData.table.rows;
  const classrooms = [];
  const timeSlots = [];

  // Row 0 contains slot numbers (1, 2, 3, ...) - skip
  // Row 1 contains "Venues/time" and actual times like "08:00-8:50"
  // Rows 2+ contain classroom data

  if (rows.length > 1 && rows[1].c) {
    rows[1].c.forEach((cell, idx) => {
      if (idx > 0 && cell && (cell.v !== null && cell.v !== undefined)) {
        const raw = String(cell.v).trim();
        if (!raw) return;

        // The value should be a time range like "08:00-8:50"
        timeSlots.push({
          index: idx,
          time: raw,
          label: raw
        });
      }
    });
  }

  // Extract classrooms and their schedules (starting from row 2)
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row.c || row.c.length === 0) continue;

    const classroomName = row.c[0]?.v;
    if (!classroomName) continue;

    const classroom = {
      name: String(classroomName).trim(),
      schedule: [],
      classes: new Set()
    };

    // Extract schedule for each time slot column (starting at column 1)
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
      } catch (e) {      span = 1;
      }

      // If no explicit colspan metadata is provided, we apply a conservative fallback
      // only for lab classes: some sheets don't include colspan info and instead
      // leave the following columns empty. For lab cells we look ahead across a few
      // columns and expand the span across subsequent empty time columns. This
      // reduces phantom entries while restoring merged lab durations.
      if (span === 1 && classInfo && /\blab\b/i.test(classInfo)) {
        // look ahead up to next N slots (configurable via env var LAB_LOOKAHEAD)
        const MAX_LOOKAHEAD = (process.env.LAB_LOOKAHEAD && Number(process.env.LAB_LOOKAHEAD)) ? Number(process.env.LAB_LOOKAHEAD) : 5;
        let extra = 0;
        for (let la = 1; la <= MAX_LOOKAHEAD; la++) {
          const nextCol = j + la;
          if (nextCol >= row.c.length) break;
          const nextCell = row.c[nextCol];
          const nextVal = nextCell && (nextCell.v !== null && nextCell.v !== undefined) ? String(nextCell.v).trim() : '';
          // If the next cell is empty, assume it's part of the merged lab
          if (!nextVal) {
            extra++;
            continue;
          }
          break;
        }
        span = 1 + extra;
      }

      // Always add entries for the cell across its span
      for (let s = 0; s < span; s++) {
        const colIndex = j + s;
        // skip columns beyond defined timeSlots
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

      if (span > 1) j += (span - 1);
    }

    classroom.classes = Array.from(classroom.classes).sort();
    classrooms.push(classroom);
  }

  return { classrooms, timeSlots };
}

/**
 * Extract class code from a class string
 * E.g., "BCS-1G Database Systems" -> "BCS-1G"
 * E.g., "FE Lab BCS-1G Qurat ul Ain" -> "BCS-1G"
 * @param {string} classString - Full class description
 * @returns {string} Class code or empty string
 */
function extractClassCode(classString) {
  if (!classString) return '';
  // Look for pattern: 2-4 uppercase letters, hyphen, 1-2 digits, optional letter
  // Can appear anywhere in the string
  const match = classString.match(/\b([A-Z]{2,4}-\d{1,2}[A-Z]?)\b/);
  return match ? match[1] : '';
}

/**
 * Search for classes across all classrooms
 * @param {Array} classrooms - List of classrooms with schedules
 * @param {string} query - Search query (class code, room name, or class title)
 * @returns {Array} Matching classes with their details
 */
function searchClasses(classrooms, query) {
  if (!query || query.trim().length === 0) {
    return [];
  }
  
  const searchTerm = query.toLowerCase().trim();
  const resultsMap = {}; // key: classroom-classtext, value: array of slots
  
  // First pass: collect all matching slots grouped by classroom and class text
  classrooms.forEach(classroom => {
    classroom.schedule.forEach((slot, slotIndex) => {
      // Search in class code and class title
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
    // Sort by class code first, then by time
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    return a.time.localeCompare(b.time);
  });
}

/**
 * Get all unique classes across all classrooms
 * @param {Array} classrooms - List of classrooms
 * @returns {Array} Sorted array of unique class codes
 */
function getAllClasses(classrooms) {
  const classes = new Set();
  
  classrooms.forEach(classroom => {
    classroom.schedule.forEach(slot => {
      if (slot.code) {
        classes.add(slot.code);
      }
    });
  });
  
  return Array.from(classes).sort();
}

/**
 * Main function to fetch and parse complete day schedule
 * @param {number|string} dayId - Day ID (0=Monday, 1=Tuesday, etc.)
 * @returns {Promise<Object>} Complete schedule data for the day
 */
async function getDaySchedule(dayId) {
  try {
    // Validate day ID
    const day = parseInt(dayId);
    if (isNaN(day) || day < 0 || day > 4) {
      throw new Error(`Invalid day ID: ${dayId}. Must be 0-4 (Monday-Friday)`);
    }
    
    const dayName = SHEET_CONFIG.DAYS[day];
    const gid = SHEET_CONFIG.DAY_GIDS[dayName] || '0';
    
    console.log(`[getDaySchedule] Fetching ${dayName} (day=${day}, gid=${gid})`);
    
    // Fetch data from Google Sheets
    const gvizData = await fetchGVizData(gid);
    
    // Parse the data
    const { classrooms, timeSlots } = parseClassroomData(gvizData);

    // Compile results
    const allClasses = getAllClasses(classrooms);

    // Normalize time headers and provide both detailed and simple classroom lists
    const timeHeaders = timeSlots.sort((a, b) => a.index - b.index).map(ts => ts.time);

    const normalizedClassrooms = classrooms.map(room => {
      const sched = new Array(timeHeaders.length).fill('');
      room.schedule.forEach(s => {
        const pos = (typeof s.timeIndex === 'number') ? s.timeIndex - 1 : -1;
        if (pos >= 0 && pos < sched.length) sched[pos] = s.class || '';
      });
      return { name: room.name, schedule: sched };
    });

    return {
      success: true,
      day: dayName,
      dayId: day,
      gid: gid,
      timestamp: new Date().toISOString(),
      data: {
        // keep `classrooms` as the detailed slot objects for backward compatibility
        classrooms: classrooms,
        // simple representation aligned with `timeHeaders` for components that need it
        classroomsSimple: normalizedClassrooms,
        timeSlots: timeSlots,
        timeHeaders: timeHeaders,
        fetchedAt: new Date().toISOString(),
        allClasses: allClasses,
        totalClassrooms: classrooms.length,
        totalClasses: allClasses.length
      }
    };
  } catch (error) {
    console.error('[getDaySchedule] Error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Search classes across all days
 * @param {string} query - Search query
 * @returns {Promise<Object>} Search results
 */
/**
 * Search classes across days. If `day` is provided (0-4) search only that day.
 * If `day === 'all'` or omitted, search across the whole week.
 * Returns an object with results grouped by day name.
 */
async function searchAcrossAllDays(query, day = null) {
  try {
    const allResults = {};

    // Helper to run search on a single day
    const runSearchForDay = async (d) => {
      const result = await getDaySchedule(d);
      if (result.success) {
        const dayName = result.day;
        const sourceClassrooms = result.data.classroomsDetailed || result.data.classrooms || [];
        const classes = searchClasses(sourceClassrooms, query);
        // Attach numeric day (0-4) to each class item so frontend can rely on it
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
      if (!isNaN(dNum) && dNum >= 0 && dNum <= 4) {
        await runSearchForDay(dNum);
      } else {
        throw new Error('Invalid day parameter for search - must be 0-4 or "all"');
      }
    }

    return {
      success: true,
      query: query,
      results: allResults,
      totalMatches: Object.values(allResults).reduce((sum, arr) => sum + arr.length, 0),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('[searchAcrossAllDays] Error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
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