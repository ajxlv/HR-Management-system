// All words the cleaner sees are here, so they are easy to change.
const T = {
  pickClient: 'Choose client…',
  needClient: 'Please choose the client.',
  needDate: 'Please choose the date.',
  needDefects: 'Please press NO or YES for defects.',
  oldPhoto: 'This photo is old. Please take a NEW photo with the camera.',
  noPhotoIn: (list) => `No photo in: ${list}. Press SUBMIT again to send anyway.`,
  saved: '✓ Saved. Ready for the next visit.',
  waiting: (n) => `${n} item${n === 1 ? '' : 's'} waiting for signal`,
  wrongPin: 'Wrong PIN. Try again.',
  rejected: (m) => `One item was refused by the server: ${m}`,
  gps: 'Getting location…',
  noGps: 'Photo added, but your location was NOT found. Turn on Location and take the photo again.',
};
const ICONS = {
  Before: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg>',
  After: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg>',
  Bill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  Wires: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/></svg>',
};
const MAX_SIDE = 1600;

const $ = (id) => document.getElementById(id);
const store = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

let cfg = null;
let token = load('token') || '';
const form = { photos: {}, defects: null, warned: '' };

// ---------- tiny IndexedDB queue ----------
const dbp = new Promise((res, rej) => {
  const r = indexedDB.open('wrs', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (mode, fn) => {
  const db = await dbp;
  return new Promise((res, rej) => {
    const t = db.transaction('queue', mode), s = t.objectStore('queue');
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
  });
};
const queueAll = () => tx('readonly', (s) => s.getAll());
const queueAdd = (items) => tx('readwrite', (s) => items.forEach((i) => s.add(i)));
const queueDel = (seq) => tx('readwrite', (s) => s.delete(seq));

// ---------- sending ----------
let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of (await queueAll()).sort((a, b) => a.seq - b.seq)) {
      let r;
      try {
        r = item.type === 'photo'
          ? await fetch('/api/photo?' + new URLSearchParams(item.params), { method: 'POST', body: item.blob, headers: auth() })
          : await fetch('/api/visit', { method: 'POST', body: JSON.stringify(item.body), headers: auth() });
      } catch { break; }                       // no signal: keep everything, try later
      if (r.status === 401) { showLogin(); break; }
      if (r.ok) { await queueDel(item.seq); continue; }
      if (r.status >= 500 || r.status === 429) break; // server trouble: retry later
      const e = await r.json().catch(() => ({}));    // refused for good: drop it, tell the user
      await queueDel(item.seq);
      say(T.rejected(e.error || r.status), 'err');
    }
  } finally { flushing = false; showWaiting(); }
}
const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});
async function showWaiting() {
  const n = (await queueAll()).length;
  $('waiting').hidden = !n;
  $('waiting').textContent = n ? T.waiting(n) : '';
}

// ---------- photos ----------
const pad = (n) => String(n).padStart(2, '0');
function stampText(box, when, pos) {
  const d = new Date(when);
  const ist = new Date(d.getTime() + 330 * 60000); // IST without DST
  const stamp = `${pad(ist.getUTCDate())}-${pad(ist.getUTCMonth() + 1)}-${ist.getUTCFullYear()} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`;
  const gps = pos ? `GPS ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)} (±${Math.round(pos.acc)} m)` : 'GPS not available';
  return [`${clientName()}  •  ${box.key}`, stamp, gps];
}
const clientName = () => $('client').selectedOptions[0]?.textContent || '';

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
    const fs = Math.max(16, Math.round(w / 34)), pad = fs * 0.6, boxH = lines.length * fs * 1.25 + pad * 2;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, h - boxH, w, boxH);
    g.fillStyle = '#fff'; g.font = `700 ${fs}px sans-serif`; g.textBaseline = 'top';
    lines.forEach((t, i) => g.fillText(t, pad, h - boxH + pad + i * fs * 1.25, w - pad * 2));
  }
  for (const q of [0.85, 0.7, 0.55]) {
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob.size < 3.5 * 1024 * 1024) return blob;
  }
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.4));
}

async function onPick(box, files) {
  for (const file of files) {
    if (box.camera && Date.now() - file.lastModified > cfg.photoMaxAgeSec * 1000) { say(T.oldPhoto, 'err'); continue; }
    say(box.gps ? T.gps : '', '');
    const pos = box.gps ? await getPosition() : null;
    const taken = box.camera ? file.lastModified : Date.now();
    const blob = await makeJpeg(file, box.gps ? stampText(box, taken, pos) : null);
    (form.photos[box.key] ||= []).push({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), pos, taken });
    form.warned = '';
    if (box.gps && !pos) { renderTiles(); say(T.noGps, 'warn'); continue; }
  }
  if (!$('msg').classList.contains('warn')) say('', '');
  renderTiles();
}

function renderTiles() {
  $('tiles').replaceChildren(...cfg.boxes.map((box) => {
    const list = form.photos[box.key] || [];
    const tile = document.createElement('div'); tile.className = 'tile' + (list.length ? ' has' : '');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = !box.camera;
    if (box.camera) input.setAttribute('capture', 'environment');
    input.onchange = () => { onPick(box, [...input.files]); input.value = ''; };
    const hit = document.createElement('button'); hit.type = 'button'; hit.className = 'hit';
    hit.innerHTML = `<span class="ico">${ICONS[box.key] || ICONS.Before}</span><span class="lbl">${box.label}</span><span class="cnt">${list.length ? `✓ ${list.length} photo${list.length > 1 ? 's' : ''}` : (box.camera ? 'Tap to take photo' : 'Tap to add photo')}</span>`;
    hit.onclick = () => input.click();
    const thumbs = document.createElement('div'); thumbs.className = 'thumbs';
    list.forEach((p) => {
      const t = document.createElement('div'); t.className = 'thumb';
      const img = new Image(); img.src = p.url; img.alt = box.label + ' photo, tap to view';
      img.onclick = () => openViewer(box, p);
      t.append(img);
      if (box.gps) {
        const g = gpsState(p), b = document.createElement('span');
        b.className = 'badge ' + g.cls; b.textContent = g.short; t.append(b);
      }
      const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label', 'Delete photo');
      x.onclick = () => { URL.revokeObjectURL(p.url); form.photos[box.key] = list.filter((q) => q !== p); form.warned = ''; renderTiles(); };
      t.append(x); thumbs.append(t);
    });
    tile.append(input, hit, thumbs); return tile;
  }));
}

