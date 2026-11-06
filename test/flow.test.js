import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { testConfig } from '../testlib/config.js';
import { createApp } from '../server/app.js';
import { istDate } from '../server/util.js';
import { HEADERS, colIndex } from '../server/form.js';
import { okAnswers, csvCells } from '../testlib/helpers.js';

let dir, server, base, token;
const NOW = Date.parse('2026-11-02T08:00:00Z'); // 13:30 IST
const TODAY = istDate(NOW);
const jpeg = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tag)]);

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'wrs-'));
  const cfg = testConfig({ DATA_DIR: dir, SHEET: 'csv', CLEANER_PIN: '4321', SESSION_SECRET: 's3cret', CLEANER_NAME: 'Ramesh' });
  for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', 'Clients', c.folder), { recursive: true });
  server = createApp(cfg, { now: () => NOW });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const api = (p, init = {}) => fetch(base + p, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
const photo = (o, buf) => api('/api/photo?' + new URLSearchParams({ client: 'c01', date: TODAY, ...o }), { method: 'POST', body: buf });
const SIGNED = { status: 'signed', signedAt: NOW - 120000 };
const visit = (o) => api('/api/visit', { method: 'POST', body: JSON.stringify({ client: 'c01', date: TODAY, inverters: 2, defects: 'No', answers: okAnswers(), signature: SIGNED, ...o }) });   // the cleaner added 2 inverter boxes
const sign = (id, extra = {}) => photo({ visit: id, box: 'Signature', cap: 'drawn', src: 'none', taken: SIGNED.signedAt, ...extra }, jpeg(`${id}-sig`));
const csvRows = (name = 'Sharma Residence') => readFileSync(path.join(dir, 'sheet', `${name}.csv`), 'utf8').trim().split('\n').map(csvCells);
const cell = (row, header) => row[HEADERS.indexOf(header)];
const near = { lat: 19.9976, lng: 73.7899, acc: 8, taken: NOW - 60000, tsrc: 'camera', cap: 'camera', src: 'phone' };
const sendAll = async (id, extra = {}) => {                       // c01 has 2 inverters
  for (const [box, n] of [['Before', 2], ['After', 1]]) for (let i = 0; i < n; i++) await photo({ visit: id, box, ...near }, jpeg(`${id}-${box}${i}`));
  for (const box of ['Inverter1', 'Inverter2', 'EarthingPitBefore', 'EarthingPitAfter', 'Challan', 'Bill']) await photo({ visit: id, box, cap: 'gallery', src: 'none' }, jpeg(`${id}-${box}`));
  return extra;
};

test('needs login, and the config has no per-client box data', async () => {
  assert.equal((await api('/api/config')).status, 401);
  assert.equal((await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: '0000' }) })).status, 401);
  const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ pin: '4321' }) });
  token = (await r.json()).token;
  const cfg = await (await api('/api/config')).json();
  assert.equal(cfg.cleanerName, 'Ramesh');
  assert.equal(cfg.maxDaysBack, 1, 'today and yesterday only');
  assert.deepEqual(cfg.clients[0], { id: 'c01', name: 'Sharma Residence', installed: '2024-10-01', amcExpiry: '2027-09-30' });   // id, name and the AMC dates the company typed in: no inverter count, no boxes
  assert.ok(cfg.clients.every((c) => Object.keys(c).every((k) => ['id', 'name', 'installed', 'amcExpiry'].includes(k))));
  assert.equal(cfg.amcRemindDays, 60);
  assert.ok(cfg.version && typeof cfg.version.version === 'string');
  // the form is built from this template: the Inverter box is repeated as many times as the cleaner adds it
  assert.deepEqual(cfg.form.boxes.map((b) => b.key), ['Before', 'After', 'Inverter1', 'EarthingPitBefore', 'EarthingPitAfter', 'Challan', 'Bill']);
  assert.equal(cfg.form.maxInverters, 12);
  assert.ok(!cfg.form.boxes.some((b) => b.key === 'Wires'));
  assert.deepEqual(cfg.form.overall, ['Completed', 'Partly completed', 'Not completed']);
  assert.deepEqual(cfg.form.electrical.map((e) => e.key), ['ACDB', 'Inverter', 'DCDB', 'Internet', 'ACSPD', 'DCSPD', 'EarthingTrip']);
  assert.deepEqual(cfg.form.electrical.find((e) => e.key === 'Internet').options, ['BLUE', 'OFF', 'N/A']);
});

