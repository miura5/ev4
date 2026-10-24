// The v3 -> v4 migration (B-06): every split document, envelopes and writers, legacy copies,
// idempotence, and batch chunking. The v3 record below is made up; the real-export gate runs only where
// fixtures/v3-export exists (it is gitignored and never committed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import { currentVersion, migrateV3, applyWrites } from '../core/migrate.mjs';
import { chunkWrites, writeBytes } from '../core/batches.mjs';
import { loadValidator, readExport } from '../core/schemas.mjs';
import { describeErrors } from '../core/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));
const validate = loadValidator();
const AT = '2026-10-18T05:30:00Z';
const REAL = path.join(ROOT, 'fixtures/v3-export');

// Two right answers on different days make w1 solid (the v2 rule); w2 was parked by a legacy event; w3 is untouched.
const item = (id, weakspotId) => ({
  id,
  type: 'single',
  objective: 'E9-1',
  stem: 'A made-up question stem here?',
  options: ['a', 'b'],
  correct: [0],
  rationales: ['r', 'r'],
  ...(weakspotId ? { weakspotId } : {}),
  chapters: 'Fund 9',
});
const derived = d => ({
  status: 'open',
  streak: 0,
  nextDue: null,
  misses: 0,
  recurrence: 1,
  lastReviewed: null,
  lastResult: null,
  solidBy: null,
  solidAt: null,
  preRead: false,
  reopenedAt: null,
  answered: 0,
  right: 0,
  history: [],
  computedAt: '2026-10-17T00:00:00Z',
  by: 'page',
  ...d,
});
const V3 = {
  weakspots: [
    {
      id: 'w1',
      schema: 2,
      topic: 'Made-up topic one',
      objective: 'E9-1',
      exam: 'E9',
      course: 'NUR 112',
      kind: 'concept',
      source: 'test',
      addedAt: '2026-10-11T15:00:00Z',
      addedBy: 'E.V.',
      initial: { streak: 0, nextDue: '2026-10-12', recurrence: 1, misses: 0 },
      events: {},
      derived: derived({
        status: 'reviewed',
        streak: 2,
        nextDue: '2026-10-15',
        lastReviewed: '2026-10-13',
        lastResult: 'right',
        solidBy: 'review',
        solidAt: '2026-10-13T15:00:00.000Z',
        answered: 2,
        right: 2,
        history: [
          { correct: true, date: '2026-10-12' },
          { date: '2026-10-13', correct: true },
        ],
      }),
    },
    {
      id: 'w2',
      schema: 2,
      topic: 'Made-up topic two',
      objective: 'E9-1',
      exam: 'E9',
      course: 'NUR 112',
      kind: 'concept',
      source: 'test',
      addedAt: '2026-10-11T15:00:00Z',
      addedBy: 'page',
      initial: { streak: 0, nextDue: '2026-10-12', recurrence: 1, misses: 0 },
      parkedReason: 'not on the exam',
      events: {
        '2026-10-11T12:00:00Z': { type: 'park', by: 'legacy', note: 'not on the exam' },
        '2026-10-12T00:51:05-05:00': { type: 'seen', by: 'Study Watch' },
      },
      derived: derived({ status: 'parked', nextDue: '2026-10-13', recurrence: 2 }),
    },
    {
      id: 'w3',
      schema: 2,
      topic: 'Made-up topic three',
      objective: 'E9-2',
      exam: 'E9',
      course: 'NUR 112',
      kind: 'concept',
      source: 'test',
      addedAt: '2026-10-16T15:00:00Z',
      addedBy: 'page',
      initial: { streak: 0, nextDue: '2026-10-17', recurrence: 1, misses: 0 },
      events: {},
      derived: derived({ nextDue: '2026-10-17' }),
    },
  ],
  sets: [
    {
      id: 'review-2026-10-13',
      schema: 1,
      kind: 'review',
      date: '2026-10-13',
      title: 'Review',
      createdAt: '2026-10-13T04:25:00-05:00',
      source: 'morning',
      items: [item('q1', 'w1'), item('q2')],
      answers: { q1: { chosen: [0], correct: true, at: '2026-10-13T15:00:00Z', outcome: 'x' } },
      pastAttempts: [
        {
          endedAt: '2026-10-12T16:00:00Z',
          answers: { q1: { chosen: [0], correct: true, at: '2026-10-12T15:00:00Z' } },
        },
      ],
    },
  ],
  days: [
    {
      id: '2026-10-13',
      schema: 1,
      date: '2026-10-13',
      dayType: 'class',
      source: 'morning',
      list: { items: [{ id: 'plan-t1', text: 'Read', tag: 'READING', minutes: 45 }], focus: [] },
      push: 'Class day',
      checks: { 'plan-t1': { at: '2026-10-13T20:00:00Z' }, gone: null },
      added: {
        'add-x': { text: 'Made-up added item', kind: 'todo', minutes: 10, at: '2026-10-13T18:00:00Z', by: 'Matt' },
      },
      skipped: { 'plan-t9': { at: '2026-10-13T19:00:00Z', by: 'Matt' }, 'plan-t8': null },
      checkin: { energy: 2, at: '2026-10-13T12:00:00Z' },
      runs: {
        'morning-0425': {
          pipeline: 'morning',
          startedAt: '2026-10-13T09:25:00Z',
          endedAt: '2026-10-13T09:31:00Z',
          status: 'ok',
          steps: [{ id: 'plan', status: 'ok' }],
        },
        'old-v2': { pipeline: 'v2 Daily list', startedAt: '2026-10-13T09:00:00Z', status: 'ok' },
      },
      weekly: { review: 'A made-up week.', at: '2026-10-13T22:57:00Z' },
    },
  ],
  dates: [
    {
      id: 'canvas-1',
      schema: 1,
      source: 'Canvas',
      canvasId: 1,
      date: '2026-10-20',
      title: 'Made-up quiz',
      kind: 'due',
      graded: true,
      course: 'NUR 112',
      notes: 'Covers Ch 9',
      editedAt: '2026-10-14T01:00:00Z',
      editedBy: 'Matt',
      syncedAt: '2026-10-12T01:00:00Z',
    },
    {
      id: 'own-1',
      schema: 1,
      source: 'owner',
      date: '2026-10-21',
      title: 'Made-up study block',
      kind: 'other',
      graded: false,
      course: 'BIO 201',
      addedAt: '2026-10-12T01:00:00Z',
      removed: { at: '2026-10-14T02:00:00Z', by: 'Matt' },
    },
    { id: 'plain', date: '2026-10-22', title: 'Made-up plan date', kind: 'clinical', course: 'NUR 112' },
  ],
  plans: [
    {
      id: 'E9',
      schema: 1,
      exam: 'E9',
      title: 'Exam 9 plan',
      sourceUrl: 'https://example.com/plan',
      source: 'Exam plan',
      createdAt: '2026-10-10T00:00:00Z',
      days: [{ date: '2026-10-13', label: 'Tue 10/13', tasks: [{ id: 't1', text: 'Read Ch 9', kind: 'reading' }] }],
      done: { t1: { at: '2026-10-13T20:00:00Z' } },
    },
  ],
  jobs: [
    {
      id: 'job-20261013-150000-guide',
      schema: 1,
      kind: 'study-guide',
      title: 'Made-up guide',
      brief: 'Made-up brief',
      createdAt: '2026-10-13T15:00:00Z',
      status: 'done',
      fired: { at: '2026-10-13T15:00:01Z', ok: true },
      startedAt: '2026-10-13T15:01:00Z',
      finishedAt: '2026-10-13T15:09:00Z',
      result: { text: 'Done.', links: [{ title: 'Guide', url: 'https://example.com/g' }] },
    },
  ],
  materials: [
    {
      id: 'up-2026-10-13-sheet',
      schema: 2,
      course: 'NUR 112',
      kind: 'upload',
      title: 'Made-up sheet',
      fileType: 'pdf',
      text: '[p1] Made-up text',
      chars: 16,
      source: 'upload',
      addedBy: 'Matt',
      addedAt: '2026-10-13T01:00:00Z',
      status: 'removed',
    },
    {
      id: 'NUR112-5',
      schema: 1,
      course: 'NUR 112',
      title: 'Ch 9 slides.pdf',
      module: 'Exam 9',
      text: '[p1] Made-up slide',
      chars: 18,
      source: 'Canvas',
      fileId: 5,
      fetchedAt: '2026-10-12T01:00:00Z',
      needsOcr: false,
    },
  ],
  talk: [
    {
      id: '2026-10-13',
      schema: 1,
      date: '2026-10-13',
      messages: {
        m20261013150000123m: { role: 'matt', text: 'Made up?', at: '2026-10-13T15:00:00.123Z' },
        m20261013150001456e: {
          role: 'ev',
          text: 'Made up.',
          at: '2026-10-13T15:00:01.456Z',
          replyTo: 'm20261013150000123m',
        },
      },
    },
    { id: 'memory', schema: 1, summary: '', upTo: 'm20261013150001456e', lastSeenAt: '2026-10-13T16:00:00Z' },
  ],
  exams: [
    {
      id: 'E9',
      schema: 1,
      course: 'NUR 112',
      kind: 'unit',
      date: '2026-10-30',
      title: 'Exam 9',
      status: 'upcoming',
      source: 'Exam 9 plan',
      prediction: { predictedRange: [80, 88] },
    },
  ],
  objectives: [{ id: 'E9-1', exam: 'E9', num: 1, text: 'Made-up objective', chapters: 'Ch 9', source: 'plan' }],
  sessions: [
    {
      id: '2026-10-13-1900-Made-up',
      schema: 1,
      date: '2026-10-13',
      topic: 'Made-up',
      source: 'Study Watch',
      filedAt: '2026-10-13T00:51:05-05:00',
      summary: 'Made up.',
      weakSpots: [],
      cardCount: 0,
    },
  ],
  ideas: [
    {
      id: 'made-up-idea',
      schema: 1,
      text: 'A made-up idea',
      objective: '',
      status: 'open',
      source: 'Study Watch',
      links: [{ to: 'sessions/2026-10-13-1900-Made-up', type: 'seen-in', createdAt: '2026-10-13T00:51:05-05:00' }],
    },
  ],
  announcements: [
    {
      id: 'canvas-9',
      schema: 1,
      course: 'NUR 112',
      title: 'Made up',
      text: 'Made-up announcement',
      postedAt: '2026-10-12T14:00:00Z',
      source: 'Canvas',
    },
  ],
  state: [{ id: 'current', schema: 1, date: '2026-10-13' }],
  system: [{ id: 'code', schema: 2, version: '3.5.0' }],
  reviews: [{ id: '2026-10-01', migratedTo: 'sets/review-2026-10-01' }],
  runs: [{ id: '2026-10-01-daily', routine: 'Daily list', at: '2026-10-01T09:00:00Z', migratedTo: 'days/2026-10-01' }],
};
const write = (r, col, id) => r.writes.find(w => w.collection === col && w.id === id);

