// lint and rebuild (B-07): rebuild reproduces every Derived fixture byte for byte; lint catches a planted wrong
// writer, a changed fact and an over-budget document, and a Derived document that drifted. The record is the
// synthetic one in test/data/record.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import EV from '../core/evcore.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { lintRecord } from '../core/lint.mjs';
import { rebuild, rebuildOne, asOf, produce, factHash, PRODUCERS, NOT_REBUILDABLE } from '../core/derive.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const RECORD = path.join(ROOT, 'test/data/record');
const load = () => {
  const db = {};
  for (const { collection, id, doc } of readExport(RECORD))
    (db[collection] = db[collection] || []).push({ ...doc, id });
  return db;
};
const lint = db => lintRecord(db, spec, validate, { date: '2026-10-17' });
const codes = (r, code) => r.issues.filter(i => i.code === code);
const doc = (db, col, id) => db[col].find(d => d.id === id);

test('rebuild reproduces every Derived fixture byte for byte, and names the ones without a producer', () => {
  const db = load();
  const results = rebuild(db, spec);
  const derived = Object.entries(db).flatMap(([c, ds]) =>
    ds
      .filter(
        d =>
          (spec.collections[c].documents && spec.collections[c].documents[d.id]
            ? spec.collections[c].documents[d.id].class
            : spec.collections[c].class) === 'Derived'
      )
      .map(d => `${c}/${d.id}`)
  );
  assert.deepEqual(results.map(r => r.ref).sort(), derived.sort(), 'every stored Derived document is visited');
  for (const r of results.filter(r => r.status !== 'skipped')) {
    assert.equal(r.status, 'same', r.ref);
    const [col, ...rest] = r.ref.split('/');
    assert.equal(
      JSON.stringify(r.data, null, 1),
      fs.readFileSync(path.join(RECORD, col, rest.join('/') + '.json'), 'utf8'),
      `${r.ref} byte for byte`
    );
  }
  assert.deepEqual(
    results
      .filter(r => r.status !== 'skipped')
      .map(r => r.ref.split('/')[0])
      .sort(),
    Object.keys(PRODUCERS).sort(),
    'one fixture per producer'
  );
  for (const r of results.filter(r => r.status === 'skipped'))
    assert.ok(NOT_REBUILDABLE[r.ref] || NOT_REBUILDABLE[r.ref.split('/')[0]], r.ref);
});

test('the fixture record lints green', () => {
  const r = lint(load());
  assert.deepEqual(
    r.issues.filter(i => i.severity !== 'info'),
    []
  );
});

test('lint catches a planted wrong writer, on a document and on an appended entry', () => {
  const db = load();
  const w = db.weakspots[0];
  w.writer = 'weekly';
  w.events = { ...w.events, [EV.eventKey('morning', '2026-10-16T12:00:00Z')]: { type: 'seen', by: 'E.V.' } };
  const r = lint(db);
  const wrong = codes(r, 'wrong-writer').map(i => i.ref);
  assert.ok(wrong.includes(`weakspots/${w.id}`));
  assert.ok(wrong.some(ref => ref.startsWith(`weakspots/${w.id}#events.morning-`)));
  assert.ok(
    r.issues.every(
      i => i.severity !== 'error' || ['wrong-writer', 'invalid', 'fact-changed', 'derived-differs'].includes(i.code)
    ),
    'nothing unrelated is reported'
  );
});

test('lint catches a planted changed fact, and not an appended event', () => {
  const db = load();
  const state = doc(db, 'state', 'current');
  const e = db.exams[0];
  assert.ok(state.factHashes[`exams/${e.id}`], 'the fixture state hashed this exam');
  const answers = db.answers[0];
  const first = Object.keys(answers.answers)[0];
  answers.answers[first] = {
    ...answers.answers[first],
    [EV.eventKey('page', '2026-10-17T15:00:00Z')]: { chosen: [0], correct: true, score: 1, at: '2026-10-17T15:00:00Z' },
  };
  assert.equal(codes(lint(db), 'fact-changed').length, 0, 'an append is not a change');
  e.title = 'A different title';
  assert.deepEqual(
    codes(lint(db), 'fact-changed').map(i => i.ref),
    [`exams/${e.id}`]
  );
  assert.equal(
    factHash(spec, 'exams', { ...e, at: '2030-01-01T00:00:00Z' }),
    factHash(spec, 'exams', e),
    'the envelope time is not a fact'
  );
});

