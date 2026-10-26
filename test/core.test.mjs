// E.V. core tests (B-05): every v3 rule with its test, ported to the v4 documents, plus a test for each split document
// (answers, dayedits, dateedits, planedits, materialedits) and a check that every write core emits validates against
// its collection's schema. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import EV from '../core/evcore.mjs';
import { spec, at, key, ev, ws, att, E4, assertValid } from './core-fixtures.mjs';

test('spec loads and the release lines up', () => {
  // B-149: core carries no release; the build writes it into the published core.js.
  assert.equal(EV.VERSION, '__EV_RELEASE__');
  assert.equal(EV.constants().review.flex.max, 15);
});

test('Central-time dates, including the daylight-saving change on Nov 1', () => {
  assert.equal(EV.chicagoDate('2026-10-17T04:46:32Z'), '2026-10-16'); // 11:46pm CDT
  assert.equal(EV.chicagoDate('2026-10-17T05:00:00Z'), '2026-10-17');
  assert.equal(EV.chicagoDate('2026-11-01T04:59:59Z'), '2026-10-31'); // still CDT
  assert.equal(EV.chicagoDate('2026-11-01T05:30:00Z'), '2026-11-01');
  assert.equal(EV.chicagoDate('2026-11-10T05:59:59Z'), '2026-11-09'); // CST, Canvas 11:59pm due
  assert.equal(EV.chicagoClock('2026-11-10T05:59:59Z'), '23:59');
  assert.equal(EV.chicagoDate('2026-10-17T00:51:05-05:00'), '2026-10-17');
  assert.equal(EV.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(EV.addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(EV.diffDays('2026-10-18', '2026-10-21'), 3);
  assert.equal(EV.shortDate('2026-10-18'), 'Sun 10/18');
});

test('v4 keys and hashes: compact times, writer-time keys read back, sha256 matches node', () => {
  assert.equal(EV.compactTime('2026-10-18T15:04:05.123Z'), '20261018-150405123');
  assert.equal(EV.eventKey('evening-cloud', '2026-10-18T01:15:00Z'), 'evening-cloud-20261018-011500000');
  assert.equal(EV.entryTime('evening-cloud-20261018-011500000', {}), '2026-10-18T01:15:00.000Z');
  assert.equal(EV.entryTime('page-20261018-011500', {}), '2026-10-18T01:15:00.000Z');
  assert.equal(EV.entryTime('x', { at: '2026-10-18T01:00:00Z' }), '2026-10-18T01:00:00Z');
  assert.equal(EV.entryTime('2026-10-16T15:00:00Z', {}), '2026-10-16T15:00:00Z', 'an ISO key still reads');
  for (const s of ['', 'abc', 'Hypokalemia — K⁺ < 3.5 mEq/L', 'x'.repeat(1000)])
    assert.equal(EV.sha256(s), crypto.createHash('sha256').update(s).digest('hex'), s.slice(0, 20));
  assert.deepEqual(EV.envelope('page', 'Told E.V.', '2026-10-18T01:00:00Z'), {
    schema: 1,
    writer: 'page',
    at: '2026-10-18T01:00:00.000Z',
    source: 'Told E.V.',
  });
});

test('question checks: single, select-all, matrix and the bad cases', () => {
  const single = {
    id: 'q1',
    type: 'single',
    objective: 'E4-3',
    cjStep: 'analyze-cues',
    stem: 'Which finding needs follow-up first?',
    options: ['A', 'B', 'C', 'D'],
    correct: [2],
    rationales: ['a', 'b', 'c', 'd'],
  };
  assert.ok(EV.validateItem(single, { strict: true }).ok);
  assert.ok(!EV.validateItem({ ...single, correct: [4] }).ok);
  assert.ok(!EV.validateItem({ ...single, correct: [0, 1] }).ok);
  assert.ok(
    !EV.validateItem({ ...single, stem: 'Select two findings that need follow-up.' }).ok,
    'select N is not allowed'
  );
  assert.ok(
    !EV.validateItem({ ...single, rationales: ['a'] }, { strict: true }).ok,
    'strict needs a rationale per option'
  );
  assert.ok(EV.validateItem({ ...single, rationales: ['a'] }).ok, 'non-strict only warns');
  assert.ok(!EV.validateItem({ ...single, cjStep: 'guessing' }).ok);
  assert.ok(
    !EV.validateItem({ ...single, options: ['A', 'a', 'C'], correct: [0], rationales: ['', '', ''] }).ok,
    'duplicate options'
  );
  const sata = {
    ...single,
    id: 'q2',
    type: 'sata',
    options: ['A', 'B', 'C', 'D', 'E'],
    correct: [0, 3],
    rationales: ['a', 'b', 'c', 'd', 'e'],
  };
  assert.ok(EV.validateItem(sata, { strict: true }).ok);
  assert.ok(!EV.validateItem({ ...sata, correct: [1] }).ok, 'select-all needs two or more');
  const matrix = {
    id: 'q3',
    type: 'matrix',
    objective: 'E4-3',
    cjStep: 'recognize-cues',
    stem: 'For each finding in an 80-year-old, mark expected or unexpected.',
    matrix: {
      columns: ['Expected', 'Unexpected'],
      rows: [
        { text: 'Thinner skin', correct: 0, rationale: 'r' },
        { text: 'New confusion', correct: 1, rationale: 'r' },
        { text: 'Slower reaction time', correct: 0, rationale: 'r' },
      ],
    },
  };
  assert.ok(EV.validateItem(matrix, { strict: true }).ok);
  assert.ok(
    !EV.validateItem({ ...matrix, matrix: { columns: ['E', 'U'], rows: matrix.matrix.rows.slice(0, 2) } }).ok,
    'matrix needs 3+ rows'
  );
  assert.ok(
    !EV.validateItem({
      ...matrix,
      matrix: {
        ...matrix.matrix,
        rows: [...matrix.matrix.rows.slice(0, 2), { text: 'x', correct: 3, rationale: 'r' }],
      },
    }).ok
  );
});

test('scoring: exact for single, +/- for select-all, per row for matrix', () => {
  const sata = { type: 'sata', options: ['A', 'B', 'C', 'D', 'E'], correct: [0, 2, 3] };
  assert.deepEqual(EV.scoreAnswer(sata, [3, 0, 2]), { correct: true, score: 1 });
  assert.equal(EV.scoreAnswer(sata, [0, 2]).correct, false);
  assert.equal(Math.round(EV.scoreAnswer(sata, [0, 2]).score * 100), 67);
  assert.equal(EV.scoreAnswer(sata, [0, 1]).score, 0);
  const m = { type: 'matrix', matrix: { columns: ['E', 'U'], rows: [{ correct: 0 }, { correct: 1 }, { correct: 0 }] } };
  assert.deepEqual(EV.scoreAnswer(m, [0, 1, 0]), { correct: true, score: 1 });
  assert.equal(EV.scoreAnswer(m, [0, 0, 0]).correct, false);
});

test('spaced review: two right answers on different days make it solid', () => {
  const d = EV.deriveWeakspot(ws('a'), [att('2026-10-12', true), att('2026-10-13', true)], { examDate: '2026-10-30' });
  assert.equal(d.status, 'reviewed');
  assert.equal(d.solidBy, 'review');
});
test('spaced review: right twice the same day only counts once', () => {
  const d = EV.deriveWeakspot(
    ws('a'),
    [att('2026-10-12', true, { hm: '14:00' }), att('2026-10-12', true, { hm: '18:00' })],
    { examDate: '2026-10-30' }
  );
  assert.equal(d.status, 'open');
  assert.equal(d.streak, 1);
  assert.equal(d.nextDue, '2026-10-15');
});
test('spaced review: wrong then right the same day advances once (v2 behavior)', () => {
  const d = EV.deriveWeakspot(
    ws('a'),
    [att('2026-10-17', false, { hm: '06:31' }), att('2026-10-17', true, { hm: '14:48' })],
    { examDate: '2026-10-21' }
  );
  assert.deepEqual([d.status, d.streak, d.nextDue, d.misses], ['open', 1, '2026-10-18', 1]);
});
test('spaced review: near the exam the interval is one day and never lands on exam day', () => {
  assert.equal(EV.deriveWeakspot(ws('a'), [att('2026-10-17', true)], { examDate: '2026-10-21' }).nextDue, '2026-10-18');
  assert.equal(EV.deriveWeakspot(ws('a'), [att('2026-10-12', true)], { examDate: '2026-10-21' }).nextDue, '2026-10-15');
  assert.equal(EV.deriveWeakspot(ws('a'), [att('2026-10-18', true)], { examDate: '2026-10-20' }).nextDue, '2026-10-19');
});
test('spaced review: a miss after solid reopens it and raises recurrence', () => {
  const d = EV.deriveWeakspot(ws('a'), [att('2026-10-12', true), att('2026-10-13', true), att('2026-10-15', false)], {
    examDate: '2026-10-30',
  });
  assert.deepEqual([d.status, d.streak, d.recurrence, d.nextDue], ['open', 0, 2, '2026-10-16']);
});
test('D-041 pre-read: the first check after the reading decides it', () => {
  const pre = ws('p', { preRead: true, readingDue: '2026-10-17' });
  assert.equal(EV.deriveWeakspot(pre, [att('2026-10-18', true)]).solidBy, 'first-check-after-reading');
  const missed = EV.deriveWeakspot(pre, [att('2026-10-18', false)]);
  assert.deepEqual([missed.status, missed.preRead, missed.nextDue, missed.misses], ['open', false, '2026-10-19', 1]);
});
test('events (keyed <writer>-<time>): park, activate, owner solid, notes done, seen again', () => {
  assert.equal(
    EV.deriveWeakspot(ws('a', { events: ev(at('2026-10-16'), { type: 'park', by: 'E.V.' }, 'evening-cloud') }), [
      att('2026-10-17', false),
    ]).status,
    'parked'
  );
  const act = EV.deriveWeakspot(
    ws('a', {
      events: { ...ev(at('2026-10-16'), { type: 'park' }), ...ev(at('2026-10-17'), { type: 'activate', by: 'owner' }) },
    }),
    []
  );
  assert.deepEqual([act.status, act.nextDue], ['open', '2026-10-17']);
  assert.equal(
    EV.deriveWeakspot(ws('a', { events: ev(at('2026-10-16'), { type: 'solid', by: 'owner' }) }), []).solidBy,
    'owner'
  );
  assert.equal(
    EV.deriveWeakspot(ws('n', { kind: 'note', events: ev(at('2026-10-16'), { type: 'done', by: 'owner' }) }), [])
      .status,
    'reviewed'
  );
  const seen = EV.deriveWeakspot(ws('a'), [att('2026-10-12', true), att('2026-10-13', true)], {});
  assert.equal(seen.status, 'reviewed');
  const seenAgain = EV.deriveWeakspot(
    ws('a', { events: ev(at('2026-10-14'), { type: 'seen', by: 'Study Watch' }, 'filing') }),
    [att('2026-10-12', true), att('2026-10-13', true)]
  );
  assert.deepEqual([seenAgain.status, seenAgain.recurrence, seenAgain.nextDue], ['open', 2, '2026-10-15']);
});
test('events from two writers interleave with answers by time', () => {
  // park from the evening run at 8:15pm, then the page reactivates the next morning, then a right answer
  const w = ws('a', {
    events: {
      ...ev('2026-10-17T01:15:00Z', { type: 'park' }, 'evening-cloud'),
      ...ev('2026-10-17T14:00:00Z', { type: 'activate' }),
    },
  });
  const whileParked = { at: '2026-10-17T05:00:00Z', date: '2026-10-17', correct: false };
  const d = EV.deriveWeakspot(w, [att('2026-10-16', true), whileParked, att('2026-10-17', true)]);
  assert.deepEqual(
    [d.status, d.streak, d.answered, d.misses],
    ['open', 1, 2, 0],
    'the miss while parked does not count'
  );
  const unordered = EV.deriveWeakspot(w, [att('2026-10-17', true), whileParked, att('2026-10-16', true)]);
  assert.deepEqual(unordered, d, 'attempt order does not matter');
});

// ---------------------------------------------------------------- answers in their own document
const SET = {
  id: 'review-2026-10-18',
  kind: 'review',
  items: [
    {
      id: 'q1',
      weakspotId: 'made',
      objective: 'E4-3',
      stem: 'A made-up stem long enough',
      options: ['a', 'b'],
      correct: [0],
    },
    { id: 'q2', objective: 'E4-3', stem: 'Another made-up stem here', options: ['a', 'b'], correct: [0] },
  ],
};
const answersDoc = (setId, answers) => ({
  id: setId,
  schema: 2, // B-75: answers schema 2
  writer: 'page',
  at: at('2026-10-17'),
  source: 'E.V. Home',
  setId,
  answers,
});

test('answers: every attempt is kept under its item, keyed by writer and time, and read oldest first', () => {
  const a = answersDoc(SET.id, {
    q1: {
      [key(at('2026-10-18', '16:00'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-18', '16:00') },
      [key(at('2026-10-17'))]: { chosen: [1], correct: false, score: 0, at: at('2026-10-17') },
    },
  });
  const { all, byWeakspot } = EV.collectAttempts([SET], [a]);
  assert.deepEqual(
    all.map(x => [x.itemId, x.correct]),
    [
      ['q1', false],
      ['q1', true],
    ]
  );
  assert.equal(byWeakspot.made.length, 2);
  assert.deepEqual(EV.answeredItems(SET, [a]), ['q1']);
  assert.deepEqual(EV.collectAttempts([SET], []).all, [], 'a set without answers has no attempts');
  assert.equal(
    EV.collectAttempts([SET], [answersDoc('other', a.answers)]).all.length,
    0,
    'answers are matched to their own set'
  );
});

test('the answer that created a weak spot is not one of its reviews', () => {
  const w = ws('made', {
    origin: { set: SET.id, item: 'q1', at: at('2026-10-17') },
    initial: { streak: 0, nextDue: '2026-10-18', recurrence: 1, misses: 0 },
  });
  const a = answersDoc(SET.id, {
    q1: { [key(at('2026-10-17'))]: { chosen: [1], correct: false, at: at('2026-10-17'), createdWeakspot: 'made' } },
  });
  const { byWeakspot } = EV.collectAttempts([SET], [a]);
  assert.equal(byWeakspot.made.length, 1);
  assert.deepEqual(EV.deriveWeakspot(w, byWeakspot.made).nextDue, '2026-10-18');
});

test('answering: review, new check miss, repeat miss, pre-read miss; the attempt goes to answers/<setId>, nothing derived is written', () => {
  const set = { id: 'review-2026-10-18', kind: 'review', items: [] };
  const target = {
    ...ws('t'),
    derived: EV.deriveWeakspot(ws('t'), [att('2026-10-17', true)], { examDate: '2026-10-21' }),
  };
  const now = '2026-10-18T15:00:00Z';
  let r = EV.planAnswer({
    set,
    item: { id: 'q1', weakspotId: 't', objective: 'E4-3', type: 'single', options: ['a', 'b'], correct: [0] },
    chosen: [0],
    now,
    weakspots: [target],
    exams: [E4],
    byWeakspot: { t: [att('2026-10-17', true, { weakspotId: 't' })] },
  });
  assert.equal(r.correct, true);
  assert.equal(r.state.status, 'reviewed');
  assert.equal(r.weakspotId, 't');
  assert.match(r.outcome, /marked solid/);
  assert.equal(r.attemptKey, 'page-20261018-150000000');
  assert.deepEqual(
    r.writes.map(w => [w.op, w.collection, w.id]),
    [['set', 'answers', set.id]],
    "the first answer creates the set's answers document and nothing else"
  );
  assert.deepEqual(r.writes[0].data.answers, { q1: { [r.attemptKey]: r.answer } });
  assertValid(r.writes[0]);
  // With an answers document already there, the attempt is an update that adds one key.
  const existing = answersDoc(set.id, {
    q0: { [key(at('2026-10-18', '14:00'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-18', '14:00') } },
  });
  r = EV.planAnswer({
    set,
    item: { id: 'q1', weakspotId: 't', objective: 'E4-3', type: 'single', options: ['a', 'b'], correct: [0] },
    chosen: [1],
    now,
    weakspots: [target],
    exams: [E4],
    answersDoc: existing,
    byWeakspot: {},
  });
  assert.equal(r.writes[0].op, 'update');
  assertValid(r.writes[0], existing);
  // A missed new check creates a weak spot (facts only) and tags the answer as its origin.
  r = EV.planAnswer({
    set,
    item: {
      id: 'q2',
      kind: 'check',
      objective: 'E4-2',
      topic: 'Caring behaviors',
      type: 'single',
      options: ['a', 'b'],
      correct: [0],
    },
    chosen: [1],
    now,
    weakspots: [target],
    exams: [E4],
  });
  const created = r.writes.find(w => w.collection === 'weakspots' && w.op === 'set');
  assert.ok(created);
  assert.equal(r.answer.createdWeakspot, created.id);
  assert.equal(created.data.initial.nextDue, '2026-10-19');
  assert.equal(created.data.writer, 'page');
  assertValid(created);
  // Missing the same topic again: seen again, not a duplicate.
  const twin = {
    ...ws('caring', { objective: 'E4-2', topic: 'Caring behaviors' }),
    derived: { status: 'open', streak: 0, nextDue: '2026-10-19', recurrence: 1, misses: 0 },
  };
  r = EV.planAnswer({
    set,
    item: {
      id: 'q3',
      kind: 'check',
      objective: 'E4-2',
      topic: 'Caring behaviors',
      type: 'single',
      options: ['a', 'b'],
      correct: [0],
    },
    chosen: [1],
    now,
    weakspots: [twin],
    exams: [E4],
  });
  assert.equal(r.answer.matched, true);
  assert.equal(r.state.recurrence, 2);
  assert.equal(r.writes.length, 1);
  // A miss on unread chapters is a preview (D-041).
  const plan = EV.planFromCards([{ days: [['Sun 10/18', '', [['Read Pharm Ch 27 (macrolides)']]]] }], {
    examId: 'E4',
    year: 2026,
    now,
  });
  r = EV.planAnswer({
    set,
    item: {
      id: 'q4',
      kind: 'drill',
      objective: 'E4-7',
      topic: 'Macrolide teaching',
      chapters: ['Pharm 27'],
      type: 'single',
      options: ['a', 'b'],
      correct: [0],
    },
    chosen: [1],
    now,
    weakspots: [],
    exams: [E4],
    plans: [EV.planView(plan, null)],
  });
  const pre = r.writes.find(w => w.collection === 'weakspots');
  assert.equal(pre.data.preRead, true);
  assert.match(r.outcome, /preview/);
  assertValid(pre);
  for (const w of r.writes) assert.ok(!JSON.stringify(w.data).includes('"derived"'), 'derived is never written');
});

test('derived is never stored: buildWeakspots computes it, derivedHash fingerprints it and moves with an answer', () => {
  const w = ws('made', { initial: { streak: 0, nextDue: '2026-10-18', recurrence: 1, misses: 0 } });
  const a1 = answersDoc(SET.id, {
    q1: { [key(at('2026-10-18'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-18') } },
  });
  const m1 = EV.buildWeakspots({ weakspots: [w], sets: [SET], answers: [a1], exams: [E4] });
  assert.equal(m1[0].derived.streak, 1);
  const h1 = EV.derivedHash(m1);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(EV.derivedHash([...m1].reverse()), h1, 'order does not matter');
  assert.equal(
    EV.derivedHash(EV.buildWeakspots({ weakspots: [w], sets: [SET], answers: [a1], exams: [E4] })),
    h1,
    'deterministic'
  );
  const a2 = answersDoc(SET.id, {
    q1: { ...a1.answers.q1, [key(at('2026-10-19'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-19') } },
  });
  const m2 = EV.buildWeakspots({ weakspots: [w], sets: [SET], answers: [a2], exams: [E4] });
  assert.equal(m2[0].derived.status, 'reviewed');
  assert.notEqual(EV.derivedHash(m2), h1);
  assert.equal(
    EV.weakspotFacts({ ...w, derived: { status: 'x' } }).derived,
    undefined,
    'facts never carry a stored derived block'
  );
});

test('review load: base by day type, exam flex in the 3 days before, caps', () => {
  const models = Array.from({ length: 16 }, (_, i) => ({
    ...ws('w' + i),
    derived: { status: 'open', streak: i < 6 ? 1 : 0, preRead: i >= 12, nextDue: '2026-10-18' },
  }));
  // need: 6 x 1 + 6 x 2 + 4 pre-read x 1 = 22 over 3 days -> 8 a day, below base 10
  let L = EV.reviewLoad({ date: '2026-10-18', dayType: 'off', exams: [E4], weakspots: models });
  assert.deepEqual([L.load, L.flex.need, L.flex.perDay], [10, 22, 8]);
  const many = Array.from({ length: 30 }, (_, i) => ({
    ...ws('m' + i),
    derived: { status: 'open', streak: 0, nextDue: '2026-10-18' },
  }));
  L = EV.reviewLoad({ date: '2026-10-18', dayType: 'off', exams: [E4], weakspots: many }); // 60 / 3 = 20 -> cap 15
  assert.equal(L.load, 15);
  L = EV.reviewLoad({ date: '2026-10-20', dayType: 'clinical', exams: [E4], weakspots: many }); // clinical day before exam: cap 8
  assert.equal(L.load, 8);
  assert.equal(EV.reviewLoad({ date: '2026-10-21', dayType: 'exam', exams: [E4], weakspots: many }).load, 0);
  assert.equal(EV.reviewLoad({ date: '2026-10-13', dayType: 'clinical', exams: [E4], weakspots: [] }).load, 3);
});

test('due ranking: overdue, nearest exam, recurrence, misses, oldest', () => {
  const mk = (id, d, extra = {}) => ({
    ...EV.weakspotFacts(ws(id, extra)),
    derived: { status: 'open', streak: 0, nextDue: d.next, recurrence: d.rec || 1, misses: d.miss || 0 },
  });
  const list = [
    mk('late', { next: '2026-10-17' }),
    mk('rec2', { next: '2026-10-18', rec: 2 }),
    mk('old', { next: '2026-10-18' }, { at: at('2026-10-10') }),
    mk('new', { next: '2026-10-18' }),
    mk('e5', { next: '2026-10-18', rec: 5 }, { exam: 'E5', objective: 'E5-1' }),
    mk('notyet', { next: '2026-10-19' }),
  ];
  const order = EV.rankDue(list, '2026-10-18', [E4, { id: 'E5', date: '2026-11-16' }]).map(w => w.id);
  assert.deepEqual(order, ['late', 'rec2', 'old', 'new', 'e5']);
});

test('plans as data: tasks, chapters, reading state and the pre-read rule; ticks live in planedits', () => {
  const cards = [
    {
      title: 'Week 2',
      days: [
        [
          'Sat 10/17',
          'Last new reading',
          [
            ['Ch 42 Fluid, Electrolytes, Acid-Base: high-yield list + skim (~45 min)'],
            ['Pharm Ch 14, p. 167–171 (nutritional support)'],
            ['Drill 6: Ch 42, 45 + Pharm Ch 14, 50 (nutrition)', 'drill'],
            ['Terminology drill: electrolytes'],
          ],
        ],
        [
          'Sun 10/18',
          'Sim day',
          [
            ['Exam Sim tab: all Exam 4 content, timed', 'drill'],
            ['Drill 7: weak spots from the sim', 'drill'],
            ['Read Pharm Ch 27 (macrolides) + Ch 28 (tetracyclines)'],
          ],
        ],
      ],
    },
  ];
  const p = EV.planFromCards(cards, { examId: 'E4', year: 2026, now: at('2026-10-16') });
  assert.ok(!('done' in p), 'a plan Fact carries no ticks');
  assertValid({ op: 'set', collection: 'plans', id: 'E4', data: p });
  const tasks = EV.planTasks(p);
  assert.equal(tasks.length, 7);
  assert.deepEqual(
    tasks.map(t => t.kind),
    ['reading', 'reading', 'drill', 'terminology', 'sim', 'drill', 'reading']
  );
  assert.deepEqual(tasks[2].chapters, ['Fund 42', 'Fund 45', 'Pharm 14', 'Pharm 50']);
  assert.equal(tasks[2].drill, 6);
  assert.deepEqual(tasks[6].chapters, ['Pharm 27', 'Pharm 28']);
  const view = e => EV.planView({ ...p, id: 'E4' }, e);
  // On 10/17 the Ch 42 reading isn't done (not ticked, date not passed): a miss on it is a preview.
  const q = { id: 'd1', objective: 'E4-3', chapters: ['Fund 42'] };
  assert.equal(EV.preReadFor(q, [view(null)], '2026-10-17').readingDue, '2026-10-17');
  // Ticked off in planedits: no longer a preview.
  const tick = EV.planTick(null, 'E4', tasks[0].id, { now: at('2026-10-17') });
  assertValid({ op: 'set', collection: 'planedits', id: tick.id, data: tick.data });
  assert.equal(EV.preReadFor(q, [view(tick.data)], '2026-10-17'), null);
  assert.equal(EV.preReadFor(q, EV.planViews([{ ...p, id: 'E4' }], [{ id: 'E4', ...tick.data }]), '2026-10-17'), null);
  // Unticking replaces the edit whole, without the task.
  const untick = EV.planTick({ id: 'E4', ...tick.data }, 'E4', tasks[0].id, {
    done: false,
    now: at('2026-10-17', '16:00'),
  });
  assert.deepEqual(untick.data.ticks, {});
  assert.equal(untick.data.updatedAt, '2026-10-17T16:00:00.000Z');
  // The next day the reading counts as done.
  assert.equal(EV.preReadFor(q, [view(null)], '2026-10-18'), null);
  assert.ok(EV.preReadFor({ chapters: ['Pharm 28'] }, [view(null)], '2026-10-17'));
  // A plan drill is done once its practice set is fully answered (answers/<setId>).
  const drillTask = { ...tasks[2] };
  const set = { id: 'E4-drill-6', planTaskId: drillTask.id, items: [{ id: 'd1' }, { id: 'd2' }] };
  const one = answersDoc(set.id, { d1: { [key(at('2026-10-17'))]: { at: at('2026-10-17'), correct: true } } });
  assert.equal(EV.taskDone(view(null), drillTask, '2026-10-17', [set], [one]), false);
  const both = answersDoc(set.id, {
    ...one.answers,
    d2: { [key(at('2026-10-17', '16:00'))]: { at: at('2026-10-17', '16:00'), correct: false } },
  });
  assert.equal(EV.taskDone(view(null), drillTask, '2026-10-17', [set], [both]), true);
});

test('day plan: budget cuts optional work first and never cuts graded work or exams', () => {
  const plan = EV.planFromCards(
    [
      {
        days: [
          [
            'Sun 10/18',
            '',
            [
              ['Read Ch 99 (big chapter)'],
              ['Terminology drill'],
              ['Optional lab'],
              ['Drill 9: Ch 99', 'drill'],
              ['Engage module due 11:59pm', 'graded'],
            ],
          ],
        ],
      },
    ],
    { examId: 'E9', year: 2026 }
  );
  const exams = [
    { id: 'BIO-E3', course: 'BIO 201', kind: 'unit', date: '2026-10-18', title: 'BIO 201 Lecture Exam 3' },
  ];
  // Graded work and exams cost no study minutes (D-086), so a 60-minute day is what forces the cuts.
  EV.configure({
    ...spec,
    constants: { ...spec.constants, dayBudgetMinutes: { ...spec.constants.dayBudgetMinutes, off: 60, exam: 60 } },
  });
  const d = EV.planDay({ date: '2026-10-18', dates: [], exams, plans: [plan], weakspots: [], objectives: [] });
  EV.configure(spec);
  const byId = Object.fromEntries(d.blocks.map(b => [b.title, b]));
  assert.equal(
    d.dayType,
    'exam',
    'B-42 (D-099): a BIO 201 unit exam makes the day an exam day (spec.courses examDayKinds)'
  );
  assert.ok(byId['BIO 201 Lecture Exam 3'].required && !byId['BIO 201 Lecture Exam 3'].deferred);
  assert.ok(!byId['Engage module due 11:59pm'].deferred);
  assert.ok(byId['Optional lab'].deferred && byId['Terminology drill'].deferred, 'optional and terminology go first');
  assert.ok(!byId['Read Ch 99 (big chapter)'].deferred, 'reading is kept');
  assert.ok(d.budget.planned <= 60);
  assert.equal(byId['BIO 201 Lecture Exam 3'].minutes, 0);
  assert.equal(byId['Engage module due 11:59pm'].minutes, 0);
  assert.ok(d.deferred.some(x => /Optional lab/.test(x.title)));
});

test('B-31 (D-086): on the Oct 19 shape each item shows once, fixed items cost nothing, and no review is deferred', () => {
  // Synthetic: a validation day with a Canvas graded date, a hand-entered validation date and plan tasks naming them.
  const date = '2026-10-19';
  const dates = [
    {
      id: 'val-group',
      date,
      kind: 'validation',
      course: 'NUR 112',
      title: 'Group check-off validation; practice sim in the evening',
    },
    {
      id: 'canvas-engage',
      date,
      kind: 'due',
      course: 'NUR 112',
      graded: true,
      canvasId: 900100,
      title: 'Online module: Topic A + Topic B review due 11:59pm',
    },
  ];
  const plan = {
    ...EV.planFromCards(
      [
        {
          days: [
            [
              'Mon 10/19',
              '',
              [
                ['Group check-off validation (lab); confirm what it covers', 'graded'],
                ['Online module: Topic A, due 11:59pm (30 min minimum)', 'graded'],
                ['Online module: Topic B review, due 11:59pm (30 min minimum)', 'graded'],
                ['Final sim tab: timed, weighted to weak spots', 'drill'],
                ['Terminology drill'],
              ],
            ],
          ],
        },
      ],
      { examId: 'E9', year: 2026 }
    ),
    id: 'E9',
  };
  const exams = [{ id: 'E9', course: 'NUR 112', kind: 'unit', date: '2026-10-21', title: 'Exam 9' }];
  const objectives = [{ id: 'E9-1', exam: 'E9' }];
  const weakspots = Array.from({ length: 12 }, (_, i) => ({
    id: 'ws' + i,
    topic: 'Topic ' + i,
    objective: 'E9-1',
    exam: 'E9',
    kind: 'concept',
    addedAt: '2026-10-10T12:00:00Z',
    derived: { status: 'open', nextDue: '2026-10-18', recurrence: 1, misses: 1, rightDays: 0 },
  }));
  const d = EV.planDay({ date, dates, exams, plans: [plan], weakspots, objectives });
  assert.equal(d.dayType, 'validation');
  assert.equal(d.budget.available, 150);
  const list = EV.buildDayList(d, {});
  const titles = list.items.map(i => i.text);
  assert.equal(titles.filter(t => /check-off validation/i.test(t)).length, 1, 'the validation shows once');
  assert.equal(titles.filter(t => /Online module/i.test(t)).length, 1, 'the graded module shows once');
  assert.ok(
    list.items.some(i => i.id === 'date-canvas-engage') && list.items.some(i => i.id === 'date-val-group'),
    "under the records' ids"
  );
  assert.ok(
    d.blocks.filter(b => ['graded', 'val', 'exam', 'clinical'].includes(b.kind)).every(b => b.minutes === 0),
    'fixed items cost 0'
  );
  assert.deepEqual(d.blocks.find(b => b.id === 'date-canvas-engage').planTasks.length, 2);
  assert.ok(!d.deferred.some(x => x.kind === 'weakspot'), 'no weak spot deferred over load');
  assert.ok(!d.blocks.some(b => b.kind === 'reviews' && b.deferred), 'no review block deferred');
  assert.ok(d.reviews.ids.length >= 10, `reviews kept: ${d.reviews.ids.length}`);
  assert.ok(d.budget.planned <= 150, `planned ${d.budget.planned}`);
});

test('day plan honors planedits ticks: a ticked task costs no minutes', () => {
  const plan = {
    ...EV.planFromCards([{ days: [['Sun 10/18', '', [['Read Ch 99 (big chapter)']]]] }], { examId: 'E9', year: 2026 }),
    id: 'E9',
  };
  const task = EV.planTasks(plan)[0];
  const untouched = EV.planDay({ date: '2026-10-18', plans: [plan], planedits: [] });
  const ticked = EV.planDay({
    date: '2026-10-18',
    plans: [plan],
    planedits: [{ id: 'E9', ...EV.planTick(null, 'E9', task.id, { now: at('2026-10-18') }).data }],
  });
  const block = d => d.blocks.find(b => b.taskId === task.id);
  assert.deepEqual([block(untouched).done, block(untouched).minutes], [false, 45]);
  assert.deepEqual([block(ticked).done, block(ticked).minutes], [true, 0]);
});

test('day type comes from exams and dates', () => {
  const dates = [
    { id: 'c', date: '2026-10-20', kind: 'clinical', course: 'NUR 112', title: 'Clinical' },
    { id: 'v', date: '2026-10-19', kind: 'validation', course: 'NUR 112', title: 'Group ID validation' },
  ];
  assert.equal(EV.dayType({ date: '2026-10-21', dates, exams: [E4] }), 'exam');
  assert.equal(EV.dayType({ date: '2026-10-20', dates, exams: [E4] }), 'clinical');
  assert.equal(EV.dayType({ date: '2026-10-19', dates, exams: [E4] }), 'validation');
  assert.equal(
    EV.dayType({
      date: '2026-10-18',
      dates,
      exams: [E4, { id: 'BIO-E3', course: 'BIO 201', kind: 'unit', date: '2026-10-18' }],
    }),
    'exam',
    'B-42: a BIO 201 lecture exam is an exam day'
  );
  assert.equal(
    EV.dayType({
      date: '2026-10-18',
      dates,
      exams: [E4, { id: 'BIO-LAB-BONES', course: 'BIO 201', kind: 'lab', date: '2026-10-18' }],
    }),
    'exam',
    'B-42: so is a lab practical'
  );
  assert.equal(
    EV.dayType({
      date: '2026-10-18',
      dates: [{ id: 'bc', date: '2026-10-18', kind: 'clinical', course: 'BIO 201', title: 'Open lab' }],
      exams: [E4],
    }),
    'off',
    'a BIO calendar entry of a kind its course does not count leaves the day as it is'
  );
  assert.equal(EV.dayType({ date: '2026-10-22', dates, exams: [E4] }), 'class');
  assert.equal(
    EV.dayType({
      date: '2026-10-20',
      dates,
      dateedits: [{ id: 'c', removed: { at: at('2026-10-18'), by: 'Matt' } }],
      exams: [E4],
    }),
    'class',
    'a date taken off in dateedits is gone'
  );
});

test('lint finds duplicates and orphans (answers in their own document); D-324: no identifier warning', () => {
  const issues = EV.lint({
    weakspots: [ws('a'), ws('b', { topic: 'a' })],
    sets: [
      {
        id: 's',
        items: [
          {
            id: 'q',
            weakspotId: 'gone',
            stem: 'A real enough stem here',
            options: ['a', 'b'],
            correct: [0],
            rationales: ['r', 'r'],
            cjStep: 'take-action',
            objective: 'E4-3',
          },
        ],
      },
    ],
    answers: [answersDoc('s', { missing: { [key(at('2026-10-17'))]: { at: at('2026-10-17'), correct: true } } })],
    journal: [{ id: 'j', text: 'Patient in room 12 was confused' }],
    objectives: [{ id: 'E4-3' }],
    exams: [E4],
  });
  const codes = issues.map(i => i.code);
  assert.ok(!codes.includes('possible-identifier'), 'D-324: nothing is flagged as an identifier');
  assert.ok(codes.includes('duplicate'));
  assert.ok(codes.includes('orphan-item'));
  assert.ok(issues.some(i => i.code === 'orphan-answer' && i.ref === 'answers/s'));
});

test('snapshot reads runs/<id> and answers/<setId>, carries the release and the derived hash; Study Watch context', () => {
  const models = [{ ...ws('a'), derived: { status: 'open', streak: 0, nextDue: '2026-10-18', recurrence: 1 } }];
  const runs = [
    {
      id: 'morning-20261017-092500-aa11',
      pipeline: 'morning',
      status: 'ok',
      startedAt: '2026-10-17T09:25:00Z',
      release: 'v4.0.0',
    },
    {
      id: 'morning-20261018-092500-bb22',
      pipeline: 'morning',
      status: 'failed',
      startedAt: '2026-10-18T09:25:00Z',
      detail: 'x',
      release: 'v4.0.0',
    },
  ];
  const review = { id: 'review-2026-10-18', items: [{ id: 'q1' }, { id: 'q2' }] };
  const s = EV.buildSnapshot({
    date: '2026-10-18',
    now: '2026-10-18T10:00:00Z',
    exams: [E4],
    weakspots: models,
    sets: [review],
    answers: [answersDoc(review.id, { q1: { [key(at('2026-10-18'))]: { at: at('2026-10-18'), correct: true } } })],
    days: [],
    runs,
    dates: [],
    counts: { weakspots: 1 },
  });
  assert.equal(s.due.count, 1);
  assert.equal(s.nextExams[0].daysLeft, 3);
  assert.equal(s.health.capacity.level, 'ok');
  assert.equal(s.health.runs.morning.id, 'morning-20261018-092500-bb22');
  assert.equal(s.health.runs.morning.status, 'failed');
  assert.equal(s.today.answered, 1);
  assert.equal(s.release, null, "B-149: the release is the run's own, passed in; none given here");
  const given = EV.buildSnapshot({
    date: '2026-10-18',
    now: '2026-10-18T10:00:00Z',
    exams: [E4],
    weakspots: models,
    sets: [review],
    answers: [],
    days: [],
    runs,
    dates: [],
    counts: { weakspots: 1 },
    versions: { spec: '4.2', release: 'v4.2.0' },
  });
  assert.deepEqual([given.release, given.specVersion], ['v4.2.0', '4.2']);
  assert.equal(s.derivedHash, EV.derivedHash(models));
  const c = EV.buildContext({
    date: '2026-10-18',
    exams: [E4],
    objectives: [{ id: 'E4-3', exam: 'E4', text: 'Findings' }],
    weakspots: models,
  });
  assert.equal(c.nextExam.id, 'E4');
  assert.equal(c.activeWeakSpots.length, 1);
});

test('automatic park events are keyed by the evening run and validate', () => {
  const models = [{ ...ws('a', { exam: 'E3', objective: 'E3-1' }), derived: { status: 'open' } }];
  const w = EV.autoParkEvents({
    weakspots: models,
    exams: [{ id: 'E3', date: '2026-10-01' }],
    date: '2026-10-18',
    now: '2026-10-18T01:15:00Z',
  });
  assert.deepEqual(Object.keys(w[0].data.events), ['evening-cloud-20261018-011500000']);
  assertValid(w[0], ws('a'));
});

// ---------------------------------------------------------------- dayView over dayedits
test('list edits: added items ride on the planned list, planned ones can be taken off for the day, fixed ones stay; each edit is the whole dayedits document (D-078)', () => {
  const now = '2026-10-17T23:20:00Z';
  const day = {
    id: '2026-10-17',
    date: '2026-10-17',
    list: {
      items: [
        { id: 'date-bio-exam', text: 'BIO 201 Lecture Exam 3', tag: 'EXAM', minutes: 0 },
        { id: 'plan-t1', text: 'Pharm Ch 14 reading', tag: 'READING', minutes: 45 },
        { id: 'review-base', text: 'Review · 6 weak spots', tag: 'REVIEW', minutes: 9 },
      ],
    },
    plan: { budget: { available: 180, planned: 54, over: 0 } },
  };
  const a = EV.listEdit(
    day,
    null,
    { action: 'add', text: '  Quizlets: Ch 7 & 8 lecture  ', kind: 'practice', minutes: 30, course: 'BIO 201' },
    { now, by: 'E.V.' }
  );
  assert.equal(a.id, 'add-quizlets-ch-7-8-lecture');
  assert.deepEqual(a.doc.added[a.id], {
    text: 'Quizlets: Ch 7 & 8 lecture',
    tag: 'PRACTICE',
    kind: 'practice',
    minutes: 30,
    course: 'BIO 201',
    at: '2026-10-17T23:20:00.000Z',
    by: 'E.V.',
  });
  assert.deepEqual([a.doc.writer, a.doc.date, a.doc.updatedAt], ['page', '2026-10-17', '2026-10-17T23:20:00.000Z']);
  assertValid({ op: 'set', collection: 'dayedits', id: '2026-10-17', data: a.doc });
  const e1 = { id: '2026-10-17', ...a.doc };
  let v = EV.dayView(day, e1);
  assert.deepEqual(
    v.items.map(i => i.id),
    ['date-bio-exam', 'plan-t1', 'review-base', a.id]
  );
  assert.equal(v.items[3].note, 'BIO 201');
  assert.equal(v.items[3].added, true);
  assert.equal(v.budget.planned, 84);
  assert.deepEqual(
    EV.dayView(day, null).items.map(i => i.id),
    ['date-bio-exam', 'plan-t1', 'review-base'],
    'the Derived day alone is the plan'
  );
  // The same text again is not a second item; a different one gets its own id
  assert.equal(EV.listEdit(day, e1, { action: 'add', text: 'quizlets: ch 7 & 8 lecture' }, { now }).doc, null);
  const b = EV.listEdit(
    day,
    e1,
    { action: 'add', text: 'Review the Chapter 8 lecture', minutes: 999 },
    { now: '2026-10-17T23:21:00Z' }
  );
  assert.equal(b.doc.added[b.id].minutes, 240);
  assert.equal(b.doc.added[b.id].tag, null);
  assert.ok(b.doc.added[a.id], 'the edit keeps what was there: it is replaced whole');
  assert.equal(b.doc.at, e1.at, 'the envelope of the first edit stays');
  // Taking a planned item off skips it for the day and frees its minutes; restore brings it back
  const r = EV.listEdit(day, e1, { action: 'remove', id: 'plan-t1' }, { now, by: 'Matt' });
  assert.deepEqual(r.doc.skipped, { 'plan-t1': { at: '2026-10-17T23:20:00.000Z', by: 'Matt' } });
  const e2 = { id: '2026-10-17', ...r.doc };
  v = EV.dayView(day, e2);
  assert.ok(!v.items.some(i => i.id === 'plan-t1'));
  assert.equal(v.budget.planned, 39);
  assert.deepEqual(v.skipped, [{ id: 'plan-t1', text: 'Pharm Ch 14 reading' }]);
  assert.equal(EV.listEdit(day, e2, { action: 'remove', id: 'plan-t1' }, { now }).note, 'already off the list');
  assert.deepEqual(EV.listEdit(day, e2, { action: 'restore', id: 'plan-t1' }, { now }).doc.skipped, {});
  // Removing an added item takes it and its check out of the document (no null-to-clear)
  const ck = EV.listEdit(day, e2, { action: 'check', id: a.id }, { now });
  assert.ok(ck.doc.checks[a.id]);
  assert.equal(EV.dayView(day, { id: 'x', ...ck.doc }).items.find(i => i.id === a.id).checked, true);
  const gone = EV.listEdit(day, { id: '2026-10-17', ...ck.doc }, { action: 'remove', id: a.id }, { now });
  assert.ok(!(a.id in gone.doc.added) && !(a.id in gone.doc.checks));
  assert.ok(!JSON.stringify(gone.doc).includes('null,') && !Object.values(gone.doc.added).includes(null));
  assertValid({ op: 'set', collection: 'dayedits', id: '2026-10-17', data: gone.doc });
  assert.throws(
    () => EV.listEdit(day, e2, { action: 'remove', id: 'date-bio-exam' }, { now }),
    /exam; it stays on the list/
  );
  assert.throws(() => EV.listEdit(day, e2, { action: 'remove', id: 'nope' }, { now }), /no item nope/);
  assert.throws(() => EV.listEdit(day, e2, { action: 'add', text: '  ' }, { now }), /text is required/);
  // A skip on a fixed item (written by hand) is ignored
  v = EV.dayView(day, { ...e2, skipped: { 'date-bio-exam': { at: now, by: 'Matt' } } });
  assert.ok(v.items.some(i => i.id === 'date-bio-exam'));
  // A day with only added items (no plan yet) still lists them
  assert.deepEqual(
    EV.dayView(null, e1).items.map(i => i.id),
    [a.id]
  );
  assert.equal(EV.dayView(null, e1).budget, null);
});

test('B-381: graded work Matt snoozes lands tomorrow still GRADED and fixed; E.V. can neither take it off nor add a graded item', () => {
  const now = '2026-10-18T14:00:00Z';
  const g = EV.listEdit(
    null,
    null,
    { action: 'add', text: 'Med math quiz', kind: 'graded', minutes: 20, course: 'NUR 112' },
    { now, by: 'Matt', date: '2026-10-19' }
  );
  assert.equal(g.doc.added[g.id].tag, 'GRADED');
  assert.equal(g.doc.added[g.id].kind, 'graded');
  assertValid({ op: 'set', collection: 'dayedits', id: '2026-10-19', data: g.doc });
  const e = { id: '2026-10-19', ...g.doc };
  const item = EV.dayView(null, e).items.find(i => i.id === g.id);
  assert.equal(item.tag, 'GRADED');
  assert.throws(
    () => EV.listEdit(null, e, { action: 'remove', id: g.id }, { now, by: 'E.V.' }),
    /graded; it stays on the list/
  );
  assert.ok(!(g.id in EV.listEdit(null, e, { action: 'remove', id: g.id }, { now, by: 'Matt' }).doc.added));
  const ev = EV.listEdit(null, null, { action: 'add', text: 'Fake graded', kind: 'graded' }, { now, by: 'E.V.' });
  assert.equal(ev.doc.added[ev.id].tag, null, 'only Matt’s Snooze writes a graded item');
});

test('B-381: graded work snoozed onto a day that already holds the same words stays graded and fixed', () => {
  const now = '2026-10-18T14:00:00Z';
  const ev = EV.listEdit(null, null, { action: 'add', text: 'Med math quiz' }, { now, by: 'E.V.', date: '2026-10-19' });
  const e = { id: '2026-10-19', ...ev.doc };
  const g = EV.listEdit(null, e, { action: 'add', text: 'Med math quiz', kind: 'graded' }, { now, by: 'Matt' });
  assert.equal(g.id, ev.id);
  assert.deepEqual([g.doc.added[g.id].tag, g.doc.added[g.id].kind], ['GRADED', 'graded']);
  const shown = EV.dayView(null, { id: 'x', ...g.doc }).items.find(i => i.id === g.id);
  assert.equal(shown.by, 'Matt', 'his graded work: never in her changes (by E.V.), so no Undo of hers takes it off');
  // Undo of his snooze adds it back as his (undoTask passes Matt for graded work): GRADED still
  const back = EV.listEdit(null, null, { action: 'add', text: 'Med math quiz', kind: 'graded' }, { now, by: 'Matt' });
  assert.equal(back.doc.added[back.id].tag, 'GRADED');
  assertValid({ op: 'set', collection: 'dayedits', id: '2026-10-19', data: g.doc });
  assert.throws(
    () => EV.listEdit(null, { id: 'x', ...g.doc }, { action: 'remove', id: g.id }, { now, by: 'E.V.' }),
    /graded; it stays on the list/
  );
  const day = { id: '2026-10-19', list: { items: [{ id: 'plan-q', text: 'Med math quiz', tag: 'PRACTICE' }] } };
  assert.throws(
    () => EV.listEdit(day, null, { action: 'add', text: 'Med math quiz', kind: 'graded' }, { now, by: 'Matt' }),
    /already planned that day/
  );
  assert.equal(EV.listEdit(null, e, { action: 'add', text: 'Med math quiz' }, { now, by: 'E.V.' }).doc, null);
  // a fixed item that is not graded never absorbs it: refused, so today's item stays
  for (const it of [
    { id: 'date-x', text: 'Med math quiz', tag: 'CLINICAL' },
    { id: 'exam-x', text: 'Med math quiz', tag: 'EXAM' },
    { id: 'soon-x', text: 'Med math quiz', tag: 'READING' },
  ])
    assert.throws(
      () =>
        EV.listEdit(
          { id: 'd', list: { items: [it] } },
          null,
          { action: 'add', text: it.text, kind: 'graded' },
          { now, by: 'Matt' }
        ),
      /can't carry the graded tag/
    );
  const gd = { id: 'd', list: { items: [{ id: 'date-g', text: 'Med math quiz', tag: 'GRADED' }] } };
  assert.equal(
    EV.listEdit(gd, null, { action: 'add', text: 'Med math quiz', kind: 'graded' }, { now, by: 'Matt' }).doc,
    null
  );
});

test('B-388: planned graded work due today can’t be snoozed off; tomorrow’s soon- item still moves', () => {
  const now = '2026-10-18T14:00:00Z';
  const day = {
    id: '2026-10-18',
    list: {
      items: [
        { id: 'date-careplan', text: 'Care plan 2', tag: 'GRADED', minutes: 0 },
        { id: 'soon-medmath', text: 'Med math quiz (due tomorrow)', tag: 'GRADED', minutes: 0 },
      ],
    },
  };
  assert.throws(
    () => EV.listEdit(day, null, { action: 'remove', id: 'date-careplan' }, { now, by: 'Matt' }),
    /graded work due that day; it stays on the list/
  );
  assert.throws(
    () => EV.listEdit(day, null, { action: 'remove', id: 'date-careplan' }, { now, by: 'E.V.' }),
    /stays on the list/
  );
  const s = EV.listEdit(day, null, { action: 'remove', id: 'soon-medmath' }, { now, by: 'Matt' });
  assert.ok(s.doc.skipped['soon-medmath'], 'his snooze of tomorrow’s heads-up still takes it off today');
  const v = EV.dayView(day, { id: '2026-10-18', ...s.doc });
  assert.ok(!v.items.some(i => i.id === 'soon-medmath'));
  // a skip of today's graded work written before the fix never hides it: it is still on today's list
  const old = EV.dayView(day, { id: '2026-10-18', skipped: { 'date-careplan': { at: now, by: 'Matt' } } });
  assert.ok(old.items.some(i => i.id === 'date-careplan' && i.tag === 'GRADED'));
});

// ---------------------------------------------------------------- liveDates over dateedits
test('calendar edits: a new entry is a dates Fact; every change, removal and restore is its dateedits document; removed dates are gone everywhere (D-080)', () => {
  const now = '2026-10-18T01:10:00Z';
  const canvas = (id, extra) => ({
    id,
    schema: 1,
    writer: 'canvas-sync',
    at: now,
    source: 'Canvas sync',
    canvasId: Number(id.slice(7)),
    course: 'NUR 112',
    graded: false,
    ...extra,
  });
  const dates = [
    canvas('canvas-11', {
      date: '2026-10-19',
      dueAt: '2026-10-20T04:59:00Z',
      title: 'Older Adult quiz',
      kind: 'due',
      graded: true,
    }),
    canvas('canvas-12', { date: '2026-10-20', title: 'Clinical day 6', kind: 'clinical' }),
    canvas('canvas-13', { date: '2026-10-21', title: 'Optional study hall', kind: 'other' }),
    {
      id: '2026-10-17-review-bio-201-chapter-8-lectu',
      schema: 1,
      writer: 'page',
      at: now,
      source: 'Told E.V.',
      date: '2026-10-17',
      title: 'Review BIO 201 Chapter 8 lecture',
      kind: 'other',
      graded: false,
      course: 'BIO 201',
    },
  ];
  // add: a new Fact written by the page, deduped by date and title, unique ids
  let r = EV.dateEdit(
    dates,
    [],
    {
      action: 'add',
      date: '2026-10-23',
      title: 'BIO lab practical',
      kind: 'exam',
      course: 'bio 201',
      notes: 'Bring the bones kit',
    },
    { now, by: 'E.V.' }
  );
  assert.equal(r.id, '2026-10-23-bio-lab-practical');
  assert.deepEqual([r.write.op, r.write.collection], ['set', 'dates']);
  assert.deepEqual(r.write.data, {
    schema: 1,
    writer: 'page',
    at: '2026-10-18T01:10:00.000Z',
    source: 'Told E.V.',
    date: '2026-10-23',
    title: 'BIO lab practical',
    kind: 'exam',
    graded: false,
    course: 'BIO 201',
    addedBy: 'E.V.',
    notes: 'Bring the bones kit',
  });
  assertValid(r.write);
  const withLab = [...dates, { id: r.id, ...r.write.data }];
  assert.equal(
    EV.dateEdit(withLab, [], { action: 'add', date: '2026-10-23', title: 'BIO  lab practical!' }, { now }).note,
    'already on the calendar'
  );
  assert.equal(
    EV.dateEdit(withLab, [], { action: 'add', date: '2026-10-23', title: 'BIO lab practical - room change' }, { now })
      .id,
    '2026-10-23-bio-lab-practical-room-change'
  );
  assert.throws(() => EV.dateEdit(dates, [], { action: 'add', date: '10/23', title: 'x' }, { now }), /YYYY-MM-DD/);
  assert.throws(
    () => EV.dateEdit(dates, [], { action: 'add', date: '2026-10-23', title: '  ' }, { now }),
    /title is required/
  );
  // change: his own entries take any field as overrides in dateedits; Canvas entries take notes only
  r = EV.dateEdit(
    withLab,
    [],
    { action: 'change', id: '2026-10-23-bio-lab-practical', date: '2026-10-24', notes: 'Room 214' },
    { now, by: 'Matt' }
  );
  assert.deepEqual([r.write.op, r.write.collection, r.write.id], ['set', 'dateedits', '2026-10-23-bio-lab-practical']);
  assert.deepEqual(
    [r.write.data.overrides, r.write.data.notes, r.write.data.removed],
    [{ date: '2026-10-24' }, 'Room 214', null]
  );
  assert.equal(r.date, '2026-10-24');
  assert.deepEqual(r.changed, ['date', 'notes']);
  assertValid(r.write);
  const labEdit = { id: r.id, ...r.write.data };
  const live = EV.liveDates(withLab, [labEdit]);
  assert.equal(live.find(d => d.id === r.id).date, '2026-10-24');
  assert.equal(live.find(d => d.id === r.id).notes, 'Room 214');
  assert.equal(withLab.find(d => d.id === r.id).date, '2026-10-23', 'the Fact itself never changes');
  assert.equal(
    EV.dateEdit(
      withLab,
      [labEdit],
      { action: 'change', id: '2026-10-23-bio-lab-practical', date: '2026-10-24' },
      { now }
    ).note,
    'no change'
  );
  assert.equal(
    EV.dateEdit(withLab, [], { action: 'change', id: '2026-10-23-bio-lab-practical', kind: 'exam' }, { now }).note,
    'no change'
  );
  assert.throws(
    () => EV.dateEdit(dates, [], { action: 'change', id: 'canvas-11', date: '2026-10-25' }, { now }),
    /comes from Canvas/
  );
  assert.equal(
    EV.dateEdit(dates, [], { action: 'change', id: 'canvas-11', notes: 'Covers Ch 7' }, { now }).write.data.notes,
    'Covers Ch 7'
  );
  assert.throws(() => EV.dateEdit(dates, [], { action: 'change', id: 'canvas-13' }, { now }), /give what to change/);
  assert.throws(
    () => EV.dateEdit(dates, [], { action: 'change', id: 'nope', title: 'x' }, { now }),
    /no calendar entry nope/
  );
  // remove and restore; Canvas graded work, exams, clinicals and validations stay
  r = EV.dateEdit(
    dates,
    [],
    { action: 'remove', id: '2026-10-17-review-bio-201-chapter-8-lectu' },
    { now, by: 'E.V.' }
  );
  assert.deepEqual(r.write.data.removed, { at: '2026-10-18T01:10:00.000Z', by: 'E.V.' });
  assertValid(r.write);
  assert.throws(
    () => EV.dateEdit(dates, [], { action: 'remove', id: 'canvas-11' }, { now }),
    /graded work from Canvas; it stays on the calendar/
  );
  assert.throws(() => EV.dateEdit(dates, [], { action: 'remove', id: 'canvas-12' }, { now }), /a clinical from Canvas/);
  const offEdit = {
    id: 'canvas-13',
    ...EV.dateEdit(dates, [], { action: 'remove', id: 'canvas-13' }, { now }).write.data,
  };
  assert.equal(
    EV.dateEdit(dates, [offEdit], { action: 'remove', id: 'canvas-13' }, { now }).note,
    'already off the calendar'
  );
  assert.throws(
    () => EV.dateEdit(dates, [offEdit], { action: 'change', id: 'canvas-13', notes: 'x' }, { now }),
    /restore it first/
  );
  assert.equal(EV.dateEdit(dates, [offEdit], { action: 'restore', id: 'canvas-13' }, { now }).write.data.removed, null);
  assert.equal(EV.dateEdit(dates, [], { action: 'restore', id: 'canvas-13' }, { now }).note, 'already on the calendar');
  const back = EV.dateEdit(
    dates,
    [offEdit],
    { action: 'add', date: '2026-10-21', title: 'Optional study hall' },
    { now }
  );
  assert.deepEqual(
    [back.write.collection, back.write.data.removed, back.note],
    ['dateedits', null, 'back on the calendar'],
    'adding a removed entry again brings it back'
  );
  assert.equal(EV.liveDates(dates, [offEdit]).length, 3);
  assert.ok(EV.isRemovedDate(EV.dateView(dates[2], offEdit)) && !EV.isRemovedDate(dates[2]));
  // removed entries leave the plan, the day type and the Canvas conflict check; the sync keeps them off
  const clin = [
    { id: 'own-clin', writer: 'page', date: '2026-10-20', kind: 'clinical', title: 'Clinical', course: 'NUR 112' },
  ];
  assert.equal(EV.dayType({ date: '2026-10-20', dates: clin, exams: [] }), 'clinical');
  assert.notEqual(
    EV.dayType({
      date: '2026-10-20',
      dates: clin,
      dateedits: [{ id: 'own-clin', removed: { at: now, by: 'Matt' } }],
      exams: [],
    }),
    'clinical'
  );
  const gradedOwn = [
    {
      id: 'own-g',
      writer: 'page',
      date: '2026-10-20',
      kind: 'due',
      graded: true,
      title: 'Care plan',
      course: 'NUR 112',
    },
  ];
  assert.ok(EV.planDay({ date: '2026-10-20', dates: gradedOwn }).blocks.some(b => b.id === 'date-own-g'));
  assert.ok(
    !EV.planDay({
      date: '2026-10-20',
      dates: gradedOwn,
      dateedits: [{ id: 'own-g', removed: { at: now, by: 'Matt' } }],
    }).blocks.some(b => b.id === 'date-own-g')
  );
  // what counts as Canvas: the sync's own entries and hand-entered ones it has linked; a note about Canvas is not enough
  assert.ok(EV.isFixedDate({ writer: 'page', canvasId: 77, kind: 'due', graded: true }));
  assert.ok(EV.isFixedDate({ writer: 'canvas-sync', kind: 'exam' }));
  assert.ok(!EV.isFixedDate({ source: 'Canvas announcement 10/15', kind: 'exam', graded: true }));
  assert.throws(
    () =>
      EV.dateEdit(
        [{ id: 'h', writer: 'page', canvasId: 77, date: '2026-10-22', title: 'Older Adult', kind: 'due' }],
        [],
        { action: 'change', id: 'h', title: 'Older Adult (ATI)' },
        { now }
      ),
    /comes from Canvas/
  );
  const raw = {
    courses: { 'NUR 112': 199214 },
    planner: [
      {
        plannable_id: 13,
        plannable_type: 'calendar_event',
        course_id: 199214,
        plannable: { title: 'Optional study hall', todo_date: '2026-10-22T20:00:00Z' },
      },
    ],
  };
  const sync = EV.normalizeCanvas(raw, { dates, dateedits: [offEdit] }, { now });
  assert.equal(sync.dates.length, 1);
  assert.equal(sync.dates[0].op, 'update');
  assert.ok(
    !('removed' in sync.dates[0].data),
    'the sync updates in place and leaves the removal (in dateedits) alone'
  );
});

test('D-324: core keeps no identifier scan or graded-work refusal', () => {
  for (const name of ['scanIdentifiers', 'scanIdentifierValues', 'identifierCandidates', 'keptVerdicts', 'gradedAsk'])
    assert.equal(EV[name], undefined, name);
});

// ---------------------------------------------------------------- B-05 review follow-ups
test("answering finds the set's answers document among ctx.answers, so an earlier attempt is never overwritten", () => {
  const set = { id: 'review-2026-10-18', kind: 'review', items: [] };
  const earlier = answersDoc(set.id, {
    q0: { [key(at('2026-10-18', '14:00'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-18', '14:00') } },
  });
  const q = {
    id: 'q2',
    kind: 'check',
    objective: 'E4-2',
    topic: 'Made-up topic',
    type: 'single',
    options: ['a', 'b'],
    correct: [0],
  };
  const r = EV.planAnswer({
    set,
    item: q,
    chosen: [0],
    now: '2026-10-18T15:00:00Z',
    weakspots: [],
    exams: [E4],
    answers: [earlier],
  });
  assert.equal(r.writes[0].op, 'update');
  assertValid(r.writes[0], earlier);
  assert.equal(
    EV.planAnswer({ set, item: q, chosen: [0], now: '2026-10-18T15:00:00Z', weakspots: [], exams: [E4], answers: [] })
      .writes[0].op,
    'set'
  );
});

test('answering with planedits: a ticked reading is no longer ahead, so a miss is a weak spot, not a preview', () => {
  const now = '2026-10-18T15:00:00Z';
  const plan = {
    id: 'E4',
    ...EV.planFromCards([{ days: [['Sun 10/18', '', [['Read Pharm Ch 27 (macrolides)']]]] }], {
      examId: 'E4',
      year: 2026,
      now,
    }),
  };
  const taskId = plan.days[0].tasks[0].id;
  const q = {
    id: 'q4',
    kind: 'drill',
    objective: 'E4-7',
    topic: 'Macrolide teaching',
    chapters: ['Pharm 27'],
    type: 'single',
    options: ['a', 'b'],
    correct: [0],
  };
  const base = { set: { id: 'E4-drill-7' }, item: q, chosen: [1], now, weakspots: [], exams: [E4], plans: [plan] };
  assert.equal(EV.planAnswer(base).writes.find(w => w.collection === 'weakspots').data.preRead, true);
  const ticked = EV.planAnswer({
    ...base,
    planedits: [{ id: 'E4', ticks: { [taskId]: { at: at('2026-10-18', '13:00'), by: 'Matt' } } }],
  });
  assert.ok(!ticked.writes.find(w => w.collection === 'weakspots').data.preRead);
});

test('planViews matches planedits on the exam id first', () => {
  const [v] = EV.planViews(
    [{ id: 'plan-e4-v2', exam: 'E4', days: [] }],
    [{ id: 'E4', ticks: { t1: { at: at('2026-10-18'), by: 'Matt' } } }]
  );
  assert.deepEqual(Object.keys(v.done), ['t1']);
});

test('a dateedits override never masks a Canvas entry; notes and removal still apply', () => {
  const canvas = {
    id: 'canvas-1',
    writer: 'canvas-sync',
    date: '2026-10-20',
    title: 'Quiz',
    kind: 'due',
    graded: true,
  };
  const hand = { id: '2026-10-23-lab', writer: 'page', date: '2026-10-23', title: 'Lab', kind: 'exam' };
  const edit = { overrides: { date: '2026-10-30', title: 'Moved' }, notes: 'bring calculator', removed: null };
  const c = EV.dateView(canvas, edit);
  assert.deepEqual([c.date, c.title, c.notes], ['2026-10-20', 'Quiz', 'bring calculator']);
  const h = EV.dateView(hand, edit);
  assert.deepEqual([h.date, h.title, h.notes], ['2026-10-30', 'Moved', 'bring calculator']);
  assert.equal(EV.liveDates([canvas], [{ id: 'canvas-1', removed: { at: at('2026-10-18'), by: 'Matt' } }]).length, 0);
});

test('derivedHash sorts ids by code unit, not by locale', () => {
  const d = { status: 'open' };
  const expected = EV.sha256(
    EV.stableStringify([
      ['B', d],
      ['a', d],
    ])
  );
  assert.equal(
    EV.derivedHash([
      { id: 'a', derived: d },
      { id: 'B', derived: d },
    ]),
    expected
  );
});

test('list edits: who did it is Matt or E.V.; a planned item taken off for the day cannot be checked until it is back', () => {
  const now = '2026-10-17T23:20:00Z';
  const day = {
    id: '2026-10-17',
    date: '2026-10-17',
    list: { items: [{ id: 'plan-t1', text: 'Pharm Ch 14 reading', tag: 'READING', minutes: 45 }] },
  };
  assert.equal(
    EV.listEdit(day, null, { action: 'add', text: 'Made-up item' }, { now, by: 'someone else' }).doc.added[
      'add-made-up-item'
    ].by,
    'E.V.'
  );
  const off = EV.listEdit(day, null, { action: 'remove', id: 'plan-t1' }, { now, by: 'Matt' });
  assert.equal(off.doc.skipped['plan-t1'].by, 'Matt');
  assert.throws(
    () => EV.listEdit(day, { id: '2026-10-17', ...off.doc }, { action: 'check', id: 'plan-t1' }, { now }),
    /off the list for the day; bring it back first/
  );
});

test('schemas: a reopen event is a weak spot event; an announcement with no Canvas post time keeps postedAt null', () => {
  const w = ws('made-up', { events: ev(at('2026-10-18'), { type: 'reopen', by: 'Matt' }) });
  assertValid({ op: 'set', collection: 'weakspots', id: w.id, data: EV.docData(w) });
  const raw = {
    courses: { 'NUR 112': 199214 },
    planner: [],
    announcements: [{ id: 10, title: 'Made up', message: '<p>Hi</p>', context_code: 'course_199214' }],
  };
  const a = EV.normalizeCanvas(raw, {}, { now: '2026-10-17T20:15:00Z' }).announcements[0];
  assert.equal(a.data.postedAt, null);
  assertValid({ op: 'set', collection: 'announcements', id: a.id, data: a.data });
});

test("B-160: what stays in E.V. core is the record's rules, under 2,500 lines; each split file is imported once", () => {
  const src = fs.readFileSync(new URL('../core/evcore.mjs', import.meta.url), 'utf8');
  assert.ok(src.split('\n').length < 2500, `${src.split('\n').length} lines`);
  const files = [...src.matchAll(/^import \{ (\w+) \} from '\.\/([\w-]+)\.mjs';$/gm)].map(m => m[2]);
  assert.deepEqual(files.sort(), [
    'canvas-rules',
    'conversation',
    'insights',
    'item-kinds',
    'library',
    'mirror',
    'notes',
    'prep',
    'sessions',
    'share',
    'skills',
  ]);
});

// B-155 to B-160: each split file is one factory with no imports, so it runs in the page as written; what it took out of
// E.V. core is moved, not copied, and E.V. core still exports every name callers use.
const SPLIT_FILES = [
  ['canvas-rules', 'makeCanvasRules', /function normalizeCanvas\(/, ['normalizeCanvas']],
  [
    'conversation',
    'makeConversation',
    /function greeting|function conversations|function earlierConversation/,
    ['greeting', 'conversations', 'earlierConversation', 'noteTitle'],
  ],
  [
    'insights',
    'makeInsights',
    /function readiness\(|function examRetro|function calibrate/,
    ['readiness', 'predictReadiness', 'answerStats', 'calibrate', 'examRetro', 'examViews', 'readinessAudit'],
  ],
  [
    'library',
    'makeLibrary',
    /function searchLibrary|function libraryChunks|function readMaterial/,
    ['searchLibrary', 'citeMaterial', 'readMaterial', 'libraryChunks', 'libraryIndex', 'liveMaterials', 'normCourse'],
  ],
  [
    'mirror',
    'makeMirror',
    /function (toMarkdown|buildBackup|restorePlan)\(/,
    ['toMarkdown', 'buildBackup', 'restorePlan'],
  ],
  [
    'prep',
    'makePrep',
    /function prepDay|function prepList|function prepEdit/,
    ['prepDay', 'prepList', 'prepEdit', 'prepKindOf', 'prepBringItems'],
  ],
  [
    'sessions',
    'makeSessions',
    /function sessionState|function closeSession|function intakeSession/,
    ['sessionState', 'closeSession', 'intakeSession', 'commentPrompt', 'parseComment', 'noteDelta'],
  ],
  ['share', 'makeShare', /function (shareableSet|sharePage)\(/, ['shareableSet', 'sharePage']],
  [
    'skills',
    'makeSkills',
    /function startSkill|function startWorkout|function weakspotCards/,
    ['skillSteps', 'startSkill', 'endSkill', 'startWorkout', 'workoutState', 'weakspotCards', 'cardsText'],
  ],
];
for (const [file, factory, moved, names] of SPLIT_FILES)
  test(`B-155 to B-160: core/${file}.mjs is one factory with no imports, moved out of E.V. core, which still exports its names`, async () => {
    const src = fs.readFileSync(new URL(`../core/${file}.mjs`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /^import /m, 'no imports: it runs in the page as written');
    assert.deepEqual(src.match(/^export .*/gm), [`export function ${factory}(core) {`]);
    const core = fs.readFileSync(new URL('../core/evcore.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(core, moved, 'moved, not copied');
    for (const n of names) assert.equal(typeof EV[n], 'function', n);
    assert.equal(typeof (await import(`../core/${file}.mjs`))[factory], 'function');
  });

// B-252 (D-251): the morning after an exam, its weak spots are not due; auto-park parks them that evening.
test('B-252: the day after an exam, its open weak spots are out of the due list and the review set; the next exam leads', () => {
  const E5 = { id: 'E5', course: 'NUR 112', kind: 'unit', date: '2026-11-05', title: 'Exam 5' };
  const docs = [
    ws('e4-old', { initial: { streak: 0, nextDue: '2026-10-19', recurrence: 1, misses: 0 } }),
    ws('e5-new', {
      exam: 'E5',
      objective: 'E5-1',
      initial: { streak: 0, nextDue: '2026-10-22', recurrence: 1, misses: 0 },
    }),
  ];
  const models = EV.buildWeakspots({ weakspots: docs, sets: [], answers: [], exams: [E4, E5] });
  const ids = xs => xs.map(w => w.id);
  // The day of the exam it is still due; the morning after, it is not.
  assert.deepEqual(ids(EV.rankDue(models, '2026-10-21', [E4, E5])), ['e4-old']);
  assert.deepEqual(ids(EV.rankDue(models, '2026-10-22', [E4, E5])), ['e5-new']);
  const r = EV.pickReviews({ date: '2026-10-22', dayType: 'off', exams: [E4, E5], weakspots: models, objectives: [] });
  assert.deepEqual(ids(r.picked), ['e5-new']);
});

// B-253 (D-251): auto-park parks a weak spot once for its exam; one he made active again after that stays active.
test('B-253: auto-park never re-parks a weak spot he made active again after its exam', () => {
  const E3 = { id: 'E3', course: 'NUR 112', kind: 'unit', date: '2026-10-01', title: 'Exam 3' };
  const docs = [
    // parked by the evening after Exam 3, then made active again by him ("revisit for ATI and the final")
    ws('kept', {
      exam: 'E3',
      objective: 'E3-1',
      events: {
        ...ev('2026-10-02T01:15:00Z', { type: 'park', by: 'E.V.' }, 'evening-cloud'),
        ...ev(at('2026-10-17'), { type: 'activate', by: 'owner' }),
      },
    }),
    // open since before the exam and never parked: the evening parks it
    ws('fresh', { exam: 'E3', objective: 'E3-2' }),
  ];
  const models = EV.buildWeakspots({ weakspots: docs, sets: [], answers: [], exams: [E3] });
  assert.equal(models.find(w => w.id === 'kept').derived.status, 'open');
  const w = EV.autoParkEvents({ weakspots: models, exams: [E3], date: '2026-10-18', now: '2026-10-18T01:15:00Z' });
  assert.deepEqual(
    w.map(x => x.id),
    ['fresh']
  );
  // and the one he kept is due in the review like any open weak spot
  assert.ok(EV.rankDue(models, '2026-10-18', [E3]).some(x => x.id === 'kept'));
});

test('B-263: planFor finds the plan he names, else the target exam, else the soonest upcoming exam', () => {
  const exams = [
    { id: 'E4', date: '2026-10-21', title: 'Exam 4' },
    { id: 'ATI-DOSE', date: '2026-11-02', title: 'ATI Proctored Dosage Assessment' },
    { id: 'E5', date: '2026-11-16', title: 'Exam 5: Functional Ability' },
  ];
  const plans = [
    { id: 'E4', exam: 'E4', title: 'Exam 4 Study Plan', days: [] },
    { id: 'ATI-DOSE', exam: 'ATI-DOSE', title: 'Dosage calculation: ATI and Dosage Exam 1', days: [] },
  ];
  const date = '2026-10-23';
  const E5 = exams[2];
  assert.equal(EV.planFor({ plans, exams, target: E5, query: 'dosage calculations exam', date }).id, 'ATI-DOSE');
  assert.equal(EV.planFor({ plans, exams, target: E5, query: 'exam 4', date }).id, 'E4');
  // the target exam (E5) has no plan and no query: the soonest upcoming exam's plan, not the past Exam 4's
  assert.equal(EV.planFor({ plans, exams, target: E5, date }).id, 'ATI-DOSE');
  assert.equal(EV.planFor({ plans: [plans[0]], exams, target: E5, date }), null);
});

test('B-392: a long title shortens at a word with an ellipsis, never inside a time', () => {
  const t = 'Informatics activity: practicing charting in a made-up EHR (due 11:59pm)';
  assert.equal(EV.shortTitle(t, 200), t);
  for (const max of [20, 32, 40, 55, 62, 66, 70]) {
    const s = EV.shortTitle(t, max);
    assert.ok(s.length <= max + 1, s);
    assert.ok(s.endsWith('…'), s);
    assert.ok(!/\b11…|\b11:5|\(…|[,:;(]…$/.test(s), 'cut inside the time or after a colon: ' + s);
    assert.ok(t.startsWith(s.slice(0, -1)), 'a prefix of whole words: ' + s);
  }
  // the time stays whole when the cut falls after it, and an unclosed "(" goes with what follows it
  const u = 'Quiz (due 11:59pm tomorrow) on fluids and electrolytes';
  assert.equal(EV.shortTitle(u, 30), 'Quiz (due 11:59pm tomorrow) on…');
  assert.equal(EV.shortTitle(u, 22), 'Quiz…');
  assert.equal(
    EV.shortTitle('Made-up unit quiz: fluids and electrolytes, part two', 40),
    'Made-up unit quiz: fluids and…'
  );
  assert.equal(EV.shortTitle('Short title', 40), 'Short title');
});

test('B-392: one seven-day graded count, today and the six days after, for her answer, the banner and the pane', () => {
  const today = '2026-10-25';
  const dates = [
    { id: 'a', date: '2026-10-25', title: 'Care plan', kind: 'due', graded: true },
    { id: 'b', date: '2026-10-26', title: 'Unit quiz', kind: 'due', graded: true },
    { id: 'c', date: '2026-10-27', title: 'Clinical day', kind: 'clinical' },
    { id: 'd', date: '2026-10-28', title: 'Reading', kind: 'due', graded: false },
    {
      id: 'e',
      date: '2026-10-29',
      title: 'Taken off',
      kind: 'due',
      graded: true,
      removed: { at: '2026-10-24T12:00:00Z' },
    },
    { id: 'f', date: '2026-10-31', title: 'Last day in the window', kind: 'due', graded: true },
    { id: 'g', date: '2026-11-01', title: 'Day eight', kind: 'due', graded: true },
    { id: 'h', date: '2026-10-24', title: 'Yesterday', kind: 'due', graded: true },
    { id: 'x', date: '2026-10-30', title: 'Calendar exam', kind: 'exam' },
  ];
  const exams = [
    { id: 'e1', date: '2026-10-25', title: 'Made-up exam' },
    { id: 'e2', date: '2026-10-30', title: 'Same day as the calendar exam' },
    { id: 'e3', date: '2026-11-02', title: 'Past the window' },
  ];
  const g = EV.gradedWeek(dates, exams, today);
  assert.deepEqual(
    g.map(d => d.id),
    ['a', 'exam-e1', 'b', 'x', 'f']
  );
  assert.equal(EV.gradedWeek(dates, exams, today, 7).length, 5);
  // a later week counts its own seven days the same way
  assert.deepEqual(
    EV.gradedWeek(dates, exams, '2026-11-01').map(d => d.id),
    ['g', 'exam-e3']
  );
  assert.equal(EV.gradedWeek([], [], today).length, 0);
  // the page has one counter: her answer, the banner and the pane all call it over WEEK_DAYS
  const src = ['10-today.js', '70-ev-quick-asks.js', '90-render.js']
    .map(f => fs.readFileSync(new URL('../page/app/' + f, import.meta.url), 'utf8'))
    .join('\n');
  assert.equal((src.match(/E\.gradedWeek\(S\.dates, S\.exams, [^)]*WEEK_DAYS\)/g) || []).length, 4);
  assert.ok(!/E\.addDays\(today, 7\)/.test(src.split("what's due this week")[1].split("'give me 5 more'")[0]));
});

test('B-392: a heads-up row says its day once', () => {
  const dates = [
    { id: 'q', date: '2026-10-26', title: 'Unit quiz on fluids', kind: 'due', graded: true },
    { id: 'h', date: '2026-10-26', title: 'Charting activity (due 11:59pm)', kind: 'due', graded: true },
  ];
  const d = EV.planDay({ date: '2026-10-25', dates, exams: [], plans: [], weakspots: [], objectives: [] });
  const soon = Object.fromEntries(d.blocks.filter(b => /^soon-/.test(b.id)).map(b => [b.id, b.title]));
  assert.equal(soon['soon-q'], 'Unit quiz on fluids (due tomorrow)', 'text without its row keeps the day');
  assert.equal(soon['soon-h'], 'Charting activity (due 11:59pm)', 'never "(due 11:59pm) (due tomorrow)"');
  // on the page's rows, which show the day beside the words, the words drop it
  assert.equal(EV.rowText({ id: 'soon-q', text: soon['soon-q'] }), 'Unit quiz on fluids');
  assert.equal(EV.rowText({ id: 'soon-h', text: soon['soon-h'] }), 'Charting activity (due 11:59pm)');
  assert.equal(EV.rowText({ id: 'date-q', text: 'Reading (~20 min)' }), 'Reading');
  assert.equal(EV.headsUpTitle('Quiz'), 'Quiz (due tomorrow)');
});
