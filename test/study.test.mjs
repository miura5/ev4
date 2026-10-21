// B-68 (D-116, D-117): the review scheduler. Today's rule (fixed) drives the morning; the adaptive rule runs beside
// it as days/<date>.shadow; the weekly compares the two in weeks/<date>.study. Nothing flips without Matt (B-69).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import * as STUDY from '../core/study.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const P = { base: 3, cap: 14, nearExam: 1 };
const exams = [{ id: 'E5', title: 'Exam 5', kind: 'unit', course: 'NUR 112', date: '2026-11-30' }];
// A solid weak spot: two right days made it solid on Nov 2; rightAfter more right days follow, the last on lastReviewed.
const solid = (id, lastReviewed, rightAfter = []) => ({
  id,
  kind: 'concept',
  exam: 'E5',
  topic: id,
  objective: 'E5-1',
  derived: {
    status: 'reviewed',
    streak: 2,
    solidAt: '2026-11-02T15:00:00Z',
    lastReviewed,
    lastResult: 'right',
    recurrence: 1,
    misses: 1,
    history: [
      { date: '2026-11-01', correct: true },
      { date: '2026-11-02', correct: true },
      ...rightAfter.map(date => ({ date, correct: true })),
    ],
  },
});
const open = (id, nextDue) => ({
  id,
  kind: 'concept',
  exam: 'E5',
  topic: id,
  objective: 'E5-1',
  addedAt: '2026-10-30T15:00:00Z',
  derived: { status: 'open', streak: 0, nextDue, recurrence: 1, misses: 1 },
});

test("B-68: the morning runs today's rule unless spec.study says otherwise; the shadow is the other one", () => {
  assert.equal(spec.study.scheduler, 'fixed');
  assert.deepEqual(spec.study.params, P);
  assert.equal(STUDY.schedulerOf(spec), 'fixed');
  assert.equal(STUDY.schedulerOf({}), 'fixed');
  assert.equal(STUDY.otherScheduler('fixed'), 'adaptive');
  assert.equal(STUDY.otherScheduler('adaptive'), 'fixed');
  const ctx = {
    date: '2026-11-04',
    dayType: 'class',
    weakspots: [open('a', '2026-11-03'), solid('s', '2026-11-02')],
    exams,
    objectives: [],
  };
  assert.deepEqual(STUDY.picker(EV, 'fixed', spec)(ctx), EV.pickReviews(ctx), "fixed is core's pickReviews, unchanged");
});

test("B-68 (D-117): a solid weak spot comes round at 3, 6, 12, then 14 days, and daily inside its exam's window", () => {
  assert.equal(
    STUDY.solidDue(EV, solid('s', '2026-11-02'), '2026-11-03', exams, P),
    '2026-11-05',
    'solid on Nov 2: back in 3 days'
  );
  assert.equal(
    STUDY.solidDue(EV, solid('s', '2026-11-05', ['2026-11-05']), '2026-11-06', exams, P),
    '2026-11-11',
    'one more right day: 6'
  );
  assert.equal(
    STUDY.solidDue(EV, solid('s', '2026-11-11', ['2026-11-05', '2026-11-11']), '2026-11-12', exams, P),
    '2026-11-23',
    'two: 12'
  );
  assert.equal(
    STUDY.solidDue(EV, solid('s', '2026-11-14', ['2026-11-05', '2026-11-11', '2026-11-14']), '2026-11-15', exams, P),
    '2026-11-28',
    'three: capped at 14'
  );
  assert.equal(
    STUDY.solidDue(EV, solid('s', '2026-11-26', ['2026-11-05']), '2026-11-27', exams, P),
    '2026-11-27',
    'three days before the exam: daily'
  );
  assert.equal(STUDY.solidDue(EV, solid('s', '2026-11-26'), '2026-12-01', exams, P), null, 'its exam has passed');
  assert.equal(
    STUDY.solidDue(EV, open('a', '2026-11-03'), '2026-11-03', exams, P),
    null,
    "an open spot is the fixed rule's"
  );
});

test("B-68 (D-117): adaptive draws due solid spots after the open ones, inside the day's load, and defers the rest with a reason", () => {
  const ws = [
    open('a', '2026-11-08'),
    open('b', '2026-11-08'),
    solid('s1', '2026-11-02'),
    solid('s2', '2026-11-03'),
    solid('s3', '2026-11-04'),
  ];
  const ctx = { date: '2026-11-08', dayType: 'class', weakspots: ws, exams, objectives: [] };
  const fixed = EV.pickReviews(ctx),
    adaptive = STUDY.picker(EV, 'adaptive', spec)(ctx);
  assert.deepEqual(
    fixed.picked.map(w => w.id),
    ['a', 'b']
  );
  assert.deepEqual(
    adaptive.picked.map(w => w.id),
    ['a', 'b', 's1', 's2', 's3'],
    'open first, then solid by due date'
  );
  const tight = STUDY.picker(EV, 'adaptive', spec)({ ...ctx, dayType: 'clinical' }); // a clinical day's load is 3
  assert.equal(tight.load.load, 3);
  assert.deepEqual(
    tight.picked.map(w => w.id),
    ['a', 'b', 's1']
  );
  assert.deepEqual(
    tight.deferred.filter(d => /solid/.test(d.reason)).map(d => d.id),
    ['s2', 's3']
  );
  const examDay = STUDY.picker(EV, 'adaptive', spec)({ ...ctx, date: '2026-11-30', dayType: 'exam' });
  assert.deepEqual(examDay.picked, [], 'the exam-day rule is kept: no reviews');
});

