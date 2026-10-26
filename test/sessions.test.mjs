// E.V. core's study sessions (B-156, split from core.test.mjs with its sections): Study Watch intake (repeats,
// near-repeats, ideas, note to-dos) and study sessions in E.V. Home (D-073): timer, note delta, prompts and parsing,
// comment mode, closing. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { at, key, ws, E4, assertValid } from './core-fixtures.mjs';

// The session helpers (shared with the greeting test in core.test.mjs).
const T0 = '2026-10-18T15:00:00.000Z';
const plus = (min, sec = 0) => new Date(Date.parse(T0) + min * 60e3 + sec * 1e3).toISOString();
const sk = t => key(t);
const session = (events, extra = {}) => ({
  id: 'ss-20261018-150000-ch-42',
  source: 'E.V. Home',
  status: 'active',
  topic: 'Ch 42 Fluids',
  startedAt: T0,
  events: { [sk(T0)]: { type: 'start' }, ...Object.fromEntries(Object.entries(events).map(([t, e]) => [sk(t), e])) },
  ...extra,
});

test('Study Watch intake: repeats bump, near-repeats ask, non-objectives become ideas, gaps become note to-dos; every write validates', () => {
  const existing = [
    { ...ws('ws-k', { objective: 'E4-3', topic: 'Hypokalemia findings' }), derived: { status: 'open' } },
    { ...ws('ws-fluid', { objective: 'E4-3', topic: 'Fluid volume excess signs' }), derived: { status: 'open' } },
  ];
  const file = {
    id: '2026-10-18-0900-Ch-42',
    date: '2026-10-18',
    startedAt: '2026-10-18T14:00:00Z',
    endedAt: '2026-10-18T14:20:00Z',
    note: 'Ch 42',
    minutes: 20,
    summary: 's',
    weakSpots: [
      { objective: 'E4-3', topic: 'Hypokalemia findings' },
      { objective: 'E4-3', topic: 'Fluid volume excess' },
      { objective: 'E4-3', topic: 'Acid-base compensation' },
      { topic: 'Why the kidneys hold sodium' },
    ],
    connections: ['Potassium links insulin and the ECG'],
    noteTodos: ['Fill in the ABG table'],
  };
  const objectives = [{ id: 'E4-3' }];
  let r = EV.intakeSession(file, { weakspots: existing, objectives, now: '2026-10-18T15:00:00Z' });
  assert.equal(r.questions.length, 1, 'near-repeat asks');
  r = EV.intakeSession(file, {
    weakspots: existing,
    objectives,
    now: '2026-10-18T15:00:00Z',
    decisions: { ws1: 'same' },
  });
  const cols = r.writes.map(w => w.collection + ':' + w.op);
  const bump = r.writes.find(w => w.id === 'ws-k' && w.data.events);
  assert.ok(bump);
  assert.deepEqual(
    Object.keys(bump.data.events),
    ['filing-20261018-150000000'],
    'filed by the filing role, keyed by writer and time'
  );
  assert.ok(r.writes.some(w => w.id === 'ws-fluid' && w.data.events));
  assert.equal(cols.filter(c => c === 'weakspots:set').length, 2, 'acid-base new + one note to-do');
  assert.equal(cols.filter(c => c === 'ideas:set').length, 2, 'unconfirmed objective + connection');
  const byId = Object.fromEntries(existing.map(({ derived, ...doc }) => [doc.id, doc])); // stored documents carry no derived
  for (const w of r.writes) {
    assert.equal(w.op === 'set' ? w.data.writer : 'filing', 'filing');
    assertValid(w, byId[w.id]);
  }
  assert.ok(EV.intakeSession(file, { sessions: [{ id: '2026-10-18-0900-Ch-42' }] }).skip);
});

