// B-446: Quiz me's five questions came back as "not a usable shape". On staging, Haiku's practice reply drifted from
// the asked shape in ways that keep their meaning ("correct": 0 for [0] was seen there); validateItem refused each
// drifted question, and a batch whose five all drifted was binned. A reply cut short at max_tokens lost the whole batch.
// These are the reply shapes, made up, and what the page now keeps of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));

const opts = ['Urine output 25 mL/h', 'Urine output 60 mL/h', 'Clear lung sounds', 'Heart rate 72'];
const why = opts.map(o => 'Why: ' + o);
const stem = n => `A client on day ${n} after surgery is assessed. Which finding needs the nurse's action first?`;
// The failing shape: every question drifted once, so all five were refused before the fix.
const DRIFTED = {
  items: [
    { type: 'single', topic: 'a', stem: stem(1), options: opts, correct: 0, rationales: why, cjStep: 'analyze-cues' },
    {
      type: 'single',
      topic: 'b',
      stem: stem(2),
      options: opts,
      correct: ['B'],
      rationales: why,
      cjStep: 'take-action',
    },
    {
      type: 'Multiple Choice',
      topic: 'c',
      stem: stem(3),
      options: opts.map(text => ({ text })),
      correct: [opts[2]],
      rationales: why,
      cjStep: 'Recognize Cues',
    },
    {
      type: 'select-all',
      topic: 'd',
      stem: stem(4),
      options: [...opts, 'Pain 2 of 10'],
      correct: ['0', '2'],
      rationales: [...why, 'Why: pain'],
      cjStep: 'prioritize_hypotheses',
    },
    {
      type: 'matrix',
      topic: 'e',
      stem: stem(5),
      matrix: {
        columns: ['Expected', 'Unexpected'],
        rows: [
          { text: 'Urine 20 mL/h', correct: 'Unexpected', rationale: 'low' },
          { text: 'Temp 37.0 C', correct: [0], rationale: 'normal' },
          { text: 'HR 130', correct: '1', rationale: 'fast' },
        ],
      },
      cjStep: 'a step it made up',
    },
  ],
};

test('B-446: the failing reply shape: every drifted question is refused as written', () => {
  const ok = EV.practiceReply.replyItems(DRIFTED).filter((q, i) => EV.validateItem({ ...q, id: 'm' + i }).ok);
  assert.equal(ok.length, 0);
});

test('B-446: normalizeItem mends the drift, so all five are usable and read as written', () => {
  const qs = EV.practiceReply.replyItems(DRIFTED).map(EV.practiceReply.normalizeItem);
  qs.forEach((q, i) => assert.deepEqual(EV.validateItem({ ...q, id: 'm' + i }).errors, [], 'item ' + i));
  assert.deepEqual(qs[0].correct, [0]);
  assert.deepEqual(qs[1].correct, [1]); // B is the second option
  assert.equal(qs[2].type, 'single');
  assert.deepEqual(qs[2].options, opts);
  assert.deepEqual(qs[2].correct, [2]); // the option's own words
  assert.equal(qs[2].cjStep, 'recognize-cues');
  assert.equal(qs[3].type, 'sata');
  assert.deepEqual(qs[3].correct, [0, 2]);
  assert.equal(qs[3].cjStep, 'prioritize-hypotheses');
  assert.deepEqual(
    qs[4].matrix.rows.map(r => r.correct),
    [1, 0, 1]
  );
  assert.equal('cjStep' in qs[4], false); // an unknown step is dropped, not the question
  assert.equal(DRIFTED.items[0].correct, 0, 'the reply itself is left as it came');
});

test('B-446: what cannot be read one way is still refused', () => {
  const bad = [
    { type: 'single', stem: stem(1), options: opts, correct: ['Z'], rationales: why, cjStep: 'take-action' },
    { type: 'single', stem: stem(2), options: opts, correct: ['none of these'], rationales: why },
    { type: 'single', stem: stem(3), options: opts, correct: 7, rationales: why },
    { type: 'quiz', stem: stem(4), options: opts, correct: [0] },
  ];
  for (const q of bad)
    assert.equal(EV.validateItem({ ...EV.practiceReply.normalizeItem(q), id: 'x' }).ok, false, JSON.stringify(q));
});

