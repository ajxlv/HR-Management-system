import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { checkClientList } from '../server/clients-import.js';
import { checkFolders, createMissing, clientBase } from '../server/folders.js';
import { testConfig, FIXTURE_CLIENTS } from '../testlib/config.js';

test('the shipped server/clients.json is valid: the checks the importer runs all pass', () => {
  const cfg = loadConfig({});
  assert.ok(cfg.clients.length > 0);
  assert.deepEqual(checkClientList(cfg.clients), []);
  const names = cfg.clients.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })), 'sorted by name');
  assert.ok(cfg.clients.every((c) => !('inverters' in c)), 'no inverter count on a client');
  assert.ok(cfg.clients.every((c) => c.folder === c.name), 'folder is the site name');
  assert.ok(!cfg.clients.some((c) => /[. ]$/.test(c.name)), 'no name ends in a dot');
});

test('the fixture clients used by the tests and demos are valid too, and are not the real list', () => {
  const fixture = testConfig({}).clients, real = loadConfig({}).clients;
  assert.deepEqual(checkClientList(fixture), []);
  assert.equal(fixture.length, 6);
  assert.ok(fixture.every((c) => !real.some((r) => r.name === c.name)), 'demo names are not in the real list');
  assert.ok(FIXTURE_CLIENTS.endsWith('clients.fixture.json'));
});

test('the check refuses what Windows or OneDrive would not accept', () => {
  const bad = (c) => checkClientList([{ id: 'c01', name: 'X', folder: 'X', ...c }]).map((p) => p.problem);
  assert.deepEqual(bad({}), []);
  assert.match(bad({ folder: 'Acron Plast Pvt. Ltd.' }).join(), /ends with a dot/);
  assert.match(bad({ folder: 'A/B' }).join(), /not allowed by Windows/);
  assert.match(bad({ name: ' X' }).join(), /extra spaces/);
  assert.match(bad({ inverters: 2 }).join(), /cleaner sets it on each visit/);
  assert.match(bad({ lat: 20 }).join(), /lat without lng/);
  assert.match(bad({ id: 'client1' }).join(), /id is not like c01/);
  assert.match(checkClientList([{ id: 'c01', name: 'A', folder: 'A' }, { id: 'c01', name: 'B', folder: 'B' }]).map((p) => p.problem).join(), /duplicate id/);
  assert.match(checkClientList([{ id: 'c01', name: 'A b', folder: 'A b' }, { id: 'c02', name: 'a  b', folder: 'a b' }]).map((p) => p.problem).join(), /same name|same folder|extra spaces/);
});

// ---- the folder check (npm run seed) ----
const setup = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrs-f-'));
  const cfg = testConfig({ DATA_DIR: dir, LOCAL_ROOT: dir, ROOT_FOLDER: 'Clients' });
  return { dir, cfg, base: clientBase(cfg) };
};

test('seed: by default only reports, and finds nothing wrong when every folder exists', async () => {
  const { dir, cfg, base } = setup();
  for (const c of cfg.clients) mkdirSync(path.join(base, c.folder), { recursive: true });
  const r = await checkFolders(cfg);
  assert.equal(r.rootExists, true); assert.equal(r.present.length, 6); assert.deepEqual([r.missing.length, r.similar.length], [0, 0]);
  rmSync(dir, { recursive: true, force: true });
});

test('seed: missing folders are reported and NOT created', async () => {
  const { dir, cfg, base } = setup();
  mkdirSync(path.join(base, 'Sharma Residence'), { recursive: true });
  const r = await checkFolders(cfg);
  assert.deepEqual(r.missing.map((c) => c.name), ['Patil Agro Industries', 'Deshmukh Hospital', 'Gokhale Apartments', 'Nashik Textile Mills', 'Jadhav Farm House']);
  assert.deepEqual(readdirSync(base), ['Sharma Residence'], 'nothing was created');
  rmSync(dir, { recursive: true, force: true });
});

test('seed --create-missing creates only what is missing, never a look-alike', async () => {
  const { dir, cfg, base } = setup();
  mkdirSync(path.join(base, 'Sharma Residence'), { recursive: true });
  mkdirSync(path.join(base, 'patil agro industries'), { recursive: true });         // the real folder, spelled with other case
  mkdirSync(path.join(base, 'Deshmukh  Hospital'), { recursive: true });            // double space
  const before = await checkFolders(cfg);
  assert.deepEqual(before.similar.map((x) => [x.client.name, x.found]), [['Patil Agro Industries', 'patil agro industries'], ['Deshmukh Hospital', 'Deshmukh  Hospital']]);
  const r = await createMissing(cfg);
  assert.deepEqual(r.created.map((c) => c.name), ['Gokhale Apartments', 'Nashik Textile Mills', 'Jadhav Farm House']);
  assert.deepEqual(readdirSync(base).sort(), ['Deshmukh  Hospital', 'Gokhale Apartments', 'Jadhav Farm House', 'Nashik Textile Mills', 'Sharma Residence', 'patil agro industries'], 'no second Patil or Deshmukh folder');
  assert.equal((await createMissing(cfg)).created.length, 0, 'running it again creates nothing');
  rmSync(dir, { recursive: true, force: true });
});

test('seed: a missing root folder is never created unless asked, so a wrong LOCAL_ROOT cannot make a fake tree', async () => {
  const { dir, cfg, base } = setup();
  const r = await createMissing(cfg);
  assert.equal(r.rootExists, false); assert.deepEqual(r.created, []);
  assert.throws(() => readdirSync(base));
  const forced = await createMissing(cfg, { createRoot: true });
  assert.equal(forced.created.length, 6); assert.equal(readdirSync(base).length, 6);
  rmSync(dir, { recursive: true, force: true });
});
