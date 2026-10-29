// The page harness (B-16, ported from v3's test/harness/run.cjs): drives the built v4 page (dist/page/<target>/, the
// shell with its published files served beside it) at phone and desktop width, with the record, sample, mcp and the
// Study Watch reader stubbed (stub.js). The record comes from a folder of <collection>/<id>.json in v4 shapes: by
// default the synthetic record (test/data/synthetic.cjs, made up), else the staging seed (`seed-staging --out`) or a
// migrated export, kept outside the repository (it is personal data).
//   node test/harness/run.cjs [record dir | synthetic] [screenshots dir]   (default: the synthetic record, B-100)
// Run `node tools/build.mjs` first. Exit code 1 when any check fails. The shell's own checks are test/harness/shell.cjs.
const { chromium } = require('playwright');
const { paintAnswer, painted, studyView, openSet: openSetById } = require('./paint.cjs');
const { rowProblems } = require('./rows.cjs');
// B-303: a set's id from its title, for openSet (paint.cjs)
const byTitle = (page, title) =>
  page.evaluate(t => (Object.entries(window.__db.sets || {}).find(([, x]) => x.title === t) || [t])[0], title);
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
// B-149: the release comes from the build (git describe at the build's commit), never a literal.
const RELEASE = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json'), 'utf8')).release;
const SPEC_VERSION = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8')).specVersion;
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dbDir = require('../data/synthetic.cjs').recordDir(process.argv[2]);
const shots = process.argv[3] || '/tmp/ev4-shots';
fs.mkdirSync(shots, { recursive: true });
function load(dir) {
  const db = {};
  for (const c of fs.readdirSync(dir)) {
    const p = path.join(dir, c);
    if (!fs.statSync(p).isDirectory()) continue;
    db[c] = {};
    for (const f of fs.readdirSync(p))
      if (f.endsWith('.json')) db[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8'));
  }
  return db;
}
const seed = load(dbDir);
delete seed.system;
delete seed.legacy;
delete seed.debug;
// D-335: the conversation can look up his journal; the harness reads one made-up entry in place of any real one
seed.journal = {
  'j-harness-1': {
    schema: 1,
    writer: 'page',
    at: '2026-10-01T02:00:00Z',
    source: 'E.V. Home',
    kind: 'free',
    text: 'A made-up journal line about harness week',
  },
};
// B-412 review: a long made-up note whose match sits far past its start, for the lookup's passage and size checks
const filler = k =>
  Array.from({ length: k }, (_, n) => ({ type: 'p', runs: [{ text: `Made-up filler line ${n} about nothing.` }] }));
seed.notes = seed.notes || {};
seed.notes['n-20261020-120000-harnesslong'] = {
  schema: 1,
  writer: 'page',
  at: '2026-10-20T17:00:00Z',
  source: 'E.V. Home',
  createdAt: '2026-10-20T17:00:00Z',
  editedAt: '2026-10-20T17:00:00Z',
  title: 'A long made-up note',
  course: 'BIO 201',
  blocks: [
    ...filler(60),
    { type: 'p', runs: [{ text: 'The zygote ladder "quoted" is the made-up marker.' }] },
    ...filler(120),
  ],
};
seed.ideas = seed.ideas || {};
seed.ideas['idea-harness-feature'] = {
  schema: 2,
  writer: 'page',
  at: '2026-10-17T14:00:00Z',
  source: 'Told E.V.',
  kind: 'feature',
  text: 'Harness feature idea: a dark-mode calendar',
  objective: '',
  status: 'open',
  links: [],
};
seed.ideas['idea-harness-general'] = {
  schema: 2,
  writer: 'page',
  at: '2026-10-17T14:00:00Z',
  source: 'Told E.V.',
  kind: 'general',
  text: 'Harness general idea: buy a new stethoscope',
  objective: '',
  status: 'open',
  links: [],
};
seed.ideas['idea-harness-learning'] = {
  schema: 2,
  writer: 'page',
  at: '2026-10-17T14:00:00Z',
  source: 'Told E.V.',
  kind: 'learning',
  text: 'Harness learning idea: third spacing links to albumin',
  objective: '',
  status: 'open',
  links: [],
}; // B-53
seed.exams = seed.exams || {};
seed.exams['E0H'] = {
  schema: 2,
  writer: 'page',
  at: '2026-09-01T14:00:00Z',
  source: 'harness',
  course: 'NUR 112',
  kind: 'unit',
  title: 'Harness Exam 0',
  date: '2026-10-01',
  status: 'upcoming',
}; // B-39: past, no score
seed.system = {
  manifest: {
    release: RELEASE,
    commit: 'a'.repeat(40),
    pages: { staging: { files: { 'page/staging/app.js': 'a'.repeat(64) } }, live: { files: {} } },
  },
}; // B-38
const env = (writer, source, at, schema = 1) => ({ schema, writer, at: at || new Date().toISOString(), source });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const DAYTIME = new Date(today + 'T19:00:00Z'); // 2pm CDT: the page's clock (see openPage)
// B-201: a weekly written today, as Sunday's is, so Today shows its card with the build recap.
{
  const lastWeek = Object.keys(seed.weeks || {})
    .sort()
    .pop();
  if (lastWeek && lastWeek !== today) {
    const w = seed.weeks[lastWeek];
    seed.weeks[today] = {
      ...w,
      date: today,
      review: 'A made-up week: fluids came along; potassium still trips you.',
      reflection: 'What helped most this week?',
      health: { ...(w.health || {}), recap: 'This week she shipped 8 tasks to live; 4 wait on you.' },
    };
  }
}
// Today's review: the newest review set in the record, with its answers, as today's (so the summary is known).
const lastReview = Object.keys(seed.sets || {})
  .filter(k => /^review-\d{4}-\d{2}-\d{2}$/.test(k))
  .sort()
  .pop();
let reviewExpect = null;
if (lastReview && lastReview !== 'review-' + today) {
  seed.sets['review-' + today] = { ...seed.sets[lastReview], date: today };
  const a = (seed.answers || {})[lastReview];
  if (a) {
    seed.answers['review-' + today] = { ...a, setId: 'review-' + today };
  }
}
// The page shows the summary once every item is answered, the first unanswered item ("n of m") while some are, and
// the first item untouched before any are. An export taken the same day may hold a review set part answered.
{
  const rs = (seed.sets || {})['review-' + today];
  const a = ((seed.answers || {})['review-' + today] || {}).answers || {};
  if (rs) {
    const latest = q => {
      const t = a[q.id] || {};
      const k = Object.keys(t).sort().pop();
      return k ? t[k] : null;
    };
    const items = rs.items || [];
    const got = items.map(latest);
    const done = got.filter(Boolean);
    const next = got.findIndex(x => !x);
    reviewExpect = !done.length
      ? null
      : next < 0
        ? `${done.filter(x => x.correct).length} of ${done.length} right`
        : `${next + 1} of ${items.length}`;
  }
}
// The harness opens the page as if nothing has been said today (the greeting at full size, a quick ask making the day's
// first two messages): an export taken today carries today's conversation, so it is left out.
if (seed.talk) delete seed.talk[today];
// The same for today's sessions and workouts: a staging record carries the proofs earlier build chats ran on it (B-51's
// skills run, B-52's CINDY), which would otherwise read as a run already started today.
for (const c of ['sessions', 'workouts'])
  for (const [id, d] of Object.entries(seed[c] || {}))
    if ((d.date || E_DATE(d.startedAt)) === today) delete seed[c][id];
function E_DATE(iso) {
  return iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso)) : null;
}
// A small practice set to exercise all three question types and the answer flow.
seed.sets = seed.sets || {};
seed.sets['more-' + today + '-1'] = {
  ...env('page', 'More practice'),
  schema: 2,
  kind: 'more',
  date: today,
  exam: 'E4',
  title: 'Harness set',
  createdAt: new Date().toISOString(),
  items: [
    {
      id: 'm1',
      kind: 'review',
      weakspotId: 'e4-preschooler',
      objective: 'E4-6',
      topic: 'Preschooler health promotion',
      type: 'single',
      cjStep: 'take-action',
      stem: 'A parent asks how to keep a 4-year-old safe in the car. What should the nurse teach?',
      options: [
        'Forward-facing seat with harness',
        'Adult seat belt only',
        'Front seat with airbag off',
        'Booster with lap belt only',
      ],
      correct: [0],
      rationales: [
        'Right for this age and size.',
        'Too early.',
        'Back seat is safest.',
        'Needs lap and shoulder belt.',
      ],
    },
    {
      id: 'm2',
      kind: 'check',
      objective: 'E4-2',
      topic: 'Caring behaviors',
      type: 'sata',
      cjStep: 'generate-solutions',
      stem: 'Which actions show caring behaviors with an anxious older adult? Select all that apply.',
      options: [
        'Sit at eye level',
        'Use touch if welcomed',
        'Speak quickly to save time',
        'Listen without interrupting',
        'Talk to the family instead',
      ],
      correct: [0, 1, 3],
      rationales: ['Yes.', 'Yes.', 'No.', 'Yes.', 'No.'],
    },
    {
      id: 'm3',
      kind: 'review',
      weakspotId: 'e4-aging-expected',
      objective: 'E4-3',
      topic: 'Aging: expected vs. unexpected',
      type: 'matrix',
      cjStep: 'recognize-cues',
      stem: 'An 82-year-old is admitted. Mark each finding as expected with aging or unexpected.',
      matrix: {
        columns: ['Expected', 'Unexpected'],
        rows: [
          { text: 'Thinner, drier skin', correct: 0, rationale: 'Normal aging.' },
          { text: 'New confusion since yesterday', correct: 1, rationale: 'Sudden change suggests delirium.' },
          { text: 'Slower reaction time', correct: 0, rationale: 'Normal aging.' },
        ],
      },
    },
  ],
};
// B-43 (D-100): a dosage set of numeric items, answered once right and once missed at each width.
seed.sets['more-' + today + '-dose'] = {
  ...env('page', 'More practice'),
  schema: 2,
  kind: 'more',
  date: today,
  title: 'Harness dosage',
  createdAt: new Date().toISOString(),
  items: [
    {
      id: 'n1',
      kind: 'check',
      type: 'numeric',
      topic: 'Liquid oral dose',
      cjStep: 'take-action',
      stem: 'Order: a drug 250 mg by mouth. On hand: 125 mg per 5 mL. How many mL do you give?',
      answer: 10,
      unit: 'mL',
      tolerance: 0,
      steps: ['Desired over have: 250 mg / 125 mg = 2', '2 x 5 mL = 10 mL'],
      sourceRef: 'materials/harness-dosage',
    },
    {
      id: 'n2',
      kind: 'check',
      type: 'numeric',
      topic: 'IV rate',
      cjStep: 'take-action',
      stem: 'Infuse 1,000 mL over 8 hours by pump. What rate do you set? Round to the whole mL/hr.',
      answer: 125,
      unit: 'mL/hr',
      tolerance: 0.5,
      steps: ['1,000 mL / 8 hr = 125 mL/hr'],
      sourceRef: 'materials/harness-dosage',
    },
  ],
};
// B-191: three single questions to close, go back and forward in, and answer out of order, at each width.
seed.sets['more-' + today + '-nav'] = {
  ...env('page', 'More practice'),
  schema: 2,
  kind: 'more',
  date: today,
  exam: 'E4',
  title: 'Harness nav',
  createdAt: new Date(Date.now() - 864e5).toISOString(),
  items: ['Erikson', 'Piaget', 'Kohlberg'].map((who, i) => ({
    id: 'v' + (i + 1),
    kind: 'check',
    objective: 'E4-1',
    topic: who + ' basics',
    type: 'single',
    cjStep: 'recognize-cues',
    stem: `Which theorist is question ${i + 1} about? (${who})`,
    options: [who, 'Freud', 'Maslow', 'Skinner'],
    correct: [0],
    rationales: [who + ' is right.', 'Not Freud.', 'Not Maslow.', 'Not Skinner.'],
  })),
};
// B-193 (D-205): a NUR question resting on a BIO passage names its source under the stem.
seed.sets['more-' + today + '-cross'] = {
  ...env('page', 'More practice'),
  schema: 2,
  kind: 'more',
  date: today,
  exam: 'E4',
  title: 'Harness cross',
  createdAt: new Date(Date.now() - 2 * 864e5).toISOString(),
  items: [
    {
      id: 'x1',
      kind: 'check',
      objective: 'E4-6',
      topic: 'Vitamin C and wound healing',
      type: 'single',
      cjStep: 'analyze-cues',
      stem: 'A client’s wound heals slowly. Which vitamin builds the collagen it needs?',
      options: ['Vitamin C', 'Vitamin A', 'Vitamin D', 'Vitamin K'],
      correct: [0],
      rationales: ['Collagen needs it (from BIO 201: Bones slides).', 'No.', 'No.', 'No.'],
      sourceRef: 'materials/BIO201-harness-bones',
    },
  ],
};
const hourAgo = new Date(Date.now() - 3600e3).toISOString();
// A small library file (D-079): the skills packet's head-to-toe checklist sits on page 12.
seed.materials = seed.materials || {};
seed.materials['BIO201-harness-bones'] = {
  ...env('canvas-sync', 'Canvas'),
  course: 'BIO 201',
  kind: 'slides',
  title: 'Bones slides.pptx',
  fileType: 'pptx',
  pages: 40,
  module: 'Chapter 7',
  text: '[s12] Vitamin C is needed to make collagen, the protein frame of bone matrix.\n',
};
seed.materials['NUR112-harness-skills'] = {
  ...env('canvas-sync', 'Canvas'),
  course: 'NUR 112',
  kind: 'lab',
  title: 'Harness Skills Packet.pdf',
  fileType: 'pdf',
  pages: 13,
  module: 'LAB/SKILLS Resources',
  text: '[p1] Nursing Skills Packet\n[p2] Table of contents: Vital signs 8; Head to Toe Assessment 12; Head to Toe Documentation 13\n[p12] HEAD TO TOE ASSESSMENT * 1. Perform hand hygiene. * 2. Introduce yourself and verify the client with two identifiers. * 3. Provide privacy and explain the assessment. * 4. Inspect the skin and auscultate heart sounds at the five landmarks.\n[p13] HEAD TO TOE DOCUMENTATION * Document findings by body system.\n',
};
// Calendar entries for the edit checks (D-080): two from Canvas (graded work stays; an optional event can go) and the rest of the export.
const inDays = n =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(Date.now() + n * 86400e3));
seed.dates = seed.dates || {};
seed.dates['canvas-h-graded'] = {
  ...env('canvas-sync', 'Canvas'),
  canvasId: 9001,
  date: inDays(2),
  title: 'Harness graded quiz',
  kind: 'due',
  graded: true,
  course: 'NUR 112',
};
seed.dates['canvas-h-hall'] = {
  ...env('canvas-sync', 'Canvas'),
  canvasId: 9002,
  date: inDays(3),
  title: 'Harness study hall',
  kind: 'other',
  graded: false,
  course: 'NUR 112',
};
// pdf.js comes from cdnjs on the page; the harness serves a local copy (npm install --no-save pdfjs-dist@4.4.168)
const pdfjsDir = path.join(root, 'node_modules/pdfjs-dist/build');
const hasPdfjs = fs.existsSync(path.join(pdfjsDir, 'pdf.min.mjs'));
const servePdfjs = page =>
  page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', r => {
    const f = path.join(pdfjsDir, r.request().url().split('/').pop());
    return fs.existsSync(f)
      ? r.fulfill({
          body: fs.readFileSync(f),
          headers: { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' },
        })
      : r.abort();
  });
// The watchdog's last health check (B-17): one stalled run it re-fired, one it could not, the evening's hash.
seed.health = {
  current: {
    ...env('watchdog', 'watchdog harness', new Date(DAYTIME.getTime() - 50 * 60e3).toISOString()),
    record: 'staging',
    pipelines: {
      morning: {
        id: 'morning-h',
        status: 'ok',
        startedAt: new Date(DAYTIME.getTime() - 9 * 3600e3).toISOString(),
        endedAt: new Date(DAYTIME.getTime() - 9 * 3600e3 + 300e3).toISOString(),
        release: RELEASE,
      },
    },
    missing: [
      { pipeline: 'evening-cloud', slot: new Date(DAYTIME.getTime() - 20 * 3600e3).toISOString(), refired: true },
    ],
    stalledRuns: [
      {
        id: 'weekly-h',
        pipeline: 'weekly',
        startedAt: new Date(DAYTIME.getTime() - 3 * 3600e3).toISOString(),
        minutes: 180,
        refired: false,
      },
    ],
    stalledJobs: [],
    reported: [
      { id: 'watchdog-refire-weekly-h', target: 'run weekly-h', reason: 'never ended', why: 'already re-fired once' },
    ],
    verifyDeploy: null,
    derivedHash: { evening: 'x'.repeat(64), at: new Date(DAYTIME.getTime() - 18 * 3600e3).toISOString() },
    capacity: {
      docs: 412,
      level: 'warn',
      budgets: [
        {
          collection: 'sets',
          docs: 401,
          bytes: null,
          warnDocs: 400,
          failDocs: null,
          warnBytes: null,
          failBytes: null,
          level: 'warn',
          relief: 'the weekly roll-up',
        },
        {
          collection: 'state',
          docs: 1,
          bytes: null,
          warnDocs: null,
          failDocs: null,
          warnBytes: 196608,
          failBytes: 245760,
          level: 'ok',
          relief: 'factHashes split per collection',
        },
        {
          collection: 'materials',
          docs: 60,
          bytes: 1572864,
          warnDocs: null,
          failDocs: null,
          warnBytes: 4194304,
          failBytes: null,
          level: 'ok',
          relief: 'the lazy library load',
        },
      ],
    },
    restoreDrill: null,
  },
};
// A background job that finished an hour ago: the page wrote jobs/<id>, the worker wrote jobresults/<id>.
// B-34 (D-090): the nightly lint in state/current, as evening-cloud writes it: one warning, notes by code.
if (seed.state && seed.state.current)
  seed.state.current.lint = {
    at: new Date(DAYTIME.getTime() - 18 * 3600e3).toISOString(),
    commit: 'c'.repeat(40),
    errors: 0,
    warnings: 1,
    notes: 2,
    notesByCode: { frozen: 1, 'not-rebuilt': 1 },
    rebuilt: { same: 3, of: 4 },
    top: [
      {
        severity: 'warning',
        code: 'derived-stale',
        ref: 'days/2026-10-17',
        msg: "built by build aaaaaaaaaaaa; differs from this build's rebuild until its next run",
      },
    ],
  };
seed.jobs = {
  'job-20261017-150000-cardiac-output': {
    ...env('page', 'E.V. Home', new Date(Date.now() - 7200e3).toISOString(), 2), // B-177: jobs schema 2
    kind: 'study-guide',
    title: 'Study guide: cardiac output',
    brief: 'harness',
    fired: { at: hourAgo, ok: true },
  },
};
seed.jobresults = {
  'job-20261017-150000-cardiac-output': {
    ...env('worker', 'worker harness', hourAgo),
    release: RELEASE,
    status: 'done',
    startedAt: hourAgo,
    finishedAt: hourAgo,
    result: {
      text: 'One page on preload, afterload and contractility, with three self-check questions.',
      links: [{ title: 'E.V. study guide: cardiac output', url: 'https://claude.ai/artifact/harness' }],
    },
  },
};
// B-47 (D-104): a finished exam-retro job with its numbers, for the retro card check
// B-177 (review): builder jobs, older than the 3-hour live window so they never show as running work: one stalled past
// the builder's 90 minutes, one failed long before he last looked (no greeting line).
const fourHoursAgo = new Date(DAYTIME.getTime() - 4 * 3600e3).toISOString(); // the page's clock (openPage)
seed.jobs['job-harness-build-stalled'] = {
  ...env('page', 'E.V. Home', fourHoursAgo, 2),
  kind: 'build',
  title: 'build: the timer sat at 0:00',
  brief: 'build: the timer sat at 0:00',
  fired: { at: fourHoursAgo, ok: true },
};
seed.jobs['job-harness-reply-failed'] = {
  ...env('page', 'E.V. Home', '2026-10-10T15:00:00Z', 2),
  kind: 'reply',
  title: 'B-01',
  brief: 'yes',
  fired: { at: '2026-10-10T15:00:01Z', ok: true },
};
// B-180: two build jobs the builder traced long ago: one green on staging, one that stopped before it got there.
for (const [id, task, commit, text, error] of [
  ['job-harness-build-green', 'B-201', 'abc1234def', 'Say ship it when you want it live.', null],
  ['job-harness-build-failed', 'B-202', null, null, 'npm test failed on the new harness check'],
]) {
  seed.jobs[id] = {
    ...env('page', 'E.V. Home', '2026-10-10T14:00:00Z', 2),
    kind: 'build',
    title: 'build: ' + id,
    brief: 'build: ' + id,
    fired: { at: '2026-10-10T14:00:01Z', ok: true },
  };
  seed.jobresults[id] = {
    ...env('builder', 'trace ' + id, '2026-10-10T14:40:00Z', 2),
    release: RELEASE,
    status: error ? 'failed' : 'done',
    startedAt: '2026-10-10T14:05:00Z',
    finishedAt: '2026-10-10T14:40:00Z',
    result: { text: text || error, task, ...(commit ? { commit } : {}) },
    message: null,
    error,
  };
}
/** B-227 (D-232), at the width it runs: a running job's line is its plan; a finished one is one line with how long it
 * worked, opening in place to what it changed, each a link to its place; a reply that filed an idea carries the same. */
