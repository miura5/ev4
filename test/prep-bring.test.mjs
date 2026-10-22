// B-189: "what to bring" from the record. The Oct 21 miss was a rule: that day's two calendar entries were exams (a
// NUR class exam and a BIO lab exam), and prepKindOf left every exam out, so neither the 8:15pm pack check nor the
// greeting's Prep marker ran for it. Now an exam makes a lab day (a lab exam or practical) or a class day, a day's list
// draws on the calendar entry, the Canvas announcements and course-calendar rows that name the day, the library and his
// per-kind kit, each item naming its source, and an ask in words is answered from that list. Made-up data throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import { eveningPush } from '../core/steps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(SPEC);

const env = { schema: 1, writer: 'page', at: '2026-10-18T10:55:09Z', source: 'test' };
const date = (id, d, title, kind, x = {}) => ({ id, ...env, date: d, title, kind, course: 'NUR 112', ...x });
// The shape of Oct 21: two exams on one day (one in the lab), a graded item due, and a clinical the day before.
const DATES = [
  date('2026-10-20-clinical', '2026-10-20', 'Clinical: Riverbend Rehab, 0630–1500', 'clinical'),
  date('2026-10-21-exam4', '2026-10-21', 'Exam 4: Health Promotion, Pharmacology, Functional Ability', 'exam'),
  date('bio-2026-10-21-lab-exam', '2026-10-21', 'BIO 201 Lab Exam: bones (Group A or B slot)', 'exam', {
    course: 'BIO 201',
    graded: true,
    notes: 'Study from the bones list. Bring a pencil.',
  }),
  date('nur-2026-10-21-ati', '2026-10-21', 'ATI Dosage Calc 4.0 due 11:59pm', 'due', { graded: true }),
  date('2026-10-28-lab', '2026-10-28', 'Lab: Sterile dressing change', 'other'),
];
const ANN = [
  {
    id: 'canvas-91',
    title: 'Lab exam reminders',
    course: 'BIO 201',
    postedAt: '2026-10-16T15:00:00Z',
    text: 'On 10/21 bring your bones lab sheet and a pencil for the spelling section. On 10/23 we start Ch 9.',
  },
  {
    id: 'canvas-92',
    title: 'Week of 10/19',
    course: 'NUR 112',
    postedAt: '2026-10-19T13:00:00Z',
    text: 'Wednesday is Exam 4 in room 210; bring your student ID. Monday lab is head-to-toe practice.',
  },
  {
    id: 'canvas-93',
    title: 'Posted after the day',
    course: 'NUR 112',
    postedAt: '2026-10-22T13:00:00Z',
    text: 'On 10/21 everyone should have brought a calculator.',
  },
];
const MATS = [
  {
    id: 'BIO201-7001',
    title: 'BIO 201 Lab Calendar.pdf',
    course: 'BIO 201',
    kind: 'course',
    text: '[p2] 10/14 Ch 7 bones lecture 10/21 Lab Exam 2 (bones), lab manual Ch 7 and 8 10/28 Ch 9 joints lab',
  },
  {
    id: 'NUR112-7002',
    title: 'Sterile Dressing Lab.pptx',
    course: 'NUR 112',
    kind: 'lab',
    text: '[s2] Sterile dressing change lab. Supplies needed: sterile gloves, a dressing kit.',
  },
];

test('B-189: the Oct 21 miss was a rule: two exams on one day now make a lab and a class prep day', () => {
  assert.equal(EV.prepKindOf(DATES[3]), null, 'graded work due is still never a prep day');
  const day = EV.prepDay(DATES, [], '2026-10-21');
  assert.equal(day.kind, 'lab', 'the lab exam ranks before the class exam');
  assert.equal(day.subject, 'bones', 'its subject past the course code and its "Lab Exam:" lead');
  assert.deepEqual(
    day.entries.map(e => [e.kind, e.id]),
    [
      ['lab', 'bio-2026-10-21-lab-exam'],
      ['class', '2026-10-21-exam4'],
    ]
  );
  // The evening before: the snapshot carries the pack check and the 8:15pm push leads with it (the tag that was off).
  const snap = EV.buildSnapshot({
    date: '2026-10-20',
    now: '2026-10-21T01:15:00Z',
    dates: DATES,
    dateedits: [],
    materials: MATS,
    dayedits: [],
    announcements: ANN,
  });
  assert.equal(snap.prep.date, '2026-10-21');
  assert.equal(snap.prep.title, 'BIO 201 Lab Exam: bones (Group A or B slot)');
  const push = eveningPush(
    {
      state: [{ id: 'current', snapshot: snap }],
      health: [{ id: 'current', at: '2026-10-21T01:00:00Z' }],
      sets: [],
      answers: [],
      weakspots: [],
      exams: [],
      days: [],
      dates: DATES,
      runs: [],
    },
    { date: '2026-10-20', now: '2026-10-21T01:15:00Z' },
    SPEC
  );
  assert.match(push, /^Pack \d+ for BIO 201 Lab Exam: bones/);
  // The greeting's Prep marker, at night and in the morning.
  const g = EV.greeting({
    date: '2026-10-20',
    now: '2026-10-21T01:30:00Z',
    items: [],
    reviewLeft: 0,
    nextExams: [],
    jobs: [],
    runs: {},
    prep: { today: EV.prepDay(DATES, [], '2026-10-20'), tomorrow: day },
  });
  assert.equal(g.brief.find(b => b.level === 'prep').title, 'Prep: BIO 201 Lab Exam: bones (Group A or B slot)');
});

