// B-192: answer options and matrix rows are shown in a seeded order: the set's id and each item's id, never its place;
// the same on every reload and after a rebuild; answers stay keyed by item id and the item's own indices; across a
// set's single-answer items no three in a row show the right answer at the same place or at places stepping by one,
// and a matrix's rows never run down the right columns. A planted ROME-style set throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));

const ABG = ['Respiratory acidosis', 'Respiratory alkalosis', 'Metabolic acidosis', 'Metabolic alkalosis'];
// Written the way the ROME set came out: question n's right answer is option n (A, B, C, D), and the matrix's rows run
// 1, 2, 3, 4 down its columns.
const single = (n, x = {}) => ({
  id: 'rome-' + n,
  kind: 'check',
  type: 'single',
  objective: 'E4-3',
  topic: 'ROME',
  stem: `ABG ${n}: pH and values given. Which imbalance is it?`,
  options: [...ABG],
  correct: [n - 1],
  rationales: ABG.map(a => a + '.'),
  ...x,
});
const matrix = {
  id: 'rome-mx',
  kind: 'check',
  type: 'matrix',
  objective: 'E4-3',
  topic: 'ROME',
  stem: 'Match each ABG to its imbalance.',
  matrix: {
    columns: [...ABG],
    rows: ABG.map((a, i) => ({ text: 'ABG row ' + (i + 1), correct: i, rationale: a + '.' })),
  },
};
const SET = { id: 'job-20261021-rome', kind: 'job', items: [single(1), single(2), single(3), single(4), matrix] };

// The run rule, restated here so the test does not lean on the code's own: three in a row at one place or stepping by one.
const runs = seq =>
  seq.slice(2).filter((x, i) => {
    const a = seq[i + 1] - seq[i],
      b = x - seq[i + 1];
    return a === b && Math.abs(a) <= 1;
  }).length;
const shownRight = (set, order) =>
  set.items.filter(q => q.type === 'single').map(q => order[q.id].options.indexOf(q.correct[0]));

test('B-192: every option and every row is shown once, and the stored items are untouched', () => {
  const before = JSON.stringify(SET);
  const order = EV.displayOrder(SET, SET.items);
  for (const q of SET.items.filter(q => q.type === 'single'))
    assert.deepEqual([...order[q.id].options].sort(), [0, 1, 2, 3], q.id);
  assert.deepEqual([...order['rome-mx'].rows].sort(), [0, 1, 2, 3]);
  assert.equal(JSON.stringify(SET), before, 'nothing is remapped: answers stay keyed by item id and its own indices');
});

test('B-192: the ROME set no longer runs A, B, C, D or 1, 2, 3, 4', () => {
  const order = EV.displayOrder(SET, SET.items);
  const seq = shownRight(SET, order);
  assert.equal(runs(seq), 0, 'right answers at ' + seq);
  assert.notDeepEqual(seq, [0, 1, 2, 3]);
  const mx = order['rome-mx'].rows.map(i => matrix.matrix.rows[i].correct);
  assert.equal(runs(mx), 0, 'matrix right columns down the rows: ' + mx);
  // Over many sets the rule holds wherever it can (four options, a run of three is always avoidable).
  for (let k = 0; k < 200; k++) {
    const s = { ...SET, id: 'set-' + k };
    assert.equal(runs(shownRight(s, EV.displayOrder(s, s.items))), 0, s.id);
  }
});

test('B-192: the same order on every reload and after a rebuild; seeded by the set and item ids, never the place', () => {
  const a = EV.displayOrder(SET, SET.items);
  const b = EV.displayOrder(JSON.parse(JSON.stringify(SET)), JSON.parse(JSON.stringify(SET.items)));
  assert.deepEqual(a, b, 'a fresh copy (a reload, a rebuild) gives the same order');
  // A lone item keeps its order wherever it sits: its seed is its ids, not its index.
  const lone = { id: SET.id, items: [single(3)] };
  const moved = { id: SET.id, items: [matrix, single(3)] };
  assert.deepEqual(
    EV.displayOrder(lone, lone.items)['rome-3'],
    EV.displayOrder(moved, moved.items)['rome-3'],
    'moving an item to another place does not change its order'
  );
  const other = { ...SET, id: 'job-20261022-rome' };
  assert.notDeepEqual(EV.displayOrder(other, other.items), a, 'another set shuffles its own way');
});

test('B-192: numeric and open items have no order; select-all is shuffled without the run rule', () => {
  const s = {
    id: 'mixed',
    items: [
      { id: 'n1', type: 'numeric', stem: 'A dose', answer: 2, unit: 'mL', steps: ['x'] },
      { id: 'o1', type: 'open', stem: 'Explain', keyPoints: [] },
      { id: 's1', type: 'sata', stem: 'Select all', options: ['a', 'b', 'c', 'd', 'e'], correct: [0, 2] },
    ],
  };
  const o = EV.displayOrder(s, s.items);
  assert.equal(o.n1, undefined);
  assert.equal(o.o1, undefined);
  assert.deepEqual([...o.s1.options].sort(), [0, 1, 2, 3, 4]);
});
