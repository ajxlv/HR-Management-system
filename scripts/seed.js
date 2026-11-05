// Creates the demo client folders where the app saves photos:
// LOCAL_ROOT (for example the OneDrive sync folder) if set, otherwise the stand-in data/onedrive.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from '../server/env.js';
import { loadConfig } from '../server/config.js';

loadEnvFile();
const cfg = loadConfig();
const base = path.join(cfg.localRoot || path.join(cfg.dataDir, 'onedrive'), cfg.rootFolder);
for (const c of cfg.clients) mkdirSync(path.join(base, c.folder), { recursive: true });
console.log(`Created ${cfg.clients.length} demo client folders in ${base}`);
