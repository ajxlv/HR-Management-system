import { readExif } from '/exif.js';

// All words the cleaner sees are here, so they are easy to change.
const T = {
  pickClient: 'Choose client…',
  saved: '✓ Saved. Ready for the next visit.',
  waiting: (n) => `${n} item${n === 1 ? '' : 's'} waiting, will send automatically`,
  waitingOpen: (n) => `${n} item${n === 1 ? '' : 's'} waiting for signal. Keep this app open.`,
  wrongPin: 'Wrong PIN. Try again.',
  rejected: (m) => `One item was refused by the server: ${m}`,
  gps: 'Getting location…',
  noGps: 'Photo added, but your location was NOT found. Turn on Location and take the photo again.',
  notVerified: 'Photo added. Its location could NOT be verified (gallery photo). HR will see "location not verified". Use the camera button for a verified location.',
  clearPhotos: 'Changing the client removes the photos you added. Continue?',
  chooseClientFirst: 'Choose the client to see the photo boxes.',
  needTitle: (n) => `Please finish ${n} thing${n === 1 ? '' : 's'} before sending:`,
  camera: 'Tap to take photo', gallery: 'From gallery',
  allNormal: 'Everything set to normal. Check each line, and change anything that is not normal.',
};
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  camera: svg('<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>'),
  paper: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  inverter: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M13 7l-3 5h4l-3 5"/>'),
};
const iconFor = (box) => (box.inverter ? ICON.inverter : box.group === 'Paperwork' ? ICON.paper : ICON.camera);
const MAX_SIDE = 1600;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const store = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

let cfg = null, prevClient = '';
let token = load('token') || '';
// make sure the service worker also knows the token (older installs only had it in localStorage)
if (token) window.WRSQueue.setMeta('token', token).catch(() => {});
// Everything the cleaner has entered so far
const form = { photos: {}, e: {}, s: {}, w: {}, overall: null, defects: null };
const resetForm = () => Object.assign(form, { photos: {}, e: {}, s: {}, w: {}, overall: null, defects: null });
const currentClient = () => cfg?.clients.find((c) => c.id === $('client').value) || null;

// ---------- queue (shared with the service worker, see queue-core.js) ----------
const Q = window.WRSQueue;
const canBackgroundSync = 'serviceWorker' in navigator && 'SyncManager' in window;
let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const r = await Q.flush();
    if (r.stopped === 'auth') showLogin();
    const rejected = await Q.getMeta('rejected');
    if (rejected && rejected.length) { await Q.setMeta('rejected', undefined); say(T.rejected(rejected[0]), 'err'); }
  } finally { flushing = false; showWaiting(); }
}
// Ask the browser to send later even if the app is closed (Android Chrome). The in-page retry stays as the fallback.
function askBackgroundSync() {
  if (!canBackgroundSync) return;
  navigator.serviceWorker.ready.then((reg) => reg.sync.register('wrs-send')).catch(() => {});
}
const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});
const saveToken = (t) => { token = t; store('token', t); Q.setMeta('token', t).catch(() => {}); };
async function showWaiting() {
  const n = (await Q.all()).length;
  $('waiting').hidden = !n;
  $('waiting').textContent = n ? (canBackgroundSync ? T.waiting(n) : T.waitingOpen(n)) : '';
}

