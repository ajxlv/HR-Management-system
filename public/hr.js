const $ = (id) => document.getElementById(id);
let key = ''; try { key = sessionStorage.getItem('hrkey') || ''; } catch {}
let data = null, statFilter = '';

const flags = (v) => v.checks && v.checks !== 'OK';
const missing = (v, boxes) => boxes.filter((b) => !v.counts[b]);
const kind = {
  incomplete: (v, boxes) => missing(v, boxes).length > 0,
  defects: (v) => v.defects === 'Yes',
  flags,
  ok: (v, boxes) => !missing(v, boxes).length && v.defects === 'No' && !flags(v),
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
  const V = data.visits, B = data.boxes, f = $('fStatus').value, c = $('fClient').value;
  statFilter = f;
  $('stats').replaceChildren(
    stat('Visits', V.length, '', ''),
    stat('Missing photos', V.filter((v) => kind.incomplete(v, B)).length, 'warn', 'incomplete'),
    stat('Defects reported', V.filter(kind.defects).length, 'bad', 'defects'),
    stat('Needs a check', V.filter(kind.flags).length, 'warn', 'flags'),
    stat('All good', V.filter((v) => kind.ok(v, B)).length, 'good', 'ok'),
  );
  const shown = V.filter((v) => (!c || v.client === c) && (!f || kind[f](v, B)));
  $('count').textContent = `${shown.length} of ${V.length} visits`;
  $('list').replaceChildren(...(shown.length ? shown.map((v) => card(v, B)) : [Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No visits match.' })]));
}

const chip = (t, cls) => `<span class="chip ${cls}">${t}</span>`;
function card(v, B) {
  const miss = missing(v, B), el = document.createElement('div'); el.className = 'visit';
  const chips = [
    miss.length ? chip('Missing: ' + miss.join(', '), 'warn') : chip('All photos in', 'good'),
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
    f.append(Object.assign(document.createElement('span'), { textContent: ph.name }));
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
