// B-99 (Matt, Oct 19): no standing reminder about graded work and no "made-up" patient or client wording in what E.V.
// says or writes (spec.persona, the item guide, page copy, core's lines and prompts, the synthetic record); the limits still act
// when it matters: a real ask to do, edit or turn in graded work gets one line back, and the identifier scan still stops
// a real identifier. The scheduled tasks' own prompts (tools/prompts.mjs) keep their hard limits word for word.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import { appSource } from '../tools/build.mjs';
import { renderPrompt } from '../tools/prompts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const spec = JSON.parse(read('spec/ev.spec.json'));
EV.configure(spec);
const STANDING =
  /yours alone|made[- ]up (?:client|patient)s?|invented (?:client|patient)|fictional (?:client|patient)/i;

test('no standing graded-work or made-up client wording in what E.V. says or writes', () => {
  for (const [name, text] of [
    ['spec.persona', JSON.stringify(spec.persona)],
    ['spec.items', JSON.stringify(spec.items)],
    ['spec.workingAgreements', JSON.stringify(spec.workingAgreements)],
    ['spec.ui', JSON.stringify(spec.ui)],
    // The run prompts' own limits live in spec.boundaries since D-175 and keep B-99's exemption there.
    ['spec.boundaries', JSON.stringify(spec.boundaries.rules.map(({ prompt, ...r }) => r))],
    ['spec.pipelines', JSON.stringify(spec.pipelines)],
    ['spec.jobs', JSON.stringify(spec.jobs)],
    ['page/app', appSource(ROOT)],
    ['page/index.src.html', read('page/index.src.html')],
    ['core/evcore.mjs', read('core/evcore.mjs')],
    ['core/steps.mjs', read('core/steps.mjs')],
    ['test/data/seed.cjs', read('test/data/seed.cjs')],
  ]) {
    const m = text.match(new RegExp('.{0,40}(' + STANDING.source + ').{0,40}', 'i'));
    assert.equal(m, null, `${name}: ${m && m[0]}`);
  }
});

test('the greeting names graded work without a reminder', () => {
  const g = EV.greeting({
    date: '2026-10-20',
    now: '2026-10-20T19:00:00Z',
    items: [],
    reviewLeft: 0,
    nextExams: [],
    jobs: [],
    runs: {},
    todayDates: [{ title: 'Care plan 3 due 11:59pm', graded: true, kind: 'due' }],
    tomorrow: { dates: [{ title: 'Unit quiz', graded: true, kind: 'due' }] },
  });
  for (const b of g.brief) assert.doesNotMatch(JSON.stringify(b), STANDING);
  assert.doesNotMatch(g.lines.join(' '), STANDING);
});

test('a real ask to do, edit, check or turn in graded work is refused in one line; topics, quizzes and schedules are not', () => {
  const graded = ['Care plan 3 due 11:59pm', 'ATI Engage Fundamentals: health assessment module'];
  for (const t of [
    'Can you write my care plan for clinical?',
    'Edit my discussion post before I submit it',
    'Fill in the ATI Engage health assessment module answers for me',
    'check my medication table',
    'turn in my concept map',
  ]) {
    const r = EV.gradedAsk(t, graded);
    assert.ok(r, t);
    assert.equal(r.split(/(?<=\.)\s/).length <= 2 && !/\n/.test(r), true);
    assert.doesNotMatch(r, STANDING);
  }
  for (const t of [
    'Quiz me on fluid volume excess',
    'When is the care plan due?',
    'Explain afterload',
    'Block time for my care plan tomorrow',
    'What should I study for Exam 4?',
    'Write me 5 questions on potassium',
  ])
    assert.equal(EV.gradedAsk(t, graded), null, t);
});

test('the identifier scan still stops a real identifier', () => {
  assert.ok(EV.scanIdentifiers('Pt John Smith, MRN 12345678, room 412').length > 0);
});

test('the scheduled tasks keep their hard limits word for word (rendered from spec.boundaries since D-175, untouched by B-99)', () => {
  for (const target of ['live', 'staging'])
    for (const [key, task] of Object.entries(spec.tasks[target])) {
      const prompt = renderPrompt({ key: `${target}.${key}`, task, spec, release: 'v4.0.0' });
      if (prompt) assert.match(prompt, /made-up clients only, never patient identifiers/, key);
    }
});
