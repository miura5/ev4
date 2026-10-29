// E.V. core's Canvas rules: the code side of the read-only sync (B-160, split from core.test.mjs with its section). All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import EV from '../core/evcore.mjs';
import { assertValid } from './core-fixtures.mjs';

test('Canvas: Central dates, graded flags, change detection; documents carry the canvas-sync envelope', () => {
  const raw = {
    courses: { 'NUR 112': 199214 },
    planner: [
      {
        plannable_id: 1,
        plannable_type: 'assignment',
        course_id: 199214,
        plannable: { title: 'Older Adult', due_at: '2026-11-17T05:59:59Z', points_possible: 10 },
      },
    ],
    announcements: [
      {
        id: 9,
        title: 'Week of 10/19',
        message: '<p>Monday lab: <b>Head-to-Toe</b></p>',
        context_code: 'course_199214',
        posted_at: '2026-10-15T14:00:00Z',
      },
    ],
  };
  let r = EV.normalizeCanvas(raw, {}, { now: '2026-10-17T20:15:00Z' });
  assert.equal(r.dates[0].data.date, '2026-11-16');
  assert.equal(r.dates[0].data.graded, true);
  assert.equal(r.dates[0].data.writer, 'canvas-sync');
  assert.equal(r.announcements[0].data.text, 'Monday lab: Head-to-Toe');
  assertValid({ op: 'set', collection: 'dates', id: r.dates[0].id, data: r.dates[0].data });
  assertValid({ op: 'set', collection: 'announcements', id: r.announcements[0].id, data: r.announcements[0].data });
  r = EV.normalizeCanvas(raw, { dates: [{ id: 'canvas-1', ...r.dates[0].data }], announcements: [{ id: 'canvas-9' }] });
  assert.equal(r.dates.length + r.announcements.length, 0, 'unchanged items are skipped');
  // A hand-entered date that already carries the Canvas id is updated in place, never duplicated.
  const hand = {
    id: 'nur-2026-11-16-older-adult',
    canvasId: 1,
    date: '2026-11-15',
    dueAt: '2026-11-16T05:59:59Z',
    title: 'Older Adult (ATI)',
    kind: 'due',
  };
  r = EV.normalizeCanvas(raw, { dates: [hand] });
  assert.equal(r.dates.length, 1);
  assert.equal(r.dates[0].id, 'nur-2026-11-16-older-adult');
  assert.equal(r.dates[0].op, 'update');
  assert.equal(r.dates[0].data.date, '2026-11-16');
  assert.ok(!('title' in r.dates[0].data), 'the hand-written title is kept');
});

test('D-324: the Canvas door passes every text on; nothing is held as a patient identifier', () => {
  const raw = {
    courses: { 'NUR 112': 199214 },
    planner: [],
    announcements: [
      {
        id: 21,
        title: 'Clinical reminder',
        message: '<p>Bring your stethoscope. Your client in room 12 (MRN: 4482913) needs a made-up care plan.</p>',
        context_code: 'course_199214',
        posted_at: '2026-10-15T14:00:00Z',
      },
      {
        id: 22,
        title: 'Lab moved',
        message: '<p>Skills lab moves to room 214 on Tuesday.</p>',
        context_code: 'course_199214',
        posted_at: '2026-10-15T15:00:00Z',
      },
    ],
    files: [
      {
        course: 'NUR 112',
        courseId: 199214,
        fileId: 501,
        title: 'Made-up case study',
        module: 'Exam 4 Content',
        updatedAt: '2026-10-15T00:00:00Z',
        text: '[p1] Case: patient born 03/14/1951, DOB 03/14/1951. ' + 'Made-up teaching text. '.repeat(20),
      },
      {
        course: 'NUR 112',
        courseId: 199214,
        fileId: 502,
        title: 'Made-up slides',
        module: 'Exam 4 Content',
        updatedAt: '2026-10-15T00:00:00Z',
        text: "[s1] Label the specimen with the patient's name, DOB and MRN. " + 'Made-up teaching text. '.repeat(20),
      },
    ],
  };
  const r = EV.normalizeCanvas(raw, {}, { now: '2026-10-17T20:15:00Z' });
  assert.deepEqual(r.announcements.map(a => a.id).sort(), ['canvas-21', 'canvas-22'], 'nothing is refused at the door');
  assert.deepEqual(r.materials.map(m => m.id).sort(), ['NUR112-501', 'NUR112-502']);
  assert.deepEqual(r.refused, []);
  assert.match(r.announcements.find(a => a.id === 'canvas-21').data.text, /MRN: 4482913/, 'kept as written');
});

// ------------------------------------------------------------------------------------------------ B-465: exams from the calendar
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { unknownCourses } from '../core/lint.mjs';

