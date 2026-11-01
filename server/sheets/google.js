import crypto from 'node:crypto';
import { safeName } from '../util.js';
import { httpError } from '../storage/local.js';

// Google Sheets through a service account. No libraries needed.
export class GoogleSheet {
  constructor({ sheetId, clientEmail, privateKey }, headers, boxCount) {
    if (!sheetId || !clientEmail || !privateKey) throw new Error('Google needs SHEET_ID, GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY');
    Object.assign(this, { sheetId, clientEmail, headers, boxCount });
    this.key = privateKey.replace(/\\n/g, '\n');
    this.tabs = new Set();
    this.tok = null;
  }

  async token() {
    if (this.tok && this.tok.exp > Date.now() + 60000) return this.tok.value;
    const now = Math.floor(Date.now() / 1000), b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({
      iss: this.clientEmail, scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    })}`;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), this.key).toString('base64url');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    });
    const j = await r.json();
    if (!r.ok) throw httpError(502, `Google sign-in failed: ${j.error_description || r.status}`);
    this.tok = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return this.tok.value;
  }

  async api(method, p, body) {
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}${p}`, {
      method, body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
    });
    const j = await r.json();
    if (!r.ok) throw httpError(502, `Google Sheets error: ${j.error?.message || r.status}`);
    return j;
  }

  async ensureTab(title) {
    if (this.tabs.has(title)) return;
    const meta = await this.api('GET', '?fields=sheets.properties(sheetId,title)');
    for (const s of meta.sheets) this.tabs.add(s.properties.title);
    if (this.tabs.has(title)) return;

    const add = await this.api('POST', ':batchUpdate', {
      requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }],
    });
    const sheetId = add.replies[0].addSheet.properties.sheetId;
    await this.api('PUT', `/values/${encodeURIComponent(`'${title}'!A1`)}?valueInputOption=RAW`, { values: [this.headers] });

    const col = (i) => ({ sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 });
    const colour = (r, g, b) => ({ red: r, green: g, blue: b });
    const GREEN = colour(0.80, 0.94, 0.80), RED = colour(0.98, 0.78, 0.78);
    const rule = (i, type, text, bg) => ({
      addConditionalFormatRule: { index: 0, rule: {
        ranges: [col(i)],
        booleanRule: { condition: { type, values: [{ userEnteredValue: text }] }, format: { backgroundColor: bg } },
      } },
    });
    const first = 3, defects = 3 + this.boxCount;
    const requests = [
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
    ];
    for (let i = first; i < first + this.boxCount; i++) {
      requests.push(rule(i, 'TEXT_STARTS_WITH', 'Uploaded', GREEN), rule(i, 'TEXT_STARTS_WITH', 'Not uploaded', RED));
    }
    requests.push(rule(defects, 'TEXT_EQ', 'Yes', RED), rule(defects, 'TEXT_EQ', 'No', GREEN));
    await this.api('POST', ':batchUpdate', { requests });
    this.tabs.add(title);
  }

  async appendRow(tab, row) {
    const title = safeName(tab);
    await this.ensureTab(title);
    await this.api('POST', `/values/${encodeURIComponent(`'${title}'!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: [row] });
  }
}
