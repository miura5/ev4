// B-312: the run API's rules with no Worker (pwa/runapi.js); the suite against a running Worker is
// pwa/run-api.test.mjs (npm run test:run-api, and the pwa-staging workflow against the staging Worker).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUITE,
  SUITE_DOCS_PER_RUN,
  MAX_WRITES,
  checkWrites,
  planBatch,
  merge,
  encodeCursor,
  decodeCursor,
  validCollection,
  validDocId,
} from '../pwa/runapi.js';
import { recordDiffs } from '../tools/pwa-staging.mjs';
import { seedRecord } from '../pwa/seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = (doc_id, extra = {}) => ({ op: 'set', collection: 'scratch', doc_id, data: { a: 1 }, ...extra });
const cur = entries => new Map(entries.map(([id, v, data = {}]) => ['scratch\n' + id, { v, data }]));

test('B-312: a batch is refused whole for a delete, a bad op, a document twice or over 50 writes', () => {
  assert.equal(checkWrites([w('a'), w('b')]), null);
  const del = checkWrites([w('a'), { op: 'delete', collection: 'scratch', doc_id: 'b' }]);
  assert.equal(del.status, 403);
  assert.equal(del.entry, 1);
  assert.equal(checkWrites([{ ...w('a'), op: 'merge' }]).status, 400);
  assert.equal(checkWrites([w('a'), w('a')]).status, 400);
  assert.equal(checkWrites(Array.from({ length: MAX_WRITES + 1 }, (_, i) => w('d' + i))).status, 400);
  assert.equal(checkWrites(Array.from({ length: MAX_WRITES }, (_, i) => w('d' + i))), null);
  assert.equal(checkWrites([]).status, 400);
  assert.equal(checkWrites([w('a', { data: { x: { __delete__: true } } })]).status, 400, 'set rejects __delete__');
  assert.equal(checkWrites([w('a', { op: 'update', data: { x: { __delete__: true } } })]), null);
  assert.equal(checkWrites([w('a', { if_version: 0 })]).status, 400);
  assert.equal(checkWrites([w('a', { data: [1] })]).status, 400);
});

test('B-312: collection paths and ids as ArtifactData takes them', () => {
  assert.ok(
    validCollection('scratch') && validCollection('data/users/me/decks/cards'.split('/').slice(0, 3).join('/'))
  );
  assert.ok(!validCollection('data/users'), 'an even number of segments is a document');
  assert.ok(!validCollection('../x') && !validCollection('') && !validCollection('a\u0000b'));
  assert.ok(validCollection('a b'), 'B-319: a space is a character a claude.ai id may hold');
  assert.ok(validDocId('2026-10-25') && !validDocId('a/b') && !validDocId('..'));
  assert.ok(validDocId('NUR 112') && validDocId('é ü') && !validDocId('.') && !validDocId('x'.repeat(201)));
});

test('B-312: if_version means what it means in ArtifactData', () => {
  // a create carries none; a write to a document that exists names the version it read
  const ok = planBatch([w('new'), w('old', { if_version: 3 })], cur([['old', 3]]));
  assert.ok(ok.ok);
  assert.deepEqual(
    ok.rows.map(r => [r.id, r.from, r.v]),
    [
      ['new', null, 1],
      ['old', 3, 4],
    ]
  );
  const stale = planBatch([w('new'), w('old', { if_version: 2 })], cur([['old', 3]]));
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.deepEqual([stale.entry, stale.doc_id, stale.if_version, stale.current_version], [1, 'old', 2, 3]);
  assert.match(stale.error, /nothing was written/);
  const bare = planBatch([w('old')], cur([['old', 3]]));
  assert.equal(bare.current_version, 3, 'an existing document with no pin is refused');
  const ghost = planBatch([w('gone', { if_version: 1 })], cur([]));
  assert.equal(ghost.current_version, null, 'a pin on a missing document is refused');
});

