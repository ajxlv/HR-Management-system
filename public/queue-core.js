// The phone-side queue, shared by the page and the service worker (so Background Sync can send after the app is closed).
// Classic script on purpose: the page loads it with <script>, the service worker with importScripts().
(function (g) {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('wrs', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'seq', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');   // the sign-in token, and refused items
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const dbp = open();
  async function run(store, mode, fn) {
    const db = await dbp;
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  }
  const all = () => run('queue', 'readonly', (s) => s.getAll()).then((a) => a.sort((x, y) => x.seq - y.seq));
  const add = (items) => run('queue', 'readwrite', (s) => items.forEach((i) => s.add(i)));
  const del = (seq) => run('queue', 'readwrite', (s) => s.delete(seq));
  const getMeta = (k) => run('meta', 'readonly', (s) => s.get(k));
  const setMeta = (k, v) => run('meta', 'readwrite', (s) => (v === undefined ? s.delete(k) : s.put(v, k)));

  // Sends everything in order: photos first, then the visit. Returns how it ended.
  //   stopped: 'offline' | 'server' | 'auth' | null (null = queue is empty)
  async function sendAll() {
    const token = await getMeta('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let sent = 0, stopped = null;
    for (const item of await all()) {
      let r;
      try {
        r = item.type === 'photo'
          ? await fetch('/api/photo?' + new URLSearchParams(item.params), { method: 'POST', body: item.blob, headers })
          : await fetch('/api/visit', { method: 'POST', body: JSON.stringify(item.body), headers });
      } catch { stopped = 'offline'; break; }                    // no signal: keep everything
      if (r.status === 401) { stopped = 'auth'; break; }          // needs a new sign-in
      if (r.ok) { await del(item.seq); sent++; continue; }
      if (r.status >= 500 || r.status === 429) { stopped = 'server'; break; }
      const e = await r.json().catch(() => ({}));                 // refused for good: drop it, remember why
      await del(item.seq);
      const list = (await getMeta('rejected')) || [];
      list.push(e.error || `Error ${r.status}`);
      await setMeta('rejected', list);
    }
    return { sent, stopped, left: (await all()).length };
  }

  // Only one sender at a time across page and service worker (the server also ignores repeats).
  async function flush() {
    const locks = g.navigator && g.navigator.locks;
    if (!locks) return sendAll();
    const r = await locks.request('wrs-flush', { ifAvailable: true }, (lock) => (lock ? sendAll() : null));
    return r || { sent: 0, stopped: 'busy', left: (await all()).length };
  }

  g.WRSQueue = { all, add, del, getMeta, setMeta, flush };
})(self);
