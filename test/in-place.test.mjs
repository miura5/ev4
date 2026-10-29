// B-517 (UX map F-31, F-32, F-56, F-62): a quiz starts where Matt is. Start on a practice or drill task with no set of
// its own starts its course's quiz inside the task (never a note or a study session), the task's course comes from the
// record or its own words, and "Quiz me" in the conversation is the quiz_me tool, not a study session.
// Made-up words throughout. The page's in-place quiz itself is driven by test/harness/run.cjs (inPlaceChecks).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import './core-fixtures.mjs'; // configures core with the spec (its courses)

const app = n => fs.readFileSync(new URL('../page/app/' + n, import.meta.url), 'utf8');

test('B-517: Start on a practice or drill task with no set is its quiz; a set opens; other tasks a session', () => {
  assert.equal(EV.taskStart({ tag: 'PRACTICE', minutes: 15, text: 'Practice: fluids' }), 'quiz');
  assert.equal(EV.taskStart({ tag: 'DRILL', minutes: 20, text: 'Drill: Ch 39, 10 questions' }), 'quiz');
  assert.equal(EV.taskStart({ tag: 'DRILL', minutes: 20, ref: 'sets/drill-E4-ch39' }), 'set');
  assert.equal(EV.taskStart({ tag: 'PRACTICE', minutes: 0, set: 'more-1' }), 'set');
  assert.equal(EV.taskStart({ tag: 'READING', minutes: 30, text: 'Read Ch 39' }), 'session');
  assert.equal(EV.taskStart({ tag: 'REVIEW', minutes: 15, text: 'Study the bones list' }), 'session');
  assert.equal(EV.taskStart({ tag: 'PRACTICE', minutes: 0, text: 'Practice: no estimate' }), null);
  assert.equal(EV.taskStart(null), null);
});

test("B-517 (F-31): a task's course is the record's, else the course its words name", () => {
  assert.equal(EV.taskCourse({ text: 'NUR 112: drill on fluids' }, { known: 'BIO 201' }), 'BIO 201');
  assert.equal(EV.taskCourse({ text: 'NUR 112: drill on fluids' }), 'NUR 112');
  assert.equal(EV.taskCourse({ text: 'bio201 bones review' }), 'BIO 201');
  assert.equal(EV.taskCourse({ text: 'Something with no course in it at all' }), null);
});

test('B-517 (F-56, F-62): the chat quizzes through quiz_me, which shows its card where he is', () => {
  const chat = app('72-ev-talking-with-claude.js');
  assert.match(chat, /name: 'quiz_me'/);
  assert.match(chat, /never starts a study session, never opens a note and never changes his view/);
  // the study session's tool sends a quiz ask to quiz_me, and its quiz with no session posts the course's quiz card
  assert.match(chat, /only when he asks for a session \(to quiz him, use quiz_me\)/);
  assert.match(app('64-ev-study-sessions.js'), /if \(!s \|\| s\.status !== 'active'\) return quizInChat\(\);/);
  // the in-place quiz never opens Notes, a note or a session, and never switches the tab
  const study = app('20-study.js');
  const body = study.slice(study.indexOf('function quizInChat'), study.indexOf('function renderMiniQuiz'));
  assert.ok(body.length > 100);
  assert.doesNotMatch(body, /showTab|newNote|startSession|setStudy/);
  const today = app('10-today.js');
  const task = today.slice(today.indexOf('function quizTask'), today.indexOf('function paintTaskQuiz'));
  assert.ok(task.length > 100);
  assert.doesNotMatch(task, /showTab|newNote|startSession|setStudy/);
});