// ---------- GPS check and photo viewer ----------
function gpsState(p) {
  if (!p.pos) return { cls: 'none', short: 'NO GPS', long: 'No location in this photo' };
  const acc = Math.round(p.pos.acc);
  return acc > 50
    ? { cls: 'weak', short: `GPS ±${acc} m`, long: `Location found, but weak (±${acc} m)` }
    : { cls: 'ok', short: `GPS ±${acc} m`, long: `Location OK (±${acc} m)` };
}
function openViewer(box, p) {
  $('vimg').src = p.url;
  const cap = $('vcap'); cap.replaceChildren();
  const add = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; cap.append(e); return e; };
  if (box.gps) {
    const g = gpsState(p);
    add('div', g.long, 'st ' + g.cls);
    if (p.pos) {
      add('small', `${p.pos.lat.toFixed(5)}, ${p.pos.lng.toFixed(5)}`);
      const a = document.createElement('a'); a.className = 'map'; a.target = '_blank'; a.rel = 'noopener';
      a.href = `https://www.google.com/maps?q=${p.pos.lat},${p.pos.lng}`; a.textContent = 'See on map';
      cap.append(a);
    } else add('small', 'Turn on Location, then delete this photo and take it again.');
  } else add('small', 'No location needed for this photo.');
  $('viewer').hidden = false;
}
const closeViewer = () => { $('viewer').hidden = true; $('vimg').removeAttribute('src'); };
$('vclose').onclick = closeViewer;
$('viewer').onclick = (e) => { if (e.target === $('viewer')) closeViewer(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });

// ---------- defects ----------
function setDefects(v) {
  form.defects = v; form.warned = '';
  $('no').classList.toggle('on', v === 'No'); $('yes').classList.toggle('on', v === 'Yes');
}
$('no').onclick = () => setDefects('No');
$('yes').onclick = () => setDefects('Yes');
$('details').oninput = () => { if ($('details').value.trim()) setDefects('Yes'); };

// ---------- submit ----------
function say(text, kind) { const m = $('msg'); m.textContent = text; m.className = 'msg ' + (kind || ''); }

$('submit').onclick = async () => {
  if (!$('client').value) return say(T.needClient, 'err');
  if (!$('date').value) return say(T.needDate, 'err');
  if (!form.defects) return say(T.needDefects, 'err');
  const missing = cfg.boxes.filter((b) => !(form.photos[b.key] || []).length).map((b) => b.label[0] + b.label.slice(1).toLowerCase());
  const key = missing.join(',');
  if (missing.length && form.warned !== key) { form.warned = key; return say(T.noPhotoIn(missing.join(', ')), 'warn'); }

  $('submit').disabled = true;
  const visit = crypto.randomUUID(), client = $('client').value, date = $('date').value;
  const items = [];
  for (const box of cfg.boxes) for (const p of form.photos[box.key] || []) {
    items.push({
      type: 'photo', blob: p.blob,
      params: { visit, client, date, box: box.key, taken: p.taken, ...(p.pos ? { lat: p.pos.lat, lng: p.pos.lng, acc: Math.round(p.pos.acc) } : {}) },
    });
  }
  items.push({ type: 'visit', body: { visit, client, date, defects: form.defects, details: $('details').value.trim() } });
  try {
    await queueAdd(items);                      // saved on the phone first, so nothing is lost
  } catch { $('submit').disabled = false; return say('Could not save on this phone. Free some space and try again.', 'err'); }

  Object.values(form.photos).flat().forEach((p) => URL.revokeObjectURL(p.url));
  form.photos = {}; form.warned = ''; setDefects(null);
  $('details').value = ''; $('client').value = ''; $('date').value = cfg.today;
  renderTiles(); say(T.saved, 'ok'); $('submit').disabled = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showWaiting(); flush();
};

// ---------- start up ----------
function showLogin() { $('app').hidden = true; $('login').hidden = false; $('pin').focus(); }

async function start() {
  let r;
  try { r = await fetch('/api/config', { headers: auth() }); }
  catch { const c = load('config'); if (c) return init(JSON.parse(c)); return say('No signal. Open the app once with signal.', 'err'); }
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
  renderTiles(); showWaiting(); flush();
}

$('pinGo').onclick = async () => {
  const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ pin: $('pin').value }) }).catch(() => null);
  if (!r) { $('pinMsg').textContent = 'No signal.'; $('pinMsg').className = 'msg err'; return; }
  if (!r.ok) { $('pinMsg').textContent = (await r.json()).error || T.wrongPin; $('pinMsg').className = 'msg err'; return; }
  token = (await r.json()).token; store('token', token); $('pin').value = ''; $('pinMsg').textContent = ''; start();
};
$('pin').onkeydown = (e) => { if (e.key === 'Enter') $('pinGo').click(); };

window.addEventListener('online', flush);
setInterval(flush, 20000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
