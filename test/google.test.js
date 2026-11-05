import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeGoogle } from '../testlib/fake-google.js';
import { GoogleSheet } from '../server/sheets/google.js';
import { explain, fromApiResponse } from '../server/sheets/google-errors.js';
import { loadGoogleCredentials } from '../server/config.js';
import { testConfig } from '../testlib/config.js';
import { HEADERS, colIndex, COLUMNS } from '../server/form.js';
import { okAnswers, rowOf, fakeVisit } from '../testlib/helpers.js';
import { createApp } from '../server/app.js';
import { letter, CLIENT_TAB, OVERVIEW_HEADERS } from '../server/sheets/layout.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const clients = testConfig({}).clients;
const make = (extra = {}, fake = createFakeGoogle()) => ({
  fake,
  sheet: new GoogleSheet({ sheetId: 'SHEET123', clientEmail: 'wrs@wrs-hr.iam.gserviceaccount.com', privateKey, rootFolder: 'Clients', clients, ...extra }, HEADERS, { fetch: fake.fetch, now: () => Date.parse('2026-11-02T10:00:00Z') }),
});
// A full 28-cell row for client 0 (Sharma Residence, 2 inverters), like the app builds it
const row = (o = {}) => { const r = rowOf(clients[0], { photos: { Before: 2, After: 1, Inverter1: 1, Challan: 1 }, answers: okAnswers({ electrical: { MCB: 'OFF' } }), defects: 'Yes', details: 'Cracked panel' }); for (const [k, v] of Object.entries(o)) r[/^\d+$/.test(k) ? +k : HEADERS.indexOf(k)] = v; return r; };

test('new client tab: banner, group band, header at row 5, data from row 6, appended below the banner', async () => {
  const { fake, sheet } = make({ logoUrl: 'https://example.com/logo.png' });
  await sheet.appendRow('Sharma Residence', row(), { client: clients[0] });
  await sheet.appendRow('Sharma Residence', row({ 0: '2026-11-03' }), { client: clients[0] });
  const t = 'Sharma Residence', cell = (c) => fake.cell(t, c);
  assert.equal(cell('A1'), '=IMAGE("https://example.com/logo.png", 1)');
  assert.equal(cell('D1'), 'Sharma Residence: Panel Cleaning Visits');
  assert.match(cell('A2'), /^Last updated: 2026-11-02 \d\d:\d\d IST$/);
  assert.equal(cell('D2'), 'Photos: OneDrive / Clients / Sharma Residence');
  // the group band above the header: Photos | Electrical checklist | Signatures | Work done | Result
  assert.deepEqual(['D4', 'I4', 'P4', 'R4', 'X4'].map(cell), ['Photos', 'Electrical checklist', 'Signatures', 'Work done', 'Result']);
  assert.deepEqual(HEADERS.map((_, i) => cell(`${letter(i)}5`)), HEADERS);
  assert.deepEqual(fake.appended.map((a) => a.row), [6, 7]);                       // never on rows 1 to 5
  assert.equal(fake.appended[0].option, 'USER_ENTERED');                           // real date, not text
  assert.equal(fake.appended[0].insert, 'OVERWRITE');                              // fills pre-formatted rows; INSERT_ROWS copied the header style
  assert.equal(fake.appended[0].values.length, 28);
  const sh = fake.sheet(t);
  assert.equal(sh.frozen, 5); assert.equal(sh.frozenCols, 3);                      // header rows, and date + submitted at + cleaner
  assert.ok(sh.filter, 'basic filter set');
  assert.equal(sh.bands.length, 1);
  assert.equal(sh.cf.length, 23);                                                  // see layout.js: uploaded/not x4, inverters x2, ON/OFF/N/A, sign, work, overall x3, defects x2, checks
  // Google refuses to freeze columns through a merged cell: no merge may cross the line after column 3
  assert.ok(sh.merges.every((m) => m.endColumnIndex <= 3 || m.startColumnIndex >= 3), 'no merge crosses the freeze line');
  assert.equal(sh.merges.length, 4 + 1 + 5);                                       // logo, title, updated, photos line, blank corner, five groups
  assert.equal(sh.requests.filter((r) => r.updateDimensionProperties?.range.dimension === 'COLUMNS').length, HEADERS.length);
  const heights = sh.requests.filter((r) => r.updateDimensionProperties?.range.dimension === 'ROWS').map((r) => r.updateDimensionProperties.properties.pixelSize);
  assert.deepEqual(heights, CLIENT_TAB.heights);
  const widths = sh.requests.filter((r) => r.updateDimensionProperties?.range.dimension === 'COLUMNS').map((r) => r.updateDimensionProperties.properties.pixelSize);
  assert.deepEqual(widths, COLUMNS.map((c) => c.width));
});

