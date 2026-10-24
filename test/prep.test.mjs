// B-104 (D-143, D-144): prep checks in E.V. core. Clinical, lab, validation and class days are never urgent; each gets
// a Prep marker and a tickable check built for that day from that day's own materials, every item citing its file and
// page. Made-up materials and calendar entries throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';
import { makeValidator } from '../core/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemas = Object.fromEntries(
  fs
    .readdirSync(path.join(ROOT, 'spec/schemas'))
    .map(f => [f.replace('.schema.json', ''), JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/schemas', f), 'utf8'))])
);
const validate = makeValidator(schemas);
EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));

const env = { schema: 1, writer: 'page', at: '2026-10-19T12:00:00Z', source: 'test' };
const date = (id, d, title, kind, x = {}) => ({
  id,
  ...env,
  addedAt: env.at,
  date: d,
  title,
  kind,
  course: 'NUR 112',
  graded: false,
  ...x,
});
// Three planted days, each with its own materials: a validation (head-to-toe), a lab (catheter insertion), a clinical.
const DATES = [
  date('v1', '2026-10-21', 'Validation: Head-to-toe assessment', 'validation', { graded: true }),
  date('l1', '2026-10-22', 'Lab: Urinary catheter insertion', 'other'),
  date('c1', '2026-10-23', 'Clinical: Mercy Hospital 4 West', 'clinical'),
  date('c2', '2026-10-30', 'Clinical: Mercy Hospital 4 West', 'clinical'),
  date('k1', '2026-10-26', 'Class: Unit 5 fluids lecture', 'other'),
  date('d1', '2026-10-21', 'Care plan 3 due 11:59pm', 'due', { graded: true }),
];
const MATS = [
  {
    id: 'NUR112-801',
    title: 'Skills Validation Guide.pdf',
    course: 'NUR 112',
    kind: 'lab',
    text: '[p3] Head-to-toe assessment validation. Bring with you: stethoscope, penlight, a watch with a second hand and your skills packet. Arrive 10 minutes early.\n[p4] Medication administration validation. Bring: drug cards and your MAR worksheet.',
  },
  {
    id: 'NUR112-802',
    title: 'Lab 6 Catheter Insertion.pptx',
    course: 'NUR 112',
    kind: 'lab',
    text: '[s2] Urinary catheter insertion lab. Supplies needed: sterile gloves, catheter kit, a practice manikin pass. [s3] Catheter insertion steps: open the kit away from you.',
  },
  {
    id: 'NUR112-803',
    title: 'Clinical Orientation Mercy.pdf',
    course: 'NUR 112',
    kind: 'clinical',
    text: '[p2] Mercy Hospital clinical: what to bring: clinical badge, black pen, bandage shears, Jarvis handbook, drug handbook, completed drug cards. Bring your clinical folder with the facility paperwork (the Mercy assessment form). [p5] Parking at Mercy is in lot C.',
  },
  {
    id: 'NUR112-804',
    title: 'NUR 112 Syllabus.pdf',
    course: 'NUR 112',
    kind: 'course',
    text: '[p9] Clinical expectations: a stethoscope and a notebook at every clinical.',
  },
];
const day = d => EV.prepDay(DATES, [], d);

test('prepKindOf: validations and clinicals by kind, labs and classes by name; graded work due is not a prep day', () => {
  assert.deepEqual(DATES.map(EV.prepKindOf), ['validation', 'lab', 'clinical', 'clinical', 'class', null]);
  assert.equal(EV.prepKindOf(date('x', '2026-10-21', 'Lab quiz due', 'due', { graded: true })), null);
  // B-189: an exam is sat somewhere: a lab exam or practical makes a lab day, any other exam a class day.
  assert.equal(EV.prepKindOf(date('x', '2026-10-21', 'NUR Exam 4', 'exam')), 'class');
  assert.equal(EV.prepKindOf(date('x', '2026-10-21', 'BIO 201 Lab Exam: bones (Group A or B slot)', 'exam')), 'lab');
  assert.equal(EV.prepKindOf(date('x', '2026-10-21', 'Skills practical', 'exam')), 'lab');
  assert.equal(day('2026-10-21').kind, 'validation', 'a validation outranks the graded due item on the same day');
  assert.equal(day('2026-10-21').subject, 'Head-to-toe assessment', 'a validation names its skill');
  assert.equal(day('2026-10-24'), null);
});

