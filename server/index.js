import { readFileSync, existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

// Minimal .env loader (no dependency).
if (existsSync('.env')) {
  for (const l of readFileSync('.env', 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !l.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}
const cfg = loadConfig();
if (!cfg.cleanerPin) console.warn('WARNING: CLEANER_PIN is empty, so there is no login. Set it before go-live.');
createApp(cfg).listen(cfg.port, () => console.log(`WRS app on http://localhost:${cfg.port}  (photos: ${cfg.storage}, sheet: ${cfg.sheet})`));