test('B-312: update merges objects deeply, replaces arrays, removes __delete__ fields, and creates a missing document', () => {
  assert.deepEqual(merge({ a: { b: 1, c: 2 }, l: [1, 2], x: 1 }, { a: { c: 3 }, l: [9], x: { __delete__: true } }), {
    a: { b: 1, c: 3 },
    l: [9],
  });
  const p = planBatch([{ op: 'update', collection: 'scratch', doc_id: 'n', data: { a: { b: 1 } } }], cur([]));
  assert.deepEqual(p.rows[0], { c: 'scratch', id: 'n', data: { a: { b: 1 } }, from: null, v: 1 });
  const q = planBatch(
    [{ op: 'update', collection: 'scratch', doc_id: 'n', if_version: 1, data: { y: 2 } }],
    cur([['n', 1, { x: 1 }]])
  );
  assert.deepEqual(q.rows[0].data, { x: 1, y: 2 });
});

test('B-312: a list cursor round-trips an id and refuses anything else', () => {
  assert.equal(decodeCursor(encodeCursor('2026-10-25.a_b')), '2026-10-25.a_b');
  assert.equal(decodeCursor('%%%'), null);
  for (const id of ['NUR 112', 'é ü', 'a+b=c']) assert.equal(decodeCursor(encodeCursor(id)), id, 'B-319: any id');
  // B-397: a cursor given before B-319 (btoa: +, / and = padding) still decodes to its id
  for (const id of ['2026-10-25.a_b', 'ab?', 'a~~>', 'x'])
    assert.equal(decodeCursor(btoa(id)), id, `old cursor ${btoa(id)}`);
  assert.ok(/[+/]/.test(btoa('ab?') + btoa('a~~>')) && /=$/.test(btoa('x')), 'the cases hold +, / and padding');
  assert.equal(decodeCursor('YQ=='), 'a');
  assert.equal(decodeCursor('YQ==='), null, 'three = is not base64');
  assert.equal(decodeCursor(btoa('a/b')), null);
});

test('B-312: the Worker routes /api/run behind the token, the page save moves the version, and nothing deletes', () => {
  const worker = fs.readFileSync(path.join(ROOT, 'pwa/worker.js'), 'utf8');
  const lock = worker.indexOf("'wrong token'");
  const run = worker.indexOf("startsWith('/api/run/')");
  assert.ok(lock > 0 && run > lock, 'the run routes come after the token check');
  assert.match(worker, /UPDATE docs SET data = \?, at = \?, v = v \+ 1 WHERE c = \? AND id = \? AND v = \?/);
  assert.match(worker, /VALUES \(\?, \?, \?, \?, 1\) ON CONFLICT \(c, id\) DO NOTHING/);
  const code = [worker, fs.readFileSync(path.join(ROOT, 'pwa/runapi.js'), 'utf8')].join('\n');
  assert.doesNotMatch(code.replace(/^\s*\/\/.*$/gm, ''), /DELETE FROM|DROP TABLE|INSERT OR REPLACE/i);
  assert.match(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'), /v INTEGER NOT NULL DEFAULT 1/);
});

test("B-312: the suite's collection is not in the seed; the staging counts take whole runs of it and nothing else", () => {
  assert.ok(!(SUITE in seedRecord()));
  const seed = { a: { 1: {} } };
  const run = n => Array.from({ length: n }, (_, i) => ({ c: SUITE, id: 'r-' + i, data: { writer: 'run-api-suite' } }));
  const a1 = { c: 'a', id: '1', data: {} };
  assert.deepEqual(recordDiffs({ docs: [a1] }, seed).problems, []);
  assert.deepEqual(recordDiffs({ docs: [a1, ...run(2 * SUITE_DOCS_PER_RUN)] }, seed).problems, []);
  assert.equal(recordDiffs({ docs: [a1, ...run(SUITE_DOCS_PER_RUN + 1)] }, seed).problems.length, 1);
  assert.deepEqual(recordDiffs({ docs: [] }, seed).problems, ["a: 1 of the seed's 1 documents missing (1)"]);
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pwa-staging.yml'), 'utf8');
  assert.match(wf, /node --test pwa\/run-api\.test\.mjs/);
  assert.match(wf, /ALTER TABLE docs ADD COLUMN v INTEGER NOT NULL DEFAULT 1/);
  assert.match(fs.readFileSync(path.join(ROOT, '.github/workflows/smoke.yml'), 'utf8'), /npm run test:run-api/);
});