// ---------- photos ----------
const pad = (n) => String(n).padStart(2, '0');
const istStamp = (ms) => { const d = new Date(ms + 330 * 60000); return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} IST`; };
const clientName = () => $('client').selectedOptions[0]?.textContent || '';
const SRC_LABEL = { exif: 'photo EXIF', phone: 'phone at upload' };

function stampLines(box, taken, pos, src) {
  const gps = pos ? `GPS ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}${pos.acc != null ? ` (±${Math.round(pos.acc)} m)` : ''} · ${SRC_LABEL[src]}` : 'GPS not available';
  return [`${clientName()}  •  ${box.label}`, taken ? istStamp(taken) : `Added ${istStamp(Date.now())}`, gps];
}

function getPosition() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => res(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  });
}

async function toBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const img = new Image(); img.src = URL.createObjectURL(file);
    await img.decode(); return img;
  }
}

async function makeJpeg(file, lines) {
  const bmp = await toBitmap(file);
  const w0 = bmp.width, h0 = bmp.height, k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, w, h);
  if (lines) {
    const fs = Math.max(16, Math.round(w / 34)), p = fs * 0.6, boxH = lines.length * fs * 1.25 + p * 2;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, h - boxH, w, boxH);
    g.fillStyle = '#fff'; g.font = `700 ${fs}px sans-serif`; g.textBaseline = 'top';
    lines.forEach((t, i) => g.fillText(t, p, h - boxH + p + i * fs * 1.25, w - p * 2));
  }
  for (const q of [0.85, 0.7, 0.55]) {
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob.size < 3.5 * 1024 * 1024) return blob;
  }
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.4));
}

// How far the location of one photo can be trusted (same rules as the server):
//  verified = read from the photo (EXIF), or the phone's live location at a live camera shot
const verdict = (p) => {
  if (p.src === 'exif' || (p.src === 'phone' && p.cap === 'camera')) return 'verified';
  return p.src === 'none' && p.cap === 'camera' ? 'none' : 'unverified';
};

// capture: 'camera' (live shot) or 'gallery'
async function onPick(box, files, capture) {
  let live, liveTried = false, worst = '';
  for (const file of files) {
    if (box.gps) say(T.gps, '');
    let ex = {};
    try { ex = readExif(await file.slice(0, 262144).arrayBuffer()); } catch {}   // the location and date sit at the start of the file
    let pos = null, src = 'none';
    if (box.gps) {
      if (ex.lat !== undefined) { pos = { lat: ex.lat, lng: ex.lng, acc: null }; src = 'exif'; }
      else {
        if (!liveTried) { live = await getPosition(); liveTried = true; }       // the phone's location, asked once per batch
        if (live) { pos = live; src = 'phone'; }
      }
    }
    const taken = ex.takenAt ?? (capture === 'camera' ? Date.now() : null);
    const tsrc = ex.takenAt !== undefined ? 'exif' : capture === 'camera' ? 'camera' : '';
    const blob = await makeJpeg(file, box.gps ? stampLines(box, taken, pos, src) : null);
    const p = { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), pos, src, cap: capture, taken, tsrc };
    (form.photos[box.key] ||= []).push(p);
    if (box.gps) { const v = verdict(p); if (v !== 'verified') worst = v; }
  }
  say(worst === 'none' ? T.noGps : worst === 'unverified' ? T.notVerified : '', worst ? 'warn' : '');
  renderPhotos(); refreshMissing();
}

function gpsState(p) {
  const v = verdict(p);
  if (v === 'none') return { cls: 'none', short: 'NO GPS', long: 'No location in this photo' };
  if (v === 'unverified') return { cls: 'unv', short: 'NOT VERIFIED', long: p.pos ? 'Location NOT verified: gallery photo, using your phone\'s location now' : 'Location NOT verified: no location in this gallery photo' };
  const acc = p.pos?.acc != null ? Math.round(p.pos.acc) : null;
  if (acc !== null && acc > 50) return { cls: 'weak', short: `GPS ±${acc} m`, long: `Location found, but weak (±${acc} m)` };
  return { cls: 'ok', short: acc !== null ? `GPS ±${acc} m` : 'GPS (photo)', long: p.src === 'exif' ? 'Location OK (read from the photo)' : `Location OK (±${acc} m)` };
}

function renderPhotos() {
  const client = currentClient(), host = $('photoGroups');
  $('photoHint').hidden = !!client;
  if (!client) { host.replaceChildren(); return; }
  const groups = [];
  for (const b of client.boxes) { let g = groups.find((x) => x.name === b.group); if (!g) groups.push(g = { name: b.group, boxes: [] }); g.boxes.push(b); }
  host.replaceChildren(...groups.map((g) => {
    const wrap = el('div', 'pgroup'); wrap.append(el('h3', '', g.name));
    const tiles = el('div', 'tiles'); wrap.append(tiles);
    for (const box of g.boxes) tiles.append(tile(box));
    return wrap;
  }));
}

function tile(box) {
  const list = form.photos[box.key] || [];
  const t = el('div', 'tile' + (list.length ? ' has' : '')); t.dataset.id = `box:${box.key}`;
  const mk = (capture) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    if (capture === 'camera') input.setAttribute('capture', 'environment');
    input.onchange = () => { const files = [...input.files]; input.value = ''; if (files.length) onPick(box, files, capture); };
    return input;
  };
  const cam = mk('camera'), gal = mk('gallery');
  const hit = el('button', 'hit'); hit.type = 'button';
  hit.innerHTML = `<span class="ico">${iconFor(box)}</span><span class="lbl">${box.label}</span><span class="cnt">${list.length ? `✓ ${list.length} photo${list.length > 1 ? 's' : ''}` : T.camera}</span>${box.hint && !list.length ? `<span class="hintline">${box.hint}</span>` : ''}`;
  hit.onclick = () => cam.click();
  const g = el('button', 'gal', T.gallery); g.type = 'button'; g.onclick = () => gal.click();
  const thumbs = el('div', 'thumbs');
  list.forEach((p) => {
    const th = el('div', 'thumb');
    const img = new Image(); img.src = p.url; img.alt = box.label + ' photo, tap to view'; img.onclick = () => openViewer(box, p);
    th.append(img);
    if (box.gps) { const s = gpsState(p), b = el('span', 'badge ' + s.cls, s.short); th.append(b); }
    const x = el('button', '', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Delete photo');
    x.onclick = () => { URL.revokeObjectURL(p.url); form.photos[box.key] = list.filter((q) => q !== p); renderPhotos(); refreshMissing(); };
    th.append(x); thumbs.append(th);
  });
  t.append(cam, gal, hit, g, thumbs);
  return t;
}

// ---------- photo viewer ----------
function openViewer(box, p) {
  $('vimg').src = p.url;
  const cap = $('vcap'); cap.replaceChildren();
  const add = (tag, text, cls) => { const e = el(tag, cls, text); cap.append(e); return e; };
  if (box.gps) {
    const g = gpsState(p);
    add('div', g.long, 'st ' + g.cls.replace('unv', 'weak'));
    if (p.pos) {
      add('small', `${p.pos.lat.toFixed(5)}, ${p.pos.lng.toFixed(5)}  ·  from ${SRC_LABEL[p.src]}`);
      const a = el('a', 'map', 'See on map'); a.target = '_blank'; a.rel = 'noopener'; a.href = `https://www.google.com/maps?q=${p.pos.lat},${p.pos.lng}`; cap.append(a);
    } else add('small', p.cap === 'camera' ? 'Turn on Location, then delete this photo and take it again.' : 'This photo has no location. Take it with the camera button for a verified location.');
  } else add('small', 'No location needed for this photo.');
  add('small', p.taken ? `Taken: ${istStamp(p.taken)}${p.tsrc === 'exif' ? ' (from the photo)' : ''}` : 'Taken: time not known');
  $('viewer').hidden = false;
}
const closeViewer = () => { $('viewer').hidden = true; $('vimg').removeAttribute('src'); };
$('vclose').onclick = closeViewer;
$('viewer').onclick = (e) => { if (e.target === $('viewer')) closeViewer(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });

