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

/**
 * IndexedDB, as much of it as the shim asks: named stores, get, put, delete and a cursor, in transactions that run one
 * at a time, as a browser runs read-write transactions on one store. One device's IndexedDB: every tab (shim) given the
 * same fake shares it, and it survives a "reload". `locks` is the device's Web Locks, so a closed tab's lock is free.
 */
function fakeIDB() {
  const stores = new Map();
  const st = n => (stores.has(n) ? stores.get(n) : stores.set(n, new Map()).get(n));
  const later = fn => setTimeout(fn, 0);
  let turn = Promise.resolve();
  const conn = {
    objectStoreNames: { contains: n => stores.has(n) },
    createObjectStore: n => (st(n), {}),
    transaction: name => {
      const m = st(name);
      const t = {};
      let open = 0;
      let finish;
      const finished = new Promise(r => (finish = r));
      let before = null; // the store as the transaction found it: an aborted transaction leaves it so
      const ready = turn.then(() => (before = new Map(m)));
      turn = turn.then(() => finished);
      const settle = () =>
        later(() => {
          if (!open && !t.done) {
            t.done = true;
            finish();
            if (t.failed) {
              m.clear();
              for (const [k, v] of before) m.set(k, v);
              t.error = new Error('QuotaExceededError');
              if (t.onabort) t.onabort();
            } else if (t.oncomplete) t.oncomplete();
          }
        });
      const req = fn => {
        open++;
        const r = {};
        ready.then(() =>
          later(() => {
            r.result = fn();
            if (r.onsuccess) r.onsuccess();
            open--;
            settle();
          })
        );
        return r;
      };
      t.objectStore = () => ({
        get: k => req(() => (!fake.crashed && m.has(k) ? structuredClone(m.get(k)) : undefined)),
        put: (v, k) =>
          req(() => {
            if (fake.crashed) return;
            if (name === 'outbox' && fake.failOutbox) return void (t.failed = true);
            m.set(k, structuredClone(v));
            // the tab dies the moment an outbox write lands: nothing after it reaches IndexedDB
            if (name === 'outbox' && fake.crashOnPut) fake.crashed = true;
          }),
        delete: k => req(() => void (!fake.crashed && m.delete(k))),
        openCursor: () => {
          open++;
          const r = {};
          const keys = [...m.keys()];
          let i = 0;
          const step = () =>
            later(() => {
              if (i < keys.length) {
                const k = keys[i];
                r.result = { key: k, value: structuredClone(m.get(k)), continue: () => (i++, step()) };
                r.onsuccess();
              } else {
                r.result = null;
                r.onsuccess();
                open--;
                settle();
              }
            });
          ready.then(step);
          return r;
        },
      });
      ready.then(settle);
      return t;
    },
  };
  const held = new Set();
  const fake = {
    failOutbox: false, // true: every write to the outbox store fails
    crashOnPut: false, // true: the first outbox write that lands is the last thing that reaches IndexedDB
    crashed: false,
    stores,
    kv: k => st('kv').get(k),
    box: () => [...st('outbox').values()],
    held,
    api: {
      open: () => {
        const r = { result: conn };
        later(() => {
          if (r.onupgradeneeded) r.onupgradeneeded();
          r.onsuccess();
        });
        return r;
      },
    },
  };
  return fake;
}