const NOW = '2026-10-28T16:00:00Z',
  TODAY = '2026-10-28';
const date = (id, date, title, extra = {}) => ({
  id,
  schema: 1,
  writer: 'page',
  at: '2026-10-28T15:00:00Z',
  source: 'Told E.V.',
  date,
  title,
  kind: 'exam',
  graded: false,
  course: 'BIO 201',
  ...extra,
});

test('B-465: a calendar entry whose title names an exam becomes its course’s exam, kind by the title and the course’s examKinds', () => {
  const dates = [
    date('d-lab', '2026-10-28', 'Chapter 9 lab exam (starts today)'),
    date('d-unit', '2026-11-01', 'Chapter 9 exam (due Sunday night)'),
    date('d-final', '2026-12-10', 'Final exam', { course: 'bio201' }), // an alias is the course's own name
    date('d-nur', '2026-11-20', 'Dosage Calculation Exam', { course: 'NUR 112', kind: 'due' }), // the title says exam
    date('d-ati', '2026-12-01', 'ATI Fundamentals Proctored Exam', { course: 'NUR 112' }),
  ];
  const w = EV.examsFromDates({ dates, exams: [], now: NOW, today: TODAY });
  assert.deepEqual(
    w.map(x => [x.op, x.collection, x.id, x.data.course, x.data.kind, x.data.date, x.data.status, x.data.dateId]),
    [
      ['set', 'exams', 'BIO201.20261028', 'BIO 201', 'lab', '2026-10-28', 'upcoming', 'd-lab'],
      ['set', 'exams', 'BIO201.20261101', 'BIO 201', 'unit', '2026-11-01', 'upcoming', 'd-unit'],
      ['set', 'exams', 'NUR112.20261120', 'NUR 112', 'dosage', '2026-11-20', 'upcoming', 'd-nur'],
      ['set', 'exams', 'NUR112.20261201', 'NUR 112', 'ati', '2026-12-01', 'upcoming', 'd-ati'],
      ['set', 'exams', 'BIO201.20261210', 'BIO 201', 'final', '2026-12-10', 'upcoming', 'd-final'],
    ]
  );
  for (const x of w) {
    assertValid(x);
    assert.deepEqual(
      [x.data.schema, x.data.writer, x.data.source, x.data.at],
      [2, 'page', 'From the calendar', new Date(NOW).toISOString()]
    );
  }
  assert.equal(w[0].data.title, 'Chapter 9 lab exam (starts today)', 'his words, as written');
  assert.deepEqual(unknownCourses({ exams: w.map(x => ({ id: x.id, ...x.data })) }), [], 'exams.course names a course');
  // a past exam day derives nothing (an exam made is permanent, B-11); no today means nothing at all
  assert.deepEqual(
    EV.examsFromDates({ dates: [date('d-old', '2026-10-18', 'Lecture Exam 3')], exams: [], now: NOW, today: TODAY }),
    []
  );
  assert.deepEqual(EV.examsFromDates({ dates, exams: [], now: NOW }), []);
  // the kind by the title and the course: NUR 112 has no lab kind, BIO 201 no dosage; midterm and test are unit exams
  assert.deepEqual(
    [
      EV.examKindFor('Lab exam', 'NUR 112'),
      EV.examKindFor('Lab practical', 'BIO 201'),
      EV.examKindFor('Dosage calc test', 'BIO 201'),
      EV.examKindFor('Midterm', 'BIO 201'),
      EV.examKindFor('Final', 'NUR 112'),
      EV.examKindFor('x', 'CHEM 101'),
    ],
    ['unit', 'lab', 'unit', 'unit', 'final', null]
  );
  assert.deepEqual(
    [EV.examKinds('BIO 201'), EV.examKinds('nur 112'), EV.examKinds('CHEM 101')],
    [['unit', 'lab', 'final'], ['unit', 'dosage', 'final', 'ati'], []]
  );
});

