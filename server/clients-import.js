// Turns HR's client list (Excel or CSV) into server/clients.json, with checks.
// Used by `npm run import:clients` and by the tests. Reads only the site name (and, if the sheet has them,
// a Folder, a Location, an Installation date and an AMC expiry column). Phone numbers, addresses and the rest of the sheet are never copied.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

export const MAX_NAME = 100;                                     // longest Google Sheet tab name
const FOLDER_BAD = /["*:<>?/\\|\u0000-\u001f]/;                  // not allowed in a Windows / OneDrive folder name
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INDIA = { lat: [6, 38], lng: [68, 98] };

// ---------- reading the sheet ----------
const textOf = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    return '';
  }
  return String(v);
};

export async function readSheet(file, { sheet, column } = {}) {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(file)) await wb.csv.readFile(file); else await wb.xlsx.readFile(file);
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0];
  if (!ws) throw new Error(`There is no sheet called "${sheet}" in ${path.basename(file)}.`);
  const grid = [];
  for (let r = 1; r <= ws.rowCount; r++) { const row = ws.getRow(r), cells = []; for (let c = 1; c <= Math.max(ws.columnCount, 1); c++) cells.push(textOf(row.getCell(c).value)); grid.push(cells); }
  return { sheetName: ws.name, grid, column };
}