/** The shim loaded as the page loads it. `net.down` makes every request fail as a dropped connection does. */
async function shim(env, idb, net = { down: false }, { status } = {}) {
  const window = new EventTarget();
  const mine = []; // the locks this tab holds, freed by close()
  const locks = {
    request: (name, fn) => {
      idb.held.add(name);
      mine.push(name);
      return fn();
    },
    query: async () => ({ held: [...idb.held].map(name => ({ name })) }),
  };
  const listeners = {};
  const events = [];
  for (const k of ['ev-sync', 'ev-note-kept']) window.addEventListener(k, e => events.push([k, e.detail]));
  const fetch = async (url, init = {}) => {
    if (net.down) throw new TypeError('Failed to fetch');
    // status(url, init) may answer in the Worker's place (a busy Worker, a lost answer)
    const instead = status && (await status(url, init));
    if (instead) return instead;
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
    { locks },
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
    /** the tab closed: its lock is free, so the next tab takes over its waiting notes */
    close: () => mine.forEach(n => idb.held.delete(n)),
    /** the app comes to the front: the shim reads the record again and sends what waits */
    focus: () => listeners.focus && listeners.focus(),
    /** the 'online' event alone, for a test that waits on its own condition */
    wake: () => {
      net.down = false;
      listeners.online();
    },
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
  assert.ok(idb.kv('record'), 'a copy of the record is kept in IndexedDB');
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
  assert.deepEqual(
    idb.box().map(o => o.c + '/' + o.id),
    ['notes/' + ID],
    'the outbox entry is in IndexedDB at once'
  );
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
  s.close();
  // the reload, still offline: both notes come back from this device
  const r = await shim(env, idb, { down: true });
  assert.deepEqual(await r.data('notes', ID), mine);
  assert.deepEqual(await r.data('notes', NEW), fresh);
  assert.equal(r.sync().pending, 2);
  await r.online();
  assert.deepEqual(stored(env, 'notes', ID), { v: 2, data: mine }, 'the edit is in D1, one version on');
  assert.deepEqual(stored(env, 'notes', NEW), { v: 1, data: fresh }, 'the new note is in D1');
  assert.equal(r.sync().pending, 0);
  await kept();
  assert.deepEqual(idb.box(), [], 'the outbox is empty');
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
      .set({ ...base, at: '2026-10-26T15:01:00.000Z', blocks: [...base.blocks, block('p', 'his line')] }); // words that differ
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

// ---- B-404 review: two tabs on one device, notes kept once, refusals that pass and ones that don't, a note at the cap

const until = async (test, ms = 4000) => {
  for (let t = Date.now(); Date.now() - t < ms; await new Promise(r => setTimeout(r, 20)))
    if (await test()) return true;
  return false;
};
const lines = (doc, ...more) => note([...doc.blocks.map(b => [b.type, b.runs[0].text]), ...more], undefined, doc);
const ID2 = 'n-20261026-150500-QrStUvWxYzAbCdEf';
const textOfAll = env => JSON.stringify(allNotes(env).map(n => n.blocks));

test('B-404 review (shim): two tabs on one device each save offline; both saves survive, in the outbox and the copy', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  const t1 = await shim(env, idb);
  const t2 = await shim(env, idb);
  t1.net.down = t2.net.down = true;
  const a = lines(BASE, ['ul', 'Tab one: hyponatremia']);
  const b = note(
    [
      ['h1', 'Potassium'],
      ['p', 'Tab two: a new note'],
    ],
    '2026-10-26T15:06:00.000Z'
  );
  await Promise.all([t1.db.collection('notes').doc(ID).set(a), t2.db.collection('notes').doc(ID2).set(b)]);
  await kept();
  assert.equal(idb.box().length, 2, 'one outbox entry each: neither tab wrote over the other');
  // the copy is merged: it holds both tabs' notes
  assert.deepEqual(idb.kv('record').db.notes[ID], a);
  assert.deepEqual(idb.kv('record').db.notes[ID2], b);
  t1.close();
  t2.close();
  const t3 = await shim(env, idb, { down: true });
  assert.deepEqual(await t3.data('notes', ID), a, 'tab one’s words after a reload with no connection');
  assert.deepEqual(await t3.data('notes', ID2), b, 'tab two’s too');
  await t3.online();
  assert.deepEqual(stored(env, 'notes', ID).data, a);
  assert.deepEqual(stored(env, 'notes', ID2).data, b);
  await kept();
  assert.deepEqual(idb.box(), []);
});

test('B-404 review (shim): two tabs edit one note offline on one device: every word kept, as two notes', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  const t1 = await shim(env, idb);
  const t2 = await shim(env, idb);
  t1.net.down = t2.net.down = true;
  await t1.db
    .collection('notes')
    .doc(ID)
    .set(lines(BASE, ['ul', 'Tab one words']));
  await t2.db
    .collection('notes')
    .doc(ID)
    .set(lines(BASE, ['ul', 'Tab two words']));
  t1.close();
  t2.close();
  const t3 = await shim(env, idb);
  await t3.online();
  const all = textOfAll(env);
  assert.ok(all.includes('Tab one words') && all.includes('Tab two words'), all);
  assert.equal(allNotes(env).length, 2);
  assert.equal(allNotes(env).filter(n => n.earlierOf === ID).length, 1);
});

