// B-43 (D-100): dosage practice. A numeric item scores right within its tolerance of its answer when any unit given is
// its unit; it validates only with a number answer, a unit from spec.items.units and its worked steps; the sets schema
// bump that admits it. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import { migrateBumps, applyWrites } from '../core/migrate.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator(path.join(ROOT, 'spec', 'schemas'));

const num = (o = {}) => ({
  id: 'n1',
  kind: 'drill',
  type: 'numeric',
  stem: 'Order: a made-up drug 250 mg by mouth. On hand: 125 mg per 5 mL. How many mL do you give?',
  answer: 10,
  unit: 'mL',
  tolerance: 0,
  steps: ['Desired over have: 250 mg / 125 mg = 2', '2 x 5 mL = 10 mL'],
  objective: 'D1-1',
  topic: 'Liquid oral doses',
  cjStep: 'take-action',
  sourceRef: 'materials/made-up-dosage',
  ...o,
});

test('a numeric item scores right at its answer and wrong a hair off, with no tolerance', () => {
  const q = num();
  assert.deepEqual(EV.scoreAnswer(q, { value: 10, unit: 'mL' }), { correct: true, score: 1 });
  assert.deepEqual(EV.scoreAnswer(q, 10), { correct: true, score: 1 });
  assert.equal(EV.scoreAnswer(q, 10.01).correct, false);
  assert.equal(EV.scoreAnswer(q, 9.99).correct, false);
});

test('at the tolerance edge: inside and on it is right, past it is wrong (rounding to the tenth: 0.05)', () => {
  const q = num({ answer: 1.3, tolerance: 0.05, unit: 'mL' });
  for (const v of [1.3, 1.25, 1.35, 1.27, 1.33]) assert.equal(EV.scoreAnswer(q, v).correct, true, String(v));
  for (const v of [1.24, 1.36, 1.2, 1.4]) assert.equal(EV.scoreAnswer(q, v).correct, false, String(v));
  // Floating point does not move the edge: 0.1 + 0.2 style sums still land on it.
  assert.equal(EV.scoreAnswer(num({ answer: 0.3, tolerance: 0.1 }), 0.1 + 0.1).correct, true);
  // gtt/min rounded to the whole drop (tolerance 0.5).
  const drip = num({ answer: 21, tolerance: 0.5, unit: 'gtt/min' });
  assert.equal(EV.scoreAnswer(drip, 20.5).correct, true);
  assert.equal(EV.scoreAnswer(drip, 21.6).correct, false);
});

test('the unit must match when one is given; none given is the item unit; spelling and case do not matter', () => {
  const q = num({ answer: 2, unit: 'tablets' });
  assert.equal(EV.scoreAnswer(q, { value: 2, unit: 'Tablets' }).correct, true);
  assert.equal(EV.scoreAnswer(q, '2 tablets').correct, true);
  assert.equal(EV.scoreAnswer(q, '2').correct, true);
  assert.equal(EV.scoreAnswer(q, { value: 2, unit: 'mL' }).correct, false, 'right number, wrong unit');
  assert.equal(EV.scoreAnswer(q, '2 mg').correct, false);
  assert.equal(EV.scoreAnswer(num({ unit: 'mL/hr', answer: 125 }), '125 mL / hr').correct, true);
  // Nothing usable given is wrong, never an error.
  for (const g of [null, '', 'ten', { value: 'x' }, NaN, []]) assert.equal(EV.scoreAnswer(q, g).correct, false);
  assert.equal(EV.unitOf('ML'), 'mL');
  assert.equal(EV.unitOf('furlongs'), null);
});

test('a numeric item validates only with a number answer, a known unit, a tolerance of 0 or more and its steps', () => {
  assert.deepEqual(EV.validateItem(num(), { strict: true }).errors, []);
  assert.equal(EV.itemType(num()), 'numeric');
  const bad = {
    'a number answer': { answer: '10' },
    unit: { unit: 'scoops' },
    tolerance: { tolerance: -1 },
    'its worked steps': { steps: [] },
    'no options': { options: ['a', 'b'], correct: [0] },
  };
  for (const [why, o] of Object.entries(bad)) {
    const v = EV.validateItem(num(o), { strict: true });
    assert.equal(v.ok, false, why);
  }
  // It fits the sets schema at this build's version (2 since B-43, 3 since B-75).
  const set = {
    schema: 3,
    writer: 'morning',
    at: '2026-10-20T09:31:00Z',
    source: 'morning 4:25',
    kind: 'drill',
    title: 'Dosage drill',
    items: [num()],
    createdAt: '2026-10-20T09:31:00Z',
  };
  assert.ok(validate('sets', set, { id: 'D1-dosage-2026-10-20' }).ok);
});

test('the sets 1 to 2 bump (chained to 3 by B-75) matches its fixture, keeps every item as it was, validates and is idempotent', () => {
  const load = d => {
    const db = {};
    for (const { collection, id, doc } of readExport(d)) (db[collection] = db[collection] || []).push({ ...doc, id });
    return db;
  };
  const dir = path.join(ROOT, 'test/data/bumps/sets-1');
  const before = load(path.join(dir, 'before')),
    after = load(path.join(dir, 'after'));
  const r = migrateBumps(before, { at: '2026-10-20T23:00:00Z' });
  const got = {};
  for (const w of r.writes) (got[w.collection] = got[w.collection] || []).push({ ...w.data, id: w.id });
  const sorted = l => (l || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const [c, docs] of Object.entries(after))
    assert.equal(EV.stableStringify(sorted(got[c])), EV.stableStringify(sorted(docs)), c);
  for (const w of r.writes) assert.ok(validate(w.collection, w.data, { id: w.id }).ok, `${w.collection}/${w.id}`);
  assert.deepEqual(got.sets[0].items, before.sets[0].items);
  assert.deepEqual(migrateBumps(applyWrites(before, r.writes), { at: '2026-10-21T23:00:00Z' }).writes, []);
});
