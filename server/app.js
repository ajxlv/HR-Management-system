import http from 'node:http';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADERS, boxesFor, isBoxKey, declaredInverters, clampInverters, formConfig, validateAnswers, validateSignature, amcStatus, AMC_REMIND_DAYS, buildRow, attention, locationSourceFrom, photoCount, missingPhotos, colIndex } from './form.js';
import { findVendor } from './vendors.js';
import { VERSION } from './version.js';
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
    ? new GoogleSheet({ sheetId: cfg.sheetId, ...cfg.google, logoUrl: cfg.logoUrl, rootFolder: cfg.rootFolder, clients: cfg.clients }, HEADERS)
    : cfg.sheet === 'csv' ? new CsvSheet(cfg.dataDir, HEADERS)
    : new ExcelSheet(path.join(cfg.dataDir, 'WRS_Cleaning_Status.xlsx'), HEADERS));
  const mutex = new Mutex();
  const now = deps.now || (() => Date.now());
  const clientById = new Map(cfg.clients.map((c) => [c.id, c]));
  const fails = new Map(); // ip -> [timestamps] for PIN rate limit

  // ---- login: each vendor has their own PIN, and the token says which vendor it belongs to ----
  const sign = (text) => crypto.createHmac('sha256', secret).update(text).digest('hex');
  const makeToken = (vendor) => { const exp = now() + 30 * 86400000, who = Buffer.from(vendor.name).toString('base64url'); return `${exp}.${who}.${sign(`${exp}.${vendor.name}`)}`; };
  const open = { name: cfg.cleanerName };                          // used only when no PIN is configured at all (testing)
  // Returns the vendor this request belongs to, or null. A vendor removed from the settings stops working at once.
  function authed(req) {
    if (!cfg.vendors.length) return open;
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    const [exp, who, mac] = t.split('.');
    if (!exp || !who || !mac || +exp < now()) return null;
    let name;
    try { name = Buffer.from(who, 'base64url').toString(); } catch { return null; }
    const vendor = cfg.vendors.find((v) => v.name === name);
    if (!vendor) return null;
    const good = sign(`${exp}.${name}`);
    return mac.length === good.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good)) ? vendor : null;
  }
  function checkPin(ip, pin) {
    const recent = (fails.get(ip) || []).filter((t) => t > now() - 60000);
    if (recent.length >= 5) throw httpError(429, 'Too many tries. Wait one minute.');
    const vendor = findVendor(cfg.vendors, pin);
    if (!vendor) { recent.push(now()); fails.set(ip, recent); throw httpError(401, 'Wrong PIN'); }
    fails.delete(ip);
    return vendor;
  }

  // ---- validation ----
  function validateCommon({ client, date, box }) {
    const c = clientById.get(client);
    if (!c) throw httpError(400, 'Unknown client');
    if (!isRealDate(date)) throw httpError(400, 'Bad date');
    const back = daysBetween(date, istDate(now()));
    if (back < 0) throw httpError(400, 'Date is in the future');
    if (back > cfg.maxDaysBack) throw httpError(400, `Date is more than ${cfg.maxDaysBack} days back`);
    if (box !== undefined && !isBoxKey(box)) throw httpError(400, 'Unknown box');
    return c;
  }
  const validId = (id) => /^[A-Za-z0-9-]{8,64}$/.test(id || '');

  // ---- handlers ----
  const dateOrEmpty = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : undefined);
  function config(vendor) {
    return {
      cleanerName: vendor.name, maxDaysBack: cfg.maxDaysBack, today: istDate(now()), form: formConfig(), version: VERSION, amcRemindDays: AMC_REMIND_DAYS,
      // Only the name, and the AMC dates the company typed in (for the reminder shown to the client after he signs)
      clients: cfg.clients.map((c) => ({ id: c.id, name: c.name, installed: dateOrEmpty(c.installed), amcExpiry: dateOrEmpty(c.amcExpiry) })),
    };
  }

  function savePhoto(q, buffer) {
    const c = validateCommon(q);
    if (!validId(q.visit)) throw httpError(400, 'Bad visit id');
    if (!buffer.length || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw httpError(400, 'Not a JPEG photo');
    if (buffer.length > cfg.maxPhotoBytes) throw httpError(413, 'Photo too large');
    const capture = q.cap === undefined || q.cap === '' ? 'camera' : q.cap;
    if (!['camera', 'gallery', 'drawn'].includes(capture)) throw httpError(400, 'Bad photo source');
    if ((capture === 'drawn') !== (q.box === 'Signature')) throw httpError(400, 'Only the signature box takes a drawn picture');
    if (q.src !== undefined && q.src !== '' && !['exif', 'phone', 'none'].includes(q.src)) throw httpError(400, 'Bad location source');
    const takenSource = q.tsrc === undefined ? (q.taken ? 'camera' : '') : q.tsrc;
    if (!['', 'exif', 'camera'].includes(takenSource)) throw httpError(400, 'Bad time source');
    // A retry after a network drop sends the same bytes to the same box. The same picture in a DIFFERENT box is a different photo.
    const hash = `${q.box}:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
    return mutex.run(async () => {
      const v = state.visit(q.visit) || state.create(q.visit, { client: q.client, date: q.date });
      if (v.client !== q.client || v.date !== q.date) throw httpError(409, 'Photo does not match this visit');
      if (v.photos[hash]) return { ok: true, duplicate: true, name: v.photos[hash].name };
      if (v.submitted) throw httpError(409, 'Visit already submitted');
      const saved = await storage.saveFile({ rootFolder: cfg.rootFolder, clientFolder: c.folder, date: q.date, box: q.box, buffer });
      const num = (x) => (x === undefined || x === '' || Number.isNaN(+x) ? null : +x);
      const lat = num(q.lat), lng = num(q.lng);
      v.photos[hash] = {
        box: q.box, name: saved.name, path: saved.path,
        capture,                                                   // 'camera' (live shot) or 'gallery'
        takenAt: num(q.taken), takenSource: takenSource,           // 'exif', 'camera' or '' (unknown)
        lat, lng, accuracy: num(q.acc),
        locationSource: locationSourceFrom(q.src, lat !== null && lng !== null),   // 'photo EXIF' | 'phone at upload' | 'none'
        savedAt: now(),
      };
      await state.save();
      return { ok: true, name: saved.name };
    });
  }

  function submitVisit(b, vendorName) {
    const c = validateCommon(b);
    if (!validId(b.visit)) throw httpError(400, 'Bad visit id');
    if (b.defects !== 'Yes' && b.defects !== 'No') throw httpError(400, 'Defects answer is required');
    const answers = validateAnswers(b.answers);
    const signature = validateSignature(b.signature);
    if (b.inverters !== undefined && clampInverters(b.inverters) === null) throw httpError(400, 'Bad inverter count');
    const details = String(b.details || '').trim().slice(0, 1000);
    return mutex.run(async () => {
      let v = state.visit(b.visit);
      if (v?.submitted) return { ok: true, duplicate: true };
      if (v && (v.client !== b.client || v.date !== b.date)) throw httpError(409, 'Visit does not match its photos');
      v = v || state.create(b.visit, { client: b.client, date: b.date });
      v.cleaner = vendorName || cfg.cleanerName;          // the vendor who signed in
      v.signature = signature;                            // the client's signature record (the picture is a photo in box Signature)
      const inverters = declaredInverters(v, b.inverters), boxes = boxesFor(inverters), defects = details ? 'Yes' : b.defects;
      v.inverters = inverters;
      const row = buildRow({ visit: v, client: c, boxes, answers, defects, details, submittedAt: istDateTime(now()), rootFolder: cfg.rootFolder, gpsMaxDistanceM: cfg.gpsMaxDistanceM });
      const counts = Object.fromEntries(boxes.map((x) => [x.key, photoCount(v, x.key)]));
      // A required photo that never arrived is flagged in Checks (and shown as Not uploaded), never lost the visit.
      // Every answer is kept here in the visit record, not only in the sheet.
      v.answers = answers;
      v.submitted = { at: now(), defects, details, inverters, answers, counts, missing: missingPhotos(v, boxes), checks: row[colIndex('checks')], row, sheetDone: false };
      await state.save();
      const pushed = await pushRow(v);
      return { ok: true, sheet: pushed ? 'written' : 'waiting' };
    });
  }

  // Must be called inside the mutex.
  async function pushRow(v) {
    const c = clientById.get(v.client);
    try {
      await sheet.appendRow(c.name, v.submitted.row, { client: c });
    } catch (e) {
      v.submitted.lastError = typeof sheet.explain === 'function' ? sheet.explain(e) : String(e.message || e);
      console.error(`Sheet row for visit ${v.id} is waiting: ${v.submitted.lastError}`);
      await state.save().catch(() => {});
      return false;
    }
    v.submitted.sheetDone = true; delete v.submitted.lastError;
    await state.save();
    return true;
  }

  const waiting = () => Object.values(state.data.visits).filter((v) => v.submitted && v.submitted.sheetDone === false).sort((a, b) => a.submitted.at - b.submitted.at);

  // Tries every waiting row, oldest first. Stops at the first failure so the order stays right.
  function retryPending() {
    return mutex.run(async () => {
      let written = 0;
      for (const v of waiting()) { if (!(await pushRow(v))) break; written++; }
      return { written, left: waiting().length };
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
        const c = clientById.get(v.client), sub = v.submitted, boxes = boxesFor(sub.inverters ?? declaredInverters(v));
        return {
          id: v.id, client: c?.name || v.client, date: v.date, submittedAt: sub.row[colIndex('at')], cleaner: v.cleaner || sub.row[colIndex('cleaner')],
          counts: sub.counts, defects: sub.defects, details: sub.details, overall: sub.answers?.overall || '', inverters: sub.inverters ?? declaredInverters(v),
          checks: sub.checks ?? sub.row[colIndex('checks')], folder: sub.row[colIndex('folder')], at: sub.at, sheetPending: sub.sheetDone === false,
          ...attention(v, boxes, sub.answers || { electrical: {}, signatures: {}, work: {}, overall: 'Completed' }),
          amc: amcStatus(c, istDate(now())), amcExpiry: dateOrEmpty(c?.amcExpiry) || '',
          photos: Object.entries(v.photos).map(([hash, ph]) => ({ hash, box: ph.box, name: ph.name, location: ph.locationSource || '' })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
        };
      }).sort((a, b) => b.at - a.at);
      return send(res, 200, { canShowPhotos: typeof storage.read === 'function', hasExcel: cfg.sheet === 'excel', visits });
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

      if (p === '/api/health') return send(res, 200, { ok: true, ...VERSION });
      if (p === '/api/login' && req.method === 'POST') {
        const { pin } = JSON.parse((await body(req, 2000)).toString() || '{}');
        const vendor = cfg.vendors.length ? checkPin(String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown', pin) : open;
        return send(res, 200, { token: makeToken(vendor), name: vendor.name });
      }
      const who = authed(req);
      if (!who) return send(res, 401, { error: 'Please sign in' });

      if (p === '/api/config' && req.method === 'GET') return send(res, 200, config(who));
      if (p === '/api/photo' && req.method === 'POST') {
        const q = Object.fromEntries(url.searchParams);
        return send(res, 200, await savePhoto(q, await body(req, cfg.maxPhotoBytes + 1024)));
      }
      if (p === '/api/visit' && req.method === 'POST') {
        return send(res, 200, await submitVisit(JSON.parse((await body(req, 20000)).toString() || '{}'), who.name));
      }
      send(res, 404, { error: 'Not found' });
    } catch (e) {
      const status = e instanceof SyntaxError ? 400 : e.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: status >= 500 && !e.status ? (cfg.exposeErrors ? `Server error: ${e.message}` : 'Server error') : e.message });
    }
  });
  // In-process access (used to load demo data without any network call).
  server.direct = { photo: savePhoto, visit: submitVisit, retryPending };
  server.sheet = sheet;
  if (cfg.sheetRetryMs > 0) {
    const timer = setInterval(() => { if (waiting().length) retryPending().catch(() => {}); }, cfg.sheetRetryMs);
    timer.unref();
    server.on('close', () => clearInterval(timer));
  }
  return server;
}