test('B-404 review (shim): one closed tab’s note sent by two tabs at once lands once, with no second note', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  const t1 = await shim(env, idb);
  t1.net.down = true;
  const a = lines(BASE, ['ul', 'Written in a tab since closed']);
  await t1.db.collection('notes').doc(ID).set(a);
  await kept();
  t1.close();
  const t2 = await shim(env, idb, { down: true });
  const t3 = await shim(env, idb, { down: true });
  t2.wake();
  t3.wake();
  await until(() => idb.box().length === 0 && t2.sync().pending === 0 && t3.sync().pending === 0);
  assert.deepEqual(stored(env, 'notes', ID).data, a);
  assert.equal(allNotes(env).length, 1, 'the same words are never kept twice: ' + textOfAll(env));
  assert.equal(t2.kept().length + t3.kept().length, 0);
});

test('B-404 review (shim): a save that landed with its answer lost is not kept a second time', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  let lose = true;
  const idb = fakeIDB();
  const net = { down: false };
  const s = await shim(env, idb, net, {
    status: async (url, init) => {
      if (init.method !== 'PUT' || !lose) return null;
      lose = false;
      await worker.fetch(new Request('https://ev.example' + url, init), env); // it lands...
      throw new TypeError('Failed to fetch'); // ...and the answer never comes back
    },
  });
  net.down = true;
  const a = lines(BASE, ['ul', 'Sent as the connection dropped']);
  await s.db.collection('notes').doc(ID).set(a);
  await s.online(); // the first send lands, its answer is lost: the shim thinks it is offline
  await s.online(); // the next send is stale (409), and the record already holds these words
  assert.deepEqual(stored(env, 'notes', ID), { v: 2, data: a });
  assert.equal(allNotes(env).length, 1, textOfAll(env));
  assert.equal(s.kept().length, 0);
  assert.equal(s.sync().pending, 0);
});

test('B-404 review (shim): a busy Worker (503, 429) is tried again after a pause; the note lands', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  let busy = 1;
  const net = { down: false };
  const s = await shim(env, fakeIDB(), net, {
    status: async (url, init) => (init.method === 'PUT' && busy-- > 0 ? new Response('busy', { status: 503 }) : null),
  });
  net.down = true;
  const a = lines(BASE, ['ul', 'Saved while the Worker was busy']);
  await s.db.collection('notes').doc(ID).set(a);
  s.wake();
  assert.ok(await until(() => stored(env, 'notes', ID).v === 2, 5000), 'tried again after its pause');
  assert.deepEqual(stored(env, 'notes', ID).data, a);
  assert.ok(await until(() => s.sync().pending === 0 && !s.sync().syncing));
  assert.deepEqual(s.sync().refused, []);
});

test('B-404 review (shim): a note the record refuses for good is kept, named to the page, and left out of syncing', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  const s = await shim(env, idb);
  s.net.down = true;
  // past the Worker's cap (written by a page with no headroom check): it can never be sent as it is
  const huge = lines(BASE, ['p', 'y'.repeat(20000)], ...Array.from({ length: 14 }, () => ['p', 'z'.repeat(19000)]));
  assert.ok(Buffer.byteLength(JSON.stringify(huge)) > 262144);
  await s.db.collection('notes').doc(ID).set(huge);
  s.wake();
  assert.ok(await until(() => (s.sync().refused || []).length === 1 && !s.sync().syncing));
  const sy = s.sync();
  assert.equal(sy.refused[0].id, ID);
  assert.match(sy.refused[0].why, /^4\d\d /);
  assert.equal(sy.pending, 0, 'not counted as waiting to sync');
  assert.deepEqual(await s.data('notes', ID), huge, 'his words stay on this device');
  await kept();
  assert.equal(idb.box().length, 1, 'and in IndexedDB');
  assert.equal(stored(env, 'notes', ID).v, 1, 'nothing written');
  // cut down (D-332) and saved again, it is a new try, and it lands
  const cut = lines(BASE, ['p', 'cut down']);
  await s.db.collection('notes').doc(ID).set(cut);
  assert.ok(await until(() => stored(env, 'notes', ID).v === 2));
  assert.deepEqual(stored(env, 'notes', ID).data, cut);
  assert.ok(await until(() => s.sync().refused.length === 0));
});