// B-297 (D-283, C-8, C-13): Study's overview. The view's one primary is Start session; the toolbar holds no Quiz me
// and the view no mini-quiz card; at 390 the toolbar is one row. Objective rows are 32 px from 600 px and 44 px on the
// phone. An objective's Quiz me opens a set of its own existing questions; with none, it starts the practice-set job.
// B-464: with any plan under the exam card its objectives fold to one line; open or close it as a check needs
async function objFold(page, open) {
  const f = page.locator(`#ov-card .fold-line.pm-more[aria-expanded="${!open}"]`);
  if (await f.count()) {
    await f.first().click();
    await page.waitForTimeout(150);
  }
}
async function quizMeChecks(page, scheme) {
  await studyView(page, 'objectives');
  await page.waitForTimeout(200);
  await objFold(page, true);
  const o = await page.evaluate(() => {
    const vis = e =>
      !!e &&
      !e.closest('[hidden]') &&
      getComputedStyle(e).display !== 'none' &&
      getComputedStyle(e).visibility !== 'hidden' &&
      e.getBoundingClientRect().height > 0;
    const r = e => e.getBoundingClientRect(),
      mid = e => r(e).top + r(e).height / 2;
    const bar = document.getElementById('sbar-study');
    const kids = [...bar.children].filter(e => vis(e) && !e.classList.contains('sp'));
    const buttons = ['p-study', 'mh']
      .flatMap(id => [...document.getElementById(id).querySelectorAll('button')])
      .filter(vis);
    return {
      primaries: buttons.filter(b => b.classList.contains('primary')).map(b => b.id || b.textContent.trim()),
      barQuiz: [...bar.querySelectorAll('button')].filter(vis).filter(b => /quiz/i.test(b.textContent)).length,
      mini: /mini quiz|take the quiz/i.test(document.getElementById('p-study').innerText),
      oneRow:
        kids.length > 0 &&
        kids.every(e => Math.abs(mid(e) - mid(kids[0])) <= 4) &&
        bar.scrollWidth <= bar.clientWidth + 1,
      rows: [...document.querySelectorAll('#ov-card .ov .obj')].filter(vis).map(e => Math.round(r(e).height)),
      start: vis(document.getElementById('study-start')),
    };
  });
  // the overview in both themes, at this pass's width (390 or 1280), to look at
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${shots}/study-objectives-${scheme}-${theme}.png` });
  }
  // B-351 (D-327): the demo's StudyOverview: the strip carries the course switch, Quiz me, Weak spots and Start
  // session in one row; the exam card's objective rows; the mini quiz beside Coming up
  ok(
    `[${scheme}] Study's overview: Start session and Quiz me in the toolbar (one row from 600 px), the exam's objective rows (B-351)`,
    o.start && o.barQuiz >= 1 && (scheme === 'phone' || o.oneRow) && o.rows.length > 0,
    JSON.stringify(o)
  );
  // which objectives have questions in his practice sets, and which have none
  const has = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('#ov-card .ov')].map(e => e.dataset.id);
    const sets = Object.values(window.__db.sets || {}).filter(x => x.kind !== 'review');
    const n = id => sets.reduce((k, x) => k + window.EVCore.validItems(x).filter(q => q.objective === id).length, 0);
    // a set that also holds other objectives' questions shows the filter (only this objective's are opened)
    const mixed = id =>
      sets.every(x => {
        const qs = window.EVCore.validItems(x);
        return !qs.some(q => q.objective === id) || qs.some(q => q.objective !== id);
      });
    return {
      yes: ids.find(id => n(id) > 0 && mixed(id)) || ids.find(id => n(id) > 0) || null,
      no: ids.find(id => !n(id)) || null,
    };
  });
  const quiz = async id => {
    // B-351: Quiz me sits on the row (shown on hover); the picked objective's detail carries Quiz me on this
    const row = page.locator(`#ov-card .ov[data-id="${id}"]`);
    await row.locator('.obj').hover();
    if (await row.locator('.oq').isVisible()) await row.locator('.oq').click();
    else {
      await row.locator('.ov-nm').click();
      await page.waitForTimeout(100);
      await page.locator('#p-study .od-q', { hasText: 'Quiz me on this' }).first().click();
    }
    await page.waitForTimeout(250);
  };
  if (has.yes) {
    await quiz(has.yes);
    const got = await page.evaluate(id => {
      const shown = !document.getElementById('study-practice').hidden;
      return {
        shown,
        back: !document.getElementById('study-back').hidden,
        count: (document.getElementById('pr-qcount') || {}).textContent,
      };
    });
    const items = await page.evaluate(id => {
      const fold = document.getElementById('pr-fold'),
        set = fold && window.__db.sets[fold.dataset.set];
      const all = set ? window.EVCore.validItems(set) : [];
      return { all: all.length, mine: all.filter(q => q.objective === id).length };
    }, has.yes);
    const n = Number((/\d+ of (\d+)/.exec(String(got.count || '')) || [])[1]);
    ok(
      `[${scheme}] an objective's Quiz me opens a set of its own existing questions, with the way back in the toolbar (B-297)`,
      got.shown && got.back && n === items.mine && items.mine > 0,
      JSON.stringify({ ...got, ...items })
    );
    await page.click('#study-back');
    await page.waitForTimeout(150);
  } else
    ok(
      `[${scheme}] an objective's Quiz me opens a set of its own existing questions (B-297)`,
      false,
      'no objective has questions'
    );
  if (has.no) {
    await quiz(has.no);
    const job = await page.evaluate(
      id =>
        Object.values(window.__db.jobs || {}).find(
          j => j.kind === 'practice-set' && String(j.brief || '').startsWith(id + ':')
        ) || null,
      has.no
    );
    ok(
      `[${scheme}] an objective with no questions starts the practice-set job on it, and the view stays on Objectives (B-297)`,
      !!job && (await page.evaluate(() => !document.getElementById('study-objectives').hidden)),
      JSON.stringify(job && { kind: job.kind, brief: job.brief })
    );
  } else
    ok(
      `[${scheme}] an objective with no questions starts the practice-set job (B-297)`,
      false,
      'every objective has questions'
    );
}
// B-482: Study's Practice sets card for the course: its sets newest first, each with its question count, its score or
// Not started, and its made date; a row opens the set, a finished one offers Retake; a plan task that made a set opens it
async function practiceSetsChecks(page, scheme) {
  await studyView(page, 'objectives');
  await page.waitForTimeout(200);
  const card = await page.evaluate(() => {
    const c = document.getElementById('ov-sets');
    const rows = c ? [...c.querySelectorAll('.st-row')] : [];
    return {
      shown: !!c && !c.hidden && c.getBoundingClientRect().height > 0,
      lab: c ? (c.querySelector('.lab') || {}).textContent : '',
      rows: rows.map(r => ({
        title: r.querySelector('.stt').textContent,
        n: r.querySelector('.sm').textContent,
        s: r.querySelector('.ss').textContent,
        d: r.querySelector('.sd').textContent,
        retake: !!r.querySelector('button.btn'),
      })),
      spill: rows.some(r => r.scrollWidth > r.clientWidth + 1 || r.getBoundingClientRect().right > innerWidth),
      planLinks: document.querySelectorAll('#p-study .pl-set').length,
    };
  });
  ok(
    `[${scheme}] Study shows the course's Practice sets: title, question count, score or Not started, made date; finished ones offer Retake (B-482)`,
    card.shown &&
      card.lab === 'Practice sets' &&
      card.rows.length > 0 &&
      card.rows.every(r => r.title && /^\d+ questions?$/.test(r.n) && /right|done|Not started/.test(r.s) && r.d) &&
      card.rows.every(r => r.retake === / right$/.test(r.s)) &&
      !card.spill,
    JSON.stringify(card)
  );
  await page.locator('#ov-sets').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/study-sets-${scheme}.png` });
  const first = card.rows[0];
  if (first) {
    await page.locator('#ov-sets .st').first().click();
    await page.waitForTimeout(250);
    const opened = await page.evaluate(() => ({
      shown: !document.getElementById('study-practice').hidden,
      title: (document.getElementById('pr-fold') || {}).dataset ? document.getElementById('pr-fold').dataset.set : '',
      count: (document.getElementById('pr-qcount') || {}).textContent,
    }));
    ok(
      `[${scheme}] a Practice sets row opens its set in Study (B-482)`,
      opened.shown && !!opened.count,
      JSON.stringify({ first, opened })
    );
    await closeSet(page);
    await page.waitForTimeout(150);
  }
  if (card.rows.some(r => r.retake)) {
    await page.locator('#ov-sets .st-row button.btn', { hasText: 'Retake' }).first().click();
    await page.waitForTimeout(250);
    const again = await page.evaluate(() => ({
      shown: !document.getElementById('study-practice').hidden,
      count: (document.getElementById('pr-qcount') || {}).textContent,
      answered: document.querySelectorAll('#pr-body .verdict').length,
    }));
    ok(
      `[${scheme}] Retake opens a finished set fresh (B-482)`,
      again.shown && again.answered === 0,
      JSON.stringify(again)
    );
    await closeSet(page);
    await page.waitForTimeout(150);
  }
  // the plan's days open, a drill task that made a set carries Open set, which opens it
  const shut = await page.evaluate(() =>
    [...document.querySelectorAll('#p-study .pl-day')]
      .map((d, i) => (d.classList.contains('open') ? -1 : i))
      .filter(i => i >= 0)
  );
  const toggle = async () => {
    for (const i of shut) {
      await page.locator('#p-study .pl-day .pl-dr').nth(i).click();
      await page.waitForTimeout(100);
    }
  };
  await toggle();
  const link = page.locator('#p-study .pl-t .pl-set').first();
  const linked = (await link.count()) > 0;
  if (linked) {
    await link.click();
    await page.waitForTimeout(250);
  }
  const fromPlan = await page.evaluate(() => ({
    shown: !document.getElementById('study-practice').hidden,
    count: (document.getElementById('pr-qcount') || {}).textContent,
  }));
  ok(
    `[${scheme}] a plan task that made a set opens it from its row (B-482)`,
    linked && fromPlan.shown && !!fromPlan.count,
    JSON.stringify({ linked, ...fromPlan })
  );
  await closeSet(page);
  await page.waitForTimeout(150);
  await toggle(); // the days as they were, for the checks after
}
// B-487 (D-368): Study's Flashcards card lists the course's decks (title, cards, due); a deck opens in its sheet with
// its cards; Flip shows the term, Space reveals it with Again / Hard / Good / Easy and the next interval under each, and
// a rating is one card's write with its new due date; Multiple choice offers 4 definitions, a wrong pick is Again on its
// own and a right one asks Hard / Good / Easy; + New card and Retire write marks; Today carries Cards · n due.
async function flashcardsChecks(page, scheme) {
  await studyView(page, 'objectives');
  await page.waitForTimeout(200);
  const card = await page.evaluate(() => {
    const c = document.getElementById('ov-decks');
    const rows = c ? [...c.querySelectorAll('.st-row')] : [];
    return {
      shown: !!c && !c.hidden && c.getBoundingClientRect().height > 0,
      lab: c ? (c.querySelector('.lab') || {}).textContent : '',
      due: c ? (c.querySelector('.up-head .mini') || {}).textContent : '',
      rows: rows.map(r => ({
        title: r.querySelector('.stt').textContent,
        n: r.querySelector('.sm').textContent,
        s: r.querySelector('.ss').textContent,
      })),
      spill: rows.some(r => r.scrollWidth > r.clientWidth + 1 || r.getBoundingClientRect().right > innerWidth),
    };
  });
  ok(
    `[${scheme}] Study shows the course's Flashcards: each deck's title, card count and due today (B-487)`,
    card.shown &&
      card.lab === 'Flashcards' &&
      card.rows.length > 0 &&
      card.rows.every(r => r.title && /^\d+ cards?$/.test(r.n) && /due|Done for today|No cards/.test(r.s)) &&
      /^\d+ due today$/.test(card.due) &&
      !card.spill,
    JSON.stringify(card)
  );
  await page.locator('#ov-decks').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/study-decks-${scheme}.png` });
  if (!card.rows.length) return;
  const deckId = await page.evaluate(
    t => (Object.entries(window.__db.decks || {}).find(([, d]) => d.title === t) || [''])[0],
    card.rows.some(r => r.title === 'Dosage abbreviations') // the seeded deck, before any deck the checks import
      ? 'Dosage abbreviations'
      : card.rows.find(r => / due$/.test(r.s))
        ? card.rows.find(r => / due$/.test(r.s)).title
        : card.rows[0].title
  );
  const cardsOf = () => page.evaluate(id => JSON.parse(JSON.stringify(window.__db.decks[id].cards)), deckId);
  const before = await cardsOf();
  const deckTitle = await page.evaluate(id => window.__db.decks[id].title, deckId);
  const openIt = async () => {
    await page.evaluate(() => document.getElementById('fc-dlg') && document.getElementById('fc-dlg').close());
    await studyView(page, 'objectives');
    await page.locator(`#ov-decks .st[aria-label="Open deck ${deckTitle}"]`).click();
    await page.waitForTimeout(250);
  };
  await openIt();
  const sheet = await page.evaluate(() => {
    const d = document.getElementById('fc-dlg');
    return {
      open: !!d && d.open,
      title: d ? (d.querySelector('.fc-ht h2') || {}).textContent : '',
      rows: d ? d.querySelectorAll('.fc-list .fc-row').length : 0,
      go: d ? [...d.querySelectorAll('.fc-go .btn')].map(b => b.textContent) : [],
      spill: d ? d.scrollWidth > d.clientWidth + 1 : true,
    };
  });
  const live = Object.values(before).filter(c => !c.retired).length;
  ok(
    `[${scheme}] a deck opens in its sheet: its cards, Flip, Multiple choice, Written and Learn (B-487, B-488)`,
    sheet.open && sheet.rows === live && sheet.go.join() === 'Flip,Multiple choice,Written,Learn' && !sheet.spill,
    JSON.stringify(sheet)
  );
  await page.screenshot({ path: `${shots}/fc-deck-${scheme}.png` });
  // Flip: the term, Space reveals it, four ratings with the next interval under each; Good (key 3) writes the card
  await page.locator('#fc-dlg .fc-go .btn', { hasText: /^Flip/ }).click();
  await page.waitForTimeout(150);
  const term = await page.textContent('#fc-dlg .fc-q');
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  const flip = await page.evaluate(() => ({
    a: (document.querySelector('#fc-dlg .fc-a') || {}).textContent,
    rate: [...document.querySelectorAll('#fc-dlg .fc-rate .btn')].map(
      b => b.querySelector('.fc-rl').textContent + ' ' + b.querySelector('.fc-ri').textContent
    ),
  }));
  ok(
    `[${scheme}] Flip: the term, then on Space its definition and Again / Hard / Good / Easy with the next interval (B-487)`,
    !!term && !!flip.a && flip.rate.length === 4 && /^Again /.test(flip.rate[0]) && /^Easy \d+d$/.test(flip.rate[3]),
    JSON.stringify({ term, ...flip })
  );
  await page.screenshot({ path: `${shots}/fc-flip-${scheme}.png` });
  const cid = Object.keys(before).find(k => before[k].term === term);
  await page.keyboard.press('3');
  await page.waitForTimeout(400);
  const rated = (await cardsOf())[cid] || {};
  const tomorrow = await page.evaluate(() => window.EVCore.addDays(window.EVCore.chicagoDate(new Date()), 1));
  ok(
    `[${scheme}] a rating writes that card's schedule: Good on a new card is due tomorrow (B-487)`,
    rated.last === 'good' &&
      rated.state === 'review' &&
      rated.due === tomorrow &&
      rated.reps === (before[cid].reps || 0) + 1,
    JSON.stringify({ cid, rated })
  );
  // Multiple choice: four definitions; a wrong pick is Again on its own; a right one asks Hard / Good / Easy
  await openIt();
  await page.locator('#fc-dlg .fc-go .btn', { hasText: /^Multiple choice/ }).click();
  await page.waitForTimeout(150);
  const mc = await page.evaluate(id => {
    const q = document.querySelector('#fc-dlg .fc-q').textContent;
    const c = Object.entries(window.__db.decks[id].cards).find(([, x]) => x.term === q);
    const opts = [...document.querySelectorAll('#fc-dlg .fc-opt')].map(b => b.lastChild.textContent);
    return { q, cid: c[0], right: opts.indexOf(c[1].definition), opts };
  }, deckId);
  ok(
    `[${scheme}] Multiple choice: the term with 4 definitions, the right one among them (B-487)`,
    mc.opts.length === 4 && mc.right >= 0 && new Set(mc.opts).size === 4,
    JSON.stringify(mc)
  );
  await page.screenshot({ path: `${shots}/fc-mc-${scheme}.png` });
  await page
    .locator('#fc-dlg .fc-opt')
    .nth(mc.right === 0 ? 1 : 0)
    .click();
  await page.waitForTimeout(400);
  const wrong = await page.evaluate(
    ({ id, cid }) => ({
      marked: !!document.querySelector('#fc-dlg .fc-opt.wrong') && !!document.querySelector('#fc-dlg .fc-opt.right'),
      last: window.__db.decks[id].cards[cid].last,
      next: !!document.querySelector('#fc-dlg .fc-show'),
    }),
    { id: deckId, cid: mc.cid }
  );
  ok(
    `[${scheme}] a wrong pick shows the right one and counts as Again on its own (B-487)`,
    wrong.marked && wrong.last === 'again' && wrong.next,
    JSON.stringify(wrong)
  );
  await page.locator('#fc-dlg .fc-show').click();
  await page.waitForTimeout(150);
  const mc2 = await page.evaluate(id => {
    const q = document.querySelector('#fc-dlg .fc-q');
    if (!q) return null;
    const c = Object.values(window.__db.decks[id].cards).find(x => x.term === q.textContent);
    return [...document.querySelectorAll('#fc-dlg .fc-opt')].map(b => b.lastChild.textContent).indexOf(c.definition);
  }, deckId);
  if (mc2 != null && mc2 >= 0) {
    await page.locator('#fc-dlg .fc-opt').nth(mc2).click();
    await page.waitForTimeout(150);
    const rate = await page.evaluate(() =>
      [...document.querySelectorAll('#fc-dlg .fc-rate .btn .fc-rl')].map(b => b.textContent)
    );
    ok(
      `[${scheme}] a right pick asks Hard / Good / Easy (B-487)`,
      rate.join() === 'Hard,Good,Easy',
      JSON.stringify(rate)
    );
  }
  await writtenLearnChecks(page, scheme, deckId, openIt, cardsOf);
  // + New card and Retire are marks on the deck; nothing is deleted
  await openIt();
  await page.locator('#fc-dlg .fc-lh .btn', { hasText: 'New card' }).click();
  await page.fill('#fc-dlg .fc-form textarea[aria-label="Term"]', 'Harness term');
  await page.fill('#fc-dlg .fc-form textarea[aria-label="Definition"]', 'Harness definition');
  await page.locator('#fc-dlg .fc-form .btn', { hasText: 'Add card' }).click();
  await page.waitForTimeout(400);
  await page.locator('#fc-dlg .fc-form .btn', { hasText: 'Cancel' }).click();
  await page.waitForTimeout(150);
  await page.locator('#fc-dlg .fc-row .btn', { hasText: 'Retire' }).first().click();
  await page.waitForTimeout(400);
  const after = await cardsOf();
  const added = Object.values(after).find(c => c.term === 'Harness term');
  ok(
    `[${scheme}] + New card adds a card due now, Retire marks one retired; nothing is deleted (B-487)`,
    !!added &&
      !added.due &&
      Object.keys(before).every(k => after[k]) &&
      Object.values(after).filter(c => c.retired).length === Object.values(before).filter(c => c.retired).length + 1,
    JSON.stringify({ n: Object.keys(after).length, added })
  );
  await page.evaluate(() => document.getElementById('fc-dlg').close());
  // Today: one Cards · n due item, opening a due-cards session in Flip
  await page.click('#tab-today');
  await page.waitForTimeout(200);
  const row = await page.evaluate(
    () => (document.querySelector('#today-list .ti-cards .ti-t') || {}).textContent || ''
  );
  ok(`[${scheme}] Today shows Cards · n due (B-487)`, /^Cards · \d+ due$/.test(row), row);
  const start = await page.evaluate(() => {
    const b = document.querySelector('#today-list .ti-cards .ti-start');
    const r = b && b.getBoundingClientRect();
    const cs = b && getComputedStyle(b);
    return b ? { w: r.width, h: r.height, right: r.right, vis: cs.visibility, disp: cs.display } : null;
  });
  if (row && scheme === 'phone')
    ok(
      `[${scheme}] Today's Cards row shows Start without a hover, tappable, inside the screen (B-494)`,
      !!start &&
        start.vis === 'visible' &&
        start.disp !== 'none' &&
        start.h >= 44 &&
        start.right <= (await page.evaluate(() => innerWidth)),
      JSON.stringify(start)
    );
  await page.screenshot({ path: `${shots}/fc-today-${scheme}.png` });
  if (row) {
    await page.locator('#today-list .ti-cards .fc-nm').click();
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => {
      const d = document.getElementById('fc-dlg');
      return { open: !!d && d.open, head: d ? (d.querySelector('.fc-ht h2') || {}).textContent : '' };
    });
    ok(
      `[${scheme}] Cards · n due opens a due-cards session in Flip (B-487)`,
      s.open && s.head === 'Flip',
      JSON.stringify(s)
    );
    await page.evaluate(() => document.getElementById('fc-dlg').close());
  }
  // B-495: a line about studying his cards opens the due ones; it starts no flashcards job
  if (row) {
    const jobs0 = await page.evaluate(() => Object.keys(window.__db.jobs || {}).length);
    await page.click('#tab-ev');
    await page.waitForTimeout(150);
    await send(page, 'I need to study my cards for the exam tonight');
    await page.waitForTimeout(400);
    const st = await page.evaluate(() => {
      const d = document.getElementById('fc-dlg');
      return {
        open: !!d && d.open,
        head: d ? (d.querySelector('.fc-ht h2') || {}).textContent : '',
        jobs: Object.keys(window.__db.jobs || {}).length,
      };
    });
    ok(
      `[${scheme}] "study my cards" opens the due cards and starts no flashcards job (B-495)`,
      st.open && st.head === 'Flip' && st.jobs === jobs0,
      JSON.stringify({ jobs0, ...st })
    );
    await page.evaluate(() => document.getElementById('fc-dlg') && document.getElementById('fc-dlg').close());
  }
  await importChecks(page, scheme);
}
// B-489: Import from Quizlet takes pasted export text, previews the first cards and makes a deck of them (no model call,
// nothing sent to Quizlet); a line with no separator is skipped and said so.
async function importChecks(page, scheme) {
  await studyView(page, 'objectives');
  await page.waitForTimeout(150);
  await page.locator('#ov-decks .fc-import').click();
  await page.waitForTimeout(150);
  const paste = [
    'Tachycardia\tHeart rate over 100',
    'Bradycardia\tHeart rate under 60',
    'a line with no tab',
    'Apnea\tNo breathing',
  ];
  await page.fill('#fc-dlg .fc-paste', paste.join('\n'));
  await page.fill('#fc-dlg .fc-ititle', 'Harness import ' + scheme);
  await page.waitForTimeout(120);
  const pv = await page.evaluate(() => ({
    head: (document.querySelector('#fc-dlg .fc-ht h2') || {}).textContent,
    note: (document.querySelector('#fc-dlg .fc-pn') || {}).textContent,
    rows: [...document.querySelectorAll('#fc-dlg .fc-prev .fc-term')].map(x => x.textContent),
    go: (document.querySelector('#fc-dlg .fc-igo') || {}).textContent,
    spill: (d => !d || d.scrollWidth > d.clientWidth + 1)(document.getElementById('fc-dlg')),
  }));
  ok(
    `[${scheme}] Import from Quizlet previews the pasted cards and says what it skipped (B-489)`,
    pv.head === 'Import from Quizlet' &&
      pv.rows.join() === 'Tachycardia,Bradycardia,Apnea' &&
      /^3 cards to import · 1 line without/.test(pv.note || '') &&
      pv.go === 'Import 3 cards' &&
      !pv.spill,
    JSON.stringify(pv)
  );
  await page.screenshot({ path: `${shots}/fc-import-${scheme}.png` });
  await page.locator('#fc-dlg .fc-igo').click();
  await page.waitForTimeout(500);
  const made = await page.evaluate(t => {
    const e = Object.entries(window.__db.decks || {}).find(([, d]) => d.title === t);
    const d = document.getElementById('fc-dlg');
    return {
      deck: e ? { course: e[1].course, source: e[1].source, n: Object.keys(e[1].cards).length } : null,
      open: (d && d.open && (d.querySelector('.fc-ht h2') || {}).textContent) || '',
    };
  }, 'Harness import ' + scheme);
  ok(
    `[${scheme}] Import makes a deck of the pasted cards for the course and opens it (B-489)`,
    !!made.deck &&
      made.deck.n === 3 &&
      made.deck.source === 'Quizlet paste' &&
      made.open === 'Harness import ' + scheme,
    JSON.stringify(made)
  );
  await page.evaluate(() => document.getElementById('fc-dlg') && document.getElementById('fc-dlg').close());
}
// B-488: Written shows the definition and takes the typed term: a miss is Again with the answer and I was right (which
// makes it Good); a near answer shows the right spelling and asks Hard / Good / Easy. Learn climbs each card from
// Multiple choice to Written with a learned-of-total bar, rates each card once, and ends on what was learned. The mode
// last used on a deck is the sheet's primary.
async function writtenLearnChecks(page, scheme, deckId, openIt, cardsOf) {
  const cardOnScreen = () =>
    page.evaluate(id => {
      const q = (document.querySelector('#fc-dlg .fc-q') || {}).textContent;
      const e = Object.entries(window.__db.decks[id].cards).find(
        ([, c]) => !c.retired && (c.definition === q || c.term === q)
      );
      return e ? { id: e[0], term: e[1].term, definition: e[1].definition } : null;
    }, deckId);
  await openIt();
  await page.locator('#fc-dlg .fc-go .btn', { hasText: /^Written$/ }).click();
  await page.waitForTimeout(150);
  const w1 = await cardOnScreen();
  const shown = await page.evaluate(() => ({
    head: (document.querySelector('#fc-dlg .fc-ht h2') || {}).textContent,
    focused: document.activeElement && document.activeElement.classList.contains('fc-type'),
  }));
  await page.screenshot({ path: `${shots}/fc-written-${scheme}.png` });
  await page.fill('#fc-dlg .fc-type', 'zzzz not it');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const miss = await page.evaluate(
    ({ id, cid }) => ({
      res: !!document.querySelector('#fc-dlg .fc-res.wrong'),
      ans: (document.querySelector('#fc-dlg .fc-ans') || {}).textContent,
      over: !!document.querySelector('#fc-dlg .fc-over'),
      last: window.__db.decks[id].cards[cid].last,
    }),
    { id: deckId, cid: w1 && w1.id }
  );
  ok(
    `[${scheme}] Written: the definition with a field for the term; a miss shows the answer, counts Again and offers I was right (B-488)`,
    !!w1 &&
      shown.head === 'Written' &&
      shown.focused &&
      miss.res &&
      miss.ans === w1.term &&
      miss.over &&
      miss.last === 'again',
    JSON.stringify({ w1, shown, miss })
  );
  await page.screenshot({ path: `${shots}/fc-written-miss-${scheme}.png` });
  await page.locator('#fc-dlg .fc-over').click();
  await page.waitForTimeout(400);
  const over = (await cardsOf())[w1 && w1.id] || {};
  ok(
    `[${scheme}] Written: I was right makes it Good (B-488)`,
    over.last === 'good' && over.state === 'review',
    JSON.stringify(over)
  );
  const w2 = await cardOnScreen();
  if (w2) {
    const t = w2.term.length >= 4 ? w2.term.slice(0, -1) : w2.term.toUpperCase() + '.';
    await page.fill('#fc-dlg .fc-type', t);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const near = await page.evaluate(() => ({
      res: (document.querySelector('#fc-dlg .fc-res') || {}).className,
      ans: (document.querySelector('#fc-dlg .fc-ans') || {}).textContent || '',
      rate: [...document.querySelectorAll('#fc-dlg .fc-rate .btn .fc-rl')].map(b => b.textContent),
    }));
    ok(
      `[${scheme}] Written: a typo or a case slip is accepted (near shows the spelling) and asks Hard / Good / Easy (B-488)`,
      /\b(near|exact)\b/.test(near.res) &&
        (!/near/.test(near.res) || near.ans === w2.term) &&
        near.rate.join() === 'Hard,Good,Easy',
      JSON.stringify({ t, ...near })
    );
    await page.screenshot({ path: `${shots}/fc-written-near-${scheme}.png` });
  }
  // Learn: rounds of up to 7; each card MC then Written; its first answer alone writes its rating
  await openIt();
  const primary = await page.evaluate(() => (document.querySelector('#fc-dlg .fc-go .btn.primary') || {}).textContent);
  ok(`[${scheme}] the deck's sheet leads with the mode last used (Written) (B-488)`, primary === 'Written', primary);
  const before = await cardsOf();
  await page.locator('#fc-dlg .fc-go .btn', { hasText: /^Learn$/ }).click();
  await page.waitForTimeout(150);
  const l0 = await page.evaluate(() => ({
    head: (document.querySelector('#fc-dlg .fc-ht h2') || {}).textContent,
    prog: (document.querySelector('#fc-dlg .fc-lpn') || {}).textContent,
    stage: (document.querySelector('#fc-dlg .fc-stage') || {}).textContent,
    opts: document.querySelectorAll('#fc-dlg .fc-opt').length,
  }));
  ok(
    `[${scheme}] Learn starts in Multiple choice with a learned-of-total bar (B-488)`,
    l0.head === 'Learn' && /^0 of \d+ learned$/.test(l0.prog) && l0.stage === 'Multiple choice' && l0.opts >= 2,
    JSON.stringify(l0)
  );
  await page.screenshot({ path: `${shots}/fc-learn-${scheme}.png` });
  const seen = [];
  let wroteShot = false;
  for (let step = 0; step < 40; step++) {
    const st = await page.evaluate(() => {
      const d = document.getElementById('fc-dlg');
      const q = (n => (n ? n.textContent : null))(d.querySelector('.fc-q'));
      return {
        head: (d.querySelector('.fc-ht h2') || {}).textContent,
        q,
        stage: (d.querySelector('.fc-stage') || {}).textContent,
        rate: !!d.querySelector('.fc-rate'),
        cont: !!d.querySelector('.fc-show'),
        type: !!d.querySelector('.fc-type'),
      };
    });
    if (st.head !== 'Learn') break;
    if (st.rate) {
      await page.locator('#fc-dlg .fc-rate .good').click();
    } else if (st.cont) {
      await page.locator('#fc-dlg .fc-show').click();
    } else {
      const c = await cardOnScreen();
      seen.push(st.stage);
      if (st.type) {
        if (!wroteShot) {
          wroteShot = true;
          await page.screenshot({ path: `${shots}/fc-learn-written-${scheme}.png` });
        }
        await page.fill('#fc-dlg .fc-type', c.term);
        await page.keyboard.press('Enter');
      } else {
        const k = await page.evaluate(
          def => [...document.querySelectorAll('#fc-dlg .fc-opt')].map(b => b.lastChild.textContent).indexOf(def),
          c.definition
        );
        await page.locator('#fc-dlg .fc-opt').nth(Math.max(0, k)).click();
      }
    }
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(300);
  const end = await page.evaluate(() => ({
    head: (document.querySelector('#fc-dlg .fc-ht h2') || {}).textContent,
    prog: (document.querySelector('#fc-dlg .fc-lpn') || {}).textContent,
    learned: [...document.querySelectorAll('#fc-dlg .fc-sum .lab')].map(b => b.textContent),
  }));
  const after = await cardsOf();
  const reps = Object.keys(after)
    .filter(k => !after[k].retired)
    .map(k => (after[k].reps || 0) - ((before[k] && before[k].reps) || 0));
  ok(
    `[${scheme}] Learn: each card climbs Multiple choice to Written, is rated once, and the end shows what was learned (B-488)`,
    end.head === 'Learned' &&
      /^(\d+) of \1 learned$/.test(end.prog) &&
      /^Learned · \d+$/.test(end.learned[0] || '') &&
      seen.includes('Multiple choice') &&
      seen.includes('Written') &&
      reps.every(n => n === 0 || n === 1) &&
      reps.filter(n => n === 1).length === Number((end.prog || '').split(' ')[0]),
    JSON.stringify({ end, seen, reps })
  );
  await page.screenshot({ path: `${shots}/fc-learn-end-${scheme}.png` });
  await page.evaluate(() => document.getElementById('fc-dlg').close());
}
async function workLineChecks(page, scheme) {
  const tag = `[${scheme}] `;
  await page.click('#tab-ev');
  // The two jobs, planted now through the record (a seed would change the briefing and the Working rows earlier on).
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const iso = ms => new Date(Date.now() + ms).toISOString();
    const env = (writer, at) => ({ schema: 2, writer, at, source: writer === 'page' ? 'E.V. Home' : 'worker x' });
    for (const [id, title, res] of [
      [
        'job-harness-work-run',
        'Writing 5 questions on what’s due soonest',
        { status: 'running', startedAt: iso(-60e3), finishedAt: null, result: null },
      ],
      [
        'job-harness-work-done',
        'Practice set: fluids, 10 questions',
        {
          status: 'done',
          startedAt: iso(-10 * 60e3),
          finishedAt: iso(-10 * 60e3 + 40e3),
          result: { text: 'Ten questions on fluids.', setId: 'drill-E4-ch39' },
        },
      ],
    ]) {
      await db
        .collection('jobs')
        .doc(id)
        .set({
          ...env('page', iso(-11 * 60e3)),
          kind: 'practice-set',
          title,
          brief: title,
          fired: { at: iso(-11 * 60e3), ok: true },
        });
      await db
        .collection('jobresults')
        .doc(id)
        .set({
          ...env('worker', iso(-30e3)),
          release: window.__db.system.manifest.release,
          ...res,
          message: null,
          error: null,
        });
    }
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__chatPre = '';
    window.__chatScript = [
      { tool: 'show_card', input: { type: 'job', id: 'job-harness-work-run' } },
      { tool: 'show_card', input: { type: 'job', id: 'job-harness-work-done' } },
    ];
    window.__chatReply = 'Here are both.';
  });
  await send(page, 'How are my practice jobs going?');
  await page.waitForTimeout(400);
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll('#ev-surf .sf-head, #ev-surf .sf-row')].map(b => ({
      t: b.textContent.trim(),
      h: Math.round(b.getBoundingClientRect().height),
    }))
  );
  const run = lines.find(l => /Writing 5 questions/.test(l.t)),
    done = lines.find(l => /Worked for/.test(l.t));
  ok(
    `${tag}B-227: a running job's line is its one-line plan`,
    !!run && run.t === 'Writing 5 questions on what’s due soonest' && run.h <= 44,
    JSON.stringify(lines)
  );
  ok(
    `${tag}B-227: a finished job is one line, at most 44 px, with how long it worked`,
    !!done && /^Practice set · Worked for 40 s$/.test(done.t) && done.h <= 44,
    JSON.stringify(lines)
  );
  await page.locator('#ev-surf .sf-row', { hasText: 'Worked for' }).click();
  await page.waitForTimeout(200);
  await page.locator('#ev-surf .work-line').click();
  await page.waitForTimeout(200);
  const link = page.locator('#ev-surf .work-changes .tlink').first();
  const label = (await link.count()) ? (await link.textContent()).trim() : '';
  await page
    .locator('#ev-surf')
    .first()
    .screenshot({ path: `${shots}/work-job-${scheme}.png` });
  if (label) await link.click();
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => ({
    study: !document.getElementById('p-study').hidden,
    practice: !document.getElementById('study-practice').hidden,
  }));
  ok(
    `${tag}B-227: opened, the job's change is a link that opens its place`,
    /^Practice: /.test(label) && opened.study && opened.practice,
    JSON.stringify({ label, opened })
  );
  // A reply whose tool filed an idea: its message carries how long it took and the idea, which opens Record › Sessions.
  await page.click('#tab-ev');
  await page.evaluate(() => {
    window.__chatPre = '';
    window.__chatScript = [
      { tool: 'save_idea', input: { text: 'Harness work idea: albumin holds fluid in the vessels', kind: 'learning' } },
    ];
    window.__chatReply = 'Saved that idea.';
  });
  await send(page, 'Save this: albumin holds fluid in the vessels');
  await page.waitForTimeout(500);
  const m = (await msgs(page)).filter(x => x.role === 'ev').pop();
  ok(
    `${tag}B-227: the reply that filed an idea stores its work (ms and the idea it changed)`,
    !!m &&
      m.work &&
      Number.isInteger(m.work.ms) &&
      m.work.changed.length === 1 &&
      /^ideas\/idea-/.test(m.work.changed[0]),
    JSON.stringify(m && m.work)
  );
  const wl = page.locator('#thread .msg.ev').last().locator('.work-line');
  const wlh = (await wl.count()) ? await wl.evaluate(e => Math.round(e.getBoundingClientRect().height)) : null;
  ok(
    `${tag}B-227: her line carries one work line, at most 44 px`,
    wlh != null && wlh <= 44 && /^Worked for \d+ s$/.test((await wl.textContent()).trim()),
    String(wlh)
  );
  if (wlh != null) await wl.click();
  await page.waitForTimeout(200);
  const il = page.locator('#thread .msg.ev').last().locator('.work-changes .tlink').first();
  const ilabel = (await il.count()) ? (await il.textContent()).trim() : '';
  await page
    .locator('#thread .msg.ev')
    .last()
    .screenshot({ path: `${shots}/work-reply-${scheme}.png` });
  if (ilabel) await il.click();
  await page.waitForTimeout(300);
  const rec = await page.evaluate(() => ({
    record: !document.getElementById('p-record').hidden,
    sessions: !document.getElementById('record-sessions').hidden,
  }));
  ok(
    `${tag}B-227: opened, the idea is a link that opens Record, Sessions`,
    /^Idea: Harness work idea/.test(ilabel) && rec.record && rec.sessions,
    JSON.stringify({ ilabel, rec })
  );
  await page.click('#tab-ev');
}
/** B-180, at the width it runs: the build card's states, the build ask (no model call, the job, the builder fired by
 * id with the two-line text, both lines in talk). */
// B-191: an open set closes back to Objectives with its answers kept and reopens where he left; B-365 (D-316) walks it
// in order, each one-answer question graded on the tap. Run at both widths from Study, Practice with a set open.
async function practiceNav(page, scheme) {
  // B-303 (D-283): no list of sets; a set opens from a row of today's list, and folds back to Objectives
  const openSet = async title => openSetById(page, await byTitle(page, title));
  await closeSet(page);
  await page.waitForTimeout(150);
  ok(
    `[${scheme}] the open set closes back to Objectives (All topics, B-348), with no list of sets (D-283)`,
    !(await page.isVisible('#study-back')) &&
      (await page.isVisible('#study-objectives')) &&
      !(await page.locator('#pr-body .pr-lead, #pr-body .pr-item').count()) &&
      !(await page.isVisible('#pr-body .q-stem')),
    (await page.textContent('#pr-body')).slice(0, 120)
  );
  const navId = 'more-' + today + '-nav';
  const q = () =>
    page.evaluate(() => ({
      stem: (document.querySelector('#pr-body .q-stem') || {}).textContent || '',
      verdict: (document.querySelector('#pr-body .verdict') || {}).textContent || '',
      whys: [...document.querySelectorAll('#pr-body .why:not([hidden])')].map(x => x.textContent),
      check:
        // open to answer: its options and no verdict (B-365: a one-answer question has no Check answer)
        !!document.querySelector('#pr-body label.opt') && !document.querySelector('#pr-body .verdict'),
      back: !!document.querySelector('#pr-body .q-back'),
      next: !!document.querySelector('#pr-body .q-next'),
      count: (document.getElementById('pr-qcount') || {}).textContent || '',
      sideways: document.documentElement.scrollWidth > innerWidth + 1,
    }));
  // B-365 (D-316): in Study a one-answer question grades on the tap, with no Back, no skip and no Check answer, as
  // the demo's StudyQuiz: the set walks in order, Next question (or Enter) after each verdict.
  await openSet('Harness nav');
  await page.waitForTimeout(150);
  let v = await q();
  ok(
    `[${scheme}] a fresh set opens on question 1, open to answer, with no Back and no skip (B-365)`,
    /question 1/.test(v.stem) && v.check && !v.next && !v.back,
    JSON.stringify(v)
  );
  await page.locator('#pr-body label.opt', { hasText: 'Erikson' }).click();
  await page.waitForTimeout(150);
  v = await q();
  ok(
    `[${scheme}] the tap answers it: Right with its why, question 1 of 3`,
    /question 1/.test(v.stem) && /^Right\b/.test(v.verdict) && /^Question 1 of 3\b/.test(v.count),
    JSON.stringify(v)
  );
  await page.screenshot({ path: `${shots}/practice-nav-answered-${scheme}.png` });
  await page.click('#pr-body button:has-text("Next question")');
  await page.waitForTimeout(120);
  v = await q();
  ok(`[${scheme}] Next question: question 2, open to answer`, /question 2/.test(v.stem) && v.check, JSON.stringify(v));
  await closeSet(page);
  await page.waitForTimeout(150);
  const saved = await page.evaluate(id => Object.keys(((window.__db.answers || {})[id] || {}).answers || {}), navId);
  ok(`[${scheme}] closed mid-set, the answer is kept`, JSON.stringify(saved) === '["v1"]', JSON.stringify(saved));
  await openSet('Harness nav');
  await page.waitForTimeout(150);
  v = await q();
  ok(`[${scheme}] reopened, it is where he left it`, /question 2/.test(v.stem) && v.check, JSON.stringify(v));
  await page.locator('#pr-body label.opt', { hasText: 'Piaget' }).click();
  await page.waitForTimeout(150);
  await page.click('#pr-body button:has-text("Next question")');
  await page.waitForTimeout(100);
  await page.locator('#pr-body label.opt', { hasText: 'Kohlberg' }).click();
  await page.waitForTimeout(150);
  await page.locator('#pr-body button', { hasText: 'See results' }).first().click();
  await page.waitForTimeout(150);
  ok(
    `[${scheme}] the last answer brings the results`,
    /3 of 3/.test(await page.textContent('#pr-body')) && !v.sideways,
    (await page.textContent('#pr-body')).slice(0, 160)
  );
  await page.screenshot({ path: `${shots}/practice-nav-done-${scheme}.png` });
  await page.click('#study-back'); // B-303: the toolbar's way back, now the summary has no All sets
  await page.waitForTimeout(150);
  // B-193 (D-205): a question on another course's passage names its source under the stem, from the data, once the
  // library is open (the page never loads it just for this). B-359 (D-316): Record's Library screen left the page, so
  // the library may not be open here: the stem then names no source, and never a wrong one.
  await openSet('Harness cross');
  await page.waitForFunction(() => document.querySelector('#pr-body .q-src'), null, { timeout: 8000 }).catch(() => {});
  const src = await page.textContent('#pr-body .q-src').catch(() => '');
  ok(
    `[${scheme}] a NUR question on a BIO passage names its source, From BIO 201: Bones slides, or none before the library opens`,
    src === 'From BIO 201: Bones slides' || src === '',
    src
  );
  await page.screenshot({ path: `${shots}/practice-cross-${scheme}.png` });
  await closeSet(page);
  await page.waitForTimeout(150);
}
async function buildAskChecks(page, scheme) {
  const tag = `[${scheme}] `;
  for (const [id, want] of [
    [
      'job-harness-build-green',
      /Filed\s*As B-201[\s\S]*Built\s*Staging green at abc1234[\s\S]*What waits\s*Say ship it/,
    ],
    [
      'job-harness-build-failed',
      /Filed\s*As B-202[\s\S]*Built\s*Stopped before staging[\s\S]*Where it stopped\s*npm test failed/,
    ],
  ]) {
    await page.evaluate(i => {
      window.__chatPre = '';
      window.__chatScript = [{ tool: 'show_card', input: { type: 'job', id: i } }];
      window.__chatReply = 'Here it is.';
    }, id);
    await send(page, 'Show me that build');
    await page.waitForTimeout(300);
    const t = await page.locator('#ev-surf').textContent();
    ok(
      `${tag}a build job's card (${id}) shows filed, built and what waits from its trace`,
      want.test(t),
      t.slice(0, 300)
    );
    await page
      .locator('#ev-surf')
      .first()
      .screenshot({ path: `${shots}/build-card-${id.split('-')[3]}-${scheme}.png` });
  }
  const count = () =>
    page.evaluate(() => ({
      jobs: Object.keys(window.__db.jobs || {}),
      fires: window.__mcpCalls.filter(c => c[1] === 'fire_trigger').length,
      chats: window.__chatCalls.length,
    }));
  const typed = 'bug: the timer resets when I switch tabs';
  const before = await count();
  const m0 = (await msgs(page)).length;
  await send(page, typed);
  await page.waitForTimeout(400);
  const after = await count();
  const id = after.jobs.find(k => !before.jobs.includes(k));
  const job = id ? await page.evaluate(i => window.__db.jobs[i], id) : null;
  ok(
    `${tag}a build ask writes the build job in his words, with no model call`,
    job &&
      job.kind === 'build' &&
      job.writer === 'page' &&
      job.schema === 2 &&
      job.title === typed &&
      job.brief === typed &&
      job.fired &&
      job.fired.ok === true &&
      after.chats === before.chats,
    JSON.stringify({ id, job, chats: [before.chats, after.chats] })
  );
  const fire = await page.evaluate(n => window.__mcpCalls.filter(c => c[1] === 'fire_trigger')[n], before.fires);
  ok(
    `${tag}it fires the builder by id with "Job <id>" and his message as typed`,
    after.fires === before.fires + 1 &&
      fire &&
      fire[0] === 'Claude Code Remote' &&
      fire[2].trigger_id === spec.tasks.build['ev4-builder'].trigger &&
      fire[2].text === `Job ${id}\n${typed}`,
    JSON.stringify(fire)
  );
  const m = await msgs(page);
  const [mine, hers] = m.slice(-2);
  ok(
    `${tag}his message and her reply land in talk, hers with the job card`,
    m.length === m0 + 2 &&
      mine.role === 'matt' &&
      mine.text === typed &&
      hers.role === 'ev' &&
      /Sent to the builder/.test(hers.text) &&
      hers.cards.some(c => c.type === 'job' && c.id === id),
    JSON.stringify(m.slice(-2)).slice(0, 300)
  );
  const surf = await page.locator('#ev-surf').textContent();
  ok(
    `${tag}the new build's card says it is queued for the builder`,
    /^bug: the timer resets when I switch tabs · queued/.test(surf.trim()) && /Sent to the builder at/.test(surf), // B-227: its plan
    surf.slice(0, 200)
  );
  await page.screenshot({ path: `${shots}/build-ask-${scheme}.png` });
  // B-290 (P-5): "idea: …" still files a build request; "note: …" saves his words in Record's ideas, the same save as
  // New › Note, with no model call, no job and no fire.
  {
    const b = await count();
    await send(page, 'idea: show the week on Today');
    await page.waitForTimeout(400);
    const a = await count();
    const iid = a.jobs.find(k => !b.jobs.includes(k));
    const ij = iid ? await page.evaluate(i => window.__db.jobs[i], iid) : null;
    ok(
      `${tag}"idea: …" still files a build request and fires the builder (B-290)`,
      ij &&
        ij.kind === 'build' &&
        ij.title === 'idea: show the week on Today' &&
        a.fires === b.fires + 1 &&
        a.chats === b.chats,
      JSON.stringify(ij)
    );
    const ideas0 = await page.evaluate(() => Object.keys(window.__db.ideas || {}));
    await send(page, 'note: rounding to tenths');
    await page.waitForTimeout(400);
    const n = await page.evaluate(k0 => {
      const k = Object.keys(window.__db.ideas || {}).find(x => !k0.includes(x));
      return k ? window.__db.ideas[k] : null;
    }, ideas0);
    const c = await count();
    const [mine, hers] = (await msgs(page)).slice(-2);
    ok(
      `${tag}"note: rounding to tenths" lands in ideas as his note, with no model call, job or fire (B-290)`,
      n &&
        n.text === 'rounding to tenths' &&
        n.status === 'open' &&
        c.jobs.length === a.jobs.length &&
        c.fires === a.fires &&
        c.chats === a.chats &&
        mine.text === 'note: rounding to tenths' &&
        /Saved to Record as a note/.test(hers.text),
      JSON.stringify({ n, hers })
    );
  }
  // B-183 (D-197): "design: <theme>" and "file: <doc link>" are builder jobs of their own kinds, fired like a build ask;
  // the builder's trace lands the kickoff as her line with a Copy chip that copies it exactly.
  const b2 = await count();
  await send(page, 'design: voice in');
  await page.waitForTimeout(400);
  const a2 = await count();
  const did = a2.jobs.find(k => !b2.jobs.includes(k));
  const dj = did ? await page.evaluate(i => window.__db.jobs[i], did) : null;
  ok(
    `${tag}"design: voice in" writes a design job with the theme and fires the builder`,
    dj && dj.kind === 'design' && dj.brief === 'voice in' && a2.fires === b2.fires + 1 && a2.chats === b2.chats,
    JSON.stringify(dj)
  );
  await send(page, 'file: https://claude.ai/artifact/AbCdEfGhIjKlMnOpQrStUv');
  await page.waitForTimeout(400);
  const a3 = await count();
  const pid = a3.jobs.find(k => !a2.jobs.includes(k));
  const pj = pid ? await page.evaluate(i => window.__db.jobs[i], pid) : null;
  ok(
    `${tag}"file: <doc link>" writes a plan job with the link and fires the builder`,
    pj &&
      pj.kind === 'plan' &&
      pj.brief === 'https://claude.ai/artifact/AbCdEfGhIjKlMnOpQrStUv' &&
      a3.fires === a2.fires + 1,
    JSON.stringify(pj)
  );
  // A kickoff as long as a real one: the template with its slots named.
  const kickoff = fs
    .readFileSync(path.join(root, 'tools/kickoff.md'), 'utf8')
    .replace(/^<!--[\s\S]*?-->\n/, '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => `[${k}]`)
    .trim();
  await page.evaluate(
    async ([job, text]) => {
      window.__copied = null;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async t => void (window.__copied = t) },
      });
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
      const at = new Date().toISOString();
      const key = 'm-' + at.replace(/\D/g, '').slice(0, 8) + '-' + at.replace(/\D/g, '').slice(8, 17) + '-job';
      const db = await window.claude.use('db');
      await db
        .collection('talk')
        .doc(day)
        .update({
          messages: {
            [key]: { role: 'ev', text, cards: [{ type: 'job', id: job }, { type: 'copy' }], at, jobId: job },
          },
        });
    },
    [did, kickoff]
  );
  await page.waitForTimeout(500);
  const chip = page.locator('#thread .copy-chip').last();
  const shown = (await chip.count()) === 1 && (await chip.isVisible());
  if (shown) await chip.click();
  await page.waitForTimeout(200);
  ok(
    `${tag}the kickoff lands as her line with a Copy chip that copies it as written, and no surface for it`,
    shown && (await page.evaluate(() => window.__copied)) === kickoff && (await chip.textContent()) === 'Copied',
    String(await page.evaluate(() => window.__copied))
  );
  await page.screenshot({ path: `${shots}/kickoff-copy-${scheme}.png` });
  // B-185 (D-198): Ship it shows only on a build that is staging green at the commit staging runs now; its tap asks
  // once, then writes a ship job naming that commit and its task and fires the builder with it.
  const showJob = async i => {
    await page.evaluate(i => {
      window.__chatPre = '';
      window.__chatScript = [{ tool: 'show_card', input: { type: 'job', id: i } }];
      window.__chatReply = 'Here it is.';
    }, i);
    await send(page, 'Show me that build');
    await page.waitForTimeout(300);
  };
  const shipBtn = () => page.locator('#ev-surf button', { hasText: /^Ship it \(/ });
  await showJob('job-harness-build-green');
  ok(`${tag}no Ship it while staging runs another commit`, (await shipBtn().count()) === 0);
  const setManifest = c =>
    page.evaluate(async c => {
      const m = JSON.parse(JSON.stringify(window.__db.system.manifest));
      m.commit = c;
      const db = await window.claude.use('db');
      await db.collection('system').doc('manifest').set(m);
    }, c);
  const was = await page.evaluate(() => window.__db.system.manifest.commit);
  await setManifest('abc1234def' + '0'.repeat(30));
  await showJob('job-harness-build-failed');
  ok(`${tag}no Ship it on a build that stopped before staging`, (await shipBtn().count()) === 0);
  await showJob('job-harness-build-green');
  ok(`${tag}Ship it names the commit on a build that is staging green at it`, (await shipBtn().count()) === 1);
  await page
    .locator('#ev-surf')
    .first()
    .screenshot({ path: `${shots}/ship-chip-${scheme}.png` });
  const b4 = await count();
  await shipBtn().click();
  await page.waitForTimeout(150);
  const ask = await page.locator('#ev-surf .ship-ask').textContent();
  const mid = await count();
  ok(
    `${tag}the tap asks once, naming the commit and its task, and writes nothing yet`,
    /^Ship abc1234 \(B-201\) to live\? This tap is your OK\.$/.test(ask) && mid.jobs.length === b4.jobs.length,
    ask
  );
  await page.locator('#ev-surf button', { hasText: /^Ship$/ }).click();
  await page.waitForTimeout(400);
  const a4 = await count();
  const sid = a4.jobs.find(k => !b4.jobs.includes(k));
  const sj = sid ? await page.evaluate(i => window.__db.jobs[i], sid) : null;
  const sf = await page.evaluate(n => window.__mcpCalls.filter(c => c[1] === 'fire_trigger')[n], b4.fires);
  ok(
    `${tag}Ship writes a ship job for that commit and task (his OK) and fires the builder with it`,
    sj &&
      sj.kind === 'ship' &&
      sj.writer === 'page' &&
      sj.commit === 'abc1234def' &&
      JSON.stringify(sj.tasks) === '["B-201"]' &&
      sj.brief === 'ship it' &&
      sf &&
      sf[2].text === `Job ${sid}\nship it abc1234`,
    JSON.stringify({ sj, sf })
  );
  await showJob('job-harness-build-green');
  ok(
    `${tag}once sent, the card says so and offers no second tap`,
    (await shipBtn().count()) === 0 && /Ship it sent for abc1234/.test(await page.locator('#ev-surf').textContent())
  );
  await setManifest(was);
}
// B-194: a second plan in force (a dosage plan), dated well ahead so it adds nothing to today.
const later = new Date(DAYTIME.getTime() + 20 * 864e5).toISOString().slice(0, 10);
seed.plans = seed.plans || {};
seed.plans['ATI-DOSE'] = {
  ...env('worker', 'Exam plan job', fourHoursAgo),
  exam: 'ATI-DOSE',
  title: 'Dosage plan (harness)',
  days: [
    {
      date: later,
      label: 'Later',
      dayLabel: '',
      tasks: [{ id: 'dose-1', kind: 'drill', text: '10 min: conversions' }],
    },
  ],
};
seed.jobs['job-harness-retro'] = {
  schema: 2,
  writer: 'page',
  at: hourAgo,
  source: 'E.V. Home',
  kind: 'exam-retro',
  title: 'Retro: Harness Exam 3',
  brief: 'E3H: the retro after the score he entered',
  fired: { at: '2026-10-01T15:00:01Z', ok: true },
};
seed.jobresults['job-harness-reply-failed'] = {
  ...env('worker', 'builder harness', '2026-10-10T15:20:00Z'),
  release: RELEASE,
  status: 'failed',
  startedAt: '2026-10-10T15:05:00Z',
  finishedAt: '2026-10-10T15:20:00Z',
  result: null,
  message: null,
  error: null,
};
seed.jobresults['job-harness-retro'] = {
  schema: 1,
  writer: 'worker',
  at: hourAgo,
  source: 'worker harness',
  release: RELEASE,
  status: 'done',
  startedAt: '2026-10-01T15:02:00Z',
  finishedAt: '2026-10-01T15:05:00Z',
  message: null,
  error: null,
  result: {
    text: 'You scored 90, two points above my range. I underrated you.',
    links: [],
    retro: {
      examId: 'E3H',
      title: 'Harness Exam 3',
      date: '2026-09-30',
      score: 90,
      prediction: { predictedRange: [80, 88], basis: 'made up' },
      calibration: { score: 90, predictedRange: [80, 88], inRange: false, error: 6 },
      practice: {
        answered: 10,
        right: 7,
        pct: 70,
        byObjective: [
          { id: 'E3-2', text: '', right: 2, n: 4, pct: 50 },
          { id: 'E3-1', text: '', right: 5, n: 6, pct: 83.3 },
        ],
      },
      weakSpots: { solid: 2, open: 1, openTopics: [{ topic: 'Made-up topic', objective: 'E3-2', recurrence: 1 }] },
      plan: { tasks: 4, ticked: 3, left: [{ date: '2026-09-29', text: 'Practice sim', kind: 'sim' }] },
    },
  },
};
const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8'));
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
// The page as the platform serves it: the shell inside its skeleton at the artifact's origin, its files beside it.
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const skeleton = b =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  b +
  '</body></html>';
