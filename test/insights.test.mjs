// E.V. core's insights (B-159, split from core.test.mjs with their section): readiness and its prediction, answer
// statistics, calibration and the exam retrospective. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { at, key, ws, E4 } from './core-fixtures.mjs';

const answersDoc = (setId, answers) => ({
  id: setId,
  schema: 1,
  writer: 'page',
  at: at('2026-10-17'),
  source: 'E.V. Home',
  setId,
  answers,
});

test('readiness prediction is deterministic and explains itself', () => {
  const exams = [{ id: 'E1', kind: 'unit', score: 94 }, { id: 'E2', kind: 'unit', score: 84 }, E4];
  const models = [
    { ...ws('a'), derived: { status: 'reviewed' } },
    { ...ws('b'), derived: { status: 'open', streak: 0 } },
  ];
  const attempts = [
    { objective: 'E4-3', date: '2026-10-18', score: 1 },
    { objective: 'E4-3', date: '2026-10-19', score: 0 },
  ];
  const p = EV.predictReadiness({
    examId: 'E4',
    exams,
    weakspots: models,
    attempts,
    date: '2026-10-20',
    now: '2026-10-20T10:00:00Z',
  });
  assert.deepEqual(p.predictedRange, [66, 74]); // 0.5*89 + 0.5*50 = 69.5, +0 for 50% solid, +/- 4
  assert.match(p.basis, /past unit exams average 89/);
  assert.deepEqual(EV.calibrate({ prediction: p, score: 72 }).inRange, true);
});

test("B-47 (D-104): examRetro sets the night-before prediction against the score and reads only E.V.'s own practice", () => {
  const exam = { ...E4, schema: 2 };
  const prediction = {
    id: 'E4',
    schema: 1,
    writer: 'morning',
    examId: 'E4',
    date: '2026-10-20',
    predictedRange: [78, 86],
    basis: 'past unit exams average 84',
  };
  const examedit = {
    id: 'E4',
    schema: 1,
    writer: 'page',
    score: 88.5,
    scoreAt: '2026-10-22T15:00:00Z',
    status: 'done',
  };
  const item = (id, objective) => ({
    id,
    type: 'single',
    stem: 'A made-up client asks a sample question.',
    options: ['a', 'b'],
    correct: [0],
    rationales: ['r', 'r'],
    objective,
    cjStep: 'take-action',
  });
  const sets = [
    { id: 'review-2026-10-19', kind: 'review', items: [item('q1', 'E4-3'), item('q2', 'E4-1'), item('q3', 'E5-1')] },
    { id: 'E4-drill-1', kind: 'drill', planTaskId: 't2', items: [item('d1', 'E4-3')] },
  ];
  const a = (iso, correct) => ({ [key(iso)]: { at: iso, correct } });
  const answers = [
    answersDoc('review-2026-10-19', {
      q1: { ...a(at('2026-10-19'), false), ...a(at('2026-10-20'), true) },
      q2: a(at('2026-10-19'), true),
      q3: a(at('2026-10-19'), false),
    }),
    answersDoc('E4-drill-1', { d1: { ...a(at('2026-10-20'), true), ...a(at('2026-10-23'), false) } }), // the miss after the exam is not part of it
  ];
  const models = [
    { ...ws('fluid-shift'), derived: { status: 'reviewed', recurrence: 1 } },
    { ...ws('potassium-limits'), derived: { status: 'parked', recurrence: 2, misses: 3 } },
    { ...ws('insulin-peak'), derived: { status: 'open', recurrence: 1, misses: 1 } },
    { ...ws('moved-one'), derived: { status: 'moved' } },
    { ...ws('other-exam', { objective: 'E5-1', exam: 'E5' }), derived: { status: 'open' } },
  ];
  const plans = EV.planViews(
    [
      {
        id: 'E4',
        exam: 'E4',
        days: [
          {
            date: '2026-10-18',
            tasks: [
              { id: 't1', text: 'Read chapter 12', kind: 'reading' },
              { id: 't2', text: 'Drill 1', kind: 'drill' },
            ],
          },
          { date: '2026-10-20', tasks: [{ id: 't3', text: 'Practice sim', kind: 'sim' }] },
          { date: '2026-10-25', tasks: [{ id: 't4', text: 'After the exam', kind: 'other' }] },
        ],
      },
    ],
    []
  );
  const r = EV.examRetro({
    examId: 'E4',
    exams: [exam],
    examedits: [examedit],
    predictions: [prediction],
    sets,
    answers,
    weakspots: models,
    plans,
    objectives: [{ id: 'E4-3', text: 'Fluid balance' }],
  });
  assert.equal(r.score, 88.5);
  assert.deepEqual(r.prediction, { predictedRange: [78, 86], basis: 'past unit exams average 84' });
  assert.deepEqual(r.calibration, { score: 88.5, predictedRange: [78, 86], inRange: false, error: 6.5 });
  assert.deepEqual([r.practice.answered, r.practice.right, r.practice.pct], [4, 3, 75]);
  assert.deepEqual(r.practice.byObjective, [
    { id: 'E4-3', text: 'Fluid balance', right: 2, n: 3, pct: 66.7 },
    { id: 'E4-1', text: '', right: 1, n: 1, pct: 100 },
  ]);
  assert.deepEqual([r.weakSpots.solid, r.weakSpots.open], [1, 2]);
  assert.deepEqual(
    r.weakSpots.openTopics.map(t => t.topic),
    ['potassium limits', 'insulin peak'],
    'the parked one stays open and comes first'
  );
  assert.deepEqual([r.plan.tasks, r.plan.ticked], [3, 2]); // the reading's day passed, the drill was fully answered; the sim is left
  assert.deepEqual(
    r.plan.left.map(t => t.text),
    ['Practice sim']
  );
  // No score yet (a retro on request): the numbers stand without calibration.
  const early = EV.examRetro({
    examId: 'E4',
    exams: [exam],
    predictions: [prediction],
    sets,
    answers,
    weakspots: models,
    plans,
  });
  assert.equal(early.score, null);
  assert.equal(early.calibration, null);
  assert.equal(EV.examRetro({ examId: 'E99', exams: [exam] }), null);
});