test('each vendor signs in with their own PIN, and the visit carries their name', async () => {
  const vdir = mkdtempSync(path.join(tmpdir(), 'wrs-v-'));
  const cfg = testConfig({ DATA_DIR: vdir, SHEET: 'csv', VENDORS: 'Ramesh=4321;Suresh=8765', SESSION_SECRET: 's3cret' });
  for (const c of cfg.clients) mkdirSync(path.join(vdir, 'onedrive', 'Clients', c.folder), { recursive: true });
  const srv = createApp(cfg, { now: () => NOW });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://localhost:${srv.address().port}`, post = (p, body, tok) => fetch(url + p, { method: 'POST', body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
  try {
    const login = async (pin) => (await post('/api/login', { pin })).json();
    const suresh = await login('8765'), ramesh = await login('4321');
    assert.equal(suresh.name, 'Suresh'); assert.equal(ramesh.name, 'Ramesh');
    assert.equal((await post('/api/login', { pin: '1111' })).status, 401);
    const conf = await (await fetch(url + '/api/config', { headers: { Authorization: `Bearer ${suresh.token}` } })).json();
    assert.equal(conf.cleanerName, 'Suresh');
    const id = 'visit-vendor-0001';
    await post('/api/photo?' + new URLSearchParams({ client: 'c02', date: TODAY, visit: id, box: 'Before', ...near }), jpeg('vb'), suresh.token);
    const r = await post('/api/visit', { visit: id, client: 'c02', date: TODAY, inverters: 1, defects: 'No', answers: okAnswers(), signature: SIGNED }, suresh.token);
    assert.equal(r.status, 200);
    assert.equal(cell(readFileSync(path.join(vdir, 'sheet', 'Patil Agro Industries.csv'), 'utf8').trim().split('\n').map(csvCells)[1], 'Cleaner'), 'Suresh');
    // a token cannot be forged for another vendor
    const [exp, who, mac] = ramesh.token.split('.');
    const forged = `${exp}.${Buffer.from('Suresh').toString('base64url')}.${mac}`;
    assert.equal((await fetch(url + '/api/config', { headers: { Authorization: `Bearer ${forged}` } })).status, 401);
    assert.equal((await fetch(url + '/api/config')).status, 401);
    // five wrong PINs from one place lock the sign-in for a minute
    for (let i = 0; i < 5; i++) await post('/api/login', { pin: '0000' });
    assert.equal((await post('/api/login', { pin: '4321' })).status, 429);
  } finally { srv.close(); rmSync(vdir, { recursive: true, force: true }); }
});

