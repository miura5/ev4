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

function drill(b, { record = [] } = {}) {
  const dir = tmp('ev4-restore-');
  RUN.start({ spec, pipeline: 'restore-drill', record: 'staging', at: AT, dir, release: 'v4.3.0' });
  RUN.pull({ spec, dir, at: AT });
  pullFixture(dir);
  // Documents the staging record holds beside the fixture (his answers on the page, B-163).
  for (const d of record) {
    const f = path.join(dir, 'pull', d.collection, d.id + '.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(d.data));
  }
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
      new RegExp(`\\b${c} schema 1 to ${{ days: 4, sets: 3, talk: 4, weeks: 4 }[c] || 2} \\(\\d+\\)`),
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
  // Newer: a days document at a schema past this build's, written by a later build.
  const newer = oldBackup(db);
  newer.collections.days[0] = { ...newer.collections.days[0], schema: 5 };
  const n = drill(seal(newer.collections)).r;
  assert.equal(n.status, 'refused');
  assert.match(n.problems.join(' '), /days\/2026-10-16 is at schema 5, newer than this build's 4/);
  // No migration: a registry at days 5 with no bump from 4 to 5.
  const ctx = { now: AT };
  const m = steps.planRestore(seal(oldBackup(db).collections), db, ctx, spec, 'backup', { ...versionsOf(), days: 5 });
  assert.match(
    m.problems.join(' '),
    /days\/2026-10-16 is at schema 1 and this build's is 5, but there is no migration from schema 4 to 5/
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
// backup holds it; the identifier stage still looks at every word. Oct 22: the drill's own safety review refused it
// passing the checklist DOB on its own judgment, and Matt chose "Ask me on the page": the drill holds the value for
// him, leaves that document as the record has it and ends partial; after his It's made up the next drill passes it.
test('B-163, B-197: v3-era runs and legacy copies restore as written; the checklist DOB is held for Matt, then passes on his answer', () => {
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
  const key = EV.idKey('DOB: 04/12/1961');
  // 1. No judgment step: the run never waits to pass a value itself; it holds it.
  const first = drill(b);
  const r = first.r;
  assert.equal(r.status, 'planned', JSON.stringify(r.problems || r.step));
  const files = r.plan.batches.flat();
  const read = id => JSON.parse(fs.readFileSync(files.find(f => f.doc_id === id).file_path, 'utf8'));
  assert.equal(read('2026-10-17-daily').routine, 'daily', 'the v3-era run, as written');
  assert.ok(!files.some(f => f.doc_id === 'v4-talk-2026-10-19-s1'), 'the copy holding it is left as the record has it');
  const held = read(key);
  assert.deepEqual(
    [held.verdict, held.by, held.writer, held.ref],
    ['unsure', 'held', 'restore-drill', 'legacy/v4-talk-2026-10-19-s1']
  );
  assert.ok(!JSON.stringify(held).includes('04/12/1961'), 'the hold keeps a fingerprint, never the value');
  assert.ok(!files.some(f => fs.readFileSync(f.file_path, 'utf8').includes('04/12/1961')), 'nowhere in the plan');
  assert.match(
    r.plan.detail,
    /1 detail that could be a real patient's held for Matt to answer in E.V. Home \(B-04\); 1 document left as the record has it/
  );
  assert.equal(r.plan.held, 1);
  assert.deepEqual(
    EV.heldForMatt([{ ...held, id: key }]).map(h => [h.key, h.kind, h.ref]),
    [[key, 'has a date of birth', 'legacy/v4-talk-2026-10-19-s1']]
  );
  RUN.end({ dir: first.dir, at: AT });
  const end1 = JSON.parse(fs.readFileSync(path.join(first.dir, 'out/runs', r.plan.runId + '.end.json'), 'utf8'));
  assert.equal(end1.status, 'partial', 'a drill that left a document is not ok until he answers');
  assert.equal(
    end1.push,
    'Restore drill partly done: 1 detail waiting on you in Your turn; the rest matches the backup.',
    'a held drill never says passed'
  );
  assert.match(end1.detail, /1 detail that could be a real patient's held for Matt/);
  // 2. His It's made up on the page (idchecks/<key>-matt, practice) is read first: the next drill restores it whole.
  const matt = verdict => ({
    collection: 'idchecks',
    id: key + '-matt',
    data: {
      schema: 1,
      writer: 'page',
      at: AT,
      source: 'E.V. Home',
      release: 'v4.3.0',
      key,
      verdict,
      reason: 'Matt: it’s from a practice scenario',
      kind: 'has a date of birth',
      ref: 'legacy/v4-talk-2026-10-19-s1',
      by: 'matt',
    },
  });
  const heldDoc = { collection: 'idchecks', id: key, data: held };
  const second = drill(b, { record: [heldDoc, matt('practice')] });
  assert.equal(second.r.status, 'planned', JSON.stringify(second.r.problems));
  const f2 = second.r.plan.batches.flat();
  const copied = f2.find(f => f.doc_id === 'v4-talk-2026-10-19-s1');
  assert.ok(copied, 'restored now');
  assert.match(fs.readFileSync(copied.file_path, 'utf8'), /DOB: 04\/12\/1961/, 'practice passes whole');
  assert.ok(!f2.some(f => f.collection === 'idchecks'), 'nothing held again');
  assert.equal(second.r.plan.held, undefined);
  RUN.end({ dir: second.dir, at: AT });
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(second.dir, 'out/runs', second.r.plan.runId + '.end.json'), 'utf8')).status,
    'ok'
  );
  assert.deepEqual(
    EV.heldForMatt([
      { ...held, id: key },
      { ...matt('practice').data, id: key + '-matt' },
    ]),
    [],
    'answered: off his list'
  );
  // 3. His Keep it out (real) keeps it held, and no run asks again.
  const third = drill(b, { record: [heldDoc, matt('real')] });
  const f3 = third.r.plan.batches.flat();
  assert.ok(!f3.some(f => f.doc_id === 'v4-talk-2026-10-19-s1') && !f3.some(f => f.collection === 'idchecks'));
});

test('B-163: Your turn asks once per place a run held from; each value keeps its own kind; answered ones drop out', () => {
  const h = (key, kind, ref, at) => ({
    id: key,
    key,
    kind,
    ref,
    at,
    by: 'held',
    verdict: 'unsure',
    source: 'canvas-sync x',
  });
  const docs = [
    h('id-b', 'has a medical record number', 'files/case-study-3', '2026-10-22T12:00:01Z'),
    h('id-a', 'has a date of birth', 'files/case-study-3', '2026-10-22T12:00:00Z'),
    h('id-c', 'has a date of birth', 'files/case-study-4', '2026-10-22T12:00:02Z'),
    h('id-d', 'has a date of birth', 'files/case-study-3', '2026-10-22T12:00:03Z'),
    { id: 'id-d-matt', key: 'id-d', by: 'matt', verdict: 'practice' },
  ];
  assert.deepEqual(EV.heldByPlace(docs), [
    {
      ref: 'files/case-study-3',
      source: 'canvas-sync x',
      at: '2026-10-22T12:00:00Z',
      items: [
        { key: 'id-a', kind: 'has a date of birth' },
        { key: 'id-b', kind: 'has a medical record number' },
      ],
      kinds: ['a date of birth', 'a medical record number'],
    },
    {
      ref: 'files/case-study-4',
      source: 'canvas-sync x',
      at: '2026-10-22T12:00:02Z',
      items: [{ key: 'id-c', kind: 'has a date of birth' }],
      kinds: ['a date of birth'],
    },
  ]);
  assert.deepEqual(EV.heldByPlace([]), []);
});