test('session timer: checks every 7 min; breaks keep the remaining time; +5 min; idle checks wrap up', () => {
  let st = EV.sessionState(session({}), plus(3));
  assert.equal(st.nextCheckAt, plus(7));
  assert.equal(st.due, false);
  assert.equal(st.minutes, 3);
  assert.equal(EV.sessionState(session({}), plus(7, 5)).due, true);
  st = EV.sessionState(
    session({ [plus(7)]: { type: 'check', n: 1, items: 3, len: 10, h: 'x', msgId: 'm1' } }),
    plus(8)
  );
  assert.equal(st.checks, 1);
  assert.equal(st.questions, 3);
  assert.equal(st.nextCheckAt, plus(14));
  assert.deepEqual(st.lastMark, { noteId: null, len: 10, h: 'x', modifiedAt: null });
  // break at 9 (5 min left), resume at 30: next check 5 min later; break time isn't study time
  st = EV.sessionState(
    session({
      [plus(7)]: { type: 'check', n: 1, items: 2 },
      [plus(9)]: { type: 'break' },
      [plus(30)]: { type: 'resume' },
    }),
    plus(31)
  );
  assert.equal(st.onBreak, false);
  assert.equal(st.nextCheckAt, plus(35));
  assert.equal(st.minutes, 10);
  st = EV.sessionState(session({ [plus(2)]: { type: 'break' } }), plus(4));
  assert.equal(st.onBreak, true);
  assert.equal(st.nextCheckAt, null);
  assert.equal(st.breakRemainingMs, 5 * 60e3);
  assert.equal(st.minutes, 2);
  st = EV.sessionState(session({ [plus(2)]: { type: 'extend' } }), plus(3));
  assert.equal(st.nextCheckAt, plus(12));
  st = EV.sessionState(session({ [plus(7)]: { type: 'idle' }, [plus(14)]: { type: 'idle' } }), plus(15));
  assert.equal(st.shouldWrap, false);
  st = EV.sessionState(
    session({ [plus(7)]: { type: 'idle' }, [plus(14)]: { type: 'idle' }, [plus(21)]: { type: 'idle' } }),
    plus(22)
  );
  assert.equal(st.shouldWrap, true);
  st = EV.sessionState(
    session({ [plus(7)]: { type: 'check', n: 1, items: 1 }, [plus(8)]: { type: 'answer', n: 1, msgId: 'm9' } }),
    plus(9)
  );
  assert.equal(st.answered[1], 'm9');
  st = EV.sessionState(session({}, { status: 'ended', endedAt: plus(40) }), plus(90));
  assert.equal(st.nextCheckAt, null);
  assert.equal(st.minutes, 40);
});

test('B-273 (D-267): her ring is the stretch to the next check: 0, a quarter, a half, full; it starts over after a check', () => {
  const at = p => new Date(Date.parse(T0) + p * 7 * 60e3).toISOString();
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' is not ' + b);
  assert.deepEqual(
    [0, 0.25, 0.5, 1].map(p => EV.sessionState(session({}), at(p)).toCheck),
    [0, 0.25, 0.5, 1]
  );
  // past due it stays full until the checkpoint lands, then starts over
  assert.equal(EV.sessionState(session({}), plus(9)).toCheck, 1);
  const checked = session({ [plus(7)]: { type: 'check', n: 1, items: 2 } });
  assert.equal(EV.sessionState(checked, plus(7)).toCheck, 0);
  near(EV.sessionState(checked, plus(10, 30)).toCheck, 0.5);
  // an answer does not move it (the answer shows on the check's card, D-217)
  const answered = session({ [plus(7)]: { type: 'check', n: 1, items: 2 }, [plus(8)]: { type: 'answer', n: 1 } });
  near(EV.sessionState(answered, plus(10, 30)).toCheck, 0.5);
  // +5 lengthens the stretch to 12 minutes: 3 of 12 done at minute 3, and it never runs backward
  const ext = session({ [plus(2)]: { type: 'extend' } });
  near(EV.sessionState(ext, plus(2)).toCheck, 2 / 12);
  near(EV.sessionState(ext, plus(3)).toCheck, 3 / 12);
  // a break holds it where it was
  const brk = session({ [plus(2)]: { type: 'break' } });
  near(EV.sessionState(brk, plus(2)).toCheck, 2 / 7);
  near(EV.sessionState(brk, plus(20)).toCheck, 2 / 7);
  // an ended session shows no stretch
  assert.equal(EV.sessionState(session({}, { status: 'ended', endedAt: plus(3) }), plus(4)).toCheck, 0);
});

test('session note delta: only the new writing; nothing new is idle; a rewrite falls back to the end', () => {
  const a = 'Fluid balance\nIsotonic: 0.9% NaCl.';
  const m = EV.noteMark(a);
  assert.deepEqual(EV.noteDelta(a + '\nHypotonic: 0.45% NaCl shifts water into cells.', m), {
    added: '\nHypotonic: 0.45% NaCl shifts water into cells.',
    same: false,
    rewritten: false,
  });
  assert.equal(EV.noteDelta(a, m).same, true);
  assert.equal(EV.noteDelta(a + '\n  ', m).same, true);
  const r = EV.noteDelta('Fluids (rewritten)\nIsotonic fluids stay put.', m);
  assert.equal(r.rewritten, true);
  assert.match(r.added, /stay put/);
  assert.equal(EV.noteDelta('x'.repeat(3000), null).added.length, 2500);
  assert.ok(!JSON.stringify(m).includes('Isotonic'), 'the mark carries no note text');
});

