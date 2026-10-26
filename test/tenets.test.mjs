// B-115: the UI tenets' checks (test/harness/tenets.cjs), held to planted reads without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, flatSource } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));

test('B-357 (D-327): the retired look tenets are no longer checked; the motion check stays', () => {
  const t = spec.ui.tenets;
  assert.equal(t.checks, undefined);
  assert.deepEqual(Object.keys(createRequire(import.meta.url)('./harness/tenets.cjs')).sort(), [
    'judgeMotion',
    'motion',
  ]);
  assert.deepEqual(t.widths, [390, 735, 1280]);
});

test('B-125 (D-271): the motion check fails a planted long move, a view still moving at 450 ms and a fading panel', () => {
  const { judgeMotion } = createRequire(import.meta.url)('./harness/tenets.cjs');
  const still = { tab: 'today', over: [], declared: 12, running: [], opacity: 1 };
  assert.equal(judgeMotion(still, still).ok, true);
  assert.equal(
    judgeMotion({ ...still, over: ['div.card animation rise 550 ms'] }, still).ok,
    false,
    'the old staggered rise'
  );
  assert.equal(
    judgeMotion(still, { ...still, running: ['i animation grow-x'] }).ok,
    false,
    'a bar still growing at 450 ms'
  );
  assert.equal(judgeMotion(still, { ...still, opacity: 0.6 }).ok, false, 'the view still fading in');
  // B-225 (D-271): a planted 0.2 s view fade shows at the tap as a view not yet opaque
  assert.equal(judgeMotion({ ...still, opacity: 0.1 }, still).ok, false, 'a 0.2 s view fade on the switch');
  const m = spec.ui.tenets.motion;
  assert.equal(m.maxMs, 450);
  assert.deepEqual(
    m.exempt,
    ['#hero', '.ev-av', '#top-av', '.reveal', '.cap-echo'],
    'her stage, her core and the header avatar, the reveal, the echo of his line'
  );
  const look = flatSource('test/harness/look.cjs');
  assert.match(look, /page\.evaluate\(motion, M\)/);
  assert.match(look, /reducedMotion: 'reduce'/);
});

test('B-125 (D-271): the stylesheet has no staggered rise and no growth of bars on a tab switch', () => {
  const css = fs.readFileSync(path.join(ROOT, 'page', 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /grow-[xy]/);
  assert.doesNotMatch(css, /\.panel\.enter>:nth-child/);
  assert.doesNotMatch(css, /\.panel\.enter\{animation/, 'B-225 (D-271): a view switch is a cut, no fade');
});

test('B-125 (D-271, Matt Oct 20): the status lights are steady, the header one and the session bar one', () => {
  const css = fs.readFileSync(path.join(ROOT, 'page', 'styles.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.(?:led|s-led)[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 4, 'the light rules are in the stylesheet');
  for (const [, sel, body] of rules) assert.doesNotMatch(body, /animation|transition/, sel.trim());
});
