import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { importClients, cleanName, parseLocation, mapColumns } from '../server/clients-import.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'wrs-imp-'));
async function xlsx(dir, rows, name = 'list.xlsx') {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  const file = path.join(dir, name); await wb.xlsx.writeFile(file); return file;
}
const run = async (dir, rows, opts = {}) => {
  const file = await xlsx(dir, rows), out = path.join(dir, 'clients.json');
  return { out, r: await importClients({ file, out, ...opts }) };
};
const read = (out) => JSON.parse(readFileSync(out, 'utf8'));

// A sheet shaped like HR's: blank top rows, the heading is a title, an empty "Customer Name" column,
// a phone column that must never be copied, and a blank-name row for the next contract year of the same site.
const HR = [
  [], [],
  [null, null, 'AMC site list above 1 Lakh', 'KW', 'start date', 'Customer Name', 'Customer Contact', 'Vendor Name'],
  [null, 1, 'Go Green', 500, '2025-12-01', null, '9999999999', 'Sandeep'],
  [null, 2, 'Samsonite', 1000, '2026-08-01', null, null, 'Uttam'],
  [null, null, null, null, '2027-08-01', null, null, null],
  [null, 3, 'Koso J1', 680, null, null, null, null],
  [null, 4, 'Acron Plast Pvt. Ltd.', 321, null, null, null, null],
  [null, 5, 'Samsonite ASHOKA,DHONGADE', 380, null, null, null, null],
];

test('reads a sheet like HR\'s: finds the heading, skips continuation rows, fixes the trailing dot, copies nothing else', async () => {
  const dir = tmp(), { out, r } = await run(dir, HR, { replaceAll: true });
  assert.equal(r.ok, true); assert.equal(r.written, true);
  assert.equal(r.map.headerRow, 2); assert.equal(r.map.nameCol, 2); assert.equal(r.map.nameHeading, 'AMC site list above 1 Lakh');
  assert.deepEqual(r.skipped, [6]);                                                  // the blank-name contract row
  assert.deepEqual(r.fixes.map((f) => [f.client, f.fix]), [['Acron Plast Pvt. Ltd', 'trailing dot removed']]);
  const list = read(out);
  assert.deepEqual(list.map((c) => c.name), ['Acron Plast Pvt. Ltd', 'Go Green', 'Koso J1', 'Samsonite', 'Samsonite ASHOKA,DHONGADE']);   // sorted by name; similar names are kept
  assert.ok(list.every((c) => c.folder === c.name), 'folder = name when the sheet has no Folder column');
  assert.ok(list.every((c) => Object.keys(c).sort().join() === 'folder,id,name'), 'no other field: no phone, vendor, KW, inverters, location');
  assert.ok(!readFileSync(out, 'utf8').includes('9999999999'));
  assert.equal(list.find((c) => c.name === 'Go Green').id, 'c01');                  // numbered in the order of the sheet
  assert.equal(list.find((c) => c.name === 'Samsonite ASHOKA,DHONGADE').id, 'c05');
  rmSync(dir, { recursive: true, force: true });
});

test('a plain list with no heading, and a CSV file, work too', async () => {
  const dir = tmp();
  const { r } = await run(dir, [['Alpha Works'], [], ['Beta Hospital'], ['Gamma Agro'], []], { replaceAll: true });
  assert.equal(r.ok, true); assert.equal(r.map.headerless, true); assert.deepEqual(r.clients.map((c) => c.name), ['Alpha Works', 'Beta Hospital', 'Gamma Agro']);
  const csv = path.join(dir, 'list.csv'); writeFileSync(csv, 'Client name,Notes\nZed Foods,x\nAce Foods,y\n');
  const out = path.join(dir, 'c2.json'), c = await importClients({ file: csv, out, replaceAll: true });
  assert.equal(c.ok, true); assert.deepEqual(c.clients.map((x) => x.name), ['Ace Foods', 'Zed Foods']);
  assert.equal(c.map.nameHeading, 'Client name');
  rmSync(dir, { recursive: true, force: true });
});

