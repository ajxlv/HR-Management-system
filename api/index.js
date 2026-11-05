// DEMO ONLY: runs the whole app as one Vercel function with sample data.
// Vercel has no permanent disk, so everything lives in /tmp and is re-created on each cold start.
// For real use, run server/index.js on a PC or VM with a disk (see README).
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { seedDemo, DEMO_CLIENTS_FILE } from '../server/demo-seed.js';

const dir = '/tmp/wrs-demo';
const e = process.env;
const cfg = loadConfig({
  DATA_DIR: dir, SHEET: 'excel', STORAGE: 'local',
  CLEANER_NAME: e.CLEANER_NAME || 'Ramesh', CLEANER_PIN: e.CLEANER_PIN || '1234',
  REPORT_KEY: e.REPORT_KEY || 'hr-demo', SESSION_SECRET: e.SESSION_SECRET || 'demo-secret',
}, { exposeErrors: true, clientsFile: DEMO_CLIENTS_FILE }); // demo only: show the real error text to help debugging
const app = createApp(cfg);

// Start-up runs on the first request, not at import time, and loads the sample data in-process (no network).
let started = null, seeded = false, startError = null;
function start() {
  return (started ||= (async () => {
    for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', cfg.rootFolder, c.folder), { recursive: true });
    if (!existsSync(path.join(dir, 'state.json'))) await seedDemo(app.direct, cfg);
    seeded = true;
    console.log('demo data ready');
  })().catch((err) => { startError = err; console.error('demo start failed', err); }));
}

const json = (res, status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj, null, 2)); };
const timeout = (ms) => new Promise((r) => setTimeout(() => r('timeout'), ms));

export default async function handler(req, res) {
  // /api/debug answers before anything else starts, to show what is wrong.
  if (req.url.startsWith('/api/debug')) {
    return json(res, 200, { node: process.version, url: req.url, host: req.headers.host, started: !!started, seeded, startError: startError && String(startError.stack || startError) });
  }
  if ((await Promise.race([start(), timeout(20000)])) === 'timeout') return json(res, 500, { error: 'Demo start-up took longer than 20 s' });
  if (startError) return json(res, 500, { error: 'Demo failed to start', detail: String(startError.stack || startError) });
  app.emit('request', req, res);
}
