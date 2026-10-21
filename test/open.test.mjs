// B-75 (D-132, D-133): open items. The check function, the grade by a stubbed model reply and by the local fallback,
// the grade rule (partial counts as a miss), checkFormat's alternation, the open check's grounding in his note, and the
// sets 2 to 3 and answers 1 to 2 bumps. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { migrateBumps } from '../core/migrate.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator(path.join(ROOT, 'spec', 'schemas'));

const open = (o = {}) => ({
  id: 'o1',
  kind: 'check',
  type: 'open',
  stem: 'Why does a made-up client with fluid volume excess develop crackles?',
  keyPoints: [
    { text: 'Extra fluid raises pressure in the capillaries', keywords: [['pressure', 'hydrostatic']] },
    {
      text: 'Fluid shifts into the lungs',
      keywords: [
        ['lung', 'alveoli', 'pulmonary'],
        ['fluid', 'water'],
      ],
    },
  ],
  modelAnswer:
    'Excess volume raises capillary hydrostatic pressure, so fluid moves into the alveoli and crackles follow.',
  sourceRef: 'note/n1#FVE: extra volume pushes fluid into the lungs',
  objective: 'E4-3',
  topic: 'Crackles in fluid volume excess',
  ...o,
});

test('the check function: a valid open item passes; one key point, a long stem, a long point, no keyword groups, no model answer, no sourceRef, options or an identifier are refused', () => {
  assert.deepEqual(EV.validateItem(open()).errors, []);
  assert.equal(EV.itemType(open()), 'open');
  const one = EV.validateItem(open({ keyPoints: [open().keyPoints[0]] }));
  assert.equal(one.ok, false);
  assert.match(one.errors.join(' '), /needs 2 or 3 key points/);
  const bad = {
    'a long stem': { stem: 'Why '.repeat(26) + 'crackles?' },
    'two questions': { stem: 'Why crackles here? And why not there?' },
    'four key points': { keyPoints: [1, 2, 3, 4].map(() => open().keyPoints[0]) },
    'a long point': { keyPoints: [{ text: 'word '.repeat(13), keywords: [['word']] }, open().keyPoints[1]] },
    'no keyword groups': { keyPoints: [{ text: 'Pressure rises', keywords: [] }, open().keyPoints[1]] },
    'no model answer': { modelAnswer: '' },
    'no sourceRef': { sourceRef: '' },
    options: { options: ['a', 'b'], correct: [0] },
    'an identifier': { modelAnswer: 'The client in room 412 has crackles from the extra fluid in the lungs.' },
  };
  for (const [why, o] of Object.entries(bad)) assert.equal(EV.validateItem(open(o)).ok, false, why);
});

test('graded by a stubbed model reply: right (every point), partial (some), wrong (none); partial counts as a miss', () => {
  const q = open();
  const by = hits => EV.scoreAnswer(q, { text: 'made-up answer', hits, gradedBy: 'model' });
  assert.deepEqual(
    [true, true].map(() => 0) &&
      [by([true, true]), by([true, false]), by([false, false])].map(r => [r.grade, r.correct]),
    [
      ['right', true],
      ['partial', false],
      ['wrong', false],
    ]
  );
  assert.equal(by([true, false]).score, 0.5);
  assert.equal(by([true, true]).gradedBy, 'model');
  // The model's reply goes through the shape check first: one boolean per key point, or nothing.
  assert.deepEqual(EV.parseGrade({ hits: [true, false] }, q), [true, false]);
  assert.equal(EV.parseGrade({ hits: [true] }, q), null, 'one boolean short');
  assert.equal(EV.parseGrade({ hits: ['yes', 'no'] }, q), null, 'not booleans');
  assert.equal(EV.parseGrade('{"hits": [true, true]}', q), null, 'text, not JSON');
  assert.equal(EV.parseGrade(null, q), null);
  // The prompt carries the question, each key point and his answer as data.
  const p = EV.gradePrompt(q, 'Fluid builds up in the lungs.');
  assert.match(p, /1\. Extra fluid raises pressure in the capillaries/);
  assert.match(p, /His answer:\nFluid builds up in the lungs\./);
  assert.match(p, /\{"hits": \[true \| false, true \| false\]\}/);
});

