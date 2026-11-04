// A small fake of the Google token endpoint and the Sheets API, for tests. Never talks to the network.
const colIndex = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const A1 = /^(?:'((?:[^']|'')+)'|([^!]+))!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/;

export function createFakeGoogle(sheetId = 'SHEET123') {
  const fake = { sheets: [], calls: [], appended: [], failures: [], nextId: 100 };
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const err = (status, message, extra = {}) => reply(status, { error: { code: status, message, ...extra } });
  const byTitle = (t) => fake.sheets.find((s) => s.title === t);
  const key = (r, c) => `${r},${c}`;
  const addSheet = (props) => {
    const s = { id: fake.nextId++, title: props.title, index: props.index ?? fake.sheets.length, cells: new Map(), cf: [], bands: [], frozen: 0, frozenCols: 0, merges: [], filter: null, requests: [] };
    if (props.index === 0) fake.sheets.forEach((x) => x.index++);
    fake.sheets.push(s); fake.sheets.sort((a, b) => a.index - b.index);
    return s;
  };
  const put = (range, values) => {
    const m = range.match(A1); if (!m) throw new Error(`bad range ${range}`);
    const s = byTitle((m[1] || m[2]).replace(/''/g, "'")); if (!s) return false;
    const r0 = +m[4] - 1, c0 = colIndex(m[3]);
    values.forEach((row, i) => row.forEach((v, j) => s.cells.set(key(r0 + i, c0 + j), v)));
    return true;
  };
  const rowFilled = (s, r) => [...s.cells.keys()].some((k) => +k.split(',')[0] === r && s.cells.get(k) !== '');
  fake.cell = (title, a1) => { const m = a1.match(/^([A-Z]+)(\d+)$/); return byTitle(title)?.cells.get(key(+m[2] - 1, colIndex(m[1]))); };
  fake.sheet = byTitle;
  fake.failNext = (n, status = 503, message = 'The service is currently unavailable.') => { fake.failures = Array(n).fill({ status, message }); };
  fake.failAlways = (status, message, extra) => { fake.always = { status, message, extra }; };

  function batchRequest(r) {
    const k = Object.keys(r)[0], v = r[k];
    if (k === 'addSheet') { const s = addSheet(v.properties); return { addSheet: { properties: { sheetId: s.id, title: s.title, index: s.index } } }; }
    if (k === 'deleteBanding') { const o = fake.sheets.find((x) => x.bands.some((b) => b.bandedRangeId === v.bandedRangeId)); if (o) o.bands = o.bands.filter((b) => b.bandedRangeId !== v.bandedRangeId); return {}; }
    const s = fake.sheets.find((x) => x.id === (v.sheetId ?? v.range?.sheetId ?? v.rule?.ranges?.[0]?.sheetId ?? v.bandedRange?.range?.sheetId ?? v.filter?.range?.sheetId ?? v.properties?.sheetId));
    if (k === 'deleteSheet') { fake.sheets = fake.sheets.filter((x) => x.id !== v.sheetId); return {}; }
    if (!s) return {};
    s.requests.push(r);
    if (k === 'addConditionalFormatRule') s.cf.push(v.rule);
    if (k === 'deleteConditionalFormatRule') s.cf.splice(v.index, 1);
    if (k === 'addBanding') {
      const rg = v.bandedRange.range;
      if (s.bands.some((b) => b.range.startRowIndex < rg.endRowIndex && rg.startRowIndex < b.range.endRowIndex)) throw Object.assign(new Error('banded range overlaps'), { http: 400 });
      s.bands.push({ bandedRangeId: fake.nextId++, ...v.bandedRange });
    }
    if (k === 'mergeCells') s.merges.push(v.range);
    if (k === 'unmergeCells') s.merges = [];
    if (k === 'setBasicFilter') s.filter = v.filter.range;
    if (k === 'updateSheetProperties') { s.frozen = v.properties.gridProperties?.frozenRowCount ?? s.frozen; s.frozenCols = v.properties.gridProperties?.frozenColumnCount ?? s.frozenCols; }
    return {};
  }

  fake.fetch = async (url, init = {}) => {
    const u = new URL(url), body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null;
    fake.calls.push({ method: init.method || 'GET', path: u.pathname + u.search, body });
    if (u.host === 'oauth2.googleapis.com') return reply(200, { access_token: 'tok', expires_in: 3600 });
    if (fake.always) return err(fake.always.status, fake.always.message, fake.always.extra);
    if (fake.failures.length) { const f = fake.failures.shift(); return err(f.status, f.message); }
    const base = `/v4/spreadsheets/${sheetId}`;
    if (!u.pathname.startsWith(base)) return err(404, 'Requested entity was not found.');
    const rest = decodeURIComponent(u.pathname.slice(base.length));
    if (rest === '' && (init.method || 'GET') === 'GET') {
      return reply(200, { properties: { title: 'WRS Cleaning Status' }, sheets: fake.sheets.map((s) => ({
        properties: { sheetId: s.id, title: s.title, index: s.index }, conditionalFormats: s.cf, bandedRanges: s.bands.map((b) => ({ bandedRangeId: b.bandedRangeId })) })) });
    }
    if (rest === ':batchUpdate') {
      try {
        const replies = body.requests.map(batchRequest);
        for (const s of fake.sheets) if (s.frozenCols && s.merges.some((m) => m.startColumnIndex < s.frozenCols && m.endColumnIndex > s.frozenCols)) {
          throw Object.assign(new Error('You can\'t freeze columns which contain only part of a merged cell.'), { http: 400 });
        }
        return reply(200, { replies });
      } catch (e) { return err(e.http || 500, e.message); }
    }
    if (rest === '/values:batchUpdate') { for (const d of body.data) put(d.range, d.values); return reply(200, {}); }
    if (rest.endsWith(':append')) {
      const range = rest.slice('/values/'.length, -':append'.length), m = range.match(A1), s = byTitle((m[1] || m[2]).replace(/''/g, "'"));
      let last = +m[4] - 1; while (rowFilled(s, last + 1)) last++;
      const at = last + 1;
      body.values.forEach((row, i) => row.forEach((v, j) => s.cells.set(key(at + i, j), v)));
      fake.appended.push({ title: s.title, row: at + 1, values: body.values[0], option: u.searchParams.get('valueInputOption') });
      return reply(200, { updates: { updatedRange: `${s.title}!A${at + 1}` } });
    }
    if (rest.endsWith(':clear')) { const m = rest.slice('/values/'.length, -':clear'.length).match(A1); byTitle((m[1] || m[2]).replace(/''/g, "'"))?.cells.delete(key(+m[4] - 1, colIndex(m[3]))); return reply(200, {}); }
    if (rest.startsWith('/values/') && init.method === 'PUT') return put(rest.slice('/values/'.length), body.values) ? reply(200, {}) : err(400, 'Unable to parse range');
    return err(404, `unhandled ${rest}`);
  };
  return fake;
}
