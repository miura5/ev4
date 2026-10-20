// seed-staging (B-12): a v4 export is copied as it is, a v3 export is migrated first, the journal and the source's
// system/* never travel, and system/seed (counts, hashes, export time) is written last and alone. The record used
// here is the synthetic one in test/data/record; the real seed ran from an export that never enters the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import EV from '../core/evcore.mjs';
import { seedStaging, collectionHash, seedAgeDays } from '../core/seed.mjs';
import { loadValidator, readExport } from '../core/schemas.mjs';
import { ROOT } from './helpers.mjs';

EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));
const validate = loadValidator();
const AT = '2026-10-18T06:00:00Z',
  EXPORTED = '2026-10-18T05:02:42Z';

const recordExport = ({ journal = false } = {}) => {
  const exp = {};
  for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record'))) {
    if (collection === 'journal' && !journal) continue;
    (exp[collection] = exp[collection] || []).push({ id, ...doc });
  }
  return exp;
};

test('a v4 export is copied as it is, without system/*, and the seed stamp comes last', () => {
  const exp = recordExport();
  const { writes, seed, migrated } = seedStaging(exp, { at: AT, exportedAt: EXPORTED });
  assert.equal(migrated, false);
  const last = writes.at(-1);
  assert.deepEqual([last.collection, last.id], ['system', 'seed']);
  assert.equal(writes.filter(w => w.collection === 'system').length, 1, 'only the seed stamp is a system write');
  const copied = writes.slice(0, -1);
  const expected = Object.entries(exp)
    .filter(([c]) => c !== 'system')
    .reduce((n, [, l]) => n + l.length, 0);
  assert.equal(copied.length, expected);
  for (const w of copied) {
    const src = exp[w.collection].find(d => d.id === w.id);
    assert.deepEqual(w.data, EV.docData(src), `${w.collection}/${w.id} is copied unchanged`);
  }
  assert.equal(seed.migration, null);
  assert.equal(seed.exportedAt, EXPORTED.replace('Z', '.000Z'));
  assert.equal(
    Object.values(seed.counts).reduce((a, b) => a + b, 0),
    copied.length
  );
  assert.equal(seed.hashes.weakspots, collectionHash(exp.weakspots));
  for (const w of writes)
    assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
});

test('the journal is never seeded', () => {
  assert.throws(
    () => seedStaging(recordExport({ journal: true }), { at: AT, exportedAt: EXPORTED }),
    /journal is never seeded/
  );
});

test('a seed needs both its own time and the export time', () => {
  assert.throws(() => seedStaging(recordExport(), { at: AT }), /needs opts.at and opts.exportedAt/);
  assert.throws(() => seedStaging(recordExport(), { exportedAt: EXPORTED }), /needs opts.at and opts.exportedAt/);
});

test('a v3 export is migrated first, with legacy copies, and stamped v3-to-v4', () => {
  const v3 = {
    exams: [
      { id: 'E9', schema: 1, course: 'NUR 112', kind: 'unit', title: 'Exam 9', status: 'upcoming', source: 'made up' },
    ],
  };
  const { writes, seed, migrated } = seedStaging(v3, { at: AT, exportedAt: EXPORTED });
  assert.equal(migrated, true);
  assert.equal(seed.migration, 'v3-to-v4');
  const exam = writes.find(w => w.collection === 'exams' && w.id === 'E9');
  assert.ok(
    exam && exam.data.schema === 2 && typeof exam.data.writer === 'string',
    "the exam is a v4 document at today's version"
  );
  assert.ok(
    writes.some(w => w.collection === 'legacy' && w.id === 'v3-exams-E9'),
    'the v3 original is kept in legacy'
  );
  for (const w of writes)
    assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
});

test('collectionHash ignores order and envelope; seedAgeDays counts whole days and never goes negative', () => {
  const a = [
    { id: 'x', schema: 1, writer: 'page', at: '2026-10-17T00:00:00Z', source: 's', v: 1 },
    { id: 'y', schema: 1, writer: 'page', at: '2026-10-17T00:00:00Z', source: 's', v: 2 },
  ];
  const b = [{ ...a[1], at: '2026-10-18T00:00:00Z' }, a[0]];
  assert.equal(collectionHash(a), collectionHash([...a].reverse()));
  assert.notEqual(collectionHash(a), collectionHash([{ ...a[0], v: 9 }, a[1]]));
  assert.match(collectionHash(b), /^[0-9a-f]{64}$/);
  const seed = { exportedAt: '2026-10-18T05:02:42Z' };
  assert.equal(seedAgeDays(seed, '2026-10-18T23:00:00Z'), 0);
  assert.equal(seedAgeDays(seed, '2026-10-20T06:00:00Z'), 2);
  assert.equal(seedAgeDays(seed, '2026-10-17T00:00:00Z'), 0);
});

test('cli seed-staging writes a plan whose last batch is the seed stamp alone, every batch within the cap', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-seed-'));
  const from = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-export-'));
  fs.cpSync(path.join(ROOT, 'test/data/record'), from, { recursive: true });
  fs.rmSync(path.join(from, 'journal'), { recursive: true, force: true });
  const log = execFileSync(
    'node',
    [
      path.join(ROOT, 'core/cli.mjs'),
      'seed-staging',
      '--from',
      from,
      '--exported-at',
      EXPORTED,
      '--at',
      AT,
      '--out',
      out,
    ],
    { encoding: 'utf8' }
  );
  assert.match(log, /seed-staging: \d+ writes in \d+ batches to the staging record/);
  const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'));
  assert.equal(plan.target, 'staging');
  assert.match(plan.record, /^https:\/\/claude\.ai\/artifact\//);
  const lastBatch = plan.batches.at(-1);
  assert.equal(lastBatch.length, 1);
  assert.deepEqual([lastBatch[0].collection, lastBatch[0].doc_id], ['system', 'seed']);
  for (const b of plan.batches) {
    assert.ok(b.length <= 50);
    const ids = b.map(w => w.collection + '/' + w.doc_id);
    assert.equal(new Set(ids).size, ids.length, 'one write per document per batch');
    for (const w of b) assert.ok(fs.existsSync(w.file_path), `${w.file_path} exists`);
  }
});