// The page's clock starts at 2pm Central today and runs from there, so the greeting and its chips are the afternoon's
// whatever time the harness runs (v3's ran in the daytime by habit).
// B-450 (D-354, D-357): the study plan in Study's overview at 1280 and 390, on two planted drafts in B-449's shape: E4's
// (the next exam: its objectives fold to one line, its tasks carry badges, one has none) and E5's (a later exam, with
// E.V.'s one question). Then the plan settings, Approve, a tick and the done count. Ends with E4's plan as it was.
async function studyPlanChecks(page) {
  const pickCourse = async c => {
    await page.$eval(`#study-course button[aria-label="${c}"]`, b => b.click());
    await page.waitForTimeout(250);
  };
  // a plan for no exam (the dosage plan, B-194) shows on a course tab with no exam ahead too (BIO 201 here)
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.click('#tab-study');
  await page.waitForTimeout(300);
  await pickCourse('BIO 201');
  const bio = await page.evaluate(() => ({
    exam: !!document.querySelector('#ov-card .ov-ex') && /No exam/.test(document.getElementById('ov-card').textContent),
    cards: [...document.querySelectorAll('#ov-plans:not([hidden]) .pl-card')].map(c => c.dataset.plan),
  }));
  ok(
    'a plan for no exam shows on a course tab with no exam ahead (B-450)',
    bio.cards.includes('ATI-DOSE'),
    JSON.stringify(bio)
  );
  await pickCourse('NUR 112');
  const d = n => new Date(Date.parse(today + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const at = new Date(DAYTIME.getTime() - 3600e3).toISOString();
  const T = (id, text, tag, kind, minutes) => ({
    id,
    text,
    ...(tag ? { tag } : {}),
    kind,
    minutes,
    doneWhen: 'Done when ' + id,
  });
  const e4 = {
    schema: 1,
    writer: 'worker',
    at,
    source: 'Exam plan job',
    exam: 'E4',
    title: 'Exam 4 plan',
    section: { course: 'NUR 112', from: today, to: d(2) },
    score: { criteria: [5, 5, 5, 4, 5, 3, 4, 4], total: 88 },
    openQuestions: ['Is Ch 39 on the exam?'],
    days: [
      {
        date: today,
        label: 'Harness day',
        tasks: [
          T('h1', 'Harness graded module', 'graded', 'graded', 60),
          T('h2', 'Harness preview', 'learn', 'reading', 25),
          T('h3', 'Harness drill', 'practice', 'drill', 20),
          T('h4', 'Harness skills run', 'skills-prep', 'other', 30),
          T('h5', 'Harness untagged task', null, 'other', 10),
        ],
      },
      {
        date: d(1),
        // B-450: an older plan's habit, its date as the label (the row shows the date once, then the theme)
        label:
          ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d(1) + 'T12:00:00Z').getUTCDay()] +
          ' ' +
          Number(d(1).slice(5, 7)) +
          '/' +
          Number(d(1).slice(8)),
        dayLabel: 'Harness taper',
        tasks: [
          T('h6', 'Harness second pass', 'review', 'review', 30),
          T('h7', 'Harness terminology', 'practice', 'terminology', 10),
        ],
      },
    ],
  };
  const e5 = {
    schema: 1,
    writer: 'worker',
    at,
    source: 'Exam plan job',
    exam: 'E5',
    title: 'Exam 5 plan',
    section: { course: 'NUR 112', from: d(3), to: d(10) },
    score: { criteria: [5, 5, 5, 4, 5, 3, 4, 4], total: 86 },
    days: [
      {
        date: d(3),
        label: 'Harness E5 day',
        tasks: [T('k1', 'Harness E5 clinical prep', 'clinical-prep', 'other', 20)],
      },
    ],
  };
  await page.evaluate(
    async ({ e4, e5, at }) => {
      const db = await window.claude.use('db');
      await db.collection('plans').doc('E4-H2').set(e4);
      await db.collection('plans').doc('E5').set(e5);
      const asked = new Date(Date.parse(at) + 60e3).toISOString(); // E.V.'s question came after the draft
      await db.collection('jobs').doc('job-harness-plan-ask').set({
        schema: 2,
        writer: 'page',
        at: asked,
        source: 'E.V. Home',
        kind: 'exam-plan',
        title: 'Plan changes',
        brief: 'Lighter weekends',
        revise: 'E5',
      });
      await db
        .collection('jobresults')
        .doc('job-harness-plan-ask')
        .set({
          schema: 1,
          writer: 'worker',
          at: asked,
          source: 'worker harness',
          status: 'done',
          startedAt: asked,
          finishedAt: asked,
          result: { text: 'Which hours do you work this weekend?', asked: true },
        });
    },
    { e4, e5, at }
  );
  await page.click('#tab-study');
  await page.waitForTimeout(400);
  await objFold(page, false); // an earlier check may have left them open
  for (const w of [1280, 390]) {
    await page.setViewportSize(w === 390 ? { width: 390, height: 844 } : { width: 1280, height: 860 });
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const vis = e => !!e && e.getClientRects().length > 0 && !e.closest('[hidden]');
      const card = document.querySelector('#ov-plans .pl-card.dr[data-plan="E4-H2"]');
      const sum = [
        ...document.querySelectorAll('#study-side .plan-sum, #ov-plans .pl-card.dr[data-plan="E4-H2"] > .plan-sum'),
      ].find(vis);
      const open = card && card.querySelector('.pl-day.open');
      return {
        settings: vis(document.getElementById('study-planset')),
        fold: (document.querySelector('#ov-card .fold-line.pm-more') || {}).textContent || '',
        objRows: [...document.querySelectorAll('#ov-card .ov')].filter(vis).length,
        draft: !!card && /Draft/.test((card.querySelector('.pl-head .badge.proposed') || {}).textContent || ''),
        sumIn: sum ? (sum.closest('#study-side') ? 'panel' : 'card') : null,
        score: sum ? (sum.querySelector('.big') || {}).textContent : '',
        approve: sum ? vis([...sum.querySelectorAll('button')].find(b => /Approve/.test(b.textContent))) : false,
        badges: open
          ? [...open.querySelectorAll('.pl-t')].map(li => [...li.querySelectorAll('.badge')].map(b => b.textContent))
          : [],
        ticksOff: open ? [...open.querySelectorAll('.pl-t input.tick')].every(t => t.disabled) : false,
        counts: card ? [...card.querySelectorAll('.pl-filter button')].map(b => b.textContent) : [],
        ask: [...document.querySelectorAll('#ov-plans .pm-ask .q')].map(q => q.textContent),
        later: [...document.querySelectorAll('#ov-plans .ov-card .ov-ex')].map(e => e.textContent),
        e5: !!document.querySelector('#ov-plans .pl-card.dr[data-plan="E5"]'),
        sideways: document.documentElement.scrollWidth > innerWidth,
        labels: card ? [...card.querySelectorAll('.pl-dr')].map(b => b.querySelector('.lb').textContent) : [],
        weight: card ? getComputedStyle(card.querySelector('.pl-t .title')).fontWeight : '',
        e4cards: [...document.querySelectorAll('#ov-plans .pl-card')]
          .filter(c => /^E4/.test(c.dataset.plan))
          .map(c => c.dataset.plan),
        swap: card ? (card.querySelector('.pl-swap') || {}).textContent : '',
        e5sum: vis(document.querySelector('#ov-plans .pl-card.dr[data-plan="E5"] > .plan-sum .pm-act')),
        dosefoot: vis(
          [...document.querySelectorAll('#ov-plans .pl-card[data-plan="ATI-DOSE"] .pl-foot button')].find(b =>
            /Ask for changes/.test(b.textContent)
          )
        ),
        bar: ['study-qquiz', 'study-qweak', 'study-start'].map(id => {
          const b = document.getElementById(id),
            r = b.getBoundingClientRect();
          return {
            id,
            l: Math.round(r.left),
            r: Math.round(r.right),
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            clip: b.scrollWidth > b.clientWidth + 1,
            t: b.textContent.trim(),
            shown: vis(b),
          };
        }),
      };
    });
    ok(
      `[${w}] a day labelled with its date shows the date once, then its theme (B-450)`,
      m.labels[1] === 'Harness taper',
      JSON.stringify(m.labels)
    );
    ok(`[${w}] plan task titles are regular weight, as the mock (B-450)`, m.weight === '400', m.weight);
    ok(
      `[${w}] one card per exam: the draft, with a switch to the approved version (B-450)`,
      JSON.stringify(m.e4cards) === '["E4-H2"]' && m.swap === 'Approved version',
      JSON.stringify([m.e4cards, m.swap])
    );
    ok(
      `[${w}] a card whose summary is not in the panel keeps its actions: E5's draft and the dosage plan (B-450)`,
      m.e5sum && m.dosefoot,
      JSON.stringify([m.e5sum, m.dosefoot])
    );
    if (w === 390) {
      // Row-aware: the buttons may wrap (CI's fonts put Start session on its own row); on each row none overlaps and
      // each is 4 px clear of the last, nothing is clipped and all three are shown inside the 390 viewport.
      const probs = rowProblems(m.bar, { gap: 4, width: 390 });
      ok(
        '[390] the toolbar of Quiz me, Weak spots and Start session: all shown, nothing clipped, a gap between each on its row (B-450)',
        m.bar.length === 3 && !probs.length && / new$|^Weak spots( · \d+)?$/.test(m.bar[1].t),
        JSON.stringify([probs, m.bar])
      );
    }
    ok(`[${w}] the Study toolbar has the plan settings`, m.settings);
    ok(
      `[${w}] under a study plan the exam's objectives fold to one line`,
      /^6 objectives · /.test(m.fold) && m.objRows === 0,
      m.fold + ' / ' + m.objRows
    );
    ok(
      `[${w}] a draft is marked Draft, its score and Approve ${w === 1280 ? 'in the right panel' : 'heading its card'}`,
      m.draft && m.sumIn === (w === 1280 ? 'panel' : 'card') && /^88/.test(m.score) && m.approve,
      JSON.stringify(m).slice(0, 300)
    );
    ok(
      `[${w}] each task shows one badge from the set, an untagged one none, and a draft's ticks wait for Approve (D-357)`,
      m.badges.length === 5 &&
        JSON.stringify(m.badges) === JSON.stringify([['Graded'], ['Learn'], ['Practice'], ['Skills prep'], []]) &&
        m.ticksOff,
      JSON.stringify(m.badges)
    );
    ok(
      `[${w}] the per-badge counts`,
      JSON.stringify(m.counts) ===
        JSON.stringify(['All7', 'Graded1', 'Learn1', 'Practice2', 'Review1', 'Skills prep1']),
      JSON.stringify(m.counts)
    );
    ok(
      `[${w}] a later exam with a plan shows its card, its draft and E.V.'s one question`,
      m.later.includes('NUR 112 Exam 5') && m.e5 && m.ask.includes('Which hours do you work this weekend?'),
      JSON.stringify([m.later, m.ask])
    );
    ok(`[${w}] the overview has no sideways scroll`, !m.sideways);
    if (w === 1280) {
      // the switch shows the version in force in the same place, and back (B-450)
      await page.locator('#ov-plans .pl-card[data-plan="E4-H2"] .pl-swap').click();
      await page.waitForTimeout(150);
      const sw = await page.evaluate(() =>
        [...document.querySelectorAll('#ov-plans .pl-card')]
          .filter(c => /^E4/.test(c.dataset.plan))
          .map(c => [c.dataset.plan, (c.querySelector('.pl-swap') || {}).textContent])
      );
      await page.locator('#ov-plans .pl-card[data-plan="E4"] .pl-swap').click();
      await page.waitForTimeout(150);
      ok(
        'the approved version shows in the draft’s place and switches back',
        JSON.stringify(sw) === '[["E4","Back to the draft"]]',
        JSON.stringify(sw)
      );
      // with his objectives open the panel is the objective's: the draft's card carries its summary and actions (B-450)
      await page.locator('#ov-card .fold-line.pm-more').click();
      await page.waitForTimeout(200);
      const acts = await page.evaluate(() =>
        [...document.querySelectorAll('#ov-plans .pl-card[data-plan="E4-H2"] > .plan-sum .pm-act button')]
          .filter(b => b.getClientRects().length)
          .map(b => b.textContent.trim())
      );
      ok(
        'with the objectives open, the draft’s card carries Ask for changes, Approve and Remake',
        ['Ask for changes', 'Approve', 'Remake'].every(x => acts.includes(x)),
        JSON.stringify(acts)
      );
      await page.locator('#ov-card .fold-line.pm-more').click();
      await page.waitForTimeout(200);
    }
    // a badge's count filters the rows; All brings them back
    await page.locator('#ov-plans .pl-card[data-plan="E4-H2"] .pl-filter button[data-f="practice"]').click();
    await page.waitForTimeout(120);
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll('#ov-plans .pl-card[data-plan="E4-H2"] .pl-day.open .pl-t .title')].map(
        t => t.textContent
      )
    );
    ok(
      `[${w}] Practice shows only its tasks`,
      JSON.stringify(shown) === JSON.stringify(['Harness drill']),
      JSON.stringify(shown)
    );
    await page.locator('#ov-plans .pl-card[data-plan="E4-H2"] .pl-filter button[data-f="all"]').click();
    await page.waitForTimeout(120);
    // a day folds on a second tap and opens on a third
    const row = page.locator('#ov-plans .pl-card[data-plan="E4-H2"] .pl-dr').first();
    await row.click();
    await page.waitForTimeout(120);
    const folded = await page.locator('#ov-plans .pl-card[data-plan="E4-H2"] .pl-day').first().locator('.pl-t').count();
    await row.click();
    await page.waitForTimeout(120);
    const reopened = await page
      .locator('#ov-plans .pl-card[data-plan="E4-H2"] .pl-day')
      .first()
      .locator('.pl-t')
      .count();
    ok(`[${w}] a day folds back on a tap and opens again`, folded === 0 && reopened === 5, folded + ' / ' + reopened);
    // the plan settings: below the toolbar on the phone, inside the view; Approved tasks and When something is missing
    // write settings/study-plan; Edit opens the instructions, the brief when he has none
    await page.click('#study-planset');
    await page.waitForTimeout(150);
    const pop = await page.evaluate(() => {
      const r = document.getElementById('plan-pop').getBoundingClientRect(),
        bar = document.getElementById('sbar-study').getBoundingClientRect();
      return {
        shown: r.height > 0,
        top: r.top,
        barBottom: bar.bottom,
        left: r.left,
        right: r.right,
        text: document.getElementById('plan-pop').textContent,
      };
    });
    ok(
      `[${w}] the sliders open the plan settings${w === 390 ? ', below the toolbar and inside the screen' : ''}`,
      pop.shown &&
        /When something is missing/.test(pop.text) &&
        /Approved tasks/.test(pop.text) &&
        !/model/i.test(pop.text) &&
        (w !== 390 || (pop.top >= pop.barBottom - 1 && pop.left >= 0 && pop.right <= 390)),
      JSON.stringify(pop).slice(0, 300)
    );
    await page.locator('#plan-pop button', { hasText: 'Keep in the plan' }).click();
    await page.waitForTimeout(150);
    await page.locator('#plan-pop button', { hasText: 'Note it and go on' }).click();
    await page.waitForTimeout(150);
    const st = await page.evaluate(() => (window.__db.settings || {})['study-plan'] || {});
    ok(
      `[${w}] the plan settings save to settings/study-plan`,
      st.approved === 'plan' && st.missing === 'note',
      JSON.stringify(st).slice(0, 200)
    );
    await page.locator('#plan-pop button', { hasText: 'Add to Today' }).click();
    await page.waitForTimeout(150);
    await page.locator('#plan-pop button', { hasText: 'Ask me' }).click();
    await page.waitForTimeout(150);
    await page.locator('#plan-pop .pm-row button', { hasText: 'Edit' }).click();
    await page.waitForTimeout(200);
    const sheet = await page.evaluate(() => ({
      open: !!document.querySelector('#plan-dlg[open]'),
      text: (document.getElementById('plan-text') || {}).value || '',
    }));
    ok(
      `[${w}] Edit opens the instructions, the built-in brief while he has none`,
      sheet.open && /^# Study Plan Maker/.test(sheet.text),
      sheet.text.slice(0, 80)
    );
    await page.screenshot({ path: `${shots}/plan-sheet-${w}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${shots}/plan-draft-${w}.png`, fullPage: true });
  }
  // Ask for changes on a later exam's card edits that plan (E5's draft), not the next exam's (B-450). B-459: plan edits
  // are made in the E.V. app too (its host is ev-app), as new plans are (below)
  await page.evaluate(() => (window.claude.host = 'ev-app'));
  await page.locator('#ov-plans .pl-card.dr[data-plan="E5"] .plan-sum button', { hasText: 'Ask for changes' }).click();
  await page.waitForTimeout(250);
  const typed = await page.$eval('#ev-input', i => i.value);
  // B-461: the send starts the edit of that plan by its id, with no chat model routing it
  await send(page, typed + 'lighter weekends');
  await page.waitForTimeout(600);
  const edits = await page.evaluate(() =>
    Object.values(window.__db.jobs || {})
      .filter(j => j.kind === 'exam-plan' && j.brief === 'Change my Exam 5 plan: lighter weekends')
      .map(j => j.revise)
  );
  ok(
    'Ask for changes on a plan’s card sends the edit to that plan (E5’s draft, not the next exam’s)',
    /Exam 5 plan/.test(typed) && edits.includes('E5'),
    JSON.stringify([typed, edits])
  );
  await page.evaluate(() => {
    window.__chatScript = null;
    window.__chatReply = null;
    delete window.claude.host;
  });
  // Make a plan plans toward its card's exam, and the card shows it making (B-450). B-465: the BIO lab practical E.V.
  // put on the calendar (in 4 days) is an exam of BIO 201 now, so the planted one comes first, in 2 days.
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    await db.collection('exams').doc('B9H').set({
      schema: 2,
      writer: 'page',
      at: new Date().toISOString(),
      source: 'Told E.V.',
      course: 'BIO 201',
      kind: 'practical',
      date: day,
      title: 'Harness practical',
      status: 'upcoming',
    });
  });
  await page.click('#tab-study');
  await page.waitForTimeout(300);
  await pickCourse('BIO 201');
  // B-456: in the E.V. app (its host is ev-app); the claude.ai page doesn't make plans (below)
  await page.evaluate(() => (window.claude.host = 'ev-app'));
  await page.locator('#ov-plans .pl-none button', { hasText: 'Make a plan' }).click();
  await page.waitForTimeout(400);
  const made = await page.evaluate(() => ({
    briefs: Object.values(window.__db.jobs || {})
      .filter(j => j.kind === 'exam-plan' && j.course === 'BIO 201')
      .map(j => j.brief),
    button: (document.querySelector('#ov-plans .pl-none button') || {}).textContent,
  }));
  ok(
    'Make a plan names its card’s exam in the job, and the card shows it making',
    made.briefs.some(b => /\(B9H\)/.test(b)) && made.button === 'Making…',
    JSON.stringify(made)
  );
  // B-456: Making… never sticks: the job got no result (no worker here), so 2 minutes after it was asked the button is
  // back, with no record change, and the job says it didn't start
  const jobsBefore = await page.evaluate(() => JSON.stringify(window.__db.jobs || {}));
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 150000);
  await pickCourse('NUR 112');
  await pickCourse('BIO 201');
  const freed = await page.evaluate(() => ({
    now: new Date().toISOString(),
    jobs: Object.entries(window.__db.jobs || {})
      .filter(([, j]) => j.kind === 'exam-plan' && j.course === 'BIO 201')
      .map(([id, j]) => [id, j.at, j.fired]),
    button: (document.querySelector('#ov-plans .pl-none button') || {}).textContent,
    disabled: (document.querySelector('#ov-plans .pl-none button') || {}).disabled,
    mini: (document.querySelector('#ov-plans .pl-none .mini') || {}).textContent,
  }));
  // B-459: and the card says the last plan didn't finish, why, and offers Try again (never a silent "No plan yet")
  ok(
    'A new plan with no result 2 minutes after it was asked frees the card as Try again, says why, with no record change',
    freed.button === 'Try again' &&
      freed.disabled === false &&
      /^Your last plan didn’t finish: it didn’t start/.test(freed.mini || '') &&
      jobsBefore === (await page.evaluate(() => JSON.stringify(window.__db.jobs || {}))),
    JSON.stringify(freed)
  );
  // B-456: the claude.ai page (no ev-app host) writes no job and says plainly where plans are made
  await page.evaluate(() => delete window.claude.host);
  const nJobs = () => page.evaluate(() => Object.keys(window.__db.jobs || {}).length);
  const n0 = await nJobs();
  await page.locator('#ov-plans .pl-none button', { hasText: 'Try again' }).click();
  await page.waitForTimeout(400);
  const said = await page.evaluate(() => ({
    toast: document.getElementById('toast').textContent,
    button: (document.querySelector('#ov-plans .pl-none button') || {}).textContent,
  }));
  ok(
    'On the claude.ai page Make a plan writes no job and points to the E.V. app',
    (await nJobs()) === n0 &&
      said.toast === 'Study plans are made in the E.V. app. Open it on your phone or computer to make one.' &&
      said.button === 'Try again',
    JSON.stringify(said)
  );
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    await db.collection('exams').doc('B9H').update({ status: 'done' }); // out of the way of the checks after this one
  });
  await pickCourse('NUR 112');
  // Approve (from the panel at 1280): the draft is the plan in force, Today opens, a tick moves the done count by one
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(250);
  await page.locator('#study-side .plan-sum button', { hasText: 'Approve' }).click();
  await page.waitForTimeout(300);
  const pe = await page.evaluate(() => (window.__db.planedits || {}).E4 || {});
  const done = () =>
    page.evaluate(() => {
      const c = document.querySelector('#ov-plans .pl-card.ok[data-plan="E4-H2"]');
      // B-464: the count shows once: on the card's head, or in the panel's summary when the card owns the panel
      const at = (c && c.querySelector('.pl-done')) || document.querySelector('#study-side .plan-sum .plan-lead');
      const n = c && /^(\d+) of (\d+) done/.exec((at || {}).textContent || '');
      return {
        n: n ? +n[1] : -1,
        all: n ? +n[2] : -1,
        today: c ? /Today/.test((c.querySelector('.pl-day.today.open') || {}).textContent || '') : false,
        ticks: c ? c.querySelectorAll('.pl-day.today .pl-t input.tick:checked').length : -1,
      };
    });
  const d0 = await done();
  ok(
    'Approve makes the draft the plan in force, his ticks kept, and Today opens in it',
    pe.plan === 'E4-H2' && d0.today && d0.all === 7,
    JSON.stringify([pe.plan, d0])
  );
  const tick = page
    .locator('#ov-plans .pl-card.ok[data-plan="E4-H2"] .pl-day.today .pl-t input.tick:not(:checked)')
    .first();
  await (await tick.elementHandle()).click();
  await page.waitForTimeout(250);
  const d1 = await done();
  ok(
    'a tick moves the done count by one, as the ticks show (B-450)',
    d1.n === d0.n + 1 && d1.ticks === d0.ticks + 1,
    JSON.stringify([d0, d1])
  );
  await page.screenshot({ path: `${shots}/plan-approved-1280.png`, fullPage: true });
  // a refused tick puts the box and the row back together (B-450)
  {
    await page.evaluate(() => {
      window.__writeDelayMs = 300;
      window.__writeFail = 'permission_denied';
    });
    const box = await page
      .locator('#ov-plans .pl-card.ok[data-plan="E4-H2"] .pl-day.today .pl-t input.tick:not(:checked)')
      .first()
      .elementHandle();
    await box.click();
    await page.waitForTimeout(120);
    const mid = await box.evaluate(b => b.closest('.pl-t').classList.contains('done'));
    await page.waitForTimeout(700);
    const after = await box.evaluate(b => ({ on: b.checked, done: b.closest('.pl-t').classList.contains('done') }));
    await page.evaluate(() => {
      window.__writeDelayMs = 0;
      window.__writeFail = null;
    });
    ok(
      'a refused plan tick unchecks the box and takes the row’s done state back',
      mid && !after.on && !after.done,
      JSON.stringify([mid, after])
    );
  }
  // B-483: one task, one tick. The day was saved before Approve, yet the approved plan's tasks for today are on Today's
  // list without Plan the rest; a tick on Today shows in Study's plan and the reverse, each stored once in planedits/E4
  {
    const todayRows = async () => {
      await page.click('#tab-today');
      await page.waitForTimeout(250);
      await page.$eval('#seg-today [data-v="list"]', b => b.click());
      await page.waitForTimeout(200);
      return page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll('#today-list li.today-item')].map(li => [
            li.dataset.id,
            !!(li.querySelector('input.tick') || {}).checked,
          ])
        )
      );
    };
    const studyTick = async () => {
      await page.click('#tab-study');
      await page.waitForTimeout(250);
      return page.evaluate(() => {
        const li = [...document.querySelectorAll('#ov-plans .pl-card.ok[data-plan="E4-H2"] .pl-day.today .pl-t')].find(
          x => (x.querySelector('.title') || {}).textContent === 'Harness untagged task'
        );
        return li ? li.querySelector('input.tick').checked : null;
      });
    };
    const nDayedits = () => page.evaluate(() => window.__writes.filter(x => x[1] === 'dayedits').length);
    const w0 = await nDayedits();
    const r0 = await todayRows();
    const onToday = ['plan-h2', 'plan-h3', 'plan-h5'].every(id => id in r0);
    ok(
      'B-483: Approve puts the plan’s tasks for today on Today’s list, without Plan the rest',
      onToday && !r0['plan-h5'],
      JSON.stringify(r0)
    );
    await page.locator('#today-list li.today-item[data-id="plan-h5"] input.tick').click();
    await page.waitForTimeout(300);
    const s1 = await studyTick();
    const t1 = ((await page.evaluate(() => (window.__db.planedits || {}).E4 || {})).ticks || {}).h5;
    ok(
      'B-483: a tick on Today shows in Study’s plan, stored once in the plan’s ticks',
      s1 === true && !!t1 && (await nDayedits()) === w0,
      JSON.stringify({ s1, t1, dayedits: (await nDayedits()) - w0 })
    );
    const box = page
      .locator('#ov-plans .pl-card.ok[data-plan="E4-H2"] .pl-day.today .pl-t', { hasText: 'Harness untagged task' })
      .locator('input.tick');
    await box.click();
    await page.waitForTimeout(300);
    const r2 = await todayRows();
    const t2 = ((await page.evaluate(() => (window.__db.planedits || {}).E4 || {})).ticks || {}).h5;
    ok(
      'B-483: an untick in Study’s plan shows on Today',
      r2['plan-h5'] === false && !t2 && (await nDayedits()) === w0,
      JSON.stringify({ r2, t2 })
    );
    // the real-app case (staging, Oct 29): a plan's graded task ticked on Today reaches the plan's ticks (Study's
    // first tick above may have ticked it already: each click turns both over together)
    const h1 = async () => !!((await page.evaluate(() => (window.__db.planedits || {}).E4 || {})).ticks || {}).h1;
    const g0 = await todayRows();
    const p0 = await h1();
    await page.locator('#today-list li.today-item[data-id="plan-h1"] input.tick').click();
    await page.waitForTimeout(300);
    const p1 = await h1();
    const g1 = await todayRows();
    await page.locator('#today-list li.today-item[data-id="plan-h1"] input.tick').click(); // and back, for what follows
    await page.waitForTimeout(300);
    const p2 = await h1();
    const g2 = await todayRows();
    ok(
      'B-483: a plan’s graded task is on Today and its tick there is the plan’s, stored once',
      'plan-h1' in g0 &&
        g0['plan-h1'] === p0 &&
        p1 === !p0 &&
        g1['plan-h1'] === p1 &&
        p2 === p0 &&
        g2['plan-h1'] === p0 &&
        (await nDayedits()) === w0,
      JSON.stringify({ today: [g0['plan-h1'], g1['plan-h1'], g2['plan-h1']], plan: [p0, p1, p2] })
    );
    await page.click('#tab-study');
    await page.waitForTimeout(200);
  }
  // Keep in the plan: a study plan's tasks leave Today's list and the week's days, and Study's line offers no Open
  // Today (B-450). The saved days carry one of its tasks each, as the morning writes them.
  {
    const tomorrow = d(1);
    await page.evaluate(
      async ({ today, tomorrow }) => {
        const db = await window.claude.use('db');
        const day = window.__db.days[today];
        const item = { id: 'plan-h3', text: 'Harness drill', tag: 'PRACTICE', minutes: 20, ref: 'plans/E4#h3' };
        await db
          .collection('days')
          .doc(today)
          .set({ ...day, list: { ...day.list, items: [...day.list.items, item] } });
        await db
          .collection('days')
          .doc(tomorrow)
          .set({
            ...day,
            date: tomorrow,
            list: {
              ...day.list,
              items: [{ id: 'plan-h6', text: 'Harness second pass', tag: 'REVIEW', minutes: 30, ref: 'plans/E4#h6' }],
            },
          });
      },
      { today, tomorrow }
    );
    const view = async keep => {
      await page.evaluate(async keep => {
        const db = await window.claude.use('db');
        const st = (window.__db.settings || {})['study-plan'] || {};
        await db
          .collection('settings')
          .doc('study-plan')
          .set({
            schema: 1,
            writer: 'page',
            at: new Date().toISOString(),
            source: 'E.V. Home',
            updatedAt: new Date().toISOString(),
            instructions: null,
            ...st,
            approved: keep ? 'plan' : 'today',
          });
      }, keep);
      await page.click('#tab-study');
      await page.waitForTimeout(250);
      const line = await page.evaluate(() => [...document.querySelectorAll('#evline button')].map(b => b.textContent));
      await page.click('#tab-today');
      await page.waitForTimeout(250);
      await page.$eval('#seg-today [data-v="list"]', b => b.click());
      await page.waitForTimeout(200);
      const list = await page.evaluate(() =>
        /Harness drill/.test((document.getElementById('today-list') || {}).textContent || '')
      );
      await page.$eval('#seg-today [data-v="week"]', b => b.click());
      await page.waitForTimeout(300);
      await page.$eval(`#today-week .wk-day[data-date="${tomorrow}"] .wk-h`, b => b.click()); // the day's panel
      await page.waitForTimeout(250);
      const week = await page.evaluate(() =>
        /Harness second pass/.test(
          ((document.getElementById('today-week') || {}).textContent || '') +
            ((document.getElementById('today-date') || {}).textContent || '')
        )
      );
      await page.$eval('#seg-today [data-v="list"]', b => b.click());
      await page.waitForTimeout(150);
      return { line, list, week };
    };
    const on = await view(false),
      off = await view(true);
    // (Study's line here leads with the weak spots to review, so its Open Today is not read on this record)
    ok(
      'Keep in the plan takes a study plan’s tasks off Today’s list and the week’s day panel',
      on.list && on.week && !off.list && !off.week,
      JSON.stringify({ on, off })
    );
    await view(false);
    await page.click('#tab-study');
    await page.waitForTimeout(200);
  }
  // B-469: Put away, from the panel at 1280 and the card's foot at 390: one confirm, then the exam's plans are marked
  // put away in planedits/E4 (nothing deleted) and the card is Make a plan again
  {
    const inPanel = await page.evaluate(() => !!document.querySelector('#study-side .plan-sum .pl-put'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const nPlans = await page.evaluate(() => Object.keys(window.__db.plans || {}).length);
    await page.locator('#ov-plans .pl-card.ok[data-plan="E4-H2"] .pl-foot .pl-put').click();
    await page.waitForTimeout(150);
    const ask = await page.evaluate(() => (document.querySelector('#ov-plans .pl-foot .pl-putq') || {}).textContent);
    await page.screenshot({ path: `${shots}/plan-putaway-390.png`, fullPage: true });
    await page.locator('#ov-plans .pl-foot .pl-putgo').click();
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({
      retired: Object.keys((window.__db.planedits.E4 || {}).retired || {}),
      plans: Object.keys(window.__db.plans || {}).length,
      make: ((document.querySelector('#ov-plans .pl-none button') || {}).textContent || '').trim(),
      cards: [...document.querySelectorAll('#ov-plans .pl-card[data-plan]')].map(c => c.dataset.plan),
    }));
    ok(
      'Put away asks once, marks the plan put away in planedits (nothing deleted) and Make a plan comes back (B-469)',
      inPanel &&
        /^Put this plan away\?/.test(ask || '') &&
        after.retired.includes('E4-H2') &&
        after.plans === nPlans &&
        after.make === 'Make a plan' &&
        !after.cards.some(id => /^E4/.test(id)),
      JSON.stringify({ inPanel, ask, after })
    );
  }
  // E4's earlier plan back in force for the checks after this one (nothing is deleted: the draft stays a Fact)
  await page.evaluate(async () => {
    const db = await window.claude.use('db');
    const { retired, ...e } = window.__db.planedits.E4;
    await db
      .collection('planedits')
      .doc('E4')
      .set({ ...e, plan: 'E4' });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
}

async function openPage(page, target = 'staging', pre = '') {
  // live tasks are created at cutover (B-24), so the main pass drives the staging build
  await page.clock.install({ time: DAYTIME });
  const dir = path.join(root, 'dist/page', target);
  await page.route(ORIGIN + '/**', r => {
    const name = new URL(r.request().url()).pathname.slice(1) || 'index.html';
    if (name === 'index.html')
      return r.fulfill({
        body: skeleton(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')),
        contentType: 'text/html',
      });
    const f = path.join(dir, name);
    return fs.existsSync(f)
      ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' })
      : r.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(pre + 'window.__db=' + JSON.stringify(seed) + ';' + stub);
  await page.goto(ORIGIN + '/');
}
const liveWorker = spec.tasks.live.worker.trigger,
  stagingWorker = spec.tasks.staging.worker.trigger;
const todayDoc = () =>
  window.__db.talk &&
  window.__db.talk[new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())];
async function send(page, text) {
  await page.fill('#ev-input', text);
  // Enter sends as the arrow does; the arrow can sit under an open surface's sheet on the phone
  // a script click: under the session's installed clock the page's frames wait on it, so Playwright's stability wait
  // would never settle
  if ((await page.isVisible('#ev-send')) && (await page.isEnabled('#ev-send')))
    await page.$eval('#ev-send', b => b.click());
  else await page.press('#ev-input', 'Enter');
  await page.waitForTimeout(250);
}
const msgs = page =>
  page.evaluate(() => {
    const d =
      window.__db.talk &&
      window.__db.talk[new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())];
    return d
      ? Object.entries(d.messages)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, m]) => ({ id, ...m }))
      : [];
  });
