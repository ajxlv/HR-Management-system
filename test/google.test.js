import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeGoogle } from '../testlib/fake-google.js';
import { GoogleSheet } from '../server/sheets/google.js';
import { explain, fromApiResponse } from '../server/sheets/google-errors.js';
import { HEADERS, BOXES, loadConfig, loadGoogleCredentials } from '../server/config.js';
import { createApp } from '../server/app.js';
import { COL } from '../server/sheets/layout.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const clients = loadConfig({}).clients;
const make = (extra = {}, fake = createFakeGoogle()) => ({
  fake,
  sheet: new GoogleSheet({ sheetId: 'SHEET123', clientEmail: 'wrs@wrs-hr.iam.gserviceaccount.com', privateKey, rootFolder: 'Clients', clients, ...extra }, HEADERS, BOXES.length, { fetch: fake.fetch, now: () => Date.parse('2026-11-02T10:00:00Z') }),
});
const row = (o = {}) => ['2026-11-02', '2026-11-02 15:30', 'Ramesh', 'Uploaded (2)', 'Uploaded (1)', 'Uploaded (1)', 'Not uploaded', 'Yes', 'Cracked panel', 'After_1: no GPS', 'Clients/Sharma Residence/2026-11-02'].map((v, i) => o[i] ?? v);

test('new client tab: banner, header at row 4, data from row 5, appended below the banner', async () => {
  const { fake, sheet } = make({ logoUrl: 'https://example.com/logo.png' });
  await sheet.appendRow('Sharma Residence', row(), { client: clients[0] });
  await sheet.appendRow('Sharma Residence', row({ 0: '2026-11-03' }), { client: clients[0] });
  const t = 'Sharma Residence';
  assert.equal(fake.cell(t, 'A1'), '=IMAGE("https://example.com/logo.png", 1)');
  assert.equal(fake.cell(t, 'B1'), 'Sharma Residence: Panel Cleaning Visits');
  assert.match(fake.cell(t, 'A2'), /^Photos: OneDrive \/ Clients \/ Sharma Residence  ·  Last updated: 2026-11-02 \d\d:\d\d IST$/);
  assert.deepEqual(HEADERS.map((_, i) => fake.cell(t, `${String.fromCharCode(65 + i)}4`)), HEADERS);
  assert.deepEqual(fake.appended.map((a) => a.row), [5, 6]);                       // never on rows 1 to 4
  assert.equal(fake.appended[0].option, 'USER_ENTERED');                           // real date, not text
  assert.equal(fake.sheet(t).frozen, 4);
  assert.ok(fake.sheet(t).filter, 'basic filter set');
  assert.equal(fake.sheet(t).bands.length, 1);
  assert.equal(fake.sheet(t).cf.length, 5);                                        // uploaded, not uploaded, yes, no, checks
  assert.equal(fake.sheet(t).merges.length, 2);                                    // title and sub-line
  const widths = fake.sheet(t).requests.filter((r) => r.updateDimensionProperties?.range.dimension === 'COLUMNS');
  assert.equal(widths.length, HEADERS.length);
  const rows = fake.sheet(t).requests.filter((r) => r.updateDimensionProperties?.range.dimension === 'ROWS').map((r) => r.updateDimensionProperties.properties.pixelSize);
  assert.deepEqual(rows, [56, 26, 10, 32]);
});

test('no logo url: bold brand text instead of IMAGE', async () => {
  const { fake, sheet } = make();
  await sheet.appendRow('Sharma Residence', row(), { client: clients[0] });
  assert.equal(fake.cell('Sharma Residence', 'A1'), 'WRS Energy');
});

test('Overview tab is first and uses live formulas', async () => {
  const { fake, sheet } = make();
  await sheet.appendRow('Sharma Residence', row(), { client: clients[0] });
  await sheet.appendRow('Patil Agro Industries', row(), { client: clients[1] });
  assert.equal(fake.sheets[0].title, 'Overview');
  assert.equal(fake.cell('Overview', 'B1'), 'WRS Panel Cleaning: Overview');
  assert.equal(fake.cell('Overview', 'A5'), 'Sharma Residence');
  assert.equal(fake.cell('Overview', 'A6'), 'Patil Agro Industries');
  const f = ['B5', 'C5', 'D5', 'E5', 'F5'].map((c) => fake.cell('Overview', c));
  assert.match(f[0], /MAXIFS/); assert.match(f[1], /COUNTIFS/); assert.match(f[2], /SUMPRODUCT/); assert.match(f[3], /COUNTIFS.*"Yes"/);
  assert.equal(f[4], `=HYPERLINK("#gid=${fake.sheet('Sharma Residence').id}","Open")`);
  assert.ok(fake.sheet('Overview').cf.length >= 1, 'red highlight rule for open defects');
});

test('text that looks like a formula, number or date stays text; folder link works', async () => {
  const { fake, sheet } = make();
  await sheet.appendRow('Sharma Residence', row({ 8: '=1+1', 9: '3/4 panels' }), { client: { ...clients[0], folderUrl: 'https://wrs.sharepoint.com/Clients/Sharma' } });
  const a = fake.appended[0].values;
  assert.equal(a[COL.details], "'=1+1");
  assert.equal(a[COL.checks], "'3/4 panels");
  assert.equal(a[COL.folder], '=HYPERLINK("https://wrs.sharepoint.com/Clients/Sharma","Clients/Sharma Residence/2026-11-02")');
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
  const cfg = loadConfig({ DATA_DIR: dir, SHEET: 'csv' }, { sheetRetryMs: 0 });
  for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', 'Clients', c.folder), { recursive: true });
  const sheet = new GoogleSheet({ sheetId: 'SHEET123', clientEmail: 'wrs@x', privateKey, clients: cfg.clients }, HEADERS, BOXES.length, { fetch: fake.fetch });
  return createApp(cfg, { sheet, now: () => Date.parse('2026-11-02T10:00:00Z') });
}
const send = async (app, id, details = '') => {
  await app.direct.photo({ visit: id, client: 'c01', date: '2026-11-02', box: 'Before', taken: Date.parse('2026-11-02T04:00:00Z'), lat: 19.9976, lng: 73.7899, acc: 9 }, jpeg(id));
  return app.direct.visit({ visit: id, client: 'c01', date: '2026-11-02', defects: details ? 'Yes' : 'No', details });
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
  assert.deepEqual(fake.appended.map((x) => x.values[COL.defects]), ['No', 'Yes']);
  assert.deepEqual(await app.direct.retryPending(), { written: 0, left: 0 });
  assert.equal(fake.appended.length, 2);
  rmSync(dir, { recursive: true, force: true });
});
