import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { istDate } from '../server/util.js';

let dir, server, base, token;
const NOW = Date.parse('2026-11-02T08:00:00Z'); // 13:30 IST
const TODAY = istDate(NOW);
const jpeg = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]);

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'wrs-'));
  const cfg = loadConfig({ DATA_DIR: dir, CLEANER_PIN: '4321', SESSION_SECRET: 's3cret', CLEANER_NAME: 'Ramesh' });
  for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', 'Clients', c.folder), { recursive: true });
  server = createApp(cfg, { now: () => NOW });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const api = (p, init = {}) => fetch(base + p, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
const photo = (o, buf) => api('/api/photo?' + new URLSearchParams({ client: 'c01', date: TODAY, ...o }), { method: 'POST', body: buf });
const visit = (o) => api('/api/visit', { method: 'POST', body: JSON.stringify({ client: 'c01', date: TODAY, defects: 'No', ...o }) });
const csv = () => readFileSync(path.join(dir, 'sheet', 'Sharma Residence.csv'), 'utf8').trim().split('\n');
const near = { lat: 19.9976, lng: 73.7899, acc: 8, taken: NOW - 60000 };

test('needs login', async () => {
  assert.equal((await api('/api/config')).status, 401);
  assert.equal((await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: '0000' }) })).status, 401);
  const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: '4321' }) });
  token = (await r.json()).token;
  const cfg = await (await api('/api/config')).json();
  assert.equal(cfg.cleanerName, 'Ramesh');
  assert.deepEqual(cfg.boxes.map((b) => b.key), ['Before', 'After', 'Bill', 'Wires']);
  assert.ok(cfg.clients.length >= 5);
});

test('rejects bad input', async () => {
  const buf = jpeg('x');
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', client: 'nope' }, buf)).status, 400);
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Roof' }, buf)).status, 400);
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', date: '2026-11-03' }, buf)).status, 400); // future
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', date: '2026-10-20' }, buf)).status, 400); // too old
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before' }, Buffer.from('not a jpeg'))).status, 400);
  assert.equal((await visit({ visit: 'visit-bad-1', defects: 'Maybe' })).status, 400);
});

test('full visit: photos, dedupe, numbering, one sheet row, checks', async () => {
  const id = 'visit-0001-aaaa';
  const r1 = await (await photo({ visit: id, box: 'Before', ...near }, jpeg('b1'))).json();
  const r2 = await (await photo({ visit: id, box: 'Before', ...near }, jpeg('b2'))).json();
  const retry = await (await photo({ visit: id, box: 'Before', ...near }, jpeg('b1'))).json(); // network retry
  assert.equal(r1.name, 'Before_1.jpg'); assert.equal(r2.name, 'Before_2.jpg');
  assert.equal(retry.duplicate, true);
  await photo({ visit: id, box: 'After', ...near }, jpeg('a1'));
  await photo({ visit: id, box: 'Bill' }, jpeg('bill'));
  // Wires left empty on purpose.

  const res = await visit({ visit: id, details: 'Two cracked panels' });
  assert.equal(res.status, 200);
  assert.equal((await visit({ visit: id, details: 'Two cracked panels' })).status, 200); // double submit
  const rows = csv();
  assert.equal(rows.length, 2, 'header + exactly one row');
  assert.match(rows[1], /Ramesh/); assert.match(rows[1], /Uploaded \(2\)/); assert.match(rows[1], /Uploaded \(1\)/);
  assert.match(rows[1], /Not uploaded/); assert.match(rows[1], /"Yes"/); assert.match(rows[1], /"OK"/);
  const files = readdirSync(path.join(dir, 'onedrive', 'Clients', 'Sharma Residence', TODAY)).sort();
  assert.deepEqual(files, ['After_1.jpg', 'Before_1.jpg', 'Before_2.jpg', 'Bill_1.jpg']);
});

test('second visit same day continues numbering, flags GPS problems', async () => {
  const id = 'visit-0002-bbbb';
  const a = await (await photo({ visit: id, box: 'Before', lat: 20.2, lng: 73.9, acc: 10, taken: NOW }, jpeg('far'))).json();
  assert.equal(a.name, 'Before_3.jpg');
  await photo({ visit: id, box: 'After', taken: NOW }, jpeg('nogps'));
  await photo({ visit: id, box: 'Wires', ...near, taken: NOW - 2 * 86400000 }, jpeg('oldday'));
  await visit({ visit: id, defects: 'No' });
  const row = csv()[2];
  assert.match(row, /Before_3: \d+ m from site/);
  assert.match(row, /After_2: no GPS/);
  assert.match(row, /Wires_1: taken on 2026-10-31/);
  assert.match(row, /"No"/);
});

test('failed storage does not lose or double anything', async () => {
  const r = await photo({ visit: 'visit-0003-cccc', box: 'Before', client: 'c06', ...near }, jpeg('c06'));
  assert.equal(r.status, 200); // c06 folder exists (created in setup)
  const missing = createApp(loadConfig({ DATA_DIR: dir, CLEANER_PIN: '' }), { now: () => NOW });
  await new Promise((res) => missing.listen(0, res));
  const url = `http://localhost:${missing.address().port}/api/photo?client=c01&date=${TODAY}&box=Before&visit=visit-0004-dddd`;
  rmSync(path.join(dir, 'onedrive', 'Clients', 'Sharma Residence'), { recursive: true });
  const bad = await fetch(url, { method: 'POST', body: jpeg('zz') });
  assert.equal(bad.status, 422); // never creates client folders by guessing
  missing.close();
});