test('rejects bad input', async () => {
  const buf = jpeg('x');
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', client: 'nope' }, buf)).status, 400);
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Wires' }, buf)).status, 400);        // Wires no longer exists
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Inverter13' }, buf)).status, 400);    // at most 12 inverter boxes
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Inverter0' }, buf)).status, 400);
  assert.equal((await visit({ visit: 'visit-bad-6', inverters: 0 })).status, 400);              // a visit needs 1 to 12 inverters
  assert.equal((await visit({ visit: 'visit-bad-7', inverters: 13 })).status, 400);
  assert.equal((await visit({ visit: 'visit-bad-8', inverters: '2' })).status, 400);
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', date: '2026-11-03' }, buf)).status, 400); // future
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', date: '2026-10-31' }, buf)).status, 400); // two days back: only today and yesterday
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', date: '2026-11-01' }, buf)).status, 200); // yesterday is fine
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before' }, Buffer.from('not a jpeg'))).status, 400);
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', cap: 'drone' }, buf)).status, 400);
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', src: 'guess' }, buf)).status, 400);
  assert.equal((await visit({ visit: 'visit-bad-1', defects: 'Maybe' })).status, 400);
  // a checklist with anything missing or odd is refused
  const half = okAnswers(); delete half.electrical.ACSPD;
  const r = await visit({ visit: 'visit-bad-2', answers: half });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /AC SPD/);
  assert.equal((await visit({ visit: 'visit-bad-9', answers: okAnswers({ electrical: { Internet: 'ON' } }) })).status, 400);   // the internet line is BLUE, not ON
  // the client signature: only the shapes the form can send
  assert.equal((await visit({ visit: 'visit-bad-10', signature: { status: 'signed' } })).status, 400);
  assert.equal((await visit({ visit: 'visit-bad-11', signature: { status: 'unavailable', reason: '' } })).status, 400);
  assert.equal((await visit({ visit: 'visit-bad-12', signature: 'yes' })).status, 400);
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Signature', cap: 'camera', src: 'none' }, buf)).status, 400);   // the signature is drawn, not photographed
  assert.equal((await photo({ visit: 'visit-bad-1', box: 'Before', cap: 'drawn', src: 'none' }, buf)).status, 400);        // and a photo box never takes a drawn picture
  assert.equal((await visit({ visit: 'visit-bad-3', answers: okAnswers({ overall: 'Fine' }) })).status, 400);
  assert.equal((await visit({ visit: 'visit-bad-4', answers: undefined })).status, 400);
  assert.equal((await visit({ visit: 'visit-bad-5', answers: okAnswers({ electrical: { ACDB: 'maybe' } }) })).status, 400);
});

test('full visit: photos, dedupe, numbering, one sheet row, every answer stored', async () => {
  const id = 'visit-0001-aaaa';
  const r1 = await (await photo({ visit: id, box: 'Before', ...near }, jpeg('b1'))).json();
  const r2 = await (await photo({ visit: id, box: 'Before', ...near }, jpeg('b2'))).json();
  const retry = await (await photo({ visit: id, box: 'Before', ...near }, jpeg('b1'))).json(); // network retry
  assert.equal(r1.name, 'Before_1.jpg'); assert.equal(r2.name, 'Before_2.jpg'); assert.equal(retry.duplicate, true);
  await photo({ visit: id, box: 'After', ...near }, jpeg('a1'));
  const inv = await (await photo({ visit: id, box: 'Inverter1', cap: 'gallery', src: 'none' }, jpeg('i1'))).json();
  assert.equal(inv.name, 'Inverter1_1.jpg');
  await photo({ visit: id, box: 'Inverter2', cap: 'camera', src: 'none' }, jpeg('i2'));
  await photo({ visit: id, box: 'Challan', cap: 'gallery', src: 'none' }, jpeg('c1'));
  await photo({ visit: id, box: 'EarthingPitBefore', cap: 'camera', src: 'none' }, jpeg('ep1'));
  assert.equal((await sign(id)).status, 200);
  // Bill and Earthing pit after left out on purpose

  const answers = okAnswers({ electrical: { ACDB: 'OFF', DCSPD: 'N/A', Internet: 'BLUE' }, signatures: { customer: 'No' }, overall: 'Partly completed' });
  const res = await visit({ visit: id, answers, details: 'Two cracked panels' });
  assert.equal(res.status, 200); assert.equal((await res.json()).sheet, 'written');
  assert.equal((await visit({ visit: id, answers, details: 'Two cracked panels' })).status, 200);   // double submit
  const rows = csvRows();
  assert.equal(rows.length, 2, 'header + exactly one row');
  assert.deepEqual(rows[0], HEADERS);
  const row = rows[1];
  assert.equal(cell(row, 'Cleaner'), 'Ramesh'); assert.equal(cell(row, 'Before'), 'Uploaded (2)'); assert.equal(cell(row, 'Inverters'), 'Uploaded (2)');
  assert.equal(cell(row, 'Challan'), 'Uploaded (1)'); assert.equal(cell(row, 'Bill'), 'Not uploaded');
  assert.equal(cell(row, 'ACDB'), 'OFF'); assert.equal(cell(row, 'DC SPD'), 'N/A'); assert.equal(cell(row, 'AC SPD'), 'ON'); assert.equal(cell(row, 'Internet'), 'BLUE');
  assert.equal(cell(row, 'Earthing pit before'), 'Uploaded (1)'); assert.equal(cell(row, 'Earthing pit after'), 'Not uploaded');
  assert.match(cell(row, 'Client signature'), /^Signed 2026-11-02 13:2\d$/); assert.equal(cell(row, 'Installed on'), '2024-10-01'); assert.equal(cell(row, 'AMC expiry'), '2027-09-30');
  assert.equal(cell(row, 'Customer signature'), 'No'); assert.equal(cell(row, 'Supervisor signature'), 'Yes');
  assert.equal(cell(row, 'Overall status'), 'Partly completed'); assert.equal(cell(row, 'Defects'), 'Yes');       // details typed -> Yes
  assert.equal(cell(row, 'Before photos taken'), 'Yes');
  assert.match(cell(row, 'Checks'), /No photo: Earthing pit after, Bill/);
  const files = readdirSync(path.join(dir, 'onedrive', 'Clients', 'Sharma Residence', TODAY)).sort();
  assert.deepEqual(files, ['After_1.jpg', 'Before_1.jpg', 'Before_2.jpg', 'Challan_1.jpg', 'EarthingPitBefore_1.jpg', 'Inverter1_1.jpg', 'Inverter2_1.jpg', 'Signature_1.jpg']);

  // every answer is also kept in the visit record, not only in the sheet
  const rec = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')).visits[id];
  assert.deepEqual(rec.answers, answers);
  assert.deepEqual(rec.submitted.answers, answers);
  assert.deepEqual(rec.submitted.missing, ['Earthing pit after', 'Bill']);
  assert.deepEqual(rec.signature, SIGNED); assert.equal(rec.cleaner, 'Ramesh');
  const photos = Object.values(rec.photos);
  assert.equal(photos.length, 8);
  const sig = photos.find((p) => p.box === 'Signature');
  assert.equal(sig.capture, 'drawn'); assert.equal(sig.lat ?? null, null);
  const b1 = photos.find((p) => p.name === 'Before_1.jpg');
  assert.equal(b1.capture, 'camera'); assert.equal(b1.locationSource, 'phone at upload'); assert.equal(b1.takenSource, 'camera');
  assert.equal(photos.find((p) => p.name === 'Challan_1.jpg').capture, 'gallery');
});

