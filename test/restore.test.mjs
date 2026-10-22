// B-163 (D-186): the restore drill migrates. A backup older than this build's schemas is checked against its own
// manifest as written, carried through the bumps to this build's schemas, validated, and restored; it refuses only a
// backup newer than this build's schema and a version with no migration, each with the reason quoted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import * as RUN from '../core/run.mjs';
import { collectionHash, migrateBackup } from '../core/seed.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { lintRecord } from '../core/lint.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const AT = '2026-11-02T02:55:00Z';
const PATH = '/Users/x/E.V. Study Watch/staging/backup/E.V.-v4-backup-sunday.json';

/** The fixture record as a pulled run folder (every document at version 3), and as {collection: [docs]}. */
function pullFixture(dir) {
  const versions = {};
  for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record'))) {
    if (collection === 'journal' || collection === 'system') continue;
    const f = path.join(dir, 'pull', collection, id + '.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(EV.docData({ ...doc, id })));
    (versions[collection] = versions[collection] || {})[id] = 3;
  }
  fs.writeFileSync(path.join(dir, 'versions.json'), JSON.stringify(versions));
}

/** A backup as a v4.0 build wrote it before this week's bumps: the fixture's documents taken back to schema 1. */
function oldBackup(db) {
  const down = {
    days: d => {
      const { shadow, readiness, ...r } = d;
      return { ...r, schema: 1 };
    },
    ideas: d => {
      const { kind, ...r } = d;
      return { ...r, schema: 1 };
    },
    weeks: d => {
      const { readiness, ...rollups } = d.rollups || {};
      const { insights, ...rest } = d;
      return { ...rest, schema: 1, health: d.health.summary, rollups };
    },
    exams: d => {
      const edit = (db.examedits || []).find(e => e.id === d.id);
      return {
        ...d,
        schema: 1,
        ...(edit && typeof edit.score === 'number' ? { score: edit.score, scoreAt: edit.scoreAt } : {}),
      };
    },
    planedits: d => ({ ...d, schema: 1 }),
    sets: d => ({ ...d, schema: 1 }),
    talk: d => ({ ...d, schema: 1 }),
  };
  const collections = {};
  for (const [c, docs] of Object.entries(db)) {
    if (c === 'journal' || c === 'system') continue;
    collections[c] = docs.map(d => (down[c] && d.schema > 1 ? down[c](d) : d));
  }
  return seal(collections);
}
/** A backup's own manifest (counts and hashes) over its documents as written. */
function seal(collections) {
  const counts = {},
    hashes = {};
  for (const [c, docs] of Object.entries(collections)) {
    counts[c] = docs.length;
    hashes[c] = collectionHash(docs);
  }
  return { kind: 'E.V. record backup', at: '2026-10-18T01:20:00Z', release: 'v4.0.0', counts, hashes, collections };
}

function drill(b) {
  const dir = tmp('ev4-restore-');
  RUN.start({ spec, pipeline: 'restore-drill', record: 'staging', at: AT, dir, release: 'v4.3.0' });
  RUN.pull({ spec, dir, at: AT });
  pullFixture(dir);
  assert.equal(RUN.compute({ spec, dir, validate, at: AT }).status, 'waiting');
  fs.mkdirSync(path.join(dir, 'in'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'in/backup.json'), JSON.stringify(b));
  fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'answers/fetch-backup.json'), JSON.stringify({ status: 'ok', path: PATH }));
  return { dir, r: RUN.compute({ spec, dir, validate, at: AT }) };
}

