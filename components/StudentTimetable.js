/**
 * My StudentTimetable component
 * Author: Syed Saad Najam
 * Notes: This is my main timetable UI — it handles search, day filtering,
 * auto-refresh, and shows schedule / saved classes. I wrote the parsing
 * and UI glue here to keep the front-end simple and easy to explain.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import styles from './StudentTimetable.module.css';

export default function StudentTimetable() {
  // State management
  const computeDefaultDay = () => {
    const today = new Date().getDay(); // 0=Sun,1=Mon..6=Sat
    return (today === 0 || today === 6) ? 0 : today - 1;
  };
  const [selectedDay, setSelectedDay] = useState(computeDefaultDay());
  const [searchQuery, setSearchQuery] = useState('');
  const [scheduleData, setScheduleData] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('search');
  const [savedClasses, setSavedClasses] = useState([]);
  const [watchedClasses, setWatchedClasses] = useState([]); // classes to auto-sync
  const [filter, setFilter] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchFilterDay, setSearchFilterDay] = useState(null); // null = show all days from search
  const searchAbortRef = useRef(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState(null); // { start, end, dayName } when user clicks a free slot
  const [freeRooms, setFreeRooms] = useState([]);
  const [finderDay, setFinderDay] = useState(0); // for time-based finder
  const [finderStartTime, setFinderStartTime] = useState('08:00');
  const [finderEndTime, setFinderEndTime] = useState('08:50');
  const [finderResults, setFinderResults] = useState(null);
  
  // Schedule search state
  const [scheduleSearchDay, setScheduleSearchDay] = useState(null); // null = all days
  const [scheduleSearchRoom, setScheduleSearchRoom] = useState('');
  const [scheduleSearchClass, setScheduleSearchClass] = useState('');
  
  // Lab filter state
  const [labDay, setLabDay] = useState(0);
  const [labSearchQuery, setLabSearchQuery] = useState('');
  const [labTimeFilter, setLabTimeFilter] = useState(''); // specific time slot filter

  // Free class/lab finder state
  const [freeQuery, setFreeQuery] = useState(''); // class code or text to find free slots for
  const [freeDayFilter, setFreeDayFilter] = useState('all'); // 'all' or 0-4
  const [freeResults, setFreeResults] = useState(null);
  const [freeTimeSlot, setFreeTimeSlot] = useState('all'); // 'all' or specific slot text
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const timePickerRef = useRef(null);

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  // Cache for API responses to avoid duplicate requests
  const cacheRef = useRef({
    schedule: {},
    search: {},
    lastSearchQuery: ''
  });

  // Helper to parse time like "08:00-8:50" or "1:30-2:20" and return minutes for the start
  const parseTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 0;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours >= 1 && hours < 8) hours += 12; // likely PM
    return hours * 60 + minutes;
  };

  // Helper to extract start and end time strings from a slot time like "08:00-8:50"
  const parseStartEnd = (timeStr) => {
    if (!timeStr) return { start: null, end: null };
    const parts = String(timeStr).split('-').map(s => s.trim());
    return { start: parts[0] || null, end: parts[1] || null };
  };

  // Return list of available time slot strings from scheduleData
  const getAllTimeSlots = () => {
    if (!scheduleData) return [];
    // Prefer week first day slots
    if (scheduleData.week && Object.keys(scheduleData.week).length > 0) {
      for (const dn of Object.keys(scheduleData.week)) {
        const d = scheduleData.week[dn];
        const ts = d?.timeSlots || d?.data?.timeSlots || [];
        if (ts && ts.length > 0) return ts.map(s => s.time).filter(Boolean);
      }
    }
    // Fallback to single-day list
    if (scheduleData.timeSlots && scheduleData.timeSlots.length > 0) return scheduleData.timeSlots.map(s => s.time).filter(Boolean);
    return [];
  };

  // Merge consecutive slots that are free/lab into a single range
  const mergeAdjacentFreeSlots = (schedule) => {
    if (!schedule || schedule.length === 0) return [];
    // First sort by time index or parsed start time
    const sorted = schedule.slice().sort((a, b) => {
      if (a.timeIndex !== undefined && b.timeIndex !== undefined) return a.timeIndex - b.timeIndex;
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });

    const merged = [];
    let current = null;

    sorted.forEach((slot) => {
      const text = slot.class || '';
      const isFree = !text || /free/i.test(text);
      const isLab = /lab/i.test(text);
      const kind = isFree ? 'free' : (isLab ? 'lab' : 'class');
      const { start, end } = parseStartEnd(slot.time || '');

      if (!current) {
        current = {
          kind,
          start: start,
          end: end,
          label: kind === 'free' ? '— Free —' : (kind === 'lab' ? 'Lab' : slot.class),
          slots: [slot]
        };
        return;
      }

      // If same kind (free or lab) and contiguous (timeIndex consecutive), extend
      const lastSlot = current.slots[current.slots.length - 1];
      const lastIndex = lastSlot.timeIndex !== undefined ? lastSlot.timeIndex : null;
      const thisIndex = slot.timeIndex !== undefined ? slot.timeIndex : null;

      const isContiguous = (lastIndex !== null && thisIndex !== null) ? (thisIndex === lastIndex + 1) : (parseTimeToMinutes(parseStartEnd(slot.time).start) === parseTimeToMinutes(current.end));

      if (kind === current.kind && isContiguous) {
        // extend end if available
        if (end) current.end = end;
        current.slots.push(slot);
      } else {
        merged.push(current);
        current = {
          kind,
          start: start,
          end: end,
          label: kind === 'free' ? '— Free —' : (kind === 'lab' ? 'Lab' : slot.class),
          slots: [slot]
        };
      }
    });

    if (current) merged.push(current);
    return merged;
  };

  // Find all classrooms that are free during a given time range on a given day
  const findFreeRoomsForTimeRange = (dayName, startTime, endTime) => {
    if (!scheduleData) return [];
    
    let dayData = scheduleData.week?.[dayName];
    if (!dayData) return [];
    
    // Extract classrooms and timeSlots (handle nested .data structure)
    const classrooms = dayData.classrooms || dayData.data?.classrooms || [];
    const timeSlots = dayData.timeSlots || dayData.data?.timeSlots || [];
    
    if (!classrooms || classrooms.length === 0 || !timeSlots || timeSlots.length === 0) {
      return [];
    }

    const toMinutes = (t) => {
      if (!t) return null;
      const m = t.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      if (h >= 1 && h < 8) h += 12;
      return h * 60 + mm;
    };

    const startMin = toMinutes(startTime);
    const endMin = toMinutes(endTime);
    if (startMin === null || endMin === null) return [];

    const free = [];
    
    classrooms.forEach((classroom) => {
      if (!classroom.name) return;
      
      // Get all the time slots that overlap with the requested range
      const overlappingSlots = timeSlots.filter(slot => {
        if (!slot.time) return false;
        const slotMin = toMinutes(slot.time);
        return slotMin !== null && slotMin >= startMin && slotMin < endMin;
      });

      if (overlappingSlots.length === 0) return; // No slots in requested range

      // Check if classroom is free during ALL overlapping slots
      const isFree = overlappingSlots.every(slot => {
        const scheduleEntry = (classroom.schedule || []).find(s => s.timeIndex === slot.index);
        const classValue = (scheduleEntry?.class || '').trim();
        // Consider free if no class assignment or class is just dashes/empty
        return !classValue || /^-+$/.test(classValue);
      });

      if (isFree) {
        free.push({
          name: classroom.name,
          schedule: classroom.schedule,
          capacity: 50,
          floor: '1st Floor'
        });
      }
    });
    
    return free;
  };

  // Handler for finder search button
  const handleFinderSearch = () => {
    const dayName = days[finderDay];
    const results = findFreeRoomsForTimeRange(dayName, finderStartTime, finderEndTime);
    setFinderResults({ rooms: results, day: dayName, start: finderStartTime, end: finderEndTime });
  };

  // Find all classrooms that are free during a given time range on a given day

  // Merge overlapping/adjacent time ranges across classrooms
  const mergeTimeRanges = (ranges) => {
    // ranges: [{start: '08:00', end: '08:50'}]
    const toMinutes = (t) => {
      if (!t) return null;
      const m = t.match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      if (h >= 1 && h < 8) h += 12;
      return h * 60 + mm;
    };

    const normalized = ranges.map(r => {
      const s = toMinutes(r.start);
      const e = toMinutes(r.end);
      return (s !== null && e !== null) ? { s, e } : null;
    }).filter(Boolean);

    if (normalized.length === 0) return [];

    normalized.sort((a, b) => a.s - b.s);
    const out = [Object.assign({}, normalized[0])];
    for (let i = 1; i < normalized.length; i++) {
      const cur = normalized[i];
      const last = out[out.length - 1];
      if (cur.s <= last.e + 1) {
        last.e = Math.max(last.e, cur.e);
      } else {
        out.push(Object.assign({}, cur));
      }
    }

    // convert back to strings
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return out.map(r => {
      const sh = Math.floor(r.s / 60);
      const sm = r.s % 60;
      const eh = Math.floor(r.e / 60);
      const em = r.e % 60;
      return { start: `${pad(sh)}:${pad(sm)}`, end: `${pad(eh)}:${pad(em)}` };
    });
  };

  // --- Free class/lab finder helpers ---
  // Check if a given time slot (by index) is occupied by the queried class/text
  const isSlotOccupiedByQuery = (classrooms, slotIndex, query) => {
    if (!classrooms || !query) return false;
    const q = query.toLowerCase().trim();
    for (const room of classrooms) {
      if (!room || !room.schedule) continue;
      const s = room.schedule.find(it => it.timeIndex === slotIndex);
      if (!s) continue;
      const roomName = (room.name || '').toLowerCase();
      const text = (s.class || '').toLowerCase();
      const code = (s.code || '').toLowerCase();

      // If the query matches the classroom name (e.g. searching for 'E-31'),
      // consider the slot occupied only if that specific room has a class at that slot.
      if (roomName.includes(q)) {
        if (text && String(text).trim() !== '') return true;
        continue;
      }

      // Otherwise, check if the slot's class text or code matches the query
      if (text && (text.includes(q) || code === q || code.includes(q))) return true;
    }
    return false;
  };

  // Compute free time ranges for a class/lab across a day's data
  const computeFreeRangesForDay = (dayData, query) => {
    if (!dayData || !dayData.classrooms || !dayData.timeSlots) return [];
    const timeSlots = dayData.timeSlots.slice().sort((a, b) => a.index - b.index);
    const classrooms = dayData.classrooms;

    const freeFlags = timeSlots.map(ts => {
      const occupied = isSlotOccupiedByQuery(classrooms, ts.index, query);
      return { index: ts.index, time: ts.time, free: !occupied };
    });

    // Merge contiguous free flags into ranges
    const ranges = [];
    let current = null;
    freeFlags.forEach(f => {
      if (f.free) {
        if (!current) {
          current = { startIndex: f.index, endIndex: f.index, startTime: f.time, endTime: f.time };
        } else {
          // extend
          current.endIndex = f.index;
          current.endTime = f.time;
        }
      } else {
        if (current) {
          ranges.push(current);
          current = null;
        }
      }
    });
    if (current) ranges.push(current);

    // Convert ranges to human-friendly start-end and collect available rooms
    return ranges.map(r => {
      const startPart = (r.startTime || '').split('-')[0].trim();
      const endPart = (r.endTime || '').split('-')[1] ? r.endTime.split('-')[1].trim() : (r.endTime || '');
      const end = endPart || r.endTime;
      
      // Collect available rooms for these free slots. Use the same access pattern
      // as `isSlotOccupiedByQuery` (schedule is an array of { timeIndex, class, code })
      const availableRooms = [];
      for (let slotIdx = r.startIndex; slotIdx <= r.endIndex; slotIdx++) {
          classrooms.forEach(room => {
            // Skip header or placeholder rows coming from sheet exports
            if (!room || !room.name) return;
            const rn = String(room.name).trim();
            if (isPlaceholderName(rn)) return;
          const schedule = room.schedule || [];
          // Try to find a schedule entry by timeIndex
          const s = Array.isArray(schedule) ? schedule.find(it => Number(it?.timeIndex) === Number(slotIdx)) : null;
          const isOccupied = !!(s && s.class && String(s.class).trim() !== '');
          if (!isOccupied) {
            if (!availableRooms.find(ar => ar.name === room.name)) {
              availableRooms.push({
                name: room.name || 'Unknown',
                capacity: room.capacity || room.capacity === 0 ? room.capacity : '?',
                block: room.block || extractBlockFromName(room.name),
                floor: room.floor || '?'
              });
            }
          }
        });
      }
      
      return { 
        start: startPart, 
        end: end,
        availableRooms: availableRooms.slice(0, 5) // Show first 5 available rooms
      };
    });
  };

  // Compute free ranges for a specific room name and also collect other rooms
  // that are free during the same ranges. Returns ranges with availableRoomsNearby.
  const computeFreeRangesForRoom = (dayData, roomQuery) => {
    if (!dayData || !dayData.classrooms || !dayData.timeSlots) return [];
    const timeSlots = dayData.timeSlots.slice().sort((a, b) => a.index - b.index);
    const classrooms = dayData.classrooms;

    // Find the target room object (by name includes query)
    const q = String(roomQuery).toLowerCase().trim();
    // Prefer exact id-match when user typed a room-like id (E-1, R109)
    const roomIdPattern = /^[A-Za-z]{1,3}-?\d{1,4}$/;
    let targetRoom = null;
    if (roomIdPattern.test(roomQuery.trim())) {
      const wanted = roomQuery.trim().toLowerCase();
      targetRoom = classrooms.find(r => {
        if (!r || !r.name) return false;
        const idMatch = String(r.name).match(/[A-Za-z]{1,3}-?\d{1,4}/i);
        return idMatch && idMatch[0].toLowerCase() === wanted;
      });
    } else {
      targetRoom = classrooms.find(r => (r.name || '').toLowerCase().includes(q));
    }
    if (!targetRoom) return [];

    // Build free flags for the target room specifically
    const freeFlags = timeSlots.map(ts => {
      const sched = targetRoom.schedule || [];
      const s = Array.isArray(sched) ? sched.find(it => Number(it?.timeIndex) === Number(ts.index)) : null;
      const occupied = !!(s && s.class && String(s.class).trim() !== '');
      return { index: ts.index, time: ts.time, free: !occupied };
    });

    // Merge contiguous free flags into ranges
    const ranges = [];
    let current = null;
    freeFlags.forEach(f => {
      if (f.free) {
        if (!current) {
          current = { startIndex: f.index, endIndex: f.index, startTime: f.time, endTime: f.time };
        } else {
          current.endIndex = f.index;
          current.endTime = f.time;
        }
      } else {
        if (current) { ranges.push(current); current = null; }
      }
    });
    if (current) ranges.push(current);

    // For each range, collect other free rooms at those slots
    return ranges.map(r => {
      const startPart = (r.startTime || '').split('-')[0].trim();
      const endPart = (r.endTime || '').split('-')[1] ? r.endTime.split('-')[1].trim() : (r.endTime || '');
      const end = endPart || r.endTime;

      const otherRooms = [];
      for (let slotIdx = r.startIndex; slotIdx <= r.endIndex; slotIdx++) {
        classrooms.forEach(room => {
          if (!room || !room.name) return;
          const rn = String(room.name).trim();
          if (isPlaceholderName(rn)) return;
          const schedule = room.schedule || [];
          const s = Array.isArray(schedule) ? schedule.find(it => Number(it?.timeIndex) === Number(slotIdx)) : null;
          const isOccupied = !!(s && s.class && String(s.class).trim() !== '');
          if (!isOccupied && room.name !== targetRoom.name) {
            if (!otherRooms.find(rr => rr.name === room.name)) {
              otherRooms.push({ name: room.name, capacity: room.capacity || '?', block: room.block || extractBlockFromName(room.name), floor: room.floor || '?' });
            }
          }
        });
      }

      // Show only the target room as the available room for clarity when in room-mode
      const targetInfo = { name: targetRoom.name, capacity: targetRoom.capacity || '?', block: targetRoom.block || extractBlockFromName(targetRoom.name), floor: targetRoom.floor || '?' };
      return { start: startPart, end: end, availableRooms: [targetInfo], targetRoom: targetInfo };
    });
  };

  // Helper to extract block from room name
  const extractBlockFromName = (name) => {
    if (!name) return '?';
    const match = name.match(/Academic Block ([IVX]+|[0-9]+)/i);
    return match ? match[1] : '?';
  };

  // Detect placeholder/header names exported from sheets (e.g. "CLASSROOMS", "ROOMS", "CLASS LIST")
  const isPlaceholderName = (name) => {
    if (!name) return true;
    const rn = String(name).trim().replace(/\s+/g, ' ');
    // Common header words
    if (/^(classrooms?|rooms?|class list|room list|laboratories|labs?)\b/i.test(rn)) return true;
    // If name contains no digits and is long and mostly uppercase, likely a header
    if (!/\d/.test(rn) && rn.length > 4 && rn === rn.toUpperCase()) return true;
    return false;
  };

  // Compute free schedule across week or single day
  const findFreeScheduleForQuery = (query, dayFilter = 'all') => {
    if (!scheduleData || !query || query.trim() === '') return {};
    const out = {};
    const qLower = query.toLowerCase().trim();
    // Detect if query matches any classroom name (room search mode).
    // Prefer strict room-id patterns like 'E-31', 'R109', 'A2' to avoid class-code collisions.
    let roomMode = false;
    const roomIdPattern = /^[A-Za-z]{1,3}-?\d{1,4}$/; // e.g. E-31, R109, A2
    if (roomIdPattern.test(query.trim())) {
      roomMode = true;
    } else {
      if (scheduleData.week) {
        for (const d of Object.values(scheduleData.week)) {
          const cls = d.classrooms || [];
          for (const r of cls) {
            if (r && r.name && String(r.name).toLowerCase().includes(qLower)) { roomMode = true; break; }
          }
          if (roomMode) break;
        }
      } else if (scheduleData.classrooms) {
        for (const r of scheduleData.classrooms) {
          if (r && r.name && String(r.name).toLowerCase().includes(qLower)) { roomMode = true; break; }
        }
      }
    }
    
    // Prioritize week data (which should exist from 'all' fetch)
    if (scheduleData.week && Object.keys(scheduleData.week).length > 0) {
      Object.entries(scheduleData.week).forEach(([dayName, dayData]) => {
        const dayNum = days.indexOf(dayName);
        if (dayFilter !== 'all' && String(dayFilter) !== String(dayNum)) return;
        
        // Ensure dayData has the right structure
        const structured = {
          classrooms: dayData.classrooms || dayData.data?.classrooms || [],
          timeSlots: dayData.timeSlots || dayData.data?.timeSlots || []
        };
        
        const ranges = roomMode ? computeFreeRangesForRoom(structured, query) : computeFreeRangesForDay(structured, query);
        if (ranges.length > 0) out[dayName] = ranges;
      });
    } else if (scheduleData.classrooms && scheduleData.timeSlots) {
      // Single day structure
      const dayName = scheduleData.day || days[selectedDay];
      if (dayFilter === 'all' || String(dayFilter) === String(selectedDay)) {
        const ranges = roomMode ? computeFreeRangesForRoom({
          classrooms: scheduleData.classrooms,
          timeSlots: scheduleData.timeSlots
        }, query) : computeFreeRangesForDay({
          classrooms: scheduleData.classrooms,
          timeSlots: scheduleData.timeSlots
        }, query);
        if (ranges.length > 0) out[dayName] = ranges;
      }
    }
    
    return out;
  };

  // Get all lab classes from the current schedule
  const getAllLabClasses = () => {
    if (!scheduleData) return [];
    const labs = [];
    
    if (scheduleData.week) {
      // All days view
      Object.entries(scheduleData.week).forEach(([dayName, schedule]) => {
        if (Array.isArray(schedule)) {
          schedule.forEach(slot => {
            if (slot.class && /lab/i.test(slot.class)) {
              labs.push({
                id: `${dayName}::${slot.time}::${slot.class}`,
                day: dayName,
                class: slot.class,
                time: slot.time,
                classroom: slot.classroom || 'TBD',
                dayNum: days.indexOf(dayName),
                capacity: slot.capacity || 50,
                floor: slot.floor || '1st Floor'
              });
            }
          });
        }
      });
    } else if (scheduleData.schedule) {
      // Single day view
      const dayName = days[selectedDay];
      scheduleData.schedule.forEach(slot => {
        if (slot.class && /lab/i.test(slot.class)) {
          labs.push({
            id: `${dayName}::${slot.time}::${slot.class}`,
            day: dayName,
            class: slot.class,
            time: slot.time,
            classroom: slot.classroom || 'TBD',
            dayNum: selectedDay,
            capacity: slot.capacity || 50,
            floor: slot.floor || '1st Floor'
          });
        }
      });
    }
    
    return labs.sort((a, b) => {
      if (a.dayNum !== b.dayNum) return a.dayNum - b.dayNum;
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });
  };

  // Get all unique lab time slots for a specific day
  const getLabTimesForDay = (dayNum) => {
    const allLabs = getAllLabClasses();
    const times = new Set();
    allLabs
      .filter(lab => lab.dayNum === dayNum)
      .forEach(lab => times.add(lab.time));
    return Array.from(times).sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));
  };

  // Filter labs by day, search query, and time
  const getFilteredLabs = () => {
    let labs = getAllLabClasses();
    
    // Filter by day
    labs = labs.filter(lab => lab.dayNum === labDay);
    
    // Filter by search query
    if (labSearchQuery.trim()) {
      const query = labSearchQuery.toLowerCase();
      labs = labs.filter(lab => 
        lab.class.toLowerCase().includes(query) ||
        lab.classroom.toLowerCase().includes(query)
      );
    }
    
    // Filter by time slot
    if (labTimeFilter) {
      labs = labs.filter(lab => lab.time === labTimeFilter);
    }
    
    return labs;
  };

  // Search schedule by day/room/class
  const getScheduleSearchResults = () => {
    if (!scheduleData) return [];
    const results = [];
    
    if (scheduleData.week) {
      Object.entries(scheduleData.week).forEach(([dayName, schedule]) => {
        const dayNum = days.indexOf(dayName);
        if (scheduleSearchDay !== null && dayNum !== scheduleSearchDay) return;
        
        if (Array.isArray(schedule)) {
          schedule.forEach(slot => {
            const matchRoom = !scheduleSearchRoom || (slot.classroom || '').toLowerCase().includes(scheduleSearchRoom.toLowerCase());
            const matchClass = !scheduleSearchClass || (slot.class || '').toLowerCase().includes(scheduleSearchClass.toLowerCase());
            
            if (matchRoom && matchClass) {
              results.push({
                id: `${dayName}::${slot.time}::${slot.classroom}::${slot.class}`,
                day: dayName,
                class: slot.class,
                time: slot.time,
                classroom: slot.classroom || 'Free',
                dayNum: dayNum
              });
            }
          });
        }
      });
    } else if (scheduleData.schedule && (scheduleSearchDay === null || scheduleSearchDay === selectedDay)) {
      const dayName = days[selectedDay];
      scheduleData.schedule.forEach(slot => {
        const matchRoom = !scheduleSearchRoom || (slot.classroom || '').toLowerCase().includes(scheduleSearchRoom.toLowerCase());
        const matchClass = !scheduleSearchClass || (slot.class || '').toLowerCase().includes(scheduleSearchClass.toLowerCase());
        
        if (matchRoom && matchClass) {
          results.push({
            id: `${dayName}::${slot.time}::${slot.classroom}::${slot.class}`,
            day: dayName,
            class: slot.class,
            time: slot.time,
            classroom: slot.classroom || 'Free',
            dayNum: selectedDay
          });
        }
      });
    }
    
    return results.sort((a, b) => {
      if (a.dayNum !== b.dayNum) return a.dayNum - b.dayNum;
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });
  };

  // Fetch schedule for the selected day (with caching)
  const fetchDaySchedule = async (dayId) => {
    // Check cache first
    const cacheKey = String(dayId);
    if (cacheRef.current.schedule[cacheKey]) {
      const cached = cacheRef.current.schedule[cacheKey];
      if (dayId === 'all') {
        setScheduleData(prev => ({ ...prev, week: cached.data.week }));
      } else {
        setScheduleData(prev => {
          if (!prev) return cached.data;
          // Merge: keep existing week data, update single-day data
          return { ...prev, ...cached.data };
        });
      }
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (dayId === 'all') {
        const response = await fetch(`/api/schedule?action=fetch&day=all`);
        const data = await response.json();
        if (data.success) {
          cacheRef.current.schedule['all'] = { data: { week: data.week }, timestamp: Date.now() };
          setScheduleData(prev => ({ ...prev, week: data.week }));
        } else {
          setError(data.error || 'Failed to fetch week schedule');
        }
      } else {
        const response = await fetch(`/api/schedule?action=fetch&day=${dayId}`);
        const data = await response.json();
        if (data.success) {
          cacheRef.current.schedule[cacheKey] = { data: data.data, timestamp: Date.now() };
          setScheduleData(prev => {
            if (!prev) return data.data;
            // Merge: keep week data if it exists, update single-day data
            return { ...prev, ...data.data };
          });
        } else {
          setError(data.error || 'Failed to fetch schedule');
        }
      }
    } catch (err) {
      setError('Network error: ' + err.message);
      console.error('[StudentTimetable] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Search for classes - with caching and instant response
  const performSearch = async (query) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    // Check cache first
    if (cacheRef.current.lastSearchQuery === query && cacheRef.current.search[query]) {
      setSearchResults(cacheRef.current.search[query]);
      return;
    }

    // Cancel previous in-flight search request, if any
    try {
      if (searchAbortRef.current) {
        try { searchAbortRef.current.abort(); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // ignore
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      // Determine which day to initially filter to
      // If today is Saturday(6) or Sunday(0), default to Monday(0)
      let filterDay = selectedDay;
      const today = new Date().getDay();
      if (today === 0 || today === 6) {
        filterDay = 0; // Default to Monday for weekend
      }
      
      // Search ALL days so results can be filtered dynamically
      const response = await fetch(`/api/schedule?action=search&query=${encodeURIComponent(query)}&day=all`, { signal: controller.signal });
      const data = await response.json();

      // If this request was aborted, stop processing
      if (controller.signal.aborted) return;

      if (data.success) {
        cacheRef.current.search[query] = data;
        cacheRef.current.lastSearchQuery = query;
        setSearchResults(data);
        // Auto-filter to the selected day initially (but user can click "All" to see all days)
        setSearchFilterDay(filterDay);
      } else {
        setError(data.error || 'Search failed');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // Request was cancelled - do nothing
        return;
      }
      setError('Network error: ' + err.message);
      console.error('[StudentTimetable] Search error:', err);
    } finally {
      setLoading(false);
      // clear controller if it's still the current one
      if (searchAbortRef.current === controller) searchAbortRef.current = null;
    }
  };

  // Add a class to watchlist (auto-sync its schedule)
  const addToWatchlist = (classCode) => {
    if (!classCode || classCode.trim() === '') return;
    const code = classCode.trim().toUpperCase();
    if (!watchedClasses.includes(code)) {
      setWatchedClasses([...watchedClasses, code]);
    }
  };

  // Remove a class from watchlist
  const removeFromWatchlist = (classCode) => {
    setWatchedClasses(watchedClasses.filter(c => c !== classCode));
  };

  // Sync watched classes with current schedule data
  const syncWatchedClasses = () => {
    if (!scheduleData || watchedClasses.length === 0) return;
    const newSaved = [...savedClasses];
    
    watchedClasses.forEach(watchCode => {
      // Find all instances of this watched class in the schedule
      const instances = new Set();
      if (scheduleData.week) {
        Object.entries(scheduleData.week).forEach(([dayName, dayData]) => {
          const classrooms = dayData?.classrooms || dayData?.data?.classrooms || [];
          classrooms.forEach(room => {
            (room.schedule || []).forEach(s => {
              if (s && s.code && s.code.toUpperCase() === watchCode) {
                instances.add(JSON.stringify({
                  day: dayName,
                  time: s.time || '',
                  code: s.code,
                  className: s.class,
                  classroom: room.name
                }));
              }
            });
          });
        });
      }
      
      // Add instances if not already in saved
      instances.forEach(inst => {
        const parsed = JSON.parse(inst);
        if (!newSaved.find(s => s.code === parsed.code && s.day === parsed.day && s.time === parsed.time)) {
          newSaved.push(parsed);
        }
      });
    });
    
    setSavedClasses(newSaved);
  };

  // Handler to compute free schedule for a given class/lab query
  const handleFreeSearch = () => {
    if (!freeQuery || !freeQuery.trim()) {
      setFreeResults(null);
      return;
    }

    // Ensure we have schedule data; if not, request it
    if (!scheduleData || (!scheduleData.week && !scheduleData.classrooms)) {
      setError('Loading schedule data... Please try again in a moment.');
      return;
    }

    // Always search all days
    // If a specific time slot is selected, compute free rooms for that slot across days
    if (freeTimeSlot && freeTimeSlot !== 'all') {
      const { start, end } = parseStartEnd(freeTimeSlot);
      const timeResults = {};
      days.forEach(dayName => {
        const rooms = findFreeRoomsForTimeRange(dayName, start, end) || [];
        if (rooms.length > 0) {
          timeResults[dayName] = [{ start, end, availableRooms: rooms.map(r => ({ name: r.name, capacity: r.capacity || r.capacity === 0 ? r.capacity : '?', block: r.block || extractBlockFromName(r.name), floor: r.floor || '?' })) }];
        }
      });

      if (Object.keys(timeResults).length > 0) {
        setFreeResults(timeResults);
        // Auto-select today's day if it has results
        const today = new Date().getDay();
        const todayIndex = today === 0 || today === 6 ? 0 : today - 1;
        const todayDayName = days[todayIndex];
        let selIndex = todayIndex;
        if (!timeResults[todayDayName]) {
          selIndex = days.indexOf(Object.keys(timeResults)[0]);
        }
        setFreeDayFilter(selIndex.toString());
        setActiveTab('schedule');
        setSelectedDay(selIndex >= 0 ? selIndex : 0);
        return;
      }
      // fallthrough to normal search if no rooms at selected time
    }

    const results = findFreeScheduleForQuery(freeQuery, 'all');
    
    // Set the results and auto-switch to Schedule tab
    if (results && Object.keys(results).length > 0) {
      setFreeResults(results);
      
      // Prioritize today's day; if today has no results, pick the first available day
      const today = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      const todayIndex = today === 0 || today === 6 ? 0 : today - 1; // Convert to weekday index (0=Mon)
      const todayDayName = days[todayIndex];
      
      let selectedDayIndex = todayIndex;
      if (!results[todayDayName]) {
        // Today has no results, pick the first day with results
        const firstDay = Object.keys(results)[0];
        selectedDayIndex = days.indexOf(firstDay);
      }
      
      setFreeDayFilter(selectedDayIndex.toString()); // Select today or first available day
      setActiveTab('schedule');
      setSelectedDay(selectedDayIndex >= 0 ? selectedDayIndex : 0);
      return;
    }
    
    // If no free ranges found, check whether the query matches any scheduled slots
    const hasAnyMatches = (() => {
      if (!scheduleData) return false;
      let found = false;
      
      if (scheduleData.week && Object.keys(scheduleData.week).length > 0) {
        Object.values(scheduleData.week).forEach(dayData => {
          if (found) return;
          const timeSlots = dayData.timeSlots || [];
          const classrooms = dayData.classrooms || [];
          for (const ts of timeSlots) {
            if (isSlotOccupiedByQuery(classrooms, ts.index, freeQuery)) {
              found = true; break;
            }
          }
        });
      } else if (scheduleData.classrooms && scheduleData.timeSlots) {
        const timeSlots = scheduleData.timeSlots || [];
        const classrooms = scheduleData.classrooms || [];
        for (const ts of timeSlots) {
          if (isSlotOccupiedByQuery(classrooms, ts.index, freeQuery)) { found = true; break; }
        }
      }
      return found;
    })();

    if ((!results || Object.keys(results).length === 0) && !hasAnyMatches) {
      // provide suggestions: collect class codes and class texts that contain the query
      const suggestions = new Set();
      if (scheduleData && scheduleData.week) {
        Object.values(scheduleData.week).forEach(dayData => {
          const cls = dayData.classrooms || [];
          cls.forEach(room => {
            (room.schedule || []).forEach(s => {
              if (s && s.class) {
                const text = String(s.class).toLowerCase();
                const code = String(s.code || '').toLowerCase();
                if (text.includes(freeQuery.toLowerCase()) || code.includes(freeQuery.toLowerCase())) {
                  if (s.code) suggestions.add(s.code);
                  else suggestions.add(s.class.split('\n')[0]);
                }
              }
            });
          });
        });
      }

      setFreeResults({ _noMatches: true, suggestions: Array.from(suggestions).slice(0, 10) });
      return;
    }

    setFreeResults(results);
  };

  // Load saved and watched classes from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('tt_saved_classes');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Deduplicate saved classes
        const seen = new Set();
        const deduplicated = parsed.filter(item => {
          const id = item.id || `${item.day}::${item.classroom}::${item.time}::${item.code}`;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        setSavedClasses(deduplicated);
      }
      const watchedRaw = localStorage.getItem('tt_watched_classes');
      if (watchedRaw) setWatchedClasses(JSON.parse(watchedRaw));
    } catch (e) {
      console.warn('Failed to read saved/watched classes', e);
    }
  }, []);

  // Persist watched classes
  useEffect(() => {
    try {
      localStorage.setItem('tt_watched_classes', JSON.stringify(watchedClasses));
    } catch (e) {
      console.warn('Failed to save watched classes', e);
    }
  }, [watchedClasses]);

  // Auto-sync watched classes when schedule data updates
  useEffect(() => {
    if (scheduleData && watchedClasses.length > 0) {
      syncWatchedClasses();
    }
  }, [scheduleData, watchedClasses]);

  // Close time-picker dropdown when clicking outside
  useEffect(() => {
    const onDocClick = (e) => {
      if (timePickerRef && timePickerRef.current && !timePickerRef.current.contains(e.target)) {
        setTimePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Auto-run search when a time slot is selected (no text query required)
  useEffect(() => {
    if (activeTab !== 'schedule') return;

    if (freeTimeSlot && freeTimeSlot !== 'all') {
      const { start, end } = parseStartEnd(freeTimeSlot);
      const timeResults = {};

      days.forEach(dayName => {
        const rooms = findFreeRoomsForTimeRange(dayName, start, end) || [];
        if (rooms.length > 0) {
          timeResults[dayName] = [{ start, end, availableRooms: rooms.map(r => ({ name: r.name, capacity: (r.capacity || r.capacity === 0) ? r.capacity : '?', block: r.block || extractBlockFromName(r.name), floor: r.floor || '?' })) }];
        }
      });

      if (Object.keys(timeResults).length > 0) {
        setFreeResults(timeResults);
        const today = new Date().getDay();
        const todayIndex = today === 0 || today === 6 ? 0 : today - 1;
        const todayDayName = days[todayIndex];
        let selIndex = todayIndex;
        if (!timeResults[todayDayName]) {
          selIndex = days.indexOf(Object.keys(timeResults)[0]);
        }
        setFreeDayFilter(selIndex.toString());
        setActiveTab('schedule');
        setSelectedDay(selIndex >= 0 ? selIndex : 0);
      } else {
        // no free rooms at selected time
        setFreeResults({ _noMatches: true, suggestions: [] });
      }
    } else {
      // if switched back to 'All times' and no text query, clear results
      if (!freeQuery || !freeQuery.trim()) setFreeResults(null);
    }
  }, [freeTimeSlot, activeTab]);

  // (No debug logs)

  // Fetch schedule when user switches to schedule tab or changes selectedDay
  useEffect(() => {
    // Client-side light polling to keep schedule reasonably fresh on Vercel.
    // Controlled by env var NEXT_PUBLIC_SHEET_CLIENT_POLL_MS (ms). If 0 or not
    // set, polling is disabled and we fetch only on tab/day change.
    const pollMs = Number(process.env.NEXT_PUBLIC_SHEET_CLIENT_POLL_MS) || 0;
    let intervalId = null;

    if (activeTab === 'schedule') {
      // Fetch ALL days for the Free Finder to work correctly
      fetchDaySchedule('all');
      
      // Also fetch the selected day for the main schedule view
      fetchDaySchedule(selectedDay);

      if (pollMs > 0) {
        intervalId = setInterval(() => {
          fetchDaySchedule('all');
          fetchDaySchedule(selectedDay);
        }, pollMs);
      }
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedDay]);

  // Handle search input with debounce - faster debounce (100ms instead of 450ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        performSearch(searchQuery);
      } else {
        setSearchResults(null);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Persist saved classes
  useEffect(() => {
    try {
      localStorage.setItem('tt_saved_classes', JSON.stringify(savedClasses));
    } catch (e) {
      console.warn('Failed to save classes', e);
    }
  }, [savedClasses]);

  // Auto-search and smart day selection for Free Finder
  useEffect(() => {
    if (activeTab === 'schedule' && freeQuery && freeQuery.trim()) {
      // Auto-trigger search
      handleFreeSearch();
    } else if (activeTab === 'schedule' && !freeQuery.trim()) {
      setFreeResults(null);
    }
  }, [freeQuery, activeTab]);

  // Render classroom schedule
  const renderSchedule = () => {
    if (!scheduleData) {
      return <div className={styles.noData}>No schedule data available</div>;
    }

    if (scheduleData.week) {
      return (
        <div className={styles.weekContainer}>
          {Object.entries(scheduleData.week).map(([dayName, dayData]) => (
            <div key={`day-${dayName}`} className={styles.dayBlock}>
              <h3 className={styles.dayHeader}>{dayName}</h3>
              {(!dayData || !dayData.classrooms || dayData.classrooms.length === 0) && (
                <div className={styles.noData}>No data for {dayName}</div>
              )}

              <div className={styles.scheduleContainer}>
                {dayData && dayData.classrooms && dayData.classrooms.map((classroom, idx) => (
                  <div key={`classroom-${dayName}-${idx}`} className={styles.classroomCard}>
                    <div className={styles.classroomHeader}>
                      <h4 className={styles.classroomName}>{classroom.name}</h4>
                      <div className={styles.headerActions}>
                        {classroom.schedule && classroom.schedule.length > 0 ? (
                          (() => {
                            // compute earliest and latest times for this classroom
                            const times = classroom.schedule.map(s => s.time).filter(Boolean);
                            const sorted = times.slice().sort((a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b));
                            const badge = sorted.length > 1 ? `${sorted[0]} — ${sorted[sorted.length - 1]}` : sorted[0] || `${classroom.schedule.length} slots`;
                            return <span className={styles.classCount}>{badge}</span>;
                          })()
                        ) : (
                          <span className={styles.classCount}>{classroom.schedule.length} slots</span>
                        )}
                      </div>
                    </div>

                    <div className={styles.scheduleGrid}>
                      {(() => {
                        const merged = mergeAdjacentFreeSlots(classroom.schedule);
                        return merged.map((entry, entryIdx) => {
                          const isFreeEntry = entry.kind === 'free' || entry.kind === 'lab' && /free/i.test(entry.label);
                          if (filter === 'free' && entry.kind !== 'free' && entry.kind !== 'lab') return null;

                          const timeLabel = entry.start && entry.end ? `${entry.start} - ${entry.end}` : (entry.start || entry.end || `${entry.slots.length} slots`);

                          return (
                            <div 
                              key={`slot-${dayName}-${idx}-${entryIdx}`} 
                              className={`${styles.scheduleSlot} ${(entry.kind === 'free' || entry.kind === 'lab') ? styles.clickableSlot : ''}`}
                              onClick={() => {
                                if ((entry.kind === 'free' || entry.kind === 'lab') && entry.start && entry.end) {
                                  setSelectedTimeRange({ start: entry.start, end: entry.end, dayName });
                                  setFreeRooms(findFreeRoomsForTimeRange(dayName, entry.start, entry.end));
                                }
                              }}
                            >
                              <div className={styles.slotTime}>{timeLabel}</div>
                              <div className={styles.slotClass}>
                                {/* show code for first slot if exists */}
                                {entry.slots[0] && entry.slots[0].code && <span className={styles.classCode}>{entry.slots[0].code}</span>}
                                <span className={styles.className}>{entry.kind === 'class' ? entry.slots[0].class : (entry.kind === 'lab' ? 'Lab' : '— Free —')}</span>
                              </div>
                              <div className={styles.slotActions}>
                                {entry.kind === 'free' || entry.kind === 'lab' ? (
                                  <button
                                    className={styles.viewBtn}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedTimeRange({ start: entry.start, end: entry.end, dayName });
                                      setFreeRooms(findFreeRoomsForTimeRange(dayName, entry.start, entry.end));
                                    }}
                                  >
                                    View Rooms
                                  </button>
                                ) : (
                                  <button
                                    className={styles.saveBtn}
                                    onClick={() => addSavedClass({ day: dayName, classroom: classroom.name, time: timeLabel, code: entry.slots[0] ? entry.slots[0].code || '' : '', className: entry.kind === 'class' ? entry.slots[0].class : (entry.kind === 'lab' ? 'Lab' : '— Free —') })}
                                  >
                                    ☆ Save
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (!scheduleData.classrooms) {
      return <div className={styles.noData}>No schedule data available</div>;
    }

    return (
      <div className={styles.scheduleContainer}>
        {scheduleData.classrooms.map((classroom, idx) => (
          <div key={`classroom-${idx}`} className={styles.classroomCard}>
            <div className={styles.classroomHeader}>
              <h3 className={styles.classroomName}>{classroom.name}</h3>
              <div className={styles.headerActions}>
                <span className={styles.classCount}>{classroom.schedule.length} slots</span>
              </div>
            </div>

            <div className={styles.scheduleGrid}>
              {(() => {
                const merged = mergeAdjacentFreeSlots(classroom.schedule);
                return merged.map((entry, entryIdx) => {
                  if (filter === 'free' && entry.kind !== 'free' && entry.kind !== 'lab') return null;

                  const timeLabel = entry.start && entry.end ? `${entry.start} - ${entry.end}` : (entry.start || entry.end || `${entry.slots.length} slots`);

                  return (
                    <div key={`slot-${idx}-${entryIdx}`} className={styles.scheduleSlot}>
                      <div className={styles.slotTime}>{timeLabel}</div>
                      <div className={styles.slotClass}>
                        {entry.slots[0] && entry.slots[0].code && <span className={styles.classCode}>{entry.slots[0].code}</span>}
                        <span className={styles.className}>{entry.kind === 'class' ? entry.slots[0].class : (entry.kind === 'lab' ? 'Lab' : '— Free —')}</span>
                      </div>
                      <div className={styles.slotActions}>
                        <button
                          className={styles.saveBtn}
                          onClick={() => addSavedClass({ day: days[selectedDay], classroom: classroom.name, time: timeLabel, code: entry.slots[0] ? entry.slots[0].code || '' : '', className: entry.kind === 'class' ? entry.slots[0].class : (entry.kind === 'lab' ? 'Lab' : '— Free —') })}
                        >
                          ☆ Save
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Helper function to save all current search results
  const saveAllCurrentSearchResults = () => {
    if (!searchResults || !searchResults.results) return;
    
    const { results } = searchResults;
    const newSaved = [...savedClasses];
    let addedCount = 0;

    Object.entries(results).forEach(([dayName, classes]) => {
      classes.forEach((classItem) => {
        let badgeText = 'Free';
        if (classItem.code) {
          badgeText = classItem.code;
        } else if (classItem.class) {
          const classStr = String(classItem.class);
          const codeMatch = classStr.match(/[A-Z]{2,}\-?\d+[A-Z]?\d*/);
          badgeText = codeMatch ? codeMatch[0] : classStr.split('\n')[0];
        }

        const id = `${dayName}::${classItem.classroom}::${classItem.time}::${badgeText}`;
        if (!newSaved.find(s => s.id === id)) {
          newSaved.push({
            id,
            day: dayName,
            time: classItem.time,
            classroom: classItem.classroom,
            code: badgeText,
            className: classItem.class,
            addedAt: Date.now()
          });
          addedCount++;
        }
      });
    });

    setSavedClasses(newSaved);
    try {
      localStorage.setItem('tt_saved_classes', JSON.stringify(newSaved));
    } catch (e) {
      console.warn('Failed to save classes', e);
    }
  };

  // Render search results - separate card per class instance, with day filter
  const renderSearchResults = () => {
    if (!searchResults) {
      return (
        <div className={styles.noResults}>
          <div className={styles.noResultsIcon}>🔍</div>
          <p>Start typing to search for your class</p>
        </div>
      );
    }

    const { results, totalMatches, query } = searchResults;

    if (totalMatches === 0) {
      return (
        <div className={styles.noResults}>
          <div className={styles.noResultsIcon}>✗</div>
          <p>No classes found for "{query}"</p>
        </div>
      );
    }

    // Flatten all instances from all days
    const allInstances = [];
    Object.entries(results).forEach(([dayName, classes]) => {
      classes.forEach((classItem) => {
        const dayNum = classItem.dayNum !== undefined ? classItem.dayNum : days.indexOf(dayName);
        // Determine badge text: prefer code; extract code from class name if needed
        let badgeText = 'Free';
        if (classItem.code) {
          badgeText = classItem.code;
        } else if (classItem.class && String(classItem.class).toLowerCase().includes('reserved')) {
          badgeText = 'Reserved';
        } else if (classItem.class) {
          // Try to extract class code from class name (e.g., "BSBA-3A1" from "TBW BSBA-3A1 Ms. Name")
          const classStr = String(classItem.class);
          const codeMatch = classStr.match(/[A-Z]{2,}\-?\d+[A-Z]?\d*/);
          badgeText = codeMatch ? codeMatch[0] : classStr.split('\n')[0];
        }
        allInstances.push({
          code: badgeText,
          class: classItem.class,
          time: classItem.time,
          classroom: classItem.classroom,
          dayName: dayName,
          dayNum: dayNum
        });
      });
    });

    // Sort by dayNum, then by time (chronological order with proper time parsing)
    const parseTimeToMinutes = (timeStr) => {
      if (!timeStr) return 0;
      // Extract start time from formats like "08:00-8:50" or "1:30-2:20"
      const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
      if (!match) return 0;
      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      
      // Convert to 24-hour if PM (1-5 PM is likely PM in timetable context)
      // Assume times before 8:00 are PM (afternoon classes)
      if (hours >= 1 && hours < 8) {
        hours += 12; // Convert to 24-hour format
      }
      return hours * 60 + minutes;
    };
    
    allInstances.sort((a, b) => {
      if (a.dayNum !== b.dayNum) return a.dayNum - b.dayNum;
      return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
    });

    // Collect all unique days
    const allDaysWithResults = Array.from(new Set(allInstances.map(inst => inst.dayNum))).sort((a, b) => a - b);

    // Filter instances by selected day if a day filter is active
    const filteredInstances = searchFilterDay !== null
      ? allInstances.filter(inst => inst.dayNum === searchFilterDay)
      : allInstances;

    return (
      <div className={styles.resultsContainer}>
        <div className={styles.resultsSummary}>
          <div>Found <strong>{totalMatches}</strong> result{totalMatches !== 1 ? 's' : ''} for <strong>"{query}"</strong></div>
        </div>

        {/* Day selector tabs at TOP - ALWAYS show all 5 days */}
        <div className={styles.daySelector}>
          <button
            className={`${styles.dayButton} ${searchFilterDay === null ? styles.activeDayButton : ''}`}
            onClick={() => setSearchFilterDay(null)}
          >
            All
          </button>
          {/* Show ALL days Mon-Fri regardless of whether they have results */}
          {[0, 1, 2, 3, 4].map(dayNum => (
            <button
              key={`day-filter-${dayNum}`}
              className={`${styles.dayButton} ${searchFilterDay === dayNum ? styles.activeDayButton : ''}`}
              onClick={() => setSearchFilterDay(dayNum)}
            >
              {days[dayNum].slice(0, 3)}
            </button>
          ))}
        </div>

        {/* Separate card for each class instance - Grouped by Day */}
        {filteredInstances.length === 0 ? (
          <div className={styles.noResults}>
            <div className={styles.noResultsIcon}>📭</div>
            <p>No classes for "{query}"</p>
          </div>
        ) : (
          (() => {
            // Group instances by day
            const grouped = {};
            filteredInstances.forEach(inst => {
              if (!grouped[inst.dayName]) {
                grouped[inst.dayName] = [];
              }
              grouped[inst.dayName].push(inst);
            });

            // Render days in proper order
            return days.map(dayName => {
              const dayInstances = grouped[dayName];
              if (!dayInstances || dayInstances.length === 0) return null;

              return (
                <div key={`day-group-search-${dayName}`}>
                  <h3 className={styles.dayGroupHeader}>{dayName}</h3>
                  <div className={styles.resultsList}>
                    {dayInstances.map((instance, idx) => (
                      <div key={`instance-${dayName}-${idx}`} className={styles.resultCard}>
                        <div className={styles.resultHeader}>
                          <span className={styles.resultCode}>{instance.code}</span>
                          <span className={styles.resultDay}>📅 {instance.dayName}</span>
                        </div>

                        <div className={styles.resultTitle}>{instance.class}</div>

                        <div className={styles.resultDetails}>
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>🕐 Time:</span>
                            <span className={styles.detailValue}>{instance.time}</span>
                          </div>
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>📍 Room:</span>
                            <span className={styles.detailValue}>{instance.classroom}</span>
                          </div>
                        </div>

                        <div className={styles.resultActions}>
                          <button
                            className={styles.saveBtn}
                            onClick={() => {
                              addSavedClass({
                                day: instance.dayName,
                                classroom: instance.classroom,
                                time: instance.time,
                                code: instance.code,
                                className: instance.class
                              });
                            }}
                          >
                            ☆ Save to My Classes
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            });
          })()
        )}
      </div>
    );
  };

  // Add saved class - now just stores code and day for real-time sync
  const addSavedClass = (item) => {
    // Create a unique ID based on code, day, time, and classroom
    const id = `${item.code}::${item.day}::${item.time}::${item.classroom}`;
    if (savedClasses.find((s) => s.id === id)) return;
    
    // Store essential info for real-time lookup
    const entry = { 
      id, 
      code: item.code,
      day: item.day,
      time: item.time,
      classroom: item.classroom,
      className: item.className || item.class,
      addedAt: Date.now() 
    };
    setSavedClasses([entry, ...savedClasses]);
  };

  const removeSavedClass = (id) => {
    setSavedClasses(savedClasses.filter((s) => s.id !== id));
  };

  // Get real-time data from schedule for a saved class
  const getRealtimeClassData = (savedClass) => {
    if (!scheduleData) return savedClass;
    
    // Try to find the class in current schedule data
    if (scheduleData.week && scheduleData.week[savedClass.day]) {
      const dayData = scheduleData.week[savedClass.day];
      const classrooms = dayData.classrooms || dayData.data?.classrooms || [];
      
      for (const room of classrooms) {
        if (room.name === savedClass.classroom) {
          for (const slot of (room.schedule || [])) {
            if (slot.code === savedClass.code && slot.time === savedClass.time) {
              // Found updated data from sheet
              return {
                ...savedClass,
                className: slot.class || savedClass.className,
                time: slot.time,
                classroom: room.name
              };
            }
          }
        }
      }
    }
    
    // If not found in exact location, return the saved version
    return savedClass;
  };

  const renderSaved = () => {
    // Check if all current search results are already saved
    const areSearchResultsSaved = () => {
      if (!searchResults || !searchResults.results) return false;
      
      const { results } = searchResults;
      let allSaved = true;
      
      Object.entries(results).forEach(([dayName, classes]) => {
        classes.forEach((classItem) => {
          let badgeText = 'Free';
          if (classItem.code) {
            badgeText = classItem.code;
          } else if (classItem.class) {
            const classStr = String(classItem.class);
            const codeMatch = classStr.match(/[A-Z]{2,}\-?\d+[A-Z]?\d*/);
            badgeText = codeMatch ? codeMatch[0] : classStr.split('\n')[0];
          }
          
          const id = `${dayName}::${classItem.classroom}::${classItem.time}::${badgeText}`;
          if (!savedClasses.find(s => s.id === id)) {
            allSaved = false;
          }
        });
      });
      
      return allSaved;
    };

    if ((!savedClasses || savedClasses.length === 0) && watchedClasses.length === 0) {
      return (
        <div>
          {/* Show save option if there are search results AND they are not already saved */}
          {searchResults && searchResults.totalMatches > 0 && !areSearchResultsSaved() && (
            <div style={{ 
              background: 'linear-gradient(90deg, rgba(124,58,237,0.08), rgba(107,70,193,0.05))',
              border: '1px solid rgba(124,58,237,0.2)',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '20px'
            }}>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: 'rgba(255,255,255,0.85)' }}>
                Found <strong>{searchResults.totalMatches}</strong> result{searchResults.totalMatches !== 1 ? 's' : ''} for <strong>"{searchResults.query}"</strong>
              </p>
              <button
                className={styles.saveAllBtn}
                onClick={saveAllCurrentSearchResults}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                💾 Save Class Schedule
              </button>
            </div>
          )}

          <div className={styles.noResults}>
            <div className={styles.noResultsIcon}>💾</div>
            <p>No saved classes yet.</p>
            <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.7)', marginTop: '12px' }}>
              Search for a class or room in the <strong>Search</strong> tab and save your favorites here!
            </p>
          </div>
        </div>
      );
    }

    return (
      <div>
        {/* Show save option if there are search results AND they are not already saved */}
        {searchResults && searchResults.totalMatches > 0 && !areSearchResultsSaved() && (
          <div style={{ 
            background: 'linear-gradient(90deg, rgba(124,58,237,0.08), rgba(107,70,193,0.05))',
            border: '1px solid rgba(124,58,237,0.2)',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '20px'
          }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: 'rgba(255,255,255,0.85)' }}>
              Found <strong>{searchResults.totalMatches}</strong> result{searchResults.totalMatches !== 1 ? 's' : ''} for <strong>"{searchResults.query}"</strong>
            </p>
            <button
              className={styles.saveAllBtn}
              onClick={saveAllCurrentSearchResults}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              💾 Save Class Schedule
            </button>
          </div>
        )}

        {/* Watched Classes Section */}
        {watchedClasses.length > 0 && (
          <div className={styles.watchedSection}>
            <h3 className={styles.watchedTitle}>📌 Class Schedules (Auto-Synced)</h3>
            <div className={styles.resultsList}>
              {watchedClasses.map(code => (
                <div key={`watched-${code}`} className={styles.watchedCard}>
                  <div className={styles.watchedHeader}>
                    <span className={styles.watchedCode}>{code}</span>
                    <button 
                      className={styles.removeBtn}
                      onClick={() => removeFromWatchlist(code)}
                      title="Stop watching this class"
                    >
                      ✕ Unwatch
                    </button>
                  </div>
                  <div className={styles.watchedInfo}>
                    <span>Auto-synced when schedule updates</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Individual Saved Classes - Grouped by Day */}
        {savedClasses && savedClasses.length > 0 && (
          <div className={styles.savedSection}>
            {watchedClasses.length > 0 && <h3 className={styles.savedTitle}>📋 Individual Classes</h3>}
            
            {/* Saved Class Codes Section - Quick access to unwatch/remove all instances */}
            {(() => {
              const uniqueCodes = [...new Set(savedClasses.map(s => s.code).filter(Boolean))].sort();
              if (uniqueCodes.length > 0) {
                return (
                  <div className={styles.savedCodesSection}>
                    <h3 className={styles.savedCodesTitle}>🔖 Your Saved Classes</h3>
                    <div className={styles.resultsList}>
                      {uniqueCodes.map(code => (
                        <div key={`saved-code-${code}`} className={styles.watchedCard}>
                          <div className={styles.watchedHeader}>
                            <span className={styles.watchedCode}>{code}</span>
                            <button 
                              className={styles.removeBtn}
                              onClick={() => {
                                // Remove all instances of this class code
                                setSavedClasses(savedClasses.filter(s => s.code !== code));
                              }}
                              title="Remove all instances of this class"
                            >
                              ✕ Remove All
                            </button>
                          </div>
                          <div className={styles.watchedInfo}>
                            <span>{savedClasses.filter(s => s.code === code).length} instance{savedClasses.filter(s => s.code === code).length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
              return null;
            })()}
            
            {/* Render saved classes with real-time data from schedule */}
            {(() => {
              const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

              // Get real-time data for each saved class
              const entries = savedClasses.map(s => {
                const realtimeData = getRealtimeClassData(s);
                return {
                  id: s.id,
                  day: realtimeData.day,
                  time: realtimeData.time,
                  classroom: realtimeData.classroom,
                  code: realtimeData.code,
                  className: realtimeData.className || ''
                };
              });

              // Sort entries by day and time
              entries.sort((a, b) => {
                const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
                if (dayDiff !== 0) return dayDiff;
                return parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
              });

              // Group by day
              return dayOrder.map(day => {
                const dayEntries = entries.filter(n => n.day === day);

                if (dayEntries.length === 0) return null;

                return (
                  <div key={`day-group-${day}`} className={styles.dayResultsGroup}>
                    <h4 className={styles.dayGroupHeader}>{day}</h4>
                    <div className={styles.resultsList}>
                      {dayEntries.map((n) => (
                        <div key={n.id} className={styles.resultCard}>
                          <div className={styles.resultHeader}>
                            <span className={styles.resultCode}>{n.code || '—'}</span>
                            <span className={styles.resultDay}>📅 {day}</span>
                          </div>
                          <div className={styles.resultTitle}>{n.className || 'Free'}</div>
                          <div className={styles.resultDetails}>
                            <div className={styles.detailRow}>
                              <span className={styles.detailLabel}>🕐 Time:</span>
                              <span className={styles.detailValue}>{n.time}</span>
                            </div>
                            <div className={styles.detailRow}>
                              <span className={styles.detailLabel}>📍 Room:</span>
                              <span className={styles.detailValue}>{n.classroom}</span>
                            </div>
                          </div>
                          <div className={styles.resultActions}>
                            <button className={styles.removeBtn} onClick={() => removeSavedClass(n.id)}>- Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>
    );
  };

  function AddClassForm({ days, onAdd }) {
    const [day, setDay] = useState(days[0] || 'Monday');
    const [time, setTime] = useState('09:00 - 10:00');
    const [code, setCode] = useState('');
    const [className, setClassName] = useState('');
    const [classroom, setClassroom] = useState('My Room');

    const submit = (e) => {
      e.preventDefault();
      if (!className.trim()) return;
      onAdd({ day, time, code, className, classroom });
      setCode('');
      setClassName('');
      setClassroom('My Room');
    };

    return (
      <form className={styles.smallForm} onSubmit={submit}>
        <select className={styles.formInput} value={day} onChange={(e) => setDay(e.target.value)}>
          {days.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <input className={styles.formInput} value={time} onChange={(e) => setTime(e.target.value)} />
        <input className={styles.formInput} placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} />
        <input className={styles.formInput} placeholder="Class name" value={className} onChange={(e) => setClassName(e.target.value)} />
        <input className={styles.formInput} placeholder="Classroom" value={classroom} onChange={(e) => setClassroom(e.target.value)} />
        <button className={styles.submitBtn} type="submit">Add</button>
      </form>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.title}>📚 FAST University Timetable</h1>
          <p className={styles.subtitle}>Made By Saad Najam</p>
        </div>
      </div>

      {/* Search Bar - Show different search based on active tab */}
      <div className={styles.searchSection}>
        {activeTab === 'schedule' ? (
          <div className={styles.searchBox}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search for a room or lab (e.g., E-31, Lab1)"
              value={freeQuery}
              onChange={(e) => setFreeQuery(e.target.value)}
            />
            <span className={styles.searchIcon}>🔍</span>
            <div className={styles.timePicker} ref={timePickerRef}>
              <button
                type="button"
                className={styles.timePickerButton}
                aria-haspopup="listbox"
                aria-expanded={timePickerOpen}
                onClick={() => setTimePickerOpen(!timePickerOpen)}
                title={freeTimeSlot === 'all' ? 'All times' : freeTimeSlot}
              >
                ⏱
              </button>

              {timePickerOpen && (
                <div className={styles.timePickerDropdown} role="listbox" aria-label="Time slots">
                  <button className={styles.timePickerOption} onClick={() => { setFreeTimeSlot('all'); setTimePickerOpen(false); }}>
                    All times
                  </button>
                  {getAllTimeSlots().map((t, idx) => (
                    <button
                      key={`tp-${idx}`}
                      className={`${styles.timePickerOption} ${freeTimeSlot === t ? styles.timePickerOptionActive : ''}`}
                      onClick={() => { setFreeTimeSlot(t); setTimePickerOpen(false); }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.searchBox}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search your class (e.g., BCS-1G, Lab-1)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <span className={styles.searchIcon}>🔍</span>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className={styles.errorBox}>
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Loading Spinner */}
      {loading && (
        <div className={styles.loader}>
          <div className={styles.spinner}></div>
          <p>Loading data...</p>
        </div>
      )}

      {/* Tabs */}
      {!loading && (
        <div className={styles.tabsContainer}>
          <button
            className={`${styles.tab} ${activeTab === 'schedule' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('schedule')}
          >
            📅 Free Rooms
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'search' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('search')}
          >
            🔍 Search
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'saved' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('saved')}
          >
            💾 Saved
          </button>
        </div>
      )}

      {/* Main Content */}
      {!loading && activeTab === 'schedule' && (
        <div className={styles.mainContent}>
          <div className={styles.freeFinderSection}>
            {/* Day Filter Buttons - Only show when there are search results */}
            {freeResults && !freeResults._noMatches && (
              <div className={styles.daySelector}>
                <button
                  className={`${styles.dayButton} ${freeDayFilter === 'all' ? styles.activeDayButton : ''}`}
                  onClick={() => setFreeDayFilter('all')}
                >
                  All
                </button>
                {days.map((day, idx) => (
                  <button
                    key={day}
                    className={`${styles.dayButton} ${freeDayFilter === idx.toString() ? styles.activeDayButton : ''}`}
                    onClick={() => setFreeDayFilter(idx.toString())}
                  >
                    {day.substring(0, 3)}
                  </button>
                ))}
              </div>
            )}

            <div className={styles.freeFinderResults}>
              {!freeResults && (
                <div className={styles.noResults}>
                  <p>Start typing a class or lab code above to find free times.</p>
                </div>
              )}

              {freeResults && freeResults._noMatches && (
                <div className={styles.noResults}>
                  <p>No class/lab found matching "{freeQuery}".</p>
                  {freeResults.suggestions && freeResults.suggestions.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <p>Did you mean:</p>
                      <div className={styles.resultsList}>
                        {freeResults.suggestions.map(s => (
                          <button key={s} className={styles.resultCard} onClick={() => { setFreeQuery(s); setTimeout(() => handleFreeSearch(), 50); }}>
                            <div className={styles.resultHeader}><strong>{s}</strong></div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {freeResults && !freeResults._noMatches && Object.entries(freeResults)
                .filter(([dayName]) => {
                  // Filter by selected day: if 'all', show all days; otherwise show only the selected day
                  if (freeDayFilter === 'all') return true;
                  const selectedDayIndex = parseInt(freeDayFilter);
                  return days.indexOf(dayName) === selectedDayIndex;
                })
                .map(([dayName, ranges]) => (
                <div key={`free-${dayName}`} className={styles.freeDayBlock}>
                  <h4 className={styles.freeDayBlockHeader}>{dayName}</h4>
                  <div className={styles.resultsList}>
                    {ranges.map((r, i) => {
                      // Create a separate card for each room
                      return (r.availableRooms || []).map((room, ri) => (
                        <div key={`room-${dayName}-${i}-${ri}`} className={styles.freeResultCard}>
                          {/* Header: Badge + Day */}
                          <div className={styles.freeCardHeader}>
                            <div className={styles.freeCardBadge}>FREE</div>
                            <div className={styles.freeCardDay}>📅 {dayName}</div>
                          </div>

                          {/* Title: room name */}
                          <div className={styles.freeCardTitle}>
                            {room.name}
                          </div>

                          {/* Details: Time + Room info */}
                          <div className={styles.freeCardDetails}>
                            <div className={styles.freeCardDetailRow}>
                              <span className={styles.freeCardDetailLabel}>🕐 Time:</span>
                              <strong>{r.start} - {r.end}</strong>
                            </div>
                            <div className={styles.freeCardDetailRow}>
                              <span className={styles.freeCardDetailLabel}>👥 Capacity:</span>
                              <strong>{room.capacity}</strong>
                            </div>
                          </div>

                          {/* Action: Save Button */}
                          <div className={styles.freeCardAction}>
                            <button
                              className={styles.freeCardActionBtn}
                              onClick={() => {
                                addSavedClass({
                                  day: dayName,
                                  classroom: room.name,
                                  time: `${r.start} - ${r.end}`,
                                  code: 'FREE',
                                  className: `Free Time`
                                });
                              }}
                            >
                              ⭐ Save to My Classes
                            </button>
                          </div>
                        </div>
                      ));
                    })}
                  </div>
                </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Search Results Tab */}
      {!loading && activeTab === 'search' && (
        <div className={styles.mainContent}>{renderSearchResults()}</div>
      )}

      {/* Saved Classes Tab */}
      {!loading && activeTab === 'saved' && (
        <div className={styles.mainContent}>{renderSaved()}</div>
      )}

      {/* Free Rooms Modal */}
      {selectedTimeRange && (
        <div className={styles.modalOverlay} onClick={() => setSelectedTimeRange(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Available Rooms</h2>
              <button className={styles.modalClose} onClick={() => setSelectedTimeRange(null)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.timeInfo}>
                {selectedTimeRange.dayName} • {selectedTimeRange.start} - {selectedTimeRange.end}
              </p>
              {(() => {
                const rooms = findFreeRoomsForTimeRange(selectedTimeRange.dayName, selectedTimeRange.start, selectedTimeRange.end);
                if (rooms.length === 0) {
                  return <div className={styles.noResults}>No rooms available at this time</div>;
                }
                return (
                  <div className={styles.roomGrid}>
                    {rooms.map((room, idx) => (
                      <div key={`room-${idx}`} className={styles.roomCard}>
                        <div className={styles.roomCardHeader}>
                          <h3 className={styles.roomName}>{room.name}</h3>
                          <span className={styles.freeBadge}>FREE</span>
                        </div>
                        <div className={styles.roomCardBody}>
                          <p className={styles.cardLabel}>Classroom</p>
                          <div className={styles.roomInfo}>
                            <span className={styles.roomDetail}>👥 Capacity: {room.capacity}</span>
                            <span className={styles.roomDetail}>📍 {room.floor}</span>
                          </div>
                          <div className={styles.roomInfo}>
                            <span className={styles.roomDetail}>📅 {selectedTimeRange.dayName}</span>
                            <span className={styles.roomDetail}>🕐 {selectedTimeRange.start}-{selectedTimeRange.end}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className={styles.footer}>
        <p>FAST Timetable © 2025 — Designed for FAST students, by a FAST student 🎓✨ | All rights reserved.</p>
      </div>
    </div>
  );
}