// ---------- checklist ----------
const CLASS = { ON: 'good', OFF: 'bad', 'N/A': 'na', Yes: 'good', No: 'bad', Completed: 'good', 'Partly completed': 'warn', 'Not completed': 'bad' };
const paints = [];   // functions that redraw the selected buttons

function choice(store, key, options, cols) {
  const wrap = el('div', `opts ${cols}`), btns = [];
  for (const o of options) {
    const b = el('button', '', o); b.type = 'button';
    b.onclick = () => { store[key] = o; paint(); refreshMissing(); };
    wrap.append(b); btns.push([o, b]);
  }
  paints.push(() => btns.forEach(([o, b]) => { b.className = store[key] === o ? `on ${CLASS[o]}` : ''; }));
  return wrap;
}
const paint = () => paints.forEach((f) => f());

function buildChecklist() {
  paints.length = 0;
  const f = cfg.form, host = $('checklist'); host.replaceChildren();
  const row = (id, label, widget) => { const r = el('div', 'crow'); r.dataset.id = id; r.append(el('div', 'q', label), widget); host.append(r); };
  host.append(el('div', 'cgroup', 'Electrical equipment'));
  for (const e of f.electrical) row(`e:${e.key}`, e.label, choice(form.e, e.key, f.electricalOptions, 'three'));
  host.append(el('div', 'cgroup', 'Signatures on the paper challan'));
  for (const s of f.signatures) row(`s:${s.key}`, s.label, choice(form.s, s.key, f.yesNo, 'two'));
  host.append(el('div', 'cgroup', 'Work done'));
  for (const w of f.work) row(`w:${w.key}`, w.label, choice(form.w, w.key, f.yesNo, 'two'));
  const ov = $('overall'); ov.replaceChildren();
  const w = choice(form, 'overall', f.overall, ''); w.className = 'chips3'; ov.replaceWith(w); w.id = 'overall';
  paint();
}