test('B-404 review (shim): a note at the page’s size limit colliding offline still becomes its second note whole', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const s = await shim(env, fakeIDB());
  s.net.down = true;
  // as large as the page saves (spec cap less its 256-byte headroom, 25-notes.js NOTE_ROOM)
  const limit = 262144 - 256;
  const fill = Array.from({ length: 14 }, () => 'x'.repeat(19000));
  const sized = () => Buffer.byteLength(JSON.stringify(lines(BASE, ...fill.map(t => ['p', t]))));
  fill[13] = 'x'.repeat(fill[13].length + (limit - sized())); // measured, then the last line made up to the limit
  const his = lines(BASE, ...fill.map(t => ['p', t]));
  const size = Buffer.byteLength(JSON.stringify(his));
  assert.ok(size <= limit && size > limit - 64, String(size));
  await s.db.collection('notes').doc(ID).set(his);
  await put(env, 'notes', ID, lines(BASE, ['ul', 'from the other device']), 1);
  await s.online();
  const earlier = allNotes(env).find(n => n.earlierOf === ID);
  assert.ok(earlier, 'the second note was accepted by the Worker');
  assert.deepEqual(earlier.blocks, his.blocks, 'whole');
  assert.ok(Buffer.byteLength(JSON.stringify(earlier)) <= 262144);
  assert.deepEqual(s.sync().refused, []);
});

test('B-404 review: the page keeps the headroom under the cap that a second note needs', () => {
  const part = fs.readFileSync(path.join(ROOT, 'page/app/25-notes.js'), 'utf8');
  assert.match(part, /const NOTE_ROOM = 256;/);
  assert.match(part, /if \(bytes <= NOTE_BYTES - NOTE_ROOM\) return '';/);
  // what a second note adds: ' (earlier)' on the title and an earlierOf of the longest id the schema allows
  const added = Buffer.byteLength(',"earlierOf":""') + 120 + ' (earlier)'.length;
  assert.ok(added < 256, String(added));
});

// ---- B-410: refused and adopted entries across a reload, one second note per closed tab's entry, the backoff

const HUGE = () => lines(BASE, ['p', 'y'.repeat(20000)], ...Array.from({ length: 14 }, () => ['p', 'z'.repeat(19000)]));
/** A tab that saved a note the record refuses (too large), then closed: its refused entry waits in IndexedDB. */
async function refusedThenClosed(env, idb) {
  const s = await shim(env, idb);
  s.net.down = true;
  await s.db.collection('notes').doc(ID).set(HUGE());
  s.wake();
  assert.ok(await until(() => (s.sync().refused || []).length === 1 && !s.sync().syncing));
  await kept();
  s.close();
}

test('B-410 (shim): a refused note after a reload, cut down and saved: the refusal clears and stays cleared', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  await refusedThenClosed(env, idb);
  const r = await shim(env, idb);
  assert.ok(await until(() => r.sync() && !r.sync().syncing));
  assert.deepEqual(
    r.sync().refused.map(x => x.id),
    [ID],
    'the reload still names the refusal'
  );
  assert.deepEqual(await r.data('notes', ID), HUGE(), 'and shows his words');
  const cut = lines(BASE, ['p', 'cut down']);
  await r.db.collection('notes').doc(ID).set(cut);
  assert.ok(await until(() => stored(env, 'notes', ID).v === 2));
  assert.deepEqual(stored(env, 'notes', ID).data, cut);
  assert.ok(await until(() => r.sync().refused.length === 0), 'the refusal is cleared');
  await kept();
  assert.deepEqual(idb.box(), [], 'nothing left waiting in IndexedDB');
  r.close();
  const r2 = await shim(env, idb);
  assert.deepEqual(await r2.data('notes', ID), cut, 'a second reload shows what was saved');
  assert.deepEqual(r2.sync().refused, []);
  // and a later save from another device reaches this device (nothing hides the note any more)
  const other = lines(cut, ['ul', 'from the other device']);
  await put(env, 'notes', ID, other, 2);
  r2.close();
  const r3 = await shim(env, idb);
  assert.deepEqual(await r3.data('notes', ID), other);
});

