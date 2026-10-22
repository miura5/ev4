// B-199: the smoke tier's wiring. The tier itself needs Chromium (test/harness/smoke.cjs, run by the smoke workflow on
// every push); this keeps the pieces that make it a tier from drifting apart: the npm script, the workflow running it
// with both plants expected red, the plants the harness knows, and CLAUDE.md's step 5 naming it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('B-199: npm run smoke builds, then runs the smoke harness on the synthetic record', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.smoke, 'node tools/build.mjs && node test/harness/smoke.cjs synthetic');
});

test('B-199: the smoke workflow runs on every push, runs the tier, and expects each plant to turn it red', () => {
  const wf = read('.github/workflows/smoke.yml');
  assert.match(wf, /^on:\n {2}push:\n/m, 'on every push');
  assert.match(wf, /run: npm run smoke -- shots/);
  for (const [plant, line] of [
    ['page-error', 'no page errors'],
    ['broken-tab', 'each tab opens its panel'],
  ]) {
    assert.ok(wf.includes(`--plant ${plant}`), `the workflow plants ${plant}`);
    assert.ok(wf.includes(`FAIL \\[390\\] ${line}`), `the ${plant} plant must fail "${line}"`);
  }
});

test('B-199: the harness names its six checks and both plants', () => {
  const h = read('test/harness/smoke.cjs');
  for (const name of [
    'the page boots and connects to the record',
    'the greeting renders',
    'each tab opens its panel',
    'a Today check-off ticks and keeps the scroll and the rows in place',
    'a review answer scores',
    'a Your-turn reply files its job and fires the builder',
    'no page errors',
  ])
    assert.ok(h.includes(name), name);
  assert.ok(h.includes("['page-error', 'broken-tab']"));
  assert.ok(h.includes("['390', { width: 390") && h.includes("['1280', { width: 1280"));
});

test('B-199, B-219: CLAUDE.md step 5 says smoke while working, the touched check before ship, the full one before live', () => {
  const md = read('CLAUDE.md');
  assert.match(md, /run `npm run smoke` while working/);
  assert.match(md, /`npm run check -- --touched` once before ship staging/);
  assert.match(md, /The full `npm run check` runs nightly and before live/);
});