test('every migrated write validates against its v4 schema and carries the envelope', () => {
  const r = migrateV3(V3, { at: AT });
  for (const w of r.writes) {
    const v = validate(w.collection, w.data, { id: w.id });
    assert.ok(v.ok, describeErrors(`${w.collection}/${w.id}`, v));
    if (w.collection !== 'legacy') {
      assert.equal(w.data.schema, currentVersion(w.collection), `${w.collection}/${w.id} at today's version`);
      assert.ok(w.data.writer && w.data.at && w.data.source, `${w.collection}/${w.id} envelope`);
    }
  }
  assert.deepEqual(
    r.skipped.map(s => s.ref),
    ['days/2026-10-13#runs/old-v2']
  );
});

test('weak spots: derived dropped, events keyed <writer>-<time> with their original instant, writers by role', () => {
  const r = migrateV3(V3, { at: AT });
  const w1 = write(r, 'weakspots', 'w1').data,
    w2 = write(r, 'weakspots', 'w2').data;
  assert.ok(!('derived' in w1));
  assert.equal(w1.writer, 'morning');
  assert.equal(w2.writer, 'page');
  assert.deepEqual(Object.keys(w2.events), ['page-20261011-120000000', 'filing-20261012-055105000']);
  assert.equal(
    w2.events['filing-20261012-055105000'].at,
    '2026-10-12T05:51:05.000Z',
    'the entry keeps its instant, in UTC'
  );
  assert.equal(w2.at, '2026-10-11T15:00:00.000Z');
});

