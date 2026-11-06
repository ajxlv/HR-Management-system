import { loadEnvFile } from './env.js';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

loadEnvFile();
const cfg = loadConfig();
if (!cfg.vendors.length) console.warn('WARNING: no PIN is set (VENDORS or CLEANER_PIN), so there is no login. Set it before go-live.');
else console.log(`Sign-in: ${cfg.vendors.length} vendor${cfg.vendors.length === 1 ? '' : 's'} (${cfg.vendors.map((v) => v.name).join(', ')})`);
const app = createApp(cfg);
app.listen(cfg.port, () => {
  console.log(`WRS app on http://localhost:${cfg.port}  (photos: ${cfg.storage}, sheet: ${cfg.sheet})`);
  // Check the Google connection once. A failure never stops the app: visits are saved and rows are retried.
  if (cfg.sheet === 'google') {
    app.sheet.check().then((r) => console.log(r.ok ? `Google Sheet: ${r.message}` : `Google Sheet NOT working yet: ${r.message}\n  Visits are still saved; their rows will be written when this is fixed.`));
  }
});
