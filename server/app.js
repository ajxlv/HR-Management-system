import http from 'node:http';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOXES, HEADERS } from './config.js';
import { State } from './state.js';
import { LocalStorage, httpError } from './storage/local.js';
import { OneDriveStorage } from './storage/onedrive.js';
import { CsvSheet } from './sheets/csv.js';
import { ExcelSheet } from './sheets/excel.js';
import { GoogleSheet } from './sheets/google.js';
import { Mutex, istDate, istDateTime, daysBetween, isRealDate, distanceM } from './util.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export function createApp(cfg, deps = {}) {
  const secret = cfg.secret || crypto.randomBytes(32).toString('hex');
  const state = new State(path.join(cfg.dataDir, 'state.json'));
  const storage = deps.storage || (cfg.storage === 'onedrive' ? new OneDriveStorage(cfg.ms) : new LocalStorage(cfg.localRoot || path.join(cfg.dataDir, 'onedrive')));
  const sheet = deps.sheet || (cfg.sheet === 'google'
    ? new GoogleSheet({ sheetId: cfg.sheetId, ...cfg.google }, HEADERS, BOXES.length)
    : cfg.sheet === 'csv' ? new CsvSheet(cfg.dataDir, HEADERS)
    : new ExcelSheet(path.join(cfg.dataDir, 'WRS_Cleaning_Status.xlsx'), HEADERS, BOXES.length));
  const mutex = new Mutex();
  const now = deps.now || (() => Date.now());
  const clientById = new Map(cfg.clients.map((c) => [c.id, c]));
  const fails = new Map(); // ip -> [timestamps] for PIN rate limit

  // ---- login ----
  const sign = (exp) => crypto.createHmac('sha256', secret).update(String(exp)).digest('hex');
  const makeToken = () => { const exp = now() + 30 * 86400000; return `${exp}.${sign(exp)}`; };
  function authed(req) {
    if (!cfg.cleanerPin) return true;
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    const [exp, mac] = t.split('.');
    if (!exp || !mac || +exp < now()) return false;
    const good = sign(exp);
    return mac.length === good.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good));
  }
  function checkPin(ip, pin) {
    const recent = (fails.get(ip) || []).filter((t) => t > now() - 60000);
    if (recent.length >= 5) throw httpError(429, 'Too many tries. Wait one minute.');
    const a = Buffer.from(String(pin)), b = Buffer.from(cfg.cleanerPin);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) { recent.push(now()); fails.set(ip, recent); throw httpError(401, 'Wrong PIN'); }
    fails.delete(ip);
  }

  // ---- validation ----
  function validateCommon({ client, date, box }) {
    const c = clientById.get(client);
    if (!c) throw httpError(400, 'Unknown client');
    if (!isRealDate(date)) throw httpError(400, 'Bad date');
    const back = daysBetween(date, istDate(now()));
    if (back < 0) throw httpError(400, 'Date is in the future');
    if (back > cfg.maxDaysBack) throw httpError(400, `Date is more than ${cfg.maxDaysBack} days back`);
    if (box !== undefined && !BOXES.some((b) => b.key === box)) throw httpError(400, 'Unknown box');
    return c;
  }
  const validId = (id) => /^[A-Za-z0-9-]{8,64}$/.test(id || '');

  // ---- handlers ----
  function config() {
    return {
      cleanerName: cfg.cleanerName, boxes: BOXES, maxDaysBack: cfg.maxDaysBack,
      photoMaxAgeSec: cfg.photoMaxAgeSec, today: istDate(now()),
      clients: cfg.clients.map(({ id, name }) => ({ id, name })),
    };
  }

  function savePhoto(q, buffer) {
    const c = validateCommon(q);
    if (!validId(q.visit)) throw httpError(400, 'Bad visit id');
    if (!buffer.length || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw httpError(400, 'Not a JPEG photo');
    if (buffer.length > cfg.maxPhotoBytes) throw httpError(413, 'Photo too large');
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    return mutex.run(async () => {
      const v = state.visit(q.visit) || state.create(q.visit, { client: q.client, date: q.date });
      if (v.client !== q.client || v.date !== q.date) throw httpError(409, 'Photo does not match this visit');
      if (v.photos[hash]) return { ok: true, duplicate: true, name: v.photos[hash].name };
      if (v.submitted) throw httpError(409, 'Visit already submitted');
      const saved = await storage.saveFile({ rootFolder: cfg.rootFolder, clientFolder: c.folder, date: q.date, box: q.box, buffer });
      const num = (x) => (x === undefined || x === '' || Number.isNaN(+x) ? null : +x);
      v.photos[hash] = {
        box: q.box, name: saved.name, path: saved.path, takenAt: num(q.taken),
        lat: num(q.lat), lng: num(q.lng), accuracy: num(q.acc), savedAt: now(),
      };
      await state.save();
      return { ok: true, name: saved.name };
    });
  }

  function checksFor(v, client) {
    const notes = [];
    for (const p of Object.values(v.photos).sort((a, b) => a.name.localeCompare(b.name))) {
      const box = BOXES.find((b) => b.key === p.box);
      const label = p.name.replace('.jpg', '');
      if (box.gps) {
        if (p.lat === null || p.lng === null) notes.push(`${label}: no GPS`);
        else if (client.lat !== undefined) {
          const d = Math.round(distanceM(p.lat, p.lng, client.lat, client.lng));
          if (d > cfg.gpsMaxDistanceM) notes.push(`${label}: ${d} m from site`);
        }
        if (p.takenAt && istDate(p.takenAt) !== v.date) notes.push(`${label}: taken on ${istDate(p.takenAt)}`);
      }
    }
    return notes.length ? notes.join('; ') : 'OK';
  }

  function submitVisit(b) {
    const c = validateCommon(b);
    if (!validId(b.visit)) throw httpError(400, 'Bad visit id');
    if (b.defects !== 'Yes' && b.defects !== 'No') throw httpError(400, 'Defects answer is required');
    const details = String(b.details || '').trim().slice(0, 1000);
    return mutex.run(async () => {
      let v = state.visit(b.visit);
      if (v?.submitted) return { ok: true, duplicate: true };
      if (v && (v.client !== b.client || v.date !== b.date)) throw httpError(409, 'Visit does not match its photos');
      v = v || state.create(b.visit, { client: b.client, date: b.date });
      const counts = Object.fromEntries(BOXES.map((x) => [x.key, Object.values(v.photos).filter((p) => p.box === x.key).length]));
      const defects = details ? 'Yes' : b.defects;
      const row = [
        b.date, istDateTime(now()), cfg.cleanerName,
        ...BOXES.map((x) => (counts[x.key] ? `Uploaded (${counts[x.key]})` : 'Not uploaded')),
        defects, details, checksFor(v, c), `${cfg.rootFolder}/${c.folder}/${b.date}`,
      ];
      await sheet.appendRow(c.name, row);
      v.submitted = { at: now(), defects, details, counts, row };
      await state.save();
      return { ok: true };
    });
  }

  // ---- http plumbing ----
  async function body(req, limit) {
    // Some hosts (Vercel) read the body before our code runs and expose it as req.body; the stream is then used up.
    if (req.body !== undefined && req.body !== null) {
      const pre = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      if (pre.length > limit) throw httpError(413, 'Too large');
      return pre;
    }
    const chunks = []; let size = 0;
    for await (const ch of req) {
      size += ch.length;
      if (size > limit) throw httpError(413, 'Too large');
      chunks.push(ch);
    }
    return Buffer.concat(chunks);
  }
  const send = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  async function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, { error: 'Not found' });
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': rel === 'sw.js' ? 'no-cache' : 'public, max-age=300',
      });
      res.end(data);
    } catch { send(res, 404, { error: 'Not found' }); }
  }

  // ---- HR dashboard (read only, protected by REPORT_KEY) ----
  function hrAllowed(req, url) {
    const given = req.headers['x-hr-key'] || url.searchParams.get('key') || '';
    const a = Buffer.from(String(given)), b = Buffer.from(cfg.reportKey);
    return cfg.reportKey && a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  async function hrApi(req, res, p, url) {
    if (!hrAllowed(req, url)) return send(res, 401, { error: 'Wrong or missing HR key' });
    if (p === '/api/hr/visits') {
      const visits = Object.values(state.data.visits).filter((v) => v.submitted).map((v) => {
        const c = clientById.get(v.client);
        const row = v.submitted.row;
        return {
          id: v.id, client: c?.name || v.client, date: v.date, submittedAt: row[1], cleaner: row[2],
          counts: v.submitted.counts, defects: v.submitted.defects, details: v.submitted.details,
          checks: row[BOXES.length + 5], folder: row[BOXES.length + 6], at: v.submitted.at,
          photos: Object.entries(v.photos).map(([hash, ph]) => ({ hash, box: ph.box, name: ph.name })).sort((a, b) => a.name.localeCompare(b.name)),
        };
      }).sort((a, b) => b.at - a.at);
      return send(res, 200, { boxes: BOXES.map((b) => b.key), canShowPhotos: typeof storage.read === 'function', hasExcel: cfg.sheet === 'excel', visits });
    }
    if (p === '/api/hr/photo') {
      const ph = state.visit(url.searchParams.get('visit'))?.photos[url.searchParams.get('hash')];
      if (!ph || typeof storage.read !== 'function') return send(res, 404, { error: 'No photo' });
      const data = await storage.read(ph.path).catch(() => null);
      if (!data) return send(res, 404, { error: 'No photo' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' });
      return res.end(data);
    }
    send(res, 404, { error: 'Not found' });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (p === '/report.xlsx' && cfg.sheet === 'excel' && cfg.reportKey && url.searchParams.get('key') === cfg.reportKey) {
        const file = await fs.readFile(path.join(cfg.dataDir, 'WRS_Cleaning_Status.xlsx')).catch(() => null);
        if (!file) return send(res, 404, { error: 'No visits yet' });
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="WRS_Cleaning_Status.xlsx"', 'Cache-Control': 'no-store' });
        return res.end(file);
      }
      if (p.startsWith('/api/hr/')) return await hrApi(req, res, p, url);
      if (!p.startsWith('/api/')) return await serveStatic(req, res, p);

      if (p === '/api/health') return send(res, 200, { ok: true });
      if (p === '/api/login' && req.method === 'POST') {
        const { pin } = JSON.parse((await body(req, 2000)).toString() || '{}');
        if (cfg.cleanerPin) checkPin(String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown', pin);
        return send(res, 200, { token: makeToken() });
      }
      if (!authed(req)) return send(res, 401, { error: 'Please sign in' });

      if (p === '/api/config' && req.method === 'GET') return send(res, 200, config());
      if (p === '/api/photo' && req.method === 'POST') {
        const q = Object.fromEntries(url.searchParams);
        return send(res, 200, await savePhoto(q, await body(req, cfg.maxPhotoBytes + 1024)));
      }
      if (p === '/api/visit' && req.method === 'POST') {
        return send(res, 200, await submitVisit(JSON.parse((await body(req, 20000)).toString() || '{}')));
      }
      send(res, 404, { error: 'Not found' });
    } catch (e) {
      const status = e instanceof SyntaxError ? 400 : e.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: status >= 500 && !e.status ? (cfg.exposeErrors ? `Server error: ${e.message}` : 'Server error') : e.message });
    }
  });
  // In-process access (used to load demo data without any network call).
  server.direct = { photo: savePhoto, visit: submitVisit };
  return server;
}