test('sets: items stay, every attempt moves to answers/<setId>, past attempts included', () => {
  const r = migrateV3(V3, { at: AT });
  const s = write(r, 'sets', 'review-2026-10-13').data;
  assert.ok(!('answers' in s) && !('pastAttempts' in s));
  assert.deepEqual(s.items, V3.sets[0].items);
  assert.equal(s.createdAt, '2026-10-13T09:25:00.000Z', 'offset times become UTC');
  const a = write(r, 'answers', 'review-2026-10-13').data;
  assert.deepEqual(Object.keys(a.answers.q1), ['page-20261012-150000000', 'page-20261013-150000000']);
  assert.equal(a.setId, 'review-2026-10-13');
});

test('days split four ways: Derived day, dayedits (no nulls), runs/<id> per v3 run, weeks/<date>', () => {
  const r = migrateV3(V3, { at: AT });
  const d = write(r, 'days', '2026-10-13').data;
  assert.deepEqual(Object.keys(d).sort(), [
    'aim',
    'at',
    'date',
    'dayType',
    'list',
    'plan',
    'push',
    'readiness',
    'schema',
    'shadow',
    'source',
    'writer',
  ]);
  assert.equal(d.shadow, null, 'B-68: a v3 day had no shadow');
  assert.equal(d.aim, null, 'B-170: nor an aim');
  assert.equal(d.schema, 4);
  const e = write(r, 'dayedits', '2026-10-13').data;
  assert.deepEqual(Object.keys(e.checks), ['plan-t1']);
  assert.deepEqual(Object.keys(e.skipped), ['plan-t9']);
  assert.equal(e.added['add-x'].by, 'Matt');
  assert.equal(e.checkin.energy, 2);
  assert.equal(e.updatedAt, '2026-10-13T20:00:00.000Z');
  const runs = r.writes.filter(w => w.collection === 'runs');
  assert.equal(runs.length, 1);
  assert.match(runs[0].id, /^morning-20261013-092500-[0-9a-f]{4}$/);
  assert.equal(runs[0].data.release, 'v3');
  assert.equal(write(r, 'weeks', '2026-10-13').data.review, 'A made-up week.');
});

