// B-42 (D-099): courses are data. spec.courses holds every course rule; core names no course; the morning, search,
// the Canvas sync, lint and the build read the table.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import { courseProblems, unknownCourses, lintRecord } from '../core/lint.mjs';
import { examTomorrow } from '../core/derive.mjs';
import { scriptParams } from '../core/canvas.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { ROOT, flatSource, flatText } from './helpers.mjs';
import { appSource } from '../tools/build.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const clone = x => JSON.parse(JSON.stringify(x));
const with_ = (edit, fn) => {
  const s = clone(spec);
  edit(s);
  EV.configure(s);
  try {
    return fn(s);
  } finally {
    EV.configure(spec);
  }
};

test('B-42: spec.courses holds NUR 112 and BIO 201 as Matt set them, and the keys it replaced are gone', () => {
  const N = spec.courses['NUR 112'],
    B = spec.courses['BIO 201'];
  assert.equal(N.canvasId, 199214);
  assert.equal(B.canvasId, 199416);
  assert.deepEqual([N.status, B.status], ['active', 'active']);
  assert.deepEqual(N.examKinds, ['unit', 'dosage', 'final', 'ati']);
  assert.deepEqual(B.examKinds, ['unit', 'lab', 'final']);
  assert.deepEqual(N.reviewKinds, ['unit', 'final', 'dosage'], "today's nurUnitExamKinds");
  assert.deepEqual(N.examDayKinds, ['unit', 'final', 'dosage', 'ati'], "today's isNurExamDay");
  assert.deepEqual(B.reviewKinds, ['unit', 'lab', 'final'], 'a lab practical gets review like a lecture exam');
  assert.deepEqual(B.examDayKinds, ['unit', 'lab', 'final']);
  assert.deepEqual([N.dayBudget, B.dayBudget], ['shared', 'shared'], 'BIO review shares the day budget');
  assert.equal(N.library.length, 4);
  assert.equal(B.library.length, 3, 'Unit N or Chapter N slides, Lab Material, Start Here syllabus only');
  assert.equal(spec.registry.canvas.courses, undefined);
  assert.equal(spec.registry.canvas.library.modules, undefined);
  assert.equal(spec.constants.nurUnitExamKinds, undefined);
  assert.deepEqual(courseProblems(spec), []);
  assert.equal(EV.defaultCourse(), 'NUR 112');
  assert.deepEqual(EV.courses(), ['NUR 112', 'BIO 201']);
});

test('B-42: courseProblems names a broken table and a key that came back', () => {
  const broken = clone(spec);
  delete broken.courses['NUR 112'].default;
  broken.courses['BIO 201'].reviewKinds.push('quiz');
  broken.constants.nurUnitExamKinds = ['unit'];
  const p = courseProblems(broken);
  assert.ok(
    p.some(x => /exactly one default/.test(x)) &&
      p.some(x => /BIO 201: reviewKinds/.test(x)) &&
      p.some(x => /nurUnitExamKinds moved/.test(x)),
    p.join(' | ')
  );
});

// A course name in code, however it is spaced or cased.
const literal = s =>
  Object.keys(spec.courses)
    .filter(k => !k.startsWith('_'))
    .map(n => new RegExp(n.replace(/\s+/g, '\\s*'), 'i'))
    .some(re => re.test(s));
test('B-42: core names no course: no core file carries a course name', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'core')).filter(f => f.endsWith('.mjs'))) {
    const lines = fs
      .readFileSync(path.join(ROOT, 'core', f), 'utf8')
      .split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => literal(l));
    assert.deepEqual(
      lines.map(([n]) => `core/${f}:${n}`),
      [],
      'a course literal in core'
    );
  }
  assert.ok(
    literal("  if ((e.course || 'NUR 112') === 'NUR 112') return 'exam';") && literal('bio201 lab'),
    'the check sees a planted one'
  );
});

const E4 = { id: 'E4', course: 'NUR 112', kind: 'unit', date: '2026-10-21', title: 'Exam 4' };
const BIO_E3 = { id: 'BIO-E3', course: 'BIO 201', kind: 'unit', date: '2026-10-28', title: 'BIO 201 Lecture Exam 3' };
const BIO_LAB = {
  id: 'BIO-LAB-BONES',
  course: 'BIO 201',
  kind: 'lab',
  date: '2026-10-30',
  title: 'BIO 201 Lab Practical: Bones',
};
const ATI = { id: 'ATI-1', course: 'NUR 112', kind: 'ati', date: '2026-10-23', title: 'ATI Fundamentals' };

