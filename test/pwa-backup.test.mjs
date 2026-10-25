// B-316 (D-302): the nightly D1 export to R2. Proved here over a real SQLite database (node:sqlite, the engine D1 is
// built on) holding the made-up record, and a stand-in R2 bucket that keeps every write: an export never replaces an
// earlier one, a restore into a new table matches counts and hashes per collection, a changed document is caught, and
// nothing in the Worker or the restore deletes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { exportToR2, exportKey, manifestOf, newestExport, putNew } from '../pwa/backup.js';
import { readExport, restoreSql, verify } from '../tools/pwa-backup.mjs';
import { seedSql, seedCounts } from '../pwa/seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A stand-in R2 bucket: head, put, get, list; every put is logged, and it has no delete.
function bucket() {
  const objects = new Map();
  const puts = [];
  return {
    objects,
    puts,
    async head(k) {
      return objects.has(k) ? { key: k } : null;
    },
    async put(k, body) {
      puts.push(k);
      objects.set(k, body);
      return { key: k };
    },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = Number(cursor || 0);
      const page = keys.slice(start, start + 2); // small pages, so the paging is exercised
      const truncated = start + 2 < keys.length;
      return { objects: page.map(key => ({ key })), truncated, cursor: truncated ? String(start + 2) : undefined };
    },
  };
}

// The made-up record in SQLite, with D1's prepare().bind().all() shape over it.
function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'));
  db.exec(seedSql({ append: true, at: 1000 }));
  return {
    db,
    prepare: sql => ({ all: async () => ({ results: db.prepare(sql).all() }) }),
  };
}

test('B-316: an export holds every document of D1, with counts per collection equal to the record', async () => {
  const env = { DB: d1(), EXPORTS: bucket() };
  const out = await exportToR2(env, Date.UTC(2026, 9, 25, 8, 17));
  assert.equal(out.key, 'exports/2026-10-25/2026-10-25T08-17-00-000Z.json');
  const counts = Object.fromEntries(Object.entries(out.collections).map(([c, m]) => [c, m.count]));
  assert.deepEqual(counts, Object.fromEntries(Object.entries(seedCounts()).filter(([, n]) => n > 0)));
  const exp = await readExport(env.EXPORTS.objects.get(out.key));
  assert.deepEqual(exp.collections, out.collections);
});

test('B-316: an export never replaces an earlier one, even at the same moment', async () => {
  const env = { DB: d1(), EXPORTS: bucket() };
  const now = Date.UTC(2026, 9, 25, 8, 17);
  const first = await exportToR2(env, now);
  const firstBody = env.EXPORTS.objects.get(first.key);
  env.DB.db.exec(
    `UPDATE docs SET data = '{"changed":true}', v = v + 1 WHERE c = 'objectives' AND rowid = (SELECT MIN(rowid) FROM docs WHERE c = 'objectives')`
  );
  const second = await exportToR2(env, now);
  const third = await exportToR2(env, now);
  assert.notEqual(second.key, first.key);
  assert.notEqual(third.key, second.key);
  assert.equal(env.EXPORTS.objects.get(first.key), firstBody, 'the first export is unchanged');
  assert.equal(new Set(env.EXPORTS.puts).size, env.EXPORTS.puts.length, 'no key was written twice');
  assert.notEqual(second.collections.objectives.sha256, first.collections.objectives.sha256);
  assert.equal(await newestExport(env.EXPORTS), third.key, 'the newest sorts last');
  // A later night sorts after all of them.
  const next = await exportToR2(env, now + 86400000);
  assert.equal(await newestExport(env.EXPORTS), next.key);
});

test('B-316: putNew skips every taken key and writes a new one', async () => {
  const b = bucket();
  const key = exportKey(0);
  await b.put(key, 'a');
  await b.put(key.replace(/\.json$/, '~2.json'), 'b');
  const k = await putNew(b, key, 'c');
  assert.equal(k, key.replace(/\.json$/, '~3.json'));
  assert.equal(b.objects.get(key), 'a');
});