test('B-410 (shim): refused, reload, another device wrote: the note is theirs, his refused words are their own note, still refused', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  await refusedThenClosed(env, idb);
  const other = lines(BASE, ['ul', 'from the other device']);
  await put(env, 'notes', ID, other, 1);
  const r = await shim(env, idb);
  assert.ok(await until(() => r.sync() && !r.sync().syncing));
  assert.deepEqual(await r.data('notes', ID), other, 'the newer version is the note');
  // the second note comes once its claim lands in IndexedDB, a moment after the boot
  assert.ok(await until(() => r.sync().refused.some(x => x.id !== ID)), 'the refusal now names the second note');
  const [ref] = r.sync().refused;
  const kept1 = await r.data('notes', ref.id);
  assert.equal(kept1.earlierOf, ID);
  assert.deepEqual(kept1.blocks, HUGE().blocks, 'his refused words, whole');
  await kept();
  assert.deepEqual(
    idb.box().map(o => [o.id, !!o.refused]),
    [[ref.id, true]],
    'only the second note waits in IndexedDB, still refused'
  );
  // he opens the second note, cuts it and saves it: it lands as a note of its own, and the refusal clears
  const cut = N.noteDoc(kept1, { blocks: [block('h1', 'Sodium (Na+)'), block('p', 'cut down')], at: AT });
  await r.db.collection('notes').doc(ref.id).set(cut);
  assert.ok(await until(() => !!stored(env, 'notes', ref.id) && r.sync().refused.length === 0 && !r.sync().syncing));
  assert.deepEqual(stored(env, 'notes', ID).data, other, 'the other device’s words untouched');
  assert.equal(stored(env, 'notes', ref.id).data.earlierOf, ID);
  await kept();
  assert.deepEqual(idb.box(), []);
});

test('B-410 (shim): two tabs take over one closed tab’s note over a changed record: one second note, every word kept', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  const t1 = await shim(env, idb);
  t1.net.down = true;
  await t1.db
    .collection('notes')
    .doc(ID)
    .set(lines(BASE, ['ul', 'Written in a tab since closed']));
  await kept();
  t1.close();
  await put(env, 'notes', ID, lines(BASE, ['ul', 'from the other device']), 1);
  const t2 = await shim(env, idb, { down: true });
  const t3 = await shim(env, idb, { down: true });
  t2.wake();
  t3.wake();
  assert.ok(await until(() => idb.box().length === 0 && t2.sync().pending === 0 && t3.sync().pending === 0));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(allNotes(env).filter(n => n.earlierOf === ID).length, 1, textOfAll(env));
  assert.equal(allNotes(env).length, 2);
  const all = textOfAll(env);
  assert.ok(all.includes('Written in a tab since closed') && all.includes('from the other device'), all);
  assert.equal(t2.kept().length + t3.kept().length, 1, 'one tab made it, and told its page');
});

test('B-410 (shim): with no Web Locks (both tabs take every entry), a stale note still makes one second note', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  const t1 = await shim(env, idb);
  const t2 = await shim(env, idb);
  idb.held.clear(); // every tab looks closed: each takes the other's entries, as with no Web Locks
  t1.net.down = t2.net.down = true;
  await t1.db
    .collection('notes')
    .doc(ID)
    .set(lines(BASE, ['ul', 'tab one']));
  await kept();
  await put(env, 'notes', ID, lines(BASE, ['ul', 'other device']), 1);
  t1.wake();
  t2.wake();
  assert.ok(await until(() => idb.box().length === 0 && t1.sync().pending === 0 && t2.sync().pending === 0));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(allNotes(env).filter(n => n.earlierOf === ID).length, 1, textOfAll(env));
  assert.ok(textOfAll(env).includes('tab one') && textOfAll(env).includes('other device'));
});