test('no logo url: bold brand text instead of IMAGE', async () => {
  const { fake, sheet } = make();
  await sheet.appendRow('Sharma Residence', row(), { client: clients[0] });
  assert.equal(fake.cell('Sharma Residence', 'A1'), 'WRS Energy');
});

test('colour rules cover ON / OFF / N/A, Yes / No, Inverters and the overall status', async () => {
  const { fake, sheet } = make();
  await sheet.appendRow('Sharma Residence', row(), { client: clients[0] });
  const rules = fake.sheet('Sharma Residence').cf.map((r) => ({ cols: [r.ranges[0].startColumnIndex, r.ranges[0].endColumnIndex], type: r.booleanRule.condition.type, v: r.booleanRule.condition.values[0].userEnteredValue, bg: r.booleanRule.format.backgroundColor }));
  const hc = (h) => HEADERS.indexOf(h);
  const at = (col, v) => rules.find((r) => r.cols[0] <= hc(col) && hc(col) < r.cols[1] && r.v === v);
  const colour = (rule) => { const { red: r, green: g, blue: b } = rule.bg; return Math.abs(r - g) < 0.03 && Math.abs(g - b) < 0.05 ? 'grey' : r > 0.9 && g < 0.9 ? 'red' : g > 0.9 && r < 0.9 ? 'green' : 'amber'; };
  assert.equal(colour(at('MCB', 'ON')), 'green'); assert.equal(colour(at('MCB', 'OFF')), 'red'); assert.equal(colour(at('MCB', 'N/A')), 'grey');
  assert.equal(colour(at('Customer signature', 'No')), 'red'); assert.equal(colour(at('Supervisor signature', 'Yes')), 'green');
  assert.equal(colour(at('Washed with water', 'No')), 'red'); assert.equal(colour(at('After photos taken', 'Yes')), 'green');
  assert.equal(colour(at('Overall status', 'Not completed')), 'red'); assert.equal(colour(at('Overall status', 'Completed')), 'green'); assert.ok(at('Overall status', 'Partly completed'));
  assert.equal(colour(at('Bill', 'Not uploaded')), 'red'); assert.equal(colour(at('Before', 'Uploaded')), 'green');
  const inv = rules.filter((r) => r.cols[0] === colIndex('Inverters'));
  assert.equal(inv.length, 2);
  assert.ok(inv.every((r) => r.type === 'CUSTOM_FORMULA' && r.v.includes('FIND(" of "')), 'Inverters is judged from "n of m uploaded"');
  assert.ok(rules.some((r) => r.cols[0] === colIndex('checks') && r.v.includes('<>"OK"')), 'Checks amber when not OK');
});

