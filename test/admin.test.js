import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testConfig } from '../testlib/config.js';
import { createApp } from '../server/app.js';
import { istDate, entryFolderName } from '../server/util.js';
import { describeUsers } from '../server/vendors.js';
import { okAnswers } from '../testlib/helpers.js';

let dir, server, base;
const NOW = Date.parse('2026-11-02T08:00:00Z');
const TODAY = istDate(NOW);
const real = (n) => readFileSync(new URL(`../demo/samples/${n}.jpg`, import.meta.url));   // real photos, so the PDF really embeds them
const VENDORS = 'Akshay Jadhav=304847;Rahul Jadhav=343003;Sandip=282544';

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'wrs-a-'));
  const cfg = testConfig({ DATA_DIR: dir, SHEET: 'csv', VENDORS, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'pw-12345', SESSION_SECRET: 'x' });
  server = createApp(cfg, { now: () => NOW });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const post = (p, body, token) => fetch(base + p, { method: 'POST', body: Buffer.isBuffer(body) ? body : JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {} });
const get = (p, token) => fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const login = async (pin) => (await (await post('/api/login', { pin })).json()).token;
const adminLogin = async () => (await (await post('/api/admin/login', { username: 'admin', password: 'pw-12345' })).json()).token;

test('usernames and IDs are made from the order and the name', () => {
  const u = describeUsers([{ name: 'Akshay Jadhav', pin: '1' }, { name: 'Sandip', pin: '2' }]);
  assert.deepEqual(u.map((x) => [x.id, x.username]), [['WRS-01', 'akshay.jadhav'], ['WRS-02', 'sandip']]);
});

test('entry folder is sitename_date_cleanedby and safe for Windows and OneDrive', () => {
  assert.equal(entryFolderName('Acron Plast Pvt. Ltd.', '2026-11-13', 'Akshay Jadhav'), 'Acron-Plast-Pvt.-Ltd_2026-11-13_Akshay-Jadhav');
  assert.equal(entryFolderName('A/B: "C"', '2026-11-13', 'Sandip'), 'A-B---C_2026-11-13_Sandip');
});

test('admin: wrong password refused, no token no access, and a cleaner token is not an admin token', async () => {
  assert.equal((await post('/api/admin/login', { username: 'admin', password: 'nope' })).status, 401);
  assert.equal((await get('/api/admin/sites')).status, 401);
  assert.equal((await get('/api/admin/sites', await login('304847'))).status, 401);
  assert.equal((await get('/api/admin/sites', 'fake.token')).status, 401);
});

test('admin adds and deletes sites; cleaners see the change; old visits keep working', async () => {
  const t = await adminLogin(), cleaner = await login('304847');
  const list = await (await get('/api/admin/sites', t)).json();
  assert.equal(list.users.length, 3); assert.equal(list.users[0].id, 'WRS-01');
  const added = await (await post('/api/admin/sites', { name: '  Green   Valley School ' }, t)).json();
  const site = added.sites.find((s) => s.name === 'Green Valley School');
  assert.ok(site, 'added, spaces tidied'); assert.equal(added.existed, false);
  assert.equal((await (await post('/api/admin/sites', { name: 'green valley school' }, t)).json()).existed, true, 'same name twice is one site');
  assert.equal((await post('/api/admin/sites', { name: 'Bad/Name' }, t)).status, 400);
  assert.ok((await (await get('/api/config', cleaner)).json()).clients.some((c) => c.id === site.id));

  // a visit for the new site, then delete the site: the visit and its row still work
  const id = 'visit-site-0001', q = { client: site.id, date: TODAY, visit: id };
  assert.equal((await post('/api/photo?' + new URLSearchParams({ ...q, box: 'Before', cap: 'gallery', src: 'none' }), real('before-1'), cleaner)).status, 200);
  assert.equal((await post('/api/admin/sites/delete', { id: site.id }, t)).status, 200);
  assert.ok(!(await (await get('/api/config', cleaner)).json()).clients.some((c) => c.id === site.id), 'gone from the dropdown');
  assert.equal((await post('/api/visit', { client: site.id, date: TODAY, visit: id, defects: 'No', answers: okAnswers() }, cleaner)).status, 200);
  assert.equal((await post('/api/admin/sites/delete', { id: 'zzz' }, t)).status, 404);
});

