// E.V. core's Markdown mirror and backup (B-160, split from core.test.mjs with its section). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import { ws, E4 } from './core-fixtures.mjs';
import { makeMirror } from '../core/mirror.mjs';

test('B-160: core/mirror.mjs is one factory with no imports, moved out of E.V. core, and E.V. core still exports its names', () => {
  const src = fs.readFileSync(new URL('../core/mirror.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'no imports: it runs in the page as written');
  assert.deepEqual(src.match(/^export .*/gm), ['export function makeMirror(core) {']);
  const core = fs.readFileSync(new URL('../core/evcore.mjs', import.meta.url), 'utf8');
  for (const n of ['toMarkdown', 'buildBackup', 'restorePlan']) {
    assert.doesNotMatch(core, new RegExp('function ' + n + '\\('), n + ' moved, not copied');
    assert.equal(typeof EV[n], 'function', n);
  }
  assert.equal(typeof makeMirror, 'function');
});

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
