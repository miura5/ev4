// B-219 (D-226, Matt Oct 22): npm run check -- --touched runs only the harnesses a change touched; the full check stays
// the nightly and the gate before live (R-06).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { flatSource } from './helpers.mjs';
import { HARNESSES, harnessesFor, steps } from '../tools/check.mjs';
import { fullCheckRefusal } from '../tools/chart.mjs';

test('B-219: each harness is chosen by a path it covers (planted), and only it', () => {
  const planted = {
    shell: 'test/harness/shell.cjs',
    run: 'page/app/40-record.js',
    captions: 'test/harness/captions.cjs',
    prep: 'test/harness/prep.cjs',
    core: 'test/harness/core.cjs',
    greet: 'test/harness/greet.cjs',
    look: 'test/harness/views.cjs',
  };
  for (const h of HARNESSES) assert.ok(harnessesFor([planted[h]]).includes(h), `${planted[h]} runs ${h}`);
  assert.deepEqual(harnessesFor(['test/harness/greet.cjs']), ['greet']);
  assert.deepEqual(harnessesFor(['page/app/30-progress.js']), ['run', 'look']);
  assert.deepEqual(harnessesFor(['page/app/73-ev-greeting.js']), ['run', 'captions', 'prep', 'greet', 'look']);
  assert.deepEqual(harnessesFor(['page/styles.css']), ['run', 'captions', 'prep', 'look']);
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
  assert.equal(steps({ record: 'synthetic', shots: '/tmp/x' }).length, 9, 'the full check runs every step');
  const src = flatSource('tools/check.mjs');
  assert.match(src, /LOOK_SIZES = FIRST\.join/, 'the touched look pass shoots the four first sizes');
  assert.match(src, /check-full\.json/, 'a full GREEN is recorded for ship live');
});

test('B-219: ship live refuses a commit no full check passed (R-06), and takes a full GREEN here or a green nightly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-r06-'));
  fs.mkdirSync(path.join(root, 'dist'));
  const sha = 'a'.repeat(40);
  assert.match(fullCheckRefusal(root, sha, []), /^R-06 \(D-226\)/);
  assert.equal(fullCheckRefusal(root, sha, [{ headSha: sha, conclusion: 'success' }]), null, 'a green nightly at it');
  assert.match(fullCheckRefusal(root, sha, [{ headSha: sha, conclusion: 'failure' }]), /R-06/, 'a red nightly is none');
  fs.writeFileSync(path.join(root, 'dist', 'check-full.json'), JSON.stringify({ commit: 'b'.repeat(40) }));
  assert.match(fullCheckRefusal(root, sha, []), /last full check here was at bbbbbbb/);
  fs.writeFileSync(path.join(root, 'dist', 'check-full.json'), JSON.stringify({ commit: sha }));
  assert.equal(fullCheckRefusal(root, sha, []), null, 'a full GREEN here at the commit');
  assert.match(flatSource('tools/chart.mjs'), /r\.check === 'fullCheck' && !r\.ended/, 'ship live enforces R-06');
  assert.match(flatSource('CLAUDE.md'), /--touched/, 'CLAUDE.md step 5 says when to run which');
});
