// B-152 (D-176): the timing checks are advisory. A quarantined check prints its numbers, runs once more in place on a
// miss and fails only on a second miss in a row; a check returns to blocking after 20 green scheduled nightlies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './helpers.mjs';
import { quarantineDue, formatInbox } from '../tools/chart.mjs';

const require = createRequire(import.meta.url);
const { advisory, allPass, LIST } = require('./harness/quarantine.cjs');
const quiet = { log: () => {} };

test('B-152: a planted miss fails only on the second; a pass on the re-run is recorded as one; numbers always printed', async () => {
  const list = { checks: { 'x-timing': { since: '2026-10-21' } } };
  const seq = vals => {
    let i = 0;
    return async () => vals[i++];
  };
  const judge = v => ({ ok: v <= 10, numbers: `${v} ms` });
  let results = [];
  const lines = [];
  await advisory(results, 'x-timing', 'x', seq([12, 8]), judge, { list, env: {}, log: l => lines.push(l) });
  assert.deepEqual(results, [['PASS', 'x (advisory: missed once, passed on the re-run)', '12 ms | 8 ms']]);
  assert.match(lines[0], /^ADVISORY {2}miss {2}x: 12 ms; once more, in place$/);
  results = [];
  await advisory(results, 'x-timing', 'x', seq([12, 13]), judge, { list, env: {}, ...quiet });
  assert.deepEqual(results, [['FAIL', 'x (advisory: missed twice in a row)', '12 ms | 13 ms']]);
  results = [];
  let resets = 0;
  await advisory(results, 'x-timing', 'x', seq([5, 6]), judge, {
    list,
    env: { EV_PLANT_MISS: 'x-timing' },
    reset: async () => resets++,
    ...quiet,
  });
  assert.equal(results[0][0], 'PASS', 'a planted miss on a good check passes on the re-run');
  assert.equal(resets, 1, 'the reset runs before the re-run');
  results = [];
  await advisory(results, 'not-listed', 'y', seq([12, 8]), judge, { list, env: {}, ...quiet });
  assert.deepEqual(results, [['FAIL', 'y', '12 ms']], 'a check out of quarantine is blocking: one run, its verdict');
  assert.deepEqual(
    allPass([
      ['PASS', 'a', '1'],
      ['FAIL', 'b', '2'],
    ]),
    { ok: false, numbers: 'b: 2' }
  );
});

test('B-152: the named timing checks are quarantined, and each harness routes them through advisory() (B-206: the Silk step-down went with its renderer)', () => {
  assert.deepEqual(Object.keys(LIST.checks).sort(), ['captions-history-pull', 'captions-pace', 'core-frame-budget']);
  assert.equal(LIST.returnAfterGreenNightlies, 20);
  const captions = fs.readFileSync(path.join(ROOT, 'test/harness/captions.cjs'), 'utf8');
  const core = fs.readFileSync(path.join(ROOT, 'test/harness/core.cjs'), 'utf8');
  for (const id of ['captions-history-pull', 'captions-pace']) assert.ok(captions.includes(`'${id}'`), id);
  for (const id of ['core-frame-budget']) assert.ok(core.includes(`'${id}'`), id);
});

test('B-152: a quarantined check returns to blocking after 20 green scheduled nightlies in a row since its date', () => {
  const q = { returnAfterGreenNightlies: 20, checks: { a: { since: '2026-10-21' }, b: { since: '2026-11-05' } } };
  const day = n => new Date(Date.UTC(2026, 9, 21 + n, 8, 41)).toISOString();
  const runs = Array.from({ length: 25 }, (_, n) => ({ event: 'schedule', createdAt: day(n), conclusion: 'success' }));
  runs[3].conclusion = 'failure';
  runs.push({ event: 'workflow_dispatch', createdAt: day(30), conclusion: 'failure' });
  assert.deepEqual(quarantineDue(q, runs), [
    { id: 'a', greens: 21, due: true },
    { id: 'b', greens: 10, due: false },
  ]);
  runs[24].conclusion = 'failure';
  assert.deepEqual(
    quarantineDue(q, runs).map(r => r.greens),
    [0, 0],
    'a red nightly starts the count again'
  );
  assert.match(formatInbox({ query: null, comments: [], triage: [] }), /node tools\/chart\.mjs quarantine --runs/);
});
