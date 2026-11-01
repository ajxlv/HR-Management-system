// Writes one row per visit to a Google Sheet, one tab per client, through a service account.
const crypto = require('crypto');
let tok = { v: '', exp: 0 };
const tabs = new Map();   // tab title -> sheetId, cached

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function token() {
  if (Date.now() < tok.exp) return tok.v;
  const now = Math.floor(Date.now() / 1000);
  const claim = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: process.env.GOOGLE_SA_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(claim).sign(process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n'), 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: claim + '.' + sig }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Google sign-in failed: ' + (j.error_description || r.status));
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return tok.v;
}

async function api(method, url, body) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}${url}`, {
    method, body: body && JSON.stringify(body), headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error('Google Sheets ' + r.status + ': ' + await r.text());
  return r.json();
}

const bg = (r, g, b) => ({ backgroundColor: { red: r, green: g, blue: b } });
const RED = bg(0.96, 0.78, 0.76), GREEN = bg(0.80, 0.93, 0.83);
function rule(sheetId, col0, col1, type, value, format) {
  return { addConditionalFormatRule: { index: 0, rule: {
    ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: col0, endColumnIndex: col1 }],
    booleanRule: { condition: { type, values: [{ userEnteredValue: value }] }, format } } } };
}

// statusCols / defectCol are 0-based column indexes in the header.
async function ensureTab(title, header, statusCols, defectCol) {
  if (tabs.has(title)) return;
  const meta = await api('GET', '?fields=sheets.properties(sheetId,title)');
  for (const s of meta.sheets) tabs.set(s.properties.title, s.properties.sheetId);
  if (tabs.has(title)) return;
  const res = await api('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] });
  const id = res.replies[0].addSheet.properties.sheetId;
  const [c0, c1] = [statusCols[0], statusCols[statusCols.length - 1] + 1];
  // index 0 inserts at the top, so add the most general rule first
  await api('POST', ':batchUpdate', { requests: [
    rule(id, c0, c1, 'TEXT_STARTS_WITH', 'Uploaded', GREEN),
    rule(id, c0, c1, 'TEXT_STARTS_WITH', 'Not uploaded', RED),
    rule(id, defectCol, defectCol + 1, 'TEXT_EQ', 'No', GREEN),
    rule(id, defectCol, defectCol + 1, 'TEXT_EQ', 'Yes', RED),
    { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
  ] });
  await api('PUT', `/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1`)}?valueInputOption=RAW`, { values: [header] });
  tabs.set(title, id);
}

module.exports = {
  async addRow(tab, header, row, statusCols, defectCol) {
    await ensureTab(tab, header, statusCols, defectCol);
    const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1`);
    await api('POST', `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: [row] });
  },
};
