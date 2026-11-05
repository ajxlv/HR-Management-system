// Checks (and, only when told to, creates) the client folders where the app saves photos.
// The real folders already exist in OneDrive, so by default this only REPORTS. It never creates a look-alike
// of a folder that exists under a slightly different spelling.
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const clientBase = (cfg) => path.join(cfg.localRoot || path.join(cfg.dataDir, 'onedrive'), cfg.rootFolder);
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export async function checkFolders(cfg) {
  const base = clientBase(cfg);
  let entries = null;
  try { entries = (await fs.readdir(base, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* root missing */ }
  if (entries === null) return { base, rootExists: false, present: [], missing: [], similar: [] };
  const exact = new Set(entries), loose = new Map(entries.map((n) => [squash(n), n]));
  const present = [], missing = [], similar = [];
  for (const c of cfg.clients) {
    if (exact.has(c.folder)) present.push(c);
    else if (loose.has(squash(c.folder))) similar.push({ client: c, found: loose.get(squash(c.folder)) });   // e.g. different case or spacing
    else missing.push(c);
  }
  return { base, rootExists: true, present, missing, similar };
}

// Creates the folders that are really missing. A client with a similar existing folder is left alone.
export async function createMissing(cfg, { createRoot = false } = {}) {
  const r = await checkFolders(cfg);
  if (!r.rootExists) {
    if (!createRoot) return { ...r, created: [] };
    await fs.mkdir(r.base, { recursive: true });
    return createMissing(cfg);
  }
  const created = [];
  for (const c of r.missing) { await fs.mkdir(path.join(r.base, c.folder)); created.push(c); }
  return { ...r, created, missing: [] };
}
