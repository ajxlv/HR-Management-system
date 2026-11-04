// npm run demo:google : sends 3 sample visits into the REAL Google Sheet so you can see the formatted layout.
//   Sharma Residence : complete visit (2 inverters, everything ON)
//   Patil Agro       : Challan and Inverter 3 photo missing, no customer signature
//   Patil Agro       : OFF items, location not verified, a defect (4 inverters)
// Photos are saved in demo-output-google/ (not in OneDrive).
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { googleFromEnv } from '../server/sheets/factory.js';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { createVisitSender } from '../server/demo-seed.js';

const { sheet: probe } = googleFromEnv();   // reads .env, sets SHEET=google
const dir = path.resolve('demo-output-google');
rmSync(dir, { recursive: true, force: true });
const cfg = loadConfig(process.env, { dataDir: dir, storage: 'local', localRoot: '', sheetRetryMs: 0 });
for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', cfg.rootFolder, c.folder), { recursive: true });

const check = await probe.check();
console.log(check.ok ? check.message : `NOT WORKING: ${check.message}`);
if (!check.ok) process.exit(1);

const app = createApp(cfg);
const visit = createVisitSender(app.direct, cfg);
await visit({ client: 'c01', back: 1 });                                                       // complete, all ON
await visit({ client: 'c02', back: 1, photos: { Challan: 0, Inverter3: 0 }, sign: { customer: 'No' }, overall: 'Partly completed' });   // missing boxes and a signature
await visit({ client: 'c02', back: 0, off: ['MCB', 'Internet'], na: ['SPD'], location: 'gallery', defects: 'Yes', details: 'Two panels cracked on the east side. MCB tripped on string 3.' });
const left = await app.direct.retryPending();
console.log(left.left ? `${left.left} row(s) could not be written yet; they stay queued in ${dir}.` : '3 visits written.');
console.log(`Open: https://docs.google.com/spreadsheets/d/${cfg.sheetId}`);
process.exit(left.left ? 1 : 0);
