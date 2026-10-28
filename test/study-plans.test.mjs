// B-449 (D-354, D-355, D-356): study plans on the synthetic record. His instructions (settings/study-plan, the spec's
// default kept equal to docs/study-plan-brief.md); the course's current section; the make ask's context and the edit
// ask's; the answer shape, the one fix ask and the saved draft; the edit patch; the usage check; the Worker's purposes;
// planDay with a plan's minutes, doneWhen and refs; the chat's choice between a change and a new plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import EV from '../core/evcore.mjs';
import * as J from '../pwa/jobs.mjs';
import { jobReply, PLANTS } from '../pwa/job-stub.mjs';
import { seedRecord } from '../pwa/seed.mjs';
import { loadSchemas } from '../core/schemas.mjs';
import { makeValidator, validateAgainst } from '../core/validate.mjs';
import worker from '../pwa/worker.js';
import { tokensOf, purposeOf } from '../pwa/claude.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const schemas = loadSchemas();
const validate = makeValidator(schemas);
const NOW = new Date('2026-10-25T15:00:00Z'); // the synthetic record: E3 on Oct 13, E4 on Oct 27, E5 on Nov 17
const TODAY = '2026-10-25';
const clone = v => JSON.parse(JSON.stringify(v));

function record() {
  const db = J.asRunDb(seedRecord(NOW));
  // a BIO 201 lab in the window: the context holds both courses' dated items
  db.dates.push({
    id: 'bio-lab-oct26',
    schema: 1,
    writer: 'page',
    at: NOW.toISOString(),
    source: 'test',
    date: '2026-10-26',
    title: 'BIO 201 lab: renal histology',
    kind: 'other',
    course: 'BIO 201',
    graded: false,
    notes: 'Pre-lab quiz due before lab',
  });
  return db;
}
function withJob(db, job) {
  const id = job.id || 'job-test-plan';
  db.jobs = [
    ...(db.jobs || []),
    { schema: 2, writer: 'page', at: NOW.toISOString(), source: 'E.V. Home', kind: 'exam-plan', ...job, id },
  ];
  return id;
}
async function run(db, job, { usage, reply = jobReply } = {}) {
  const jobId = withJob(db, job);
  const asks = [];
  const writes = [];
  const r = await J.runJob({
    db,
    spec,
    schemas,
    jobId,
    now: NOW,
    release: 'v4.5.5+1',
    usage,
    ask: async body => (asks.push(clone(body)), reply(body)),
    write: async w => writes.push(w),
  });
  return { r, asks, writes: writes.flat(), jobId };
}
const words = body =>
  body.messages
    .flatMap(m => (typeof m.content === 'string' ? [m.content] : m.content.map(b => b.text || b.content || '')))
    .join('\n');

test('B-449: the default instructions are docs/study-plan-brief.md, built into the spec (drift test)', () => {
  const file = fs.readFileSync(path.join(ROOT, 'docs/study-plan-brief.md'), 'utf8');
  assert.equal(spec.jobs.kinds['exam-plan'].instructions, file, 'rebuild the spec copy from the file');
  assert.deepEqual(EV.studyPlanInstructions(null, spec), { text: file, from: 'default', missing: 'ask' });
  assert.match(EV.studyPlanHardRules(file, spec), /^1\. \*\*Nothing is left off the calendar/);
  assert.doesNotMatch(EV.studyPlanHardRules(file, spec), /Rubric|Course profiles/);
});

test('B-449: settings/study-plan holds his instructions (the page writes it, an Edit); blank goes back to the default', () => {
  const w = EV.studyPlanSettingsWrite(null, '  Plan short days.\n\n## Hard rules\n\n1. No all-nighters.  ', {
    now: NOW,
  });
  assert.equal(w.id, 'study-plan');
  assert.ok(validate('settings', w.data, { id: 'study-plan' }).ok);
  assert.deepEqual(EV.studyPlanInstructions(w.data, spec).from, 'settings');
  assert.equal(EV.studyPlanHardRules(w.data.instructions, spec), '1. No all-nighters.');
  const back = EV.studyPlanSettingsWrite(w.data, '   ', { now: NOW });
  assert.equal(back.data.instructions, null);
  assert.equal(back.data.at, w.data.at, 'the envelope is kept, updatedAt moves');
  assert.equal(EV.studyPlanInstructions(back.data, spec).from, 'default');
  assert.ok(validate('settings', back.data, { id: 'study-plan' }).ok);
  // B-450's two options ride on the same document; what a write leaves out stays
  const opts = EV.studyPlanSettingsWrite(back.data, { missing: 'note', approved: 'plan' }, { now: NOW });
  assert.deepEqual([opts.data.instructions, opts.data.missing, opts.data.approved], [null, 'note', 'plan']);
  assert.ok(validate('settings', opts.data, { id: 'study-plan' }).ok);
  assert.equal(EV.studyPlanInstructions(opts.data, spec).missing, 'note');
  assert.throws(() => EV.studyPlanSettingsWrite(null, { missing: 'maybe' }), /ask or note/);
  assert.equal(spec.collections.settings.class, 'Edit');
  assert.deepEqual(spec.collections.settings.writers, ['page']);
});

test('B-449: a course’s current section runs from the later of today and the day after its last exam, through its next', () => {
  const db = record();
  const s = EV.studyPlanSection({ exams: db.exams, course: 'NUR 112', date: TODAY });
  assert.deepEqual([s.from, s.to, s.exam.id, s.lastExam.id], ['2026-10-25', '2026-10-27', 'E4', 'E3']);
  const after = EV.studyPlanSection({ exams: db.exams, course: 'nur112', date: '2026-10-28' });
  assert.deepEqual([after.from, after.to, after.exam.id], ['2026-10-28', '2026-11-17', 'E5']);
  const named = EV.studyPlanSection({ exams: db.exams, course: 'NUR 112', date: TODAY, examId: 'E5' });
  assert.deepEqual([named.from, named.to], ['2026-10-28', '2026-11-17'], 'E5’s section starts the day after E4');
  assert.equal(EV.studyPlanSection({ exams: db.exams, course: 'BIO 201', date: TODAY }), null);
  assert.equal(EV.studyPlanCourse({ title: 'Study plan', brief: 'a cram plan for E5' }, db.exams), 'NUR 112');
  assert.equal(EV.studyPlanCourse({ course: 'nur 112' }, db.exams), 'NUR 112');
  assert.equal(EV.studyPlanCourse({ title: 'x', brief: 'something' }, db.exams), null);
});

