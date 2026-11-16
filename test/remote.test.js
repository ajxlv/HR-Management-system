import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testConfig } from '../testlib/config.js';
import { createApp } from '../server/app.js';
import { OneDriveJson } from '../server/jsonstore.js';
import { istDate } from '../server/util.js';
import { okAnswers } from '../testlib/helpers.js';

// A stand-in for OneDrive's file store with the same rule: a save only works if nobody saved since you read.
function fakeOneDrive() {
  const files = new Map(); let n = 0;
  return {
    files,
    async getJson(root, name) { const f = files.get(`${root}/${name}`); return f ? { obj: JSON.parse(f.text), etag: f.etag } : null; },
    async putJson(root, name, obj, etag) {
      const key = `${root}/${name}`, f = files.get(key);
      if (f && f.etag !== etag) throw Object.assign(new Error('changed'), { status: 412 });
      const next = `etag-${++n}`; files.set(key, { text: JSON.stringify(obj), etag: next }); return next;
    },
  };
}

const NOW = Date.parse('2026-11-02T08:00:00Z'), TODAY = istDate(NOW);
const real = (n) => readFileSync(new URL(`../demo/samples/${n}.jpg`, import.meta.url));
const VENDORS = 'Akshay Jadhav=304847;Rahul Jadhav=343003';
let dir, od, a, b, urlA, urlB;

// Two app copies that share only the fake OneDrive records and the photo folder: like two Vercel instances.
const boot = async () => {
  const cfg = testConfig({ DATA_DIR: dir, SHEET: 'none', VENDORS, SESSION_SECRET: 'x', ROOT_FOLDER: 'Panel Cleaning' });
  const app = createApp(cfg, { now: () => NOW, jsonStore: (name) => new OneDriveJson(od, 'Panel Cleaning', name) });
  await new Promise((r) => app.listen(0, r));
  return app;
};
before(async () => { dir = mkdtempSync(path.join(tmpdir(), 'wrs-rem-')); od = fakeOneDrive(); a = await boot(); b = await boot(); urlA = `http://localhost:${a.address().port}`; urlB = `http://localhost:${b.address().port}`; });
after(() => { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); });

const call = (url, p, body, token) => fetch(url + p, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {} });
const login = async (url, pin) => (await (await call(url, '/api/login', { pin })).json()).token;

test('a stale save is refused with 503, so the phone sends it again', async () => {
  const x = new OneDriveJson(od, 'R', 'k.json'), y = new OneDriveJson(od, 'R', 'k.json');
  await x.read(); await y.read();
  await x.write({ v: 1 });
  await assert.rejects(() => y.write({ v: 2 }), (e) => e.status === 503);
  assert.deepEqual(await y.read(), { v: 1 });
  await y.write({ v: 2 });
});

test('a site added on one copy shows up on the other', async () => {
  const ta = await login(urlA, '304847'), tb = await login(urlB, '343003');
  const r = await (await call(urlA, '/api/sites', { name: 'Remote Test Site' }, ta)).json();
  const cfgB = await (await call(urlB, '/api/config', undefined, tb)).json();
  assert.ok(cfgB.clients.some((c) => c.id === r.id), 'the second copy sees it');
  // and a visit for it is accepted by the copy that never saw the site being added
  const id = 'visit-rem-0001', q = { client: r.id, date: TODAY, visit: id };
  assert.equal((await call(urlB, '/api/photo?' + new URLSearchParams({ ...q, box: 'Before', cap: 'gallery', src: 'none' }), real('before-1'), tb)).status, 200);
});

test('photos sent to different copies still land in one entry folder with one PDF', async () => {
  const ta = await login(urlA, '304847'), id = 'visit-rem-0002', q = { client: 'c01', date: TODAY, visit: id };
  const photo = (url, box, file) => call(url, '/api/photo?' + new URLSearchParams({ ...q, box, cap: 'gallery', src: 'none' }), real(file), ta);
  assert.equal((await photo(urlA, 'Before', 'before-1')).status, 200);
  assert.equal((await photo(urlB, 'After', 'after-1')).status, 200);
  assert.equal((await photo(urlA, 'Inverter1', 'inverter-1')).status, 200);
  const res = await (await call(urlB, '/api/visit', { ...q, defects: 'No', answers: okAnswers() }, ta)).json();
  assert.equal(res.pdf, 'saved');
  const rec = JSON.parse(od.files.get('Panel Cleaning/state.json').text).visits[id];
  assert.equal(Object.keys(rec.photos).length, 3);
  const files = readdirSync(path.join(dir, 'onedrive', 'Panel Cleaning', rec.folder)).sort();   // storage default root of the test config
  assert.ok(files.includes(`${rec.folder}.pdf`) && files.includes('Before_1.jpg') && files.includes('After_1.jpg'));
});
