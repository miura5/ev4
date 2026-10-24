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
  assert.match(p, /never help with graded/i);
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
  assert.match(p, /Never help with graded/);
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