test('B-449: the make ask’s context: both courses’ dated items with ids and 3 days past the exam, objectives, materials, passages, notes, weak spots, scores, budget, progress', () => {
  const db = record();
  db.plans
    .find(p => p.id === 'E4')
    .days[0].tasks.push({ id: 'e4-terms-24', text: 'Terms: Ch 39', kind: 'terminology' });
  const ctx = EV.studyPlanContext(db, {
    date: TODAY,
    job: { title: 'Study plan: NUR 112', brief: 'a plan', course: 'NUR 112' },
    spec,
    models: EV.buildWeakspots({ weakspots: db.weakspots, sets: db.sets, answers: db.answers, exams: db.exams }),
    constants: EV.constants(),
  });
  assert.equal(ctx.mode, 'make');
  assert.equal(ctx.section.exam.id, 'E4');
  assert.ok(ctx.dates.every(d => d.id && d.date >= '2026-10-25' && d.date <= '2026-10-30'));
  assert.ok(
    ctx.dates.some(d => d.id === 'bio-lab-oct26' && d.notes),
    'the other course’s lab, with its notes'
  );
  assert.ok(
    ctx.dates.some(d => d.date === '2026-10-30'),
    'three days past the exam'
  );
  assert.ok(!ctx.dates.some(d => d.date > '2026-10-30'));
  assert.ok(ctx.objectives.length && ctx.objectives.every(o => o.id.startsWith('E4-')));
  assert.ok(ctx.materials.length && ctx.materials.every(m => /^materials\//.test(m.ref) && !m.text));
  assert.ok(ctx.passages.length && ctx.passages.every(p => p.text.length <= 600));
  assert.ok(ctx.notes.length && ctx.notes.every(n => n.excerpt.length <= 400 && !/\(earlier\)/.test(n.title)));
  assert.ok(!ctx.notes.some(n => /Renal/.test(n.title)), 'only the course’s notes');
  assert.ok(ctx.weakSpots.length);
  assert.deepEqual(
    ctx.scores.map(s => [s.id, s.score]),
    [['E3', 86]]
  );
  assert.equal(ctx.budget.dayMinutes.class, 180);
  // the exam already has a plan (plans/E4): the new one carries its progress
  assert.equal(ctx.progress.plan, 'E4');
  assert.ok(
    ctx.progress.missed.some(t => t.id === 'e4-terms-24'),
    'a past drill left undone'
  );
  assert.ok(
    ctx.progress.done.some(t => t.id === 'e4-drill-39'),
    'its set answered'
  );
  assert.equal(ctx.progress.left, 1);
  const none = EV.studyPlanContext(db, { date: TODAY, job: { course: 'BIO 201', brief: 'x' }, spec });
  assert.match(none.refused, /no BIO 201 exam ahead/);
});

test('B-449: making a plan asks Sonnet once by purpose, with his instructions and the record cache-marked, 24k long', async () => {
  const db = record();
  db.settings = [
    {
      id: 'study-plan',
      ...EV.studyPlanSettingsWrite(null, { instructions: 'MY OWN PLAN RULES', missing: 'note' }, { now: NOW }).data,
    },
  ];
  const { r, asks, writes, jobId } = await run(db, {
    title: 'Study plan: NUR 112',
    brief: 'a cram plan, 2 hours a day',
    course: 'NUR 112',
  });
  assert.equal(r.status, 'done', r.said);
  assert.equal(asks.length, 1, 'a passing score: no fix ask');
  const a = asks[0];
  assert.equal(a.purpose, 'exam-plan');
  assert.equal(a.max_tokens, 24000);
  assert.equal(a.model, undefined, 'the page never names a model');
  assert.deepEqual(a.cache, [
    { m: 0, b: 0 },
    { m: 0, b: 1 },
  ]);
  const [stable, material] = a.messages[0].content.map(b => b.text);
  assert.match(stable, /MY OWN PLAN RULES/);
  assert.doesNotMatch(stable, /Study Plan Maker/, 'his instructions replace the default');
  assert.match(stable, /note it as an open question and go on/, 'his missing-item option');
  assert.match(material, /"passages":/);
  assert.match(material, /cram plan, 2 hours a day/, 'his intent words reach the ask');
  const plan = writes.find(w => w.collection === 'plans');
  assert.equal(plan.id, 'E4-2', 'plans/E4 is not replaced');
  assert.ok(validate('plans', plan.data, { id: plan.id }).ok);
  assert.deepEqual(plan.data.section, { course: 'NUR 112', from: '2026-10-25', to: '2026-10-27' });
  assert.equal(plan.data.instructions, 'settings');
  assert.equal(plan.data.days[0].date, TODAY, 'a new plan starts today');
  const t2 = plan.data.days[0].tasks.find(t => t.id === 't2');
  assert.deepEqual([t2.ref, t2.tag, t2.minutes, t2.doneWhen], ['dates/synthetic-ati', 'graded', 45, 'submitted']);
  assert.equal(plan.data.score.total, 88);
  assert.ok(plan.data.openQuestions.length);
  const res = writes.find(w => w.collection === 'jobresults' && w.data.status === 'done');
  assert.equal(res.data.result.planId, 'E4-2');
  assert.equal(res.data.result.usage.asks, 1);
  assert.ok(validate('jobresults', res.data, { id: jobId }).ok);
  assert.ok(!writes.some(w => w.collection === 'dayedits'), 'plan tasks never go into dayedits');
  // the old plan stays in force until he accepts the new draft
  const after = [...db.plans, { ...plan.data, id: plan.id }];
  assert.equal(EV.planViews(after, []).find(p => p.exam === 'E4').id, 'E4');
  const ok = EV.planAccept(null, 'E4', 'E4-2', { now: NOW });
  assert.ok(validate('planedits', ok.data, { id: 'E4' }).ok);
  assert.equal(EV.planViews(after, [{ id: 'E4', ...ok.data }]).find(p => p.exam === 'E4').id, 'E4-2');
  assert.equal(after.length, db.plans.length + 1, 'nothing deleted');
});

test('B-449: a plan with no plan before it is a draft too, until he accepts it', () => {
  const p = {
    id: 'E5',
    schema: 1,
    writer: 'worker',
    at: NOW.toISOString(),
    source: 'x',
    exam: 'E5',
    section: { course: 'NUR 112', from: '2026-10-28', to: '2026-11-17' },
    days: [],
  };
  assert.deepEqual(EV.planViews([p], []), []);
  assert.equal(EV.latestPlanDraft([p], [], 'E5').id, 'E5');
});

test('B-449: one fix ask when the model’s own score is under 85 or a criterion under 3; the draft is saved either way', async () => {
  const db = record();
  const { r, asks, writes } = await run(db, { title: PLANTS.low + ' plan', brief: 'a plan', course: 'NUR 112' });
  assert.equal(r.status, 'done');
  assert.equal(asks.length, 2);
  const fix = asks[1].messages;
  assert.equal(fix.length, 3);
  assert.equal(fix[2].content[0].type, 'tool_result');
  assert.match(fix[2].content[0].content, /total is 61, under 85; criteria under 3: #8 \(2\)/);
  assert.deepEqual(asks[1].cache, asks[0].cache, 'the fix ask reads the same prefix from the cache');
  const plan = writes.find(w => w.collection === 'plans');
  assert.equal(plan.data.score.total, 88, 'the fixed plan is saved');
  // a fix that fails too: the first plan is saved as it was
  const db2 = record();
  const stub = body => {
    const rep = jobReply(body);
    rep.content[0].input.score = { criteria: [3, 3, 3, 3, 3, 3, 3, 3], total: 60 };
    return rep;
  };
  const two = await run(db2, { title: 'plan', brief: 'a plan', course: 'NUR 112' }, { reply: stub });
  assert.equal(two.asks.length, 2, 'one fix ask, never a loop');
  assert.equal(two.writes.find(w => w.collection === 'plans').data.score.total, 60);
});

test('B-449: an answer with one question writes only E.V.’s question, no plan', async () => {
  const db = record();
  const { r, writes } = await run(db, { title: PLANTS.ask + ' plan', brief: 'a plan', course: 'NUR 112' });
  assert.equal(r.status, 'done');
  assert.ok(!writes.some(w => w.collection === 'plans'));
  const res = writes.find(w => w.collection === 'jobresults' && w.data.status === 'done');
  assert.equal(res.data.result.asked, true);
  const talk = writes.find(w => w.collection === 'talk');
  const msg = Object.values(talk.data.messages)[0];
  assert.equal(msg.text, 'Is the care plan draft graded?');
});

test('B-449: the job reads usage first and stops with a plain line when the ceiling has no room; nothing is asked', async () => {
  const db = record();
  const full = async () => ({ hour: 450000, day: 600000, limits: { hour: 500000, day: 1500000 } });
  const { r, asks, writes } = await run(db, { title: 'plan', brief: 'a plan', course: 'NUR 112' }, { usage: full });
  assert.equal(r.status, 'failed');
  assert.equal(asks.length, 0);
  assert.match(r.said, /isn’t room in this hour’s Claude allowance.*Try again next hour/);
  assert.match(writes.at(-1).data.error, /this hour’s/);
  const room = async () => ({ hour: 0, day: 0, limits: { hour: 500000, day: 1500000 } });
  assert.equal(
    (await run(record(), { title: 'plan', brief: 'a plan', course: 'NUR 112' }, { usage: room })).r.status,
    'done'
  );
  assert.ok(J.askNeeds({ messages: [], purpose: 'exam-plan', max_tokens: 24000 }) > 3 * 24000);
});

test('B-449: a job with nothing to plan says so plainly, with no ask', async () => {
  const { r, asks, writes } = await run(record(), { title: 'plan', brief: 'a plan', course: 'BIO 201' });
  assert.equal(asks.length, 0);
  assert.equal(r.status, 'failed');
  assert.match(
    writes.find(w => w.collection === 'jobresults' && w.data.status === 'failed').data.error,
    /no BIO 201 exam ahead/
  );
});

/** A draft to edit: the stub's plan for E4, saved as plans/E4-2. */
async function withDraft() {
  const db = record();
  const made = await run(db, { title: 'plan', brief: 'a plan', course: 'NUR 112', id: 'job-make' });
  const p = made.writes.find(w => w.collection === 'plans');
  db.plans.push({ ...p.data, id: p.id });
  return db;
}

test('D-356: an edit is a Haiku patch on the draft: no materials, hard rules only, the draft cache-marked; untouched tasks stay identical; the score is kept, marked', async () => {
  const db = await withDraft();
  const draft = db.plans.find(p => p.id === 'E4-2');
  const { r, asks, writes } = await run(db, {
    title: 'Plan changes',
    brief: 'make the preview shorter',
    revise: 'E4-2',
  });
  assert.equal(r.status, 'done', r.said);
  assert.equal(asks.length, 1);
  const a = asks[0];
  assert.equal(a.purpose, 'plan-edit');
  assert.equal(a.max_tokens, undefined, 'the usual length');
  assert.deepEqual(a.cache, [
    { m: 0, b: 0 },
    { m: 0, b: 1 },
  ]);
  const all = words(a);
  assert.doesNotMatch(all, /"passages"|"materials"|"objectives"|"notes"/, 'no materials block');
  assert.doesNotMatch(all, /Study Plan Maker|## 4\. Rubric/, 'not the whole brief');
  assert.match(all, /Nothing is left off the calendar/, 'its hard rules');
  // an added revalidation ladder keeps to his ladder and load rules, read from the cached prefix
  const prefix = a.messages[0].content[0].text;
  for (const rule of [
    /first look before the lab[^\n]*guided practice[^\n]*solo runs[^\n]*at least 2 mocks scored/,
    /Lay each skills ladder\*\* backward from its checkoff date/,
    /Check the load:\*\* total minutes per day/,
    /Failed a checkoff:\*\* the revalidation ladder becomes the top priority/,
  ])
    assert.match(prefix, rule);
  assert.doesNotMatch(prefix, /Course profiles|## 2\. How a plan/, 'not the whole brief');
  // his own instructions' parts are used, the default's where his have none
  const own = EV.studyPlanEditRules(
    '## Hard rules\n\n1. No all-nighters.\n\n## Re-planning triggers\n\n- Behind: rest.',
    spec
  );
  assert.match(own, /^The hard rules:\n1\. No all-nighters\./);
  assert.match(own, /When to re-plan:\n- Behind: rest\.$/);
  assert.match(own, /backward from its checkoff date/, 'the default’s ladder lines where his have none');
  assert.match(a.messages[0].content[1].text, /"draft"/);
  assert.doesNotMatch(
    a.messages[0].content[1].text,
    /make the preview shorter/,
    'the request comes after the cached draft'
  );
  assert.match(a.messages[0].content[2].text, /make the preview shorter/);
  assert.deepEqual(
    a.tools.map(t => t.name),
    ['answer', 'lookup']
  );
  const next = writes.find(w => w.collection === 'plans');
  assert.equal(next.id, 'E4-3');
  assert.ok(validate('plans', next.data, { id: next.id }).ok);
  assert.equal(next.data.revises, 'E4-2');
  assert.equal(next.data.editedSinceScore, true);
  assert.deepEqual(next.data.score, draft.score, 'the baseline score is kept');
  const tasks = p => p.days.flatMap(d => d.tasks.map(t => ({ ...t, date: d.date })));
  const before = tasks(draft),
    after = tasks(next.data);
  assert.equal(after.find(t => t.id === 't1').minutes, 20, 'the edit');
  assert.ok(
    after.some(t => t.id === 'stub-new'),
    'the add'
  );
  for (const t of before.filter(t => t.id !== 't1'))
    assert.deepEqual(
      after.find(x => x.id === t.id),
      t,
      `${t.id} is untouched`
    );
  assert.deepEqual(next.data.keyDates, draft.keyDates);
  assert.ok(
    db.plans.some(p => p.id === 'E4-2'),
    'the draft it changed stays'
  );
});

test('D-356: an edit may look up a date or material by id first; each round reads the cached prefix', async () => {
  const db = await withDraft();
  const { r, asks } = await run(db, {
    title: 'Plan changes',
    brief: 'look up the clinical and move t3 after it',
    revise: 'E4-2',
  });
  assert.equal(r.status, 'done', r.said);
  assert.equal(asks.length, 2);
  const res = asks[1].messages[2].content[0];
  assert.equal(res.type, 'tool_result');
  assert.ok(JSON.parse(res.content).some(d => d.id === 'demo-clinical'));
  assert.equal(
    EV.studyPlanLookup(db, 'materials/NUR112-990002', 'sodium').title,
    'Fluids and electrolytes handout.pdf'
  );
  assert.equal(EV.studyPlanLookup(db, 'dates/demo-quiz').id, 'demo-quiz');
  assert.match(EV.studyPlanLookup(db, 'exams/E4').error, /ref:/);
});

test('D-356: a patch applies add, edit, move and remove in order; an op naming no task is left out and counted', () => {
  const draft = {
    id: 'E4-2',
    exam: 'E4',
    schema: 1,
    writer: 'worker',
    at: 'x',
    source: 'y',
    score: { criteria: [4, 4, 4, 4, 4, 4, 4, 4], total: 80 },
    days: [
      {
        date: '2026-10-25',
        tasks: [
          { id: 'a', text: 'A', minutes: 30 },
          { id: 'b', text: 'B' },
        ],
      },
      { date: '2026-10-26', tasks: [{ id: 'c', text: 'C' }] },
    ],
  };
  const r = EV.applyPlanPatch(draft, {
    ops: [
      { op: 'move', id: 'c', date: '2026-10-27' },
      { op: 'remove', id: 'b' },
      { op: 'edit', id: 'a', set: { minutes: 15, id: 'zz' } },
      { op: 'add', date: '2026-10-26', task: { id: 'a', text: 'A again' } },
      { op: 'remove', id: 'nope' },
    ],
    openQuestions: ['Q?'],
  });
  assert.deepEqual([r.applied, r.skipped], [4, 1]);
  assert.deepEqual(
    r.plan.days.map(d => [d.date, d.tasks.map(t => t.id)]),
    [
      ['2026-10-25', ['a']],
      ['2026-10-26', ['a-2']],
      ['2026-10-27', ['c']],
    ]
  );
  assert.equal(r.plan.days[0].tasks[0].minutes, 15);
  assert.deepEqual(r.plan.openQuestions, ['Q?']);
  assert.equal(r.plan.editedSinceScore, true);
  assert.equal(r.plan.revises, 'E4-2');
  assert.equal(draft.days[0].tasks.length, 2, 'the draft itself is never changed');
});

// ---------------------------------------------------------------- chat (D-362)
// Every study plan line from the three B-456 reviews and B-449's: none starts a new (Sonnet) plan from chat.
const OFFERED = [
  // a plain whole-plan ask: an edit still, and the Make a new plan chip beside it
  'redo the plan around my revalidation', // Matt's
  'replan for my failed checkoff', // Matt's
  'make me a cram plan',
  'make me a cram plan for the dosage assessment',
  'I need to cram for the exam',
  'redo the plan',
  'redo plan',
  'redo study plan',
  'redo my exam plan',
  'redo the exam plan',
  'redo my pharm plan',
  'rewrite my E4 plan',
  'rewrite my NUR 112 plan',
  'rewrite my E4 plan around my revalidation',
  'scrap this plan and start again',
  'scrap my current E4 plan and start again',
  'scrap the whole plan, it’s not working',
  'rework everything',
  'redo the whole thing',
  'rebuild the whole plan',
  'remake the study plan',
  'remake it from scratch',
  'can u redo the plan pls',
  '"redo the plan"',
  'REDO THE PLAN!',
  'redo the plan for E4',
  'redo the plan for my revalidation',
  'cram plan for E4',
  'cramming mode',
  'start over',
];
const NOT_OFFERED = [
  // Matt's three edits
  'add revalidation practice for the injection checkoff before Monday',
  'add skills practice for my revalidation',
  'schedule two mock runs before my retry',
  // edits and single-task asks
  'move the drill to Thursday',
  'add a new task for the lab',
  'remove the reading from today',
  'drop the drill from tonight',
  'move the quiz review from today to Friday',
  'add a new one-hour block Sunday',
  'add a cram session on Sunday',
  'make Thursday lighter',
  'swap the drill and the preview',
  'make the preview shorter',
  'scrap the Friday drill',
  'redo the practice quiz on Thursday',
  'rework the Sunday block to 30 minutes',
  'rebuild the Sunday mock',
  'add a redo of the dosage practice quiz',
  'rewrite the Friday drill and move it to Saturday',
  'redo the drill from today on Friday',
  'cram the labs into thursday',
  'i want to cram the drug cards on friday',
  'add cramming time on sunday',
  'cramming mode for Monday',
  // the doubtful ones the reviews found
  'replan the friday drill',
  'not the whole plan',
  'rebuild the friday plan',
  'new plan for the drill',
  'redo the plan’s Friday drill',
  "redo the plan's Friday drill",
  'redo the plan task on Friday',
  'scrap the plan task for Friday',
  'rewrite the study plan block on Sunday',
  'redo it on Friday',
  'scrap the drill, redo it on Friday',
  'scrap this',
  'scrap all this',
  'redo all of this',
  'rewrite all of it',
  'this plan is bad, rewrite it',
  'redo it from now',
  'remake it from tonight',
  'redo the plan for friday',
  'scrap the plan for tomorrow',
  'scrap everything for friday',
  'rebuild the plan for next week',
  'redo the plan for 11/3',
  'the whole plan',
  'just that task',
  'the plan looks terrible',
  'what about my plan for E4',
  'cram',
  'I want to cram',
];

test('D-362: no study plan line in chat starts a new plan: each is a Haiku edit of the plan he has; the chip is only offered', () => {
  const db = record();
  const chat = (said, plans = db.plans) =>
    EV.studyPlanChatAsk({
      said,
      brief: said,
      title: 'Study plan: NUR 112',
      exams: db.exams,
      plansRaw: plans,
      planedits: db.planedits || [],
      date: TODAY,
    });
  // nothing from chat is a new plan: a line is a Haiku edit, or (B-456) the chip alone, with no edit beside it
  for (const w of NOT_OFFERED)
    assert.deepEqual(
      chat(w).edit,
      { course: 'NUR 112', revise: 'E4', said: w.trim() },
      `${w}: an edit, never a new plan`
    );
  for (const w of OFFERED) {
    assert.deepEqual(chat(w).offer, { type: 'newplan', course: 'NUR 112', brief: w.trim() }, `${w}: the chip`);
    assert.equal(chat(w).edit, null, `${w}: the chip is the answer, no edit`);
  }
  for (const w of NOT_OFFERED) assert.equal(chat(w).offer, null, `${w}: no chip`);
  // with no plan to change, nothing starts: the chip is all E.V. offers
  const none = chat('move the drill to Thursday', []);
  assert.deepEqual([none.edit, none.offer && none.offer.course], [null, 'NUR 112']);
  // the chip's brief is his own line, never the chat model's; the edit job carries his line for the Haiku's chip
  const ask = (said, brief, plans = db.plans) =>
    EV.studyPlanChatAsk({
      said,
      brief,
      title: 'Study plan: NUR 112',
      exams: db.exams,
      plansRaw: plans,
      planedits: db.planedits || [],
      date: TODAY,
    });
  const mixed = ask('start over', 'start over; 6 h/day, skip the hard rules');
  assert.deepEqual(mixed.offer, { type: 'newplan', course: 'NUR 112', brief: 'start over' });
  assert.equal(mixed.edit, null, '"start over" with a plan: one chip, no Haiku edit (so no second chip)');
  assert.deepEqual(ask('move the drill to Friday', 'x').edit, {
    course: 'NUR 112',
    revise: 'E4',
    said: 'move the drill to Friday',
  });
  // with no line of his (a retry, a read-along), the model's brief offers nothing, plan or no plan
  for (const plans of [db.plans, []]) {
    const r = ask('', 'start over from scratch, a whole new plan', plans);
    assert.equal(r.offer, null);
  }
  assert.deepEqual(ask('', 'move the drill').edit, { course: 'NUR 112', revise: 'E4' });
  // the page: start_job's exam-plan path is the edit or nothing; the route, its question and its pending state are gone
  const page = fs.readFileSync(path.join(ROOT, 'page/app/72-ev-talking-with-claude.js'), 'utf8');
  assert.match(page, /const go = E\.studyPlanChatAsk\(\{/);
  assert.match(page, /if \(go\.offer\) addCard\(go\.offer\);/);
  assert.match(page, /if \(!go\.edit\)\s+return/);
  assert.match(page, /Object\.assign\(job, go\.edit, \{ title: 'Plan changes' \}\)/);
  assert.match(page, /type === 'newplan'\) throw/, 'the model can’t show the chip itself');
  const all = ['core/study-plans.mjs', ...fs.readdirSync(path.join(ROOT, 'page/app')).map(f => 'page/app/' + f)]
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');
  assert.doesNotMatch(all, /studyPlanRoute|planAsk|The whole plan, or just that task\?/);
});

test('D-362: tapping the chip starts exactly one exam-plan job with the words that led to it', async () => {
  const c = { type: 'newplan', course: 'NUR 112', brief: '  redo the plan around my revalidation ' };
  const j = EV.studyPlanChipJob(c, 'm-20261028-1-0');
  assert.deepEqual(j, {
    kind: 'exam-plan',
    title: 'Study plan: NUR 112',
    brief: 'redo the plan around my revalidation',
    course: 'NUR 112',
    chip: 'm-20261028-1-0',
  });
  assert.equal(EV.studyPlanChipStarted(c, [], 'm-20261028-1-0'), null);
  const started = { id: 'job-chip', schema: 2, ...j };
  assert.equal(EV.studyPlanChipStarted(c, [started], 'm-20261028-1-0').id, 'job-chip', 'once started, it is that job');
  // an old job with the same words, from another chip weeks ago, never hides a new chip's button
  const old = { ...started, id: 'job-old', chip: 'm-20261007-1-0', at: '2026-10-07T15:00:00Z' };
  assert.equal(EV.studyPlanChipStarted(c, [old], 'm-20261028-1-0'), null);
  const { chip, ...noChip } = old;
  assert.equal(EV.studyPlanChipStarted(c, [noChip], 'm-20261028-1-0'), null, 'nor one started some other way');
  assert.equal(EV.studyPlanChipStarted(c, [{ ...started, revise: 'E4' }], 'm-20261028-1-0'), null, 'nor an edit');
  assert.ok(validate('jobs', { schema: 2, writer: 'page', at: NOW.toISOString(), source: 'E.V. Home', ...j }).ok);
  const cards = fs.readFileSync(path.join(ROOT, 'page/app/67-ev-cards.js'), 'utf8');
  assert.match(
    cards,
    /const job = E\.studyPlanChipStarted\(c, S\.jobs, key\) \|\| E\.studyPlanNewJobRunning\(S\.jobs, c\.course\);\s+if \(job\) return CARDS\.job/
  );
  // a second tap on the same chip can't start two: the tap marks the chip (and guard disables it) before the job is
  // written; once written, the chip is that job's card, matched by its key
  assert.match(cards, /const started = newPlanTapped\.has\(key\);[\s\S]*if \(started\) return;/);
  assert.match(
    cards,
    /guard\(\s*ev\.target,[\s\S]*?newPlanTapped\.add\(key\);\s+await startJob\(E\.studyPlanChipJob\(c, key\)\);/
  );
  assert.match(cards, /`Make a new \$\{c\.course\} plan`/);
  // the page passes the chip and his line through to the job
  const jobsJs = fs.readFileSync(path.join(ROOT, 'page/app/62-ev-jobs-and-filing.js'), 'utf8');
  assert.match(jobsJs, /kind === 'exam-plan' && chip \? \{ chip:/);
  assert.match(jobsJs, /kind === 'exam-plan' && said \? \{ said:/);
  // the briefing's "draft its plan" offers the chip; nothing in the page starts a new plan but the chip and Study
  const quick = fs.readFileSync(path.join(ROOT, 'page/app/70-ev-quick-asks.js'), 'utf8');
  assert.match(quick, /'draft its plan': async \(\) => \{[\s\S]*?\{ type: 'newplan', course: ex\.course, brief:/);
  for (const f of fs.readdirSync(path.join(ROOT, 'page/app'))) {
    const src = fs.readFileSync(path.join(ROOT, 'page/app', f), 'utf8');
    for (const m of src.matchAll(/startJob\(\{[^}]*kind: 'exam-plan'/g))
      assert.fail(`${f} starts an exam-plan job itself: ${m[0]}`);
  }
  // the job it starts makes a new plan on Sonnet, naming its job to the Worker
  const { r, asks, writes } = await run(record(), { id: 'job-chip', ...j });
  assert.equal(r.status, 'done', r.said);
  assert.deepEqual([asks.length, asks[0].purpose, asks[0].job], [1, 'exam-plan', 'job-chip']);
  assert.match(words(asks[0]), /redo the plan around my revalidation/);
  assert.equal(writes.filter(w => w.collection === 'plans').length, 1);
});

test('B-456: one new plan at a time per course: the chip, Make a plan, Remake and other tabs share one guard', () => {
  const now = Date.parse('2026-10-28T15:00:00Z');
  const at = '2026-10-28T14:59:00Z';
  const chipJob = { id: 'job-20261028-newplan-nur112-1', kind: 'exam-plan', course: 'NUR 112', at, chip: 'm1-0' };
  const view = (j, status) => ({ ...j, createdAt: j.at, status });
  // the chip's job queued (no result yet) or running holds the course; done, failed, a failed firing or a day old don't
  assert.equal(EV.studyPlanNewJobRunning([view(chipJob, 'queued')], 'NUR 112', now).id, chipJob.id);
  assert.equal(EV.studyPlanNewJobRunning([view(chipJob, 'running')], 'nur-112', now).id, chipJob.id);
  for (const j of [
    view(chipJob, 'done'),
    view(chipJob, 'failed'),
    view({ ...chipJob, fired: { ok: false } }, 'queued'),
    view({ ...chipJob, at: '2026-10-27T14:00:00Z' }, 'running'),
    view({ ...chipJob, revise: 'E4' }, 'running'),
    view({ ...chipJob, course: 'BIO 201' }, 'running'),
  ])
    assert.equal(EV.studyPlanNewJobRunning([j], 'NUR 112', now), null, JSON.stringify(j));
  // a second chip (one from a later line, or the Haiku edit's) shows the running job, not a button
  const second = { type: 'newplan', course: 'NUR 112', brief: 'start over' };
  const jobs = [view(chipJob, 'running')];
  assert.equal(
    EV.studyPlanChipStarted(second, jobs, 'm2-1') || EV.studyPlanNewJobRunning(jobs, second.course, now),
    jobs[0]
  );
  // the id is the course's next of the day in every tab: a tab that hasn't seen the first job writes the same id
  assert.equal(EV.studyPlanNewJobId([], 'NUR 112', '2026-10-28'), 'job-20261028-newplan-nur112-1');
  assert.equal(EV.studyPlanNewJobId([chipJob], 'NUR 112', '2026-10-28'), 'job-20261028-newplan-nur112-2');
  // the page: startJob reads the record right before writing a new plan's job; one there is the answer, nothing is
  // written; the chip shows it; Study's Make a plan and Remake go through the same startJob (and show Making…)
  const jobsJs = fs.readFileSync(path.join(ROOT, 'page/app/62-ev-jobs-and-filing.js'), 'utf8');
  assert.match(
    jobsJs,
    /if \(kind === 'exam-plan' && !revise && course\) \{\s+const fresh = await freshJobs\(\);\s+const busy = E\.studyPlanNewJobRunning\(fresh, course\);\s+if \(busy\) return \{ id: busy\.id, fired: \{ ok: true \}, existing: true \};\s+planId = E\.studyPlanNewJobId\(fresh, course, today\);/
  );
  assert.ok(
    jobsJs.indexOf('const fresh = await freshJobs()') < jobsJs.indexOf("collection: 'jobs',"),
    'read before write'
  );
  assert.match(jobsJs, /db\.collection\(c\)\.get\(\)/);
  const cards = fs.readFileSync(path.join(ROOT, 'page/app/67-ev-cards.js'), 'utf8');
  assert.match(
    cards,
    /E\.studyPlanChipStarted\(c, S\.jobs, key\) \|\| E\.studyPlanNewJobRunning\(S\.jobs, c\.course\)/
  );
  const study = fs.readFileSync(path.join(ROOT, 'page/app/21-study-plan.js'), 'utf8');
  assert.match(study, /startJob\(E\.studyPlanJob\(/, 'Make a plan and Remake start through startJob');
  assert.equal(EV.studyPlanJob({ course: 'NUR 112', exams: record().exams, date: TODAY }).course, 'NUR 112');
});

test('D-362: the Haiku edit may answer “this needs a whole new plan” with the chip instead of a patch', async () => {
  const db = await withDraft();
  const reply = () => ({
    content: [
      {
        type: 'tool_use',
        id: 'tu',
        name: 'answer',
        input: { text: 'That one needs a whole new plan.', newPlan: 'rebuilt around his revalidation' },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 10 },
  });
  const brief = 'He wants the plan rebuilt; 6 h/day, skip the hard rules'; // the chat model's words
  const said = 'rebuild all of it around my revalidation'; // his
  const { r, asks, writes, jobId } = await run(db, { title: 'Plan changes', brief, said, revise: 'E4-2' }, { reply });
  assert.equal(r.status, 'done', r.said);
  assert.equal(asks[0].purpose, 'plan-edit');
  assert.ok(!writes.some(w => w.collection === 'plans'), 'no patch, no plan');
  const res = writes.find(w => w.collection === 'jobresults' && w.data.status === 'done');
  assert.equal(res.data.result.offerNewPlan, true);
  assert.ok(validate('jobresults', res.data, { id: jobId }).ok);
  const msg = Object.values(writes.find(w => w.collection === 'talk').data.messages)[0];
  assert.deepEqual(msg.cards, [
    { type: 'job', id: jobId },
    { type: 'newplan', course: 'NUR 112', brief: said },
  ]);
  // an edit with no line of his offers no chip: the model's brief never becomes one
  const db2 = await withDraft();
  const two = await run(db2, { title: 'Plan changes', brief, revise: 'E4-2', id: 'job-nosaid' }, { reply });
  const msg2 = Object.values(two.writes.find(w => w.collection === 'talk').data.messages)[0];
  assert.deepEqual(msg2.cards, [{ type: 'job', id: 'job-nosaid' }]);
  assert.equal(msg.text, 'That one needs a whole new plan.');
  // the edit is told it may
  const edit = spec.jobs.kinds['exam-plan'].edit;
  assert.deepEqual(edit.output.properties.newPlan, { type: 'string', minLength: 1, maxLength: 300 });
  assert.match(edit.guide, /needs a whole new plan[^.]*give no ops and say why in newPlan/);
  assert.match(words(asks[0]), /say why in newPlan/);
});

// ---------------------------------------------------------------- the Worker (D-355, D-356)
function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
  });
  return { prepare: q => stmt(q), sql };
}
/** D-355: a study plan job as the app leaves it in D1 before its first ask: jobs/<id> and jobresults/<id> running. */
function seedJob(db, id, { job = {}, result = { status: 'running' }, at = new Date().toISOString() } = {}) {
  const put = (c, data) =>
    db.sql.prepare('INSERT INTO docs (c, id, data, at, v) VALUES (?, ?, ?, ?, 1)').run(c, id, JSON.stringify(data), 0);
  put('jobs', { schema: 2, writer: 'page', at, source: 'E.V. Home', kind: 'exam-plan', title: 'Study plan', ...job });
  if (result)
    put('jobresults', { schema: 2, writer: 'worker', at, source: 'x', release: 'v4', startedAt: at, ...result });
}
async function viaWorker(bodies, vars = {}, seed = db => seedJob(db, 'job-plan'), api = null) {
  const DB = fakeD1();
  if (seed) seed(DB);
  const env = {
    EV_TOKEN: 't',
    ANTHROPIC_API_KEY: 'k',
    DB,
    ASSETS: { fetch: () => new Response('') },
    ...vars,
  };
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    if (api) return api(sent.length);
    return new Response(
      JSON.stringify({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 100 } }),
      { status: 200 }
    );
  };
  const out = [];
  const replies = [];
  try {
    for (const b of bodies) {
      const r = await worker.fetch(
        new Request('https://ev.example/api/claude', {
          method: 'POST',
          headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...b }),
        }),
        env
      );
      out.push(r.status);
      replies.push(await r.json().catch(() => null));
    }
    const u = await (
      await worker.fetch(
        new Request('https://ev.example/api/claude/usage', { headers: { authorization: 'Bearer t' } }),
        env
      )
    ).json();
    return { out, sent, used: u.hour, DB, replies };
  } finally {
    globalThis.fetch = real;
  }
}

test('D-355: the Worker picks the model by purpose: a plan on Sonnet with 24k, an edit and every other ask on Haiku', async () => {
  const { out, sent } = await viaWorker([
    { purpose: 'exam-plan', max_tokens: 24000, job: 'job-plan' },
    { purpose: 'plan-edit' },
    { model: 'claude-sonnet-5-5', max_tokens: 24000 }, // a chat ask naming a model gets Haiku and the usual length
    {},
  ]);
  assert.deepEqual(out, [200, 200, 200, 200]);
  assert.deepEqual(
    sent.map(b => [b.model, b.max_tokens]),
    [
      ['claude-sonnet-5-5', 24000],
      ['claude-haiku-5-5', 8192],
      ['claude-haiku-5-5', 8192],
      ['claude-haiku-5-5', 8192],
    ]
  );
  assert.ok(
    sent.every(b => b.purpose === undefined),
    'the purpose is the Worker’s, never sent on'
  );
  const env = await viaWorker([{ purpose: 'exam-plan', job: 'job-plan' }], { CLAUDE_PLAN_MODEL: 'claude-sonnet-x' });
  assert.equal(env.sent[0].model, 'claude-sonnet-x');
});

test('D-355: an unknown purpose, a plan over 24k, an edit over the usual length or a purposed read-along is refused, unsent', async () => {
  const { out, sent } = await viaWorker([
    { purpose: 'chat' },
    { purpose: 'exam-plan', max_tokens: 24001, job: 'job-plan' },
    { purpose: 'exam-plan', max_tokens: 1.5, job: 'job-plan' },
    { purpose: 'plan-edit', max_tokens: 9000 },
    { purpose: 'exam-plan', read: { note: 'n1', h: 'abc' }, job: 'job-plan' },
  ]);
  assert.deepEqual(out, [400, 400, 400, 400, 400]);
  assert.equal(sent.length, 0);
  assert.equal(typeof purposeOf({ purpose: 'toString' }), 'string', 'no inherited name is a purpose');
});

test('D-355: a plan’s Sonnet tokens count 3 each against the ceilings, cache weights on top; Haiku’s as before', async () => {
  const u = {
    usage: {
      input_tokens: 1000,
      output_tokens: 1000,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 1000,
    },
  };
  assert.equal(tokensOf(u), 3350);
  assert.equal(tokensOf(u, 3), 10050);
  const plan = await viaWorker([{ purpose: 'exam-plan', job: 'job-plan' }]);
  assert.equal(plan.used, 3000);
  const edit = await viaWorker([{ purpose: 'plan-edit' }]);
  assert.equal(edit.used, 1000);
});

test('B-449: a Sonnet ask Claude did not answer gives its claim back; the cap holds for answered ones; its refusal reads plainly', async () => {
  const plan = { purpose: 'exam-plan', max_tokens: 24000, job: 'job-plan' };
  const ok = () =>
    new Response(
      JSON.stringify({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 1 } }),
      {
        status: 200,
      }
    );
  const refused = () =>
    new Response(
      JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'tool_choice: type "tool" and "any" are not supported' },
      }),
      { status: 400 }
    );
  // a 400, a 529 and a dropped connection each give the claim back: the two answered asks still both go
  const api = n => {
    if (n === 1) return refused();
    if (n === 2) return new Response('{"type":"error"}', { status: 529 });
    if (n === 3) throw new Error('socket hang up');
    return ok();
  };
  const r = await viaWorker([plan, plan, plan, plan, plan, plan], {}, undefined, api);
  assert.deepEqual(r.out, [400, 529, 502, 200, 200, 429]);
  assert.equal(r.sent.length, 5, 'the sixth is refused unsent');
  assert.equal(r.DB.sql.prepare('SELECT n FROM claude_plan_asks WHERE job = ?').get('job-plan').n, 2);
  assert.deepEqual(r.replies[5], { error: 'This plan has had its 2 Sonnet asks', code: 'ceiling', scope: 'plan' });
  // a job dated in the future is refused
  const ahead = await viaWorker([plan], {}, db =>
    seedJob(db, 'job-plan', { at: new Date(Date.now() + 10 * 60000).toISOString() })
  );
  assert.deepEqual([ahead.out[0], ahead.sent.length], [403, 0]);
  const slip = await viaWorker([plan], {}, db =>
    seedJob(db, 'job-plan', { at: new Date(Date.now() + 60000).toISOString() })
  );
  assert.equal(slip.out[0], 200, 'a clock’s slip of a minute is fine');
});

test('B-449: an answer billed but lost after its headers keeps its Sonnet claim and counts an estimate to the ceilings', async () => {
  const plan = { purpose: 'exam-plan', max_tokens: 24000, job: 'job-plan' };
  const dropped = () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => {
      throw new Error('the connection dropped');
    },
  });
  const r = await viaWorker([plan], {}, undefined, dropped);
  assert.deepEqual([r.out[0], r.sent.length], [502, 1]);
  assert.equal(r.DB.sql.prepare('SELECT n FROM claude_plan_asks WHERE job = ?').get('job-plan').n, 1, 'claim kept');
  assert.ok(r.used >= 24000 * 3, `counted ${r.used}: at least the whole answer allowance at Sonnet's weight`);
  // a refusal (no answer, nothing billed) still gives it back
  const no = await viaWorker([plan], {}, undefined, () => new Response('{"type":"error"}', { status: 400 }));
  assert.equal(no.DB.sql.prepare('SELECT n FROM claude_plan_asks WHERE job = ?').get('job-plan').n, 0);
});

test('B-449: an answer in the text gets its one fix ask too, by a plain line; a malformed one fails cleanly after it', async () => {
  const inText = body => {
    const rep = jobReply(body);
    return { ...rep, content: [{ type: 'text', text: JSON.stringify(rep.content[0].input) }] };
  };
  // weak by its own score: one fix, asked in words, and the fixed plan saved
  const weak = await run(
    record(),
    { title: PLANTS.low + ' plan', brief: 'a plan', course: 'NUR 112' },
    { reply: inText }
  );
  assert.equal(weak.r.status, 'done', weak.r.said);
  assert.equal(weak.asks.length, 2);
  const last = weak.asks[1].messages.at(-1).content[0];
  assert.equal(last.type, 'text');
  assert.match(last.text, /total is 61, under 85[\s\S]*answer tool, or as one JSON object/);
  assert.equal(weak.writes.find(w => w.collection === 'plans').data.score.total, 88);
  // malformed, twice: one fix, then a clean failure with nothing it made written
  for (const bad of ['Sorry, here is my plan in words.', JSON.stringify({ text: 'x', plan: { title: 'no days' } })]) {
    const reply = () => ({
      content: [{ type: 'text', text: bad }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const m = await run(record(), { title: 'plan', brief: 'a plan', course: 'NUR 112' }, { reply });
    assert.equal(m.asks.length, 2, bad);
    assert.equal(m.asks[1].messages.at(-1).content[0].type, 'text');
    assert.ok(['failed', 'refused'].includes(m.r.status), m.r.status);
    assert.ok(!m.writes.some(w => w.collection === 'plans'), 'no plan written');
    assert.equal(m.writes.at(-1).data.status, 'failed');
  }
});

test('B-449: an edit that keeps looking things up past the cap stops there: its asks counted, failed, nothing written', async () => {
  const db = await withDraft();
  let n = 0;
  const reply = () => ({
    content: [{ type: 'tool_use', id: 'lk' + ++n, name: 'lookup', input: { ref: 'dates/demo-quiz' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 10 },
  });
  const before = db.plans.length;
  const { r, asks, writes } = await run(db, { title: 'Plan changes', brief: 'move t3', revise: 'E4-2' }, { reply });
  const most = spec.jobs.kinds['exam-plan'].edit.lookups;
  assert.equal(most, 3);
  assert.equal(asks.length, 1 + most, 'the ask and one per lookup round, no more');
  assert.match(JSON.stringify(asks.at(-1).messages.at(-1).content), /No more lookups: answer now/);
  assert.equal(r.status, 'refused', 'no answer: refused by the checks');
  assert.ok(!writes.some(w => w.collection === 'plans'));
  assert.equal(writes.at(-1).data.status, 'failed');
  assert.equal(db.plans.length, before);
});

test('B-449: no plan ask forces tool_choice (the plan models refuse it); the answer is asked for in words', async () => {
  // the make ask and its fix ask
  const { asks } = await run(record(), { title: PLANTS.low + ' plan', brief: 'a plan', course: 'NUR 112' });
  assert.equal(asks.length, 2);
  for (const a of asks) assert.deepEqual(a.tool_choice, { type: 'auto' });
  assert.match(asks[0].messages[0].content[2].text, /calling the answer tool/);
  // an edit, its lookup rounds and the last round's ask to answer now
  const db = await withDraft();
  const ed = await run(db, {
    title: 'Plan changes',
    brief: 'look up the clinical and move t3 after it',
    revise: 'E4-2',
  });
  assert.equal(ed.r.status, 'done', ed.r.said);
  for (const a of ed.asks) assert.deepEqual(a.tool_choice, { type: 'auto' });
  // an answer given as JSON in the text, with no tool call, is read as the answer
  const inText = body => {
    const rep = jobReply(body);
    return { ...rep, content: [{ type: 'text', text: 'Here it is: ' + JSON.stringify(rep.content[0].input) }] };
  };
  const t = await run(record(), { title: 'plan', brief: 'a plan', course: 'NUR 112' }, { reply: inText });
  assert.equal(t.r.status, 'done', t.r.said);
  assert.ok(t.writes.some(w => w.collection === 'plans'));
  // Claude's own words reach the job's result when it refuses an ask
  const no = async () => {
    throw Object.assign(new Error('Claude refused the ask (400): tool_choice: type "tool" is not supported'), {
      code: 'refused',
    });
  };
  const f = await run(record(), { title: 'plan', brief: 'a plan', course: 'NUR 112' }, { reply: no });
  assert.equal(f.r.status, 'failed');
  assert.match(
    f.writes.at(-1).data.error,
    /^Claude refused the ask \(400\): tool_choice: type "tool" is not supported\. Try again\.$/
  );
  const bridge = fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8');
  assert.match(bridge, /own\.error && typeof own\.error === 'object' \? own\.error\.message : own && own\.error/);
  assert.match(bridge, /code: words \? 'refused' : null/);
});

test('D-355: Sonnet only for a running study plan job the Worker finds in D1, twice a job at most; else refused, unsent', async () => {
  const plan = (job, extra = {}) => ({ purpose: 'exam-plan', max_tokens: 24000, ...(job ? { job } : {}), ...extra });
  // no job named, or one D1 doesn't hold: refused, never sent to Sonnet (nor to Haiku)
  const none = await viaWorker([plan(null), plan('job-nope'), plan('../x')]);
  assert.deepEqual(none.out, [403, 403, 403]);
  assert.equal(none.sent.length, 0);
  // the job's make ask and its one fix ask go to Sonnet; a third is refused
  const ok = await viaWorker([plan('job-plan'), plan('job-plan'), plan('job-plan')]);
  assert.deepEqual(ok.out, [200, 200, 429]);
  assert.deepEqual(
    ok.sent.map(b => b.model),
    ['claude-sonnet-5-5', 'claude-sonnet-5-5']
  );
  // each job has its own two
  const two = await viaWorker([plan('job-a'), plan('job-b'), plan('job-a'), plan('job-a')], {}, db => {
    seedJob(db, 'job-a');
    seedJob(db, 'job-b');
  });
  assert.deepEqual(two.out, [200, 200, 200, 429]);
  // what the Worker can't confirm as a running new-plan job is refused
  for (const [why, seed] of [
    ['an edit job', db => seedJob(db, 'j', { job: { revise: 'E4-2' } })],
    ['another kind', db => seedJob(db, 'j', { job: { kind: 'study-guide' } })],
    ['no result yet', db => seedJob(db, 'j', { result: null })],
    ['a finished job', db => seedJob(db, 'j', { result: { status: 'done' } })],
    ['over a day old', db => seedJob(db, 'j', { at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() })],
  ]) {
    const r = await viaWorker([plan('j')], {}, seed);
    assert.deepEqual([r.out[0], r.sent.length], [403, 0], why);
  }
  // the app's make ask names its job; an edit ask (Haiku) needs none
  const db = record();
  const { asks } = await run(db, { id: 'job-named', title: 'plan', brief: 'a plan', course: 'NUR 112' });
  assert.equal(asks[0].job, 'job-named');
});

// ---------------------------------------------------------------- Today (planDay)
test('B-449: planDay takes a plan task’s minutes and doneWhen; a ref to today’s dated item merges into it, never twice', () => {
  const date = '2026-11-02';
  const dates = [
    { id: 'quiz-1', date, title: 'Unit quiz: fluids', kind: 'due', graded: true, course: 'NUR 112' },
    { id: 'lec-9', date, title: 'Lecture 9: acid-base', kind: 'other', course: 'NUR 112' },
    { id: 'exam-d', date: '2026-11-03', title: 'Exam 5', kind: 'exam', course: 'NUR 112' },
  ];
  const plan = {
    id: 'E5-2',
    exam: 'E5',
    section: { course: 'NUR 112', from: '2026-10-28', to: '2026-11-17' },
    days: [
      {
        date,
        tasks: [
          {
            id: 'p1',
            text: 'Preview Ch 40 headings',
            tag: 'learn',
            kind: 'reading',
            minutes: 25,
            doneWhen: '5 terms listed',
          },
          {
            id: 'p2',
            text: 'Take it in the testing window',
            tag: 'graded',
            kind: 'graded',
            minutes: 30,
            doneWhen: 'submitted',
            ref: 'dates/quiz-1',
          },
          {
            id: 'p3',
            text: 'Attend and mark what is stressed',
            tag: 'learn',
            kind: 'other',
            minutes: 50,
            doneWhen: 'notes taken',
            ref: 'dates/lec-9',
          },
          { id: 'p4', text: 'Skills: first look', tag: 'skills-prep', kind: 'val', minutes: 0, doneWhen: 'watched' },
        ],
      },
    ],
  };
  const d = EV.planDay({ date, dates, exams: [], plans: [plan], weakspots: [], objectives: [] });
  const by = id => d.blocks.find(b => b.id === id);
  assert.equal(by('plan-p1').minutes, 25, 'the plan’s own minutes');
  assert.equal(by('plan-p1').doneWhen, '5 terms listed');
  assert.equal(by('plan-p2'), undefined, 'the graded task is the quiz itself');
  assert.deepEqual(by('date-quiz-1').planTasks, ['p2']);
  assert.equal(d.blocks.filter(b => b.ref === 'dates/quiz-1').length, 1, 'the dated item once');
  assert.equal(by('plan-p3').minutes, 50, 'a lecture is no list item of its own: its task stands');
  assert.equal(by('plan-p4').tag, 'SKILLS PREP');
  assert.equal(by('plan-p4').minutes, 0);
  const list = EV.buildDayList(d, {});
  assert.equal(list.items.find(i => i.id === 'plan-p1').doneWhen, '5 terms listed');
  assert.ok(!list.items.some(i => i.id === 'plan-p2'));
  // a ref to a dated item on another day is early work: it stays a task
  const early = clone(plan);
  early.days[0].tasks[1].ref = 'dates/exam-d';
  const e = EV.planDay({ date, dates, exams: [], plans: [early], weakspots: [], objectives: [] });
  assert.equal(e.blocks.find(b => b.id === 'plan-p2').minutes, 30);
  // an exam named by its dated item merges into the exam's own row, as the exams collection makes it
  const examDay = {
    ...clone(plan),
    days: [
      {
        date: '2026-11-03',
        tasks: [
          { id: 'x1', text: 'Sit it', tag: 'graded', kind: 'exam', minutes: 90, doneWhen: 'done', ref: 'dates/exam-d' },
        ],
      },
    ],
  };
  const x = EV.planDay({
    date: '2026-11-03',
    dates,
    exams: [{ id: 'E5', date: '2026-11-03', title: 'Exam 5: nutrition', course: 'NUR 112' }],
    plans: [examDay],
    weakspots: [],
    objectives: [],
  });
  assert.equal(x.blocks.filter(b => b.kind === 'exam').length, 1);
  assert.deepEqual(x.blocks.find(b => b.kind === 'exam').planTasks, ['x1']);
});

// ---------------------------------------------------------------- D-357: one tag per task, from a fixed set
const TAG_IDS = ['graded', 'learn', 'practice', 'review', 'clinical-prep', 'skills-prep'];
const examPlan = spec.jobs.kinds['exam-plan'];
const answerTask = (over = {}) => ({
  id: 'x',
  text: 'Preview Ch 40',
  tag: 'learn',
  kind: 'reading',
  minutes: 20,
  doneWhen: 'skimmed',
  ...over,
});
const planAnswer = tasks => ({
  text: 'A plan.',
  plan: {
    exam: 'E4',
    title: 'E4 plan',
    section: { course: 'NUR 112', from: TODAY, to: '2026-10-27' },
    days: [{ date: TODAY, tasks }],
  },
  score: { criteria: [5, 5, 5, 5, 5, 5, 5, 5], total: 100 },
});

test('D-357: a task’s tag is one of graded, learn, practice, review, clinical-prep, skills-prep: the answer shapes, plans.schema and the instructions hold the set', () => {
  assert.deepEqual(EV.STUDY_PLAN_TAGS, TAG_IDS);
  const ops = examPlan.edit.output.properties.ops.items.properties;
  for (const s of [
    examPlan.output.properties.plan.properties.days.items.properties.tasks.items.properties.tag,
    ops.task.properties.tag,
    ops.set.properties.tag,
  ])
    assert.deepEqual(s, { enum: TAG_IDS });
  const shape = examPlan.output;
  assert.ok(validateAgainst(shape, planAnswer([answerTask()])).ok);
  for (const bad of ['PRACTICE', 'COMMITMENT PREP', 'commitment-prep', 'reading', 'Learn'])
    assert.ok(!validateAgainst(shape, planAnswer([answerTask({ tag: bad })])).ok, `${bad} is refused`);
  const patch = tag => ({ text: 'ok', ops: [{ op: 'edit', id: 'x', set: { tag } }] });
  assert.ok(validateAgainst(examPlan.edit.output, patch('skills-prep')).ok);
  assert.ok(!validateAgainst(examPlan.edit.output, patch('SKILLS PREP')).ok);
  // a stored study plan (it has a section) holds the set; an exam plan page's plan keeps its legend's tags
  const doc = tag => ({
    schema: 1,
    writer: 'worker',
    at: NOW.toISOString(),
    source: 'x',
    exam: 'E4',
    section: { course: 'NUR 112', from: TODAY, to: '2026-10-27' },
    days: [{ date: TODAY, tasks: [{ id: 'a', text: 'A', tag }] }],
  });
  for (const t of TAG_IDS) assert.ok(validate('plans', doc(t), { id: 'E4-2' }).ok, t);
  for (const bad of ['COMMITMENT PREP', 'PRACTICE', 'drill'])
    assert.ok(!validate('plans', doc(bad), { id: 'E4-2' }).ok, `${bad} is refused on a study plan`);
  const { section, ...legacy } = doc('drill');
  assert.ok(validate('plans', legacy, { id: 'E4' }).ok, 'an exam plan page’s drill tag stands');
  const sch = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/schemas/plans.schema.json'), 'utf8'));
  assert.deepEqual(sch.anyOf[1].properties.days.items.properties.tasks.items.properties.tag.enum, TAG_IDS);
  // the built-in instructions and the guide tell the model the set, with Learn for previews, lectures and full reads
  const brief = fs.readFileSync(path.join(ROOT, 'docs/study-plan-brief.md'), 'utf8');
  for (const t of TAG_IDS) assert.match(brief, new RegExp(`^- ${t} \\(`, 'm'), t);
  assert.doesNotMatch(brief, /COMMITMENT PREP/);
  assert.match(brief, /^- learn \(Learn\): [^\n]*previews, lectures, full reads/m);
  assert.match(brief, /^- clinical-prep \(Clinical prep\)/m);
  for (const t of TAG_IDS) assert.ok(examPlan.guide.includes(t), `the guide names ${t}`);
});

test('D-357: code sets graded on a task whose ref is a dated graded item, whatever the model said; a reading tagged practice is learn', async () => {
  const db = record();
  const reply = body => {
    const rep = jobReply(body);
    const plan = rep.content[0].input.plan;
    plan.days[0].tasks = [
      answerTask({ id: 'pre', tag: 'practice' }), // a preview the model called practice
      answerTask({ id: 'ati', text: 'ATI module', tag: 'review', kind: 'other', ref: 'dates/synthetic-ati' }),
      answerTask({ id: 'q', text: 'Quiz early', tag: 'learn', kind: 'other', ref: 'dates/demo-quiz' }),
      answerTask({ id: 'lab', text: 'Pre-lab', tag: 'skills-prep', kind: 'other', ref: 'dates/bio-lab-oct26' }),
      answerTask({ id: 'drill', text: '15 questions', tag: 'practice', kind: 'drill' }),
    ];
    return rep;
  };
  const { r, writes } = await run(db, { title: 'plan', brief: 'a plan', course: 'NUR 112' }, { reply });
  assert.equal(r.status, 'done', r.said);
  const saved = writes.find(w => w.collection === 'plans');
  assert.ok(validate('plans', saved.data, { id: saved.id }).ok);
  const tag = id => saved.data.days[0].tasks.find(t => t.id === id).tag;
  assert.equal(tag('ati'), 'graded', 'a ref to graded work is graded');
  assert.equal(tag('q'), 'graded');
  assert.equal(tag('lab'), 'skills-prep', 'a ref to an ungraded item keeps the model’s tag');
  assert.equal(tag('pre'), 'learn', 'a preview is never practice');
  assert.equal(tag('drill'), 'practice');
  assert.ok(saved.data.days.every(d => d.tasks.every(t => TAG_IDS.includes(t.tag))));
  // an edit's patch is settled the same way, over the record's dates
  const draft = { ...saved.data, id: saved.id };
  const next = EV.applyPlanPatch(
    draft,
    {
      ops: [
        { op: 'edit', id: 'ati', set: { tag: 'review' } },
        { op: 'add', date: TODAY, task: answerTask({ id: 'n', tag: 'learn', kind: 'other', ref: 'dates/demo-quiz' }) },
        { op: 'edit', id: 'drill', set: { tag: 'review' } },
      ],
    },
    { dates: EV.liveDates(db.dates, db.dateedits) }
  );
  const after = id => next.plan.days[0].tasks.find(t => t.id === id).tag;
  assert.deepEqual([after('ati'), after('n'), after('drill')], ['graded', 'graded', 'review']);
  assert.equal(next.retagged, 2);
  // and through the job: the worker passes the record's dates to the patch
  const db2 = await withDraft();
  const forced = body => ({
    content: [
      {
        type: 'tool_use',
        id: 'tu',
        name: 'answer',
        input: { text: 'Changed.', ops: [{ op: 'edit', id: 't2', set: { tag: 'practice' } }] },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 10 },
  });
  const e = await run(db2, { title: 'Plan changes', brief: 'make t2 practice', revise: 'E4-2' }, { reply: forced });
  assert.equal(e.r.status, 'done', e.r.said);
  const p3 = e.writes.find(w => w.collection === 'plans');
  assert.equal(p3.data.days[0].tasks.find(t => t.id === 't2').tag, 'graded');
});

test('D-357: the tag reaches Today through planDay with the task’s other fields, by its display name', () => {
  const date = '2026-11-02';
  const tasks = TAG_IDS.map((tag, i) => ({
    id: 'k' + i,
    text: `Task ${tag}`,
    tag,
    kind: tag === 'learn' ? 'reading' : 'other',
    minutes: 15 + i,
    doneWhen: `${tag} done`,
  }));
  const plan = {
    id: 'E5-2',
    exam: 'E5',
    section: { course: 'NUR 112', from: '2026-10-28', to: '2026-11-17' },
    days: [{ date, tasks }],
  };
  const d = EV.planDay({ date, dates: [], exams: [], plans: [plan], weakspots: [], objectives: [] });
  const list = EV.buildDayList(d, {});
  const item = i => list.items.find(x => x.id === 'plan-k' + i);
  assert.deepEqual(
    TAG_IDS.map((_, i) => item(i).tag),
    ['GRADED', 'LEARN', 'PRACTICE', 'REVIEW', 'CLINICAL PREP', 'SKILLS PREP']
  );
  for (const [i, t] of tasks.entries()) {
    assert.equal(item(i).minutes, t.minutes, 'its minutes');
    assert.equal(item(i).doneWhen, t.doneWhen, 'its doneWhen');
    assert.equal(item(i).ref, 'plans/E5#' + t.id, 'its ref');
  }
  const graded = d.blocks.find(b => b.id === 'plan-k0');
  assert.deepEqual([graded.required, graded.cut], [true, 99], 'graded work is never cut for the budget');
  // an exam plan page's legend is unchanged: its review is ATI review
  const page = {
    id: 'E4',
    exam: 'E4',
    days: [{ date, tasks: [{ id: 'r', text: 'ATI', tag: 'review', kind: 'review' }] }],
  };
  const pd = EV.planDay({ date, dates: [], exams: [], plans: [page], weakspots: [], objectives: [] });
  assert.equal(pd.blocks.find(b => b.id === 'plan-r').tag, 'ATI REVIEW');
  // Today shows each by its display name
  const today = fs.readFileSync(path.join(ROOT, 'page/app/10-today.js'), 'utf8');
  for (const [k, name] of [
    ['GRADED', 'Graded'],
    ['LEARN', 'Learn'],
    ['PRACTICE', 'Practice'],
    ['REVIEW', 'Review'],
    ["'CLINICAL PREP'", 'Clinical prep'],
    ["'SKILLS PREP'", 'Skills prep'],
  ])
    assert.match(today, new RegExp(`^\\s+${k}: \\['${name}',`, 'm'), name);
});

test('B-450: the page’s plan writes are core composers: his settings and Approve on a study plan draft', () => {
  const s = EV.studyPlanSettingsSet(null, { approved: 'plan' }, { now: NOW });
  assert.equal(s.op, 'set');
  assert.equal(s.collection, 'settings');
  assert.equal(s.id, 'study-plan');
  assert.equal(s.data.instructions, null, 'the default until he writes some');
  assert.equal(s.data.approved, 'plan');
  assert.ok(validate('settings', s.data, { id: 'study-plan' }).ok);
  const s2 = EV.studyPlanSettingsSet({ id: 'study-plan', ...s.data }, { missing: 'note' }, { now: NOW });
  assert.deepEqual([s2.data.approved, s2.data.missing], ['plan', 'note'], 'what a change leaves out stays');
  const draft = {
    id: 'E5-2',
    schema: 1,
    writer: 'worker',
    at: NOW.toISOString(),
    source: 'x',
    exam: 'E5',
    section: { course: 'NUR 112', from: '2026-10-28', to: '2026-11-17' },
    days: [],
  };
  const ticks = { t1: { at: NOW.toISOString(), by: 'Matt' } };
  const pe = {
    id: 'E5',
    schema: 2,
    writer: 'page',
    at: NOW.toISOString(),
    source: 'E.V. Home',
    updatedAt: NOW.toISOString(),
    ticks,
  };
  const a = EV.studyPlanApproveSet([pe], draft, { now: NOW });
  assert.deepEqual([a.op, a.collection, a.id, a.data.plan], ['set', 'planedits', 'E5', 'E5-2']);
  assert.deepEqual(a.data.ticks, ticks, 'his ticks are kept');
  assert.ok(validate('planedits', a.data, { id: 'E5' }).ok);
  assert.equal(EV.planViews([draft], [{ id: 'E5', ...a.data }])[0].id, 'E5-2', 'the draft is the plan in force');
  assert.throws(() => EV.studyPlanApproveSet([], { ...draft, section: undefined }, { now: NOW }), /study plan draft/);
});

test('B-450: Make a plan plans toward its card’s exam; an exam marked done is never the section’s, even on its day', () => {
  const ex = (id, date, status = 'upcoming') => ({ id, course: 'NUR 112', date, title: `Exam ${id}`, status });
  const exams = [ex('E4', '2026-10-28', 'done'), ex('E5', '2026-11-17'), ex('E6', '2026-12-08')];
  assert.equal(EV.studyPlanSection({ exams, course: 'NUR 112', date: '2026-10-28' }).exam.id, 'E5');
  assert.equal(EV.studyPlanSection({ exams, course: 'NUR 112', date: '2026-10-28', examId: 'E4' }), null);
  const job = EV.studyPlanJob({ course: 'NUR 112', exams, date: '2026-10-28', examId: 'E6' });
  assert.match(job.brief, /\(E6\)/, 'the card’s exam is named in the brief the Worker reads');
  assert.match(EV.studyPlanJob({ course: 'NUR 112', exams, date: '2026-10-28' }).brief, /\(E5\)/);
});

test('B-450: Ask for changes on a plan’s card edits that plan, whatever exam is next; with none named, the default', () => {
  const at = NOW.toISOString();
  const plan = (id, exam, section) => ({
    id,
    schema: 1,
    writer: 'worker',
    at,
    source: 'x',
    exam,
    ...(section ? { section } : {}),
    days: [],
  });
  const exams = [
    { id: 'E5', course: 'NUR 112', date: '2026-11-17', title: 'Exam 5' },
    { id: 'E6', course: 'NUR 112', date: '2026-12-08', title: 'Exam 6' },
  ];
  const plansRaw = [
    plan('E5', 'E5', { course: 'NUR 112', from: '2026-10-28', to: '2026-11-17' }),
    plan('E6', 'E6', { course: 'NUR 112', from: '2026-11-18', to: '2026-12-08' }),
    plan('ATI-DOSE', 'ATI-DOSE'),
  ];
  const base = {
    said: 'make the weekends lighter',
    brief: 'make the weekends lighter',
    exams,
    plansRaw,
    planedits: [],
    date: '2026-10-28',
  };
  assert.equal(
    EV.studyPlanChatAsk({ ...base, title: 'NUR 112 plan' }).edit.revise,
    'E5',
    'the default: the next exam’s'
  );
  assert.deepEqual(EV.studyPlanChatAsk({ ...base, revise: 'E6' }).edit, {
    course: 'NUR 112',
    revise: 'E6',
    said: 'make the weekends lighter',
  });
  assert.equal(EV.studyPlanChatAsk({ ...base, revise: 'ATI-DOSE' }).edit.revise, 'ATI-DOSE', 'a plan for no exam');
  const job = EV.studyPlanJob({ revise: 'ATI-DOSE', changes: base.brief });
  assert.equal(job.revise, 'ATI-DOSE');
});

test('B-449: Ask for changes on a plan’s card that plainly asks for a new plan gets the chip alone, no edit beside it', () => {
  const db = record();
  const ask = said =>
    EV.studyPlanChatAsk({
      said,
      brief: said,
      title: 'Study plan: NUR 112',
      exams: db.exams,
      plansRaw: db.plans,
      planedits: db.planedits || [],
      date: TODAY,
      revise: 'E4',
    });
  const whole = ask('redo the plan around my revalidation');
  assert.deepEqual([whole.edit, whole.offer && whole.offer.type], [null, 'newplan']);
  const edit = ask('move the drill to Friday');
  assert.deepEqual([edit.edit.revise, edit.offer], ['E4', null]);
});