test('graded offline by core.gradeOpenLocal: a point is hit when a word of every keyword group is in his answer', () => {
  const q = open();
  const local = text => EV.scoreAnswer(q, text);
  const right = local('The hydrostatic pressure goes up, so water leaks into the lungs.');
  assert.deepEqual([right.grade, right.hits, right.gradedBy], ['right', [true, true], 'local']);
  const part = local('Fluid ends up in the lungs.');
  assert.deepEqual([part.grade, part.hits], ['partial', [false, true]]);
  const none = local('I am not sure.');
  assert.deepEqual([none.grade, none.hits], ['wrong', [false, false]]);
  // Plurals and case do not matter; a phrase must appear in order.
  assert.deepEqual(EV.gradeOpenLocal(q, 'PRESSURES rise; Waters fill the Alveoli'), [true, true]);
  const phrase = open({ keyPoints: [{ text: 'Third spacing', keywords: [['third space']] }, open().keyPoints[1]] });
  assert.deepEqual(EV.gradeOpenLocal(phrase, 'fluid moves to a third space in the lung'), [true, true]);
  assert.deepEqual(EV.gradeOpenLocal(phrase, 'space for a third of the fluid in the lung'), [false, true]);
  // A malformed model reply is the same as none: the answer is graded locally and says so.
  const mal = EV.scoreAnswer(q, { text: 'Fluid ends up in the lungs.', hits: [true], gradedBy: 'model' });
  assert.deepEqual([mal.grade, mal.gradedBy], ['partial', 'local']);
});

test('answering an open check: the attempt keeps text, hits, grade and gradedBy; partial is a miss that makes a weak spot; it validates', () => {
  const set = {
    id: 'check-ss-made-up-2',
    kind: 'check',
    items: [open()],
  };
  const r = EV.planAnswer({
    set,
    item: open(),
    chosen: { text: 'Fluid ends up in the lungs.', hits: [false, true], gradedBy: 'model' },
    now: '2026-10-21T19:00:00Z',
    weakspots: [],
    exams: [],
    byWeakspot: {},
  });
  assert.equal(r.correct, false, 'partial counts as a miss');
  const a = r.writes.find(w => w.collection === 'answers');
  const attempt = Object.values(a.data.answers.o1)[0];
  assert.deepEqual(
    [attempt.text, attempt.hits, attempt.grade, attempt.gradedBy, attempt.correct, attempt.score],
    ['Fluid ends up in the lungs.', [false, true], 'partial', 'model', false, 0.5]
  );
  assert.ok(attempt.createdWeakspot, 'the miss is a weak spot');
  assert.ok(r.writes.some(w => w.collection === 'weakspots'));
  assert.equal(a.data.schema, 2);
  const v = validate('answers', a.data, { id: a.id });
  assert.ok(v.ok, JSON.stringify(v.errors));
  // Added once after a partial grade: stored on the attempt, the grade unchanged.
  const added = {
    ...a.data,
    answers: { o1: { [Object.keys(a.data.answers.o1)[0]]: { ...attempt, added: 'Made-up more.' } } },
  };
  assert.ok(validate('answers', added, { id: a.id }).ok);
  // The set that holds an open check is of kind check, at sets schema 3.
  const sv = validate(
    'sets',
    { schema: 3, writer: 'page', at: '2026-10-21T19:00:00Z', source: 'Study session', kind: 'check', items: [open()] },
    { id: set.id }
  );
  assert.ok(sv.ok, JSON.stringify(sv.errors));
});

test('checkFormat (D-133): multiple choice first, then they alternate; a fallback counts as multiple choice; a wrong answer changes nothing', () => {
  const ev = (k, e) => [`page-20261021-${k}000`, e];
  const session = events => ({
    id: 'ss-made-up',
    startedAt: '2026-10-21T18:00:00Z',
    events: Object.fromEntries(events),
  });
  const at = '2026-10-21T19:00:00Z';
  assert.equal(EV.checkFormat(session([]), at), 'mc', 'the first check');
  const one = [ev('180700', { type: 'check', n: 1, format: 'mc', items: 3 })];
  assert.equal(EV.checkFormat(session(one), at), 'open');
  const two = [...one, ev('181400', { type: 'check', n: 2, format: 'open', items: 1 })];
  assert.equal(EV.checkFormat(session(two), at), 'mc');
  // An open check that fell back to multiple choice is stored as mc: the next one is open again.
  const fell = [...one, ev('181400', { type: 'check', n: 2, format: 'mc', items: 3 })];
  assert.equal(EV.checkFormat(session(fell), at), 'open');
  // An answer, right or wrong, does not move the alternation; neither do a comment or a quiet checkpoint.
  const more = [
    ...two,
    ev('181500', { type: 'answer', n: 2, result: 'miss' }),
    ev('181800', { type: 'check', comment: true }),
    ev('181900', { type: 'check', quiet: true }),
  ];
  assert.equal(EV.checkFormat(session(more), at), 'mc');
  // A session written before B-74 stored no format: its checks were multiple choice.
  assert.equal(EV.checkFormat(session([ev('180700', { type: 'check', n: 1, items: 2 })]), at), 'open');
});

