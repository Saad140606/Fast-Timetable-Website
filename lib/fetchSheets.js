// Utility I wrote to fetch GViz JSON from Google Sheets and convert it
// into a simple JavaScript structure the app can use. Notes to self are
// included inline where parsing edge-cases are handled.

async function fetchJSONText(url){
  const res = await fetch(url);
  const text = await res.text();
  
  // Check for 404 or other errors
  if (res.status === 404) {
    throw new Error('Sheet not found or not published to web. Status: 404. The Google Sheet must be published to the web for GViz to access it. Please visit the sheet URL and use File > Share to publish it.');
  }
  if (res.status === 403) {
    throw new Error('Access denied to sheet. Status: 403. Make sure the sheet is shared with view access.');
  }
  if (!res.ok) {
    throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
  }
  
  // GViz responses are wrapped (e.g. )]}'\n...); ) — find the first JSON object start/end and parse safely
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if(first === -1 || last === -1) throw new Error('Unexpected GViz response format - no JSON found');
  const json = JSON.parse(text.slice(first, last + 1));
  return json;
}

function parseSheetRows(json){
  const rows = (json.table && json.table.rows) || [];
  const classes = [];
  
  console.log('[parseSheetRows] Total rows:', rows.length);
  
  if(rows.length === 0) {
    console.log('[parseSheetRows] ERROR: No rows in GViz response');
    return classes;
  }
  
  // Log first 3 rows for debugging
  console.log('[parseSheetRows] First 3 rows:');
  rows.slice(0, 3).forEach((r, i) => {
    const cells = r.c?.map(c => c?.v || '[empty]').join(' | ') || 'no cells';
    console.log(`  Row ${i}: ${cells}`);
  });
  
  // STRATEGY: Try TWO approaches
  // Approach 1: Assume row 0 is header (standard Google Sheets format)
  let headerRowIndex = 0;
  let classCount = 0;
  let classes1 = [];
  
  // Try approach 1: row 0 = header
  rows.forEach((row, rowIndex) => {
    if(rowIndex === 0) return; // Skip header
    
    const firstCellInRow = row.c && row.c[0] && row.c[0].v ? String(row.c[0].v).trim().replace(/\s+/g, ' ') : '';
    (row.c || []).forEach((cell, colIndex) => {
      if(colIndex === 0) return; // Skip first column
      if(!cell || !cell.v) return;
      
      const slot = (json.table.rows[0] && json.table.rows[0].c[colIndex] && json.table.rows[0].c[colIndex].v) ? String(json.table.rows[0].c[colIndex].v).trim().replace(/\s+/g, ' ') : '';
      const value = String(cell.v).trim().replace(/\s+/g, ' ');
      
      classes1.push({
        val: value,
        location: firstCellInRow,
        slot: slot,
        time: ''
      });
      classCount++;
    });
  });
  
  console.log('[parseSheetRows] Approach 1 (row 0 = header): parsed', classCount, 'classes');
  
  // If approach 1 worked, use it
  if(classCount > 0){
    console.log('[parseSheetRows] Using Approach 1');
    return classes1;
  }
  
  // APPROACH 2: If no classes found, try finding header row that contains time-like strings
  console.log('[parseSheetRows] Trying Approach 2 (search for header row)');
  headerRowIndex = 1; // default
  for(let i=0;i<Math.min(4, rows.length);i++){
    const r = rows[i];
    if(!r || !r.c) continue;
    const hasTimeLike = r.c.some(cell => cell && cell.v && /\d{1,2}:\d{2}\s*-/.test(String(cell.v)) );
    if(hasTimeLike){ headerRowIndex = i; break; }
  }
  console.log('[parseSheetRows] Detected headerRowIndex:', headerRowIndex);
  
  let classes2 = [];
  rows.forEach((row, rowIndex) => {
    if(rowIndex <= headerRowIndex) return; // Skip header and rows before it
    
    const firstCellInRow = row.c && row.c[0] && row.c[0].v ? String(row.c[0].v).trim().replace(/\s+/g, ' ') : '';
    (row.c || []).forEach((cell, colIndex) => {
      if(colIndex === 0) return; // Skip first column
      if(!cell || !cell.v) return;
      
      const slot = (json.table.rows[headerRowIndex] && json.table.rows[headerRowIndex].c[colIndex] && json.table.rows[headerRowIndex].c[colIndex].v) ? String(json.table.rows[headerRowIndex].c[colIndex].v).trim().replace(/\s+/g, ' ') : '';
      const value = String(cell.v).trim().replace(/\s+/g, ' ');
      
      classes2.push({
        val: value,
        location: firstCellInRow,
        slot: slot,
        time: ''
      });
    });
  });
  
  console.log('[parseSheetRows] Approach 2: parsed', classes2.length, 'classes');
  console.log('[parseSheetRows] Using Approach 2');
  return classes2;
}

export async function fetchConfig(configUrl){
  const res = await fetch(configUrl);
  const text = await res.text();
  try{
    return JSON.parse(text);
  }catch(e){
    // fallback: try to extract JSON object from wrapped text
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if(first===-1||last===-1) throw e;
    return JSON.parse(text.slice(first, last+1));
  }
}

export async function fetchSheetPage(baseUrl, code){
  // baseUrl is expected to end with something like "&gid=" or include the query up to gid param
  const url = baseUrl + code.gid;
  console.log('[fetchSheetPage] Fetching:', code.name, 'URL:', url);
  try{
    const json = await fetchJSONText(url);
    const classes = parseSheetRows(json);
    console.log('[fetchSheetPage] Got', classes.length, 'classes for', code.name);
    return { sheet: code.name, classes };
  }catch(err){
    console.error('[fetchSheetPage] ERROR fetching', code.name, ':', err);
    throw err;
  }
}

export async function fetchAllSheetsFromConfig(config, regionKey = 'karachi'){
  // config should contain regionKey -> { url, codes }
  const region = config[regionKey] || config;
  const baseUrl = region.url;
  const codes = region.codes || [];
  const promises = codes.map(code => fetchSheetPage(baseUrl, code));
  return Promise.all(promises);
}

export default { fetchConfig, fetchSheetPage, fetchAllSheetsFromConfig }