test('a cleaner adds a site that is not listed; it is shared with everyone and survives a restart', async () => {
  const a = await login('304847'), b = await login('343003');
  const r = await (await post('/api/sites', { name: 'New Dairy Plant' }, a)).json();
  assert.match(r.id, /^m\d+$/); assert.equal(r.existed, false);
  assert.equal((await (await post('/api/sites', { name: 'new dairy plant' }, b)).json()).id, r.id, 'no duplicate');
  assert.ok((await (await get('/api/config', b)).json()).clients.some((c) => c.name === 'New Dairy Plant'));
  assert.equal((await post('/api/sites', { name: '   ' }, a)).status, 400);
  assert.equal((await post('/api/sites', { name: 'x' })).status, 401);
  const s2 = createApp(testConfig({ DATA_DIR: dir, SHEET: 'csv', VENDORS, SESSION_SECRET: 'x' }), { now: () => NOW });
  await new Promise((res) => s2.listen(0, res));
  const tok = (await (await fetch(`http://localhost:${s2.address().port}/api/login`, { method: 'POST', body: JSON.stringify({ pin: '304847' }) })).json()).token;
  const cfg = await (await fetch(`http://localhost:${s2.address().port}/api/config`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  assert.ok(cfg.clients.some((c) => c.name === 'New Dairy Plant'));
  s2.close();
});

test('one folder per entry with the photos and a PDF that embeds the signature and photos', async () => {
  const a = await login('304847'), id = 'visit-pdf-0001';
  const up = (box, file, extra = {}) => post('/api/photo?' + new URLSearchParams({ client: 'c01', date: TODAY, visit: id, box, cap: 'gallery', src: 'none', ...extra }), real(file), a);
  for (const [box, file] of [['Before', 'before-1'], ['After', 'after-1'], ['Inverter1', 'inverter-1'], ['EarthingPitBefore', 'earthingpitbefore-1'], ['EarthingPitAfter', 'earthingpitafter-1'], ['Challan', 'challan-1'], ['Bill', 'bill-1']]) assert.equal((await up(box, file)).status, 200);
  assert.equal((await up('Signature', 'signature-1', { cap: 'drawn' })).status, 200);
  const signedAt = NOW - 60000;
  const res = await (await post('/api/visit', { client: 'c01', date: TODAY, visit: id, defects: 'No', answers: okAnswers(), signature: { status: 'signed', signedAt } }, a)).json();
  assert.equal(res.pdf, 'saved');
  const rec = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')).visits[id];
  assert.equal(rec.folder, `Sharma-Residence_${TODAY}_Akshay-Jadhav`);
  const files = readdirSync(path.join(dir, 'onedrive', 'Clients', rec.folder)).sort();
  assert.deepEqual(files, ['After_1.jpg', 'Bill_1.jpg', 'Before_1.jpg', 'Challan_1.jpg', 'EarthingPitAfter_1.jpg', 'EarthingPitBefore_1.jpg', 'Inverter1_1.jpg', 'Signature_1.jpg', `${rec.folder}.pdf`].sort());
  const pdf = readFileSync(path.join(dir, 'onedrive', 'Clients', rec.folder, `${rec.folder}.pdf`));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const jpegs = pdf.toString('latin1').match(/\/Subtype \/Image/g) || [];
  assert.ok(jpegs.length >= 8, `signature and 7 photos are embedded (found ${jpegs.length})`);
  assert.ok(pdf.length > 100000);
});

test('the same site, date and cleaner twice gives two folders, never a mix', async () => {
  const b = await login('343003');
  const f = async (id) => {
    await post('/api/photo?' + new URLSearchParams({ client: 'c02', date: TODAY, visit: id, box: 'Before', cap: 'gallery', src: 'none' }), real('before-2'), b);
    await post('/api/visit', { client: 'c02', date: TODAY, visit: id, defects: 'No', answers: okAnswers() }, b);
    return JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')).visits[id].folder;
  };
  const one = await f('visit-twice-0001'), two = await f('visit-twice-0002');
  assert.notEqual(one, two); assert.equal(two, `${one}_2`);
});