test("B-68: planDay takes the scheduler it is given; with none it is today's rule, so the morning's list is unchanged", () => {
  const base = {
    date: '2026-11-08',
    dates: [],
    exams,
    plans: [],
    weakspots: [open('a', '2026-11-08'), solid('s1', '2026-11-02')],
    objectives: [],
    sets: [],
  };
  assert.deepEqual(EV.planDay({ ...base, pickReviews: STUDY.picker(EV, 'fixed', spec) }), EV.planDay(base));
  assert.deepEqual(EV.planDay({ ...base, pickReviews: STUDY.picker(EV, 'adaptive', spec) }).reviews.ids, ['a', 's1']);
  assert.deepEqual(
    STUDY.shadowOf(EV.planDay({ ...base, pickReviews: STUDY.picker(EV, 'adaptive', spec) }), 'adaptive'),
    { scheduler: 'adaptive', ids: ['a', 's1'], deferred: [] }
  );
});

test('B-68 (D-116): the week compares list and shadow: both, only one, and how the one-sided picks were answered', () => {
  const day = (date, list, shadow) => ({
    id: date,
    date,
    plan: { reviews: { ids: list } },
    shadow: { scheduler: 'adaptive', ids: shadow, deferred: [] },
  });
  const days = [
    day('2026-11-08', ['a', 'b'], ['a', 'b', 's1', 's2']),
    day('2026-11-09', ['c'], ['c', 's3']),
    { id: '2026-11-07', date: '2026-11-07', shadow: null },
  ];
  const att = [
    { weakspotId: 's1', date: '2026-11-10', at: '2026-11-10T15:00:00Z', correct: true },
    { weakspotId: 's3', date: '2026-11-09', at: '2026-11-09T15:00:00Z', correct: false },
  ];
  assert.deepEqual(STUDY.compareWeek(days, att, { from: '2026-11-08', to: '2026-11-14' }), {
    scheduler: 'fixed',
    shadow: 'adaptive',
    days: 2,
    both: 3,
    onlyList: { picks: 0, right: 0, missed: 0, unanswered: 0 },
    onlyShadow: { picks: 3, right: 1, missed: 1, unanswered: 1 },
  });
  assert.equal(STUDY.compareWeek([{ date: '2026-11-08', shadow: null }], [], {}), null, 'no shadow, no comparison');
});

test('B-68: the days 1 to 2 bump adds shadow null, validates and is idempotent; a new day carries a valid shadow', async () => {
  const { migrateBumps, applyWrites, currentVersion } = await import('../core/migrate.mjs');
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/data/record/days/2026-10-16.json'), 'utf8'));
  const old = { ...d, schema: 1 };
  delete old.shadow;
  delete old.readiness; // B-48: neither existed at schema 1; the bumps chain through 2 to 3
  const before = { days: [{ ...old, id: '2026-10-16' }] };
  const r = migrateBumps(before, { at: '2026-10-20T17:00:00Z' });
  const main = r.writes.find(w => w.collection === 'days');
  assert.equal(main.data.schema, 3);
  assert.equal(main.data.shadow, null);
  assert.equal(main.data.readiness, null);
  assert.ok(
    r.writes.some(w => w.collection === 'legacy' && w.id === 'v4-days-2026-10-16-s1'),
    'the old form is kept'
  );
  for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id}`);
  assert.equal(currentVersion('days'), 3);
  assert.deepEqual(migrateBumps(applyWrites(before, r.writes), { at: '2026-10-21T17:00:00Z' }).writes, []);
  assert.ok(validate('days', d, { id: '2026-10-16' }).ok, 'the fixture day, rebuilt with its shadow');
  assert.deepEqual(d.shadow.scheduler, 'adaptive');
});

test('B-68: the weekly reads the days of its week, and core.js carries the schedulers for the page', async () => {
  assert.ok(spec.pipelines.weekly.reads.some(r => r.collection === 'days' && r.windowDays === 8));
  const { buildPages, loadSchemas } = await import('../tools/build.mjs');
  const core = buildPages({ root: ROOT, spec, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion }).staging[
    'core.js'
  ];
  assert.match(
    core,
    /window\.EVStudy = \{ SCHEDULERS, schedulerOf, otherScheduler, solidDue, picker, shadowOf, compareWeek \}/
  );
});