$('allNormal').onclick = () => {
  for (const e of cfg.form.electrical) form.e[e.key] = 'ON';
  for (const s of cfg.form.signatures) form.s[s.key] = 'Yes';
  for (const w of cfg.form.work) form.w[w.key] = 'Yes';
  paint(); refreshMissing(); say(T.allNormal, 'ok');
};

// ---------- defects ----------
function setDefects(v) { form.defects = v; $('no').classList.toggle('on', v === 'No'); $('yes').classList.toggle('on', v === 'Yes'); refreshMissing(); }
$('no').onclick = () => setDefects('No');
$('yes').onclick = () => setDefects('Yes');
$('details').oninput = () => { if ($('details').value.trim()) setDefects('Yes'); };

// ---------- what is still missing ----------
function missingItems() {
  const client = currentClient(), out = [];
  if (!client) return [{ id: 'client', text: 'Choose the client' }];
  for (const b of client.boxes) if (b.required && !(form.photos[b.key] || []).length) out.push({ id: `box:${b.key}`, text: `Add a photo: ${b.label[0] + b.label.slice(1).toLowerCase()}` });
  for (const e of cfg.form.electrical) if (!form.e[e.key]) out.push({ id: `e:${e.key}`, text: `Choose ON, OFF or N/A: ${e.label}` });
  for (const s of cfg.form.signatures) if (!form.s[s.key]) out.push({ id: `s:${s.key}`, text: `Answer Yes or No: ${s.label}` });
  for (const w of cfg.form.work) if (!form.w[w.key]) out.push({ id: `w:${w.key}`, text: `Answer Yes or No: ${w.label}` });
  if (!form.overall) out.push({ id: 'overall', text: 'Choose the overall status' });
  if (!form.defects) out.push({ id: 'defects', text: 'Defects: press NO or YES' });
  return out;
}
const target = (id) => document.querySelector(`[data-id="${CSS.escape(id)}"]`);

