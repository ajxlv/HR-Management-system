import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';

// Hosts like Vercel read the body first (req.body) and may hide req.socket. The app must still work.
test('works when the host pre-reads the body and hides the socket', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wrs-h-'));
  const cfg = loadConfig({ DATA_DIR: dir, SHEET: 'csv', CLEANER_PIN: '1234', SESSION_SECRET: 's' });
  for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', 'Clients', c.folder), { recursive: true });
  const app = createApp(cfg);
  const host = http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks);
      req.body = (req.headers['content-type'] || '').includes('json') ? JSON.parse(raw.toString() || '{}') : raw;
    }
    Object.defineProperty(req, 'socket', { value: undefined });
    app.emit('request', req, res);
  });
  await new Promise((r) => host.listen(0, r));
  const base = `http://localhost:${host.address().port}`;

  const bad = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ pin: '0000' }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ pin: '1234' }) });
  assert.equal(ok.status, 200);
  const { token } = await ok.json();
  const today = new Date().toISOString().slice(0, 10);
  const ph = await fetch(`${base}/api/photo?visit=host-visit-1&client=c01&date=${today}&box=Bill`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' }, body: Buffer.from([0xff, 0xd8, 0xff, 1, 2]),
  });
  assert.equal(ph.status, 200);
  host.close(); rmSync(dir, { recursive: true, force: true });
});