test('B-446: replyItems reads {items}, a bare array, {questions} and {set: {items}}; anything else is none', () => {
  const q = [{ stem: 'x' }];
  assert.deepEqual(EV.practiceReply.replyItems({ items: q }), q);
  assert.deepEqual(EV.practiceReply.replyItems(q), q);
  assert.deepEqual(EV.practiceReply.replyItems({ questions: q }), q);
  assert.deepEqual(EV.practiceReply.replyItems({ set: { items: q } }), q);
  for (const r of [null, undefined, 'text', {}, { items: 'no' }]) assert.deepEqual(EV.practiceReply.replyItems(r), []);
});

test('B-446: a reply cut short at max_tokens keeps its whole questions', () => {
  const whole = JSON.stringify(DRIFTED);
  const cut = whole.slice(0, whole.indexOf('"topic":"d"') + 40); // stops inside the fourth question
  assert.throws(() => JSON.parse(cut));
  const got = EV.practiceReply.salvageItems(cut);
  assert.equal(got.length, 3);
  assert.deepEqual(
    got[2].options,
    opts.map(text => ({ text }))
  );
  // braces and brackets inside strings do not end a question early
  const tricky = '{"items":[{"stem":"Which } is ] right? \\"quoted\\" {","correct":[1]},{"stem":"cut';
  assert.deepEqual(EV.practiceReply.salvageItems(tricky), [{ stem: 'Which } is ] right? "quoted" {', correct: [1] }]);
  // words around the JSON, and a whole reply, read the same
  assert.equal(EV.practiceReply.salvageItems('Here you go:\n```json\n' + whole + '\n```').length, 5);
  assert.deepEqual(EV.practiceReply.salvageItems('no JSON at all'), []);
});

test('B-446 (review): a value that reads as an option and as a place naming another option is refused', () => {
  const N = EV.practiceReply.normalizeItem;
  const ask = (options, correct) =>
    EV.validateItem({ ...N({ type: 'single', stem: stem(1), options, correct, cjStep: 'take-action' }), id: 'x' });
  // blood types: "A" is the second option's words and the letter of the first
  assert.equal(ask(['O', 'A', 'B', 'AB'], ['A']).ok, false);
  // GCS scores: "3" is the first option's words and the fourth's place
  assert.equal(ask(['3', '8', '12', '15'], ['3']).ok, false);
  // number options stay numbers, so a bare index cannot pass as their words
  assert.equal(ask([2, 1, 4, 3], 1).ok, false);
  // the words first: "AB" and "15" name only the fourth option; "B" is the second by words and no other by letter
  assert.deepEqual(N({ options: ['O', 'A', 'B', 'AB'], correct: ['AB'] }).correct, [3]);
  assert.deepEqual(N({ options: ['3', '8', '12', '15'], correct: '15' }).correct, [3]);
  assert.deepEqual(N({ options: ['O', 'B', 'C', 'AB'], correct: ['B'] }).correct, [1]);
  // a whole number is an index, as the asked shape says
  assert.deepEqual(N({ options: ['3', '8', '12', '15'], correct: 3 }).correct, [3]);
});

test('B-446 (review): a mended set holds only the schema fields and validates as the page writes it', async () => {
  const { makeValidator } = await import('../core/validate.mjs');
  const { loadSchemas } = await import('../core/schemas.mjs');
  const { ITEM_FIELDS } = await import('../core/steps-shared.mjs');
  const schemas = loadSchemas(path.join(ROOT, 'spec', 'schemas'));
  const itemProps = Object.keys(schemas.sets.properties.items.items.properties);
  assert.deepEqual([...EV.practiceReply.ITEM_KEYS].sort(), [...itemProps].sort());
  for (const k of ITEM_FIELDS) assert.ok(EV.practiceReply.ITEM_KEYS.includes(k), k);
  const extra = DRIFTED.items.map((q, i) =>
    i === 0 ? { ...q, stem: undefined, question: q.stem, difficulty: 'easy' } : { ...q, explanation: 'x' }
  );
  const m = extra[4].matrix;
  extra[4] = { ...extra[4], matrix: { ...m, note: 'n', rows: m.rows.map(r => ({ ...r, why: 'w' })) } };
  const items = extra
    .map(EV.practiceReply.normalizeItem)
    .map((q, i) => ({ ...q, id: 'm' + (i + 1), kind: 'check' }))
    .filter(q => EV.validateItem(q).ok);
  assert.equal(items.length, 5);
  const doc = {
    ...EV.envelope('page', 'More practice', '2026-10-28T12:00:00Z'),
    schema: 3,
    kind: 'more',
    date: '2026-10-28',
    title: 'More practice · Wed 28 Oct',
    createdAt: '2026-10-28T12:00:00Z',
    items,
  };
  const v = makeValidator(schemas)('sets', doc, { id: 'more-2026-10-28-1' });
  assert.ok(v.ok, JSON.stringify(v.errors));
  // and as written, the extra keys refuse the write: what the review found
  const raw = { ...doc, items: items.map((q, i) => (i === 0 ? { ...q, question: 'x' } : q)) };
  assert.equal(makeValidator(schemas)('sets', raw, { id: 'more-2026-10-28-1' }).ok, false);
});

