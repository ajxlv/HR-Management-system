// Fills a running app with made-up visits (used by `npm run demo` and by the Vercel demo).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { istDate } from './util.js';

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'samples');
const FILE = { Before: 'before', After: 'after', Bill: 'bill', Wires: 'wires' };
const DAY = 86400000;

export async function seedDemo(base, cfg) {
  const now = Date.now(), date = (back) => istDate(now - back * DAY);
  const sample = (box, i) => readFileSync(path.join(SAMPLES, `${FILE[box]}-${box === 'Bill' ? 1 : (i % (box === 'Wires' ? 2 : 3)) + 1}.jpg`));
  // random trailing bytes so two samples in one visit are never byte-identical (the app drops exact duplicates)
  const jpeg = (box, i) => Buffer.concat([sample(box, i), Buffer.from(Math.random().toString(36))]);
  const login = await (await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ pin: cfg.cleanerPin }) })).json();
  const headers = { Authorization: `Bearer ${login.token}` };

  async function visit({ client, back, photos, defects = 'No', details = '' }) {
    const id = `demo-${client}-${back}-${Math.random().toString(36).slice(2, 10)}`, d = date(back);
    const site = cfg.clients.find((c) => c.id === client);
    for (const [box, count, opts = {}] of photos) {
      for (let i = 0; i < count; i++) {
        const gps = box !== 'Bill' && site.lat !== undefined && !opts.noGps
          ? { lat: site.lat + (opts.far ? 0.03 : 0.0004), lng: site.lng, acc: 9 } : {};
        const q = new URLSearchParams({ visit: id, client, date: d, box, taken: Date.parse(`${d}T07:00:00Z`) - (opts.otherDay ? 2 * DAY : 0), ...gps });
        const r = await fetch(`${base}/api/photo?${q}`, { method: 'POST', body: jpeg(box, i), headers });
        if (!r.ok) throw new Error(await r.text());
      }
    }
    const r = await fetch(`${base}/api/visit`, { method: 'POST', body: JSON.stringify({ visit: id, client, date: d, defects, details }), headers });
    if (!r.ok) throw new Error(await r.text());
  }

  await visit({ client: 'c01', back: 4, photos: [['Before', 3], ['After', 3], ['Bill', 1], ['Wires', 2]] });
  await visit({ client: 'c01', back: 1, photos: [['Before', 2], ['After', 2], ['Bill', 1], ['Wires', 1]], defects: 'Yes', details: 'Two panels cracked on the east side. Bird nest near inverter.' });
  await visit({ client: 'c02', back: 3, photos: [['Before', 3], ['After', 3], ['Bill', 1], ['Wires', 2]] });
  await visit({ client: 'c02', back: 0, photos: [['Before', 2], ['After', 2]] });
  await visit({ client: 'c03', back: 2, photos: [['Before', 3], ['After', 3], ['Bill', 1], ['Wires', 1, { noGps: true }]] });
  await visit({ client: 'c04', back: 1, photos: [['Before', 2, { far: true }], ['After', 2], ['Bill', 1], ['Wires', 1]], defects: 'Yes', details: 'Loose clamp on row 3' });
  await visit({ client: 'c05', back: 0, photos: [['Before', 2, { otherDay: true }], ['After', 2], ['Wires', 1]] });
}
