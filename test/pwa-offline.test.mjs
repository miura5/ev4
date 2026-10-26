// B-404 (D-325, D-326): the app offline. The shim (pwa/bridge.js) keeps an IndexedDB copy of the record and an outbox
// of note saves; it boots from the copy with no connection, takes notes offline and refuses every other write with
// his words; back online it sends the outbox pinned to the version each note was read at, and a stale one is never
// merged: the newer stays the note, his becomes '<title> (earlier)' (earlierOf the original), and the page is told.
// The Worker runs here over an in-memory SQLite standing in for D1, as in test/pwa-save.test.mjs; IndexedDB is a small
// in-memory stand-in shared across "reloads". sw.js is run over a fake cache to show the app's files answer offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../pwa/worker.js';
import { makeNotes } from '../core/notes.mjs';
import { SHIM } from '../tools/build-pwa.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'offline-suite-token-not-a-secret';
const N = makeNotes();
const BRIDGE = fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8');

function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
  });
  return { prepare: q => stmt(q), batch: async list => Promise.all(list.map(s => s.all())), sql };
}
const envOf = () => ({ EV_TOKEN: TOKEN, DB: fakeD1(), ASSETS: { fetch: () => new Response('') } });
const put = async (env, c, id, doc, v) => {
  const r = await worker.fetch(
    new Request(`https://ev.example/api/db/${c}/${id}` + (v != null ? '?if_version=' + v : ''), {
      method: 'PUT',
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    }),
    env
  );
  return { status: r.status, body: await r.json() };
};
const stored = (env, c, id) => {
  const r = env.DB.sql.prepare('SELECT data, v FROM docs WHERE c = ? AND id = ?').get(c, id);
  return r ? { v: r.v, data: JSON.parse(r.data) } : null;
};
const allNotes = env =>
  env.DB.sql
    .prepare("SELECT id, data FROM docs WHERE c = 'notes'")
    .all()
    .map(r => ({ id: r.id, ...JSON.parse(r.data) }));

/** IndexedDB, as much of it as the shim asks: one database, one store, get and put. Survives a "reload". */
function fakeIDB(store = new Map()) {
  const later = fn => setTimeout(fn, 0);
  const req = fn => {
    const r = {};
    later(() => {
      r.result = fn();
      if (r.onsuccess) r.onsuccess();
    });
    return r;
  };
  const conn = {
    createObjectStore: () => ({}),
    transaction: () => {
      const t = {
        objectStore: () => ({
          get: k => req(() => (store.has(k) ? structuredClone(store.get(k)) : undefined)),
          put: (v, k) => {
            store.set(k, structuredClone(v));
            later(() => t.oncomplete && t.oncomplete());
          },
        }),
      };
      return t;
    },
  };
  return {
    store,
    api: {
      open: () => {
        const r = { result: conn };
        later(() => {
          if (!store.size && r.onupgradeneeded) r.onupgradeneeded();
          r.onsuccess();
        });
        return r;
      },
    },
  };
}

/** The shim loaded as the page loads it. `net.down` makes every request fail as a dropped connection does. */
async function shim(env, idb, net = { down: false }) {
  const window = new EventTarget();
  const listeners = {};
  const events = [];
  for (const k of ['ev-sync', 'ev-note-kept']) window.addEventListener(k, e => events.push([k, e.detail]));
  const fetch = async (url, init = {}) => {
    if (net.down) throw new TypeError('Failed to fetch');
    return worker.fetch(new Request('https://ev.example' + url, init), env);
  };
  const document = {
    body: null,
    visibilityState: 'visible',
    addEventListener: () => {},
    querySelector: () => null,
    createElement: () => ({}),
  };
  new Function(
    'window',
    'document',
    'localStorage',
    'navigator',
    'fetch',
    'setInterval',
    'addEventListener',
    'indexedDB',
    BRIDGE
  )(
    window,
    document,
    { getItem: () => TOKEN, setItem: () => {} },
    {},
    fetch,
    () => 0,
    (name, fn) => (listeners[name] = fn),
    idb.api
  );
  const db = await window.claude.use('db');
  return {
    db,
    events,
    net,
    sync: () => [...events].reverse().find(e => e[0] === 'ev-sync')?.[1],
    kept: () => events.filter(e => e[0] === 'ev-note-kept').map(e => e[1]),
    /** back online: the 'online' event, then the outbox sent; resolves when the record has it. */
    online: async () => {
      net.down = false;
      listeners.online();
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 10));
        const s = [...events].reverse().find(e => e[0] === 'ev-sync')?.[1];
        if (s && s.online && !s.pending && !s.syncing) return;
      }
    },
    data: async (c, id) => (await db.collection(c).doc(id).get()).data(),
  };
}
const kept = () => new Promise(r => setTimeout(r, 400)); // the copy is written 300 ms after the last change

