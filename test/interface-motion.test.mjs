// B-216, B-276 (D-271): one clock. She (page/app/60-ev-conversation.js) and the rest of the interface move at the
// display's rate: no stepped timing anywhere; a view switch is a cut, a fold opens in 0.28 s and closes in 0.16 s,
// nothing in the interface runs over 0.45 s (an indicator that loops, a spinner or a pulse, is not a move); and reduced
// motion (B-224) keeps the end states with no movement.
import { sourceStyles } from '../tools/build.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = sourceStyles(ROOT).replace(/\/\*[\s\S]*?\*\//g, '');
const HER = '60-ev-conversation.js';
const appFiles = fs
  .readdirSync(path.join(ROOT, 'page/app'))
  .filter(f => f.endsWith('.js'))
  .map(f => [f, fs.readFileSync(path.join(ROOT, 'page/app', f), 'utf8')]);

/** Every transition and animation declaration in the stylesheet, with its seconds. */
export function timings(text) {
  const out = [];
  for (const m of text.matchAll(/(?:^|[;{\s])((?:transition|animation)(?:-duration)?)\s*:\s*([^;}]+)/g)) {
    const value = m[2];
    const secs = [...value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)].map(x => Number(x[1]) / (x[2] === 'ms' ? 1000 : 1));
    out.push({ prop: m[1], value: value.trim(), secs, loops: /\binfinite\b/.test(value) });
  }
  return out;
}

test('B-276 (D-271): no stepped timing anywhere, her module included', () => {
  assert.equal(/steps\s*\(/.test(css), false, 'styles.css uses steps()');
  const stepped = appFiles.filter(([, t]) => /steps\(\s*\d/.test(t)).map(([f]) => f);
  assert.deepEqual(stepped, []);
});

test('B-216 (D-271): no interface move runs over 0.45 s (a looping indicator aside)', () => {
  const long = timings(css).filter(t => !t.loops && t.secs.some(s => s > 0.45));
  assert.deepEqual(
    long.map(t => `${t.prop}: ${t.value}`),
    []
  );
});

test('B-225 (D-271): a view switch is a cut; folds open in 0.28 s and close in 0.16 s', () => {
  assert.doesNotMatch(css, /\.panel\.enter\{animation/, 'no fade on a view switch');
  // B-515 lane 2: her stage's time is the token --dur-pane, 280 ms
  const hero = css.match(/body\.captions \.hero,[^{]*\{[^}]*transition:height var\(--dur-pane\)/);
  assert.ok(hero, "her stage's fold opens in --dur-pane");
  assert.match(css, /--dur-pane:280ms/, 'the token is 0.28 s');
  assert.match(
    css,
    /body\.captions\.her-folded \.hero\{transition-duration:var\(--dur-pop-in\)\}/,
    'and closes in --dur-pop-in'
  );
  assert.match(css, /--dur-pop-in:160ms/, 'the token is 0.16 s');
  assert.match(css, /\.chev,\.prep-row \.chev\{transition-duration:\.16s\}/, 'a chevron closes in 0.16 s');
  // B-515 lane 1: the open chevron's time is the token --dur-chev-open, 280 ms
  assert.match(
    css,
    /\[aria-expanded="true"\] \.chev[^{]*\{transition-duration:var\(--dur-chev-open\)\}/,
    'and opens in 0.28 s'
  );
  assert.match(css, /--dur-chev-open:280ms/, 'the token is 0.28 s');
});

test('B-216 (B-224): reduced motion stops every interface move and keeps the end states', () => {
  assert.match(
    css,
    /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{transition:none!important;animation:none!important\}\}/
  );
  assert.ok(
    appFiles.some(([f, t]) => f === HER && /reduce/.test(t)),
    'her module reads reduced motion'
  );
});
