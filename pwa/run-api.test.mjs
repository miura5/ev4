// B-312: the run API's suite, against a running Worker over D1.
//   node --test pwa/run-api.test.mjs              starts `wrangler dev` on a fresh local D1 seeded with the made-up
//                                                 record (needs `npm ci --prefix pwa`), runs the suite, stops it
//   EV_RUN_API_URL=<staging Worker> EV_TOKEN=... node --test pwa/run-api.test.mjs
//                                                 the same suite against the staging Worker (the pwa-staging workflow)
// It reads the seed's collections and writes only into its own collection, SUITE, under ids new to each run: the
// Worker never deletes, so on staging those documents stay (the staging check leaves SUITE out of its counts). It
// prints statuses and counts, never the token.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedRecord } from './seed.mjs';
import { SUITE } from './runapi.js';

const PWA = path.dirname(fileURLToPath(import.meta.url));
const REMOTE = process.env.EV_RUN_API_URL || null;
const TOKEN = REMOTE ? process.env.EV_TOKEN : 'run-api-suite-token-not-a-secret';
const RUN = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const SEED = seedRecord();
// Collections the suite reads back against the seed: ones the page and the runs leave alone on staging.
const READ = ['objectives', 'exams'];

let base = REMOTE ? REMOTE.replace(/\/+$/, '') : null;
let proc = null;