test('B-465: a day the course already has an exam for, a non-exam entry, a review of an exam, an entry taken off and an unknown course each give nothing', () => {
  const dates = [
    date('d-lab', '2026-10-28', 'Chapter 9 lab exam'),
    date('d-unit', '2026-11-01', 'Chapter 9 exam'),
    date('d-due', '2026-11-03', 'Chapter 9 written assignment', { kind: 'due' }),
    date('d-e5', '2026-11-05', 'Exam 5', { course: 'NUR 112' }),
    date('d-rem', '2026-11-06', 'Exam 5 Remediation', { course: 'NUR 112' }),
    date('d-rev', '2026-11-04', 'Exam 5 review session', { course: 'NUR 112', kind: 'other' }),
    date('d-sim', '2026-11-07', 'Sim exam day', { course: 'NUR 112' }),
    date('d-off', '2026-11-12', 'Chapter 10 exam'),
    date('d-chem', '2026-11-13', 'Exam 2', { course: 'CHEM 101' }),
  ];
  const exams = [
    {
      id: 'BIO201.20261028',
      course: 'BIO 201',
      kind: 'lab',
      date: '2026-10-28',
      title: 'Chapter 9 lab exam',
      dateId: 'd-lab',
    },
    { id: 'E5', course: 'NUR 112', kind: 'unit', date: '2026-11-05', title: 'Exam 5' },
  ];
  const dateedits = [{ id: 'd-off', removed: { at: NOW, by: 'Matt' } }];
  const w = EV.examsFromDates({ dates, dateedits, exams, now: NOW, today: TODAY });
  assert.deepEqual(
    w.map(x => x.id),
    ['BIO201.20261101'],
    'only the Chapter 9 exam: the lab exam has its document, Exam 5 is E5 (same course and day)'
  );
  // an exam that names the entry covers it even when its day was changed since
  const moved = [
    { id: 'BIO201.20261101', course: 'BIO 201', kind: 'unit', date: '2026-11-02', title: 'x', dateId: 'd-unit' },
  ];
  assert.deepEqual(EV.examsFromDates({ dates, dateedits, exams: [...exams, ...moved], now: NOW, today: TODAY }), []);
  // two entries on one day for one course give one exam; skip leaves out the ids already written this load
  const twice = [date('a', '2026-11-01', 'Chapter 9 exam'), date('b', '2026-11-01', 'Ch 9 lecture exam')];
  assert.equal(EV.examsFromDates({ dates: twice, exams: [], now: NOW, today: TODAY }).length, 1);
  assert.deepEqual(
    EV.examsFromDates({ dates: twice, exams: [], now: NOW, today: TODAY, skip: ['BIO201.20261101'] }),
    []
  );
  // nothing is ever an update or a delete: every write is a set of an exam the record lacks
  assert.ok(w.every(x => x.op === 'set' && !exams.some(e => e.id === x.id)));
});

test('B-465 review: only real exams of a known course, today or later, and never a second exam for one already held', () => {
  const one = (d, exams = []) => EV.examsFromDates({ dates: [d], exams, now: NOW, today: TODAY }).map(w => w.id);
  // not exams: a care plan, a pre-test, a TB test, a quiz, a reflection, a paper (kind due or even kind exam)
  assert.deepEqual(one(date('a', '2026-11-02', 'Final Care Plan', { kind: 'due', course: 'NUR 112' })), []);
  assert.deepEqual(one(date('a', '2026-11-02', 'ATI Pre-test', { course: 'NUR 112' })), []);
  assert.deepEqual(one(date('a', '2026-11-02', 'ATI Fundamentals post test', { course: 'NUR 112' })), []);
  assert.deepEqual(one(date('a', '2026-11-02', 'TB test due', { kind: 'due', course: 'NUR 112' })), []);
  assert.deepEqual(one(date('a', '2026-11-02', 'Final test', { kind: 'due' })), [], 'test or final only on kind exam');
  assert.deepEqual(one(date('a', '2026-11-02', 'Chapter 9 quiz (exam prep)')), []);
  assert.deepEqual(one(date('a', '2026-11-02', 'Exam 4 reflection', { kind: 'due', course: 'NUR 112' })), []);
  assert.deepEqual(one(date('a', '2026-11-02', 'Exam paper', { kind: 'due' })), []);
  // exams: a kind-due entry titled exam or midterm; a kind-exam "Final exam"
  assert.deepEqual(one(date('a', '2026-11-02', 'Midterm', { kind: 'due' })), ['BIO201.20261102']);
  assert.deepEqual(one(date('a', '2026-12-10', 'Final exam')), ['BIO201.20261210']);
  // no course of its own: nothing (no default-course guess)
  const { course, ...courseless } = date('a', '2026-11-02', 'Exam 6');
  assert.deepEqual(one(courseless), []);
  // a past day: nothing; today: an exam, upcoming
  assert.deepEqual(one(date('a', '2026-10-27', 'Exam 6', { course: 'NUR 112' })), []);
  const today = EV.examsFromDates({
    dates: [date('a', TODAY, 'Exam 6', { course: 'NUR 112' })],
    exams: [],
    now: NOW,
    today: TODAY,
  });
  assert.deepEqual(
    today.map(w => [w.id, w.data.status]),
    [['NUR112.20261028', 'upcoming']]
  );
  // an exam held without a course field is matched by its own course from its id, never the default one
  const bioE3 = { id: 'BIO-E3', kind: 'unit', date: '2026-11-02', title: 'Lecture Exam 3' };
  assert.deepEqual(one(date('a', '2026-11-02', 'Lecture Exam 3'), [bioE3]), []);
  assert.deepEqual(
    one(date('a', '2026-11-02', 'Exam 6', { course: 'NUR 112' }), [bioE3]),
    ['NUR112.20261102'],
    'BIO-E3 is BIO 201’s, so it does not cover a NUR 112 exam that day'
  );
  assert.deepEqual(
    [
      EV.examCourse(bioE3),
      EV.examCourse({ id: 'E5' }),
      EV.examCourse({ id: 'ATI-fund' }),
      EV.examCourse({ id: 'BIO201.20261102' }),
    ],
    ['BIO 201', 'NUR 112', 'NUR 112', 'BIO 201']
  );
  assert.deepEqual(
    one(date('a', '2026-11-05', 'Exam 5', { course: 'NUR 112' }), [{ id: 'E5', date: '2026-11-05' }]),
    []
  );
});