test('B-453: columns that differ only by a symbol match on exact or folded text, symbols kept, else are refused', () => {
  const N = EV.practiceReply.normalizeItem;
  const grid = (columns, keys) =>
    N({
      type: 'matrix',
      stem: 'Which change does each finding show in this client?',
      matrix: { columns, rows: keys.map((k, i) => ({ text: 'Finding ' + (i + 1), correct: k, rationale: 'why' })) },
      cjStep: 'analyze-cues',
    });
  const keyed = q => q.matrix.rows.map(r => r.correct);
  const usable = q => EV.validateItem({ ...q, id: 'x' }).ok;
  // the failing input: every row "↓" was keyed to the first column ("↑")
  const arrows = grid(['↑', '↓', 'No change'], ['↓', '↓', '↓']);
  assert.deepEqual(keyed(arrows), [1, 1, 1]);
  assert.deepEqual(keyed(grid(['↑', '↓', 'No change'], ['↑', ' ↓ ', 'No change'])), [0, 1, 2]);
  assert.deepEqual(keyed(grid(['> 5', '< 5'], ['< 5', '> 5', '< 5'])), [1, 0, 1]);
  assert.deepEqual(keyed(grid(['Rh+', 'Rh-'], ['Rh-', 'Rh+', 'Rh-'])), [1, 0, 1]);
  // folded for case, spacing and trailing punctuation, the symbols kept: the same choice still matches
  assert.deepEqual(keyed(grid(['> 5', '< 5'], ['>5', '<  5', '< 5'])), [0, 1, 1]);
  assert.deepEqual(keyed(grid(['Rh+', 'Rh-'], ['rh-', 'RH+', 'Rh-.'])), [1, 0, 1]);
  assert.deepEqual(keyed(grid(['↑', '↓', 'No change'], [' ↓ ', 'no  change', 'No change.'])), [1, 2, 2]);
  assert.deepEqual(N({ options: ['Hypokalemia', 'Hyperkalemia'], correct: ['hyperkalemia.'] }).correct, [1]);
  assert.deepEqual(N({ options: ['Hyperkalemia.', 'Hypokalemia'], correct: ['hyperkalemia'] }).correct, [0]);
  assert.deepEqual(N({ options: ['> 5', '< 5', '= 5'], correct: ['< 5'] }).correct, [1]);
  // words that name no column, or more than one: refused, the row left as written
  for (const [cols, keys] of [
    [
      ['↑', '↓', 'No change'],
      ['up', '↓', '↓'],
    ],
    [
      ['No change', 'no change.', '↑'],
      ['NO CHANGE', '↑', '↑'],
    ],
  ]) {
    const q = grid(cols, keys);
    assert.equal(usable(q), false, JSON.stringify(keys));
    assert.equal(keyed(q)[0], keys[0], 'the unreadable row is left as written, never keyed to a column');
  }
  // a key whose own symbol contradicts the one choice its words name is refused (the review's inputs), as an option
  // and as a matrix row
  const single = (options, correct) =>
    N({ type: 'single', stem: stem(1), options, correct, rationales: options.map(() => 'why'), cjStep: 'take-action' });
  for (const [options, correct] of [
    [['↑ potassium', 'No change'], ['↓ potassium']],
    [['Rh-', 'Unknown'], ['Rh+']],
    [['< 0.5 mL/kg/h', 'Normal'], ['> 0.5 mL/kg/h']],
  ]) {
    const q = single(options, correct);
    assert.deepEqual(q.correct, correct, JSON.stringify(correct));
    assert.equal(EV.validateItem({ ...q, id: 'x' }).ok, false, JSON.stringify(correct));
    assert.equal(usable(grid(options, [correct[0], options[1], options[1]])), false, 'matrix ' + correct[0]);
  }
});