test("dates: removal and Matt's notes on a Canvas entry move to dateedits; owner fields stay", () => {
  const r = migrateV3(V3, { at: AT });
  const c = write(r, 'dates', 'canvas-1').data;
  assert.equal(c.writer, 'canvas-sync');
  assert.ok(!('notes' in c) && !('editedAt' in c));
  assert.equal(write(r, 'dateedits', 'canvas-1').data.notes, 'Covers Ch 9');
  const own = write(r, 'dates', 'own-1').data;
  assert.equal(own.writer, 'page');
  assert.ok(!('removed' in own));
  assert.deepEqual(write(r, 'dateedits', 'own-1').data.removed, { at: '2026-10-14T02:00:00.000Z', by: 'Matt' });
  assert.equal(write(r, 'dateedits', 'plain'), undefined, 'no edit when there was nothing to move');
  const live = EV.liveDates(
    applyWrites(V3, r.writes).dates.filter(d => d.writer),
    applyWrites(V3, r.writes).dateedits
  );
  assert.deepEqual(live.map(d => d.id).sort(), ['canvas-1', 'plain']);
  assert.equal(live.find(d => d.id === 'canvas-1').notes, 'Covers Ch 9');
});

test('plans, jobs, materials, talk and the rest: ticks to planedits, results to jobresults, removal to materialedits, talk keys rewritten', () => {
  const r = migrateV3(V3, { at: AT });
  assert.ok(!('done' in write(r, 'plans', 'E9').data));
  assert.deepEqual(Object.keys(write(r, 'planedits', 'E9').data.ticks), ['t1']);
  const j = write(r, 'jobs', 'job-20261013-150000-guide').data;
  assert.ok(!('status' in j) && !('result' in j));
  assert.equal(write(r, 'jobresults', 'job-20261013-150000-guide').data.status, 'done');
  assert.ok(!('status' in write(r, 'materials', 'up-2026-10-13-sheet').data));
  assert.equal(write(r, 'materialedits', 'up-2026-10-13-sheet').data.removed.by, 'Matt');
  assert.equal(write(r, 'materials', 'NUR112-5').data.kind, 'slides', 'an older material gets the kind v3 inferred');
  const t = write(r, 'talk', '2026-10-13').data;
  assert.deepEqual(Object.keys(t.messages), ['m-20261013-150000123-matt', 'm-20261013-150001456-ev']);
  assert.equal(t.messages['m-20261013-150001456-ev'].replyTo, 'm-20261013-150000123-matt');
  assert.equal(write(r, 'talk', 'memory').data.upTo, 'm-20261013-150001456-ev');
  assert.ok(!('prediction' in write(r, 'exams', 'E9').data));
  assert.equal(write(r, 'sessions', '2026-10-13-1900-Made-up').data.writer, 'filing');
});

test('nothing is lost: every v3 document has a legacy copy marked migratedTo (or kept as written), state and system are not migrated', () => {
  const r = migrateV3(V3, { at: AT });
  const legacy = r.writes.filter(w => w.collection === 'legacy');
  const total = Object.values(V3).reduce((s, d) => s + d.length, 0);
  assert.equal(legacy.length, total);
  assert.equal(write(r, 'legacy', 'v3-weakspots-w1').data.migratedTo, 'weakspots/w1');
  assert.ok(write(r, 'legacy', 'v3-weakspots-w1').data.derived, 'the original keeps its derived block');
  assert.equal(write(r, 'legacy', 'v3-state-current').data.migratedTo, null);
  assert.equal(r.writes.filter(w => ['state', 'system'].includes(w.collection)).length, 0);
});

test('idempotent and deterministic: the same export gives the same writes; a migrated record gives none', () => {
  const a = migrateV3(V3, { at: AT }),
    b = migrateV3(JSON.parse(JSON.stringify(V3)), { at: AT });
  assert.deepEqual(a.writes, b.writes);
  assert.deepEqual(migrateV3(applyWrites(V3, a.writes), { at: AT }).writes, []);
  assert.throws(() => migrateV3({ ...V3, journal: [{ id: 'j' }] }, { at: AT }), /journal is page-only/);
  assert.throws(() => migrateV3(V3, {}), /needs opts\.at/);
});

