// WRS cleaning photo app. No packages needed. Node 18+.
require('./env');
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const local = require('./local');

const PORT = Number(process.env.PORT || 3000);
const MAX_M = Number(process.env.MAX_DISTANCE_M || 300);
const MAX_BACK_DAYS = Number(process.env.MAX_BACK_DAYS || 7);
const TZ_MIN = 330;   // India, UTC+5:30, for "which day" decisions
const files = process.env.STORAGE === 'onedrive' ? require('./onedrive') : local.files;
const sheet = process.env.SHEET === 'google' ? require('./sheets') : local.sheet;

// The boxes on the phone. camera: true means live camera with GPS stamp; false allows the gallery.
const KINDS = [
  { key: 'Before', camera: true },
  { key: 'After', camera: true },
  { key: 'Bill', camera: false },
  { key: 'Wires', camera: true },
];
const HEADER = ['Visit date', 'Submitted at', 'Cleaner', ...KINDS.map(k => k.key), 'Defects', 'Defect details', 'Checks', 'Folder'];
const STATUS_COLS = KINDS.map((_, i) => 3 + i);
const DEFECT_COL = 3 + KINDS.length;

const ROOT = path.join(__dirname, '..');
const clients = JSON.parse(fs.readFileSync(path.join(ROOT, 'clients.json'), 'utf8'));
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const VISITS_FILE = path.join(DATA, 'visits.json');

// Visit state survives restarts, so a phone that retries never creates duplicates.
let visits = {};
try { visits = JSON.parse(fs.readFileSync(VISITS_FILE, 'utf8')); } catch {}
const cutoff = Date.now() - 30 * 864e5;
for (const id in visits) if (visits[id].created < cutoff) delete visits[id];
function saveVisits() { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(VISITS_FILE, JSON.stringify(visits)); }

const istDay = d => new Date(d.getTime() + TZ_MIN * 60000).toISOString().slice(0, 10);
function dateOk(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const today = istDay(new Date()), oldest = istDay(new Date(Date.now() - MAX_BACK_DAYS * 864e5));
  return s <= today && s >= oldest;
}
function meters(a, b, c, d) {
  const r = x => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}
function visitFor(id, client, date) {
  if (!/^[\w-]{8,64}$/.test(id)) return null;
  const v = visits[id] ||= { created: Date.now(), client: client.id, date, photos: {}, hashes: [], notes: [], done: false };
  return v.client === client.id && v.date === date ? v : null;
}

async function savePhoto(h, body) {
  const client = clients.find(c => c.id === h('x-client'));
  const kind = KINDS.find(k => k.key === h('x-kind'));
  const date = h('x-date');
  if (!client) return [400, { error: 'Unknown client' }];
  if (!kind) return [400, { error: 'Unknown photo box' }];
  if (!dateOk(date)) return [400, { error: 'Date not allowed' }];
  if (body.length < 100) return [400, { error: 'Empty photo' }];
  const v = visitFor(h('x-visit'), client, date);
  if (!v) return [400, { error: 'Bad visit' }];
  if (v.done) return [409, { error: 'Visit already submitted' }];
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  if (v.hashes.includes(hash)) return [200, { ok: true, duplicate: true }];

  // Short names, numbered: the date folder already says which day it is.
  const dir = `${client.folder}/${date}`;
  const used = new Set(await files.list(dir));
  let n = 1; while (used.has(`${kind.key}_${n}.jpg`)) n++;
  const name = `${kind.key}_${n}.jpg`;
  await files.put(`${dir}/${name}`, body);

  v.hashes.push(hash);
  v.photos[kind.key] = (v.photos[kind.key] || 0) + 1;
  if (kind.camera) {
    const lat = parseFloat(h('x-lat')), lon = parseFloat(h('x-lon'));
    if (isNaN(lat) || isNaN(lon)) v.notes.push(`${name}: no GPS`);
    else if (client.lat != null && meters(lat, lon, client.lat, client.lon) > MAX_M)
      v.notes.push(`${name}: ${Math.round(meters(lat, lon, client.lat, client.lon))} m from site`);
    const taken = new Date(h('x-taken'));
    if (!isNaN(taken) && istDay(taken) !== date) v.notes.push(`${name}: taken on ${istDay(taken)}`);
  }
  saveVisits();
  return [200, { ok: true, file: name }];
}

async function submitVisit(body) {
  let b; try { b = JSON.parse(body.toString()); } catch { return [400, { error: 'Bad request' }]; }
  const client = clients.find(c => c.id === b.client);
  if (!client) return [400, { error: 'Unknown client' }];
  if (!dateOk(b.date)) return [400, { error: 'Date not allowed' }];
  if (b.defects !== 'Yes' && b.defects !== 'No') return [400, { error: 'Answer the defects question' }];
  const v = visitFor(b.visit, client, b.date);
  if (!v) return [400, { error: 'Bad visit' }];
  if (v.done) return [200, { ok: true, already: true }];

  const status = KINDS.map(k => {
    const got = v.photos[k.key] || 0, sent = Number(b.counts?.[k.key] || 0);
    if (!got) return 'Not uploaded';
    return sent > got ? `Uploaded ${got} of ${sent}` : `Uploaded (${got})`;
  });
  const row = [b.date, new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), String(b.cleaner || '').slice(0, 80),
    ...status, b.defects, String(b.details || '').trim().slice(0, 2000), v.notes.join('; ') || 'OK', `${client.folder}/${b.date}`];
  await sheet.addRow(client.sheetTab || client.name, HEADER, row, STATUS_COLS, DEFECT_COL);
  v.done = true; saveVisits();
  return [200, { ok: true }];
}

let queue = Promise.resolve();   // one write at a time keeps numbering and the sheet consistent
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/api/config')
    return send(200, { clients: clients.map(({ id, name }) => ({ id, name })), kinds: KINDS, maxBackDays: MAX_BACK_DAYS });
  if (req.method === 'POST' && (url === '/api/photo' || url === '/api/visit')) {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 12e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      const h = k => { try { return decodeURIComponent(req.headers[k] || ''); } catch { return ''; } };
      const job = () => url === '/api/photo' ? savePhoto(h, Buffer.concat(chunks)) : submitVisit(Buffer.concat(chunks));
      queue = queue.then(job).then(([c, o]) => send(c, o), e => { console.error(e); send(500, { error: 'Server error, will retry' }); });
    });
    return;
  }
  const f = path.join(ROOT, 'public', url === '/' ? 'index.html' : url);
  if (!f.startsWith(path.join(ROOT, 'public') + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

if (require.main === module) server.listen(PORT, () => console.log(`http://localhost:${PORT}  photos=${process.env.STORAGE || 'local'}  sheet=${process.env.SHEET || 'local'}`));
module.exports = server;
