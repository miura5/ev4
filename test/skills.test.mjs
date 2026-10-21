// E.V. core's skills practice and workouts (B-158, split from core.test.mjs with their sections): workouts (D-108) and
// Quizlet cards from weak spots. The skills runs themselves are tested in features.test.mjs. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import { makeSkills } from '../core/skills.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { describeErrors } from '../core/validate.mjs';

const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url)));
EV.configure(spec);
const validate = loadValidator();

const at = (date, hm = '15:00') => `${date}T${hm}:00Z`; // 15:00Z = 10:00 Central (CDT)
const key = (iso, writer = 'page') => EV.eventKey(writer, iso);
const ev = (iso, e, writer = 'page') => ({ [key(iso, writer)]: { ...e } });
const ws = (id, extra = {}) => ({
  id,
  schema: 1,
  writer: 'page',
  at: at('2026-10-15'),
  source: 'test',
  topic: id.replace(/-/g, ' '),
  objective: 'E4-3',
  exam: 'E4',
  course: 'NUR 112',
  kind: 'concept',
  addedBy: 'test',
  initial: { streak: 0, nextDue: '2026-10-16', recurrence: 1, misses: 0 },
  events: {},
  ...extra,
});
const att = (date, correct, extra = {}) => ({ at: at(date, extra.hm || '15:00'), date, correct, ...extra });
const E4 = { id: 'E4', course: 'NUR 112', kind: 'unit', date: '2026-10-21', title: 'Exam 4' };
/** Validates a planned write: a set as the whole document; an update merged (nested maps) into the document it updates. */
function assertValid(w, existing = null) {
  const merge = (a, b) => {
    const o = { ...a };
    for (const [k, v] of Object.entries(b))
      o[k] =
        v && typeof v === 'object' && !Array.isArray(v) && a && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
    return o;
  };
  const doc = w.op === 'update' ? merge(EV.docData(existing), w.data) : w.data;
  const r = validate(w.collection, doc, { id: w.id });
  assert.ok(r.ok, describeErrors(`${w.collection}/${w.id}`, r));
}

