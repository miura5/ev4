// E.V. core's skills practice (B-158, split from core.test.mjs with their sections) and
// the Quizlet cards from weak spots. The skills runs themselves are tested in features.test.mjs. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';

test('B-41: weakspotCards turns open concept weak spots into one-line Quizlet cards with the last rationale missed', () => {
  const at = '2026-10-16T14:00:00Z';
  const ws = (id, extra = {}) => ({
    id,
    schema: 1,
    writer: 'page',
    at,
    source: 't',
    topic: 'Made-up\ttopic ' + id,
    objective: 'E4-7',
    exam: 'E4',
    course: 'NUR 112',
    kind: 'concept',
    addedBy: 't',
    initial: { streak: 0, nextDue: '2026-10-17', recurrence: 1, misses: 0 },
    events: {},
    ...extra,
  });
  const sets = [
    {
      id: 'review-2026-10-16',
      kind: 'review',
      date: '2026-10-16',
      items: [
        {
          id: 'q1',
          kind: 'review',
          weakspotId: 'a',
          objective: 'E4-7',
          topic: 't',
          type: 'single',
          stem: 'Made-up stem?',
          options: ['Wrong', 'Right\nanswer'],
          correct: [1],
          rationales: ['No.', 'Because of the\tmade-up reason.'],
        },
      ],
    },
  ];
  const answers = [
    {
      id: 'review-2026-10-16',
      setId: 'review-2026-10-16',
      answers: {
        q1: { 'page-20261016-150000000': { chosen: [0], correct: false, score: 0, at: '2026-10-16T15:00:00Z' } },
      },
    },
  ];
  const models = EV.buildWeakspots({
    weakspots: [ws('a'), ws('b'), ws('n', { kind: 'note' })],
    sets,
    answers,
    exams: [{ id: 'E4', date: '2026-10-21', course: 'NUR 112', kind: 'unit', status: 'upcoming' }],
  });
  const cards = EV.weakspotCards({
    weakspots: models,
    objectives: [{ id: 'E4-7', exam: 'E4', text: 'Describe made-up drug classes' }],
    sets,
    answers,
  });
  assert.deepEqual(
    cards.map(c => c.term),
    ['Made-up topic a', 'Made-up topic b'],
    'concept weak spots only, tabs flattened'
  );
  assert.equal(
    cards[0].definition,
    'E4-7: Describe made-up drug classes · Answer: Right answer. Because of the made-up reason.'
  );
  assert.equal(cards[1].definition, 'E4-7: Describe made-up drug classes');
  assert.ok(
    EV.cardsText(cards)
      .split('\n')
      .every(l => l.split('\t').length === 2)
  );
});
