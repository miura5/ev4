// B-170 (D-120's morning half, behind D-190): the morning's new checks lead with the latest week's weakest objective
// once spec.study.aim is weakest; until then it writes that aim's checks beside the list as days/<date>.aim, and the
// weekly compares the two in weeks/<date>.study.aim.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import * as STUDY from '../core/study.mjs';
import { produce, rebuildOne } from '../core/derive.mjs';
import { CODE_STEPS } from '../core/steps.mjs';
import { migrateBumps, applyWrites } from '../core/migrate.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const DATE = '2026-10-20'; // a Tuesday, a class day: new checks are written
const env = (writer, at) => ({ schema: 1, writer, at, source: writer });
const record = ({ insights = true } = {}) => ({
  exams: [
    {
      id: 'E4',
      ...env('page', '2026-10-01T12:00:00Z'),
      date: '2026-10-30',
      course: 'NUR 112',
      kind: 'unit',
      title: 'Exam 4',
    },
  ],
  objectives: [1, 2, 3, 4, 5].map(n => ({
    id: `E4-${n}`,
    ...env('seed', '2026-10-01T12:00:00Z'),
    exam: 'E4',
    text: `Made-up objective ${n}`,
  })),
  weakspots: [],
  sets: [],
  answers: [],
  plans: [],
  planedits: [],
  dates: [],
  dateedits: [],
  dayedits: [],
  materials: [],
  materialedits: [],
  announcements: [],
  examedits: [],
  weeks: [
    {
      id: '2026-10-18',
      date: '2026-10-18',
      at: '2026-10-19T00:30:00Z',
      insights: insights ? { weakestObjective: 'E4-3' } : null,
    },
  ],
});
const withAim = aim => ({ ...spec, study: { ...spec.study, aim } });

test("B-170: with insights naming E4-3 the weakest aim leads the checks with E4-3; without them, today's rule", () => {
  const N = EV.constants().review.newChecksPerDay;
  const day = (db, aim) =>
    EV.planDay({ date: DATE, ...db, pickReviews: STUDY.dayPicker(EV, withAim(aim), { weeks: db.weeks, date: DATE }) })
      .reviews.checks;
  const today = ['E4-1', 'E4-2', 'E4-3', 'E4-4', 'E4-5'].slice(0, N);
  assert.deepEqual(day(record(), 'today'), today, "today's rule: the exam's objectives in order");
  assert.equal(day(record(), 'weakest')[0], 'E4-3', 'the weakest objective first');
  assert.equal(day(record(), 'weakest').length, N, 'inside the day’s count');
  assert.deepEqual(day(record({ insights: false }), 'weakest'), today, 'no insights: today’s rule');
  // An objective of another exam, or a week too old, changes nothing.
  const other = record();
  other.weeks[0].insights.weakestObjective = 'E3-2';
  assert.deepEqual(day(other, 'weakest'), today);
  const old = record();
  old.weeks[0].date = old.weeks[0].id = '2026-09-27';
  assert.equal(STUDY.weakestOf(EV, old.weeks, DATE), null, 'a week more than 13 days back is not the latest');
  assert.equal(STUDY.aimOf(spec), 'today', 'it ships behind the comparison: today drives the morning');
});

test('B-170: days/<date> carries the other aim’s checks, and the practice brief writes the checks the day lists', () => {
  const db = record();
  const d = produce(db, spec, 'days', { date: DATE, now: '2026-10-20T09:25:00Z' });
  assert.equal(d.schema, 4);
  assert.deepEqual(d.aim, { rule: 'today', weakest: 'E4-3', other: { rule: 'weakest', checks: d.aim.other.checks } });
  assert.equal(d.aim.other.checks[0], 'E4-3');
  assert.notDeepEqual(d.plan.reviews.checks, d.aim.other.checks, 'the shadow differs from the list');
  assert.ok(validate('days', d, { id: DATE }).ok, 'the day validates');
  const flipped = produce(db, withAim('weakest'), 'days', { date: DATE, now: '2026-10-20T09:25:00Z' });
  assert.equal(flipped.plan.reviews.checks[0], 'E4-3');
  assert.equal(flipped.aim.other.rule, 'today');
  // The practice brief: the checks it asks the morning to write are the ones the day lists, under either aim.
  for (const [s, day] of [
    [spec, d],
    [withAim('weakest'), flipped],
  ]) {
    const ctx = { date: DATE, now: '2026-10-20T09:25:00Z' };
    CODE_STEPS['practice-brief'](db, ctx, s);
    assert.deepEqual(
      ctx.brief.review.checks.map(c => c.objective),
      day.plan.reviews.checks
    );
  }
});