test('three planted days with their own materials yield three different lists, each item citing its file and page', () => {
  const lists = ['2026-10-21', '2026-10-22', '2026-10-23'].map(d =>
    EV.prepList({ day: day(d), phase: 'night', materials: MATS, dates: DATES })
  );
  // B-189: the kit (spec.constants.prep.kit) completes each list after the materials; the materials' items lead.
  const texts = lists.map(l => l.items.filter(i => !i.kit).map(i => i.text));
  assert.deepEqual(
    lists.map(l => l.items.filter(i => i.kit).map(i => i.text)),
    [['Black pen'], ['Lab kit'], ['Watch with a second hand', 'Penlight']],
    'only the kit items the materials did not already name, each after them'
  );
  for (const l of lists) assert.ok(l.items.filter(i => i.kit).every(i => /^your \w+ kit$/.test(i.cite)));
  assert.deepEqual(texts[0], ['Stethoscope', 'Penlight', 'Watch with a second hand', 'Skills packet']);
  assert.deepEqual(texts[1], ['Sterile gloves', 'Catheter kit', 'Practice manikin pass']);
  assert.ok(
    [
      'Clinical badge',
      'Black pen',
      'Bandage shears',
      'Jarvis handbook',
      'Drug handbook',
      'Completed drug cards',
      'Clinical folder with your paperwork',
      'Stethoscope',
      'Notebook',
    ].every(t => texts[2].includes(t)),
    texts[2].join(', ')
  );
  assert.notDeepEqual(texts[0], texts[1]);
  assert.notDeepEqual(texts[1], texts[2]);
  assert.notDeepEqual(texts[0], texts[2]);
  for (const l of lists) {
    assert.equal(l.empty, false);
    assert.equal(l.note, null);
    for (const it of l.items.filter(i => !i.kit))
      assert.match(it.cite, /, (p|slide)\. ?\d+$|, slide \d+$/, it.text + ' cites its file and page');
  }
  assert.equal(lists[0].items[0].cite, 'Skills Validation Guide, p. 3');
  assert.equal(lists[1].items[0].cite, 'Lab 6 Catheter Insertion, slide 2');
  assert.equal(
    lists[2].items.find(i => i.text === 'Notebook').cite,
    'NUR 112 Syllabus, p. 9',
    'the syllabus counts as that day’s material'
  );
  assert.ok(
    !texts[0].includes('Completed drug cards'),
    'the medication validation’s page is not the head-to-toe day’s'
  );
});

test('paperwork is listed to bring, never filled in', () => {
  const l = EV.prepList({ day: day('2026-10-23'), phase: 'night', materials: MATS, dates: DATES });
  const pw = l.items.filter(i => i.paperwork).map(i => i.text);
  assert.ok(pw.includes('Clinical folder with your paperwork'), pw.join(', '));
  for (const it of l.items)
    assert.deepEqual(
      Object.keys(it).filter(k => /fill|draft|answer|write/i.test(k)),
      [],
      'an item carries nothing to fill in'
    );
});

test('a day with no materials says so plainly instead of a short list', () => {
  const l = EV.prepList({ day: day('2026-10-26'), phase: 'morning', materials: MATS, dates: DATES });
  assert.equal(l.empty, true);
  assert.deepEqual(l.items, []);
  assert.equal(
    l.note,
    'Nothing in your materials says what to bring for Class: Unit 5 fluids lecture. Add what you know and I’ll keep it for next time.'
  );
  assert.equal(l.done, false, 'an empty check is never shown as done');
  const v = EV.prepList({ day: day('2026-10-21'), phase: 'night', materials: [], dates: DATES });
  assert.match(v.note, /^Nothing in your materials says what to bring for the Head-to-toe assessment validation\./);
});

test('an item added by hand on one clinical day comes back on the next clinical day as you usually bring', () => {
  const now = '2026-10-22T23:00:00Z';
  const r = EV.prepEdit(null, { action: 'add', text: 'Lunch and a water bottle' }, { now, date: '2026-10-23' });
  assert.equal(r.doc.added[r.id].tag, 'PREP');
  assert.deepEqual(validate('dayedits', r.doc).errors, [], 'the dayedits document stays valid at its schema');
  const dayedits = [{ id: '2026-10-23', ...r.doc }];
  const first = EV.prepList({ day: day('2026-10-23'), phase: 'night', materials: MATS, dates: DATES, dayedits });
  assert.ok(first.items.some(i => i.added && i.text === 'Lunch and a water bottle'));
  const next = EV.prepList({ day: day('2026-10-30'), phase: 'night', materials: MATS, dates: DATES, dayedits });
  const back = next.items.find(i => i.text === 'Lunch and a water bottle');
  assert.ok(back && back.usual && !back.added, 'it comes back as you usually bring');
  const lab = EV.prepList({ day: day('2026-10-22'), phase: 'night', materials: MATS, dates: DATES, dayedits });
  assert.ok(!lab.items.some(i => i.text === 'Lunch and a water bottle'), 'only on days of the same kind');
  // It stays off the day's own list.
  assert.ok(!EV.dayView({ list: { items: [] } }, dayedits[0]).items.some(i => /Lunch/.test(i.text)));
});

