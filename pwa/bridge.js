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
//           job (jobs.mjs, the worker's own brief, fold and checks), writing what passes through the run API. B-459: a
//           study plan job instead runs in the Worker (POST /api/jobs/<id>/run, planjob.js), whatever the page does.
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

  // ---- B-404: the IndexedDB copy (the record, its versions and the cursor) and the outbox of note saves. Two stores:
  // 'kv' holds the record's copy, merged on each write so two tabs never drop each other's documents; 'outbox' holds one
  // entry per note per tab (<tab> \n <collection> \n <id>), so no tab ever writes over another's waiting words. An
  // entry is removed only once it is in the record, and only when it is still the one that was sent (its tag).
  const IDB = 'ev-app';
  const KV = 'kv';
  const BOX = 'outbox';
  const rand = n => {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const v = new Uint32Array(n);
    crypto.getRandomValues(v);
    return Array.from(v, x => A[x % 62]).join('');
  };
  const TAB = rand(12); // this tab, for as long as it is open
  let idbP = null;
  const idb = () =>
    (idbP =
      idbP ||
      new Promise((ok, no) => {
        if (typeof indexedDB === 'undefined' || !indexedDB) return no(new Error('no IndexedDB'));
        const q = indexedDB.open(IDB, 2);
        q.onupgradeneeded = () => {
          const names = q.result.objectStoreNames;
          const has = n => (names && names.contains ? names.contains(n) : false);
          if (!has(KV)) q.result.createObjectStore(KV);
          if (!has(BOX)) q.result.createObjectStore(BOX);
        };
        q.onsuccess = () => ok(q.result);
        q.onerror = () => no(q.error);
      }));
  /** One transaction over `store`: fn(objectStore, done) runs inside it; resolves with what done() was given. */
  const idbTx = (store, mode, fn) =>
    idb().then(
      d =>
        new Promise((ok, no) => {
          const t = d.transaction(store, mode);
          let out;
          fn(t.objectStore(store), v => (out = v));
          t.oncomplete = () => ok(out);
          t.onerror = t.onabort = () => no(t.error);
        })
    );
  const idbGet = k =>
    idbTx(KV, 'readonly', (st, done) => {
      const q = st.get(k);
      q.onsuccess = () => done(q.result);
    });
  /** The record's copy: read and written in one transaction, each document kept at the newer of the two versions. */
  const writeCopy = () =>
    idbTx(KV, 'readwrite', st => {
      const q = st.get('record');
      q.onsuccess = () => {
        const old = q.result && q.result.db ? q.result : { db: {}, vers: {}, since: 0 };
        const out = { db: clone(old.db), vers: clone(old.vers || {}), since: since, at: Date.now() };
        for (const c of Object.keys(db)) {
          const od = (out.db[c] = out.db[c] || {});
          const ov = (out.vers[c] = out.vers[c] || {});
          for (const id of Object.keys(db[c])) {
            const mine = verOf(c, id) || 0;
            // a newer version wins; at the same version the copy keeps what it holds (another tab's offline words,
            // perhaps) unless this tab's own words wait to be sent
            if (!(id in od) || mine > (ov[id] || 0) || (mine === (ov[id] || 0) && !!outbox[ownKey(c, id)])) {
              od[id] = clone(db[c][id]);
              if (mine) ov[id] = mine;
            }
          }
        }
        // the older cursor of the two: a read from it brings whatever either tab had not seen
        out.since = Math.min(since || 0, old.since || 0) || since || old.since || 0;
        st.put(out, 'record');
      };
    });
  let copyTimer = 0;
  /** The record's copy written a moment after the last change (an outbox entry is written at once, by boxPut). */
  const keepCopy = () => {
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => writeCopy().catch(() => {}), 300);
  };
  const boxAll = () =>
    idbTx(BOX, 'readonly', (st, done) => {
      const out = [];
      const q = st.openCursor();
      q.onsuccess = () => {
        const cur = q.result;
        if (!cur) return done(out);
        out.push([cur.key, cur.value]);
        cur.continue();
      };
    });
  /** true once the entry is in IndexedDB; false when it could not be written (the entry then lives in this tab only,
   * marked local, and its claim is this tab's: no other tab can hold what IndexedDB never held). */
  const boxPut = (key, o) =>
    idbTx(BOX, 'readwrite', st => st.put(clone(o), key)).then(
      () => {
        delete o.local;
        return true;
      },
      () => {
        o.local = true;
        return false;
      }
    );
  /** The entry removed only when it is still the one sent: another tab's newer words under that key stay. */
  const boxDone = (key, tag) =>
    idbTx(BOX, 'readwrite', (st, done) => {
      const q = st.get(key);
      q.onsuccess = () => {
        if (q.result && q.result.tag === tag) st.delete(key);
        done(q.result && q.result.tag !== tag ? q.result : null);
      };
    }).catch(() => null);
  // outbox: <tab> \n c \n id -> {tab, c, id, doc, base, tag, refused?}: a note saved on this device, not yet in the record
  const outbox = {};
  const ownKey = (c, id) => TAB + '\n' + c + '\n' + id;
  const waiting = (c, id) => Object.values(outbox).some(o => o.c === c && o.id === id);
  // B-410: an entry that can still be sent (not refused) keeps the record's newer copy from replacing his words
  const sendableFor = (c, id) => Object.values(outbox).some(o => o.c === c && o.id === id && !o.refused);
  /**
   * B-410: the entry claimed for the second note in one transaction: removed only if it is still the one this tab
   * holds (its tag), and the second note's entry put in the same transaction. true: this tab made the claim, so it
   * makes the second note; false: another tab took it first (or it changed), so nothing is kept twice. With no
   * IndexedDB there is no other tab, and the claim is this tab's.
   */
  const boxClaim = (key, tag, ekey, eo) =>
    idbTx(BOX, 'readwrite', (st, done) => {
      const q = st.get(key);
      q.onsuccess = () => {
        if (!q.result || q.result.tag !== tag) return done(false);
        st.delete(key);
        st.put(clone(eo), ekey);
        done(true);
      };
    }).then(
      won => !!won,
      () => {
        eo.local = true; // the transaction failed: nothing changed in IndexedDB, and the new entry is this tab's alone
        return true;
      }
    );
  // a tab is open while it holds its lock; a closed tab's waiting notes are taken over by the next tab that looks
  const locks = typeof navigator !== 'undefined' && navigator && navigator.locks;
  if (locks) locks.request('ev-tab-' + TAB, () => new Promise(() => {})).catch(() => {});
  async function openTabs() {
    if (!locks) return null;
    try {
      const q = await locks.query();
      return new Set((q.held || []).map(l => String(l.name).replace(/^ev-tab-/, '')));
    } catch (e) {
      return null;
    }
  }
  /** Waiting notes of tabs no longer open, taken into this tab's outbox (under their own keys) to send. */
  async function adopt() {
    const all = await boxAll().catch(() => []);
    const open = await openTabs();
    let n = 0;
    const shown = new Set();
    for (const [key, o] of all) {
      if (outbox[key] || !o || !o.c || claimed.has(o.tag)) continue; // B-410: an entry this tab moved stays moved
      if (o.tab !== TAB && open && open.has(o.tab)) continue; // that tab is open: it sends its own
      if (o.tab === TAB) continue;
      delete o.seen; // B-409 review: a stamp is this tab's own; one another tab left in IndexedDB never counts here
      outbox[key] = o;
      n++;
      // B-410: refused words the record has since passed get their own second note, as take() does
      const v = verOf(o.c, o.id);
      if (o.refused && v && (!o.base || v > o.base)) {
        moveRefused(key, o);
        continue;
      }
      // B-409: this tab's own words for the note wait to be sent: they stay what the page shows, and the words taken
      // over are never stamped seen, so no save here replaces them; they send on their own, and both are kept (D-326)
      if (outbox[ownKey(o.c, o.id)]) continue;
      (db[o.c] = db[o.c] || {})[o.id] = o.doc;
      o.seen = ++SEQ; // B-409: shown to the page from here on (a save asked before this never saw these words)
      shown.add(o.c);
    }
    if (moved) {
      moved = false;
      tell();
    }
    shown.forEach(emit); // B-409: the page shows the words it took over, mid-session as at boot
    return n;
  }
  const net = { online: true, syncing: false };
  const sendable = () => Object.values(outbox).filter(o => !o.refused);
  const pending = () => sendable().length;
  let told = '';
  function tell() {
    const refused = Object.values(outbox)
      .filter(o => o.refused)
      .map(o => ({ c: o.c, id: o.id, why: o.refused }));
    const detail = { online: net.online, pending: pending(), syncing: net.syncing, refused };
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
      if (sendableFor(d.c, d.id)) continue;
      // B-410: a refused entry (words the record can't take as they are) never hides a newer version. The version its
      // words were built on, read again, leaves them shown; a newer one takes the note, and his refused words move at
      // once to a second note of their own, '<title> (earlier)', still refused, which he can open, cut and save. The
      // note then has no entry, so his next save goes straight on from the version he sees.
      const refused = Object.entries(outbox).filter(([, o]) => o.c === d.c && o.id === d.id && o.refused);
      if (refused.length) {
        const newer = !Number.isInteger(d.v) || refused.some(([, o]) => !o.base || d.v > o.base);
        if (!newer) continue;
        for (const [key, o] of refused) moveRefused(key, o);
      }
      (db[d.c] = db[d.c] || {})[d.id] = d.data;
      setVer(d.c, d.id, d.v);
      changed.add(d.c);
    }
    if (changed.size) keepCopy();
    if (moved) {
      moved = false;
      tell();
    }
    return changed;
  };
  let moved = false;
  // B-410 final review: the tags of refused entries this tab has moved, so a failed claim (IndexedDB still holding the
  // old entry) is never taken over and moved again by a later adopt()
  const claimed = new Set();
  /**
   * B-410: a refused entry's words as a second note on this device: a new id, earlierOf the note, still refused. The
   * old entry is claimed in one transaction (its tag checked, it deleted, the new entry put), so only one tab, and only
   * once, makes the second note: not a reload that takes the entry over twice, not two tabs opening at once, and a
   * crash can't leave both. An entry IndexedDB never held is this tab's, so its claim holds.
   */
  function moveRefused(key, o) {
    const at = new Date().toISOString();
    const eid = newNoteId(at);
    const ekey = ownKey(o.c, eid);
    const eo = { tab: TAB, c: o.c, id: eid, doc: earlierNote(o.doc, o.id, at), base: null, tag: rand(12) };
    eo.refused = o.refused;
    if (outbox[key] === o) delete outbox[key]; // the note now follows the newer version
    if (o.tag) claimed.add(o.tag);
    moved = true;
    const claim = o.local ? boxPut(ekey, eo).then(() => true) : boxClaim(key, o.tag, ekey, eo);
    return claim.then(won => {
      if (!won) return; // another tab (or an earlier take-over in this one) made it
      outbox[ekey] = eo;
      (db[o.c] = db[o.c] || {})[eid] = eo.doc;
      keepCopy();
      tell();
      emit(o.c);
    });
  }
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
    const copy = await idbGet('record').catch(() => null);
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
    await adopt(); // the notes a closed tab (or this app before a reload) left waiting
    tell();
    if (net.online && pending()) replay();
    if (net.online) failStale();
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
  let SEQ = 0; // B-409: the order of saves asked and of words shown to the page, to tell what a save could have seen
  function save(c, id, make, kind = 'set') {
    const key = c + '\n' + id;
    const seq = ++SEQ; // the page asked for this save now: words shown after it were never in it
    const attempt = async () => {
      const doc = make();
      // B-404: a note goes to the outbox while offline, or while an earlier save of it waits there (so they stay in
      // order); any other write is refused offline, with the document it tried to save
      if (c === 'notes' && (waiting(c, id) || !net.online)) return queueNote(c, id, doc, seq);
      if (!net.online && c !== 'notes') throw offlineError(doc);
      try {
        return await saveNow(c, id, doc);
      } catch (e) {
        if (e.offline && c === 'notes') return queueNote(c, id, doc, seq);
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
    if (job) (doc.kind === 'exam-plan' ? startWorkerJob : runAppJob)(id);
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
  async function queueNote(c, id, doc, seq = ++SEQ) {
    const key = ownKey(c, id);
    const was = outbox[key];
    // B-410, B-409: a save of the note replaces another entry for it (one a closed tab left, adopted) only when the
    // save was built on that entry's words: the same words, or words the page showed before he saved (after a
    // reload; refused ones he cut down, D-332). Then the new entry keeps its base: if the record moved on since, the send is stale and both are
    // kept (D-326). Words the save never saw are never dropped: an entry that can still be sent stays and goes first,
    // so this save goes stale behind it and both are kept; refused words become their own second note, still refused.
    const replaced = [];
    for (const [k, o] of Object.entries(outbox)) {
      if (k === key || o.c !== c || o.id !== id) continue;
      // B-409: the page showed these words before this save was asked (after a reload, the note he is editing), so
      // the save was built on them: it replaces them and carries their base on
      const saw = !!o.seen && o.seen < seq;
      if (saw || sameWords(o.doc, doc)) replaced.push([k, o]);
      else if (o.refused) moveRefused(k, o);
    }
    if (moved) {
      moved = false;
      tell();
    }
    const from = replaced.length ? replaced[0] : null;
    for (const [k, o] of replaced) {
      delete outbox[k];
      boxDone(k, o.tag);
    }
    outbox[key] = {
      tab: TAB,
      c,
      id,
      doc,
      base: was ? was.base : from ? from[1].base : verOf(c, id),
      tag: rand(12),
      ...(was && was.from ? { from: was.from } : from ? { from: from[0] } : {}),
    };
    (db[c] = db[c] || {})[id] = doc;
    await boxPut(key, outbox[key]);
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
    const iso = new Date(at).toISOString();
    return 'n-' + iso.slice(0, 10).replace(/-/g, '') + '-' + iso.slice(11, 19).replace(/:/g, '') + '-' + rand(16);
  }
  /** D-326: his version of note `id` as the second note: a new note, made now, earlierOf the original. */
  function earlierNote(his, id, at) {
    const d = clone(his);
    for (const k of ['archivedAt', 'discardedAt']) delete d[k];
    return { ...d, at, createdAt: at, title: earlierTitle(his.title), earlierOf: id, editedAt: his.editedAt || at };
  }
  /** The same words: blocks, course and label, which is all a note's text is (the stamps aside). */
  const sameWords = (a, b) =>
    !!a &&
    !!b &&
    JSON.stringify(a.blocks || []) === JSON.stringify(b.blocks || []) &&
    (a.course === undefined ? null : a.course) === (b.course === undefined ? null : b.course) &&
    (a.label || '') === (b.label || '');
  let replaying = null;
  let backoff = 0;
  let retryTimer = 0;
  let notBefore = 0; // B-410: no send before this time (a busy Worker's pause), whatever asks: refresh, a save, online
  /** A refusal that may pass later (the Worker or D1 busy, a rate limit): tried again after a pause that doubles. */
  function retryLater() {
    backoff = Math.min(60000, backoff ? backoff * 2 : 2000);
    notBefore = Date.now() + backoff;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      notBefore = 0;
      if (net.online) replay();
    }, backoff);
  }
  function settled(key, o, doc) {
    // a save made while this one was out goes next, pinned to the version just written
    if (outbox[key] === o && o.doc === doc) {
      delete outbox[key];
      return boxDone(key, o.tag).then(newer => {
        // another tab wrote newer words under this key meanwhile: they wait here now, pinned to what they read
        if (newer && !outbox[key]) outbox[key] = newer;
      });
    }
  }
  function replay() {
    if (replaying) return replaying;
    if (Date.now() < notBefore) return Promise.resolve(); // the pause runs out first; its timer sends
    replaying = (async () => {
      net.syncing = true;
      tell();
      await adopt();
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
          if (r.ok) {
            sent++;
            backoff = 0;
            const saved = await r.json().catch(() => ({}));
            setVer(o.c, o.id, saved.version);
            if (outbox[key] && outbox[key] !== o) outbox[key].base = saved.version;
            // B-410: a save that replaced this entry while it was out was built on these words: it goes on from here
            for (const e of Object.values(outbox)) if (e.from === key && e.base === o.base) e.base = saved.version;
            await settled(key, o, doc);
          } else if (r.status === 409) {
            sent++;
            try {
              await keepBoth(key, o);
            } catch (e) {
              return retryLater(); // the record could not be read: the note waits, tried again later
            }
          } else if (r.status === 401) return;
          else if (r.status === 429 || r.status >= 500) return retryLater();
          else {
            const why = await r.text().catch(() => '');
            if (outbox[key] !== o) {
              // B-410: a save of the note replaced this entry while it was out: the refusal was of words he has
              // since changed, so it marks nothing and writes nothing; the new entry goes in this same replay
              if (o.tab !== TAB) boxDone(key, o.tag);
              sent++;
              continue;
            }
            // refused for good (its shape or size): kept on this device, unsent, and the page is told; a new save of
            // the note (cut down, D-332) tries again
            o.refused = r.status + ' ' + why.slice(0, 200);
            await boxPut(key, o);
            console.warn('E.V. app: ' + o.c + '/' + o.id + ' was refused: ' + o.refused);
          }
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
   * note '<title> (earlier)' (sent next, as a create), and the page is told. Nothing is merged and nothing is lost.
   * When the record already holds his words (another tab sent the same entry, or a save landed and its answer was
   * lost) there is nothing to keep twice: the entry is done. */
  async function keepBoth(key, o) {
    const got = await api('run/get?collection=' + encodeURIComponent(o.c) + '&doc_id=' + encodeURIComponent(o.id));
    if (got.status === 404) {
      o.base = null; // it was never written after all: sent again as a create
      return;
    }
    if (!got.ok) throw new Error('run/get answered ' + got.status);
    const cur = await got.json();
    const now = outbox[key];
    if (!now) return; // replaced meanwhile by a save of the note (B-410): that entry carries his words on
    const his = now.doc; // the newest he saved on this device, a save made meanwhile included
    const settle = () => {
      if (outbox[key] === now) delete outbox[key];
      if (!sendableFor(o.c, o.id)) {
        db[o.c][o.id] = cur.data;
        setVer(o.c, o.id, cur.version);
      }
    };
    if (sameWords(cur.data, his)) {
      settle();
      emit(o.c);
      await boxDone(key, now.tag);
      return;
    }
    const at = new Date().toISOString();
    const eid = newNoteId(at);
    const earlier = earlierNote(his, o.id, at);
    const ekey = ownKey(o.c, eid);
    const eo = { tab: TAB, c: o.c, id: eid, doc: earlier, base: null, tag: rand(12) };
    // B-410: only the tab whose claim holds makes the second note (two tabs that took over one closed tab's entry, or
    // two tabs with no Web Locks, never make it twice); the second note's entry lands in the same transaction
    // an entry IndexedDB never held is this tab's alone: its claim holds, and the second note is put on its own
    const won = now.local ? (await boxPut(ekey, eo), true) : await boxClaim(key, now.tag, ekey, eo);
    if (outbox[key] !== now) {
      // a save of the note replaced the entry while the claim was out: if the claim held, his words in the
      // second note are kept as well; the new entry goes on as a stale send
      if (!won) return;
    }
    settle();
    if (!won) {
      emit(o.c);
      return;
    }
    outbox[ekey] = eo;
    db[o.c][eid] = earlier;
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
      // B-496: a page run always ends: each ask that gets no answer in askTimeoutMs is stopped, and no flashcards batch
      // starts past the run's window, well inside the 20 minutes after which a run left running is marked failed
      const began = Date.now();
      await J.runJob({
        db: await fresh(),
        timeLeft: () => J.PAGE_RUN_MS - (Date.now() - began),
        spec,
        schemas,
        jobId: id,
        release: meta ? meta.content : 'v4',
        reload: fresh,
        // B-449: a study plan reads this hour's and today's tokens first, and stops with a plain line when there's no room
        usage: async () => {
          const r = await api('claude/usage');
          return r.ok ? r.json() : null;
        },
        ask: async body => {
          const stop = new AbortController();
          const ms = J.askTimeoutMs(body);
          const timer = setTimeout(() => stop.abort(), ms);
          let r;
          try {
            r = await api('claude', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
              signal: stop.signal,
            });
          } catch (e) {
            if (stop.signal.aborted)
              throw new Error(`Claude didn’t answer within ${Math.round(ms / 60000)} minutes, so E.V. stopped asking`);
            throw e;
          } finally {
            clearTimeout(timer);
          }
          if (!r.ok) {
            // B-418 (D-339): a token ceiling's refusal keeps the Worker's plain sentence for the job's result
            const own = await r.json().catch(() => null);
            if (own && own.code === 'ceiling' && own.error)
              throw Object.assign(new Error(String(own.error)), {
                code: 'ceiling',
                scope: own.scope || null,
                until: Number(own.until) || null, // B-430: when the ceiling resets
              });
            // B-449: the refusal's own words (Claude's error message, or the Worker's), short, so the job's result says
            // what went wrong; neither carries a key or a token
            const said =
              (own && own.error && typeof own.error === 'object' ? own.error.message : own && own.error) || '';
            const words = String(said).replace(/\s+/g, ' ').trim().slice(0, 160);
            throw Object.assign(
              new Error(words ? `Claude refused the ask (${r.status}): ${words}` : 'the Worker answered ' + r.status),
              { code: words ? 'refused' : null, status: r.status }
            );
          }
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
  // B-459: a study plan job (Sonnet's make and its fix ask, or a plan edit) runs in the Worker (planjob.js), whatever
  // the page does: the page asks it to start once, and reads the result from jobresults/<id> as it does every job's.
  // A start that never reached the Worker is tried twice more; one the Worker refused is marked failed with its reason.
  // The Worker starts at most one run per job, so a retry never starts a second.
  async function startWorkerJob(id) {
    if (running.has(id)) return;
    running.add(id);
    try {
      const meta = document.querySelector('meta[name="ev-release"]');
      let r = null;
      for (let tries = 0; tries < 3; tries++) {
        if (tries) await new Promise(ok => setTimeout(ok, 2000 * tries));
        try {
          r = await api('jobs/' + encodeURIComponent(id) + '/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ release: meta ? meta.content : 'v4' }),
          });
        } catch (e) {
          r = null;
          continue;
        }
        if (r.status < 500) break;
      }
      if (r && !r.ok && r.status !== 409) {
        const own = await r.json().catch(() => null);
        const J = await import('./jobs.mjs');
        const ctx = J.contextFor({ jobId: id, now: new Date(), release: meta ? meta.content : 'v4' });
        const why =
          'it couldn’t start (' +
          String((own && own.error) || 'the Worker answered ' + r.status).slice(0, 160) +
          '). Try again.';
        await batch([J.statusWrite(ctx, 'failed', why)], J.asRunDb(db)).catch(() => {});
      }
      // while it runs, the record is read every few seconds (not every 10), so the Worker's writes reach this page soon:
      // the running mark, then the plan and its message, and the page's own saves meet fewer documents changed since
      if (r && r.status === 202) watchJob(id);
    } finally {
      running.delete(id);
    }
  }
  const watching = new Set();
  function watchJob(id) {
    if (watching.has(id)) return;
    watching.add(id);
    const until = Date.now() + 15 * 60000; // past the Worker's deadline
    const look = () =>
      pull()
        .then(
          ch => ch instanceof Set && ch.forEach(emit),
          () => {}
        )
        .then(() => {
          const res = (db.jobresults || {})[id];
          if ((res && res.status !== 'running') || Date.now() > until) watching.delete(id);
          else setTimeout(look, 3000);
        });
    setTimeout(look, 1500);
  }
  // B-459: at boot, an app job still marked running long after it started (jobs.mjs staleRuns: a run the app or the
  // Worker lost) is marked failed through the app's own batch, so its result never stays running forever
  async function failStale() {
    try {
      const J = await import('./jobs.mjs');
      const all = J.asRunDb(db);
      for (const id of J.staleRuns(all)) {
        if (running.has(id)) continue;
        const left = db.jobresults[id];
        const ctx = {
          ...J.contextFor({ jobId: id, now: new Date(), release: left.release }),
          startedAt: left.startedAt,
        };
        const w = J.statusWrite(ctx, 'failed', 'it stopped before it finished. Try again.');
        await (writeLock = writeLock.catch(() => {}).then(() => batch([w], J.asRunDb(db)))).catch(() => {});
      }
    } catch (e) {}
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
                // B-411 review: a session's filing mark is laid under, as mergeUnder: a different mark already there
                // wins and this one is refused as a conflict, so two views filing at once file from one mark
                const has = cur.filing && typeof cur.filing === 'object';
                if (
                  c === 'sessions' &&
                  patch.filing &&
                  has &&
                  JSON.stringify(cur.filing) !== JSON.stringify(patch.filing)
                ) {
                  const e = new Error('another view began filing this session first');
                  e.code = 'conflict';
                  e.conflict = true;
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
    // B-442: a prefix (the open note, sent whole and unchanged while its cache lives) goes first in the first turn, as
    // its own block, and the Worker is asked to mark it as the cache breakpoint: the tools and it are read from the cache
    // on every later ask and tool round that starts the same way
    const prefix = typeof opts.prefix === 'string' && opts.prefix ? opts.prefix : '';
    if (prefix) {
      const first = turns[0];
      first.content = [
        { type: 'text', text: prefix },
        ...(Array.isArray(first.content) ? first.content : [{ type: 'text', text: first.content }]),
      ];
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
            // B-418 (D-339): a read-along ask names the note and its text's mark, for the Worker's read limits
            ...(opts.read && round === 0 ? { read: opts.read } : {}),
            ...(prefix ? { cache: [{ m: 0, b: 0 }] } : {}), // B-442: the Worker marks it; never raw cache_control
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
        // B-418 (D-339): the Worker's own refusals (a token ceiling, a read on unchanged text or too soon) keep its code
        // and its plain sentence, which the page shows as it is
        let own = null;
        try {
          own = JSON.parse(why);
        } catch {}
        if (own && ['ceiling', 'unchanged', 'too_soon'].includes(own.code) && own.error)
          throw fail(own.code, String(own.error), text);
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
