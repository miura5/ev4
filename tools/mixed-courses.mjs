#!/usr/bin/env node
// B-498: a read-only listing of what sits under the wrong course in a record, for the build manager to show Matt (the
// fix keeps new work in its own course; nothing already in the record is changed or removed, B-11):
//   - a study plan's tasks that are another course's work (EVCore.planTaskCourse: the dated item, exam, objective,
//     material or note a task's ref names, else the one course its words name), plan by plan, put-away plans skipped;
//   - weak spots filed under a course other than their own (EVCore.spotCourse: the objective's exam's course, else the
//     exam's), which the page now shows under their own course.
//   node tools/mixed-courses.mjs <record dir>             a record saved as <dir>/<collection>/<id>.json (ArtifactData's
//                                                         out_dir, or core/runapi-client.mjs list)
//   node tools/mixed-courses.mjs --worker <system/worker>  reads the app's record through the run API (the token goes
//                                                         to curl on stdin, core/runapi-client.mjs), into a temp dir
// It writes nothing anywhere but its temp dir, and prints ids, dates, courses and each listed task's first words.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLLECTIONS = [
  'plans',
  'planedits',
  'weakspots',
  'exams',
  'objectives',
  'dates',
  'dateedits',
  'materials',
  'notes',
];

/** {collection: [{...doc, id}]} from a record saved as <dir>/<collection>/<id>.json. */
export function readRecord(dir) {
  const db = {};
  for (const c of COLLECTIONS) {
    const d = path.join(dir, c);
    db[c] = fs.existsSync(d)
      ? fs
          .readdirSync(d)
          .filter(f => f.endsWith('.json'))
          .map(f => ({ ...JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')), id: f.slice(0, -5) }))
      : [];
  }
  return db;
}

const short = (t, n = 80) => {
  const s = String(t || '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/**
 * What is mixed: {tasks: [{plan, exam, course, inForce, date, task, text, theirs}], spots: [{id, topic, filed, own,
 * status}]}. A plan's course is its section's, else its exam's; a plan put away is left out.
 */
export function mixedCourses(db) {
  const exams = db.exams || [];
  const scope = {
    dates: EV.liveDates(db.dates || [], db.dateedits || []),
    exams,
    objectives: db.objectives || [],
    materials: db.materials || [],
    notes: db.notes || [],
  };
  const inForce = new Set(EV.planViews(db.plans || [], db.planedits || []).map(p => p.id));
  const retired = p => !!(((db.planedits || []).find(e => e && e.id === (p.exam || p.id)) || {}).retired || {})[p.id];
  const tasks = [];
  for (const p of db.plans || []) {
    if (retired(p)) continue;
    const course = (p.section && p.section.course) || (exams.find(e => e.id === (p.exam || p.id)) || {}).course;
    if (!course) continue;
    for (const d of p.days || [])
      for (const t of d.tasks || []) {
        const theirs = EV.planTaskCourse(t, scope);
        if (theirs && EV.courseOf({ course: theirs }) !== EV.courseOf({ course }))
          tasks.push({
            plan: p.id,
            exam: p.exam || p.id,
            course,
            inForce: inForce.has(p.id),
            date: d.date,
            task: t.id || null,
            text: short(t.text || t.title),
            theirs,
          });
      }
  }
  const models = EV.buildWeakspots({ weakspots: db.weakspots || [], sets: [], answers: [], exams });
  const spots = models
    .map(w => {
      const doc = (db.weakspots || []).find(x => x.id === w.id) || {};
      const filed = EV.courseOf({ course: doc.course });
      const own = EV.courseOf({ course: EV.spotCourse(w, { exams, objectives: db.objectives || [] }) });
      return { id: w.id, topic: short(w.topic, 60), filed, own, status: w.derived.status };
    })
    .filter(x => x.filed !== x.own);
  return { tasks, spots };
}

/** The listing as lines. */
export function report({ tasks, spots }) {
  const out = [];
  out.push(`Plan tasks that are another course's work: ${tasks.length}`);
  for (const t of tasks)
    out.push(
      `  plans/${t.plan} (${t.course} ${t.exam}${t.inForce ? ', in force' : ', draft'}) ${t.date} ${t.task || ''}: ${t.theirs}: ${t.text}`
    );
  out.push(`Weak spots filed under another course: ${spots.length}`);
  for (const w of spots) out.push(`  weakspots/${w.id} (${w.status}): filed ${w.filed}, its own ${w.own}: ${w.topic}`);
  out.push('Nothing was changed: this listing only reads (B-11).');
  return out;
}

export async function main(argv) {
  EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8')));
  let dir = argv[0];
  if (argv[0] === '--worker') {
    if (!argv[1]) throw new Error('usage: --worker <saved system/worker>');
    const { readWorker, list } = await import('../core/runapi-client.mjs');
    const w = readWorker(path.resolve(argv[1]));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-mixed-'));
    for (const c of COLLECTIONS) {
      const r = list(w, { collection: c, outDir: dir, versions: path.join(dir, '.versions', c + '.json') });
      if (!r.ok) throw new Error(`${c}: ${r.status} ${r.error}`);
    }
  }
  if (!dir || !fs.existsSync(dir))
    throw new Error('usage: node tools/mixed-courses.mjs <record dir> | --worker <file>');
  console.log(report(mixedCourses(readRecord(dir))).join('\n'));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(
    c => process.exit(c),
    e => {
      console.error(String((e && e.message) || e));
      process.exit(1);
    }
  );
