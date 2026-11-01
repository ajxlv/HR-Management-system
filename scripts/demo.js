// Fills a demo Excel sheet with made-up visits so you can see how HR's file will look.
//   npm run demo   ->  demo/WRS_Cleaning_Status_demo.xlsx
//   npm run demo:serve -> same, then keeps the app running on http://localhost:3000
//        cleaner PIN 1234, HR page /hr.html with key hr-demo
// Photos are drawn samples from demo/samples.
import { mkdirSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { istDate } from '../server/util.js';

const dir = path.resolve('demo-output');
rmSync(dir, { recursive: true, force: true });
const serve = process.argv.includes('--serve');
const cfg = loadConfig({ DATA_DIR: dir, SHEET: 'excel', CLEANER_NAME: 'Ramesh', CLEANER_PIN: '1234', REPORT_KEY: 'hr-demo', SESSION_SECRET: 'demo-secret', port: 3000 });
for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', cfg.rootFolder, c.folder), { recursive: true });
const server = createApp(cfg);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const DAY = 86400000, now = Date.now();
const date = (back) => istDate(now - back * DAY);
const sample = (box, i) => readFileSync(`demo/samples/${{ Before: 'before', After: 'after', Bill: 'bill', Wires: 'wires' }[box]}-${box === 'Bill' ? 1 : (i % (box === 'Wires' ? 2 : 3)) + 1}.jpg`);
// random trailing bytes, so two samples in one visit are never byte-identical (the app drops exact duplicates)
const jpeg = (box, i) => Buffer.concat([sample(box, i), Buffer.from(Math.random().toString(36))]);
const authH = { Authorization: '' };
const login = await (await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ pin: '1234' }) })).json();
authH.Authorization = `Bearer ${login.token}`;

async function visit({ client, back, photos, defects = 'No', details = '' }) {
  const id = `demo-${client}-${back}-${Math.random().toString(36).slice(2, 10)}`, d = date(back);
  const site = cfg.clients.find((c) => c.id === client);
  for (const [box, count, opts = {}] of photos) {
    for (let i = 0; i < count; i++) {
      const gps = box !== 'Bill' && site.lat !== undefined && !opts.noGps
        ? { lat: site.lat + (opts.far ? 0.03 : 0.0004), lng: site.lng, acc: 9 } : {};
      const q = new URLSearchParams({ visit: id, client, date: d, box, taken: Date.parse(`${d}T07:00:00Z`) - (opts.otherDay ? 2 * DAY : 0), ...gps });
      const r = await fetch(`${base}/api/photo?${q}`, { method: 'POST', body: jpeg(box, i), headers: authH });
      if (!r.ok) throw new Error(await r.text());
    }
  }
  const r = await fetch(`${base}/api/visit`, { method: 'POST', body: JSON.stringify({ visit: id, client, date: d, defects, details }), headers: authH });
  if (!r.ok) throw new Error(await r.text());
}

await visit({ client: 'c01', back: 4, photos: [['Before', 3], ['After', 3], ['Bill', 1], ['Wires', 2]] });
await visit({ client: 'c01', back: 1, photos: [['Before', 2], ['After', 2], ['Bill', 1], ['Wires', 1]], defects: 'Yes', details: 'Two panels cracked on the east side. Bird nest near inverter.' });
await visit({ client: 'c02', back: 3, photos: [['Before', 4], ['After', 4], ['Bill', 1], ['Wires', 2]] });
await visit({ client: 'c02', back: 0, photos: [['Before', 2], ['After', 2]], defects: 'No' });
await visit({ client: 'c03', back: 2, photos: [['Before', 3], ['After', 3], ['Bill', 1], ['Wires', 1, { noGps: true }]] });
await visit({ client: 'c04', back: 1, photos: [['Before', 2, { far: true }], ['After', 2], ['Bill', 1], ['Wires', 1]], defects: 'Yes', details: 'Loose clamp on row 3' });
await visit({ client: 'c05', back: 0, photos: [['Before', 2, { otherDay: true }], ['After', 2], ['Wires', 1]] });

mkdirSync('demo', { recursive: true });
copyFileSync(path.join(dir, 'WRS_Cleaning_Status.xlsx'), 'demo/WRS_Cleaning_Status_demo.xlsx');
console.log('Wrote demo/WRS_Cleaning_Status_demo.xlsx');
if (serve) {
  server.close();
  const app = createApp(cfg);
  app.listen(cfg.port, () => console.log('Demo running: cleaner  http://localhost:3000  (PIN 1234)\n              HR page  http://localhost:3000/hr.html  (key hr-demo)'));
} else server.close();