// Finds the header row and the columns. The header can be a plain "Client" or a title like "AMC site list above 1 Lakh".
export function mapColumns({ grid, column }) {
  const filled = (c, from) => grid.slice(from).filter((row) => (row[c] || '').trim() !== '').length;
  // A column given as a heading text also tells us the heading row; a letter does not.
  let foundRow = -1;
  const colIdx = (spec) => {
    if (/^[A-Za-z]{1,2}$/.test(spec)) return [...spec.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    for (let r = 0; r < Math.min(grid.length, 15); r++) { const i = grid[r].findIndex((t) => t.trim().toLowerCase() === spec.trim().toLowerCase()); if (i >= 0) { foundRow = r; return i; } }
    return -1;
  };
  const HEADING = /site|client|name|party|customer|list|folder/i;
  let headerRow = -1, nameCol = -1, headerless = false;
  if (column) {
    // the person chose the column: its first filled cell is the heading if it reads like one, otherwise the list has no heading
    nameCol = colIdx(column);
    if (nameCol < 0) throw new Error(`Column "${column}" was not found. Use a letter (C) or the heading text.`);
    const first = grid.findIndex((row) => (row[nameCol] || '').trim() !== '');
    headerRow = foundRow >= 0 ? foundRow : first >= 0 && first < 15 && HEADING.test(grid[first][nameCol]) ? first : -1;
    headerless = headerRow < 0;
  } else {
    // header row: the first of the top rows with a heading-like cell. Of several, the heading with the most names under it
    // wins, so an empty "Customer Name" column loses to "AMC site list".
    for (let r = 0; r < Math.min(grid.length, 15) && headerRow < 0; r++) {
      const hits = grid[r].map((t, c) => ({ t, c })).filter((x) => x.t.trim() && HEADING.test(x.t));
      if (hits.length) { headerRow = r; hits.sort((a, b) => filled(b.c, r + 1) - filled(a.c, r + 1) || a.c - b.c); nameCol = hits[0].c; }
    }
    if (nameCol < 0 || filled(nameCol, headerRow + 1) === 0) {            // a plain pasted list with no heading
      nameCol = grid[0].map((_, c) => c).sort((a, b) => filled(b, 0) - filled(a, 0))[0];
      headerRow = -1; headerless = true;
    }
  }
  const heading = headerRow >= 0 ? grid[headerRow] : [];
  const find = (re) => heading.findIndex((t, c) => c !== nameCol && re.test(t.trim()));
  return {
    headerRow, nameCol, headerless,
    folderCol: find(/^(onedrive\s+)?folder(\s+name)?$/i),
    installedCol: find(/^(date\s+of\s+)?install(ation|ed)(\s+date|\s+on)?$/i),
    amcExpiryCol: find(/^amc\s+(expiry|expires|end)(\s+date)?$/i),     // never the contract "start date" / "end date" columns of the AMC list
    locationCol: find(/^(location|maps?(\s+link)?|google\s+maps|lat\s*[,/]?\s*lng|coordinates)$/i),
    nameHeading: headerless ? '(no heading)' : heading[nameCol],
  };
}

// ---------- cleaning and checking one value ----------
export function cleanName(raw) {
  const fixes = [];
  let s = String(raw).replace(/[ ​\t\r\n]+/g, ' ');
  if (s !== String(raw)) fixes.push('hidden space or tab character replaced');
  const trimmed = s.trim().replace(/\s{2,}/g, ' ');
  if (trimmed !== s.trim()) fixes.push('extra spaces removed');
  else if (s !== s.trim()) fixes.push('leading or trailing space removed');
  s = trimmed;
  const noDot = s.replace(/[. ]+$/, '');                                   // Windows and OneDrive drop a trailing dot from a folder name
  if (noDot !== s) { fixes.push('trailing dot removed'); s = noDot; }
  return { value: s, fixes };
}

// A date typed by the company: 2027-03-31, 31-03-2027, 31/03/2027 or an Excel date. Day first, as in India. Returns '' (empty), a date text, or undefined (not a date).
export function parseDate(text) {
  const t = String(text).trim(); if (!t) return '';
  let y, m, d, x;
  if ((x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) [d, m, y] = [+x[1], +x[2], +x[3]];
  else return undefined;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return !Number.isNaN(Date.parse(iso)) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso && y >= 2000 && y <= 2100 ? iso : undefined;
}

export function parseLocation(text) {
  const t = String(text).trim(); if (!t) return null;
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [new RegExp(`@${num},\\s*${num}`), new RegExp(`!3d${num}!4d${num}`), new RegExp(`[?&](?:q|ll|query|destination)=${num}(?:,|%2C)\\s*${num}`), new RegExp(`^${num}\\s*[,;\\s]\\s*${num}$`)];
  for (const re of patterns) { const m = t.match(re); if (m) return { lat: +m[1], lng: +m[2] }; }
  return undefined;                                                         // there is text, but it is not a position
}

const keyOf = (s) => s.toLowerCase().replace(/\s+/g, ' ');
const tabOf = (s) => s.replace(/[\\/:*?"<>|\[\]]/g, '-').trim().slice(0, 100).toLowerCase();   // same as safeName in server/util.js, compared without case

// ---------- the whole import ----------
// existing: the current clients.json list (ids are kept for clients that are still in the sheet)
export function buildClients({ grid, column }, existing = [], { replaceAll = false, allowRemove = false } = {}) {
  const map = mapColumns({ grid, column });
  const problems = [], fixes = [], rows = [], skipped = [];
  for (let r = map.headerRow + 1; r < grid.length; r++) {
    const rawName = (grid[r][map.nameCol] || '');
    if (!rawName.trim()) { if (grid[r].some((t) => t.trim())) skipped.push(r + 1); continue; }   // e.g. the next contract year of the same site
    const rowNo = r + 1, { value: name, fixes: f } = cleanName(rawName);
    for (const x of f) fixes.push({ row: rowNo, client: name, fix: x });
    const folderRaw = map.folderCol >= 0 ? (grid[r][map.folderCol] || '') : '';
    const folder = folderRaw.trim() ? cleanName(folderRaw).value : name;
    const entry = { row: rowNo, name, folder };
    const bad = (problem, suggestion) => problems.push({ row: rowNo, client: name || rawName, problem, suggestion });
    if (!name) bad('the name is empty after cleaning', 'fix the cell in the sheet');
    if (name.length > MAX_NAME) bad(`the name is ${name.length} characters (the Google Sheet tab limit is ${MAX_NAME})`, 'shorten the name');
    if (FOLDER_BAD.test(folder)) bad(`the folder name has a character Windows and OneDrive do not allow: ${folder.match(FOLDER_BAD)[0]}`, 'rename the site and its OneDrive folder, then fix the sheet');
    if (RESERVED.test(folder)) bad(`"${folder}" is a reserved Windows name`, 'rename the site');
    if (map.locationCol >= 0 && (grid[r][map.locationCol] || '').trim()) {
      const loc = parseLocation(grid[r][map.locationCol]);
      if (loc === undefined) bad(`the location "${grid[r][map.locationCol]}" is not a position`, 'use "19.99, 73.78" or a Google Maps link');
      else if (loc.lat < INDIA.lat[0] || loc.lat > INDIA.lat[1] || loc.lng < INDIA.lng[0] || loc.lng > INDIA.lng[1]) bad(`the location ${loc.lat}, ${loc.lng} is outside India, are latitude and longitude swapped?`, 'check the location');
      else Object.assign(entry, loc);
    }
    for (const [col, field, what] of [[map.installedCol, 'installed', 'installation date'], [map.amcExpiryCol, 'amcExpiry', 'AMC expiry date']]) {
      if (col < 0 || !(grid[r][col] || '').trim()) continue;
      const d = parseDate(grid[r][col]);
      if (d === undefined) bad(`the ${what} "${grid[r][col]}" is not a date`, 'use 31-03-2027 (day-month-year)'); else entry[field] = d;
    }
    if (entry.installed && entry.amcExpiry && entry.amcExpiry < entry.installed) bad('the AMC expiry is before the installation date', 'check both dates');
    rows.push(entry);
  }
  // exact duplicates (ignoring case and spacing) would share a folder or a sheet tab. Similar names are fine.
  const seenName = new Map(), seenFolder = new Map(), seenTab = new Map();
  for (const e of rows) {
    for (const [seen, key, what] of [[seenName, keyOf(e.name), 'name'], [seenFolder, keyOf(e.folder), 'folder'], [seenTab, tabOf(e.name), 'sheet tab name']]) {
      if (seen.has(key)) problems.push({ row: e.row, client: e.name, problem: `same ${what} as row ${seen.get(key)}`, suggestion: 'one of them is a duplicate, or the names need to differ' });
      else seen.set(key, e.row);
    }
  }
  if (!rows.length) problems.push({ row: '-', client: '-', problem: 'no client names were found', suggestion: 'check the sheet, or pass --column' });

  // ids: stable. A client that is already known keeps its id.
  const byFolder = new Map(existing.map((c) => [keyOf(c.folder), c])), byName = new Map(existing.map((c) => [keyOf(c.name), c]));
  const num = (id) => +String(id).replace(/\D/g, '') || 0;
  const width = Math.max(2, String(replaceAll ? rows.length : Math.max(rows.length, ...existing.map((c) => num(c.id)), 0)).length);
  let next = replaceAll ? 0 : Math.max(0, ...existing.map((c) => num(c.id)));
  const used = new Set();
  const clients = rows.map((e) => {
    const old = replaceAll ? null : byFolder.get(keyOf(e.folder)) || byName.get(keyOf(e.name));
    const id = old && !used.has(old.id) ? old.id : `c${String(++next).padStart(width, '0')}`;
    used.add(id);
    const out = { id, name: e.name, folder: e.folder };
    if (e.lat !== undefined) { out.lat = e.lat; out.lng = e.lng; }
    if (e.installed) out.installed = e.installed;
    if (e.amcExpiry) out.amcExpiry = e.amcExpiry;
    return out;
  });
  const gone = replaceAll ? [] : existing.filter((c) => !used.has(c.id));
  if (gone.length && !allowRemove) problems.push({ row: '-', client: gone.map((c) => c.name).join(', '), problem: `${gone.length} client(s) in the current list are not in the sheet. Visits already stored use their ids.`, suggestion: 'add them back to the sheet, or run again with --allow-remove' });
  clients.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }));
  return { clients, problems, fixes, skipped, map, removed: gone };
}

// ---------- file level ----------
export async function importClients({ file, out, sheet, column, replaceAll = false, allowRemove = false, dryRun = false }) {
  const data = await readSheet(file, { sheet, column });
  let existing = [];
  try { existing = JSON.parse(await fs.readFile(out, 'utf8')); } catch { /* first import */ }
  const result = buildClients(data, existing, { replaceAll, allowRemove });
  const ok = result.problems.length === 0;
  let written = false;
  if (ok && !dryRun) { await fs.writeFile(out, JSON.stringify(result.clients, null, 2) + '\n'); written = true; }
  return { ...result, ok, written, sheetName: data.sheetName };
}

// A problem list for a client list that is already in clients.json (used by the tests and by the importer's own checks)
export function checkClientList(clients) {
  const problems = [];
  const seen = { id: new Set(), name: new Map(), folder: new Map(), tab: new Map() };
  clients.forEach((c, i) => {
    const row = i + 1, bad = (p) => problems.push({ row, client: c.name, problem: p });
    if (!/^c\d+$/.test(c.id || '')) bad('id is not like c01');
    if (seen.id.has(c.id)) bad('duplicate id'); seen.id.add(c.id);
    if (!c.name || c.name !== c.name.trim() || /\s{2,}/.test(c.name)) bad('name has extra spaces');
    if (!c.folder || c.folder !== c.folder.trim() || /\s{2,}/.test(c.folder)) bad('folder has extra spaces');
    if (/[. ]$/.test(c.folder || '')) bad('folder ends with a dot or space');
    if (FOLDER_BAD.test(c.folder || '') || RESERVED.test(c.folder || '')) bad('folder name not allowed by Windows or OneDrive');
    if ((c.name || '').length > MAX_NAME) bad('name too long for a sheet tab');
    if (c.inverters !== undefined) bad('"inverters" must not be on a client: the cleaner sets it on each visit');
    if ((c.lat === undefined) !== (c.lng === undefined)) bad('lat without lng or the other way round');
    for (const k of ['installed', 'amcExpiry']) if (c[k] !== undefined && parseDate(c[k]) !== c[k]) bad(`${k} is not a date like 2027-03-31`);
    for (const [m, k, what] of [[seen.name, keyOf(c.name || ''), 'name'], [seen.folder, keyOf(c.folder || ''), 'folder'], [seen.tab, tabOf(c.name || ''), 'sheet tab name']]) {
      if (m.has(k)) bad(`same ${what} as row ${m.get(k)}`); else m.set(k, row);
    }
  });
  return problems;
}
