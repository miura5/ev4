// B-285 (D-278, D-285, C-1, C-15): the component set's checks (test/harness/components.cjs), held to planted buttons
// and colours without a browser, and the stylesheet holding the parts and measures the harness renders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { judgeKinds, judgeYellow, lchOf } = require('./harness/components.cjs');
const theme = require('./harness/contrast.cjs').load(); // page/theme.js as the shell runs it
const b = (label, cls, extra = {}) => ({ label, cls: cls.split(' '), submit: false, inSeg: false, ...extra });

test('B-285: D-278 passes the five kinds with one primary and the send, and names what falls outside', () => {
  const good = [
    b('Start session', 'btn primary'),
    b('Course', 'btn neutral'),
    b('Open', 'btn ghost sm'),
    b('Done', 'btn icon'),
    b('Done, outlined', 'btn neutral icon'),
    b('Accept', 'btn tint x-green'),
    b('Send', 'btn primary icon send', { submit: true }),
    b('Week', '', { inSeg: true }),
  ];
  assert.equal(judgeKinds(good).ok, true, judgeKinds(good).detail);
  const two = judgeKinds([...good, b('Accept all', 'btn primary sm')]);
  assert.equal(two.ok, false);
  assert.deepEqual(two.primaries, ['Start session', 'Accept all']);
  for (const [label, cls] of [
    ['Old primary', 'primary'],
    ['No kind', 'btn sm'],
    ['Two fills', 'btn neutral ghost'],
    ['Tint with no colour', 'btn tint'],
    ['A fold line', 'fold-line'],
  ])
    assert.deepEqual(judgeKinds([b(label, cls)]).outside, [label], cls);
});

test('B-285: D-285 reads coded yellow back from its colour: the generator gives D-269 in both themes; off by a step fails', () => {
  for (const mode of ['light', 'dark']) {
    const y = theme.genTheme(mode, 60).sem.yellow;
    assert.equal(judgeYellow(y, mode).ok, true, judgeYellow(y, mode).detail);
  }
  assert.equal(judgeYellow(theme.lch2hex(58, 54, 82), 'light').ok, false, 'the demo-like lighter yellow fails');
  assert.equal(judgeYellow(theme.lch2hex(52, 54, 90), 'light').ok, false, 'another hue fails');
  const w = lchOf([255, 255, 255]);
  assert.ok(Math.abs(w.L - 100) < 0.1 && w.C < 0.5, 'white is L100 C0');
});

test('B-285: the stylesheet holds every part, rows at 32 and 44 px, and switches styled by their picked state', () => {
  const css = fs.readFileSync(path.join(ROOT, 'page', 'styles.css'), 'utf8');
  const set = css.slice(css.indexOf('B-285 (D-274, D-278, D-269, C-1, C-15): the component set'));
  for (const part of [
    'button.btn.primary',
    'button.btn.neutral',
    'button.btn.tint',
    'button.btn:is(.ghost,.icon)',
    'button.btn.sm',
    '.badge',
    '.badge.proposed',
    '.seg button:is([aria-pressed="true"],[aria-checked="true"])',
    '.ui-card',
    '.li{',
    '.toolbar',
    '.pbar',
    '.field',
  ])
    assert.ok(set.includes(part), part);
  assert.match(set, /\.li\{[^}]*height:32px/);
  assert.match(set, /@media \(max-width:599px\)\{[\s\S]*\.li\{height:44px/);
  assert.doesNotMatch(set, /[×✕]/, 'no close button among the parts');
  const hexes = set.match(/#[0-9a-f]{3,8}\b/gi) || [];
  assert.deepEqual(hexes, [], 'every colour in the set is a token of the generator');
});
