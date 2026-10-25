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

test('B-389: the shim sends the version it last saw, one save of a document at a time, and refuses on 409', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8');
  assert.match(src, /'\?if_version=' \+ seen/, 'the save carries if_version');
  assert.match(src, /setVer\(d\.c, d\.id, d\.v\)/, 'the read keeps each version');
  assert.match(src, /setVer\(c, id, saved\.version\)/, 'a save keeps the version it made');
  assert.match(src, /r\.status === 409/);
  assert.match(src, /e\.code = 'conflict'/);
});