const results = [];
const ok = (name, cond, detail = '') => {
  results.push([cond ? 'PASS' : 'FAIL', name, detail]);
};
// B-348 (D-327): an open set closes by the strip's All topics (its old fold line where one still shows)
async function closeSet(page) {
  if (await page.isVisible('#pr-fold')) await page.click('#pr-fold');
  else if (await page.isVisible('#study-back')) await page.click('#study-back');
}
// B-365 (D-316): in Study a one-answer question grades on the tap; Check answer, where a question still has it
async function checkAnswer(page, root) {
  const b = page.locator(`${root} button:has-text("Check answer")`);
  if (await b.isVisible().catch(() => false)) await b.click();
}
// B-357: a control he must reach is checked for being tappable where it sits (nothing over it) as its own check,
// then taken by a script click, so one covered control is one FAIL and the run goes on.
async function tap(page, locator, name) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const free = await locator.evaluate(b => {
    const r = b.getBoundingClientRect(),
      at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && (at === b || b.contains(at));
  });
  if (name) ok(name, free);
  await locator.evaluate(b => b.click());
}
(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  // A · Aurora is dark only (D-077): the passes are phone width (all interactions) and desktop width (screens).
  for (const scheme of ['phone', 'desktop']) {
    const page = await browser.newPage({
      viewport: scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 },
      colorScheme: 'dark',
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await servePdfjs(page);
    await openPage(page);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${shots}/ev-${scheme}.png`, fullPage: false });
    ok(`[${scheme}] opens on E.V.`, (await page.isVisible('#p-ev')) && !(await page.isVisible('#p-today')));
    ok(
      `[${scheme}] opening: her stage above the greeting, her 24 px flower kept in the sidebar (D-213)`,
      ...(await page.evaluate(() => {
        const v = {
          opening: document.body.classList.contains('opening'),
          flower: !!document.querySelector('#hero svg.fl'),
          stage: Math.round(document.querySelector('#hero').getBoundingClientRect().height),
          av: Math.round(
            (document.querySelector('#top-av svg.fl') || { getBoundingClientRect: () => ({}) }).getBoundingClientRect()
              .width || 0
          ),
        };
        return [v.opening && v.flower && v.stage >= 100 && (innerWidth < 600 || v.av >= 20), JSON.stringify(v)];
      }))
    );
    ok(
      `[${scheme}] core is drawing`,
      await page.evaluate(() => {
        // B-272 (D-265): her Dial Arc, 12 segments less her gap, drawn.
        const sm = window.EVApp.core.sample(0);
        return !!sm && sm.renderer === 'svg' && sm.segments >= 10 && sm.draws > 0;
      })
    );
    // B-38: the page follows system/manifest; a newer build asks for a reload, nothing reloads on its own
    ok(`[${scheme}] no update bar while the deployed build is this page's`, !(await page.isVisible('#ev-update')));
    await page.evaluate(async () => {
      const db = await window.claude.use('db');
      const m = JSON.parse(JSON.stringify(window.__db.system.manifest));
      m.commit = 'b'.repeat(40);
      m.pages.staging.files['page/staging/app.js'] = 'b'.repeat(64);
      await db.collection('system').doc('manifest').set(m);
    });
    await page.waitForTimeout(150);
    ok(
      `[${scheme}] a new deploy shows "E.V. updated: reload" with a Reload button`,
      (await page.isVisible('#ev-update')) &&
        /E\.V\. updated: reload/.test(await page.textContent('#ev-update')) &&
        (await page.locator('#ev-update button', { hasText: 'Reload' }).count()) === 1
    );
    await page.screenshot({ path: `${shots}/update-bar-${scheme}.png`, fullPage: false });
    ok(
      `[${scheme}] the bar never covers the header's buttons or sideways-scrolls`,
      await page.evaluate(() => {
        const b = document.getElementById('ev-update').getBoundingClientRect(),
          t = document.getElementById('mh').getBoundingClientRect();
        return (b.top >= t.bottom || b.bottom <= t.top) && document.documentElement.scrollWidth <= innerWidth + 1;
      })
    );
    await page.evaluate(async () => {
      const db = await window.claude.use('db');
      const m = JSON.parse(JSON.stringify(window.__db.system.manifest));
      m.pages.staging.files['page/staging/app.js'] = 'a'.repeat(64);
      await db.collection('system').doc('manifest').set(m);
    });
    await page.waitForTimeout(100);
    ok(`[${scheme}] back on this page's build, the bar goes away`, !(await page.isVisible('#ev-update')));
    ok(
      `[${scheme}] five sections in the sidebar or the tab bar, Notes a sixth on the desktop (D-327), System with no link (D-314); no top bar, no dock (D-210)`,
      (await page.locator('#top .tabs .tab:visible').count()) === (scheme === 'phone' ? 5 : 6) &&
        !(await page.isVisible('#tab-system')) &&
        (await page.locator('.dock').count()) === 0 &&
        (await page.locator('header.top').count()) === 0
    );
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`[${scheme}] no sideways scroll`, !overflow);
    ok(`[${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    // ---- E.V.: greeting, quick asks, chat with tools, jobs, guard, check-in (light pass does the interactions)
    const greet = (await page.locator('#thread .msg.ev').last().textContent()) || '';
    // B-90: one strict line (what can't wait, else a greeting and how she can help). B-358 (D-316): under it one summary
    // line, as the demo's Main board, from code: no briefing to fold, no line per item, no button.
    // her greeting's line is kept in talk/memory once its quick call (or core's fallback) settles
    await page
      .waitForFunction(() => (((window.__db.talk || {}).memory || {}).headlines || []).length > 0, null, {
        timeout: 5000,
      })
      .catch(() => {});
    const gb = await page.evaluate(() => {
      const g = document.querySelector('#thread .msg.greet');
      return {
        // B-368 (D-316): the greeting's line is kept in the record, not shown
        head: ((((window.__db.talk || {}).memory || {}).headlines || []).slice(-1)[0] || {}).text || '',
        shown: !!g.querySelector('.bubble'),
        lines: [...g.querySelectorAll('.brief .brief-line')].map(x => x.textContent),
        buttons: g.querySelectorAll('.brief button').length,
        cards: g.querySelectorAll('.ev-card').length,
      };
    });
    ok(
      `[${scheme}] greeting rendered: one sentence naming what can't wait`,
      /^(Morning|Afternoon|Evening), Matt\. ATI Engage Fundamentals is due tonight\.$|^Still up, Matt\? ATI Engage Fundamentals is due tonight\.$/.test(
        gb.head
      ),
      gb.head
    );
    ok(
      `[${scheme}] on screen only its summary line of today's list: no large line, no line per item, no button, no card (B-358, B-368)`,
      gb.lines.length === 1 && /on today’s list/.test(gb.lines[0]) && !gb.buttons && !gb.cards && !gb.shown,
      JSON.stringify(gb)
    );
    // B-452 (Matt) retired B-358's five chips at rest: no quick-ask pills under the composer
    const gm = await page.evaluate(() => [...document.querySelectorAll('#qchips .qchip')].map(c => c.textContent));
    ok(`[${scheme}] at rest no quick-ask pills under the composer (B-452)`, gm.length === 0, JSON.stringify(gm));
    await page.click('#tab-today');
    await page.waitForTimeout(100);
    // B-201: the Sunday card carries the build recap, one sentence from the Chart.
    {
      const wk = await page.evaluate(() => {
        const c = document.getElementById('weekly'),
          r = c && c.querySelector('.wk-recap');
        return {
          shown: !!c && !c.hidden && c.getBoundingClientRect().height > 0,
          recap: r ? r.textContent : '',
          inside: !!r && r.getBoundingClientRect().right <= innerWidth + 1,
        };
      });
      ok(
        `[${scheme}] B-201: the Sunday card shows the build recap`,
        wk.shown && wk.recap === 'This week she shipped 8 tasks to live; 4 wait on you.' && wk.inside,
        JSON.stringify(wk)
      );
      await page.locator('#weekly').scrollIntoViewIfNeeded();
      await page.locator('#weekly').screenshot({ path: `${shots}/recap-${scheme}.png` });
      await page.evaluate(() => scrollTo(0, 0));
    }
    // B-225 (D-271): a switch is a cut: the tab at full opacity on the tap frame, no fade, its cards do not rise.
    ok(
      `[${scheme}] switching tabs shows the tab at once: a cut, nothing rising`,
      await page.evaluate(() => {
        const p = document.getElementById('p-today'),
          s = getComputedStyle(p);
        return (
          s.animationName === 'none' &&
          parseFloat(s.opacity) === 1 &&
          getComputedStyle(document.querySelector('#p-today .card')).animationName === 'none'
        );
      })
    );
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${shots}/today-${scheme}.png`, fullPage: true });
    await page.click('#tab-ev');
    await page.waitForTimeout(100);
    if (scheme === 'desktop') {
      await send(page, 'What’s due this week?'); // typed: with review, a finished job and the session chip it has no chip (D-125) await page.waitForTimeout(900);
      await page.screenshot({ path: `${shots}/ev-desktop-conversation.png`, fullPage: false });
      // B-53 (D-109) at desktop width: the kind on every note (B-302: the row's result); B-303 (D-290): no note offers
      // the weak-spot action
      await page.click('#tab-record');
      await page.waitForTimeout(150);
      {
        const row = t => page.locator('#rec-list .rec-li[data-kind="note"]', { hasText: t }).first();
        const act = async t => {
          await row(t).locator('.nm').click();
          await page.waitForTimeout(60);
          return page.locator('#rec-detail button', { hasText: 'Make it a weak spot' }).count();
        };
        ok(
          '[desktop] note kinds shown; no note offers Make it a weak spot (D-290)',
          /Feature/.test(await row('Harness feature idea').textContent()) &&
            /General/.test(await row('Harness general idea').textContent()) &&
            (await act('Harness feature idea')) === 0 &&
            (await act('Harness general idea')) === 0 &&
            (await act('Harness learning idea')) === 0
        );
        await page.screenshot({ path: `${shots}/ideas-desktop.png`, fullPage: false });
      }
      await page.click('#tab-ev');
      await page.waitForTimeout(150);
      // The greeting's Open the study guide chip opens the guide in a new tab and answers with the job's card.
      await page.evaluate(() => {
        window.__opened = [];
        window.open = (u, t) => {
          window.__opened.push([u, t]);
          return null;
        };
      });
      // B-358 (D-316): the chips are the demo's five, so the finished guide is asked for in words
      await send(page, 'Open the study guide');
      await page.waitForTimeout(900);
      const op = await page.evaluate(() => window.__opened);
      ok(
        '[desktop] Open the study guide, asked in words, opens it in a new tab',
        JSON.stringify(op) === JSON.stringify([['https://claude.ai/artifact/harness', '_blank']]),
        JSON.stringify(op)
      );
      // B-47: the retro card at desktop width
      await page.evaluate(() => {
        window.__chatPre = '';
        window.__chatScript = [{ tool: 'show_card', input: { type: 'job', id: 'job-harness-retro' } }];
        window.__chatReply = 'Here’s your Exam 3 retro.';
      });
      await send(page, 'Show me my Exam 3 retro');
      await page.waitForTimeout(300);
      ok(
        '[desktop] the retro card shows its numbers',
        /you scored 90 \(2 above the range\)/.test(await page.locator('#ev-surf').textContent())
      );
      await page
        .locator('#ev-surf')
        .first()
        .screenshot({ path: `${shots}/retro-card-desktop.png` });
      // B-43 (D-100) at desktop width: Study → Practice, the dosage set, one numeric item answered.
      {
        await openSetById(page, await byTitle(page, 'Harness dosage')); // B-303 (D-283): from today's list
        await page.waitForTimeout(150);
        await page.locator('#pr-body input.num-in').fill('10 mL');
        await checkAnswer(page, '#pr-body');
        await page.waitForTimeout(150);
        const d = await page.evaluate(() => ({
          verdict: document.querySelector('#pr-body .verdict').textContent,
          steps: document.querySelectorAll('#pr-body .num-steps li').length,
          unit: document.querySelector('#pr-body .num-unit').textContent,
        }));
        ok(
          '[desktop] a numeric item answered with its unit typed (10 mL) is Right, with its worked steps (B-43)',
          /^Right\b/.test(d.verdict) && d.steps === 2 && d.unit === 'mL',
          JSON.stringify(d)
        );
        await page.screenshot({ path: `${shots}/dosage-desktop.png`, fullPage: false });
      }
      await practiceNav(page, scheme); // B-191
      await page.click('#tab-ev');
      await page.waitForTimeout(150);
      await buildAskChecks(page, scheme); // B-180
      await workLineChecks(page, scheme); // B-227
      await quizMeChecks(page, scheme); // B-297
      await practiceSetsChecks(page, scheme); // B-482
      await flashcardsChecks(page, scheme); // B-487
      await page.close();
      continue;
    }
    await page.waitForTimeout(1500);
    ok(
      'open marks lastSeenAt in talk/memory',
      await page.evaluate(() => !!(window.__db.talk && window.__db.talk.memory && window.__db.talk.memory.lastSeenAt))
    );
    await send(page, 'What’s due this week?'); // typed: with review, a finished job and the session chip it has no chip (D-125) await page.waitForTimeout(250);
    let m = await msgs(page);
    ok(
      'quick ask posts Matt + E.V. to talk/<today>',
      m.length === 2 && m[0].role === 'matt' && m[1].role === 'ev' && m[1].cards[0].type === 'go', // B-362
      JSON.stringify(m.map(x => [x.role, x.text.slice(0, 30)]))
    );
    // B-362 (D-316): a chip's answer is her one line and one button under it, as the demo: no data card, no surface
    {
      const last = page.locator('#thread .msg.ev').last();
      const a = {
        text: (
          (await last
            .locator('.bubble')
            .first()
            .textContent()
            .catch(() => '')) || ''
        ).trim(),
        buttons: await last.locator('.msg-acts button').allTextContents(),
        cards: await last.locator('.ev-card').count(),
        surf: await page.isVisible('#ev-surf'),
      };
      ok(
        'her answer to what is due is one line and one button, Open the week; no card, no surface (B-362)',
        /^(\d+|[A-Z][a-z]+) (graded )?dates? in the next 7 days|^Nothing dated in the next 7 days/.test(a.text) &&
          a.buttons.join() === 'Open the week' &&
          !a.cards &&
          !a.surf,
        JSON.stringify(a)
      );
    }
    // Captions (B-77): after his first message she stays on her stage at 80%; no core moves to the top bar or a message.
    {
      const st = await page.evaluate(() => ({
        step: document.getElementById('hero').dataset.step,
        av: document.querySelector('#top-av').getBoundingClientRect().width,
      }));
      ok(
        'after his first message her core stays on her stage, a step down from her opening, none in the header',
        !!st.step && !['opening', 'idle'].includes(st.step) && st.av < 1,
        JSON.stringify(st)
      );
    }
    ok(
      'one live core, her stage: none on the messages',
      (await page.locator('#thread .ev-av svg').count()) === 0 && (await page.locator('#hero svg.fl').count()) === 1
    );
    // Chat that starts a background job through the page tools and the Claude Code Remote connector
    await page.evaluate(() => {
      window.__chatScript = [
        {
          tool: 'start_job',
          input: {
            kind: 'study-guide',
            title: 'Study guide: fluid balance',
            brief: 'Matt asked for a study guide on fluid balance for Exam 4.',
          },
        },
      ];
      window.__chatReply = 'On it. Study guide queued.';
    });
    await send(page, 'Make me a study guide on fluid balance');
    await page.waitForTimeout(300);
    const call = await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
    ok(
      'chat sends context first and the message last',
      call.input[0].role === 'user' &&
        /HIS RECORD/.test(call.input[0].content) &&
        call.input[call.input.length - 1].content === 'Make me a study guide on fluid balance',
      call.input.length + ' turns'
    );
    ok(
      'chat offers the page tools on the quick tier',
      call.tier === 'quick' && call.tools.includes('start_job') && call.tools.includes('show_card'),
      call.tier + ' ' + call.tools.join(',')
    );
    const jobs = await page.evaluate(() =>
      Object.entries(window.__db.jobs)
        .filter(([, j]) => j.title === 'Study guide: fluid balance')
        .map(([id, j]) => ({ id, ...j }))
    );
    ok(
      'job doc created with its envelope and fired',
      jobs.length === 1 && jobs[0].writer === 'page' && jobs[0].at && jobs[0].fired && jobs[0].fired.ok === true,
      JSON.stringify(jobs[0] && jobs[0].fired)
    );
    const mc = await page.evaluate(() => window.__mcpCalls.find(c => c[1] === 'fire_trigger'));
    ok(
      'fire_trigger called on the live worker with the job id',
      mc &&
        mc[0] === 'Claude Code Remote' &&
        mc[1] === 'fire_trigger' &&
        mc[2].trigger_id === stagingWorker &&
        mc[2].text === 'Job ' + (jobs[0] || {}).id,
      JSON.stringify(mc)
    );
    // B-210: the job is one line in the pane (its surface line or its card line, at most 44 px). B-286 (D-291):
    // the sidebar has no Working section; the job shows only in the conversation.
    await page.waitForTimeout(300);
    const jl = await page.evaluate(() => {
      const line = [...document.querySelectorAll('#ev-surf .sf-head, #ev-surf .sf-row, #thread .card-line')].find(x =>
        /Study guide|Background job|queued|running/i.test(x.textContent)
      );
      const w = document.getElementById('side-work');
      return {
        h: line ? Math.round(line.getBoundingClientRect().height) : null,
        side: !!w || [...document.querySelectorAll('#top .sec')].some(x => /working/i.test(x.textContent)),
      };
    });
    ok(
      'a running job is one line in the pane, and the sidebar has no Working section (D-291)',
      jl.h != null && jl.h <= 44 && !jl.side,
      JSON.stringify(jl)
    );
    m = await msgs(page);
    const last = m[m.length - 1];
    ok(
      'reply saved with its job card',
      last.role === 'ev' &&
        last.text === 'On it. Study guide queued.' &&
        last.cards.some(c => c.type === 'job') &&
        last.jobId === (jobs[0] || {}).id &&
        last.replyTo === m[m.length - 2].id,
      JSON.stringify(last).slice(0, 200)
    );
    ok('job card shows queued', /queued/.test(await page.locator('#ev-surf').textContent()));
    ok(
      'no Go deeper under the quick reply (B-452, Matt)',
      (await page.locator('#thread .msg.ev').last().locator('button', { hasText: 'Go deeper' }).count()) === 0
    );
    ok(
      'chat context carries the greeting as record data and the reply-once rule',
      /Today’s greeting, built by E.V. core from this record/.test(call.input[0].content) &&
        /write your reply once, after the last tool result/.test(call.input[0].content)
    );
    // D-324: an ask that names graded work goes to Claude like any other; nothing refuses it on the page.
    {
      const before = await page.evaluate(() => window.__chatCalls.length);
      await send(page, 'Can you write my care plan for clinical?');
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => window.__chatCalls.length);
      ok(
        'D-324: an ask that names graded work is asked of Claude, not refused',
        after > before,
        JSON.stringify([before, after])
      );
    }
    // A reply written in two rounds around a tool call shows once (only the text after the tool)
    await page.evaluate(() => {
      window.__chatPre = 'I can’t resize myself, but I can attach your list.';
      window.__chatScript = [{ tool: 'show_card', input: { type: 'today', filter: 'open' } }];
      window.__chatReply = 'Here’s what’s still open today.';
    });
    await send(page, 'Show me what is left today');
    await page.waitForTimeout(300);
    const two = (await msgs(page)).slice(-1)[0];
    ok(
      'two-round reply saved once, without the first-round narration',
      two.text === 'Here’s what’s still open today.' && two.cards.some(c => c.type === 'today'),
      JSON.stringify(two.text)
    );
    ok('two-round reply shown once', !/resize/.test(await page.locator('#thread .msg.ev').last().textContent()));
    await page.evaluate(() => {
      window.__chatPre = '';
    });
    // Ticking an item in a conversation card: the thread is patched in place (no replayed animations, no jump)
    {
      const tc = page.locator('#ev-surf');
      await tc
        .locator('input.tick:not(:checked)')
        .first()
        .evaluate(n => n.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(200);
      const t0 = await page.evaluate(() => {
        window.__anims = [];
        document.addEventListener('animationstart', e => window.__anims.push(String(e.target.className)), true);
        window.__msgNode = document.querySelector('#thread .msg.ev:last-of-type');
        window.__firstMsg = document.querySelector('#thread .msg');
        window.__rows0 = [...document.querySelectorAll('#ev-surf .row')].map(r =>
          Math.round(r.getBoundingClientRect().top)
        );
        window.__sfTop0 = document.getElementById('ev-surf').scrollTop;
        window.__log0 = window.EVApp.core.stats().log.length;
        return scrollY + document.getElementById('thread').scrollTop;
      });
      const bb = await tc.locator('input.tick:not(:checked)').first().boundingBox();
      await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(700);
      const t1 = await page.evaluate(() => ({
        y: scrollY + document.getElementById('thread').scrollTop,
        msgAnims: window.__anims.filter(c => /\bmsg\b/.test(c)).length,
        kept: window.__firstMsg.isConnected,
        rows: [...document.querySelectorAll('#ev-surf .row')].map(r => Math.round(r.getBoundingClientRect().top)),
        rows0: window.__rows0,
        sfTop: [window.__sfTop0, document.getElementById('ev-surf').scrollTop],
        nod: window.EVApp.core
          .stats()
          .log.slice(window.__log0)
          .some(e => e.kind === 'gesture' && e.name === 'done'),
      }));
      ok(
        'ticking in a conversation card keeps the page still: no replayed messages, no scroll',
        t1.msgAnims === 0 && Math.abs(t1.y - t0) < 2 && t1.kept,
        JSON.stringify({ t0, ...t1 })
      );
      ok(
        'B-78 (rule 6): ticking a Today item in its surface keeps the surface’s scroll and its neighbours in place, and she nods',
        t1.rows.length === t1.rows0.length &&
          t1.rows.every((y, i) => Math.abs(y - t1.rows0[i]) <= 1) &&
          t1.sfTop[0] === t1.sfTop[1] &&
          t1.nod,
        JSON.stringify({ rows: t1.rows, rows0: t1.rows0, sfTop: t1.sfTop, nod: t1.nod })
      );
      ok(
        'the ticked item stays in the open card, shown done',
        (await tc.locator('.row.done input.tick:checked').count()) >= 1
      );
      ok(
        'the tick was saved',
        await page.evaluate(
          () =>
            Object.keys(
              (
                (window.__db.dayedits &&
                  window.__db.dayedits[
                    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
                  ]) ||
                {}
              ).checks || {}
            ).length > 0 || Object.values(window.__db.planedits || {}).some(p => p.ticks && Object.keys(p.ticks).length)
        )
      );
    }
    // B-47 (D-104): a finished retro's card shows the numbers the narrative was written over
    await page.evaluate(() => {
      window.__chatPre = '';
      window.__chatScript = [{ tool: 'show_card', input: { type: 'job', id: 'job-harness-retro' } }];
      window.__chatReply = 'Here’s your Exam 3 retro.';
    });
    await send(page, 'Show me my Exam 3 retro');
    await page.waitForTimeout(300);
    {
      const t = await page.locator('#p-ev').textContent();
      ok(
        'the retro card shows prediction against score, practice, weak spots and plan',
        /Exam retro/.test(t) &&
          /80–88 · you scored 90 \(2 above the range\)/.test(t) &&
          /7 of 10 right \(70%\) · weakest E3-2 at 50%/.test(t) &&
          /2 made solid · 1 still open/.test(t) &&
          /3 of 4 tasks done/.test(t) &&
          /I underrated you/.test(t),
        t.slice(0, 300)
      );
      await page
        .locator('#ev-surf')
        .first()
        .screenshot({ path: `${shots}/retro-card.png` });
    }
    // B-177 (review): a builder job's card names its kind, says the builder's own words, and never offers Try again
    // (a retry would fire the worker; the watchdog re-fires the builder).
    for (const [id, want] of [
      ['job-harness-build-stalled', /No word from the builder in 90 minutes\./],
      ['job-harness-reply-failed', /The builder stopped before it finished\./],
    ]) {
      await page.evaluate(i => {
        window.__chatPre = '';
        window.__chatScript = [{ tool: 'show_card', input: { type: 'job', id: i } }];
        window.__chatReply = 'Here it is.';
      }, id);
      await send(page, 'Show me that job');
      await page.waitForTimeout(300);
      const surf = page.locator('#ev-surf');
      const t = await surf.textContent();
      ok(
        `a builder job's card (${id}) names its kind and the builder, with no Try again`,
        (id.includes('build') ? /^build: .+ · queued/.test(t.trim()) : /^Your reply · failed/.test(t.trim())) && // B-227: a queued job reads its plan
          want.test(t) &&
          (await surf.locator('button', { hasText: 'Try again' }).count()) === 0,
        t.slice(0, 300)
      );
      await surf.first().screenshot({ path: `${shots}/builder-job-${id.split('-')[2]}.png` });
    }
    await buildAskChecks(page, scheme); // B-180
    // B-194: a plan card's Open the plan shows that plan; B-450: in Study's overview, where every plan in force shows.
    {
      // The worker's reply to a plan job, as it lands: one message carrying the plan's card.
      await page.evaluate(async () => {
        const db = await window.claude.use('db');
        const at = new Date().toISOString();
        const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(at));
        const key = 'm-' + at.replace(/\D/g, '').slice(0, 8) + '-' + at.replace(/\D/g, '').slice(8, 17) + '-job';
        await db
          .collection('talk')
          .doc(day)
          .update({
            messages: {
              [key]: { role: 'ev', text: 'Your dosage plan is ready.', cards: [{ type: 'plan', id: 'ATI-DOSE' }], at },
            },
          });
      });
      await page.waitForTimeout(500);
      const surf = await page.locator('#ev-surf').textContent();
      await page.locator('#ev-surf button', { hasText: 'Open the plan' }).click();
      await page.waitForTimeout(300);
      // B-450: the Plan screen is retired; the plan opens in Study's overview, with the exam's own plan beside it
      const t = await page.evaluate(() => ({
        tab: document.body.dataset.view,
        cards: [...document.querySelectorAll('#ov-plans .pl-card')].map(c => [
          c.dataset.plan,
          c.textContent.slice(0, 80),
        ]),
        oldScreen: !!document.getElementById('plan-card'),
      }));
      ok(
        "a plan card's Open the plan shows that plan in Study's overview, the exam's plan there too (B-194, B-450)",
        t.tab === 'study' &&
          !t.oldScreen &&
          t.cards.some(([id, x]) => id === 'ATI-DOSE' && /Dosage plan \(harness\)/.test(x)) &&
          t.cards.some(([id, x]) => id === 'E4' && /Exam 4 plan/.test(x)),
        JSON.stringify(t).slice(0, 300) + ' | surface: ' + surf.slice(0, 200)
      );
      await page.screenshot({ path: `${shots}/plan-from-card.png` });
      await page.click('#tab-ev');
      await page.waitForTimeout(200);
    }
    // Captions (B-77): the brand, like tapping her, returns to now from wherever he has scrolled
    await page.evaluate(() => {
      const t = document.getElementById('thread');
      t.scrollTop = 0;
      t.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(150);
    // B-208 (D-210): her flower: the sidebar's from 600 px, the E.V. tab's on the phone.
    await page.click('#tab-ev'); // B-368: the sidebar's brand is no control; Conversation in the nav returns to now
    await page.waitForTimeout(900);
    // Now is the bottom, or, when her current line and its card are taller than the captions, her line pinned at the top.
    const bn = await page.evaluate(() => {
      const t = document.getElementById('thread'),
        cur = t.querySelector('.msg.ev.current'),
        tr = t.getBoundingClientRect(),
        cr = cur && cur.getBoundingClientRect();
      return {
        atBottom: t.scrollHeight - t.clientHeight - t.scrollTop < 4,
        linePinned: !!cr && Math.abs(cr.top - tr.top - 8) < 4,
        pill: !document.getElementById('ev-now').hidden,
      };
    });
    ok('tapping Conversation returns to now', (bn.atBottom || bn.linePinned) && !bn.pill, JSON.stringify(bn));
    // Logging a weak spot from the conversation
    await page.evaluate(() => {
      window.__chatScript = [
        { tool: 'add_weakspot', input: { topic: 'Isotonic vs hypotonic IV fluids', objective: 'E4-3' } },
        { tool: 'show_card', input: { type: 'weakspots' } },
      ];
      window.__chatReply = 'Logged.';
    });
    await send(page, 'I keep mixing up isotonic and hypotonic fluids, log that');
    await page.waitForTimeout(250);
    const ws2 = await page.evaluate(() =>
      Object.values(window.__db.weakspots).filter(w => w.topic === 'Isotonic vs hypotonic IV fluids')
    );
    ok(
      'add_weakspot tool writes a weak spot as a Fact, nothing derived stored',
      ws2.length === 1 &&
        ws2[0].source === 'Told E.V.' &&
        ws2[0].objective === 'E4-3' &&
        ws2[0].writer === 'page' &&
        !ws2[0].derived,
      JSON.stringify(ws2[0] && { o: ws2[0].objective, s: ws2[0].source })
    );
    // D-324: nothing is held as a patient identifier: a message with a room number or a birth date is sent as typed,
    // with no judgment asked and no verdict kept.
    {
      const before0 = (await msgs(page)).length;
      await send(page, 'The resident in room 12 was confused, DOB: 04/12/1961');
      await page.waitForTimeout(300);
      ok(
        'D-324: a message with a room number and a birth date is sent as typed, with no judgment and no verdict',
        (await msgs(page)).some(m => m.text === 'The resident in room 12 was confused, DOB: 04/12/1961') &&
          (await msgs(page)).length > before0 &&
          !(await page.evaluate(() => (window.__jsonCalls || []).some(c => /Candidates \(JSON\)/.test(c.prompt)))) &&
          !(await page.evaluate(() => Object.keys(window.__db.idchecks || {}).length)) &&
          !(await page.$('#ev-guard'))
      );
    }
    // Check-in: local quick ask, energy picker writes days/<today>.checkin and posts advice
    await page.evaluate(() => {
      window.__chatScript = [];
    });
    await send(page, 'I’m wiped');
    await page.waitForTimeout(150);
    await page.locator('#ev-surf').locator('.energy button').nth(1).click();
    await page.waitForTimeout(300);
    const ci = await page.evaluate(() => {
      const d = (window.__db.dayedits || {})[
        new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
      ];
      return d && d.checkin;
    });
    ok('check-in saved to the day’s edits', ci && ci.energy === 2, JSON.stringify(ci));
    ok('low energy gets a lighter plan', /Minimum viable day/.test((await msgs(page)).slice(-1)[0].text));
    // B-41: the weak spots to Quizlet quick ask answers locally with a card that copies the cards
    await send(page, 'Weak spots to Quizlet');
    await page.waitForTimeout(250);
    {
      const last = page.locator('#p-ev');
      const t = await last.textContent();
      ok(
        'quick ask: weak spots to Quizlet posts a card with the copy button',
        /open weak spots? as Quizlet cards/.test(t) &&
          /Weak spots for Quizlet/.test(t) &&
          (await last.locator('button', { hasText: 'for Quizlet' }).count()) === 1,
        t.slice(0, 160)
      );
      await last.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/quizlet-card-${scheme}.png`, fullPage: false });
    }
    // Connector failure: job is created but not started; Try again re-fires on a click
    await page.evaluate(() => {
      window.__mcpFail = 'server_not_connected';
      window.__chatScript = [
        {
          tool: 'start_job',
          input: { kind: 'practice-set', title: 'Practice: acid-base', brief: '20 questions on acid-base' },
        },
      ];
      window.__chatReply = 'Queued.';
    });
    await send(page, 'Write me 20 acid-base questions');
    await page.waitForTimeout(300);
    let jb = await page.evaluate(() => Object.values(window.__db.jobs).find(j => j.title === 'Practice: acid-base'));
    ok(
      'connector error recorded on the job',
      jb && jb.fired && jb.fired.ok === false && jb.fired.error === 'server_not_connected',
      JSON.stringify(jb && jb.fired)
    );
    const jc = page.locator('#ev-surf');
    ok(
      'job card says how to fix it',
      /Settings → Connectors/.test(await jc.textContent()) &&
        (await jc.locator('button', { hasText: 'Try again' }).count()) === 1
    );
    // B-200 (D-208): a refused Try again puts the card back as it was and says why in one line.
    const tryAgain = (fail, delay) =>
      page.evaluate(
        async ([fail, delay]) => {
          const card = () => document.querySelector('#ev-surf');
          const b = [...card().querySelectorAll('button')].find(x => x.textContent.trim() === 'Try again');
          if (!b) return null;
          window.__writeDelayMs = delay;
          window.__writeFail = fail;
          const t0 = performance.now();
          b.click();
          await new Promise(r => requestAnimationFrame(() => r()));
          const ms = Math.round(performance.now() - t0);
          const queued = /queued/i.test(card().textContent) && !/not started/i.test(card().textContent);
          const said = card().textContent.slice(0, 160);
          await new Promise(r => setTimeout(r, delay + 300));
          window.__writeDelayMs = 0;
          window.__writeFail = null;
          const t = document.getElementById('toast');
          return {
            queued,
            said,
            ms,
            back: /not started/.test(card().textContent),
            line: t && !t.hidden ? t.textContent.trim() : '',
          };
        },
        [fail, delay]
      );
    await page.evaluate(() => {
      window.__mcpFail = null;
    });
    const refusedRetry = await tryAgain('permission_denied', 300);
    ok(
      'a refused Try again shows queued on the tap, then puts the card back and says why (B-200, D-208)',
      !!refusedRetry &&
        refusedRetry.queued &&
        refusedRetry.back &&
        /^Couldn’t save: .*permission_denied/.test(refusedRetry.line),
      JSON.stringify(refusedRetry)
    );
    // B-200 (D-208): with the record 2 s slow, Try again shows the job queued on the tap's next frame.
    const slowRetry = await tryAgain(null, 2000);
    ok(
      'Try again shows the job queued on the tap frame, the record 2 s behind (B-200, D-208)',
      !!slowRetry && slowRetry.queued && slowRetry.ms < 500, // read on the first frame after the tap (B-357)
      JSON.stringify(slowRetry)
    );
    await page
      .waitForFunction(
        () => {
          const j = Object.values(window.__db.jobs).find(x => x.title === 'Practice: acid-base');
          return j && j.fired && j.fired.ok === true;
        },
        null,
        { timeout: 4000 }
      )
      .catch(() => {});
    jb = await page.evaluate(() => Object.values(window.__db.jobs).find(j => j.title === 'Practice: acid-base'));
    ok(
      'Try again re-fires the job with a clean attempt',
      jb.fired.ok === true && !jb.fired.error,
      JSON.stringify(jb.fired)
    );
    {
      // B-46 (D-103): the clinical-prep brief. D-324: an ask that names a room starts its job like any other; the day
      // before a clinical day the briefing offers it, and the chip starts the job for that day.
      await page.evaluate(() => {
        window.__chatScript = [
          {
            tool: 'start_job',
            input: {
              kind: 'clinical-prep',
              title: 'Clinical prep: room 412',
              brief: 'Prep me for my patient in room 412, DOB 3/4/51',
            },
          },
        ];
        window.__chatReply = 'Started.';
      });
      await send(page, 'Prep me for my patient in room 412');
      await page.waitForTimeout(300);
      ok(
        'D-324: a clinical-prep ask that names a room starts its job, as written',
        (
          await page.evaluate(() =>
            Object.values(window.__db.jobs).filter(j => j.kind === 'clinical-prep' && /412/.test(j.title + j.brief))
          )
        ).length === 1
      );
      const tomorrow = await page.evaluate(() => window.EVCore.addDays(window.EVCore.chicagoDate(new Date()), 1));
      await page.evaluate(async t => {
        const db = await window.claude.use('db');
        await db.collection('dates').doc('harness-clinical').set({
          schema: 1,
          writer: 'page',
          at: new Date().toISOString(),
          source: 'harness',
          addedAt: new Date().toISOString(),
          date: t,
          title: 'Clinical: Med-surg (made-up site)',
          kind: 'clinical',
          course: 'NUR 112',
          graded: false,
        });
      }, tomorrow);
      await page.waitForTimeout(300);
      const offer = await page.evaluate(() =>
        window.EVCore.clinicalPrepOffer({
          dates: Object.entries(window.__db.dates).map(([id, d]) => ({ id, ...d })),
          dateedits: [],
          jobs: Object.values(window.__db.jobs),
          date: window.EVCore.chicagoDate(new Date()),
        })
      );
      ok(
        'the day before a clinical day, the brief is offered',
        offer && offer.date === tomorrow,
        JSON.stringify(offer)
      );
      const fires = await page.evaluate(() => window.__mcpCalls.length);
      await send(page, 'Brief me for clinical');
      await page.waitForTimeout(400);
      const cj = await page.evaluate(
        t => Object.values(window.__db.jobs).find(j => j.kind === 'clinical-prep' && j.brief.startsWith(t + ': ')),
        tomorrow
      );
      const fired = await page.evaluate(n => window.__mcpCalls.slice(n), fires);
      ok(
        'the chip starts the clinical-prep job for that day and fires the worker',
        cj &&
          cj.brief.startsWith(tomorrow + ': ') &&
          /^Clinical prep: /.test(cj.title) &&
          fired.some(c => c[1] === 'fire_trigger') &&
          /Writing your clinical prep brief/.test((await msgs(page)).slice(-1)[0].text),
        JSON.stringify({ cj, fired: fired.map(c => c[1]) })
      );
      await page.screenshot({ path: `${shots}/clinical-prep-${scheme}.png`, fullPage: false });
    }
    // Claude errors are branched by code
    await page.evaluate(() => {
      window.__chatFail = 'rate_limited';
    });
    await send(page, 'Quick question about potassium');
    await page.waitForTimeout(250);
    const rl = (await msgs(page)).slice(-1)[0];
    ok('rate limit explained, kept in the thread', /usage limit/.test(rl.text) && rl.error === 'rate_limited', rl.text);
    await page.evaluate(() => {
      window.__chatFail = null;
      window.__chatScript = [];
    });
    ok(
      'explain questions go to the default tier',
      await page.evaluate(async () => {
        window.__chatReply = 'Because…';
        return true;
      })
    );
    await send(page, 'Explain why hypokalemia causes muscle weakness');
    await page.waitForTimeout(250);
    ok(
      'tier picks default for explanations',
      (await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)).tier)) ===
        'default'
    );
    await page.screenshot({ path: `${shots}/ev-conversation.png`, fullPage: true });
    ok(
      'no sideways scroll after the conversation',
      !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
    );
    ok(
      // B-384: a problem is a short whole phrase in the status line (the detail is System's lead line)
      'status reads Live, or a short phrase for the problem System leads with (B-120, B-384)',
      await page.evaluate(() => {
        const s = document.getElementById('status').textContent,
          l = document.querySelector('#health .sys-lead');
        return s === 'Live' || (!!l && (s === l.textContent || (/^[A-Z][^.\d]{3,60}$/.test(s) && !/\d/.test(s))));
      }),
      await page.textContent('#status')
    );
    // B-291 (D-286, D-287, C-7, D-282): no Now card, no Focus heading, no Add and no Remove on Today.
    {
      const t = await page.evaluate(() => ({
        now: !!document.getElementById('now'),
        focus: [...document.querySelectorAll('#p-today h2, #p-today h3')].some(h =>
          /^Focus$/.test(h.textContent.trim())
        ),
        addRemove: [...document.querySelectorAll('#p-today button')]
          .filter(b => /^(Add|Remove)$/.test(b.textContent.trim()))
          .map(b => b.outerHTML.slice(0, 120)),
      }));
      // B-357 (D-327): the demo's toolbar has Add; Remove stays off Today (B-364)
      t.addRemove = t.addRemove.filter(h => !/ti-add/.test(h));
      ok(
        'Today has no Now card, Focus heading or Remove',
        !t.now && !t.focus && !t.addRemove.length,
        JSON.stringify(t)
      );
    }
    ok(
      'today list rendered',
      (await page.locator('#today-list .li').count()) > 0,
      String(await page.locator('#today-list .li').count())
    );
    // ---- List edits (D-078): E.V. adds to the day's list and takes items off; Matt can add and remove on Today
    const dayDoc = () =>
      page.evaluate(
        () =>
          window.__db.dayedits &&
          window.__db.dayedits[new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())]
      );
    const listLines = c =>
      ((/Today’s list \(id \| done \| tag \| item\):\n([\s\S]*?)(\n[A-Z][^\n|]*:|\n---|$)/.exec(c) || [])[1] || '')
        .split('\n')
        .map(l => l.split(' | '));
    const budgetMin = async () =>
      // B-346 (D-327): the budget card's "<on the list> of <budget> min"; an added, unticked task adds to it
      Number(((await page.textContent('#today-budget .tb-big')) || '').replace(/^\D*?(\d+) of \d+ min.*$/s, '$1'));
    const min0 = await budgetMin();
    await page.evaluate(() => {
      window.__toolResults = [];
      window.__chatScript = [
        {
          tool: 'edit_list',
          input: {
            action: 'add',
            text: 'Quizlets: Ch 7 & 8 lecture for BIO 201 Lecture Exam 3',
            kind: 'practice',
            minutes: 30,
            course: 'BIO 201',
          },
        },
        {
          tool: 'edit_list',
          input: {
            action: 'add',
            text: 'Review the Chapter 8 lecture',
            kind: 'review',
            minutes: 25,
            course: 'BIO 201',
          },
        },
        { tool: 'edit_list', input: { action: 'add', text: 'Write the care plan', date: '2020-01-01' } },
      ];
      window.__chatReply = 'Both are on today’s list.';
    });
    await send(page, 'Add Quizlets for chapter 7 and 8 and a Chapter 8 lecture review to today');
    await page.waitForTimeout(300);
    let dd = await dayDoc();
    let addedNow = Object.values((dd && dd.added) || {}).filter(Boolean);
    const lcall = await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
    ok(
      'chat offers edit_list and says when to use it',
      lcall.tools.includes('edit_list') &&
        /His daily list is yours to keep/.test(lcall.input[0].content) &&
        /His calendar is yours to keep too/.test(lcall.input[0].content) &&
        !lcall.tools.includes('add_date'),
      lcall.tools.join(',') + ' | ' + JSON.stringify(await page.evaluate(() => window.__toolResults)).slice(0, 400)
    );
    ok(
      'edit_list adds both to today, by E.V., with kind, minutes and course',
      addedNow.length === 2 &&
        addedNow.every(a => a.by === 'E.V.' && a.course === 'BIO 201') &&
        addedNow[0].tag === 'PRACTICE' &&
        addedNow[1].minutes === 25,
      JSON.stringify(addedNow)
    );
    ok(
      'edit_list refuses a day in the past',
      /date must be today/.test((await page.evaluate(() => window.__toolResults)).slice(-1)[0])
    );
    ok(
      'nothing added to the calendar',
      !(await page.evaluate(
        seeded =>
          Object.entries(window.__db.dates || {}).some(
            ([id, d]) => !seeded.includes(id) && /Quizlets: Ch 7/.test(d.title)
          ),
        Object.keys(seed.dates || {})
      ))
    );
    const lc = page.locator('#ev-surf');
    ok(
      'the reply carries today’s list with the new items',
      /Quizlets: Ch 7 & 8 lecture/.test(await lc.textContent()) && /added by E\.V\./.test(await lc.textContent())
    );
    await page.click('#tab-today');
    await page.waitForTimeout(150);
    ok(
      'Today lists the added items with no Remove on the row (D-282), and counts their minutes',
      (await page.locator('#today-list .li', { hasText: 'Review the Chapter 8 lecture' }).count()) === 1 &&
        (await page
          .locator('#today-list .li', { hasText: 'Review the Chapter 8 lecture' })
          .locator('button', { hasText: 'Remove' })
          .count()) === 0 &&
        (Number.isNaN(min0)
          ? /~25 min · added by E\.V\./.test(await page.textContent('#today-list'))
          : (await budgetMin()) === min0 + 55),
      `${min0} -> ${await budgetMin()}`
    );
    // Matt adds one himself from the header's New (B-287, C-7), then removes it
    await page.click('#new-btn');
    await page.click('#new-menu [data-new="task"]');
    await page.fill('#new-title', 'Flashcards for the bones lab');
    await page.press('#new-title', 'Enter');
    await page.waitForTimeout(200);
    dd = await dayDoc();
    const mine = Object.entries(dd.added || {}).find(([, a]) => a && a.text === 'Flashcards for the bones lab');
    ok(
      'New writes his task to today and closes',
      mine &&
        mine[1].by === 'Matt' &&
        !(await page.evaluate(() => document.getElementById('new-dlg').open)) &&
        (await page.locator('#today-list .li', { hasText: 'Flashcards for the bones lab' }).count()) === 1
    );
    await page.click('#new-btn');
    await page.click('#new-menu [data-new="task"]');
    await page.fill('#new-title', 'half typed');
    const rr = await page.evaluate(async () => {
      const n = document.querySelectorAll('#today-list .li').length;
      const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
      await (
        await window.claude.use('db')
      )
        .collection('dayedits')
        .doc(t)
        .update({ updatedAt: new Date().toISOString() });
      return n;
    });
    await page.waitForTimeout(150);
    ok(
      'a refresh keeps what he is typing in New',
      rr > 0 &&
        (await page.inputValue('#new-title')) === 'half typed' &&
        (await page.evaluate(() => document.activeElement && document.activeElement.id === 'new-title'))
    );
    await page.fill('#new-title', '');
    await page.keyboard.press('Escape');
    // B-291, B-296 (D-282, C-10): an added item's row carries no Remove; its name opens the task's panel, which says
    // who added it and holds Remove from today. Here he takes it off by asking E.V., through the same list edit.
    {
      const fr = page.locator('#today-list .li', { hasText: 'Flashcards for the bones lab' });
      await fr.locator('.nm').click();
      await page.waitForSelector('#today-task:not([hidden])', { timeout: 1500 }).catch(() => {});
      ok(
        'an added item opens its view: who added it; no Remove on it or on the row (B-364)',
        /Added by you/.test((await page.textContent('#today-taskmain')) + (await page.textContent('#today-task'))) &&
          (await page.locator('#today-task .tp-remove').count()) === 0 &&
          (await fr.locator('button', { hasText: 'Remove' }).count()) === 0
      );
      await page.click('#tab-ev');
      await page.evaluate(id => {
        window.__toolResults = [];
        window.__chatScript = [{ tool: 'edit_list', input: { action: 'remove', id } }];
        window.__chatReply = 'Taken off.';
      }, mine[0]);
      await send(page, 'Take the flashcards off today');
      await page.waitForTimeout(300);
      await page.click('#tab-today');
      await page.waitForTimeout(150);
    }
    dd = await dayDoc();
    ok(
      'her name and status stay one row while jobs run (D-210: the sidebar, or the header on the phone)',
      await page.evaluate(() => {
        const b = document.getElementById('brand').getBoundingClientRect(),
          h = document.getElementById('mh').getBoundingClientRect();
        return b.width === 0 || (b.height <= 44 && h.height <= 52);
      }),
      await page.textContent('#readout')
    );
    ok(
      'taking it off removes his item',
      !(mine[0] in dd.added) &&
        (await page.locator('#today-list .li', { hasText: 'Flashcards for the bones lab' }).count()) === 0
    );
    await page.evaluate(() => document.querySelector('#today-list').scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(2800);
    await page.screenshot({ path: `${shots}/today-edited.png`, fullPage: false });
    await page.click('#tab-ev');
    await page.waitForTimeout(100);
    // E.V. takes a planned item off for the day and brings it back; fixed items stay
    const lines = listLines(lcall.input[0].content);
    const plannedLine = lines.find(
      l => l[0] && !/^add-/.test(l[0]) && !['GRADED', 'EXAM', 'CLINICAL', 'VALIDATION'].includes(l[2])
    );
    await page.evaluate(id => {
      window.__toolResults = [];
      window.__chatScript = [{ tool: 'edit_list', input: { action: 'remove', id } }];
      window.__chatReply = 'Taken off today.';
    }, plannedLine && plannedLine[0]);
    await send(page, 'Take that off today');
    await page.waitForTimeout(300);
    dd = await dayDoc();
    ok(
      'remove on a planned item skips it for the day',
      plannedLine && dd.skipped && dd.skipped[plannedLine[0]] && dd.skipped[plannedLine[0]].by === 'E.V.',
      JSON.stringify(plannedLine) + ' ' + JSON.stringify(dd.skipped)
    );
    const ctx2 = await page.evaluate(() => {
      window.__chatScript = [];
      window.__chatReply = 'Ok.';
      return true;
    });
    await send(page, 'What is still on my list?');
    await page.waitForTimeout(250);
    const c3 = (await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)))).input[0]
      .content;
    ok(
      'the chat sees what was taken off and who added what',
      ctx2 &&
        /Taken off today’s list: /.test(c3) &&
        /\[added by you\]/.test(c3) &&
        !listLines(c3).some(l => l[0] === plannedLine[0])
    );
    await page.evaluate(id => {
      window.__toolResults = [];
      window.__chatScript = [{ tool: 'edit_list', input: { action: 'restore', id } }];
      window.__chatReply = 'Back on.';
    }, plannedLine[0]);
    await send(page, 'Actually put it back');
    await page.waitForTimeout(300);
    ok('restore brings it back', !(await dayDoc()).skipped[plannedLine[0]]);
    const fixedId = (lines.find(l => ['GRADED', 'EXAM', 'CLINICAL', 'VALIDATION'].includes(l[2])) || [])[0] || null; // graded work, exams, clinicals and validations stay
    if (fixedId) {
      await page.evaluate(id => {
        window.__toolResults = [];
        window.__chatScript = [{ tool: 'edit_list', input: { action: 'remove', id } }];
        window.__chatReply = 'That one stays.';
      }, fixedId);
      await send(page, 'Take the graded one off');
      await page.waitForTimeout(300);
      ok(
        'graded work stays on the list',
        /stays on the list/.test((await page.evaluate(() => window.__toolResults)).slice(-1)[0]) &&
          !((await dayDoc()).skipped || {})[fixedId]
      );
    }
    // A later day: the doc is created with only the added item; the morning run keeps it
    const tmr = await page.evaluate(() => {
      const d = new Date(Date.now() + 86400e3);
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
    });
    await page.evaluate(date => {
      window.__chatScript = [
        { tool: 'edit_list', input: { action: 'add', text: 'Skim Ch 9 before lab', kind: 'reading', date } },
      ];
      window.__chatReply = 'On tomorrow’s list.';
    }, tmr);
    await send(page, 'Put skimming chapter 9 on tomorrow');
    await page.waitForTimeout(300);
    const td = await page.evaluate(d => window.__db.dayedits[d], tmr);
    ok(
      'tomorrow gets its own dayedits doc with the item; the morning run keeps it',
      td &&
        td.date === tmr &&
        td.schema === 1 &&
        td.writer === 'page' &&
        Object.values(td.added).some(a => a && a.text === 'Skim Ch 9 before lab' && a.tag === 'READING'),
      JSON.stringify(td)
    );
    // ---- Calendar edits (D-080): E.V. adds, changes and takes entries off; Canvas graded work stays; Record has Remove and Bring back
    const labDate = inDays(4);
    const labId = labDate + '-bio-lab-practical';
    const cal = () =>
      page.evaluate(() => {
        const out = {};
        const ed = window.__db.dateedits || {};
        for (const [id, d] of Object.entries(window.__db.dates || {})) {
          const e = ed[id];
          out[id] = {
            ...d,
            ...((e && e.overrides) || {}),
            ...(e && e.notes != null ? { notes: e.notes } : {}),
            removed: e ? e.removed || null : undefined,
            edited: !!e,
          };
        }
        return out;
      });
    await page.evaluate(
      ([labDate, labId]) => {
        window.__toolResults = [];
        window.__chatScript = [
          {
            tool: 'edit_dates',
            input: { action: 'add', date: labDate, title: 'BIO lab practical', kind: 'exam', course: 'BIO 201' },
          },
          { tool: 'edit_dates', input: { action: 'change', id: labId, notes: 'Bring the bones kit' } },
          { tool: 'edit_dates', input: { action: 'remove', id: 'canvas-h-graded' } },
          { tool: 'edit_dates', input: { action: 'remove', id: 'canvas-h-hall' } },
        ];
        window.__chatReply = 'Calendar updated.';
      },
      [labDate, labId]
    );
    await send(page, 'Put the BIO lab practical on my calendar, bones kit noted, and take the study hall off');
    await page.waitForTimeout(350);
    const dcall = await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
    let dr = await page.evaluate(() => window.__toolResults.slice(-4));
    let cd = await cal();
    ok(
      'chat offers edit_dates with calendar ids in the context',
      dcall.tools.includes('edit_dates') &&
        /Calendar, next 7 days \(id: date title\): /.test(dcall.input[0].content) &&
        /canvas-h-hall: \d{4}-\d{2}-\d{2} Harness study hall \(other, Canvas\)/.test(dcall.input[0].content),
      (dcall.input[0].content.match(/Calendar, next 7 days[^\n]*/) || [''])[0].slice(0, 200)
    );
    ok(
      'edit_dates adds and changes his entry, by E.V.',
      cd[labId] &&
        cd[labId].addedBy === 'E.V.' &&
        cd[labId].course === 'BIO 201' &&
        cd[labId].kind === 'exam' &&
        cd[labId].notes === 'Bring the bones kit' &&
        cd[labId].edited &&
        /^added to the calendar/.test(dr[0]) &&
        /\(notes\)$/.test(dr[1]),
      JSON.stringify(cd[labId]) + ' ' + JSON.stringify(dr.slice(0, 2))
    );
    ok(
      'graded work from Canvas stays; an optional Canvas event comes off',
      /stays on the calendar/.test(dr[2]) &&
        !cd['canvas-h-graded'].removed &&
        cd['canvas-h-hall'].removed &&
        cd['canvas-h-hall'].removed.by === 'E.V.' &&
        /^taken off the calendar: canvas-h-hall/.test(dr[3]),
      JSON.stringify(dr.slice(2))
    );
    await page.evaluate(() => {
      window.__toolResults = [];
      window.__chatScript = [{ tool: 'lookup', input: { what: 'dates', query: 'harness' } }];
      window.__chatReply = 'Here is what I see.';
    });
    await send(page, 'What is on my calendar?');
    await page.waitForTimeout(300);
    const c4 = (await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)))).input[0]
      .content;
    const lk = (await page.evaluate(() => window.__toolResults.slice(-1)))[0] || '';
    ok(
      'the chat sees what came off the calendar, and only live entries in the week',
      /Taken off the calendar: canvas-h-hall: /.test(c4) &&
        !/canvas-h-hall: [^;\n]*\(other, Canvas\)/.test((c4.match(/Calendar, next 7 days[^\n]*/) || [''])[0])
    );
    ok(
      'lookup dates returns ids and marks what is off',
      /"id":"canvas-h-graded"/.test(lk) && /"id":"canvas-h-hall"[^}]*"off":true/.test(lk),
      lk.slice(0, 200)
    );
    // D-335: his notes and journal are open to the conversation's lookup
    await page.evaluate(() => {
      window.__toolResults = [];
      window.__chatScript = [
        { tool: 'lookup', input: { what: 'notes', query: 'potassium' } },
        { tool: 'lookup', input: { what: 'journal', query: 'harness week' } },
      ];
      window.__chatReply = 'Here is what I see.';
    });
    await send(page, 'What did I write about potassium?');
    await page.waitForTimeout(300);
    const [lkNotes, lkJournal] = await page.evaluate(() => window.__toolResults.slice(-2));
    ok(
      'lookup notes and journal read his notes (with their text) and his journal (D-335)',
      /"title":"Fluid and electrolytes: potassium and sodium"/.test(lkNotes || '') &&
        /3\.5 to 5\.0 mEq\/L/.test(lkNotes || '') &&
        /A made-up journal line about harness week/.test(lkJournal || ''),
      String(lkNotes).slice(0, 160) + ' | ' + String(lkJournal).slice(0, 160)
    );
    // B-412 review: a match far past the note's start comes back as its passage, marked cut; a query that matches every
    // note shares the 4,000 characters and still parses; one note by id reads up to the cap
    await page.evaluate(() => {
      window.__toolResults = [];
      window.__chatScript = [
        { tool: 'lookup', input: { what: 'notes', query: 'zygote ladder' } },
        { tool: 'lookup', input: { what: 'notes', query: 'a' } },
        { tool: 'lookup', input: { what: 'notes', id: 'n-20261020-120000-harnesslong' } },
      ];
      window.__chatReply = 'Here is what I see.';
    });
    await send(page, 'Find the zygote ladder in my notes');
    await page.waitForTimeout(300);
    const lkLong = await page.evaluate(() => window.__toolResults.slice(-3));
    const parsed = lkLong.map(t => {
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    });
    const [far, many, whole] = parsed;
    const farNote = (far || []).find(n => n.id === 'n-20261020-120000-harnesslong') || {};
    ok(
      'lookup notes: a match past character 900 comes back with its passage, cut and placed; every reply parses (B-412)',
      parsed.every(Boolean) &&
        lkLong.every(t => t.length <= 4000) &&
        farNote.cut === true &&
        farNote.from > 900 &&
        farNote.chars > farNote.text.length &&
        /zygote ladder "quoted"/.test(farNote.text) &&
        Array.isArray(many) &&
        many.length > 1 &&
        many.some(n => n.cut) &&
        whole.length === 1 &&
        whole[0].cut === true &&
        whole[0].text.length > 3000,
      lkLong.map(t => String(t).length + ':' + String(t).slice(0, 120)).join(' | ')
    );
    await page.click('#tab-today');
    await page.waitForTimeout(150);
    // B-359 (D-316): the dates live in Today's week; Record's Dates screen left the page (taking a date off and bringing
    // it back from the week is the prep harness's B-295 check)
    await page.click('#seg-today [data-v="week"]');
    await page.waitForTimeout(200);
    const wk = await page.evaluate(() =>
      [...document.querySelectorAll('#today-week .wchip[data-id]')].map(c => [
        c.querySelector('.wc-t').textContent,
        c.classList.contains('off'),
      ])
    );
    ok(
      'Today’s week marks what came off as Taken off and shows the new entry (B-363)',
      wk.filter(([t]) => /Harness study hall/.test(t)).every(([, off]) => off) &&
        wk.some(([t, off]) => /BIO lab practical/.test(t) && !off),
      JSON.stringify(wk)
    );
    await page.click('#seg-today [data-v="list"]');
    await page.waitForTimeout(100);
    await page.click('#tab-ev');
    await page.waitForTimeout(100);
    // ---- Library (D-079): E.V. searches and reads his materials; attachments are read on the page and saved
    await page.evaluate(() => {
      window.__toolResults = [];
      window.__gets = 0;
      window.__chatScript = [
        { tool: 'materials', input: { action: 'search', query: 'head to toe assessment', course: 'NUR 112' } },
        { tool: 'materials', input: { action: 'read', id: 'NUR112-harness-skills', page: 12 } },
        { tool: 'materials', input: { action: 'list', kind: 'lab' } },
      ];
      window.__chatReply = 'From your Skills Packet, p. 12: start with hand hygiene.';
    });
    await send(page, 'Let us run the head to toe validation');
    await page.waitForTimeout(300);
    const lr = await page.evaluate(() => window.__toolResults.slice(-3));
    const lcall2 = await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
    ok(
      'chat offers the materials tool and the cite-your-source rule',
      lcall2.tools.includes('materials') && /search them first and name the file and page/.test(lcall2.input[0].content)
    );
    ok(
      'materials search cites the file and page',
      /"cite":"Harness Skills Packet, p\. 12"/.test(lr[0]),
      String(lr[0]).slice(0, 200)
    );
    ok(
      'materials read starts at the asked page',
      (() => {
        try {
          const r = JSON.parse(lr[1]);
          return (
            r.text.startsWith('[p12] HEAD TO TOE') &&
            /\[p13\] HEAD TO TOE DOCUMENTATION/.test(r.text) &&
            r.more === false
          );
        } catch (e) {
          return false;
        }
      })(),
      String(lr[1]).slice(0, 160)
    );
    ok(
      'materials list shows the lab files',
      /NUR112-harness-skills \| NUR 112 \| lab \| Harness Skills Packet\.pdf/.test(lr[2])
    );
    ok(
      'the library loads once per open',
      await page.evaluate(() => window.__gets === 1),
      String(await page.evaluate(() => window.__gets))
    );
    const mats = () =>
      page.evaluate(() =>
        Object.entries(window.__db.materials || {})
          .filter(([id]) => /^up-/.test(id))
          .map(([id, m]) => ({ id, ...m }))
      );
    // A Word file
    await page.setInputFiles('#ev-file', path.join(root, 'test/data/sample.docx'));
    await page.waitForTimeout(800);
    let up = await mats();
    let lastE = (await msgs(page)).slice(-1)[0];
    ok(
      'a Word attachment is read and saved to the library',
      up.length === 1 &&
        /^up-\d{4}-\d{2}-\d{2}-sample$/.test(up[0].id) &&
        /^Head-to-Toe Assessment Checklist\nPerform hand hygiene/.test(up[0].text) &&
        up[0].addedBy === 'Matt' &&
        up[0].course === 'NUR 112',
      JSON.stringify(up.map(u => [u.id, u.text.slice(0, 40)]))
    );
    ok(
      'the reply names it and carries its card',
      /Saved \*\*sample\.docx\*\* to your library/.test(lastE.text) &&
        lastE.cards[0].type === 'material' &&
        (await page.locator('#ev-surf').locator('button', { hasText: 'Remove from library' }).count()) === 1,
      lastE.text
    );
    ok('his message shows the attachment', /Attached \*\*sample\.docx\*\*/.test((await msgs(page)).slice(-2)[0].text));
    await page.evaluate(() => {
      window.__chatScript = [];
      window.__chatReply = 'Ok.';
    });
    await send(page, 'quiz me on it');
    await page.waitForTimeout(250);
    ok(
      'the chat knows what he just attached',
      /Files he just attached \(in the materials tool\): up-\d{4}-\d{2}-\d{2}-sample "sample\.docx"/.test(
        (await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)))).input[0]
          .content
      )
    );
    // A photo: read by Claude through sample images
    await page.evaluate(() => {
      window.__sampleFn = p =>
        /Transcribe all the text/.test(p)
          ? { pages: [{ page: 1, text: 'Erikson: trust vs. mistrust in infancy' }] }
          : { items: [] };
    });
    await page.setInputFiles('#ev-file', {
      name: 'erikson-photo.png',
      mimeType: 'image/png',
      buffer: fs.readFileSync(path.join(root, 'test/data/sample.png')),
    });
    await page.waitForTimeout(800);
    up = await mats();
    const ph = up.find(u => /erikson-photo/.test(u.id));
    const ocrCall = await page.evaluate(() => (window.__jsonCalls || []).slice(-1)[0]);
    ok(
      'a photo is read by Claude and saved with its source marked',
      ph &&
        ph.text === '[p1] Erikson: trust vs. mistrust in infancy' &&
        ph.ocr &&
        ph.ocr.pages[0] === 1 &&
        ocrCall.images === 1 &&
        ocrCall.tier === 'default',
      JSON.stringify(ph && { t: ph.text, o: ph.ocr })
    );
    // D-324: a text file with a record number is saved as it is; nothing is left out as an identifier.
    const before4 = (await mats()).length;
    await page.setInputFiles('#ev-file', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Client notes. MRN: 4482913. Ambulated twice.'),
    });
    await page.waitForTimeout(500);
    const notes = (await mats()).find(u => /notes/.test(u.id));
    ok(
      'an attachment with a record number is saved whole (D-324)',
      (await mats()).length === before4 + 1 &&
        notes &&
        /MRN: 4482913/.test(notes.text) &&
        !/\[left out\]|real patient/.test((await msgs(page)).slice(-1)[0].text),
      (await msgs(page)).slice(-1)[0].text
    );
    // A PDF: text pages with pdf.js, the image-only page read by Claude
    if (hasPdfjs) {
      await page.evaluate(() => {
        window.__sampleFn = p =>
          /Transcribe all the text/.test(p)
            ? { pages: [{ page: 2, text: 'Scanned page: Erikson stages. Trust vs. mistrust (infancy)' }] }
            : { items: [] };
      });
      await page.setInputFiles('#ev-file', path.join(root, 'test/data/sample.pdf'));
      await page.waitForTimeout(3000);
      const pdf = (await mats()).find(u => /-sample-2$|-sample$/.test(u.id) && u.fileType === 'pdf');
      ok(
        'a PDF is read: text pages directly, the picture page by Claude',
        pdf &&
          /^\[p1\] Head-to-Toe Assessment Checklist Perform hand hygiene/.test(pdf.text) &&
          /\[p2\] Scanned page: Erikson stages/.test(pdf.text) &&
          pdf.pages === 2 &&
          pdf.ocr.pages.join() === '2',
        JSON.stringify(pdf && { id: pdf.id, t: pdf.text.slice(0, 160), o: pdf.ocr }) +
          ' | ' +
          (await msgs(page)).slice(-1)[0].text
      );
    } else console.log('NOTE PDF attachment checks skipped: npm install --no-save pdfjs-dist@4.4.168');
    // B-359 (D-316): Record's Library screen left the page (the materials stay in the record); an upload's Remove from
    // library stays on its material card (the latest reply's surface): it marks materialedits and keeps the material
    {
      const mat = [...(await msgs(page))]
        .reverse()
        .map(m => (m.cards || []).find(c => c && c.type === 'material'))
        .find(Boolean);
      const rmBtn = page.locator('#ev-surf').locator('button', { hasText: 'Remove from library' }).first();
      const had = !!mat && (await rmBtn.count()) > 0;
      if (had) await rmBtn.click();
      await page.waitForTimeout(300);
      const rm = await page.evaluate(
        id => (id ? [window.__db.materials[id], (window.__db.materialedits || {})[id]] : null),
        mat && mat.id
      );
      ok(
        'Remove from library on the material card marks materialedits by Matt and keeps the material (B-11)',
        had && !!rm && !!rm[1] && !!rm[1].removed && rm[1].removed.by === 'Matt' && !!rm[0] && rm[0].text.length > 0,
        JSON.stringify({ had, id: mat && mat.id, ed: rm && rm[1] })
      );
    }
    await page.evaluate(() => {
      window.__sampleFn = null;
    });
    // Study > Review: the migrated set, all answered
    await quizMeChecks(page, scheme); // B-297
    await practiceSetsChecks(page, scheme); // B-482
    await flashcardsChecks(page, scheme); // B-487
    await studyView(page, 'review'); // B-297 (D-283): today's review opens from Today
    await page.waitForTimeout(100);
    const rv = await page.textContent('#rv-body');
    const rvOpen = await page.evaluate(
      () => !!document.querySelector('#rv-body label.opt') && !document.querySelector('#rv-body .verdict')
    );
    ok(
      'review summary from migrated answers',
      reviewExpect ? rv.includes(reviewExpect) : rvOpen,
      (reviewExpect || '(unanswered)') + ' · ' + rv.slice(0, 80)
    );
    // Practice: open the harness set, answer single (right), sata (wrong), matrix (right)
    // B-303 (D-283): the Practice list is retired: Study offers no list of sets, and a set opens where he meets it
    // (here a row of today's list naming it)
    await studyView(page, 'practice');
    await page.waitForTimeout(100);
    await closeSet(page);
    await page.waitForTimeout(100);
    ok(
      'Study has no list of sets: the open set folds back to Objectives (D-283)',
      (await page.isVisible('#study-objectives')) &&
        !(await page.locator('#pr-body .pr-lead, #pr-body .pr-item, #pr-done-fold').count())
    );
    const openSet = async title => openSetById(page, await byTitle(page, title));
    // B-54 (D-110): an open calendar drill over a chapter range offers Share as a page above its questions; other sets do not
    {
      const ids = await page.evaluate(() => {
        const pl = Object.entries(window.__db.plans || {}).map(([id, p]) => ({ id, ...p }));
        const views = window.EVCore.planViews(pl, []);
        const all = Object.entries(window.__db.sets)
          .map(([id, x]) => ({ id, ...x }))
          .filter(x => x.kind !== 'review' && window.EVCore.validItems(x).length);
        return {
          yes: all.filter(x => window.EVCore.shareableSet(x, views).ok).map(x => x.title),
          no: all.filter(x => !window.EVCore.shareableSet(x, views).ok).map(x => x.title),
        };
      });
      ok(
        'only a calendar drill over a chapter range qualifies here',
        ids.yes.length >= 1 &&
          ids.no.some(t => /weak spots/.test(t)) &&
          ids.no.includes('Harness set') &&
          !ids.yes.some(t => /weak spots/.test(t)),
        JSON.stringify(ids)
      );
      if (ids.yes.length) {
        await openSet(ids.yes[0]);
        await page.waitForTimeout(250);
        ok(
          'an open calendar drill offers Share as a page above its questions',
          (await page.isVisible('#pr-share')) &&
            (await page.locator('#pr-share button', { hasText: 'Share as a page' }).count()) === 1,
          ids.yes[0]
        );
        const before = await page.evaluate(() => window.__mcpCalls.filter(c => c[1] === 'fire_trigger').length);
        await page.locator('#pr-share button', { hasText: 'Share as a page' }).click();
        await page.waitForTimeout(400);
        const sj = await page.evaluate(() =>
          Object.entries(window.__db.jobs)
            .filter(([, j]) => j.kind === 'share-set')
            .map(([id, j]) => ({ id, ...j }))
        );
        const fires = await page.evaluate(() =>
          window.__mcpCalls.filter(c => c[1] === 'fire_trigger').map(c => c[2].text)
        );
        ok(
          'Share as a page starts one share-set job naming the set, fired on the worker',
          sj.length === 1 &&
            /^[\w.-]+: share it as a page for classmates$/.test(sj[0].brief) &&
            fires.length === before + 1 &&
            fires[fires.length - 1] === 'Job ' + sj[0].id,
          JSON.stringify(sj.map(j => j.brief))
        );
        ok(
          'while it is made, the bar says so',
          (await page.locator('#pr-share button', { hasText: 'Making its page…' }).count()) === 1
        );
        await page.screenshot({ path: `${shots}/share-bar-phone.png` });
        await page.click('#study-back');
        await page.waitForTimeout(150);
        ok('back on Objectives, the share bar goes', !(await page.isVisible('#pr-share')));
      }
    }
    const model = id =>
      page.evaluate(id => {
        const rows = c => Object.entries(window.__db[c] || {}).map(([k, v]) => ({ id: k, ...v }));
        return (
          window.EVCore.buildWeakspots({
            weakspots: rows('weakspots'),
            sets: rows('sets'),
            answers: rows('answers'),
            exams: rows('exams'),
          }).find(w => w.id === id) || {}
        ).derived;
      }, id);
    const agingDerived = await model('e4-aging-expected');
    const agingBefore = (agingDerived && agingDerived.streak) || 0;
    const agingRightToday =
      !!agingDerived && agingDerived.lastReviewed === today && agingDerived.lastResult === 'right';
    const prePre = await model('e4-preschooler'); // the export can already hold his answers on it
    const preStreak =
      prePre && prePre.lastResult === 'right' ? (prePre.lastReviewed === today ? prePre.streak - 1 : prePre.streak) : 0;
    // B-43 (D-100): a numeric item takes a number beside its unit; answered, the verdict, the answer when missed, and
    // the worked steps; the answer lands as {value, unit}.
    {
      await openSet('Harness dosage');
      await page.waitForTimeout(120);
      const field = page.locator('#pr-body input.num-in');
      const unit = await page.textContent('#pr-body .num-unit').catch(() => '');
      const check = page.locator('#pr-body button', { hasText: 'Check answer' });
      const off = await check.isDisabled();
      await field.fill('10');
      await check.click();
      await page.waitForTimeout(150);
      const n1 = await page.evaluate(t => {
        const a = ((window.__db.answers || {})['more-' + t + '-dose'] || {}).answers || {};
        return {
          verdict: document.querySelector('#pr-body .verdict').textContent,
          steps: document.querySelectorAll('#pr-body .num-steps li').length,
          shown: !!document.querySelector('#pr-body .num-answer'),
          saved: Object.values(a.n1 || {}).map(x => [x.chosen, x.correct]),
        };
      }, today);
      ok(
        `[${scheme}] a numeric item: a number field beside its unit (mL), Check answer waits for a number; 10 is Right, the worked steps show, saved as {value, unit} (B-43)`,
        unit === 'mL' &&
          off &&
          /^Right\b/.test(n1.verdict) &&
          n1.steps === 2 &&
          !n1.shown &&
          JSON.stringify(n1.saved) === JSON.stringify([[{ value: 10, unit: 'mL' }, true]]),
        JSON.stringify({ unit, off, ...n1 })
      );
      await page.click('#pr-body button:has-text("Next question")');
      await page.waitForTimeout(100);
      await page.locator('#pr-body input.num-in').fill('126');
      await checkAnswer(page, '#pr-body');
      await page.waitForTimeout(150);
      const n2 = await page.evaluate(() => ({
        verdict: document.querySelector('#pr-body .verdict').textContent,
        answer: (document.querySelector('#pr-body .num-answer') || {}).textContent || '',
        steps: document.querySelectorAll('#pr-body .num-steps li').length,
      }));
      ok(
        `[${scheme}] past its tolerance (126 for 125 ± 0.5 mL/hr) is Missed, with the answer and its worked step (B-43)`,
        /^Missed\b/.test(n2.verdict) && n2.answer === 'Answer: 125 mL/hr' && n2.steps === 1,
        JSON.stringify(n2)
      );
      await page.screenshot({ path: `${shots}/dosage-${scheme}.png`, fullPage: false });
      await page
        .locator('#pr-body button', { hasText: /See results/ })
        .first()
        .click();
      await page.waitForTimeout(150);
      await page.click('#study-back');
      await page.waitForTimeout(150);
    }
    await openSet('Harness set');
    await page.waitForTimeout(100);
    ok('a set made for him offers no Share', !(await page.isVisible('#pr-share')));
    // B-192: options show in a seeded order, so the harness picks them by their words.
    {
      // B-211 (D-217): each answer carries its letter, as the demo's StudyQuiz (B-348), and that key picks it.
      const kb = await page.evaluate(() => {
        const labs = [...document.querySelectorAll('#pr-body label.opt')];
        return {
          nums: labs.map(l => (l.querySelector('kbd.opt-n') || {}).textContent).join(''),
          at: labs.findIndex(l => /Forward-facing seat with harness/.test(l.textContent)),
        };
      });
      await page.keyboard.press('abcd'[kb.at]);
      const picked = await page
        .locator('#pr-body label.opt', { hasText: 'Forward-facing seat with harness' })
        .locator('input')
        .isChecked();
      ok(
        'the answers are lettered A to D and a letter key picks one (D-217, B-348)',
        kb.nums === 'ABCD' && picked,
        JSON.stringify(kb)
      );
    }
    await checkAnswer(page, '#pr-body');
    await page.waitForTimeout(150);
    ok('single answered and scored', /^Right\b/.test(await page.textContent('#pr-body .verdict')));
    let ws = await model('e4-preschooler');
    ok(
      'the answer lands in answers/<setId> and the weak spot is recomputed from it',
      ws &&
        ws.streak === preStreak + 1 &&
        ws.lastResult === 'right' &&
        (await page.evaluate(t => {
          const a = (window.__db.answers || {})['more-' + t + '-1'];
          return (
            !!a &&
            a.writer === 'page' &&
            Object.keys(a.answers.m1 || {}).length === 1 &&
            !window.__db.weakspots['e4-preschooler'].derived
          );
        }, today)),
      JSON.stringify(ws && { s: ws.streak, n: ws.nextDue })
    );
    await page.click('#pr-body button:has-text("Next question")');
    await page.waitForTimeout(100);
    await page.locator('#pr-body label.opt', { hasText: 'Sit at eye level' }).click();
    await page.locator('#pr-body label.opt', { hasText: 'Speak quickly to save time' }).click();
    await checkAnswer(page, '#pr-body');
    await page.waitForTimeout(150);
    const t2 = await page.textContent('#pr-body');
    ok('select-all partial credit shown', /Partly right|Missed/.test(t2));
    const created = await page.evaluate(() => Object.keys(window.__db.weakspots).filter(k => k.includes('E4-2')));
    ok('missed check created a weak spot', created.length === 1, created.join(','));
    await page.click('#pr-body button:has-text("Next question")');
    await page.waitForTimeout(100);
    const radios = page.locator('#pr-body table.mx input[type=radio]');
    ok('matrix renders 3 rows x 2 columns', (await radios.count()) === 6);
    await page.check('#pr-body table.mx input[aria-label="Thinner, drier skin: Expected"]');
    await page.check('#pr-body table.mx input[aria-label="New confusion since yesterday: Unexpected"]');
    await page.check('#pr-body table.mx input[aria-label="Slower reaction time: Expected"]');
    await checkAnswer(page, '#pr-body');
    await page.waitForTimeout(150);
    ok('matrix answered correctly', /^Right\b/.test(await page.textContent('#pr-body .verdict')));
    ws = await model('e4-aging-expected');
    ok(
      'matrix right: today counts once toward the streak',
      ws.streak === agingBefore + 1 || (ws.streak === agingBefore && agingRightToday),
      JSON.stringify({ before: agingBefore, s: ws.streak, last: ws.lastReviewed })
    );
    await page.screenshot({ path: `${shots}/practice.png`, fullPage: true });
    // B-39 (D-095): every attempt is truth: nothing an answer wrote is replaced
    {
      const setId = 'more-' + today + '-1';
      const tries = () =>
        page.evaluate(
          id => Object.keys((((window.__db.answers || {})[id] || {}).answers || {}).m1 || {}).length,
          setId
        );
      const before = await tries();
      const next = page.locator('#pr-body button', { hasText: /See results|Next question|Summary/ }).first();
      if (await next.count()) {
        await next.click();
        await page.waitForTimeout(150);
      }
      // B-370 (D-316): in Study the results card is the demo's: New quiz and Back to topics, with Review for the
      // misses; no Retake (an answer is still only ever appended: the answers document keeps every attempt)
      const acts = await page.locator('#pr-body button').allTextContents();
      ok(
        "a finished set offers the demo's New quiz and Back to topics, no Retake, and keeps every attempt",
        acts.some(t => /New quiz/.test(t)) &&
          acts.some(t => /Back to topics/.test(t)) &&
          !acts.some(t => /^Retake$/.test(t.trim())) &&
          (await tries()) >= Math.max(1, before),
        JSON.stringify(acts)
      );
      await page.screenshot({ path: `${shots}/retake-${scheme}.png`, fullPage: false });
      await page.locator('#pr-body button', { hasText: 'Back to topics' }).first().click();
      await page.waitForTimeout(2200);
    }
    await practiceNav(page, scheme); // B-191
    // Plan: B-450 (D-354, D-357): no Plan tab or screen; each exam's plan is a card of day rows under its exam card.
    if (await page.isVisible('#study-back')) await page.click('#study-back'); // B-297: out of the quiz card
    ok(
      `[${scheme}] no Plan view in Study: the plan is in the overview (B-450)`,
      !(await page.$('#seg-study [data-v="plan"]')) && !(await page.$('#plan-card'))
    );
    {
      // the old exam plan's day (no tags: no badge) opens on a tap; its tick saves to planedits/E4, the plan untouched
      const day = page.locator('#ov-plans .pl-card[data-plan="E4"] .pl-day:not(.open) .pl-dr').first();
      await day.click();
      await page.waitForTimeout(150);
      const open = page.locator('#ov-plans .pl-card[data-plan="E4"] .pl-day.open').first();
      ok('a plan day opens to its tasks on a tap', (await open.locator('.pl-t input.tick').count()) > 0);
      // B-450: an older plan's tags show as the nearest of the six (DRILL is Practice), for display only
      const legacy = await open.locator('.pl-t .badge').allTextContents();
      ok(
        'an older plan’s tag shows as its nearest badge (DRILL: Practice)',
        JSON.stringify(legacy) === '["Practice"]',
        JSON.stringify(legacy)
      );
      const before = await page.evaluate(
        () => Object.keys(((window.__db.planedits || {}).E4 || {}).ticks || {}).length
      );
      const firstUnchecked = open.locator('input.tick:not(:checked)').first();
      // One element, resolved once: check() on the :not(:checked) locator re-resolves after the re-render
      await (await firstUnchecked.elementHandle()).click();
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => Object.keys(((window.__db.planedits || {}).E4 || {}).ticks || {}).length);
      ok(
        'plan tick saved to planedits/E4, the plan untouched',
        after === before + 1 && !(await page.evaluate(() => window.__db.plans.E4.done)),
        before + ' -> ' + after
      );
      await page.screenshot({ path: `${shots}/plan.png`, fullPage: true });
    }
    await studyPlanChecks(page); // B-450
    // Progress
    await page.click('#tab-progress');
    await page.waitForTimeout(100);
    // B-366 (D-316): the demo has no score form, so Record your score left Progress; saved scores stay in the record
    ok('Progress shows no score form (B-366)', !(await page.isVisible('#score-card')));
    // B-381: his score reaches the record through her record_score tool: the same examedits write (D-094), the exam
    // itself unchanged, then the exam-retro job, fired once (D-104)
    {
      await page.click('#tab-ev');
      await page.evaluate(() => {
        window.__chatScript = [{ tool: 'record_score', input: { exam: 'E0H', score: 88.5 } }];
        window.__chatReply = 'Saved 88.5 for Harness Exam 0.';
      });
      await send(page, 'I got 88.5 on Harness Exam 0');
      await page.waitForTimeout(600);
      const ed = await page.evaluate(() => (window.__db.examedits || {}).E0H);
      ok(
        'a score he says lands in examedits/<examId> through record_score, the exam itself unchanged',
        !!ed &&
          ed.score === 88.5 &&
          ed.status === 'done' &&
          ed.writer === 'page' &&
          (await page.evaluate(() => !('score' in window.__db.exams.E0H))),
        JSON.stringify(ed)
      );
      const rj = await page.evaluate(() =>
        Object.entries(window.__db.jobs || {})
          .filter(([, j]) => j.kind === 'exam-retro' && /^E0H: /.test(j.brief || ''))
          .map(([id, j]) => ({ id, ...j }))
      );
      const rf = await page.evaluate(() => window.__mcpCalls.filter(c => c[1] === 'fire_trigger').map(c => c[2].text));
      ok(
        'a saved score starts the retro job for that exam, fired once',
        rj.length === 1 &&
          /^E0H: /.test(rj[0].brief) &&
          rj[0].fired &&
          rj[0].fired.ok === true &&
          rf.filter(t => t === 'Job ' + rj[0].id).length === 1,
        JSON.stringify(rj.map(j => [j.brief, j.fired]))
      );
      await page.evaluate(() => {
        window.__chatScript = [];
      });
      await page.click('#tab-progress');
      await page.waitForTimeout(100);
    }
    // B-301 (C-6): a planted week. Each bar's day panel lists the sessions that make up that bar and adds up to it; a
    // workout and a note on the same day never appear there; the bars are 44 px or wider at 390.
    {
      const plant = await page.evaluate(async () => {
        const E = window.EVCore,
          t = E.chicagoDate(new Date()),
          mon = E.addDays(t, -((E.weekday(t) + 6) % 7));
        const d0 = mon === t ? t : E.addDays(t, -1),
          d1 = mon;
        const db = await window.claude.use('db'),
          at = new Date().toISOString();
        const ss = [
          ['pw-a', d0, 35, 'Planted: acid-base', 'NUR 112'],
          ['pw-b', d0, 20, 'Planted: skull bones', 'BIO 201'],
          ['pw-c', d1, 15, 'Planted: fluid shifts', 'NUR 112'],
        ];
        for (const [id, date, minutes, topic, folder] of ss)
          await db
            .collection('sessions')
            .doc(id)
            .set({
              schema: 2,
              writer: 'page',
              at,
              source: 'E.V. Home',
              status: 'ended',
              date,
              // late in the day (Chicago), so on a Monday, when both days are today, the planted sessions are the
              // day's newest and the panel's five rows hold them ahead of the seed's own entries for today
              startedAt: E.addDays(date, 1) + 'T03:00:00.000Z',
              endedAt: E.addDays(date, 1) + 'T03:30:00.000Z',
              topic,
              folder,
              minutes,
            });
        await db
          .collection('workouts')
          .doc('pw-wk')
          .set({
            schema: 1,
            writer: 'page',
            at,
            source: 'E.V. Home',
            sequence: 'cindy',
            title: 'Planted workout',
            date: d0,
            status: 'done',
            startedAt: d0 + 'T16:00:00.000Z',
            endedAt: d0 + 'T16:20:00.000Z',
          });
        await db
          .collection('ideas')
          .doc('pw-note')
          .set({
            schema: 1,
            writer: 'page',
            at,
            source: 'E.V. Home',
            title: 'Planted note',
            postedAt: d0 + 'T17:00:00.000Z',
            date: d0,
          });
        return { d0, d1, t };
      });
      await page.waitForTimeout(300);
      await page.click('#tab-study');
      await page.click('#tab-progress');
      await page.click('#prog-period [data-p="week"]');
      await page.waitForTimeout(150);
      for (const [w, h] of [
        [390, 844],
        [1280, 900],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(200);
        const bars = await page.evaluate(() =>
          [...document.querySelectorAll('#prog-chart .pc-bar')].map(b => b.dataset.key)
        );
        const rows = [];
        for (const key of bars) {
          await page.click(`#prog-chart .pc-bar[data-key="${key}"]`);
          await page.waitForTimeout(40);
          rows.push(
            await page.evaluate(k => {
              const bar = document.querySelector(`#prog-chart .pc-bar[data-key="${k}"]`);
              // B-342 (D-327): the demo's day panel: the day's total over what it holds in Record (sessions, quizzes, notes)
              const items = [...document.querySelectorAll('#prog-day .prog-s')];
              const tt = (document.querySelector('#prog-day .prog-day-total') || {}).textContent || '';
              const mm = /^(\d+) h(?: (\d+) m)?$/.exec(tt) || [];
              const m2 = /^(\d+) min$/.exec(tt) || [];
              const want = Object.entries(window.__db.sessions || {})
                .filter(([, s]) => s.date === k && s.status !== 'active' && (s.minutes || 0) > 0)
                .map(([id, s]) => [id, s.minutes]);
              return {
                k,
                bar: Number(bar.dataset.min),
                sum: mm[1] ? 60 * Number(mm[1]) + Number(mm[2] || 0) : m2[1] ? Number(m2[1]) : NaN,
                ids: items
                  .filter(li => li.dataset.kind === 'session')
                  .map(li => li.dataset.id)
                  .sort(),
                kinds: items.map(li => li.dataset.kind),
                want: want.map(x => x[0]).sort(),
                wantMin: want.reduce((a, x) => a + x[1], 0),
                text: document.getElementById('prog-day').textContent,
                width: Math.round(bar.getBoundingClientRect().width),
              };
            }, key)
          );
        }
        ok(
          `[${w}] Progress: on a planted week each day panel's total is its bar, the day's sessions' minutes, and lists them`,
          rows.length === 7 &&
            // a day after today reads Ahead (the demo's), with no bar
            rows.every(r =>
              r.k > plant.t
                ? r.bar === 0 && /Ahead/.test(r.text)
                : r.sum === r.bar && r.bar === r.wantMin && r.ids.every(i => r.want.includes(i))
            ) &&
            rows.find(r => r.k === plant.d0).ids.includes('pw-a') &&
            rows.find(r => r.k === plant.d1).ids.includes('pw-c'),
          JSON.stringify(rows.map(r => [r.k, r.bar, r.sum, r.ids.length]))
        );
        ok(
          `[${w}] Progress: no workout appears in the day panel (its notes do, as the demo's)`,
          rows.every(r => !/Planted workout/.test(r.text) && !r.kinds.includes('workout')),
          rows.find(r => r.k === plant.d0).text.slice(0, 160)
        );
        if (w === 390)
          ok(
            '[390] Progress: every bar measures 44 px or wider',
            rows.every(r => r.width >= 44),
            rows.map(r => r.width).join(',')
          );
        await page.click(`#prog-chart .pc-bar[data-key="${plant.d0}"]`);
        await page.waitForTimeout(80);
        for (const th of ['light', 'dark']) {
          await page.evaluate(m => document.documentElement.setAttribute('data-theme', m), th);
          await page.waitForTimeout(80);
          await page.screenshot({ path: `${shots}/progress-${w}-${th}.png`, fullPage: w < 600 });
        }
        await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      }
      // the month and the semester: their bars add up to the period's study time, and a picked bar's panel to the bar
      for (const p of ['month', 'sem']) {
        await page.click(`#prog-period [data-p="${p}"]`);
        await page.waitForTimeout(100);
        const r = await page.evaluate(() => {
          const bars = [...document.querySelectorAll('#prog-chart .pc-bar')];
          const pick = bars.find(b => b.getAttribute('aria-pressed') === 'true');
          return {
            n: bars.length,
            pressed: document.querySelector('#prog-period [aria-pressed="true"]').dataset.p,
            bar: Number(pick.dataset.min),
            sum: (t => {
              const a = /^(\d+) h(?: (\d+) m)?$/.exec(t) || [],
                b = /^(\d+) min$/.exec(t) || [];
              return a[1] ? 60 * Number(a[1]) + Number(a[2] || 0) : b[1] ? Number(b[1]) : NaN;
            })((document.querySelector('#prog-day .prog-day-total') || {}).textContent || ''),
            stats: document.getElementById('prog-stats').textContent,
          };
        });
        ok(
          `Progress (${p}): the switch shows it picked, and the picked bar's panel totals the bar`,
          r.pressed === p &&
            r.n >= 1 &&
            r.sum === r.bar &&
            /Study time/.test(r.stats) &&
            /Quiz accuracy/.test(r.stats) &&
            /Weak spots/.test(r.stats),
          JSON.stringify(r)
        );
      }
      await page.click('#prog-period [data-p="week"]');
      await page.setViewportSize({ width: 390, height: 844 });
      ok(
        'Progress: no topic-share line and no Copy summary',
        !/share of|Copy summary/i.test(await page.textContent('#p-progress'))
      );
    }
    // B-338, B-342 (D-327): the readiness card, its line chart and the week's insights left Progress (their data stays
    // in the record); its Exam readiness rows count each course's next exam's objectives
    {
      const rd = await page.textContent('#prog-ready');
      ok(
        'Progress: exam readiness names Exam 4; no readiness card or insights card',
        /Exam 4/.test(rd) && !(await page.isVisible('#ready-card')) && !(await page.isVisible('#insights-card')),
        rd.slice(0, 120)
      );
      // make_practice aims its spare questions at the weekly's weakest objective.
      await page.evaluate(() => {
        window.__jsonCalls = [];
        window.__chatScript = [{ tool: 'make_practice', input: {} }];
        window.__chatReply = 'Writing them.';
      });
      await page.click('#tab-ev');
      await send(page, 'Give me 5 more questions');
      await page.waitForTimeout(400);
      const prompts = await page.evaluate(() => (window.__jsonCalls || []).map(c => String(c.prompt)));
      ok(
        'make_practice targets the weakest objective from the latest weeks document',
        prompts.some(p => /Weakest objective so far: E4-3 \(2 of 7 right\)/.test(p)),
        prompts.map(p => (p.match(/Weakest objective so far:[^.]*/) || [''])[0]).join(' | ')
      );
      await page.evaluate(() => {
        window.__chatScript = [];
      });
      await page.click('#tab-progress');
      await page.waitForTimeout(150);
    }
    await studyView(page, 'weak'); // B-297 (D-281): weak spots live in Study
    await page.waitForTimeout(100);
    // B-365 (D-316): Weak spots as the demo's StudyWeak: open rows by when they are due, previews and solid quiet,
    // each open row with Drill and Mark solid; no Copy for Quizlet
    ok(
      'weak spots listed',
      (await page.locator('#weak-list .wl[data-id]:not(.quiet)').count()) > 5,
      String(await page.locator('#weak-list .wl[data-id]:not(.quiet)').count())
    );
    // B-371 (D-316): the demo's sections only: To review · N when this run's misses were proposed (B-407), then Open · N
    // in the course; previews and solid ones stay in the record
    const heads = await page.$$eval('#weak-list .dayh', xs => xs.map(x => x.textContent));
    ok(
      'weak spots: To review (when any), Open · N in the course, and no previews or solid section',
      /^(To review · \d+\|)?Open · \d+ in /.test(heads.join('|')) &&
        !/Previews, before the reading|Solid ·/.test(await page.textContent('#weak-list')),
      (await page.textContent('#weak-list')).slice(0, 200)
    );
    await page
      .locator('#weak-list .wl[data-id]:not(.quiet)')
      .first()
      .locator('button', { hasText: 'Mark solid' })
      .click();
    await page.waitForTimeout(150);
    const solidEv = await page.evaluate(() =>
      Object.entries(window.__db.weakspots)
        .filter(([, w]) => w.events && Object.values(w.events).some(e => e.type === 'solid' && e.by === 'owner'))
        .map(([id]) => id)
    );
    ok('mark solid writes an owner event', solidEv.length === 1, solidEv.join(','));
    ok('weak spots: no Copy for Quizlet, as the demo (B-365)', !(await page.isVisible('#weak-quizlet-btn')));
    await page.screenshot({ path: `${shots}/progress.png`, fullPage: true });
    // Record
    await page.click('#tab-record');
    await page.waitForTimeout(100);
    // B-302: the log's helpers. A note's detail opens from its row (the right panel from 1200 px, under the row below).
    const recRow = (kind, text) =>
      page
        .locator(`#rec-list .rec-li[data-kind="${kind}"]`)
        .filter({ has: page.locator('.nm', { hasText: text }) })
        .first();
    const recById = id => page.locator(`#rec-list .rec-li[data-id="${id}"]`);
    const recOpen = async (kind, text) => {
      const r = recRow(kind, text);
      if ((await r.locator('.nm').getAttribute('aria-expanded')) !== 'true') await r.locator('.nm').click();
      await page.waitForTimeout(80);
      return page.locator('#rec-detail');
    };
    {
      const want = await page.evaluate(
        () => Object.values(window.__db.sessions || {}).filter(x => x.status !== 'active').length
      );
      const got = await page.locator('#rec-list .rec-li[data-kind="session"]').count();
      ok(
        'sessions listed in the log (every session the record holds that is not running)',
        got >= 2 && got === want,
        JSON.stringify({ got, want })
      );
    }
    {
      const ids = await page.$$eval('#rec-list .rec-li[data-kind="note"]', ls => ls.map(l => l.dataset.id));
      let linked = false;
      for (const id of ids) {
        const nm = recById(id).locator('.nm');
        if ((await nm.getAttribute('aria-expanded')) !== 'true') await nm.click();
        await page.waitForTimeout(60);
        if (/1 link/.test(await page.textContent('#rec-detail'))) linked = true;
      }
      ok('a note with a link shows it in its detail', linked, ids.join(' | ').slice(0, 160));
    }
    // B-53 (D-109): every note shows its kind and the kind can change; B-303 (D-290): no note offers "Make it a weak spot"
    {
      const kindOf = async t => (await recRow('note', t).locator('.r').textContent()).trim();
      const acts = async t => (await recOpen('note', t)).locator('button', { hasText: 'Make it a weak spot' }).count();
      ok(
        'a feature note shows its kind and no weak-spot action',
        (await kindOf('Harness feature idea')) === 'Feature' && (await acts('Harness feature idea')) === 0
      );
      ok(
        'a general note shows its kind and no weak-spot action',
        (await kindOf('Harness general idea')) === 'General' && (await acts('Harness general idea')) === 0
      );
      ok(
        'a learning note shows its kind and no weak-spot action either (D-290)',
        (await kindOf('Harness learning idea')) === 'Learning' && (await acts('Harness learning idea')) === 0
      );
      // B-111: the kind menu is the detail's, never the row's.
      ok(
        "a note's kind menu waits until its row is opened",
        (await page.locator('#rec-list .rec-li select').count()) === 0
      );
      await (await recOpen('note', 'Harness feature idea')).locator('select.idea-kind').selectOption('learning');
      await page.waitForTimeout(200);
      const k = await page.evaluate(() => window.__db.ideas['idea-harness-feature'].kind);
      ok(
        'changing the kind writes it (a mark), and still no weak-spot action (D-290)',
        k === 'learning' && (await acts('Harness feature idea')) === 0,
        k
      );
      await page.screenshot({ path: `${shots}/ideas-${scheme}.png`, fullPage: false });
    }
    // B-302 (C-1, C-7, C-13): the log at 1280 and 390, light and dark, its filter open. Rows are 32 px at 1280 and 44
    // px at 390 with the time on the row's line; every switch segment on the view is 44 px or more at 390; nothing on
    // the view creates; the type tabs and the filter narrow the rows, and Show workouts hides the workouts.
    for (const w of [1280, 390]) {
      await page.setViewportSize(w === 390 ? { width: 390, height: 844 } : { width: 1280, height: 860 });
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const box = e => e.getBoundingClientRect();
        const rows = [...document.querySelectorAll('#rec-list .rec-li')].map(li => {
          const r = box(li),
            t = box(li.querySelector('.t')),
            nm = box(li.querySelector('.nm'));
          return {
            h: Math.round(r.height),
            line: t.height > 0 && t.top >= r.top - 1 && t.bottom <= r.bottom + 1 && Math.abs(t.top - nm.top) < r.height,
            time: li.querySelector('.t').textContent,
          };
        });
        const view = document.getElementById('record-sessions');
        const creates = [...document.querySelectorAll('#p-record button')].filter(
          b =>
            b.offsetParent &&
            !b.closest('[hidden]') &&
            /^\s*(\+\s*)?(Log something|New|Add|Create)\b/i.test(b.textContent)
        );
        return {
          rows,
          creates: creates.map(b => b.textContent.trim()),
          sideways: document.documentElement.scrollWidth > innerWidth,
          kinds: [...new Set([...view.querySelectorAll('.rec-li')].map(li => li.dataset.kind))],
        };
      });
      ok(
        `[${w}] Record: every row has its time on the row's line (B-357: the demo's heights, no fixed px)`,
        m.rows.length >= 4 && m.rows.every(r => r.line) && m.rows.some(r => /\d:\d\d [ap]m/i.test(r.time)),
        JSON.stringify(m.rows.slice(0, 6))
      );
      // B-357 (D-316): the demo's Record has Log something, so the old no-create rule (C-7) is retired
      ok(`[${w}] Record: no sideways scroll`, !m.sideways, JSON.stringify(m.creates));
      ok(
        `[${w}] Record: the log holds sessions, quizzes, notes and workouts`,
        ['session', 'quiz', 'note', 'workout'].every(k => m.kinds.includes(k)),
        m.kinds.join(',')
      );
      await page.click('#rec-filter-btn');
      await page.waitForTimeout(100);
      const segs = await page.evaluate(() =>
        [...document.querySelectorAll('#p-record .seg button')]
          .filter(b => b.offsetParent && b.getBoundingClientRect().height > 0)
          .map(b => [
            b.textContent.trim(),
            Math.round(b.getBoundingClientRect().width),
            Math.round(b.getBoundingClientRect().height),
          ])
      );
      if (w === 390)
        ok(
          '[390] Record: every segment is 44 px tall or more, the filter open',
          segs.length >= 10 && segs.every(([, , h]) => h >= 44),
          JSON.stringify(segs)
        );
      for (const th of ['light', 'dark']) {
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), th);
        await page.waitForTimeout(80);
        await page.screenshot({ path: `${shots}/record-${w}-${th}.png`, fullPage: false });
      }
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      // the filter narrows: Show workouts off hides them; Today keeps only today's; Reset brings all back
      const count = k => page.locator(`#rec-list .rec-li${k ? `[data-kind="${k}"]` : ''}`).count();
      const all = await count();
      await page.click('#rec-workouts');
      await page.waitForTimeout(60);
      const noWo = await count('workout');
      await page.click('#rec-filter [aria-label="When"] [data-v="today"]');
      await page.waitForTimeout(60);
      const days = await page.locator('#rec-list .rec-day').allTextContents();
      const label = await page.textContent('#rec-filter-btn');
      await page.click('#rec-filter button:has-text("Reset")');
      await page.waitForTimeout(60);
      const back = await count();
      ok(
        `[${w}] Record: Show workouts off hides them, Today keeps today's, Reset brings every row back`,
        noWo === 0 && days.every(d => d === 'Today') && /Filter · 2/.test(label) && back === all,
        JSON.stringify({ all, noWo, days, label, back })
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(60);
      ok(`[${w}] Record: Esc closes the filter`, await page.isHidden('#rec-filter'));
      // a type tab shows only its type
      await page.click('#rec-types [data-v="quiz"]');
      await page.waitForTimeout(60);
      const qs = await page.evaluate(() =>
        [...document.querySelectorAll('#rec-list .rec-li')].map(li => li.dataset.kind)
      );
      await page.click('#rec-types [data-v="all"]');
      ok(`[${w}] Record: Quizzes shows only quizzes`, qs.length >= 1 && qs.every(k => k === 'quiz'), qs.join(','));
    }
    await page.setViewportSize(scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 });
    await page.waitForTimeout(100);
    // B-359 (D-316): Record's Journal screen left the page (the journal stays in the record); the guard on his words
    // is the composer's, checked above
    // System
    await page.$eval('#tab-system', b => b.click());
    await page.waitForTimeout(100);
    // B-119: the lists fold under one line each; the cards' lines carry their counts.
    ok(
      'system shows capacity and the runs',
      /412 documents in your record · 1 near or over budget/.test(await page.textContent('#cap-card-line')) &&
        (await page.locator('#pipes .sys-item').count()) >= 5 &&
        !(await page.isVisible('#pipes')),
      await page.textContent('#cap-card-line')
    );
    {
      await page.click('#cap-card-line');
      const c = await page.textContent('#capacity'); // B-37 (D-093): the budgets, worst first, no 25,000 cap
      ok(
        'system shows the D-093 budgets, the one near its budget first with its relief',
        (await page.locator('#capacity .sys-item').count()) === 3 &&
          /^setsnear budget401 documents · warns at 400 · relief: the weekly roll-upstate/.test(c) &&
          /warns at 192 KiB, fails at 240 KiB/.test(c) &&
          /1\.5 MiB · warns at 4 MiB/.test(c) &&
          !/25,000/.test(c),
        c
      );
      const card = page.locator('#cap-card');
      for (const [w, h] of [
        [390, 844],
        [1280, 860],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await card.screenshot({ path: `${shots}/capacity-${w}.png` });
      }
      await page.setViewportSize(scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 });
      await page.click('#cap-card-line');
    }
    {
      const card = page.locator('#lint-card');
      await page.click('#lint-card-line');
      const c = await card.textContent(); // B-34 (D-090)
      ok(
        'the Checks card shows the nightly lint: when, the counts, the warning, the notes by kind',
        /Checks · 0 errors, 1 warning · /.test(await page.textContent('#lint-card-line')) &&
          /3 of 4 built documents reproduced\./.test(c) &&
          (await page.locator('#lint .sys-item').count()) === 1 &&
          /derived-stale|built by build/.test(c) &&
          /days\/2026-10-17/.test(c) &&
          /Notes, not problems: 1 kept from before, frozen · 1 rebuilt by their next run/.test(c),
        c.slice(0, 300)
      );
      for (const [w, h] of [
        [390, 844],
        [1280, 860],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await card.screenshot({ path: `${shots}/checks-${w}.png` });
      }
      await page.setViewportSize(scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 });
      await page.click('#lint-card-line');
    }
    // ---- System health panel (B-17, B-119): health/current in plain words, never alarming; the first thing to look at leads
    const hp = await page.textContent('#health');
    const lead = await page.textContent('#health .sys-lead'),
      nTop = await page.locator('#health-top li').count();
    ok(
      'health panel leads with the first thing to look at, the rest one line each',
      /missed its .*run; E\.V\. started it again\./.test(lead) && nTop === 2 && /checked 5\d min ago/.test(hp),
      JSON.stringify({ lead, nTop })
    );
    ok(
      'a missed slot, a stalled run and a stuck retry each read as a sentence',
      /Evening \(cloud\) missed its .*run; E\.V\. started it again\./.test(hp) &&
        /Weekly review started 3 h ago and never finished\./.test(hp) &&
        /weekly-h: never ended, still stuck after one retry\. A build chat should look\./.test(hp),
      hp
    );
    ok(
      'the weak spot state is held against the evening hash; a drill not yet run is not a line',
      /Your weak spots changed since the evening snapshot/.test(hp) && !/Backup restore drill/.test(hp)
    );
    // B-165 (D-188): the evidence two gated tasks wait on, from the latest weekly, read against the spec's numbers.
    ok(
      'B-165: the evidence B-70 and B-71 wait on reads beside the health line',
      /Evidence \(week of [^)]+\): 212 of 300 answers for learned intervals · 1 of 2 exams with a prediction and a score for calibration\./.test(
        hp
      ),
      hp
    );
    {
      const card = page.locator('#health');
      for (const [w, h] of [
        [390, 844],
        [1280, 860],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await card.screenshot({ path: `${shots}/health-evidence-${w}.png` });
      }
      await page.setViewportSize(scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 });
    }
    ok(
      'pipelines read with when they run',
      /Morning · daily 4:25am/.test(await page.textContent('#pipes')) &&
        /Watchdog · every 3 hours at :55/.test(await page.textContent('#pipes')) &&
        /Restore drill · monthly on the 1st, 8:55pm/.test(await page.textContent('#pipes')),
      (await page.textContent('#pipes')).slice(0, 300)
    );
    ok(
      'versions name the release and the record',
      new RegExp(
        `Release ${reEsc(RELEASE)} · core ${reEsc(RELEASE)} · spec ${reEsc(SPEC_VERSION)} · staging record`
      ).test(await page.textContent('#versions'))
    );
    await page.screenshot({ path: `${shots}/system.png`, fullPage: true });
    {
      // B-55 (D-111): a health check 5 hours old is marked stale, the watchdog itself may have stopped
      const keep = await page.evaluate(() => window.__db.health.current.at);
      const setAt = t =>
        page.evaluate(async t => {
          const db = await window.claude.use('db');
          await db
            .collection('health')
            .doc('current')
            .set({ ...window.__db.health.current, at: t });
        }, t);
      await setAt(await page.evaluate(() => new Date(Date.now() - 5 * 3600e3 - 60e3).toISOString()));
      await page.waitForTimeout(300); // the page's own (fake) clock
      const card = page.locator('#health');
      for (const [w, h] of [
        [390, 844],
        [1280, 860],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const t = await card.textContent();
        ok(
          `[${w}] a 5-hour-old health check is marked stale`,
          /This health check is 5 hours old\. The watchdog checks every three hours, so it may have stopped\./.test(
            t
          ) &&
            /^This health check is 5 hours old/.test(await page.textContent('#health .sys-lead')) &&
            (await page.locator('#health-top li').count()) === 3,
          t.slice(0, 200)
        );
        await card.screenshot({ path: `${shots}/health-stale-${w}.png` });
      }
      await setAt(keep);
      await page.waitForTimeout(200);
      ok('a fresh health check has no stale mark', !/stale/.test(await card.textContent()));
      // B-27 (D-087): a missed Mac-lane slot reads as a sentence, not a retry
      const h0 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__db.health.current)));
      await page.evaluate(async h => {
        const db = await window.claude.use('db');
        await db
          .collection('health')
          .doc('current')
          .set({
            ...h,
            missing: [
              ...h.missing,
              { pipeline: 'evening-mac', slot: '2026-10-19T01:20:00.000Z', refired: false, lane: 'mac' },
            ],
          });
      }, h0);
      await page.waitForTimeout(300);
      ok(
        'a missed Mac-lane slot says the Mac may have been asleep, and is not retried',
        /Evening \(Mac\) missed its 8:20 [ap]m run\. It runs on your Mac, which may have been asleep or offline; it runs again at its next time\./.test(
          await card.textContent()
        ),
        (await card.textContent()).slice(0, 400)
      );
      // B-163 (D-186): a backup two schema bumps behind reads amber, as a sentence that says it still restores
      await page.evaluate(async h => {
        const db = await window.claude.use('db');
        await db
          .collection('health')
          .doc('current')
          .set({
            ...h,
            backup: {
              run: 'evening-mac-20261018-012000000',
              at: '2026-10-18T01:20:00.000Z',
              file: 'backup/E.V.-v4-backup-saturday.json',
              behind: 2,
            },
          });
      }, h0);
      for (const [w, hh] of [
        [390, 844],
        [1280, 860],
      ]) {
        await page.setViewportSize({ width: w, height: hh });
        await card.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const t = await card.textContent();
        ok(
          `[${w}] a backup behind this build's schemas is an amber line that says it still restores`,
          /Your latest backup \(.+\) is 2 schema updates behind this build\. It still restores: the drill moves it forward\./.test(
            t
          ) && !/backup[^.]*failed/i.test(t),
          t.slice(0, 500)
        );
        await card.screenshot({ path: `${shots}/health-backup-${w}.png` });
      }
      await page.evaluate(async h => {
        const db = await window.claude.use('db');
        await db.collection('health').doc('current').set(h);
      }, h0);
      await page.waitForTimeout(200);
      await page.setViewportSize({ width: 390, height: 844 });
    }
    await workLineChecks(page, scheme); // B-227: last, since its links leave a set open in Study
    ok('no page errors after interactions', errors.length === 0, errors.join(' | '));
    // Visitor
    const v = await browser.newPage({ viewport: { width: 390, height: 700 } });
    await openPage(v, 'staging', 'window.__notOwner=true;');
    await v.waitForTimeout(600);
    ok(
      'visitors see nothing and cannot write',
      /private study record/.test(await v.textContent('#status')) &&
        (await v.evaluate(() => window.__writes.length)) === 0
    );
    await page.close();
    await v.close();
    // Staging page: same page, staging worker only; filing is live-only
    const st = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await st.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await openPage(st, 'staging');
    await st.waitForTimeout(900);
    await st.evaluate(() => {
      window.__chatScript = [
        { tool: 'start_job', input: { kind: 'general', title: 'Staging check', brief: 'harness' } },
      ];
      window.__chatReply = 'Queued.';
    });
    await send(st, 'Run a staging job');
    await st.waitForTimeout(300);
    const smc = await st.evaluate(() => window.__mcpCalls.find(c => c[1] === 'fire_trigger'));
    ok('staging fires only the staging worker', smc && smc[2].trigger_id === stagingWorker, JSON.stringify(smc));
    // B-408: the page files no Study Watch session any more; File it asked in words fires no task and asks no reader
    await st.evaluate(() => {
      window.__chatScript = [];
      window.__chatReply = 'Your study sessions are saved as they end.';
    });
    await send(st, 'File it');
    await st.waitForTimeout(300);
    ok(
      'file it asked in words fires no task and calls no local reader',
      (await st.evaluate(() => window.__mcpCalls.filter(c => c[1] === 'fire_trigger').length)) === 1 &&
        (await st.evaluate(() => window.__mcpCalls.filter(c => String(c[0]).startsWith('host:')).length)) === 0,
      JSON.stringify(await st.evaluate(() => window.__mcpCalls.map(c => c[0] + ' ' + c[1])))
    );
    ok('staging readout says staging', /staging/i.test(await st.textContent('#readout')));
    await st.close();

    // ---- B-18: skills practice, the readiness audit, grounded explanations (B-408 retired the page's session filing)
    {
      const fp = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const fErr = [];
      fp.on('pageerror', e => fErr.push(e.message));
      await fp.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
      // B-408 retired the page's Study Watch filing (the reader); this page goes on with skills practice and the rest
      await openPage(fp, 'staging');
      await fp.waitForTimeout(1500);
      // Skills practice: E.V. finds the checklist in the library and runs it in a card, one step at a time
      await fp.evaluate(() => {
        window.__toolResults = [];
        window.__chatScript = [{ tool: 'practice_skill', input: { action: 'start', skill: 'head to toe assessment' } }];
        window.__chatReply = 'Let’s run it.';
      });
      await send(fp, 'Run me through the head to toe validation');
      await fp.waitForTimeout(800);
      const sk = await fp.evaluate(
        () =>
          Object.entries(window.__db.sessions)
            .filter(([id, x]) => id.startsWith('ss-skill-') && x.status === 'active')
            .map(([id, x]) => ({ id, ...x }))[0]
      );
      ok(
        'practice_skill starts a skills session from the checklist in his materials',
        sk &&
          sk.kind === 'skill' &&
          sk.status === 'active' &&
          sk.skill.steps.length >= 4 &&
          /p\. 12/.test(sk.skill.cite),
        JSON.stringify(sk && { t: sk.topic, n: sk.skill.steps.length, c: sk.skill.cite }) +
          ' ' +
          JSON.stringify(await fp.evaluate(() => window.__toolResults))
      );
      const card = () => fp.locator('#ev-surf[data-type="skill"]'); // B-78: a card is a surface
      // B-82: while the run goes the sheet is the whole runner; her line carries no card.
      ok(
        'the run shows in the sheet at step 1 with Did it and Missed it; her line carries no card',
        (await card().locator('.ev-card').count()) === 0 &&
          /Step 1 of \d+/.test(await fp.textContent('#sksheet')) &&
          (await fp.locator('#sksheet .sk-acts button', { hasText: 'Did it' }).count()) === 1
      );
      await fp.locator('#sksheet .sk-acts button', { hasText: 'Did it' }).click();
      await fp.waitForTimeout(400);
      await fp.locator('#sksheet .sk-acts button', { hasText: 'Missed it' }).click();
      await fp.waitForTimeout(400);
      const sw = await fp.evaluate(
        id =>
          Object.values(window.__db.weakspots).filter(w => w.kind === 'skill' && w.origin && w.origin.session === id),
        sk.id
      );
      ok(
        'a missed step is a weak spot of kind skill at once',
        sw.length === 1 && /: step 2, /.test(sw[0].topic) && /Step 3 of \d+/.test(await fp.textContent('#sksheet')),
        JSON.stringify(sw.map(w => w.topic))
      );
      await fp.screenshot({ path: `${shots}/skills-card.png` });
      // B-51 (D-107): on the phone a bottom sheet keeps the current step in view; marking works from it as from the card
      ok(
        '[phone] the sheet peeks with the current step and its count, the side panel hidden',
        (await fp.isVisible('#sksheet')) &&
          /Step 3 of \d+/.test(await fp.textContent('#sksheet')) &&
          !(await fp.isVisible('#skpanel')),
        await fp.textContent('#sksheet')
      );
      const sb = await fp.locator('#sksheet').boundingBox();
      const vh = fp.viewportSize().height;
      ok(
        '[phone] the sheet sits on screen, without scrolling',
        sb && sb.y > vh / 3 && sb.y + sb.height <= vh,
        JSON.stringify(sb)
      );
      await fp.locator('#sksheet .sk-peek button', { hasText: 'Did it' }).click();
      await fp.waitForTimeout(400);
      ok(
        '[phone] Did it on the sheet marks step 3',
        /Step 4 of \d+/.test(await fp.textContent('#sksheet')) && (await card().locator('.ev-card').count()) === 0
      );
      await fp.locator('#sksheet .sk-tog').click();
      await fp.waitForTimeout(300);
      const opened = await fp.evaluate(() =>
        [...document.querySelectorAll('#sksheet .sk-step')].map(li => (li.className.match(/pass|miss|cur/) || [''])[0])
      );
      ok(
        '[phone] the sheet opens to the whole ticked list, the current step marked, with the tally',
        opened.slice(0, 4).join(',') === 'pass,miss,pass,cur' &&
          (await fp.locator('#sksheet .sk-tog').getAttribute('aria-expanded')) === 'true' &&
          /3 of \d+ done · 1 missed/.test(await fp.textContent('#sksheet .sk-head')),
        opened.join(',')
      );
      await fp.screenshot({ path: `${shots}/skills-sheet-phone.png` });
      await fp.locator('#sksheet .sk-tog').click();
      await fp.waitForTimeout(200);
      ok(
        "[phone] End is the pane header bar's, beside the step count (D-217)",
        /^Step 4 of \d+ · 1 missed$/.test(await fp.textContent('#kbar .s-clock')) &&
          (await fp.locator('#sksheet button', { hasText: 'End' }).count()) === 0,
        await fp.textContent('#kbar')
      );
      await fp.locator('#kbar button', { hasText: 'End' }).click();
      await fp.waitForTimeout(400);
      ok(
        '[phone] the sheet and the bar go when the run ends',
        !(await fp.isVisible('#sksheet')) && !(await fp.isVisible('#kbar'))
      );
      const ended = await fp.evaluate(id => window.__db.sessions[id], sk.id);
      ok(
        'Stop ends the run with its summary, and the summary card comes back under her line',
        ended.status === 'ended' &&
          /^2 of \d+ steps done right, missed step 2\. Stopped before the end\.$/.test(ended.summary) &&
          /missed step 2/.test(await card().textContent()),
        ended.summary
      );
      await studyView(fp, 'weak'); // B-297 (D-281)
      await fp.waitForTimeout(200);
      ok(
        'the missed step is kept as a skill weak spot in the record; Weak spots shows no Notes and skills section (B-365)',
        (await fp.evaluate(() =>
          Object.values(window.__db.weakspots || {}).some(w => w.kind === 'skill' && /: step 2, /.test(w.topic || ''))
        )) && !(await fp.locator('#study-weak button', { hasText: /^(Practiced|Done|Make active)$/ }).count())
      );
      await fp.click('#tab-ev');
      await fp.waitForTimeout(150);
      // The readiness audit: per objective, what to reread, from "How ready am I?"
      await send(fp, 'How ready am I?');
      await fp.waitForTimeout(1200);
      const hr = (await msgs(fp)).filter(m => m.role === 'ev').slice(-1)[0] || {};
      const hl = await fp.evaluate(() => {
        const sf = document.getElementById('ev-surf');
        return {
          head: sf && sf.querySelector('.sf-head .sf-t').textContent,
          rows: sf ? [...sf.querySelectorAll('.sf-row .sf-t')].map(x => x.textContent) : [],
          inLine: document.querySelectorAll('#thread .msg.ev .ev-card').length,
        };
      });
      ok(
        'How ready am I? attaches readiness and the readiness audit: readiness opens as a surface, the audit a row under its line (B-78)',
        (hr.cards || []).map(c => c.type).join() === 'readiness,audit' &&
          hl.inLine === 0 &&
          /readiness · (\d+% solid|no weak spots yet) · /.test(hl.head || '') &&
          hl.rows.length === 1 &&
          /audit · \d+ objectives?/.test(hl.rows[0]),
        JSON.stringify({ cards: hr.cards, hl })
      );
      await fp.locator('#ev-surf .sf-row', { hasText: 'audit' }).click();
      await fp.waitForTimeout(600);
      const au = await fp.evaluate(() => ({
        head: document.querySelector('#ev-surf .sf-head .sf-t').textContent,
        rows: [...document.querySelectorAll('#ev-surf .sf-row .sf-t')].map(x => x.textContent),
        text: document.querySelector('#ev-surf .sf-body').textContent,
      }));
      ok(
        'its audit row opens in place, readiness folding to a row: per objective what to reread, from his materials',
        /audit · \d+ objectives?/.test(au.head) &&
          au.rows.length === 1 &&
          /readiness/.test(au.rows[0]) &&
          /\d+ solid · \d+ right once · \d+ not yet/.test(au.text) &&
          /Reread: [^·]+, (p\.|slide) \d+/.test(au.text),
        JSON.stringify(au).slice(0, 400)
      );
      await fp.screenshot({ path: `${shots}/audit-card.png` });
      await fp.click('#tab-ev');
      await fp.waitForTimeout(300);
      // Grounded explanations: the rule rides in the chat context, with the materials tool
      await fp.evaluate(() => {
        window.__chatScript = [];
        window.__chatReply = 'Ok.';
      });
      await send(fp, 'Explain why third spacing causes low blood pressure');
      await fp.waitForTimeout(400);
      const gc = await fp.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
      ok(
        'grounded explanations: explain from his materials and cite, or mark it',
        /Grounded explanations: when he asks why, or to explain a weak spot/.test(gc.input[0].content) &&
          /\(check your materials\)/.test(gc.input[0].content) &&
          gc.tools.includes('materials') &&
          gc.tools.includes('practice_skill')
      );
      ok('B-18: no page errors', fErr.length === 0, fErr.join(' | '));
      await fp.close();
    }
    // ---- B-212 (D-217): from 1200 px the checklist is the right panel; the step and its buttons stay in the pane
    {
      const dp = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      const dErr = [];
      dp.on('pageerror', e => dErr.push(e.message));
      await dp.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
      await openPage(dp, 'staging');
      await dp.waitForTimeout(1500);
      await dp.evaluate(() => {
        window.__chatScript = [{ tool: 'practice_skill', input: { action: 'start', skill: 'head to toe assessment' } }];
        window.__chatReply = 'Let’s run it.';
      });
      await send(dp, 'Run me through the head to toe validation');
      await dp.waitForTimeout(800);
      const dcard = () => dp.locator('#ev-surf[data-type="skill"]'); // B-78: a card is a surface
      ok(
        '[desktop] the right panel shows the whole checklist; the pane holds the step with Did it; the header bar says Step 1 with End',
        (await dp.isVisible('#ev-side #skpanel')) &&
          (await dp.isVisible('#sksheet')) &&
          (await dp.locator('#skpanel .sk-step').count()) >= 4 &&
          (await dp.locator('#skpanel .sk-acts').count()) === 0 &&
          /Step 1 of \d+/.test(await dp.textContent('#sksheet')) &&
          /^Step 1 of \d+$/.test(await dp.textContent('#kbar .s-clock')) &&
          (await dp.locator('#kbar button').allTextContents()).join() === 'End',
        await dp.evaluate(() => (document.getElementById('kbar') || {}).textContent)
      );
      const pb = await dp.locator('#skpanel').boundingBox(),
        tb = await dp.locator('#thread').boundingBox();
      ok(
        '[desktop] the panel sits to the right of the pane, in view',
        pb && tb && pb.x >= tb.x + tb.width && pb.y < 860 && pb.x + pb.width <= 1280,
        JSON.stringify({ pb, tb })
      );
      await dp.locator('#sksheet .sk-acts button', { hasText: 'Did it' }).click();
      await dp.waitForTimeout(400);
      await dp.locator('#sksheet .sk-acts button', { hasText: 'Missed it' }).click();
      await dp.waitForTimeout(400);
      const marks = await dp.evaluate(() =>
        [...document.querySelectorAll('#skpanel .sk-step')].map(li => (li.className.match(/pass|miss|cur/) || [''])[0])
      );
      ok(
        "[desktop] marking in the pane ticks the right panel's list, with the tally",
        marks.slice(0, 3).join(',') === 'pass,miss,cur' &&
          /2 of \d+ done · 1 missed/.test(await dp.textContent('#skpanel')),
        marks.join(',')
      );
      ok(
        '[desktop] her line carries no card while the panel runs (B-82)',
        (await dcard().locator('.ev-card').count()) === 0
      );
      await dp.screenshot({ path: `${shots}/skills-panel-desktop.png` });
      ok(
        '[desktop] no horizontal scroll with the panel open',
        await dp.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      );
      await dp.locator('#kbar button', { hasText: 'End' }).click();
      await dp.waitForTimeout(400);
      ok(
        '[desktop] End in the header bar ends the run; the panel and the bar go',
        !(await dp.isVisible('#skpanel')) &&
          !(await dp.isVisible('#kbar')) &&
          (await dp.evaluate(() =>
            Object.values(window.__db.sessions).some(x => x.kind === 'skill' && x.status === 'ended')
          ))
      );
      ok('B-51: no page errors', dErr.length === 0, dErr.join(' | '));
      await dp.close();
    }
    // ---- B-54 (D-110): the shared page itself, at both widths: answers and reasons show only after an attempt
    for (const [label, vp] of [
      ['phone', { width: 390, height: 844 }],
      ['desktop', { width: 1280, height: 860 }],
    ]) {
      const sp = await browser.newPage({ viewport: vp, colorScheme: label === 'phone' ? 'dark' : 'light' });
      const sErr = [];
      sp.on('pageerror', e => sErr.push(e.message));
      await sp.addScriptTag({ path: path.join(root, 'dist/page/staging/core.js') }).catch(() => {});
      const html = await sp.evaluate(() =>
        window.EVCore.sharePage({
          id: 'x',
          title: 'Drill 9: Ch 3-4',
          items: [
            {
              id: 'a',
              type: 'single',
              stem: 'A made-up client asks which action comes first?',
              options: ['Wait', 'Assess airway'],
              correct: [1],
              rationales: ['Delays care.', 'Airway first.'],
              weakspotId: 'ws-x',
              objective: 'E9-1',
            },
            {
              id: 'b',
              type: 'sata',
              stem: 'Which findings are expected after a made-up procedure? Select all that apply.',
              options: ['Mild pain', 'Fever 40 C', 'Fatigue'],
              correct: [0, 2],
              rationales: ['Expected.', 'Report it.', 'Expected.'],
            },
            {
              id: 'c',
              type: 'matrix',
              stem: 'Mark each made-up finding as expected or unexpected.',
              matrix: {
                columns: ['Expected', 'Unexpected'],
                rows: [
                  { text: 'Dry skin', correct: 0, rationale: 'Normal aging.' },
                  { text: 'New confusion', correct: 1, rationale: 'Sudden change.' },
                  { text: 'Slower reaction time', correct: 0, rationale: 'Normal aging.' },
                ],
              },
            },
          ],
        })
      );
      await sp.setContent(html);
      await sp.waitForTimeout(150);
      ok(
        `[${label}] the shared page shows questions with the reasons hidden, and nothing of his`,
        (await sp.locator('.q').count()) === 3 &&
          (await sp.locator('.why:visible').count()) === 0 &&
          !/ws-x|E9-1/.test(await sp.content())
      );
      await sp.locator('.q').nth(0).locator('label', { hasText: 'Wait' }).click();
      await sp.locator('.q').nth(0).locator('button.check').click();
      ok(
        `[${label}] a wrong try marks the right answer and shows the reasons`,
        /Not quite/.test(await sp.locator('.q').nth(0).textContent()) &&
          (await sp.locator('.q').nth(0).locator('.why', { hasText: 'Airway first.' }).isVisible())
      );
      await sp.locator('.q').nth(2).locator('input[aria-label="Dry skin: Expected"]').check();
      await sp.locator('.q').nth(2).locator('input[aria-label="New confusion: Unexpected"]').check();
      await sp.locator('.q').nth(2).locator('input[aria-label="Slower reaction time: Expected"]').check();
      await sp.locator('.q').nth(2).locator('button.check').click();
      ok(`[${label}] a matrix answered right says so`, /Right/.test(await sp.locator('.q').nth(2).textContent()));
      ok(
        `[${label}] no horizontal scroll on the shared page`,
        await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
      );
      await sp.screenshot({ path: `${shots}/share-page-${label}.png`, fullPage: true });
      ok(`[${label}] B-54: no page errors`, sErr.length === 0, sErr.join(' | '));
      await sp.close();
    }
    // ---- B-52 (D-108): both workout sequences at both widths; every workouts/<id> written validates
    {
      const { loadValidator } = await import(path.join(root, 'core/schemas.mjs'));
      const validate = loadValidator();
      for (const [label, vp] of [
        ['phone', { width: 390, height: 844 }],
        ['desktop', { width: 1280, height: 860 }],
      ]) {
        const wp = await browser.newPage({ viewport: vp });
        const wErr = [];
        wp.on('pageerror', e => wErr.push(e.message));
        await wp.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
        await openPage(wp, 'staging');
        await wp.waitForTimeout(1500);
        // B-78: the workout card is the open surface (beside the runner panel on desktop)
        const last = () => wp.locator('#ev-surf');
        // The page's wall clock forward: not clock.fastForward, whose real-time sync can rewind it (docs/lessons.md, and jump below).
        const ahead = async ms => {
          await wp.clock.setSystemTime((await wp.evaluate(() => Date.now())) + ms);
          await wp.waitForTimeout(150);
        };
        // CINDY from the quick ask: the picker, Start, three rounds, the cap, extra reps, then energy and mood
        await send(wp, 'Start a workout');
        await wp.waitForTimeout(400);
        ok(
          `[${label}] start a workout offers both sequences`,
          /CINDY/.test(await last().textContent()) &&
            /1,500-rep ladder/.test(await last().textContent()) &&
            (await last().locator('button', { hasText: 'Start' }).count()) === 2
        );
        await last().locator('.row', { hasText: 'CINDY' }).locator('button', { hasText: 'Start' }).click();
        await wp.waitForTimeout(500);
        ok(
          `[${label}] CINDY runs as a card with its clock and round`,
          /Workout · CINDY/.test(await last().textContent()) &&
            /20:00 left|19:5\d left/.test(await last().textContent()) &&
            /5 pull-ups/.test(await last().textContent()),
          (await last().textContent()).slice(0, 160)
        );
        for (let i = 0; i < 3; i++) {
          await ahead(5 * 60e3);
          await last().locator('button', { hasText: 'Round done' }).click();
          await wp.waitForTimeout(250);
        }
        ok(
          `[${label}] three rounds counted`,
          /3 rounds so far \(90 reps\)/.test(await last().textContent()),
          (await last().textContent()).slice(0, 200)
        );
        ok(
          `[${label}] the running workout follows the session pattern: its line in the pane header with Finish, its round and Round done in the pane, its card the right panel's surface from 1200 px (D-217)`,
          (await wp.isVisible('#sksheet')) &&
            /CINDY · Round 4/.test(await wp.textContent('#sksheet')) &&
            (await wp.locator('#sksheet button', { hasText: 'Round done' }).count()) === 1 &&
            (await wp.evaluate(() => document.getElementById('kbar').parentNode.id)) === 'mh' &&
            /^CINDY · Round 4 · \d/.test(await wp.textContent('#kbar .s-clock')) &&
            (await wp.locator('#kbar button', { hasText: 'Finish' }).count()) === 1 &&
            (label === 'phone'
              ? !(await wp.isVisible('#skpanel'))
              : !(await wp.isVisible('#skpanel')) && (await wp.isVisible('#ev-side #ev-surf[data-type="workout"]'))),
          await wp.evaluate(() =>
            [document.getElementById('kbar'), document.getElementById('sksheet')]
              .map(n => n && n.textContent)
              .join(' | ')
          )
        );
        // Then the card's condition, not a fixed wait: its clock redraws on the next tick.
        await ahead(5 * 60e3 + 5000);
        await wp
          .waitForFunction(() => /rounds in 20 minutes/.test(document.getElementById('p-ev').textContent), null, {
            timeout: 8000,
          })
          .catch(() => {});
        ok(
          `[${label}] at the cap the card asks for the extra reps`,
          /3 rounds in 20 minutes/.test(await last().textContent()) &&
            (await last().locator('input[type=number]').count()) === 1,
          (await last().textContent()).slice(0, 240)
        );
        await wp.screenshot({ path: `${shots}/workout-cindy-${label}.png` });
        await last().locator('input[type=number]').fill('7');
        await last().locator('form button[type=submit]').click();
        await wp.waitForTimeout(400);
        await last().locator('.energy button', { hasText: '4' }).click();
        await last().locator('input[aria-label=Mood]').fill('strong, arms gone');
        await last().locator('button', { hasText: 'Save' }).click();
        await wp.waitForTimeout(400);
        const cindy = await wp.evaluate(
          old =>
            Object.entries(window.__db.workouts || {})
              .filter(([id, w]) => w.sequence === 'cindy' && !old.includes(id))
              .map(([id, w]) => ({ id, ...w })),
          Object.keys(seed.workouts || {})
        ); // the run this harness made, not one the export holds
        ok(
          `[${label}] CINDY lands in workouts/<id>: rounds, extra reps, energy and mood, valid`,
          cindy.length === 1 &&
            cindy[0].status === 'done' &&
            cindy[0].result.rounds === 3 &&
            cindy[0].result.extraReps === 7 &&
            cindy[0].energy === 4 &&
            cindy[0].mood === 'strong, arms gone' &&
            validate('workouts', (({ id, ...d }) => d)(cindy[0]), { id: cindy[0].id }).ok,
          JSON.stringify(cindy[0] && cindy[0].result)
        );
        ok(
          `[${label}] the card closes with the summary`,
          /3 rounds \+ 7 reps in 20 min/.test(await last().textContent()) &&
            /Energy 4\/5/.test(await last().textContent())
        );
        // The ladder from the conversation: five rounds, stopped in round six
        await wp.evaluate(() => {
          window.__chatScript = [{ tool: 'start_workout', input: { sequence: 'ladder-1500' } }];
          window.__chatReply = 'Ladder time.';
        });
        await send(wp, 'Let’s do the 1500 rep ladder');
        await wp.waitForTimeout(600);
        ok(
          `[${label}] the ladder runs round by round`,
          /Round 1 of 19/.test(await last().textContent()) &&
            /1 pull-ups/.test(await last().textContent()) &&
            /5 air squats/.test(await last().textContent()),
          (await last().textContent()).slice(0, 200)
        );
        for (let i = 0; i < 5; i++) {
          await ahead(2 * 60e3);
          await last().locator('button', { hasText: 'Round done' }).click();
          await wp.waitForTimeout(250);
        }
        ok(
          `[${label}] round six asks for 6, 12, 18, 24 and 30`,
          /Round 6 of 19/.test(await last().textContent()) &&
            /6 pull-ups/.test(await last().textContent()) &&
            /30 air squats/.test(await last().textContent())
        );
        await wp.screenshot({ path: `${shots}/workout-ladder-${label}.png` });
        await ahead(60e3);
        await last().locator('button', { hasText: 'Stop here' }).click();
        await wp.waitForTimeout(400);
        await last().locator('.energy button', { hasText: '2' }).click();
        await last().locator('button', { hasText: 'Save' }).click();
        await wp.waitForTimeout(400);
        const lad = await wp.evaluate(() =>
          Object.entries(window.__db.workouts || {})
            .filter(([, w]) => w.sequence === 'ladder-1500')
            .map(([id, w]) => ({ id, ...w }))
        );
        ok(
          `[${label}] the ladder keeps total time and where he stopped, valid`,
          lad.length === 1 &&
            lad[0].status === 'stopped' &&
            lad[0].result.stopRound === 6 &&
            lad[0].result.reps === 225 &&
            lad[0].result.totalSeconds >= 660 &&
            lad[0].result.totalSeconds < 690 &&
            lad[0].energy === 2 &&
            lad[0].mood === null &&
            validate('workouts', (({ id, ...d }) => d)(lad[0]), { id: lad[0].id }).ok,
          JSON.stringify(lad[0] && lad[0].result)
        );
        await wp.click('#tab-record');
        await wp.waitForTimeout(200);
        const wl = await wp.textContent('#rec-list'); // B-302: workouts are rows in the log
        ok(
          `[${label}] Record lists both workouts with their results`,
          /CINDY/.test(wl) && /3 rounds \+ 7 reps/.test(wl) && /stopped in round 6/.test(wl),
          wl.slice(0, 200)
        );
        ok(`[${label}] B-52: no page errors`, wErr.length === 0, wErr.join(' | '));
        await wp.close();
      }
    }

    // ---- B-290 (D-327): Coming up in E.V.'s right panel lists the dates after today that the sidebar doesn't show.
    // Graded work due tomorrow is on today's list (a heads-up), so it can be in the sidebar; then it is not Coming up.
    {
      const cp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await cp.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
      await openPage(cp);
      await cp.waitForTimeout(900);
      await cp.evaluate(async () => {
        const db = await window.claude.use('db');
        const E = window.EVCore;
        await db
          .collection('dates')
          .doc('h-b290-tomorrow')
          .set({
            schema: 1,
            writer: 'page',
            at: new Date().toISOString(),
            source: 'Harness',
            date: E.addDays(E.chicagoDate(new Date()), 1),
            title: 'Harness care plan',
            kind: 'due',
            graded: true,
            course: 'NUR 112',
          });
        // the morning's saved list carries it as the heads-up the planner writes (E.dayPlan's soon- item), first, so
        // the sidebar's five show it; with no saved list the page builds the day live and adds it itself
        const today = E.chicagoDate(new Date()),
          snap = await db.collection('days').doc(today).get(),
          day = snap.exists ? snap.data() : null;
        if (day && day.list && day.list.items)
          await db
            .collection('days')
            .doc(today)
            .set({
              ...day,
              list: {
                ...day.list,
                items: [
                  {
                    id: 'soon-h-b290-tomorrow',
                    kind: 'graded-soon',
                    text: 'Harness care plan (due tomorrow)',
                    title: 'Harness care plan (due tomorrow)',
                    tag: 'GRADED',
                    minutes: 0,
                    required: true,
                    ref: 'dates/h-b290-tomorrow',
                  },
                  ...day.list.items,
                ],
              },
            });
      });
      await cp.waitForTimeout(500);
      const cu = await cp.evaluate(() => {
        const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 1;
        const card = document.getElementById('ev-dates');
        return {
          shown: vis(card),
          head: card ? card.querySelector('h2').textContent : '',
          up: card ? [...card.querySelectorAll('.wk-t')].map(e => e.textContent) : [],
          side: [...document.querySelectorAll('#side-today .si .t')].filter(vis).map(e => e.textContent),
        };
      });
      const inSide = cu.side.some(t => /^Harness care plan/.test(t)),
        inUp = cu.up.includes('Harness care plan');
      ok(
        "B-290: Coming up (the dates after today) shares no item with the sidebar; tomorrow's graded work is in the sidebar and not in Coming up",
        cu.shown &&
          cu.head === 'Coming up' &&
          cu.up.length > 0 &&
          inSide &&
          !inUp &&
          !cu.up.some(t => cu.side.some(x => x.startsWith(t))),
        JSON.stringify(cu)
      );
      await cp.close();
    }

    // ---- Study session on the phone (B-408, D-325: under 1024 px there is no Notes, so the session is the
    // Conversation's; it reads no note and asks about his objectives and weak spots, B-314). A fake clock fast-forwards.
    const ss = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const sErr = [];
    ss.on('pageerror', e => sErr.push(e.message));
    ss.on('console', m => {
      if (m.type() === 'error') sErr.push(m.text());
    });
    await ss.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await openPage(ss);
    await ss.waitForTimeout(900);
    const sess = () =>
      ss.evaluate(
        () =>
          Object.entries(window.__db.sessions || {})
            .filter(([, x]) => x.source === 'E.V. Home' && x.kind !== 'skill')
            .map(([id, x]) => ({ id, ...x }))[0] || null
      ); // study sessions only: the export can hold a skills run
    // Moves the page's wall clock forward, then waits for done(). Not clock.fastForward: with the core's animation frames
    // keeping Playwright's fake clock busy, its real-time sync can finish after a fast-forward and rewind the clock.
    const jump = async (ms, done) => {
      await ss.clock.setSystemTime((await ss.evaluate(() => Date.now())) + ms);
      for (let i = 0; i < 50 && !(await done()); i++) await ss.waitForTimeout(100);
      await ss.waitForTimeout(250);
    };
    const hasEvent = test => async () => {
      const s = await sess();
      return !!s && Object.values(s.events || {}).some(test);
    };
    const hostCalls = () => ss.evaluate(() => window.__mcpCalls.filter(c => String(c[0]).startsWith('host:')).length);
    // B-408 (D-325): the Conversation has no session card. B-452 (Matt) retired the chips: at 1280 and 390 no pill offers
    // a session; typing Start a study session starts one.
    const restView = () =>
      ss.evaluate(() => ({
        chips: [...document.querySelectorAll('#qchips .qchip')].map(c => c.textContent),
        card: !!document.getElementById('ev-sess'),
      }));
    await ss.setViewportSize({ width: 1280, height: 900 });
    await ss.waitForTimeout(600);
    const rest1280 = await restView();
    await ss.screenshot({ path: `${shots}/b408-rest-1280.png` });
    await ss.setViewportSize({ width: 390, height: 844 });
    await ss.waitForTimeout(600);
    const rest390 = await restView();
    await ss.screenshot({ path: `${shots}/b408-rest-390.png` });
    ok(
      'B-408, B-452: at 1280 and 390 no session card and no quick-ask pills',
      !rest1280.card && !rest1280.chips.length && !rest390.card && !rest390.chips.length,
      JSON.stringify({ rest1280, rest390 })
    );
    await send(ss, 'Start a study session');
    for (let i = 0; i < 40 && !(await sess()); i++) await ss.waitForTimeout(100);
    await ss.waitForTimeout(400);
    let S1 = await sess();
    ok(
      'the phone starts a session on no note, with a start mark and no call to a local reader',
      S1 &&
        S1.status === 'active' &&
        S1.topic === 'Study session' &&
        S1.noteId === '' &&
        !S1.note &&
        Object.values(S1.events)[0].type === 'start' &&
        (await hostCalls()) === 0,
      JSON.stringify(S1 && { topic: S1.topic, noteId: S1.noteId, events: S1.events })
    );
    ok(
      'start message in the thread',
      /^Session started\. I’ll keep time; tap Quiz me now/.test((await msgs(ss)).slice(-1)[0].text),
      (await msgs(ss)).slice(-1)[0].text
    );
    // Captions (B-77, D-122): in a session only her latest two lines show, and her core is at the session step (66%).
    // The stage steps down over its own transition: measure once its height has held still (under a loaded check run
    // it was read mid-step, 197 for 196).
    await ss
      .waitForFunction(
        () => {
          const h = document.getElementById('hero'),
            v = Math.round(h.getBoundingClientRect().height);
          const s = window.__stageRead;
          window.__stageRead = v;
          return s === v && h.dataset.step === 'session';
        },
        null,
        { polling: 150, timeout: 5000 }
      )
      .catch(() => {});
    {
      const cs = await ss.evaluate(() => {
        const h = document.getElementById('hero');
        return {
          step: h.dataset.step,
          px: Math.round(h.querySelector('.ev-av').getBoundingClientRect().width),
          stage: Math.round(h.getBoundingClientRect().height),
          lines: document.querySelectorAll('#thread .msg.ev').length,
          // B-74 (D-128): the session is its own conversation, opened by the line of his that started it.
          thread: [...document.querySelectorAll('#thread .msg')].map(
            m => (m.classList.contains('ev') ? 'ev: ' : 'matt: ') + m.textContent.trim().slice(0, 40)
          ),
        };
      });
      ok(
        // B-377 (D-316): starting a session keeps the thread and adds her line; her flower 70% on its stage (D-213)
        'in a session: the thread ends with her start line, her flower at 70% (73 px on the phone) on its stage (D-213)',
        cs.step === 'session' &&
          /^ev: Session started/.test(cs.thread[cs.thread.length - 1] || '') &&
          Math.abs(cs.px - 73) <= 1,
        JSON.stringify(cs)
      );
    }
    // B-211 (D-217): the session's stats are one quiet line in the pane header (no pill, no box); B-273: its progress is
    // her ring, the stretch to the next check (just started).
    const lineView = () =>
      ss.evaluate(() => {
        const b = document.getElementById('sbar'),
          r = b.getBoundingClientRect(),
          mh = document.getElementById('mh').getBoundingClientRect(),
          h = document.getElementById('hero').getBoundingClientRect(),
          th = document.getElementById('thread').getBoundingClientRect(),
          cs = getComputedStyle(b);
        return {
          h: Math.round(r.height),
          top: Math.round(r.top),
          heroBottom: Math.round(h.bottom),
          threadTop: Math.round(th.top),
          inHeader: b.parentNode.id === 'mh' && r.top >= mh.top - 1 && r.bottom <= mh.bottom + 1,
          // B-287 (C-7): New ends the header, so the line's right is measured to New's left
          right: Math.round(document.getElementById('new-wrap').getBoundingClientRect().left - r.right),
          cores: b.querySelectorAll('canvas, svg.fl').length,
          ring: window.EVApp.core.stats().ring,
          label: b.getAttribute('aria-label'),
          bg: cs.backgroundColor,
          border: cs.borderTopWidth,
          session: document.body.classList.contains('in-session') && !document.body.classList.contains('opening'),
          over: b.scrollWidth > b.clientWidth + 1,
        };
      });
    {
      const pr = await lineView();
      ok(
        "the session is one line in the pane header, as the demo's strip (B-357: its own height and rule); her ring has only just started toward the first check (B-273)",
        pr.inHeader && pr.cores === 0 && pr.ring >= 0 && pr.ring < 0.1 && pr.session && !pr.over,
        JSON.stringify(pr)
      );
      ok(
        'the line names the session in its label and shows the minutes, then Break and End (B-88; no reading-along words, B-362)',
        /Study session/.test(pr.label) &&
          /^\d+ (?:min left|min\s*to (?:my )?next check)$/.test(await ss.textContent('#sbar .s-clock')) &&
          (await ss.locator('#sbar button').allTextContents()).join(',') === 'Break,End',
        await ss.textContent('#sbar')
      );
    }
    {
      const rv = await ss.evaluate(() => ({
        reading: !document.getElementById('sread').hidden && document.getElementById('sread').textContent,
        chips: [...document.querySelectorAll('#qchips .qchip')].filter(c => c.offsetParent).map(c => c.textContent),
      }));
      ok(
        'in a session: no Reading line (B-362, as the demo), and no quick-ask pills (B-452)',
        !rv.reading && !rv.chips.length,
        JSON.stringify(rv)
      );
    }
    await ss.screenshot({ path: `${shots}/session-bar.png` });
    // B-408 (D-325): at 1280 the phone's session shows in the strip on every view (as a Notes session does), never as
    // the header's line: the minutes to her next check, what it is on, Break and End.
    await ss.setViewportSize({ width: 1280, height: 860 });
    await ss.click('#tab-today');
    await ss.waitForTimeout(800);
    {
      const pd = await ss.evaluate(() => {
        const sl = document.getElementById('ev-sslot'),
          q = c => ((sl && sl.querySelector(c)) || {}).textContent || '';
        return {
          header: !document.getElementById('sbar').hidden,
          shown: !!sl && sl.getBoundingClientRect().width > 0,
          left: q('.s-left'),
          name: q('.tn'),
          btns: sl ? [...sl.querySelectorAll('button.btn')].map(b => b.textContent) : [],
        };
      });
      ok(
        '[desktop] the session is in the strip (n min to next check, Study session, Break, End); the header line stays hidden',
        !pd.header &&
          pd.shown &&
          /^\d+ min to next check$/.test(pd.left) &&
          pd.name === 'Study session' &&
          pd.btns.join() === 'Break,End',
        JSON.stringify(pd)
      );
    }
    await ss.screenshot({ path: `${shots}/session-bar-desktop.png` });
    await ss.click('#tab-ev');
    await ss.setViewportSize({ width: 390, height: 844 });
    await ss.waitForTimeout(400);
    // B-408: the phone's session reads no note, so she never reads along here (a Notes session's read-along is the notes
    // harness's); Quiz me now and the wrap-up are answered from the stub below.
    const WRAP = {
      summary: 'Worked through IV fluid tonicity and where water moves.',
      weakSpots: [
        { objective: 'E4-3', topic: 'Hypokalemia findings' },
        { objective: 'E4-3', topic: 'Fluid volume excess signs' },
        { objective: 'E4-3', topic: 'Hypotonic vs isotonic fluid shifts' },
        { topic: 'Why the kidneys hold sodium' },
      ],
      connections: ['Sodium pulls water, which links fluids to edema'],
      noteTodos: ['Add a hypertonic example'],
      cards: [
        { term: 'Isotonic', definition: '0.9% NaCl; stays in the vessels' },
        { term: 'Hypotonic', definition: '0.45% NaCl; water moves into cells' },
      ],
    };
    await ss.evaluate(w => {
      window.__commentSay = {
        say: 'Good link: that is tonicity deciding where the water goes.',
        quote: 'Hypotonic: 0.45% NaCl shifts water into the cells.',
        kind: 'connection',
      };
      window.__sampleFn = p =>
        /reading over his shoulder/.test(p)
          ? window.__commentSay
          : /Study session check/.test(p)
            ? {
                items: [
                  { text: '1. Why does 0.45% NaCl move water into the cells?', kind: 'why' },
                  { text: 'Your note has no hypertonic example yet.', kind: 'gap' },
                ],
              }
            : w;
    }, WRAP);
    // Quiz me now (typed; B-452 retired its chip): 1 to 3 questions on his objectives and weak spots, as a check card
    await send(ss, 'Quiz me now');
    for (let i = 0; i < 50 && !(await hasEvent(e => e.type === 'check' && e.items)()); i++)
      await ss.waitForTimeout(100);
    await ss.waitForTimeout(300);
    S1 = await sess();
    const chk = Object.values(S1.events).find(e => e.type === 'check' && e.items);
    const jp = await ss.evaluate(
      () => (window.__jsonCalls || []).filter(c => /Study session check/.test(c.prompt)).slice(-1)[0]
    );
    ok('Quiz me now calls no local reader', (await hostCalls()) === 0);
    ok(
      'the quiz prompt carries the record context on the quick tier',
      jp && /Testable objectives:/.test(jp.prompt) && jp.tier === 'quick',
      jp && jp.prompt.slice(0, 400)
    );
    ok(
      'the quiz keeps a check event on no note',
      chk && chk.n === 1 && chk.items === 2 && chk.noteId === '',
      JSON.stringify(chk)
    );
    const lastChk = (await msgs(ss)).slice(-1)[0];
    ok(
      'the quiz posts as a card with its items',
      lastChk.cards &&
        lastChk.cards[0].type === 'check' &&
        lastChk.cards[0].items.length === 2 &&
        lastChk.cards[0].items[0].text === 'Why does 0.45% NaCl move water into the cells?',
      JSON.stringify(lastChk.cards)
    );
    ok(
      'check card rendered',
      /Two questions on your objectives and weak spots/.test((await msgs(ss)).slice(-1)[0].text) &&
        /Check 1 · 2 questions/.test(await ss.locator('#p-ev').textContent()) &&
        (await ss.locator('#ev-surf').locator('ol.check-items li').count()) === 2
    );
    // Answer in the composer: recorded on the session, and Claude sees the check's questions
    await ss.evaluate(() => {
      window.__sampleFn &&
        (window.__chatReply = 'Right: less solute outside, so water moves in. What happens to cell size?');
      window.__chatScript = [];
    });
    await ss.locator('#ev-surf').locator('button', { hasText: 'Answer' }).click();
    ok(
      'Answer focuses the composer',
      await ss.evaluate(
        () =>
          document.activeElement &&
          document.activeElement.id === 'ev-input' &&
          /Answer check 1/.test(document.activeElement.placeholder)
      )
    );
    await send(ss, 'There is less solute in the fluid so water moves into the cells');
    await ss.waitForTimeout(400);
    S1 = await sess();
    const ans = Object.values(S1.events).find(e => e.type === 'answer');
    const cc = await ss.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
    ok(
      'answer recorded on the session',
      ans && ans.n === 1 && /^m-\d{8}-\d{9}-matt$/.test(ans.msgId),
      JSON.stringify(ans)
    );
    ok(
      'chat sees the session and the check questions',
      /Study session running on his objectives and weak spots/.test(cc.input[0].content) &&
        cc.input.some(t => /Why does 0\.45% NaCl move water into the cells\?/.test(t.content)) &&
        cc.tools.includes('study_session')
    );
    ok('check card shows answered', /Check 1 · answered/.test(await ss.locator('#ev-surf').textContent()));
    {
      // B-273 (D-267): her ring is the stretch to the next check, which the quiz just started over; the answer shows on
      // its card, not on her (D-217).
      const pt = await ss.evaluate(() => {
        const s = Object.values(window.__db.sessions || {}).find(x => x.source === 'E.V. Home' && x.kind !== 'skill');
        return {
          ring: window.EVApp.core.stats().ring,
          toCheck: window.EVCore.sessionState(s, new Date().toISOString()).toCheck,
          filled: window.EVApp.core.sample(0).filled,
        };
      });
      ok(
        'after the quiz her ring starts over toward the next check, and the answer leaves it where the clock has it (B-273)',
        pt.ring >= 0 && pt.ring < 0.1 && Math.abs(pt.ring - pt.toCheck) < 0.01 && pt.filled === 0,
        JSON.stringify(pt)
      );
    }
    {
      // B-273 (D-267): Playwright's clock at 25%, 50% and 100% of the stretch to the next check, through the page's own
      // feed (its session tick, then her ring): 3 and 6 segments fall in, and at the check the ring is full, then starts
      // over once the checkpoint lands.
      const at = await ss.evaluate(() => {
        const s = Object.values(window.__db.sessions || {}).find(x => x.source === 'E.V. Home' && x.kind !== 'skill');
        const C = window.EVApp.core,
          set = C.setRing;
        window.__rings = [];
        C.setRing = r => {
          window.__rings.push(r);
          return set(r);
        };
        return Date.parse(window.EVCore.sessionState(s, new Date().toISOString()).nextCheckAt);
      });
      const step = spec.constants.studyWatch.checkMinutes * 60e3;
      for (const [p, want] of [
        [0.25, 3],
        [0.5, 6],
      ]) {
        await ss.clock.setSystemTime(at - (1 - p) * step);
        await ss.waitForTimeout(1800);
        const pt = await ss.evaluate(() => ({
          ring: window.EVApp.core.stats().ring,
          filled: window.EVApp.core.sample(0).filled,
        }));
        await ss.screenshot({ path: `${shots}/session-pointer-${p * 100}.png` });
        ok(
          `with the clock ${p * 100}% of the way to the next check, her ring has ${want} of 12 segments (B-273)`,
          Math.abs(pt.ring - p) < 0.01 && pt.filled === want,
          JSON.stringify(pt)
        );
      }
      const n0 = Object.keys((await sess()).events).length;
      await ss.evaluate(() => (window.__rings = []));
      await ss.clock.setSystemTime(at);
      for (let i = 0; i < 50 && Object.keys((await sess()).events).length === n0; i++) await ss.waitForTimeout(100);
      await ss.waitForTimeout(1500);
      const full = await ss.evaluate(() => ({ fed: window.__rings.slice(), ring: window.EVApp.core.stats().ring }));
      ok(
        'at 100% the page feeds her a full ring, and once the check lands it starts over (B-273)',
        full.fed.includes(1) && full.ring >= 0 && full.ring < 0.05,
        JSON.stringify({ fed: [...new Set(full.fed)].slice(0, 6), ring: full.ring })
      );
    }
    // Break and resume from the bar
    await ss.locator('#sbar button', { hasText: 'Break' }).click();
    await ss.waitForTimeout(300);
    ok(
      'break shown on the line',
      /On a break|\d+ min break/.test(await ss.textContent('#sbar')) && // B-362: the demo's "5 min break"
        Object.values((await sess()).events).some(e => e.type === 'break'),
      (await ss.textContent('#sbar')) + ' · ' + JSON.stringify(Object.values((await sess()).events).map(e => e.type))
    );
    await ss.screenshot({ path: `${shots}/session-break.png` });
    await ss.locator('#sbar button', { hasText: 'Resume' }).click();
    await ss.waitForTimeout(300);
    ok(
      'resume: the strip shows the minutes left again, no longer on a break',
      /(?:min left|min\s*to (?:my )?next check)/.test(await ss.textContent('#sbar')) &&
        !/On a break|min break/.test(await ss.textContent('#sbar')),
      await ss.textContent('#sbar')
    );
    // End: wrap-up as JSON, filed with the same rules as evening filing; near-repeat waits on a tap. B-408: ended from
    // the strip's End at 1280, where the phone's session (no note, no planned end) shows on desktop
    await ss.setViewportSize({ width: 1280, height: 860 });
    await ss.waitForTimeout(600);
    await ss.locator('#ev-sslot .s-end').click();
    for (
      let i = 0;
      i < 50 &&
      !(((await sess()) || {}).status === 'ended' && /Session saved/.test((await msgs(ss)).slice(-1)[0].text));
      i++
    )
      await ss.waitForTimeout(100);
    await ss.waitForTimeout(400);
    S1 = await sess();
    ok(
      "[desktop] the strip's End ends the phone's session, its wrap-up posts in the Conversation, and the strip empties",
      S1.status === 'ended' &&
        S1.endedBy === 'ended' &&
        /Session saved/.test((await msgs(ss)).slice(-1)[0].text) &&
        !(await ss.evaluate(() => !!document.querySelector('#ev-sslot .s-end'))),
      JSON.stringify({ st: S1.status, by: S1.endedBy, last: (await msgs(ss)).slice(-1)[0].text })
    );
    await ss.setViewportSize({ width: 390, height: 844 });
    await ss.waitForTimeout(600);
    ok(
      'session ended with summary, counts and cards',
      S1.weakSpots.length === 3 &&
        S1.connections.includes('Why the kidneys hold sodium') &&
        S1.status === 'ended' &&
        /tonicity/.test(S1.summary) &&
        S1.checks === 1 &&
        S1.questions === 2 &&
        S1.cardCount === 2 &&
        S1.minutes >= 3,
      JSON.stringify({ st: S1.status, m: S1.minutes, c: S1.checks, q: S1.questions })
    );
    const wsNew = await ss.evaluate(() =>
      Object.entries(window.__db.weakspots)
        .filter(
          ([, w]) =>
            /Study session/.test(w.addedBy || '') ||
            /^E\.V\. Home · /.test(w.source || '') ||
            /Study session/.test(w.source || '')
        )
        .map(([id, w]) => ({ id, ...w }))
    );
    ok(
      'new weak spot (objective) and note to-do, as Facts',
      wsNew.some(
        w =>
          w.topic === 'Hypotonic vs isotonic fluid shifts' && w.kind === 'concept' && !w.derived && w.writer === 'page'
      ) && wsNew.some(w => w.kind === 'note' && /hypertonic/.test(w.topic)),
      wsNew.map(w => w.topic).join(' | ')
    );
    ok(
      'exact repeat bumps the existing weak spot',
      await ss.evaluate(() =>
        Object.values(window.__db.weakspots['ws-2026-10-17-E4-3-hypokalemia-findings'].events || {}).some(
          e => e.type === 'seen' && e.by === 'Study session'
        )
      )
    );
    ok(
      'ideas kept from the session',
      await ss.evaluate(
        () =>
          Object.values(window.__db.ideas).filter(i => i.by === 'Study session' && /^Study session · /.test(i.source))
            .length === 2
      )
    );
    ok(
      'near-repeat waits on Matt',
      S1.pending && S1.pending.ws1 && S1.pending.ws1.candidate.id === 'ws-2026-10-17-E4-3-fluid-volume-excess',
      JSON.stringify(S1.pending)
    );
    const card = ss.locator('#ev-surf');
    ok(
      'wrap-up card: summary, sections, Quizlet copy, same-or-different',
      /Session saved/.test((await msgs(ss)).slice(-1)[0].text) &&
        /Worked through IV fluid tonicity/.test(await card.textContent()) &&
        (await card.locator('button', { hasText: 'Copy 2 cards for Quizlet' }).count()) === 1 &&
        (await card.locator('button', { hasText: 'Same' }).count()) === 1
    );
    ok('bar gone after the session', await ss.isHidden('#sbar'));
    await ss.screenshot({ path: `${shots}/session-wrap.png`, fullPage: true });
    await card.locator('button', { hasText: 'Same' }).click();
    await ss.waitForTimeout(400);
    S1 = await sess();
    ok(
      'same: bumps the old weak spot and clears the question',
      S1.pending.ws1 === null &&
        (await ss.evaluate(() =>
          Object.values(window.__db.weakspots['ws-2026-10-17-E4-3-fluid-volume-excess'].events || {}).some(
            e => e.type === 'seen' && e.by === 'Study session'
          )
        ))
    );
    ok(
      'Record lists the session',
      await (async () => {
        await ss.click('#tab-record');
        await ss.waitForTimeout(150);
        const t = await ss.textContent('#rec-list'); // B-302: the log
        await ss.click('#tab-ev');
        return /Study session/.test(t);
      })()
    );
    ok(
      'back on E.V., the newest message is in view',
      await ss.evaluate(() => {
        const r = [...document.querySelectorAll('#thread .msg')].pop().getBoundingClientRect();
        return r.top < innerHeight && r.bottom > 0;
      })
    );
    await ss.setViewportSize({ width: 1280, height: 860 });
    await ss.waitForTimeout(300);
    await ss.screenshot({ path: `${shots}/session-wrap-desktop.png`, fullPage: false });
    await ss.setViewportSize({ width: 390, height: 844 });
    await ss.waitForTimeout(200);
    ok(
      'session: no sideways scroll',
      !(await ss.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
    );
    ok('session: no page errors', sErr.length === 0, sErr.join(' | '));
    await ss.close();
    // B-91 (Matt, Oct 19): a reopen within the same conversation starts clean at her greeting: what he said before it
    // folds behind the pull, her stage is at full size, the chips show, and the briefing has room to unfold.
    {
      const rp = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      const rErr = [];
      rp.on('pageerror', e => rErr.push(e.message));
      await rp.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
      const t1 = new Date(DAYTIME.getTime() - 25 * 60e3).toISOString(),
        t2 = new Date(DAYTIME.getTime() - 24 * 60e3).toISOString(),
        mk = (t, by) =>
          'm-' +
          t
            .replace(/[-:T]/g, '')
            .replace(/\.(\d+)Z$/, '$1')
            .replace(/^(\d{8})/, '$1-') +
          '-' +
          by;
      const pre = `window.__preTalk = ${JSON.stringify({ [mk(t1, 'matt')]: { role: 'matt', text: 'What’s due this week?', at: t1 }, [mk(t2, 'ev')]: { role: 'ev', text: '9 dates in the next 7 days.', cards: [{ type: 'dates', days: 7 }], at: t2, tier: 'local' } })};`;
      // the talk is planted as the page loads (the stub's record is rebuilt from the seed on every load)
      const plant = `Object.defineProperty(window, '__db', { configurable: true, get() { return this.__db0; }, set(v) { v.talk = v.talk || {}; v.talk[${JSON.stringify(today)}] = { schema: 1, writer: 'page', at: ${JSON.stringify(t1)}, source: 'E.V. Home', date: ${JSON.stringify(today)}, messages: window.__preTalk }; this.__db0 = v; } });`;
      await openPage(rp, 'staging', pre + plant);
      await rp.waitForTimeout(3500);
      const planted = await rp.evaluate(
        d => Object.keys(((window.__db.talk || {})[d] || {}).messages || {}).length,
        today
      );
      const v = await rp.evaluate(() => ({
        msgs: [...document.querySelectorAll('#thread .msg')].map(m => m.className.replace(/\s+/g, ' ')),
        step: document.getElementById('hero').dataset.step,
        chips: [...document.querySelectorAll('#qchips .qchip')].filter(c => c.offsetParent).length,
        greet: !!document.querySelector('#thread .msg.greet.current .brief .brief-line'), // B-358: its summary line
      }));
      ok(
        'B-91: a reopen in the same conversation starts clean at her greeting (his earlier lines fold behind the pull)',
        // B-452: no quick-ask pills under it any more
        planted >= 2 && v.msgs.length === 1 && /greet/.test(v.msgs[0]) && v.greet && v.step === 'idle' && v.chips === 0,
        JSON.stringify({ planted, ...v })
      );
      ok('B-91: no page errors', rErr.length === 0, rErr.join(' | '));
      await rp.close();
    }
    // B-87: a page opened mid-session (a reload, a reopened tab, a live publish) past a due checkpoint takes the session
    // over at once, instead of sitting at 0:00 for two minutes. B-408: the phone's session, on no note.
    {
      const tk = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const tErr = [];
      tk.on('pageerror', e => tErr.push(e.message));
      await tk.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
      await openPage(tk);
      await tk.waitForTimeout(900);
      await tk.evaluate(async () => {
        const t0 = new Date(Date.now() - 8 * 60e3).toISOString();
        const k =
          'page-' +
          t0
            .replace(/[-:]/g, '')
            .replace('T', '-')
            .replace(/\.\d+Z$/, '');
        const db = await window.claude.use('db');
        await db
          .collection('sessions')
          .doc('ss-reload')
          .set({
            schema: 1,
            writer: 'page',
            at: t0,
            source: 'E.V. Home',
            status: 'active',
            date: t0.slice(0, 10),
            startedAt: t0,
            topic: 'Study session',
            noteId: '',
            driver: { view: 'gone', at: t0 },
            events: { [k]: { type: 'start', at: t0 } },
          });
      });
      const t0 = Date.now();
      let d = null;
      for (let i = 0; i < 80; i++) {
        d = await tk.evaluate(() => window.__db.sessions['ss-reload']);
        if (d.driver.view !== 'gone' && Object.values(d.events).some(e => e.type === 'skip' && e.why === 'no-note'))
          break;
        await tk.waitForTimeout(100);
      }
      ok(
        'B-87: a page opened mid-session past a due checkpoint claims the session and runs the checkpoint within seconds',
        d &&
          d.driver.view !== 'gone' &&
          Object.values(d.events).some(e => e.type === 'skip' && e.why === 'no-note') && // B-314: a checkpoint on no note
          Date.now() - t0 < 8000,
        JSON.stringify({
          driver: d && d.driver,
          events: d && Object.values(d.events).map(e => e.type + (e.why ? ':' + e.why : '')),
          ms: Date.now() - t0,
        })
      );
      ok('B-87: no page errors', tErr.length === 0, tErr.join(' | '));
      await tk.close();
    }
  }
  // B-182 (D-196): Your turn at 390, 735 and 1280. The main passes carry no system/yourturn, so no chip; here a planted
  // one: the chip with its count, the card by place, a chip's tap writes the reply job and fires the builder, the model's
  // tool path refuses the kind.
  {
    // Nothing waiting (an empty system/yourturn): no chip.
    seed.system.yourturn = {
      schema: 2,
      writer: 'deploy',
      at: DAYTIME.toISOString(),
      source: 'ship',
      commit: 'abc1234',
      groups: [],
    };
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await servePdfjs(page);
    await openPage(page);
    await page.waitForTimeout(1500);
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('#qchips button')].map(b => b.textContent.trim())
    );
    ok(
      '[your turn 390] no Your turn chip while nothing waits',
      !chips.some(c => /^Your turn/.test(c)),
      chips.join(' | ')
    );
    await page.close();
  }
  for (const w of [390, 735, 1280]) {
    const tag = `[your turn ${w}]`;
    seed.system.yourturn = {
      schema: 2,
      writer: 'deploy',
      at: DAYTIME.toISOString(),
      source: 'ship staging at abc1234',
      commit: 'abc1234',
      groups: [
        {
          place: 'staging',
          label: 'On the staging page',
          tasks: [{ id: 'B-183', ask: 'Read the kickoff once.', status: 'open' }],
        },
        {
          place: 'decision',
          label: 'A decision (a reply in a build chat)',
          tasks: [
            { id: 'B-210', ask: 'Blue or red for the timer?', status: 'blocked', choices: ['Blue', 'Red'] },
            { id: 'B-211', ask: 'Keep the old chime?', status: 'blocked' },
          ],
        },
      ],
    };
    const page = await browser.newPage({
      viewport: { width: w, height: w === 735 ? 830 : w === 390 ? 844 : 860 },
      colorScheme: 'dark',
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await servePdfjs(page);
    await openPage(page);
    await page.waitForTimeout(1500);
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('#qchips button')].map(b => b.textContent.trim())
    );
    // B-358 (D-316): no Your turn chip, and Your turn is asked in words; B-452: no quick-ask pills at all
    ok(`${tag} the greeting offers no pills, no Your turn chip`, chips.length === 0, chips.join(' | '));
    await send(page, 'Your turn');
    await page.waitForTimeout(500);
    const card = await page.evaluate(() =>
      [...document.querySelectorAll('#ev-surf .yt-place')].map(g => ({
        place: g.dataset.place,
        label: g.querySelector('.yt-label').textContent,
        items: [...g.querySelectorAll('.yt-item')].map(li => ({
          id: li.dataset.task,
          chips: [...li.querySelectorAll('.yt-chips button')].map(b => b.textContent.trim()),
        })),
      }))
    );
    ok(
      `${tag} the card groups each ask by place, with its chips`,
      JSON.stringify(card) ===
        JSON.stringify([
          {
            place: 'staging',
            label: 'On the staging page',
            items: [{ id: 'B-183', chips: ['Done', 'Fine', 'What’s off'] }],
          },
          {
            place: 'decision',
            label: 'A decision (a reply in a build chat)',
            items: [
              { id: 'B-210', chips: ['Blue', 'Red', 'Reply'] },
              { id: 'B-211', chips: ['Yes', 'No', 'Later', 'Reply'] },
            ],
          },
        ]),
      JSON.stringify(card)
    );
    await page.screenshot({ path: `${shots}/your-turn-${w}.png` });
    const fires0 = await page.evaluate(() => window.__mcpCalls.filter(c => c[1] === 'fire_trigger').length);
    await page.locator('#ev-surf .yt-item[data-task="B-210"] .yt-chips button', { hasText: 'Blue' }).click();
    await page.waitForTimeout(300);
    const armed = await page.evaluate(() => ({
      confirm: (document.querySelector('#ev-surf .yt-item[data-task="B-210"] .yt-confirm') || {}).textContent || '',
      fires: window.__mcpCalls.filter(c => c[1] === 'fire_trigger').length,
      jobs: Object.values(window.__db.jobs || {}).filter(j => j.kind === 'reply' && j.title === 'B-210').length,
    }));
    ok(
      `${tag} a chip asks before it sends: nothing written or fired until Send`,
      /^Send “Blue” on B-210 to the builder\?/.test(armed.confirm) && armed.fires === fires0 && armed.jobs === 0,
      JSON.stringify(armed)
    );
    await page.locator('#ev-surf .yt-item[data-task="B-210"] .yt-chips button', { hasText: 'Send' }).click();
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      jobs: Object.entries(window.__db.jobs || {}).filter(([, j]) => j.kind === 'reply' && j.title === 'B-210'),
      fires: window.__mcpCalls.filter(c => c[1] === 'fire_trigger'),
      sent: (document.querySelector('#ev-surf .yt-item[data-task="B-210"] .yt-sent') || {}).textContent || '',
    }));
    const [jid, job] = after.jobs[0] || [];
    const fire = after.fires[fires0];
    ok(
      `${tag} a tap writes the reply job and fires the builder with "Job <id>" and "reply B-210: Blue"`,
      after.jobs.length === 1 &&
        job.brief === 'Blue' &&
        job.writer === 'page' &&
        job.fired &&
        job.fired.ok === true &&
        after.fires.length === fires0 + 1 &&
        fire[2].trigger_id === spec.tasks.build['ev4-builder'].trigger &&
        fire[2].text === `Job ${jid}\nreply B-210: Blue` &&
        /^Sent: Blue\./.test(after.sent),
      JSON.stringify({ job, fire, sent: after.sent })
    );
    // The model's tool path may not start a builder job of any kind.
    await page.evaluate(() => {
      window.__chatPre = '';
      window.__toolResults = [];
      window.__chatScript = [
        { tool: 'start_job', input: { kind: 'reply', title: 'B-211', brief: 'yes' } },
        { tool: 'start_job', input: { kind: 'ship', title: 'Ship it', brief: 'ship it' } },
      ];
      window.__chatReply = 'Tried.';
    });
    const jobs0 = await page.evaluate(() => Object.keys(window.__db.jobs || {}).length);
    await send(page, 'answer B-211 for me with yes');
    await page.waitForTimeout(400);
    const tr = await page.evaluate(() => ({ r: window.__toolResults, n: Object.keys(window.__db.jobs || {}).length }));
    ok(
      `${tag} start_job refuses reply and ship from the model's tool path`,
      tr.r.length === 2 &&
        tr.r.every(x => /^refused: a (reply|ship) job starts only from his own tap/.test(x)) &&
        tr.n === jobs0,
      JSON.stringify(tr)
    );
    ok(`${tag} no page errors`, errs.length === 0, errs.join(' | '));
    await page.close();
  }
  {
    // The live page while jobs.builderOnLive is false: no Your turn chip, and "bug: ..." is no build ask.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await servePdfjs(page);
    await openPage(page, 'live');
    await page.waitForTimeout(1500);
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('#qchips button')].map(b => b.textContent.trim())
    );
    const jobs0 = await page.evaluate(
      () => Object.values(window.__db.jobs || {}).filter(j => j.kind === 'build').length
    );
    // B-320 (D-306): since the cutover the claude.ai live page is read-only: it says so, and nothing can be sent
    const ro = await page.evaluate(() => ({
      text: document.body.innerText.includes('This page is read-only now: E.V. lives in the app.'),
      composer: !!document.querySelector('#ev-input') && document.querySelector('#ev-input').offsetParent !== null,
    }));
    const jobs1 = await page.evaluate(
      () => Object.values(window.__db.jobs || {}).filter(j => j.kind === 'build').length
    );
    ok(
      '[live 390] the claude.ai live page is read-only since the cutover: it says so, no composer, no Your turn chip, no build ask',
      ro.text && !ro.composer && !chips.some(c => /^Your turn/.test(c)) && jobs1 === jobs0,
      JSON.stringify({ ro, chips, jobs0, jobs1 })
    );
    await page.close();
  }
  // D-324: identifier verdicts a run kept before are left in the record, unread: Your turn asks nothing about them.
  {
    const tag = '[held 390]';
    delete seed.system.yourturn;
    const KEY = 'id-0123456789abcdef';
    seed.idchecks = {
      [KEY]: {
        schema: 1,
        writer: 'restore-drill',
        at: '2026-10-22T12:00:00Z',
        source: 'restore-drill restore-drill-20261022-1200',
        release: 'v4.3.0',
        key: KEY,
        verdict: 'unsure',
        reason: 'held for Matt: a run never passes a value on its own',
        kind: 'has a date of birth',
        ref: 'legacy/v4-talk-2026-10-19-s1',
        by: 'held',
      },
    };
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await servePdfjs(page);
    await openPage(page);
    await page.waitForTimeout(1500);
    await send(page, 'Your turn');
    await page.waitForTimeout(500);
    const surf = await page.evaluate(() => ({
      held: document.querySelectorAll('#ev-surf .yt-held').length,
      text: (document.getElementById('ev-surf') || {}).textContent || '',
    }));
    ok(
      `${tag} an old held verdict asks nothing: no held row, no made-up chip (D-324)`,
      surf.held === 0 && !/real patient|It’s made up/.test(surf.text),
      JSON.stringify(surf).slice(0, 300)
    );
    ok(`${tag} no page errors`, errs.length === 0, errs.join(' | '));
    await page.close();
  }
  delete seed.idchecks;
  delete seed.system.yourturn;
  // B-215 (D-216): a job that finishes while he is on another tab: her small dial turns to face him, closed, with one
  // segment lit at twelve (B-272), her status says something's ready, no badge anywhere; opening E.V. ends it.
  for (const [tag, vp, flower] of [
    ['[notice 390]', { width: 390, height: 844 }, '#tab-her svg'],
    ['[notice 1280]', { width: 1280, height: 860 }, '#top-av svg'],
  ]) {
    const page = await browser.newPage({ viewport: vp, colorScheme: 'dark' });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await openPage(page, 'staging');
    await page.waitForTimeout(1500);
    await page.click('#tab-today');
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => document.getElementById('readout').textContent);
    await page.evaluate(async () => {
      const db = await window.claude.use('db');
      const at = new Date().toISOString();
      const env = { schema: 2, writer: 'page', at, source: 'E.V. Home' };
      await db
        .collection('jobs')
        .doc('job-notice-harness')
        .set({ ...env, kind: 'study-guide', title: 'Study guide: notice', brief: 'harness', fired: { at, ok: true } });
      await db
        .collection('jobresults')
        .doc('job-notice-harness')
        .set({
          schema: 1,
          writer: 'worker',
          at,
          source: 'worker harness',
          status: 'done',
          startedAt: at,
          finishedAt: at,
          result: { text: 'Done.' },
        });
    });
    await page
      .waitForFunction(() => /something’s ready/.test(document.getElementById('readout').textContent), null, {
        timeout: 4000,
      })
      .catch(() => {});
    // her turn to face him eases in over about half a second (B-272)
    await page
      .waitForFunction(
        sel => {
          const C = window.EVApp.core,
            i = C.cores().findIndex(c => c.svg === document.querySelector(sel));
          return i >= 0 && C.sample(i).facing;
        },
        flower,
        { timeout: 3000 }
      )
      .catch(() => {});
    const on = await page.evaluate(sel => {
      const C = window.EVApp.core,
        st = C.stats();
      const f = document.querySelector(sel),
        i = C.cores().findIndex(c => c.svg === f),
        sm = i >= 0 ? C.sample(i) : null;
      return {
        readout: document.getElementById('readout').textContent,
        mood: st.mood,
        ring: st.ring,
        facing: sm ? sm.facing : null,
        lit: sm ? sm.solid : -1,
        halftone: sm ? sm.back : -1,
        // D-216 is about a count on her or the nav; a row's one word badge (B-291) is not a notice
        badges: [...document.querySelectorAll('.badge, .count, .dot-count, [class*="badge"]')].filter(
          b => b.getBoundingClientRect().height > 0 && !b.closest('.li')
        ).length,
      };
    }, flower);
    await page.screenshot({ path: `${shots}/notice-${vp.width}.png` });
    ok(
      `${tag} a job finished off the E.V. tab: her status says something’s ready, she is alert, ${vp.width < 600 ? '(the phone bar carries the demo’s speech-bubble icon, B-361)' : 'her small dial faces him, closed, lit at twelve,'} no badge (D-216)`,
      !/something’s ready/.test(before) &&
        /^something’s ready/.test(on.readout) &&
        on.mood === 'alert' &&
        (vp.width < 600 || (on.facing === true && on.lit === 1 && on.halftone === 11)) &&
        on.badges === 0,
      JSON.stringify({ before, ...on })
    );
    await page.click('#tab-ev'); // B-368: the sidebar's brand is no control
    await page.waitForTimeout(600);
    const off = await page.evaluate(() => ({
      readout: document.getElementById('readout').textContent,
      ring: window.EVApp.core.stats().ring,
    }));
    ok(`${tag} opening E.V. ends it`, !/something’s ready/.test(off.readout) && off.ring === -1, JSON.stringify(off));
    ok(`${tag} no page errors`, errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : '');
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? `SOME FAILED: ${failed} of ${results.length}` : `ALL PASSED: ${results.length} checks`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : '');
  console.log('CRASHED', e.message.split('\n').slice(0, 14).join('\n'));
  console.log(
    String(e.stack || '')
      .split('\n')
      .filter(l => /harness\//.test(l))
      .join('\n')
  );
  process.exit(1);
});