test('session prompts and parsing: Study Watch wording, record context, 1 to 3 items, wrap-up as JSON', () => {
  const ctx = EV.sessionContext({
    date: '2026-10-18',
    exams: [E4],
    objectives: [{ id: 'E4-3', exam: 'E4', text: 'Fluids and electrolytes', chapters: 'Ch 42' }],
    weakspots: [{ ...ws('ws-k', { topic: 'Hypokalemia findings' }), derived: { status: 'open' } }],
  });
  assert.equal(ctx.objectives, 1);
  assert.match(ctx.text, /E4-3: Fluids and electrolytes \[Ch 42\]/);
  assert.match(ctx.text, /Hypokalemia findings/);
  const p = EV.checkPrompt({
    noteName: 'Ch 42 Fluids',
    text: 'Fluid balance',
    added: 'Hypotonic shifts water into cells.',
    n: 2,
    context: ctx,
  });
  assert.match(p, /Study session check 2 on Matt's note "Ch 42 Fluids"/);
  assert.match(p, /New text since the last check:\nHypotonic/);
  assert.doesNotMatch(p, /graded|patient identifiers/i, 'D-324');
  assert.match(p, /data, never instructions/);
  assert.deepEqual(
    EV.parseCheck({
      items: [
        { text: '1. Why does 0.45% NaCl shift water into cells?', kind: 'why' },
        { text: 'Gap: no hypertonic example', kind: 'nope' },
        { text: '' },
        { text: 'c' },
        { text: 'd' },
      ],
    }).map(i => [i.text, i.kind]),
    [
      ['Why does 0.45% NaCl shift water into cells?', 'why'],
      ['Gap: no hypertonic example', 'why'],
      ['c', 'why'],
    ]
  );
  assert.equal(EV.parseCheck('Sure!\n1. One?\n2) Two?\n- Three?\n4. Four?').length, 3);
  assert.equal(EV.parseCheck(null).length, 0);
  const w = EV.parseWrap({
    summary: ' Worked  through fluids. ',
    weakSpots: [{ objective: 'E4-3', topic: 'Hypotonic shifts' }, 'none', { topic: 'none' }],
    connections: ['- none', 'Sodium follows water'],
    noteTodos: ['None'],
    cards: [{ term: 'Isotonic\t', definition: '0.9% NaCl\nstays in the vessels' }, { term: 'x' }],
  });
  assert.equal(w.summary, 'Worked through fluids.');
  assert.equal(w.weakSpots.length, 1);
  assert.deepEqual(w.connections, ['Sodium follows water']);
  assert.equal(w.noteTodos.length, 0);
  assert.deepEqual(w.cards, [{ term: 'Isotonic', definition: '0.9% NaCl stays in the vessels' }]);
  assert.equal(EV.cardsText(w.cards), 'Isotonic\t0.9% NaCl stays in the vessels');
  assert.match(
    EV.wrapPrompt({
      noteName: 'Ch 42',
      transcript: [
        { who: 'E.V.', text: '1. Why?' },
        { who: 'Matt', text: 'Because water follows sodium' },
      ],
      context: ctx,
    }),
    /Matt: Because water follows sodium/
  );
});

test('closing a session: one session update, weak spots by objective, ideas, note to-dos, near-repeats wait for Matt', () => {
  const existing = [
    { ...ws('ws-k', { objective: 'E4-3', topic: 'Hypokalemia findings' }), derived: { status: 'open' } },
    { ...ws('ws-fluid', { objective: 'E4-3', topic: 'Fluid volume excess signs' }), derived: { status: 'open' } },
  ];
  const s = session(
    {
      [plus(7)]: { type: 'check', n: 1, items: 3 },
      [plus(14)]: { type: 'check', n: 2, items: 2 },
      [plus(20)]: { type: 'end' },
    },
    { status: 'ending' }
  );
  const wrap = {
    summary: 'Fluids.',
    weakSpots: [
      { objective: 'E4-3', topic: 'Hypokalemia findings' },
      { objective: 'E4-3', topic: 'Fluid volume excess' },
      { objective: 'E4-3', topic: 'Acid-base compensation' },
      { topic: 'Why kidneys hold sodium' },
    ],
    connections: ['Potassium links insulin and the ECG'],
    noteTodos: ['Fill in the ABG table'],
    cards: [{ term: 'Isotonic', definition: '0.9% NaCl' }],
  };
  const r = EV.closeSession(s, wrap, { weakspots: existing, objectives: [{ id: 'E4-3' }], now: plus(21) });
  const up = r.writes[0];
  assert.equal(up.op, 'update');
  assert.equal(up.collection, 'sessions');
  assert.equal(up.data.status, 'ended');
  assert.equal(up.data.minutes, 20);
  assert.equal(up.data.checks, 2);
  assert.equal(up.data.questions, 5);
  assert.equal(up.data.cardCount, 1);
  assert.deepEqual(Object.keys(up.data.pending), ['ws1']);
  assert.equal(up.data.pending.ws1.candidate.id, 'ws-fluid');
  assert.deepEqual(up.data.weakSpots, ['Hypokalemia findings', 'Fluid volume excess', 'Acid-base compensation']);
  assert.deepEqual(up.data.connections, ['Potassium links insulin and the ECG', 'Why kidneys hold sodium']);
  const bump = r.writes.find(w => w.id === 'ws-k' && w.data.events);
  assert.ok(
    bump &&
      Object.values(bump.data.events)[0].by === 'Study session' &&
      Object.keys(bump.data.events)[0].startsWith('page-')
  );
  const sets = r.writes.filter(w => w.op === 'set');
  assert.equal(sets.filter(w => w.collection === 'weakspots').length, 2, 'acid-base + the note to-do');
  assert.equal(sets.filter(w => w.collection === 'ideas').length, 2);
  assert.ok(sets.every(w => !w.data.sessionId || w.data.sessionId === s.id));
  const sessionDoc = { ...s, schema: 2, writer: 'page', at: T0, source: 'E.V. Home', date: '2026-10-18' };
  const byId = Object.fromEntries([...existing, sessionDoc].map(({ derived, ...doc }) => [doc.id, doc]));
  for (const w of r.writes) assertValid(w, byId[w.id]);
  const d = EV.decideSessionQuestion({ ...s, pending: up.data.pending }, 'ws1', 'same', {
    weakspots: existing,
    objectives: [{ id: 'E4-3' }],
    now: plus(22),
  });
  assert.ok(d.some(w => w.id === 'ws-fluid' && w.data.events));
  assert.deepEqual(d[d.length - 1], {
    op: 'update',
    collection: 'sessions',
    id: s.id,
    data: { pending: { ws1: null } },
  });
  const d2 = EV.decideSessionQuestion({ ...s, pending: up.data.pending }, 'ws1', 'different', {
    weakspots: existing,
    objectives: [{ id: 'E4-3' }],
    now: plus(22),
  });
  assert.ok(d2.some(w => w.op === 'set' && w.collection === 'weakspots' && w.data.topic === 'Fluid volume excess'));
  assert.equal(
    EV.closeSession(session({}, { status: 'ending' }), {}, { now: plus(2) }).writes[0].data.summary,
    'Short session; no checks ran.'
  );
});

test('session state skips an event whose time cannot be read, without disturbing the order of the rest', () => {
  const s = session({ [plus(7)]: { type: 'check', n: 1, items: 2 } });
  s.events['not-a-time'] = { type: 'break' };
  const st = EV.sessionState(s, plus(8));
  assert.equal(st.checks, 1);
  assert.equal(st.onBreak, false);
});

test('B-88 comment mode: comments and quiet checkpoints move the mark without counting as checks; a quiz does', () => {
  const t0 = '2026-10-19T19:00:00.000Z';
  const at = m => new Date(Date.parse(t0) + m * 60e3).toISOString();
  const key = (type, m) =>
    type +
    '-' +
    at(m)
      .replace(/[-:]/g, '')
      .replace('T', '-')
      .replace(/\.\d+Z$/, '');
  const s = {
    status: 'active',
    startedAt: t0,
    events: {
      [key('start', 0)]: { type: 'start', at: at(0), len: 10, h: 'a', noteId: 'n' },
      [key('check', 2)]: { type: 'check', at: at(2), comment: true, len: 40, h: 'b', noteId: 'n', msgId: 'm-1' },
      [key('check', 7)]: { type: 'check', at: at(7), quiet: true, len: 60, h: 'c', noteId: 'n' },
      [key('idle', 14)]: { type: 'idle', at: at(14) },
      [key('check', 16)]: { type: 'check', at: at(16), n: 1, items: 2, len: 70, h: 'd', noteId: 'n' },
    },
  };
  const st = EV.sessionState(s, at(17));
  assert.equal(st.checks, 1);
  assert.equal(st.questions, 2);
  assert.equal(st.comments, 1);
  assert.equal(st.reads, 3);
  assert.deepEqual([st.lastMark.h, st.lastQuizMark.h], ['d', 'd']);
  const mid = EV.sessionState({ ...s, events: Object.fromEntries(Object.entries(s.events).slice(0, 3)) }, at(8));
  assert.deepEqual([mid.checks, mid.comments, mid.lastMark.h, mid.lastQuizMark.h, mid.idleChecks], [0, 1, 'c', 'a', 0]);
});

test('B-88 comment prompt and parser: silence by default, one short line, a quote only if he wrote it', () => {
  const p = EV.commentPrompt({
    noteName: 'Cardiac',
    opening: 'CO = HR x SV',
    before: 'Preload',
    added: 'SV falls if afterload climbs\n',
    context: { text: 'Next exam: E4' },
  });
  assert.match(p, /Most of the time, say nothing/);
  assert.match(p, /The new lines he just wrote:\nSV falls if afterload climbs/);
  assert.match(p, /Next exam: E4/);
  assert.doesNotMatch(p, /graded|patient identifiers/i, 'D-324');
  assert.equal(EV.parseComment({ say: null }, 'x'), null);
  assert.equal(EV.parseComment({ say: 'null' }, 'x'), null);
  assert.equal(EV.parseComment('nope', 'x'), null);
  assert.deepEqual(
    EV.parseComment(
      { say: ' Good link.  That is afterload on the exam. ', quote: '“SV falls if afterload climbs”', kind: 'exam' },
      'SV falls if afterload climbs\n'
    ),
    { say: 'Good link. That is afterload on the exam.', quote: 'SV falls if afterload climbs', kind: 'exam' }
  );
  assert.equal(EV.parseComment({ say: 'Nice.', quote: 'not in his note', kind: 'odd' }, 'SV falls').quote, null);
  assert.equal(EV.parseComment({ say: 'Nice.', kind: 'odd' }, 'SV falls').kind, 'connection');
});

test('B-287 (C-7): a note from the header’s New is one ideas write: his words, kind general, open, no course', () => {
  const w = EV.noteIdea('  Rounding to   tenths for mL ', { at: T0, date: '2026-10-18' });
  assert.equal(w.op, 'set');
  assert.equal(w.collection, 'ideas');
  assert.match(w.id, /^idea-2026-10-18-100000-rounding/);
  assert.equal(w.data.text, 'Rounding to tenths for mL');
  assert.equal(w.data.kind, 'general');
  assert.equal(w.data.status, 'open');
  assert.equal(w.data.source, 'New note');
  assert.ok(!('course' in w.data));
  assertValid(w);
  assert.throws(() => EV.noteIdea('   ', { at: T0, date: '2026-10-18' }), /needs words/);
});

test('B-381: the score he tells E.V. is the old form’s examedits write: score, scoreAt, status done, kept whole', () => {
  const w = EV.examScore('E4', 88.5, { at: T0 });
  assert.deepEqual([w.op, w.collection, w.id], ['set', 'examedits', 'E4']);
  assert.deepEqual([w.data.score, w.data.scoreAt, w.data.status, w.data.writer], [88.5, T0, 'done', 'page']);
  assertValid(w);
  const again = EV.examScore('E4', 90, { at: '2026-10-19T15:00:00.000Z', current: { id: 'E4', ...w.data } });
  assert.equal(again.data.at, T0, 'the envelope of the first write stays');
  assert.equal(again.data.score, 90);
  assert.ok(!('id' in again.data));
  assert.throws(() => EV.examScore('E4', 101, { at: T0 }), /0 to 100/);
});

test('B-381: two notes with the same title on the same day both survive (time in the id, -2 when taken)', () => {
  const a = EV.noteIdea('Rounding', { at: T0, date: '2026-10-18' });
  const b = EV.noteIdea('Rounding', { at: '2026-10-18T15:04:09.000Z', date: '2026-10-18', existing: [a] });
  const c = EV.noteIdea('Rounding', { at: T0, date: '2026-10-18', existing: [{ id: a.id }, b.id] });
  assert.match(a.id, /^idea-2026-10-18-100000-rounding$/, 'the time is Central, as the date is');
  assert.notEqual(a.id, b.id);
  assert.equal(c.id, a.id + '-2');
  const store = {};
  for (const w of [a, b, c]) {
    assert.ok(!(w.id in store), 'never overwrites an existing idea');
    store[w.id] = w.data;
  }
  assert.equal(Object.keys(store).length, 3);
});

test('B-381: record_score holds only a number he typed plainly in this turn’s line', () => {
  assert.equal(EV.scoreSaid(88.5, 'I got 88.5 on Exam 4'), true);
  assert.equal(EV.scoreSaid(88.5, '88.5'), true);
  assert.equal(EV.scoreSaid(92, 'I got 92 on exam 4'), true);
  assert.equal(EV.scoreSaid(4, 'I got 92 on exam 4'), false, 'the exam’s number is never the score');
  assert.equal(EV.scoreSaid(85, 'maybe around 85?'), false, 'a hedged line is refused');
  assert.equal(EV.scoreSaid(85, 'I think 85'), false);
  assert.equal(EV.scoreSaid(100, '88 out of 100'), false);
  assert.equal(EV.scoreSaid(88, '88 out of 100'), true);
  assert.equal(EV.scoreSaid(90, 'I did ok on Exam 4'), false);
  assert.equal(EV.scoreSaid(90, ''), false, 'a turn without his new line approves nothing');
  // B-388: /100 and exam ids like E4 are never the score; only a line with exactly one number left is accepted
  assert.equal(EV.scoreSaid(100, 'I got 88/100 on exam 4'), false);
  assert.equal(EV.scoreSaid(88, 'I got 88/100 on exam 4'), true);
  assert.equal(EV.scoreSaid(88, 'I got 88 / 100 on exam 4'), true);
  assert.equal(EV.scoreSaid(4, 'E4 was 88'), false);
  assert.equal(EV.scoreSaid(88, 'E4 was 88'), true);
  assert.equal(EV.scoreSaid(88, 'I got 88 and Sam got 92'), false, 'two numbers left: which is his is unclear');
});

test('B-388: two sessions on one open topic make one idea; the second links to it and writes no idea', () => {
  const file = (id, at) => ({
    id,
    date: '2026-10-18',
    startedAt: at,
    note: 'Ch 42',
    weakSpots: [{ topic: 'Why the kidneys hold sodium' }],
    connections: ['Potassium links insulin and the ECG'],
  });
  const a = EV.intakeSession(file('sw-a', '2026-10-18T14:00:00Z'), { now: '2026-10-18T15:00:00Z' });
  const made = a.writes.filter(w => w.collection === 'ideas');
  assert.equal(made.length, 2);
  const ideas = made.map(w => ({ id: w.id, ...w.data }));
  const b = EV.intakeSession(file('sw-b', '2026-10-19T14:00:00Z'), {
    ideas,
    sessions: [{ id: 'sw-a' }],
    now: '2026-10-19T15:00:00Z',
  });
  assert.equal(b.writes.filter(w => w.collection === 'ideas').length, 0, 'no second idea for the same topic');
  assert.deepEqual(b.linked.map(l => l.idea).sort(), ideas.map(i => i.id).sort());
  assert.ok(
    b.writes.every(w => w.collection !== 'ideas'),
    'his status on the idea is never written'
  );
  // the text matches after normalising (case, punctuation, spacing)
  const s = { id: 'ss-1', topic: 'K', status: 'active', startedAt: T0 };
  const wrap = {
    summary: 'x',
    weakSpots: [],
    connections: ['  potassium links INSULIN and the ECG. '],
    noteTodos: [],
    cards: [],
  };
  const c = EV.closeSession(s, wrap, { now: '2026-10-20T15:00:00Z', ideas });
  assert.equal(c.writes.filter(w => w.collection === 'ideas').length, 0);
  assert.equal(c.linked[0].idea, ideas.find(i => /potassium/.test(i.id)).id);
  // an idea he promoted or archived is not open: a new idea is filed beside it, and his stays as it was
  const shut = ideas.map(i => ({ ...i, status: 'archived' }));
  const d = EV.closeSession(s, wrap, { now: '2026-10-20T15:00:00Z', ideas: shut });
  const w = d.writes.filter(x => x.collection === 'ideas');
  assert.equal(w.length, 1);
  assert.ok(!shut.some(i => i.id === w[0].id), 'a new id never overwrites one there');
  assert.deepEqual(d.linked, []);
});

test('B-388: two Study Watch files in one evening pass naming one open topic make one idea', async () => {
  // as the page's filing pass (page/app/62-ev-jobs-and-filing.js): each file's ideas join madeIdeas as documents
  const files = ['sw-a', 'sw-b'].map((id, i) => ({
    id,
    date: '2026-10-18',
    startedAt: `2026-10-18T1${4 + i}:00:00Z`,
    note: 'Ch 42',
    weakSpots: [{ topic: 'Why the kidneys hold sodium' }],
  }));
  const madeIdeas = [];
  let made = 0;
  for (const f of files) {
    const r = EV.intakeSession(f, { ideas: [...madeIdeas], now: '2026-10-18T20:00:00Z', writer: 'page' });
    for (const w of r.writes) if (w.collection === 'ideas') madeIdeas.push({ id: w.id, ...w.data });
    made += r.writes.filter(w => w.collection === 'ideas').length;
  }
  assert.equal(made, 1, 'the second file links to the first file’s idea');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../page/app/62-ev-jobs-and-filing.js', import.meta.url), 'utf8');
  assert.match(src, /madeIdeas\.push\(\{ id: w\.id, \.\.\.w\.data \}\)/, 'the pass keeps each idea’s text and status');
});

test('B-381: E.V.’s save_idea and a session’s findings never land on an idea already there', () => {
  const at = '2026-10-18T15:04:09.000Z';
  const first = EV.ideaId('Potassium links insulin and the ECG', { at, date: '2026-10-18' });
  assert.equal(first, 'idea-2026-10-18-100409-potassium-links-insulin-and-th');
  assert.equal(EV.ideaId('Potassium links insulin and the ECG', { at, existing: [{ id: first }] }), first + '-2');
  const s = { id: 'ss-1', topic: 'K', status: 'active', startedAt: T0 };
  const wrap = { summary: 'x', weakSpots: [], connections: ['Same words', 'Same words'], noteTodos: [], cards: [] };
  const old = { id: 'idea-2026-10-18-100409-same-words', status: 'done' };
  const r = EV.closeSession(s, wrap, { now: at, ideas: [old] });
  const ids = r.writes.filter(w => w.collection === 'ideas').map(w => w.id);
  assert.deepEqual(
    ids,
    [old.id + '-2', old.id + '-3'],
    'his done idea stays as he left it; two same lines are two ideas'
  );
});

test('B-406 (D-325): a second session ends and logs the running one; Undo restores it whole through marks', () => {
  const merge = (a, b) => {
    const o = { ...a };
    for (const [k, v] of Object.entries(b))
      o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
    return o;
  };
  const apply = (doc, writes) => {
    for (const w of writes.filter(x => x.id === doc.id)) {
      assertValid(w, doc);
      doc = merge(doc, w.data);
    }
    return doc;
  };
  const base = {
    schema: 2,
    writer: 'page',
    at: T0,
    source: 'E.V. Home',
    kind: 'note',
    date: '2026-10-18',
    planned: 25,
    noteId: 'n-20261018-150000-abcdefgh',
    note: 'notes/n-20261018-150000-abcdefgh',
  };
  // the start writes: a new note at its empty mark, naming notes/<id>; a Today task with no note, its estimate long
  const w0 = EV.startTimedSession({
    id: 'ss-20261018-150000-new-note',
    at: T0,
    key: sk(T0),
    topic: 'New note',
    noteId: base.noteId,
    fresh: true,
    comments: 'more',
    view: 'v1',
  });
  assertValid(w0);
  assert.equal(w0.data.note, base.note);
  assert.equal(w0.data.planned, 25);
  assert.deepEqual(Object.values(w0.data.events)[0], { type: 'start', noteId: base.noteId, ...EV.noteMark('') });
  const w1 = EV.startTimedSession({
    id: 'ss-20261018-150000-lab',
    at: T0,
    key: sk(T0),
    topic: 'Lab draft',
    planned: 40,
  });
  assertValid(w1);
  assert.equal(w1.data.note, undefined);
  assert.equal(w1.data.planned, 40);
  assert.equal(w1.data.comments, 'some');
  // A: a note session, a quiz at 7 answered at 8, a +5 at 9
  let a = session(
    {
      [plus(7)]: { type: 'check', n: 1, items: 2, msgId: 'm1' },
      [plus(8)]: { type: 'answer', n: 1, msgId: 'm2' },
      [plus(9)]: { type: 'extend' },
    },
    base
  );
  const before = EV.sessionState(a, plus(10));
  assert.equal(before.planned, 30, '+5 lengthens a timed session');
  assert.equal(before.leftMs, 20 * 60e3);
  assert.equal(before.nextCheckAt, plus(19));
  // the switch at 10: A is ended (a mark and an event), B starts
  const sw = EV.switchSession(a, { at: plus(10), key: sk(plus(10)) });
  assert.equal(sw.length, 1);
  assert.deepEqual(Object.keys(sw[0].data).sort(), ['endedAt', 'events', 'status']);
  a = apply(a, sw);
  assert.equal(a.status, 'ended');
  assert.ok(EV.switchedUnfiled(a), 'ended by the switch, waiting to be filed');
  const ended = EV.sessionState(a, plus(10, 20));
  assert.equal(ended.minutes, 10, 'logged: ten minutes so far');
  assert.equal(ended.nextCheckAt, null);
  assert.equal(
    EV.switchSession(a, { at: plus(11), key: sk(plus(11)) }).length,
    0,
    'an ended session is not ended twice'
  );
  let b = {
    ...session({}, { ...base, id: 'ss-20261018-151000-new-note', startedAt: plus(10), planned: 25 }),
    events: { [sk(plus(10, 1))]: { type: 'start', len: 0, h: EV.noteMark('').h } },
  };
  // Undo 20 s later: B discarded, A active again; nothing removed
  const undo = EV.undoSwitch(a, b, { at: plus(10, 20), keys: [sk(plus(10, 20)), sk(plus(10, 21))] });
  assert.equal(undo.length, 2);
  assert.ok(undo.every(w => w.op === 'update'));
  const evBefore = Object.keys(a.events).length;
  a = apply(a, undo);
  b = apply(b, undo);
  assert.equal(b.status, 'discarded');
  assert.equal(Object.values(b.events).filter(e => e.type === 'end').length, 1);
  assert.equal(a.status, 'active');
  assert.equal(a.endedAt, null);
  assert.equal(Object.keys(a.events).length, evBefore + 1, 'one reopen event added; every event kept');
  assert.equal(EV.switchedUnfiled(a), false);
  const after = EV.sessionState(a, plus(10, 20));
  assert.equal(after.minutes, 10, 'the timer is where it stopped');
  assert.equal(after.leftMs, 20 * 60e3);
  assert.equal(after.nextCheckAt, plus(19, 20), 'the next check moves on by the time it stood ended');
  assert.equal(after.answered[1], 'm2', 'the check answer stands');
  assert.equal(after.checks, 1);
  assert.equal(EV.undoSwitch(a, b, { at: plus(11), keys: [sk(plus(11)), sk(plus(11, 1))] }).length, 0, 'once');
  // B-406 review: Undo changes nothing once the ended session can't be reopened (filed, or past the window)
  // the clock runs out at 30 study minutes (10:20 to 30:20), and ends then
  assert.equal(EV.sessionState(a, plus(30, 10)).timeUp, false);
  assert.equal(EV.sessionState(a, plus(30, 20)).timeUp, true);
  assert.equal(EV.sessionState(a, plus(40)).shouldWrap, false, 'a timed session ends on its clock, not on idle');
  // a session the switch ended and nobody undid is filed in full: its minutes, summary and status
  let c = apply(session({ [plus(7)]: { type: 'check', n: 1, items: 1 } }, base), [
    EV.switchSession(session({}, base), { at: plus(12), key: sk(plus(12)) })[0],
  ]);
  const r = EV.closeSession(c, { summary: 'Fluids.' }, { now: plus(12, 30), endedBy: 'switched' });
  assertValid(r.writes[0], c);
  c = apply(c, r.writes);
  assert.equal(c.minutes, 12);
  assert.equal(c.endedAt, plus(12));
  assert.equal(c.summary, 'Fluids.');
  assert.equal(EV.switchedUnfiled(c), false, 'filed');
  const late = { ...b, status: 'active' };
  assert.deepEqual(
    EV.undoSwitch(c, late, { at: plus(13), keys: [sk(plus(13)), sk(plus(13, 1))] }),
    [],
    'Undo after filing changes nothing: the new session is not discarded'
  );
  let e = apply(session({}, base), [EV.switchSession(session({}, base), { at: plus(12), key: sk(plus(12)) })[0]]);
  assert.equal(EV.switchedAt(e), plus(12));
  assert.equal(
    EV.undoSwitch(e, late, { at: plus(12, 11), keys: [sk(plus(12, 11)), sk(plus(12, 12))], windowMs: 12e3 }).length,
    2,
    'inside the window'
  );
  assert.deepEqual(
    EV.undoSwitch(e, late, { at: plus(12, 12), keys: [sk(plus(12, 12)), sk(plus(12, 13))], windowMs: 12e3 }),
    [],
    'past the window, nothing'
  );
  assert.equal(EV.undoSwitch(null, late, { at: plus(13), keys: ['a', 'b'] }).length, 0);
  // a break at the switch is a break again after Undo
  let d = apply(session({ [plus(3)]: { type: 'break' } }, base), [
    EV.switchSession(session({ [plus(3)]: { type: 'break' } }, base), { at: plus(4), key: sk(plus(4)) })[0],
  ]);
  d = apply(d, EV.undoSwitch(d, null, { at: plus(5), keys: [sk(plus(5)), sk(plus(5, 1))] }));
  const ds = EV.sessionState(d, plus(6));
  assert.equal(ds.onBreak, true);
  assert.equal(ds.minutes, 3);
  assert.equal(ds.breakStartedAt, plus(5));
});

test('B-411: the switching view is on the end event; a filing mark makes filing again after a reload write each finding once', () => {
  const base = {
    schema: 2,
    writer: 'page',
    at: T0,
    source: 'E.V. Home',
    kind: 'note',
    date: '2026-10-18',
    planned: 25,
  };
  const merge = (a, b) => {
    const o = { ...a };
    for (const [k, v] of Object.entries(b))
      o[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
    return o;
  };
  // the end event names the view that switched
  const s0 = session({ [plus(7)]: { type: 'check', n: 1, items: 2 } }, base);
  const sw = EV.switchSession(s0, { at: plus(10), key: sk(plus(10)), view: 'view-a' });
  assertValid(sw[0], s0);
  let s = merge(s0, sw[0].data);
  assert.deepEqual(EV.switchedEnd(s), { at: plus(10), view: 'view-a' });
  assert.equal(EV.switchedAt(s), plus(10));
  // the filing mark lands first, with its time and summary
  const wrap = {
    summary: 'Potassium.',
    weakSpots: [{ objective: 'E4-3', topic: 'Hyperkalemia ECG' }, { topic: 'Why the kidneys hold potassium' }],
    connections: ['Insulin moves potassium into cells'],
    noteTodos: ['Fill in the ECG table'],
  };
  const fm = EV.filingMark(s, wrap, { now: plus(10, 30) });
  assertValid(fm, s);
  s = merge(s, fm.data);
  const opts = { weakspots: [], objectives: [{ id: 'E4-3' }], ideas: [], endedBy: 'switched' };
  const first = EV.closeSession(s, { summary: 'a different summary' }, { ...opts, now: plus(11) });
  assert.equal(first.writes[0].data.summary, 'Potassium.', 'filed from the mark, not a second summary');
  assert.equal(first.writes[0].data.filedAt, plus(10, 30), 'at the mark’s time');
  const sets = first.writes.filter(w => w.op === 'set');
  assert.equal(sets.length, 4, 'a weak spot, two ideas and a note to-do');
  // a reload after the findings landed but before the session's own update: filed again, each finding once
  const ideas = sets.filter(w => w.collection === 'ideas').map(w => ({ id: w.id, ...w.data }));
  const weakspots = sets
    .filter(w => w.collection === 'weakspots')
    .map(w => ({ id: w.id, ...w.data, derived: { status: 'open' } }));
  const again = EV.closeSession(s, {}, { ...opts, weakspots, ideas, now: plus(30) });
  assert.equal(again.writes.filter(w => w.op === 'set').length, 0, 'no finding written twice');
  assert.equal(again.writes.filter(w => w.collection === 'weakspots').length, 0, 'and no weak spot seen again');
  assert.deepEqual(again.writes[0].data, first.writes[0].data, 'the same session update');
  // a weak spot already in the record before the session is seen once: filed again, the same event key
  const old = [{ ...ws('ws-k', { objective: 'E4-3', topic: 'Hyperkalemia ECG' }), derived: { status: 'open' } }];
  const seen1 = EV.closeSession(s, {}, { ...opts, weakspots: old, now: plus(11) }).writes.find(w => w.id === 'ws-k');
  const seen2 = EV.closeSession(s, {}, { ...opts, weakspots: old, now: plus(40) }).writes.find(w => w.id === 'ws-k');
  assert.ok(seen1);
  assert.deepEqual(seen2, seen1);
  // with no mark (a session ended the usual way) closing is as before
  const plain = EV.closeSession(session({ [plus(7)]: { type: 'end' } }, base), wrap, { ...opts, now: plus(8) });
  assert.equal(plain.writes[0].data.filedAt, plus(8));
});