test('B-42: BIO 201 exams reach nextExams and the review load; an ATI does not; a done course leaves', () => {
  const exams = [BIO_LAB, ATI, BIO_E3, E4];
  assert.deepEqual(
    EV.nextExams(exams, '2026-10-20').map(e => e.id),
    ['E4', 'BIO-E3', 'BIO-LAB-BONES']
  );
  assert.deepEqual(
    EV.nextExams(exams, '2026-10-21').map(e => e.id),
    ['BIO-E3', 'BIO-LAB-BONES'],
    'after Exam 4 the next exam is BIO 201'
  );
  const ws = [1, 2, 3].map(i => ({
    id: 'b' + i,
    exam: 'BIO-E3',
    kind: 'concept',
    derived: { status: 'open', nextDue: '2026-10-25', streak: 0 },
  }));
  const L = EV.reviewLoad({ date: '2026-10-25', dayType: 'off', exams, weakspots: ws });
  assert.equal(L.flex && L.flex.exam, 'BIO-E3', 'BIO 201 Lecture Exam 3 sets the flex three days out');
  with_(
    s => {
      s.courses['BIO 201'].status = 'done';
    },
    () =>
      assert.deepEqual(
        EV.nextExams(exams, '2026-10-20').map(e => e.id),
        ['E4']
      )
  );
});

test('B-42: an exam day by its course: a BIO lecture exam and a lab practical are exam days', () => {
  assert.equal(EV.dayType({ date: '2026-10-28', dates: [], exams: [BIO_E3] }), 'exam');
  assert.equal(EV.dayType({ date: '2026-10-30', dates: [], exams: [BIO_LAB] }), 'exam');
  assert.equal(EV.isExamDay(ATI, '2026-10-23'), true);
  with_(
    s => {
      s.courses['BIO 201'].examDayKinds = ['final'];
    },
    () => assert.equal(EV.dayType({ date: '2026-10-28', dates: [], exams: [BIO_E3] }), 'class', 'the table decides')
  );
});

test('B-42: exams of both courses on one day split the due weak spots by how many each has due; otherwise the nearest exam first', () => {
  const day = '2026-11-04',
    nur = { ...E4, date: day },
    bio = { ...BIO_E3, date: day };
  const w = (id, exam) => ({
    id,
    exam,
    kind: 'concept',
    addedAt: id,
    derived: { status: 'open', nextDue: '2026-11-01', recurrence: 1, misses: 1 },
  });
  const ws = [w('n1', 'E4'), w('n2', 'E4'), w('n3', 'E4'), w('n4', 'E4'), w('b1', 'BIO-E3'), w('b2', 'BIO-E3')];
  const order = EV.rankDue(ws, '2026-11-02', [nur, bio]).map(x => x.id);
  assert.deepEqual(
    order
      .slice(0, 3)
      .map(x => x[0])
      .sort(),
    ['b', 'n', 'n'],
    'the first three: two of four NUR, one of two BIO'
  );
  assert.deepEqual(
    order
      .slice(0, 6)
      .map(x => x[0])
      .sort(),
    ['b', 'b', 'n', 'n', 'n', 'n']
  );
  assert.deepEqual(
    order.filter(x => x[0] === 'n'),
    ['n1', 'n2', 'n3', 'n4'],
    'each course keeps its own order'
  );
  const apart = EV.rankDue(ws, '2026-11-02', [nur, { ...bio, date: '2026-11-09' }]).map(x => x.id);
  assert.deepEqual(apart, ['n1', 'n2', 'n3', 'n4', 'b1', 'b2'], 'a nearer exam goes first');
  const nurOnly = ws.filter(x => x.id[0] === 'n');
  assert.deepEqual(
    EV.rankDue(nurOnly, '2026-11-02', [nur, bio]).map(x => x.id),
    ['n1', 'n2', 'n3', 'n4'],
    'one course on a day: as before'
  );
});

test('B-42: predictions and the score card stay NUR 112 unit, final and dosage exams (scoredKinds)', () => {
  assert.equal(examTomorrow({ exams: [E4] }, '2026-10-20').id, 'E4');
  assert.equal(examTomorrow({ exams: [{ ...BIO_E3, date: '2026-10-21' }] }, '2026-10-20'), null);
  assert.equal(examTomorrow({ exams: [{ ...ATI, date: '2026-10-21' }] }, '2026-10-20'), null);
});

test('B-42: search and the morning passages default to the active courses; naming a done course brings it back', () => {
  const mats = [
    {
      id: 'NUR112-1',
      course: 'NUR 112',
      title: 'Ch 39 Fluids.pdf',
      kind: 'slides',
      text: 'fluid volume deficit and dehydration in older adults',
    },
    {
      id: 'BIO201-1',
      course: 'BIO 201',
      title: 'Unit 3 Bones.pdf',
      kind: 'slides',
      text: 'fluid in the bones: synovial fluid volume and joints',
    },
    { id: 'up-1', course: null, title: 'my notes.txt', kind: 'notes', text: 'fluid volume notes' },
  ];
  const idx = () => EV.libraryIndex(EV.libraryChunks(mats));
  assert.deepEqual(
    EV.searchLibrary(idx(), 'fluid volume')
      .map(h => h.id)
      .sort(),
    ['BIO201-1', 'NUR112-1', 'up-1']
  );
  with_(
    s => {
      s.courses['BIO 201'].status = 'done';
    },
    () => {
      assert.deepEqual(
        EV.searchLibrary(idx(), 'fluid volume')
          .map(h => h.id)
          .sort(),
        ['NUR112-1', 'up-1'],
        'a done course leaves search'
      );
      assert.deepEqual(
        EV.searchLibrary(idx(), 'fluid volume', { course: 'BIO 201' }).map(h => h.id),
        ['BIO201-1'],
        'and comes back when he names it'
      );
    }
  );
});

