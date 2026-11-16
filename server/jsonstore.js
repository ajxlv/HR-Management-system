// Where the app keeps its small JSON records (state.json: visits and photos, sites.json: added and deleted sites).
//   FileJson:     a file on this computer (the normal way)
//   OneDriveJson: a file inside OneDrive (<root folder>/_app-data/), for hosts with no permanent disk, such as Vercel.
//                 Every write says "only if nobody saved since I read it"; if somebody did, the request fails with 503 and the
//                 phone sends it again (it keeps everything until the server says OK).
import { promises as fs, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { httpError } from './storage/local.js';

export class FileJson {
  constructor(file) { this.file = file; this.sync = true; }
  readSync() { return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : null; }
  async read() { return this.readSync(); }
  async write(obj) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
    await fs.rename(tmp, this.file);
  }
}

export class OneDriveJson {
  constructor(onedrive, rootFolder, name) { Object.assign(this, { od: onedrive, rootFolder, name, etag: null, sync: false }); }
  async read() {
    const r = await this.od.getJson(this.rootFolder, this.name);
    this.etag = r ? r.etag : null;
    return r ? r.obj : null;
  }
  async write(obj) {
    try { this.etag = await this.od.putJson(this.rootFolder, this.name, obj, this.etag); }
    catch (e) {
      if (e.status === 412) throw httpError(503, 'Someone else saved at the same moment. Trying again.');
      throw e;
    }
  }
}
