// B-481: a written question's key held to its own numbers and rationale before it is shown; B-480: a practice set
// topped up once to the count asked, and its header line when it still falls short.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import * as J from '../pwa/jobs.mjs';
import { jobReply } from '../pwa/job-stub.mjs';
import { seedRecord } from '../pwa/seed.mjs';
import { loadSchemas } from '../core/schemas.mjs';
import { askedCount } from '../core/steps-worker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const schemas = loadSchemas();
const NOW = new Date('2026-10-25T15:00:00Z');

const base = { type: 'single', topic: 'pediatric dosing', cjStep: 'take-action', verify: true };
// Oct 28, live: 20 kg, 15 mg/kg/day divided every 12 hours; the single dose is 150 mg
const q12 = (correct, rationales) => ({
  ...base,
  stem: 'A child weighs 20 kg. The order is 15 mg/kg/day divided every 12 hours. What is the single dose?',
  options: ['75 mg', '300 mg', '37.5 mg', '150 mg'],
  correct: [correct],
  rationales: rationales || [
    'Divides by 4, not 2.',
    'That is the whole day.',
    'Divides by 8.',
    'Correct: 20 × 15 = 300 mg/day, ÷ 2 = 150 mg.',
  ],
  calc: { weightKg: 20, dosePerKg: 15, per: 'day', everyHours: 12, doseUnit: 'mg' },
});
// Oct 28, live: 14 kg, 25 mg/kg/day q8h, 100 mg per 5 mL: 116.7 mg a dose, 5.83 mL; no option offered it
const q8 = {
  ...base,
  stem: 'A 14 kg child needs 25 mg/kg/day divided every 8 hours. The stock is 100 mg/5 mL. How many mL per dose?',
  options: ['0.7 mL', '2.5 mL', '1.5 mL', '4.2 mL'],
  correct: [1],
  rationales: ['No.', '350 mg/day ÷ 3 = 116.7 mg; 116.7 ÷ 100 × 5 = 5.8 mL.', 'No.', 'No.'],
  calc: { weightKg: 14, dosePerKg: 25, per: 'day', dosesPerDay: 3, stockAmount: 100, stockUnit: 'mg', stockMl: 5 },
};

test('B-481: the 20 kg, 15 mg/kg/day q12h item keyed 150 mg is kept; keyed 75 mg it is dropped', () => {
  assert.deepEqual(EV.practiceReply.calcAnswer(q12(3).calc), { value: 150, unit: 'mg' });
  assert.equal(EV.practiceReply.answerKeyProblem(q12(3)), null);
  assert.match(EV.practiceReply.answerKeyProblem(q12(0)), /key is not the worked answer \(150 mg\)/);
});

test('B-481: the 14 kg, 25 mg/kg/day q8h, 100 mg/5 mL item is dropped: no option is 5.83 mL', () => {
  assert.ok(Math.abs(EV.practiceReply.calcAnswer(q8.calc).value - 5.8333) < 0.001);
  assert.match(EV.practiceReply.answerKeyProblem(q8), /no option is the worked answer \(5\.83 mL\)/);
  // with 5.8 mL among the options and keyed, it holds
  const fixed = { ...q8, options: ['0.7 mL', '5.8 mL', '1.5 mL', '4.2 mL'] };
  assert.equal(EV.practiceReply.answerKeyProblem(fixed), null);
});

test('B-481: a rationale that contradicts its key drops the item', () => {
  const said = [
    '300 mg / 2 = 150 mg, so 75 mg is wrong for this order.',
    'That is the whole day.',
    'Divides by 8.',
    'Close, but not the key.',
  ];
  // no calc to work, yet its own rationale says the key is wrong
  const { calc, ...plain } = q12(0, said);
  assert.match(EV.practiceReply.answerKeyProblem(plain), /the key’s own rationale calls it wrong/);
  // the same words under a distractor still name the key wrong
  assert.equal(
    EV.practiceReply.answerKeyProblem({ ...plain, rationales: ['Yes.', said[0], said[2], said[3]] }),
    'a rationale says the key is wrong'
  );
  const concept = {
    ...base,
    stem: 'Which finding fits fluid volume deficit in an adult client?',
    options: ['Tachycardia', 'Bradycardia', 'Weight gain', 'Crackles'],
    correct: [1],
    rationales: ['Wait, this is the right one.', 'Right.', 'No.', 'No.'],
  };
  assert.equal(EV.practiceReply.answerKeyProblem(concept), 'a rationale corrects itself');
  const names = {
    ...concept,
    rationales: ['Yes.', 'The correct answer is tachycardia, since the heart speeds up.', 'No.', 'No.'],
  };
  assert.equal(EV.practiceReply.answerKeyProblem(names), 'a rationale names another option as the answer');
  assert.equal(
    EV.practiceReply.answerKeyProblem({ ...concept, correct: [0], rationales: ['Right.', 'No.', 'No.', 'No.'] }),
    null
  );
});

