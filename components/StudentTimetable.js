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
      setScheduleData(cached.data);
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
          setScheduleData({ week: data.week });
        } else {
          setError(data.error || 'Failed to fetch week schedule');
        }
      } else {
        const response = await fetch(`/api/schedule?action=fetch&day=${dayId}`);
        const data = await response.json();
        if (data.success) {
          cacheRef.current.schedule[cacheKey] = { data: data.data, timestamp: Date.now() };
          setScheduleData(data.data);
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
      setActiveTab('search');
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
        setActiveTab('search');
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

  // Load saved classes from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('tt_saved_classes');
      if (raw) setSavedClasses(JSON.parse(raw));
    } catch (e) {
      console.warn('Failed to read saved classes', e);
    }
  }, []);

  // (No debug logs)

  // Fetch schedule when user switches to schedule tab or changes selectedDay
  useEffect(() => {
    // Client-side light polling to keep schedule reasonably fresh on Vercel.
    // Controlled by env var NEXT_PUBLIC_SHEET_CLIENT_POLL_MS (ms). If 0 or not
    // set, polling is disabled and we fetch only on tab/day change.
    const pollMs = Number(process.env.NEXT_PUBLIC_SHEET_CLIENT_POLL_MS) || 0;
    let intervalId = null;

    if (activeTab === 'schedule') {
      // initial fetch
      fetchDaySchedule(selectedDay);

      if (pollMs > 0) {
        intervalId = setInterval(() => {
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
        allInstances.push({
          code: classItem.code || 'Unknown',
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
          Found <strong>{totalMatches}</strong> result{totalMatches !== 1 ? 's' : ''} for{' '}
          <strong>"{query}"</strong>
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

        {/* Separate card for each class instance */}
        <div className={styles.resultsList}>
          {filteredInstances.length === 0 ? (
            <div className={styles.noResults}>
              <div className={styles.noResultsIcon}>📭</div>
              <p>No classes today for "{query}"</p>
            </div>
          ) : (
            filteredInstances.map((instance, idx) => (
              <div key={`instance-${idx}`} className={styles.resultCard}>
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
            ))
          )}
        </div>
      </div>
    );
  };

  // Add saved class
  const addSavedClass = (item) => {
    const id = `${item.day}::${item.classroom}::${item.time}::${item.code}`;
    if (savedClasses.find((s) => s.id === id)) return;
    const entry = { id, ...item, addedAt: Date.now() };
    setSavedClasses([entry, ...savedClasses]);
  };

  const removeSavedClass = (id) => {
    setSavedClasses(savedClasses.filter((s) => s.id !== id));
  };

  const renderSaved = () => {
    if (!savedClasses || savedClasses.length === 0) {
      return (
        <div className={styles.noResults}>
          <div className={styles.noResultsIcon}>💾</div>
          <p>No saved classes yet. Save a class from search or schedule.</p>
        </div>
      );
    }

    return (
      <div className={styles.resultsList}>
        {savedClasses.map((s) => (
          <div key={s.id} className={styles.resultCard}>
            <div className={styles.resultHeader}>
              <span className={styles.resultCode}>{s.code || '—'}</span>
              <span className={styles.resultTime}>{s.time}</span>
            </div>
            <div className={styles.resultDetails}>
              <div className={styles.resultClass}>{s.className || 'Free'}</div>
              <div className={styles.resultClassroom}>📍 {s.classroom}</div>
              <div className={styles.resultClassroom}>📅 {s.day}</div>
            </div>
            <div className={styles.resultActions}>
              <button className={styles.removeBtn} onClick={() => removeSavedClass(s.id)}>- Remove</button>
            </div>
          </div>
        ))}
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

      {/* Search Bar */}
      <div className={styles.searchSection}>
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
            📅 Schedule
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
          <div className={styles.controlsRow}>
            <div className={styles.daySelector}>
              <button
                key={`day-all`}
                className={`${styles.dayButton} ${selectedDay === 'all' ? styles.activeDayButton : ''}`}
                onClick={() => setSelectedDay('all')}
              >
                <span className={styles.dayName}>All</span>
              </button>

              {days.map((day, idx) => (
                <button
                  key={`day-${idx}`}
                  className={`${styles.dayButton} ${selectedDay === idx ? styles.activeDayButton : ''}`}
                  onClick={() => setSelectedDay(idx)}
                >
                  <span className={styles.dayName}>{day.slice(0, 3)}</span>
                </button>
              ))}
            </div>

            <div className={styles.filterGroup}>
              <button className={`${styles.filterBtn} ${filter === 'all' ? styles.activeFilter : ''}`} onClick={() => setFilter('all')}>All</button>
              <button className={`${styles.filterBtn} ${filter === 'free' ? styles.activeFilter : ''}`} onClick={() => setFilter('free')}>Free/Labs</button>
            </div>

            <div className={styles.addGroup}>
              <button className={styles.addBtn} onClick={() => setShowAddForm(!showAddForm)}>{showAddForm ? 'Close' : 'Add My Class'}</button>
            </div>
          </div>

          {showAddForm && (
            <div className={styles.addForm}>
              <AddClassForm days={days} onAdd={(item) => { addSavedClass(item); setShowAddForm(false); }} />
            </div>
          )}

          {/* Schedule Search Section */}
          <div className={styles.searchSection2}>
            <h3 className={styles.searchTitle}>🔎 Search Schedule</h3>
            <div className={styles.searchControls}>
              <div className={styles.searchGroup}>
                <label className={styles.searchLabel}>Day</label>
                <select className={styles.searchSelect} value={scheduleSearchDay === null ? 'all' : scheduleSearchDay} onChange={(e) => setScheduleSearchDay(e.target.value === 'all' ? null : parseInt(e.target.value))}>
                  <option value="all">All Days</option>
                  {days.map((day, idx) => (
                    <option key={idx} value={idx}>{day}</option>
                  ))}
                </select>
              </div>

              <div className={styles.searchGroup}>
                <label className={styles.searchLabel}>Room/Classroom</label>
                <input 
                  type="text" 
                  className={styles.searchInput2} 
                  placeholder="e.g., Lab-1, Room-101"
                  value={scheduleSearchRoom} 
                  onChange={(e) => setScheduleSearchRoom(e.target.value)}
                />
              </div>

              <div className={styles.searchGroup}>
                <label className={styles.searchLabel}>Class</label>
                <input 
                  type="text" 
                  className={styles.searchInput2} 
                  placeholder="e.g., BCS-1G, Lab"
                  value={scheduleSearchClass} 
                  onChange={(e) => setScheduleSearchClass(e.target.value)}
                />
              </div>
            </div>

            {/* Schedule Search Results */}
            {(() => {
              const results = getScheduleSearchResults();
              return (
                <div className={styles.searchResults}>
                  {results.length === 0 ? (
                    <div className={styles.noResults}>
                      <p>No classes match your search</p>
                    </div>
                  ) : (
                    <div className={styles.resultsList}>
                      {results.map((result, idx) => (
                        <div key={result.id} className={styles.resultCard}>
                          <div className={styles.resultHeader}>
                            <span className={styles.resultDay}>📅 {result.day}</span>
                            <span className={styles.resultTime}>🕐 {result.time}</span>
                          </div>
                          <div className={styles.resultDetails}>
                            <div className={styles.resultClass}>{result.class}</div>
                            <div className={styles.resultClassroom}>📍 {result.classroom}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Free Lab Classes Section */}
          <div className={styles.labSection}>
            <h2 className={styles.labMainTitle}>🧪 Free Classrooms</h2>
            <p className={styles.labSubtitle}>Find available classrooms for any day and time</p>
            
            {/* Day Selector */}
            <div className={styles.labDaySelector}>
              {days.map((day, idx) => (
                <button
                  key={`lab-day-${idx}`}
                  className={`${styles.labDayBtn} ${labDay === idx ? styles.labDayBtnActive : ''}`}
                  onClick={() => {
                    setLabDay(idx);
                    setLabTimeFilter(''); // reset time filter when day changes
                  }}
                >
                  {day}
                </button>
              ))}
            </div>

            {/* Search and Time Filter */}
            <div className={styles.labSearchBar}>
              <div className={styles.labSearchBox}>
                <span className={styles.labSearchIcon}>🔍</span>
                <input
                  type="text"
                  className={styles.labSearchInput}
                  placeholder="Search rooms by name, type"
                  value={labSearchQuery}
                  onChange={(e) => setLabSearchQuery(e.target.value)}
                />
              </div>

              <select 
                className={styles.labTimeSelect}
                value={labTimeFilter}
                onChange={(e) => setLabTimeFilter(e.target.value)}
              >
                <option value="">All Times</option>
                {getLabTimesForDay(labDay).map((time, idx) => (
                  <option key={idx} value={time}>{time}</option>
                ))}
              </select>
            </div>

            {/* Lab Results */}
            {(() => {
              const filteredLabs = getFilteredLabs();
              const totalLabs = getAllLabClasses().filter(lab => lab.dayNum === labDay).length;
              
              return (
                <div className={styles.labResultsWrapper}>
                  {filteredLabs.length > 0 && (
                    <p className={styles.labResultsInfo}>
                      Showing {filteredLabs.length} of {totalLabs} free rooms
                    </p>
                  )}
                  
                  {filteredLabs.length === 0 ? (
                    <div className={styles.noResults}>
                      <p>No lab classrooms available</p>
                    </div>
                  ) : (
                    <div className={styles.labGridCards}>
                      {filteredLabs.map((lab) => (
                        <div key={lab.id} className={styles.labCardNew}>
                          <div className={styles.labCardIcon}>🏢</div>
                          <div className={styles.labCardContent}>
                            <h3 className={styles.labCardTitle}>{lab.classroom}</h3>
                            <span className={styles.labCardBadge}>FREE</span>
                            <div className={styles.labCardType}>{lab.class}</div>
                            <div className={styles.labCardMeta}>
                              <span>👥 Capacity: {lab.capacity}</span>
                              <span>📍 {lab.floor}</span>
                            </div>
                            <div className={styles.labCardFooter}>
                              <span>📅 {lab.day}</span>
                              <span>⏰ {lab.time}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Free Rooms/Labs Finder Section */}
          <div className={styles.finderSection}>
            <h3 className={styles.finderTitle}>🔍 Find Free Rooms & Labs</h3>
            <div className={styles.finderControls}>
              <div className={styles.finderGroup}>
                <label className={styles.finderLabel}>Day</label>
                <select className={styles.finderSelect} value={finderDay} onChange={(e) => setFinderDay(parseInt(e.target.value))}>
                  {days.map((day, idx) => (
                    <option key={idx} value={idx}>{day}</option>
                  ))}
                </select>
              </div>

              <div className={styles.finderGroup}>
                <label className={styles.finderLabel}>From Time</label>
                <input 
                  type="time" 
                  className={styles.finderInput} 
                  value={finderStartTime} 
                  onChange={(e) => setFinderStartTime(e.target.value)}
                />
              </div>

              <div className={styles.finderGroup}>
                <label className={styles.finderLabel}>To Time</label>
                <input 
                  type="time" 
                  className={styles.finderInput} 
                  value={finderEndTime} 
                  onChange={(e) => setFinderEndTime(e.target.value)}
                />
              </div>

              <button className={styles.finderSearchBtn} onClick={handleFinderSearch}>Search</button>
            </div>

            {/* Finder Results */}
            {finderResults && (
              <div className={styles.finderResults}>
                <p className={styles.finderResultsInfo}>
                  Available on {finderResults.day} • {finderResults.start} - {finderResults.end}
                </p>
                {finderResults.rooms.length === 0 ? (
                  <div className={styles.noResults}>
                    <p>No rooms or labs available at this time</p>
                  </div>
                ) : (
                  <div className={styles.roomGrid}>
                    {finderResults.rooms.map((room, idx) => (
                      <div key={`finder-room-${idx}`} className={styles.roomCard}>
                        <div className={styles.roomCardHeader}>
                          <h3 className={styles.roomName}>{room.name}</h3>
                          <span className={styles.freeBadge}>AVAILABLE</span>
                        </div>
                        <div className={styles.roomCardBody}>
                          <p className={styles.cardLabel}>Classroom</p>
                          <div className={styles.roomInfo}>
                            <span className={styles.roomDetail}>👥 Capacity: {room.capacity}</span>
                            <span className={styles.roomDetail}>📍 {room.floor}</span>
                          </div>
                          <div className={styles.roomInfo}>
                            <span className={styles.roomDetail}>📅 {finderResults.day}</span>
                            <span className={styles.roomDetail}>🕐 {finderResults.start}-{finderResults.end}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Schedule */}
          {renderSchedule()}
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