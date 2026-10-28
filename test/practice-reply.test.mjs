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
