// The shim (ev-bridge): gives the page the same window.claude.use('db' | 'user' | 'sample' | 'mcp') it has on
// claude.ai, backed by this Worker's /api/db instead. Adapted from test/harness/stub.js.
//   db:     the whole record is loaded once, kept in memory, and checked for changes every 10 s and on focus.
//           A write goes to the Worker first; only when it is saved does the page's copy change.
//   user:   whoever holds the token is the owner (one person).
//   sample: none in the demo (B-10, no API key), so E.V.'s Claude features show as unavailable.
//   mcp:    none (the scheduled runs and the Study Watch reader live on claude.ai and the Mac).
(function () {
  const KEY = 'ev.token';
  const read = () => {
    try {
      return localStorage.getItem(KEY) || '';
    } catch (e) {
      return '';
    }
  };
  let token = read();
  const clone = v => JSON.parse(JSON.stringify(v));
  const api = (path, init = {}) =>
    fetch('/api/' + path, { ...init, headers: { ...(init.headers || {}), authorization: 'Bearer ' + token } });

  // The token form: shown on first open, or when the Worker refuses the token.
  const askToken = msg =>
    new Promise(resolve => {
      const f = document.createElement('form');
      f.id = 'ev-token';
      f.style.cssText =
        'position:fixed;inset:0;z-index:99;display:grid;place-content:center;gap:10px;padding:24px;background:var(--bg,#111);color:var(--text,#eee);font:16px system-ui';
      f.innerHTML =
        '<b>E.V.</b><label>' +
        msg +
        '<br><input type=password autocomplete=current-password style="font:16px system-ui;padding:8px;margin-top:6px;width:16em"></label><button style="font:16px system-ui;padding:8px">Open</button>';
      f.onsubmit = e => {
        e.preventDefault();
        token = f.querySelector('input').value.trim();
        try {
          localStorage.setItem(KEY, token);
        } catch (e) {}
        f.remove();
        resolve();
      };
      const show = () => {
        document.body.appendChild(f);
        f.querySelector('input').focus();
      };
      if (document.body) show();
      else addEventListener('DOMContentLoaded', show);
    });

  const db = {};
  let since = 0;
  const subs = [];
  const emit = c => subs.filter(s => s.c === c).forEach(s => s.fire());
  const take = docs => {
    const changed = new Set();
    for (const d of docs) {
      (db[d.c] = db[d.c] || {})[d.id] = d.data;
      changed.add(d.c);
    }
    return changed;
  };
  async function pull() {
    const r = await api('db?since=' + since);
    if (r.status === 401) return 401;
    if (!r.ok) throw new Error('record unavailable (' + r.status + ')');
    const body = await r.json();
    since = body.now;
    return take(body.docs);
  }
  const ready = (async () => {
    if (!token) await askToken('Your E.V. token');
    for (;;) {
      const got = await pull();
      if (got !== 401) break;
      await askToken('That token was refused. Try again');
    }
    const refresh = () =>
      pull()
        .then(ch => ch instanceof Set && ch.forEach(emit))
        .catch(() => {});
    setInterval(refresh, 10000);
    addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  })();

  function merge(t, s) {
    for (const k of Object.keys(s)) {
      const v = s[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k]))
        merge(t[k], v);
      else t[k] = clone(v);
    }
    return t;
  }
  async function save(c, id, doc) {
    const r = await api('db/' + encodeURIComponent(c) + '/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!r.ok) {
      const e = new Error('not saved (' + r.status + ')');
      e.code = r.status === 401 ? 'permission_denied' : 'unavailable';
      throw e;
    }
    (db[c] = db[c] || {})[id] = doc;
    emit(c);
  }

  const ops = {
    '==': (a, b) => a === b,
    '>=': (a, b) => a >= b,
    '<=': (a, b) => a <= b,
    '>': (a, b) => a > b,
    '<': (a, b) => a < b,
  };
  function query(c, filters) {
    const rows = () =>
      Object.entries(db[c] || {})
        .filter(([, d]) => filters.every(([f, op, v]) => ops[op](d[f], v)))
        .map(([id, d]) => ({ id, exists: true, data: () => clone(d) }));
    return {
      where: (f, op, v) => query(c, [...filters, [f, op, v]]),
      async get() {
        await ready;
        return { docs: rows() };
      },
      onSnapshot(cb) {
        const s = { c, fire: () => cb({ docs: rows() }) };
        subs.push(s);
        ready.then(s.fire);
        return () => subs.splice(subs.indexOf(s), 1);
      },
      doc: id => {
        const snap = () => {
          const d = (db[c] || {})[id];
          return { id, exists: !!d, data: () => d && clone(d) };
        };
        return {
          set: data => save(c, id, clone(data)),
          async update(data) {
            const cur = (db[c] || {})[id];
            if (!cur) {
              const e = new Error('not found');
              e.code = 'invalid_argument';
              throw e;
            }
            return save(c, id, merge(clone(cur), data));
          },
          async get() {
            await ready;
            return snap();
          },
          onSnapshot(cb) {
            const s = { c, fire: () => cb(snap()) };
            subs.push(s);
            ready.then(s.fire);
            return () => subs.splice(subs.indexOf(s), 1);
          },
        };
      },
      async add(data) {
        const id = 'x' + Math.random().toString(36).slice(2, 10);
        await save(c, id, clone(data));
        return { id };
      },
    };
  }
  const DB = {
    collection: c => query(c, []),
    doc: p => {
      const [c, id] = p.split('/');
      return query(c, []).doc(id);
    },
  };

  window.claude = {
    use: async n => {
      if (n === 'db') return ready.then(() => DB);
      if (n === 'user') return { isOwner: async () => true };
      return null;
    },
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
