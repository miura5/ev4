// B-219 (D-226, Matt Oct 22): npm run check -- --touched runs only the harnesses a change touched; the full check runs
// nightly. B-466 (D-366): a red nightly is a filed bug and never gates a live release; R-06 is ended.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chartCopy, flatSource } from './helpers.mjs';
import { HARNESSES, harnessesFor, steps } from '../tools/check.mjs';
import * as chart from '../tools/chart.mjs';

test('B-219: each harness is chosen by a path it covers (planted), and only it', () => {
  const planted = {
    shell: 'test/harness/shell.cjs',
    components: 'test/harness/components.cjs',
    run: 'page/app/40-record.js',
    captions: 'test/harness/captions.cjs',
    prep: 'test/harness/prep.cjs',
    core: 'test/harness/core.cjs',
    greet: 'test/harness/greet.cjs',
    frame: 'page/app/90-render.js',
    notes: 'test/harness/notes.cjs',
    look: 'test/harness/views.cjs',
  };
  for (const h of HARNESSES) assert.ok(harnessesFor([planted[h]]).includes(h), `${planted[h]} runs ${h}`);
  assert.deepEqual(harnessesFor(['test/harness/greet.cjs']), ['greet']);
  assert.deepEqual(
    harnessesFor(['test/harness/components.cjs']),
    ['components', 'look'],
    'B-285: look uses its checks'
  );
  assert.deepEqual(harnessesFor(['page/app/30-progress.js']), ['run', 'look']);
  assert.deepEqual(harnessesFor(['page/app/73-ev-greeting.js']), ['run', 'captions', 'prep', 'greet', 'look']);
  assert.deepEqual(
    harnessesFor(['page/ds/tokens.css']),
    harnessesFor(['page/ds/views/legacy-carry.css']),
    'B-501: tokens as the sheet'
  );
  // D-388: the split files map as their kinds: a component's CSS, a pattern's or a view's as the sheet; a component's
  // JS or its Gallery cells to components, run and look
  for (const p of ['page/ds/components/01-button.css', 'page/ds/patterns/week.css', 'page/ds/views/today.css'])
    assert.deepEqual(harnessesFor([p]), harnessesFor(['page/ds/views/legacy-carry.css']), p);
  assert.deepEqual(harnessesFor(['page/app/01-ui-05-line.js']), ['components', 'run', 'look']);
  assert.deepEqual(harnessesFor(['page/app/89-gallery-10-sheet.js']), ['components', 'run', 'look']);
  assert.deepEqual(harnessesFor(['page/app/01-ui.js']), HARNESSES, 'DS and dsRoot: every harness, as the kit');
  assert.deepEqual(harnessesFor(['page/app/89-gallery.js']), ['components']);
  assert.deepEqual(harnessesFor(['page/ds/views/legacy-carry.css']), [
    'components',
    'run',
    'captions',
    'prep',
    'frame',
    'notes',
    'look',
  ]);
});

test('B-219: the record of the work, docs, CI and tools touch no harness; an unknown path runs them all', () => {
  assert.deepEqual(
    harnessesFor([
      'chart/tasks.json',
      'BACKLOG.md',
      'CLAUDE.md',
      'tools/chart.mjs',
      '.github/workflows/nightly.yml',
      'test/chart.test.mjs',
    ]),
    []
  );
  for (const p of [
    'page/app/99-new-part.js',
    'core/evcore.mjs',
    'spec/ev.spec.json',
    'tools/build.mjs',
    'test/harness/stub.js',
    'page/index.src.html',
  ])
    assert.deepEqual(harnessesFor([p]), HARNESSES, p);
});

test('B-219: --touched keeps npm test and the build and drops the harnesses not chosen', () => {
  const names = steps({ record: 'synthetic', shots: '/tmp/x', only: ['run', 'look'] }).map(s => s[0]);
  assert.deepEqual(names, ['npm test', 'build', 'run', 'look']);
  assert.equal(steps({ record: 'synthetic', shots: '/tmp/x' }).length, 12, 'the full check runs every step');
  const src = flatSource('tools/check.mjs');
  assert.match(src, /LOOK_SIZES = FIRST\.join/, 'the touched look pass shoots the four first sizes');
  assert.match(src, /check-full\.json/, 'a full GREEN is still recorded, as the record of the last full check here');
});

test('B-466 (D-366): the full check gates nothing: R-06 is ended in the Chart, and ship live has no fullCheck step', () => {
  const rules = chart.loadChart(chartCopy()).rules; // a copy of the record (B-153), never the real one
  const r06 = rules.find(r => r.id === 'R-06');
  assert.ok(r06, 'R-06 is kept in chart/rules.json (nothing deleted)');
  assert.equal(r06.check, 'fullCheck');
  assert.match(r06.ended || '', /^D-366/, 'ended, citing D-366');
  assert.equal(
    rules.some(r => r.check === 'fullCheck' && !r.ended),
    false,
    'no live-enforced fullCheck rule'
  );
  // ship live's rules step: R-04 stays, R-06 is gone, and nothing reads a nightly or dist/check-full.json for it.
  const ship = flatSource('tools/chart.mjs');
  assert.match(ship, /R-04 \(D-083\): a live deploy needs Matt's explicit OK/, 'R-04 is still enforced');
  assert.doesNotMatch(ship, /fullCheckRefusal|r\.check === 'fullCheck'|nightlyGreen|NIGHTLY_RUNS|check-full\.json/);
  assert.equal(chart.fullCheckRefusal, undefined, 'the R-06 refusal is retired, not kept dead');
  assert.match(flatSource('CLAUDE.md'), /--touched/, 'CLAUDE.md step 5 says when to run which');
  assert.match(flatSource('CLAUDE.md'), /R-06 is ended by D-366/, 'CLAUDE.md step 5 says R-06 is ended');
});
