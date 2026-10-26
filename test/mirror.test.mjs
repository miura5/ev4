// E.V. core's Markdown mirror and backup (B-160, split from core.test.mjs with its section). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { ws, E4 } from './core-fixtures.mjs';

test('backup round-trips into a restore plan', () => {
  const b = EV.buildBackup({ weakspots: [ws('a')], exams: [E4] }, { now: '2026-10-18T01:00:00Z' });
  assert.equal(b.counts.weakspots, 1);
  assert.equal(b.release, null, 'B-149: no release unless the run gives its own');
  assert.equal(EV.buildBackup({}, { now: '2026-10-18T01:00:00Z', release: 'v4.2.0' }).release, 'v4.2.0');
  const plan = EV.restorePlan(b);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].op, 'set');
  assert.ok(!('id' in plan[0].data));
});

test('B-406: the mirror keeps a discarded session marked so, and leaves it out of the Sessions count', () => {
  const s = (id, status) => ({ id, date: '2026-10-21', minutes: 10, source: 'E.V. Home', status, topic: 'T' });
  const files = EV.toMarkdown({ sessions: [s('ss-a', 'ended'), s('ss-b', 'discarded')] }, { date: '2026-10-21' });
  assert.match(files.find(f => f.path === 'index.md').content, /- Sessions: 1\n/);
  assert.match(files.find(f => f.path === 'sessions/ss-b.md').content, /status: "discarded"/);
  assert.doesNotMatch(files.find(f => f.path === 'sessions/ss-a.md').content, /status:/);
});