test('B-72 (D-120): weekInsights ranks objectives by accuracy, finds items missed every time, the recurrence leaders and study against the next day', async () => {
  const { weekInsights } = await import('../core/derive.mjs');
  const q = (id, objective, topic, type = 'single') => ({
    id,
    objective,
    topic,
    type,
    correct: [0],
    cjStep: 'analyze-cues',
  });
  const sets = [
    {
      id: 's1',
      items: [q('a', 'E9-1', 'Potassium'), q('b', 'E9-2', 'Sodium', 'select-all'), q('c', 'E9-2', 'Calcium')],
    },
  ];
  const ans = (day, n, right) => ({
    chosen: [right ? 0 : 1],
    correct: right,
    score: right ? 1 : 0,
    at: `2026-10-${day}T15:0${n}:00Z`,
  });
  const answers = [
    {
      id: 's1',
      setId: 's1',
      answers: {
        a: { p1: ans(13, 1, false), p2: ans(14, 1, false), p3: ans(16, 1, false) },
        b: { p1: ans(13, 2, true), p2: ans(16, 2, true) },
        c: { p1: ans(14, 3, true), p2: ans(16, 3, false) },
      },
    },
  ];
  const models = [
    { id: 'w1', topic: 'Potassium', derived: { recurrence: 3, status: 'open' } },
    { id: 'w2', topic: 'Sodium', derived: { recurrence: 1, status: 'open' } },
  ];
  const db = {
    sessions: [{ id: 'ss-1', date: '2026-10-15', minutes: 45 }],
    dayedits: [{ id: '2026-10-15', checkin: { energy: 4, at: '2026-10-15T12:00:00Z' } }],
  };
  const r = weekInsights({ sets, answers, models }, db, '2026-10-18');
  assert.deepEqual(r.window, { from: '2026-09-21', to: '2026-10-18' });
  assert.deepEqual(r.byObjective, [
    { id: 'E9-1', right: 0, n: 3, pct: 0 },
    { id: 'E9-2', right: 3, n: 4, pct: 75 },
  ]);
  assert.equal(r.weakestObjective, 'E9-1');
  assert.deepEqual(r.missedEvery, [
    { ref: 'sets/s1#a', topic: 'Potassium', objective: 'E9-1', attempts: 3, missed: 3 },
  ]);
  assert.equal(r.neverMissed, 1);
  assert.deepEqual(r.recurrence, [{ weakspotId: 'w1', topic: 'Potassium', recurrence: 3 }]);
  const d15 = r.studyVsNextDay.find(x => x.date === '2026-10-15');
  // D-416: the check-in is retired, so an old day's energy reads null; the field keeps old weeks' shape
  assert.deepEqual(d15, { date: '2026-10-15', minutes: 45, energy: null, nextAnswers: 3, nextPct: 33 });
  assert.deepEqual(r.lines, [
    'Weakest objective: E9-1, 0 of 3 right (0%).',
    'Missed every time: Potassium (3 of 3).',
    'Back most often: Potassium (3 times).',
  ]);
  assert.equal(r.byFormat[0].id, 'single');
});

