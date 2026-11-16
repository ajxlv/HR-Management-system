import { httpError } from './local.js';

// Microsoft 365 OneDrive for Business through Microsoft Graph (client credentials).
export class OneDriveStorage {
  constructor({ tenant, clientId, secret, driveId, user }) {
    if (!tenant || !clientId || !secret || !(driveId || user)) {
      throw new Error('OneDrive needs MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and MS_DRIVE_ID or MS_USER');
    }
    Object.assign(this, { tenant, clientId, secret });
    this.drive = driveId ? `/drives/${driveId}` : `/users/${encodeURIComponent(user)}/drive`;
    this.tok = null;
  }

  async token() {
    if (this.tok && this.tok.exp > Date.now() + 60000) return this.tok.value;
    const r = await fetch(`https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.clientId, client_secret: this.secret, grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    });
    const j = await r.json();
    if (!r.ok) throw httpError(502, `Microsoft sign-in failed: ${j.error_description || r.status}`);
    this.tok = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return this.tok.value;
  }

  async graph(method, p, { body, headers, raw } = {}) {
    const r = await fetch(`https://graph.microsoft.com/v1.0${p}`, {
      method, body: raw ? body : body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${await this.token()}`, ...(!raw && body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    });
    const text = await r.text();
    return { status: r.status, ok: r.ok, json: text ? JSON.parse(text) : {} };
  }

  enc(s) { return s.split('/').map(encodeURIComponent).join('/'); }

  // The root folder and the entry folder are created when they do not exist yet. Returns the entry folder's item id.
  async ensureFolder(rootFolder, folder) {
    let root = await this.graph('GET', `${this.drive}/root:/${this.enc(rootFolder)}`);
    if (root.status === 404) {
      root = await this.graph('POST', `${this.drive}/root/children`, { body: { name: rootFolder, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' } });
      if (root.status === 409) root = await this.graph('GET', `${this.drive}/root:/${this.enc(rootFolder)}`);
    }
    if (!root.ok) throw httpError(502, `OneDrive error ${root.status}`);
    let d = await this.graph('GET', `${this.drive}/items/${root.json.id}:/${this.enc(folder)}`);
    if (d.status === 404) {
      d = await this.graph('POST', `${this.drive}/items/${root.json.id}/children`, { body: { name: folder, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' } });
      if (d.status === 409) d = await this.graph('GET', `${this.drive}/items/${root.json.id}:/${this.enc(folder)}`);
    }
    if (!d.ok) throw httpError(502, `OneDrive error ${d.status}`);
    return d.json.id;
  }

  // Simple upload takes up to 4 MB; bigger files (the PDF with all the photos) go through an upload session in chunks.
  async put(folderId, name, buffer, behavior, contentType, ifMatch) {
    if (buffer.length < 3.5 * 1024 * 1024) {
      return this.graph('PUT', `${this.drive}/items/${folderId}:/${this.enc(name)}:/content?@microsoft.graph.conflictBehavior=${behavior}`,
        { body: buffer, raw: true, headers: { 'Content-Type': contentType, ...(ifMatch ? { 'If-Match': ifMatch } : {}) } });
    }
    const s = await this.graph('POST', `${this.drive}/items/${folderId}:/${this.enc(name)}:/createUploadSession`, { body: { item: { '@microsoft.graph.conflictBehavior': behavior } } });
    if (!s.ok) return s;
    const CHUNK = 320 * 1024 * 10;
    let last = { ok: false, status: 0, json: {} };
    for (let at = 0; at < buffer.length; at += CHUNK) {
      const part = buffer.subarray(at, Math.min(buffer.length, at + CHUNK));
      const r = await fetch(s.json.uploadUrl, { method: 'PUT', body: part, headers: { 'Content-Length': String(part.length), 'Content-Range': `bytes ${at}-${at + part.length - 1}/${buffer.length}` } });
      const text = await r.text();
      last = { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : {} };
      if (!r.ok) return last;
    }
    return last;
  }

  // The entry folder's id is remembered, so the next photo of the same entry needs no folder lookup.
  async folderId(rootFolder, folder) {
    this.ids ||= new Map();
    const key = `${rootFolder}/${folder}`;
    if (!this.ids.has(key)) this.ids.set(key, await this.ensureFolder(rootFolder, folder));
    return this.ids.get(key);
  }

  // startAt: the first number to try (the app knows what it saved already). A taken name answers 409 and the next number is tried.
  async saveFile({ rootFolder, folder, box, buffer, startAt = 1 }) {
    const key = `${rootFolder}/${folder}`;
    for (let lookup = 0; lookup < 2; lookup++) {
      const id = await this.folderId(rootFolder, folder);
      let removed = false;
      for (let n = startAt, tries = 0; tries < 8; tries++, n++) {
        const name = `${box}_${n}.jpg`;
        const up = await this.put(id, name, buffer, 'fail', 'image/jpeg');
        if (up.ok) return { name, path: `${rootFolder}/${folder}/${name}` };
        if (up.status === 404) { this.ids.delete(key); removed = true; break; }   // the folder was removed meanwhile: look it up again
        if (up.status !== 409) throw httpError(502, `OneDrive upload failed ${up.status}`);
      }
      if (!removed) break;
    }
    throw httpError(502, 'OneDrive upload failed: file name clash');
  }

  // A file with a fixed name (the PDF). Writing it again replaces it.
  async saveNamed({ rootFolder, folder, name, buffer }) {
    const id = await this.folderId(rootFolder, folder);
    const up = await this.put(id, name, buffer, 'replace', 'application/pdf');
    if (!up.ok) throw httpError(502, `OneDrive upload failed ${up.status}`);
    return { name, path: `${rootFolder}/${folder}/${name}` };
  }

  // The app's own small records (state.json, sites.json) live in <root folder>/_app-data/.
  // getJson returns { obj, etag } or null; putJson only succeeds if nobody changed the file since that etag (else status 412).
  async dataFolderId(rootFolder) { return (this.dataFolder ||= await this.ensureFolder(rootFolder, '_app-data')); }
  async getJson(rootFolder, name) {
    const id = await this.dataFolderId(rootFolder);
    const meta = await this.graph('GET', `${this.drive}/items/${id}:/${this.enc(name)}`);
    if (meta.status === 404) return null;
    if (!meta.ok) throw httpError(502, `OneDrive error ${meta.status}`);
    const r = await fetch(`https://graph.microsoft.com/v1.0${this.drive}/items/${meta.json.id}/content`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!r.ok) throw httpError(502, `OneDrive read failed ${r.status}`);
    return { obj: JSON.parse(await r.text()), etag: meta.json.eTag };
  }
  async putJson(rootFolder, name, obj, etag) {
    const id = await this.dataFolderId(rootFolder);
    const up = await this.put(id, name, Buffer.from(JSON.stringify(obj)), 'replace', 'application/json', etag);
    if (up.status === 412) throw httpError(412, 'The file was changed by someone else');
    if (!up.ok) throw httpError(502, `OneDrive save failed ${up.status}`);
    return up.json.eTag;
  }

  // Used by the PDF and the HR page to get a saved photo back.
  async read(relPath) {
    const r = await fetch(`https://graph.microsoft.com/v1.0${this.drive}/root:/${this.enc(relPath)}:/content`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!r.ok) throw httpError(502, `OneDrive read failed ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
}
