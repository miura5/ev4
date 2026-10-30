// B-601: E.V.'s prompts frame material by the course in context. NCLEX and next-gen framing only for a nursing course
// (spec.courses.<name>.nursing, NUR 112); BIO 201 by its own lecture and lab exams; no course known, neutral.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import { spec } from './core-fixtures.mjs';

const kinds = spec.jobs.kinds;
const texts = () => [
  kinds['study-guide'].guide,
  kinds['exam-plan'].instructions,
  (spec.items.writingGuide || []).join(' '),
  (spec.persona.voice || []).join(' '),
];

test('the spec flags NUR 112 as nursing and names BIO 201 its own exams', () => {
  assert.equal(spec.courses['NUR 112'].nursing, true);
  assert.notEqual(spec.courses['BIO 201'].nursing, true);
  assert.match(spec.courses['BIO 201'].exams, /lecture and lab/);
});

test('a BIO 201 prompt carries no NCLEX; a NUR 112 prompt keeps it', () => {
  assert.ok(
    texts().some(t => /NCLEX/.test(t)),
    'the spec texts still name NCLEX for nursing'
  );
  for (const t of texts()) {
    const bio = EV.frameText(t, 'BIO 201');
    assert.doesNotMatch(bio, /NCLEX/);
    assert.equal(EV.frameText(t, 'NUR 112'), t);
    assert.doesNotMatch(EV.frameText(t, null), /NCLEX/);
  }
  assert.match(EV.frameText(kinds['study-guide'].guide, 'BIO 201'), /lecture and lab exams/);
  assert.match(EV.examFrame('NUR 112').style, /NCLEX/);
  assert.doesNotMatch(EV.examFrame('BIO 201').style + EV.examFrame('BIO 201').exam, /NCLEX-style|the NCLEX/);
  assert.equal(EV.examFrame(null).exam, 'his exams');
});

test('the page frames its practice questions and her teaching line by the course, never a fixed NCLEX', () => {
  const study = fs.readFileSync(new URL('../page/app/20-study.js', import.meta.url), 'utf8');
  const talk = fs.readFileSync(new URL('../page/app/72-ev-talking-with-claude.js', import.meta.url), 'utf8');
  assert.doesNotMatch(study, /'You write NCLEX-style/);
  assert.match(study, /E\.examFrame\(opt\.course/);
  assert.doesNotMatch(talk, /when it shows up on the NCLEX/);
  assert.match(talk, /evContext\(nn \? nn\.course : null\)/);
});
