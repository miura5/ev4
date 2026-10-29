// B-525 (UX map F-21): approving a plan keeps its Open questions for the instructor and its Scope map. The plan in force
// carries both fields from its draft, and its card draws them as the draft's card does. The page's side runs in
// test/harness/run.cjs (studyPlanChecks, after Approve).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import './core-fixtures.mjs';

const draft = {
  id: 'E4-2',
  exam: 'E4',
  at: '2026-10-29T15:00:00Z',
  section: { course: 'NUR 112', from: '2026-10-29', to: '2026-11-02' },
  openQuestions: ['Is the made-up chapter on the exam?'],
  scope: [
    { topic: 'Made-up fluids', chapters: 'Ch 39' },
    { topic: 'Made-up acid-base', gap: true },
  ],
  days: [{ date: '2026-10-29', tasks: [{ id: 't1', text: 'Made-up drill' }] }],
};

test('B-525: the approved plan in force keeps the draft’s Open questions and Scope map', () => {
  const pe = EV.planAccept(null, 'E4', 'E4-2', { now: '2026-10-29T16:00:00Z' });
  const [p] = EV.planViews([draft], [{ id: 'E4', ...(pe.data || pe) }]);
  assert.equal(p && p.id, 'E4-2');
  assert.deepEqual(p.openQuestions, draft.openQuestions);
  assert.deepEqual(p.scope, draft.scope);
});

test('B-525: the approved card draws the same Open questions and Scope map lines as the draft card', () => {
  const src = fs.readFileSync(new URL('../page/app/21-study-plan.js', import.meta.url), 'utf8');
  const card = src.slice(src.indexOf('function approvedCard'), src.indexOf('function planNotes'));
  assert.match(card, /rows\.append\(\.\.\.planNotes\(p\)\)/);
  const dr = src.slice(src.indexOf('function draftCard'), src.indexOf('function planWorking'));
  assert.match(dr, /rows\.append\(\.\.\.planNotes\(p\)\)/);
  assert.match(src, /'Open questions for the instructor · ' \+ qs\.length/);
});
