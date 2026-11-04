// Everything about the visit form in ONE place: photo boxes, checklist items, sheet columns, and the rules
// that turn a visit into a sheet row. Change a label or add a checklist item here.
import { httpError } from './storage/local.js';
import { istDate, distanceM } from './util.js';

// ---------- photo boxes (the Inverter boxes depend on the client) ----------
export const MAX_INVERTERS = 12;
export const inverterCount = (client) => (Number.isInteger(client?.inverters) && client.inverters >= 1 && client.inverters <= MAX_INVERTERS ? client.inverters : 1);

// Every box takes several photos, from the camera or the gallery. Only Before and After need a location.
export function boxesFor(client) {
  const n = inverterCount(client);
  return [
    { key: 'Before', label: 'BEFORE', group: 'Site photos', gps: true, required: true, hint: 'Panels before cleaning' },
    { key: 'After', label: 'AFTER', group: 'Site photos', gps: true, required: true, hint: 'Panels after cleaning' },
    ...Array.from({ length: n }, (_, i) => ({ key: `Inverter${i + 1}`, label: `INVERTER ${i + 1}`, group: 'Inverters', inverter: true, gps: false, required: true, hint: 'Photo of the display' })),
    { key: 'Challan', label: 'CHALLAN', group: 'Paperwork', gps: false, required: true, hint: 'Signed cleaning receipt' },
    { key: 'Bill', label: 'BILL', group: 'Paperwork', gps: false, required: true, hint: 'Bill or receipt' },
  ];
}

// ---------- checklist ----------
export const ELECTRICAL_OPTIONS = ['ON', 'OFF', 'N/A'];   // ON is the normal state
export const ELECTRICAL = [
  { key: 'ACDB', label: 'ACDB', header: 'ACDB' },
  { key: 'Inverter', label: 'Inverter', header: 'Inverter' },
  { key: 'DCDB', label: 'DCDB', header: 'DCDB' },
  { key: 'Internet', label: 'Internet (monitoring online)', header: 'Internet' },
  { key: 'MCB', label: 'MCB', header: 'MCB' },
  { key: 'SPD', label: 'SPD', header: 'SPD' },
  { key: 'EarthingTrip', label: 'Earthing Trip', header: 'Earthing Trip' },
];
export const YES_NO = ['Yes', 'No'];
export const SIGNATURES = [
  { key: 'customer', label: 'Customer signature present', header: 'Customer signature' },
  { key: 'supervisor', label: 'Cleaning supervisor signature present', header: 'Supervisor signature' },
];
export const WORK = [
  { key: 'sessionCleaning', label: 'Session cleaning completed', header: 'Session cleaning' },
  { key: 'washed', label: 'Solar panels washed with water', header: 'Washed with water' },
  { key: 'inverterRoom', label: 'Inverter room condition checked (dust-free and proper ventilation)', header: 'Inverter room checked' },
  { key: 'earthingPit', label: 'Earthing pit inspection checked', header: 'Earthing pit checked' },
];
export const OVERALL = ['Completed', 'Partly completed', 'Not completed'];

// What the app sends to the phone so the form is built from this file.
export const formConfig = () => ({ electricalOptions: ELECTRICAL_OPTIONS, electrical: ELECTRICAL, signatures: SIGNATURES, work: WORK, yesNo: YES_NO, overall: OVERALL });

