import { promises as fs, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Small JSON file with every visit and photo record (structured, so a later AI job can read it).
export class State {
  constructor(file) {
    this.file = file;
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { visits: {} };
  }
  visit(id) { return this.data.visits[id]; }
  create(id, init) { return (this.data.visits[id] = { id, photos: {}, submitted: null, ...init }); }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.rename(tmp, this.file);
  }
}
