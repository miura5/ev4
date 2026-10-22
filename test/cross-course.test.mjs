// B-193 (D-205): a question may rest on another course's passage when it is the same concept, names its source and
// still targets an objective of its own course; a miss files one weak spot, under that objective. No course is named in
// core: the courses come from the material and the objective's exam. Made-up records throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import { AGENT_FOLDS } from '../core/steps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));

const env = { schema: 1, writer: 'test', at: '2026-10-21T12:00:00Z', source: 'test' };
const EXAMS = [
  { id: 'E4', ...env, course: 'NUR 112', title: 'Exam 4', date: '2026-10-21', kind: 'unit' },
  { id: 'BX3', ...env, course: 'BIO 201', title: 'Lecture Exam 3', date: '2026-10-30', kind: 'unit' },
];
const OBJECTIVES = [
  { id: 'E4-8', ...env, exam: 'E4', text: 'Nutrition: vitamins and wound healing' },
  { id: 'BX3-2', ...env, exam: 'BX3', text: 'Bone remodeling' },
];
const MATERIALS = [
  {
    id: 'BIO201-501',
    ...env,
    course: 'BIO 201',
    kind: 'slides',
    title: 'Bones slides.pptx',
    text: '[s12] Vitamin C...',
  },
  { id: 'NUR112-502', ...env, course: 'NUR 112', kind: 'slides', title: 'Nutrition.pptx', text: '[s3] Vitamin C...' },
];
const item = x => ({
  id: 'p1',
  kind: 'check',
  type: 'single',
  objective: 'E4-8',
  topic: 'Vitamin C and collagen',
  cjStep: 'analyze-cues',
  stem: 'A client with a slow-healing wound lacks which vitamin needed for collagen? (from BIO 201: Bones slides)',
  options: ['Vitamin C', 'Vitamin A', 'Vitamin D', 'Vitamin K'],
  correct: [0],
  rationales: ['Collagen needs it.', 'No.', 'No.', 'No.'],
  sourceRef: 'materials/BIO201-501',
  ...x,
});
const ctx = { materials: MATERIALS, exams: EXAMS, objectives: OBJECTIVES };

test('B-193: an item on another course’s passage names its source and counts toward its own objective’s course', () => {
  const c = EV.crossCourse(item(), ctx);
  assert.equal(c.course, 'NUR 112');
  assert.deepEqual(c.source, { course: 'BIO 201', title: 'Bones slides', label: 'from BIO 201: Bones slides' });
  assert.deepEqual(c.errors, []);
  // Its own course's material is not cross-course; nor is an item with no material behind it.
  assert.equal(EV.crossCourse(item({ sourceRef: 'materials/NUR112-502' }), ctx).source, null);
  assert.equal(EV.crossCourse(item({ sourceRef: null, verify: true }), ctx).source, null);
  // A BIO objective on a BIO passage is simply a BIO item.
  const bio = EV.crossCourse(item({ objective: 'BX3-2' }), ctx);
  assert.equal(bio.course, 'BIO 201');
  assert.equal(bio.source, null);
});

test('B-193: an item on another course’s passage that targets no objective of its own course is not kept', () => {
  const none = EV.crossCourse(item({ objective: '' }), { ...ctx, set: { exam: 'E4' } });
  assert.match(none.errors[0], /rests on BIO 201 material \(Bones slides\) but targets no objective of its own course/);
  const unknown = EV.crossCourse(item({ objective: 'E9-1' }), { ...ctx, set: { exam: 'E4' } });
  assert.equal(unknown.errors.length, 1);
  // The morning's drill writer keeps the labeled item and drops the one without an objective of its own course.
  const out = AGENT_FOLDS['practice-sets'](
    {
      drills: {
        'drill-x': [
          item(),
          item({ id: 'p2', objective: 'E9-1', stem: 'Which vitamin does collagen need? (from BIO 201: Bones slides)' }),
        ],
      },
    },
    { ...ctx, weakspots: [] },
    {
      now: '2026-10-21T09:30:00Z',
      source: 'morning test',
      brief: {
        date: '2026-10-21',
        review: { exists: true, targets: [], checks: [] },
        drills: [{ setId: 'drill-x', exam: 'E4', title: 'Drill', objectives: ['E4-8'] }],
      },
    }
  );
  const set = out.writes.find(w => w.collection === 'sets' && w.id === 'drill-x');
  assert.deepEqual(
    set.data.items.map(q => q.objective),
    ['E4-8'],
    out.say.join(' | ')
  );
  assert.match(out.say.join(' '), /targets no objective of its own course/);
});

test('B-193: a cross-course miss files one weak spot, under the NUR 112 objective, never one under BIO', () => {
  const set = { id: 'job-20261021-vitc', kind: 'job', exam: 'E4', items: [item()] };
  const r = EV.planAnswer({
    set,
    item: set.items[0],
    chosen: [1],
    now: Date.parse('2026-10-21T15:00:00Z'),
    weakspots: [],
    exams: EXAMS,
    answers: [],
    sets: [set],
  });
  assert.equal(r.correct, false);
  const ws = r.writes.filter(w => w.collection === 'weakspots');
  assert.equal(ws.length, 1, 'one weak spot');
  assert.equal(ws[0].data.objective, 'E4-8');
  assert.equal(ws[0].data.exam, 'E4');
  assert.equal(ws[0].data.course, 'NUR 112', 'under its own course, never the passage’s');
});

test('B-193: no course is named in the code that decides it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/item-kinds.mjs'), 'utf8');
  const code = src
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(code.replace(/'from ' \+/, ''), /\b(NUR|BIO)\s?\d{3}\b/);
});
