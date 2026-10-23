// B-216 (D-222): two clocks. She moves on held frames inside her own module (page/app/60-ev-conversation.js); every
// other part of the interface moves at full frame rate with short eases: a view settles within 0.16 s, a fold takes
// 0.28 s, nothing runs over 0.45 s (an indicator that loops, a spinner or a pulse, is not a move), no stepped timing,
// and reduced motion keeps the end states with no movement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'page/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
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

test('B-216 (D-222): no stepped timing outside her module', () => {
  assert.equal(/steps\s*\(/.test(css), false, 'styles.css uses steps()');
  const stepped = appFiles.filter(([f, t]) => f !== HER && /steps\(\s*\d/.test(t)).map(([f]) => f);
  assert.deepEqual(stepped, []);
});

test('B-216 (D-222): no interface move runs over 0.45 s (a looping indicator aside)', () => {
  const long = timings(css).filter(t => !t.loops && t.secs.some(s => s > 0.45));
  assert.deepEqual(
    long.map(t => `${t.prop}: ${t.value}`),
    []
  );
});

test('B-216 (D-222): a view settles within 0.16 s and folds take 0.28 s', () => {
  const enter = css.match(/\.panel\.enter\{animation:fade ([\d.]+)s/);
  assert.ok(enter && Number(enter[1]) <= 0.16, 'the view fade: ' + (enter && enter[1]));
  const hero = css.match(/body\.captions \.hero,[^{]*\{[^}]*transition:height ([\d.]+)s/);
  assert.ok(hero && Number(hero[1]) === 0.28, "her stage's fold: " + (hero && hero[1]));
});

test('B-216 (D-222): reduced motion stops every interface move and keeps the end states', () => {
  assert.match(
    css,
    /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{transition:none!important;animation:none!important\}\}/
  );
  assert.ok(
    appFiles.some(([f, t]) => f === HER && /reduce/.test(t)),
    'her module reads reduced motion'
  );
});