test('B-163: a schema-1 backup restores into a throwaway store, migrated to this build, and lints green', () => {
  const src = tmp('ev4-src-');
  pullFixture(src);
  const db = RUN.loadPulled(src);
  const b = oldBackup(db);
  assert.equal(b.collections.days[0].schema, 1, 'the planted backup is at schema 1');
  assert.ok(!('shadow' in b.collections.days[0]));
  const { r } = drill(b);
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  // The run document names, per collection, the schema restored from and the one migrated to.
  assert.match(r.plan.detail, /counts and hashes match its manifest; migrated to this build: /);
  for (const c of ['days', 'exams', 'ideas', 'planedits', 'sets', 'talk', 'weeks'])
    assert.match(
      r.plan.detail,
      new RegExp(`\\b${c} schema 1 to ${{ days: 3, sets: 3, talk: 3, weeks: 4 }[c] || 2} \\(\\d+\\)`),
      c
    );
  // Migrated, the backup is the fixture again, but for what schema 1 never held: the fixture day's shadow pick (B-68)
  // and the day's and the week's readiness stamps (B-48), which a migrated document carries as null. Only those two
  // documents are written back.
  assert.notEqual(db.days[0].shadow, null, 'the fixture day has a shadow pick');
  assert.deepEqual(
    r.plan.batches.flat().map(w => `${w.collection}/${w.doc_id}`),
    ['days/2026-10-16', 'weeks/2026-10-11'],
    'only what the migration cannot rebuild differs'
  );
  // The throwaway store as the restore leaves it lints with no errors.
  const store = {};
  for (const [c, docs] of Object.entries(migrateBackup(b.collections, versionsOf(), { at: AT }).collections))
    store[c] = docs;
  const errors = lintRecord(store, spec, validate, { date: '2026-11-01' }).issues.filter(i => i.severity === 'error');
  assert.deepEqual(errors, []);
});

test('B-163: a lost document comes back at the current schema, and an exam score becomes its Edit', () => {
  const src = tmp('ev4-src-');
  pullFixture(src);
  const db = RUN.loadPulled(src);
  const b = oldBackup(db);
  // As if the record lost a day after the backup: the backup's schema-1 copy is restored at schema 2.
  const lost = { ...b.collections.days[0], id: '2026-10-15', date: '2026-10-15' };
  b.collections.days.push(lost);
  // An exam score the backup holds on the exam (before D-094), with no examedits document for it.
  const exam = b.collections.exams.find(e => typeof e.score !== 'number');
  Object.assign(exam, { score: 88, scoreAt: '2026-10-10T15:00:00Z' });
  const sealed = seal(b.collections);
  const { r } = drill(sealed);
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  const writes = r.plan.batches.flat().map(w => `${w.collection}/${w.doc_id}`);
  assert.ok(writes.includes('days/2026-10-15'), writes.join(' '));
  assert.ok(writes.includes(`examedits/${exam.id}`), writes.join(' '));
  assert.match(r.plan.detail, /exams schema 1 to 2 \(\d+\); /);
  assert.match(r.plan.detail, /examedits at 1, 1 added by the migration/);
});

const versionsOf = () =>
  Object.fromEntries(
    fs
      .readdirSync(path.join(ROOT, 'spec/schemas'))
      .filter(f => f.endsWith('.schema.json'))
      .map(f => [
        f.slice(0, -12),
        JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/schemas', f), 'utf8'))['x-ev'].schema || 1,
      ])
  );

