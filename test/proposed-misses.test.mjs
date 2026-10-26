// B-407 (D-237, D-334): a miss she finds waits as a proposed weak spot for his triage in Study's To review. A session's
// missed check, filed at its close through the findings path, and a missed quiz question each write one proposed spot;
// it is in no review pick and no readiness count until he accepts it, and a second miss on it adds nothing. Made-up data.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { at, key, ws, E4, assertValid, spec } from './core-fixtures.mjs';
import { produce } from '../core/derive.mjs';

const T0 = '2026-10-18T15:00:00.000Z';
const plus = min => new Date(Date.parse(T0) + min * 60e3).toISOString();
const session = (events, extra = {}) => ({
  id: 'ss-20261018-150000-n9',
  source: 'E.V. Home',
  status: 'ending',
  kind: 'note',
  topic: 'Acid-base',
  startedAt: T0,
  events: {
    [key(T0)]: { type: 'start' },
    ...Object.fromEntries(Object.entries(events).map(([t, e]) => [key(t), e])),
  },
  ...extra,
});
const objectives = [{ id: 'E4-3', exam: 'E4' }];
const counted = ws('ws-counted', {
  objective: 'E4-3',
  initial: { streak: 0, nextDue: '2026-10-18', recurrence: 1, misses: 0 },
});
const wrap = {
  summary: 'Checked ABG steps.',
  weakSpots: [{ objective: 'E4-3', topic: 'Full vs partial compensation' }],
};
const build = docs => EV.buildWeakspots({ weakspots: docs, sets: [], answers: [], exams: [E4] });
const docOf = w => ({ id: w.id, ...w.data });
const ids = xs => xs.map(w => w.id).sort();

