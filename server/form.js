// Everything about the visit form in ONE place: photo boxes, checklist items, sheet columns, and the rules
// that turn a visit into a sheet row. Change a label or add a checklist item here.
import { httpError } from './storage/local.js';
import { istDate, istDateTime, distanceM } from './util.js';

// ---------- photo boxes ----------
// The cleaner decides how many inverters a site has: the form starts with one Inverter box and he adds more.
// The count travels with the visit. Clients carry no inverter data.
export const MAX_INVERTERS = 12;
export const clampInverters = (n) => (Number.isInteger(n) && n >= 1 && n <= MAX_INVERTERS ? n : null);
const INVERTER_KEY = /^Inverter([1-9]\d?)$/;
export const inverterIndex = (key) => { const m = INVERTER_KEY.exec(key); return m ? +m[1] : 0; };
const FIXED_BOXES = ['Before', 'After', 'EarthingPitBefore', 'EarthingPitAfter', 'Challan', 'Bill', 'Signature'];
export const isBoxKey = (key) => FIXED_BOXES.includes(key) || (inverterIndex(key) >= 1 && inverterIndex(key) <= MAX_INVERTERS);
// The count of inverter boxes the visit really has: what the cleaner declared, but never fewer than the highest one he uploaded to.
export function declaredInverters(visit, declared) {
  const highest = Math.max(0, ...Object.values(visit.photos).map((p) => inverterIndex(p.box)));
  return Math.max(clampInverters(declared) ?? 1, highest);
}

// Every box takes several photos, from the camera or the gallery. Only Before and After need a location.
// Only Inverter 1 is compulsory: a site may have just one, and the cleaner adds a box for each extra inverter he wants to photograph.
export function boxesFor(inverters) {
  const n = clampInverters(inverters) ?? 1;
  return [
    { key: 'Before', label: 'BEFORE', group: 'Site photos', gps: true, required: true, hint: 'Panels before cleaning' },
    { key: 'After', label: 'AFTER', group: 'Site photos', gps: true, required: true, hint: 'Panels after cleaning' },
    ...Array.from({ length: n }, (_, i) => ({ key: `Inverter${i + 1}`, label: `INVERTER ${i + 1}`, group: 'Inverters', inverter: true, gps: false, required: i === 0, hint: i === 0 ? 'Photo of the display' : 'Only if there is one' })),
    { key: 'EarthingPitBefore', label: 'EARTHING PIT BEFORE', group: 'Earthing pit', gps: false, required: true, hint: 'Before cleaning the pit' },
    { key: 'EarthingPitAfter', label: 'EARTHING PIT AFTER', group: 'Earthing pit', gps: false, required: true, hint: 'After cleaning the pit' },
    { key: 'Challan', label: 'CHALLAN', group: 'Paperwork', gps: false, required: true, hint: 'Signed cleaning receipt' },
    { key: 'Bill', label: 'BILL', group: 'Paperwork', gps: false, required: true, hint: 'Bill or receipt' },
  ];
}

