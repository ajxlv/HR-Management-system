// Small builders shared by the tests.
import { boxesFor, buildRow, ELECTRICAL, SIGNATURES, WORK } from '../server/form.js';

export const okAnswers = (over = {}) => {
  const a = { electrical: {}, signatures: {}, work: {}, overall: 'Completed' };
  for (const e of ELECTRICAL) a.electrical[e.key] = e.options[0];
  for (const s of SIGNATURES) a.signatures[s.key] = 'Yes';
  for (const w of WORK) a.work[w.key] = 'Yes';
  return {
    ...a, ...over,
    electrical: { ...a.electrical, ...(over.electrical || {}) }, signatures: { ...a.signatures, ...(over.signatures || {}) }, work: { ...a.work, ...(over.work || {}) },
  };
};

// photos: { Before: 2, Inverter1: 1, ... }; each can also be an object of extra fields, e.g. { count: 1, capture: 'gallery' }
export function fakeVisit(client, photos = {}, date = '2026-11-02', signature) {
  const out = {}; let n = 0;
  for (const [box, spec] of Object.entries(photos)) {
    const { count = 1, ...extra } = typeof spec === 'number' ? { count: spec } : spec;
    for (let i = 1; i <= count; i++) {
      out[`h${n++}`] = { box, name: `${box}_${i}.jpg`, path: `Clients/${client.folder}/${date}/${box}_${i}.jpg`, capture: 'camera', takenAt: Date.parse(`${date}T07:00:00Z`), takenSource: 'camera', lat: client.lat ?? null, lng: client.lng ?? null, locationSource: 'phone at upload', ...extra };
    }
  }
  return { id: 'v-test-0001', client: client.id, date, cleaner: 'Ramesh', ...(signature ? { signature } : {}), photos: out };
}
export const allPhotos = (inverters = 2) => Object.fromEntries(boxesFor(inverters).map((b) => [b.key, b.key === 'Before' || b.key === 'After' ? 2 : 1]));
// the client's signature picture is a photo in box Signature (drawn, no location); a signed visit has both
export const SIGNED = { status: 'signed', signedAt: Date.parse('2026-11-02T07:30:00Z') };
export const signedPhoto = { Signature: { count: 1, capture: 'drawn', takenAt: SIGNED.signedAt, takenSource: '', lat: null, lng: null, locationSource: '' } };

// inverters: how many inverter boxes the cleaner added to this visit
export function rowOf(client, { inverters = 2, photos, answers = okAnswers(), defects = 'No', details = '', submittedAt = '2026-11-02 15:30', date = '2026-11-02', signature = SIGNED, signaturePhoto = true } = {}) {
  return buildRow({ visit: fakeVisit(client, { ...(photos ?? allPhotos(inverters)), ...(signaturePhoto && signature?.status === 'signed' ? signedPhoto : {}) }, date, signature), client, boxes: boxesFor(inverters), answers, defects, details, submittedAt, rootFolder: 'Clients', gpsMaxDistanceM: 300 });
}

// Parses one line of our CSV output (every cell is quoted)
export const csvCells = (line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
