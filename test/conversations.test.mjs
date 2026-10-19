// core.conversations (B-77, D-128 gap rule only): talk splits into conversations at a gap of
// spec.constants.conversation.idleGapMin minutes or more; midnight is not a boundary; a pull to load brings back one
// earlier conversation, with its length, until the next one back lies wholly before today. All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';

const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url)));
EV.configure(spec);
// Central daylight time in October: UTC-5.
const at = (day, hh, mm) => new Date(Date.UTC(2026, 9, day, hh + 5, mm)).toISOString();
const msg = (id, iso, role = 'ev') => ({ id, at: iso, role, text: id });

test('the idle gap is the spec\'s: 120 minutes', () => {
  assert.equal(spec.constants.conversation.idleGapMin, 120);
  assert.equal(EV.constants().conversation.idleGapMin, 120);
});

test('a 119-minute gap stays one conversation; a 121-minute gap splits', () => {
  const t = [msg('a', at(18, 9, 0), 'matt'), msg('b', at(18, 9, 1)), msg('c', at(18, 11, 0), 'matt'), msg('d', at(18, 11, 1)), msg('e', at(18, 13, 2), 'matt'), msg('f', at(18, 13, 3))];
  const cs = EV.conversations(t);
  assert.deepEqual(cs.map(c => c.messages.map(m => m.id)), [['a', 'b', 'c', 'd'], ['e', 'f']], '9:01 to 11:00 is 119 min; 11:01 to 13:02 is 121 min');
  assert.equal(cs[0].start, at(18, 9, 0)); assert.equal(cs[0].end, at(18, 11, 1));
  // Exactly 120 minutes is a gap of 120 minutes or more: it splits.
  assert.equal(EV.conversations([msg('x', at(18, 9, 0)), msg('y', at(18, 11, 0))]).length, 2);
});

test('midnight is not a boundary', () => {
  const t = [msg('late1', at(17, 23, 30), 'matt'), msg('late2', at(17, 23, 31)), msg('pastmid', at(18, 0, 40), 'matt'), msg('pastmid2', at(18, 0, 41))];
  const cs = EV.conversations(t);
  assert.equal(cs.length, 1); assert.deepEqual(cs[0].messages.map(m => m.id), ['late1', 'late2', 'pastmid', 'pastmid2']);
  // And a gap across midnight still splits at the gap.
  assert.equal(EV.conversations([msg('p', at(17, 22, 0)), msg('q', at(18, 0, 30))]).length, 2);
});

test('the gap can be given; two messages at the same moment keep their id order', () => {
  const t = [msg('a', at(18, 9, 0)), msg('b', at(18, 9, 30))];
  assert.equal(EV.conversations(t, { idleGapMin: 20 }).length, 2); assert.equal(EV.conversations(t, { idleGapMin: 31 }).length, 1);
  const same = EV.conversations([msg('m-2', at(18, 9, 0)), msg('m-1', at(18, 9, 0))]);
  assert.deepEqual(same[0].messages.map(m => m.id), ['m-1', 'm-2']);
});

test('order in, time order out; messages without a time are left out', () => {
  const cs = EV.conversations([msg('b', at(18, 9, 5)), msg('a', at(18, 9, 0)), { id: 'z', role: 'ev' }]);
  assert.deepEqual(cs[0].messages.map(m => m.id), ['a', 'b']);
  assert.deepEqual(EV.conversations([]), []);
});

test('a pull loads the previous conversation with its count, and stops at the start of today', () => {
  const today = '2026-10-18';
  const t = [
    msg('y1', at(17, 20, 0), 'matt'), msg('y2', at(17, 20, 1)),                                   // yesterday evening
    msg('m1', at(18, 6, 0), 'matt'), msg('m2', at(18, 6, 1)), msg('m3', at(18, 6, 5), 'matt'), msg('m4', at(18, 6, 6)), // this morning
    msg('n1', at(18, 12, 0), 'matt'), msg('n2', at(18, 12, 1)),                                   // noon
    msg('g', at(18, 19, 0)),                                                                        // the greeting, now
  ];
  const cs = EV.conversations(t);
  assert.equal(cs.length, 4);
  const first = EV.earlierConversation(cs, 1, today); assert.equal(first.count, 2); assert.deepEqual(first.conversation.messages.map(m => m.id), ['n1', 'n2']);
  const second = EV.earlierConversation(cs, 2, today); assert.equal(second.count, 4);
  assert.deepEqual(EV.earlierConversation(cs, 3, today), { edge: 'today' }, 'yesterday evening lies wholly before today: that is the start of today');
  assert.deepEqual(EV.earlierConversation(cs, 4, today), { edge: 'today' });
  // A conversation that began last night and ran past midnight ends today: it can be loaded.
  const t2 = [msg('a', at(17, 23, 50), 'matt'), msg('b', at(18, 0, 10)), msg('g', at(18, 9, 0))];
  const c2 = EV.conversations(t2); assert.equal(EV.earlierConversation(c2, 1, today).count, 2);
});

test('past the start of today a further pull goes on into earlier days, one conversation at a time, to the 7-day edge (D-128 as amended)', () => {
  const today = '2026-10-18', windowStart = '2026-10-11';
  const t = [
    msg('o1', at(10, 20, 0), 'matt'), msg('o2', at(10, 20, 1)),                                   // Oct 10: outside the window
    msg('f1', at(16, 9, 0), 'matt'), msg('f2', at(16, 9, 1)), msg('f3', at(16, 9, 2)),            // Fri, Oct 16
    msg('y1', at(17, 20, 0), 'matt'), msg('y2', at(17, 20, 1)),                                   // yesterday evening
    msg('n1', at(18, 12, 0), 'matt'), msg('n2', at(18, 12, 1)),                                   // noon
    msg('g', at(18, 19, 0)),                                                                        // the greeting, now
  ];
  const cs = EV.conversations(t); const o = { pastToday: true, windowStart };
  assert.equal(EV.earlierConversation(cs, 1, today).count, 2);
  assert.deepEqual(EV.earlierConversation(cs, 2, today), { edge: 'today' }, 'first the start of today');
  const y = EV.earlierConversation(cs, 2, today, o); assert.equal(y.count, 2); assert.deepEqual(y.conversation.messages.map(m => m.id), ['y1', 'y2']);
  const f = EV.earlierConversation(cs, 3, today, o); assert.equal(f.count, 3);
  assert.deepEqual(EV.earlierConversation(cs, 4, today, o), { edge: 'window' }, 'Oct 10 ended before the window: everything from the last 7 days');
  assert.deepEqual(EV.earlierConversation(cs, 5, today, o), { edge: 'window' });
  // With nothing older at all, the window edge comes once today is past.
  const c2 = EV.conversations([msg('g', at(18, 9, 0))]);
  assert.deepEqual(EV.earlierConversation(c2, 1, today), { edge: 'today' }); assert.deepEqual(EV.earlierConversation(c2, 1, today, o), { edge: 'window' });
});