test('B-407: a planted session miss is filed as proposed, in no review pick and no readiness count, and in To review', () => {
  const s = session({ [plus(7)]: { type: 'check', n: 1, items: 1 }, [plus(20)]: { type: 'end' } });
  const r = EV.closeSession(s, wrap, { weakspots: build([counted]), objectives, now: plus(21) });
  // the filing order B-411 set: findings first, the session's own update (which marks it filed) last
  assert.equal(EV.closeUpdate(r.writes)[0].collection, 'sessions');
  const found = EV.closeFindings(r.writes).filter(w => w.collection === 'weakspots' && w.op === 'set');
  assert.equal(found.length, 1);
  const spot = found[0];
  assert.equal(spot.data.proposed, true);
  assert.equal(spot.data.topic, 'Full vs partial compensation');
  assert.equal(spot.data.objective, 'E4-3');
  assert.equal(spot.data.origin.session, s.id);
  assertValid(spot);
  const models = build([counted, docOf(spot)]);
  const m = models.find(w => w.id === spot.id);
  assert.equal(m.derived.status, 'proposed');
  assert.equal(EV.isActive(m), false);
  for (const date of ['2026-10-18', '2026-10-19', '2026-10-25'])
    assert.deepEqual(ids(EV.rankDue(models, date, [E4])).includes(spot.id), false, date);
  const pick = EV.pickReviews({ date: '2026-10-19', dayType: 'off', exams: [E4], weakspots: models, objectives: [] });
  assert.equal(ids(pick.picked).includes(spot.id), false, 'no review pick');
  const rd = EV.readiness({ examId: 'E4', weakspots: models });
  assert.equal(rd.active + rd.solid, 1, 'readiness counts only the counted spot');
  const audit = EV.readinessAudit({ examId: 'E4', objectives, weakspots: models });
  assert.equal(audit[0].notYet + audit[0].rightOnce + audit[0].solid + audit[0].preRead, 1);
  assert.deepEqual(ids(EV.toReview(models, '2026-10-19')), [spot.id], 'it waits in To review');

  // the next session finding the same miss adds nothing while it waits, nor on the day he declined it; a day later a
  // miss on a spot he declined proposes a fresh one, on a free id (B-407 review)
  const s2 = { ...session({ [plus(30)]: { type: 'end' } }), id: 'ss-20261018-153000-n9' };
  const again = EV.closeSession(s2, wrap, { weakspots: models, objectives, now: plus(31) });
  assert.equal(EV.closeFindings(again.writes).filter(w => w.collection === 'weakspots').length, 0);
  const declined = build([
    counted,
    { ...docOf(spot), events: { [key(plus(25))]: { type: 'decline', by: 'owner', at: plus(25) } } },
  ]);
  const after = EV.closeSession(s2, wrap, { weakspots: declined, objectives, now: plus(31) });
  assert.equal(EV.closeFindings(after.writes).filter(w => w.collection === 'weakspots').length, 0, 'declined today');
  const nextDay = new Date(Date.parse(T0) + 864e5).toISOString();
  const s3 = { ...session({ [nextDay]: { type: 'end' } }), id: 'ss-20261019-150000-n9' };
  const later = EV.closeFindings(EV.closeSession(s3, wrap, { weakspots: declined, objectives, now: nextDay }).writes);
  const fresh = later.filter(w => w.collection === 'weakspots' && w.op === 'set');
  assert.equal(fresh.length, 1, 'declined yesterday holds nothing');
  assert.equal(fresh[0].data.proposed, true);
  assert.notEqual(fresh[0].id, spot.id);
  // a twin he joined as a duplicate takes the miss as a seen event on its survivor, as an exact repeat does
  const joined = build([
    counted,
    {
      ...docOf(spot),
      links: [{ to: 'weakspots/ws-counted', type: 'duplicate-of', createdAt: plus(25), createdBy: 'owner' }],
    },
  ]);
  const dup = EV.closeFindings(EV.closeSession(s2, wrap, { weakspots: joined, objectives, now: plus(31) }).writes);
  assert.deepEqual(
    dup.filter(w => w.collection === 'weakspots').map(w => [w.op, w.id, Object.values(w.data.events || {})[0]?.type]),
    [['update', 'ws-counted', 'seen']]
  );

  // his accept counts it from tomorrow
  const acc = build([
    counted,
    {
      ...docOf(spot),
      events: { [key(plus(25))]: { type: 'accept', by: 'owner', objective: 'E4-3', at: plus(25) } },
    },
  ]).find(w => w.id === spot.id);
  assert.equal(acc.derived.status, 'open');
  assert.equal(acc.derived.nextDue, '2026-10-19');
});

test('B-407: a missed quiz question writes one proposed spot; a second miss on it names it and writes none', () => {
  const set = { id: 'practice-e4', kind: 'practice', exam: 'E4', items: [] };
  const item = {
    id: 'q1',
    kind: 'check',
    objective: 'E4-3',
    topic: 'Full vs partial compensation',
    type: 'single',
    options: ['a', 'b'],
    correct: [0],
  };
  const now = at('2026-10-18');
  const r = EV.planAnswer({ set, item, chosen: [1], now, weakspots: build([counted]), exams: [E4] });
  const made = r.writes.filter(w => w.collection === 'weakspots');
  assert.equal(made.length, 1);
  assert.equal(made[0].data.proposed, true);
  assert.equal(r.answer.createdWeakspot, made[0].id);
  assert.match(r.outcome, /To review/);
  assertValid(made[0]);
  const models = build([counted, docOf(made[0])]);
  assert.equal(models.find(w => w.id === made[0].id).derived.status, 'proposed');
  assert.deepEqual(ids(EV.rankDue(models, '2026-10-19', [E4])), ['ws-counted']);
  const r2 = EV.planAnswer({ set, item: { ...item, id: 'q2' }, chosen: [1], now, weakspots: models, exams: [E4] });
  assert.equal(r2.writes.filter(w => w.collection === 'weakspots').length, 0, 'the spot is never replaced');
  assert.equal(r2.answer.weakspotId, made[0].id);
  assert.match(r2.outcome, /Already proposed/);
  // declined today it still takes the miss; declined the day before, a miss proposes a fresh spot on a free id
  const dec = d =>
    build([counted, { ...docOf(made[0]), events: { [key(at(d))]: { type: 'decline', by: 'owner', at: at(d) } } }]);
  const r3 = EV.planAnswer({
    set,
    item: { ...item, id: 'q3' },
    chosen: [1],
    now,
    weakspots: dec('2026-10-18'),
    exams: [E4],
  });
  assert.equal(r3.writes.filter(w => w.collection === 'weakspots').length, 0);
  const r4 = EV.planAnswer({
    set,
    item: { ...item, id: 'q4' },
    chosen: [1],
    now: at('2026-10-19'),
    weakspots: dec('2026-10-18'),
    exams: [E4],
  });
  const fresh = r4.writes.filter(w => w.collection === 'weakspots');
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].data.proposed, true);
});

