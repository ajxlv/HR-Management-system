import crypto from 'node:crypto';
import { safeName } from '../util.js';
import { GoogleError, fromApiResponse, explain } from './google-errors.js';
import {
  CLIENT_TAB, OVERVIEW_TAB_LAYOUT, MAX_ROWS, NCOLS, OVERVIEW_TAB, OVERVIEW_HEADERS, OVERVIEW_TITLE,
  clientTabRequests, overviewRequests, overviewRow, logoCell, clientTitle, clientUpdated, clientPhotos, overviewSubline, q,
} from './layout.js';
import { GROUP_SPANS, colIndex } from '../form.js';
import { letter as letterOf } from './layout.js';
import { istDateTime } from '../util.js';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// Google Sheets through a service account. No libraries needed.
export class GoogleSheet {
  // opts: { sheetId, clientEmail, privateKey, projectId, logoUrl, rootFolder, clients }
  constructor(opts, headers, deps = {}) {
    const { sheetId, clientEmail, privateKey } = opts;
    if (!sheetId || !clientEmail || !privateKey) throw new Error('Google needs SHEET_ID and either GOOGLE_KEY_FILE or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY');
    Object.assign(this, { sheetId, clientEmail, headers, key: privateKey, projectId: opts.projectId || '',
      logoUrl: opts.logoUrl || '', rootFolder: opts.rootFolder || 'Clients', clients: opts.clients || [] });
    this.fetch = deps.fetch || globalThis.fetch;
    this.now = deps.now || Date.now;
    this.tok = null;
    this.tabs = null; // title -> sheetId, loaded on first use
  }

  explain(err) { return explain(err, { email: this.clientEmail, sheetId: this.sheetId, projectId: this.projectId }); }

  async send(url, init) {
    try { return await this.fetch(url, init); }
    catch (e) { throw new GoogleError(e.message, { kind: 'network' }); }
  }

  async token() {
    if (this.tok && this.tok.exp > this.now() + 60000) return this.tok.value;
    const now = Math.floor(this.now() / 1000), b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({ iss: this.clientEmail, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    let sig;
    try { sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), this.key).toString('base64url'); }
    catch (e) { throw new GoogleError(`the private key could not be read (${e.message})`, { kind: 'auth' }); }
    const r = await this.send('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new GoogleError(`${j.error || r.status}: ${j.error_description || ''}`.trim(), { status: r.status, kind: 'auth' });
    this.tok = { value: j.access_token, exp: this.now() + j.expires_in * 1000 };
    return this.tok.value;
  }

  async api(method, p, body) {
    const r = await this.send(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}${p}`, {
      method, body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw fromApiResponse(r.status, j);
    return j;
  }

  batch(requests) { return this.api('POST', ':batchUpdate', { requests }); }
  write(range, values) { return this.api('PUT', `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { values }); }