test('B-465 review: the page derives exams only after dates, dateedits and exams have each had a first snapshot', () => {
  const connect = fs.readFileSync(path.join(ROOT, 'page', 'app', '03-connect.js'), 'utf8');
  const study = fs.readFileSync(path.join(ROOT, 'page', 'app', '20-study.js'), 'utf8');
  assert.match(connect, /loaded\.add\(key === 'dates' \? 'dates:raw' : 'dateedits'\)/);
  assert.match(study, /\['dates:raw', 'dateedits', 'exams'\]\.every\(k => loaded\.has\(k\)\)/);
  // dates arriving with no edits yet would give the entry he took off its exam; once the edits are in, it gives none
  const dates = [date('d-off', '2026-11-12', 'Chapter 10 exam')];
  const dateedits = [{ id: 'd-off', removed: { at: NOW, by: 'Matt' } }];
  assert.equal(EV.examsFromDates({ dates, dateedits: [], exams: [], now: NOW, today: TODAY }).length, 1);
  assert.deepEqual(EV.examsFromDates({ dates, dateedits, exams: [], now: NOW, today: TODAY }), []);
});

test('B-465: his Add exam composes a valid exams document through core (D-200), never over an exam that day', () => {
  const exams = [{ id: 'E5', course: 'NUR 112', kind: 'unit', date: '2026-11-05', title: 'Exam 5' }];
  const w = EV.examAdd(
    exams,
    { course: 'BIO 201', title: ' Chapter 10  lab exam ', date: '2026-11-12' },
    { now: NOW, today: TODAY }
  );
  assertValid(w);
  assert.deepEqual(
    [
      w.op,
      w.collection,
      w.id,
      w.data.course,
      w.data.kind,
      w.data.date,
      w.data.title,
      w.data.status,
      w.data.source,
      w.data.writer,
      w.data.schema,
    ],
    [
      'set',
      'exams',
      'BIO201.20261112',
      'BIO 201',
      'lab',
      '2026-11-12',
      'Chapter 10 lab exam',
      'upcoming',
      'Added by Matt',
      'page',
      2,
    ]
  );
  assert.deepEqual(unknownCourses({ exams: [{ id: w.id, ...w.data }] }), []);
  // the kind he picks wins when the course has it; one it lacks falls back to the title's
  assert.equal(
    EV.examAdd(exams, { course: 'BIO 201', title: 'Chapter 10', date: '2026-11-12', kind: 'final' }, { now: NOW }).data
      .kind,
    'final'
  );
  assert.equal(
    EV.examAdd(exams, { course: 'BIO 201', title: 'Chapter 10', date: '2026-11-12', kind: 'dosage' }, { now: NOW }).data
      .kind,
    'unit'
  );
  assert.throws(
    () => EV.examAdd(exams, { course: 'NUR 112', title: 'Exam 5 again', date: '2026-11-05' }, { now: NOW }),
    /already has an exam on/
  );
  assert.throws(
    () => EV.examAdd(exams, { course: 'CHEM 101', title: 'x', date: '2026-11-05' }, { now: NOW }),
    /which course/
  );
  assert.throws(() => EV.examAdd(exams, { course: 'BIO 201', title: 'x', date: 'Nov 5' }, { now: NOW }), /YYYY-MM-DD/);
  assert.throws(
    () => EV.examAdd(exams, { course: 'BIO 201', title: '  ', date: '2026-11-05' }, { now: NOW }),
    /title is required/
  );
  // the page's two exam writes are core composers; test/actions.test.mjs's D-200 lint holds every page write site to that
  const study = fs.readFileSync(path.join(ROOT, 'page', 'app', '20-study.js'), 'utf8');
  const nw = fs.readFileSync(path.join(ROOT, 'page', 'app', '80-new.js'), 'utf8');
  assert.match(study, /run\(E\.examsFromDates\(args\)\)/);
  assert.match(nw, /write\(\s*E\.examAdd\(/);
});