test('Overview tab is first, with the new OFF and not-completed counts, as live formulas', async () => {
  const { fake, sheet } = make();
  await sheet.appendRow('Sharma Residence', row(), { client: clients[0] });
  await sheet.appendRow('Patil Agro Industries', row(), { client: clients[1] });
  assert.equal(fake.sheets[0].title, 'Overview');
  assert.equal(fake.cell('Overview', 'B1'), 'WRS Panel Cleaning: Overview');
  assert.deepEqual(OVERVIEW_HEADERS.map((_, i) => fake.cell('Overview', `${letter(i)}4`)), OVERVIEW_HEADERS);
  assert.ok(OVERVIEW_HEADERS.includes('Visits with any OFF item') && OVERVIEW_HEADERS.includes('Visits not completed'));
  assert.equal(fake.cell('Overview', 'A5'), 'Sharma Residence'); assert.equal(fake.cell('Overview', 'A6'), 'Patil Agro Industries');
  const f = Object.fromEntries(OVERVIEW_HEADERS.map((h, i) => [h, fake.cell('Overview', `${letter(i)}5`)]));
  assert.match(f['Last visit date'], /MAXIFS/); assert.match(f['Visits this month'], /COUNTIFS/);
  assert.match(f['Visits with missing photos'], /SUMPRODUCT.*"Not uploaded".*FIND\(" of "/);
  assert.match(f['Visits with any OFF item'], /SUMPRODUCT.*"OFF"/);
  assert.match(f['Visits not completed'], /COUNTIFS\(.*"<>Completed".*"<>"\)/);
  assert.match(f['Open defects'], /COUNTIFS.*"Yes"/);
  assert.equal(f['Client tab'], `=HYPERLINK("#gid=${fake.sheet('Sharma Residence').id}","Open")`);
  // the formulas look at the right client-tab columns: ACDB to Earthing Trip for OFF, Overall status for "not completed"
  assert.ok(f['Visits with any OFF item'].includes('$' + letter(colIndex('e:ACDB')) + '$6') && f['Visits with any OFF item'].includes('$' + letter(colIndex('e:EarthingTrip')) + '$6'));
  assert.ok(f['Visits not completed'].includes('$' + letter(colIndex('overall')) + '$6'));
  assert.ok(fake.sheet('Overview').cf.length >= 3, 'red highlight rules (open defects, any OFF, not completed)');
});

test('text that looks like a formula, number or date stays text; folder link works', async () => {
  const { fake, sheet } = make();
  await sheet.appendRow('Sharma Residence', row({ 'Defect details': '=1+1', Checks: '3/4 panels' }), { client: { ...clients[0], folderUrl: 'https://wrs.sharepoint.com/Clients/Sharma' } });
  const a = fake.appended[0].values;
  assert.equal(a[colIndex('details')], "'=1+1");
  assert.equal(a[colIndex('checks')], "'3/4 panels");
  assert.equal(a[colIndex('folder')], '=HYPERLINK("https://wrs.sharepoint.com/Clients/Sharma","Clients/Sharma Residence/2026-11-02")');
});

test('format:sheet can run twice without stacking banding or rules', async () => {
  const { fake, sheet } = make();
  await sheet.appendRow('Sharma Residence', row(), { client: clients[0] });
  const before = { cf: fake.sheet('Sharma Residence').cf.length, bands: fake.sheet('Sharma Residence').bands.length };
  await sheet.formatAll(); await sheet.formatAll();
  assert.deepEqual({ cf: fake.sheet('Sharma Residence').cf.length, bands: fake.sheet('Sharma Residence').bands.length }, before);
  assert.equal(fake.sheet('Overview').bands.length, 1);
});

test('plain-English error messages', () => {
  const ctx = { email: 'wrs@x.iam', sheetId: 'ABC', projectId: 'wrs-hr' };
  assert.match(explain(fromApiResponse(403, { error: { message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }), ctx), /Sheet not shared with wrs@x\.iam: open the sheet, press Share, add this email as Editor/);
  const disabled = fromApiResponse(403, { error: { message: 'Google Sheets API has not been used in project 1 before or it is disabled.', status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED', metadata: { activationUrl: 'https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=1' } }] } });
  assert.match(explain(disabled, ctx), /Sheets API not enabled: enable it here https:\/\/console\.developers\.google\.com/);
  assert.match(explain(fromApiResponse(404, { error: { message: 'Requested entity was not found.' } }), ctx), /Wrong SHEET_ID \(ABC\)/);
  assert.match(explain(Object.assign(new Error('fetch failed'), { kind: 'network' }), ctx), /Cannot reach Google/);
  assert.match(explain(Object.assign(new Error('invalid_grant: Invalid JWT'), { kind: 'auth' }), ctx), /clock/);
});

test('check(): ok message, and a clear message when the sheet is not shared', async () => {
  const a = make(); const ok = await a.sheet.check();
  assert.equal(ok.ok, true); assert.equal(ok.message, "OK: wrote to 'WRS Cleaning Status'");
  assert.equal(a.fake.sheet('_check'), undefined, 'test tab removed again');
  const b = make(); b.fake.failAlways(403, 'The caller does not have permission', {});
  const bad = await b.sheet.check();
  assert.equal(bad.ok, false); assert.match(bad.message, /Sheet not shared with wrs@wrs-hr\.iam\.gserviceaccount\.com/);
});

test('credentials: key file, real newlines and escaped newlines all work', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrs-k-'));
  const file = path.join(dir, 'k.json');
  writeFileSync(file, JSON.stringify({ client_email: 'a@b', private_key: privateKey, project_id: 'p1' }));
  assert.equal(loadGoogleCredentials({ GOOGLE_KEY_FILE: file }).privateKey, privateKey.trim());
  assert.equal(loadGoogleCredentials({ GOOGLE_KEY_FILE: file }).projectId, 'p1');
  const escaped = JSON.stringify(privateKey).slice(1, -1);                 // text with \n as two characters
  assert.equal(loadGoogleCredentials({ GOOGLE_CLIENT_EMAIL: 'a@b', GOOGLE_PRIVATE_KEY: `"${escaped}"` }).privateKey, privateKey.trim());
  assert.equal(loadGoogleCredentials({ GOOGLE_CLIENT_EMAIL: 'a@b', GOOGLE_PRIVATE_KEY: privateKey }).privateKey, privateKey.trim());
  assert.throws(() => loadGoogleCredentials({ GOOGLE_KEY_FILE: path.join(dir, 'missing.json') }), /GOOGLE_KEY_FILE not found/);
  rmSync(dir, { recursive: true, force: true });
});

// ---- retry queue ----
const jpeg = (t) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(t)]);
function appWith(fake, dir) {
  const cfg = testConfig({ DATA_DIR: dir, SHEET: 'csv' }, { sheetRetryMs: 0 });
  for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', 'Clients', c.folder), { recursive: true });
  const sheet = new GoogleSheet({ sheetId: 'SHEET123', clientEmail: 'wrs@x', privateKey, clients: cfg.clients }, HEADERS, { fetch: fake.fetch });
  return createApp(cfg, { sheet, now: () => Date.parse('2026-11-02T10:00:00Z') });
}
const send = async (app, id, details = '') => {
  await app.direct.photo({ visit: id, client: 'c01', date: '2026-11-02', box: 'Before', taken: Date.parse('2026-11-02T04:00:00Z'), lat: 19.9976, lng: 73.7899, acc: 9 }, jpeg(id));
  return app.direct.visit({ visit: id, client: 'c01', date: '2026-11-02', defects: details ? 'Yes' : 'No', details, answers: okAnswers() });
};

test('retry queue: a failed row waits, is retried, and is written exactly once', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrs-r-')), fake = createFakeGoogle();
  const app = appWith(fake, dir);
  fake.failAlways(403, 'The caller does not have permission', {});          // sheet not shared yet
  const r = await send(app, 'retry-visit-1');
  assert.equal(r.ok, true); assert.equal(r.sheet, 'waiting');               // the visit itself is saved
  assert.equal(fake.appended.length, 0);
  assert.deepEqual(await app.direct.retryPending(), { written: 0, left: 1 });
  fake.always = null;                                                       // HR shares the sheet
  fake.failNext(1);                                                         // and Google hiccups once more
  assert.deepEqual(await app.direct.retryPending(), { written: 0, left: 1 });
  const [a, b] = await Promise.all([app.direct.retryPending(), app.direct.retryPending()]);   // two timers at once
  assert.equal(fake.appended.length, 1, 'written exactly once');
  assert.equal(a.written + b.written, 1);
  assert.deepEqual(await app.direct.retryPending(), { written: 0, left: 0 });
  assert.equal(fake.appended.length, 1);
  assert.equal((await send(app, 'retry-visit-1')).duplicate, true);         // double submit adds nothing
  assert.equal(fake.appended.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('retry queue survives a restart and keeps the order', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrs-r2-')), fake = createFakeGoogle();
  let app = appWith(fake, dir);
  fake.failAlways(503, 'unavailable', {});
  await send(app, 'restart-visit-1'); await send(app, 'restart-visit-2', 'Loose clamp');
  fake.always = null;
  app = appWith(fake, dir);                                                 // server restarted: state.json is reloaded
  assert.deepEqual(await app.direct.retryPending(), { written: 2, left: 0 });
  assert.deepEqual(fake.appended.map((x) => x.values[colIndex('defects')]), ['No', 'Yes']);
  assert.deepEqual(await app.direct.retryPending(), { written: 0, left: 0 });
  assert.equal(fake.appended.length, 2);
  rmSync(dir, { recursive: true, force: true });
});