test('--column picks the names column; an unknown column is an error', async () => {
  const dir = tmp(), file = await xlsx(dir, [['No', 'Who', 'Other name'], [1, 'One Ltd', 'x'], [2, 'Two Ltd', 'y']]);   // 'Who' is not a heading the importer would guess
  const r = await importClients({ file, out: path.join(dir, 'o.json'), column: 'Who', replaceAll: true });
  assert.deepEqual(r.clients.map((c) => c.name), ['One Ltd', 'Two Ltd']);
  const r2 = await importClients({ file, out: path.join(dir, 'o2.json'), column: 'C', replaceAll: true });
  assert.deepEqual(r2.clients.map((c) => c.name), ['x', 'y']);
  await assert.rejects(importClients({ file, out: path.join(dir, 'o3.json'), column: 'Nope' }), /not found/);
  rmSync(dir, { recursive: true, force: true });
});

test('cleaning: spaces and the trailing dot', () => {
  assert.deepEqual(cleanName('  Acron  Plast Pvt. Ltd.  '), { value: 'Acron Plast Pvt. Ltd', fixes: ['extra spaces removed', 'trailing dot removed'] });
  assert.equal(cleanName('Seva Automotive Pvt.Ltd').value, 'Seva Automotive Pvt.Ltd');       // a dot inside is fine
  assert.equal(cleanName('Acron Plast Pvt. Ltd.C.5').value, 'Acron Plast Pvt. Ltd.C.5');
  assert.equal(cleanName('Name With\tOdd Spaces').value, 'Name With Odd Spaces');
  assert.equal(cleanName('Plain').fixes.length, 0);
});