test('B-407 review: Join targets only a near-repeat: a concept, open or solid, same objective, at least 0.5 similar', () => {
  const models = build([
    counted, // 'counted' under E4-3: unrelated words
    ws('ws-frank', { objective: 'E4-3', topic: 'Frank-Starling law' }),
    ws('ws-frank-other', { objective: 'E4-2', topic: 'Frank-Starling curve' }),
  ]);
  const spot = { id: 'ws-new', objective: 'E4-3', topic: 'Frank-Starling curve' };
  assert.equal(EV.joinTarget(models, spot).id, 'ws-frank');
  assert.equal(EV.joinTarget(models, { ...spot, topic: 'Afterload and vasoconstriction' }), null, 'unrelated: off');
  // B-407 review: close words naming opposite things are never a join target (hypo and hyper, left and right, type 1
  // and type 2), though their similarity alone would allow one
  for (const [have, miss] of [
    ['Hypokalemia ECG changes and signs', 'Hyperkalemia ECG changes and signs'],
    ['Left-sided heart failure signs', 'Right-sided heart failure signs'],
    ['Type 1 diabetes insulin needs', 'Type 2 diabetes insulin needs'],
  ]) {
    const m = build([ws('ws-have', { objective: 'E4-3', topic: have })]);
    assert.ok(EV.similarity(have, miss) >= 0.5 || /Hypo/.test(have), have);
    assert.equal(EV.joinTarget(m, { id: 'ws-miss', objective: 'E4-3', topic: miss }), null, miss);
    assert.equal(EV.opposed(have, miss), true, miss);
  }
});

test('B-407 review: the weekly counts a proposal among new weak spots in the week he accepts it', () => {
  const inWeek = '2026-10-15T15:00:00.000Z';
  const doc = (id, extra) => ({ ...ws(id, { objective: 'E4-3', topic: id }), addedAt: inWeek, at: inWeek, ...extra });
  const accept = d => ({ [key(at(d))]: { type: 'accept', by: 'owner', objective: 'E4-3', at: at(d) } });
  const db = {
    weakspots: [
      doc('ws-his'),
      doc('ws-waits', { proposed: true }),
      doc('ws-took', { proposed: true, events: accept('2026-10-16') }),
      // proposed on Saturday the 17th, accepted on Monday the 19th: new in the week of Monday, not of Saturday
      doc('ws-late', {
        proposed: true,
        addedAt: '2026-10-17T15:00:00.000Z',
        at: '2026-10-17T15:00:00.000Z',
        events: accept('2026-10-19'),
      }),
    ],
    exams: [E4],
  };
  const week = d => produce(db, spec, 'weeks', { date: d, now: d + 'T22:57:00Z' }, { source: 'test' });
  assert.deepEqual(week('2026-10-18').rollups.newWeakSpots, ['ws-his', 'ws-took']);
  assert.deepEqual(week('2026-10-25').rollups.newWeakSpots, ['ws-late']);
});