test('B-42: course names as the record writes them, guesses for an attached file and defaults come from the table', () => {
  assert.equal(EV.normCourse('nur112'), 'NUR 112');
  assert.equal(EV.normCourse('Bio 201'), 'BIO 201');
  assert.equal(EV.normCourse('CHEM 101'), 'CHEM 101');
  assert.equal(EV.courseOf({}), 'NUR 112');
  assert.equal(EV.courseOf({ course: 'bio201' }), 'BIO 201');
  assert.equal(EV.guessCourse('Unit 3 the skeletal system: bones and joints'), 'BIO 201');
  assert.equal(EV.guessCourse('Ch 39 fluids and electrolytes'), 'NUR 112');
  assert.equal(
    EV.materialFromUpload(
      { title: 'Histology lab.pdf', text: 'epithelial and connective tissues under the microscope' },
      { now: '2026-10-20T12:00:00Z' }
    ).data.course,
    'BIO 201'
  );
  assert.equal(
    EV.materialFromUpload(
      { title: 'notes.txt', text: 'anything at all written in a plain note', course: 'BIO 201' },
      { now: '2026-10-20T12:00:00Z' }
    ).data.course,
    'BIO 201'
  );
  with_(
    s => {
      s.courses['CHEM 101'] = { ...clone(s.courses['BIO 201']), canvasId: 1, guess: 'titration' };
    },
    () =>
      assert.equal(
        EV.guessCourse('acid base titration'),
        'CHEM 101',
        'a course added to the table is guessed with no code change'
      )
  );
});

test('B-42: lint and the build check exams.course and materials.course against spec.courses', () => {
  const db = {
    exams: [
      E4,
      { ...BIO_E3, course: 'bio 201' },
      { id: 'X', course: 'CHEM 101', kind: 'unit', date: '2026-11-01', title: 'X' },
    ],
    materials: [
      { id: 'm1', course: 'NUR 112' },
      { id: 'm2', course: 'PSY 101' },
      { id: 'm3', course: null },
    ],
  };
  assert.deepEqual(unknownCourses(db), [
    { ref: 'exams/X', course: 'CHEM 101' },
    { ref: 'materials/m2', course: 'PSY 101' },
  ]);
  const r = lintRecord(
    {
      exams: [
        {
          id: 'X',
          schema: 2,
          writer: 'canvas-sync',
          at: '2026-10-20T00:00:00Z',
          source: 'x',
          course: 'CHEM 101',
          kind: 'unit',
          date: '2026-11-01',
          title: 'X',
        },
      ],
    },
    spec,
    loadValidator(),
    { date: '2026-10-20' }
  );
  assert.ok(
    r.issues.some(i => i.code === 'unknown-course' && i.severity === 'error' && i.ref === 'exams/X'),
    JSON.stringify(r.issues.map(i => i.code))
  );
  const build = fs.readFileSync(path.join(ROOT, 'tools/build.mjs'), 'utf8');
  assert.match(build, /courseProblems\(spec\)/);
  assert.match(build, /unknownCourses\(db\)/);
});

test('B-42: the Canvas sync takes its course ids and module rules from spec.courses', () => {
  const files = scriptParams('files', { spec, db: {} });
  assert.deepEqual(files.courses, { 'NUR 112': 199214, 'BIO 201': 199416 });
  assert.equal(files.rules.modules.length, 7);
  assert.ok(files.rules.modules.every(m => ['NUR 112', 'BIO 201'].includes(m.course) && m.module && m.kind));
  assert.equal(files.rules.skipSections, spec.registry.canvas.library.skipSections);
  const picked = EV.libraryPick(
    'BIO 201',
    [
      { name: 'Unit 3: Bones', items: [{ type: 'File', content_id: 1, title: 'Bones.pdf' }] },
      {
        name: 'Start Here',
        items: [
          { type: 'File', content_id: 2, title: 'Syllabus.pdf' },
          { type: 'File', content_id: 3, title: 'Policy.pdf' },
        ],
      },
    ],
    files.rules
  );
  assert.deepEqual(
    picked.map(f => [f.fileId, f.kind]),
    [
      [1, 'slides'],
      [2, 'course'],
    ]
  );
  assert.deepEqual(scriptParams('dates', { spec, db: {} }).courses, files.courses);
});

test('B-42: the page reads the table: the course select and the course words come from spec.courses', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'page/index.src.html'), 'utf8'),
    app = flatText(appSource(ROOT));
  assert.match(shell, /<select id="d-course" aria-label="Course"><\/select>/, 'no course in the shell');
  assert.match(app, /\$\('d-course'\)\.replaceChildren\(\.\.\.E\.activeCourses\(\)/);
  assert.doesNotMatch(app, /nextNurExams|nurUnitExamKinds|enum: \['NUR 112', 'BIO 201'\]/);
});
