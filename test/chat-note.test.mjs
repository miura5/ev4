// B-497: a note made through the chat ("note: …") keeps every word: a short title from its first line and the whole
// text in its body, nothing cut; its course is the one its words or the conversation name, else the next exam's.
// Made-up words throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { assertValid } from './core-fixtures.mjs';

const EXAMS = [
  { id: 'E5', course: 'NUR 112', date: '2026-11-17', title: 'Exam 5', status: 'upcoming' },
  { id: 'BX3', course: 'BIO 201', date: '2026-11-02', title: 'Lecture Exam 3', status: 'upcoming' },
  { id: 'BX2', course: 'BIO 201', date: '2026-10-01', title: 'Lecture Exam 2', status: 'done' },
];
const AT = '2026-10-29T15:00:00Z';
const LONG =
  'Remember for the exam that fluid volume deficit shows as tachycardia, low urine output, poor skin turgor and a ' +
  'rising hematocrit, while fluid volume excess shows as bounding pulses, crackles, edema and a falling hematocrit; ' +
  'the nurse weighs the client daily at the same time on the same scale, and a gain of 1 kg is about 1 liter of ' +
  'fluid kept. Also: isotonic saline for deficit, a diuretic and fluid restriction for excess, and watch potassium ' +
  'with loop diuretics because it drops; hypokalemia shows as muscle weakness and flat T waves. ' +
  'Last third: the end of this note must survive whole, ending here.';

test('B-497: a long one-line note gets a short title from its start and keeps every word in its body', () => {
  const { title, body } = EV.noteParts(LONG);
  assert.ok(title.length <= 80, title);
  assert.ok(title.endsWith('…'));
  assert.ok(LONG.startsWith(title.slice(0, -1)));
  assert.equal(body, LONG, 'the whole text, nothing cut');
  const w = EV.noteIdea(title, { at: AT, date: '2026-10-29', body, course: 'NUR 112' });
  assert.ok(w.data.text.includes('Last third: the end of this note must survive whole, ending here.'));
  assert.equal(w.data.text.split('\n')[0], title);
  assert.equal(w.data.course, 'NUR 112');
  assertValid(w);
});

test('B-497: a note of several lines takes its first line as the title and the rest as its body', () => {
  const { title, body } = EV.noteParts('Fluids\nDeficit: tachycardia.\n\nExcess: crackles.');
  assert.equal(title, 'Fluids');
  assert.equal(body, 'Deficit: tachycardia.\n\nExcess: crackles.');
});

test('B-497: its course is the one its words name, else the conversation’s, else the next exam’s', () => {
  const date = '2026-10-29';
  assert.equal(
    EV.noteCourse({ text: 'for NUR112: daily weights', recent: ['BIO 201 bones'], exams: EXAMS, date }),
    'NUR 112'
  );
  assert.equal(
    EV.noteCourse({
      text: 'daily weights',
      recent: ['What about osteoclasts?', 'From BIO 201: Bones slides'],
      exams: EXAMS,
      date,
    }),
    'BIO 201'
  );
  assert.equal(EV.noteCourse({ text: 'daily weights', recent: [], exams: EXAMS, date }), 'BIO 201', 'the next exam');
  assert.equal(EV.noteCourse({ text: 'daily weights', recent: [], exams: EXAMS, date: '2026-11-05' }), 'NUR 112');
  assert.equal(EV.noteCourse({ text: 'daily weights', recent: [], exams: [], date }), null);
});
