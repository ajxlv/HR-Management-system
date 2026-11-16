// Builds a sample "Panel Cleaning" folder (dummy photos, dummy signatures, a PDF report per entry) to show HR how the real
// OneDrive folder will look.   node scripts/make-hr-demo.js "<output folder>"
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportPdf } from '../server/pdf.js';
import { boxesFor, formConfig } from '../server/form.js';
import { entryFolderName } from '../server/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = (n) => readFileSync(path.join(here, '..', 'demo', 'samples', `${n}.jpg`));
const logo = readFileSync(path.join(here, '..', 'public', 'logo.png'));
const out = path.resolve(process.argv[2] || 'Panel Cleaning');

const ok = { electrical: { ACDB: 'ON', Inverter: 'ON', DCDB: 'ON', Internet: 'BLUE', ACSPD: 'ON', DCSPD: 'ON', EarthingTrip: 'ON' }, signatures: { customer: 'Yes', supervisor: 'Yes' }, work: { sessionCleaning: 'Yes', washed: 'Yes', inverterRoom: 'Yes', earthingPit: 'Yes' }, overall: 'Completed' };
const withOff = { ...ok, electrical: { ...ok.electrical, DCDB: 'OFF', DCSPD: 'N/A' }, work: { ...ok.work, inverterRoom: 'No' }, overall: 'Partly completed' };

// photos: [box, sample file]; each box is numbered Before_1, Before_2 ... like the app does
const entries = [
  { site: 'Acron Plast Pvt. Ltd', date: '2026-11-10', by: 'Akshay Jadhav', at: '2026-11-10 11:48', sig: 1, answers: ok, defects: 'No', details: '', checks: 'OK',
    photos: [['Before', 'before-1'], ['Before', 'before-2'], ['After', 'after-1'], ['After', 'after-2'], ['Inverter1', 'inverter-1'], ['EarthingPitBefore', 'earthingpitbefore-1'], ['EarthingPitAfter', 'earthingpitafter-1'], ['Challan', 'challan-1'], ['Bill', 'bill-1']], inverters: 1 },
  { site: 'Amber Auto', date: '2026-11-11', by: 'Rahul Jadhav', at: '2026-11-11 14:12', sig: 2, answers: withOff, defects: 'Yes', details: 'DCDB switch found OFF. Two panels have cracked glass near the inverter room.', checks: 'Location not verified: Before_2',
    photos: [['Before', 'before-2'], ['Before', 'before-3'], ['After', 'after-2'], ['Inverter1', 'inverter-1'], ['Inverter2', 'inverter-2'], ['EarthingPitBefore', 'earthingpitbefore-1'], ['EarthingPitAfter', 'earthingpitafter-1'], ['Challan', 'challan-1'], ['Bill', 'bill-1']], inverters: 2 },
  { site: 'Aumsai Coatings', date: '2026-11-12', by: 'Uttam Chaudhari', at: '2026-11-12 10:25', sig: 3, answers: ok, defects: 'No', details: '', checks: 'OK',
    photos: [['Before', 'before-3'], ['After', 'after-3'], ['Inverter1', 'inverter-2'], ['EarthingPitBefore', 'earthingpitbefore-1'], ['EarthingPitAfter', 'earthingpitafter-1'], ['Challan', 'challan-1'], ['Bill', 'bill-1']], inverters: 1 },
  { site: 'Ajay Dua', date: '2026-11-13', by: 'Sandip', at: '2026-11-13 16:40', sig: 4, answers: ok, defects: 'No', details: '', checks: 'OK',
    photos: [['Before', 'before-1'], ['After', 'after-3'], ['Inverter1', 'inverter-1'], ['EarthingPitBefore', 'earthingpitbefore-1'], ['EarthingPitAfter', 'earthingpitafter-1'], ['Challan', 'challan-1'], ['Bill', 'bill-1']], inverters: 1 },
];

rmSync(out, { recursive: true, force: true });
const rootName = path.basename(out);
for (const e of entries) {
  const folder = entryFolderName(e.site, e.date, e.by), dir = path.join(out, folder);
  mkdirSync(dir, { recursive: true });
  const count = {}, photos = [];
  for (const [box, file] of e.photos) {
    const name = `${box}_${(count[box] = (count[box] || 0) + 1)}.jpg`, buffer = sample(file);
    writeFileSync(path.join(dir, name), buffer); photos.push({ box, name, buffer });
  }
  const signatureBuffer = sample(`signature-demo-${e.sig}`);
  writeFileSync(path.join(dir, 'Signature_1.jpg'), signatureBuffer);
  const pdf = await buildReportPdf({
    client: e.site, folder: `${rootName}/${folder}`, date: e.date, cleaner: e.by, submittedAt: e.at, answers: e.answers, defects: e.defects, details: e.details,
    checks: e.checks, form: formConfig(), signature: { status: 'signed' }, boxes: boxesFor(e.inverters), photos, signatureBuffer, logo,
  });
  writeFileSync(path.join(dir, `${folder}.pdf`), pdf);
  console.log(`${folder}: ${e.photos.length + 1} images + PDF (${Math.round(pdf.length / 1024)} KB)`);
}