  // ---- reading the workbook ----
  async meta() {
    const m = await this.api('GET', '?fields=properties.title,sheets(properties(sheetId,title,index),conditionalFormats,bandedRanges(bandedRangeId))');
    this.tabs = new Map(m.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
    return m;
  }
  existingOf(sheet) { return { conditionalFormats: (sheet.conditionalFormats || []).length, bandedRangeIds: (sheet.bandedRanges || []).map((b) => b.bandedRangeId) }; }

  // ---- building tabs ----
  find(clientName) { return this.clients.find((c) => safeName(c.name) === safeName(clientName)); }
  updated() { return istDateTime(this.now()); }

  async fillClientTab(title, client, existing) {
    const id = this.tabs.get(title), T = CLIENT_TAB, t = q(title);
    await this.batch(clientTabRequests(id, existing));
    const folder = client?.folder || title;
    const L = (i) => letterOf(i);
    await this.api('POST', '/values:batchUpdate', { valueInputOption: 'USER_ENTERED', data: [
      { range: `${t}!A1`, values: [[logoCell(this.logoUrl)]] },
      { range: `${t}!${L(T.logoColumns)}1`, values: [[clientTitle(client?.name || title)]] },
      { range: `${t}!A2`, values: [[clientUpdated(this.updated())]] },
      { range: `${t}!${L(T.logoColumns)}2`, values: [[clientPhotos(this.rootFolder, folder)]] },
      ...GROUP_SPANS.map((g) => ({ range: `${t}!${L(g.from)}${T.groupRow}`, values: [[g.name]] })),
      { range: `${t}!A${T.headerRow}`, values: [this.headers] },
    ] });
  }

  async ensureTab(title, client) {
    if (!this.tabs) await this.meta();
    if (this.tabs.has(title)) return this.tabs.get(title);
    const r = await this.batch([{ addSheet: { properties: { title, gridProperties: { rowCount: MAX_ROWS, columnCount: NCOLS } } } }]);
    this.tabs.set(title, r.replies[0].addSheet.properties.sheetId);
    await this.fillClientTab(title, client, {});
    await this.refreshOverview();
    return this.tabs.get(title);
  }

  async refreshOverview() {
    const m = await this.meta();            // fresh look, so old rules and banding are cleared before re-applying
    const ov = m.sheets.find((x) => x.properties.title === OVERVIEW_TAB);
    let id, existing = {};
    if (ov) { id = ov.properties.sheetId; existing = this.existingOf(ov); }
    else {
      const r = await this.batch([{ addSheet: { properties: { title: OVERVIEW_TAB, index: 0, gridProperties: { rowCount: MAX_ROWS, columnCount: OVERVIEW_HEADERS.length } } } }]);
      id = r.replies[0].addSheet.properties.sheetId; this.tabs.set(OVERVIEW_TAB, id);
    }
    await this.batch(overviewRequests(id, existing));
    const rows = this.clients.filter((c) => this.tabs.has(safeName(c.name))).map((c) => overviewRow(safeName(c.name), this.tabs.get(safeName(c.name)), c.name));
    await this.api('POST', '/values:batchUpdate', { valueInputOption: 'USER_ENTERED', data: [
      { range: `${q(OVERVIEW_TAB)}!A1:B1`, values: [[logoCell(this.logoUrl), OVERVIEW_TITLE]] },
      { range: `${q(OVERVIEW_TAB)}!A2`, values: [[overviewSubline]] },
      { range: `${q(OVERVIEW_TAB)}!A${OVERVIEW_TAB_LAYOUT.headerRow}`, values: [OVERVIEW_HEADERS, ...rows] },
    ] });
  }

  // ---- adding a visit ----
  // Text that a spreadsheet would turn into a number, date or formula gets a leading ' so it stays text.
  static plain(v) { const s = String(v ?? ''); return /^[=+\-@\d]/.test(s) ? `'${s}` : s; }

  rowValues(row, client) {
    const out = [...row];
    for (const k of ['cleaner', 'details', 'checks']) out[colIndex(k)] = GoogleSheet.plain(out[colIndex(k)]);
    if (client?.folderUrl) out[colIndex('folder')] = `=HYPERLINK(${JSON.stringify(client.folderUrl)},${JSON.stringify(String(row[colIndex('folder')]))})`;
    return out;
  }

  async appendRow(tab, row, ctx = {}) {
    const title = safeName(tab), client = ctx.client || this.find(tab);
    await this.ensureTab(title, client);
    // Appending at the header row means "after the table that starts there", so the banner is never overwritten.
    const header = CLIENT_TAB.headerRow;
    await this.api('POST', `/values/${encodeURIComponent(`${q(title)}!A${header}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: [this.rowValues(row, client)] });
    await this.write(`${q(title)}!A2`, [[clientUpdated(this.updated())]]);
  }

  // ---- format:sheet : re-apply the layout to every existing tab ----
  async formatAll() {
    const m = await this.meta(), done = [], skipped = [];
    for (const s of m.sheets) {
      const title = s.properties.title;
      if (title === OVERVIEW_TAB) continue;
      const client = this.clients.find((c) => safeName(c.name) === title);
      if (!client) { skipped.push(title); continue; }
      await this.fillClientTab(title, client, this.existingOf(s)); done.push(title);
    }
    await this.refreshOverview();
    return { done, skipped };
  }

  // ---- connection check ----
  // Signs in, opens the sheet, writes and clears one cell on a _check tab. Returns { ok, message }.
  async check() {
    try {
      const m = await this.meta();
      const t = '_check', existed = this.tabs.has(t);
      let id = this.tabs.get(t);
      if (!existed) id = (await this.batch([{ addSheet: { properties: { title: t } } }])).replies[0].addSheet.properties.sheetId;
      await this.write(`${t}!A1`, [[`WRS check ${this.updated()}`]]);
      await this.api('POST', `/values/${encodeURIComponent(`${t}!A1`)}:clear`, {});
      if (!existed) await this.batch([{ deleteSheet: { sheetId: id } }]);
      this.tabs = null;
      return { ok: true, message: `OK: wrote to '${m.properties.title}'` };
    } catch (e) {
      return { ok: false, message: this.explain(e), error: e };
    }
  }
}