const AT = '2026-10-26T15:00:00.000Z';
const block = (type, text) => ({ type, runs: [{ text }] });
const note = (lines, at = AT, prev = null) =>
  N.noteDoc(prev, { blocks: lines.map(([t, x]) => block(t, x)), course: null, at, source: 'E.V. Home' });
const ID = 'n-20261026-150000-AbCdEfGhIjKlMnOp';
const BASE = note([
  ['h1', 'Sodium (Na+)'],
  ['ul', 'Normal range: 135-145 mEq/L'],
]);

test('B-404 (shim): the app boots from the copy on this device when there is no connection', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  await put(env, 'scratch', 'a', { x: 1 });
  const idb = fakeIDB();
  await shim(env, idb);
  await kept();
  assert.ok(idb.store.get('record'), 'a copy of the record is kept in IndexedDB');
  const off = await shim(env, idb, { down: true });
  assert.deepEqual(await off.data('notes', ID), BASE, 'the note reads offline');
  assert.deepEqual(await off.data('scratch', 'a'), { x: 1 }, 'so does the rest of the record');
  assert.equal(off.sync().online, false, 'the page is told it is offline');
  // with no copy and no connection, the boot fails as it did (no record to show)
  await assert.rejects(() => shim(env, fakeIDB(), { down: true }).then(s => s.db));
});

test('B-404 (shim): offline, a note saves on this device and the page shows it; any other write is refused with his words', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  const s = await shim(env, idb);
  s.net.down = true;
  const mine = note(
    [...BASE.blocks.map(b => [b.type, b.runs[0].text]), ['ul', 'Water follows sodium']],
    '2026-10-26T16:00:00.000Z',
    BASE
  );
  await s.db.collection('notes').doc(ID).set(mine); // resolves: saved on this device
  assert.deepEqual(await s.data('notes', ID), mine, 'the page reads his words at once');
  assert.equal(stored(env, 'notes', ID).v, 1, 'nothing reached the record');
  assert.equal(s.sync().online, false);
  assert.equal(s.sync().pending, 1, 'one note waits in the outbox');
  assert.deepEqual(Object.keys(idb.store.get('outbox')), ['notes\n' + ID], 'the outbox is in IndexedDB at once');
  const e = await s.db
    .collection('ideas')
    .doc('i1')
    .set({ text: 'an idea typed offline' })
    .then(
      () => null,
      x => x
    );
  assert.ok(e, 'a write other than a note is refused offline');
  assert.equal(e.code, 'unavailable');
  assert.match(e.message, /offline/);
  assert.deepEqual(e.unsaved, { text: 'an idea typed offline' }, 'with his words');
  assert.equal(await s.data('ideas', 'i1'), undefined);
});

test('B-404 (shim): an offline save survives a reload and is sent when the connection is back (read back from D1)', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  const s = await shim(env, idb);
  s.net.down = true;
  const mine = note(
    [
      ['h1', 'Sodium (Na+)'],
      ['ul', 'Water follows sodium'],
    ],
    '2026-10-26T16:00:00.000Z',
    BASE
  );
  await s.db.collection('notes').doc(ID).set(mine);
  const fresh = note(
    [
      ['h1', 'Potassium'],
      ['p', 'Written offline, a new note'],
    ],
    '2026-10-26T16:05:00.000Z'
  );
  const NEW = 'n-20261026-160500-ZyXwVuTsRqPoNmLk';
  await s.db.collection('notes').doc(NEW).set(fresh);
  await kept();
  // the reload, still offline: both notes come back from this device
  const r = await shim(env, idb, { down: true });
  assert.deepEqual(await r.data('notes', ID), mine);
  assert.deepEqual(await r.data('notes', NEW), fresh);
  assert.equal(r.sync().pending, 2);
  await r.online();
  assert.deepEqual(stored(env, 'notes', ID), { v: 2, data: mine }, 'the edit is in D1, one version on');
  assert.deepEqual(stored(env, 'notes', NEW), { v: 1, data: fresh }, 'the new note is in D1');
  assert.equal(r.sync().pending, 0);
  assert.deepEqual(idb.store.get('outbox'), {}, 'the outbox is empty');
  assert.equal(r.kept().length, 0, 'no conflict');
  // and the next save online goes straight to the record, pinned to the version just written
  const next = note(
    [
      ['h1', 'Sodium (Na+)'],
      ['ul', 'Water follows sodium'],
      ['ul', 'More'],
    ],
    '2026-10-26T16:10:00.000Z',
    BASE
  );
  await r.db.collection('notes').doc(ID).set(next);
  assert.deepEqual(stored(env, 'notes', ID), { v: 3, data: next });
});