// ---------- sheet columns (order = order in the sheet) ----------
const photoCol = (key, header, width = 105) => ({ key, header, group: 'Photos', width });
export const COLUMNS = [
  { key: 'date', header: 'Visit date', width: 110 },
  { key: 'at', header: 'Submitted at (IST)', width: 150 },
  { key: 'cleaner', header: 'Cleaner', width: 110 },
  photoCol('Before', 'Before'), photoCol('After', 'After'), photoCol('Inverters', 'Inverters', 135), photoCol('Challan', 'Challan'), photoCol('Bill', 'Bill'),
  ...ELECTRICAL.map((e) => ({ key: `e:${e.key}`, header: e.header, group: 'Electrical checklist', width: 90 })),
  ...SIGNATURES.map((s) => ({ key: `s:${s.key}`, header: s.header, group: 'Signatures', width: 120 })),
  ...WORK.map((w) => ({ key: `w:${w.key}`, header: w.header, group: 'Work done', width: 120 })),
  { key: 'beforeTaken', header: 'Before photos taken', group: 'Work done', width: 120 },
  { key: 'afterTaken', header: 'After photos taken', group: 'Work done', width: 120 },
  { key: 'overall', header: 'Overall status', group: 'Result', width: 130 },
  { key: 'defects', header: 'Defects', group: 'Result', width: 85 },
  { key: 'details', header: 'Defect details', group: 'Result', width: 300 },
  { key: 'checks', header: 'Checks', group: 'Result', width: 300 },
  { key: 'folder', header: 'Photo folder', group: 'Result', width: 290 },
];
export const HEADERS = COLUMNS.map((c) => c.header);
export const colIndex = (key) => { const i = COLUMNS.findIndex((c) => c.key === key); if (i < 0) throw new Error(`no column ${key}`); return i; };
// Consecutive columns with the same group, e.g. [{ name: 'Photos', from: 3, to: 7 }, ...]
export const GROUP_SPANS = COLUMNS.reduce((out, c, i) => {
  if (!c.group) return out;
  const last = out[out.length - 1];
  if (last && last.name === c.group && last.to === i - 1) last.to = i; else out.push({ name: c.group, from: i, to: i });
  return out;
}, []);

// ---------- answers ----------
export function validateAnswers(a) {
  const bad = (m) => { throw httpError(400, m); };
  if (!a || typeof a !== 'object') bad('The checklist answers are missing');
  const out = { electrical: {}, signatures: {}, work: {} };
  for (const e of ELECTRICAL) { const v = a.electrical?.[e.key]; if (!ELECTRICAL_OPTIONS.includes(v)) bad(`Please answer ON, OFF or N/A for ${e.label}`); out.electrical[e.key] = v; }
  for (const s of SIGNATURES) { const v = a.signatures?.[s.key]; if (!YES_NO.includes(v)) bad(`Please answer Yes or No: ${s.label}`); out.signatures[s.key] = v; }
  for (const w of WORK) { const v = a.work?.[w.key]; if (!YES_NO.includes(v)) bad(`Please answer Yes or No: ${w.label}`); out.work[w.key] = v; }
  if (!OVERALL.includes(a.overall)) bad('Please choose the overall status');
  out.overall = a.overall;
  return out;
}

// ---------- where a photo's location came from ----------
export const LOC = { EXIF: 'photo EXIF', PHONE: 'phone at upload', NONE: 'none' };
export const locationSourceFrom = (code, hasCoords) => (code === 'exif' ? LOC.EXIF : code === 'phone' ? LOC.PHONE : code === 'none' ? LOC.NONE : hasCoords ? LOC.PHONE : LOC.NONE);

// 'verified'  : read from the photo itself (EXIF) or the phone's live location at a live camera shot
// 'unverified': a gallery photo with the phone's location at upload time, or no location at all
// 'none'      : a camera shot but no location could be found
export function locationVerdict(p) {
  const src = p.locationSource || (p.lat != null ? LOC.PHONE : LOC.NONE);
  const capture = p.capture || 'camera';
  if (src === LOC.EXIF) return 'verified';
  if (src === LOC.PHONE && capture === 'camera') return 'verified';
  if (src === LOC.NONE && capture === 'camera') return 'none';
  return 'unverified';
}

// ---------- the checks note, the sheet row ----------
export const photoCount = (visit, key) => Object.values(visit.photos).filter((p) => p.box === key).length;
export const missingPhotos = (visit, boxes) => boxes.filter((b) => b.required && !photoCount(visit, b.key)).map((b) => b.label[0] + b.label.slice(1).toLowerCase());

