// The synthetic record (B-100): a made-up study record in v4 shapes for the page harnesses, so any session can run
// them without a staging export. It is the made-up record of test/data/seed.cjs, dated from the day it is built, with
// the documents the harnesses' own checks name. Nothing here is Matt's: no export, no Canvas text, no journal, no
// conversation of his; clinical content is generic and every client is made up.
//   node test/data/synthetic.cjs <out dir>        -> <out dir>/<collection>/<id>.json
// The harnesses (run.cjs, captions.cjs, core.cjs) build one themselves when no record dir is given, or given "synthetic".
const fs = require('fs'); const path = require('path');
const { seed } = require('./seed.cjs');
const TZ = 'America/Chicago';
const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
// An instant at a Central wall-clock time on a date (as seed.cjs).
function ct(date, hh, mm = 0) {
  let t = Date.parse(date + 'T00:00:00Z') + (hh + 6) * 36e5 + mm * 6e4;
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
  t -= ((h - hh + 24) % 24) * 36e5; return new Date(t).toISOString();
}

/** The record as {collection: {id: doc}}, dated from `now`. */
function syntheticRecord(now = new Date()) {
  const db = seed(now);
  const today = ymd(now), d = n => addDays(today, n), at = ct(d(-7), 18), env = (writer, source, when = at) => ({ schema: 1, writer, at: when, source });
  const put = (c, id, doc) => { (db[c] = db[c] || {})[id] = doc; };
  // run.cjs: graded work due today is the greeting's one urgent line.
  put('dates', 'synthetic-ati', { ...env('page', 'owner'), addedAt: at, date: today, title: 'ATI Engage Fundamentals: health assessment module and its practice assessment due 11:59pm', kind: 'due', course: 'NUR 112', graded: true });
  db.dates['demo-quiz'].date = d(4);
  db.days[today].list.items = db.days[today].list.items.filter(i => i.id !== 'soon-demo-quiz');
  // run.cjs: the weak spots and objectives its answer checks name.
  put('objectives', 'E4-6', { ...env('worker', 'Exam plan job', ct(d(-30), 10)), exam: 'E4', num: 6, text: 'Teach health promotion across the lifespan.', chapters: [22] });
  // The study session's wrap-up repeats one weak spot exactly and one nearly.
  for (const [id, objective, topic] of [['e4-preschooler', 'E4-6', 'Preschooler health promotion'], ['e4-aging-expected', 'E4-3', 'Aging: expected vs. unexpected'], ['ws-2026-10-17-E4-3-hypokalemia-findings', 'E4-3', 'Hypokalemia findings'], ['ws-2026-10-17-E4-3-fluid-volume-excess', 'E4-3', 'Fluid volume excess']]) {
    const when = ct(d(-5), 19, 30);
    put('weakspots', id, { ...env('page', 'Review miss', when), addedAt: when, addedBy: 'Matt', topic, objective, exam: 'E4', course: 'NUR 112', kind: 'concept', initial: { streak: 0, nextDue: d(-4), recurrence: 1, misses: 1 }, events: {} });
  }
  // run.cjs (B-54): the exam plan's calendar, with a chapter drill (shareable) and a weak-spot drill (not).
  put('plans', 'E4', { ...env('worker', 'Exam plan job', ct(d(-10), 10)), exam: 'E4', title: 'Exam 4 plan', days: [
    { date: d(-1), label: 'Fluids', tasks: [{ id: 'e4-read-39', text: 'Read Ch 39: fluids and electrolytes', tag: 'READING', kind: 'reading', chapters: [39] }, { id: 'e4-drill-39', text: 'Drill: Ch 39 fluids and electrolytes, 10 questions', tag: 'DRILL', kind: 'drill', chapters: [39] }] },
    { date: d(1), label: 'Weak spots', tasks: [{ id: 'e4-drill-weak', text: 'Drill: Exam 4 weak spots, 10 questions', tag: 'DRILL', kind: 'drill' }] },
  ] });
  const q = (id, stem, options, rationales, objective, topic) => ({ id, kind: 'drill', type: 'single', stem, options, correct: [0], rationales, objective, topic, cjStep: 'recognize-cues' });
  put('sets', 'drill-E4-ch39', { ...env('morning', 'morning 4:25', ct(d(-1), 4, 31)), schema: 3, kind: 'drill', title: 'Drill: Ch 39 fluids and electrolytes', date: d(-1), exam: 'E4', planTaskId: 'e4-drill-39', items: [
    q('d1', 'Which made-up finding best shows fluid volume deficit?', ['Weight down 1 kg in a day', 'Bounding pulse', 'Crackles', 'Distended neck veins'], ['Right: a kilogram is about a litre lost.', 'That is excess.', 'That is excess.', 'That is excess.'], 'E4-1', 'Fluid volume deficit'),
    q('d2', 'Normal serum sodium is:', ['135 to 145 mEq/L', '3.5 to 5.0 mEq/L', '95 to 105 mEq/L', '8.5 to 10.5 mg/dL'], ['Right.', 'That is potassium.', 'That is chloride.', 'That is calcium.'], 'E4-2', 'Sodium range'),
  ] });
  // Yesterday's chapter drill, answered through (its summary carries All sets).
  const ans = (n, right) => { const when = ct(d(-1), 19, n); return { ['page-' + when.replace(/[-:]/g, '').replace('T', '-').replace(/\.\d+Z$/, '')]: { chosen: [right ? 0 : 1], correct: right, score: right ? 1 : 0, at: when, outcome: right ? 'right' : 'wrong' } }; };
  put('answers', 'drill-E4-ch39', { ...env('page', 'E.V. Home', ct(d(-1), 19, 5)), schema: 2, setId: 'drill-E4-ch39', answers: { d1: ans(1, true), d2: ans(2, false) } });
  put('sets', 'drill-E4-weak', { ...env('morning', 'morning 4:25', ct(d(-1), 4, 31)), schema: 3, kind: 'drill', title: 'Drill: Exam 4 weak spots', date: d(-1), exam: 'E4', planTaskId: 'e4-drill-weak', items: [
    q('w1', 'Cardiac output equals:', ['Heart rate × stroke volume', 'Stroke volume ÷ heart rate', 'Preload minus afterload', 'Heart rate × afterload'], ['Right.', 'Backwards.', 'Not a formula.', 'Not a formula.'], 'E4-3', 'What raises cardiac output'),
  ] });
  // run.cjs: its own skills packet (p. 12) is the one checklist in the library.
  delete db.materials['NUR112-990001'];
  // A lab guide that names head to toe on every page, as a real library does, so the checklist page outranks the
  // packet's table of contents.
  const labs = ['vital signs', 'bed bath', 'oral care', 'sterile gloves', 'wound care', 'medication pass', 'intake and output', 'ambulation', 'transfer', 'feeding', 'urinary catheter care', 'oxygen therapy', 'pain assessment', 'fall risk', 'restraint alternatives', 'hand hygiene', 'PPE', 'glucose check', 'incentive spirometry', 'range of motion'];
  const guide = labs.map((t, i) => `[p${i + 1}] Skills lab week ${i + 1}: ${t}. Practice it in pairs, then fold it into your head to toe routine. Your instructor signs your practice log.`).join('\n');
  put('materials', 'NUR112-990003', { ...env('canvas-sync', 'Canvas sync', ct(d(-20), 20, 20)), course: 'NUR 112', kind: 'lab', title: 'Skills lab guide.pdf', module: 'Week 9', fileType: 'pdf', fileId: 990003, text: guide, pages: labs.length, chars: guide.length, needsOcr: false });
  // run.cjs: two filed sessions; one is a v3 session filed under its bare id, which the reader must leave alone. The
  // page's own study sessions are the harness's to start, so the seed's filed session is a Study Watch one here.
  for (const x of Object.values(db.sessions)) { x.source = 'Study Watch'; delete x.comments; } // B-74: comments is a page session's
  { const [id0, s0] = Object.entries(db.sessions)[0], s1 = ct(d(-2), 0, 35), e1 = ct(d(-2), 1, 20);
    put('sessions', '2026-10-17-0035-Pharmacology-Chapter-50', { ...s0, at: e1, date: d(-2), startedAt: s1, endedAt: e1, topic: 'Pharmacology: made-up dosage practice', minutes: 45, events: { ['page-' + s1.replace(/[-:]/g, '').replace('T', '-').replace(/\.\d+Z$/, '')]: { type: 'start', len: 600, h: 'synth1' } }, summary: 'Dosage math on made-up orders.', cards: [] }); }
  // run.cjs: Exam 3 has its score, so the score card asks for the harness's own past exam.
  put('examedits', 'E3', { ...env('page', 'E.V. Home', ct(d(-11), 15)), updatedAt: ct(d(-11), 15), score: 86, scoreAt: ct(d(-11), 15), status: 'done' });
  // run.cjs (B-34): the nightly lint lands on state/current.
  put('state', 'current', env('evening-cloud', 'evening 8:15', ct(d(-1), 20, 18)));
  // run.cjs: more than ten active weak spots, and four previews (missed before the reading; the reading is ahead).
  const more = [['E4-1', 'Third spacing and edema'], ['E4-1', 'Intake and output totals'], ['E4-2', 'Calcium and tetany signs'], ['E4-2', 'Magnesium and reflexes'], ['E4-3', 'Stroke volume factors'], ['E4-4', 'Pulse oximetry limits'], ['E4-5', 'Lactated Ringer’s uses'], ['E4-5', 'Hypertonic saline cautions']];
  more.forEach(([objective, topic], i) => { const when = ct(d(-3 - (i % 3)), 20, i); put('weakspots', 'ws-synth-' + (i + 1), { ...env('page', 'Review miss', when), addedAt: when, addedBy: 'Matt', topic, objective, exam: 'E4', course: 'NUR 112', kind: 'concept', initial: { streak: 0, nextDue: d(1), recurrence: 1, misses: 1 }, events: {} }); });
  ['Enteral feeding checks', 'Bowel elimination changes', 'Urinary retention signs', 'Nutrition screening tools'].forEach((topic, i) => { const when = ct(d(-1), 21, i); put('weakspots', 'ws-preview-' + (i + 1), { ...env('page', 'Pre-reading check', when), addedAt: when, addedBy: 'Matt', topic, objective: '', exam: 'E5', course: 'NUR 112', kind: 'concept', preRead: true, readingDue: d(3), initial: { streak: 0, nextDue: d(3), recurrence: 1, misses: 1 }, events: {} }); });
  // run.cjs (B-72, D-120): last Sunday's weekly, with the insights the Progress card shows and make_practice aims at.
  { const wd = new Date(today + 'T12:00:00Z').getUTCDay(), sun = d(-(wd || 7)), base = JSON.parse(fs.readFileSync(path.join(__dirname, 'record', 'weeks', '2026-10-11.json'), 'utf8'));
    put('weeks', sun, { ...base, at: ct(sun, 17, 59), date: sun, health: { ...(base.health || {}), evidence: { answers: 212, scoredExams: 1 } }, rollups: { ...base.rollups, from: addDays(sun, -6), to: sun, readiness: { E4: { pctSolid: 10, active: 8, solid: 1, accuracy7: 55, answers7: 12 } } },
      insights: { window: { from: addDays(sun, -27), to: sun },
        byObjective: [{ id: 'E4-3', right: 2, n: 7, pct: 29 }, { id: 'E4-2', right: 4, n: 8, pct: 50 }, { id: 'E4-1', right: 6, n: 9, pct: 67 }],
        byFormat: [{ id: 'select-all', right: 1, n: 4, pct: 25 }, { id: 'single', right: 11, n: 20, pct: 55 }],
        byCjStep: [{ id: 'analyze-cues', right: 3, n: 8, pct: 38 }],
        missedEvery: [{ ref: 'sets/drill-E4-weak#w1', topic: 'What raises cardiac output', objective: 'E4-3', attempts: 3, missed: 3 }],
        neverMissed: 5, recurrence: [{ weakspotId: 'ws-synth-5', topic: 'Stroke volume factors', recurrence: 3 }],
        studyVsNextDay: [], weakestObjective: 'E4-3',
        lines: ['Weakest objective: E4-3, 2 of 7 right (29%).', 'Missed every time: What raises cardiac output (3 of 3).', 'Back most often: Stroke volume factors (3 times).'] } }); }
  return db;
}

