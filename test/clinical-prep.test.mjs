// B-46 (D-103): the clinical-prep brief. Its read set leaves out the graded clinical paperwork by section and title;
// the worker gets the next clinical day, the Skills Packet and lab passages with their pages, his skill weak spots and
// instructor notes; a brief that names what could be a patient is held back; the greeting offers it the day before.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EV from '../core/evcore.mjs';
import * as RUN from '../core/run.mjs';
import { readExport, loadValidator } from '../core/schemas.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
// B-315: these tests drive the ArtifactData protocol on the staging record; test/run-worker.test.mjs proves the Worker target.
delete spec.registry.records.staging.runs;
EV.configure(spec);
const validate = loadValidator();
const AT = '2026-10-21T19:34:00Z'; // Wed afternoon; the clinical is Thursday
const CLIN = '2026-10-22';

const env = (writer, source, at) => ({ schema: 1, writer, at, source });
const mat = (id, title, x = {}) => ({
  id,
  ...env('canvas-sync', 'Canvas sync', '2026-10-01T01:20:00Z'),
  course: 'NUR 112',
  kind: 'clinical',
  title,
  module: 'Clinical',
  fileType: 'pdf',
  fileId: Number(id.replace(/\D/g, '')),
  needsOcr: false,
  ...x,
});
const PACKET =
  '[p1] Nursing Skills Packet\n[p12] HEAD TO TOE ASSESSMENT * 1. Perform hand hygiene. * 2. Introduce yourself. * 3. Inspect the skin and auscultate heart sounds at the five landmarks.\n[p14] VITAL SIGNS * 1. Count the radial pulse for a full minute when irregular. * 2. Recheck a blood pressure on the other arm.\n';
const MATERIALS = [
  mat('NUR112-880001', 'Nursing Skills Packet.pdf', { kind: 'lab', text: PACKET, pages: 14, chars: PACKET.length }),
  mat('NUR112-880002', 'Lab reference sheet: normal values.pdf', {
    kind: 'lab',
    text: '[p1] Normal values: potassium 3.5 to 5.0 mEq/L; sodium 135 to 145 mEq/L.',
    pages: 1,
  }),
  mat('NUR112-880003', 'Data Prep Sheet.docx', { text: '[p1] Fill in before clinical.', pages: 1 }),
  mat('NUR112-880004', 'Week 9 forms.pdf', {
    section: 'Clinical Judgment Map',
    text: '[p1] Recognize cues, analyze cues.',
    pages: 1,
  }),
  mat('NUR112-880005', 'Drug Cards template.pdf', { text: '[p1] Drug name, class, action.', pages: 1 }),
  mat('NUR112-880006', 'Medication table.xlsx', { text: '[p1] Med, dose, route, time.', pages: 1 }),
  mat('NUR112-880007', 'Chapter 39 slides.pptx', {
    kind: 'slides',
    module: 'Exam 4 Content',
    text: '[p1] Fluids and electrolytes.',
    pages: 1,
  }),
];

test('B-46: the read set leaves out the graded clinical paperwork by section and title, and keeps the packet and lab sheets', () => {
  const { read, left } = EV.clinicalReadSet(MATERIALS, 'NUR 112');
  assert.deepEqual(read.map(m => m.id).sort(), ['NUR112-880001', 'NUR112-880002']);
  assert.deepEqual(
    Object.fromEntries(left.map(x => [x.id, x.why])),
    {
      'NUR112-880003': 'data prep sheet (title)',
      'NUR112-880004': 'judgment map (section)',
      'NUR112-880005': 'drug cards (title)',
      'NUR112-880006': 'medication table (title)',
    },
    'each by the field that names it'
  );
  assert.ok(!read.some(m => /slides/.test(m.title)), 'lecture slides are not clinical material');
  assert.equal(EV.gradedClinicalPaperwork({ title: 'Care plan worksheet' }), 'care plan (title)');
  assert.equal(EV.gradedClinicalPaperwork({ title: 'Head to toe checklist' }), null);
});

