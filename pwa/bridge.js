// The shim (ev-bridge): gives the page the same window.claude.use('db' | 'user' | 'sample' | 'mcp') it has on
// claude.ai, backed by this Worker's /api/db instead. Adapted from test/harness/stub.js.
//   db:     the whole record is loaded once, kept in memory, and checked for changes every 10 s and on focus.
//           A write goes to the Worker first; only when it is saved does the page's copy change. B-389: each save
//           carries the version the shim last saw of that document (if_version, as the run API's); a document that
//           changed since is refused (409), the shim reads the record again and tries once more without overwriting
//           what is newer (an update re-merged, a create laid under); any save that still fails is refused to the page
//           with the document it tried to save.
//           B-404 (D-325, D-326): offline. An IndexedDB copy of the record (and the versions) is kept, so the app boots
//           with no connection; a note saved with no connection goes to an outbox (kept in IndexedDB) and the page's
//           copy changes at once; every other write is refused offline with the document it tried to save. Back online,
//           the outbox is sent pinned to the version each note was read at; a stale one is never merged: the newer
//           version stays the note and his is kept at once as a second note, '<title> (earlier)' (earlierOf the
//           original), and the page is told ('ev-note-kept'). 'ev-sync' tells the page online, pending and syncing.
//   user:   whoever holds the token is the owner (one person).
//   sample: Claude on Haiku through the Worker's /api/claude (D-299); the key stays on the Worker.
//   mcp:    none (the scheduled runs and the Study Watch reader live on claude.ai and the Mac).
//   jobs:   B-324 (D-308): a job runs here at once, through the Worker, instead of waiting on the scheduled worker. The
//           page saves jobs/<id>, then asks to fire the worker; with no mcp that ask comes back mcp_unavailable, and the
//           page records it on the job. For a worker kind the shim records the hand-off as made instead and runs the
//           job (jobs.mjs, the worker's own brief, fold and checks), writing what passes through the run API.
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
  // B-404: a request the network refuses marks the app offline (a cancelled ask does not); any answer marks it online
  const api = async (path, init = {}) => {
    let r;
    try {
      r = await fetch('/api/' + path, {
        ...init,
        headers: { ...(init.headers || {}), authorization: 'Bearer ' + token },
      });
    } catch (e) {
      if (!(init.signal && init.signal.aborted)) setOnline(false);
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { offline: true });
    }
    setOnline(true);
    return r;
  };

  // ---- B-404: the IndexedDB copy (the record, its versions and the cursor) and the outbox of note saves
  const IDB = 'ev-app';
  const KV = 'kv';
  let idbP = null;
  const idb = () =>
    (idbP =
      idbP ||
      new Promise((ok, no) => {
        if (typeof indexedDB === 'undefined' || !indexedDB) return no(new Error('no IndexedDB'));
        const q = indexedDB.open(IDB, 1);
        q.onupgradeneeded = () => q.result.createObjectStore(KV);
        q.onsuccess = () => ok(q.result);
        q.onerror = () => no(q.error);
      }));
  const idbGet = k =>
    idb().then(
      d =>
        new Promise((ok, no) => {
          const q = d.transaction(KV, 'readonly').objectStore(KV).get(k);
          q.onsuccess = () => ok(q.result);
          q.onerror = () => no(q.error);
        })
    );
  const idbPut = (k, v) =>
    idb().then(
      d =>
        new Promise((ok, no) => {
          const t = d.transaction(KV, 'readwrite');
          t.objectStore(KV).put(v, k);
          t.oncomplete = () => ok();
          t.onerror = t.onabort = () => no(t.error);
        })
    );
  let copyTimer = 0;
  /** The record's copy written a moment after the last change (the outbox is written at once, by keepOutbox). */
  const keepCopy = () => {
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      idbPut('record', { db, vers, since, at: Date.now() }).catch(() => {});
    }, 300);
  };
  const outbox = {}; // c \n id -> {c, id, doc, base}: a note saved on this device, not yet in the record
  const keepOutbox = () => idbPut('outbox', clone(outbox)).catch(() => {});
  const net = { online: true, syncing: false };
  const pending = () => Object.keys(outbox).length;
  let told = '';
  function tell() {
    const detail = { online: net.online, pending: pending(), syncing: net.syncing };
    const k = JSON.stringify(detail);
    if (k === told) return;
    told = k;
    try {
      window.dispatchEvent(new CustomEvent('ev-sync', { detail }));
    } catch (e) {}
  }
  function setOnline(on) {
    if (net.online === on) return;
    net.online = on;
    tell();
    if (on && pending()) replay();
  }

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
  const vers = {}; // B-389: c -> id -> the version last seen, sent with the next save of that document
  const verOf = (c, id) => (vers[c] && vers[c][id]) || null;
  const setVer = (c, id, v) => {
    if (Number.isInteger(v)) (vers[c] = vers[c] || {})[id] = v;
  };
  let since = 0;
  const subs = [];
  const emit = c => subs.filter(s => s.c === c).forEach(s => s.fire());
  const take = docs => {
    const changed = new Set();
    for (const d of docs) {
      // a read that left before a save landed never puts the older copy back over it
      if (Number.isInteger(d.v) && d.v < (verOf(d.c, d.id) || 0)) continue;
      // B-404: a note saved on this device and not yet sent stays as he wrote it; replay() settles it
      if (outbox[d.c + '\n' + d.id]) continue;
      (db[d.c] = db[d.c] || {})[d.id] = d.data;
      setVer(d.c, d.id, d.v);
      changed.add(d.c);
    }
    if (changed.size) keepCopy();
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
    // B-404: the copy kept on this device, read first, so the app opens with no connection
    const [copy, box] = await Promise.all([idbGet('record').catch(() => null), idbGet('outbox').catch(() => null)]);
    if (box && typeof box === 'object') Object.assign(outbox, box);
    if (!token) await askToken('Your E.V. token');
    for (;;) {
      let got;
      try {
        got = await pull();
      } catch (e) {
        if (!(copy && copy.db)) throw e;
        // no record to read (offline, or the Worker is down): the copy kept on this device, read-only but for notes
        for (const c of Object.keys(copy.db)) db[c] = copy.db[c];
        for (const c of Object.keys(copy.vers || {})) vers[c] = copy.vers[c];
        since = copy.since || 0;
        setOnline(false);
        break;
      }
      if (got !== 401) break;
      await askToken('That token was refused. Try again');
    }
    for (const k of Object.keys(outbox)) {
      const o = outbox[k];
      (db[o.c] = db[o.c] || {})[o.id] = o.doc;
    }
    tell();
    if (net.online && pending()) replay();
    const refresh = () =>
      pull()
        .then(ch => {
          if (ch instanceof Set) ch.forEach(emit);
          if (pending()) replay();
        })
        .catch(() => {});
    setInterval(refresh, 10000);
    addEventListener('focus', refresh);
    addEventListener('online', refresh);
    addEventListener('offline', () => setOnline(false));
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
  // B-389: one document's saves go one at a time, each built and pinned when its turn comes, so the page's own quick
  // saves of one document never refuse each other; only a change from elsewhere is a conflict. On a conflict (409:
  // a run or another device wrote it since) the record is read again and the save tried once more, never over what is
  // newer: an update is merged again into the document as it is now; a create that found the document made meanwhile
  // adds only what that document lacks (mergeUnder), and is refused when both set one field differently (B-394). A set
  // over a document that changed is not retried. Any save that fails (a conflict, a network failure, a refusal) reaches
  // the page with the document it tried to save (e.unsaved), so his words are never simply gone.
  const queues = new Map();
  function save(c, id, make, kind = 'set') {
    const key = c + '\n' + id;
    const attempt = async () => {
      const doc = make();
      // B-404: a note goes to the outbox while offline, or while an earlier save of it waits there (so they stay in
      // order); any other write is refused offline, with the document it tried to save
      if (c === 'notes' && (outbox[key] || !net.online)) return queueNote(c, id, doc);
      if (!net.online && c !== 'notes') throw offlineError(doc);
      try {
        return await saveNow(c, id, doc);
      } catch (e) {
        if (e.offline && c === 'notes') return queueNote(c, id, doc);
        if (e.offline) throw Object.assign(offlineError(doc), { cause: e });
        if (!e.conflict) throw Object.assign(e, { unsaved: doc });
        let again = null;
        if (kind === 'update') again = make;
        else if (e.wasCreate && (db[c] || {})[id]) again = () => mergeUnder(clone(db[c][id]), doc);
        if (!again) throw Object.assign(e, { unsaved: doc });
        let next;
        try {
          next = again();
        } catch (e1) {
          throw Object.assign(e1, { unsaved: doc });
        }
        try {
          return await saveNow(c, id, next);
        } catch (e2) {
          throw Object.assign(e2, { unsaved: next });
        }
      }
    };
    const turn = (queues.get(key) || Promise.resolve()).catch(() => {}).then(attempt);
    queues.set(key, turn);
    turn.catch(() => {}).then(() => queues.get(key) === turn && queues.delete(key));
    return turn;
  }
  /** `add` laid under `t`: objects merged deeply, and a value `t` already holds is kept, so nothing newer goes. B-394:
   * a field both set to different values is a collision, refused as a conflict (the caller adds e.unsaved), never
   * silently dropped; only the top-level envelope (who made the document, and when) stays the first maker's. */
  const ENVELOPE = new Set(['schema', 'writer', 'at', 'source', 'updatedAt']);
  function mergeUnder(t, add, top = true) {
    for (const k of Object.keys(add)) {
      const v = add[k];
      const obj = x => x && typeof x === 'object' && !Array.isArray(x);
      if (obj(v) && obj(t[k])) mergeUnder(t[k], v, false);
      else if (!(k in t)) t[k] = clone(v);
      else if (!(top && ENVELOPE.has(k)) && JSON.stringify(t[k]) !== JSON.stringify(v)) {
        const e = new Error('it was written elsewhere at the same moment, so it wasn’t saved');
        e.code = 'conflict';
        e.conflict = true;
        e.field = k;
        throw e;
      }
    }
    return t;
  }
  async function saveNow(c, id, doc) {
    const job = await jobHandOff(c, doc);
    if (job) doc = job;
    const seen = verOf(c, id);
    const r = await api(
      'db/' + encodeURIComponent(c) + '/' + encodeURIComponent(id) + (seen ? '?if_version=' + seen : ''),
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(doc),
      }
    );
    if (r.status === 409) {
      // B-389: it changed since it was read (another device, a run, or a job): nothing was written. Read the record
      // again, so the page shows the document as it is now and a retry builds on it.
      const b = await r.json().catch(() => ({}));
      await pull()
        .then(ch => ch instanceof Set && ch.forEach(emit))
        .catch(() => {});
      const e = new Error('it changed elsewhere while you were writing, so it wasn’t saved');
      e.code = 'conflict';
      e.conflict = true;
      e.wasCreate = !seen;
      e.currentVersion = b.current_version == null ? null : b.current_version;
      const cur = (db[c] || {})[id];
      if (cur) e.current = clone(cur); // B-404: the version that stays, for the page to show beside his
      throw e;
    }
    if (!r.ok) {
      const e = new Error('not saved (' + r.status + ')');
      e.code = r.status === 401 ? 'permission_denied' : 'unavailable';
      throw e;
    }
    const saved = await r.json().catch(() => ({}));
    (db[c] = db[c] || {})[id] = doc;
    setVer(c, id, saved.version);
    keepCopy();
    emit(c);
    if (job) runAppJob(id);
  }

  // ---- B-404: notes offline. A save with no connection is kept in the outbox and shown at once; replay() sends the
  // outbox when the connection is back, each note pinned to the version it was read at.
  function offlineError(doc) {
    const e = new Error('you’re offline, so it wasn’t saved');
    e.code = 'unavailable';
    e.offline = true;
    e.unsaved = doc;
    return e;
  }
  async function queueNote(c, id, doc) {
    const key = c + '\n' + id;
    const was = outbox[key];
    outbox[key] = { c, id, doc, base: was ? was.base : verOf(c, id) };
    (db[c] = db[c] || {})[id] = doc;
    await keepOutbox();
    keepCopy();
    tell();
    emit(c);
    if (net.online) replay();
  }
  const putPath = (c, id, base) =>
    'db/' + encodeURIComponent(c) + '/' + encodeURIComponent(id) + (base ? '?if_version=' + base : '');
  const EARLIER = ' (earlier)';
  /** core/notes.mjs noteEarlierTitle, the same rule (test/pwa-offline.test.mjs holds them equal). */
  const earlierTitle = title => {
    const t = String(title || '').endsWith(EARLIER) ? String(title).slice(0, -EARLIER.length) : String(title || '');
    return (t.trim() || 'Untitled').slice(0, 300 - EARLIER.length) + EARLIER;
  };
  /** A new note id as core/notes.mjs newNoteId makes one: n-<UTC time>-<16 random letters and digits>. */
  function newNoteId(at) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const v = new Uint32Array(16);
    crypto.getRandomValues(v);
    const iso = new Date(at).toISOString();
    const t = iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 19).replace(/:/g, '');
    return 'n-' + t + '-' + Array.from(v, x => A[x % 62]).join('');
  }
  /** D-326: his version of note `id` as the second note: a new note, made now, earlierOf the original. */
  function earlierNote(his, id, at) {
    const d = clone(his);
    for (const k of ['archivedAt', 'discardedAt']) delete d[k];
    return { ...d, at, createdAt: at, title: earlierTitle(his.title), earlierOf: id, editedAt: his.editedAt || at };
  }
  let replaying = null;
  function replay() {
    if (replaying) return replaying;
    replaying = (async () => {
      net.syncing = true;
      tell();
      for (let round = 0; round < 20 && net.online; round++) {
        let sent = 0;
        for (const key of Object.keys(outbox)) {
          const o = outbox[key];
          if (!o || o.refused) continue;
          const doc = o.doc;
          let r;
          try {
            r = await api(putPath(o.c, o.id, o.base), {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(doc),
            });
          } catch (e) {
            return; // offline again: the outbox waits
          }
          sent++;
          if (r.ok) {
            const saved = await r.json().catch(() => ({}));
            setVer(o.c, o.id, saved.version);
            // a save made while this one was out goes next, pinned to the version just written
            if (outbox[key] === o && o.doc === doc) delete outbox[key];
            else if (outbox[key]) outbox[key].base = saved.version;
          } else if (r.status === 409) {
            try {
              await keepBoth(key, o);
            } catch (e) {
              return; // the record could not be read: the note stays in the outbox, tried again later
            }
          } else if (r.status === 401) return;
          else {
            // refused for good (its shape or size): kept here, unsent, and never tried again in a loop
            const why = await r.text().catch(() => '');
            o.refused = r.status + ' ' + why.slice(0, 200);
            console.warn('E.V. app: ' + o.c + '/' + o.id + ' was refused: ' + o.refused);
          }
          await keepOutbox();
        }
        if (!sent) break;
      }
      const ch = await pull().catch(() => null);
      if (ch instanceof Set) ch.forEach(emit);
    })().finally(() => {
      net.syncing = false;
      replaying = null;
      keepCopy();
      tell();
    });
    return replaying;
  }
  /** D-326, on a stale note in the outbox: the version in the record stays the note; his is kept at once as the second
   * note '<title> (earlier)' (sent next, as a create), and the page is told. Nothing is merged and nothing is lost. */
  async function keepBoth(key, o) {
    const got = await api('run/get?collection=' + encodeURIComponent(o.c) + '&doc_id=' + encodeURIComponent(o.id));
    if (got.status === 404) {
      o.base = null; // it was never written after all: sent again as a create
      return;
    }
    if (!got.ok) throw new Error('run/get answered ' + got.status);
    const cur = await got.json();
    // from here to the event, nothing waits: no save of this note can slip in between
    const his = outbox[key].doc; // the newest he saved on this device, a save made meanwhile included
    delete outbox[key];
    const at = new Date().toISOString();
    const eid = newNoteId(at);
    const earlier = earlierNote(his, o.id, at);
    outbox[o.c + '\n' + eid] = { c: o.c, id: eid, doc: earlier, base: null };
    db[o.c][eid] = earlier;
    db[o.c][o.id] = cur.data;
    setVer(o.c, o.id, cur.version);
    try {
      window.dispatchEvent(
        new CustomEvent('ev-note-kept', {
          detail: { id: o.id, earlierId: eid, current: clone(cur.data), earlier: clone(earlier) },
        })
      );
    } catch (e) {}
    emit(o.c);
  }

  // ---- B-324: jobs through the API. jobs-spec.json is what the runner reads of the spec, with the schemas.
  let jobsSpec = null;
  const loadJobsSpec = () =>
    (jobsSpec =
      jobsSpec ||
      fetch('jobs-spec.json').then(r => {
        if (!r.ok) throw new Error('jobs-spec.json answered ' + r.status);
        return r.json();
      }));
  /** The job with its hand-off recorded as made, when the page records that firing the worker found no mcp. */
  async function jobHandOff(c, doc) {
    const f = doc && doc.fired;
    if (c !== 'jobs' || !f || f.ok !== false || f.error !== 'mcp_unavailable') return null;
    const { spec } = await loadJobsSpec().catch(() => ({ spec: null }));
    if (!spec || !(spec.jobs.kinds || {})[doc.kind]) return null; // a builder kind stays as the page wrote it
    return { ...doc, fired: { at: f.at, ok: true } };
  }
  const running = new Set();
  const getJson = async path => {
    const r = await api(path);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(path.split('?')[0] + ' answered ' + r.status);
    return r.json();
  };
  // A document neither the job's record nor the shim's copy holds is written unpinned: if it appeared meanwhile, the batch is refused (409)
  // and the job folds again over the record as it is now.
  const versionOf = async (c, id, seen) => {
    if (!seen && !(db[c] && db[c][id])) return null;
    const d = await getJson('run/get?collection=' + encodeURIComponent(c) + '&doc_id=' + encodeURIComponent(id));
    return d ? d.version : null;
  };
  async function runAppJob(id) {
    if (running.has(id)) return;
    running.add(id);
    try {
      const [{ spec, schemas }, J] = await Promise.all([loadJobsSpec(), import('./jobs.mjs')]);
      const fresh = async () => {
        const ch = await pull();
        if (ch instanceof Set) ch.forEach(emit);
        return J.asRunDb(db);
      };
      const meta = document.querySelector('meta[name="ev-release"]');
      await J.runJob({
        db: await fresh(),
        spec,
        schemas,
        jobId: id,
        release: meta ? meta.content : 'v4',
        reload: fresh,
        ask: async body => {
          const r = await api('claude', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error('the Worker answered ' + r.status);
          return r.json();
        },
        // one job's batch at a time, each pinned just before it is sent, so jobs run side by side but never write
        // over each other's versions
        write: (writes, seen) => (writeLock = writeLock.catch(() => {}).then(() => batch(writes, seen))),
      });
    } catch (e) {
      console.warn('E.V. app: job ' + id + ' stopped: ' + (e && e.message));
      // a job left running would wait forever: mark it failed, to try again
      const left = (db.jobresults || {})[id];
      if (left && left.status === 'running')
        try {
          const J = await import('./jobs.mjs');
          const ctx = {
            ...J.contextFor({ jobId: id, now: new Date(), release: left.release }),
            startedAt: left.startedAt,
          };
          await batch([J.statusWrite(ctx, 'failed', 'it stopped before it finished. Try again.')], J.asRunDb(db));
        } catch (e2) {}
    } finally {
      running.delete(id);
    }
  }
  let writeLock = Promise.resolve();
  async function batch(writes, seen) {
    const J = await import('./jobs.mjs');
    const body = JSON.stringify({ writes: await J.pinned(writes, versionOf, seen) });
    const r = await api('run/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    if (r.status === 409) {
      const b = await r.json().catch(() => ({}));
      const which = b.collection ? ` (${b.collection}/${b.doc_id}, now at version ${b.current_version})` : '';
      throw Object.assign(new Error('a document changed' + which), { conflict: true });
    }
    if (!r.ok) throw new Error('not saved (' + r.status + ')');
    const ch = await pull();
    if (ch instanceof Set) ch.forEach(emit);
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
          set: data => {
            const doc = clone(data);
            return save(c, id, () => doc);
          },
          update(data) {
            const patch = clone(data);
            // merged into the document as it stands when this save's turn comes
            return save(
              c,
              id,
              () => {
                const cur = (db[c] || {})[id];
                if (!cur) {
                  const e = new Error('not found');
                  e.code = 'invalid_argument';
                  throw e;
                }
                return merge(clone(cur), patch);
              },
              'update'
            );
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
        const doc = clone(data);
        await save(c, id, () => doc);
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

  // sample: the claude.ai call shape (sample(input, opts), sample.json, sample.limits), answered by Haiku through
  // /api/claude. Every tier is Haiku. Page tools run here, in rounds, as on claude.ai. Images (B-322: the library's
  // page reading) go with the last user turn as base64 image blocks, as limits() says.
  const fail = (code, message, text) => Object.assign({ code, message }, text ? { text } : {});
  const ROUNDS = 6;
  // The Messages API's image limits: these four types, and well under 5 MB each once base64 (a long edge over 1568
  // px is scaled down by the API anyway). Anything else (a phone's HEIC photo, a large scan) is redrawn as a JPEG.
  const IMAGES = {
    maxCount: 4,
    maxInputBytes: 5e6,
    mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  };
  const EDGE = 1568;
  const RAW_MAX = 3.5e6; // bytes before base64 (which adds a third)
  const base64 = async blob => {
    const b = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };
  async function asJpeg(blob) {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, EDGE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return await new Promise((ok, no) =>
      c.toBlob(b => (b ? ok(b) : no(new Error('the picture could not be redrawn'))), 'image/jpeg', 0.85)
    );
  }
  async function imageBlock(img) {
    if (!(img instanceof Blob)) throw fail('invalid_request', 'an image must be a Blob or File');
    let b = img;
    if (!IMAGES.mediaTypes.includes(b.type) || b.size > RAW_MAX) {
      try {
        b = await asJpeg(b);
      } catch (e) {
        throw fail('invalid_request', 'that picture could not be read (' + (b.type || 'unknown type') + ')');
      }
      if (b.size > RAW_MAX) throw fail('invalid_request', 'that picture is too large to send');
    }
    return { type: 'image', source: { type: 'base64', media_type: b.type, data: await base64(b) } };
  }
  async function ask(input, opts = {}, wantJson = false) {
    let turns = typeof input === 'string' ? [{ role: 'user', content: input }] : (input || []).map(t => ({ ...t }));
    if (!turns.length || turns[turns.length - 1].role !== 'user')
      throw fail('invalid_request', 'input must end on a user turn');
    const images = opts.images ? [].concat(opts.images) : [];
    if (images.length > IMAGES.maxCount)
      throw fail('invalid_request', 'at most ' + IMAGES.maxCount + ' images in one ask');
    const blocks = await Promise.all(images.map(imageBlock));
    // consecutive turns of one role read as one, as on claude.ai
    turns = turns.reduce((a, t) => {
      const last = a[a.length - 1];
      if (last && last.role === t.role) last.content += '\n\n' + t.content;
      else a.push({ role: t.role, content: String(t.content) });
      return a;
    }, []);
    if (wantJson)
      turns[turns.length - 1].content +=
        '\n\nYour reply is machine-parsed: reply with only the JSON value, no other text and no code fence.';
    // the images go before the words that ask about them, in the last user turn
    if (blocks.length) {
      const last = turns[turns.length - 1];
      last.content = [...blocks, { type: 'text', text: last.content }];
    }
    const tools = (opts.tools || []).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema || { type: 'object', properties: {} },
    }));
    const messages = turns;
    let text = '';
    let truncated = false;
    for (let round = 0; round < ROUNDS; round++) {
      let r;
      try {
        r = await api('claude', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            messages,
            tools,
            ...(tools.length && round === ROUNDS - 1 ? { tool_choice: { type: 'none' } } : {}),
          }),
          signal: opts.signal,
        });
      } catch (e) {
        throw opts.signal && opts.signal.aborted
          ? fail('cancelled', 'stopped', text)
          : fail('upstream_error', e.message, text);
      }
      if (!r.ok) {
        const why = await r.text().catch(() => '');
        throw fail(
          r.status === 429 ? 'rate_limited' : r.status === 401 ? 'not_granted' : 'upstream_error',
          r.status + ' ' + why.slice(0, 300),
          text
        );
      }
      const res = await r.json();
      if (res.stop_reason === 'refusal') throw fail('refused', 'Claude declined');
      const said = res.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      if (said.trim()) {
        const before = text;
        text = text ? text + '\n\n' + said : said;
        if (opts.onText) opts.onText({ text, delta: text.slice(before.length) });
      }
      truncated = res.stop_reason === 'max_tokens';
      const uses = res.content.filter(b => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) break;
      messages.push({ role: 'assistant', content: res.content });
      const results = await Promise.all(
        uses.map(async u => {
          const t = opts.tools.find(x => x.name === u.name);
          try {
            if (!t) throw new Error('no tool ' + u.name);
            const out = await t.execute(u.input || {}, { signal: opts.signal || new AbortController().signal });
            return {
              type: 'tool_result',
              tool_use_id: u.id,
              content: typeof out === 'string' ? out : JSON.stringify(out ?? null),
            };
          } catch (e) {
            return { type: 'tool_result', tool_use_id: u.id, content: 'Error: ' + e.message, is_error: true };
          }
        })
      );
      messages.push({ role: 'user', content: results });
    }
    if (!text.trim()) throw fail('empty_completion', 'Claude wrote nothing');
    return { text, truncated, modelTierApplied: opts.modelTier || 'default' };
  }
  const parseJson = raw => {
    const tries = [raw, (raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1]];
    const a = raw.search(/[[{]/),
      b = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
    if (a >= 0 && b > a) tries.push(raw.slice(a, b + 1));
    for (const t of tries)
      if (t != null)
        try {
          return JSON.parse(t);
        } catch (e) {}
    throw fail('invalid_json', 'no JSON in the reply', raw);
  };
  const sample = Object.assign((input, opts) => ask(input, opts), {
    json: async (input, opts = {}) => {
      // on tool calls only the final round's text is parsed, as on claude.ai
      let last = '';
      const res = await ask(input, { ...opts, onText: u => ((last = u.delta), opts.onText && opts.onText(u)) }, true);
      if (res.truncated) throw fail('invalid_json', 'cut short', res.text);
      return parseJson((opts.tools ? last : res.text).trim());
    },
    limits: async () => ({
      maxPromptBytes: 262144,
      maxInputBytes: 262144,
      tools: { maxCount: 16 },
      images: { ...IMAGES, mediaTypes: [...IMAGES.mediaTypes] },
    }),
  });

  window.claude = {
    host: 'ev-app', // B-320 (D-306): the app, never the read-only claude.ai live page (page/app/04-model.js)
    use: async n => {
      if (n === 'db') return ready.then(() => DB);
      if (n === 'user') return { isOwner: async () => true };
      if (n === 'sample') return sample;
      return null;
    },
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