test('batches: at most 50 writes and 1 MiB each, one write per document per batch, order kept', () => {
  const writes = Array.from({ length: 120 }, (_, i) => ({
    op: 'set',
    collection: 'c',
    doc_id: 'd' + i,
    data: { n: i },
  }));
  const b = chunkWrites(writes, { maxWrites: 50, maxBytes: 1048576 });
  assert.deepEqual(
    b.map(x => x.length),
    [50, 50, 20]
  );
  assert.deepEqual(b.flat(), writes);
  const big = Array.from({ length: 5 }, (_, i) => ({
    op: 'set',
    collection: 'c',
    doc_id: 'b' + i,
    data: { t: 'x'.repeat(400000) },
  }));
  assert.ok(chunkWrites(big).every(x => x.reduce((s, w) => s + writeBytes(w), 0) <= 1048576));
  assert.deepEqual(
    chunkWrites([
      { collection: 'c', doc_id: 'a' },
      { collection: 'c', doc_id: 'a' },
    ]).map(x => x.length),
    [1, 1]
  );
  assert.throws(
    () => chunkWrites([{ collection: 'c', doc_id: 'x', data: { t: 'x'.repeat(1048577) } }]),
    /over the 1048576-byte batch limit/
  );
});

test(
  'the real v3 export: every write validates, a second run writes nothing (fixtures/v3-export, local only)',
  { skip: !fs.existsSync(REAL) && 'no fixtures/v3-export in this checkout' },
  () => {
    const v3 = {};
    for (const { collection, id, doc } of readExport(REAL))
      (v3[collection] = v3[collection] || []).push({ ...doc, id });
    assert.equal(v3.journal, undefined, 'an export never holds the journal');
    const r = migrateV3(v3, { at: AT });
    const bad = r.writes
      .map(w => (validate(w.collection, w.data, { id: w.id }).ok ? null : `${w.collection}/${w.id}`))
      .filter(Boolean);
    assert.deepEqual(bad, []);
    assert.deepEqual(migrateV3(applyWrites(v3, r.writes), { at: AT }).writes, []);
  }
);

test('no migrated document is stamped after the export: a date with no creation time takes the migration time', () => {
  const v3 = {
    dates: [{ id: 'd-future', schema: 1, date: '2026-12-01', title: 'A made-up date', kind: 'due', source: 'owner' }],
  };
  const { writes } = migrateV3(v3, { at: '2026-10-18T05:00:00Z' });
  const d = writes.find(w => w.collection === 'dates' && w.id === 'd-future');
  assert.equal(d.data.at, '2026-10-18T05:00:00.000Z');
  for (const w of writes)
    assert.ok(!(Date.parse(w.data.at) > Date.parse('2026-10-18T05:00:00Z')), `${w.collection}/${w.id}`);
});

