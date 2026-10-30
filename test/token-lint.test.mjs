// B-515 D2c (D-380): the token lint. View CSS takes colour, font size, radius and duration from page/ds/tokens.css
// only; tokens.css itself and the Gallery's sheet are the only files that may hold raw values (B-515 lane 4b retired
// the carry and every per-file pin).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { audit } from '../tools/token-audit.mjs';
import { styleParts } from '../tools/build.mjs';

export const EXEMPT = ['page/ds/tokens.css', 'page/ds/gallery.css'];
const RAW = {
  colours: /#[0-9a-f]{3}|\b(?:rgba?|hsla?|oklch|lch)\(\s*[\d.]/i,
  fontSizes: /\d/,
  radii: /^(?!0(px)?$).*\d/,
  durations: /\d/,
};
const raw = f => {
  const a = audit(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  return Object.entries(RAW).map(([k, re]) =>
    a.families[k].values.filter(v => re.test(v.value)).reduce((s, v) => s + v.uses, 0)
  );
};

test('B-515 (D-380): view CSS adds no raw colour, font size, radius or duration outside tokens.css', () => {
  const parts = styleParts(ROOT).map(([, f]) => f);
  for (const f of parts) {
    if (EXEMPT.includes(f)) continue;
    const n = raw(f);
    Object.keys(RAW).forEach((k, i) => assert.equal(n[i], 0, `${f}: ${n[i]} raw ${k}`));
  }
});
