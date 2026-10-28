// B-450: the phone toolbar check is row-aware; wrapping passes, overlap, clipping and overflow fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { rowProblems } = createRequire(import.meta.url)('./harness/rows.cjs');

const b = (id, l, r, top, extra = {}) => ({ id, l, r, top, bottom: top + 32, clip: false, shown: true, ...extra });
const oneRow = () => [b('quiz', 12, 120, 100), b('weak', 128, 250, 100), b('start', 258, 378, 100)];
// Nightly 40763305576 on CI's fonts: Start session wrapped onto its own full-width row.
const wrapped = () => [b('quiz', 12, 155, 100), b('weak', 163, 378, 100), b('start', 12, 378, 140)];

test('three buttons on one row with gaps pass', () => assert.deepEqual(rowProblems(oneRow()), []));
test('Start session on its own second row passes (CI fonts)', () => assert.deepEqual(rowProblems(wrapped()), []));
test('a top a pixel off still counts as the same row', () => {
  const x = oneRow();
  x[2].top = 101;
  assert.deepEqual(rowProblems(x), []);
});
test('overlap on one row fails', () => {
  const x = oneRow();
  x[1].l = 110;
  assert.match(rowProblems(x).join(), /quiz and weak less than 4 px apart/);
});
test('a gap under 4 px on one row fails', () => {
  const x = oneRow();
  x[1].l = 122;
  assert.match(rowProblems(x).join(), /less than 4 px/);
});
test('a clipped button fails, even when wrapped', () => {
  const x = wrapped();
  x[2].clip = true;
  assert.match(rowProblems(x).join(), /start clipped/);
});
test('a button past the 390 viewport fails', () => {
  const x = oneRow();
  x[2].r = 400;
  assert.match(rowProblems(x).join(), /outside the 390/);
});
test('a hidden button fails', () => {
  const x = oneRow();
  x[0].shown = false;
  assert.match(rowProblems(x).join(), /quiz not shown/);
});
test('a second row overlapping the first fails', () => {
  const x = wrapped();
  x[2].top = 120;
  assert.match(rowProblems(x).join(), /overlaps the row above/);
});