test('lint catches a planted over-budget document: bytes, and a material past the text cap', () => {
  const db = load();
  const m = db.materials[0];
  m.text = 'Made-up course text. '.repeat(Math.ceil((spec.capacity.documentBytes + 10) / 21));
  const over = codes(lint(db), 'over-budget').map(i => i.ref + ' ' + i.msg);
  assert.ok(over.some(s => s.startsWith(`materials/${m.id} `) && /bytes; the budget is 262144/.test(s)));
  assert.ok(over.some(s => s.startsWith(`materials/${m.id} `) && /characters of text; the cap is 200000/.test(s)));
});

test('lint catches a Derived document that drifted from its rebuild', () => {
  const db = load();
  doc(db, 'days', '2026-10-16').push = 'Something no rebuild would say';
  const r = lint(db);
  assert.deepEqual(
    codes(r, 'derived-differs').map(i => i.ref),
    ['days/2026-10-16', 'state/current'],
    'state/current reads the day, so it moves with it'
  );
});

test('the record as of a time: later documents and entries are left out; an Edit changed since is named', () => {
  const db = load();
  const at = '2026-10-16T14:00:00Z';
  const late = EV.eventKey('page', '2026-10-16T20:00:00Z');
  const a = db.answers[0];
  const item = Object.keys(a.answers)[0];
  a.answers[item] = {
    ...a.answers[item],
    [late]: { chosen: [0], correct: true, score: 1, at: '2026-10-16T20:00:00Z' },
  };
  db.exams.push({
    id: 'E10',
    schema: 1,
    writer: 'canvas-sync',
    at: '2026-10-16T21:00:00Z',
    source: 'later',
    course: 'NUR 112',
    kind: 'unit',
    title: 'Later',
    status: 'upcoming',
  });
  const pe = db.planedits[0];
  pe.updatedAt = '2026-10-16T22:00:00Z';
  const { db: then, inexact } = asOf(db, at, spec);
  assert.ok(!then.exams.some(e => e.id === 'E10'));
  assert.ok(!(late in then.answers[0].answers[item]));
  assert.deepEqual(inexact, [`planedits/${pe.id}`]);
  assert.ok(!('journal' in then), 'no Derived document is rebuilt from the journal');
  assert.equal(rebuildOne(db, spec, 'state', doc(db, 'state', 'current')).status.startsWith('inexact-'), true);
});

test('a document migrated from v3 is not compared; it is rebuilt by its next run', () => {
  const db = load();
  db.days.push({
    id: '2026-10-15',
    schema: 1,
    writer: 'morning',
    at: '2026-10-15T09:25:00Z',
    source: 'migrated from v3',
    date: '2026-10-15',
    list: { items: [] },
  });
  const r = rebuildOne(db, spec, 'days', doc(db, 'days', '2026-10-15'));
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /migrated from v3/);
});

test("produce writes what its pipeline will: the producer's data under the run's envelope, valid for its schema", () => {
  const db = load();
  const day = produce(
    db,
    spec,
    'days',
    { date: '2026-10-17', now: '2026-10-17T09:25:00Z' },
    { source: 'morning run-x' }
  );
  assert.deepEqual([day.writer, day.at, day.source], ['morning', '2026-10-17T09:25:00.000Z', 'morning run-x']);
  assert.ok(validate('days', day, { id: '2026-10-17' }).ok);
  const st = produce(db, spec, 'state', {
    date: '2026-10-17',
    now: '2026-10-17T01:15:00Z',
    specVersion: spec.specVersion,
  });
  assert.equal(st.snapshot.specVersion, spec.specVersion);
  assert.equal(
    st.derivedHash,
    EV.derivedHash(EV.buildWeakspots({ weakspots: db.weakspots, sets: db.sets, answers: db.answers, exams: db.exams }))
  );
  assert.ok(validate('state', st, { id: 'current' }).ok);
});

