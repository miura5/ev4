// E.V. core tests (B-05): every v3 rule with its test, ported to the v4 documents, plus a test for each split document
// (answers, dayedits, dateedits, planedits, materialedits) and a check that every write core emits validates against
// its collection's schema. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import EV from '../core/evcore.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { describeErrors } from '../core/validate.mjs';

const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url)));
EV.configure(spec);
const validate = loadValidator();

const at = (date, hm = '15:00') => `${date}T${hm}:00Z`; // 15:00Z = 10:00 Central (CDT)
const key = (iso, writer = 'page') => EV.eventKey(writer, iso);
const ev = (iso, e, writer = 'page') => ({ [key(iso, writer)]: { ...e } });
const ws = (id, extra = {}) => ({ id, schema: 1, writer: 'page', at: at('2026-10-15'), source: 'test', topic: id.replace(/-/g, ' '), objective: 'E4-3', exam: 'E4', course: 'NUR 112', kind: 'concept', addedBy: 'test', initial: { streak: 0, nextDue: '2026-10-16', recurrence: 1, misses: 0 }, events: {}, ...extra });
const att = (date, correct, extra = {}) => ({ at: at(date, extra.hm || '15:00'), date, correct, ...extra });
const E4 = { id: 'E4', course: 'NUR 112', kind: 'unit', date: '2026-10-21', title: 'Exam 4' };
/** Validates a planned write: a set as the whole document; an update merged (nested maps) into the document it updates. */
function assertValid(w, existing = null) {
  const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && a && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return o; };
  const doc = w.op === 'update' ? merge(EV.docData(existing), w.data) : w.data;
  const r = validate(w.collection, doc, { id: w.id });
  assert.ok(r.ok, describeErrors(`${w.collection}/${w.id}`, r));
}

test('spec loads and the release lines up', () => {
  assert.equal(EV.VERSION, 'v' + spec.specVersion);
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
  for (const s of ['', 'abc', 'Hypokalemia — K⁺ < 3.5 mEq/L', 'x'.repeat(1000)]) assert.equal(EV.sha256(s), crypto.createHash('sha256').update(s).digest('hex'), s.slice(0, 20));
  assert.deepEqual(EV.envelope('page', 'Told E.V.', '2026-10-18T01:00:00Z'), { schema: 1, writer: 'page', at: '2026-10-18T01:00:00.000Z', source: 'Told E.V.' });
});

test('question checks: single, select-all, matrix and the bad cases', () => {
  const single = { id: 'q1', type: 'single', objective: 'E4-3', cjStep: 'analyze-cues', stem: 'Which finding needs follow-up first?', options: ['A', 'B', 'C', 'D'], correct: [2], rationales: ['a', 'b', 'c', 'd'] };
  assert.ok(EV.validateItem(single, { strict: true }).ok);
  assert.ok(!EV.validateItem({ ...single, correct: [4] }).ok);
  assert.ok(!EV.validateItem({ ...single, correct: [0, 1] }).ok);
  assert.ok(!EV.validateItem({ ...single, stem: 'Select two findings that need follow-up.' }).ok, 'select N is not allowed');
  assert.ok(!EV.validateItem({ ...single, rationales: ['a'] }, { strict: true }).ok, 'strict needs a rationale per option');
  assert.ok(EV.validateItem({ ...single, rationales: ['a'] }).ok, 'non-strict only warns');
  assert.ok(!EV.validateItem({ ...single, cjStep: 'guessing' }).ok);
  assert.ok(!EV.validateItem({ ...single, options: ['A', 'a', 'C'], correct: [0], rationales: ['', '', ''] }).ok, 'duplicate options');
  const sata = { ...single, id: 'q2', type: 'sata', options: ['A', 'B', 'C', 'D', 'E'], correct: [0, 3], rationales: ['a', 'b', 'c', 'd', 'e'] };
  assert.ok(EV.validateItem(sata, { strict: true }).ok);
  assert.ok(!EV.validateItem({ ...sata, correct: [1] }).ok, 'select-all needs two or more');
  const matrix = { id: 'q3', type: 'matrix', objective: 'E4-3', cjStep: 'recognize-cues', stem: 'For each finding in an 80-year-old, mark expected or unexpected.', matrix: { columns: ['Expected', 'Unexpected'], rows: [{ text: 'Thinner skin', correct: 0, rationale: 'r' }, { text: 'New confusion', correct: 1, rationale: 'r' }, { text: 'Slower reaction time', correct: 0, rationale: 'r' }] } };
  assert.ok(EV.validateItem(matrix, { strict: true }).ok);
  assert.ok(!EV.validateItem({ ...matrix, matrix: { columns: ['E', 'U'], rows: matrix.matrix.rows.slice(0, 2) } }).ok, 'matrix needs 3+ rows');
  assert.ok(!EV.validateItem({ ...matrix, matrix: { ...matrix.matrix, rows: [...matrix.matrix.rows.slice(0, 2), { text: 'x', correct: 3, rationale: 'r' }] } }).ok);
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
  assert.equal(d.status, 'reviewed'); assert.equal(d.solidBy, 'review');
});
test('spaced review: right twice the same day only counts once', () => {
  const d = EV.deriveWeakspot(ws('a'), [att('2026-10-12', true, { hm: '14:00' }), att('2026-10-12', true, { hm: '18:00' })], { examDate: '2026-10-30' });
  assert.equal(d.status, 'open'); assert.equal(d.streak, 1); assert.equal(d.nextDue, '2026-10-15');
});
test('spaced review: wrong then right the same day advances once (v2 behavior)', () => {
  const d = EV.deriveWeakspot(ws('a'), [att('2026-10-17', false, { hm: '06:31' }), att('2026-10-17', true, { hm: '14:48' })], { examDate: '2026-10-21' });
  assert.deepEqual([d.status, d.streak, d.nextDue, d.misses], ['open', 1, '2026-10-18', 1]);
});
test('spaced review: near the exam the interval is one day and never lands on exam day', () => {
  assert.equal(EV.deriveWeakspot(ws('a'), [att('2026-10-17', true)], { examDate: '2026-10-21' }).nextDue, '2026-10-18');
  assert.equal(EV.deriveWeakspot(ws('a'), [att('2026-10-12', true)], { examDate: '2026-10-21' }).nextDue, '2026-10-15');
  assert.equal(EV.deriveWeakspot(ws('a'), [att('2026-10-18', true)], { examDate: '2026-10-20' }).nextDue, '2026-10-19');
});
test('spaced review: a miss after solid reopens it and raises recurrence', () => {
  const d = EV.deriveWeakspot(ws('a'), [att('2026-10-12', true), att('2026-10-13', true), att('2026-10-15', false)], { examDate: '2026-10-30' });
  assert.deepEqual([d.status, d.streak, d.recurrence, d.nextDue], ['open', 0, 2, '2026-10-16']);
});
test('D-041 pre-read: the first check after the reading decides it', () => {
  const pre = ws('p', { preRead: true, readingDue: '2026-10-17' });
  assert.equal(EV.deriveWeakspot(pre, [att('2026-10-18', true)]).solidBy, 'first-check-after-reading');
  const missed = EV.deriveWeakspot(pre, [att('2026-10-18', false)]);
  assert.deepEqual([missed.status, missed.preRead, missed.nextDue, missed.misses], ['open', false, '2026-10-19', 1]);
});
test('events (keyed <writer>-<time>): park, activate, owner solid, notes done, seen again', () => {
  assert.equal(EV.deriveWeakspot(ws('a', { events: ev(at('2026-10-16'), { type: 'park', by: 'E.V.' }, 'evening-cloud') }), [att('2026-10-17', false)]).status, 'parked');
  const act = EV.deriveWeakspot(ws('a', { events: { ...ev(at('2026-10-16'), { type: 'park' }), ...ev(at('2026-10-17'), { type: 'activate', by: 'owner' }) } }), []);
  assert.deepEqual([act.status, act.nextDue], ['open', '2026-10-17']);
  assert.equal(EV.deriveWeakspot(ws('a', { events: ev(at('2026-10-16'), { type: 'solid', by: 'owner' }) }), []).solidBy, 'owner');
  assert.equal(EV.deriveWeakspot(ws('n', { kind: 'note', events: ev(at('2026-10-16'), { type: 'done', by: 'owner' }) }), []).status, 'reviewed');
  const seen = EV.deriveWeakspot(ws('a'), [att('2026-10-12', true), att('2026-10-13', true)], {});
  assert.equal(seen.status, 'reviewed');
  const seenAgain = EV.deriveWeakspot(ws('a', { events: ev(at('2026-10-14'), { type: 'seen', by: 'Study Watch' }, 'filing') }), [att('2026-10-12', true), att('2026-10-13', true)]);
  assert.deepEqual([seenAgain.status, seenAgain.recurrence, seenAgain.nextDue], ['open', 2, '2026-10-15']);
});
test('events from two writers interleave with answers by time', () => {
  // park from the evening run at 8:15pm, then the page reactivates the next morning, then a right answer
  const w = ws('a', { events: { ...ev('2026-10-17T01:15:00Z', { type: 'park' }, 'evening-cloud'), ...ev('2026-10-17T14:00:00Z', { type: 'activate' }) } });
  const whileParked = { at: '2026-10-17T05:00:00Z', date: '2026-10-17', correct: false };
  const d = EV.deriveWeakspot(w, [att('2026-10-16', true), whileParked, att('2026-10-17', true)]);
  assert.deepEqual([d.status, d.streak, d.answered, d.misses], ['open', 1, 2, 0], 'the miss while parked does not count');
  const unordered = EV.deriveWeakspot(w, [att('2026-10-17', true), whileParked, att('2026-10-16', true)]);
  assert.deepEqual(unordered, d, 'attempt order does not matter');
});

// ---------------------------------------------------------------- answers in their own document
const SET = { id: 'review-2026-10-18', kind: 'review', items: [{ id: 'q1', weakspotId: 'made', objective: 'E4-3', stem: 'A made-up stem long enough', options: ['a', 'b'], correct: [0] }, { id: 'q2', objective: 'E4-3', stem: 'Another made-up stem here', options: ['a', 'b'], correct: [0] }] };
const answersDoc = (setId, answers) => ({ id: setId, schema: 1, writer: 'page', at: at('2026-10-17'), source: 'E.V. Home', setId, answers });

