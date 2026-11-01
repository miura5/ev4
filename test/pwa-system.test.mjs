// B-473 (D-367): the system documents a scheduled run bootstraps from, held by the Worker (pwa/system.js), put there by
// the deploy workflow (tools/pwa-system.mjs) and read by a run (core/cli.mjs api system). The Worker runs here over an
// in-memory SQLite standing in for D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../pwa/worker.js';
import { SYSTEM_NAMES } from '../pwa/system.js';
import { putSystem, systemDocs, systemMessage, parseSystemMessage } from '../tools/pwa-system.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'test-token-0123456789abcdef';

function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
  });
  return { sql, prepare: q => stmt(q) };
}
const env = () => ({ DB: fakeD1(), EV_TOKEN: TOKEN });
const call = (e, route, init = {}) => worker.fetch(new Request('https://ev.test' + route, init), e);
const fetchOn = e => (u, init) => worker.fetch(new Request(u, init), e);
const auth = { authorization: 'Bearer ' + TOKEN };

test('B-473: the system route needs the token, holds only the four names, and never reaches docs', async () => {
  const e = env();
  assert.equal((await call(e, '/api/run/system/manifest')).status, 401);
  assert.equal((await call(e, '/api/run/system/manifest', { headers: auth })).status, 404);
  assert.equal((await call(e, '/api/run/system/worker', { headers: auth })).status, 404, 'system/worker is never here');
  const put = await call(e, '/api/run/system/manifest', { method: 'PUT', headers: auth, body: '{ "commit": "abc" }' });
  assert.equal(put.status, 200);
  const got = await call(e, '/api/run/system/manifest', { headers: auth });
  assert.equal(await got.text(), '{"commit":"abc"}');
  assert.equal((await call(e, '/api/run/system/spec', { method: 'PUT', headers: auth, body: 'nope' })).status, 400);
  assert.equal((await call(e, '/api/run/system/spec', { method: 'DELETE', headers: auth })).status, 405);
  assert.equal(e.DB.sql.prepare('SELECT COUNT(*) AS n FROM docs').get().n, 0, 'the record table is untouched');
  const db = await (await call(e, '/api/db?since=0', { headers: auth })).json();
  assert.equal(db.docs.length, 0, "the page's sync never sees them");
});

test("B-473: the deploy puts the build's documents and the Chart's Your turn, reads each back, and leaves the notice", async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-sys-'));
  fs.mkdirSync(path.join(dist, 'system'));
  const manifest = { schema: 2, commit: 'f'.repeat(40), release: 'v4.0.0' };
  fs.writeFileSync(path.join(dist, 'system', 'manifest.json'), JSON.stringify(manifest, null, 1));
  fs.writeFileSync(path.join(dist, 'system', 'spec.json'), '{"a": 1}');
  fs.writeFileSync(path.join(dist, 'system', 'environments.json'), '{"b": 2}');
  const docs = systemDocs({ root: ROOT, dist, target: 'staging', now: new Date('2026-11-01T00:00:00Z') });
  assert.deepEqual(Object.keys(docs).sort(), [...SYSTEM_NAMES].sort());
  assert.equal(JSON.parse(docs.yourturn).source, 'deploy staging');
  const e = env();
  const r = await putSystem({ base: 'https://ev.test', token: TOKEN, docs, fetchFn: fetchOn(e) });
  assert.ok(
    r.lines.every(l => l.ok),
    JSON.stringify(r.lines)
  );
  const parsed = parseSystemMessage(r.message);
  assert.equal(parsed.commit, manifest.commit);
  assert.deepEqual(Object.keys(parsed.hashes).sort(), [...SYSTEM_NAMES].sort());
  assert.ok(!r.message.includes(TOKEN));
  const bad = await putSystem({ base: 'https://ev.test', token: 'wrong-token-0123456789', docs, fetchFn: fetchOn(e) });
  assert.ok(bad.lines.every(l => !l.ok));
  assert.equal(parseSystemMessage(systemMessage({ commit: 'abc1234', hashes: {} })), null);
  fs.rmSync(dist, { recursive: true, force: true });
});
