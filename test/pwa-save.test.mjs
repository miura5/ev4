// B-389: the page's save (PUT /api/db/<c>/<id>) carries the version it read, as the run API's if_version, and the
// Worker's token is compared in constant time. The Worker runs here over an in-memory SQLite standing in for D1 (the
// same SQL, through the few D1 calls the Worker makes); the suite against wrangler dev and the staging Worker is
// pwa/run-api.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../pwa/worker.js';
import { sameBytes, tokenOk, ifVersionOf } from '../pwa/guard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'save-suite-token-not-a-secret';

/** D1's prepare/bind/first/all/run/batch over node:sqlite, with the app's schema. */
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
const call = async (env, method, route, body, token = TOKEN) => {
  const r = await worker.fetch(
    new Request('https://ev.example' + route, {
      method,
      headers: { ...(token != null ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }),
    env
  );
  return { status: r.status, body: await r.json() };
};
const put = (env, c, id, doc, v) => call(env, 'PUT', `/api/db/${c}/${id}` + (v != null ? '?if_version=' + v : ''), doc);
const row = (env, c, id) => {
  const r = env.DB.sql.prepare('SELECT data, v FROM docs WHERE c = ? AND id = ?').get(c, id);
  return r && { ...r };
};

test('B-389: a create with no version still works, at version 1', async () => {
  const env = envOf();
  const r = await put(env, 'notes', 'n1', { a: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.version, 1);
  assert.deepEqual(JSON.parse(row(env, 'notes', 'n1').data), { a: 1 });
});

test('B-389: a fresh save (the version it read) is accepted, one version more', async () => {
  const env = envOf();
  await put(env, 'notes', 'n1', { a: 1 });
  const r = await put(env, 'notes', 'n1', { a: 2 }, 1);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.version, 2);
  const again = await put(env, 'notes', 'n1', { a: 3 }, 2);
  assert.equal(again.body.version, 3);
  assert.deepEqual(row(env, 'notes', 'n1'), { data: '{"a":3}', v: 3 });
  // the page's read carries each document's version, which its next save sends
  const read = await call(env, 'GET', '/api/db?since=0');
  assert.deepEqual(
    read.body.docs.map(d => [d.c, d.id, d.v, d.data]),
    [['notes', 'n1', 3, { a: 3 }]]
  );
});

test('B-389: a stale save is refused with 409 and the current version, and writes nothing', async () => {
  const env = envOf();
  await put(env, 'notes', 'n1', { a: 1 });
  await put(env, 'notes', 'n1', { a: 2, other: 'device' }, 1); // another device saved since: now version 2
  const r = await put(env, 'notes', 'n1', { a: 'stale' }, 1);
  assert.equal(r.status, 409);
  assert.equal(r.body.current_version, 2);
  assert.equal(r.body.if_version, 1);
  assert.deepEqual([r.body.collection, r.body.doc_id], ['notes', 'n1']);
  assert.match(r.body.error, /nothing was written/);
  assert.deepEqual(row(env, 'notes', 'n1'), { data: '{"a":2,"other":"device"}', v: 2 }, 'unchanged');
});

test('B-389: a save with no version to a document that exists, or one pinned to a missing document, is refused', async () => {
  const env = envOf();
  await put(env, 'notes', 'n1', { a: 1 });
  const bare = await put(env, 'notes', 'n1', { a: 'blind' });
  assert.equal(bare.status, 409, 'a create over a document that exists is a conflict, as in the run API');
  assert.equal(bare.body.current_version, 1);
  assert.deepEqual(row(env, 'notes', 'n1'), { data: '{"a":1}', v: 1 });
  const ghost = await put(env, 'notes', 'n2', { a: 1 }, 3);
  assert.equal(ghost.status, 409);
  assert.equal(ghost.body.current_version, null);
  assert.equal(row(env, 'notes', 'n2'), undefined, 'not created');
});

test('B-389: a bad version or a body that is not JSON is refused with 400; a run pinned to the old version after a page save is refused', async () => {
  const env = envOf();
  for (const v of ['0', '-1', '1.5', 'x', '01'])
    assert.equal((await put(env, 'notes', 'n1', { a: 1 }, v)).status, 400, v);
  assert.equal((await call(env, 'PUT', '/api/db/notes/n1', '{not json')).status, 400);
  assert.equal(row(env, 'notes', 'n1'), undefined);
  await put(env, 'notes', 'n1', { a: 1 });
  await put(env, 'notes', 'n1', { a: 2 }, 1);
  const r = await call(env, 'POST', '/api/run/batch', {
    writes: [{ op: 'update', collection: 'notes', doc_id: 'n1', if_version: 1, data: { run: true } }],
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.current_version, 2);
});

test('B-389: ifVersionOf reads ?if_version as a whole number from 1', () => {
  const v = q => ifVersionOf(new URL('https://ev.example/api/db/a/b' + q));
  assert.equal(v(''), null);
  assert.equal(v('?if_version='), null);
  assert.equal(v('?if_version=7'), 7);
  for (const bad of ['0', '-2', '2.0', '1e3', 'abc', ' 3'])
    assert.equal(v('?if_version=' + encodeURIComponent(bad)), undefined);
});

test('B-389: the token check is timing-safe: hashed to equal lengths, then a constant-time compare', async () => {
  // the platform's compare is used where the runtime has one (Cloudflare's crypto.subtle.timingSafeEqual)
  const calls = [];
  const subtle = {
    timingSafeEqual: (a, b) => {
      calls.push([a.byteLength, b.byteLength]);
      return a.every((x, i) => x === b[i]);
    },
  };
  assert.equal(await tokenOk('Bearer ' + TOKEN, TOKEN, subtle), true);
  assert.equal(await tokenOk('Bearer x', TOKEN, subtle), false);
  assert.equal(await tokenOk('Bearer ' + TOKEN + 'x'.repeat(500), TOKEN, subtle), false);
  assert.deepEqual(
    calls,
    [
      [32, 32],
      [32, 32],
      [32, 32],
    ],
    'every compare runs over two SHA-256 digests, whatever the lengths sent'
  );
  // with no platform compare, the XOR loop: right answers, and it reads every byte (no early exit)
  const noSubtle = {};
  assert.equal(await tokenOk('Bearer ' + TOKEN, TOKEN, noSubtle), true);
  assert.equal(await tokenOk('Bearer ' + TOKEN.slice(0, -1) + 'X', TOKEN, noSubtle), false);
  assert.equal(await tokenOk(null, TOKEN, noSubtle), false);
  assert.equal(await tokenOk('Bearer ', '', noSubtle), false, 'no token set: nothing opens');
  let reads = 0;
  const spy = n =>
    new Proxy(new Uint8Array(n), {
      get: (t, k) => {
        if (typeof k === 'string' && /^\d+$/.test(k)) reads++;
        const v = Reflect.get(t, k);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  const a = spy(32);
  const b = new Uint8Array(32);
  b[0] = 1; // differs at the first byte
  assert.equal(sameBytes(a, b, noSubtle), false);
  assert.equal(reads, 32, 'a mismatch at the first byte still reads all 32');
  assert.equal(sameBytes(new Uint8Array(3), new Uint8Array(4), noSubtle), false);
  // the Worker uses it: no plain comparison of the header against the token is left
  const src = fs.readFileSync(path.join(ROOT, 'pwa/worker.js'), 'utf8');
  assert.match(src, /await tokenOk\(request\.headers\.get\('authorization'\), env\.EV_TOKEN\)/);
  assert.doesNotMatch(src, /[!=]==?\s*'Bearer '/);
  const env = envOf();
  assert.equal((await call(env, 'GET', '/api/db', undefined, null)).status, 401);
  assert.equal((await call(env, 'GET', '/api/db', undefined, TOKEN + 'x')).status, 401);
  assert.equal((await call(env, 'GET', '/api/db', undefined, TOKEN)).status, 200);
  assert.equal((await call({ ...env, EV_TOKEN: '' }, 'GET', '/api/db', undefined, '')).status, 401);
});

/** The shim (pwa/bridge.js) loaded as the page loads it, over a fake browser whose fetch is the Worker above (over
 * its in-memory D1). `puts` logs each PUT the shim sends (route, status, how many of that document's saves were in
 * flight); `stale` hands the next read an answer given before; `focus()` makes the shim read the record again;
 * `beforePut(fn)` runs fn(route, n) before the n-th PUT (from 0) leaves, to land another writer or fail the network. */
async function shim(env) {
  const src = fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8');
  const window = {};
  const listeners = {};
  const puts = [];
  const inFlight = {};
  let stale = null;
  let beforePut = null;
  const fetch = async (url, init = {}) => {
    if (stale && /^\/api\/db\?since=/.test(url)) {
      const body = stale;
      stale = null;
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }
    const put = init.method === 'PUT';
    const key = put && url.split('?')[0];
    if (put && beforePut) await beforePut(url, puts.length);
    if (put) inFlight[key] = (inFlight[key] || 0) + 1;
    const r = await worker.fetch(new Request('https://ev.example' + url, init), env);
    if (put) puts.push({ route: url, status: r.status, together: inFlight[key]-- });
    return r;
  };
  const document = {
    body: null,
    visibilityState: 'visible',
    addEventListener: () => {},
    querySelector: () => null,
    createElement: () => ({}),
  };
  const run = new Function(
    'window',
    'document',
    'localStorage',
    'navigator',
    'fetch',
    'setInterval',
    'addEventListener',
    src
  );
  run(
    window,
    document,
    { getItem: () => TOKEN, setItem: () => {} },
    {},
    fetch,
    () => 0,
    (name, fn) => (listeners[name] = fn)
  );
  const db = await window.claude.use('db');
  return {
    db,
    puts,
    stale: body => (stale = body),
    beforePut: fn => (beforePut = fn),
    focus: async () => {
      listeners.focus();
      await new Promise(r => setTimeout(r, 20));
    },
    data: async (c, id) => (await db.collection(c).doc(id).get()).data(),
  };
}
const stored = (env, c, id) => {
  const r = row(env, c, id);
  return r && { v: r.v, data: JSON.parse(r.data) };
};

test('B-389 (shim): two quick saves of one document go one at a time, each merged at its turn', async () => {
  const env = envOf();
  await put(env, 'notes', 'n1', { a: 1 });
  const s = await shim(env);
  const ref = s.db.collection('notes').doc('n1');
  await Promise.all([ref.update({ b: 1 }), ref.update({ c: 1 }), ref.update({ b: 2 })]);
  assert.deepEqual(stored(env, 'notes', 'n1'), { v: 4, data: { a: 1, b: 2, c: 1 } });
  assert.deepEqual(
    s.puts.map(p => [p.route, p.status, p.together]),
    [
      ['/api/db/notes/n1?if_version=1', 200, 1],
      ['/api/db/notes/n1?if_version=2', 200, 1],
      ['/api/db/notes/n1?if_version=3', 200, 1],
    ],
    'each save waits for the one before, and carries the version it made'
  );
  assert.deepEqual(await s.data('notes', 'n1'), { a: 1, b: 2, c: 1 });
});

test('B-389 (shim): an update refused because a run wrote since is read again and merged once more', async () => {
  const env = envOf();
  await put(env, 'talk', '2026-10-25', { schema: 4, writer: 'page', messages: { m1: { text: 'first' } } });
  const s = await shim(env);
  // the worker answers in the meantime: version 2, which the shim has not read
  await put(
    env,
    'talk',
    '2026-10-25',
    { schema: 4, writer: 'page', messages: { m1: { text: 'first' }, w1: { text: 'hers' } } },
    1
  );
  await s.db
    .collection('talk')
    .doc('2026-10-25')
    .update({ messages: { m2: { text: 'his second' } } });
  assert.deepEqual(
    s.puts.map(p => [p.route, p.status]),
    [
      ['/api/db/talk/2026-10-25?if_version=1', 409],
      ['/api/db/talk/2026-10-25?if_version=2', 200],
    ]
  );
  assert.deepEqual(stored(env, 'talk', '2026-10-25').data.messages, {
    m1: { text: 'first' },
    w1: { text: 'hers' },
    m2: { text: 'his second' },
  });
});

test('B-389 (shim): a set over a document that changed is not retried; the page gets the error with his words', async () => {
  const env = envOf();
  await put(env, 'ideas', 'i1', { text: 'old' });
  const s = await shim(env);
  await put(env, 'ideas', 'i1', { text: 'from the other device' }, 1);
  const e = await s.db
    .collection('ideas')
    .doc('i1')
    .set({ text: 'his new words' })
    .then(
      () => null,
      x => x
    );
  assert.ok(e && e.conflict && e.code === 'conflict');
  assert.deepEqual(e.unsaved, { text: 'his new words' }, 'the refusal carries what he wrote');
  assert.doesNotMatch(e.message, /^conflict$/);
  assert.deepEqual(
    s.puts.map(p => p.status),
    [409],
    'tried once'
  );
  assert.deepEqual(
    stored(env, 'ideas', 'i1'),
    { v: 2, data: { text: 'from the other device' } },
    'nothing overwritten'
  );
  assert.deepEqual(await s.data('ideas', 'i1'), { text: 'from the other device' }, 'the page shows the newest');
});

test('B-389 (shim): a line he sends while a worker message lands: the create is laid under the new document', async () => {
  const env = envOf();
  const s = await shim(env); // today's talk document does not exist yet
  const w = await put(env, 'talk', '2026-10-25', {
    schema: 4,
    writer: 'worker',
    source: 'worker worker-1',
    messages: { w1: { role: 'ev', text: 'the job is done' } },
  });
  assert.equal(w.status, 200);
  await s.db
    .collection('talk')
    .doc('2026-10-25')
    .set({ schema: 4, writer: 'page', source: 'E.V. Home', messages: { m1: { role: 'matt', text: 'his line' } } });
  assert.deepEqual(
    s.puts.map(p => [p.route, p.status]),
    [
      ['/api/db/talk/2026-10-25', 409],
      ['/api/db/talk/2026-10-25?if_version=1', 200],
    ]
  );
  assert.deepEqual(stored(env, 'talk', '2026-10-25'), {
    v: 2,
    data: {
      schema: 4,
      writer: 'worker',
      source: 'worker worker-1',
      messages: { w1: { role: 'ev', text: 'the job is done' }, m1: { role: 'matt', text: 'his line' } },
    },
  });
});

const refusal = p =>
  p.then(
    () => null,
    x => x
  );

test('B-394 (shim): a retry that conflicts again (a third writer between the re-read and the retry) ends refused, nothing written', async () => {
  const env = envOf();
  const day = '2026-10-25';
  await put(env, 'talk', day, { schema: 4, writer: 'page', messages: { m1: { text: 'first' } } });
  const s = await shim(env);
  await put(
    env,
    'talk',
    day,
    { schema: 4, writer: 'page', messages: { m1: { text: 'first' }, w1: { text: 'hers' } } },
    1
  );
  s.beforePut(async (route, n) => {
    // after the shim read version 2 and before its retry leaves, another writer makes version 3
    if (n === 1) {
      const r = await put(env, 'talk', day, { schema: 4, writer: 'worker', messages: { w2: { text: 'third' } } }, 2);
      assert.equal(r.status, 200);
    }
  });
  const e = await refusal(
    s.db
      .collection('talk')
      .doc(day)
      .update({ messages: { m2: { text: 'his second' } } })
  );
  assert.ok(e && e.conflict, 'refused as a conflict');
  assert.equal(e.unsaved.messages.m2.text, 'his second', 'the refusal carries his line');
  assert.deepEqual(
    s.puts.map(p => [p.route, p.status]),
    [
      ['/api/db/talk/2026-10-25?if_version=1', 409],
      ['/api/db/talk/2026-10-25?if_version=2', 409],
    ],
    'tried once more, never a third time'
  );
  assert.deepEqual(
    stored(env, 'talk', day),
    { v: 3, data: { schema: 4, writer: 'worker', messages: { w2: { text: 'third' } } } },
    'nothing of his written over the third writer'
  );
});

test('B-394 (shim): a save the network drops is refused with his words, and nothing is written', async () => {
  const env = envOf();
  const s = await shim(env);
  s.beforePut(() => {
    throw new TypeError('Failed to fetch');
  });
  const doc = { schema: 4, writer: 'page', messages: { m1: { role: 'matt', text: 'his line' } } };
  const e = await refusal(s.db.collection('talk').doc('2026-10-25').set(doc));
  assert.ok(e, 'refused');
  assert.deepEqual(e.unsaved, doc, 'his text is kept on the refusal');
  assert.equal(row(env, 'talk', '2026-10-25'), undefined, 'nothing written');
  assert.equal((await s.db.collection('talk').doc('2026-10-25').get()).exists, false, 'the page shows nothing saved');
});

test('B-394 (shim): a create race where both sides set one field differently is refused with his document, never dropped', async () => {
  const env = envOf();
  const s = await shim(env);
  const theirs = {
    schema: 4,
    writer: 'worker',
    source: 'worker worker-1',
    messages: { m1: { role: 'ev', text: 'theirs' } },
  };
  assert.equal((await put(env, 'talk', '2026-10-25', theirs)).status, 200);
  const his = { schema: 4, writer: 'page', source: 'E.V. Home', messages: { m1: { role: 'matt', text: 'his line' } } };
  const e = await refusal(s.db.collection('talk').doc('2026-10-25').set(his));
  assert.ok(e && e.conflict, 'refused as a conflict');
  assert.equal(e.field, 'role', 'the first field both set differently');
  assert.deepEqual(e.unsaved, his, 'the refusal carries what he wrote');
  assert.deepEqual(
    s.puts.map(p => p.status),
    [409],
    'no retry over a collision'
  );
  assert.deepEqual(stored(env, 'talk', '2026-10-25'), { v: 1, data: theirs }, 'theirs untouched');
});

test('B-389 (shim): a read that left before a save landed never puts the older copy back', async () => {
  const env = envOf();
  await put(env, 'notes', 'n1', { a: 1 });
  const s = await shim(env);
  await s.db.collection('notes').doc('n1').set({ a: 2 }); // version 2
  s.stale({ now: 1, docs: [{ c: 'notes', id: 'n1', data: { a: 1 }, at: 1, v: 1 }] });
  await s.focus();
  assert.deepEqual(await s.data('notes', 'n1'), { a: 2 });
  await put(env, 'notes', 'n1', { a: 3 }, 2); // a newer version from elsewhere is taken
  await s.focus();
  assert.deepEqual(await s.data('notes', 'n1'), { a: 3 });
});