// ---------- checklist ----------
const ON_OFF_NA = ['ON', 'OFF', 'N/A'];   // the first option is the normal state
export const ELECTRICAL_OPTIONS = ON_OFF_NA;
export const ELECTRICAL = [
  { key: 'ACDB', label: 'ACDB (MCB ON / OFF)', header: 'ACDB', options: ON_OFF_NA },
  { key: 'Inverter', label: 'Inverter', header: 'Inverter', options: ON_OFF_NA },
  { key: 'DCDB', label: 'DCDB', header: 'DCDB', options: ON_OFF_NA },
  { key: 'Internet', label: 'Internet (connection status)', header: 'Internet', options: ['BLUE', 'OFF', 'N/A'], note: 'BLUE light = connected' },
  { key: 'ACSPD', label: 'AC SPD', header: 'AC SPD', options: ON_OFF_NA },
  { key: 'DCSPD', label: 'DC SPD', header: 'DC SPD', options: ON_OFF_NA },
  { key: 'EarthingTrip', label: 'Earthing Trip', header: 'Earthing Trip', options: ON_OFF_NA },
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
export const formConfig = () => ({ boxes: boxesFor(1), maxInverters: MAX_INVERTERS, electrical: ELECTRICAL, signatures: SIGNATURES, work: WORK, yesNo: YES_NO, overall: OVERALL });

// ---------- sheet columns (order = order in the sheet) ----------
const photoCol = (key, header, width = 105) => ({ key, header, group: 'Photos', width });
export const COLUMNS = [
  { key: 'date', header: 'Visit date', width: 110 },
  { key: 'at', header: 'Submitted at (IST)', width: 150 },
  { key: 'cleaner', header: 'Cleaner', width: 110 },
  photoCol('Before', 'Before'), photoCol('After', 'After'), photoCol('Inverters', 'Inverters', 120),
  photoCol('EarthingPitBefore', 'Earthing pit before', 120), photoCol('EarthingPitAfter', 'Earthing pit after', 120),
  photoCol('Challan', 'Challan'), photoCol('Bill', 'Bill'),
  ...ELECTRICAL.map((e) => ({ key: `e:${e.key}`, header: e.header, group: 'Electrical checklist', width: 90 })),
  ...SIGNATURES.map((s) => ({ key: `s:${s.key}`, header: s.header, group: 'Signatures', width: 120 })),
  { key: 'clientSign', header: 'Client signature', group: 'Signatures', width: 190 },
  ...WORK.map((w) => ({ key: `w:${w.key}`, header: w.header, group: 'Work done', width: 120 })),
  { key: 'beforeTaken', header: 'Before photos taken', group: 'Work done', width: 120 },
  { key: 'afterTaken', header: 'After photos taken', group: 'Work done', width: 120 },
  { key: 'overall', header: 'Overall status', group: 'Result', width: 130 },
  { key: 'defects', header: 'Defects', group: 'Result', width: 85 },
  { key: 'details', header: 'Defect details', group: 'Result', width: 300 },
  { key: 'checks', header: 'Checks', group: 'Result', width: 300 },
  { key: 'folder', header: 'Photo folder', group: 'Result', width: 290 },
  { key: 'installed', header: 'Installed on', group: 'AMC', width: 110 },
  { key: 'amcExpiry', header: 'AMC expiry', group: 'AMC', width: 110 },
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
  for (const e of ELECTRICAL) { const v = a.electrical?.[e.key]; if (!e.options.includes(v)) bad(`Please choose ${e.options.join(', ')} for ${e.label}`); out.electrical[e.key] = v; }
  for (const s of SIGNATURES) { const v = a.signatures?.[s.key]; if (!YES_NO.includes(v)) bad(`Please answer Yes or No: ${s.label}`); out.signatures[s.key] = v; }
  for (const w of WORK) { const v = a.work?.[w.key]; if (!YES_NO.includes(v)) bad(`Please answer Yes or No: ${w.label}`); out.work[w.key] = v; }
  if (!OVERALL.includes(a.overall)) bad('Please choose the overall status');
  out.overall = a.overall;
  return out;
}

// ---------- the client's signature, drawn on the phone ----------
// The picture itself is uploaded like a photo (box "Signature"). This record says whether it was taken and when.
export const SIGNATURE_STATUS = ['signed', 'unavailable'];
export function validateSignature(sig) {
  if (sig === undefined || sig === null) return null;                    // an older phone app: counted as "not taken"
  const bad = (m) => { throw httpError(400, m); };
  if (typeof sig !== 'object' || !SIGNATURE_STATUS.includes(sig.status)) bad('The client signature answer is not valid');
  if (sig.status === 'unavailable') {
    const reason = String(sig.reason || '').trim().slice(0, 200);
    if (reason.length < 3) bad('Please write why the client could not sign');
    return { status: 'unavailable', reason };
  }
  const at = Number(sig.signedAt);
  if (!Number.isFinite(at) || at <= 0) bad('The signing time is missing');
  return { status: 'signed', signedAt: at };
}
export const signatureState = (visit) => (visit.signature?.status === 'signed' && photoCount(visit, 'Signature') > 0 ? 'signed'
  : visit.signature?.status === 'signed' ? 'image missing' : visit.signature?.status === 'unavailable' ? 'unavailable' : 'none');
const signatureCell = (visit) => {
  switch (signatureState(visit)) {
    case 'signed': return `Signed ${istDateTime(visit.signature.signedAt)}`;
    case 'image missing': return 'Signed (picture missing)';
    case 'unavailable': return `Not available: ${visit.signature.reason}`;
    default: return 'Not taken';
  }
};

// ---------- the AMC reminder (dates are typed in by the company, per client) ----------
export const AMC_REMIND_DAYS = 60;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const validAmcDate = isDate;
// state: 'none' (no date entered), 'ok', 'soon' (within the reminder window), 'expired'
export function amcStatus(client, today, remindDays = AMC_REMIND_DAYS) {
  if (!isDate(client?.amcExpiry)) return { state: 'none', days: null };
  const days = Math.round((Date.parse(client.amcExpiry) - Date.parse(today)) / 86400000);
  return { state: days < 0 ? 'expired' : days <= remindDays ? 'soon' : 'ok', days };
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
    // The signature is drawn at the end of the visit, so its own time is not compared.
    if (p.box !== 'Signature' && p.takenAt && (p.takenSource === 'exif' || p.takenSource === 'camera' || p.takenSource === undefined) && istDate(p.takenAt) !== visit.date) {
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
  const sig = signatureState(visit);
  if (sig === 'none') notes.push('No client signature');
  else if (sig === 'image missing') notes.push('Client signature picture missing');
  else if (sig === 'unavailable') notes.push(`Client did not sign: ${visit.signature.reason}`);
  return notes.length ? notes.join('; ') : 'OK';
}

export function buildRow({ visit, client, boxes, answers, defects, details, submittedAt, rootFolder, gpsMaxDistanceM }) {
  const up = (k) => (photoCount(visit, k) ? `Uploaded (${photoCount(visit, k)})` : 'Not uploaded');
  const haveInverters = boxes.filter((b) => b.inverter && photoCount(visit, b.key)).length;   // inverters photographed; only the first is compulsory
  const cell = {
    date: visit.date, at: submittedAt, cleaner: visit.cleaner,
    Before: up('Before'), After: up('After'), Inverters: haveInverters ? `Uploaded (${haveInverters})` : 'Not uploaded',
    EarthingPitBefore: up('EarthingPitBefore'), EarthingPitAfter: up('EarthingPitAfter'), Challan: up('Challan'), Bill: up('Bill'),
    clientSign: signatureCell(visit),
    beforeTaken: photoCount(visit, 'Before') ? 'Yes' : 'No', afterTaken: photoCount(visit, 'After') ? 'Yes' : 'No',
    overall: answers.overall, defects, details, checks: buildChecks(visit, client, boxes, { gpsMaxDistanceM }),
    folder: `${rootFolder}/${client.folder}/${visit.date}`,
    installed: isDate(client.installed) ? client.installed : '', amcExpiry: isDate(client.amcExpiry) ? client.amcExpiry : '',
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
    clientSign: signatureState(visit),
  };
}
