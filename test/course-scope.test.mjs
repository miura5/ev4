// B-498: an exam's plan holds only its own course's work, and a miss files under its own course. The plan's make
// context, its saved draft, an edit's patch, Today's plan copies, a quiz miss, a session finding, the page's course of
// a spot, and the read-only listing of what a record already holds mixed. Made-up records throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { spec, at, key, ws, assertValid } from './core-fixtures.mjs';
import { mixedCourses, report } from '../tools/mixed-courses.mjs';

const env = { schema: 1, writer: 'test', at: at('2026-10-20'), source: 'test' };
const EXAMS = [
  { id: 'E5', ...env, course: 'NUR 112', title: 'Exam 5', date: '2026-11-17', kind: 'unit' },
  { id: 'BX3', ...env, course: 'BIO 201', title: 'Lecture Exam 3', date: '2026-11-02', kind: 'unit' },
];
const OBJECTIVES = [
  { id: 'E5-1', ...env, exam: 'E5', text: 'Fluid volume deficit' },
  { id: 'BX3-2', ...env, exam: 'BX3', text: 'Bone remodeling' },
];
const DATES = [
  {
    id: 'nur-quiz-6',
    ...env,
    date: '2026-10-30',
    title: 'NUR 112 quiz 6',
    kind: 'quiz',
    course: 'NUR 112',
    graded: true,
  },
  {
    id: 'bio-lab-9',
    ...env,
    date: '2026-10-31',
    title: 'Lab practical 9',
    kind: 'lab',
    course: 'BIO 201',
    graded: true,
  },
];
const scope = { dates: DATES, exams: EXAMS, objectives: OBJECTIVES, materials: [], notes: [] };
const section = {
  course: 'BIO 201',
  from: '2026-10-29',
  to: '2026-11-02',
  exam: { id: 'BX3', title: 'Lecture Exam 3' },
};

test('B-498: a BIO plan’s make context holds BIO’s dated items with ids; NUR’s only as load, with no ids', () => {
  const ctx = EV.studyPlanContext(
    { exams: EXAMS, objectives: OBJECTIVES, dates: DATES, materials: [], notes: [], plans: [] },
    { date: '2026-10-29', job: { course: 'BIO 201', brief: 'a plan' }, spec, constants: EV.constants() }
  );
  assert.equal(ctx.section.exam.id, 'BX3');
  assert.deepEqual(
    ctx.dates.map(d => d.id),
    ['bio-lab-9']
  );
  assert.ok(ctx.exams.every(e => e.course === 'BIO 201'));
  assert.deepEqual(
    ctx.otherCourses.items.map(x => [x.course, x.title, x.id]),
    [['NUR 112', 'NUR 112 quiz 6', undefined]]
  );
  assert.match(ctx.otherCourses.note, /never a task of this plan/);
});

test('B-498: a weak spot counts toward its objective’s course, whatever course it was filed under', () => {
  const misfiled = ws('ws-bones', { objective: 'BX3-2', exam: 'BX3', course: 'NUR 112' });
  assert.equal(EV.spotCourse(misfiled, { exams: EXAMS, objectives: OBJECTIVES }), 'BIO 201');
  assert.equal(EV.spotCourse(ws('ws-x', { objective: '', exam: '', course: 'BIO 201' }), { exams: EXAMS }), 'BIO 201');
  assert.equal(EV.spotCourse(ws('ws-y', { objective: '', exam: '', course: undefined }), { exams: EXAMS }), 'NUR 112');
  // a BIO plan's context takes BIO's open spots only, the misfiled one included
  const models = EV.buildWeakspots({
    weakspots: [misfiled, ws('ws-fluids', { objective: 'E5-1', exam: 'E5' })],
    sets: [],
    answers: [],
    exams: EXAMS,
  });
  const ctx = EV.studyPlanContext(
    { exams: EXAMS, objectives: OBJECTIVES, dates: DATES, materials: [], notes: [], plans: [] },
    { date: '2026-10-29', job: { course: 'BIO 201', brief: 'a plan' }, spec, models, constants: EV.constants() }
  );
  assert.deepEqual(
    ctx.weakSpots.map(w => w.id),
    ['ws-bones']
  );
});

test('B-498: a made plan’s tasks that are another course’s work are left out and counted', () => {
  const plan = {
    title: 'BX3 plan',
    days: [
      {
        date: '2026-10-30',
        tasks: [
          { id: 'a', text: 'Bone remodeling flashcards', kind: 'review', tag: 'review' },
          { id: 'b', text: 'Quiz 6', kind: 'graded', tag: 'graded', ref: 'dates/nur-quiz-6' },
          { id: 'c', text: 'Review NUR 112 fluids weak spots', kind: 'review', tag: 'review' },
          { id: 'd', text: 'Lab practical 9 prep', kind: 'practice', tag: 'practice', ref: 'dates/bio-lab-9' },
        ],
      },
    ],
  };
  const r = EV.studyPlanDoc(plan, { section, dates: [DATES[1]], spec, scope });
  assert.deepEqual(
    r.plan.days[0].tasks.map(t => t.id),
    ['a', 'd']
  );
  assert.equal(r.offCourse, 2);
  // with no scope (an older caller) nothing more is dropped than before
  assert.equal(EV.studyPlanDoc(plan, { section, dates: [DATES[1]], spec }).offCourse, 0);
});

