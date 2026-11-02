// B-669: "Make a mock exam for chapter 9" quizzes on chapter 9 with a full set. quiz_me takes a chapter or topic and a
// count, the record's questions on it are matched by core (EVCore.quizTopic), and a quiz the record can't fill is
// written fresh, never served short. Made-up data throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import './core-fixtures.mjs';

const app = n => fs.readFileSync(new URL('../page/app/' + n, import.meta.url), 'utf8');
const { chapterOf, chapterNums, matcher } = EV.quizTopic;

test('B-669: a chapter is read from his words, a title or an objective', () => {
  for (const t of ['chapter 9', 'Chapter 9 mock exam', 'ch 9', 'Ch. 9', 'ch9', 'chap 9', 'BIO 201 Ch 9 Muscles.pdf'])
    assert.equal(chapterOf(t), 9, t);
  assert.equal(chapterOf('muscle contraction'), null);
  assert.equal(chapterOf('BIO 201'), null, 'a course number is no chapter');
  assert.equal(chapterOf('each 9 questions'), null);
  assert.deepEqual([...chapterNums([9, '10'])], [9, 10]);
  assert.deepEqual([...chapterNums('Ch 9-11')], [9, 10, 11]);
  assert.deepEqual([...chapterNums(['Chapter 9'])], [9]);
  assert.equal(chapterNums(undefined).size, 0);
});

test('B-669: a question is on chapter 9 by its objective, its source, its words or its set', () => {
  const objectives = [
    { id: 'X1-1', text: 'Describe the sarcomere', chapters: [9] },
    { id: 'X1-2', text: 'Name the bones of the skull', chapters: ['8'] },
  ];
  const materials = [{ id: 'mat-ch9', title: 'Ch 9 Muscle tissue slides' }];
  const on = matcher('chapter 9', { objectives, materials });
  assert.equal(on({ objective: 'X1-1', stem: 'Which band shortens?' }), true, 'its objective covers chapter 9');
  assert.equal(on({ objective: 'X1-2', stem: 'Which bone is this?' }), false, 'its objective is chapter 8');
  assert.equal(on({ sourceRef: 'materials/mat-ch9', stem: 'Which ion binds troponin?' }), true, 'its source');
  assert.equal(on({ stem: 'Which ion binds troponin?' }, { title: 'Mock exam · X 101 · chapter 9' }), true, 'its set');
  assert.equal(on({ stem: 'Which ion binds troponin?' }, { title: 'More practice · Sun 1 Nov' }), false);
  assert.equal(on(null), false);
});

test('B-669: a topic in words matches when at least half its words show in the question', () => {
  const on = matcher('muscle contraction');
  assert.equal(on({ topic: 'Muscle contraction', stem: 'What starts the power stroke?' }), true);
  assert.equal(on({ topic: 'Muscles', stem: 'Which protein forms the thin filament?' }), true, 'half of two words');
  assert.equal(on({ topic: 'Bone remodeling', stem: 'Which cell resorbs bone?' }), false);
  assert.equal(matcher(''), null, 'no topic, no filter');
  assert.equal(matcher('mock exam'), null, 'quiz words alone are no topic');
});

test('B-669: quiz_me takes a chapter or topic and a count, and a short record is written, never served short', () => {
  const chat = app('72-ev-talking-with-claude.js');
  const quiz = chat.slice(chat.indexOf("name: 'quiz_me'"), chat.indexOf("name: 'study_session'"));
  assert.match(quiz, /topic: \{\s*type: 'string'/);
  assert.match(quiz, /count: \{\s*type: 'integer',\s*minimum: 1,\s*maximum: 20/);
  assert.match(quiz, /mock exam/);
  assert.match(quiz, /a practice job that failed earlier is never a reason not to call it/);
  assert.match(quiz, /topic: str\(i\.topic, 60\)/);
  // the conversation's record summary says a failed job is no reason to refuse
  assert.match(chat, /Recent jobs \(one that failed is no reason to refuse or shrink a new ask/);
  // a practice-set job is held to what fits one answer
  assert.match(chat, /practice-set: 10 to 20 questions/);
  const study = app('20-study.js');
  const body = study.slice(study.indexOf('function quizInChat'), study.indexOf('function renderMiniQuiz'));
  assert.match(body, /if \(have >= n \|\| \(have && !words && n <= 5\)\) return served\(\);/);
  assert.match(body, /morePractice\(\{[\s\S]*count: n,[\s\S]*topic:/);
  const more = study.slice(
    study.indexOf('async function morePractice'),
    study.indexOf("$('more-btn').addEventListener")
  );
  assert.match(more, /`Write exactly \$\{n\} questions\.`/);
  assert.match(more, /topicPassages\(opt\.topic/);
});