function workerDb() {
  const db = {};
  for (const { collection, id, doc } of readExport(path.join(ROOT, 'test/data/record')))
    if (collection !== 'journal') (db[collection] = db[collection] || []).push({ ...doc, id });
  db.materials = [...(db.materials || []), ...MATERIALS];
  db.dates = [
    ...(db.dates || []),
    {
      id: 'clin-2026-10-22',
      ...env('page', 'owner', '2026-10-01T12:00:00Z'),
      addedAt: '2026-10-01T12:00:00Z',
      date: CLIN,
      title: 'Clinical: Med-surg (made-up site)',
      kind: 'clinical',
      course: 'NUR 112',
      graded: false,
    },
  ];
  db.weakspots = [
    ...(db.weakspots || []),
    {
      id: 'ws-skill-vitals',
      ...env('page', 'Skills run', '2026-10-15T20:00:00Z'),
      addedAt: '2026-10-15T20:00:00Z',
      addedBy: 'Matt',
      topic: 'Irregular pulse: a full minute',
      objective: '',
      exam: null,
      course: 'NUR 112',
      kind: 'skill',
      initial: { streak: 0, nextDue: '2026-10-16', recurrence: 1, misses: 1 },
      events: {},
    },
  ];
  db.announcements = [
    ...(db.announcements || []),
    {
      id: 'ann-clin-1',
      ...env('canvas-sync', 'Canvas sync', '2026-10-20T01:20:00Z'),
      title: 'Clinical Thursday',
      text: 'Bring your stethoscope and penlight; report at 0630 in uniform.',
      course: 'NUR 112',
      postedAt: '2026-10-19T15:00:00Z',
      url: 'https://example.invalid/a/1',
    },
  ];
  db.jobs = [
    ...(db.jobs || []),
    {
      id: 'job-20261021-193000-clinical-prep',
      ...env('page', 'E.V. Home', '2026-10-21T19:30:00Z'),
      kind: 'clinical-prep',
      title: 'Clinical prep: Med-surg',
      brief: `${CLIN}: a prep brief for Clinical: Med-surg (made-up site)`,
      fired: { at: '2026-10-21T19:30:01Z', ok: true },
    },
  ];
  return db;
}
function worker(db, jobId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-clin-'));
  RUN.start({ spec, pipeline: 'worker', record: 'staging', at: AT, dir, release: 'v4.2.0', input: { job: jobId } });
  for (const c of RUN.pull({ spec, dir, at: AT })) {
    const a = c.args;
    const docs = (db[a.collection] || []).filter(d => !a.query.where || EV.toMs(d.at) >= EV.toMs(a.query.where[0][2]));
    for (const d of docs) {
      const f = path.join(a.out_dir, a.collection, d.id + '.json');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(EV.docData(d)));
    }
  }
  fs.writeFileSync(path.join(dir, 'versions.json'), '{}');
  return dir;
}
const answer = (dir, v) => {
  fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'answers', 'do-job.json'), JSON.stringify(v));
};

