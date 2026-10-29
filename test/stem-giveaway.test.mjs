// B-500: no question shown in the Mini quiz, or any runner, carries its answer or its worked solution in the stem.
// B-481's written-key check (answerKeyProblem) holds new questions as they are written; a stored one is held to its
// stem part (stemGivesAway) wherever a set's questions are read for showing (EVCore.validItems, which the Mini quiz's
// one-answer list is drawn from). Made-up questions.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import './core-fixtures.mjs';

const P = EV.practiceReply;
const q = x => ({
  id: 'q1',
  kind: 'check',
  type: 'single',
  topic: 'Dosage',
  cjStep: 'take-action',
  stem: 'Ordered: cephalexin 25 mg/kg/day divided every 6 hours for a 15 kg child. How many mg per dose?',
  options: ['93.8 mg', '375 mg', '62.5 mg', '150 mg'],
  correct: [0],
  rationales: ['375 mg a day over 4 doses.', 'That is the daily dose.', 'No.', 'No.'],
  ...x,
});

test('B-500: a stem that says its answer, holds a worked solution or repeats its key is caught', () => {
  const leaks = [
    q({ stem: q().stem + ' (Answer: 93.8 mg.)' }),
    q({ stem: 'How many mg per dose for a 15 kg child at 25 mg/kg/day q6h? Each dose = 93.8 mg' }),
    q({ stem: 'Which dose is right? The correct answer is 93.8 mg.' }),
    q({ stem: 'Which dose is right for a 15 kg child? Solution: 25 x 15 = 375; 375 / 4.' }),
    q({
      stem: 'Which vitamin is needed to build collagen? (Vitamin C)',
      options: ['Vitamin C', 'Vitamin A', 'Vitamin D', 'Vitamin K'],
    }),
  ];
  for (const x of leaks) {
    assert.equal(P.stemGivesAway(x), 'its stem gives its answer away', x.stem);
    assert.ok(P.answerKeyProblem(x), 'the writer’s check refuses it too: ' + x.stem);
  }
});

test('B-500: a fair stem is kept, a lab value or a statement stem included', () => {
  const fair = [
    q(),
    q({
      stem: 'A client’s potassium = 5.8 mEq/L. Which finding needs action first?',
      options: ['Peaked T waves', 'Thirst', 'Dry skin', 'Fatigue'],
    }),
    q({
      stem: 'The nurse caring for a client with a slow-healing wound should first assess',
      options: ['Vitamin C intake', 'Hair color', 'Shoe size', 'Height'],
    }),
    q({
      stem: 'Which vitamin is needed to build collagen? Choose one.',
      options: ['Vitamin C', 'One', 'Vitamin D', 'Vitamin K'],
      correct: [0],
    }),
    { id: 'o1', type: 'open', stem: 'Answer: in two lines, why does vitamin C matter for healing?', keyPoints: ['x'] },
  ];
  for (const x of fair) assert.equal(P.stemGivesAway(x), null, x.stem);
});

test('B-500: a set’s questions as every runner reads them leave out the one that gives its answer away', () => {
  const set = {
    id: 'more-2026-10-29-1',
    kind: 'more',
    items: [q({ id: 'm1' }), q({ id: 'm2', stem: q().stem + ' (Answer: 93.8 mg.)' })],
  };
  assert.deepEqual(
    EV.validItems(set).map(x => x.id),
    ['m1']
  );
  // the Mini quiz draws its one-answer questions from these
  assert.deepEqual(
    EV.validItems(set)
      .filter(x => EV.itemType(x) === 'single')
      .map(x => x.id),
    ['m1']
  );
});
