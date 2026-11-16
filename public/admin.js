const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const keep = (k, v) => { try { v === undefined ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} };
const recall = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };

let token = recall('adminToken') || '', sites = [];

async function call(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  if (!r) throw new Error('No signal');
  if (r.status === 401 && token) { signOut(); throw new Error('Please sign in again'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

function signOut() { token = ''; keep('adminToken', undefined); $('main').hidden = true; $('gate').hidden = false; $('user').focus(); }

function drawSites() {
  const q = $('find').value.trim().toLowerCase();
  const shown = sites.filter((s) => s.name.toLowerCase().includes(q));
  $('siteCount').textContent = sites.length;
  $('sites').replaceChildren(...shown.map((s) => {
    const tr = el('tr'), name = el('td', '', s.name);
    if (s.addedBy) name.append(el('span', 'tag', `added by ${s.addedBy}`));
    const act = el('td', 'act'), b = el('button', 'del', 'Delete'); b.type = 'button';
    b.onclick = async () => {
      if (!confirm(`Delete the site "${s.name}"? Old visits and photos stay where they are.`)) return;
      try { sites = (await call('/api/admin/sites/delete', { id: s.id })).sites; $('addMsg').textContent = ''; drawSites(); } catch (e) { alert(e.message); }
    };
    act.append(b); tr.append(name, act); return tr;
  }));
}

async function load() {
  const j = await call('/api/admin/sites');
  sites = j.sites;
  $('users').replaceChildren(...j.users.map((u) => { const tr = el('tr'); for (const v of [u.id, u.name, u.username, u.pin]) tr.append(el('td', '', v)); return tr; }));
  $('gate').hidden = true; $('main').hidden = false; drawSites();
}

$('go').onclick = async () => {
  $('gateMsg').textContent = '';
  try {
    const r = await fetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: $('user').value.trim(), password: $('pass').value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('gateMsg').textContent = j.error || 'Could not sign in'; return; }
    token = j.token; keep('adminToken', token); $('pass').value = ''; await load();
  } catch (e) { $('gateMsg').textContent = e.message; }
};
$('pass').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('out').onclick = signOut;
$('find').oninput = drawSites;
$('add').onclick = async () => {
  const name = $('newName').value;
  try {
    const j = await call('/api/admin/sites', { name });
    sites = j.sites; $('newName').value = ''; $('addMsg').textContent = j.existed ? 'That site is already in the list.' : `Added: ${name.trim()}`; drawSites();
  } catch (e) { $('addMsg').textContent = ''; alert(e.message); }
};
$('newName').onkeydown = (e) => { if (e.key === 'Enter') $('add').click(); };

if (token) load().catch(() => signOut()); else signOut();