function write(db, out) {
  for (const [c, docs] of Object.entries(db)) {
    fs.mkdirSync(path.join(out, c), { recursive: true });
    for (const [id, doc] of Object.entries(docs)) fs.writeFileSync(path.join(out, c, id + '.json'), JSON.stringify(doc, null, 1));
  }
}

/** A harness's record folder: the one named, or (none, or "synthetic") a synthetic record written fresh to a temp dir. */
function recordDir(arg) {
  if (arg && arg !== 'synthetic') return arg;
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ev4-synthetic-'));
  write(syntheticRecord(), out); fs.writeFileSync(path.join(out, 'SYNTHETIC'), 'Made-up records from test/data/synthetic.cjs.\n');
  return out;
}

module.exports = { syntheticRecord, write, recordDir };
if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node test/data/synthetic.cjs <out dir>'); process.exit(2); }
  // Rebuilt in place only over an earlier synthetic record (its marker file), never over anything else.
  if (fs.existsSync(out) && fs.readdirSync(out).length) {
    if (!fs.existsSync(path.join(out, 'SYNTHETIC'))) { console.error(`${out} is not empty and holds no synthetic record: give a new folder`); process.exit(1); }
    fs.rmSync(out, { recursive: true });
  }
  const db = syntheticRecord();
  write(db, out);
  fs.writeFileSync(path.join(out, 'SYNTHETIC'), 'Made-up records from test/data/synthetic.cjs. Nothing here is Matt\'s data.\n');
  console.log(`synthetic record: ${Object.values(db).reduce((n, d) => n + Object.keys(d).length, 0)} documents in ${Object.keys(db).length} collections -> ${out}`);
}