test('B-189: the list draws on the calendar entry, the announcements and calendar rows that name the day, then the kit', () => {
  const l = EV.prepList({
    day: EV.prepDay(DATES, [], '2026-10-21'),
    phase: 'morning',
    materials: MATS,
    dates: DATES,
    announcements: ANN,
  });
  const by = Object.fromEntries(l.items.map(i => [i.text, i.cite]));
  assert.equal(by['Pencil'], 'Your calendar: BIO 201 Lab Exam: bones (Group A or B slot)', 'the entry names it first');
  assert.equal(by['Bones lab sheet'], 'Canvas announcement: Lab exam reminders, Fri 10/16');
  assert.equal(by['Student ID'], 'Canvas announcement: Week of 10/19, Mon 10/19', 'its weekday, posted that week');
  assert.equal(by['Lab manual'], 'BIO 201 Lab Calendar, p. 2', 'the course calendar row for 10/21');
  assert.equal(by['Textbook: Ch 7 and 8'], 'BIO 201 Lab Calendar, p. 2', 'the chapters that row names');
  assert.equal(by['Lab kit'], 'your lab kit');
  assert.ok(!('Calculator' in by), 'an announcement posted after the day is not its source');
  assert.ok(!l.items.some(i => /Ch 9/.test(i.text)), 'the row for another day stays out');
  assert.ok(
    l.items.every(i => i.cite),
    'every item names its source'
  );
  assert.equal(l.fromRecord, l.items.length - 1, 'all but the kit come from the record');
  assert.deepEqual(l.kitKinds, ['lab'], 'the class kit is empty, so only the lab kit is used');
  assert.equal(l.note, null);
  assert.equal(
    EV.prepReply(l, '2026-10-21', '2026-10-21'),
    'For BIO 201 Lab Exam: bones (Group A or B slot) today: 5 named in your record (each line says where), 1 from your lab kit.'
  );
});

test('B-189: the kit is his to edit, and an item the record names keeps the record as its source', () => {
  const day = EV.prepDay(DATES, [], '2026-10-20');
  const l = EV.prepList({
    day,
    phase: 'night',
    materials: [],
    dates: DATES,
    kit: { clinical: ['Stethoscope', 'Lunch', 'Pencil'] },
    announcements: [
      {
        id: 'a',
        title: 'Clinical reminder',
        postedAt: '2026-10-18T12:00:00Z',
        text: 'For clinical on 10/20 bring a pencil.',
      },
    ],
  });
  assert.deepEqual(
    l.items.map(i => [i.text, i.kit ? 'kit' : 'record']),
    [
      ['Pencil', 'record'],
      ['Stethoscope', 'kit'],
      ['Lunch', 'kit'],
    ]
  );
  const spec = SPEC.constants.prep.kit;
  assert.deepEqual(spec.clinical, [
    'Stethoscope',
    'Clinical badge',
    'Watch with a second hand',
    'Penlight',
    'Black pen',
  ]);
  assert.deepEqual(spec.lab, ['Lab kit']);
});

test('B-189: an ask for what to bring, in his words, names the day and the kind he said', () => {
  const at = '2026-10-21T12:22:59Z'; // Wed 7:22am Central
  const cases = [
    ['I have lab/class today. Make a prep list of items to bring', '2026-10-21', ['lab', 'class']],
    ['what should I bring to clinical tomorrow?', '2026-10-22', ['clinical']],
    ['What do I need for lab', '2026-10-21', ['lab']],
    ['what to bring Friday', '2026-10-23', []],
    ['what should I pack for 10/28?', '2026-10-28', []],
    ['pack list please', '2026-10-21', []],
  ];
  for (const [t, d, said] of cases) assert.deepEqual(EV.prepAsk(t, at), { date: d, said }, t);
  assert.equal(EV.prepAsk('what to bring', '2026-10-21T23:00:00Z').date, '2026-10-22', 'from 5pm on: tomorrow');
  for (const t of ['bring up the vitamin set again', 'how did I do on Exam 4?', 'explain ROME'])
    assert.equal(EV.prepAsk(t, at), null, t);
});

test('B-189: with no calendar entry, the day he named builds from the record and his kit; with neither, he is told plainly', () => {
  const day = EV.prepDaySaid(DATES, [], '2026-10-22', ['lab', 'class']);
  assert.equal(day.said, true);
  assert.equal(day.title, 'Lab day (from what you said)');
  const l = EV.prepList({ day, phase: 'morning', materials: MATS, dates: DATES, announcements: ANN });
  assert.deepEqual(
    l.items.map(i => i.text),
    ['Lab kit']
  );
  assert.equal(l.empty, true);
  assert.match(l.note, /Your lab kit is below\./);
  assert.match(
    EV.prepReply(l, '2026-10-22', '2026-10-21'),
    /tomorrow: 1 from your lab kit\. Your materials don’t name/
  );
  assert.equal(EV.prepDaySaid(DATES, [], '2026-10-28', ['class']).kind, 'lab', 'the calendar wins over his words');
  assert.equal(EV.prepDaySaid(DATES, [], '2026-10-24', []), null);
  assert.match(
    EV.prepReply(null, '2026-10-24', '2026-10-21'),
    /^Nothing on your calendar makes Sat 10\/24 a class, lab/
  );
});