test('B-39 (D-094): the exams 1 to 2 bump moves the score to examedits, keeps the original in legacy, matches its fixture and is idempotent', async () => {
  const { migrateBumps, BUMPS } = await import('../core/migrate.mjs');
  const { readExport: read } = await import('../core/schemas.mjs');
  const dir = path.join(ROOT, 'test/data/bumps/exams-1');
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of read(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const before = load(path.join(dir, 'before')),
    after = load(path.join(dir, 'after'));
  assert.ok(BUMPS.exams[1], 'a migration keyed by collection and version');
  const r = migrateBumps(before, { at: '2026-10-18T17:00:00Z' });
  const got = {};
  for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  for (const [c, docs] of Object.entries(after))
    assert.deepEqual(
      EV.stableStringify((got[c] || []).sort((a, b) => (a.id < b.id ? -1 : 1))),
      EV.stableStringify(docs.sort((a, b) => (a.id < b.id ? -1 : 1))),
      c
    );
  assert.deepEqual(Object.keys(got).sort(), Object.keys(after).sort());
  for (const w of r.writes)
    assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
  assert.ok(!('score' in got.exams.find(e => e.id === 'E1')) && got.examedits.find(e => e.id === 'E1').score === 88.5);
  // Idempotent: the record as it stands after the bump needs nothing more.
  const applied = applyWrites(before, r.writes);
  assert.deepEqual(migrateBumps(applied, { at: '2026-10-19T17:00:00Z' }).writes, []);
  // A score Matt entered after the bump is never overwritten by a later run of it.
  applied.exams = applied.exams.map(e => (e.id === 'E2' ? { ...e, schema: 1, score: 70 } : e));
  applied.examedits.push({
    id: 'E2',
    schema: 1,
    writer: 'page',
    at: '2026-11-03T00:00:00Z',
    source: 'E.V. Home',
    updatedAt: '2026-11-03T00:00:00Z',
    score: 91,
  });
  assert.ok(
    !migrateBumps(applied, { at: '2026-11-04T00:00:00Z' }).writes.some(w => w.collection === 'examedits'),
    'an existing examedits document is kept'
  );
});

test('B-53 (D-109): the ideas 1 to 2 bump makes every earlier idea a learning idea, matches its fixture and is idempotent', async () => {
  const { migrateBumps } = await import('../core/migrate.mjs');
  const { readExport: read } = await import('../core/schemas.mjs');
  const dir = path.join(ROOT, 'test/data/bumps/ideas-1');
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of read(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const before = load(path.join(dir, 'before')),
    after = load(path.join(dir, 'after'));
  const r = migrateBumps(before, { at: '2026-10-18T17:00:00Z' });
  const got = {};
  for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const [c, docs] of Object.entries(after))
    assert.equal(EV.stableStringify(sorted(got[c])), EV.stableStringify(sorted(docs)), c);
  for (const w of r.writes)
    assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
  assert.ok(got.ideas.every(i => i.kind === 'learning' && i.schema === 2));
  assert.deepEqual(
    migrateBumps(applyWrites(before, r.writes), { at: '2026-10-19T17:00:00Z' }).writes,
    [],
    'a second run writes nothing'
  );
  // A schema-1 idea that already carries a kind keeps it: only a missing kind becomes learning.
  const { BUMPS } = await import('../core/migrate.mjs');
  assert.equal(
    BUMPS.ideas[1]({ id: 'made-up', schema: 1, text: 'A made-up idea', kind: 'feature' }).data.kind,
    'feature'
  );
  assert.equal(BUMPS.ideas[1]({ id: 'made-up', schema: 1, text: 'A made-up idea' }).data.kind, 'learning');
});

test('B-29 (Matt, Oct 18): the weeks 1 to 2 bump makes health {summary, verify: null}, matches its fixture, rebuilds and is idempotent', async () => {
  const { migrateBumps } = await import('../core/migrate.mjs');
  const { rebuildOne } = await import('../core/derive.mjs');
  const { readExport: read } = await import('../core/schemas.mjs');
  const dir = path.join(ROOT, 'test/data/bumps/weeks-1');
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of read(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const before = load(path.join(dir, 'before')),
    after = load(path.join(dir, 'after'));
  const r = migrateBumps(before, { at: '2026-10-18T17:00:00Z' });
  const got = {};
  for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const [c, docs] of Object.entries(after))
    assert.equal(EV.stableStringify(sorted(got[c])), EV.stableStringify(sorted(docs)), c);
  for (const w of r.writes)
    assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
  assert.deepEqual(got.weeks[0].health, { summary: before.weeks[0].health, verify: null });
  const applied = applyWrites(before, r.writes);
  assert.deepEqual(migrateBumps(applied, { at: '2026-10-19T17:00:00Z' }).writes, [], 'a second run writes nothing');
  // The bumped week still rebuilds as its run would write it today, in the synthetic record it came from.
  const rec = {};
  for (const { collection, id, doc } of read(path.join(ROOT, 'test/data/record')))
    if (collection !== 'journal') (rec[collection] = rec[collection] || []).push({ ...doc, id });
  rec.weeks = applied.weeks;
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
  assert.equal(rebuildOne(rec, spec, 'weeks', rec.weeks[0]).status, 'same');
});

test('B-74 (D-128, D-130, D-133): the talk and sessions 1 to 2 bumps match their fixtures, validate and are idempotent', async () => {
  const { migrateBumps, BUMPS } = await import('../core/migrate.mjs');
  const { readExport: read } = await import('../core/schemas.mjs');
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of read(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const name of ['talk-1', 'sessions-1']) {
    const dir = path.join(ROOT, 'test/data/bumps', name);
    const before = load(path.join(dir, 'before')),
      after = load(path.join(dir, 'after'));
    const r = migrateBumps(before, { at: '2026-10-20T22:00:00Z' });
    const got = {};
    for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
    for (const [c, docs] of Object.entries(after))
      assert.equal(EV.stableStringify(sorted(got[c])), EV.stableStringify(sorted(docs)), `${name}: ${c}`);
    for (const w of r.writes)
      assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
    assert.deepEqual(
      migrateBumps(applyWrites(before, r.writes), { at: '2026-10-21T22:00:00Z' }).writes,
      [],
      `${name}: a second run writes nothing`
    );
  }
  // talk: every document moves to today's version (2, then 3 with B-178, 4 with B-227) with its messages as they were,
  // memory included.
  const talk = load(path.join(ROOT, 'test/data/bumps/talk-1/after')).talk;
  assert.ok(talk.every(t => t.schema === 4));
  // sessions: a page session gains comments Some and its question checks format mc (a comment's mark gets none); a filed
  // session and a skills run gain no level; a level or a format already set is kept.
  const ss = load(path.join(ROOT, 'test/data/bumps/sessions-1/after')).sessions;
  const page = ss.find(s => s.id.startsWith('ss-2')),
    filed = ss.find(s => s.id.startsWith('sw-')),
    skill = ss.find(s => s.id.startsWith('ss-skill-'));
  assert.equal(page.comments, 'some');
  assert.deepEqual(
    Object.values(page.events)
      .filter(e => e.type === 'check')
      .map(e => e.format),
    ['mc', undefined]
  );
  assert.ok(
    Object.values(page.events)
      .filter(e => e.type !== 'check')
      .every(e => !('format' in e))
  );
  assert.ok(!('comments' in filed) && !('comments' in skill));
  const kept = BUMPS.sessions[1]({
    id: 'ss-made-up',
    schema: 1,
    comments: 'off',
    events: { 'page-20261016-000700000': { type: 'check', n: 1, format: 'open' } },
  }).data;
  assert.deepEqual([kept.comments, kept.events['page-20261016-000700000'].format], ['off', 'open']);
  // A skills run is an ss- session that never comments on notes: no level.
  assert.ok(!('comments' in BUMPS.sessions[1]({ id: 'ss-skill-made-up', schema: 1, kind: 'skill' }).data));
});

test('B-48 (D-105): the days and weeks 2 to 3 bumps add readiness null, match their fixtures, validate, rebuild and are idempotent', async () => {
  const { migrateBumps } = await import('../core/migrate.mjs');
  const { rebuildOne } = await import('../core/derive.mjs');
  const { readExport: read } = await import('../core/schemas.mjs');
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of read(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
  const rec = load(path.join(ROOT, 'test/data/record'));
  delete rec.journal;
  for (const [name, c] of [
    ['days-2', 'days'],
    ['weeks-2', 'weeks'],
  ]) {
    const dir = path.join(ROOT, 'test/data/bumps', name);
    const before = load(path.join(dir, 'before')),
      after = load(path.join(dir, 'after'));
    const r = migrateBumps(before, { at: '2026-10-21T12:00:00Z' });
    const got = {};
    for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
    for (const [col, docs] of Object.entries(after))
      assert.equal(EV.stableStringify(sorted(got[col])), EV.stableStringify(sorted(docs)), `${name}: ${col}`);
    for (const w of r.writes)
      assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
    const doc = got[c][0];
    assert.equal(doc.schema, 4, 'the bumps chain to this build');
    assert.equal(
      c === 'days' ? doc.readiness : doc.rollups.readiness,
      null,
      'a document from before the stamp has none'
    );
    const applied = applyWrites(before, r.writes);
    assert.deepEqual(
      migrateBumps(applied, { at: '2026-10-22T12:00:00Z' }).writes,
      [],
      `${name}: a second run writes nothing`
    );
    // The migrated document rebuilds as written (readiness stays null), in the record it came from.
    assert.equal(rebuildOne({ ...rec, [c]: applied[c] }, spec, c, applied[c][0]).status, 'same', name);
  }
});

test('B-48 (D-105): a day stamps readiness per upcoming exam of every active course, as of its morning', async () => {
  const { rebuildOne, readinessStamp } = await import('../core/derive.mjs');
  const { readExport: read } = await import('../core/schemas.mjs');
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
  const rec = {};
  for (const { collection, id, doc } of read(path.join(ROOT, 'test/data/record')))
    if (collection !== 'journal') (rec[collection] = rec[collection] || []).push({ ...doc, id });
  const day = rec.days[0];
  assert.deepEqual(Object.keys(day.readiness), ['E9']);
  assert.deepEqual(Object.keys(day.readiness.E9).sort(), ['accuracy7', 'active', 'answers7', 'pctSolid', 'solid']);
  assert.equal(rebuildOne(rec, spec, 'days', day).status, 'same', 'the fixture day rebuilds with its stamp');
  assert.equal(rebuildOne(rec, spec, 'weeks', rec.weeks[0]).status, 'same', 'the fixture week rebuilds with its stamp');
  // Seven-day accuracy counts only the exam's own objectives, within seven days before the date.
  const v = {
    exams: [{ id: 'E9', date: '2026-10-30', course: 'NUR 112', kind: 'unit' }],
    sets: [
      {
        id: 's1',
        items: [
          { id: 'a', objective: 'E9-1', type: 'single', correct: [0] },
          { id: 'b', objective: 'E9-2', type: 'single', correct: [0] },
          { id: 'c', objective: 'E8-1', type: 'single', correct: [0] },
        ],
      },
    ],
    answers: [
      {
        id: 's1',
        setId: 's1',
        answers: {
          a: { 'page-1': { chosen: [0], correct: true, score: 1, at: '2026-10-20T15:00:00Z' } },
          b: { 'page-2': { chosen: [1], correct: false, score: 0, at: '2026-10-20T15:01:00Z' } },
          c: { 'page-3': { chosen: [0], correct: true, score: 1, at: '2026-10-20T15:02:00Z' } },
        },
      },
    ],
    models: [],
  };
  const s = readinessStamp(v, '2026-10-21');
  assert.deepEqual(s.E9, { pctSolid: null, active: 0, solid: 0, accuracy7: 50, answers7: 2 });
  assert.deepEqual(readinessStamp(v, '2026-10-30'), {}, 'an exam today is no longer upcoming');
});

test('B-72 (D-120): the weeks 3 to 4 bump adds insights null, matches its fixture, validates, rebuilds and is idempotent', async () => {
  const { migrateBumps } = await import('../core/migrate.mjs');
  const { rebuildOne } = await import('../core/derive.mjs');
  const { readExport: read } = await import('../core/schemas.mjs');
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of read(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const dir = path.join(ROOT, 'test/data/bumps/weeks-3');
  const before = load(path.join(dir, 'before')),
    after = load(path.join(dir, 'after'));
  const r = migrateBumps(before, { at: '2026-10-21T13:00:00Z' });
  const got = {};
  for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  for (const [col, docs] of Object.entries(after))
    assert.equal(EV.stableStringify(sorted(got[col])), EV.stableStringify(sorted(docs)), col);
  for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id}`);
  assert.equal(got.weeks[0].insights, null);
  assert.deepEqual(got.weeks[0].rollups.readiness, before.weeks[0].rollups.readiness, 'the B-48 stamp is kept');
  const applied = applyWrites(before, r.writes);
  assert.deepEqual(migrateBumps(applied, { at: '2026-10-22T13:00:00Z' }).writes, []);
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
  const rec = load(path.join(ROOT, 'test/data/record'));
  delete rec.journal;
  assert.equal(rebuildOne({ ...rec, weeks: applied.weeks }, spec, 'weeks', applied.weeks[0]).status, 'same');
});

test('B-177 (D-194): the jobs 1 to 2 bump only moves a job to the new version, matches its fixture, validates and is idempotent', async () => {
  const { migrateBumps } = await import('../core/migrate.mjs');
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of readExport(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const dir = path.join(ROOT, 'test/data/bumps/jobs-1');
  const before = load(path.join(dir, 'before')),
    after = load(path.join(dir, 'after'));
  const r = migrateBumps(before, { at: '2026-10-21T22:30:00Z' });
  const got = {};
  for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  for (const [c, docs] of Object.entries(after))
    assert.equal(EV.stableStringify(sorted(got[c])), EV.stableStringify(sorted(docs)), c);
  for (const w of r.writes)
    assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id} validates`);
  for (const j of got.jobs) {
    const was = before.jobs.find(b => b.id === j.id);
    assert.deepEqual({ ...j, schema: 1 }, was, 'only the version moves');
  }
  assert.equal(got.legacy.length, 2, 'each job keeps its legacy copy');
  const applied = applyWrites(before, r.writes);
  assert.deepEqual(migrateBumps(applied, { at: '2026-10-22T22:30:00Z' }).writes, [], 'a second run writes nothing');
  // The builder's kinds validate at schema 2 and not at schema 1.
  const build = { ...after.jobs[0], kind: 'build' };
  delete build.id;
  for (const kind of ['build', 'reply', 'design', 'plan', 'ship'])
    assert.ok(validate('jobs', { ...build, kind }).ok, kind);
  assert.ok(!validate('jobs', { ...build, schema: 1 }).ok, 'schema 1 is no longer current');
});

test('B-178 (D-195, D-196): the jobresults 1 to 2, talk 2 to 3 and system 1 to 2 bumps match their fixtures, validate and are idempotent', async () => {
  const { migrateBumps, BUMPS } = await import('../core/migrate.mjs');
  const { readExport, loadValidator } = await import('../core/schemas.mjs');
  const EV = (await import('../core/evcore.mjs')).default;
  const validate = loadValidator();
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of readExport(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const apply = (db, writes) => {
    const out = JSON.parse(JSON.stringify(db));
    for (const w of writes) {
      const list = (out[w.collection] = out[w.collection] || []);
      const i = list.findIndex(d => d.id === w.id);
      if (i >= 0) list[i] = { ...w.data, id: w.id };
      else list.push({ ...w.data, id: w.id });
    }
    return out;
  };
  for (const [name, col, from, to] of [
    ['jobresults-1', 'jobresults', 1, 2],
    ['talk-2', 'talk', 2, 4], // B-227: the chain runs on to 4
    ['talk-3', 'talk', 3, 4], // B-227 (D-232): a message may carry work; the documents only move
    ['system-1', 'system', 1, 2],
  ]) {
    assert.ok(BUMPS[col][from], `${name}: a migration keyed by collection and version`);
    const dir = path.join(ROOT, 'test/data/bumps', name);
    const before = load(path.join(dir, 'before')),
      after = load(path.join(dir, 'after'));
    const r = migrateBumps(before, { at: '2026-10-22T01:00:00Z' });
    const got = {};
    for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
    for (const [c, docs] of Object.entries(after))
      assert.equal(EV.stableStringify(sorted(got[c])), EV.stableStringify(sorted(docs)), `${name}: ${c}`);
    for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id}`);
    // Identity: each document moves to the new version and nothing else changes; its original is kept in legacy.
    for (const d of before[col]) {
      const moved = after[col].find(x => x.id === d.id);
      assert.deepEqual({ ...moved, schema: from }, d, `${name}: ${d.id} only moves to ${to}`);
      assert.equal(moved.schema, to);
      assert.ok(after.legacy.some(l => l.migratedFrom === `${col}/${d.id}` && l.schema === from));
    }
    assert.deepEqual(migrateBumps(apply(before, r.writes), { at: '2026-10-23T01:00:00Z' }).writes, [], name);
  }
});
