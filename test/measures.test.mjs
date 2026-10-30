// B-522: one source per measure (core/measures.mjs). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import E from '../core/evcore.mjs';

const spot = (id, status, extra = {}) => ({ id, kind: 'concept', derived: { status, ...extra.d }, ...extra.w });

test('B-522: open weak spots leave out previews, and a course filter keeps spots with no course', () => {
  const ms = [
    spot('a', 'open', { w: { c: 'X' } }),
    spot('b', 'open', { d: { preRead: true } }),
    spot('c', 'parked'),
    spot('d', 'open', { w: { c: 'Y' } }),
    spot('e', 'open'),
  ];
  assert.deepEqual(
    E.openSpots(ms).map(w => w.id),
    ['a', 'd', 'e']
  );
  assert.deepEqual(
    E.openSpots(ms, { course: 'X', courseOf: w => w.c || null }).map(w => w.id),
    ['a', 'e']
  );
});

test('B-522: an objective with answers and no spots is solid; an open unright spot is not yet', () => {
  const o = { id: 'E1-1' };
  assert.equal(E.objectiveState(o, [], { n: 3 }).state, 'solid');
  assert.equal(E.objectiveState(o, [], undefined).state, 'notyet');
  const ws = [spot('a', 'open', { w: { objective: 'E1-1' } })];
  assert.equal(E.objectiveState(o, ws, { n: 3 }).state, 'notyet');
  ws[0].derived.streak = 1;
  assert.equal(E.objectiveState(o, ws, { n: 3 }).state, 'almost');
});

test('B-522: study time counts a running session at its clock and ticked minutes per course, never twice', () => {
  const now = '2026-10-29T17:12:00Z';
  const sessions = [
    { id: 's1', status: 'ended', date: '2026-10-29', minutes: 20, c: 'A' },
    { id: 's2', status: 'active', date: '2026-10-29', startedAt: '2026-10-29T17:00:00Z', c: 'B' },
    { id: 's3', status: 'discarded', date: '2026-10-29', minutes: 50, c: 'A' },
  ];
  const ticked = [
    { date: '2026-10-29', course: 'A', minutes: 15 },
    { date: '2026-10-29', course: 'C', minutes: 30 },
  ];
  const st = E.studyTime(sessions, { now, courseOf: s => s.c, ticked });
  const running = st.sessions.find(x => x.s.id === 's2');
  assert.ok(running && running.minutes >= 11, 'the running session counts its clock: ' + (running && running.minutes));
  assert.ok(!st.sessions.some(x => x.s.id === 's3'), 'a discarded session never counts');
  const by = E.minutesByCourse(st, '2026-10-29', '2026-10-29');
  assert.equal(by.A, 20); // the larger of 20 session and 15 ticked
  assert.equal(by.C, 30);
  assert.equal(E.minutesIn(st, '2026-10-29', '2026-10-29'), 50 + by.B);
  assert.equal(E.minutesIn(st, '2026-10-30', '2026-10-31'), 0);
});

test('B-522: Study, Today and Progress read the measures from core, not their own copies', () => {
  const read = f => fs.readFileSync(new URL('../page/app/' + f, import.meta.url), 'utf8');
  const study = read('20-study.js'),
    prog = read('30-progress.js');
  assert.match(study, /E\.objectiveState\(o, M\.models, acc\)/);
  assert.match(study, /E\.openSpots\(M\.models, \{ course, courseOf: wsCourse \}\)/);
  assert.match(prog, /E\.openSpots\(M\.models\)/);
  assert.match(prog, /E\.studyTime\(S\.sessions/);
  assert.doesNotMatch(prog, /s\.status !== 'active' && s\.date/);
});

test('B-522: tasks ticked off the day list count on their tick day, plan or list, once each', () => {
  // made up: a plan's task ticked on a day it wasn't on the list, another on its own day's list, and a list add
  const plans = [
    {
      id: 'P1-2',
      exam: 'P1',
      days: [
        { date: '2026-10-29', tasks: [{ id: 't3', minutes: 45 }] },
        { date: '2026-10-30', tasks: [{ id: 'b4', minutes: 20 }] },
      ],
      done: { t3: { at: '2026-10-29T14:48:00Z' }, b4: { at: '2026-10-29T16:00:00Z' } },
    },
  ];
  const lists = [
    {
      date: '2026-10-29',
      items: [
        { id: 'plan-t3', key: 'plans/P1#t3', minutes: 45, course: 'A', done: true }, // the same task: once
        { id: 'add-x', minutes: 10, course: 'B', done: true },
        { id: 'add-y', minutes: 30, course: 'B', done: false },
      ],
    },
  ];
  const tw = E.tickedWork({ plans, planCourse: () => 'A', lists, courseOf: it => it.course });
  assert.deepEqual(
    tw.map(x => [x.key, x.date, x.course, x.minutes]),
    [
      ['plans/P1#t3', '2026-10-29', 'A', 45],
      ['plans/P1#b4', '2026-10-29', 'A', 20],
      ['2026-10-29/add-x', '2026-10-29', 'B', 10],
    ]
  );
  const st = E.studyTime([{ id: 's', status: 'ended', date: '2026-10-29', minutes: 2, c: 'B' }], {
    courseOf: s => s.c,
    ticked: tw,
  });
  assert.equal(E.minutesIn(st, '2026-10-29', '2026-10-29'), 75); // 65 A ticked, B the larger of 10 and 2
  assert.equal(E.minutesIn(st, '2026-10-30', '2026-10-30'), 0); // b4 counts the day it was ticked, not its plan day
});

test('B-591: a session with no folder takes the course its words name: guess words, or a chapter one course names', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url), 'utf8'));
  E.configure(spec);
  // made up: a lab exam names Chapter 9 in BIO 201; an NUR exam names Chapter 39
  const exams = [
    { id: 'X1', course: 'BIO 201', title: 'Chapter 9 lab exam' },
    { id: 'X2', course: 'NUR 112', title: 'Exam 4: Ch 39 fluids' },
  ];
  assert.equal(E.courseNamed('10/26 Chapter 9', { exams }), 'BIO 201');
  assert.equal(E.courseNamed('Ch. 39 notes', { exams }), 'NUR 112');
  assert.equal(E.courseNamed('skeletal muscle', { exams }), 'BIO 201');
  assert.equal(E.courseNamed('New note', { exams }), null);
  assert.equal(E.courseNamed('Chapter 12', { exams }), null);
  const prog = fs.readFileSync(new URL('../page/app/30-progress.js', import.meta.url), 'utf8');
  assert.match(prog, /E\.courseNamed\(words\.join\(' '\)/);
});

test('B-522: Today, Progress and Record read study time from core', () => {
  const read = f => fs.readFileSync(new URL('../page/app/' + f, import.meta.url), 'utf8');
  assert.match(read('30-progress.js'), /E\.tickedWork\(/);
  assert.match(read('10-today.js'), /dayStudyMinutes\(today\)/);
  assert.match(read('40-record.js'), /E\.sessionMinutes\(s, now\(\)\)/);
  assert.doesNotMatch(read('40-record.js'), /s\.minutes \?\? E\.sessionState/);
});