test('answers: every attempt is kept under its item, keyed by writer and time, and read oldest first', () => {
  const a = answersDoc(SET.id, { q1: { [key(at('2026-10-18', '16:00'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-18', '16:00') }, [key(at('2026-10-17'))]: { chosen: [1], correct: false, score: 0, at: at('2026-10-17') } } });
  const { all, byWeakspot } = EV.collectAttempts([SET], [a]);
  assert.deepEqual(all.map(x => [x.itemId, x.correct]), [['q1', false], ['q1', true]]);
  assert.equal(byWeakspot.made.length, 2);
  assert.deepEqual(EV.answeredItems(SET, [a]), ['q1']);
  assert.deepEqual(EV.collectAttempts([SET], []).all, [], 'a set without answers has no attempts');
  assert.equal(EV.collectAttempts([SET], [answersDoc('other', a.answers)]).all.length, 0, 'answers are matched to their own set');
});

test('the answer that created a weak spot is not one of its reviews', () => {
  const w = ws('made', { origin: { set: SET.id, item: 'q1', at: at('2026-10-17') }, initial: { streak: 0, nextDue: '2026-10-18', recurrence: 1, misses: 0 } });
  const a = answersDoc(SET.id, { q1: { [key(at('2026-10-17'))]: { chosen: [1], correct: false, at: at('2026-10-17'), createdWeakspot: 'made' } } });
  const { byWeakspot } = EV.collectAttempts([SET], [a]);
  assert.equal(byWeakspot.made.length, 1);
  assert.deepEqual(EV.deriveWeakspot(w, byWeakspot.made).nextDue, '2026-10-18');
});

test('answering: review, new check miss, repeat miss, pre-read miss; the attempt goes to answers/<setId>, nothing derived is written', () => {
  const set = { id: 'review-2026-10-18', kind: 'review', items: [] };
  const target = { ...ws('t'), derived: EV.deriveWeakspot(ws('t'), [att('2026-10-17', true)], { examDate: '2026-10-21' }) };
  const now = '2026-10-18T15:00:00Z';
  let r = EV.planAnswer({ set, item: { id: 'q1', weakspotId: 't', objective: 'E4-3', type: 'single', options: ['a', 'b'], correct: [0] }, chosen: [0], now, weakspots: [target], exams: [E4], byWeakspot: { t: [att('2026-10-17', true, { weakspotId: 't' })] } });
  assert.equal(r.correct, true);
  assert.equal(r.state.status, 'reviewed'); assert.equal(r.weakspotId, 't');
  assert.match(r.outcome, /marked solid/);
  assert.equal(r.attemptKey, 'page-20261018-150000000');
  assert.deepEqual(r.writes.map(w => [w.op, w.collection, w.id]), [['set', 'answers', set.id]], 'the first answer creates the set\'s answers document and nothing else');
  assert.deepEqual(r.writes[0].data.answers, { q1: { [r.attemptKey]: r.answer } });
  assertValid(r.writes[0]);
  // With an answers document already there, the attempt is an update that adds one key.
  const existing = answersDoc(set.id, { q0: { [key(at('2026-10-18', '14:00'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-18', '14:00') } } });
  r = EV.planAnswer({ set, item: { id: 'q1', weakspotId: 't', objective: 'E4-3', type: 'single', options: ['a', 'b'], correct: [0] }, chosen: [1], now, weakspots: [target], exams: [E4], answersDoc: existing, byWeakspot: {} });
  assert.equal(r.writes[0].op, 'update'); assertValid(r.writes[0], existing);
  // A missed new check creates a weak spot (facts only) and tags the answer as its origin.
  r = EV.planAnswer({ set, item: { id: 'q2', kind: 'check', objective: 'E4-2', topic: 'Caring behaviors', type: 'single', options: ['a', 'b'], correct: [0] }, chosen: [1], now, weakspots: [target], exams: [E4] });
  const created = r.writes.find(w => w.collection === 'weakspots' && w.op === 'set');
  assert.ok(created); assert.equal(r.answer.createdWeakspot, created.id); assert.equal(created.data.initial.nextDue, '2026-10-19');
  assert.equal(created.data.writer, 'page'); assertValid(created);
  // Missing the same topic again: seen again, not a duplicate.
  const twin = { ...ws('caring', { objective: 'E4-2', topic: 'Caring behaviors' }), derived: { status: 'open', streak: 0, nextDue: '2026-10-19', recurrence: 1, misses: 0 } };
  r = EV.planAnswer({ set, item: { id: 'q3', kind: 'check', objective: 'E4-2', topic: 'Caring behaviors', type: 'single', options: ['a', 'b'], correct: [0] }, chosen: [1], now, weakspots: [twin], exams: [E4] });
  assert.equal(r.answer.matched, true); assert.equal(r.state.recurrence, 2); assert.equal(r.writes.length, 1);
  // A miss on unread chapters is a preview (D-041).
  const plan = EV.planFromCards([{ days: [['Sun 10/18', '', [['Read Pharm Ch 27 (macrolides)']]]] }], { examId: 'E4', year: 2026, now });
  r = EV.planAnswer({ set, item: { id: 'q4', kind: 'drill', objective: 'E4-7', topic: 'Macrolide teaching', chapters: ['Pharm 27'], type: 'single', options: ['a', 'b'], correct: [0] }, chosen: [1], now, weakspots: [], exams: [E4], plans: [EV.planView(plan, null)] });
  const pre = r.writes.find(w => w.collection === 'weakspots');
  assert.equal(pre.data.preRead, true); assert.match(r.outcome, /preview/); assertValid(pre);
  for (const w of r.writes) assert.ok(!JSON.stringify(w.data).includes('"derived"'), 'derived is never written');
});

test('derived is never stored: buildWeakspots computes it, derivedHash fingerprints it and moves with an answer', () => {
  const w = ws('made', { initial: { streak: 0, nextDue: '2026-10-18', recurrence: 1, misses: 0 } });
  const a1 = answersDoc(SET.id, { q1: { [key(at('2026-10-18'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-18') } } });
  const m1 = EV.buildWeakspots({ weakspots: [w], sets: [SET], answers: [a1], exams: [E4] });
  assert.equal(m1[0].derived.streak, 1);
  const h1 = EV.derivedHash(m1);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(EV.derivedHash([...m1].reverse()), h1, 'order does not matter');
  assert.equal(EV.derivedHash(EV.buildWeakspots({ weakspots: [w], sets: [SET], answers: [a1], exams: [E4] })), h1, 'deterministic');
  const a2 = answersDoc(SET.id, { q1: { ...a1.answers.q1, [key(at('2026-10-19'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-19') } } });
  const m2 = EV.buildWeakspots({ weakspots: [w], sets: [SET], answers: [a2], exams: [E4] });
  assert.equal(m2[0].derived.status, 'reviewed');
  assert.notEqual(EV.derivedHash(m2), h1);
  assert.equal(EV.weakspotFacts({ ...w, derived: { status: 'x' } }).derived, undefined, 'facts never carry a stored derived block');
});

test('review load: base by day type, exam flex in the 3 days before, caps', () => {
  const models = Array.from({ length: 16 }, (_, i) => ({ ...ws('w' + i), derived: { status: 'open', streak: i < 6 ? 1 : 0, preRead: i >= 12, nextDue: '2026-10-18' } }));
  // need: 6 x 1 + 6 x 2 + 4 pre-read x 1 = 22 over 3 days -> 8 a day, below base 10
  let L = EV.reviewLoad({ date: '2026-10-18', dayType: 'off', exams: [E4], weakspots: models });
  assert.deepEqual([L.load, L.flex.need, L.flex.perDay], [10, 22, 8]);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...ws('m' + i), derived: { status: 'open', streak: 0, nextDue: '2026-10-18' } }));
  L = EV.reviewLoad({ date: '2026-10-18', dayType: 'off', exams: [E4], weakspots: many }); // 60 / 3 = 20 -> cap 15
  assert.equal(L.load, 15);
  L = EV.reviewLoad({ date: '2026-10-20', dayType: 'clinical', exams: [E4], weakspots: many }); // clinical day before exam: cap 8
  assert.equal(L.load, 8);
  assert.equal(EV.reviewLoad({ date: '2026-10-21', dayType: 'exam', exams: [E4], weakspots: many }).load, 0);
  assert.equal(EV.reviewLoad({ date: '2026-10-13', dayType: 'clinical', exams: [E4], weakspots: [] }).load, 3);
});

test('due ranking: overdue, nearest exam, recurrence, misses, oldest', () => {
  const mk = (id, d, extra = {}) => ({ ...EV.weakspotFacts(ws(id, extra)), derived: { status: 'open', streak: 0, nextDue: d.next, recurrence: d.rec || 1, misses: d.miss || 0 } });
  const list = [mk('late', { next: '2026-10-17' }), mk('rec2', { next: '2026-10-18', rec: 2 }), mk('old', { next: '2026-10-18' }, { at: at('2026-10-10') }), mk('new', { next: '2026-10-18' }), mk('e5', { next: '2026-10-18', rec: 5 }, { exam: 'E5', objective: 'E5-1' }), mk('notyet', { next: '2026-10-19' })];
  const order = EV.rankDue(list, '2026-10-18', [E4, { id: 'E5', date: '2026-11-16' }]).map(w => w.id);
  assert.deepEqual(order, ['late', 'rec2', 'old', 'new', 'e5']);
});

test('plans as data: tasks, chapters, reading state and the pre-read rule; ticks live in planedits', () => {
  const cards = [{ title: 'Week 2', days: [
    ['Sat 10/17', 'Last new reading', [['Ch 42 Fluid, Electrolytes, Acid-Base: high-yield list + skim (~45 min)'], ['Pharm Ch 14, p. 167–171 (nutritional support)'], ['Drill 6: Ch 42, 45 + Pharm Ch 14, 50 (nutrition)', 'drill'], ['Terminology drill: electrolytes']]],
    ['Sun 10/18', 'Sim day', [['Exam Sim tab: all Exam 4 content, timed', 'drill'], ['Drill 7: weak spots from the sim', 'drill'], ['Read Pharm Ch 27 (macrolides) + Ch 28 (tetracyclines)']]],
  ] }];
  const p = EV.planFromCards(cards, { examId: 'E4', year: 2026, now: at('2026-10-16') });
  assert.ok(!('done' in p), 'a plan Fact carries no ticks');
  assertValid({ op: 'set', collection: 'plans', id: 'E4', data: p });
  const tasks = EV.planTasks(p);
  assert.equal(tasks.length, 7);
  assert.deepEqual(tasks.map(t => t.kind), ['reading', 'reading', 'drill', 'terminology', 'sim', 'drill', 'reading']);
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
  const untick = EV.planTick({ id: 'E4', ...tick.data }, 'E4', tasks[0].id, { done: false, now: at('2026-10-17', '16:00') });
  assert.deepEqual(untick.data.ticks, {}); assert.equal(untick.data.updatedAt, '2026-10-17T16:00:00.000Z');
  // The next day the reading counts as done.
  assert.equal(EV.preReadFor(q, [view(null)], '2026-10-18'), null);
  assert.ok(EV.preReadFor({ chapters: ['Pharm 28'] }, [view(null)], '2026-10-17'));
  // A plan drill is done once its practice set is fully answered (answers/<setId>).
  const drillTask = { ...tasks[2] };
  const set = { id: 'E4-drill-6', planTaskId: drillTask.id, items: [{ id: 'd1' }, { id: 'd2' }] };
  const one = answersDoc(set.id, { d1: { [key(at('2026-10-17'))]: { at: at('2026-10-17'), correct: true } } });
  assert.equal(EV.taskDone(view(null), drillTask, '2026-10-17', [set], [one]), false);
  const both = answersDoc(set.id, { ...one.answers, d2: { [key(at('2026-10-17', '16:00'))]: { at: at('2026-10-17', '16:00'), correct: false } } });
  assert.equal(EV.taskDone(view(null), drillTask, '2026-10-17', [set], [both]), true);
});

test('day plan: budget cuts optional work first and never cuts graded work or exams', () => {
  const plan = EV.planFromCards([{ days: [['Sun 10/18', '', [['Read Ch 99 (big chapter)'], ['Terminology drill'], ['Optional lab'], ['Drill 9: Ch 99', 'drill'], ['Engage module due 11:59pm', 'graded']]]] }], { examId: 'E9', year: 2026 });
  const exams = [{ id: 'BIO-E3', course: 'BIO 201', kind: 'unit', date: '2026-10-18', title: 'BIO 201 Lecture Exam 3' }];
  EV.configure({ ...spec, constants: { ...spec.constants, dayBudgetMinutes: { ...spec.constants.dayBudgetMinutes, off: 200 } } });
  const d = EV.planDay({ date: '2026-10-18', dates: [], exams, plans: [plan], weakspots: [], objectives: [] });
  EV.configure(spec);
  const byId = Object.fromEntries(d.blocks.map(b => [b.title, b]));
  assert.equal(d.dayType, 'off');
  assert.ok(byId['BIO 201 Lecture Exam 3'].required && !byId['BIO 201 Lecture Exam 3'].deferred);
  assert.ok(!byId['Engage module due 11:59pm'].deferred);
  assert.ok(byId['Optional lab'].deferred && byId['Terminology drill'].deferred, 'optional and terminology go first');
  assert.ok(!byId['Read Ch 99 (big chapter)'].deferred, 'reading is kept');
  assert.ok(d.budget.planned <= 200);
  assert.ok(d.deferred.some(x => /Optional lab/.test(x.title)));
});

test('day plan honors planedits ticks: a ticked task costs no minutes', () => {
  const plan = { ...EV.planFromCards([{ days: [['Sun 10/18', '', [['Read Ch 99 (big chapter)']]]] }], { examId: 'E9', year: 2026 }), id: 'E9' };
  const task = EV.planTasks(plan)[0];
  const untouched = EV.planDay({ date: '2026-10-18', plans: [plan], planedits: [] });
  const ticked = EV.planDay({ date: '2026-10-18', plans: [plan], planedits: [{ id: 'E9', ...EV.planTick(null, 'E9', task.id, { now: at('2026-10-18') }).data }] });
  const block = d => d.blocks.find(b => b.taskId === task.id);
  assert.deepEqual([block(untouched).done, block(untouched).minutes], [false, 45]);
  assert.deepEqual([block(ticked).done, block(ticked).minutes], [true, 0]);
});

test('day type comes from exams and dates', () => {
  const dates = [{ id: 'c', date: '2026-10-20', kind: 'clinical', course: 'NUR 112', title: 'Clinical' }, { id: 'v', date: '2026-10-19', kind: 'validation', course: 'NUR 112', title: 'Group ID validation' }];
  assert.equal(EV.dayType({ date: '2026-10-21', dates, exams: [E4] }), 'exam');
  assert.equal(EV.dayType({ date: '2026-10-20', dates, exams: [E4] }), 'clinical');
  assert.equal(EV.dayType({ date: '2026-10-19', dates, exams: [E4] }), 'validation');
  assert.equal(EV.dayType({ date: '2026-10-18', dates, exams: [E4, { id: 'BIO-E3', course: 'BIO 201', kind: 'unit', date: '2026-10-18' }] }), 'off');
  assert.equal(EV.dayType({ date: '2026-10-22', dates, exams: [E4] }), 'class');
  assert.equal(EV.dayType({ date: '2026-10-20', dates, dateedits: [{ id: 'c', removed: { at: at('2026-10-18'), by: 'Matt' } }], exams: [E4] }), 'class', 'a date taken off in dateedits is gone');
});

test('Study Watch intake: repeats bump, near-repeats ask, non-objectives become ideas, gaps become note to-dos; every write validates', () => {
  const existing = [{ ...ws('ws-k', { objective: 'E4-3', topic: 'Hypokalemia findings' }), derived: { status: 'open' } }, { ...ws('ws-fluid', { objective: 'E4-3', topic: 'Fluid volume excess signs' }), derived: { status: 'open' } }];
  const file = { id: '2026-10-18-0900-Ch-42', date: '2026-10-18', startedAt: '2026-10-18T14:00:00Z', endedAt: '2026-10-18T14:20:00Z', note: 'Ch 42', minutes: 20, summary: 's', weakSpots: [{ objective: 'E4-3', topic: 'Hypokalemia findings' }, { objective: 'E4-3', topic: 'Fluid volume excess' }, { objective: 'E4-3', topic: 'Acid-base compensation' }, { topic: 'Why the kidneys hold sodium' }], connections: ['Potassium links insulin and the ECG'], noteTodos: ['Fill in the ABG table'] };
  const objectives = [{ id: 'E4-3' }];
  let r = EV.intakeSession(file, { weakspots: existing, objectives, now: '2026-10-18T15:00:00Z' });
  assert.equal(r.questions.length, 1, 'near-repeat asks');
  r = EV.intakeSession(file, { weakspots: existing, objectives, now: '2026-10-18T15:00:00Z', decisions: { ws1: 'same' } });
  const cols = r.writes.map(w => w.collection + ':' + w.op);
  const bump = r.writes.find(w => w.id === 'ws-k' && w.data.events);
  assert.ok(bump);
  assert.deepEqual(Object.keys(bump.data.events), ['filing-20261018-150000000'], 'filed by the filing role, keyed by writer and time');
  assert.ok(r.writes.some(w => w.id === 'ws-fluid' && w.data.events));
  assert.equal(cols.filter(c => c === 'weakspots:set').length, 2, 'acid-base new + one note to-do');
  assert.equal(cols.filter(c => c === 'ideas:set').length, 2, 'unconfirmed objective + connection');
  const byId = Object.fromEntries(existing.map(({ derived, ...doc }) => [doc.id, doc])); // stored documents carry no derived
  for (const w of r.writes) { assert.equal(w.op === 'set' ? w.data.writer : 'filing', 'filing'); assertValid(w, byId[w.id]); }
  assert.ok(EV.intakeSession(file, { sessions: [{ id: '2026-10-18-0900-Ch-42' }] }).skip);
});

test('Canvas: Central dates, graded flags, change detection; documents carry the canvas-sync envelope', () => {
  const raw = { courses: { 'NUR 112': 199214 }, planner: [{ plannable_id: 1, plannable_type: 'assignment', course_id: 199214, plannable: { title: 'Older Adult', due_at: '2026-11-17T05:59:59Z', points_possible: 10 } }], announcements: [{ id: 9, title: 'Week of 10/19', message: '<p>Monday lab: <b>Head-to-Toe</b></p>', context_code: 'course_199214', posted_at: '2026-10-15T14:00:00Z' }] };
  let r = EV.normalizeCanvas(raw, {}, { now: '2026-10-17T20:15:00Z' });
  assert.equal(r.dates[0].data.date, '2026-11-16');
  assert.equal(r.dates[0].data.graded, true);
  assert.equal(r.dates[0].data.writer, 'canvas-sync');
  assert.equal(r.announcements[0].data.text, 'Monday lab: Head-to-Toe');
  assertValid({ op: 'set', collection: 'dates', id: r.dates[0].id, data: r.dates[0].data });
  assertValid({ op: 'set', collection: 'announcements', id: r.announcements[0].id, data: r.announcements[0].data });
  r = EV.normalizeCanvas(raw, { dates: [{ id: 'canvas-1', ...r.dates[0].data }], announcements: [{ id: 'canvas-9' }] });
  assert.equal(r.dates.length + r.announcements.length, 0, 'unchanged items are skipped');
  // A hand-entered date that already carries the Canvas id is updated in place, never duplicated.
  const hand = { id: 'nur-2026-11-16-older-adult', canvasId: 1, date: '2026-11-15', dueAt: '2026-11-16T05:59:59Z', title: 'Older Adult (ATI)', kind: 'due' };
  r = EV.normalizeCanvas(raw, { dates: [hand] });
  assert.equal(r.dates.length, 1); assert.equal(r.dates[0].id, 'nur-2026-11-16-older-adult'); assert.equal(r.dates[0].op, 'update'); assert.equal(r.dates[0].data.date, '2026-11-16');
  assert.ok(!('title' in r.dates[0].data), 'the hand-written title is kept');
});

test('lint finds possible identifiers, duplicates and orphans (answers in their own document)', () => {
  const issues = EV.lint({ weakspots: [ws('a'), ws('b', { topic: 'a' })], sets: [{ id: 's', items: [{ id: 'q', weakspotId: 'gone', stem: 'A real enough stem here', options: ['a', 'b'], correct: [0], rationales: ['r', 'r'], cjStep: 'take-action', objective: 'E4-3' }] }], answers: [answersDoc('s', { missing: { [key(at('2026-10-17'))]: { at: at('2026-10-17'), correct: true } } })], journal: [{ id: 'j', text: 'Patient in room 12 was confused' }], objectives: [{ id: 'E4-3' }], exams: [E4] });
  const codes = issues.map(i => i.code);
  assert.ok(codes.includes('possible-identifier'));
  assert.ok(codes.includes('duplicate'));
  assert.ok(codes.includes('orphan-item'));
  assert.ok(issues.some(i => i.code === 'orphan-answer' && i.ref === 'answers/s'));
});

test('readiness prediction is deterministic and explains itself', () => {
  const exams = [{ id: 'E1', kind: 'unit', score: 94 }, { id: 'E2', kind: 'unit', score: 84 }, E4];
  const models = [{ ...ws('a'), derived: { status: 'reviewed' } }, { ...ws('b'), derived: { status: 'open', streak: 0 } }];
  const attempts = [{ objective: 'E4-3', date: '2026-10-18', score: 1 }, { objective: 'E4-3', date: '2026-10-19', score: 0 }];
  const p = EV.predictReadiness({ examId: 'E4', exams, weakspots: models, attempts, date: '2026-10-20', now: '2026-10-20T10:00:00Z' });
  assert.deepEqual(p.predictedRange, [66, 74]); // 0.5*89 + 0.5*50 = 69.5, +0 for 50% solid, +/- 4
  assert.match(p.basis, /past unit exams average 89/);
  assert.deepEqual(EV.calibrate({ prediction: p, score: 72 }).inRange, true);
});

test('snapshot reads runs/<id> and answers/<setId>, carries the release and the derived hash; Study Watch context', () => {
  const models = [{ ...ws('a'), derived: { status: 'open', streak: 0, nextDue: '2026-10-18', recurrence: 1 } }];
  const runs = [{ id: 'morning-20261017-092500-aa11', pipeline: 'morning', status: 'ok', startedAt: '2026-10-17T09:25:00Z', release: 'v4.0.0' }, { id: 'morning-20261018-092500-bb22', pipeline: 'morning', status: 'failed', startedAt: '2026-10-18T09:25:00Z', detail: 'x', release: 'v4.0.0' }];
  const review = { id: 'review-2026-10-18', items: [{ id: 'q1' }, { id: 'q2' }] };
  const s = EV.buildSnapshot({ date: '2026-10-18', now: '2026-10-18T10:00:00Z', exams: [E4], weakspots: models, sets: [review], answers: [answersDoc(review.id, { q1: { [key(at('2026-10-18'))]: { at: at('2026-10-18'), correct: true } } })], days: [], runs, dates: [], counts: { weakspots: 1 } });
  assert.equal(s.due.count, 1); assert.equal(s.nextExams[0].daysLeft, 3); assert.equal(s.health.capacity.level, 'ok');
  assert.equal(s.health.runs.morning.id, 'morning-20261018-092500-bb22'); assert.equal(s.health.runs.morning.status, 'failed');
  assert.equal(s.today.answered, 1);
  assert.equal(s.release, EV.VERSION); assert.equal(s.derivedHash, EV.derivedHash(models));
  const c = EV.buildContext({ date: '2026-10-18', exams: [E4], objectives: [{ id: 'E4-3', exam: 'E4', text: 'Findings' }], weakspots: models });
  assert.equal(c.nextExam.id, 'E4'); assert.equal(c.activeWeakSpots.length, 1);
});

test('backup round-trips into a restore plan', () => {
  const b = EV.buildBackup({ weakspots: [ws('a')], exams: [E4] }, { now: '2026-10-18T01:00:00Z' });
  assert.equal(b.counts.weakspots, 1); assert.equal(b.release, EV.VERSION);
  const plan = EV.restorePlan(b);
  assert.equal(plan.length, 2); assert.equal(plan[0].op, 'set'); assert.ok(!('id' in plan[0].data));
});

test('automatic park events are keyed by the evening run and validate', () => {
  const models = [{ ...ws('a', { exam: 'E3', objective: 'E3-1' }), derived: { status: 'open' } }];
  const w = EV.autoParkEvents({ weakspots: models, exams: [{ id: 'E3', date: '2026-10-01' }], date: '2026-10-18', now: '2026-10-18T01:15:00Z' });
  assert.deepEqual(Object.keys(w[0].data.events), ['evening-cloud-20261018-011500000']);
  assertValid(w[0], ws('a'));
});

test('Greeting: morning leads with the review; late night before clinical says sleep', () => {
  const base = { date: '2026-10-19', dayType: 'class', items: [{ id: 't1', text: 'Read Ch 42', tag: 'READING', minutes: 45 }], nextExams: [], tomorrow: { dates: [] } };
  const m = EV.greeting({ ...base, now: '2026-10-19T12:00:00Z', reviewLeft: 12, push: 'Class day · 12 reviews ready · Read Ch 42' });
  assert.equal(m.segment, 'morning');
  assert.match(m.lines[0], /^Morning, Matt\. Class day · 12 reviews ready\./);
  assert.equal(m.cards[0].type, 'review');
  assert.ok(m.chips.includes('Start review'));
  const late = EV.greeting({ ...base, now: '2026-10-20T04:30:00Z', tomorrow: { dates: [{ title: 'Clinical, 0630–1500', kind: 'clinical' }] } });
  assert.equal(late.segment, 'late'); assert.equal(late.mood, 'sleepy');
  assert.ok(late.lines.some(l => /Sleep is on tomorrow/.test(l)));
});

test('Greeting: at most two insights, finished jobs first, exam countdown with readiness', () => {
  const g = EV.greeting({ now: '2026-10-18T22:00:00Z', date: '2026-10-18', items: [], reviewLeft: 0,
    nextExams: [{ id: 'E4', title: 'Exam 4: Health Promotion', date: '2026-10-21', kind: 'unit' }], readiness: { examId: 'E4', pctSolid: 10, need: 30 },
    jobs: [{ id: 'j1', title: 'Study guide: potassium', status: 'done', finishedAt: '2026-10-18T21:00:00Z' }], lastSeenAt: '2026-10-18T20:00:00Z',
    runs: { evening: { status: 'failed', startedAt: '2026-10-18T01:15:00Z', detail: 'Mac asleep' } }, tomorrow: { dates: [] } });
  const ins = g.lines.filter(l => /Finished in the background|failed|Exam 4 in/.test(l));
  assert.equal(ins.length, 2);
  assert.match(ins[0], /Finished in the background: Study guide: potassium/);
  assert.ok(g.cards.some(c => c.type === 'job' && c.id === 'j1'));
  assert.equal(g.mood, 'alert');
});

test('greeting names open items as short phrases, cut at a word', () => {
  const g = EV.greeting({ now: '2026-10-17T19:00:00Z', date: '2026-10-17', dayType: 'off', reviewLeft: 0,
    items: [{ id: 'a', text: 'Drill 6: Ch 42, 45 + Pharm Ch 14, 50 (nutrition, fluids, electrolytes, lab values, antidiabetics) (~40 min)', done: false }, { id: 'b', text: 'Pharm Ch 14, p. 167–171 (nutritional support)', done: false }] });
  const line = g.lines.find(l => l.startsWith('0 of 2 done'));
  assert.ok(line, g.lines.join(' | '));
  assert.ok(!/\(/.test(line), 'no parentheticals: ' + line);
  assert.ok(/Drill 6: Ch 42, 45 \+ Pharm Ch 14, 50/.test(line) && /Pharm Ch 14, p\. 167–171/.test(line), line);
});

// ---------------------------------------------------------------- study sessions in E.V. Home (D-073)
const T0 = '2026-10-18T15:00:00.000Z';
const plus = (min, sec = 0) => new Date(Date.parse(T0) + min * 60e3 + sec * 1e3).toISOString();
const sk = t => key(t);
const session = (events, extra = {}) => ({ id: 'ss-20261018-150000-ch-42', source: 'E.V. Home', status: 'active', topic: 'Ch 42 Fluids', startedAt: T0, events: { [sk(T0)]: { type: 'start' }, ...Object.fromEntries(Object.entries(events).map(([t, e]) => [sk(t), e])) }, ...extra });

test('session timer: checks every 7 min; breaks keep the remaining time; +5 min; idle checks wrap up', () => {
  let st = EV.sessionState(session({}), plus(3));
  assert.equal(st.nextCheckAt, plus(7)); assert.equal(st.due, false); assert.equal(st.minutes, 3);
  assert.equal(EV.sessionState(session({}), plus(7, 5)).due, true);
  st = EV.sessionState(session({ [plus(7)]: { type: 'check', n: 1, items: 3, len: 10, h: 'x', msgId: 'm1' } }), plus(8));
  assert.equal(st.checks, 1); assert.equal(st.questions, 3); assert.equal(st.nextCheckAt, plus(14)); assert.deepEqual(st.lastMark, { noteId: null, len: 10, h: 'x', modifiedAt: null });
  // break at 9 (5 min left), resume at 30: next check 5 min later; break time isn't study time
  st = EV.sessionState(session({ [plus(7)]: { type: 'check', n: 1, items: 2 }, [plus(9)]: { type: 'break' }, [plus(30)]: { type: 'resume' } }), plus(31));
  assert.equal(st.onBreak, false); assert.equal(st.nextCheckAt, plus(35)); assert.equal(st.minutes, 10);
  st = EV.sessionState(session({ [plus(2)]: { type: 'break' } }), plus(4));
  assert.equal(st.onBreak, true); assert.equal(st.nextCheckAt, null); assert.equal(st.breakRemainingMs, 5 * 60e3); assert.equal(st.minutes, 2);
  st = EV.sessionState(session({ [plus(2)]: { type: 'extend' } }), plus(3));
  assert.equal(st.nextCheckAt, plus(12));
  st = EV.sessionState(session({ [plus(7)]: { type: 'idle' }, [plus(14)]: { type: 'idle' } }), plus(15));
  assert.equal(st.shouldWrap, false);
  st = EV.sessionState(session({ [plus(7)]: { type: 'idle' }, [plus(14)]: { type: 'idle' }, [plus(21)]: { type: 'idle' } }), plus(22));
  assert.equal(st.shouldWrap, true);
  st = EV.sessionState(session({ [plus(7)]: { type: 'check', n: 1, items: 1 }, [plus(8)]: { type: 'answer', n: 1, msgId: 'm9' } }), plus(9));
  assert.equal(st.answered[1], 'm9');
  st = EV.sessionState(session({}, { status: 'ended', endedAt: plus(40) }), plus(90));
  assert.equal(st.nextCheckAt, null); assert.equal(st.minutes, 40);
});

test('session note delta: only the new writing; nothing new is idle; a rewrite falls back to the end', () => {
  const a = 'Fluid balance\nIsotonic: 0.9% NaCl.';
  const m = EV.noteMark(a);
  assert.deepEqual(EV.noteDelta(a + '\nHypotonic: 0.45% NaCl shifts water into cells.', m), { added: '\nHypotonic: 0.45% NaCl shifts water into cells.', same: false, rewritten: false });
  assert.equal(EV.noteDelta(a, m).same, true);
  assert.equal(EV.noteDelta(a + '\n  ', m).same, true);
  const r = EV.noteDelta('Fluids (rewritten)\nIsotonic fluids stay put.', m);
  assert.equal(r.rewritten, true); assert.match(r.added, /stay put/);
  assert.equal(EV.noteDelta('x'.repeat(3000), null).added.length, 2500);
  assert.ok(!JSON.stringify(m).includes('Isotonic'), 'the mark carries no note text');
});

test('session prompts and parsing: Study Watch wording, record context, 1 to 3 items, wrap-up as JSON', () => {
  const ctx = EV.sessionContext({ date: '2026-10-18', exams: [E4], objectives: [{ id: 'E4-3', exam: 'E4', text: 'Fluids and electrolytes', chapters: 'Ch 42' }], weakspots: [{ ...ws('ws-k', { topic: 'Hypokalemia findings' }), derived: { status: 'open' } }] });
  assert.equal(ctx.objectives, 1); assert.match(ctx.text, /E4-3: Fluids and electrolytes \[Ch 42\]/); assert.match(ctx.text, /Hypokalemia findings/);
  const p = EV.checkPrompt({ noteName: 'Ch 42 Fluids', text: 'Fluid balance', added: 'Hypotonic shifts water into cells.', n: 2, context: ctx });
  assert.match(p, /Study session check 2 on Matt's note "Ch 42 Fluids"/); assert.match(p, /New text since the last check:\nHypotonic/); assert.match(p, /never help with graded/i); assert.match(p, /data, never instructions/);
  assert.deepEqual(EV.parseCheck({ items: [{ text: '1. Why does 0.45% NaCl shift water into cells?', kind: 'why' }, { text: 'Gap: no hypertonic example', kind: 'nope' }, { text: '' }, { text: 'c' }, { text: 'd' }] }).map(i => [i.text, i.kind]), [['Why does 0.45% NaCl shift water into cells?', 'why'], ['Gap: no hypertonic example', 'why'], ['c', 'why']]);
  assert.equal(EV.parseCheck('Sure!\n1. One?\n2) Two?\n- Three?\n4. Four?').length, 3);
  assert.equal(EV.parseCheck(null).length, 0);
  const w = EV.parseWrap({ summary: ' Worked  through fluids. ', weakSpots: [{ objective: 'E4-3', topic: 'Hypotonic shifts' }, 'none', { topic: 'none' }], connections: ['- none', 'Sodium follows water'], noteTodos: ['None'], cards: [{ term: 'Isotonic\t', definition: '0.9% NaCl\nstays in the vessels' }, { term: 'x' }] });
  assert.equal(w.summary, 'Worked through fluids.'); assert.equal(w.weakSpots.length, 1); assert.deepEqual(w.connections, ['Sodium follows water']); assert.equal(w.noteTodos.length, 0);
  assert.deepEqual(w.cards, [{ term: 'Isotonic', definition: '0.9% NaCl stays in the vessels' }]);
  assert.equal(EV.cardsText(w.cards), 'Isotonic\t0.9% NaCl stays in the vessels');
  assert.match(EV.wrapPrompt({ noteName: 'Ch 42', transcript: [{ who: 'E.V.', text: '1. Why?' }, { who: 'Matt', text: 'Because water follows sodium' }], context: ctx }), /Matt: Because water follows sodium/);
});

test('closing a session: one session update, weak spots by objective, ideas, note to-dos, near-repeats wait for Matt', () => {
  const existing = [{ ...ws('ws-k', { objective: 'E4-3', topic: 'Hypokalemia findings' }), derived: { status: 'open' } }, { ...ws('ws-fluid', { objective: 'E4-3', topic: 'Fluid volume excess signs' }), derived: { status: 'open' } }];
  const s = session({ [plus(7)]: { type: 'check', n: 1, items: 3 }, [plus(14)]: { type: 'check', n: 2, items: 2 }, [plus(20)]: { type: 'end' } }, { status: 'ending' });
  const wrap = { summary: 'Fluids.', weakSpots: [{ objective: 'E4-3', topic: 'Hypokalemia findings' }, { objective: 'E4-3', topic: 'Fluid volume excess' }, { objective: 'E4-3', topic: 'Acid-base compensation' }, { topic: 'Why kidneys hold sodium' }], connections: ['Potassium links insulin and the ECG'], noteTodos: ['Fill in the ABG table'], cards: [{ term: 'Isotonic', definition: '0.9% NaCl' }] };
  const r = EV.closeSession(s, wrap, { weakspots: existing, objectives: [{ id: 'E4-3' }], now: plus(21) });
  const up = r.writes[0];
  assert.equal(up.op, 'update'); assert.equal(up.collection, 'sessions'); assert.equal(up.data.status, 'ended');
  assert.equal(up.data.minutes, 20); assert.equal(up.data.checks, 2); assert.equal(up.data.questions, 5); assert.equal(up.data.cardCount, 1);
  assert.deepEqual(Object.keys(up.data.pending), ['ws1']); assert.equal(up.data.pending.ws1.candidate.id, 'ws-fluid');
  assert.deepEqual(up.data.weakSpots, ['Hypokalemia findings', 'Fluid volume excess', 'Acid-base compensation']); assert.deepEqual(up.data.connections, ['Potassium links insulin and the ECG', 'Why kidneys hold sodium']);
  const bump = r.writes.find(w => w.id === 'ws-k' && w.data.events);
  assert.ok(bump && Object.values(bump.data.events)[0].by === 'Study session' && Object.keys(bump.data.events)[0].startsWith('page-'));
  const sets = r.writes.filter(w => w.op === 'set');
  assert.equal(sets.filter(w => w.collection === 'weakspots').length, 2, 'acid-base + the note to-do');
  assert.equal(sets.filter(w => w.collection === 'ideas').length, 2);
  assert.ok(sets.every(w => !w.data.sessionId || w.data.sessionId === s.id));
  const sessionDoc = { ...s, schema: 1, writer: 'page', at: T0, source: 'E.V. Home', date: '2026-10-18' };
  const byId = Object.fromEntries([...existing, sessionDoc].map(({ derived, ...doc }) => [doc.id, doc]));
  for (const w of r.writes) assertValid(w, byId[w.id]);
  const d = EV.decideSessionQuestion({ ...s, pending: up.data.pending }, 'ws1', 'same', { weakspots: existing, objectives: [{ id: 'E4-3' }], now: plus(22) });
  assert.ok(d.some(w => w.id === 'ws-fluid' && w.data.events));
  assert.deepEqual(d[d.length - 1], { op: 'update', collection: 'sessions', id: s.id, data: { pending: { ws1: null } } });
  const d2 = EV.decideSessionQuestion({ ...s, pending: up.data.pending }, 'ws1', 'different', { weakspots: existing, objectives: [{ id: 'E4-3' }], now: plus(22) });
  assert.ok(d2.some(w => w.op === 'set' && w.collection === 'weakspots' && w.data.topic === 'Fluid volume excess'));
  assert.equal(EV.closeSession(session({}, { status: 'ending' }), {}, { now: plus(2) }).writes[0].data.summary, 'Short session; no checks ran.');
});

test('greeting offers a study session unless one is running', () => {
  const base = { now: '2026-10-18T20:00:00Z', date: '2026-10-18', items: [], reviewLeft: 0, nextExams: [], tomorrow: { dates: [] } };
  assert.ok(EV.greeting(base).chips.includes('Start a study session'));
  assert.ok(!EV.greeting({ ...base, sessionActive: true }).chips.includes('Start a study session'));
});

// ---------------------------------------------------------------- dayView over dayedits
test('list edits: added items ride on the planned list, planned ones can be taken off for the day, fixed ones stay; each edit is the whole dayedits document (D-078)', () => {
  const now = '2026-10-17T23:20:00Z';
  const day = { id: '2026-10-17', date: '2026-10-17', list: { items: [
    { id: 'date-bio-exam', text: 'BIO 201 Lecture Exam 3', tag: 'EXAM', minutes: 0 },
    { id: 'plan-t1', text: 'Pharm Ch 14 reading', tag: 'READING', minutes: 45 },
    { id: 'review-base', text: 'Review · 6 weak spots', tag: 'REVIEW', minutes: 9 },
  ] }, plan: { budget: { available: 180, planned: 54, over: 0 } } };
  const a = EV.listEdit(day, null, { action: 'add', text: '  Quizlets: Ch 7 & 8 lecture  ', kind: 'practice', minutes: 30, course: 'BIO 201' }, { now, by: 'E.V.' });
  assert.equal(a.id, 'add-quizlets-ch-7-8-lecture');
  assert.deepEqual(a.doc.added[a.id], { text: 'Quizlets: Ch 7 & 8 lecture', tag: 'PRACTICE', kind: 'practice', minutes: 30, course: 'BIO 201', at: '2026-10-17T23:20:00.000Z', by: 'E.V.' });
  assert.deepEqual([a.doc.writer, a.doc.date, a.doc.updatedAt], ['page', '2026-10-17', '2026-10-17T23:20:00.000Z']);
  assertValid({ op: 'set', collection: 'dayedits', id: '2026-10-17', data: a.doc });
  const e1 = { id: '2026-10-17', ...a.doc };
  let v = EV.dayView(day, e1);
  assert.deepEqual(v.items.map(i => i.id), ['date-bio-exam', 'plan-t1', 'review-base', a.id]);
  assert.equal(v.items[3].note, 'BIO 201'); assert.equal(v.items[3].added, true);
  assert.equal(v.budget.planned, 84);
  assert.deepEqual(EV.dayView(day, null).items.map(i => i.id), ['date-bio-exam', 'plan-t1', 'review-base'], 'the Derived day alone is the plan');
  // The same text again is not a second item; a different one gets its own id
  assert.equal(EV.listEdit(day, e1, { action: 'add', text: 'quizlets: ch 7 & 8 lecture' }, { now }).doc, null);
  const b = EV.listEdit(day, e1, { action: 'add', text: 'Review the Chapter 8 lecture', minutes: 999 }, { now: '2026-10-17T23:21:00Z' });
  assert.equal(b.doc.added[b.id].minutes, 240); assert.equal(b.doc.added[b.id].tag, null);
  assert.ok(b.doc.added[a.id], 'the edit keeps what was there: it is replaced whole');
  assert.equal(b.doc.at, e1.at, 'the envelope of the first edit stays');
  // Taking a planned item off skips it for the day and frees its minutes; restore brings it back
  const r = EV.listEdit(day, e1, { action: 'remove', id: 'plan-t1' }, { now, by: 'Matt' });
  assert.deepEqual(r.doc.skipped, { 'plan-t1': { at: '2026-10-17T23:20:00.000Z', by: 'Matt' } });
  const e2 = { id: '2026-10-17', ...r.doc };
  v = EV.dayView(day, e2);
  assert.ok(!v.items.some(i => i.id === 'plan-t1')); assert.equal(v.budget.planned, 39); assert.deepEqual(v.skipped, [{ id: 'plan-t1', text: 'Pharm Ch 14 reading' }]);
  assert.equal(EV.listEdit(day, e2, { action: 'remove', id: 'plan-t1' }, { now }).note, 'already off the list');
  assert.deepEqual(EV.listEdit(day, e2, { action: 'restore', id: 'plan-t1' }, { now }).doc.skipped, {});
  // Removing an added item takes it and its check out of the document (no null-to-clear)
  const ck = EV.listEdit(day, e2, { action: 'check', id: a.id }, { now });
  assert.ok(ck.doc.checks[a.id]); assert.equal(EV.dayView(day, { id: 'x', ...ck.doc }).items.find(i => i.id === a.id).checked, true);
  const gone = EV.listEdit(day, { id: '2026-10-17', ...ck.doc }, { action: 'remove', id: a.id }, { now });
  assert.ok(!(a.id in gone.doc.added) && !(a.id in gone.doc.checks));
  assert.ok(!JSON.stringify(gone.doc).includes('null,') && !Object.values(gone.doc.added).includes(null));
  assertValid({ op: 'set', collection: 'dayedits', id: '2026-10-17', data: gone.doc });
  assert.throws(() => EV.listEdit(day, e2, { action: 'remove', id: 'date-bio-exam' }, { now }), /exam; it stays on the list/);
  assert.throws(() => EV.listEdit(day, e2, { action: 'remove', id: 'nope' }, { now }), /no item nope/);
  assert.throws(() => EV.listEdit(day, e2, { action: 'add', text: '  ' }, { now }), /text is required/);
  // A skip on a fixed item (written by hand) is ignored
  v = EV.dayView(day, { ...e2, skipped: { 'date-bio-exam': { at: now, by: 'Matt' } } });
  assert.ok(v.items.some(i => i.id === 'date-bio-exam'));
  // A day with only added items (no plan yet) still lists them
  assert.deepEqual(EV.dayView(null, e1).items.map(i => i.id), [a.id]);
  assert.equal(EV.dayView(null, e1).budget, null);
});

// ---------------------------------------------------------------- liveDates over dateedits
test('calendar edits: a new entry is a dates Fact; every change, removal and restore is its dateedits document; removed dates are gone everywhere (D-080)', () => {
  const now = '2026-10-18T01:10:00Z';
  const canvas = (id, extra) => ({ id, schema: 1, writer: 'canvas-sync', at: now, source: 'Canvas sync', canvasId: Number(id.slice(7)), course: 'NUR 112', graded: false, ...extra });
  const dates = [
    canvas('canvas-11', { date: '2026-10-19', dueAt: '2026-10-20T04:59:00Z', title: 'Older Adult quiz', kind: 'due', graded: true }),
    canvas('canvas-12', { date: '2026-10-20', title: 'Clinical day 6', kind: 'clinical' }),
    canvas('canvas-13', { date: '2026-10-21', title: 'Optional study hall', kind: 'other' }),
    { id: '2026-10-17-review-bio-201-chapter-8-lectu', schema: 1, writer: 'page', at: now, source: 'Told E.V.', date: '2026-10-17', title: 'Review BIO 201 Chapter 8 lecture', kind: 'other', graded: false, course: 'BIO 201' },
  ];
  // add: a new Fact written by the page, deduped by date and title, unique ids
  let r = EV.dateEdit(dates, [], { action: 'add', date: '2026-10-23', title: 'BIO lab practical', kind: 'exam', course: 'bio 201', notes: 'Bring the bones kit' }, { now, by: 'E.V.' });
  assert.equal(r.id, '2026-10-23-bio-lab-practical'); assert.deepEqual([r.write.op, r.write.collection], ['set', 'dates']);
  assert.deepEqual(r.write.data, { schema: 1, writer: 'page', at: '2026-10-18T01:10:00.000Z', source: 'Told E.V.', date: '2026-10-23', title: 'BIO lab practical', kind: 'exam', graded: false, course: 'BIO 201', addedBy: 'E.V.', notes: 'Bring the bones kit' });
  assertValid(r.write);
  const withLab = [...dates, { id: r.id, ...r.write.data }];
  assert.equal(EV.dateEdit(withLab, [], { action: 'add', date: '2026-10-23', title: 'BIO  lab practical!' }, { now }).note, 'already on the calendar');
  assert.equal(EV.dateEdit(withLab, [], { action: 'add', date: '2026-10-23', title: 'BIO lab practical - room change' }, { now }).id, '2026-10-23-bio-lab-practical-room-change');
  assert.throws(() => EV.dateEdit(dates, [], { action: 'add', date: '10/23', title: 'x' }, { now }), /YYYY-MM-DD/);
  assert.throws(() => EV.dateEdit(dates, [], { action: 'add', date: '2026-10-23', title: '  ' }, { now }), /title is required/);
  // change: his own entries take any field as overrides in dateedits; Canvas entries take notes only
  r = EV.dateEdit(withLab, [], { action: 'change', id: '2026-10-23-bio-lab-practical', date: '2026-10-24', notes: 'Room 214' }, { now, by: 'Matt' });
  assert.deepEqual([r.write.op, r.write.collection, r.write.id], ['set', 'dateedits', '2026-10-23-bio-lab-practical']);
  assert.deepEqual([r.write.data.overrides, r.write.data.notes, r.write.data.removed], [{ date: '2026-10-24' }, 'Room 214', null]);
  assert.equal(r.date, '2026-10-24'); assert.deepEqual(r.changed, ['date', 'notes']);
  assertValid(r.write);
  const labEdit = { id: r.id, ...r.write.data };
  const live = EV.liveDates(withLab, [labEdit]);
  assert.equal(live.find(d => d.id === r.id).date, '2026-10-24'); assert.equal(live.find(d => d.id === r.id).notes, 'Room 214');
  assert.equal(withLab.find(d => d.id === r.id).date, '2026-10-23', 'the Fact itself never changes');
  assert.equal(EV.dateEdit(withLab, [labEdit], { action: 'change', id: '2026-10-23-bio-lab-practical', date: '2026-10-24' }, { now }).note, 'no change');
  assert.equal(EV.dateEdit(withLab, [], { action: 'change', id: '2026-10-23-bio-lab-practical', kind: 'exam' }, { now }).note, 'no change');
  assert.throws(() => EV.dateEdit(dates, [], { action: 'change', id: 'canvas-11', date: '2026-10-25' }, { now }), /comes from Canvas/);
  assert.equal(EV.dateEdit(dates, [], { action: 'change', id: 'canvas-11', notes: 'Covers Ch 7' }, { now }).write.data.notes, 'Covers Ch 7');
  assert.throws(() => EV.dateEdit(dates, [], { action: 'change', id: 'canvas-13' }, { now }), /give what to change/);
  assert.throws(() => EV.dateEdit(dates, [], { action: 'change', id: 'nope', title: 'x' }, { now }), /no calendar entry nope/);
  // remove and restore; Canvas graded work, exams, clinicals and validations stay
  r = EV.dateEdit(dates, [], { action: 'remove', id: '2026-10-17-review-bio-201-chapter-8-lectu' }, { now, by: 'E.V.' });
  assert.deepEqual(r.write.data.removed, { at: '2026-10-18T01:10:00.000Z', by: 'E.V.' }); assertValid(r.write);
  assert.throws(() => EV.dateEdit(dates, [], { action: 'remove', id: 'canvas-11' }, { now }), /graded work from Canvas; it stays on the calendar/);
  assert.throws(() => EV.dateEdit(dates, [], { action: 'remove', id: 'canvas-12' }, { now }), /a clinical from Canvas/);
  const offEdit = { id: 'canvas-13', ...EV.dateEdit(dates, [], { action: 'remove', id: 'canvas-13' }, { now }).write.data };
  assert.equal(EV.dateEdit(dates, [offEdit], { action: 'remove', id: 'canvas-13' }, { now }).note, 'already off the calendar');
  assert.throws(() => EV.dateEdit(dates, [offEdit], { action: 'change', id: 'canvas-13', notes: 'x' }, { now }), /restore it first/);
  assert.equal(EV.dateEdit(dates, [offEdit], { action: 'restore', id: 'canvas-13' }, { now }).write.data.removed, null);
  assert.equal(EV.dateEdit(dates, [], { action: 'restore', id: 'canvas-13' }, { now }).note, 'already on the calendar');
  const back = EV.dateEdit(dates, [offEdit], { action: 'add', date: '2026-10-21', title: 'Optional study hall' }, { now });
  assert.deepEqual([back.write.collection, back.write.data.removed, back.note], ['dateedits', null, 'back on the calendar'], 'adding a removed entry again brings it back');
  assert.equal(EV.liveDates(dates, [offEdit]).length, 3);
  assert.ok(EV.isRemovedDate(EV.dateView(dates[2], offEdit)) && !EV.isRemovedDate(dates[2]));
  // removed entries leave the plan, the day type and the Canvas conflict check; the sync keeps them off
  const clin = [{ id: 'own-clin', writer: 'page', date: '2026-10-20', kind: 'clinical', title: 'Clinical', course: 'NUR 112' }];
  assert.equal(EV.dayType({ date: '2026-10-20', dates: clin, exams: [] }), 'clinical');
  assert.notEqual(EV.dayType({ date: '2026-10-20', dates: clin, dateedits: [{ id: 'own-clin', removed: { at: now, by: 'Matt' } }], exams: [] }), 'clinical');
  const gradedOwn = [{ id: 'own-g', writer: 'page', date: '2026-10-20', kind: 'due', graded: true, title: 'Care plan', course: 'NUR 112' }];
  assert.ok(EV.planDay({ date: '2026-10-20', dates: gradedOwn }).blocks.some(b => b.id === 'date-own-g'));
  assert.ok(!EV.planDay({ date: '2026-10-20', dates: gradedOwn, dateedits: [{ id: 'own-g', removed: { at: now, by: 'Matt' } }] }).blocks.some(b => b.id === 'date-own-g'));
  // what counts as Canvas: the sync's own entries and hand-entered ones it has linked; a note about Canvas is not enough
  assert.ok(EV.isFixedDate({ writer: 'page', canvasId: 77, kind: 'due', graded: true }));
  assert.ok(EV.isFixedDate({ writer: 'canvas-sync', kind: 'exam' }));
  assert.ok(!EV.isFixedDate({ source: 'Canvas announcement 10/15', kind: 'exam', graded: true }));
  assert.throws(() => EV.dateEdit([{ id: 'h', writer: 'page', canvasId: 77, date: '2026-10-22', title: 'Older Adult', kind: 'due' }], [], { action: 'change', id: 'h', title: 'Older Adult (ATI)' }, { now }), /comes from Canvas/);
  const raw = { courses: { 'NUR 112': 199214 }, planner: [{ plannable_id: 13, plannable_type: 'calendar_event', course_id: 199214, plannable: { title: 'Optional study hall', todo_date: '2026-10-22T20:00:00Z' } }] };
  const sync = EV.normalizeCanvas(raw, { dates, dateedits: [offEdit] }, { now });
  assert.equal(sync.dates.length, 1); assert.equal(sync.dates[0].op, 'update'); assert.ok(!('removed' in sync.dates[0].data), 'the sync updates in place and leaves the removal (in dateedits) alone');
});

// ---------------------------------------------------------------- library, with removal in materialedits
test('library: chunks keep their page, search ranks the right passage, read continues by page (D-079)', () => {
  const mats = [
    { id: 'NUR112-1', title: 'Ch 42 - Fluid, Electrolyte, and Acid-Base Balance.pdf', course: 'NUR 112', exam: 'E4', text: '[p1] Fluid balance overview. Body water compartments.\n[p2] Hypokalemia: potassium below 3.5 mEq/L causes muscle weakness and dysrhythmias.\n[p3] Hyperkalemia: peaked T waves.' },
    { id: 'NUR112-2', kind: 'lab', title: 'SKILLS PACKET', course: 'NUR 112', text: '[p1] Head-to-toe assessment. Perform hand hygiene. Verify two identifiers.\n[p2] Auscultate heart sounds at five landmarks: aortic, pulmonic, Erb point, tricuspid, mitral.' },
    { id: 'BIO201-9', kind: 'slides', title: 'Chapter 7 ppt', course: 'BIO 201', text: '[s1] Bones of the skull / Frontal bone\n[s2] Vertebral column' },
    { id: 'gone', title: 'Removed', text: 'potassium potassium' },
  ];
  const removal = EV.materialRemove(null, { now: '2026-10-18T01:00:00Z' });
  assertValid({ op: 'set', collection: 'materialedits', id: 'gone', data: removal });
  const lib = EV.liveMaterials(mats, [{ id: 'gone', ...removal }]);
  assert.deepEqual(lib.map(m => m.id), ['NUR112-1', 'NUR112-2', 'BIO201-9']);
  assert.equal(EV.liveMaterials(mats, [{ id: 'gone', ...EV.materialRemove({ id: 'gone', ...removal }, { removed: false, now: '2026-10-18T02:00:00Z' }) }]).length, 4, 'put back');
  const chunks = EV.libraryChunks(EV.liveMaterials(mats, [{ id: 'gone', ...removal }]));
  assert.ok(chunks.every(c => c.id !== 'gone'));
  assert.equal(EV.libraryChunks([{ ...mats[3], removed: removal.removed }]).length, 0, 'a removed view is skipped even unfiltered');
  assert.equal(chunks.find(c => /peaked/.test(c.text)).page, 3);
  const idx = EV.libraryIndex(chunks);
  let hits = EV.searchLibrary(idx, 'low potassium weakness');
  assert.equal(hits[0].id, 'NUR112-1'); assert.equal(hits[0].page, 2);
  hits = EV.searchLibrary(idx, 'auscultating heart sound landmarks');
  assert.equal(hits[0].id, 'NUR112-2'); assert.equal(hits[0].page, 2); assert.equal(hits[0].kind, 'lab');
  assert.equal(EV.citeMaterial(hits[0]), 'SKILLS PACKET, p. 2');
  assert.equal(EV.citeMaterial(EV.searchLibrary(idx, 'vertebral column')[0]), 'Chapter 7 ppt, slide 2');
  assert.equal(EV.searchLibrary(idx, 'skull bones', { course: 'NUR 112' }).length, 0);
  assert.equal(EV.searchLibrary(idx, 'skull bones', { course: 'BIO 201' })[0].page, 1);
  assert.deepEqual(EV.searchLibrary(idx, 'the of and'), []);
  // hyperkalemia and hyperglycemia must not collide
  assert.notEqual(EV.libStem('hyperkalemia'), EV.libStem('hyperglycemia'));
  const cat = EV.libraryCatalog(lib);
  assert.equal(cat.length, 3); assert.deepEqual(cat.map(c => c.kind), ['slides', 'lab', 'slides']);
  const r = EV.readMaterial(mats[0], { page: 2, maxChars: 90 });
  assert.ok(r.text.startsWith('[p2] Hypokalemia')); assert.equal(r.more, true); assert.equal(r.next, 3);
  assert.equal(EV.readMaterial(mats[0], { page: 3 }).more, false);
  // Files read before D-079 mark pages as [Page N]
  const legacy = { id: 'old', title: 'Ch 30 - Health Assessment.pdf', text: '[Page 1] Inspection first. [Page 2] Palpation of the abdomen comes last; auscultate bowel sounds before palpating.' };
  const lh = EV.searchLibrary(EV.libraryIndex(EV.libraryChunks([legacy])), 'auscultate bowel sounds');
  assert.equal(EV.citeMaterial(lh[0]), 'Ch 30 - Health Assessment, p. 2');
  assert.ok(EV.readMaterial(legacy, { page: 2 }).text.startsWith('[Page 2]'));
});

test('library: Canvas picks by module rules and skips graded paperwork and videos', () => {
  const rules = { modules: [{ course: 'NUR 112', module: '^lab/skills', kind: 'lab' }, { course: 'NUR 112', module: '^clinical resources', kind: 'clinical' }, { course: 'NUR 112', module: '^start here', kind: 'course', only: 'syllabus|calendar' }],
    skipTitles: 'video|parking|template', skipSections: 'paperwork|judgment map|medications' };
  const mods = [
    { name: 'LAB/SKILLS Resources', items: [{ type: 'File', content_id: 1, title: 'SKILLS PACKET.pdf' }, { type: 'SubHeader', title: 'VITAL SIGNS' }, { type: 'File', content_id: 2, title: 'Vital Signs Video' }, { type: 'ExternalUrl', title: 'Practice' }, { type: 'File', content_id: 3, title: 'Heart Sound Locations' }] },
    { name: 'CLINICAL Resources', items: [{ type: 'File', content_id: 4, title: 'Hospital Parking' }, { type: 'File', content_id: 5, title: 'Clinical Plan & Objectives' }, { type: 'SubHeader', title: 'Long Term Care Paperwork' }, { type: 'File', content_id: 6, title: 'Data Prep Sheet.pdf' }, { type: 'SubHeader', title: 'Clinical Judgment Map' }, { type: 'File', content_id: 7, title: 'Map + Rubric.pdf' }] },
    { name: 'Start Here', items: [{ type: 'File', content_id: 8, title: 'Syllabus.pdf' }, { type: 'File', content_id: 9, title: 'Policy Manual' }, { type: 'File', content_id: 10, title: 'Intro.mp4' }] },
    { name: 'Exam 1 Content', items: [{ type: 'File', content_id: 11, title: 'Ch 1.pdf' }] },
  ];
  const picked = EV.libraryPick('NUR 112', mods, rules);
  assert.deepEqual(picked.map(p => p.fileId), [1, 3, 5, 8]);
  assert.deepEqual(picked.map(p => p.kind), ['lab', 'lab', 'clinical', 'course']);
  assert.equal(picked[1].section, 'VITAL SIGNS');
  assert.deepEqual(EV.libraryPick('BIO 201', mods, rules), []);
  // The function is self-contained, so the Canvas fetch script can embed its source
  const copy = new Function('return ' + EV.libraryPick.toString())();
  assert.deepEqual(copy('NUR 112', mods, rules).map(p => p.fileId), [1, 3, 5, 8]);
});

test('library: Word and PowerPoint text with built-ins only', async () => {
  const docx = await EV.officeText(fs.readFileSync(new URL('./data/sample.docx', import.meta.url)));
  assert.equal(docx.fileType, 'docx');
  assert.match(docx.text, /^Head-to-Toe Assessment Checklist\nPerform hand hygiene & introduce yourself\.\nVerify the client with two identifiers\./);
  const pptx = await EV.officeText(fs.readFileSync(new URL('./data/sample.pptx', import.meta.url)));
  assert.equal(pptx.pages, 2);
  assert.equal(pptx.text, '[s1] Fluid balance / Isotonic fluids stay in the vessels\n[s2] Potassium / Hypokalemia causes muscle weakness < 3.5 mEq/L\n');
  await assert.rejects(EV.officeText(new Uint8Array([1, 2, 3])), /not a \.docx or \.pptx/);
  // Read by ranges (a big deck from Canvas): only the zip directory and the slide XML are fetched
  const bytes = new Uint8Array(fs.readFileSync(new URL('./data/sample.pptx', import.meta.url))); const calls = [];
  const ranged = await EV.officeText({ size: bytes.length, range: async (a, b) => { calls.push([a, b]); return bytes.slice(a, b); } });
  assert.equal(ranged.text, pptx.text); assert.equal(calls.length, 3); // the directory, then one range per slide
  const copy = new Function('return ' + EV.officeText.toString())();
  assert.equal((await copy(fs.readFileSync(new URL('./data/sample.pptx', import.meta.url)))).pages, 2);
});

test('library: uploads become materials written by the page; page images read by Claude merge back by page', () => {
  const now = '2026-10-18T01:00:00Z';
  const u = EV.materialFromUpload({ title: 'Head to toe checklist.pdf', text: '[p1] Head-to-toe: hand hygiene, identify client, inspect skin...\n[p2] ', fileType: 'pdf', pages: 2, ocrPages: [2] }, { now, existingIds: ['up-2026-10-17-head-to-toe-checklist'] });
  assert.equal(u.id, 'up-2026-10-17-head-to-toe-checklist-2');
  assert.equal(u.data.course, 'NUR 112'); assert.equal(u.data.kind, 'upload'); assert.deepEqual(u.data.ocr.pages, [2]); assert.equal(u.data.source, 'upload');
  assert.equal(u.data.writer, 'page'); assert.ok(!('status' in u.data), 'removal lives in materialedits');
  assertValid({ op: 'set', collection: 'materials', id: u.id, data: u.data });
  assert.equal(EV.materialFromUpload({ title: 'Skull bones.jpg', text: 'Frontal bone, parietal bone, occipital bone' }, { now }).data.course, 'BIO 201');
  assert.throws(() => EV.materialFromUpload({ title: 'blank.pdf', text: '[p1] \n[p2] ' }, { now }), /no readable text/);
  const pages = EV.parseOcr({ pages: [{ page: 2, text: 'Auscultate  heart' }, { page: 9, text: 'not asked' }] }, [2]);
  assert.deepEqual(pages, { 2: 'Auscultate heart' });
  assert.equal(EV.mergeOcr('[p1] One\n[p2] \n[p3] Three\n', pages), '[p1] One\n[p2] Auscultate heart\n[p3] Three\n');
  assert.match(EV.ocrPrompt({ title: 'X', pages: [1, 2] }), /pages 1, 2 of "X"[\s\S]*\{"pages"/);
});

test('library: Canvas files keep kind, type and link; a read handout survives an image-only refetch', () => {
  const raw = { host: 'https://alabama.instructure.com', courses: { 'NUR 112': 199214 }, files: [{ course: 'NUR 112', courseId: 199214, fileId: 77, title: 'Handout.pdf', module: 'Exam 4 Content', kind: 'handout', fileType: 'pdf', updatedAt: 'v2', pages: 1, text: '[p1] ', needsOcr: true }] };
  const old = { id: 'NUR112-77', fileUpdatedAt: 'v1', text: '[p1] Erikson stages...', ocr: { by: 'Claude', at: '2026-10-17T00:00:00Z', pages: [1] } };
  const res = EV.normalizeCanvas(raw, { materials: [old] }, { now: '2026-10-18T01:00:00Z' });
  const m = res.materials[0].data;
  assert.equal(m.schema, 1); assert.equal(m.writer, 'canvas-sync'); assert.equal(m.kind, 'handout'); assert.equal(m.url, 'https://alabama.instructure.com/courses/199214/files/77');
  assert.equal(m.text, '[p1] Erikson stages...'); assert.equal(m.ocr.stale, true);
  assertValid({ op: 'set', collection: 'materials', id: 'NUR112-77', data: m });
  const fresh = EV.normalizeCanvas({ ...raw, files: [{ ...raw.files[0], fileId: 78 }] }, {}, { now: '2026-10-18T01:00:00Z' });
  assert.match(fresh.changes[0].text, /image-only: attach it in the conversation/);
});

test('identifier values in whole files: field names alone pass, values do not', () => {
  assert.deepEqual(EV.scanIdentifierValues('Label the syringe with the patient’s name, DOB, MRN. Check the medical record for the order. DOB Date Of Birth.'), []);
  assert.deepEqual(EV.scanIdentifierValues('Lab is in Room 112 on Tuesdays.'), []);
  assert.deepEqual(EV.scanIdentifierValues('MRN: 4482913'), ['has a medical record number']);
  assert.deepEqual(EV.scanIdentifierValues('DOB 3/14/1952'), ['has a date of birth', 'has what looks like a birth date']);
  assert.deepEqual(EV.scanIdentifierValues('The resident in room 12 was confused'), ["has a patient's room number"]);
  assert.ok(EV.scanIdentifiers('Label with DOB and MRN').length > 0); // messages stay strict
});

// ---------------------------------------------------------------- B-05 review follow-ups
test('answering finds the set\'s answers document among ctx.answers, so an earlier attempt is never overwritten', () => {
  const set = { id: 'review-2026-10-18', kind: 'review', items: [] };
  const earlier = answersDoc(set.id, { q0: { [key(at('2026-10-18', '14:00'))]: { chosen: [0], correct: true, score: 1, at: at('2026-10-18', '14:00') } } });
  const q = { id: 'q2', kind: 'check', objective: 'E4-2', topic: 'Made-up topic', type: 'single', options: ['a', 'b'], correct: [0] };
  const r = EV.planAnswer({ set, item: q, chosen: [0], now: '2026-10-18T15:00:00Z', weakspots: [], exams: [E4], answers: [earlier] });
  assert.equal(r.writes[0].op, 'update'); assertValid(r.writes[0], earlier);
  assert.equal(EV.planAnswer({ set, item: q, chosen: [0], now: '2026-10-18T15:00:00Z', weakspots: [], exams: [E4], answers: [] }).writes[0].op, 'set');
});

test('answering with planedits: a ticked reading is no longer ahead, so a miss is a weak spot, not a preview', () => {
  const now = '2026-10-18T15:00:00Z';
  const plan = { id: 'E4', ...EV.planFromCards([{ days: [['Sun 10/18', '', [['Read Pharm Ch 27 (macrolides)']]]] }], { examId: 'E4', year: 2026, now }) };
  const taskId = plan.days[0].tasks[0].id;
  const q = { id: 'q4', kind: 'drill', objective: 'E4-7', topic: 'Macrolide teaching', chapters: ['Pharm 27'], type: 'single', options: ['a', 'b'], correct: [0] };
  const base = { set: { id: 'E4-drill-7' }, item: q, chosen: [1], now, weakspots: [], exams: [E4], plans: [plan] };
  assert.equal(EV.planAnswer(base).writes.find(w => w.collection === 'weakspots').data.preRead, true);
  const ticked = EV.planAnswer({ ...base, planedits: [{ id: 'E4', ticks: { [taskId]: { at: at('2026-10-18', '13:00'), by: 'Matt' } } }] });
  assert.ok(!ticked.writes.find(w => w.collection === 'weakspots').data.preRead);
});

test('planViews matches planedits on the exam id first', () => {
  const [v] = EV.planViews([{ id: 'plan-e4-v2', exam: 'E4', days: [] }], [{ id: 'E4', ticks: { t1: { at: at('2026-10-18'), by: 'Matt' } } }]);
  assert.deepEqual(Object.keys(v.done), ['t1']);
});

test('a dateedits override never masks a Canvas entry; notes and removal still apply', () => {
  const canvas = { id: 'canvas-1', writer: 'canvas-sync', date: '2026-10-20', title: 'Quiz', kind: 'due', graded: true };
  const hand = { id: '2026-10-23-lab', writer: 'page', date: '2026-10-23', title: 'Lab', kind: 'exam' };
  const edit = { overrides: { date: '2026-10-30', title: 'Moved' }, notes: 'bring calculator', removed: null };
  const c = EV.dateView(canvas, edit); assert.deepEqual([c.date, c.title, c.notes], ['2026-10-20', 'Quiz', 'bring calculator']);
  const h = EV.dateView(hand, edit); assert.deepEqual([h.date, h.title, h.notes], ['2026-10-30', 'Moved', 'bring calculator']);
  assert.equal(EV.liveDates([canvas], [{ id: 'canvas-1', removed: { at: at('2026-10-18'), by: 'Matt' } }]).length, 0);
});

test('derivedHash sorts ids by code unit, not by locale', () => {
  const d = { status: 'open' };
  const expected = EV.sha256(EV.stableStringify([['B', d], ['a', d]]));
  assert.equal(EV.derivedHash([{ id: 'a', derived: d }, { id: 'B', derived: d }]), expected);
});

test('list edits: who did it is Matt or E.V.; a planned item taken off for the day cannot be checked until it is back', () => {
  const now = '2026-10-17T23:20:00Z';
  const day = { id: '2026-10-17', date: '2026-10-17', list: { items: [{ id: 'plan-t1', text: 'Pharm Ch 14 reading', tag: 'READING', minutes: 45 }] } };
  assert.equal(EV.listEdit(day, null, { action: 'add', text: 'Made-up item' }, { now, by: 'someone else' }).doc.added['add-made-up-item'].by, 'E.V.');
  const off = EV.listEdit(day, null, { action: 'remove', id: 'plan-t1' }, { now, by: 'Matt' });
  assert.equal(off.doc.skipped['plan-t1'].by, 'Matt');
  assert.throws(() => EV.listEdit(day, { id: '2026-10-17', ...off.doc }, { action: 'check', id: 'plan-t1' }, { now }), /off the list for the day; bring it back first/);
});

test('schemas: a reopen event is a weak spot event; an announcement with no Canvas post time keeps postedAt null', () => {
  const w = ws('made-up', { events: ev(at('2026-10-18'), { type: 'reopen', by: 'Matt' }) });
  assertValid({ op: 'set', collection: 'weakspots', id: w.id, data: EV.docData(w) });
  const raw = { courses: { 'NUR 112': 199214 }, planner: [], announcements: [{ id: 10, title: 'Made up', message: '<p>Hi</p>', context_code: 'course_199214' }] };
  const a = EV.normalizeCanvas(raw, {}, { now: '2026-10-17T20:15:00Z' }).announcements[0];
  assert.equal(a.data.postedAt, null);
  assertValid({ op: 'set', collection: 'announcements', id: a.id, data: a.data });
});

test('session state skips an event whose time cannot be read, without disturbing the order of the rest', () => {
  const s = session({ [plus(7)]: { type: 'check', n: 1, items: 2 } });
  s.events['not-a-time'] = { type: 'break' };
  const st = EV.sessionState(s, plus(8));
  assert.equal(st.checks, 1); assert.equal(st.onBreak, false);
});