test('B-406: study vs next day leaves out a discarded session', async () => {
  const { weekInsights } = await import('../core/derive.mjs');
  const db = {
    sessions: [
      { id: 'ss-1', date: '2026-10-15', minutes: 45 },
      { id: 'ss-2', date: '2026-10-15', minutes: 25, status: 'discarded' },
    ],
  };
  const r = weekInsights({ sets: [], answers: [], models: [] }, db, '2026-10-18');
  assert.equal(r.studyVsNextDay.find(x => x.date === '2026-10-15').minutes, 45);
});

test("B-478: examScope answers a course's objectives ask from its next exam, never a past one", () => {
  const open = (id, exam, objective = '') => ({ id, exam, objective, course: 'NUR 112', derived: { status: 'open' } });
  const exams = [
    { id: 'E4', title: 'Exam 4', date: '2026-10-20', course: 'NUR 112', kind: 'unit' },
    { id: 'ATI-D', title: 'ATI Proctored Dosage Assessment', date: '2026-11-02', course: 'NUR 112', kind: 'ati' },
    { id: 'E5', title: 'Exam 5', date: '2026-11-20', course: 'NUR 112', kind: 'unit' },
  ];
  const objectives = [
    { id: 'E4-1', exam: 'E4', text: 'Fluid balance' },
    { id: 'E5-1', exam: 'E5', text: 'Bowel elimination' },
  ];
  const weakspots = [open('w1', 'E4', 'E4-1'), open('w2', 'ATI-D'), open('w3', 'E5', 'E5-1')];
  const plans = [
    { id: 'ATI-D', exam: 'ATI-D', days: [{ date: '2026-10-30', tasks: [{ id: 't1', kind: 'practice' }] }] },
  ];
  const s = EV.examScope({ exams, objectives, weakspots, plans, date: '2026-10-29', course: 'NUR 112' });
  assert.equal(s.exam.id, 'ATI-D'); // the next exam, not Exam 4 (past) and not the one after it with objectives
  assert.equal(s.noObjectives, true);
  assert.deepEqual(s.objectives, []);
  assert.deepEqual(
    s.weakspots.map(w => w.id),
    ['w2']
  );
  assert.equal(s.plan.id, 'ATI-D');
  assert.equal(s.tasksLeft, 1);
  // with objectives, they are the next exam's
  const t = EV.examScope({ exams, objectives, weakspots, plans, date: '2026-11-03', course: 'NUR 112' });
  assert.equal(t.exam.id, 'E5');
  assert.equal(t.noObjectives, false);
  assert.deepEqual(
    t.objectives.map(o => o.id),
    ['E5-1']
  );
  // no exam ahead
  assert.equal(EV.examScope({ exams, date: '2026-12-01', course: 'NUR 112' }).exam, null);
});