test('B-410 (shim): during a busy Worker’s pause, reading the record again sends nothing', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  let puts = 0;
  let busy = 1;
  const net = { down: false };
  const s = await shim(env, fakeIDB(), net, {
    status: async (url, init) => {
      if (init.method !== 'PUT') return null;
      puts++;
      return busy-- > 0 ? new Response('busy', { status: 503 }) : null;
    },
  });
  net.down = true;
  await s.db
    .collection('notes')
    .doc(ID)
    .set(lines(BASE, ['ul', 'Saved while the Worker was busy']));
  s.wake();
  assert.ok(await until(() => puts === 1 && !s.sync().syncing));
  for (let i = 0; i < 5; i++) {
    s.focus(); // the 10-second refresh, a focus, a save: each would send at once without the pause
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(puts, 1, 'nothing sent before the pause runs out');
  assert.ok(await until(() => stored(env, 'notes', ID).v === 2, 5000), 'then it lands');
  assert.equal(puts, 2);
});

// ---- B-410 review: the refused edge in a live tab and after a reload, a late refusal, an entry IndexedDB never held

/** Refused in a live tab or a reloaded one, then another device writes, he sees it and edits it. */
async function refusedThenOtherWrites(reload) {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  let s;
  if (reload) {
    await refusedThenClosed(env, idb);
    s = await shim(env, idb);
    assert.ok(await until(() => s.sync() && !s.sync().syncing));
  } else {
    s = await shim(env, idb);
    s.net.down = true;
    await s.db.collection('notes').doc(ID).set(HUGE());
    s.wake();
    assert.ok(await until(() => (s.sync().refused || []).length === 1 && !s.sync().syncing));
  }
  const other = lines(BASE, ['ul', 'from the other device']);
  await put(env, 'notes', ID, other, 1);
  s.focus();
  assert.ok(
    await until(async () => JSON.stringify((await s.data('notes', ID)).blocks) === JSON.stringify(other.blocks))
  );
  const edit = lines(other, ['p', 'his edit on the shown note']);
  await s.db.collection('notes').doc(ID).set(edit);
  assert.ok(await until(() => stored(env, 'notes', ID).v === 3 && !s.sync().syncing));
  await kept();
  assert.deepEqual(stored(env, 'notes', ID).data, edit, 'his edit lands in place, from the version he saw');
  assert.equal(
    allNotes(env).length,
    1,
    'no second note made from that edit: ' + JSON.stringify(allNotes(env).map(n => n.title))
  );
  const [ref] = s.sync().refused;
  assert.ok(ref && ref.id !== ID);
  const second = await s.data('notes', ref.id);
  assert.equal(second.earlierOf, ID);
  assert.equal(second.title, 'Sodium (Na+) (earlier)');
  assert.deepEqual(second.blocks, HUGE().blocks, 'his refused words have a home: a second note, still refused');
  assert.deepEqual(
    idb.box().map(o => [o.id, !!o.refused]),
    [[ref.id, true]]
  );
}
test('B-410 review (shim): refused in a live tab, another device writes, he edits: in place, refused words kept apart', () =>
  refusedThenOtherWrites(false));
test('B-410 review (shim): the same after a reload (a refused entry taken over from the closed tab)', () =>
  refusedThenOtherWrites(true));