test('ticks: night and morning are two checks on the day; ticked through, the check is done', () => {
  const l0 = EV.prepList({ day: day('2026-10-21'), phase: 'night', materials: MATS, dates: DATES });
  let doc = null;
  const now = '2026-10-21T01:00:00Z';
  for (const it of l0.items)
    doc = EV.prepEdit(
      doc && { id: '2026-10-21', ...doc },
      { action: 'check', id: it.id, phase: 'night' },
      { now, date: '2026-10-21' }
    ).doc;
  assert.deepEqual(validate('dayedits', doc).errors, []);
  const night = EV.prepList({
    day: day('2026-10-21'),
    phase: 'night',
    materials: MATS,
    dates: DATES,
    dayedits: [{ id: '2026-10-21', ...doc }],
  });
  assert.equal(night.done, true);
  const morning = EV.prepList({
    day: day('2026-10-21'),
    phase: 'morning',
    materials: MATS,
    dates: DATES,
    dayedits: [{ id: '2026-10-21', ...doc }],
  });
  assert.equal(morning.done, false, 'the morning bag check is its own');
  const un = EV.prepEdit(
    { id: '2026-10-21', ...doc },
    { action: 'check', id: l0.items[0].id, phase: 'night', done: false },
    { now, date: '2026-10-21' }
  ).doc;
  assert.equal(
    EV.prepList({
      day: day('2026-10-21'),
      phase: 'night',
      materials: MATS,
      dates: DATES,
      dayedits: [{ id: '2026-10-21', ...un }],
    }).done,
    false
  );
});

const base = { date: '2026-10-20', items: [], reviewLeft: 0, nextExams: [], jobs: [], runs: {} };
const prep = d => ({ today: day(d.today) || null, tomorrow: day(d.tomorrow) || null });
test('the greeting never marks a clinical, lab, validation or class day urgent; it gets the Prep marker', () => {
  for (const [d, next] of [
    ['2026-10-21', '2026-10-22'],
    ['2026-10-22', '2026-10-23'],
    ['2026-10-23', '2026-10-24'],
    ['2026-10-26', '2026-10-27'],
  ]) {
    const todayDates = DATES.filter(x => x.date === d && x.kind !== 'due').map(x => ({
      title: x.title,
      graded: !!x.graded,
      kind: x.kind,
    }));
    const items = [
      {
        id: 'date-' + d,
        text: DATES.find(x => x.date === d).title,
        tag: DATES.find(x => x.date === d).kind === 'validation' ? 'VALIDATION' : null,
      },
    ];
    const g = EV.greeting({
      ...base,
      date: d,
      now: d + 'T12:30:00Z',
      items,
      todayDates,
      prep: prep({ today: d, tomorrow: next }),
    }); // 7:30am Central
    assert.equal(g.brief.filter(b => b.level === 'urgent').length, 0, d + ': nothing urgent');
    assert.doesNotMatch(g.headline, /validation|lab|clinical|class/i, d + ': the headline names nothing that can wait');
    const p = g.brief.find(b => b.level === 'prep');
    assert.ok(p && p.kind === 'prep' && p.when === 'today', d + ': the Prep marker');
    assert.equal(g.prep.phase, 'morning');
    assert.equal(g.prep.date, d);
    assert.notEqual(g.mood, 'alert');
  }
  // The night before: the pack check is for tomorrow.
  const eve = EV.greeting({
    ...base,
    date: '2026-10-20',
    now: '2026-10-21T00:30:00Z',
    tomorrow: { dates: [{ title: 'Validation: Head-to-toe assessment', kind: 'validation', graded: true }] },
    prep: prep({ today: '2026-10-20', tomorrow: '2026-10-21' }),
  });
  assert.deepEqual([eve.prep.phase, eve.prep.date], ['night', '2026-10-21']);
  assert.equal(eve.brief.find(b => b.level === 'prep').title, 'Prep: Validation: Head-to-toe assessment');
  assert.equal(eve.brief.filter(b => b.level === 'urgent').length, 0);
  assert.equal(
    eve.brief.filter(b => /Head-to-toe/.test(b.title)).length,
    1,
    'the graded validation is the Prep marker alone, not a second line'
  );
  // Urgent stays for one-time deadlines: graded work due today still is.
  const due = EV.greeting({
    ...base,
    date: '2026-10-21',
    now: '2026-10-21T14:00:00Z',
    todayDates: [
      { title: 'Care plan 3 due 11:59pm', graded: true, kind: 'due' },
      { title: 'Validation: Head-to-toe assessment', graded: true, kind: 'validation' },
    ],
    prep: prep({ today: '2026-10-21' }),
  });
  assert.deepEqual(
    due.brief.filter(b => b.level === 'urgent').map(b => b.title),
    ['Care plan 3 due 11:59pm']
  );
  assert.ok(
    due.brief.findIndex(b => b.level === 'prep') > due.brief.findIndex(b => b.level === 'urgent'),
    'urgent first, then the calm Prep marker'
  );
});