test('problems stop the write and are listed with row, client, problem and fix', async () => {
  const dir = tmp(), out = path.join(dir, 'clients.json');
  writeFileSync(out, '[{"id":"c01","name":"Existing","folder":"Existing"}]\n');
  const rows = [['Clients'], ['Fine One'], ['Bad/Slash'], ['fine  one'], ['CON'], ['What?'], ['x'.repeat(101)]];
  const r = await importClients({ file: await xlsx(dir, rows), out, allowRemove: true });
  assert.equal(r.ok, false); assert.equal(r.written, false);
  const byRow = Object.fromEntries(r.problems.map((p) => [p.row + ':' + p.problem.slice(0, 18), p]));
  assert.ok(r.problems.some((p) => p.row === 3 && /character Windows and OneDrive do not allow: \//.test(p.problem)));
  assert.ok(r.problems.some((p) => p.row === 4 && /same name as row 2/.test(p.problem)), 'duplicate ignoring case and spaces');
  assert.ok(r.problems.some((p) => p.row === 4 && /same folder as row 2/.test(p.problem)));
  assert.ok(r.problems.some((p) => p.row === 5 && /reserved Windows name/.test(p.problem)));
  assert.ok(r.problems.some((p) => p.row === 6 && /do not allow: \?/.test(p.problem)));
  assert.ok(r.problems.some((p) => p.row === 7 && /101 characters/.test(p.problem)));
  assert.ok(r.problems.every((p) => p.suggestion), 'every problem has a suggested fix');
  assert.equal(readFileSync(out, 'utf8'), '[{"id":"c01","name":"Existing","folder":"Existing"}]\n', 'the old file is untouched');
  void byRow; rmSync(dir, { recursive: true, force: true });
});

test('two names that would share a Google Sheet tab are a problem', async () => {
  const dir = tmp(), { r } = await run(dir, [['Client'], ['Plant A/B'], ['Plant A-B']].map((x) => x), { replaceAll: true });
  assert.ok(r.problems.some((p) => /same sheet tab name/.test(p.problem)));
  rmSync(dir, { recursive: true, force: true });
});

test('folder and location columns, in several formats', async () => {
  const dir = tmp();
  const rows = [['Client', 'OneDrive folder', 'Location'],
    ['Site A', 'Site A Folder', '19.9975, 73.7898'],
    ['Site B', null, 'https://www.google.com/maps/place/X/@20.0110,73.7620,17z/data=!3m1'],
    ['Site C', null, 'https://www.google.com/maps/place/Y/data=!3d19.9615!4d73.7670'],
    ['Site D', null, 'https://maps.google.com/?q=19.9420,73.8300'],
    ['Site E', null, null]];
  const { r } = await run(dir, rows, { replaceAll: true });
  assert.equal(r.ok, true);
  const get = (n) => r.clients.find((c) => c.name === n);
  assert.equal(get('Site A').folder, 'Site A Folder'); assert.equal(get('Site B').folder, 'Site B');
  assert.deepEqual([get('Site A').lat, get('Site A').lng], [19.9975, 73.7898]);
  assert.deepEqual([get('Site B').lat, get('Site B').lng], [20.011, 73.762]);
  assert.deepEqual([get('Site C').lat, get('Site C').lng], [19.9615, 73.767]);
  assert.deepEqual([get('Site D').lat, get('Site D').lng], [19.942, 73.83]);
  assert.equal('lat' in get('Site E'), false, 'no location: left out');
  assert.deepEqual(parseLocation('19.99 73.78'), { lat: 19.99, lng: 73.78 });
  assert.equal(parseLocation(''), null); assert.equal(parseLocation('near the bus stand'), undefined);
  rmSync(dir, { recursive: true, force: true });
});

test('a location outside India, or not a position, is a problem', async () => {
  const dir = tmp(), { r } = await run(dir, [['Client', 'Location'], ['Swapped', '73.7898, 19.9975'], ['Words', 'next to the mill'], ['Fine', '19.99, 73.78']], { replaceAll: true });
  assert.ok(r.problems.some((p) => p.client === 'Swapped' && /outside India/.test(p.problem)));
  assert.ok(r.problems.some((p) => p.client === 'Words' && /not a position/.test(p.problem)));
  assert.ok(!r.problems.some((p) => p.client === 'Fine'));
  rmSync(dir, { recursive: true, force: true });
});

test('ids stay put when the list is re-imported, reordered or extended', async () => {
  const dir = tmp(), out = path.join(dir, 'clients.json');
  const first = await importClients({ file: await xlsx(dir, [['Client'], ['Zed'], ['Ace'], ['Mid']], 'a.xlsx'), out, replaceAll: true });
  assert.deepEqual(first.clients.map((c) => [c.name, c.id]), [['Ace', 'c02'], ['Mid', 'c03'], ['Zed', 'c01']]);
  // HR re-sorts the sheet and adds a client in the middle: the old ids must not move
  const second = await importClients({ file: await xlsx(dir, [['Client'], ['Mid'], ['New One'], ['Zed'], ['Ace']], 'b.xlsx'), out });
  assert.equal(second.ok, true);
  assert.deepEqual(Object.fromEntries(second.clients.map((c) => [c.name, c.id])), { Ace: 'c02', Mid: 'c03', Zed: 'c01', 'New One': 'c04' });
  // renaming only the case or spacing keeps the id (matched by folder)
  const third = await importClients({ file: await xlsx(dir, [['Client'], ['mid'], ['New One'], ['Zed'], ['Ace']], 'c.xlsx'), out });
  assert.equal(third.clients.find((c) => c.name === 'mid').id, 'c03');
  rmSync(dir, { recursive: true, force: true });
});

test('dropping a client is refused (stored visits use its id) unless allowed; --replace-all starts again', async () => {
  const dir = tmp(), out = path.join(dir, 'clients.json');
  await importClients({ file: await xlsx(dir, [['Client'], ['One'], ['Two'], ['Three']], 'a.xlsx'), out, replaceAll: true });
  const short = await xlsx(dir, [['Client'], ['One'], ['Three']], 'b.xlsx');
  const refused = await importClients({ file: short, out });
  assert.equal(refused.ok, false); assert.match(refused.problems[0].problem, /1 client\(s\) in the current list are not in the sheet/);
  assert.equal(read(out).length, 3, 'file untouched');
  const allowed = await importClients({ file: short, out, allowRemove: true });
  assert.equal(allowed.ok, true); assert.deepEqual(read(out).map((c) => c.id), ['c01', 'c03']);     // ids are not renumbered
  // a new client after a removal never gets a removed id of an earlier client that is still the highest... it takes the next number
  const more = await importClients({ file: await xlsx(dir, [['Client'], ['One'], ['Three'], ['Four']], 'c.xlsx'), out });
  assert.equal(more.clients.find((c) => c.name === 'Four').id, 'c04');
  const fresh = await importClients({ file: short, out, replaceAll: true });
  assert.deepEqual(fresh.clients.map((c) => c.id), ['c01', 'c02']);
  rmSync(dir, { recursive: true, force: true });
});

test('--dry-run writes nothing', async () => {
  const dir = tmp(), out = path.join(dir, 'clients.json');
  const r = await importClients({ file: await xlsx(dir, [['Client'], ['One']]), out, replaceAll: true, dryRun: true });
  assert.equal(r.ok, true); assert.equal(r.written, false); assert.equal(existsSync(out), false);
  rmSync(dir, { recursive: true, force: true });
});

test('column detection chooses the heading with names under it', () => {
  const grid = [['', 'Customer Name', 'Site name'], ['', '', 'A'], ['', '', 'B']];
  assert.equal(mapColumns({ grid }).nameCol, 2);
});

test('the command line refuses to write when a check fails, and says why', async () => {
  const dir = tmp(), out = path.join(dir, 'clients.json'), file = await xlsx(dir, [['Client'], ['Good'], ['Bad:Name']]);
  const script = path.resolve('scripts/import-clients.js');
  let code = 0, text = '';
  try { execFileSync('node', [script, file, '--out', out, '--replace-all'], { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { code = e.status; text = e.stdout; }
  assert.equal(code, 1); assert.match(text, /PROBLEMS \(1\)\. Nothing was written\./); assert.match(text, /row \| client \| problem \| suggested fix/); assert.match(text, /3 \| Bad:Name/);
  assert.equal(existsSync(out), false);
  const ok = await xlsx(dir, [['Client'], ['Good'], ['Fine Too']], 'ok.xlsx');
  const good = execFileSync('node', [script, ok, '--out', out, '--replace-all'], { encoding: 'utf8' });
  assert.match(good, /Wrote .*clients\.json {2}\(2 clients, sorted by name\)/); assert.match(good, /folder {5}: no Folder column, so folder = name/);
  assert.deepEqual(read(out).map((c) => c.name), ['Fine Too', 'Good']);
  rmSync(dir, { recursive: true, force: true });
});

// ---------- AMC dates typed in by the company ----------
test('optional Installation date and AMC expiry columns are read; the contract start date is never used', async () => {
  const dir = tmp();
  const rows = [
    ['Site', 'start date', 'end date', 'Installation date', 'AMC expiry'],
    ['Go Green', '2025-12-01', '2026-11-30', '15-03-2024', '31/03/2027'],
    ['Samsonite', '2026-08-01', '2027-07-31', '', ''],
    ['Koso J1', null, null, new Date(Date.UTC(2023, 5, 10)), '2026-12-15'],
  ];
  const { out, r } = await run(dir, rows, { replaceAll: true });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  const byName = Object.fromEntries(read(out).map((c) => [c.name, c]));
  assert.deepEqual([byName['Go Green'].installed, byName['Go Green'].amcExpiry], ['2024-03-15', '2027-03-31']);   // day first, as in India
  assert.equal(byName['Samsonite'].installed, undefined); assert.equal(byName['Samsonite'].amcExpiry, undefined);   // the "start date" / "end date" columns are not copied
  assert.deepEqual([byName['Koso J1'].installed, byName['Koso J1'].amcExpiry], ['2023-06-10', '2026-12-15']);
  rmSync(dir, { recursive: true, force: true });
});

test('a date that is not a date, or an AMC that ends before the installation, stops the import', async () => {
  for (const [rows, text] of [
    [[['Site', 'AMC expiry'], ['A', 'next year']], /AMC expiry date .{1,3}next year.{1,3} is not a date/],
    [[['Site', 'AMC expiry'], ['A', '31-02-2027']], /not a date/],
    [[['Site', 'Installation date', 'AMC expiry'], ['A', '2026-05-01', '2025-05-01']], /before the installation/],
  ]) {
    const dir = tmp(), { r, out } = await run(dir, rows, { replaceAll: true });
    assert.equal(r.ok, false); assert.equal(existsSync(out), false); assert.match(JSON.stringify(r.problems), text);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseDate and checkClientList', async () => {
  const { parseDate, checkClientList } = await import('../server/clients-import.js');
  assert.equal(parseDate(''), ''); assert.equal(parseDate('2027-03-31'), '2027-03-31'); assert.equal(parseDate('1-2-2027'), '2027-02-01');
  for (const bad of ['31-13-2027', '2027-02-30', 'tomorrow', '12/2027', '1999-01-01']) assert.equal(parseDate(bad), undefined, bad);
  const ok = { id: 'c01', name: 'A', folder: 'A' };
  assert.deepEqual(checkClientList([{ ...ok, installed: '2024-01-01', amcExpiry: '2027-01-01' }]), []);
  assert.match(JSON.stringify(checkClientList([{ ...ok, amcExpiry: '01-01-2027' }])), /amcExpiry is not a date/);
});