test('cli: lint exits 0 green and 1 red; rebuild --out writes the regenerated documents', () => {
  const run = (...a) => {
    try {
      return { code: 0, out: execFileSync('node', [path.join(ROOT, 'core/cli.mjs'), ...a], { encoding: 'utf8' }) };
    } catch (e) {
      return { code: e.status, out: e.stdout };
    }
  };
  let r = run('lint', '--from', RECORD, '--date', '2026-10-17');
  assert.equal(r.code, 0);
  assert.match(r.out, /^lint: GREEN/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-lint-'));
  fs.cpSync(RECORD, dir, { recursive: true });
  const f = path.join(dir, 'exams', fs.readdirSync(path.join(dir, 'exams'))[0]);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), writer: 'weekly' }, null, 1));
  r = run('lint', '--from', dir, '--date', '2026-10-17');
  assert.equal(r.code, 1);
  assert.match(r.out, /NO  wrong-writer exams\//);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-rebuild-'));
  r = run('rebuild', 'days', 'state', '--from', RECORD, '--out', out);
  assert.equal(r.code, 0);
  assert.match(r.out, /rebuild: 2 reproduced, 0 differ/);
  assert.equal(
    fs.readFileSync(path.join(out, 'days', '2026-10-16.json'), 'utf8'),
    fs.readFileSync(path.join(RECORD, 'days', '2026-10-16.json'), 'utf8')
  );
});

test('a run ended after the as-of time reads as still running then', () => {
  const db = {
    runs: [
      {
        id: 'evening-cloud-x',
        schema: 1,
        writer: 'evening-cloud',
        at: '2026-10-18T06:00:00Z',
        source: 's',
        release: 'v4.0.0',
        pipeline: 'evening-cloud',
        startedAt: '2026-10-18T06:00:00Z',
        endedAt: '2026-10-18T06:02:00Z',
        status: 'ok',
        steps: [{ id: 'a', status: 'ok' }],
        planHash: 'f'.repeat(64),
        push: 'x',
      },
    ],
  };
  const mid = asOf(db, '2026-10-18T06:01:00Z', spec).db.runs[0];
  assert.deepEqual([mid.status, mid.endedAt, 'steps' in mid, 'push' in mid], ['running', null, false, false]);
  assert.equal(asOf(db, '2026-10-18T06:03:00Z', spec).db.runs[0].status, 'ok');
});

test('what changed while the producing run ran, or a Derived input rewritten since, makes a rebuild inexact', () => {
  const ledger = (id, startedAt, endedAt) => ({
    id,
    schema: 1,
    writer: id.split('-20')[0],
    at: startedAt,
    source: 's',
    release: 'v4.0.0',
    pipeline: id.split('-20')[0],
    startedAt,
    endedAt,
    status: 'ok',
    steps: [],
  });
  const db = {
    runs: [
      ledger('watchdog-20261018-060000000', '2026-10-18T06:00:00Z', '2026-10-18T06:01:30Z'),
      ledger('weekly-20261018-055000000', '2026-10-18T05:50:00Z', '2026-10-18T05:52:00Z'),
    ],
    health: [{ id: 'current', schema: 1, writer: 'watchdog', at: '2026-10-18T06:05:00Z', source: 'watchdog x' }],
  };
  const during = asOf(db, '2026-10-18T06:02:00Z', spec, { since: '2026-10-18T06:01:00Z' }).inexact;
  assert.deepEqual(during, ['runs/watchdog-20261018-060000000', 'health/current'], 'ended mid-run; rewritten since');
  assert.deepEqual(
    asOf(db, '2026-10-18T06:02:00Z', spec).inexact,
    ['health/current'],
    'with no run window, only the rewrite'
  );
  assert.deepEqual(
    asOf(db, '2026-10-18T06:02:00Z', spec, { since: '2026-10-18T06:01:00Z', self: 'watchdog-20261018-060000000' })
      .inexact,
    ['health/current'],
    'its own ledger entry never counts'
  );
});