test('B-316: a restore of the newest export into a new table matches counts and hashes per collection', async () => {
  const env = { DB: d1(), EXPORTS: bucket() };
  await exportToR2(env, 1);
  await exportToR2(env, 2);
  const exp = await readExport(env.EXPORTS.objects.get(await newestExport(env.EXPORTS)));
  const scratch = new DatabaseSync(':memory:');
  scratch.exec(restoreSql(exp, 'restore_r1'));
  const rows = scratch.prepare('SELECT c, id, data FROM restore_r1').all();
  const lines = await verify(exp, rows);
  assert.ok(
    lines.every(l => l.ok),
    lines.map(l => l.what).join('\n')
  );
  assert.equal(rows.length, exp.docs.length);
  // Each statement stays under D1's 100 KB limit for one SQL statement.
  for (const s of restoreSql(exp, 'restore_r1').split('\n')) assert.ok(s.length < 100000, 'statement over 100 KB');
});

test('B-316: a restore that lost or changed a document is RED, and an export that misses its manifest is refused', async () => {
  const env = { DB: d1(), EXPORTS: bucket() };
  const { key } = await exportToR2(env, 1);
  const exp = await readExport(env.EXPORTS.objects.get(key));
  const rows = exp.docs.map(d => ({ c: d.c, id: d.id, data: d.data }));
  const lost = await verify(exp, rows.slice(1));
  assert.ok(!lost.at(-1).ok);
  const changed = rows.map((r, i) => (i === 0 ? { ...r, data: r.data + ' ' } : r));
  const bad = await verify(exp, changed);
  assert.ok(!bad.at(-1).ok && /hash differs/.test(bad.at(-1).what));
  const tampered = JSON.parse(env.EXPORTS.objects.get(key));
  tampered.docs[0].data = '{}';
  await assert.rejects(readExport(JSON.stringify(tampered)), /misses its own manifest/);
});

test('B-316: the restore goes only into a new restore_ table; nothing deletes or replaces', () => {
  assert.throws(() => restoreSql({ docs: [] }, 'docs'), /restore_/);
  const sql = restoreSql({ docs: [{ c: 'a', id: 'b', data: '{"x":"it\'s"}', at: 1, v: 1 }] }, 'restore_x');
  assert.doesNotMatch(sql, /\b(DELETE|DROP|REPLACE|UPDATE)\b/i);
  for (const f of ['pwa/backup.js', 'pwa/worker.js', 'tools/pwa-backup.mjs'])
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /\.delete\(|DELETE FROM|DROP TABLE/, f);
});

test('B-316: manifests are over the documents as stored, in id order', async () => {
  const a = await manifestOf([
    { c: 'x', id: '2', data: '{"b":1}' },
    { c: 'x', id: '1', data: '{"a":1}' },
  ]);
  const b = await manifestOf([
    { c: 'x', id: '1', data: '{"a":1}' },
    { c: 'x', id: '2', data: '{"b":1}' },
  ]);
  assert.deepEqual(a, b);
  assert.equal(a.x.count, 2);
  assert.match(a.x.sha256, /^[0-9a-f]{64}$/);
});

test('B-316: only the staging Worker gets the bucket and the cron, bound by the workflow once the bucket exists; nothing deletes', () => {
  const toml = fs.readFileSync(path.join(ROOT, 'pwa/wrangler.toml'), 'utf8');
  assert.doesNotMatch(toml.replace(/^#.*$/gm, ''), /r2_buckets|triggers/, 'no binding to a bucket that may not exist');
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pwa-staging.yml'), 'utf8');
  assert.match(wf, /r2 bucket create ev-staging-exports/);
  assert.match(wf, /\[\[env\.staging\.r2_buckets\]\]\\nbinding = "EXPORTS"\\nbucket_name = "ev-staging-exports"/);
  assert.match(wf, /\[env\.staging\.triggers\]\\ncrons = \["17 8 \* \* \*"\]/);
  assert.ok(wf.indexOf('r2 bucket create') < wf.indexOf('wrangler deploy --env staging'), 'bound before the deploy');
  assert.match(wf, /d1 time-travel info ev-staging/);
  assert.doesNotMatch(wf, /r2 object delete|r2 bucket delete|d1 delete|DROP TABLE|DELETE FROM/);
});