test('B-410 review (shim): a refusal that comes back after he saved a cut marks nothing; the cut lands', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  let hold = null;
  let first = true;
  const s = await shim(
    env,
    idb,
    { down: false },
    {
      status: async (url, init) => {
        if (init.method === 'PUT' && first) {
          first = false;
          await new Promise(r => (hold = r)); // the big send is out; its answer (400) comes after the cut is saved
        }
        return null;
      },
    }
  );
  s.net.down = true;
  await s.db.collection('notes').doc(ID).set(HUGE());
  s.wake();
  assert.ok(await until(() => !!hold));
  const cut = lines(BASE, ['p', 'cut while the big one was out']);
  await s.db.collection('notes').doc(ID).set(cut);
  hold();
  assert.ok(await until(() => stored(env, 'notes', ID).v === 2 && !s.sync().syncing));
  assert.deepEqual(stored(env, 'notes', ID).data, cut, 'the cut goes in the same replay');
  assert.deepEqual(s.sync().refused, [], 'the late refusal marks nothing');
  await kept();
  assert.deepEqual(idb.box(), [], 'and writes nothing to IndexedDB');
  assert.deepEqual(await s.data('notes', ID), cut);
});

test('B-410 review (shim): a note IndexedDB could not hold still makes its second note when it is stale', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  const s = await shim(env, idb);
  s.net.down = true;
  idb.failOutbox = true; // a full disk, or a private window: the outbox entry lives in this tab only
  const mine = lines(BASE, ['ul', 'kept only in this tab']);
  await s.db.collection('notes').doc(ID).set(mine);
  await put(env, 'notes', ID, lines(BASE, ['ul', 'from the other device']), 1);
  await s.online();
  const earlier = allNotes(env).find(n => n.earlierOf === ID);
  assert.ok(earlier, 'the claim holds for an entry no other tab could see');
  assert.deepEqual(earlier.blocks, mine.blocks);
  assert.ok(textOfAll(env).includes('from the other device'));
});

test('B-411 review (shim): a session’s filing mark is laid under: a different mark already there wins, the same one passes', async () => {
  const env = envOf();
  const SID = 'ss-20261026-150000-mark';
  await put(env, 'sessions', SID, { status: 'ending', topic: 'Potassium' });
  const a = await shim(env, fakeIDB());
  const b = await shim(env, fakeIDB()); // a second view, booted before the first one's mark
  const markA = { at: '2026-10-26T15:10:00.000Z', wrap: { summary: 'A' } };
  const markB = { at: '2026-10-26T15:10:01.000Z', wrap: { summary: 'B' } };
  await a.db.collection('sessions').doc(SID).update({ filing: markA });
  const e = await b.db
    .collection('sessions')
    .doc(SID)
    .update({ filing: markB })
    .then(
      () => null,
      x => x
    );
  assert.ok(e && e.conflict, 'the second view’s different mark is refused as a conflict');
  assert.deepEqual(stored(env, 'sessions', SID).data.filing, markA, 'the first mark stays in the record');
  await b.db.collection('sessions').doc(SID).update({ filing: markA }); // the same mark passes
  await a.db.collection('sessions').doc(SID).update({ filing: null }); // an Undo voids it
  assert.equal(stored(env, 'sessions', SID).data.filing, null);
});

// ---- B-410: moveRefused claims its entry in one transaction: one second note, and never lost

const ID3 = 'n-20261026-151000-WaItInGnOtEtHrEe';
/** A tab that saved a refused note, then closed; another device has since written the note (v2). */
async function refusedPassedAndClosed(env, idb, more) {
  await refusedThenClosed(env, idb);
  if (more) await more();
  await put(env, 'notes', ID, lines(BASE, ['ul', 'from the other device']), 1);
}
const refusedSeconds = idb => idb.box().filter(o => o.refused && o.doc.earlierOf === ID);

test('B-410 (shim): a reload that takes the refused entry over twice (boot, then the send) makes one second note', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  // another note waits too, so the reload sends, and takes entries over a second time
  await refusedPassedAndClosed(env, idb, async () => {
    const s = await shim(env, idb, { down: true });
    await s.db
      .collection('notes')
      .doc(ID3)
      .set(
        note([
          ['h1', 'Potassium'],
          ['p', 'waiting'],
        ])
      );
    await kept();
    s.close();
  });
  const r = await shim(env, idb);
  assert.ok(await until(() => r.sync() && !r.sync().syncing && r.sync().pending === 0 && r.sync().refused.length));
  await kept();
  assert.equal(r.sync().refused.length, 1, JSON.stringify(r.sync().refused));
  assert.equal(idb.box().length, 1, JSON.stringify(idb.box().map(o => [o.id, !!o.refused])));
  assert.equal(refusedSeconds(idb).length, 1);
  assert.ok(stored(env, 'notes', ID3), 'the other waiting note was sent');
});