function showMissing(items, scroll) {
  const box = $('missing');
  document.querySelectorAll('.need').forEach((n) => n.classList.remove('need'));
  if (!items.length) { box.hidden = true; return; }
  const ul = el('ul');
  for (const it of items) {
    const li = el('li'), b = el('button', '', it.text); b.type = 'button';
    b.onclick = () => target(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    li.append(b); ul.append(li); target(it.id)?.classList.add('need');
  }
  box.replaceChildren(el('b', '', T.needTitle(items.length)), ul); box.hidden = false;
  if (scroll) target(items[0].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
// once the list is showing, keep it up to date as items are completed
const refreshMissing = () => { if (!$('missing').hidden) showMissing(missingItems(), false); };

// ---------- client choice ----------
$('client').onchange = () => {
  const had = Object.values(form.photos).some((l) => l.length);
  if (had && !confirm(T.clearPhotos)) { $('client').value = prevClient; return; }
  Object.values(form.photos).flat().forEach((p) => URL.revokeObjectURL(p.url));
  form.photos = {}; prevClient = $('client').value; say('', '');
  renderPhotos(); refreshMissing();
};

// ---------- submit ----------
function say(text, kind) { const m = $('msg'); m.textContent = text; m.className = 'msg ' + (kind || ''); }

$('submit').onclick = async () => {
  const miss = missingItems();
  if (miss.length) { showMissing(miss, true); return; }   // blocked until everything is answered and every required box has a photo
  const client = currentClient(), date = $('date').value;
  if (!date) { say('Please choose the date.', 'err'); return; }
  $('submit').disabled = true;
  const visit = crypto.randomUUID(), items = [];
  for (const box of client.boxes) for (const p of form.photos[box.key] || []) {
    items.push({
      type: 'photo', blob: p.blob,
      params: { visit, client: client.id, date, box: box.key, cap: p.cap, src: p.src, tsrc: p.tsrc || '',
        ...(p.taken ? { taken: p.taken } : {}), ...(p.pos ? { lat: p.pos.lat, lng: p.pos.lng, ...(p.pos.acc != null ? { acc: Math.round(p.pos.acc) } : {}) } : {}) },
    });
  }
  items.push({ type: 'visit', body: { visit, client: client.id, date, defects: form.defects, details: $('details').value.trim(),
    answers: { electrical: { ...form.e }, signatures: { ...form.s }, work: { ...form.w }, overall: form.overall } } });
  try {
    await Q.add(items);                         // saved on the phone first, so nothing is lost
    askBackgroundSync();
  } catch { $('submit').disabled = false; return say('Could not save on this phone. Free some space and try again.', 'err'); }

  Object.values(form.photos).flat().forEach((p) => URL.revokeObjectURL(p.url));
  resetForm(); prevClient = '';
  $('details').value = ''; $('client').value = ''; $('date').value = cfg.today;
  setDefects(null); paint(); renderPhotos(); showMissing([], false);
  say(T.saved, 'ok'); $('submit').disabled = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showWaiting(); flush();
};

// ---------- start up ----------
function showLogin() { $('app').hidden = true; $('login').hidden = false; $('pin').focus(); }

async function start() {
  let r;
  try { r = await fetch('/api/config', { headers: auth() }); }
  catch {
    let c = null; try { c = JSON.parse(load('config')); } catch {}
    if (c && c.form) return init(c);          // an older saved config has no checklist, so it cannot be used
    return say('No signal. Open the app once with signal.', 'err');
  }
  if (r.status === 401) return showLogin();
  cfg = await r.json(); store('config', JSON.stringify(cfg)); init(cfg);
}

function init(c) {
  cfg = c;
  $('login').hidden = true; $('app').hidden = false;
  $('who').textContent = cfg.cleanerName;
  $('client').replaceChildren(new Option(T.pickClient, ''), ...cfg.clients.map((x) => new Option(x.name, x.id)));
  const d = $('date'); d.max = cfg.today; d.value = cfg.today;
  const min = new Date(cfg.today + 'T00:00:00Z'); min.setUTCDate(min.getUTCDate() - cfg.maxDaysBack);
  d.min = min.toISOString().slice(0, 10);
  resetForm(); prevClient = '';
  buildChecklist(); renderPhotos(); showWaiting(); flush();
}

$('pinGo').onclick = async () => {
  const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ pin: $('pin').value }) }).catch(() => null);
  if (!r) { $('pinMsg').textContent = 'No signal.'; $('pinMsg').className = 'msg err'; return; }
  if (!r.ok) { $('pinMsg').textContent = (await r.json()).error || T.wrongPin; $('pinMsg').className = 'msg err'; return; }
  saveToken((await r.json()).token); $('pin').value = ''; $('pinMsg').textContent = ''; start();
};
$('pin').onkeydown = (e) => { if (e.key === 'Enter') $('pinGo').click(); };

window.addEventListener('online', flush);
setInterval(flush, 20000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
