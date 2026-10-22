// The page harness (B-16, ported from v3's test/harness/run.cjs): drives the built v4 page (dist/page/<target>/, the
// shell with its published files served beside it) at phone and desktop width, with the record, sample, mcp and the
// Study Watch reader stubbed (stub.js). The record comes from a folder of <collection>/<id>.json in v4 shapes: by
// default the synthetic record (test/data/synthetic.cjs, made up), else the staging seed (`seed-staging --out`) or a
// migrated export, kept outside the repository (it is personal data).
//   node test/harness/run.cjs [record dir | synthetic] [screenshots dir]   (default: the synthetic record, B-100)
// Run `node tools/build.mjs` first. Exit code 1 when any check fails. The shell's own checks are test/harness/shell.cjs.
const { chromium } = require('playwright');
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
delete seed.journal; // the harness never needs his journal
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
/** B-180, at the width it runs: the build card's states, the build ask (no model call, the job, the builder fired by
 * id with the two-line text, both lines in talk) and an identifier that holds a build ask with nothing written. */
// B-191: an open set closes back to the list with its answers kept; Back and Next walk it in its order, an answered
// question showing its answer and why, an unanswered one open; answered out of order, then reopened where he left. Run
// at both widths from Study, Practice with a set open.
async function practiceNav(page, scheme) {
  const openSet = async title => {
    const lead = page.locator('#pr-body .pr-lead', { hasText: title });
    if (await lead.count()) return lead.locator('button.primary').click();
    if (
      (await page.locator('#pr-done-fold[aria-expanded="false"]').count()) &&
      !(await page.locator('#pr-body .row', { hasText: title }).first().isVisible())
    )
      await page.click('#pr-done-fold');
    const r = page.locator('#pr-body .row', { hasText: title }).first();
    if (!(await r.locator('.pr-acts').isVisible())) await r.locator('.pr-line').click(); // a line keeps its fold
    await page.waitForTimeout(80);
    return page.locator('#pr-body .row', { hasText: title }).first().locator('.pr-acts button').first().click();
  };
  await page.click('#pr-fold');
  await page.waitForTimeout(150);
  ok(
    `[${scheme}] the open set's head line folds it back into the list it was opened from (D-160)`,
    !(await page.isVisible('#pr-fold')) &&
      (await page.locator('#pr-body .pr-lead, #pr-body .row').count()) > 0 &&
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
        !!document.querySelector('#pr-body button.primary') &&
        /Check answer/.test(document.querySelector('#pr-body button.primary').textContent),
      back: !!document.querySelector('#pr-body .q-back'),
      next: !!document.querySelector('#pr-body .q-next'),
      count: (document.getElementById('pr-qcount') || {}).textContent || '',
      sideways: document.documentElement.scrollWidth > innerWidth + 1,
    }));
  await openSet('Harness nav');
  await page.waitForTimeout(150);
  let v = await q();
  ok(
    `[${scheme}] a fresh set opens on question 1, open to answer, with Next and no Back`,
    /question 1/.test(v.stem) && v.check && v.next && !v.back,
    JSON.stringify(v)
  );
  await page.click('#pr-body .q-next');
  await page.waitForTimeout(120);
  await page.locator('#pr-body label.opt', { hasText: 'Piaget' }).click();
  await page.click('#pr-body button:has-text("Check answer")');
  await page.waitForTimeout(150);
  v = await q();
  ok(
    `[${scheme}] answered out of order: question 2 first, Right with its why, 1 of 3`,
    /question 2/.test(v.stem) &&
      /^Right\b/.test(v.verdict) &&
      v.whys.includes('Piaget is right.') &&
      v.count === '1 of 3',
    JSON.stringify(v)
  );
  await page.screenshot({ path: `${shots}/practice-nav-answered-${scheme}.png` });
  await page.click('#pr-body .q-back');
  await page.waitForTimeout(120);
  v = await q();
  ok(
    `[${scheme}] Back to question 1: still open to answer, nothing marked`,
    /question 1/.test(v.stem) && v.check && !v.verdict && !v.back,
    JSON.stringify(v)
  );
  await page.screenshot({ path: `${shots}/practice-nav-back-${scheme}.png` });
  await page.click('#pr-body .q-next');
  await page.waitForTimeout(120);
  v = await q();
  ok(
    `[${scheme}] Next to question 2: its answer and why are still there`,
    /question 2/.test(v.stem) && /^Right\b/.test(v.verdict) && v.whys.includes('Piaget is right.') && v.back,
    JSON.stringify(v)
  );
  await page.click('#pr-fold');
  await page.waitForTimeout(150);
  const saved = await page.evaluate(id => Object.keys(((window.__db.answers || {})[id] || {}).answers || {}), navId);
  const line = await page
    .locator('#pr-body .pr-lead, #pr-body .row', { hasText: 'Harness nav' })
    .first()
    .textContent()
    .catch(() => '');
  ok(
    `[${scheme}] closed mid-set, the answer is kept and the list says one is answered`,
    JSON.stringify(saved) === '["v2"]' && /1 of 3|1 answered/.test(line),
    JSON.stringify([saved, line])
  );
  await openSet('Harness nav');
  await page.waitForTimeout(150);
  v = await q();
  ok(
    `[${scheme}] reopened, it is where he left it`,
    /question 2/.test(v.stem) && /^Right\b/.test(v.verdict),
    JSON.stringify(v)
  );
  await page.click('#pr-body .q-back');
  await page.waitForTimeout(100);
  await page.locator('#pr-body label.opt', { hasText: 'Erikson' }).click();
  await page.click('#pr-body button:has-text("Check answer")');
  await page.waitForTimeout(150);
  await page.click('#pr-body button:has-text("Next question")');
  await page.waitForTimeout(100);
  await page.click('#pr-body button:has-text("Next question")');
  await page.waitForTimeout(100);
  await page.locator('#pr-body label.opt', { hasText: 'Kohlberg' }).click();
  await page.click('#pr-body button:has-text("Check answer")');
  await page.waitForTimeout(150);
  await page.locator('#pr-body button', { hasText: 'See results' }).first().click();
  await page.waitForTimeout(150);
  ok(
    `[${scheme}] the last answer, whichever order, brings the results`,
    /3 of 3|All sets/.test(await page.textContent('#pr-body')) && !v.sideways,
    (await page.textContent('#pr-body')).slice(0, 160)
  );
  await page.screenshot({ path: `${shots}/practice-nav-done-${scheme}.png` });
  await page.locator('#pr-body button', { hasText: 'All sets' }).first().click();
  await page.waitForTimeout(150);
  // B-193 (D-205): a question on another course's passage names its source under the stem, from the data, once the
  // library is open (the page never loads it just for this): open Record, Library first, then the set.
  await page.click('#tab-record');
  await page.click('#seg-record [data-v="library"]');
  await page
    .waitForFunction(() => document.querySelectorAll('#library li').length > 0, null, { timeout: 8000 })
    .catch(() => {});
  await page.click('#seg-record [data-v="sessions"]'); // Record back on its first view for the checks after
  await page.click('#tab-study');
  await page.click('#seg-study [data-v="practice"]');
  await page.waitForTimeout(150);
  await openSet('Harness cross');
  await page.waitForFunction(() => document.querySelector('#pr-body .q-src'), null, { timeout: 8000 }).catch(() => {});
  const src = await page.textContent('#pr-body .q-src').catch(() => '');
  ok(
    `[${scheme}] a NUR question on a BIO passage names its source: From BIO 201: Bones slides`,
    src === 'From BIO 201: Bones slides',
    src
  );
  await page.screenshot({ path: `${shots}/practice-cross-${scheme}.png` });
  await page.click('#pr-fold');
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
    /^Build · queued/.test(surf.trim()) && /Sent to the builder at/.test(surf),
    surf.slice(0, 200)
  );
  await page.screenshot({ path: `${shots}/build-ask-${scheme}.png` });
  const held = 'idea: a bigger font for the resident in room 12';
  for (let i = 0; i < 2; i++) {
    await page.fill('#ev-input', held);
    await page.click('#ev-send');
    await page.waitForTimeout(200);
  }
  const still = await count();
  ok(
    `${tag}an identifier holds a build ask every time and nothing is written or fired`,
    !(await page.isHidden('#ev-guard')) &&
      /project record/.test(await page.textContent('#ev-guard')) &&
      still.jobs.length === after.jobs.length &&
      still.fires === after.fires &&
      (await msgs(page)).length === m.length,
    await page.textContent('#ev-guard')
  );
  await page.fill('#ev-input', '');
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
  await page.click('#ev-send');
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
      `[${scheme}] opening: large core above the greeting, top-bar core tucked away`,
      await page.evaluate(
        () =>
          document.body.classList.contains('opening') &&
          !!document.querySelector('#hero canvas') &&
          document.querySelector('#hero').getBoundingClientRect().height > 150 &&
          document.querySelector('#top-av').getBoundingClientRect().width < 4
      )
    );
    ok(
      `[${scheme}] core is drawing`,
      await page.evaluate(() => {
        const sm = window.EVApp.core.sample(0);
        let lit = sm ? sm.lit : 0;
        return lit > 500;
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
      `[${scheme}] the bar never covers the top bar's buttons or sideways-scrolls`,
      await page.evaluate(() => {
        const b = document.getElementById('ev-update').getBoundingClientRect(),
          t = document.getElementById('tab-system').getBoundingClientRect();
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
      `[${scheme}] five tabs as icons in the top bar beside System, no dock (B-85)`,
      (await page.locator('#top .tabs .tab').count()) === 5 &&
        (await page.isVisible('#tab-system')) &&
        (await page.locator('.dock').count()) === 0 &&
        (await page.evaluate(() => {
          const t = document.getElementById('top').getBoundingClientRect().height,
            lab = getComputedStyle(document.querySelector('#tab-today span')).position;
          return t <= 54 && (innerWidth >= 900 ? lab === 'static' : lab === 'absolute');
        }))
    );
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`[${scheme}] no sideways scroll`, !overflow);
    ok(`[${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    // ---- E.V.: greeting, quick asks, chat with tools, jobs, guard, check-in (light pass does the interactions)
    const greet = (await page.locator('#thread .msg.ev').last().textContent()) || '';
    // B-90: one strict line (what can't wait, else a greeting and how she can help), and a briefing folded under it.
    const gb = await page.evaluate(() => {
      const g = document.querySelector('#thread .msg.greet'),
        row = g.querySelector('.brief-row'),
        ul = g.querySelector('.brief-list');
      const cs = getComputedStyle(row);
      return {
        head: g.querySelector('.bubble').textContent,
        row: row && row.textContent,
        folded: !!ul && ul.hidden && row.getAttribute('aria-expanded') === 'false',
        dots: [...row.querySelectorAll('.br-dot')].map(d => d.className),
        plain:
          cs.borderTopWidth === '0px' &&
          /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) &&
          !g.querySelector('.badge, .bi-act'),
        items: [...g.querySelectorAll('.brief-item')].map(li => [
          li.dataset.level,
          li.querySelector('.bi-t').textContent,
          (li.querySelector('.bi-mark') || {}).className || '',
        ]),
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
      `[${scheme}] the briefing starts folded: plain text, a count and one red dot for the urgent item (urgent outranks new), no pills`,
      gb.folded && /^\d+ things to know$/.test(gb.row) && gb.dots.join() === 'br-dot urgent' && gb.plain,
      JSON.stringify(gb).slice(0, 300)
    );
    ok(
      `[${scheme}] the briefing ranks urgent, then new (the finished job), then the rest; urgent and new carry an accent mark`,
      gb.items[0][0] === 'urgent' &&
        /^ATI Engage Fundamentals/.test(gb.items[0][1]) &&
        gb.items[0][2] === 'bi-mark urgent' &&
        gb.items[1][0] === 'new' &&
        /Study guide: cardiac output/.test(gb.items[1][1]) &&
        gb.items[1][2] === 'bi-mark new' &&
        gb.items.slice(2).every(i => i[0] === 'normal' && !i[2]),
      JSON.stringify(gb.items)
    );
    if (scheme === 'phone') {
      await page.click('#thread .msg.greet .brief-row');
      await page.waitForTimeout(1100);
      const op = await page.evaluate(() => {
        const ul = document.querySelector('#thread .msg.greet .brief-list'),
          li = ul.querySelector('.brief-item'),
          t = li.querySelector('.bi-t');
        return {
          open: !ul.hidden,
          cut: t.scrollWidth > t.clientWidth + 1,
          rowsLeft: [...ul.querySelectorAll('.bi-t')].every(x => getComputedStyle(x).textAlign !== 'center'),
          step: document.getElementById('hero').dataset.step,
        };
      });
      await page.click('#thread .msg.greet .brief-item .bi-main');
      await page.waitForTimeout(300);
      const ex = await page.evaluate(() => {
        const li = document.querySelector('#thread .msg.greet .brief-item'),
          t = li.querySelector('.bi-t');
        return {
          open: li.classList.contains('open'),
          whole: t.scrollWidth <= t.clientWidth + 1,
          detail: li.querySelector('.bi-more').offsetParent && li.querySelector('.bi-d').textContent,
          go: (li.querySelector('.bi-go') || {}).textContent,
        };
      });
      ok(
        '[phone] opened, the briefing is a left-aligned list, rows cut to one line, her core stepped down',
        op.open && op.cut && op.rowsLeft && op.step === 'list',
        JSON.stringify(op)
      );
      ok(
        '[phone] a line opens in place by its chevron to the full text, the detail and its action as a text link',
        ex.open && ex.whole && ex.detail === 'Due tonight. Graded.' && ex.go === 'Open Today →',
        JSON.stringify(ex)
      );
      await page.screenshot({ path: `${shots}/briefing-open-phone.png` });
      await page.click('#thread .msg.greet .brief-row');
      await page.waitForTimeout(900);
    }
    // D-125 as amended: the greeting has no card; its offers are the chips, at most three, the finished job among them.
    const gm = await page.evaluate(() => ({
      cards: document.querySelectorAll('#thread .msg.greet .ev-card').length,
      chips: [...document.querySelectorAll('#qchips .qchip')].map(c => c.textContent),
    }));
    ok(
      `[${scheme}] the greeting has no card; at most three chips, one opening the finished study guide`,
      gm.cards === 0 && gm.chips.length <= 3 && gm.chips.includes('Open the study guide'),
      JSON.stringify(gm)
    );
    ok(
      `[${scheme}] quick chips`,
      (await page.locator('#qchips .qchip').count()) >= 3,
      String(await page.locator('#qchips .qchip').count())
    );
    await page.click('#tab-today');
    await page.waitForTimeout(100);
    // B-125 (D-163): a switch shows the tab at once, one fade of at most 0.2 s on the whole; its cards do not rise.
    ok(
      `[${scheme}] switching tabs shows the tab at once: one short fade, nothing rising`,
      await page.evaluate(() => {
        const p = document.getElementById('p-today'),
          s = getComputedStyle(p);
        return (
          p.classList.contains('enter') &&
          s.animationName === 'fade' &&
          parseFloat(s.animationDuration) <= 0.2 &&
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
      // B-53 (D-109) at desktop width: the kind on every idea, the weak-spot action only on a learning idea
      await page.click('#tab-record');
      await page.waitForTimeout(150);
      {
        const row = t => page.locator('#ideas .row', { hasText: t });
        const act = t => row(t).locator('button', { hasText: 'Make it a weak spot' }).count();
        ok(
          '[desktop] idea kinds shown; only the learning idea offers Make it a weak spot',
          /Feature/.test(await row('Harness feature idea').textContent()) &&
            /General/.test(await row('Harness general idea').textContent()) &&
            (await act('Harness feature idea')) === 0 &&
            (await act('Harness general idea')) === 0 &&
            (await act('Harness learning idea')) === 1
        );
        await page.locator('#ideas').scrollIntoViewIfNeeded();
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
      await page.focus('#ev-input');
      await page.waitForTimeout(150); // B-85: in a conversation the chips come back in an empty focused input
      await page.locator('#qchips .qchip', { hasText: 'Open the study guide' }).click();
      await page.waitForTimeout(900);
      const op = await page.evaluate(() => window.__opened);
      ok(
        '[desktop] Open the study guide opens it in a new tab, and her reply carries the job card with its link',
        JSON.stringify(op) === JSON.stringify([['https://claude.ai/artifact/harness', '_blank']]) &&
          (await page.locator('#ev-surf .ev-card a[href="https://claude.ai/artifact/harness"]').count()) === 1,
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
        await page.click('#tab-study');
        await page.waitForTimeout(150);
        if (await page.isVisible('#seg-study [data-v="practice"]')) await page.click('#seg-study [data-v="practice"]');
        await page.waitForTimeout(150);
        const lead = page.locator('#pr-body .pr-lead', { hasText: 'Harness dosage' });
        if (await lead.count()) await lead.locator('button.primary').click();
        else {
          if (await page.locator('#pr-done-fold[aria-expanded="false"]').count()) await page.click('#pr-done-fold');
          const r = page.locator('#pr-body .row', { hasText: 'Harness dosage' }).first();
          await r.locator('.pr-line').click();
          await page.waitForTimeout(80);
          await r.locator('.pr-acts button').first().click();
        }
        await page.waitForTimeout(150);
        await page.locator('#pr-body input.num-in').fill('10 mL');
        await page.click('#pr-body button:has-text("Check answer")');
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
      m.length === 2 && m[0].role === 'matt' && m[1].role === 'ev' && m[1].cards[0].type === 'dates',
      JSON.stringify(m.map(x => [x.role, x.text.slice(0, 30)]))
    );
    ok(
      'the dates card opens as a surface, its head line naming its count, nothing under her line (B-78)',
      /^\d+ dates? in the next week$|^Nothing dated in the next week$/.test(
        await page
          .locator('#ev-surf .sf-head .sf-t')
          .textContent()
          .catch(() => '')
      ) && (await page.locator('#thread .msg.ev').last().locator('.ev-card').count()) === 0
    );
    // Captions (B-77): after his first message she stays on her stage at 80%; no core moves to the top bar or a message.
    ok(
      'after his first message her core stays on her stage, a step down (an open surface takes the list step, B-78)',
      await page.evaluate(
        () =>
          document.getElementById('hero').dataset.step === (innerWidth >= 1024 ? 'surface' : 'list') &&
          document.querySelector('#top-av').getBoundingClientRect().width < 1
      )
    );
    ok(
      'one live core, her stage: none on the messages',
      (await page.locator('#thread .ev-av canvas').count()) === 0 && (await page.locator('#hero canvas').count()) === 1
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
      'Go deeper offered on the quick reply',
      (await page.locator('#thread .msg.ev').last().locator('button', { hasText: 'Go deeper' }).count()) === 1
    );
    ok(
      'chat context carries the greeting as record data and the reply-once rule',
      /Today’s greeting, built by E.V. core from this record/.test(call.input[0].content) &&
        /write your reply once, after the last tool result/.test(call.input[0].content)
    );
    // B-99: a planted ask to write graded work is refused in one line on the page, with no model call.
    {
      const before = await page.evaluate(() => window.__chatCalls.length);
      await send(page, 'Can you write my care plan for clinical?');
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => window.__chatCalls.length);
      const said = (await page.locator('#thread .msg.ev').last().locator('.bubble').textContent())
        .replace(/\s+/g, ' ')
        .trim();
      ok(
        'B-99: a request to write graded work is refused in one line, without asking Claude',
        after === before &&
          said === 'That’s graded work, so it stays yours. I can block time for it or quiz you on the topic.',
        JSON.stringify([before, after, said])
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
        (id.includes('build') ? /^Build · queued/.test(t.trim()) : /^Your reply · failed/.test(t.trim())) &&
          want.test(t) &&
          (await surf.locator('button', { hasText: 'Try again' }).count()) === 0,
        t.slice(0, 300)
      );
      await surf.first().screenshot({ path: `${shots}/builder-job-${id.split('-')[2]}.png` });
    }
    await buildAskChecks(page, scheme); // B-180
    // B-194: a plan card's Open the plan shows that plan in Study, Plan, which names the other plans in force to switch to.
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
      const t = await page.locator('#plan-card').textContent();
      ok(
        "a plan card's Open the plan shows that plan, with the other plans in force named",
        /Dosage plan \(harness\)/.test(t) && /Other plans: Exam 4 plan/.test(t),
        t.slice(0, 200) + ' | surface: ' + surf.slice(0, 200)
      );
      await page.screenshot({ path: `${shots}/plan-from-card.png` });
      await page.locator('#plan-card .plan-others button', { hasText: 'Exam 4 plan' }).click();
      await page.waitForTimeout(200);
      const t2 = await page.locator('#plan-card').textContent();
      ok(
        'switching to another plan shows it',
        /Exam 4 plan/.test(t2) && /Other plans: Dosage plan/.test(t2),
        t2.slice(0, 200)
      );
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
    await page.click('#brand');
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
    ok('tapping the brand returns to now', (bn.atBottom || bn.linePinned) && !bn.pill, JSON.stringify(bn));
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
    // B-197: the identifier check, two stages. A question that only names the fields (his Oct 19 skills checklist ask)
    // is no candidate and goes straight on; a value is looked at with the words around it (the stand-in model answers
    // the judgment); practice goes on whole; real or unsure waits on It's made up or Leave it out, in plain words.
    const idDocs = () => page.evaluate(() => Object.values(window.__db.idchecks || {}));
    const before0 = (await msgs(page)).length;
    await send(page, 'What is your client’s name and date of birth?');
    await page.waitForTimeout(200);
    ok(
      'a question that names the fields is no candidate: it is sent, with nothing said and no judgment asked',
      (await page.isHidden('#ev-guard')) &&
        (await msgs(page)).some(m => /client’s name and date of birth/.test(m.text)) &&
        (await msgs(page)).length > before0 &&
        !(await page.evaluate(() => (window.__jsonCalls || []).some(c => /Candidates \(JSON\)/.test(c.prompt))))
    );
    await page.evaluate(() => {
      window.__sampleFn = p => {
        if (!/Candidates \(JSON\)/.test(p)) return { items: [] };
        const rows = JSON.parse(p.split('Candidates (JSON): ')[1].split('\n')[0]);
        return {
          verdicts: rows.map(r => ({
            key: r.key,
            verdict: /checklist/.test(r.around) ? 'practice' : 'unsure',
            reason: /checklist/.test(r.around) ? 'A step of a skills validation checklist.' : 'Nothing says.',
          })),
        };
      };
    });
    await send(page, 'For the checklist: the client is Ana Reyes, DOB: 04/12/1961');
    await page.waitForTimeout(300);
    const kept1 = await idDocs();
    ok(
      'a practice value passes whole after one judgment, and its verdict is kept without the value',
      (await page.isHidden('#ev-guard')) &&
        (await msgs(page)).some(m => /DOB: 04\/12\/1961/.test(m.text)) &&
        kept1.some(d => d.verdict === 'practice' && d.by === 'judgment' && d.writer === 'page') &&
        !JSON.stringify(kept1).includes('04/12/1961'),
      JSON.stringify(kept1)
    );
    const before2 = (await msgs(page)).length;
    await page.fill('#ev-input', 'The resident in room 12 was confused');
    await page.click('#ev-send');
    await page.waitForTimeout(300);
    const guardText = await page.textContent('#ev-guard');
    ok(
      'an unsure value waits on him in plain words, with It’s made up and Leave it out, and nothing is sent',
      !(await page.isHidden('#ev-guard')) &&
        (await msgs(page)).length === before2 &&
        /could be a real patient’s/.test(guardText) &&
        !/flag|violation/i.test(guardText) &&
        (await page.locator('#ev-guard button').count()) === 2,
      guardText
    );
    await page.screenshot({ path: `${shots}/id-held-${scheme}.png` });
    await page.locator('#ev-guard button', { hasText: 'Leave it out' }).click();
    await page.waitForTimeout(300);
    ok(
      'Leave it out sends his words with only that detail left out',
      (await page.isHidden('#ev-guard')) && (await msgs(page)).some(m => m.text === 'The [left out] was confused'),
      JSON.stringify((await msgs(page)).slice(-2).map(m => m.text))
    );
    await page.fill('#ev-input', 'Sim lab: the resident in room 7 was confused');
    await page.click('#ev-send');
    await page.waitForTimeout(300);
    await page.locator('#ev-guard button', { hasText: 'It’s made up' }).click();
    await page.waitForTimeout(300);
    const kept2 = await idDocs();
    ok(
      'It’s made up sends his words whole and keeps his answer, which every later check reads first',
      (await msgs(page)).some(m => m.text === 'Sim lab: the resident in room 7 was confused') &&
        kept2.some(d => d.by === 'matt' && d.verdict === 'practice'),
      JSON.stringify(kept2.map(d => [d.by, d.verdict]))
    );
    await page.evaluate(() => {
      window.__sampleFn = null;
    });
    await page.fill('#ev-input', '');
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
    await page.evaluate(() => {
      window.__mcpFail = null;
    });
    await jc.locator('button', { hasText: 'Try again' }).click();
    await page.waitForTimeout(300);
    jb = await page.evaluate(() => Object.values(window.__db.jobs).find(j => j.title === 'Practice: acid-base'));
    ok(
      'Try again re-fires the job with a clean attempt',
      jb.fired.ok === true && !jb.fired.error,
      JSON.stringify(jb.fired)
    );
    {
      // B-46 (D-103): the clinical-prep brief. Its ask never carries patient details; the day before a clinical day the
      // briefing offers it, and the chip starts the job for that day.
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
        window.__chatReply = 'Leaving that out.';
      });
      await send(page, 'Prep me for my patient in room 412');
      await page.waitForTimeout(300);
      ok(
        'a clinical-prep ask with patient details writes no job and starts nothing',
        (
          await page.evaluate(() =>
            Object.values(window.__db.jobs).filter(j => j.kind === 'clinical-prep' || /412/.test(j.title + j.brief))
          )
        ).length === 0
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
      const cj = await page.evaluate(() => Object.values(window.__db.jobs).find(j => j.kind === 'clinical-prep'));
      const fired = await page.evaluate(n => window.__mcpCalls.slice(n), fires);
      ok(
        'the chip starts the clinical-prep job for that day and fires the worker',
        cj &&
          cj.brief.startsWith(tomorrow + ': ') &&
          /^Clinical prep: /.test(cj.title) &&
          fired.some(c => c[1] === 'fire_trigger') &&
          /Never your paperwork/.test((await msgs(page)).slice(-1)[0].text),
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
      'status reads Live or the one problem System leads with (B-120)',
      await page.evaluate(() => {
        const s = document.getElementById('status').textContent,
          l = document.querySelector('#health .sys-lead');
        return s === 'Live' || (!!l && s === l.textContent);
      }),
      await page.textContent('#status')
    );
    ok(
      'now card has an action',
      (await page.textContent('#now')).length > 10,
      (await page.textContent('#now')).slice(0, 120)
    );
    ok(
      'today list rendered',
      (await page.locator('#today-list .row').count()) > 0,
      String(await page.locator('#today-list .row').count())
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
      Number(((await page.textContent('#today-list .card-head')) || '').replace(/^\D*?(\d+) of.*$/s, '$1'));
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
      'Today lists the added items with Remove, and counts their minutes',
      (await page
        .locator('#today-list .row', { hasText: 'Review the Chapter 8 lecture' })
        .locator('button', { hasText: 'Remove' })
        .count()) === 1 &&
        (Number.isNaN(min0)
          ? /~25 min · added by E\.V\./.test(await page.textContent('#today-list'))
          : (await budgetMin()) === min0 + 55),
      `${min0} -> ${await budgetMin()}`
    );
    // Matt adds one himself, then removes it
    await page.fill('#today-add', 'Flashcards for the bones lab');
    await page.press('#today-add', 'Enter');
    await page.waitForTimeout(200);
    dd = await dayDoc();
    const mine = Object.entries(dd.added || {}).find(([, a]) => a && a.text === 'Flashcards for the bones lab');
    ok(
      'the add row writes his item and clears',
      mine &&
        mine[1].by === 'Matt' &&
        (await page.inputValue('#today-add')) === '' &&
        (await page.locator('#today-list .row', { hasText: 'Flashcards for the bones lab' }).count()) === 1
    );
    await page.fill('#today-add', 'half typed');
    await page.focus('#today-add');
    const rr = await page.evaluate(async () => {
      const n = document.querySelectorAll('#today-list .row').length;
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
      'a refresh keeps what he is typing',
      rr > 0 &&
        (await page.inputValue('#today-add')) === 'half typed' &&
        (await page.evaluate(() => document.activeElement && document.activeElement.id === 'today-add'))
    );
    await page.fill('#today-add', '');
    // B-117 (D-078): an added item opens in place to its Remove.
    {
      const fr = page.locator('#today-list .row', { hasText: 'Flashcards for the bones lab' });
      ok(
        'an added item shows its Remove only once its line is opened',
        !(await fr.locator('button', { hasText: 'Remove' }).isVisible())
      );
      await fr.locator('.ti-line').click();
      await fr.locator('button', { hasText: 'Remove' }).click();
      await page.waitForTimeout(200);
    }
    dd = await dayDoc();
    ok(
      'top bar stays one line while jobs run',
      await page.evaluate(() => {
        const b = document.getElementById('brand').getBoundingClientRect(),
          y = document.getElementById('tab-system').getBoundingClientRect();
        return Math.abs((b.top + b.bottom) / 2 - (y.top + y.bottom) / 2) < 6;
      }),
      await page.textContent('#readout')
    );
    ok(
      'the add row is one line: field and Add',
      await page.evaluate(() => {
        const i = document.getElementById('today-add').getBoundingClientRect(),
          b = document.querySelector('.add-row button').getBoundingClientRect();
        return Math.abs(i.top - b.top) < 8 && b.left > i.right;
      })
    );
    ok(
      'Remove takes his item off',
      !(mine[0] in dd.added) &&
        (await page.locator('#today-list .row', { hasText: 'Flashcards for the bones lab' }).count()) === 0
    );
    await page.evaluate(() => document.querySelector('#today-add').scrollIntoView({ block: 'center' }));
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
    await page.click('#tab-today');
    await page.waitForTimeout(150);
    ok(
      'Today’s week leaves out what came off and shows the new entry',
      !/Harness study hall/.test(await page.textContent('#ahead')) &&
        /BIO lab practical/.test(await page.textContent('#ahead'))
    );
    await page.click('#tab-record');
    await page.waitForTimeout(100);
    await page.locator('#seg-record [data-v="dates"]').click();
    await page.waitForTimeout(150);
    const offRow = page.locator('#dates-off .row', { hasText: 'Harness study hall' });
    ok(
      'Record → Dates lists what came off with Bring back; graded Canvas work has no Remove',
      (await offRow.locator('button', { hasText: 'Bring back' }).count()) === 1 &&
        /taken off by E\.V\./.test(await offRow.textContent()) &&
        (await page.locator('#dates .row', { hasText: 'Harness graded quiz' }).locator('button').count()) === 0 &&
        (await page
          .locator('#dates .row', { hasText: 'BIO lab practical' })
          .locator('button', { hasText: 'Remove' })
          .count()) === 1
    );
    await page.screenshot({ path: `${shots}/record-dates.png`, fullPage: true });
    await offRow.locator('button', { hasText: 'Bring back' }).click();
    await page.waitForTimeout(200);
    await page
      .locator('#dates .row', { hasText: 'BIO lab practical' })
      .locator('button', { hasText: 'Remove' })
      .click();
    await page.waitForTimeout(200);
    cd = await cal();
    ok(
      'Bring back and Remove write through E.V. core, by Matt',
      cd['canvas-h-hall'].removed === null &&
        (await page.locator('#dates .row', { hasText: 'Harness study hall' }).count()) === 1 &&
        cd[labId].removed &&
        cd[labId].removed.by === 'Matt' &&
        (await page.locator('#dates-off .row', { hasText: 'BIO lab practical' }).count()) === 1,
      JSON.stringify([cd['canvas-h-hall'].removed, cd[labId].removed])
    );
    await page.fill('#d-date', labDate);
    await page.fill('#d-title', 'BIO lab practical');
    await page.click('#date-add button[type="submit"]');
    await page.waitForTimeout(200);
    cd = await cal();
    ok(
      'adding it again from the form brings it back instead of a copy',
      cd[labId].removed === null && Object.keys(cd).filter(k => k.startsWith(labId)).length === 1
    );
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
    // B-197: a text file with a real-looking record number the judgment can't call practice is saved with only that
    // detail left out, and she says so in plain words.
    const before4 = (await mats()).length;
    await page.setInputFiles('#ev-file', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Client notes. MRN: 4482913. Ambulated twice.'),
    });
    await page.waitForTimeout(500);
    const notes = (await mats()).find(u => /notes/.test(u.id));
    ok(
      'an attachment with a record number is saved with that detail left out',
      (await mats()).length === before4 + 1 &&
        notes &&
        /\[left out\]/.test(notes.text) &&
        !/4482913/.test(notes.text) &&
        /I left out one detail that could be a real patient’s/.test((await msgs(page)).slice(-1)[0].text),
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
    // Remove from library
    // B-78: the surface holds the latest reply's card (the photo's); the docx is removed from Record → Library
    await page.click('#tab-record');
    await page.click('#seg-record [data-v="library"]');
    await page.waitForTimeout(250);
    await page.locator('#library .row', { hasText: 'sample' }).first().locator('button', { hasText: 'Remove' }).click();
    await page.click('#tab-ev');
    await page.waitForTimeout(250);
    const rm = await page.evaluate(() => {
      const id = Object.keys(window.__db.materials).find(
        id => /-sample$/.test(id) && window.__db.materials[id].fileType === 'docx'
      );
      return id ? [id, window.__db.materials[id], (window.__db.materialedits || {})[id]] : null;
    });
    ok(
      'Remove from library marks it in materialedits and keeps the material',
      rm && rm[2] && rm[2].removed && rm[2].removed.by === 'Matt' && rm[1].text.length > 0,
      JSON.stringify(rm && rm[2])
    );
    // Record > Library lists the files
    await page.click('#tab-record');
    await page.click('#seg-record [data-v="library"]');
    await page.waitForTimeout(250);
    ok(
      'Record lists the library by course with uploads removable',
      (await page.locator('#library .row').count()) >= 4 &&
        /Harness Skills Packet/.test(await page.textContent('#library')) &&
        (await page
          .locator('#library .row', { hasText: 'erikson-photo' })
          .locator('button', { hasText: 'Remove' })
          .count()) === 1,
      String(await page.locator('#library .row').count())
    );
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${shots}/library.png`, fullPage: false });
    await page.click('#seg-record [data-v="sessions"]');
    await page.click('#tab-ev');
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.__sampleFn = null;
    });
    // Study > Review: the migrated set, all answered
    await page.click('#tab-study');
    await page.click('#seg-study [data-v="review"]');
    await page.waitForTimeout(100);
    const rv = await page.textContent('#rv-body');
    ok(
      'review summary from migrated answers',
      reviewExpect ? rv.includes(reviewExpect) : /Check answer/.test(rv),
      (reviewExpect || '(unanswered)') + ' · ' + rv.slice(0, 80)
    );
    // Practice: open the harness set, answer single (right), sata (wrong), matrix (right)
    await page.click('#seg-study [data-v="practice"]');
    await page.waitForTimeout(100);
    ok(
      'practice lists sets',
      (await page.locator('#pr-body .row').count()) + (await page.locator('#pr-body .pr-lead').count()) >= 2
    );
    // B-126 (D-165): Practice leads with the set to do next; the others are lines opening in place to Start, Continue or
    // Review, the finished ones folded under one line.
    const openSet = async title => {
      const lead = page.locator('#pr-body .pr-lead', { hasText: title });
      if (await lead.count()) return lead.locator('button.primary').click();
      if (
        (await page.locator('#pr-done-fold[aria-expanded="false"]').count()) &&
        !(await page.locator('#pr-body .row', { hasText: title }).first().isVisible())
      )
        await page.click('#pr-done-fold');
      const r = page.locator('#pr-body .row', { hasText: title }).first();
      await r.locator('.pr-line').click();
      await page.waitForTimeout(80);
      return page.locator('#pr-body .row', { hasText: title }).first().locator('.pr-acts button').first().click();
    };
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
        const allSets = page.locator('#pr-body button', { hasText: 'All sets' });
        if (await allSets.count()) {
          await allSets.first().click();
          await page.waitForTimeout(150);
        }
        ok('back on the list, the share bar goes', !(await page.isVisible('#pr-share')));
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
      await page.click('#pr-body button:has-text("Check answer")');
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
      await page.locator('#pr-body button', { hasText: 'All sets' }).first().click();
      await page.waitForTimeout(150);
    }
    await openSet('Harness set');
    await page.waitForTimeout(100);
    ok('a set made for him offers no Share', !(await page.isVisible('#pr-share')));
    // B-192: options show in a seeded order, so the harness picks them by their words.
    await page.locator('#pr-body label.opt', { hasText: 'Forward-facing seat with harness' }).click();
    await page.click('#pr-body button:has-text("Check answer")');
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
    await page.click('#pr-body button:has-text("Check answer")');
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
    await page.click('#pr-body button:has-text("Check answer")');
    await page.waitForTimeout(150);
    ok('matrix answered correctly', /^Right\b/.test(await page.textContent('#pr-body .verdict')));
    ws = await model('e4-aging-expected');
    ok(
      'matrix right: today counts once toward the streak',
      ws.streak === agingBefore + 1 || (ws.streak === agingBefore && agingRightToday),
      JSON.stringify({ before: agingBefore, s: ws.streak, last: ws.lastReviewed })
    );
    await page.screenshot({ path: `${shots}/practice.png`, fullPage: true });
    // B-39 (D-095): every attempt is truth: Retake shows the set fresh, a new answer is appended, nothing is replaced
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
      ok(
        'a finished set offers Retake',
        (await page.locator('#pr-body button', { hasText: 'Retake' }).count()) === 1,
        (await page.textContent('#pr-body')).slice(0, 160)
      );
      await page.locator('#pr-body button', { hasText: 'Retake' }).click();
      await page.waitForTimeout(150);
      ok(
        'Retake shows the first question unanswered, the one count at the bar back to none (B-116)',
        /Check answer/.test(await page.textContent('#pr-body')) && (await page.textContent('#pr-qcount')) === '0 of 3',
        await page.textContent('#pr-qcount')
      );
      await page.locator('#pr-body label.opt').nth(1).click();
      await page.click('#pr-body button:has-text("Check answer")');
      await page.waitForTimeout(150);
      ok(
        'the retake answer is appended beside the first one, never replacing it',
        (await tries()) === before + 1,
        `${before} -> ${await tries()}`
      );
      await page.screenshot({ path: `${shots}/retake-${scheme}.png`, fullPage: false });
    }
    await practiceNav(page, scheme); // B-191
    // Plan: tick a task (B-121: from 1024 px the plan sits beside review and practice, with no Plan button)
    if (scheme === 'desktop') {
      ok(
        '[desktop] the plan sits beside the study view, folded to its title, with no Plan button',
        (await page.isVisible('#plan-card .fold-line')) &&
          !(await page.isVisible('#plan-card .plan-day')) &&
          !(await page.isVisible('#seg-study [data-v="plan"]'))
      );
      await page.click('#plan-card .fold-line');
    } else await page.click('#seg-study [data-v="plan"]');
    await page.waitForTimeout(100);
    const planRows = page.locator('#plan-card .plan-day').first().locator('input.tick');
    ok('plan shows tasks', (await planRows.count()) > 0);
    const before = await page.evaluate(() => Object.keys(((window.__db.planedits || {}).E4 || {}).ticks || {}).length);
    const firstUnchecked = page.locator('#plan-card .plan-day').first().locator('input.tick:not(:checked)').first();
    // One element, resolved once: check() on the :not(:checked) locator re-resolves after the re-render and can tick the next task too.
    await (await firstUnchecked.elementHandle()).click();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => Object.keys(((window.__db.planedits || {}).E4 || {}).ticks || {}).length);
    if (after !== before + 1)
      console.log(
        'DEBUG plan ticks',
        JSON.stringify(await page.evaluate(() => (window.__db.planedits || {}).E4)),
        JSON.stringify(await page.evaluate(() => window.__writes.filter(w => w[1] === 'planedits')))
      );
    ok(
      'plan tick saved to planedits/E4, the plan untouched',
      after === before + 1 && !(await page.evaluate(() => window.__db.plans.E4.done)),
      before + ' -> ' + after
    );
    await page.screenshot({ path: `${shots}/plan.png`, fullPage: true });
    // Progress
    await page.click('#tab-progress');
    await page.waitForTimeout(100);
    // B-39 (D-094): the score card asks for a past unit exam's score and saves it to examedits/<examId>, replaced whole
    {
      ok(
        'score card asks for the past exam with no score',
        (await page.isVisible('#score-card')) && /Harness Exam 0/.test(await page.textContent('#score-card')),
        await page.textContent('#score-card')
      );
      await page.fill('#score-in', '88.5');
      await page.click('#score-form button[type=submit]');
      await page.waitForTimeout(200);
      const ed = await page.evaluate(() => (window.__db.examedits || {}).E0H);
      ok(
        'the score lands in examedits/<examId>, the exam itself unchanged',
        !!ed &&
          ed.score === 88.5 &&
          ed.status === 'done' &&
          ed.writer === 'page' &&
          (await page.evaluate(() => !('score' in window.__db.exams.E0H))),
        JSON.stringify(ed)
      );
      // B-47 (D-104): the saved score starts the post-exam retro: an exam-retro job naming the exam, fired on the worker
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
      ok(
        'once scored, the card asks for the next one or hides',
        !/Harness Exam 0/.test((await page.textContent('#score-card')) || '') || !(await page.isVisible('#score-card'))
      );
      await page.screenshot({ path: `${shots}/score-${scheme}.png`, fullPage: false });
    }
    const rd = await page.textContent('#ready-card');
    ok('readiness shows E4', /Exam 4/.test(rd) && /% solid/.test(rd), rd.slice(0, 100));
    {
      // B-48 (D-105): the mornings' stamps draw E4's line; the night-before prediction is its last, marked point.
      const pts = await page.locator('#ready-card svg.trend circle.trend-pt').count();
      const cap = (await page.textContent('#ready-card .trend-cap')) || '';
      ok(
        'readiness draws its line from the mornings, nothing stored by the page',
        pts === 7 && /Solid over 7 mornings: 0% to 20%\./.test(cap),
        JSON.stringify({ pts, cap })
      );
      const tomorrow = await page.evaluate(() => window.EVCore.addDays(window.EVCore.chicagoDate(new Date()), 1));
      await page.evaluate(async t => {
        const db = await window.claude.use('db');
        await db
          .collection('predictions')
          .doc('E4')
          .set({
            schema: 1,
            writer: 'morning',
            at: new Date().toISOString(),
            source: 'morning 4:25',
            examId: 'E4',
            date: t,
            percentSolid: 25,
            activeWeakSpots: 8,
            accuracyLast7: 60,
            answersLast7: 10,
            predictedRange: [78, 86],
            basis: 'harness',
          });
      }, tomorrow);
      await page.waitForTimeout(300);
      await page.click('#seg-progress [data-v="weak"]');
      await page.click('#seg-progress [data-v="readiness"]');
      await page.waitForTimeout(200);
      const pred = await page.locator('#ready-card svg.trend circle.trend-pred').count();
      const cap2 = (await page.textContent('#ready-card .trend-cap')) || '';
      const tip = await page.evaluate(() => {
        const t = document.querySelector('#ready-card svg.trend circle.trend-pred title');
        return t ? t.textContent : '';
      });
      ok(
        'the night-before prediction is the last marked point',
        pred === 1 && /the night before, 25%/.test(cap2) && /predicted score 78 to 86/.test(tip),
        JSON.stringify({ pred, cap2, tip })
      );
      for (const [w, h] of [
        [390, 844],
        [1280, 860],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        await page.locator('#ready-card').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await page.locator('#ready-card').screenshot({ path: `${shots}/readiness-trend-${w}.png` });
      }
      await page.setViewportSize(scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 });
      // B-72 (D-120): the latest weekly's insights, its three lines, beside readiness; nothing recomputed by the page.
      const closed = await page.evaluate(() => document.getElementById('insights-list').hidden);
      await page.click('#insights-line');
      const ins = await page.evaluate(() => {
        const c = document.getElementById('insights-card');
        return c && !c.hidden
          ? {
              h: document.getElementById('insights-line').textContent,
              closed: null,
              lines: [...c.querySelectorAll('.ins-line')].map(l => l.textContent),
            }
          : null;
      });
      if (ins) ins.closed = closed;
      ok(
        'the week’s insights fold to one line that opens to their top three',
        ins &&
          ins.closed &&
          /^From the week of .+ · 3 findings$/.test(ins.h) &&
          ins.lines.length === 3 &&
          ins.lines[0] === 'Weakest objective: E4-3, 2 of 7 right (29%).',
        JSON.stringify(ins)
      );
      await page.locator('#insights-card').screenshot({ path: `${shots}/insights-${scheme}.png` });
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
    await page.click('#seg-progress [data-v="weak"]');
    await page.waitForTimeout(100);
    ok(
      'weak spots listed',
      (await page.locator('#progress-weak li.ws-item').count()) > 10,
      String(await page.locator('#progress-weak li.ws-item').count())
    );
    ok(
      'previews listed',
      (await page.locator('#weak-preview .row').count()) === 4,
      String(await page.locator('#weak-preview .row').count())
    );
    await page.locator('#weak-due .ws-item').first().locator('.ws-line').click();
    await page.locator('#weak-due .ws-item').first().locator('button', { hasText: 'Mark solid' }).click();
    await page.waitForTimeout(150);
    const solidEv = await page.evaluate(() =>
      Object.entries(window.__db.weakspots)
        .filter(([, w]) => w.events && Object.values(w.events).some(e => e.type === 'solid' && e.by === 'owner'))
        .map(([id]) => id)
    );
    ok('mark solid writes an owner event', solidEv.length === 1, solidEv.join(','));
    // B-41: Copy for Quizlet on the weak-spot list: import text, one tab-separated card per open weak spot, no write
    {
      await page.evaluate(() => {
        window.__clip = null;
        try {
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
              writeText: t => {
                window.__clip = t;
                return Promise.resolve();
              },
            },
          });
        } catch (e) {
          window.__clipErr = e.message;
        }
        window.__writes0 = JSON.stringify(window.__db);
      });
      ok('weak spots: Copy for Quizlet is offered', await page.isVisible('#weak-quizlet-btn'));
      await page.click('#weak-quizlet-btn');
      await page.waitForTimeout(150);
      const clip = await page.evaluate(() => window.__clip || '');
      const lines = clip.split('\n').filter(Boolean);
      const open = await page.evaluate(() => Object.values(window.__db.weakspots).length);
      ok(
        'Copy for Quizlet copies one term<TAB>definition line per open concept weak spot',
        lines.length >= 10 && lines.every(l => l.split('\t').length === 2 && l.split('\t')[0] && l.split('\t')[1]),
        `${lines.length} lines of ${open} · ${lines[0] || ''}`.slice(0, 200)
      );
      ok(
        'Copy for Quizlet writes nothing to the record',
        await page.evaluate(() => JSON.stringify(window.__db) === window.__writes0)
      );
      await page.locator('#weak-quizlet').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/weak-quizlet-${scheme}.png`, fullPage: false });
    }
    await page.screenshot({ path: `${shots}/progress.png`, fullPage: true });
    // Record
    await page.click('#tab-record');
    await page.waitForTimeout(100);
    {
      const want = await page.evaluate(
        () => Object.values(window.__db.sessions || {}).filter(x => x.status !== 'active').length
      );
      const got = await page.locator('#sessions .row').count();
      ok(
        'sessions listed (every session the record holds that is not running)',
        got >= 2 && got === want,
        JSON.stringify({ got, want })
      );
    }
    ok('ideas show links', /1 link/.test(await page.textContent('#ideas')));
    // B-53 (D-109): every idea shows its kind; only a learning idea offers "Make it a weak spot"; the kind can change
    {
      const feat = page.locator('#ideas .row', { hasText: 'Harness feature idea' });
      ok(
        'a feature idea shows its kind and no weak-spot action',
        /Feature/.test(await feat.textContent()) &&
          (await feat.locator('button', { hasText: 'Make it a weak spot' }).count()) === 0
      );
      const gen = page.locator('#ideas .row', { hasText: 'Harness general idea' }),
        learn = page.locator('#ideas .row', { hasText: 'Harness learning idea' });
      ok(
        'a general idea shows its kind and no weak-spot action',
        /General/.test(await gen.textContent()) &&
          (await gen.locator('button', { hasText: 'Make it a weak spot' }).count()) === 0
      );
      ok(
        'a learning idea shows its kind and offers Make it a weak spot',
        /Learning/.test(await learn.textContent()) &&
          (await learn.locator('button', { hasText: 'Make it a weak spot' }).count()) === 1
      );
      // B-111: the kind menu shows once the row is opened in place.
      ok("an idea's kind menu waits until its row is opened", !(await feat.locator('select.idea-kind').isVisible()));
      await feat.locator('.idea-head').click();
      await feat.locator('select.idea-kind').selectOption('learning');
      await page.waitForTimeout(200);
      const k = await page.evaluate(() => window.__db.ideas['idea-harness-feature'].kind);
      ok(
        'changing the kind writes it (a mark) and the action appears',
        k === 'learning' &&
          (await page
            .locator('#ideas .row', { hasText: 'Harness feature idea' })
            .locator('button', { hasText: 'Make it a weak spot' })
            .count()) === 1,
        k
      );
      await page.locator('#ideas').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/ideas-${scheme}.png`, fullPage: false });
    }
    await page.click('#seg-record [data-v="journal"]');
    // B-197: nothing is said while he writes; on save an unsure value waits on his choice, and Leave it out saves.
    await page.fill('#j-text', 'Resident in room 12 was confused.');
    await page.waitForTimeout(50);
    const jWarn0 = await page.textContent('#j-warn');
    await page.locator('#j-add button[type="submit"]').click();
    await page.waitForTimeout(300);
    ok(
      'the journal asks about an unsure value on save, in plain words, and saves nothing yet',
      !jWarn0 &&
        /could be a real patient’s/.test(await page.textContent('#j-warn')) &&
        !(await page.evaluate(() => Object.values(window.__db.journal || {}).some(j => /room 12/.test(j.text || '')))),
      await page.textContent('#j-warn')
    );
    await page.locator('#j-warn button', { hasText: 'Leave it out' }).click();
    await page.waitForTimeout(300);
    ok(
      'Leave it out saves the entry with that detail left out',
      await page.evaluate(() =>
        Object.values(window.__db.journal || {}).some(j => j.text === '[left out] was confused.')
      )
    );
    // System
    await page.click('#tab-system');
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
        /Evening \(Mac\) missed its 8:20 PM run\. It runs on your Mac, which may have been asleep or offline; it runs again at its next time\./.test(
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
    await send(st, 'File it');
    await st.waitForTimeout(200);
    ok(
      'file it files through the reader on the page, never a Mac task',
      /Nothing new to file/.test((await msgs(st)).slice(-1)[0].text) &&
        (await st.evaluate(() => window.__mcpCalls.filter(c => c[1] === 'fire_trigger').length)) === 1
    );
    ok('staging readout says staging', /staging/i.test(await st.textContent('#readout')));
    await st.close();

    // ---- B-18: session filing from the page, skills practice, the readiness audit, grounded explanations
    {
      const fp = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const fErr = [];
      fp.on('pageerror', e => fErr.push(e.message));
      await fp.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
      // The reader lists three sessions: one new, one v3 already filed (under its bare id), one tagged #graded.
      const fresh = {
        found: true,
        id: '2026-10-18-1300-Harness-Fluids',
        date: today,
        startedAt: today + 'T18:00:00Z',
        endedAt: today + 'T18:40:00Z',
        note: 'Harness Fluids',
        minutes: 40,
        checks: 3,
        questions: 4,
        summary: 'Worked through third spacing.',
        weakSpots: [
          { objective: 'E4-3', topic: 'Third spacing signs' },
          { objective: '', topic: 'Why albumin holds fluid in the vessels' },
        ],
        connections: ['Albumin links nutrition to edema'],
        noteTodos: ['Add a third-spacing example'],
        cardCount: 2,
        source: 'Study Watch',
      };
      const pre = `window.__readerSessions = { sessions: [{ id: '2026-10-18-1300-Harness-Fluids', bytes: 900, sha256: 'a', modifiedAt: '${today}T18:41:00Z' }, { id: '2026-10-17-0035-Pharmacology-Chapter-50', bytes: 800, sha256: 'b', modifiedAt: '2026-10-17T05:50:00Z' }, { id: '2026-10-18-1200-Harness-Graded', bytes: 300, sha256: 'c', modifiedAt: '${today}T17:00:00Z' }], count: 3, more: false };
        window.__readerSession = { '2026-10-18-1300-Harness-Fluids': ${JSON.stringify(fresh)}, '2026-10-18-1200-Harness-Graded': { found: true, id: '2026-10-18-1200-Harness-Graded', graded: true } };`;
      await openPage(fp, 'staging', pre);
      await fp.waitForTimeout(2500);
      const filed = await fp.evaluate(() => window.__db.sessions['sw-2026-10-18-1300-Harness-Fluids']);
      ok(
        'on open, new Study Watch sessions are filed from the page through the reader',
        filed &&
          filed.writer === 'page' &&
          filed.source === 'Study Watch' &&
          filed.summary === 'Worked through third spacing.' &&
          !JSON.stringify(filed).includes('note text'),
        JSON.stringify(filed).slice(0, 200)
      );
      ok(
        'only findings were read, and only from the reader’s session tools',
        await fp.evaluate(
          h =>
            window.__mcpCalls
              .filter(c => c[0] === h)
              .map(c => c[1])
              .every(t => ['status', 'list_sessions', 'read_session'].includes(t)) &&
            window.__mcpCalls.some(c => c[1] === 'read_session' && c[2].id === '2026-10-18-1300-Harness-Fluids'),
          spec.registry.studyWatch.reader.host
        )
      );
      ok(
        'a session v3 already filed and a #graded one are left alone',
        await fp.evaluate(
          () =>
            !window.__db.sessions['sw-2026-10-17-0035-Pharmacology-Chapter-50'] &&
            !window.__db.sessions['sw-2026-10-18-1200-Harness-Graded'] &&
            !window.__mcpCalls.some(
              c => c[1] === 'read_session' && c[2].id === '2026-10-17-0035-Pharmacology-Chapter-50'
            )
        )
      );
      const fw = await fp.evaluate(() => ({
        ws: Object.values(window.__db.weakspots)
          .filter(w => w.topic === 'Third spacing signs' || w.topic === 'Add a third-spacing example')
          .map(w => w.kind),
        ideas: Object.values(window.__db.ideas).filter(i => i.sessionId === 'sw-2026-10-18-1300-Harness-Fluids').length,
      }));
      ok(
        'its findings are filed by the session rules: a weak spot, a note to-do, ideas',
        fw.ws.includes('concept') && fw.ws.includes('note') && fw.ideas === 2,
        JSON.stringify(fw)
      );
      const fm = (await msgs(fp)).slice(-1)[0];
      ok(
        'E.V. says what it filed, once, with the session card',
        /^Filed 1 Study Watch session, 2 new weak spots, 2 ideas\. Sessions tagged #graded stayed out\.$/.test(
          fm.text
        ) && fm.cards[0].type === 'session',
        fm.text
      );
      await send(fp, 'File it');
      await fp.waitForTimeout(500);
      ok(
        'file it again: nothing new, nothing written twice',
        /Nothing new to file|#graded stayed out of the record/.test((await msgs(fp)).slice(-1)[0].text) &&
          (await fp.evaluate(() => Object.keys(window.__db.sessions).filter(k => k.startsWith('sw-')).length)) === 1,
        (await msgs(fp)).slice(-1)[0].text
      );
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
      await fp.locator('#sksheet .sk-mini', { hasText: 'End' }).click();
      await fp.waitForTimeout(400);
      ok('[phone] the sheet goes when the run ends', !(await fp.isVisible('#sksheet')));
      const ended = await fp.evaluate(id => window.__db.sessions[id], sk.id);
      ok(
        'Stop ends the run with its summary, and the summary card comes back under her line',
        ended.status === 'ended' &&
          /^2 of \d+ steps done right, missed step 2\. Stopped before the end\.$/.test(ended.summary) &&
          /missed step 2/.test(await card().textContent()),
        ended.summary
      );
      await fp.click('#tab-progress');
      await fp.locator('#seg-progress [data-v="weak"]').click();
      await fp.waitForTimeout(200);
      ok(
        'Progress lists it as a skill to practice',
        (await fp
          .locator('#weak-notes .row', { hasText: ': step 2, ' })
          .locator('button', { hasText: 'Practiced' })
          .count()) === 1
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
    // ---- B-51 (D-107): at 1024px and up the checklist is a side panel beside the thread
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
        '[desktop] the side panel shows the whole checklist beside the thread, the sheet hidden',
        (await dp.isVisible('#skpanel')) &&
          !(await dp.isVisible('#sksheet')) &&
          (await dp.locator('#skpanel .sk-step').count()) >= 4 &&
          /Step 1 of \d+/.test(await dp.textContent('#skpanel'))
      );
      const pb = await dp.locator('#skpanel').boundingBox(),
        tb = await dp.locator('#thread').boundingBox();
      ok(
        '[desktop] the panel sits to the right of the thread, in view',
        pb && tb && pb.x >= tb.x + tb.width && pb.y < 860 && pb.x + pb.width <= 1280,
        JSON.stringify({ pb, tb })
      );
      await dp.locator('#skpanel .sk-acts button', { hasText: 'Did it' }).click();
      await dp.waitForTimeout(400);
      await dp.locator('#skpanel .sk-acts button', { hasText: 'Missed it' }).click();
      await dp.waitForTimeout(400);
      const marks = await dp.evaluate(() =>
        [...document.querySelectorAll('#skpanel .sk-step')].map(li => (li.className.match(/pass|miss|cur/) || [''])[0])
      );
      ok(
        '[desktop] marking from the panel ticks the list, with the tally',
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
      await dp.locator('#skpanel button', { hasText: 'End' }).click();
      await dp.waitForTimeout(400);
      ok(
        '[desktop] End on the panel ends the run and the panel goes',
        !(await dp.isVisible('#skpanel')) &&
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
        // The page's wall clock forward: not clock.fastForward, whose real-time sync can rewind it (CLAUDE.md, and jump below).
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
          `[${label}] the running workout sits in the dock too, with its round and buttons`,
          label === 'phone'
            ? (await wp.isVisible('#sksheet')) &&
                /CINDY · Round 4/.test(await wp.textContent('#sksheet')) &&
                (await wp.locator('#sksheet button', { hasText: 'Round done' }).count()) === 1
            : (await wp.isVisible('#skpanel')) &&
                /Workout · CINDY/.test(await wp.textContent('#skpanel')) &&
                (await wp.locator('#skpanel button', { hasText: 'Round done' }).count()) === 1
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
        const wl = await wp.textContent('#workouts');
        ok(
          `[${label}] Record lists both workouts with their results`,
          /CINDY/.test(wl) && /3 rounds \+ 7 reps/.test(wl) && /stopped in round 6/.test(wl),
          wl.slice(0, 200)
        );
        ok(`[${label}] B-52: no page errors`, wErr.length === 0, wErr.join(' | '));
        await wp.close();
      }
    }

    // ---- Study session, entirely in the E.V. conversation (D-073). A fake clock fast-forwards to each check.
    const ss = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const sErr = [];
    ss.on('pageerror', e => sErr.push(e.message));
    ss.on('console', m => {
      if (m.type() === 'error') sErr.push(m.text());
    });
    await ss.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await openPage(ss);
    await ss.waitForTimeout(900);
    const host = spec.registry.studyWatch.reader.host;
    const note1 = 'Fluids and electrolytes\nIsotonic: 0.9% NaCl stays in the vessels.';
    const setNote = (text, extra = {}) =>
      ss.evaluate(
        ([t, e]) => {
          window.__readerNote = {
            found: true,
            appVersion: '0.4',
            note: {
              id: 'x-coredata://n1',
              name: 'Fluids and electrolytes',
              folder: '2026/2026 Fall/NUR 112/Week 9',
              modifiedAt: new Date().toISOString(),
              text: t,
            },
            ...e,
          };
        },
        [text, extra]
      );
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
    // Without the reader (a browser tab or the iPhone), E.V. says where to open the page
    await ss.evaluate(() => {
      window.__readerFail = 'server_not_connected';
    });
    // D-125 as amended: while no session runs, Start a study session keeps the last of the three chips.
    const sc = await ss.evaluate(() => [...document.querySelectorAll('#qchips .qchip')].map(c => c.textContent));
    ok(
      'session chip offered, last of at most three',
      sc.length <= 3 && sc[sc.length - 1] === 'Start a study session',
      JSON.stringify(sc)
    );
    await ss.locator('#qchips .qchip', { hasText: 'Start a study session' }).click();
    await ss.waitForTimeout(300);
    ok(
      'no reader: says to open the desktop app, starts nothing',
      /Claude desktop app on your Mac/.test((await msgs(ss)).slice(-1)[0].text) && !(await sess()),
      (await msgs(ss)).slice(-1)[0].text
    );
    // A #graded note is refused
    await ss.evaluate(() => {
      window.__readerFail = null;
    });
    await setNote('', { graded: true });
    await send(ss, 'Start a study session');
    await ss.waitForTimeout(300);
    ok('graded note refused', /#graded/.test((await msgs(ss)).slice(-1)[0].text) && !(await sess()));
    // Start
    await setNote(note1);
    await send(ss, 'start a study session');
    await ss.waitForTimeout(400);
    let S1 = await sess();
    ok(
      'session saved as active with a start mark, no note text',
      S1 &&
        S1.status === 'active' &&
        S1.topic === 'Fluids and electrolytes' &&
        Object.values(S1.events)[0].len === note1.length &&
        !JSON.stringify(S1).includes('Isotonic'),
      JSON.stringify(S1 && S1.events)
    );
    ok(
      'start message in the thread',
      /Session started on Fluids and electrolytes/.test((await msgs(ss)).slice(-1)[0].text.replace(/\*\*/g, ''))
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
        'in a session: the thread is the session (his line that started it, her start line), her core at 66% (172 px) on a 196 px stage (D-128, B-74)',
        cs.step === 'session' &&
          cs.lines === 1 &&
          cs.thread.length === 2 &&
          /^matt: start a study session/i.test(cs.thread[0]) &&
          /^ev: Session started/.test(cs.thread[1]) &&
          Math.abs(cs.px - 172) <= 1 &&
          cs.stage === 196,
        JSON.stringify(cs)
      );
    }
    // B-86 (Matt, Oct 19): the session's stats are one quiet line under her core (no pill above her); its progress is
    // the ring round her own core (B-84).
    const lineView = () =>
      ss.evaluate(() => {
        const b = document.getElementById('sbar'),
          r = b.getBoundingClientRect(),
          h = document.getElementById('hero').getBoundingClientRect(),
          th = document.getElementById('thread').getBoundingClientRect(),
          cs = getComputedStyle(b);
        return {
          h: Math.round(r.height),
          top: Math.round(r.top),
          heroBottom: Math.round(h.bottom),
          threadTop: Math.round(th.top),
          cores: b.querySelectorAll('canvas').length,
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
        'the session is one quiet line under her core (at most 34 px, no box), above her words; her own core carries the ring',
        pr.h <= 34 &&
          pr.top >= pr.heroBottom - 8 &&
          pr.top + pr.h <= pr.threadTop + 1 &&
          /rgba\(0, 0, 0, 0\)|transparent/.test(pr.bg) &&
          pr.border === '0px' &&
          pr.cores === 0 &&
          pr.ring >= 0 &&
          pr.ring < 0.1 &&
          pr.session &&
          !pr.over,
        JSON.stringify(pr)
      );
      ok(
        'the line names the session in its label and shows the minutes and that she is reading along, then Break and End (B-88)',
        /Fluids and electrolytes/.test(pr.label) &&
          /^\d+ min · reading along$/.test(await ss.textContent('#sbar .s-clock')) &&
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
        'in a session, against a reader without titles (v1): the Reading line says Your notes and his latest line, and Quiz me now is the one chip (D-131)',
        /^Reading · Your notesIsotonic: 0\.9% NaCl stays in the vessels\.$/.test(rv.reading || '') &&
          rv.chips.join() === 'Quiz me now',
        JSON.stringify(rv)
      );
    }
    {
      // B-74 (D-131): reader 0.3 names the note (course › first heading); the next read puts its title on the line.
      await ss.evaluate(() => {
        window.__readerNote.note.title = 'NUR 112 › Fluids and electrolytes';
      });
      await jump(31e3, () => ss.evaluate(() => /›/.test(document.getElementById('sread').textContent)));
      const reading = await ss.evaluate(() => document.getElementById('sread').textContent);
      ok(
        'in a session, against reader 0.3: the Reading line names the course and note by the reader title, then his latest line (D-131)',
        /^Reading · NUR 112 › Fluids and electrolytesIsotonic: 0\.9% NaCl stays in the vessels\.$/.test(reading),
        reading
      );
    }
    ok(
      'chip hidden while a session runs',
      (await ss.locator('#qchips .qchip', { hasText: 'Start a study session' }).count()) === 0
    );
    await ss.screenshot({ path: `${shots}/session-bar.png` });
    // The same line at 1280, under her core in the middle column.
    await ss.setViewportSize({ width: 1280, height: 860 });
    await ss.waitForTimeout(500);
    {
      const pd = await lineView();
      const c = await ss.evaluate(() => {
        const b = document.getElementById('sbar').getBoundingClientRect(),
          a = document.querySelector('#hero .ev-av').getBoundingClientRect();
        return Math.round(Math.abs((b.left + b.right) / 2 - (a.left + a.right) / 2));
      });
      ok(
        '[desktop] the line stays one line, under her core and centred on it',
        pd.h <= 34 && pd.top >= pd.heroBottom - 8 && c <= 2 && !pd.over,
        JSON.stringify({ ...pd, offCentre: c })
      );
    }
    await ss.screenshot({ path: `${shots}/session-bar-desktop.png` });
    await ss.setViewportSize({ width: 390, height: 844 });
    await ss.waitForTimeout(400);
    // B-88: she reads along every 30 s; a line that earns it gets one short comment quoting it (the quote in memory only)
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
    const note2 = note1 + '\nHypotonic: 0.45% NaCl shifts water into the cells.\n';
    await setNote(note2);
    const beforeC = (await msgs(ss)).length;
    await jump(
      31e3,
      hasEvent(e => e.type === 'check' && e.comment)
    );
    await ss.waitForTimeout(400);
    S1 = await sess();
    const cev = Object.values(S1.events).find(e => e.type === 'check' && e.comment);
    const cp = await ss.evaluate(
      () => (window.__jsonCalls || []).filter(c => /reading over his shoulder/.test(c.prompt)).slice(-1)[0]
    );
    ok(
      'a read sends only the new lines to Claude on the quick tier, with the record context',
      cp &&
        /The new lines he just wrote:\nHypotonic: 0\.45% NaCl shifts water into the cells\./.test(cp.prompt) &&
        /Testable objectives:/.test(cp.prompt) &&
        cp.tier === 'quick',
      cp && cp.prompt.slice(0, 300)
    );
    const cm = (await msgs(ss)).slice(-1)[0];
    ok(
      'her comment posts as one line with no card, and the session keeps a mark, not the text or the quote',
      (await msgs(ss)).length === beforeC + 1 &&
        cm.text === 'Good link: that is tonicity deciding where the water goes.' &&
        !cm.cards &&
        cev &&
        cev.msgId === cm.id &&
        cev.len === note2.length &&
        !JSON.stringify(S1).includes('Hypotonic') &&
        !JSON.stringify(await msgs(ss)).includes('shifts water into the cells'),
      JSON.stringify({ cm, cev })
    );
    ok(
      'the quote shows under her line on the page',
      (await ss.textContent('#thread .msg.ev.current .cap-quote').catch(() => '')) ===
        'on “Hypotonic: 0.45% NaCl shifts water into the cells.”'
    );
    await ss.screenshot({ path: `${shots}/session-comment.png` });
    // A read with nothing worth a word stays silent: no message, no event
    await ss.evaluate(() => {
      window.__commentSay = { say: null, quote: null, kind: null };
    });
    await setNote(note2 + 'Hypertonic: 3% NaCl pulls water out of the cells.\n');
    const beforeS = (await msgs(ss)).length;
    const evN = Object.keys((await sess()).events).length;
    await jump(
      80e3,
      async () =>
        (await ss.evaluate(
          () => (window.__jsonCalls || []).filter(c => /reading over his shoulder/.test(c.prompt)).length
        )) >= 2
    );
    ok(
      'a read with nothing worth saying stays silent',
      (await msgs(ss)).length === beforeS && Object.keys((await sess()).events).length === evN
    );
    // Quiz me now: 1 to 3 questions on what he wrote since the session started, as a check card
    await ss.locator('#qchips .qchip', { hasText: 'Quiz me now' }).click();
    for (let i = 0; i < 50 && !(await hasEvent(e => e.type === 'check' && e.items)()); i++)
      await ss.waitForTimeout(100);
    await ss.waitForTimeout(300);
    S1 = await sess();
    const chk = Object.values(S1.events).find(e => e.type === 'check' && e.items);
    const jp = await ss.evaluate(
      () => (window.__jsonCalls || []).filter(c => /Study session check/.test(c.prompt)).slice(-1)[0]
    );
    ok(
      'Quiz me now reads the note through the reader',
      await ss.evaluate(h => window.__mcpCalls.some(c => c[0] === h && c[1] === 'latest_note'), host)
    );
    ok(
      'the quiz prompt carries his writing since the start and the record context',
      jp &&
        /New text since the last check:\n\nHypotonic: 0\.45% NaCl[\s\S]*Hypertonic: 3% NaCl/.test(jp.prompt) &&
        /Testable objectives:/.test(jp.prompt) &&
        jp.tier === 'quick',
      jp && jp.prompt.slice(0, 400)
    );
    ok(
      'the quiz keeps a mark, not the text',
      chk && chk.n === 1 && chk.items === 2 && chk.len > note1.length && !JSON.stringify(S1).includes('Hypotonic'),
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
      /Two questions on what you just wrote/.test((await msgs(ss)).slice(-1)[0].text) &&
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
      /Study session running on his note "Fluids and electrolytes"/.test(cc.input[0].content) &&
        cc.input.some(t => /Why does 0\.45% NaCl move water into the cells\?/.test(t.content)) &&
        cc.tools.includes('study_session')
    );
    ok('check card shows answered', /Check 1 · answered/.test(await ss.locator('#ev-surf').textContent()));
    // Break and resume from the bar
    await ss.locator('#sbar button', { hasText: 'Break' }).click();
    await ss.waitForTimeout(300);
    ok(
      'break shown on the line',
      /On a break/.test(await ss.textContent('#sbar')) &&
        Object.values((await sess()).events).some(e => e.type === 'break')
    );
    await ss.screenshot({ path: `${shots}/session-break.png` });
    await ss.locator('#sbar button', { hasText: 'Resume' }).click();
    await ss.waitForTimeout(300);
    ok(
      'resume: she reads along again',
      /min · reading along/.test(await ss.textContent('#sbar')),
      await ss.textContent('#sbar')
    );
    // New writing with what looks like an identifier skips the check and says why, once
    await setNote(
      note1 +
        '\nHypotonic: 0.45% NaCl shifts water into the cells.\nHypertonic: 3% NaCl pulls water out of the cells.\nThe resident in room 12 had edema.\n'
    );
    const before3 = (await msgs(ss)).length;
    await jump(
      80e3,
      hasEvent(e => e.type === 'skip' && e.why === 'identifiers')
    );
    S1 = await sess();
    ok(
      'identifier skips the check',
      Object.values(S1.events).some(e => e.type === 'skip' && e.why === 'identifiers') &&
        /room number/.test((await msgs(ss)).slice(-1)[0].text) &&
        (await msgs(ss)).length === before3 + 1
    );
    // End: wrap-up as JSON, filed with the same rules as evening filing; near-repeat waits on a tap
    await ss.locator('#sbar button', { hasText: 'End' }).click();
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
        const t = await ss.textContent('#sessions');
        await ss.click('#tab-ev');
        return /Fluids and electrolytes/.test(t);
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
        greet: !!document.querySelector('#thread .msg.greet.current .brief-row'),
      }));
      ok(
        'B-91: a reopen in the same conversation starts clean at her greeting (his earlier lines fold behind the pull)',
        planted >= 2 && v.msgs.length === 1 && /greet/.test(v.msgs[0]) && v.greet && v.step === 'idle' && v.chips >= 1,
        JSON.stringify({ planted, ...v })
      );
      await rp.click('#thread .msg.greet .brief-row');
      await rp.waitForTimeout(1200);
      ok(
        'B-91: and its briefing unfolds with her stage stepping down',
        await rp.evaluate(
          () =>
            document.getElementById('hero').dataset.step === 'surface' &&
            !document.querySelector('#thread .msg.greet .brief-list').hidden
        )
      );
      ok('B-91: no page errors', rErr.length === 0, rErr.join(' | '));
      await rp.close();
    }
    // B-87: a page opened mid-session (a reload, a reopened tab, a live publish) past a due checkpoint takes the session
    // over as soon as its reader answers, instead of sitting at 0:00 for two minutes.
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
        window.__readerNote = {
          found: true,
          appVersion: '0.4',
          note: {
            id: 'x-coredata://n9',
            name: 'Reload test',
            folder: 'NUR 112',
            modifiedAt: t0,
            text: 'Line one\nLine two\n',
          },
        };
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
            topic: 'Reload test',
            noteId: 'x-coredata://n9',
            driver: { view: 'gone', at: t0 },
            events: { [k]: { type: 'start', at: t0, len: 5, h: 'zz', noteId: 'x-coredata://n9' } },
          });
      });
      const t0 = Date.now();
      let d = null;
      for (let i = 0; i < 80; i++) {
        d = await tk.evaluate(() => window.__db.sessions['ss-reload']);
        if (d.driver.view !== 'gone' && Object.values(d.events).some(e => e.type === 'check' || e.type === 'idle'))
          break;
        await tk.waitForTimeout(100);
      }
      ok(
        'B-87: a page opened mid-session past a due checkpoint claims the session and runs the checkpoint within seconds',
        d &&
          d.driver.view !== 'gone' &&
          Object.values(d.events).some(e => e.type === 'check' && e.quiet) &&
          Date.now() - t0 < 8000,
        JSON.stringify({
          driver: d && d.driver,
          events: d && Object.values(d.events).map(e => e.type + (e.quiet ? ':quiet' : '')),
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
      chips.length > 0 && !chips.some(c => /^Your turn/.test(c)),
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
    ok(
      `${tag} the greeting offers Your turn with its count`,
      chips.includes('Your turn (3)') && chips.length <= 3,
      chips.join(' | ')
    );
    await page.locator('#qchips button', { hasText: 'Your turn (3)' }).click();
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
    await page.evaluate(() => {
      window.__chatScript = [];
      window.__chatReply = 'Noted.';
    });
    await send(page, 'bug: the timer resets when I switch tabs');
    await page.waitForTimeout(400);
    const jobs1 = await page.evaluate(
      () => Object.values(window.__db.jobs || {}).filter(j => j.kind === 'build').length
    );
    ok(
      '[live 390] while the builder cannot read live: no Your turn chip and no build ask',
      !chips.some(c => /^Your turn/.test(c)) && jobs1 === jobs0,
      JSON.stringify({ chips, jobs0, jobs1 })
    );
    await page.close();
  }
  // B-163 (Matt, Oct 22: "Ask me on the page"): what a run kept out waits in Your turn, where and what kind, never the
  // value; It's made up keeps his answer as <key>-matt and takes it off the list. At 390 and 1280.
  for (const w of [390, 1280]) {
    const tag = `[held ${w}]`;
    delete seed.system.yourturn;
    const KEY = 'id-0123456789abcdef';
    seed.idchecks = {
      [KEY]: {
        schema: 1,
        writer: 'restore-drill',
        at: '2026-10-22T04:33:00Z',
        source: 'restore-drill restore-drill-20261022-043233095',
        release: 'v4.3.0',
        key: KEY,
        verdict: 'unsure',
        reason: 'held for Matt: a run never passes a value on its own',
        kind: 'has a date of birth',
        ref: 'legacy/v4-talk-2026-10-19-s1',
        by: 'held',
      },
    };
    const page = await browser.newPage({ viewport: { width: w, height: w === 390 ? 844 : 860 }, colorScheme: 'dark' });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await servePdfjs(page);
    await openPage(page);
    await page.waitForTimeout(1500);
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('#qchips button')].map(b => b.textContent.trim())
    );
    ok(
      `${tag} the greeting offers Your turn for what a run kept out`,
      chips.includes('Your turn (1)'),
      chips.join(' | ')
    );
    await page.locator('#qchips button', { hasText: 'Your turn (1)' }).click();
    await page.waitForTimeout(500);
    const card = await page.evaluate(() => {
      const li = document.querySelector('#ev-surf .yt-place[data-place="held"] .yt-held');
      return li
        ? {
            key: li.dataset.keys,
            text: li.textContent,
            chips: [...li.querySelectorAll('.yt-chips button')].map(b => b.textContent.trim()),
          }
        : null;
    });
    ok(
      `${tag} the card names where and what kind, never the value, with It's made up and Keep it out`,
      card &&
        card.key === KEY &&
        /A run left out a date of birth that could be a real patient’s/.test(card.text) &&
        /legacy\/v4-talk-2026-10-19-s1/.test(card.text) &&
        !/\d{2}\/\d{2}\/\d{4}/.test(card.text) &&
        !/flag|violation/i.test(card.text) &&
        JSON.stringify(card.chips) === JSON.stringify(['It’s made up', 'Keep it out']),
      JSON.stringify(card)
    );
    await page.screenshot({ path: `${shots}/held-${w}.png` });
    await page.locator('#ev-surf .yt-held .yt-chips button', { hasText: 'It’s made up' }).click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(k => {
      const d = (window.__db.idchecks || {})[k + '-matt'];
      return { d, left: document.querySelectorAll('#ev-surf .yt-held').length };
    }, KEY);
    ok(
      `${tag} It's made up keeps his answer as <key>-matt (practice, by matt) and the item leaves the list`,
      after.d && after.d.verdict === 'practice' && after.d.by === 'matt' && after.d.key === KEY && after.left === 0,
      JSON.stringify(after)
    );
    ok(`${tag} no page errors`, errs.length === 0, errs.join(' | '));
    await page.close();
  }
  // B-163 (Matt, Oct 22): a case-study handout holds several values; Your turn asks once per place, and his one tap keeps
  // an answer per value. Two from one file and one from another: two asks, and It's made up on the file answers both.
  for (const w of [390, 1280]) {
    const tag = `[held grouped ${w}]`;
    delete seed.system.yourturn;
    const held = (key, kind, ref, at) => ({
      schema: 1,
      writer: 'canvas-sync',
      at,
      source: 'canvas-sync canvas-sync-20261022-1200',
      release: 'v4.3.0',
      key,
      verdict: 'unsure',
      reason: 'held for Matt: a run never passes a value on its own',
      kind,
      ref,
      by: 'held',
    });
    const A = 'id-aaaaaaaaaaaaaaaa';
    const B = 'id-bbbbbbbbbbbbbbbb';
    const C = 'id-cccccccccccccccc';
    seed.idchecks = {
      [A]: held(A, 'has a date of birth', 'files/case-study-3', '2026-10-22T12:00:00Z'),
      [B]: held(B, 'has a medical record number', 'files/case-study-3', '2026-10-22T12:00:01Z'),
      [C]: held(C, 'has a date of birth', 'files/case-study-4', '2026-10-22T12:00:02Z'),
    };
    const page = await browser.newPage({ viewport: { width: w, height: w === 390 ? 844 : 860 }, colorScheme: 'dark' });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await servePdfjs(page);
    await openPage(page);
    await page.waitForTimeout(1500);
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('#qchips button')].map(b => b.textContent.trim())
    );
    ok(`${tag} the greeting counts one ask per file`, chips.includes('Your turn (2)'), chips.join(' | '));
    await page.locator('#qchips button', { hasText: 'Your turn (2)' }).click();
    await page.waitForTimeout(500);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('#ev-surf .yt-held')].map(li => ({ ref: li.dataset.ref, text: li.textContent }))
    );
    ok(
      `${tag} one row per file; the handout's row names how many and what kinds, never a value`,
      rows.length === 2 &&
        rows[0].ref === 'files/case-study-3' &&
        /A run left out 2 details that could be a real patient’s \(a date of birth, a medical record number\)/.test(
          rows[0].text
        ) &&
        /A run left out a date of birth/.test(rows[1].text),
      JSON.stringify(rows)
    );
    await page.screenshot({ path: `${shots}/held-grouped-${w}.png` });
    await page
      .locator('#ev-surf .yt-held[data-ref="files/case-study-3"] .yt-chips button', { hasText: 'It’s made up' })
      .click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(
      ([a, b, c]) => {
        const db = window.__db.idchecks || {};
        return {
          a: db[a + '-matt'],
          b: db[b + '-matt'],
          c: db[c + '-matt'] || null,
          left: [...document.querySelectorAll('#ev-surf .yt-held')].map(li => li.dataset.ref),
        };
      },
      [A, B, C]
    );
    ok(
      `${tag} one tap keeps an answer per value in that file, each with its own kind; the other file still asks`,
      after.a &&
        after.a.verdict === 'practice' &&
        after.a.by === 'matt' &&
        after.a.kind === 'has a date of birth' &&
        after.b &&
        after.b.verdict === 'practice' &&
        after.b.kind === 'has a medical record number' &&
        after.c === null &&
        JSON.stringify(after.left) === JSON.stringify(['files/case-study-4']),
      JSON.stringify(after)
    );
    ok(`${tag} no page errors`, errs.length === 0, errs.join(' | '));
    await page.close();
  }
  delete seed.idchecks;
  delete seed.system.yourturn;
  await browser.close();
  for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : '');
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? `SOME FAILED: ${failed} of ${results.length}` : `ALL PASSED: ${results.length} checks`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : '');
  console.log('CRASHED', e.message.split('\n').slice(0, 14).join('\n'));
  process.exit(1);
});
