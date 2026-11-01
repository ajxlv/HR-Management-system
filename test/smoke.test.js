// End-to-end check in local mode: photos land in Client/Date/Kind_n.jpg and one sheet row per visit.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrs-'));
process.env.STORAGE_DIR = tmp; process.env.DATA_DIR = path.join(tmp, 'data');
process.env.STORAGE = 'local'; process.env.SHEET = 'local';
const server = require('../server/index');

const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const jpg = n => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(500, n)]);

test('visit flow', async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const photo = (kind, n, extra = {}) => fetch(base + '/api/photo', { method: 'POST', body: jpg(n),
    headers: { 'x-visit': 'visit-0001', 'x-client': 'demo-nashik', 'x-date': today, 'x-kind': kind, 'x-lat': '19.9976', 'x-lon': '73.7899', 'x-taken': new Date().toISOString(), ...extra } }).then(r => r.json());

  assert.equal((await photo('Before', 1)).file, 'Before_1.jpg');
  assert.equal((await photo('Before', 2)).file, 'Before_2.jpg');
  assert.ok((await photo('Before', 2)).duplicate, 'retry of same photo is ignored');
  assert.equal((await photo('After', 3, { 'x-lat': '18.5', 'x-lon': '73.8' })).file, 'After_1.jpg');
  assert.equal((await photo('Bill', 4)).file, 'Bill_1.jpg');

  const bad = await fetch(base + '/api/photo', { method: 'POST', body: jpg(9), headers: { 'x-visit': 'visit-0001', 'x-client': 'demo-nashik', 'x-date': '2020-01-01', 'x-kind': 'Before' } });
  assert.equal(bad.status, 400, 'old dates are refused');

  const body = { visit: 'visit-0001', client: 'demo-nashik', date: today, cleaner: 'Ramesh', defects: 'Yes', details: 'One panel cracked', counts: { Before: 2, After: 1, Bill: 1, Wires: 0 } };
  const post = () => fetch(base + '/api/visit', { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
  assert.ok((await post()).ok);
  assert.ok((await post()).already, 'second submit does not add a second row');

  const dir = path.join(tmp, 'onedrive', 'Demo Client Nashik', today);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['After_1.jpg', 'Before_1.jpg', 'Before_2.jpg', 'Bill_1.jpg']);
  const rows = fs.readFileSync(path.join(tmp, 'sheets', 'Demo Client Nashik.csv'), 'utf8').trim().split('\n');
  assert.equal(rows.length, 2);
  assert.match(rows[1], /"Uploaded \(2\)","Uploaded \(1\)","Uploaded \(1\)","Not uploaded","Yes","One panel cracked"/);
  assert.match(rows[1], /After_1\.jpg: \d+ m from site/);
  server.close();
});
