// B-45 (D-102): exam plans are drafted, then accepted. plans/<exam> and plans/<exam>-<n> are Facts never changed;
// planedits/<exam>.plan names the one in force; readers see only that one; the greeting offers a draft once, when
// the Canvas sync brings in an exam's content module, and never drafts unasked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const env = (writer, at) => ({ schema: 1, writer, at, source: 'test' });
const plan = (id, exam, at) => ({
  id,
  ...env('worker', at),
  exam,
  title: 'Plan ' + id,
  days: [{ date: '2026-11-02', label: 'Day', tasks: [{ id: id + '-t1', text: 'Read', kind: 'reading' }] }],
});
const P = [
  plan('E5', 'E5', '2026-10-20T10:00:00Z'),
  plan('E5-2', 'E5', '2026-10-22T10:00:00Z'),
  plan('E4', 'E4', '2026-10-01T10:00:00Z'),
  plan('E4-draft', 'E4', '2026-10-02T10:00:00Z'),
];

test("B-45: readers see each exam's plan in force: plans/<exam> until planedits names a draft", () => {
  assert.deepEqual(
    EV.planViews(P, []).map(p => p.id),
    ['E5', 'E4'],
    'drafts, the old <exam>-draft too, are left out'
  );
  const pe = {
    id: 'E5',
    schema: 2,
    writer: 'page',
    at: '2026-10-22T12:00:00Z',
    source: 'E.V. Home',
    updatedAt: '2026-10-22T12:00:00Z',
    ticks: { t: { at: '2026-10-22T12:00:00Z' } },
    plan: 'E5-2',
  };
  const v = EV.planViews(P, [pe]);
  assert.deepEqual(
    v.map(p => p.id),
    ['E5-2', 'E4']
  );
  assert.deepEqual(Object.keys(v[0].done), ['t'], "the exam's ticks travel with the plan in force");
  assert.deepEqual(
    EV.planViews(P, [{ ...pe, plan: 'E5-9' }]).map(p => p.id),
    ['E5', 'E4'],
    'a plan that is not in the record falls back to plans/<exam>'
  );
  assert.deepEqual(
    EV.planDrafts(P, [pe], 'E5').map(p => p.id),
    ['E5']
  );
  assert.deepEqual(
    EV.planDrafts(P, [], 'E5').map(p => p.id),
    ['E5-2']
  );
});

test('B-45: a draft gets the next free id and is never written over plans/<exam>', () => {
  assert.equal(EV.nextPlanId([], 'E6'), 'E6');
  assert.equal(EV.nextPlanId(P, 'E5'), 'E5-3');
  assert.equal(EV.nextPlanId(P.slice(0, 1), 'E5'), 'E5-2');
});

test('B-45: accepting a draft names it in planedits/<exam> with the ticks kept; a later tick keeps it; both validate', () => {
  const before = {
    id: 'E5',
    schema: 1,
    writer: 'page',
    at: '2026-10-21T12:00:00Z',
    source: 'E.V. Home',
    updatedAt: '2026-10-21T12:00:00Z',
    ticks: { 'E5-t1': { at: '2026-10-21T12:00:00Z', by: 'Matt' } },
  };
  const a = EV.planAccept(before, 'E5', 'E5-2', { now: '2026-10-22T12:00:00Z' });
  assert.equal(a.id, 'E5');
  assert.equal(a.data.plan, 'E5-2');
  assert.deepEqual(Object.keys(a.data.ticks), ['E5-t1']);
  assert.equal(a.data.schema, 2);
  assert.ok(
    validate('planedits', a.data, { id: 'E5' }).ok,
    JSON.stringify(validate('planedits', a.data, { id: 'E5' }))
  );
  const t = EV.planTick({ ...a.data, id: 'E5' }, 'E5', 'E5-2-t1', { now: '2026-10-22T13:00:00Z' });
  assert.equal(t.data.plan, 'E5-2', 'a tick keeps the plan in force');
  assert.ok(validate('planedits', t.data, { id: 'E5' }).ok);
  const fresh = EV.planTick(null, 'E6', 'x', { now: '2026-10-22T13:00:00Z' });
  assert.ok(validate('planedits', fresh.data, { id: 'E6' }).ok, 'a first tick writes the new version');
});

