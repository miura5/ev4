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
import { makeValidator } from '../core/validate.mjs';
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
  assert.deepEqual([t2.ref, t2.tag, t2.minutes, t2.doneWhen], ['dates/synthetic-ati', 'GRADED', 45, 'submitted']);
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
  return { prepare: q => stmt(q) };
}
async function viaWorker(bodies, vars = {}) {
  const env = {
    EV_TOKEN: 't',
    ANTHROPIC_API_KEY: 'k',
    DB: fakeD1(),
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
    { purpose: 'exam-plan', max_tokens: 24000 },
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
  const env = await viaWorker([{ purpose: 'exam-plan' }], { CLAUDE_PLAN_MODEL: 'claude-sonnet-x' });
  assert.equal(env.sent[0].model, 'claude-sonnet-x');
});

test('D-355: an unknown purpose, a plan over 24k, an edit over the usual length or a purposed read-along is refused, unsent', async () => {
  const { out, sent } = await viaWorker([
    { purpose: 'chat' },
    { purpose: 'exam-plan', max_tokens: 24001 },
    { purpose: 'exam-plan', max_tokens: 1.5 },
    { purpose: 'plan-edit', max_tokens: 9000 },
    { purpose: 'exam-plan', read: { note: 'n1', h: 'abc' } },
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
  const plan = await viaWorker([{ purpose: 'exam-plan' }]);
  assert.equal(plan.used, 3000);
  const edit = await viaWorker([{ purpose: 'plan-edit' }]);
  assert.equal(edit.used, 1000);
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
            tag: 'PRACTICE',
            kind: 'reading',
            minutes: 25,
            doneWhen: '5 terms listed',
          },
          {
            id: 'p2',
            text: 'Take it in the testing window',
            tag: 'GRADED',
            kind: 'graded',
            minutes: 30,
            doneWhen: 'submitted',
            ref: 'dates/quiz-1',
          },
          {
            id: 'p3',
            text: 'Attend and mark what is stressed',
            tag: 'PRACTICE',
            kind: 'other',
            minutes: 50,
            doneWhen: 'notes taken',
            ref: 'dates/lec-9',
          },
          { id: 'p4', text: 'Skills: first look', tag: 'SKILLS PREP', kind: 'val', minutes: 0, doneWhen: 'watched' },
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
          { id: 'x1', text: 'Sit it', tag: 'GRADED', kind: 'exam', minutes: 90, doneWhen: 'done', ref: 'dates/exam-d' },
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