test('B-453: a numeric answer or tolerance written as a string becomes the number it says', () => {
  const N = EV.practiceReply.normalizeItem;
  const dose = {
    type: 'numeric',
    topic: 'dosage',
    stem: 'Give 250 mg from a supply of 125 mg per 5 mL. Round to the tenth. How many mL?',
    unit: 'mL',
    steps: ['250 / 125 x 5 = 10'],
    cjStep: 'take-action',
  };
  const q = N({ ...dose, answer: ' 10 ', tolerance: '0.05' });
  assert.equal(q.answer, 10);
  assert.equal(q.tolerance, 0.05);
  assert.ok(EV.validateItem({ ...q, id: 'x' }).ok);
  assert.ok(EV.scoreAnswer(q, '10 mL').correct);
  // what is not a number is left as written, and refused
  const bad = N({ ...dose, answer: 'about 10', tolerance: 'half' });
  assert.equal(bad.answer, 'about 10');
  assert.equal(EV.validateItem({ ...bad, id: 'x' }).ok, false);
  // only a numeric item's answer is read as a number
  assert.equal(N({ type: 'open', answer: '10' }).answer, '10');
});

test('B-455: an item is held to its candidate objectives; a planted dosage miss proposes a spot with a known one', () => {
  const W = EV.practiceReply.withObjective;
  // kept when it is a candidate, the only candidate when there is exactly one, else left off
  assert.equal(W({ objective: 'D1-2' }, ['D1-1', 'D1-2']).objective, 'D1-2');
  assert.equal(W({ objective: 'E4-3' }, ['D1-1']).objective, 'D1-1');
  assert.equal(W({}, ['D1-1']).objective, 'D1-1');
  assert.equal('objective' in W({ objective: 'E4-3' }, ['D1-1', 'D1-2']), false);
  assert.equal('objective' in W({ objective: 'E4-3' }, []), false);
  // a dosage reply with no objective (its prompt used to say "objective (or omit)"), its exam's one objective the
  // candidate, missed: the proposed spot carries that objective, so Accept is on
  const exams = [{ id: 'D1', course: 'NUR 112', title: 'Dosage exam', kind: 'dosage', date: '2026-11-05' }];
  const objectives = [{ id: 'D1-1', exam: 'D1', text: 'Calculate oral and liquid doses' }];
  const reply = {
    items: [
      {
        type: 'numeric',
        topic: 'Liquid dose',
        stem: 'Give 250 mg from a supply of 125 mg per 5 mL. Round to the tenth. How many mL?',
        answer: '10',
        unit: 'mL',
        tolerance: 0.05,
        steps: ['250 / 125 x 5 = 10'],
        calc: { dose: 250, doseUnit: 'mg', stockAmount: 125, stockUnit: 'mg', stockMl: 5 }, // B-481
        cjStep: 'take-action',
        sourceRef: 'materials/dose-handout',
      },
    ],
  };
  // the page's own steps (moreDosage): its candidates, then its tagging
  const cands = EV.practiceReply.candidateObjectives({ exam: exams[0], course: 'NUR 112', objectives, exams });
  const [item] = EV.practiceReply.tagItems(
    { items: reply.items.map(q => ({ ...q, weakspotId: 'ws-anything' })) },
    { ids: cands.map(o => o.id), checks: true, type: 'numeric' }
  );
  assert.equal(item.kind, 'check');
  assert.equal('weakspotId' in item, false, 'a dosage set holds new checks only');
  assert.ok(EV.validateItem(item).ok);
  const set = { id: 'more-2026-10-28-1', kind: 'more', exam: 'D1', items: [item] };
  const r = EV.planAnswer({ set, item, chosen: '12 mL', now: '2026-10-28T15:00:00Z', weakspots: [], exams });
  assert.equal(r.correct, false);
  const made = r.writes.find(w => w.collection === 'weakspots');
  assert.ok(made, JSON.stringify(r.writes.map(w => w.collection)));
  assert.equal(made.data.objective, 'D1-1');
  assert.ok(
    objectives.some(o => o.id === made.data.objective),
    'a known objective: Accept is on'
  );
});