// B-107: the evening run's part. The state step's snapshot carries tomorrow's prep check, built as the page builds
// it; the 8:15pm push carries its pack-check line.
import { eveningPush } from '../core/steps.mjs';
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const snapFor = (date, materials) =>
  EV.buildSnapshot({ date, now: date + 'T01:15:00Z', dates: DATES, dateedits: [], materials, dayedits: [] });
test('the evening snapshot carries tomorrow’s prep check, each item cited; none when tomorrow needs no prep', () => {
  for (const [d, kind, first, cite] of [
    ['2026-10-20', 'validation', 'Stethoscope', 'Skills Validation Guide, p. 3'],
    ['2026-10-21', 'lab', 'Sterile gloves', 'Lab 6 Catheter Insertion, slide 2'],
    ['2026-10-22', 'clinical', null, 'Clinical Orientation Mercy, p. 2'],
  ]) {
    const p = snapFor(d, MATS).prep;
    assert.equal(p.date, EV.addDays(d, 1));
    assert.equal(p.kind, kind);
    assert.equal(p.empty, false);
    if (first) assert.equal(p.items[0].text, first);
    assert.ok(
      p.items.every(i => /, (p\.|slide) \d+$/.test(i.cite) || /^your \w+ kit$/.test(i.cite)),
      JSON.stringify(p.items)
    );
    assert.ok(p.items.some(i => i.cite === cite));
  }
  const none = snapFor('2026-10-25', MATS).prep;
  assert.equal(none.kind, 'class');
  assert.equal(none.empty, true);
  assert.match(none.note, /^Nothing in your materials says what to bring for Class: Unit 5 fluids lecture\./);
  assert.equal(snapFor('2026-10-23', MATS).prep, null, 'a day after which nothing needs prep');
  assert.ok(
    !('prep' in EV.buildSnapshot({ date: '2026-10-20', now: '2026-10-21T01:15:00Z', dates: DATES })),
    'no materials passed, no prep field'
  );
});
test('the 8:15pm push carries the pack-check line, first after a stale health warning', () => {
  const push = (d, materials) =>
    eveningPush(
      {
        state: [{ id: 'current', snapshot: snapFor(d, materials) }],
        health: [{ id: 'current', at: d + 'T01:00:00Z' }],
        sets: [],
        answers: [],
        weakspots: [],
        exams: [],
        days: [],
        dates: DATES,
        runs: [],
      },
      { date: d, now: d + 'T01:15:00Z' },
      SPEC
    );
  assert.match(
    push('2026-10-20', MATS),
    /^Pack 5 for Validation: Head-to-toe assessment/,
    'four named, one from the kit'
  );
  assert.match(push('2026-10-21', MATS), /^Pack 4 for Lab: Urinary catheter insertion/, 'three named, the lab kit');
  assert.match(push('2026-10-25', MATS), /^Prep: nothing in your materials for Class: Unit 5 fluids lecture/);
  for (const d of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-25'])
    assert.ok(push(d, MATS).length <= SPEC.constants.push.maxChars);
  assert.doesNotMatch(push('2026-10-23', MATS), /Pack|Prep/);
});
test('a table of contents is never read as a bring list (a dash there is a page range)', () => {
  const toc = {
    id: 'NUR112-899',
    title: 'Practice Skills Packet.pdf',
    course: 'NUR 112',
    kind: 'lab',
    text: '[p2] SKILLS CHECKLIST TABLE OF CONTENTS Handwashing 5 Donning and Removing Personal Protective Equipment (PPE) 7 Vital Signs 8 - 9 Head to Toe Assessment 12 Donning and Removing Sterile Gloves 15 - 16 Medication Administration Preparing Oral, Intramuscular 20-24',
  };
  assert.deepEqual(EV.prepBringItems(toc.text), []);
  const day = EV.prepDay([date('v9', '2026-10-27', 'Validation: Sterile gloves', 'validation')], [], '2026-10-27');
  const l = EV.prepList({ day, phase: 'night', materials: [toc] });
  assert.equal(l.empty, true, JSON.stringify(l.items));
  assert.deepEqual(
    EV.prepBringItems('Equipment: Vital Signs 8 - 9 Range of Motion 10 - 11'),
    [],
    'bare "equipment" opens no list'
  );
});
