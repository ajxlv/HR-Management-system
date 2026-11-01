import { promises as fs } from 'node:fs';
import path from 'node:path';

// Stand-in for OneDrive: a folder on disk laid out exactly like OneDrive.
export class LocalStorage {
  constructor(base) { this.base = base; } // any folder, e.g. the OneDrive sync folder

  // Used by the HR page to show thumbnails. relPath comes from our own records, never from the user.
  async read(relPath) {
    const file = path.join(this.base, relPath);
    if (!file.startsWith(this.base + path.sep)) throw httpError(400, 'Bad path');
    return fs.readFile(file);
  }

  async saveFile({ rootFolder, clientFolder, date, box, buffer }) {
    const clientDir = path.join(this.base, rootFolder, clientFolder);
    try { await fs.access(clientDir); }
    catch { throw httpError(422, `Client folder not found: ${rootFolder}/${clientFolder}`); }
    const dir = path.join(clientDir, date);
    await fs.mkdir(dir, { recursive: true });
    const used = (await fs.readdir(dir)).map((n) => n.match(new RegExp(`^${box}_(\\d+)\\.jpg$`))).filter(Boolean).map((m) => +m[1]);
    const name = `${box}_${Math.max(0, ...used) + 1}.jpg`;
    await fs.writeFile(path.join(dir, name), buffer, { flag: 'wx' });
    return { name, path: `${rootFolder}/${clientFolder}/${date}/${name}` };
  }
}

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