test('B-404 (shim, D-326): two devices edit one note offline: 2 notes in the end, every word kept, nothing merged', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const laptop = await shim(env, fakeIDB());
  const phone = await shim(env, fakeIDB());
  laptop.net.down = phone.net.down = true;
  const onLaptop = note(
    [
      ['h1', 'Sodium (Na+)'],
      ['ul', 'Hyponatremia: headache, confusion'],
    ],
    '2026-10-26T15:42:00.000Z',
    BASE
  );
  const onPhone = note(
    [
      ['h1', 'Sodium (Na+)'],
      ['ul', 'Hypernatremia: thirst, dry mucous membranes'],
    ],
    '2026-10-26T16:05:00.000Z',
    BASE
  );
  await laptop.db.collection('notes').doc(ID).set(onLaptop);
  await phone.db.collection('notes').doc(ID).set(onPhone);
  await phone.online(); // the phone is back first: its version becomes the note
  assert.deepEqual(stored(env, 'notes', ID).data, onPhone);
  // the laptop types once more while its first save still waits in the outbox
  const more = note(
    [
      ['h1', 'Sodium (Na+)'],
      ['ul', 'Hyponatremia: headache, confusion'],
      ['ul', 'Seizures when severe'],
    ],
    '2026-10-26T15:50:00.000Z',
    BASE
  );
  await laptop.db.collection('notes').doc(ID).set(more);
  await laptop.online();
  const notes = allNotes(env);
  assert.equal(notes.length, 2, JSON.stringify(notes.map(n => n.title)));
  const orig = notes.find(n => n.id === ID);
  const earlier = notes.find(n => n.id !== ID);
  assert.deepEqual(stored(env, 'notes', ID).data, onPhone, 'the newer version stays the note, untouched');
  assert.equal(earlier.earlierOf, ID, 'the second note is linked to the original');
  assert.equal(earlier.title, 'Sodium (Na+) (earlier)');
  assert.match(earlier.id, /^n-\d{8}-\d{6}-[A-Za-z0-9]{16}$/);
  assert.equal(N.noteIdOk(earlier.id), true);
  assert.deepEqual(earlier.blocks, more.blocks, 'his newest words, the save made while the first waited included');
  const words = JSON.stringify(notes.map(n => n.blocks));
  for (const w of ['Hyponatremia', 'Seizures when severe', 'Hypernatremia', 'Sodium'])
    assert.ok(words.includes(w), w + ' is kept');
  // the page that wrote it is told, with both versions, and its copy holds both
  const [k] = laptop.kept();
  assert.equal(k.id, ID);
  assert.equal(k.earlierId, earlier.id);
  assert.deepEqual(k.current, onPhone);
  assert.deepEqual(k.earlier.blocks, more.blocks);
  assert.deepEqual(await laptop.data('notes', ID), onPhone);
  assert.equal((await laptop.data('notes', earlier.id)).earlierOf, ID);
  assert.equal(laptop.sync().pending, 0);
});

test('B-404 (shim): a stale note saved online is refused with the version that stays, and nothing is written', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const s = await shim(env, fakeIDB());
  const other = note(
    [
      ['h1', 'Sodium (Na+)'],
      ['p', 'from the other device'],
    ],
    '2026-10-26T15:30:00.000Z',
    BASE
  );
  await put(env, 'notes', ID, other, 1);
  const mine = note(
    [
      ['h1', 'Sodium (Na+)'],
      ['p', 'his words'],
    ],
    '2026-10-26T15:31:00.000Z',
    BASE
  );
  const e = await s.db
    .collection('notes')
    .doc(ID)
    .set(mine)
    .then(
      () => null,
      x => x
    );
  assert.ok(e && e.conflict);
  assert.deepEqual(e.unsaved, mine, 'his words come back to the page');
  assert.deepEqual(e.current, other, 'with the version that stays, for the picker');
  assert.deepEqual(stored(env, 'notes', ID), { v: 2, data: other });
});

