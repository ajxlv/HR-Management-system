// The real app on Vercel. Vercel has no permanent disk, so:
//   - photos and the PDF go to OneDrive (STORAGE=onedrive), and
//   - the app's own records (visits, added sites) are kept in OneDrive too, in <ROOT_FOLDER>/_app-data/ (STATE_STORE=onedrive, automatic on Vercel).
// Settings come from the Vercel project's Environment Variables (see README, "Deploy on Vercel").
// (The old sample-data demo is in demo/vercel-demo.js.)
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';

const env = process.env;
let app = null, problem = null;
try {
  const cfg = loadConfig({ ...env, DATA_DIR: env.DATA_DIR || '/tmp/wrs', SHEET: env.SHEET || 'none' });
  if (!cfg.vendors.length) throw new Error('VENDORS is not set in the Vercel environment variables, so nobody could sign in safely.');
  if (cfg.storage !== 'onedrive') throw new Error('STORAGE must be onedrive on Vercel (there is no permanent disk).');
  app = createApp(cfg);
} catch (e) { problem = e.message; console.error('Setup problem:', problem); }

export default function handler(req, res) {
  if (problem) {
    res.statusCode = 503; res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: `Setup incomplete: ${problem}` }));
  }
  app.emit('request', req, res);
}