test('second visit same day continues numbering; gallery photos and EXIF are judged by where the location came from', async () => {
  const id = 'visit-0002-bbbb';
  // gallery photo whose location is inside the photo (EXIF): verified
  const exif = await (await photo({ visit: id, box: 'Before', cap: 'gallery', src: 'exif', lat: 19.9976, lng: 73.7899, taken: Date.parse(`${TODAY}T05:00:00Z`), tsrc: 'exif' }, jpeg('e1'))).json();
  assert.equal(exif.name, 'Before_3.jpg');
  // gallery photo with only the phone's location at upload: "not verified"
  await photo({ visit: id, box: 'After', cap: 'gallery', src: 'phone', lat: 19.9976, lng: 73.7899, acc: 9, tsrc: '' }, jpeg('g1'));
  // camera shot with no location: "no GPS"
  await photo({ visit: id, box: 'After', cap: 'camera', src: 'none', taken: NOW, tsrc: 'camera' }, jpeg('n1'));
  // EXIF date two days ago
  await photo({ visit: id, box: 'Inverter1', cap: 'gallery', src: 'none', taken: NOW - 2 * 86400000, tsrc: 'exif' }, jpeg('d1'));
  await sign(id);
  await visit({ visit: id });
  const row = csvRows()[2];
  const checks = cell(row, 'Checks');
  assert.match(checks, /Location not verified: After_2/);
  assert.match(checks, /No GPS: After_3/);
  assert.match(checks, /Taken on 2026-10-31: Inverter1_2/);
  assert.doesNotMatch(checks, /Before_3/, 'EXIF location is trusted');
  assert.match(checks, /No photo: .*Challan/);
  assert.doesNotMatch(checks, /Signature|signature/, 'the signature is not compared with the visit date or place');
});

