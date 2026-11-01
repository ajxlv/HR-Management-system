// Creates the demo client folders in the local OneDrive stand-in (data/onedrive/Clients/...).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';

const cfg = loadConfig();
for (const c of cfg.clients) mkdirSync(path.join(cfg.dataDir, 'onedrive', cfg.rootFolder, c.folder), { recursive: true });
console.log(`Created ${cfg.clients.length} demo client folders in ${cfg.dataDir}/onedrive/${cfg.rootFolder}`);