export function buildChecks(visit, client, boxes, { gpsMaxDistanceM = 300 } = {}) {
  // Notes are grouped by problem, so many photos do not make a long list: "Location not verified: Before_1, Before_2"
  const noGps = [], unverified = [], far = [], dates = new Map();
  const photos = Object.values(visit.photos).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const p of photos) {
    const box = boxes.find((b) => b.key === p.box), label = p.name.replace('.jpg', '');
    if (box?.gps) {
      const verdict = locationVerdict(p);
      if (verdict === 'none') noGps.push(label);
      else if (verdict === 'unverified') unverified.push(label);
      if (p.lat != null && p.lng != null && client.lat !== undefined) {
        const d = Math.round(distanceM(p.lat, p.lng, client.lat, client.lng));
        if (d > gpsMaxDistanceM) far.push(`${label} (${d} m)`);
      }
    }
    // Only a date we can trust is compared with the visit date: the photo's own EXIF date, or a live camera shot.
    if (p.takenAt && (p.takenSource === 'exif' || p.takenSource === 'camera' || p.takenSource === undefined) && istDate(p.takenAt) !== visit.date) {
      const day = istDate(p.takenAt); dates.set(day, [...(dates.get(day) || []), label]);
    }
  }
  const notes = [];
  if (noGps.length) notes.push(`No GPS: ${noGps.join(', ')}`);
  if (unverified.length) notes.push(`Location not verified: ${unverified.join(', ')}`);
  if (far.length) notes.push(`Far from site: ${far.join(', ')}`);
  for (const [day, labels] of dates) notes.push(`Taken on ${day}: ${labels.join(', ')}`);
  const missing = missingPhotos(visit, boxes);
  if (missing.length) notes.push(`No photo: ${missing.join(', ')}`);
  return notes.length ? notes.join('; ') : 'OK';
}

export function buildRow({ visit, client, boxes, answers, defects, details, submittedAt, rootFolder, gpsMaxDistanceM }) {
  const up = (k) => (photoCount(visit, k) ? `Uploaded (${photoCount(visit, k)})` : 'Not uploaded');
  const inv = boxes.filter((b) => b.inverter), have = inv.filter((b) => photoCount(visit, b.key)).length;
  const cell = {
    date: visit.date, at: submittedAt, cleaner: visit.cleaner,
    Before: up('Before'), After: up('After'), Inverters: `${have} of ${inv.length} uploaded`, Challan: up('Challan'), Bill: up('Bill'),
    beforeTaken: photoCount(visit, 'Before') ? 'Yes' : 'No', afterTaken: photoCount(visit, 'After') ? 'Yes' : 'No',
    overall: answers.overall, defects, details, checks: buildChecks(visit, client, boxes, { gpsMaxDistanceM }),
    folder: `${rootFolder}/${client.folder}/${visit.date}`,
  };
  for (const e of ELECTRICAL) cell[`e:${e.key}`] = answers.electrical[e.key];
  for (const s of SIGNATURES) cell[`s:${s.key}`] = answers.signatures[s.key];
  for (const w of WORK) cell[`w:${w.key}`] = answers.work[w.key];
  return COLUMNS.map((c) => cell[c.key]);
}

// For the HR page: what needs attention in one visit.
export function attention(visit, boxes, answers) {
  return {
    missing: missingPhotos(visit, boxes),
    off: ELECTRICAL.filter((e) => answers.electrical[e.key] === 'OFF').map((e) => e.header),
    noSignature: SIGNATURES.filter((s) => answers.signatures[s.key] === 'No').map((s) => s.header),
    notDone: WORK.filter((w) => answers.work[w.key] === 'No').map((w) => w.header),
    notCompleted: answers.overall !== 'Completed',
  };
}
