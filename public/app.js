// Phone page: pick client and date, fill the photo boxes, answer defects, submit.
// Everything is queued on the phone first, so it still works with no signal on the roof.
const $ = id => document.getElementById(id);
const FRESH_MS = 3 * 60 * 1000;   // a "camera" photo must be this new, so old gallery photos are refused
let config, photos = {}, defects = null, warned = false;

function say(text, kind) { const m = $('msg'); m.textContent = text; m.className = kind; m.style.display = text ? 'block' : 'none'; }
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

// ---------- queue (IndexedDB)
const dbP = new Promise((ok, no) => {
  const r = indexedDB.open('wrs-photos', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('q', { autoIncrement: true });
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
});
async function tx(mode, fn) {
  const db = await dbP;
  return new Promise((ok, no) => { const r = fn(db.transaction('q', mode).objectStore('q')); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
}
let flushing = false;
async function flush() {
  if (flushing) return; flushing = true;
  try {
    for (const key of await tx('readonly', s => s.getAllKeys())) {
      const it = await tx('readonly', s => s.get(key));
      let r;
      try {
        r = it.type === 'photo'
          ? await fetch('/api/photo', { method: 'POST', body: it.blob, headers: it.headers })
          : await fetch('/api/visit', { method: 'POST', body: JSON.stringify(it.body), headers: { 'Content-Type': 'application/json' } });
      } catch { break; }                          // offline: keep order, try later
      if (r.status >= 500) break;                 // server trouble: try later
      if (!r.ok) console.warn('Dropped item', it.type, await r.text());
      await tx('readwrite', s => s.delete(key));
    }
  } finally { flushing = false; }
  const left = await tx('readonly', s => s.count());
  $('pending').textContent = left ? `${left} item(s) waiting for signal. Keep this page open or reopen it later.` : '';
  if (!left && $('msg').className === 'info') say('All sent.', 'ok');
}
addEventListener('online', flush); setInterval(flush, 20000);

// ---------- GPS and photo stamping
function gps() {
  return new Promise(ok => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition(p => ok(p.coords), () => ok(null), { enableHighAccuracy: true, timeout: 10000, maximumAge: 20000 })
    : ok(null));
}
async function toJpeg(file, stampLines) {
  const img = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
  if (stampLines) {
    const fs = Math.max(18, Math.round(c.width / 45)), pad = 10, hgt = stampLines.length * (fs + 6) + pad * 2;
    x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, c.height - hgt, c.width, hgt);
    x.fillStyle = '#fff'; x.font = `${fs}px Arial`;
    stampLines.forEach((t, i) => x.fillText(t, pad, c.height - hgt + pad + fs + i * (fs + 6)));
  }
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
}

// ---------- boxes
function renderBoxes() {
  $('boxes').innerHTML = '';
  for (const k of config.kinds) {
    const list = photos[k.key] ||= [];
    const box = document.createElement('div'); box.className = 'box' + (list.length ? ' has' : '');
    box.innerHTML = `<div class="name">${k.key}</div><div class="hint">${k.camera ? 'Camera + location' : 'Camera or gallery'}</div>
      <div class="count">${list.length ? list.length + ' photo(s)' : 'Tap to add'}</div><div class="thumbs"></div>`;
    list.forEach((p, i) => {
      const t = document.createElement('div'); t.className = 'x';
      t.innerHTML = `<img src="${p.url}" alt=""><span>&times;</span>`;
      t.querySelector('span').onclick = e => { e.stopPropagation(); URL.revokeObjectURL(p.url); list.splice(i, 1); renderBoxes(); };
      box.querySelector('.thumbs').appendChild(t);
    });
    box.onclick = () => pick(k);
    $('boxes').appendChild(box);
  }
}
function pick(kind) {
  if (!$('client').value) return say('Select the client first.', 'err');
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  if (kind.camera) inp.capture = 'environment'; else inp.multiple = true;
  const where = kind.camera ? gps() : Promise.resolve(null);   // start GPS while the camera is open
  inp.onchange = async () => {
    for (const f of inp.files) {
      if (kind.camera && Date.now() - f.lastModified > FRESH_MS) { say(`${kind.key}: please take a new photo with the camera, not an old one.`, 'err'); continue; }
      const pos = await where, now = new Date();
      const lines = kind.camera ? [
        `${$('client').selectedOptions[0].textContent}  |  ${kind.key}`,
        now.toLocaleString('en-IN'),
        pos ? `${pos.latitude.toFixed(6)}, ${pos.longitude.toFixed(6)}  (±${Math.round(pos.accuracy)} m)` : 'Location not available',
      ] : null;
      const blob = await toJpeg(f, lines);
      photos[kind.key].push({ blob, url: URL.createObjectURL(blob), lat: pos?.latitude, lon: pos?.longitude, acc: pos?.accuracy, taken: now.toISOString() });
      if (kind.camera && !pos) say('Photo added, but location was not available. Turn on location for the next one.', 'info');
      else say('', '');
    }
    renderBoxes();
  };
  inp.click();
}

// ---------- defects
document.querySelectorAll('.yn button').forEach(b => b.onclick = () => {
  defects = b.dataset.v; document.querySelectorAll('.yn button').forEach(x => x.classList.toggle('on', x === b));
});
$('details').oninput = () => { if ($('details').value.trim() && defects !== 'Yes') document.querySelector('.yn .yes').click(); };

// ---------- submit
$('submit').onclick = async () => {
  const cleaner = $('cleaner').value.trim(), client = $('client').value, date = $('date').value;
  if (!cleaner) return say('Type your name.', 'err');
  if (!client) return say('Select the client.', 'err');
  if (!date) return say('Select the date.', 'err');
  if (!defects) return say('Answer: any defects noticed? Yes or No.', 'err');
  const missing = config.kinds.filter(k => !photos[k.key].length).map(k => k.key);
  if (missing.length && !warned) { warned = true; return say(`No photo in: ${missing.join(', ')}. Press Submit again to send anyway.`, 'info'); }

  localStorage.setItem('cleaner', cleaner);
  const visit = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const counts = {};
  for (const k of config.kinds) {
    counts[k.key] = photos[k.key].length;
    for (const p of photos[k.key]) {
      const headers = { 'x-visit': visit, 'x-client': encodeURIComponent(client), 'x-date': date, 'x-kind': k.key, 'x-taken': p.taken, 'Content-Type': 'image/jpeg' };
      if (p.lat != null) Object.assign(headers, { 'x-lat': p.lat, 'x-lon': p.lon, 'x-acc': Math.round(p.acc) });
      await tx('readwrite', s => s.add({ type: 'photo', blob: p.blob, headers }));
    }
  }
  await tx('readwrite', s => s.add({ type: 'visit', body: { visit, client, date, cleaner, defects, details: $('details').value, counts } }));

  // reset the form for the next visit
  for (const k of config.kinds) { photos[k.key].forEach(p => URL.revokeObjectURL(p.url)); photos[k.key] = []; }
  defects = null; warned = false; $('details').value = '';
  document.querySelectorAll('.yn button').forEach(x => x.classList.remove('on'));
  renderBoxes();
  say('Submitted. Sending...', 'info');
  flush();
};

// ---------- start
(async () => {
  $('cleaner').value = localStorage.getItem('cleaner') || '';
  try { config = await (await fetch('/api/config')).json(); localStorage.setItem('config', JSON.stringify(config)); }
  catch { config = JSON.parse(localStorage.getItem('config') || 'null'); }
  if (!config) return say('Could not load the client list. Check your internet and reopen.', 'err');
  for (const c of config.clients) $('client').add(new Option(c.name, c.id));
  $('date').value = today(); $('date').max = today(); $('date').min = daysAgo(config.maxBackDays);
  renderBoxes(); flush();
})();
