// DEMO ONLY: runs the whole app as one Vercel function with sample data.
// Vercel has no permanent disk, so everything lives in /tmp and is re-created on each cold start.
// For real use, run server/index.js on a PC or VM with a disk (see README).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/demo-seed.js';

const dir = '/tmp/wrs-demo';
const e = process.env;
const cfg = loadConfig({
  DATA_DIR: dir, SHEET: 'excel', STORAGE: 'local',
  CLEANER_NAME: e.CLEANER_NAME || 'Ramesh', CLEANER_PIN: e.CLEANER_PIN || '1234',
  REPORT_KEY: e.REPORT_KEY || 'hr-demo', SESSION_SECRET: e.SESSION_SECRET || 'demo-secret',
});
for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', cfg.rootFolder, c.folder), { recursive: true });

const app = createApp(cfg);
const ready = (async () => {
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  await seedDemo(`http://127.0.0.1:${app.address().port}`, cfg);
})();

export default async function handler(req, res) {
  await ready;
  app.emit('request', req, res);
}
