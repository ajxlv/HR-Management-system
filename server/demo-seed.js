// Fills a running app with made-up visits (used by `npm run demo`, `npm run demo:google` and the Vercel demo).
// It calls the app in-process, so no network is needed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { istDate } from './util.js';
import { boxesFor, ELECTRICAL, SIGNATURES, WORK } from './form.js';

// The demos use made-up clients, never the real list.
export const DEMO_CLIENTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testlib', 'clients.fixture.json');

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'samples');
const DAY = 86400000;

// Which sample picture to use for a box, and which of the few we have
function sampleFor(box, i) {
  if (box.inverter) return `inverter-${(i % 2) + 1}.jpg`;
  if (box.key === 'Challan') return 'challan-1.jpg';
  if (box.key === 'Bill') return 'bill-1.jpg';
  return `${box.key.toLowerCase()}-${(i % 3) + 1}.jpg`;
}

// How the location of a photo was obtained (see "location" below):
//   camera        live camera shot, phone location          -> verified
//   exif          gallery photo with a location inside it    -> verified
//   gallery       gallery photo, phone location at upload    -> "location not verified"
//   none          camera shot, no location at all           -> "no GPS"
export function createVisitSender(direct, cfg) {
  const now = Date.now(), date = (back) => istDate(now - back * DAY);
  // random trailing bytes so two samples in one visit are never byte-identical (the app drops exact duplicates)
  const jpeg = (box, i) => Buffer.concat([readFileSync(path.join(SAMPLES, sampleFor(box, i))), Buffer.from(Math.random().toString(36))]);

  // opts: back (days ago), inverters (how many inverter boxes the cleaner added), photos { BoxKey: count | 0 }, location, far, otherDay, off [], na [], sign {customer:'No'}, work {washed:'No'},
  //       overall, defects, details
  return async function visit({ client, back = 0, inverters = 1, photos = {}, location = 'camera', far = false, otherDay = false, off = [], na = [], sign = {}, work = {}, overall = 'Completed', defects = 'No', details = '' }) {
    const site = cfg.clients.find((c) => c.id === client), boxes = boxesFor(inverters), d = date(back);
    const id = `demo-${client}-${back}-${Math.random().toString(36).slice(2, 10)}`;
    for (const box of boxes) {
      const count = photos[box.key] ?? (box.key === 'Before' || box.key === 'After' ? 2 : 1);
      for (let i = 0; i < count; i++) {
        const q = { visit: id, client, date: d, box: box.key, cap: location === 'camera' || location === 'none' ? 'camera' : 'gallery' };
        if (box.gps && location !== 'none' && site.lat !== undefined) {
          q.lat = site.lat + (far ? 0.03 : 0.0004); q.lng = site.lng; q.src = location === 'exif' ? 'exif' : 'phone';
          if (location !== 'exif') q.acc = 9;
        } else q.src = 'none';
        const taken = Date.parse(`${d}T07:00:00Z`) + i * 60000 - (otherDay ? 2 * DAY : 0);
        if (location === 'camera' || location === 'none') { q.taken = taken; q.tsrc = 'camera'; } else if (location === 'exif') { q.taken = taken; q.tsrc = 'exif'; } else q.tsrc = '';
        await direct.photo(q, jpeg(box, i));
      }
    }
    const answers = { electrical: {}, signatures: {}, work: {}, overall };
    for (const e of ELECTRICAL) answers.electrical[e.key] = off.includes(e.key) ? 'OFF' : na.includes(e.key) ? 'N/A' : 'ON';
    for (const s of SIGNATURES) answers.signatures[s.key] = sign[s.key] || 'Yes';
    for (const w of WORK) answers.work[w.key] = work[w.key] || 'Yes';
    await direct.visit({ visit: id, client, date: d, inverters, answers, defects, details });
  };
}

export async function seedDemo(direct, cfg) {
  const visit = createVisitSender(direct, cfg);
  await visit({ client: 'c01', back: 4, inverters: 2 });                                                // 2 inverters, all normal
  await visit({ client: 'c02', back: 3, inverters: 4, location: 'exif', off: ['MCB', 'Internet'], na: ['SPD'], overall: 'Partly completed', work: { inverterRoom: 'No' }, defects: 'Yes', details: 'MCB tripped on string 3. Internet logger offline, no data on the app.' });   // 4 inverters, two items OFF
  await visit({ client: 'c03', back: 2, inverters: 6, location: 'gallery', photos: { Inverter5: 0 }, sign: { customer: 'No' }, overall: 'Not completed', work: { sessionCleaning: 'No' } });   // 6 inverters: one photo missing, no customer signature, location not verified
  await visit({ client: 'c04', back: 1, inverters: 2, far: true, otherDay: true, defects: 'Yes', details: 'Loose clamp on row 3' });                  // far from the site, photos taken on another day
  await visit({ client: 'c01', back: 0, location: 'none' });                                            // camera shots without a location
  await visit({ client: 'c05', back: 0, inverters: 4, photos: { Challan: 0 }, off: ['DCDB'], overall: 'Partly completed' });
}
