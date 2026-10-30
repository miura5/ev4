// B-594: one kind map. Every word E.V. puts on a kind badge (Today's BADGE, the study plan's tags, Record's REC_BADGE)
// is in DS.kind's map, and no kind badge carries an old .x-* tone class that would paint over its kind's colour.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import EV from '../core/evcore.mjs';

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

// B-607: New task's Kind picker lists core's list kinds, worded as Today's badge, each a kind in the one map
const todayBadge = new Function(block(src('10-today.js'), 'const BADGE = {') + '}; return BADGE;')();
const pickerKinds = () =>
  Object.entries(EV.LIST_KINDS).map(([v, tag]) => [v, tag && todayBadge[tag] ? todayBadge[tag][0] : 'Class']);

test('B-607: the New task Kind picker is the kind map, with no list of its own', () => {
  const nw = src('80-new.js');
  assert.ok(
    nw.includes("Object.entries(E.LIST_KINDS).map(([v, tag]) => [v, tag && BADGE[tag] ? BADGE[tag][0] : 'Class'])")
  );
  assert.ok(!nw.includes("['reading', 'Reading']"));
  const kinds = pickerKinds();
  for (const k of ['todo', 'reading', 'learn', 'practice', 'review', 'notes', 'graded', 'skills-prep', 'clinical-prep'])
    assert.ok(
      kinds.some(([v]) => v === k),
      `the picker offers ${k}`
    );
  for (const [v, word] of kinds) assert.ok(dsKind(word), `${v}'s word ${word} is a kind`);
});

test('B-607: a hand-added Learn and Skills prep save their kind and show the plan badge', () => {
  const day = { id: '2026-10-30', date: '2026-10-30', list: { items: [] } };
  const now = new Date('2026-10-30T15:00:00Z');
  for (const [kind, tag, word, k] of [
    ['learn', 'LEARN', 'Learn', 'learn'],
    ['skills-prep', 'SKILLS PREP', 'Skills prep', 'skills'],
  ]) {
    const a = EV.listEdit(day, null, { action: 'add', text: 'My ' + kind, kind, minutes: 15 }, { now, by: 'Matt' });
    const it = a.doc.added[a.id];
    assert.equal(it.kind, kind);
    assert.equal(it.tag, tag);
    assert.equal(todayBadge[tag][0], word);
    assert.equal(dsKind(word), k);
  }
  const study = block(src('10-today.js'), 'const STUDY_TAGS = new Set([');
  for (const t of ['LEARN', 'SKILLS PREP'])
    assert.ok(study.includes(`'${t}'`), `${t} counts as Study, as a plan's does`);
});