test('B-410 (shim): two tabs opening at once over a passed refused entry make one second note', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  await refusedPassedAndClosed(env, idb);
  const [t2, t3] = await Promise.all([shim(env, idb), shim(env, idb)]);
  assert.ok(await until(() => t2.sync().refused.length + t3.sync().refused.length === 1));
  await kept();
  assert.equal(idb.box().length, 1, JSON.stringify(idb.box().map(o => [o.id, o.tab, !!o.refused])));
  assert.equal(refusedSeconds(idb).length, 1);
  assert.deepEqual(refusedSeconds(idb)[0].doc.blocks, HUGE().blocks, 'his words, whole');
});

test('B-410 (shim): when IndexedDB can’t write, the refused words are not lost: a reload still has them', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  await refusedPassedAndClosed(env, idb);
  idb.failOutbox = true; // the claim's transaction fails: nothing in IndexedDB changes
  const r = await shim(env, idb);
  assert.ok(await until(() => r.sync().refused.some(x => x.id !== ID)), 'this tab shows them as a second note');
  await kept();
  assert.ok(
    idb.box().some(o => o.refused && JSON.stringify(o.doc.blocks) === JSON.stringify(HUGE().blocks)),
    'and IndexedDB still holds them'
  );
  r.close();
  idb.failOutbox = false;
  const r2 = await shim(env, idb);
  assert.ok(await until(() => r2.sync().refused.length === 1));
  await kept();
  const [ref] = r2.sync().refused;
  assert.deepEqual((await r2.data('notes', ref.id)).blocks, HUGE().blocks, 'after the reload, his words are there');
  assert.equal(refusedSeconds(idb).length, 1, 'once');
});

test('B-410 (shim): a failed claim is never moved again by a later replay, in IndexedDB trouble or after it', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  await refusedPassedAndClosed(env, idb);
  idb.failOutbox = true; // the claim fails: IndexedDB keeps the old entry
  const r = await shim(env, idb);
  assert.ok(await until(() => r.sync() && r.sync().refused.some(x => x.id !== ID)));
  await kept();
  // another note waits (saved offline), so each wake replays, and a replay takes closed tabs' entries over again
  r.net.down = true;
  await r.db
    .collection('notes')
    .doc(ID3)
    .set(
      note([
        ['h1', 'Potassium'],
        ['p', 'waiting'],
      ])
    );
  r.wake();
  await kept();
  r.focus();
  await kept();
  idb.failOutbox = false;
  r.focus();
  await kept();
  assert.equal(r.sync().refused.filter(x => x.id !== ID).length, 1, JSON.stringify(r.sync().refused));
  r.close();
});

test('B-410 (shim): a tab that dies right after moving refused words leaves one second note, never two', async () => {
  const env = envOf();
  await put(env, 'notes', ID, BASE);
  const idb = fakeIDB();
  await refusedPassedAndClosed(env, idb);
  idb.crashOnPut = true; // the tab dies as soon as its first outbox write lands
  const r = await shim(env, idb);
  assert.ok(await until(() => idb.crashed));
  await kept();
  r.close();
  idb.crashed = idb.crashOnPut = false; // a fresh start of the app on the same device
  // the move was one transaction: IndexedDB holds the second note and not the old entry, never both
  assert.equal(idb.box().length, 1, JSON.stringify(idb.box().map(o => [o.id, !!o.refused])));
  const r2 = await shim(env, idb);
  assert.ok(await until(() => r2.sync() && !r2.sync().syncing && r2.sync().refused.length));
  await kept();
  assert.equal(r2.sync().refused.length, 1, JSON.stringify(r2.sync().refused));
  assert.equal(refusedSeconds(idb).length, 1);
  assert.deepEqual(refusedSeconds(idb)[0].doc.blocks, HUGE().blocks);
});