test('B-455 (review): the candidates each prompt gets, and the general path tags a spot-aimed item from its spot or them', () => {
  const C = EV.practiceReply.candidateObjectives;
  const exams = [
    { id: 'E4', course: 'NUR 112', kind: 'unit', date: '2026-11-02' },
    { id: 'E5', course: 'NUR 112', kind: 'unit', date: '2026-11-20' },
    { id: 'D1', course: 'NUR 112', kind: 'dosage', date: '2026-11-05' },
    { id: 'BX3', course: 'BIO 201', kind: 'unit', date: '2026-10-30' },
  ];
  const objectives = [
    { id: 'E4-1', exam: 'E4' },
    { id: 'E4-2', exam: 'E4' },
    { id: 'BX3-1', exam: 'BX3' },
  ];
  const ids = ctx => C({ objectives, exams, ...ctx }).map(o => o.id);
  // the exam's own; an exam with none falls to its course's (D1 and E5 have none: NUR 112's); a course alone, its
  // own; no exam and no course, every one; a course with none, none
  assert.deepEqual(ids({ exam: exams[0], course: 'NUR 112' }), ['E4-1', 'E4-2']);
  assert.deepEqual(ids({ exam: exams[2], course: 'NUR 112' }), ['E4-1', 'E4-2']);
  assert.deepEqual(ids({ exam: exams[1], course: 'nur112' }), ['E4-1', 'E4-2']);
  assert.deepEqual(ids({ course: 'BIO 201' }), ['BX3-1']);
  assert.deepEqual(ids({}), ['E4-1', 'E4-2', 'BX3-1']);
  assert.deepEqual(ids({ course: 'NUR 113' }), []);
  // the general path's tagging (morePractice): the review's input, a spot with no objective and an item naming an
  // objective the record lacks: never written as given
  const T = (items, spots, cands) => EV.practiceReply.tagItems({ items }, { ids: cands, spots });
  const q = { type: 'single', stem: 'Which finding needs action first?', options: ['a', 'b'], correct: [0] };
  const spots = [
    { id: 'ws-1', objective: '' },
    { id: 'ws-2', objective: 'E4-2' },
  ];
  let [a, b, c, d] = T(
    [
      { ...q, weakspotId: 'ws-1', objective: 'E9-9' },
      { ...q, weakspotId: 'ws-2', objective: 'E9-9' },
      { ...q, weakspotId: 'ws-gone', objective: 'E4-1' },
      { ...q, objective: 'E9-9' },
    ],
    spots,
    ['E4-1', 'E4-2']
  );
  assert.equal('objective' in a, false, 'E9-9 is not written: two candidates, none named');
  assert.deepEqual([a.weakspotId, a.kind], ['ws-1', 'review']);
  assert.deepEqual([b.objective, b.kind], ['E4-2', 'review'], "a spot's own objective");
  assert.deepEqual([c.objective, 'weakspotId' in c, c.kind], ['E4-1', false, 'check'], 'an unknown spot id left off');
  assert.equal('objective' in d, false);
  [a] = T([{ ...q, weakspotId: 'ws-1', objective: 'E9-9' }], spots, ['E4-1']);
  assert.equal(a.objective, 'E4-1', 'the one candidate');
  assert.deepEqual(
    T([{ ...q, weakspotId: 'ws-1', objective: 'E4-2' }], spots, ['E4-1', 'E4-2']).map(x => x.objective),
    ['E4-2']
  );
  assert.deepEqual(
    T([q, q], [], []).map(x => x.id),
    ['m1', 'm2']
  );
});

test('B-624: a planted bad sourceRef is left off the item, so the set still fits its shape; a valid one stays', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/schemas/sets.schema.json'), 'utf8'));
  const base = { type: 'single', topic: 'a', options: opts, correct: [0], rationales: why, cjStep: 'analyze-cues' };
  const items = EV.practiceReply.tagItems({
    items: [
      { ...base, stem: stem(1), sourceRef: 'BIO 201 slides, chapter 3' },
      { ...base, stem: stem(2), sourceRef: 'materials/bio-ch3' },
      { ...base, stem: stem(3), sourceRef: 'note/n1#line' },
    ],
  });
  assert.equal(items.length, 3);
  assert.equal('sourceRef' in items[0], false, 'the bad ref is left off');
  assert.equal(items[1].sourceRef, 'materials/bio-ch3');
  assert.equal(items[2].sourceRef, 'note/n1#line');
  const refSchema = JSON.stringify(schema).match(/"\^\(materials\|note\)\/[^"]*"/);
  assert.ok(refSchema, 'the sets schema still holds the pattern, unchanged');
  const re = new RegExp(JSON.parse(refSchema[0]));
  for (const q of items) assert.ok(q.sourceRef === undefined || re.test(q.sourceRef));
  const page = fs.readFileSync(path.join(ROOT, 'page/app/20-study.js'), 'utf8');
  assert.match(page, /always starts with materials\/ or note\//, 'the prompt names the ref shape');
  assert.match(
    page,
    /does not fit its shape\/\.test\(msg\) \? 'shape'/,
    'a shape refusal shows "shape", not "(Error)"'
  );
});
