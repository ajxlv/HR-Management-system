import { loadEnvFile } from '../env.js';
import { loadConfig, HEADERS, BOXES } from '../config.js';
import { GoogleSheet } from './google.js';

// Used by the command-line scripts: reads .env, builds the Google sheet client or explains what is missing.
export function googleFromEnv() {
  loadEnvFile();
  process.env.SHEET = 'google';
  let cfg;
  try { cfg = loadConfig(); }
  catch (e) { console.error(`Problem: ${e.message}`); process.exit(1); }
  try {
    const sheet = new GoogleSheet({ sheetId: cfg.sheetId, ...cfg.google, logoUrl: cfg.logoUrl, rootFolder: cfg.rootFolder, clients: cfg.clients }, HEADERS, BOXES.length);
    return { cfg, sheet };
  } catch (e) {
    console.error(`Problem: ${e.message}\nOpen .env and fill: SHEET_ID and GOOGLE_KEY_FILE (path to the downloaded JSON key).`);
    process.exit(1);
  }
}