test('B-46: the worker gets the clinical day, the packet passages with their pages, skill weak spots and instructor notes, never the paperwork', () => {
  const db = workerDb();
  const dir = worker(db, 'job-20261021-193000-clinical-prep');
  const w = RUN.compute({ spec, dir, validate, at: AT });
  assert.equal(w.status, 'waiting', JSON.stringify(w.problems));
  const m = w.question.material;
  assert.equal(m.job.kind, 'clinical-prep');
  assert.match(m.guide, /Never fill in, draft, outline or summarize graded clinical paperwork/);
  assert.match(m.guide, /Never ask for, guess at or write anything about a patient/);
  const c = m.context;
  assert.deepEqual(c.day, {
    date: CLIN,
    title: 'Clinical: Med-surg (made-up site)',
    course: 'NUR 112',
    subject: 'Med-surg',
  });
  assert.ok(
    c.passages.some(p => p.ref === 'materials/NUR112-880001' && [12, 14].includes(p.page)),
    JSON.stringify(c.passages.map(p => [p.ref, p.page]))
  );
  const banned = ['NUR112-880003', 'NUR112-880004', 'NUR112-880005', 'NUR112-880006'];
  assert.ok(!c.passages.some(p => banned.includes(p.ref.replace('materials/', ''))), 'no paperwork passage');
  assert.deepEqual(c.skillWeakSpots, [{ weakspotId: 'ws-skill-vitals', topic: 'Irregular pulse: a full minute' }]);
  assert.deepEqual(
    c.instructorNotes.map(n => n.title),
    ['Clinical Thursday']
  );
  assert.equal(c.notRead.length, 4);
  // The brief posts as the job's message.
  answer(dir, {
    text: 'Thursday, Med-surg. Review head to toe (SKILLS PACKET, p. 12) and vital signs, a full minute for an irregular pulse (SKILLS PACKET, p. 14). Bring the stethoscope and penlight; 0630 in uniform (instructor note).',
  });
  const r = RUN.compute({ spec, dir, validate, at: AT });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems));
  const res = JSON.parse(
    fs.readFileSync(r.plan.batches.flat().find(x => x.collection === 'jobresults').file_path, 'utf8')
  );
  assert.equal(res.status, 'done');
  assert.match(res.result.text, /SKILLS PACKET, p\. 12/);
});

test('B-46 (B-04), B-197, B-163: a brief that names what could be a real patient holds it back for Matt', () => {
  const db = workerDb();
  const dir = worker(db, 'job-20261021-193000-clinical-prep');
  RUN.compute({ spec, dir, validate, at: AT });
  answer(dir, { text: 'Your patient in room 412 is on a cardiac diet; review vitals (SKILLS PACKET, p. 14).' });
  const r = RUN.compute({ spec, dir, validate, at: AT });
  assert.equal(r.status, 'planned', JSON.stringify(r.problems || r.step));
  const files = r.plan.batches.flat();
  const written = files.map(f => fs.readFileSync(f.file_path, 'utf8')).join('\n');
  assert.ok(!/room 412/.test(written), 'the value is held back from every write');
  assert.match(written, /\[left out\]/);
  const held = JSON.parse(fs.readFileSync(files.find(f => f.collection === 'idchecks').file_path, 'utf8'));
  assert.deepEqual([held.by, held.verdict], ['held', 'unsure']);
  assert.match(held.kind, /room number/);
});

test('B-46: the greeting offers the brief the day before a clinical day, once, and never after one was asked for', () => {
  const db = workerDb();
  const dates = db.dates;
  assert.deepEqual(EV.clinicalPrepOffer({ dates, dateedits: [], jobs: [], date: '2026-10-21' }), {
    date: CLIN,
    title: 'Clinical: Med-surg (made-up site)',
  });
  assert.equal(EV.clinicalPrepOffer({ dates, dateedits: [], jobs: db.jobs, date: '2026-10-21' }), null);
  assert.equal(EV.clinicalPrepOffer({ dates, dateedits: [], jobs: [], date: '2026-10-20' }), null, 'two days out');
  const g = EV.greeting({
    now: AT,
    date: '2026-10-21',
    items: [],
    clinicalOffer: EV.clinicalPrepOffer({ dates, dateedits: [], jobs: [], date: '2026-10-21' }),
  });
  const item = g.brief.find(b => b.kind === 'clinical-prep');
  assert.ok(item, JSON.stringify(g.brief));
  assert.equal(item.date, CLIN);
  assert.deepEqual(item.action, { label: 'Brief me', chip: 'Brief me for clinical' });
  assert.match(item.detail, /Never your graded paperwork/);
  assert.notEqual(item.level, 'urgent', 'a clinical day is never urgent (D-143)');
});
