// Fills a demo Excel sheet with made-up visits so you can see how HR's file will look.
//   npm run demo        -> demo/WRS_Cleaning_Status_demo.xlsx
//   npm run demo:serve  -> same, then keeps the app running on http://localhost:3000
//        cleaner PIN 1234, HR page /hr.html with key hr-demo
import { mkdirSync, rmSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/demo-seed.js';

const dir = path.resolve('demo-output');
rmSync(dir, { recursive: true, force: true });
const serve = process.argv.includes('--serve');
const cfg = loadConfig({ DATA_DIR: dir, SHEET: 'excel', CLEANER_NAME: 'Ramesh', CLEANER_PIN: '1234', REPORT_KEY: 'hr-demo', SESSION_SECRET: 'demo-secret', PORT: 3000 });
for (const c of cfg.clients) mkdirSync(path.join(dir, 'onedrive', cfg.rootFolder, c.folder), { recursive: true });

const server = createApp(cfg);
await new Promise((r) => server.listen(serve ? cfg.port : 0, r));
await seedDemo(`http://localhost:${server.address().port}`, cfg);
mkdirSync('demo', { recursive: true });
copyFileSync(path.join(dir, 'WRS_Cleaning_Status.xlsx'), 'demo/WRS_Cleaning_Status_demo.xlsx');
console.log('Wrote demo/WRS_Cleaning_Status_demo.xlsx');
if (serve) console.log('Demo running: cleaner  http://localhost:3000  (PIN 1234)\n              HR page  http://localhost:3000/hr.html  (key hr-demo)');
else server.close();