test("B-404: the shim names the second note as core's noteEarlierTitle does", async () => {
  for (const [title, want] of [
    ['Sodium', 'Sodium (earlier)'],
    ['', 'Untitled (earlier)'],
    ['Sodium (earlier)', 'Sodium (earlier)'],
    ['x'.repeat(300), 'x'.repeat(290) + ' (earlier)'],
  ]) {
    assert.equal(N.noteEarlierTitle(title), want, title);
    const env = envOf();
    const blocks = title ? [block('h1', title.replace(/ \(earlier\)$/, ''))] : [block('p', 'no heading')];
    const base = N.noteDoc(null, { blocks, course: null, at: AT });
    await put(env, 'notes', ID, base);
    const s = await shim(env, fakeIDB());
    s.net.down = true;
    await s.db
      .collection('notes')
      .doc(ID)
      .set({ ...base, at: '2026-10-26T15:01:00.000Z' });
    await put(env, 'notes', ID, { ...base, at: '2026-10-26T15:02:00.000Z' }, 1);
    await s.online();
    const earlier = allNotes(env).find(n => n.id !== ID);
    assert.equal(earlier.title, N.noteEarlierTitle(base.title), title);
    assert.ok(earlier.title.length <= 300);
  }
  // a note edited as an earlier one keeps its '(earlier)' title through noteDoc
  const e = N.noteDoc({ createdAt: AT, earlierOf: ID }, { blocks: [block('h1', 'Sodium')], at: AT });
  assert.equal(e.title, 'Sodium (earlier)');
  assert.equal(e.earlierOf, ID);
});

test('B-404: sw.js caches the files the app boots from when it installs, and answers them offline', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'pwa/sw.js'), 'utf8');
  const boot = JSON.parse(
    src
      .match(/const BOOT = (\[[\s\S]*?\]);/)[1]
      .replace(/'/g, '"')
      .replace(/,\s*\]/, ']')
  );
  // every boot file is one the app serves: the built page's files and the shim's
  for (const f of ['bridge.js', 'app.js', 'core.js', 'spec.json', 'styles.css']) assert.ok(boot.includes(f), f);
  for (const f of SHIM.filter(f => f !== 'sw.js')) assert.ok(boot.includes(f), f);
  assert.ok(boot.includes('./'), 'the page itself');
  // run the worker over a fake cache and a fetch that is up, then down
  const handlers = {};
  const cache = new Map();
  const keyOf = r => (typeof r === 'string' ? new URL(r, 'https://ev.example/').href : r.url);
  const store = {
    add: async r => cache.set(keyOf(r), new Response('copy of ' + keyOf(r))),
    put: async (r, res) => cache.set(keyOf(r), res),
    match: async (r, o = {}) => {
      const k = keyOf(r);
      const hit = cache.get(k) || (o.ignoreSearch ? cache.get(k.split('?')[0]) : null);
      return hit ? hit.clone() : undefined;
    },
  };
  let up = true;
  const self = {
    addEventListener: (n, fn) => (handlers[n] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  new Function('self', 'caches', 'fetch', 'location', 'Request', 'Response', src)(
    self,
    { open: async () => store },
    async r => {
      if (!up) throw new TypeError('Failed to fetch');
      return new Response('fresh ' + r.url);
    },
    { origin: 'https://ev.example' },
    class extends Request {
      constructor(u, o) {
        super(new URL(u, 'https://ev.example/'), o);
      }
    },
    Response
  );
  let wait;
  handlers.install({ waitUntil: p => (wait = p) });
  await wait;
  for (const f of boot) assert.ok(cache.has(new URL(f, 'https://ev.example/').href), f + ' cached at install');
  up = false;
  const ask = async (url, mode = 'no-cors') => {
    let res;
    handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: p => (res = p) });
    return res && (await (await res).text());
  };
  assert.match(await ask('https://ev.example/app.js'), /app\.js/, 'app.js answers offline');
  assert.match(await ask('https://ev.example/spec.json?x=1'), /spec\.json/, 'a query string still finds it');
  assert.match(
    await ask('https://ev.example/index.html#notes', 'navigate'),
    /ev\.example\/$/,
    'the page opens offline'
  );
  let api = 'not asked';
  handlers.fetch({ request: { url: 'https://ev.example/api/db', method: 'GET' }, respondWith: () => (api = 'cached') });
  assert.equal(api, 'not asked', 'the record is never cached by the worker');
});
