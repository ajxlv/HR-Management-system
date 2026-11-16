// The list of sites (clients). server/clients.json is the starting list; the admin and the cleaners change it
// from the app. Changes are kept in sites.json (see jsonstore.js) so clients.json is never rewritten:
//   added:   sites typed in by the admin or by a cleaner ("not listed")
//   deleted: ids removed by the admin. A deleted site disappears from the dropdown, but old visits still know it.
import { FileJson } from './jsonstore.js';
import { httpError } from './storage/local.js';

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const BAD = /["*:<>?/\\|\u0000-\u001f]/;
const empty = () => ({ added: [], deleted: [] });

export function cleanSiteName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
  if (!name) throw httpError(400, 'Please type the site name');
  if (name.length > 100) throw httpError(400, 'The site name is too long (100 characters at most)');
  if (BAD.test(name)) throw httpError(400, 'The site name cannot contain " * : < > ? / \\ |');
  return name;
}

export class SiteStore {
  // `clients` is the live array the rest of the app uses; this class changes it in place.
  // `source` is a file path, or a store from jsonstore.js.
  constructor(source, clients) {
    this.store = typeof source === 'string' ? new FileJson(source) : source;
    this.clients = clients;
    this.base = clients.map((c) => ({ ...c }));                  // the starting list from clients.json
    this.data = (this.store.sync ? this.store.readSync() : null) ?? empty();
    this.apply();
  }
  // Rebuilds the live list from the starting list plus what was added and deleted.
  apply() {
    this.data.added ||= []; this.data.deleted ||= [];
    this.clients.length = 0;
    this.clients.push(...this.base.map((c) => ({ ...c })));
    for (const a of this.data.added) if (!this.clients.some((c) => c.id === a.id)) this.clients.push({ ...a });
    for (const c of this.clients) if (this.data.deleted.includes(c.id)) c.deleted = true;
  }
  async refresh() {
    if (this.store.sync) return;
    this.data = (await this.store.read()) ?? empty();
    this.apply();
  }
  get(id) { return this.clients.find((c) => c.id === id); }
  active() { return this.clients.filter((c) => !c.deleted); }
  save() { return this.store.write(this.data); }

  async add(rawName, addedBy) {
    const name = cleanSiteName(rawName);
    const dup = this.active().find((c) => squash(c.name) === squash(name));
    if (dup) return { site: dup, existed: true };                       // typed twice: use the one that is already there
    const next = Math.max(0, ...this.clients.map((c) => +(/^[a-z]+(\d+)$/.exec(c.id) || [0, 0])[1])) + 1;
    const site = { id: `m${next}`, name, folder: name, addedBy: addedBy || 'admin' };
    this.clients.push(site); this.data.added.push(site);
    await this.save();
    return { site, existed: false };
  }

  async remove(id) {
    const c = this.get(id);
    if (!c || c.deleted) throw httpError(404, 'Site not found');
    c.deleted = true;
    if (!this.data.deleted.includes(id)) this.data.deleted.push(id);
    await this.save();
    return c;
  }
}
