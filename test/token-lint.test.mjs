// B-515 D2c (D-380): the token lint. View CSS takes colour, font size, radius and duration from page/ds/tokens.css
// only. the carry (page/ds/views/carry-*.css, build.mjs CARRY) is exempt until consolidation retires it, as are tokens.css itself and the
// Gallery's sheet. The other files still hold the raw values they had when the legacy layer was dropped: each is
// pinned at that count and may only go down (the tokens branch takes them to zero), and a file not listed holds none.
// The carry's build (tools/carry.mjs) keeps legacy's precedence: its raised selectors outrank every other selector.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { audit } from '../tools/token-audit.mjs';
import { styleParts, CARRY } from '../tools/build.mjs';
import { carry, raiseList, CARRY_IDS } from '../tools/carry.mjs';

export const EXEMPT = ['page/ds/tokens.css', ...CARRY, 'page/ds/gallery.css'];
const RAW = {
  colours: /#[0-9a-f]{3}|\b(?:rgba?|hsla?|oklch|lch)\(\s*[\d.]/i,
  fontSizes: /\d/,
  radii: /^(?!0(px)?$).*\d/,
  durations: /\d/,
};
// [colours, font sizes, radii, durations] left per file on Oct 30; lower these as tokens replace them, never raise.
const LEFT = new Map([
  ['page/ds/base.css', [0, 1, 0, 0]], // B-515 snap (D-402): the body's 16px is the reading size, not a half step
  ['page/ds/components/06-fold.css', [0, 0, 0, 2]],
  ['page/ds/patterns/cards.css', [0, 20, 4, 0]],
  ['page/ds/patterns/plan-card.css', [1, 19, 4, 0]],
  ['page/ds/patterns/runner.css', [0, 10, 6, 0]],
  ['page/ds/patterns/sessions.css', [0, 3, 2, 3]],
  ['page/ds/patterns/shell.css', [3, 38, 28, 4]],
  ['page/ds/patterns/triage.css', [1, 3, 2, 0]],
  ['page/ds/views/ev.css', [9, 26, 18, 15]], // B-515 lane 2: the carry's 14, 15 and 3 px radii and .36s, until the snap
  ['page/ds/views/notes.css', [0, 17, 4, 0]],
  ['page/ds/views/progress.css', [0, 7, 3, 0]],
  ['page/ds/views/record.css', [3, 7, 2, 0]],
  ['page/ds/views/study.css', [0, 25, 9, 1]],
  ['page/ds/views/today.css', [0, 44, 27, 0]],
]);
const raw = f => {
  const a = audit(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  return Object.entries(RAW).map(([k, re]) =>
    a.families[k].values.filter(v => re.test(v.value)).reduce((s, v) => s + v.uses, 0)
  );
};

test('B-515 (D-380): view CSS adds no raw colour, font size, radius or duration outside tokens.css; the carry is exempt', () => {
  const parts = styleParts(ROOT).map(([, f]) => f);
  assert.ok(
    CARRY.every(f => parts.includes(f)),
    'the exemption names the carry'
  );
  for (const f of parts) {
    if (EXEMPT.includes(f)) continue;
    const n = raw(f),
      max = LEFT.get(f) || [0, 0, 0, 0];
    Object.keys(RAW).forEach((k, i) => assert.ok(n[i] <= max[i], `${f}: ${n[i]} raw ${k}, at most ${max[i]}`));
  }
});

test('B-515: the carry keeps legacy precedence: raised normal declarations, plain !important ones', () => {
  assert.equal(
    raiseList('a, .b::after'),
    'a' + ':not(#\\#)'.repeat(CARRY_IDS) + ',.b' + ':not(#\\#)'.repeat(CARRY_IDS) + '::after'
  );
  const out = carry('@media (x){.a{color:red;display:none!important}}@keyframes k{from{opacity:0}}');
  assert.equal(
    out,
    '@media (x){' + raiseList('.a') + '{color:red}.a{display:none!important}}@keyframes k{from{opacity:0}}'
  );
  // more ids than any other selector in the sheet holds, so a raised carry rule wins as the legacy layer did
  let most = 0;
  for (const [, f] of styleParts(ROOT)) {
    if (CARRY.includes(f)) continue;
    const css = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{/g))
      for (const sel of m[1].split(',')) most = Math.max(most, (sel.match(/#[a-zA-Z_\\-]/g) || []).length);
  }
  assert.ok(CARRY_IDS > most, `a selector holds ${most} ids`);
});