test('B-163: a backup newer than this build, and a version with no migration, are refused with the reason', async () => {
  const steps = await import('../core/steps.mjs');
  const src = tmp('ev4-src-');
  pullFixture(src);
  const db = RUN.loadPulled(src);
  // Newer: a days document at schema 3, written by a build past this one.
  const newer = oldBackup(db);
  newer.collections.days[0] = { ...newer.collections.days[0], schema: 4 };
  const n = drill(seal(newer.collections)).r;
  assert.equal(n.status, 'refused');
  assert.match(n.problems.join(' '), /days\/2026-10-16 is at schema 4, newer than this build's 3/);
  // No migration: this build's registry at days 3 with no bump from 2 to 3.
  const ctx = { now: AT };
  const m = steps.planRestore(seal(oldBackup(db).collections), db, ctx, spec, 'backup', { ...versionsOf(), days: 4 });
  assert.match(
    m.problems.join(' '),
    /days\/2026-10-16 is at schema 1 and this build's is 4, but there is no migration from schema 3 to 4/
  );
  // Today's refusal (B-27, Oct 21) was this backup's shape: it now restores.
  assert.equal(drill(oldBackup(db)).r.status, 'planned');
  // The first staging drill on B-163 (runs/restore-drill-20261021-112917045): legacy keeps copies as they were, so a
  // copy at schema 2 is restored as written, never refused or migrated.
  const copy = {
    id: 'v3-materials-NUR112-1',
    schema: 2,
    writer: 'canvas-sync',
    at: '2026-10-18T00:00:00Z',
    source: 'x',
    migratedTo: 'materials/NUR112-1',
  };
  const withCopy = oldBackup(db);
  withCopy.collections.legacy = [...(withCopy.collections.legacy || []), copy];
  const rec = { ...db, legacy: [...(db.legacy || []), copy] };
  const kept = steps.planRestore(seal(withCopy.collections), rec, ctx, spec, 'backup');
  assert.ok(!kept.problems, JSON.stringify(kept.problems));
  assert.match(kept.detail, /^drill ok: /);
  assert.ok(!kept.writes.some(w => w.collection === 'legacy'), 'the copy is already identical: kept as written');
  // The Oct 21 drill on the Wednesday backup (runs/restore-drill-20261022-015856964): v3-era documents with no envelope
  // (a run log with no schema or writer, from before the Oct 18 cutover) are kept as written and named, never refused.
  const v3run = { id: '2026-10-17-canvas', at: '2026-10-17T01:15:00Z', pipeline: 'canvas', status: 'ok' };
  const withV3 = oldBackup(db);
  withV3.collections.runs = [...(withV3.collections.runs || []), v3run];
  const pre = steps.planRestore(
    seal(withV3.collections),
    { ...db, runs: [...(db.runs || []), v3run] },
    ctx,
    spec,
    'backup'
  );
  assert.ok(!pre.problems, JSON.stringify(pre.problems));
  assert.match(pre.detail, /1 pre-v4 documents \(no envelope\) kept as written: runs\/2026-10-17-canvas/);
  // A v4 document (it has an envelope) that fails its shape is still refused.
  const bad = oldBackup(db);
  bad.collections.runs = [
    ...(bad.collections.runs || []),
    { ...v3run, id: 'x-bad', schema: 1, writer: 'morning', source: 's' },
  ];
  assert.match(
    steps.planRestore(seal(bad.collections), db, ctx, spec, 'backup').problems.join(' '),
    /runs\/x-bad after migration/
  );
});

test('B-163: evening-mac names its backup schema versions; health says how many bumps behind the latest backup is', async () => {
  const { backupSchemaLine } = await import('../core/steps.mjs');
  const { latestBackup, healthBody } = await import('../core/watch.mjs');
  const { BUMPS, currentVersion } = await import('../core/migrate.mjs');
  const src = tmp('ev4-src-');
  pullFixture(src);
  const db = RUN.loadPulled(src);
  const now = { ...db };
  delete now.journal;
  assert.equal(
    backupSchemaLine(now),
    'schema versions ' +
      Object.keys(BUMPS)
        .sort()
        .filter(c => (db[c] || []).length)
        .map(c => c + ':' + currentVersion(c))
        .join(' ')
  );
  assert.equal(backupSchemaLine({ days: [{ id: 'x', schema: 1 }] }), 'schema versions all 1');
  const run = (detail, at) => ({
    id: 'evening-mac-' + at,
    pipeline: 'evening-mac',
    status: 'ok',
    startedAt: at,
    steps: [{ id: 'mac-files', status: 'ok', detail }],
  });
  const cur = run(
    `backup backup/E.V.-v4-backup-wednesday.json (370 documents, 812 KB; ${backupSchemaLine(now)})`,
    '2026-10-22T01:20:00Z'
  );
  const old = run(
    'backup backup/E.V.-v4-backup-sunday.json (370 documents, 800 KB; schema versions all 1)',
    '2026-10-19T01:20:00Z'
  );
  const pre = run('backup backup/E.V.-v4-backup-saturday.json (370 documents, 800 KB)', '2026-10-18T01:20:00Z');
  const allBehind = Object.keys(BUMPS).reduce((n, c) => n + currentVersion(c) - 1, 0);
  const behindNow = Object.keys(BUMPS)
    .filter(c => !(db[c] || []).length)
    .reduce((n, c) => n + currentVersion(c) - 1, 0);
  assert.equal(latestBackup([old, cur, pre]).behind, behindNow, 'the newest backup is the one counted');
  assert.equal(latestBackup([old, pre]).behind, allBehind, 'all at 1: every bump this build has');
  assert.equal(latestBackup([pre]).behind, null, 'a run before the line: unknown, not a count');
  assert.equal(latestBackup([{ ...cur, status: 'failed' }]), null);
  // health/current carries it.
  const h = healthBody(
    { ...db, runs: [...(db.runs || []), old] },
    { now: '2026-10-20T12:00:00Z', record: 'staging' },
    spec
  );
  assert.deepEqual(h.backup, {
    run: old.id,
    at: old.startedAt,
    file: 'backup/E.V.-v4-backup-sunday.json',
    behind: allBehind,
  });
});

// B-163 as the Oct 21 drills found it: the Wednesday backup held v3-era runs with no v4 envelope, legacy copies that
// keep the writer that made them (page, worker, …), and the Oct 19 skills-checklist exchange. Each is restored as the
// backup holds it; the identifier stage (B-197) still looks at every word, and a practice verdict passes it.
test('B-163, B-197: v3-era runs and legacy copies restore as written; the checklist DOB waits on the judgment and passes', () => {
  const src = tmp('ev4-src-');
  pullFixture(src);
  const db = RUN.loadPulled(src);
  const v3run = {
    id: '2026-10-17-daily',
    at: '2026-10-17T04:47:00-05:00',
    routine: 'daily',
    status: 'ok',
    detail: 'v3 daily run',
    migratedTo: null,
    migratedAt: '2026-10-18T10:00:00Z',
  };
  const copy = {
    id: 'v4-talk-2026-10-19-s1',
    schema: 1,
    writer: 'page',
    at: '2026-10-19T18:20:00Z',
    source: 'E.V. Home',
    date: '2026-10-19',
    messages: {
      'm-20261019-182000000-matt': {
        role: 'matt',
        text: 'Skills validation run-through: what is your client’s name and date of birth?',
      },
      'm-20261019-182005000-ev': { role: 'ev', text: 'Per the checklist: my name is Ana Reyes, DOB: 04/12/1961.' },
    },
    migratedTo: 'talk/2026-10-19',
  };
  const b = seal({
    ...Object.fromEntries(Object.entries(db).filter(([c]) => c !== 'journal' && c !== 'system')),
    runs: [...(db.runs || []), v3run],
    legacy: [...(db.legacy || []), copy],
  });
  const { dir, r } = drill(b);
  assert.deepEqual([r.status, r.step], ['waiting', 'identifiers'], JSON.stringify(r.problems));
  const [c] = r.question.material.candidates;
  assert.equal(c.where, 'legacy/v4-talk-2026-10-19-s1');
  assert.match(c.around, /Skills validation run-through/);
  fs.writeFileSync(
    path.join(dir, 'answers/identifiers.json'),
    JSON.stringify({
      verdicts: [{ key: c.key, verdict: 'practice', reason: 'E.V. playing a skills-checklist client.' }],
    })
  );
  const p = RUN.compute({ spec, dir, validate, at: AT });
  assert.equal(p.status, 'planned', JSON.stringify(p.problems));
  const files = p.plan.batches.flat();
  const read = id => JSON.parse(fs.readFileSync(files.find(f => f.doc_id === id).file_path, 'utf8'));
  assert.equal(read('2026-10-17-daily').routine, 'daily', 'the v3-era run, as written');
  assert.equal(read('v4-talk-2026-10-19-s1').writer, 'page', 'the legacy copy keeps its writer');
  assert.match(JSON.stringify(read('v4-talk-2026-10-19-s1')), /DOB: 04\/12\/1961/, 'practice passes whole');
  assert.equal(read(c.key).verdict, 'practice', 'and the verdict is kept, so the next drill does not ask again');
});