test('B-45: the greeting offers one plan draft when the Canvas sync just brought in an exam content module', () => {
  const exams = [
    { id: 'E5', title: 'Exam 5: Mobility', date: '2026-11-20' },
    { id: 'E4', title: 'Exam 4', date: '2026-10-21' },
  ];
  const mat = { id: 'NUR112-1', course: 'NUR 112', module: 'Exam 5 Content', at: '2026-10-21T01:20:00Z' };
  const o = { materials: [mat], plans: [], exams, jobs: [], since: '2026-10-20T12:00:00Z', date: '2026-10-21' };
  assert.deepEqual(EV.planOffer(o), { examId: 'E5', title: 'Exam 5: Mobility' });
  assert.equal(EV.planOffer({ ...o, plans: [plan('E5', 'E5', '2026-10-20T00:00:00Z')] }), null, 'an exam with a plan');
  assert.equal(
    EV.planOffer({ ...o, jobs: [{ kind: 'exam-plan', title: 'Exam plan', brief: 'E5: draft it' }] }),
    null,
    'one asked for already'
  );
  assert.equal(EV.planOffer({ ...o, since: '2026-10-21T02:00:00Z' }), null, 'a module he has seen');
  assert.equal(
    EV.planOffer({ ...o, materials: [{ ...mat, course: 'BIO 201', module: 'Unit 5' }] }),
    null,
    'a course with no plan module'
  );
  const g = EV.greeting({
    date: '2026-10-21',
    now: '2026-10-21T13:00:00Z',
    items: [],
    nextExams: [],
    jobs: [],
    runs: {},
    planOffer: EV.planOffer(o),
  });
  assert.ok(
    g.lines.some(l => /^Exam 5 content is on Canvas\. Want me to draft its plan\?$/.test(l)),
    g.lines.join(' | ')
  );
  const item = g.brief.find(b => b.kind === 'plan');
  assert.deepEqual(
    [item.level, item.title, item.exam, item.action.chip],
    ['new', 'Exam 5 content is on Canvas', 'E5', 'Draft its plan'],
    'a new line in the briefing whose action is its one tap'
  );
  assert.ok(
    !EV.greeting({
      date: '2026-10-21',
      now: '2026-10-21T13:00:00Z',
      items: [],
      nextExams: [],
      jobs: [],
      runs: {},
    }).lines.some(l => /draft its plan/.test(l)),
    'never unasked otherwise'
  );
});

test('B-45: the planedits 1 to 2 bump matches its fixture, validates and is idempotent', async () => {
  const { migrateBumps, applyWrites, currentVersion } = await import('../core/migrate.mjs');
  const { readExport } = await import('../core/schemas.mjs');
  const dir = path.join(ROOT, 'test/data/bumps/planedits-1');
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of readExport(d)) (db[collection] ||= []).push({ ...doc, id });
    return db;
  };
  const before = load(path.join(dir, 'before')),
    after = load(path.join(dir, 'after'));
  const r = migrateBumps(before, { at: '2026-10-20T17:00:00Z' });
  const got = {};
  for (const w of r.writes) (got[w.collection] ||= []).push({ ...w.data, id: w.id });
  for (const [c, docs] of Object.entries(after)) assert.equal(EV.stableStringify(got[c]), EV.stableStringify(docs), c);
  for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id}`);
  assert.equal(currentVersion('planedits'), 2);
  assert.deepEqual(
    migrateBumps(applyWrites(before, r.writes), { at: '2026-10-21T17:00:00Z' }).writes,
    [],
    'twice changes nothing'
  );
});
