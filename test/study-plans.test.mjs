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

test('D-356: the chat’s choice: a change is a patch, new words a new plan from today, anything else one question', () => {
  assert.equal(EV.studyPlanRoute('make me a cram plan for the dosage assessment', { hasPlan: true }).route, 'new');
  assert.equal(EV.studyPlanRoute('remake it from scratch', { hasPlan: true }).route, 'new');
  assert.equal(EV.studyPlanRoute('start over from today', { hasPlan: true }).route, 'new');
  assert.equal(EV.studyPlanRoute('move the drill to Thursday', { hasPlan: true }).route, 'change');
  assert.equal(EV.studyPlanRoute('add a new task for the lab', { hasPlan: true }).route, 'change');
  const ask = EV.studyPlanRoute('what about my plan for E4', { hasPlan: true });
  assert.deepEqual(ask, { route: 'ask', question: 'Change the current plan, or make a new one from today?' });
  assert.equal(EV.studyPlanRoute('move the drill', { hasPlan: false }).route, 'new', 'no plan yet: a new one');
  // a rewrite of a bad plan, a plan from today and a cram plan are each a new plan (Sonnet), never a patch
  for (const w of [
    'this plan is bad, rewrite it',
    'rewrite my E4 plan',
    'the plan looks terrible',
    'scrap it and plan from today',
    'plan from today please',
    'I need a plan starting today',
    'make it start from now',
    'cram plan for E4, add the labs too',
    'I need to cram for the exam',
    'cramming mode for Monday',
    'redo the whole thing',
  ])
    assert.equal(EV.studyPlanRoute(w, { hasPlan: true }).route, 'new', w);
  for (const w of [
    'start over from today',
    'make a plan from today',
    'redo it from now',
    'remake it from tonight',
    'redo the plan around my revalidation',
    'replan for my failed checkoff',
  ])
    assert.equal(EV.studyPlanRoute(w, { hasPlan: true }).route, 'new', w);
  // plain edits that name a day stay a patch (the review's four): "from today" alone is no new plan, nor "a new one-hour"
  for (const w of [
    'remove the reading from today',
    'drop the drill from tonight',
    'move the quiz review from today to Friday',
    'add a new one-hour block Sunday',
    'add revalidation practice for the injection checkoff before Monday',
    'add skills practice for my revalidation',
    'schedule two mock runs before my retry',
    'add a cram session on Sunday',
    'make Thursday lighter',
    'swap the drill and the preview',
  ])
    assert.equal(EV.studyPlanRoute(w, { hasPlan: true }).route, 'change', w);
  const chat = fs.readFileSync(path.join(ROOT, 'page/app/72-ev-talking-with-claude.js'), 'utf8');
  assert.match(chat, /E\.studyPlanRoute\(words, \{ hasPlan: !!cur \}\)/, 'the chat’s start_job routes through it');
  assert.match(chat, /job\.revise = cur\.id/);
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
async function viaWorker(bodies, vars = {}, seed = db => seedJob(db, 'job-plan')) {
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
    return new Response(
      JSON.stringify({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 100 } }),
      { status: 200 }
    );
  };
  const out = [];
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
    }
    const u = await (
      await worker.fetch(
        new Request('https://ev.example/api/claude/usage', { headers: { authorization: 'Bearer t' } }),
        env
      )
    ).json();
    return { out, sent, used: u.hour };
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
