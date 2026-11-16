import { promises as fs } from 'node:fs';
import path from 'node:path';

// Stand-in for OneDrive: a folder on disk laid out exactly like OneDrive.
// Layout: <base>/<rootFolder>/<entry folder>/<files>   (one entry folder per cleaning visit)
export class LocalStorage {
  constructor(base) { this.base = base; } // any folder, e.g. the OneDrive sync folder

  // Used by the HR page and the PDF. relPath comes from our own records, never from the user.
  async read(relPath) {
    const file = path.join(this.base, relPath);
    if (!file.startsWith(this.base + path.sep)) throw httpError(400, 'Bad path');
    return fs.readFile(file);
  }

  async dir(rootFolder, folder) {
    const dir = path.join(this.base, rootFolder, folder);
    if (!dir.startsWith(path.join(this.base, rootFolder) + path.sep)) throw httpError(400, 'Bad folder');
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  // A photo: Before_1.jpg, Before_2.jpg ...
  async saveFile({ rootFolder, folder, box, buffer }) {
    const dir = await this.dir(rootFolder, folder);
    const used = (await fs.readdir(dir)).map((n) => n.match(new RegExp(`^${box}_(\\d+)\\.jpg$`))).filter(Boolean).map((m) => +m[1]);
    const name = `${box}_${Math.max(0, ...used) + 1}.jpg`;
    await fs.writeFile(path.join(dir, name), buffer, { flag: 'wx' });
    return { name, path: `${rootFolder}/${folder}/${name}` };
  }

  // A file with a fixed name (the PDF). Writing it again replaces it.
  async saveNamed({ rootFolder, folder, name, buffer }) {
    const dir = await this.dir(rootFolder, folder);
    await fs.writeFile(path.join(dir, name), buffer);
    return { name, path: `${rootFolder}/${folder}/${name}` };
  }
}

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
