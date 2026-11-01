// Saves files to OneDrive through Microsoft Graph.
// Business: client credentials + MS_DRIVE_ID. Personal: MS_REFRESH_TOKEN (rotated and kept in data/ms_token.json).
const fs = require('fs'), path = require('path');
const TOKEN_FILE = path.join(__dirname, '..', 'data', 'ms_token.json');
let tok = { v: '', exp: 0 };

async function token() {
  if (Date.now() < tok.exp) return tok.v;
  const e = process.env;
  let url, form;
  if (e.MS_TENANT_ID) {
    url = `https://login.microsoftonline.com/${e.MS_TENANT_ID}/oauth2/v2.0/token`;
    form = { client_id: e.MS_CLIENT_ID, client_secret: e.MS_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' };
  } else {
    let refresh = e.MS_REFRESH_TOKEN;
    try { refresh = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).refresh_token || refresh; } catch {}
    url = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
    form = { client_id: e.MS_CLIENT_ID, refresh_token: refresh, grant_type: 'refresh_token', scope: 'Files.ReadWrite offline_access' };
    if (e.MS_CLIENT_SECRET) form.client_secret = e.MS_CLIENT_SECRET;
  }
  const r = await fetch(url, { method: 'POST', body: new URLSearchParams(form) });
  const j = await r.json();
  if (!r.ok) throw new Error('Microsoft sign-in failed: ' + (j.error_description || r.status));
  if (j.refresh_token) { fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true }); fs.writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: j.refresh_token })); }
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return tok.v;
}

const drive = () => process.env.MS_TENANT_ID ? `/drives/${process.env.MS_DRIVE_ID}` : '/me/drive';
const enc = rel => [process.env.ONEDRIVE_ROOT || '', ...rel.split('/')].filter(Boolean).map(encodeURIComponent).join('/');

async function graph(method, url, body, type) {
  return fetch('https://graph.microsoft.com/v1.0' + drive() + url, {
    method, body, headers: { Authorization: 'Bearer ' + await token(), ...(type ? { 'Content-Type': type } : {}) },
  });
}

module.exports = {
  // Photos are well under Graph's 4 MB simple-upload limit after the phone compresses them.
  async put(rel, buf) {
    const r = await graph('PUT', `/root:/${enc(rel)}:/content?@microsoft.graph.conflictBehavior=rename`, buf, 'image/jpeg');
    if (!r.ok) throw new Error('OneDrive upload failed: ' + r.status + ' ' + await r.text());
  },
  async list(rel) {
    const r = await graph('GET', `/root:/${enc(rel)}:/children?$select=name&$top=999`);
    if (r.status === 404) return [];
    if (!r.ok) throw new Error('OneDrive list failed: ' + r.status);
    return (await r.json()).value.map(x => x.name);
  },
};