test('the same picture in two different boxes is two photos; a retry to the same box is one', async () => {
  const id = 'visit-0007-gggg', same = jpeg('one picture, two boxes');
  const a = await (await photo({ visit: id, box: 'Challan', cap: 'gallery', src: 'none' }, same)).json();
  const b = await (await photo({ visit: id, box: 'Bill', cap: 'gallery', src: 'none' }, same)).json();
  const again = await (await photo({ visit: id, box: 'Bill', cap: 'gallery', src: 'none' }, same)).json();
  assert.equal(a.name.startsWith('Challan_'), true); assert.equal(b.name.startsWith('Bill_'), true);
  assert.equal(again.duplicate, true);
  const rec = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')).visits[id];
  assert.equal(Object.keys(rec.photos).length, 2);
});

test('a visit with a missing required photo is saved, not lost', async () => {
  const id = 'visit-0003-cccc';
  await photo({ visit: id, box: 'Before', ...near }, jpeg('only-one'));
  const r = await visit({ visit: id });
  assert.equal(r.status, 200);
  const row = csvRows().at(-1);
  assert.equal(cell(row, 'After'), 'Not uploaded'); assert.equal(cell(row, 'Inverters'), 'Not uploaded');
  assert.equal(cell(row, 'After photos taken'), 'No');
});

test('the cleaner sets the inverter count on each visit, for any client', async () => {
  const id = 'visit-0004-dddd', p = (box) => api('/api/photo?' + new URLSearchParams({ client: 'c03', date: TODAY, visit: id, box }), { method: 'POST', body: jpeg(`c3-${box}`) });
  assert.equal((await p('Inverter6')).status, 200);       // any client can have up to 12 inverter boxes
  assert.equal((await p('Inverter13')).status, 400);
  assert.equal((await visit({ visit: id, client: 'c03', inverters: 6 })).status, 200);
  assert.equal(cell(csvRows('Deshmukh Hospital')[1], 'Inverters'), 'Uploaded (1)');
  // nothing declared: the count is the highest inverter box he uploaded to
  const id2 = 'visit-0008-hhhh';
  await api('/api/photo?' + new URLSearchParams({ client: 'c04', date: TODAY, visit: id2, box: 'Inverter3' }), { method: 'POST', body: jpeg('c4-i3') });
  const noCount = await api('/api/visit', { method: 'POST', body: JSON.stringify({ client: 'c04', date: TODAY, defects: 'No', answers: okAnswers(), visit: id2 }) });
  assert.equal(noCount.status, 200);
  assert.equal(cell(csvRows('Gokhale Apartments')[1], 'Inverters'), 'Uploaded (1)');
  // a declared count below what he uploaded is raised, never hides a photo
  const id3 = 'visit-0009-iiii';
  await api('/api/photo?' + new URLSearchParams({ client: 'c05', date: TODAY, visit: id3, box: 'Inverter2' }), { method: 'POST', body: jpeg('c5-i2') });
  await visit({ visit: id3, client: 'c05', inverters: 1 });
  assert.equal(cell(csvRows('Nashik Textile Mills')[1], 'Inverters'), 'Uploaded (1)');
  const rec = JSON.parse(readFileSync(path.join(dir, 'state.json'), 'utf8')).visits;
  assert.equal(rec[id].inverters, 6); assert.equal(rec[id].submitted.inverters, 6); assert.equal(rec[id2].inverters, 3); assert.equal(rec[id3].inverters, 2);
});

test('failed storage does not lose or double anything', async () => {
  const r = await photo({ visit: 'visit-0005-eeee', box: 'Before', client: 'c06', ...near }, jpeg('c06'));
  assert.equal(r.status, 200); // c06 folder exists (created in setup)
  const missing = createApp(testConfig({ DATA_DIR: dir, SHEET: 'csv', CLEANER_PIN: '' }), { now: () => NOW });
  await new Promise((res) => missing.listen(0, res));
  const url = `http://localhost:${missing.address().port}/api/photo?client=c01&date=${TODAY}&box=Before&visit=visit-0006-ffff`;
  rmSync(path.join(dir, 'onedrive', 'Clients', 'Sharma Residence'), { recursive: true });
  const bad = await fetch(url, { method: 'POST', body: jpeg('zz') });
  assert.equal(bad.status, 422); // never creates client folders by guessing
  missing.close();
});
