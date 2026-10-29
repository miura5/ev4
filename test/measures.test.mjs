// B-522: one source per measure (core/measures.mjs). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import E from '../core/evcore.mjs';

const spot = (id, status, extra = {}) => ({ id, kind: 'concept', derived: { status, ...extra.d }, ...extra.w });

test('B-522: open weak spots leave out previews, and a course filter keeps spots with no course', () => {
  const ms = [
    spot('a', 'open', { w: { c: 'X' } }),
    spot('b', 'open', { d: { preRead: true } }),
    spot('c', 'parked'),
    spot('d', 'open', { w: { c: 'Y' } }),
    spot('e', 'open'),
  ];
  assert.deepEqual(
    E.openSpots(ms).map(w => w.id),
    ['a', 'd', 'e']
  );
  assert.deepEqual(
    E.openSpots(ms, { course: 'X', courseOf: w => w.c || null }).map(w => w.id),
    ['a', 'e']
  );
});

test('B-522: an objective with answers and no spots is solid; an open unright spot is not yet', () => {
  const o = { id: 'E1-1' };
  assert.equal(E.objectiveState(o, [], { n: 3 }).state, 'solid');
  assert.equal(E.objectiveState(o, [], undefined).state, 'notyet');
  const ws = [spot('a', 'open', { w: { objective: 'E1-1' } })];
  assert.equal(E.objectiveState(o, ws, { n: 3 }).state, 'notyet');
  ws[0].derived.streak = 1;
  assert.equal(E.objectiveState(o, ws, { n: 3 }).state, 'almost');
});

test('B-522: study time counts a running session at its clock and ticked minutes per course, never twice', () => {
  const now = '2026-10-29T17:12:00Z';
  const sessions = [
    { id: 's1', status: 'ended', date: '2026-10-29', minutes: 20, c: 'A' },
    { id: 's2', status: 'active', date: '2026-10-29', startedAt: '2026-10-29T17:00:00Z', c: 'B' },
    { id: 's3', status: 'discarded', date: '2026-10-29', minutes: 50, c: 'A' },
  ];
  const ticked = [
    { date: '2026-10-29', course: 'A', minutes: 15 },
    { date: '2026-10-29', course: 'C', minutes: 30 },
  ];
  const st = E.studyTime(sessions, { now, courseOf: s => s.c, ticked });
  const running = st.sessions.find(x => x.s.id === 's2');
  assert.ok(running && running.minutes >= 11, 'the running session counts its clock: ' + (running && running.minutes));
  assert.ok(!st.sessions.some(x => x.s.id === 's3'), 'a discarded session never counts');
  const by = E.minutesByCourse(st, '2026-10-29', '2026-10-29');
  assert.equal(by.A, 20); // the larger of 20 session and 15 ticked
  assert.equal(by.C, 30);
  assert.equal(E.minutesIn(st, '2026-10-29', '2026-10-29'), 50 + by.B);
  assert.equal(E.minutesIn(st, '2026-10-30', '2026-10-31'), 0);
});

test('B-522: Study, Today and Progress read the measures from core, not their own copies', () => {
  const read = f => fs.readFileSync(new URL('../page/app/' + f, import.meta.url), 'utf8');
  const study = read('20-study.js'),
    prog = read('30-progress.js');
  assert.match(study, /E\.objectiveState\(o, M\.models, acc\)/);
  assert.match(study, /E\.openSpots\(M\.models, \{ course, courseOf: wsCourse \}\)/);
  assert.match(prog, /E\.openSpots\(M\.models\)/);
  assert.match(prog, /E\.studyTime\(S\.sessions/);
  assert.doesNotMatch(prog, /s\.status !== 'active' && s\.date/);
});