test('B-498: an edit’s patch never adds another course’s work; tasks it leaves alone stay as they were', () => {
  const draft = {
    id: 'BX3-2',
    exam: 'BX3',
    section,
    days: [{ date: '2026-10-30', tasks: [{ id: 'old', text: 'Old NUR 112 carry-over', kind: 'review' }] }],
  };
  const r = EV.applyPlanPatch(
    draft,
    {
      ops: [
        { op: 'add', date: '2026-10-31', task: { id: 'n1', text: 'Quiz 6', ref: 'dates/nur-quiz-6' } },
        { op: 'add', date: '2026-10-31', task: { id: 'n2', text: 'Skull bones drill' } },
      ],
    },
    { dates: DATES, scope }
  );
  assert.equal(r.offCourse, 1);
  const ids = r.plan.days.flatMap(d => d.tasks.map(t => t.id));
  assert.deepEqual(ids.sort(), ['n2', 'old']);
});

test('B-498: an added Today item of one course never joins another course’s plan task by its words', () => {
  const plans = [
    {
      id: 'BX3',
      exam: 'BX3',
      section,
      days: [{ date: '2026-10-30', tasks: [{ id: 't', text: 'Review weak spots' }] }],
    },
  ];
  assert.equal(EV.planCopyRef(plans, '2026-10-30', 'Review weak spots'), 'plans/BX3#t');
  assert.equal(EV.planCopyRef(plans, '2026-10-30', 'Review weak spots', 'NUR 112'), null);
  assert.equal(EV.planCopyRef(plans, '2026-10-30', 'Review weak spots', 'BIO 201'), 'plans/BX3#t');
});

test('B-498: a miss on a BIO quiz files under BIO, by its objective or the course its set was written for', () => {
  const item = { id: 'm1', kind: 'check', type: 'single', topic: 'Osteoclasts', stem: 'Which cell resorbs bone?' };
  const q = { ...item, options: ['Osteoclast', 'Osteoblast', 'Osteocyte', 'Chondrocyte'], correct: [0] };
  q.rationales = ['Yes.', 'No.', 'No.', 'No.'];
  const miss = (qq, set) =>
    EV.planAnswer({ set, item: qq, chosen: [1], now: '2026-10-29T15:00:00Z', weakspots: [], exams: EXAMS });
  // Quiz me's set for a course with no exam in it: its focus names the course (B-375)
  const focus = { id: 'more-2026-10-29-1', kind: 'more', focus: 'BIO 201', items: [q] };
  const a = miss(q, focus).writes.find(w => w.collection === 'weakspots');
  assert.equal(a.data.course, 'BIO 201');
  assertValid(a);
  // an objective of the BIO exam, on a set naming no exam or course
  const b = miss({ ...q, objective: 'BX3-2' }, { id: 'more-x', kind: 'more', items: [q] }).writes.find(
    w => w.collection === 'weakspots'
  );
  assert.equal(b.data.course, 'BIO 201');
});

test('B-498: a study session’s missed check files under its objective’s course', () => {
  const T0 = '2026-10-29T15:00:00.000Z';
  const s = {
    id: 'ss-20261029-150000-b1',
    source: 'E.V. Home',
    status: 'ending',
    kind: 'note',
    topic: 'Bones',
    startedAt: T0,
    events: { [key(T0)]: { type: 'start' }, [key('2026-10-29T15:20:00.000Z')]: { type: 'end' } },
  };
  const wrap = { summary: 'Bones.', weakSpots: [{ objective: 'BX3-2', topic: 'Osteoclast vs osteoblast' }] };
  const r = EV.closeSession(s, wrap, { objectives: OBJECTIVES, exams: EXAMS, now: '2026-10-29T15:21:00.000Z' });
  const spot = r.writes.find(w => w.collection === 'weakspots' && w.op === 'set');
  assert.equal(spot.data.course, 'BIO 201');
  assert.equal(spot.data.proposed, true);
});

test('B-498: the listing names a plan’s other-course task and a misfiled spot, and changes nothing', () => {
  const db = {
    exams: EXAMS,
    objectives: OBJECTIVES,
    dates: DATES,
    dateedits: [],
    materials: [],
    notes: [],
    planedits: [{ id: 'BX3', ...env, schema: 2, ticks: {}, plan: 'BX3' }], // approved: the plan in force
    plans: [
      {
        id: 'BX3',
        ...env,
        exam: 'BX3',
        section,
        days: [
          {
            date: '2026-10-30',
            tasks: [
              { id: 'a', text: 'Bone remodeling flashcards' },
              { id: 'b', text: 'Quiz 6', ref: 'dates/nur-quiz-6' },
            ],
          },
        ],
      },
    ],
    weakspots: [
      ws('ws-bones', { objective: 'BX3-2', exam: 'BX3', course: 'NUR 112' }),
      ws('ws-fluids', { objective: 'E5-1', exam: 'E5' }),
    ],
  };
  const before = JSON.stringify(db);
  const m = mixedCourses(db);
  assert.deepEqual(
    m.tasks.map(t => [t.plan, t.task, t.theirs]),
    [['BX3', 'b', 'NUR 112']]
  );
  assert.deepEqual(
    m.spots.map(w => [w.id, w.filed, w.own]),
    [['ws-bones', 'NUR 112', 'BIO 201']]
  );
  assert.match(report(m).join('\n'), /plans\/BX3 \(BIO 201 BX3, in force\) 2026-10-30 b: NUR 112: Quiz 6/);
  assert.equal(JSON.stringify(db), before, 'read only');
  void spec;
});