test('B-158: skills practice and workouts are their own file, one factory, and E.V. core still exports every name', () => {
  const src = fs.readFileSync(new URL('../core/skills.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'no imports: it runs in the page as written');
  assert.deepEqual(src.match(/^export .*/gm), ['export function makeSkills(core) {']);
  const core = fs.readFileSync(new URL('../core/evcore.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /function startSkill|function startWorkout|function weakspotCards/, 'moved, not copied');
  for (const n of [
    'skillSteps',
    'startSkill',
    'endSkill',
    'startWorkout',
    'workoutState',
    'weakspotCards',
    'cardsText',
  ])
    assert.equal(typeof EV[n], 'function', n);
  assert.equal(typeof makeSkills, 'function');
});

test('B-52 (D-108): CINDY keeps rounds in the cap, the ladder its time and stop point; every write validates', () => {
  const q = EV.workoutSequences();
  assert.deepEqual(Object.keys(q).sort(), ['cindy', 'ladder-1500']);
  const L = q['ladder-1500'];
  assert.equal(L.rungs.length, 19);
  assert.equal(L.rungs.reduce((a, r) => a + r, 0) * L.moves.reduce((a, m) => a + m.per, 0), 1500);
  assert.deepEqual(EV.workoutMoves(L, 10), [
    { move: 'pull-ups', reps: 10 },
    { move: 'dips', reps: 20 },
    { move: 'push-ups', reps: 30 },
    { move: 'sit-ups', reps: 40 },
    { move: 'air squats', reps: 50 },
  ]);
  const apply = (doc, w) => {
    const merge = (a, b) => {
      const o = { ...a };
      for (const [k, v] of Object.entries(b))
        o[k] =
          v && typeof v === 'object' && !Array.isArray(v) && a && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
      return o;
    };
    assertValid(w, doc);
    return w.op === 'set' ? { ...w.data, id: w.id } : { ...merge(doc, w.data), id: doc.id };
  };
  // CINDY: three rounds, the cap passes, 7 extra reps typed, then energy and mood.
  const t0 = '2026-10-19T12:00:00Z';
  const min = m => new Date(Date.parse(t0) + m * 60000).toISOString();
  const s = EV.startWorkout(q.cindy, { now: t0 });
  assert.equal(s.id, 'wo-20261019-120000-cindy');
  let c = apply(null, s);
  for (const m of [6, 12, 18]) c = apply(c, EV.workoutRound(c, q.cindy, { now: min(m) }));
  let st = EV.workoutState(c, q.cindy, min(19));
  assert.deepEqual([st.done, st.current, st.reps, Math.round(st.leftMs / 1000)], [3, 4, 90, 60]);
  assert.equal(EV.workoutState(c, q.cindy, min(20)).over, true);
  assert.throws(() => EV.workoutRound(c, q.cindy, { now: min(21) }), /time cap has passed/);
  c = apply(c, EV.endWorkout(c, q.cindy, { now: min(20.5), extraReps: 7 }));
  assert.deepEqual(
    [c.status, c.result],
    ['done', { rounds: 3, extraReps: 7, reps: 97, totalSeconds: 1200, completed: true }]
  );
  assert.throws(() => EV.workoutCheckin(c, { energy: 6 }), /energy is 1 to 5/);
  assert.throws(() => EV.workoutCheckin(c, { energy: 3, mood: 'patient in room 12 was loud' }), /room number/);
  c = apply(c, EV.workoutCheckin(c, { energy: 4, mood: '  strong,   arms gone ' }));
  assert.equal(EV.workoutSummary(c, q.cindy), '3 rounds + 7 reps in 20 min · energy 4/5 · “strong, arms gone”');
  const early = apply(
    apply(
      apply(null, EV.startWorkout(q.cindy, { now: t0 })),
      EV.workoutRound({ ...apply(null, EV.startWorkout(q.cindy, { now: t0 })) }, q.cindy, { now: min(4) })
    ),
    { op: 'update', collection: 'workouts', id: 'wo-20261019-120000-cindy', data: {} }
  );
  const e2 = apply(early, EV.endWorkout(early, q.cindy, { now: min(9), stopped: true }));
  assert.equal(EV.workoutSummary(e2, q.cindy), '1 round in 9:00, stopped before the 20-minute cap');
  // The ladder, stopped in round 6 after 5 rungs.
  let l = apply(null, EV.startWorkout(L, { now: t0 }));
  for (let n = 1; n <= 5; n++) l = apply(l, EV.workoutRound(l, L, { now: min(3 * n) }));
  assert.deepEqual(EV.workoutState(l, L, min(16)).moves[0], { move: 'pull-ups', reps: 6 });
  l = apply(l, EV.endWorkout(l, L, { now: min(17), stopped: true }));
  assert.deepEqual(
    [l.status, l.result],
    ['stopped', { rounds: 5, totalSeconds: 1020, reps: 225, completed: false, stopRound: 6 }]
  );
  assert.equal(EV.workoutSummary(l, L), 'stopped in round 6 after 17:00 (225 reps)');
  // All 19 rungs: completed, total time kept.
  let f = apply(null, EV.startWorkout(L, { now: t0 }));
  for (let n = 1; n <= 19; n++) f = apply(f, EV.workoutRound(f, L, { now: min(3 * n) }));
  assert.equal(EV.workoutState(f, L, min(58)).over, true);
  f = apply(f, EV.endWorkout(f, L, { now: min(58) }));
  assert.deepEqual([f.status, f.result.completed, f.result.reps, f.result.totalSeconds], ['done', true, 1500, 3480]);
  assert.equal(EV.workoutSummary(f, L), 'all 19 rounds in 58:00');
  assert.throws(() => EV.workoutRound(f, L, { now: min(59) }), /this workout is over/);
  assert.throws(
    () => EV.workoutRound({ ...f, status: 'active', endedAt: null }, L, { now: min(59) }),
    /every round is done/
  );
  assert.deepEqual(EV.workoutMoves(L, 20), []);
  assert.deepEqual(EV.workoutMoves(null, 1), []);
  assert.throws(() => EV.startWorkout(null, { now: t0 }), /no such workout/);
  assert.equal(EV.workoutSummary({ ...f, result: null }, L), '');
});

test('B-41: weakspotCards turns open concept weak spots into one-line Quizlet cards with the last rationale missed', () => {
  const at = '2026-10-16T14:00:00Z';
  const ws = (id, extra = {}) => ({
    id,
    schema: 1,
    writer: 'page',
    at,
    source: 't',
    topic: 'Made-up\ttopic ' + id,
    objective: 'E4-7',
    exam: 'E4',
    course: 'NUR 112',
    kind: 'concept',
    addedBy: 't',
    initial: { streak: 0, nextDue: '2026-10-17', recurrence: 1, misses: 0 },
    events: {},
    ...extra,
  });
  const sets = [
    {
      id: 'review-2026-10-16',
      kind: 'review',
      date: '2026-10-16',
      items: [
        {
          id: 'q1',
          kind: 'review',
          weakspotId: 'a',
          objective: 'E4-7',
          topic: 't',
          type: 'single',
          stem: 'Made-up stem?',
          options: ['Wrong', 'Right\nanswer'],
          correct: [1],
          rationales: ['No.', 'Because of the\tmade-up reason.'],
        },
      ],
    },
  ];
  const answers = [
    {
      id: 'review-2026-10-16',
      setId: 'review-2026-10-16',
      answers: {
        q1: { 'page-20261016-150000000': { chosen: [0], correct: false, score: 0, at: '2026-10-16T15:00:00Z' } },
      },
    },
  ];
  const models = EV.buildWeakspots({
    weakspots: [ws('a'), ws('b'), ws('n', { kind: 'note' })],
    sets,
    answers,
    exams: [{ id: 'E4', date: '2026-10-21', course: 'NUR 112', kind: 'unit', status: 'upcoming' }],
  });
  const cards = EV.weakspotCards({
    weakspots: models,
    objectives: [{ id: 'E4-7', exam: 'E4', text: 'Describe made-up drug classes' }],
    sets,
    answers,
  });
  assert.deepEqual(
    cards.map(c => c.term),
    ['Made-up topic a', 'Made-up topic b'],
    'concept weak spots only, tabs flattened'
  );
  assert.equal(
    cards[0].definition,
    'E4-7: Describe made-up drug classes · Answer: Right answer. Because of the made-up reason.'
  );
  assert.equal(cards[1].definition, 'E4-7: Describe made-up drug classes');
  assert.ok(
    EV.cardsText(cards)
      .split('\n')
      .every(l => l.split('\t').length === 2)
  );
});