test('the open check (D-132): grounded in his note, or null so the check falls back to multiple choice', () => {
  const note = 'FVE: extra volume pushes fluid into the lungs\nHydrostatic pressure rises in the capillaries.';
  const reply = (o = {}) => ({
    item: {
      stem: 'Why do crackles follow fluid volume excess?',
      keyPoints: [
        { text: 'Capillary pressure rises', keywords: [['hydrostatic', 'pressure']] },
        { text: 'Fluid moves into the lungs', keywords: [['lungs'], ['fluid']] },
        { text: 'Sodium is retained by the kidneys', keywords: [['sodium']] },
      ],
      modelAnswer: 'Extra volume raises capillary pressure and pushes fluid into the lungs.',
      sourceLine: 'FVE: extra volume pushes fluid into the lungs',
      ...o,
    },
  });
  const item = EV.parseOpenCheck(reply(), { text: note, noteId: 'n1', id: 'o1' });
  assert.ok(item, 'two grounded points');
  assert.equal(item.keyPoints.length, 2, 'the point his note does not hold is dropped');
  assert.equal(item.type, 'open');
  assert.match(item.sourceRef, /^note\/n1#FVE: extra volume/);
  assert.deepEqual(EV.validateItem(item).errors, []);
  assert.equal(
    EV.parseOpenCheck(reply({ keyPoints: reply().item.keyPoints.slice(1) }), { text: note }),
    null,
    'one grounded point is too few'
  );
  assert.equal(EV.parseOpenCheck(reply({ sourceLine: 'A line he never wrote' }), { text: note }), null);
  assert.equal(EV.parseOpenCheck({ item: null }, { text: note }), null, 'the model said no');
  assert.equal(EV.parseOpenCheck('not json', { text: note }), null);
  const p = EV.openCheckPrompt({ noteName: 'Fluids', text: note, added: 'new lines', n: 2 });
  assert.match(p, /Study session open check 2 on/);
  assert.match(p, /\{"item": null\}/);
});

test('the sets 2 to 3 and answers 1 to 2 bumps match their fixtures, keep every item and attempt, validate and are idempotent', () => {
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of readExport(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const apply = (db, writes) => {
    const out = JSON.parse(JSON.stringify(db));
    for (const w of writes) {
      const list = (out[w.collection] = out[w.collection] || []);
      const i = list.findIndex(d => d.id === w.id);
      if (i >= 0) list[i] = { ...w.data, id: w.id };
      else list.push({ ...w.data, id: w.id });
    }
    return out;
  };
  for (const name of ['sets-2', 'answers-1']) {
    const dir = path.join(ROOT, 'test/data/bumps', name);
    const before = load(path.join(dir, 'before')),
      after = load(path.join(dir, 'after'));
    const r = migrateBumps(before, { at: '2026-10-21T20:00:00Z' });
    const got = {};
    for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
    for (const [c, docs] of Object.entries(after))
      assert.equal(EV.stableStringify(sorted(got[c])), EV.stableStringify(sorted(docs)), `${name}: ${c}`);
    for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id}`);
    assert.deepEqual(migrateBumps(apply(before, r.writes), { at: '2026-10-22T20:00:00Z' }).writes, [], name);
  }
  const s = load(path.join(ROOT, 'test/data/bumps/sets-2/after')).sets[0];
  const b = load(path.join(ROOT, 'test/data/bumps/sets-2/before')).sets[0];
  assert.deepEqual([s.schema, s.items], [3, b.items]);
  const a = load(path.join(ROOT, 'test/data/bumps/answers-1/after')).answers[0];
  assert.equal(a.schema, 2);
  assert.deepEqual(a.answers, load(path.join(ROOT, 'test/data/bumps/answers-1/before')).answers[0].answers);
});
