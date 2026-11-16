import { FileJson } from './jsonstore.js';

// Small JSON record with every visit and photo (structured, so a later AI job can read it).
// `source` is a file path, or a store from jsonstore.js (FileJson or OneDriveJson).
export class State {
  constructor(source) {
    this.store = typeof source === 'string' ? new FileJson(source) : source;
    this.data = (this.store.sync ? this.store.readSync() : null) ?? { visits: {} };
  }
  // With a store that is not on this computer, load the newest copy before every change.
  async refresh() {
    if (this.store.sync) return;
    this.data = (await this.store.read()) ?? { visits: {} };
    this.data.visits ||= {};
  }
  visit(id) { return this.data.visits[id]; }
  create(id, init) { return (this.data.visits[id] = { id, photos: {}, submitted: null, ...init }); }
  async save() { await this.store.write(this.data); }
}