test('a Derived document built by an earlier build is stale, a warning; by this build, an error', () => {
  const db = load();
  const day = doc(db, 'days', '2026-10-16');
  day.push = 'Something this build would not say';
  db.runs.push({
    id: 'morning-x',
    schema: 1,
    writer: 'morning',
    at: day.at,
    source: 's',
    release: 'v4.0.0',
    pipeline: 'morning',
    startedAt: day.at,
    endedAt: day.at,
    status: 'ok',
    commit: 'a'.repeat(40),
  });
  day.source = 'morning morning-x';
  const stale = lintRecord(db, spec, validate, { date: '2026-10-17', commit: 'b'.repeat(40) });
  assert.ok(codes(stale, 'derived-stale').some(i => i.ref === 'days/2026-10-16' && /build aaaaaaaaaaaa/.test(i.msg)));
  assert.ok(!codes(stale, 'derived-differs').some(i => i.ref === 'days/2026-10-16'));
  const same = lintRecord(db, spec, validate, { date: '2026-10-17', commit: 'a'.repeat(40) });
  assert.ok(codes(same, 'derived-differs').some(i => i.ref === 'days/2026-10-16'));
});

test('B-32 (D-089): marks change in place, a first write is not a change, and a planted unmarked change is red', () => {
  const db = load();
  const state = doc(db, 'state', 'current');
  for (const ref of [
    'dates/canvas-900001',
    'jobs/job-20261016-140000-sample-guide',
    'sessions/ss-20261016-200000-sample-note',
    'materials/NUR112-900002',
  ])
    assert.match(state.factHashes[ref], /^[0-9a-f]{64}\.[0-9a-z]+$/, ref);
  assert.ok(
    state.factFields.dates.includes('title') && !state.factFields.dates.includes('date'),
    'a mark is outside the hashed fields'
  );
  // A Canvas re-date, a fired job, a session ended (its marks plus first writes), a refetched file: all green.
  const d = doc(db, 'dates', 'canvas-900001');
  Object.assign(d, { date: '2026-12-01', dueAt: '2026-12-02T05:59:59Z', syncedAt: '2026-10-18T01:20:00Z' });
  const j = doc(db, 'jobs', 'job-20261016-140000-sample-guide');
  j.fired = '2026-10-17T12:00:00Z';
  const s = doc(db, 'sessions', 'ss-20261016-200000-sample-note');
  const hadSummary = s.summary !== undefined;
  Object.assign(s, { status: 'ended', endedAt: '2026-10-16T21:00:00Z', pending: {} });
  if (!hadSummary) s.summary = 'A first write when the session ends';
  const m = doc(db, 'materials', 'NUR112-900002');
  Object.assign(m, { text: (m.text || '') + ' [p9] Made-up added slide.', fetchedAt: '2026-10-18T01:20:00Z' });
  const green = lint(db);
  assert.deepEqual(codes(green, 'fact-changed'), [], JSON.stringify(codes(green, 'fact-changed')));
  // An unmarked field changed: red, naming the rule; a field removed: red too.
  d.title = 'A planted different title';
  const red = codes(lint(db), 'fact-changed');
  assert.deepEqual(
    red.map(i => i.ref),
    ['dates/canvas-900001']
  );
  assert.match(red[0].msg, /write-once \(marks: date, dueAt, syncedAt;/);
  delete j.title;
  assert.match(codes(lint(db), 'fact-changed').find(i => i.ref.startsWith('jobs/')).msg, /^title removed/);
});

test('B-32: a stored hash from before marks is not compared (no mask), so the first night after deploy is not red', () => {
  const db = load();
  const state = doc(db, 'state', 'current');
  state.factHashes = Object.fromEntries(Object.entries(state.factHashes).map(([k, v]) => [k, v.split('.')[0]]));
  delete state.factFields;
  doc(db, 'dates', 'canvas-900001').title = 'changed';
  assert.deepEqual(codes(lint(db), 'fact-changed'), []);
});

test('B-37 (D-093): lint warns on a planted 200 KiB state/current, and the state step splits the fact hashes past the budget', async () => {
  const db = load();
  const state = doc(db, 'state', 'current');
  state.snapshot = { ...state.snapshot, padding: 'Made-up padding. '.repeat(Math.ceil((200 * 1024) / 17)) };
  const warn = codes(lint(db), 'over-budget').filter(i => i.ref === 'state');
  assert.equal(warn.length, 1);
  assert.equal(warn[0].severity, 'warning');
  assert.match(warn[0].msg, /warns at 196608/);
  // The split: a planted budget small enough that tonight's state/current reaches it.
  const { CODE_STEPS } = await import('../core/steps.mjs');
  const small = JSON.parse(JSON.stringify(spec));
  small.capacity.collections.state.warnBytes = 2000;
  const fresh = load();
  delete fresh.journal;
  const ctx = { date: '2026-10-17', now: '2026-10-20T01:15:00.000Z', source: 'evening-cloud evening-cloud-test' };
  const r = CODE_STEPS.state(fresh, ctx, small);
  const ids = r.writes.map(w => w.id);
  assert.equal(ids[0], 'current');
  assert.ok(ids.length > 2 && ids.slice(1).every(id => /^facts-[a-z]+$/.test(id)), ids.join(','));
  const cur = r.writes[0].data;
  assert.deepEqual(cur.factHashes, {});
  assert.deepEqual(
    cur.factsSplit,
    ids.slice(1).map(id => id.slice(6))
  );
  for (const w of r.writes) assert.ok(validate('state', w.data, { id: w.id }).ok, w.id);
  // lint reads the hashes wherever they are: a change is still caught, and every split document rebuilds.
  const db2 = load();
  db2.state = r.writes.map(w => ({ ...w.data, id: w.id }));
  const res = lintRecord(db2, small, validate, { date: '2026-10-17' });
  assert.deepEqual(
    res.issues.filter(i => i.code === 'fact-changed'),
    []
  );
  for (const x of res.rebuilt.filter(x => x.ref.startsWith('state/'))) assert.match(x.status, /same$/, x.ref);
  db2.exams[0].title = 'A planted change';
  assert.deepEqual(
    lintRecord(db2, small, validate, { date: '2026-10-17' })
      .issues.filter(i => i.code === 'fact-changed')
      .map(i => i.ref),
    [`exams/${db2.exams[0].id}`]
  );
});

test("B-39/B-53: a schema bump's legacy copy keeps its writer, and the bumped Fact is a note until the next state rebuild", async () => {
  const { migrateBumps } = await import('../core/migrate.mjs');
  const db = load();
  const state = doc(db, 'state', 'current');
  const idea = doc(db, 'ideas', 'sample-idea');
  const ref = 'ideas/sample-idea';
  // The idea as it stood at schema 1, hashed by state/current then; the bump sets it at 2 and keeps the old form.
  const old = { ...idea, schema: 1 };
  delete old.kind;
  state.factHashes[ref] = factHash(spec, 'ideas', old, { fields: state.factFields.ideas });
  const { writes } = migrateBumps({ ideas: [old] }, { at: '2026-10-18T16:36:00Z' });
  db.ideas = db.ideas.filter(d => d.id !== 'sample-idea');
  db.legacy = db.legacy || [];
  for (const w of writes) db[w.collection].push({ ...w.data, id: w.id });
  const r = lint(db);
  assert.deepEqual(codes(r, 'wrong-writer'), [], "a legacy copy carries its original's writer");
  assert.deepEqual(codes(r, 'fact-changed'), []);
  assert.deepEqual(
    codes(r, 'fact-migrated').map(i => i.ref),
    [ref]
  );
  // A legacy copy that does not match the stored hash covers nothing: the change is red.
  doc(db, 'legacy', 'v4-ideas-sample-idea-s1').text = 'A planted different text';
  assert.deepEqual(
    codes(lint(db), 'fact-changed').map(i => i.ref),
    [ref]
  );
});

test('state/current rebuilds the same from a fuller export: it counts only what the evening-cloud run reads', () => {
  const db = load();
  db.debug = [{ id: 'made-up-debug', schema: 1, writer: 'evening-mac', at: '2026-10-16T01:00:00Z', source: 'test' }];
  const st = doc(db, 'state', 'current');
  assert.equal(
    rebuildOne(db, spec, 'state', st).status,
    rebuildOne({ ...db, debug: undefined }, spec, 'state', st).status
  );
  assert.ok(['same', 'inexact-same'].includes(rebuildOne(db, spec, 'state', st).status));
});

test('B-34 (D-090): frozen originals and spec.legacyCollections are notes, never errors; an unknown collection still warns', () => {
  const db = load();
  // A v3 leftover in a v4 collection, in its old shape and writer, marked by the migration: frozen, not invalid.
  db.runs = db.runs || [];
  // (dated after the fixture's state/current, so the stored snapshot's rebuild is not what is tested here)
  db.runs.push({
    id: 'made-up-v2-run',
    writer: 'v2-pipeline',
    at: '2026-10-30T09:00:00Z',
    kind: 'old',
    migratedAt: '2026-10-18T05:00:00Z',
  });
  db.daily = [{ id: '2026-09-30', writer: 'v3', at: '2026-09-30T09:00:00Z', text: 'A made-up v3 daily' }];
  const r = lint(db);
  assert.deepEqual(
    r.issues.filter(i => i.severity === 'error').map(i => i.ref),
    []
  );
  assert.deepEqual(
    r.issues.filter(i => i.ref === 'runs/made-up-v2-run'),
    [],
    'no invalid or wrong-writer on a frozen original'
  );
  assert.match(codes(r, 'frozen').find(i => i.ref === 'runs').msg, /^1 frozen original/);
  assert.equal(codes(r, 'frozen').find(i => i.ref === 'daily').severity, 'info');
  assert.deepEqual(codes(r, 'unknown-collection'), []);
  // A legacy copy is still checked against legacy's own schema.
  if (db.legacy && db.legacy.length) {
    db.legacy[0].migratedTo = 42;
    assert.ok(codes(lint(db), 'invalid').some(i => i.ref === `legacy/${db.legacy[0].id}`));
  }
  db.notacollection = [{ id: 'x', writer: 'page', at: '2026-10-01T00:00:00Z' }];
  assert.equal(codes(lint(db), 'unknown-collection').length, 1);
});

test("B-34: the two pre-v4 leftovers the live lint found are frozen notes, in code: a v2 test day and v3's system/code", () => {
  const db = load();
  // Made-up stand-ins in the shapes the live export had: no migratedAt on either.
  db.days = [
    ...(db.days || []),
    {
      id: '2026-09-16',
      date: '2026-09-16',
      schema: 1,
      source: 'migrated',
      runs: {
        'made-up-daily-test': {
          pipeline: 'v2 Daily list (test A-2)',
          status: 'ok',
          startedAt: '2026-09-17T03:11:39Z',
          endedAt: '2026-09-17T03:11:39Z',
        },
      },
    },
  ];
  db.system = [
    ...(db.system || []),
    {
      id: 'code',
      schema: 1,
      version: 'v3.2',
      commit: 'made-up',
      short: 'made-up',
      dirty: false,
      builtAt: '2026-10-16T00:00:00Z',
    },
  ];
  const r = lint(db);
  assert.deepEqual(
    r.issues.filter(i => i.severity === 'error' && /2026-09-16|system\/code/.test(i.ref)),
    [],
    JSON.stringify(r.issues.filter(i => i.severity === 'error'))
  );
  assert.match(codes(r, 'frozen').find(i => i.ref === 'days').msg, /^1 frozen original/);
  assert.match(codes(r, 'frozen').find(i => i.ref === 'system').msg, /^1 frozen original/);
  // A v4 document is never a leftover: a days document of today's shape with a bad field is still invalid.
  db.days.push({ ...db.days.find(d => d.id !== '2026-09-16' && d.schema), id: '2026-09-17', schema: 'x' });
  assert.ok(codes(lint(db), 'invalid').some(i => i.ref === 'days/2026-09-17'));
});

test('B-34 (D-090): the state step writes state/current.lint from its pull; a planted change is in it; state still rebuilds byte for byte', async () => {
  const { CODE_STEPS } = await import('../core/steps.mjs');
  const ctx = {
    date: '2026-10-17',
    now: '2026-10-20T01:15:00.000Z',
    source: 'evening-cloud evening-cloud-test',
    commit: 'c'.repeat(40),
  };
  const clean = load();
  delete clean.journal;
  const r = CODE_STEPS.state(clean, ctx, spec);
  const cur = r.writes.find(w => w.id === 'current').data;
  assert.equal(cur.lint.errors, 0);
  assert.equal(cur.lint.at, ctx.now);
  assert.equal(cur.lint.commit, ctx.commit);
  assert.ok(validate('state', cur, { id: 'current' }).ok);
  assert.match(r.say[0], /^Lint: 0 errors/);
  // Rebuild reproduces the new state/current byte for byte: the lint is taken as stored, as the date is.
  const after = load();
  after.state = [{ ...cur, id: 'current' }];
  const rb = rebuildOne(after, spec, 'state', after.state[0]);
  assert.match(rb.status, /same$/);
  assert.deepEqual(rb.data.lint, cur.lint);
  // A Fact changed since last night's hashes is caught by tonight's lint, before the hashes are taken again.
  const planted = load();
  delete planted.journal;
  planted.exams[0].title = 'A planted change';
  const lt = CODE_STEPS.state(planted, ctx, spec).writes.find(w => w.id === 'current').data.lint;
  assert.equal(lt.errors, 1);
  assert.deepEqual(
    lt.top.filter(i => i.severity === 'error').map(i => [i.code, i.ref]),
    [['fact-changed', `exams/${planted.exams[0].id}`]]
  );
  assert.equal(lt.top[0].code, 'fact-changed', 'errors first');
});

test("B-32 follow-up (Matt, Oct 18): a refetched file's pages, chars and ocr are marks; its title is still write-once", () => {
  const db = load();
  const m = doc(db, 'materials', 'NUR112-900002');
  Object.assign(m, {
    pages: (m.pages || 1) + 3,
    chars: (m.chars || 0) + 500,
    ocr: { by: 'Claude (E.V. Home)', at: '2026-10-18T01:20:00Z', pages: [2], stale: true },
    fetchedAt: '2026-10-18T01:20:00Z',
  });
  assert.deepEqual(codes(lint(db), 'fact-changed'), []);
  m.title = 'A planted renamed file.pdf';
  assert.deepEqual(
    codes(lint(db), 'fact-changed').map(i => i.ref),
    ['materials/NUR112-900002']
  );
});

test("B-150 (D-183): a planted 200 KiB system/spec warns, one past 240 KiB is an error, today's is clean", () => {
  const clean = load();
  assert.deepEqual(
    codes(lint(clean), 'over-budget').filter(i => i.ref.startsWith('system/')),
    [],
    "the synthetic record's system documents are under budget"
  );
  const db = load();
  const s = doc(db, 'system', 'spec');
  s.padding = 'Made-up padding. '.repeat(Math.ceil((200 * 1024) / 17));
  const warn = codes(lint(db), 'over-budget').filter(i => i.ref === 'system/spec');
  assert.equal(warn.length, 1);
  assert.equal(warn[0].severity, 'warning');
  assert.match(warn[0].msg, /a system document warns at 196608 \(spec\.capacity\.system\)/);
  s.padding = 'Made-up padding. '.repeat(Math.ceil((241 * 1024) / 17));
  const fail = codes(lint(db), 'over-budget').filter(i => i.ref === 'system/spec');
  assert.equal(fail[0].severity, 'error');
});