const freePort = () =>
  new Promise((ok, no) => {
    const s = net.createServer();
    s.unref();
    s.on('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

before(async () => {
  if (REMOTE) {
    assert.ok(TOKEN, 'EV_TOKEN is set for the staging Worker');
    return;
  }
  const wrangler = path.join(PWA, 'node_modules/.bin/wrangler');
  assert.ok(fs.existsSync(wrangler), 'wrangler is installed in pwa/: run npm ci --prefix pwa first');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-run-api-d1-'));
  fs.writeFileSync(path.join(dir, 'seed.sql'), execFileSync('node', ['seed.mjs'], { cwd: PWA }));
  for (const file of [path.join(PWA, 'schema.sql'), path.join(dir, 'seed.sql')])
    execFileSync(wrangler, ['d1', 'execute', 'ev-demo', '--local', '--persist-to', dir, '--file', file], {
      cwd: PWA,
      stdio: 'pipe',
    });
  // wrangler serves public/ as the Worker's assets; the suite needs only the API, so an empty one will do.
  fs.mkdirSync(path.join(PWA, 'public'), { recursive: true });
  const port = await freePort();
  const log = [];
  proc = spawn(
    wrangler,
    ['dev', '--local', '--persist-to', dir, '--ip', '127.0.0.1', '--port', String(port), '--var', 'EV_TOKEN:' + TOKEN],
    { cwd: PWA, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }
  );
  proc.stdout.on('data', d => log.push(String(d)));
  proc.stderr.on('data', d => log.push(String(d)));
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (proc.exitCode != null) break;
    const s = await fetch(base + '/api/run/list?collection=objectives').then(
      r => r.status,
      () => 0
    );
    if (s === 401) return;
    await new Promise(r => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error('wrangler dev did not come up:\n' + log.join('').slice(-2000));
});

after(() => {
  if (proc) proc.kill();
});

const call = async (method, route, body, token = TOKEN) => {
  const r = await fetch(base + route, {
    method,
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};
const q = o => new URLSearchParams(o).toString();
const get = (c, id) => call('GET', '/api/run/get?' + q({ collection: c, doc_id: id }));
const list = (c, extra = {}) => call('GET', '/api/run/list?' + q({ collection: c, ...extra }));
const batch = writes => call('POST', '/api/run/batch', { writes });
const listAll = async (c, limit) => {
  const docs = [];
  let cursor = null;
  for (let i = 0; i < 500; i++) {
    const r = await list(c, { limit: String(limit), ...(cursor ? { cursor } : {}) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.documents.length <= limit);
    docs.push(...r.body.documents);
    cursor = r.body.next_cursor;
    if (!cursor) return docs;
  }
  throw new Error('list never ended');
};
const id = n => `${RUN}-${String(n).padStart(2, '0')}`;

test('no token, or a wrong one: 401 on every run route', async () => {
  for (const t of [null, TOKEN + '-wrong']) {
    assert.equal((await call('GET', '/api/run/list?collection=objectives', null, t)).status, 401);
    assert.equal((await call('POST', '/api/run/batch', { writes: [] }, t)).status, 401);
  }
});

// The documents as the record holds them: locally the seed, written moments ago; on staging, what the D1 holds (the
// page's own read, /api/db), since the made-up record's dates are relative to the day it was seeded.
const held = async c => {
  if (!REMOTE) return SEED[c];
  const r = await call('GET', '/api/db');
  assert.equal(r.status, 200);
  return Object.fromEntries(r.body.docs.filter(d => d.c === c).map(d => [d.id, d.data]));
};

test('list and get return what ArtifactData returns for the same documents: each id, its data and a version', async () => {
  for (const c of READ) {
    const want = await held(c);
    assert.deepEqual(Object.keys(want).sort(), Object.keys(SEED[c]).sort(), `${c}: the seed's documents`);
    const ids = Object.keys(want).sort();
    assert.ok(ids.length > 2, `${c} has documents to page through`);
    const docs = await listAll(c, 2); // pages of two: the cursor is followed to the end
    assert.deepEqual(
      docs.map(d => d.id),
      ids,
      `${c}: every document, in id order`
    );
    for (const d of docs) {
      assert.deepEqual(Object.keys(d).sort(), ['data', 'id', 'version']);
      assert.deepEqual(d.data, want[d.id], `${c}/${d.id}: the data as the record holds it`);
      assert.ok(Number.isInteger(d.version) && d.version >= 1);
      if (!REMOTE) assert.equal(d.version, 1, `${c}/${d.id}: a seeded document is at version 1`);
    }
    const one = await get(c, ids[0]);
    assert.equal(one.status, 200);
    assert.deepEqual(one.body, { collection: c, id: ids[0], version: docs[0].version, data: want[ids[0]] });
    const whole = await list(c);
    assert.equal(whole.body.documents.length, ids.length, `${c}: one page at the default limit`);
    assert.equal(whole.body.next_cursor, null);
  }
  const none = await get(READ[0], 'no-such-document');
  assert.equal(none.status, 404);
  assert.equal((await list(SUITE + '-empty-' + RUN)).body.documents.length, 0);
});

test('a batch of 25 writes lands whole: each document at version 1, then 25 pinned updates at version 2', async () => {
  const writes = Array.from({ length: 25 }, (_, i) => ({
    op: 'set',
    collection: SUITE,
    doc_id: id(i),
    data: { schema: 1, writer: 'run-api-suite', n: i, keep: { a: 1, b: 2 }, gone: 'x' },
  }));
  const r = await batch(writes);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.results.length, 25);
  assert.ok(r.body.results.every(x => x.version === 1));
  const mine = (await listAll(SUITE, 1000)).filter(d => d.id.startsWith(RUN + '-'));
  assert.equal(mine.length, 25);
  assert.deepEqual(
    mine.map(d => d.data.n).sort((a, b) => a - b),
    [...Array(25).keys()]
  );

  const up = await batch(
    writes.map(w => ({
      op: 'update',
      collection: SUITE,
      doc_id: w.doc_id,
      if_version: 1,
      data: { keep: { b: 3 }, gone: { __delete__: true }, added: true },
    }))
  );
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.ok(up.body.results.every(x => x.version === 2));
  const one = await get(SUITE, id(7));
  assert.deepEqual(one.body.data, { schema: 1, writer: 'run-api-suite', n: 7, keep: { a: 1, b: 3 }, added: true });
  assert.equal(one.body.version, 2);
});

test('a batch with one stale if_version writes nothing and names the conflict', async () => {
  const before = await Promise.all([0, 1].map(n => get(SUITE, id(n))));
  assert.ok(
    before.every(b => b.body.version === 2),
    'the 25-write test ran first'
  );
  const r = await batch([
    { op: 'update', collection: SUITE, doc_id: id(0), if_version: 2, data: { touched: true } },
    { op: 'update', collection: SUITE, doc_id: id(1), if_version: 1, data: { touched: true } }, // stale
    { op: 'set', collection: SUITE, doc_id: id(90), data: { schema: 1, n: 90 } },
  ]);
  assert.equal(r.status, 409);
  assert.equal(r.body.entry, 1);
  assert.equal(r.body.collection, SUITE);
  assert.equal(r.body.doc_id, id(1));
  assert.equal(r.body.if_version, 1);
  assert.equal(r.body.current_version, 2);
  assert.match(r.body.error, /nothing was written/);
  const afterwards = await Promise.all([0, 1].map(n => get(SUITE, id(n))));
  assert.deepEqual(
    afterwards.map(a => a.body),
    before.map(b => b.body),
    'neither pinned document changed'
  );
  assert.equal((await get(SUITE, id(90))).status, 404, 'the create in the same batch did not land');

  const bare = await batch([{ op: 'set', collection: SUITE, doc_id: id(0), data: { schema: 1 } }]);
  assert.equal(bare.status, 409, 'a write to a document that exists, with no if_version, is refused');
  assert.equal(bare.body.current_version, 2);
  const ghost = await batch([{ op: 'set', collection: SUITE, doc_id: id(91), if_version: 3, data: {} }]);
  assert.equal(ghost.status, 409, 'a pin on a document that does not exist is refused');
  assert.equal(ghost.body.current_version, null);
});

test('a delete is refused: the batch writes nothing, and a DELETE request is refused too', async () => {
  const before = await get(SUITE, id(2));
  const r = await batch([
    { op: 'update', collection: SUITE, doc_id: id(3), if_version: 2, data: { touched: true } },
    { op: 'delete', collection: SUITE, doc_id: id(2), if_version: 2 },
  ]);
  assert.equal(r.status, 403);
  assert.equal(r.body.entry, 1);
  assert.match(r.body.error, /never deletes/);
  assert.deepEqual((await get(SUITE, id(2))).body, before.body, 'still there, unchanged');
  assert.equal((await get(SUITE, id(3))).body.version, 2, 'the other entry did not land');
  for (const route of [
    '/api/run/get?' + q({ collection: SUITE, doc_id: id(2) }),
    '/api/run/batch',
    '/api/db/' + SUITE + '/' + id(2),
  ]) {
    const d = await call('DELETE', route);
    assert.ok([403, 404].includes(d.status), `DELETE ${route.split('?')[0]}: ${d.status}`);
  }
  assert.deepEqual((await get(SUITE, id(2))).body, before.body);
});

test("the page's own save moves the version, so a run pinned to the old one is refused", async () => {
  const before = await get(SUITE, id(4));
  const put = await fetch(`${base}/api/db/${SUITE}/${id(4)}`, {
    method: 'PUT',
    headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ ...before.body.data, page: true }),
  });
  assert.equal(put.status, 200);
  const now = await get(SUITE, id(4));
  assert.equal(now.body.version, before.body.version + 1);
  assert.equal(now.body.data.page, true);
  const r = await batch([
    { op: 'update', collection: SUITE, doc_id: id(4), if_version: before.body.version, data: { run: true } },
  ]);
  assert.equal(r.status, 409);
  assert.equal(r.body.current_version, before.body.version + 1);
});

test("a batch's walls: over 50 writes, a document twice, a bad path, set with __delete__", async () => {
  const many = Array.from({ length: 51 }, (_, i) => ({
    op: 'set',
    collection: SUITE,
    doc_id: `${RUN}-x${i}`,
    data: {},
  }));
  assert.equal((await batch(many)).status, 400);
  const twice = [
    { op: 'set', collection: SUITE, doc_id: `${RUN}-y`, data: {} },
    { op: 'update', collection: SUITE, doc_id: `${RUN}-y`, data: {} },
  ];
  assert.equal((await batch(twice)).status, 400);
  assert.equal((await batch([{ op: 'set', collection: 'a/b', doc_id: 'x', data: {} }])).status, 400);
  assert.equal(
    (await batch([{ op: 'set', collection: SUITE, doc_id: `${RUN}-z`, data: { a: { __delete__: true } } }])).status,
    400
  );
  assert.equal((await get(SUITE, `${RUN}-y`)).status, 404);
});
