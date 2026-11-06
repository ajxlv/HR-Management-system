const $ = (id) => document.getElementById(id);
let key = ''; try { key = sessionStorage.getItem('hrkey') || ''; } catch {}
let data = null, statFilter = '';

const flags = (v) => v.checks && v.checks !== 'OK';
const kind = {
  incomplete: (v) => v.missing.length > 0,
  off: (v) => v.off.length > 0,
  notCompleted: (v) => v.notCompleted,
  defects: (v) => v.defects === 'Yes',
  flags,
  clientSign: (v) => v.clientSign !== 'signed',
  amc: (v) => v.amc && (v.amc.state === 'soon' || v.amc.state === 'expired'),
  ok: (v) => !v.missing.length && !v.off.length && !v.noSignature.length && !v.notDone.length && !v.notCompleted && v.defects === 'No' && !flags(v) && v.clientSign === 'signed',
};

async function load() {
  const r = await fetch('/api/hr/visits', { headers: { 'x-hr-key': key } }).catch(() => null);
  if (!r || r.status === 401) { $('main').hidden = true; $('gate').hidden = false; if (r) $('gateMsg').textContent = key ? 'Wrong HR key.' : ''; return; }
  data = await r.json();
  $('gate').hidden = true; $('main').hidden = false;
  if (data.hasExcel) { $('xlsx').hidden = false; $('xlsx').href = '/report.xlsx?key=' + encodeURIComponent(key); }
  const clients = [...new Set(data.visits.map((v) => v.client))].sort();
  $('fClient').replaceChildren(new Option('All clients', ''), ...clients.map((c) => new Option(c, c)));
  render();
}

function stat(label, n, cls, f) {
  const b = document.createElement('button'); b.className = `stat ${cls} ${statFilter === f ? 'on' : ''}`; b.type = 'button';
  b.innerHTML = `<b>${n}</b><span>${label}</span>`;
  b.onclick = () => { statFilter = statFilter === f ? '' : f; $('fStatus').value = statFilter; render(); };
  return b;
}

function render() {
  const V = data.visits, f = $('fStatus').value, c = $('fClient').value;
  statFilter = f;
  $('stats').replaceChildren(
    stat('Visits', V.length, '', ''),
    stat('Missing photos', V.filter(kind.incomplete).length, 'warn', 'incomplete'),
    stat('Any item OFF', V.filter(kind.off).length, 'bad', 'off'),
    stat('Not completed', V.filter(kind.notCompleted).length, 'bad', 'notCompleted'),
    stat('Defects reported', V.filter(kind.defects).length, 'bad', 'defects'),
    stat('No client signature', V.filter(kind.clientSign).length, 'warn', 'clientSign'),
    stat('AMC ending / ended', V.filter(kind.amc).length, 'warn', 'amc'),
    stat('Needs a check', V.filter(kind.flags).length, 'warn', 'flags'),
    stat('All good', V.filter(kind.ok).length, 'good', 'ok'),
  );
  const shown = V.filter((v) => (!c || v.client === c) && (!f || kind[f](v)));
  $('count').textContent = `${shown.length} of ${V.length} visits`;
  $('list').replaceChildren(...(shown.length ? shown.map((v) => card(v)) : [Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No visits match.' })]));
}

const chip = (t, cls) => `<span class="chip ${cls}">${t}</span>`;
function card(v) {
  const el = document.createElement('div'); el.className = 'visit';
  const chips = [
    v.missing.length ? chip('Missing: ' + v.missing.join(', '), 'warn') : chip('All photos in', 'good'),
    v.off.length ? chip('OFF: ' + v.off.join(', '), 'bad') : '',
    v.noSignature.length ? chip('No signature', 'bad') : '',
    v.overall && v.notCompleted ? chip(v.overall, v.overall === 'Not completed' ? 'bad' : 'warn') : '',
    v.clientSign === 'unavailable' ? chip('Client did not sign', 'warn') : v.clientSign !== 'signed' ? chip('No client signature', 'bad') : chip('Client signed', 'good'),
    v.amc?.state === 'expired' ? chip('AMC ended', 'bad') : v.amc?.state === 'soon' ? chip(`AMC ends in ${v.amc.days} days`, 'warn') : '',
    v.defects === 'Yes' ? chip('Defects', 'bad') : '',
    flags(v) ? chip('Check', 'warn') : '',
    v.sheetPending ? chip('Sheet row waiting', 'warn') : '',
  ].join('');
  el.innerHTML = `<button type="button" aria-expanded="false">
      <div class="who"><b></b><span></span></div><div class="when"></div><div class="chips">${chips}</div><span class="arrow">›</span></button>`;
  el.querySelector('b').textContent = v.client;
  el.querySelector('.who span').textContent = `Work date ${v.date} · ${v.cleaner}`;
  el.querySelector('.when').textContent = `Sent ${v.submittedAt}`;
  const btn = el.querySelector('button');
  btn.onclick = () => {
    const open = el.classList.toggle('open'); btn.setAttribute('aria-expanded', open);
    if (open) { const d = detail(v); d.className = 'detail'; el.append(d); } else el.querySelector('.detail')?.remove();
  };
  return el;
}

function detail(v) {
  const d = document.createElement('div');
  const h = (t) => Object.assign(document.createElement('h4'), { textContent: t });
  const p = (t, cls) => Object.assign(document.createElement('p'), { textContent: t, className: cls || '' });
  d.append(h('Defects'), p(v.defects === 'Yes' ? (v.details || 'Yes (no details written)') : 'None reported'));
  if (v.overall) d.append(h('Overall status'), p(v.overall));
  if (v.off.length) d.append(h('Equipment OFF'), p(v.off.join(', ')));
  if (v.noSignature.length) d.append(h('Missing signatures'), p(v.noSignature.join(', ')));
  if (v.notDone.length) d.append(h('Work not done'), p(v.notDone.join(', ')));
  d.append(h('Client signature'), p({ signed: 'Signed', 'image missing': 'Signed, but the picture is missing', unavailable: 'Client was not available', none: 'Not taken' }[v.clientSign] || 'Not taken'));
  if (v.amcExpiry) d.append(h('AMC expiry'), p(v.amcExpiry));
  if (v.checks && v.checks !== 'OK') d.append(h('Needs a check'), p(v.checks));
  d.append(h('Folder in OneDrive'), p(v.folder, 'path'));
  d.append(h(`Photos (${v.photos.length})`));
  const wrap = document.createElement('div'); wrap.className = 'photos';
  for (const ph of v.photos) {
    const f = document.createElement('div'); f.className = 'photo';
    if (data.canShowPhotos) {
      const img = new Image(); img.loading = 'lazy'; img.alt = ph.name;
      img.src = `/api/hr/photo?visit=${encodeURIComponent(v.id)}&hash=${ph.hash}&key=${encodeURIComponent(key)}`;
      img.onclick = () => { $('lightbox').querySelector('img').src = img.src; $('lightbox').hidden = false; };
      f.append(img);
    }
    f.append(Object.assign(document.createElement('span'), { textContent: ph.name + (ph.location && ph.location !== 'none' ? '' : '') }));
    wrap.append(f);
  }
  d.append(wrap);
  return d;
}

$('fClient').onchange = render; $('fStatus').onchange = render;
$('lightbox').onclick = () => { $('lightbox').hidden = true; };
$('go').onclick = () => { key = $('key').value; try { sessionStorage.setItem('hrkey', key); } catch {} load(); };
$('key').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
load();