test('B-481: a calculation with no calc is not trusted; rates, drops and conversions are worked', () => {
  const { calc, ...bare } = q12(3);
  assert.equal(EV.practiceReply.answerKeyProblem(bare), 'a calculation with no calc to check its key');
  assert.deepEqual(EV.practiceReply.calcAnswer({ volumeMl: 1000, hours: 8 }), { value: 125, unit: 'ml/hr' });
  assert.equal(
    Math.round(EV.practiceReply.calcAnswer({ volumeMl: 1000, hours: 8, dropFactor: 10 }).value * 10) / 10,
    20.8
  );
  assert.equal(EV.practiceReply.calcAnswer({ value: 44, from: 'lb', to: 'kg' }).value, 20);
  assert.equal(EV.practiceReply.calcAnswer({ value: 0.25, from: 'mg', to: 'mcg' }).value, 250);
  const drip = {
    ...base,
    stem: 'Infuse 1,000 mL over 8 hours with a drop factor of 10 gtt/mL. How many gtt/min?',
    options: ['21 gtt/min', '125 gtt/min', '13 gtt/min', '42 gtt/min'],
    correct: [0],
    rationales: ['1000 × 10 ÷ 480 = 20.8, so 21.', 'mL/hr.', 'No.', 'No.'],
    calc: { volumeMl: 1000, hours: 8, dropFactor: 10 },
  };
  assert.equal(EV.practiceReply.answerKeyProblem(drip), null);
  const numeric = {
    ...base,
    type: 'numeric',
    stem: 'Give 250 mg from a stock of 125 mg per 5 mL. How many mL? Round to tenths.',
    answer: 10,
    unit: 'mL',
    tolerance: 0.05,
    steps: ['250 ÷ 125 × 5 = 10 mL'],
    calc: { dose: 250, doseUnit: 'mg', stockAmount: 125, stockUnit: 'mg', stockMl: 5 },
  };
  assert.equal(EV.practiceReply.answerKeyProblem(numeric), null);
  assert.match(EV.practiceReply.answerKeyProblem({ ...numeric, answer: 5 }), /not the worked 10/);
  // a conceptual question that only mentions a dose is no calculation
  const words = {
    ...base,
    stem: 'The order reads 15 mg/kg/day. What should the nurse check before giving it?',
    options: ['The client’s weight', 'The client’s height', 'The room number', 'The diet order'],
    correct: [0],
    rationales: ['Right.', 'No.', 'No.', 'No.'],
  };
  assert.equal(EV.practiceReply.answerKeyProblem(words), null);
});

test('B-480: the count asked comes from the title or brief, else the count written', () => {
  assert.equal(askedCount({ title: '10 weight-based dose problems' }, 9), 10);
  assert.equal(askedCount({ title: 'Chapter 39 questions' }, 12), 12);
  assert.equal(askedCount({ title: 'Practice', brief: '5 questions on burns' }, 7), 5);
});

function job(title) {
  const db = J.asRunDb(seedRecord(NOW));
  const id = 'job-test-dose';
  db.jobs = [
    ...(db.jobs || []),
    {
      id,
      schema: 2,
      writer: 'page',
      at: NOW.toISOString(),
      source: 'E.V. Home',
      kind: 'practice-set',
      title,
      brief: '',
    },
  ];
  return { db, id };
}
const good = n => ({ ...q12(3), stem: `Case ${n}: ` + q12(3).stem });
const answered = items => ({
  content: [{ type: 'tool_use', name: 'answer', id: 't', input: { text: 'Here they are.', items } }],
});

async function runWith(title, replies) {
  const { db, id } = job(title);
  const asks = [];
  const writes = [];
  const r = await J.runJob({
    db,
    spec,
    schemas,
    jobId: id,
    now: NOW,
    release: 'v4.5.5+1',
    ask: async body => (asks.push(body), replies[asks.length - 1] || jobReply(body)),
    write: async w => writes.push(w),
  });
  const set = writes.flat().find(w => w.collection === 'sets');
  return { r, asks, set };
}

test('B-480: dropped questions are replaced by one more ask for the missing count', async () => {
  const first = [good(1), good(2), q12(0), q8];
  const { asks, set } = await runWith('4 weight-based dose problems', [answered(first), answered([good(3), good(4)])]);
  assert.equal(asks.length, 2, 'one top-up ask');
  const line = asks[1].messages[0].content;
  assert.match(line, /Write exactly 2 new questions on the same brief/);
  assert.equal(set.data.items.length, 4);
  assert.equal(set.data.asked, undefined, 'a full set names no shortfall');
  assert.ok(
    set.data.items.every(q => !q.calc),
    'calc is not stored'
  );
});

test('B-480: a set still short after its one top-up says so in its header', async () => {
  const { asks, set } = await runWith('4 weight-based dose problems', [
    answered([good(1), good(2), q12(0), q8]),
    answered([q12(0)]),
  ]);
  assert.equal(asks.length, 2, 'never a second top-up');
  assert.equal(set.data.items.length, 2);
  assert.equal(set.data.asked, 4);
  assert.equal(EV.practiceReply.setShortfall(set.data), '2 of 4: 2 didn’t pass E.V.’s checks');
  const full = await runWith('2 weight-based dose problems', [answered([good(1), good(2)])]);
  assert.equal(full.asks.length, 1, 'no top-up when every question passed');
});
