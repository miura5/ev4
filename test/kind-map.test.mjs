// B-594: one kind map. Every word E.V. puts on a kind badge (Today's BADGE, the study plan's tags, Record's REC_BADGE)
// is in DS.kind's map, and no kind badge carries an old .x-* tone class that would paint over its kind's colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const src = f => fs.readFileSync(path.join(ROOT, 'page/app', f), 'utf8');
const badge = src('01-ui-02-badge.js');
const dsKind = new Function(
  badge.slice(badge.indexOf('function dsKind'), badge.indexOf('\n    }\n', badge.indexOf('function dsKind')) + 6) +
    'return dsKind;'
)();
const block = (s, start) => s.slice(s.indexOf(start), s.indexOf('};', s.indexOf(start)));

test('B-594: every kind word E.V. shows is in the one kind map, with no tone class over it', () => {
  const today = block(src('10-today.js'), 'const BADGE = {');
  const words = [...today.matchAll(/\[\s*'([^']+)',\s*'([^']*)'\s*\]/g)];
  assert.ok(words.length >= 12, 'Today has its badges');
  for (const [, w, cls] of words) {
    assert.ok(dsKind(w), `Today's ${w} is a kind`);
    assert.doesNotMatch(cls, /\bx-/, `Today's ${w} carries no tone class`);
  }
  const rec = block(src('40-record.js'), 'const REC_BADGE = {');
  for (const [, w, cls] of rec.matchAll(/\[\s*'([^']+)',\s*'([^']*)'\s*\]/g)) {
    assert.ok(dsKind(w), `Record's ${w} is a kind`);
    assert.doesNotMatch(cls, /\bx-/, `Record's ${w} carries no tone class`);
  }
  for (const t of [
    'graded',
    'learn',
    'practice',
    'review',
    'clinical-prep',
    'skills-prep',
    'Clinical prep',
    'Skills prep',
  ])
    assert.ok(dsKind(t), `the plan's ${t} is a kind`);
  assert.equal(dsKind('Learn'), 'learn');
  assert.equal(dsKind('Graded'), 'graded');
  assert.equal(dsKind('Skills prep'), 'skills');
  // the study plan's badge is DS.badge, so the word sets data-k
  assert.match(src('21-study-plan.js'), /return b \? DS\.badge\(\{ text: b\[0\] \}\) : null;/);
  // and a kind's colour beats an old tone class (not :where)
  const css = fs.readFileSync(path.join(ROOT, 'page/ds/components/02-badge.css'), 'utf8');
  assert.match(css, /:is\(\.k-graded,\[data-k='graded'\]\)\{--x:var\(--kind-graded\)\}/);
});
