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

  async saveFile({ rootFolder, clientFolder, date, box, buffer }) {
    const enc = (s) => s.split('/').map(encodeURIComponent).join('/');
    const clientPath = `${rootFolder}/${clientFolder}`;
    const c = await this.graph('GET', `${this.drive}/root:/${enc(clientPath)}`);
    if (c.status === 404) throw httpError(422, `Client folder not found in OneDrive: ${clientPath}`);
    if (!c.ok) throw httpError(502, `OneDrive error ${c.status}`);

    let d = await this.graph('GET', `${this.drive}/items/${c.json.id}:/${date}`);
    if (d.status === 404) {
      d = await this.graph('POST', `${this.drive}/items/${c.json.id}/children`, {
        body: { name: date, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' },
      });
      if (d.status === 409) d = await this.graph('GET', `${this.drive}/items/${c.json.id}:/${date}`);
    }
    if (!d.ok) throw httpError(502, `OneDrive error ${d.status}`);

    const kids = await this.graph('GET', `${this.drive}/items/${d.json.id}/children?$select=name&$top=500`);
    if (!kids.ok) throw httpError(502, `OneDrive error ${kids.status}`);
    const re = new RegExp(`^${box}_(\\d+)\\.jpg$`);
    let n = Math.max(0, ...kids.json.value.map((k) => (k.name.match(re) || [0, 0])[1] * 1)) + 1;

    for (let tries = 0; tries < 5; tries++, n++) {
      const name = `${box}_${n}.jpg`;
      const up = await this.graph('PUT',
        `${this.drive}/items/${d.json.id}:/${name}:/content?@microsoft.graph.conflictBehavior=fail`,
        { body: buffer, raw: true, headers: { 'Content-Type': 'image/jpeg' } });
      if (up.ok) return { name, path: `${clientPath}/${date}/${name}` };
      if (up.status !== 409) throw httpError(502, `OneDrive upload failed ${up.status}`);
    }
    throw httpError(502, 'OneDrive upload failed: file name clash');
  }
}