test('B-170: the weekly compares the two aims over the days that carry one', () => {
  const days = [
    {
      date: '2026-10-19',
      plan: { reviews: { checks: ['E4-1', 'E4-2', 'E4-3'] } },
      aim: { rule: 'today', weakest: 'E4-3', other: { rule: 'weakest', checks: ['E4-3', 'E4-1', 'E4-2'] } },
    },
    {
      date: '2026-10-20',
      plan: { reviews: { checks: [] } },
      aim: { rule: 'today', weakest: 'E4-3', other: { rule: 'weakest', checks: [] } },
    },
    { date: '2026-10-21', plan: { reviews: { checks: [] } }, aim: null },
  ];
  const atts = [
    { objective: 'E4-3', date: '2026-10-19', correct: true },
    { objective: 'E4-3', date: '2026-10-22', correct: false },
    { objective: 'E4-1', date: '2026-10-22', correct: false },
    { objective: 'E4-3', date: '2026-10-12', correct: false },
  ];
  assert.deepEqual(STUDY.compareAim(days, atts, { from: '2026-10-19', to: '2026-10-25' }), {
    rule: 'today',
    other: 'weakest',
    days: 2,
    differed: 1,
    weakest: ['E4-3'],
    onWeakest: { right: 1, missed: 1 },
  });
  assert.equal(STUDY.compareAim([{ date: '2026-10-19', aim: null }], atts, {}), null);
  // In the weekly: weeks/<date>.study.aim from its days.
  const db = { ...record(), days: days.map(d => ({ id: d.date, ...env('morning', d.date + 'T09:25:00Z'), ...d })) };
  const w = produce(db, spec, 'weeks', { date: '2026-10-25', now: '2026-10-26T00:30:00Z' });
  assert.equal(w.study.aim.days, 2);
  assert.equal(w.study.aim.differed, 1);
});

test('B-170: the days 3 to 4 bump adds aim null, matches its fixture, validates, rebuilds and is idempotent', () => {
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of readExport(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const dir = path.join(ROOT, 'test/data/bumps/days-3');
  const before = load(path.join(dir, 'before')),
    after = load(path.join(dir, 'after'));
  const r = migrateBumps(before, { at: '2026-10-21T12:00:00Z' });
  const got = {};
  for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  for (const [col, docs] of Object.entries(after))
    assert.equal(EV.stableStringify(sorted(got[col])), EV.stableStringify(sorted(docs)), col);
  for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id}`);
  assert.equal(got.days[0].aim, null);
  const applied = applyWrites(before, r.writes);
  assert.deepEqual(migrateBumps(applied, { at: '2026-10-22T12:00:00Z' }).writes, [], 'a second run writes nothing');
  const rec = load(path.join(ROOT, 'test/data/record'));
  delete rec.journal;
  assert.equal(rebuildOne({ ...rec, days: applied.days }, spec, 'days', applied.days[0]).status, 'same');
});

test('B-170: the morning reads the latest weeks, and the practice brief and the day pick alike', () => {
  assert.ok(spec.pipelines.morning.reads.some(r => r.collection === 'weeks' && r.windowDays === 14));
  assert.equal(spec.study.aim, 'today');
});

test('B-406: a discarded session (an Undo took it back) counts in no week: not in sessions, minutes or study vs next day', () => {
  const base = record();
  const s = (id, minutes, status) => ({
    id,
    ...env('page', '2026-10-21T15:00:00Z'),
    source: 'E.V. Home',
    date: '2026-10-21',
    status,
    minutes,
  });
  const one = { ...base, sessions: [s('ss-20261021-150000-kept', 30, 'ended')] };
  const two = { ...one, sessions: [...one.sessions, s('ss-20261021-151000-undone', 25, 'discarded')] };
  const w1 = produce(one, spec, 'weeks', { date: '2026-10-25', now: '2026-10-26T00:30:00Z' });
  const w2 = produce(two, spec, 'weeks', { date: '2026-10-25', now: '2026-10-26T00:30:00Z' });
  assert.equal(w2.rollups.sessions, 1);
  assert.equal(w2.rollups.studyMinutes, 30);
  assert.deepEqual(w2.rollups, w1.rollups);
  assert.deepEqual(w2.insights, w1.insights);
});
