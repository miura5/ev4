// The page harness (B-16, ported from v3's test/harness/run.cjs): drives the built v4 page (dist/page/<target>/, the
// shell with its published files served beside it) at phone and desktop width, with the record, sample, mcp and the
// Study Watch reader stubbed (stub.js). The record comes from a folder of <collection>/<id>.json in v4 shapes: the
// staging seed (`seed-staging --out`) or a migrated export, kept outside the repository (it is personal data).
//   node test/harness/run.cjs <record dir> [screenshots dir]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails. The shell's own checks are test/harness/shell.cjs.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '../..');
const dbDir = process.argv[2];
if (!dbDir) { console.error('usage: node test/harness/run.cjs <record dir> [screenshots dir]'); process.exit(2); }
const shots = process.argv[3] || '/tmp/ev4-shots'; fs.mkdirSync(shots, { recursive: true });
function load(dir) { const db = {}; for (const c of fs.readdirSync(dir)) { const p = path.join(dir, c); if (!fs.statSync(p).isDirectory()) continue; db[c] = {}; for (const f of fs.readdirSync(p)) if (f.endsWith('.json')) db[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')); } return db; }
const seed = load(dbDir);
delete seed.system; delete seed.legacy; delete seed.debug; delete seed.journal; // the harness never needs his journal
seed.ideas = seed.ideas || {}; seed.ideas['idea-harness-feature'] = { schema: 2, writer: 'page', at: '2026-10-17T14:00:00Z', source: 'Told E.V.', kind: 'feature', text: 'Harness feature idea: a dark-mode calendar', objective: '', status: 'open', links: [] }; seed.ideas['idea-harness-general'] = { schema: 2, writer: 'page', at: '2026-10-17T14:00:00Z', source: 'Told E.V.', kind: 'general', text: 'Harness general idea: buy a new stethoscope', objective: '', status: 'open', links: [] }; seed.ideas['idea-harness-learning'] = { schema: 2, writer: 'page', at: '2026-10-17T14:00:00Z', source: 'Told E.V.', kind: 'learning', text: 'Harness learning idea: third spacing links to albumin', objective: '', status: 'open', links: [] }; // B-53
seed.exams = seed.exams || {}; seed.exams['E0H'] = { schema: 2, writer: 'page', at: '2026-09-01T14:00:00Z', source: 'harness', course: 'NUR 112', kind: 'unit', title: 'Harness Exam 0', date: '2026-10-01', status: 'upcoming' }; // B-39: past, no score
seed.system = { manifest: { release: 'v4.0.0', commit: 'a'.repeat(40), pages: { staging: { files: { 'page/staging/app.js': 'a'.repeat(64) } }, live: { files: {} } } } }; // B-38
const env = (writer, source, at) => ({ schema: 1, writer, at: at || new Date().toISOString(), source });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const DAYTIME = new Date(today + 'T19:00:00Z'); // 2pm CDT: the page's clock (see openPage)
// Today's review: the newest review set in the record, with its answers, as today's (so the summary is known).
const lastReview = Object.keys(seed.sets || {}).filter(k => /^review-\d{4}-\d{2}-\d{2}$/.test(k)).sort().pop();
let reviewExpect = null;
if (lastReview && lastReview !== 'review-' + today) {
  seed.sets['review-' + today] = { ...seed.sets[lastReview], date: today };
  const a = (seed.answers || {})[lastReview];
  if (a) { seed.answers['review-' + today] = { ...a, setId: 'review-' + today }; }
}
// The page shows the summary once every item is answered, the first unanswered item ("n of m") while some are, and
// the first item untouched before any are. An export taken the same day may hold a review set part answered.
{ const rs = (seed.sets || {})['review-' + today]; const a = ((seed.answers || {})['review-' + today] || {}).answers || {};
  if (rs) {
    const latest = q => { const t = a[q.id] || {}; const k = Object.keys(t).sort().pop(); return k ? t[k] : null; };
    const items = rs.items || []; const got = items.map(latest); const done = got.filter(Boolean);
    const next = got.findIndex(x => !x);
    reviewExpect = !done.length ? null : next < 0 ? `${done.filter(x => x.correct).length} of ${done.length} right` : `${next + 1} of ${items.length}`;
  } }
// The harness opens the page as if nothing has been said today (the greeting at full size, a quick ask making the day's
// first two messages): an export taken today carries today's conversation, so it is left out.
if (seed.talk) delete seed.talk[today];
// The same for today's sessions and workouts: a staging record carries the proofs earlier build chats ran on it (B-51's
// skills run, B-52's CINDY), which would otherwise read as a run already started today.
for (const c of ['sessions', 'workouts']) for (const [id, d] of Object.entries(seed[c] || {})) if ((d.date || E_DATE(d.startedAt)) === today) delete seed[c][id];
function E_DATE(iso) { return iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso)) : null; }
// A small practice set to exercise all three question types and the answer flow.
seed.sets = seed.sets || {};
seed.sets['more-' + today + '-1'] = { ...env('page', 'More practice'), kind: 'more', date: today, exam: 'E4', title: 'Harness set', createdAt: new Date().toISOString(), items: [
  { id: 'm1', kind: 'review', weakspotId: 'e4-preschooler', objective: 'E4-6', topic: 'Preschooler health promotion', type: 'single', cjStep: 'take-action', stem: 'A parent asks how to keep a 4-year-old safe in the car. What should the nurse teach?', options: ['Forward-facing seat with harness', 'Adult seat belt only', 'Front seat with airbag off', 'Booster with lap belt only'], correct: [0], rationales: ['Right for this age and size.', 'Too early.', 'Back seat is safest.', 'Needs lap and shoulder belt.'] },
  { id: 'm2', kind: 'check', objective: 'E4-2', topic: 'Caring behaviors', type: 'sata', cjStep: 'generate-solutions', stem: 'Which actions show caring behaviors with an anxious older adult? Select all that apply.', options: ['Sit at eye level', 'Use touch if welcomed', 'Speak quickly to save time', 'Listen without interrupting', 'Talk to the family instead'], correct: [0, 1, 3], rationales: ['Yes.', 'Yes.', 'No.', 'Yes.', 'No.'] },
  { id: 'm3', kind: 'review', weakspotId: 'e4-aging-expected', objective: 'E4-3', topic: 'Aging: expected vs. unexpected', type: 'matrix', cjStep: 'recognize-cues', stem: 'An 82-year-old is admitted. Mark each finding as expected with aging or unexpected.', matrix: { columns: ['Expected', 'Unexpected'], rows: [{ text: 'Thinner, drier skin', correct: 0, rationale: 'Normal aging.' }, { text: 'New confusion since yesterday', correct: 1, rationale: 'Sudden change suggests delirium.' }, { text: 'Slower reaction time', correct: 0, rationale: 'Normal aging.' }] } },
] };
const hourAgo = new Date(Date.now() - 3600e3).toISOString();
// A small library file (D-079): the skills packet's head-to-toe checklist sits on page 12.
seed.materials = seed.materials || {};
seed.materials['NUR112-harness-skills'] = { ...env('canvas-sync', 'Canvas'), course: 'NUR 112', kind: 'lab', title: 'Harness Skills Packet.pdf', fileType: 'pdf', pages: 13, module: 'LAB/SKILLS Resources',
  text: '[p1] Nursing Skills Packet\n[p2] Table of contents: Vital signs 8; Head to Toe Assessment 12; Head to Toe Documentation 13\n[p12] HEAD TO TOE ASSESSMENT * 1. Perform hand hygiene. * 2. Introduce yourself and verify the client with two identifiers. * 3. Provide privacy and explain the assessment. * 4. Inspect the skin and auscultate heart sounds at the five landmarks.\n[p13] HEAD TO TOE DOCUMENTATION * Document findings by body system.\n' };
// Calendar entries for the edit checks (D-080): two from Canvas (graded work stays; an optional event can go) and the rest of the export.
const inDays = n => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(Date.now() + n * 86400e3));
seed.dates = seed.dates || {};
seed.dates['canvas-h-graded'] = { ...env('canvas-sync', 'Canvas'), canvasId: 9001, date: inDays(2), title: 'Harness graded quiz', kind: 'due', graded: true, course: 'NUR 112' };
seed.dates['canvas-h-hall'] = { ...env('canvas-sync', 'Canvas'), canvasId: 9002, date: inDays(3), title: 'Harness study hall', kind: 'other', graded: false, course: 'NUR 112' };
// pdf.js comes from cdnjs on the page; the harness serves a local copy (npm install --no-save pdfjs-dist@4.4.168)
const pdfjsDir = path.join(root, 'node_modules/pdfjs-dist/build');
const hasPdfjs = fs.existsSync(path.join(pdfjsDir, 'pdf.min.mjs'));
const servePdfjs = page => page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/**', r => { const f = path.join(pdfjsDir, r.request().url().split('/').pop()); return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), headers: { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' } }) : r.abort(); });
// The watchdog's last health check (B-17): one stalled run it re-fired, one it could not, the evening's hash.
seed.health = { current: { ...env('watchdog', 'watchdog harness', new Date(DAYTIME.getTime() - 50 * 60e3).toISOString()), record: 'staging', pipelines: { morning: { id: 'morning-h', status: 'ok', startedAt: new Date(DAYTIME.getTime() - 9 * 3600e3).toISOString(), endedAt: new Date(DAYTIME.getTime() - 9 * 3600e3 + 300e3).toISOString(), release: 'v4.0.0' } }, missing: [{ pipeline: 'evening-cloud', slot: new Date(DAYTIME.getTime() - 20 * 3600e3).toISOString(), refired: true }], stalledRuns: [{ id: 'weekly-h', pipeline: 'weekly', startedAt: new Date(DAYTIME.getTime() - 3 * 3600e3).toISOString(), minutes: 180, refired: false }], stalledJobs: [], reported: [{ id: 'watchdog-refire-weekly-h', target: 'run weekly-h', reason: 'never ended', why: 'already re-fired once' }], verifyDeploy: null, derivedHash: { evening: 'x'.repeat(64), at: new Date(DAYTIME.getTime() - 18 * 3600e3).toISOString() }, capacity: { docs: 412, level: 'warn', budgets: [{ collection: 'sets', docs: 401, bytes: null, warnDocs: 400, failDocs: null, warnBytes: null, failBytes: null, level: 'warn', relief: 'the weekly roll-up' }, { collection: 'state', docs: 1, bytes: null, warnDocs: null, failDocs: null, warnBytes: 196608, failBytes: 245760, level: 'ok', relief: 'factHashes split per collection' }, { collection: 'materials', docs: 60, bytes: 1572864, warnDocs: null, failDocs: null, warnBytes: 4194304, failBytes: null, level: 'ok', relief: 'the lazy library load' }] }, restoreDrill: null } };
// A background job that finished an hour ago: the page wrote jobs/<id>, the worker wrote jobresults/<id>.
// B-34 (D-090): the nightly lint in state/current, as evening-cloud writes it: one warning, notes by code.
if (seed.state && seed.state.current) seed.state.current.lint = { at: new Date(DAYTIME.getTime() - 18 * 3600e3).toISOString(), commit: 'c'.repeat(40), errors: 0, warnings: 1, notes: 2, notesByCode: { frozen: 1, 'not-rebuilt': 1 }, rebuilt: { same: 3, of: 4 }, top: [{ severity: 'warning', code: 'derived-stale', ref: 'days/2026-10-17', msg: 'built by build aaaaaaaaaaaa; differs from this build\'s rebuild until its next run' }] };
seed.jobs = { 'job-20261017-150000-cardiac-output': { ...env('page', 'E.V. Home', new Date(Date.now() - 7200e3).toISOString()), kind: 'study-guide', title: 'Study guide: cardiac output', brief: 'harness', fired: { at: hourAgo, ok: true } } };
seed.jobresults = { 'job-20261017-150000-cardiac-output': { ...env('worker', 'worker harness', hourAgo), release: 'v4.0.0', status: 'done', startedAt: hourAgo, finishedAt: hourAgo, result: { text: 'One page on preload, afterload and contractility, with three self-check questions.', links: [{ title: 'E.V. study guide: cardiac output', url: 'https://claude.ai/artifact/harness' }] } } };
// B-47 (D-104): a finished exam-retro job with its numbers, for the retro card check
seed.jobs['job-harness-retro'] = { schema: 1, writer: 'page', at: hourAgo, source: 'E.V. Home', kind: 'exam-retro', title: 'Retro: Harness Exam 3', brief: 'E3H: the retro after the score he entered', fired: { at: '2026-10-01T15:00:01Z', ok: true } };
seed.jobresults['job-harness-retro'] = { schema: 1, writer: 'worker', at: hourAgo, source: 'worker harness', release: 'v4.0.0', status: 'done', startedAt: '2026-10-01T15:02:00Z', finishedAt: '2026-10-01T15:05:00Z', message: null, error: null,
  result: { text: 'You scored 90, two points above my range. I underrated you.', links: [], retro: { examId: 'E3H', title: 'Harness Exam 3', date: '2026-09-30', score: 90, prediction: { predictedRange: [80, 88], basis: 'made up' }, calibration: { score: 90, predictedRange: [80, 88], inRange: false, error: 6 },
    practice: { answered: 10, right: 7, pct: 70, byObjective: [{ id: 'E3-2', text: '', right: 2, n: 4, pct: 50 }, { id: 'E3-1', text: '', right: 5, n: 6, pct: 83.3 }] }, weakSpots: { solid: 2, open: 1, openTopics: [{ topic: 'Made-up topic', objective: 'E3-2', recurrence: 1 }] }, plan: { tasks: 4, ticked: 3, left: [{ date: '2026-09-29', text: 'Practice sim', kind: 'sim' }] } } } };
const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8'));
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
// The page as the platform serves it: the shell inside its skeleton at the artifact's origin, its files beside it.
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const skeleton = b => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + b + '</body></html>';
// The page's clock starts at 2pm Central today and runs from there, so the greeting and its chips are the afternoon's
// whatever time the harness runs (v3's ran in the daytime by habit).
async function openPage(page, target = 'staging', pre = '') { // live tasks are created at cutover (B-24), so the main pass drives the staging build
  await page.clock.install({ time: DAYTIME });
  const dir = path.join(root, 'dist/page', target);
  await page.route(ORIGIN + '/**', r => { const name = new URL(r.request().url()).pathname.slice(1) || 'index.html'; if (name === 'index.html') return r.fulfill({ body: skeleton(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')), contentType: 'text/html' }); const f = path.join(dir, name); return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' }) : r.fulfill({ status: 404, body: '' }); });
  await page.addInitScript(pre + 'window.__db=' + JSON.stringify(seed) + ';' + stub);
  await page.goto(ORIGIN + '/');
}
const liveWorker = spec.tasks.live.worker.trigger, stagingWorker = spec.tasks.staging.worker.trigger;
const todayDoc = () => window.__db.talk && window.__db.talk[new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())];
async function send(page, text) { await page.fill('#ev-input', text); await page.click('#ev-send'); await page.waitForTimeout(250); }
const msgs = page => page.evaluate(() => { const d = window.__db.talk && window.__db.talk[new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())]; return d ? Object.entries(d.messages).sort(([a], [b]) => a.localeCompare(b)).map(([id, m]) => ({ id, ...m })) : []; });
const results = []; const ok = (name, cond, detail = '') => { results.push([cond ? 'PASS' : 'FAIL', name, detail]); };
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  // A · Aurora is dark only (D-077): the passes are phone width (all interactions) and desktop width (screens).
  for (const scheme of ['phone', 'desktop']) {
    const page = await browser.newPage({ viewport: scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 }, colorScheme: 'dark' });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' })); await servePdfjs(page);
    await openPage(page); await page.waitForTimeout(900);
    await page.screenshot({ path: `${shots}/ev-${scheme}.png`, fullPage: false });
    ok(`[${scheme}] opens on E.V.`, await page.isVisible('#p-ev') && !(await page.isVisible('#p-today')));
    ok(`[${scheme}] opening: large core above the greeting, top-bar core tucked away`, await page.evaluate(() => document.body.classList.contains('opening') && !!document.querySelector('#hero canvas') && document.querySelector('#hero').getBoundingClientRect().height > 150 && document.querySelector('#top-av').getBoundingClientRect().width < 4));
    ok(`[${scheme}] core is drawing`, await page.evaluate(() => { const sm = window.EVApp.core.sample(0); let lit = sm ? sm.lit : 0; return lit > 500; }));
    // B-38: the page follows system/manifest; a newer build asks for a reload, nothing reloads on its own
    ok(`[${scheme}] no update bar while the deployed build is this page's`, !(await page.isVisible('#ev-update')));
    await page.evaluate(async () => { const db = await window.claude.use('db'); const m = JSON.parse(JSON.stringify(window.__db.system.manifest)); m.commit = 'b'.repeat(40); m.pages.staging.files['page/staging/app.js'] = 'b'.repeat(64); await db.collection('system').doc('manifest').set(m); });
    await page.waitForTimeout(150);
    ok(`[${scheme}] a new deploy shows "E.V. updated: reload" with a Reload button`, await page.isVisible('#ev-update') && /E\.V\. updated: reload/.test(await page.textContent('#ev-update')) && (await page.locator('#ev-update button', { hasText: 'Reload' }).count()) === 1);
    await page.screenshot({ path: `${shots}/update-bar-${scheme}.png`, fullPage: false });
    ok(`[${scheme}] the bar never covers the top bar's buttons or sideways-scrolls`, await page.evaluate(() => { const b = document.getElementById('ev-update').getBoundingClientRect(), t = document.getElementById('tab-system').getBoundingClientRect(); return (b.top >= t.bottom || b.bottom <= t.top) && document.documentElement.scrollWidth <= innerWidth + 1; }));
    await page.evaluate(async () => { const db = await window.claude.use('db'); const m = JSON.parse(JSON.stringify(window.__db.system.manifest)); m.pages.staging.files['page/staging/app.js'] = 'a'.repeat(64); await db.collection('system').doc('manifest').set(m); });
    await page.waitForTimeout(100);
    ok(`[${scheme}] back on this page's build, the bar goes away`, !(await page.isVisible('#ev-update')));
    ok(`[${scheme}] dock has five tabs, System sits in the top bar`, (await page.locator('.dock .tab').count()) === 5 && await page.isVisible('#tab-system'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`[${scheme}] no sideways scroll`, !overflow);
    ok(`[${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    // ---- E.V.: greeting, quick asks, chat with tools, jobs, guard, check-in (light pass does the interactions)
    const greet = (await page.locator('#thread .msg.ev').last().textContent()) || '';
    ok(`[${scheme}] greeting rendered`, /Morning, Matt|Afternoon check-in|Evening, Matt|Still up/.test(greet), greet.slice(0, 140));
    ok(`[${scheme}] greeting reports the finished job`, /Finished in the background: Study guide: cardiac output/.test(greet));
    ok(`[${scheme}] finished job card links out`, (await page.locator('#thread .ev-card a[href="https://claude.ai/artifact/harness"]').count()) === 1);
    ok(`[${scheme}] quick chips`, (await page.locator('#qchips .qchip').count()) >= 3, String(await page.locator('#qchips .qchip').count()));
    await page.click('#tab-today'); await page.waitForTimeout(100);
    ok(`[${scheme}] switching tabs plays the arrival`, await page.evaluate(() => document.getElementById('p-today').classList.contains('enter') && getComputedStyle(document.querySelector('#p-today > .card')).animationName === 'rise'));
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${shots}/today-${scheme}.png`, fullPage: true });
    await page.click('#tab-ev'); await page.waitForTimeout(100);
    if (scheme === 'desktop') {
      await page.locator('#qchips .qchip', { hasText: 'What’s due this week?' }).click(); await page.waitForTimeout(900);
      await page.screenshot({ path: `${shots}/ev-desktop-conversation.png`, fullPage: false });
      // B-53 (D-109) at desktop width: the kind on every idea, the weak-spot action only on a learning idea
      await page.click('#tab-record'); await page.waitForTimeout(150);
      { const row = t => page.locator('#ideas .row', { hasText: t }); const act = t => row(t).locator('button', { hasText: 'Make it a weak spot' }).count();
        ok('[desktop] idea kinds shown; only the learning idea offers Make it a weak spot', /Feature/.test(await row('Harness feature idea').textContent()) && /General/.test(await row('Harness general idea').textContent()) && (await act('Harness feature idea')) === 0 && (await act('Harness general idea')) === 0 && (await act('Harness learning idea')) === 1);
        await page.locator('#ideas').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/ideas-desktop.png`, fullPage: false }); }
      await page.click('#tab-ev'); await page.waitForTimeout(150);
      // B-47: the retro card at desktop width
      await page.evaluate(() => { window.__chatPre = ''; window.__chatScript = [{ tool: 'show_card', input: { type: 'job', id: 'job-harness-retro' } }]; window.__chatReply = 'Here’s your Exam 3 retro.'; });
      await send(page, 'Show me my Exam 3 retro'); await page.waitForTimeout(300);
      ok('[desktop] the retro card shows its numbers', /you scored 90 \(2 above the range\)/.test(await page.locator('#thread .msg.ev').last().textContent()));
      await page.locator('#thread .msg.ev').last().screenshot({ path: `${shots}/retro-card-desktop.png` });
      await page.close(); continue;
    }
    await page.waitForTimeout(1500);
    ok('open marks lastSeenAt in talk/memory', await page.evaluate(() => !!(window.__db.talk && window.__db.talk.memory && window.__db.talk.memory.lastSeenAt)));
    await page.locator('#qchips .qchip', { hasText: 'What’s due this week?' }).click(); await page.waitForTimeout(250);
    let m = await msgs(page);
    ok('quick ask posts Matt + E.V. to talk/<today>', m.length === 2 && m[0].role === 'matt' && m[1].role === 'ev' && m[1].cards[0].type === 'dates', JSON.stringify(m.map(x => [x.role, x.text.slice(0, 30)])));
    ok('dates card shown', /Next 7 days/.test(await page.locator('#thread .msg.ev').last().textContent()));
    // Captions (B-77): after his first message she stays on her stage at 80%; no core moves to the top bar or a message.
    ok('after his first message her core stays on her stage, at the conversation step', await page.evaluate(() => document.getElementById('hero').dataset.step === 'conversation' && document.querySelector('#top-av').getBoundingClientRect().width < 1));
    ok('one live core, her stage: none on the messages', (await page.locator('#thread .ev-av canvas').count()) === 0 && (await page.locator('#hero canvas').count()) === 1);
    // Chat that starts a background job through the page tools and the Claude Code Remote connector
    await page.evaluate(() => { window.__chatScript = [{ tool: 'start_job', input: { kind: 'study-guide', title: 'Study guide: fluid balance', brief: 'Matt asked for a study guide on fluid balance for Exam 4.' } }]; window.__chatReply = 'On it. Study guide queued.'; });
    await send(page, 'Make me a study guide on fluid balance'); await page.waitForTimeout(300);
    const call = await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
    ok('chat sends context first and the message last', call.input[0].role === 'user' && /HIS RECORD/.test(call.input[0].content) && call.input[call.input.length - 1].content === 'Make me a study guide on fluid balance', call.input.length + ' turns');
    ok('chat offers the page tools on the quick tier', call.tier === 'quick' && call.tools.includes('start_job') && call.tools.includes('show_card'), call.tier + ' ' + call.tools.join(','));
    const jobs = await page.evaluate(() => Object.entries(window.__db.jobs).filter(([, j]) => j.title === 'Study guide: fluid balance').map(([id, j]) => ({ id, ...j })));
    ok('job doc created with its envelope and fired', jobs.length === 1 && jobs[0].writer === 'page' && jobs[0].at && jobs[0].fired && jobs[0].fired.ok === true, JSON.stringify(jobs[0] && jobs[0].fired));
    const mc = await page.evaluate(() => window.__mcpCalls.find(c => c[1] === 'fire_trigger'));
    ok('fire_trigger called on the live worker with the job id', mc && mc[0] === 'Claude Code Remote' && mc[1] === 'fire_trigger' && mc[2].trigger_id === stagingWorker && mc[2].text === 'Job ' + (jobs[0] || {}).id, JSON.stringify(mc));
    m = await msgs(page); const last = m[m.length - 1];
    ok('reply saved with its job card', last.role === 'ev' && last.text === 'On it. Study guide queued.' && last.cards.some(c => c.type === 'job') && last.jobId === (jobs[0] || {}).id && last.replyTo === m[m.length - 2].id, JSON.stringify(last).slice(0, 200));
    ok('job card shows queued', /queued/.test(await page.locator('#thread .msg.ev').last().textContent()));
    ok('Go deeper offered on the quick reply', (await page.locator('#thread .msg.ev').last().locator('button', { hasText: 'Go deeper' }).count()) === 1);
    ok('chat context carries the greeting as record data and the reply-once rule', /Today’s greeting, built by E.V. core from this record/.test(call.input[0].content) && /write your reply once, after the last tool result/.test(call.input[0].content));
    // A reply written in two rounds around a tool call shows once (only the text after the tool)
    await page.evaluate(() => { window.__chatPre = 'I can’t resize myself, but I can attach your list.'; window.__chatScript = [{ tool: 'show_card', input: { type: 'today', filter: 'open' } }]; window.__chatReply = 'Here’s what’s still open today.'; });
    await send(page, 'Show me what is left today'); await page.waitForTimeout(300);
    const two = (await msgs(page)).slice(-1)[0];
    ok('two-round reply saved once, without the first-round narration', two.text === 'Here’s what’s still open today.' && two.cards.some(c => c.type === 'today'), JSON.stringify(two.text));
    ok('two-round reply shown once', !/resize/.test(await page.locator('#thread .msg.ev').last().textContent()));
    await page.evaluate(() => { window.__chatPre = ''; });
    // Ticking an item in a conversation card: the thread is patched in place (no replayed animations, no jump)
    {
      const tc = page.locator('#thread .msg.ev').last();
      await tc.locator('input.tick:not(:checked)').first().evaluate(n => n.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
      const t0 = await page.evaluate(() => { window.__anims = []; document.addEventListener('animationstart', e => window.__anims.push(String(e.target.className)), true); window.__msgNode = document.querySelector('#thread .msg.ev:last-of-type'); window.__firstMsg = document.querySelector('#thread .msg'); return scrollY + document.getElementById('thread').scrollTop; });
      const bb = await tc.locator('input.tick:not(:checked)').first().boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(700);
      const t1 = await page.evaluate(() => ({ y: scrollY + document.getElementById('thread').scrollTop, msgAnims: window.__anims.filter(c => /\bmsg\b/.test(c)).length, kept: window.__firstMsg.isConnected }));
      ok('ticking in a conversation card keeps the page still: no replayed messages, no scroll', t1.msgAnims === 0 && Math.abs(t1.y - t0) < 2 && t1.kept, JSON.stringify({ t0, ...t1 }));
      ok('the ticked item stays in the open card, shown done', (await tc.locator('.row.done input.tick:checked').count()) >= 1);
      ok('the tick was saved', await page.evaluate(() => Object.keys((window.__db.dayedits && window.__db.dayedits[new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())] || {}).checks || {}).length > 0 || Object.values(window.__db.planedits || {}).some(p => p.ticks && Object.keys(p.ticks).length)));
    }
    // B-47 (D-104): a finished retro's card shows the numbers the narrative was written over
    await page.evaluate(() => { window.__chatPre = ''; window.__chatScript = [{ tool: 'show_card', input: { type: 'job', id: 'job-harness-retro' } }]; window.__chatReply = 'Here’s your Exam 3 retro.'; });
    await send(page, 'Show me my Exam 3 retro'); await page.waitForTimeout(300);
    { const t = await page.locator('#thread .msg.ev').last().textContent();
      ok('the retro card shows prediction against score, practice, weak spots and plan', /Exam retro/.test(t) && /80–88 · you scored 90 \(2 above the range\)/.test(t) && /7 of 10 right \(70%\) · weakest E3-2 at 50%/.test(t) && /2 made solid · 1 still open/.test(t) && /3 of 4 tasks done/.test(t) && /I underrated you/.test(t), t.slice(0, 300));
      await page.locator('#thread .msg.ev').last().screenshot({ path: `${shots}/retro-card.png` }); }
    // Captions (B-77): the brand, like tapping her, returns to now from wherever he has scrolled
    await page.evaluate(() => { const t = document.getElementById('thread'); t.scrollTop = 0; t.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(150);
    await page.click('#brand'); await page.waitForTimeout(900);
    ok('tapping the brand returns to now', await page.evaluate(() => { const t = document.getElementById('thread'); return t.scrollHeight - t.clientHeight - t.scrollTop < 4 && document.getElementById('ev-now').hidden; }));
    // Logging a weak spot from the conversation
    await page.evaluate(() => { window.__chatScript = [{ tool: 'add_weakspot', input: { topic: 'Isotonic vs hypotonic IV fluids', objective: 'E4-3' } }, { tool: 'show_card', input: { type: 'weakspots' } }]; window.__chatReply = 'Logged.'; });
    await send(page, 'I keep mixing up isotonic and hypotonic fluids, log that'); await page.waitForTimeout(250);
    const ws2 = await page.evaluate(() => Object.values(window.__db.weakspots).filter(w => w.topic === 'Isotonic vs hypotonic IV fluids'));
    ok('add_weakspot tool writes a weak spot as a Fact, nothing derived stored', ws2.length === 1 && ws2[0].source === 'Told E.V.' && ws2[0].objective === 'E4-3' && ws2[0].writer === 'page' && !ws2[0].derived, JSON.stringify(ws2[0] && { o: ws2[0].objective, s: ws2[0].source }));
    // Identifier guard: first send is held, nothing is written
    const before2 = (await msgs(page)).length;
    await page.fill('#ev-input', 'The resident in room 12 was confused'); await page.click('#ev-send'); await page.waitForTimeout(150);
    ok('identifier guard holds the message', !(await page.isHidden('#ev-guard')) && (await msgs(page)).length === before2 && /room number/.test(await page.textContent('#ev-guard')), await page.textContent('#ev-guard'));
    await page.fill('#ev-input', '');
    // Check-in: local quick ask, energy picker writes days/<today>.checkin and posts advice
    await page.evaluate(() => { window.__chatScript = []; });
    await send(page, 'I’m wiped'); await page.waitForTimeout(150);
    await page.locator('#thread .msg.ev').last().locator('.energy button').nth(1).click(); await page.waitForTimeout(300);
    const ci = await page.evaluate(() => { const d = (window.__db.dayedits || {})[new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())]; return d && d.checkin; });
    ok('check-in saved to the day’s edits', ci && ci.energy === 2, JSON.stringify(ci));
    ok('low energy gets a lighter plan', /Minimum viable day/.test((await msgs(page)).slice(-1)[0].text));
    // B-41: the weak spots to Quizlet quick ask answers locally with a card that copies the cards
    await send(page, 'Weak spots to Quizlet'); await page.waitForTimeout(250);
    { const last = page.locator('#thread .msg.ev').last(); const t = await last.textContent();
      ok('quick ask: weak spots to Quizlet posts a card with the copy button', /open weak spots? as Quizlet cards/.test(t) && /Weak spots for Quizlet/.test(t) && (await last.locator('button', { hasText: 'for Quizlet' }).count()) === 1, t.slice(0, 160));
      await last.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/quizlet-card-${scheme}.png`, fullPage: false }); }
    // Connector failure: job is created but not started; Try again re-fires on a click
    await page.evaluate(() => { window.__mcpFail = 'server_not_connected'; window.__chatScript = [{ tool: 'start_job', input: { kind: 'practice-set', title: 'Practice: acid-base', brief: '20 questions on acid-base' } }]; window.__chatReply = 'Queued.'; });
    await send(page, 'Write me 20 acid-base questions'); await page.waitForTimeout(300);
    let jb = await page.evaluate(() => Object.values(window.__db.jobs).find(j => j.title === 'Practice: acid-base'));
    ok('connector error recorded on the job', jb && jb.fired && jb.fired.ok === false && jb.fired.error === 'server_not_connected', JSON.stringify(jb && jb.fired));
    const jc = page.locator('#thread .msg.ev').last();
    ok('job card says how to fix it', /Settings → Connectors/.test(await jc.textContent()) && (await jc.locator('button', { hasText: 'Try again' }).count()) === 1);
    await page.evaluate(() => { window.__mcpFail = null; }); await jc.locator('button', { hasText: 'Try again' }).click(); await page.waitForTimeout(300);
    jb = await page.evaluate(() => Object.values(window.__db.jobs).find(j => j.title === 'Practice: acid-base'));
    ok('Try again re-fires the job with a clean attempt', jb.fired.ok === true && !jb.fired.error, JSON.stringify(jb.fired));
    // Claude errors are branched by code
    await page.evaluate(() => { window.__chatFail = 'rate_limited'; });
    await send(page, 'Quick question about potassium'); await page.waitForTimeout(250);
    const rl = (await msgs(page)).slice(-1)[0];
    ok('rate limit explained, kept in the thread', /usage limit/.test(rl.text) && rl.error === 'rate_limited', rl.text);
    await page.evaluate(() => { window.__chatFail = null; window.__chatScript = []; });
    ok('explain questions go to the default tier', await page.evaluate(async () => { window.__chatReply = 'Because…'; return true; }));
    await send(page, 'Explain why hypokalemia causes muscle weakness'); await page.waitForTimeout(250);
    ok('tier picks default for explanations', (await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)).tier)) === 'default');
    await page.screenshot({ path: `${shots}/ev-conversation.png`, fullPage: true });
    ok('no sideways scroll after the conversation', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
    ok('status is live', /^Live/.test(await page.textContent('#status')), await page.textContent('#status'));
    ok('now card has an action', (await page.textContent('#now')).length > 10, (await page.textContent('#now')).slice(0, 120));
    ok('today list rendered', (await page.locator('#today-list .row').count()) > 0, String(await page.locator('#today-list .row').count()));
    // ---- List edits (D-078): E.V. adds to the day's list and takes items off; Matt can add and remove on Today
    const dayDoc = () => page.evaluate(() => window.__db.dayedits && window.__db.dayedits[new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())]);
    const listLines = c => ((/Today’s list \(id \| done \| tag \| item\):\n([\s\S]*?)(\n[A-Z][^\n|]*:|\n---|$)/.exec(c) || [])[1] || '').split('\n').map(l => l.split(' | '));
    const budgetMin = async () => Number(((await page.textContent('#today-list .card-head')) || '').replace(/^\D*?(\d+) of.*$/s, '$1'));
    const min0 = await budgetMin();
    await page.evaluate(() => { window.__toolResults = []; window.__chatScript = [{ tool: 'edit_list', input: { action: 'add', text: 'Quizlets: Ch 7 & 8 lecture for BIO 201 Lecture Exam 3', kind: 'practice', minutes: 30, course: 'BIO 201' } }, { tool: 'edit_list', input: { action: 'add', text: 'Review the Chapter 8 lecture', kind: 'review', minutes: 25, course: 'BIO 201' } }, { tool: 'edit_list', input: { action: 'add', text: 'Write the care plan', date: '2020-01-01' } }]; window.__chatReply = 'Both are on today’s list.'; });
    await send(page, 'Add Quizlets for chapter 7 and 8 and a Chapter 8 lecture review to today'); await page.waitForTimeout(300);
    let dd = await dayDoc(); let addedNow = Object.values((dd && dd.added) || {}).filter(Boolean);
    const lcall = await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
    ok('chat offers edit_list and says when to use it', lcall.tools.includes('edit_list') && /His daily list is yours to keep/.test(lcall.input[0].content) && /His calendar is yours to keep too/.test(lcall.input[0].content) && !lcall.tools.includes('add_date'), lcall.tools.join(',') + ' | ' + JSON.stringify(await page.evaluate(() => window.__toolResults)).slice(0, 400));
    ok('edit_list adds both to today, by E.V., with kind, minutes and course', addedNow.length === 2 && addedNow.every(a => a.by === 'E.V.' && a.course === 'BIO 201') && addedNow[0].tag === 'PRACTICE' && addedNow[1].minutes === 25, JSON.stringify(addedNow));
    ok('edit_list refuses a day in the past', /date must be today/.test((await page.evaluate(() => window.__toolResults)).slice(-1)[0]));
    ok('nothing added to the calendar', !(await page.evaluate(seeded => Object.entries(window.__db.dates || {}).some(([id, d]) => !seeded.includes(id) && /Quizlets: Ch 7/.test(d.title)), Object.keys(seed.dates || {}))));
    const lc = page.locator('#thread .msg.ev').last();
    ok('the reply carries today’s list with the new items', /Quizlets: Ch 7 & 8 lecture/.test(await lc.textContent()) && /added by E\.V\./.test(await lc.textContent()));
    await page.click('#tab-today'); await page.waitForTimeout(150);
    ok('Today lists the added items with Remove, and counts their minutes', (await page.locator('#today-list .row', { hasText: 'Review the Chapter 8 lecture' }).locator('button', { hasText: 'Remove' }).count()) === 1 && (Number.isNaN(min0) ? /~25 min · added by E\.V\./.test(await page.textContent('#today-list')) : (await budgetMin()) === min0 + 55), `${min0} -> ${await budgetMin()}`);
    // Matt adds one himself, then removes it
    await page.fill('#today-add', 'Flashcards for the bones lab'); await page.press('#today-add', 'Enter'); await page.waitForTimeout(200);
    dd = await dayDoc(); const mine = Object.entries(dd.added || {}).find(([, a]) => a && a.text === 'Flashcards for the bones lab');
    ok('the add row writes his item and clears', mine && mine[1].by === 'Matt' && (await page.inputValue('#today-add')) === '' && (await page.locator('#today-list .row', { hasText: 'Flashcards for the bones lab' }).count()) === 1);
    await page.fill('#today-add', 'half typed'); await page.focus('#today-add'); const rr = await page.evaluate(async () => { const n = document.querySelectorAll('#today-list .row').length; const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()); await (await window.claude.use('db')).collection('dayedits').doc(t).update({ updatedAt: new Date().toISOString() }); return n; }); await page.waitForTimeout(150);
    ok('a refresh keeps what he is typing', rr > 0 && (await page.inputValue('#today-add')) === 'half typed' && await page.evaluate(() => document.activeElement && document.activeElement.id === 'today-add')); await page.fill('#today-add', '');
    await page.locator('#today-list .row', { hasText: 'Flashcards for the bones lab' }).locator('button', { hasText: 'Remove' }).click(); await page.waitForTimeout(200);
    dd = await dayDoc();
    ok('top bar stays one line while jobs run', await page.evaluate(() => { const b = document.getElementById('brand').getBoundingClientRect(), y = document.getElementById('tab-system').getBoundingClientRect(); return Math.abs((b.top + b.bottom) / 2 - (y.top + y.bottom) / 2) < 6; }), await page.textContent('#readout'));
    ok('the add row is one line: field and Add', await page.evaluate(() => { const i = document.getElementById('today-add').getBoundingClientRect(), b = document.querySelector('.add-row button').getBoundingClientRect(); return Math.abs(i.top - b.top) < 8 && b.left > i.right; }));
    ok('Remove takes his item off', !(mine[0] in dd.added) && (await page.locator('#today-list .row', { hasText: 'Flashcards for the bones lab' }).count()) === 0);
    await page.evaluate(() => document.querySelector('#today-add').scrollIntoView({ block: 'center' })); await page.waitForTimeout(2800); await page.screenshot({ path: `${shots}/today-edited.png`, fullPage: false });
    await page.click('#tab-ev'); await page.waitForTimeout(100);
    // E.V. takes a planned item off for the day and brings it back; fixed items stay
    const lines = listLines(lcall.input[0].content);
    const plannedLine = lines.find(l => l[0] && !/^add-/.test(l[0]) && !['GRADED', 'EXAM', 'CLINICAL', 'VALIDATION'].includes(l[2]));
    await page.evaluate(id => { window.__toolResults = []; window.__chatScript = [{ tool: 'edit_list', input: { action: 'remove', id } }]; window.__chatReply = 'Taken off today.'; }, plannedLine && plannedLine[0]);
    await send(page, 'Take that off today'); await page.waitForTimeout(300);
    dd = await dayDoc();
    ok('remove on a planned item skips it for the day', plannedLine && dd.skipped && dd.skipped[plannedLine[0]] && dd.skipped[plannedLine[0]].by === 'E.V.', JSON.stringify(plannedLine) + ' ' + JSON.stringify(dd.skipped));
    const ctx2 = await page.evaluate(() => { window.__chatScript = []; window.__chatReply = 'Ok.'; return true; });
    await send(page, 'What is still on my list?'); await page.waitForTimeout(250);
    const c3 = (await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)))).input[0].content;
    ok('the chat sees what was taken off and who added what', ctx2 && /Taken off today’s list: /.test(c3) && /\[added by you\]/.test(c3) && !listLines(c3).some(l => l[0] === plannedLine[0]));
    await page.evaluate(id => { window.__toolResults = []; window.__chatScript = [{ tool: 'edit_list', input: { action: 'restore', id } }]; window.__chatReply = 'Back on.'; }, plannedLine[0]);
    await send(page, 'Actually put it back'); await page.waitForTimeout(300);
    ok('restore brings it back', !(await dayDoc()).skipped[plannedLine[0]]);
    const fixedId = (lines.find(l => ['GRADED', 'EXAM', 'CLINICAL', 'VALIDATION'].includes(l[2])) || [])[0] || null; // graded work, exams, clinicals and validations stay
    if (fixedId) {
      await page.evaluate(id => { window.__toolResults = []; window.__chatScript = [{ tool: 'edit_list', input: { action: 'remove', id } }]; window.__chatReply = 'That one stays.'; }, fixedId);
      await send(page, 'Take the graded one off'); await page.waitForTimeout(300);
      ok('graded work stays on the list', /stays on the list/.test((await page.evaluate(() => window.__toolResults)).slice(-1)[0]) && !((await dayDoc()).skipped || {})[fixedId]);
    }
    // A later day: the doc is created with only the added item; the morning run keeps it
    const tmr = await page.evaluate(() => { const d = new Date(Date.now() + 86400e3); return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d); });
    await page.evaluate(date => { window.__chatScript = [{ tool: 'edit_list', input: { action: 'add', text: 'Skim Ch 9 before lab', kind: 'reading', date } }]; window.__chatReply = 'On tomorrow’s list.'; }, tmr);
    await send(page, 'Put skimming chapter 9 on tomorrow'); await page.waitForTimeout(300);
    const td = await page.evaluate(d => window.__db.dayedits[d], tmr);
    ok('tomorrow gets its own dayedits doc with the item; the morning run keeps it', td && td.date === tmr && td.schema === 1 && td.writer === 'page' && Object.values(td.added).some(a => a && a.text === 'Skim Ch 9 before lab' && a.tag === 'READING'), JSON.stringify(td));
    // ---- Calendar edits (D-080): E.V. adds, changes and takes entries off; Canvas graded work stays; Record has Remove and Bring back
    const labDate = inDays(4); const labId = labDate + '-bio-lab-practical'; const cal = () => page.evaluate(() => { const out = {}; const ed = window.__db.dateedits || {}; for (const [id, d] of Object.entries(window.__db.dates || {})) { const e = ed[id]; out[id] = { ...d, ...(e && e.overrides || {}), ...(e && e.notes != null ? { notes: e.notes } : {}), removed: e ? e.removed || null : undefined, edited: !!e }; } return out; });
    await page.evaluate(([labDate, labId]) => { window.__toolResults = []; window.__chatScript = [{ tool: 'edit_dates', input: { action: 'add', date: labDate, title: 'BIO lab practical', kind: 'exam', course: 'BIO 201' } }, { tool: 'edit_dates', input: { action: 'change', id: labId, notes: 'Bring the bones kit' } }, { tool: 'edit_dates', input: { action: 'remove', id: 'canvas-h-graded' } }, { tool: 'edit_dates', input: { action: 'remove', id: 'canvas-h-hall' } }]; window.__chatReply = 'Calendar updated.'; }, [labDate, labId]);
    await send(page, 'Put the BIO lab practical on my calendar, bones kit noted, and take the study hall off'); await page.waitForTimeout(350);
    const dcall = await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input))); let dr = await page.evaluate(() => window.__toolResults.slice(-4)); let cd = await cal();
    ok('chat offers edit_dates with calendar ids in the context', dcall.tools.includes('edit_dates') && /Calendar, next 7 days \(id: date title\): /.test(dcall.input[0].content) && /canvas-h-hall: \d{4}-\d{2}-\d{2} Harness study hall \(other, Canvas\)/.test(dcall.input[0].content), (dcall.input[0].content.match(/Calendar, next 7 days[^\n]*/) || [''])[0].slice(0, 200));
    ok('edit_dates adds and changes his entry, by E.V.', cd[labId] && cd[labId].addedBy === 'E.V.' && cd[labId].course === 'BIO 201' && cd[labId].kind === 'exam' && cd[labId].notes === 'Bring the bones kit' && cd[labId].edited && /^added to the calendar/.test(dr[0]) && /\(notes\)$/.test(dr[1]), JSON.stringify(cd[labId]) + ' ' + JSON.stringify(dr.slice(0, 2)));
    ok('graded work from Canvas stays; an optional Canvas event comes off', /stays on the calendar/.test(dr[2]) && !cd['canvas-h-graded'].removed && cd['canvas-h-hall'].removed && cd['canvas-h-hall'].removed.by === 'E.V.' && /^taken off the calendar: canvas-h-hall/.test(dr[3]), JSON.stringify(dr.slice(2)));
    await page.evaluate(() => { window.__toolResults = []; window.__chatScript = [{ tool: 'lookup', input: { what: 'dates', query: 'harness' } }]; window.__chatReply = 'Here is what I see.'; }); await send(page, 'What is on my calendar?'); await page.waitForTimeout(300);
    const c4 = (await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)))).input[0].content; const lk = (await page.evaluate(() => window.__toolResults.slice(-1)))[0] || '';
    ok('the chat sees what came off the calendar, and only live entries in the week', /Taken off the calendar: canvas-h-hall: /.test(c4) && !/canvas-h-hall: [^;\n]*\(other, Canvas\)/.test((c4.match(/Calendar, next 7 days[^\n]*/) || [''])[0]));
    ok('lookup dates returns ids and marks what is off', /"id":"canvas-h-graded"/.test(lk) && /"id":"canvas-h-hall"[^}]*"off":true/.test(lk), lk.slice(0, 200));
    await page.click('#tab-today'); await page.waitForTimeout(150);
    ok('Today’s week leaves out what came off and shows the new entry', !/Harness study hall/.test(await page.textContent('#ahead')) && /BIO lab practical/.test(await page.textContent('#ahead')));
    await page.click('#tab-record'); await page.waitForTimeout(100); await page.locator('#seg-record [data-v="dates"]').click(); await page.waitForTimeout(150);
    const offRow = page.locator('#dates-off .row', { hasText: 'Harness study hall' });
    ok('Record → Dates lists what came off with Bring back; graded Canvas work has no Remove', (await offRow.locator('button', { hasText: 'Bring back' }).count()) === 1 && /taken off by E\.V\./.test(await offRow.textContent()) && (await page.locator('#dates .row', { hasText: 'Harness graded quiz' }).locator('button').count()) === 0 && (await page.locator('#dates .row', { hasText: 'BIO lab practical' }).locator('button', { hasText: 'Remove' }).count()) === 1);
    await page.screenshot({ path: `${shots}/record-dates.png`, fullPage: true });
    await offRow.locator('button', { hasText: 'Bring back' }).click(); await page.waitForTimeout(200);
    await page.locator('#dates .row', { hasText: 'BIO lab practical' }).locator('button', { hasText: 'Remove' }).click(); await page.waitForTimeout(200); cd = await cal();
    ok('Bring back and Remove write through E.V. core, by Matt', cd['canvas-h-hall'].removed === null && (await page.locator('#dates .row', { hasText: 'Harness study hall' }).count()) === 1 && cd[labId].removed && cd[labId].removed.by === 'Matt' && (await page.locator('#dates-off .row', { hasText: 'BIO lab practical' }).count()) === 1, JSON.stringify([cd['canvas-h-hall'].removed, cd[labId].removed]));
    await page.fill('#d-date', labDate); await page.fill('#d-title', 'BIO lab practical'); await page.click('#date-add button[type="submit"]'); await page.waitForTimeout(200); cd = await cal();
    ok('adding it again from the form brings it back instead of a copy', cd[labId].removed === null && Object.keys(cd).filter(k => k.startsWith(labId)).length === 1);
    await page.click('#tab-ev'); await page.waitForTimeout(100);
    // ---- Library (D-079): E.V. searches and reads his materials; attachments are read on the page and saved
    await page.evaluate(() => { window.__toolResults = []; window.__gets = 0; window.__chatScript = [{ tool: 'materials', input: { action: 'search', query: 'head to toe assessment', course: 'NUR 112' } }, { tool: 'materials', input: { action: 'read', id: 'NUR112-harness-skills', page: 12 } }, { tool: 'materials', input: { action: 'list', kind: 'lab' } }]; window.__chatReply = 'From your Skills Packet, p. 12: start with hand hygiene.'; });
    await send(page, 'Let us run the head to toe validation'); await page.waitForTimeout(300);
    const lr = await page.evaluate(() => window.__toolResults.slice(-3));
    const lcall2 = await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
    ok('chat offers the materials tool and the cite-your-source rule', lcall2.tools.includes('materials') && /search them first and name the file and page/.test(lcall2.input[0].content));
    ok('materials search cites the file and page', /"cite":"Harness Skills Packet, p\. 12"/.test(lr[0]), String(lr[0]).slice(0, 200));
    ok('materials read starts at the asked page', (() => { try { const r = JSON.parse(lr[1]); return r.text.startsWith('[p12] HEAD TO TOE') && /\[p13\] HEAD TO TOE DOCUMENTATION/.test(r.text) && r.more === false; } catch (e) { return false; } })(), String(lr[1]).slice(0, 160));
    ok('materials list shows the lab files', /NUR112-harness-skills \| NUR 112 \| lab \| Harness Skills Packet\.pdf/.test(lr[2]));
    ok('the library loads once per open', await page.evaluate(() => window.__gets === 1), String(await page.evaluate(() => window.__gets)));
    const mats = () => page.evaluate(() => Object.entries(window.__db.materials || {}).filter(([id]) => /^up-/.test(id)).map(([id, m]) => ({ id, ...m })));
    // A Word file
    await page.setInputFiles('#ev-file', path.join(root, 'test/data/sample.docx')); await page.waitForTimeout(800);
    let up = await mats(); let lastE = (await msgs(page)).slice(-1)[0];
    ok('a Word attachment is read and saved to the library', up.length === 1 && /^up-\d{4}-\d{2}-\d{2}-sample$/.test(up[0].id) && /^Head-to-Toe Assessment Checklist\nPerform hand hygiene/.test(up[0].text) && up[0].addedBy === 'Matt' && up[0].course === 'NUR 112', JSON.stringify(up.map(u => [u.id, u.text.slice(0, 40)])));
    ok('the reply names it and carries its card', /Saved \*\*sample\.docx\*\* to your library/.test(lastE.text) && lastE.cards[0].type === 'material' && (await page.locator('#thread .msg.ev').last().locator('button', { hasText: 'Remove from library' }).count()) === 1, lastE.text);
    ok('his message shows the attachment', /Attached \*\*sample\.docx\*\*/.test((await msgs(page)).slice(-2)[0].text));
    await page.evaluate(() => { window.__chatScript = []; window.__chatReply = 'Ok.'; }); await send(page, 'quiz me on it'); await page.waitForTimeout(250);
    ok('the chat knows what he just attached', /Files he just attached \(in the materials tool\): up-\d{4}-\d{2}-\d{2}-sample "sample\.docx"/.test((await page.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)))).input[0].content));
    // A photo: read by Claude through sample images
    await page.evaluate(() => { window.__sampleFn = p => /Transcribe all the text/.test(p) ? { pages: [{ page: 1, text: 'Erikson: trust vs. mistrust in infancy' }] } : { items: [] }; });
    await page.setInputFiles('#ev-file', { name: 'erikson-photo.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(root, 'test/data/sample.png')) }); await page.waitForTimeout(800);
    up = await mats(); const ph = up.find(u => /erikson-photo/.test(u.id));
    const ocrCall = await page.evaluate(() => (window.__jsonCalls || []).slice(-1)[0]);
    ok('a photo is read by Claude and saved with its source marked', ph && ph.text === '[p1] Erikson: trust vs. mistrust in infancy' && ph.ocr && ph.ocr.pages[0] === 1 && ocrCall.images === 1 && ocrCall.tier === 'default', JSON.stringify(ph && { t: ph.text, o: ph.ocr }));
    // A text file with a real-looking record number is refused, nothing saved
    const before4 = (await mats()).length;
    await page.setInputFiles('#ev-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Client notes. MRN: 4482913. Ambulated twice.') }); await page.waitForTimeout(500);
    ok('an attachment with a record number is refused', (await mats()).length === before4 && /has a medical record number, so I didn't save it/.test((await msgs(page)).slice(-1)[0].text), (await msgs(page)).slice(-1)[0].text);
    // A PDF: text pages with pdf.js, the image-only page read by Claude
    if (hasPdfjs) {
      await page.evaluate(() => { window.__sampleFn = p => /Transcribe all the text/.test(p) ? { pages: [{ page: 2, text: 'Scanned page: Erikson stages. Trust vs. mistrust (infancy)' }] } : { items: [] }; });
      await page.setInputFiles('#ev-file', path.join(root, 'test/data/sample.pdf')); await page.waitForTimeout(3000);
      const pdf = (await mats()).find(u => /-sample-2$|-sample$/.test(u.id) && u.fileType === 'pdf');
      ok('a PDF is read: text pages directly, the picture page by Claude', pdf && /^\[p1\] Head-to-Toe Assessment Checklist Perform hand hygiene/.test(pdf.text) && /\[p2\] Scanned page: Erikson stages/.test(pdf.text) && pdf.pages === 2 && pdf.ocr.pages.join() === '2', JSON.stringify(pdf && { id: pdf.id, t: pdf.text.slice(0, 160), o: pdf.ocr }) + ' | ' + (await msgs(page)).slice(-1)[0].text);
    } else console.log('NOTE PDF attachment checks skipped: npm install --no-save pdfjs-dist@4.4.168');
    // Remove from library
    await page.locator('#thread .msg.ev', { hasText: 'Saved **sample.docx**'.replace(/\*/g, '') }).first().locator('button', { hasText: 'Remove from library' }).click(); await page.waitForTimeout(250);
    const rm = await page.evaluate(() => { const id = Object.keys(window.__db.materials).find(id => /-sample$/.test(id) && window.__db.materials[id].fileType === 'docx'); return id ? [id, window.__db.materials[id], (window.__db.materialedits || {})[id]] : null; });
    ok('Remove from library marks it in materialedits and keeps the material', rm && rm[2] && rm[2].removed && rm[2].removed.by === 'Matt' && rm[1].text.length > 0, JSON.stringify(rm && rm[2]));
    // Record > Library lists the files
    await page.click('#tab-record'); await page.click('#seg-record [data-v="library"]'); await page.waitForTimeout(250);
    ok('Record lists the library by course with uploads removable', (await page.locator('#library .row').count()) >= 4 && /Harness Skills Packet/.test(await page.textContent('#library')) && (await page.locator('#library .row', { hasText: 'erikson-photo' }).locator('button', { hasText: 'Remove' }).count()) === 1, String(await page.locator('#library .row').count()));
    await page.waitForTimeout(900); await page.screenshot({ path: `${shots}/library.png`, fullPage: false });
    await page.click('#seg-record [data-v="sessions"]'); await page.click('#tab-ev'); await page.waitForTimeout(100);
    await page.evaluate(() => { window.__sampleFn = null; });
    // Study > Review: the migrated set, all answered
    await page.click('#tab-study'); await page.click('#seg-study [data-v="review"]'); await page.waitForTimeout(100);
    const rv = await page.textContent('#rv-body');
    ok('review summary from migrated answers', reviewExpect ? rv.includes(reviewExpect) : /Check answer/.test(rv), (reviewExpect || '(unanswered)') + ' · ' + rv.slice(0, 80));
    // Practice: open the harness set, answer single (right), sata (wrong), matrix (right)
    await page.click('#seg-study [data-v="practice"]'); await page.waitForTimeout(100);
    ok('practice lists sets', (await page.locator('#pr-body .row').count()) >= 2);
    // B-54 (D-110): an open calendar drill over a chapter range offers Share as a page above its questions; other sets do not
    { const ids = await page.evaluate(() => { const pl = Object.entries(window.__db.plans || {}).map(([id, p]) => ({ id, ...p })); const views = window.EVCore.planViews(pl, []); const all = Object.entries(window.__db.sets).map(([id, x]) => ({ id, ...x })).filter(x => x.kind !== 'review' && window.EVCore.validItems(x).length); return { yes: all.filter(x => window.EVCore.shareableSet(x, views).ok).map(x => x.title), no: all.filter(x => !window.EVCore.shareableSet(x, views).ok).map(x => x.title) }; });
      ok('only a calendar drill over a chapter range qualifies here', ids.yes.length >= 1 && ids.no.some(t => /weak spots/.test(t)) && ids.no.includes('Harness set') && !ids.yes.some(t => /weak spots/.test(t)), JSON.stringify(ids));
      if (ids.yes.length) {
        await page.evaluate(t => { const r = [...document.querySelectorAll('#pr-body .row')].find(r => r.textContent.startsWith(t.slice(0, 30))); if (r) r.querySelector('button').click(); }, ids.yes[0]); await page.waitForTimeout(250);
        ok('an open calendar drill offers Share as a page above its questions', await page.isVisible('#pr-share') && (await page.locator('#pr-share button', { hasText: 'Share as a page' }).count()) === 1, ids.yes[0]);
        const before = await page.evaluate(() => window.__mcpCalls.filter(c => c[1] === 'fire_trigger').length);
        await page.locator('#pr-share button', { hasText: 'Share as a page' }).click(); await page.waitForTimeout(400);
        const sj = await page.evaluate(() => Object.entries(window.__db.jobs).filter(([, j]) => j.kind === 'share-set').map(([id, j]) => ({ id, ...j })));
        const fires = await page.evaluate(() => window.__mcpCalls.filter(c => c[1] === 'fire_trigger').map(c => c[2].text));
        ok('Share as a page starts one share-set job naming the set, fired on the worker', sj.length === 1 && /^[\w.-]+: share it as a page for classmates$/.test(sj[0].brief) && fires.length === before + 1 && fires[fires.length - 1] === 'Job ' + sj[0].id, JSON.stringify(sj.map(j => j.brief)));
        ok('while it is made, the bar says so', (await page.locator('#pr-share button', { hasText: 'Making its page…' }).count()) === 1);
        await page.screenshot({ path: `${shots}/share-bar-phone.png` });
        const allSets = page.locator('#pr-body button', { hasText: 'All sets' });
        if (await allSets.count()) { await allSets.first().click(); await page.waitForTimeout(150); }
        ok('back on the list, the share bar goes', !(await page.isVisible('#pr-share')));
      }
    }
    const model = id => page.evaluate(id => { const rows = c => Object.entries(window.__db[c] || {}).map(([k, v]) => ({ id: k, ...v })); return (window.EVCore.buildWeakspots({ weakspots: rows('weakspots'), sets: rows('sets'), answers: rows('answers'), exams: rows('exams') }).find(w => w.id === id) || {}).derived; }, id);
    const agingDerived = await model('e4-aging-expected'); const agingBefore = (agingDerived && agingDerived.streak) || 0; const agingRightToday = !!agingDerived && agingDerived.lastReviewed === today && agingDerived.lastResult === 'right';
    await page.locator('#pr-body .row', { hasText: 'Harness set' }).locator('button').click(); await page.waitForTimeout(100);
    ok('a set made for him offers no Share', !(await page.isVisible('#pr-share')));
    await page.locator('#pr-body label.opt').nth(0).click(); await page.click('#pr-body button:has-text("Check answer")'); await page.waitForTimeout(150);
    ok('single answered and scored', /Correct\./.test(await page.textContent('#pr-body')));
    let ws = await model('e4-preschooler');
    ok('the answer lands in answers/<setId> and the weak spot is recomputed from it', ws && ws.streak === 1 && ws.lastResult === 'right' && await page.evaluate(t => { const a = (window.__db.answers || {})['more-' + t + '-1']; return !!a && a.writer === 'page' && Object.keys(a.answers.m1 || {}).length === 1 && !window.__db.weakspots['e4-preschooler'].derived; }, today), JSON.stringify(ws && { s: ws.streak, n: ws.nextDue }));
    await page.click('#pr-body button:has-text("Next question")'); await page.waitForTimeout(100);
    await page.locator('#pr-body label.opt').nth(0).click(); await page.locator('#pr-body label.opt').nth(2).click();
    await page.click('#pr-body button:has-text("Check answer")'); await page.waitForTimeout(150);
    const t2 = await page.textContent('#pr-body');
    ok('select-all partial credit shown', /Partly right|Not quite/.test(t2));
    const created = await page.evaluate(() => Object.keys(window.__db.weakspots).filter(k => k.includes('E4-2')));
    ok('missed check created a weak spot', created.length === 1, created.join(','));
    await page.click('#pr-body button:has-text("Next question")'); await page.waitForTimeout(100);
    const radios = page.locator('#pr-body table.mx input[type=radio]');
    ok('matrix renders 3 rows x 2 columns', (await radios.count()) === 6);
    await radios.nth(0).check(); await radios.nth(3).check(); await radios.nth(4).check();
    await page.click('#pr-body button:has-text("Check answer")'); await page.waitForTimeout(150);
    ok('matrix answered correctly', /Correct\./.test(await page.textContent('#pr-body')));
    ws = await model('e4-aging-expected');
    ok('matrix right: today counts once toward the streak', ws.streak === agingBefore + 1 || (ws.streak === agingBefore && agingRightToday), JSON.stringify({ before: agingBefore, s: ws.streak, last: ws.lastReviewed }));
    await page.screenshot({ path: `${shots}/practice.png`, fullPage: true });
    // B-39 (D-095): every attempt is truth: Retake shows the set fresh, a new answer is appended, nothing is replaced
    { const setId = 'more-' + today + '-1';
      const tries = () => page.evaluate(id => Object.keys((((window.__db.answers || {})[id] || {}).answers || {}).m1 || {}).length, setId);
      const before = await tries();
      const next = page.locator('#pr-body button', { hasText: /See results|Next question|Summary/ }).first(); if (await next.count()) { await next.click(); await page.waitForTimeout(150); }
      ok('a finished set offers Retake', (await page.locator('#pr-body button', { hasText: 'Retake' }).count()) === 1, (await page.textContent('#pr-body')).slice(0, 160));
      await page.locator('#pr-body button', { hasText: 'Retake' }).click(); await page.waitForTimeout(150);
      ok('Retake shows the first question unanswered', /Check answer/.test(await page.textContent('#pr-body')) && /1 of 3/.test(await page.textContent('#pr-body')));
      await page.locator('#pr-body label.opt').nth(1).click(); await page.click('#pr-body button:has-text("Check answer")'); await page.waitForTimeout(150);
      ok('the retake answer is appended beside the first one, never replacing it', (await tries()) === before + 1, `${before} -> ${await tries()}`);
      await page.screenshot({ path: `${shots}/retake-${scheme}.png`, fullPage: false }); }
    // Plan: tick a task
    await page.click('#seg-study [data-v="plan"]'); await page.waitForTimeout(100);
    const planRows = page.locator('#plan-card .plan-day').first().locator('input.tick');
    ok('plan shows tasks', (await planRows.count()) > 0);
    const before = await page.evaluate(() => Object.keys(((window.__db.planedits || {}).E4 || {}).ticks || {}).length);
    const firstUnchecked = page.locator('#plan-card .plan-day').first().locator('input.tick:not(:checked)').first();
    // One element, resolved once: check() on the :not(:checked) locator re-resolves after the re-render and can tick the next task too.
    await (await firstUnchecked.elementHandle()).click(); await page.waitForTimeout(150);
    const after = await page.evaluate(() => Object.keys(((window.__db.planedits || {}).E4 || {}).ticks || {}).length);
    if (after !== before + 1) console.log('DEBUG plan ticks', JSON.stringify(await page.evaluate(() => (window.__db.planedits || {}).E4)), JSON.stringify(await page.evaluate(() => window.__writes.filter(w => w[1] === 'planedits'))));
    ok('plan tick saved to planedits/E4, the plan untouched', after === before + 1 && !(await page.evaluate(() => window.__db.plans.E4.done)), before + ' -> ' + after);
    await page.screenshot({ path: `${shots}/plan.png`, fullPage: true });
    // Progress
    await page.click('#tab-progress'); await page.waitForTimeout(100);
    // B-39 (D-094): the score card asks for a past unit exam's score and saves it to examedits/<examId>, replaced whole
    { ok('score card asks for the past exam with no score', await page.isVisible('#score-card') && /Harness Exam 0/.test(await page.textContent('#score-card')), await page.textContent('#score-card'));
      await page.fill('#score-in', '88.5'); await page.click('#score-form button[type=submit]'); await page.waitForTimeout(200);
      const ed = await page.evaluate(() => (window.__db.examedits || {}).E0H);
      ok('the score lands in examedits/<examId>, the exam itself unchanged', !!ed && ed.score === 88.5 && ed.status === 'done' && ed.writer === 'page' && await page.evaluate(() => !('score' in window.__db.exams.E0H)), JSON.stringify(ed));
      // B-47 (D-104): the saved score starts the post-exam retro: an exam-retro job naming the exam, fired on the worker
      const rj = await page.evaluate(() => Object.entries(window.__db.jobs || {}).filter(([, j]) => j.kind === 'exam-retro' && /^E0H: /.test(j.brief || '')).map(([id, j]) => ({ id, ...j })));
      const rf = await page.evaluate(() => window.__mcpCalls.filter(c => c[1] === 'fire_trigger').map(c => c[2].text));
      ok('a saved score starts the retro job for that exam, fired once', rj.length === 1 && /^E0H: /.test(rj[0].brief) && rj[0].fired && rj[0].fired.ok === true && rf.filter(t => t === 'Job ' + rj[0].id).length === 1, JSON.stringify(rj.map(j => [j.brief, j.fired])));
      ok('once scored, the card asks for the next one or hides', !/Harness Exam 0/.test(await page.textContent('#score-card') || '') || !(await page.isVisible('#score-card')));
      await page.screenshot({ path: `${shots}/score-${scheme}.png`, fullPage: false }); }
    const rd = await page.textContent('#ready-card');
    ok('readiness shows E4', /Exam 4/.test(rd) && /% solid/.test(rd), rd.slice(0, 100));
    await page.click('#seg-progress [data-v="weak"]'); await page.waitForTimeout(100);
    ok('weak spots listed', (await page.locator('#weak-active .row').count()) > 10, String(await page.locator('#weak-active .row').count()));
    ok('previews listed', (await page.locator('#weak-preview .row').count()) === 4, String(await page.locator('#weak-preview .row').count()));
    await page.locator('#weak-active .row').first().locator('button').click(); await page.waitForTimeout(150);
    const solidEv = await page.evaluate(() => Object.entries(window.__db.weakspots).filter(([, w]) => w.events && Object.values(w.events).some(e => e.type === 'solid' && e.by === 'owner')).map(([id]) => id));
    ok('mark solid writes an owner event', solidEv.length === 1, solidEv.join(','));
    // B-41: Copy for Quizlet on the weak-spot list: import text, one tab-separated card per open weak spot, no write
    { await page.evaluate(() => { window.__clip = null; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } }); } catch (e) { window.__clipErr = e.message; } window.__writes0 = JSON.stringify(window.__db); });
      ok('weak spots: Copy for Quizlet is offered', await page.isVisible('#weak-quizlet-btn'));
      await page.click('#weak-quizlet-btn'); await page.waitForTimeout(150);
      const clip = await page.evaluate(() => window.__clip || ''); const lines = clip.split('\n').filter(Boolean);
      const open = await page.evaluate(() => Object.values(window.__db.weakspots).length);
      ok('Copy for Quizlet copies one term<TAB>definition line per open concept weak spot', lines.length >= 10 && lines.every(l => l.split('\t').length === 2 && l.split('\t')[0] && l.split('\t')[1]), `${lines.length} lines of ${open} · ${lines[0] || ''}`.slice(0, 200));
      ok('Copy for Quizlet writes nothing to the record', await page.evaluate(() => JSON.stringify(window.__db) === window.__writes0));
      await page.locator('#weak-quizlet').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/weak-quizlet-${scheme}.png`, fullPage: false }); }
    await page.screenshot({ path: `${shots}/progress.png`, fullPage: true });
    // Record
    await page.click('#tab-record'); await page.waitForTimeout(100);
    ok('sessions listed', (await page.locator('#sessions .row').count()) === 2);
    ok('ideas show links', /1 link/.test(await page.textContent('#ideas')));
    // B-53 (D-109): every idea shows its kind; only a learning idea offers "Make it a weak spot"; the kind can change
    { const feat = page.locator('#ideas .row', { hasText: 'Harness feature idea' });
      ok('a feature idea shows its kind and no weak-spot action', /Feature/.test(await feat.textContent()) && (await feat.locator('button', { hasText: 'Make it a weak spot' }).count()) === 0);
      const gen = page.locator('#ideas .row', { hasText: 'Harness general idea' }), learn = page.locator('#ideas .row', { hasText: 'Harness learning idea' });
      ok('a general idea shows its kind and no weak-spot action', /General/.test(await gen.textContent()) && (await gen.locator('button', { hasText: 'Make it a weak spot' }).count()) === 0);
      ok('a learning idea shows its kind and offers Make it a weak spot', /Learning/.test(await learn.textContent()) && (await learn.locator('button', { hasText: 'Make it a weak spot' }).count()) === 1);
      await feat.locator('select.idea-kind').selectOption('learning'); await page.waitForTimeout(200);
      const k = await page.evaluate(() => window.__db.ideas['idea-harness-feature'].kind);
      ok('changing the kind writes it (a mark) and the action appears', k === 'learning' && (await page.locator('#ideas .row', { hasText: 'Harness feature idea' }).locator('button', { hasText: 'Make it a weak spot' }).count()) === 1, k);
      await page.locator('#ideas').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/ideas-${scheme}.png`, fullPage: false }); }
    await page.click('#seg-record [data-v="journal"]'); await page.fill('#j-text', 'Resident in room 12 was confused.'); await page.waitForTimeout(50);
    ok('journal warns about identifiers', /room number/.test(await page.textContent('#j-warn')));
    // System
    await page.click('#tab-system'); await page.waitForTimeout(100);
    ok('system shows capacity and the runs', /412 documents in your record/.test(await page.textContent('#capacity')) && (await page.locator('#pipes .row').count()) >= 5, await page.textContent('#capacity'));
    { const c = await page.textContent('#capacity'); // B-37 (D-093): the budgets, worst first, no 25,000 cap
      ok('system shows the D-093 budgets, the one near its budget first with its relief', (await page.locator('#capacity .row').count()) === 3 && /^412 documents in your record\.setsnear budget401 documents · warns at 400 · relief: the weekly roll-upstate/.test(c) && /warns at 192 KiB, fails at 240 KiB/.test(c) && /1\.5 MiB · warns at 4 MiB/.test(c) && !/25,000/.test(c), c);
      const card = page.locator('#capacity').locator('xpath=..');
      for (const [w, h] of [[390, 844], [1280, 860]]) { await page.setViewportSize({ width: w, height: h }); await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await card.screenshot({ path: `${shots}/capacity-${w}.png` }); }
      await page.setViewportSize(scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 }); }
    { const card = page.locator('#lint').locator('xpath=..'); const c = await card.textContent(); // B-34 (D-090)
      ok('the Checks card shows the nightly lint: when, the counts, the warning, the notes by kind', /Checked .* · 0 errors, 1 warning · 3 of 4 built documents reproduced/.test(c) && (await page.locator('#lint .row').count()) === 1 && /derived-stale|built by build/.test(c) && /days\/2026-10-17/.test(c) && /Notes, not problems: 1 kept from before, frozen · 1 rebuilt by their next run/.test(c), c.slice(0, 300));
      for (const [w, h] of [[390, 844], [1280, 860]]) { await page.setViewportSize({ width: w, height: h }); await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await card.screenshot({ path: `${shots}/checks-${w}.png` }); }
      await page.setViewportSize(scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 }); }
    // ---- System health panel (B-17): health/current in plain words, never alarming
    const hp = await page.textContent('#health');
    ok('health panel leads with a plain verdict from health/current', /3 things to look at\./.test(hp) && /checked 5\d min ago/.test(hp), hp.slice(0, 160));
    ok('a missed slot, a stalled run and a stuck retry each read as a sentence', /Evening \(cloud\) missed its .*run; E\.V\. started it again\./.test(hp) && /Weekly review started 3 h ago and never finished\./.test(hp) && /weekly-h: never ended, still stuck after one retry\. A build chat should look\./.test(hp), hp);
    ok('the weak spot state is held against the evening hash, and the drill age is shown', /Your weak spots changed since the evening snapshot/.test(hp) && /Backup restore drill: none yet/.test(hp));
    ok('pipelines read with when they run', /Morning · daily 4:25am/.test(await page.textContent('#pipes')) && /Watchdog · every 3 hours at :55/.test(await page.textContent('#pipes')) && /Restore drill · monthly on the 1st, 8:55pm/.test(await page.textContent('#pipes')), (await page.textContent('#pipes')).slice(0, 300));
    ok('versions name the release and the record', /Release v4\.0\.0 · core v4\.0\.0 · spec 4\.0\.0 · staging record/.test(await page.textContent('#versions')));
    await page.screenshot({ path: `${shots}/system.png`, fullPage: true });
    { // B-55 (D-111): a health check 5 hours old is marked stale, the watchdog itself may have stopped
      const keep = await page.evaluate(() => window.__db.health.current.at);
      const setAt = t => page.evaluate(async t => { const db = await window.claude.use('db'); await db.collection('health').doc('current').set({ ...window.__db.health.current, at: t }); }, t);
      await setAt(await page.evaluate(() => new Date(Date.now() - 5 * 3600e3 - 60e3).toISOString())); await page.waitForTimeout(300); // the page's own (fake) clock
      const card = page.locator('#health');
      for (const [w, h] of [[390, 844], [1280, 860]]) {
        await page.setViewportSize({ width: w, height: h }); await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
        const t = await card.textContent();
        ok(`[${w}] a 5-hour-old health check is marked stale`, /This health check is 5 hours old\. The watchdog checks every three hours, so it may have stopped\./.test(t) && (await card.locator('.chip', { hasText: 'stale' }).count()) === 1 && /4 things to look at\./.test(t), t.slice(0, 200));
        await card.screenshot({ path: `${shots}/health-stale-${w}.png` });
      }
      await setAt(keep); await page.waitForTimeout(200);
      ok('a fresh health check has no stale mark', !/stale/.test(await card.textContent()));
      // B-27 (D-087): a missed Mac-lane slot reads as a sentence, not a retry
      const h0 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__db.health.current)));
      await page.evaluate(async h => { const db = await window.claude.use('db'); await db.collection('health').doc('current').set({ ...h, missing: [...h.missing, { pipeline: 'evening-mac', slot: '2026-10-19T01:20:00.000Z', refired: false, lane: 'mac' }] }); }, h0); await page.waitForTimeout(300);
      ok('a missed Mac-lane slot says the Mac may have been asleep, and is not retried', /Evening \(Mac\) missed its 8:20 PM run\. It runs on your Mac, which may have been asleep or offline; it runs again at its next time\./.test(await card.textContent()), (await card.textContent()).slice(0, 400));
      await page.evaluate(async h => { const db = await window.claude.use('db'); await db.collection('health').doc('current').set(h); }, h0); await page.waitForTimeout(200);
      await page.setViewportSize({ width: 390, height: 844 }); }
    ok('no page errors after interactions', errors.length === 0, errors.join(' | '));
    // Visitor
    const v = await browser.newPage({ viewport: { width: 390, height: 700 } });
    await openPage(v, 'staging', 'window.__notOwner=true;'); await v.waitForTimeout(600);
    ok('visitors see nothing and cannot write', /private study record/.test(await v.textContent('#status')) && (await v.evaluate(() => window.__writes.length)) === 0);
    await page.close(); await v.close();
    // Staging page: same page, staging worker only; filing is live-only
    const st = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await st.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await openPage(st, 'staging'); await st.waitForTimeout(900);
    await st.evaluate(() => { window.__chatScript = [{ tool: 'start_job', input: { kind: 'general', title: 'Staging check', brief: 'harness' } }]; window.__chatReply = 'Queued.'; });
    await send(st, 'Run a staging job'); await st.waitForTimeout(300);
    const smc = await st.evaluate(() => window.__mcpCalls.find(c => c[1] === 'fire_trigger'));
    ok('staging fires only the staging worker', smc && smc[2].trigger_id === stagingWorker, JSON.stringify(smc));
    await send(st, 'File it'); await st.waitForTimeout(200);
    ok('file it files through the reader on the page, never a Mac task', /Nothing new to file/.test((await msgs(st)).slice(-1)[0].text) && (await st.evaluate(() => window.__mcpCalls.filter(c => c[1] === 'fire_trigger').length)) === 1);
    ok('staging readout says staging', /staging/i.test(await st.textContent('#readout')));
    await st.close();

    // ---- B-18: session filing from the page, skills practice, the readiness audit, grounded explanations
    {
      const fp = await browser.newPage({ viewport: { width: 390, height: 844 } }); const fErr = []; fp.on('pageerror', e => fErr.push(e.message));
      await fp.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
      // The reader lists three sessions: one new, one v3 already filed (under its bare id), one tagged #graded.
      const fresh = { found: true, id: '2026-10-18-1300-Harness-Fluids', date: today, startedAt: today + 'T18:00:00Z', endedAt: today + 'T18:40:00Z', note: 'Harness Fluids', minutes: 40, checks: 3, questions: 4, summary: 'Worked through third spacing.', weakSpots: [{ objective: 'E4-3', topic: 'Third spacing signs' }, { objective: '', topic: 'Why albumin holds fluid in the vessels' }], connections: ['Albumin links nutrition to edema'], noteTodos: ['Add a third-spacing example'], cardCount: 2, source: 'Study Watch' };
      const pre = `window.__readerSessions = { sessions: [{ id: '2026-10-18-1300-Harness-Fluids', bytes: 900, sha256: 'a', modifiedAt: '${today}T18:41:00Z' }, { id: '2026-10-17-0035-Pharmacology-Chapter-50', bytes: 800, sha256: 'b', modifiedAt: '2026-10-17T05:50:00Z' }, { id: '2026-10-18-1200-Harness-Graded', bytes: 300, sha256: 'c', modifiedAt: '${today}T17:00:00Z' }], count: 3, more: false };
        window.__readerSession = { '2026-10-18-1300-Harness-Fluids': ${JSON.stringify(fresh)}, '2026-10-18-1200-Harness-Graded': { found: true, id: '2026-10-18-1200-Harness-Graded', graded: true } };`;
      await openPage(fp, 'staging', pre); await fp.waitForTimeout(2500);
      const filed = await fp.evaluate(() => window.__db.sessions['sw-2026-10-18-1300-Harness-Fluids']);
      ok('on open, new Study Watch sessions are filed from the page through the reader', filed && filed.writer === 'page' && filed.source === 'Study Watch' && filed.summary === 'Worked through third spacing.' && !JSON.stringify(filed).includes('note text'), JSON.stringify(filed).slice(0, 200));
      ok('only findings were read, and only from the reader’s session tools', await fp.evaluate(h => window.__mcpCalls.filter(c => c[0] === h).map(c => c[1]).every(t => ['status', 'list_sessions', 'read_session'].includes(t)) && window.__mcpCalls.some(c => c[1] === 'read_session' && c[2].id === '2026-10-18-1300-Harness-Fluids'), spec.registry.studyWatch.reader.host));
      ok('a session v3 already filed and a #graded one are left alone', await fp.evaluate(() => !window.__db.sessions['sw-2026-10-17-0035-Pharmacology-Chapter-50'] && !window.__db.sessions['sw-2026-10-18-1200-Harness-Graded'] && !window.__mcpCalls.some(c => c[1] === 'read_session' && c[2].id === '2026-10-17-0035-Pharmacology-Chapter-50')));
      const fw = await fp.evaluate(() => ({ ws: Object.values(window.__db.weakspots).filter(w => w.topic === 'Third spacing signs' || w.topic === 'Add a third-spacing example').map(w => w.kind), ideas: Object.values(window.__db.ideas).filter(i => i.sessionId === 'sw-2026-10-18-1300-Harness-Fluids').length }));
      ok('its findings are filed by the session rules: a weak spot, a note to-do, ideas', fw.ws.includes('concept') && fw.ws.includes('note') && fw.ideas === 2, JSON.stringify(fw));
      const fm = (await msgs(fp)).slice(-1)[0];
      ok('E.V. says what it filed, once, with the session card', /^Filed 1 Study Watch session, 2 new weak spots, 2 ideas\. Sessions tagged #graded stayed out\.$/.test(fm.text) && fm.cards[0].type === 'session', fm.text);
      await send(fp, 'File it'); await fp.waitForTimeout(500);
      ok('file it again: nothing new, nothing written twice', /Nothing new to file|#graded stayed out of the record/.test((await msgs(fp)).slice(-1)[0].text) && (await fp.evaluate(() => Object.keys(window.__db.sessions).filter(k => k.startsWith('sw-')).length)) === 1, (await msgs(fp)).slice(-1)[0].text);
      // Skills practice: E.V. finds the checklist in the library and runs it in a card, one step at a time
      await fp.evaluate(() => { window.__toolResults = []; window.__chatScript = [{ tool: 'practice_skill', input: { action: 'start', skill: 'head to toe assessment' } }]; window.__chatReply = 'Let’s run it.'; });
      await send(fp, 'Run me through the head to toe validation'); await fp.waitForTimeout(800);
      const sk = await fp.evaluate(() => Object.entries(window.__db.sessions).filter(([id]) => id.startsWith('ss-skill-')).map(([id, x]) => ({ id, ...x }))[0]);
      ok('practice_skill starts a skills session from the checklist in his materials', sk && sk.kind === 'skill' && sk.status === 'active' && sk.skill.steps.length >= 4 && /p\. 12/.test(sk.skill.cite), JSON.stringify(sk && { t: sk.topic, n: sk.skill.steps.length, c: sk.skill.cite }) + ' ' + JSON.stringify(await fp.evaluate(() => window.__toolResults)));
      const card = () => fp.locator('#thread .msg.ev').last();
      ok('the skills card shows step 1 with Did it and Missed it', /Step 1\./.test(await card().textContent()) && (await card().locator('button', { hasText: 'Did it' }).count()) === 1);
      await card().locator('button', { hasText: 'Did it' }).click(); await fp.waitForTimeout(400);
      await card().locator('button', { hasText: 'Missed it' }).click(); await fp.waitForTimeout(400);
      const sw = await fp.evaluate(id => Object.values(window.__db.weakspots).filter(w => w.kind === 'skill' && w.origin && w.origin.session === id), sk.id);
      ok('a missed step is a weak spot of kind skill at once', sw.length === 1 && /: step 2, /.test(sw[0].topic) && /Step 3\./.test(await card().textContent()), JSON.stringify(sw.map(w => w.topic)));
      ok('the card keeps the tally', /2 of \d+ · 1 missed/.test(await card().textContent()), (await card().textContent()).slice(0, 120));
      await fp.screenshot({ path: `${shots}/skills-card.png` });
      // B-51 (D-107): on the phone a bottom sheet keeps the current step in view; marking works from it as from the card
      ok('[phone] the sheet peeks with the current step and its count, the side panel hidden', await fp.isVisible('#sksheet') && /Step 3 of \d+/.test(await fp.textContent('#sksheet')) && !(await fp.isVisible('#skpanel')), await fp.textContent('#sksheet'));
      const sb = await fp.locator('#sksheet').boundingBox(); const vh = fp.viewportSize().height;
      ok('[phone] the sheet sits on screen above the dock, without scrolling', sb && sb.y > vh / 3 && sb.y + sb.height <= vh, JSON.stringify(sb));
      await fp.locator('#sksheet .sk-peek button', { hasText: 'Did it' }).click(); await fp.waitForTimeout(400);
      ok('[phone] Did it on the sheet marks step 3, and the card follows', /Step 4 of \d+/.test(await fp.textContent('#sksheet')) && /Step 4\./.test(await card().textContent()) && /3 of \d+ · 1 missed/.test(await card().textContent()));
      await fp.locator('#sksheet .sk-tog').click(); await fp.waitForTimeout(300);
      const opened = await fp.evaluate(() => [...document.querySelectorAll('#sksheet .sk-step')].map(li => (li.className.match(/pass|miss|cur/) || [''])[0]));
      ok('[phone] the sheet opens to the whole ticked list, the current step marked', opened.slice(0, 4).join(',') === 'pass,miss,pass,cur' && await fp.locator('#sksheet .sk-tog').getAttribute('aria-expanded') === 'true', opened.join(','));
      await fp.screenshot({ path: `${shots}/skills-sheet-phone.png` });
      await fp.locator('#sksheet .sk-tog').click(); await fp.waitForTimeout(200);
      await card().locator('button', { hasText: 'Stop' }).click(); await fp.waitForTimeout(400);
      ok('[phone] the sheet goes when the run ends', !(await fp.isVisible('#sksheet')));
      const ended = await fp.evaluate(id => window.__db.sessions[id], sk.id);
      ok('Stop ends the run with its summary', ended.status === 'ended' && /^2 of \d+ steps done right, missed step 2\. Stopped before the end\.$/.test(ended.summary) && /missed step 2/.test(await card().textContent()), ended.summary);
      await fp.click('#tab-progress'); await fp.locator('#seg-progress [data-v="weak"]').click(); await fp.waitForTimeout(200);
      ok('Progress lists it as a skill to practice', (await fp.locator('#weak-notes .row', { hasText: ': step 2, ' }).locator('button', { hasText: 'Practiced' }).count()) === 1);
      await fp.click('#tab-ev'); await fp.waitForTimeout(150);
      // The readiness audit: per objective, what to reread, from "How ready am I?"
      await send(fp, 'How ready am I?'); await fp.waitForTimeout(1200);
      const au = await fp.locator('#thread .msg.ev').last().textContent();
      ok('How ready am I? attaches the readiness audit with what to reread', /Readiness audit · /.test(au) && /\d+ solid · \d+ right once · \d+ not yet/.test(au) && /Reread: [^·]+, (p\.|slide) \d+/.test(au), au.slice(0, 400));
      await fp.screenshot({ path: `${shots}/audit-card.png` });
      // Grounded explanations: the rule rides in the chat context, with the materials tool
      await fp.evaluate(() => { window.__chatScript = []; window.__chatReply = 'Ok.'; }); await send(fp, 'Explain why third spacing causes low blood pressure'); await fp.waitForTimeout(400);
      const gc = await fp.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
      ok('grounded explanations: explain from his materials and cite, or mark it', /Grounded explanations: when he asks why, or to explain a weak spot/.test(gc.input[0].content) && /\(check your materials\)/.test(gc.input[0].content) && gc.tools.includes('materials') && gc.tools.includes('practice_skill'));
      ok('B-18: no page errors', fErr.length === 0, fErr.join(' | '));
      await fp.close();
    }
    // ---- B-51 (D-107): at 1024px and up the checklist is a side panel beside the thread
    {
      const dp = await browser.newPage({ viewport: { width: 1280, height: 860 } }); const dErr = []; dp.on('pageerror', e => dErr.push(e.message));
      await dp.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
      await openPage(dp, 'staging'); await dp.waitForTimeout(1500);
      await dp.evaluate(() => { window.__chatScript = [{ tool: 'practice_skill', input: { action: 'start', skill: 'head to toe assessment' } }]; window.__chatReply = 'Let’s run it.'; });
      await send(dp, 'Run me through the head to toe validation'); await dp.waitForTimeout(800);
      const dcard = () => dp.locator('#thread .msg.ev').last();
      ok('[desktop] the side panel shows the whole checklist beside the thread, the sheet hidden', await dp.isVisible('#skpanel') && !(await dp.isVisible('#sksheet')) && (await dp.locator('#skpanel .sk-step').count()) >= 4 && /Step 1 of \d+/.test(await dp.textContent('#skpanel')));
      const pb = await dp.locator('#skpanel').boundingBox(), tb = await dp.locator('#thread').boundingBox();
      ok('[desktop] the panel sits to the right of the thread, in view', pb && tb && pb.x >= tb.x + tb.width && pb.y < 860 && pb.x + pb.width <= 1280, JSON.stringify({ pb, tb }));
      await dp.locator('#skpanel .sk-acts button', { hasText: 'Did it' }).click(); await dp.waitForTimeout(400);
      await dp.locator('#skpanel .sk-acts button', { hasText: 'Missed it' }).click(); await dp.waitForTimeout(400);
      const marks = await dp.evaluate(() => [...document.querySelectorAll('#skpanel .sk-step')].map(li => (li.className.match(/pass|miss|cur/) || [''])[0]));
      ok('[desktop] marking from the panel ticks the list and the card follows', marks.slice(0, 3).join(',') === 'pass,miss,cur' && /Step 3\./.test(await dcard().textContent()) && /2 of \d+ · 1 missed/.test(await dcard().textContent()), marks.join(','));
      await dcard().locator('button', { hasText: 'Did it' }).click(); await dp.waitForTimeout(400);
      ok('[desktop] marking from the card moves the panel on', /Step 4 of \d+/.test(await dp.textContent('#skpanel')));
      await dp.screenshot({ path: `${shots}/skills-panel-desktop.png` });
      ok('[desktop] no horizontal scroll with the panel open', await dp.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await dp.locator('#skpanel button', { hasText: 'Stop' }).click(); await dp.waitForTimeout(400);
      ok('[desktop] Stop on the panel ends the run and the panel goes', !(await dp.isVisible('#skpanel')) && await dp.evaluate(() => Object.values(window.__db.sessions).some(x => x.kind === 'skill' && x.status === 'ended')));
      ok('B-51: no page errors', dErr.length === 0, dErr.join(' | '));
      await dp.close();
    }
    // ---- B-54 (D-110): the shared page itself, at both widths: answers and reasons show only after an attempt
    for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
      const sp = await browser.newPage({ viewport: vp, colorScheme: label === 'phone' ? 'dark' : 'light' }); const sErr = []; sp.on('pageerror', e => sErr.push(e.message));
      await sp.addScriptTag({ path: path.join(root, 'dist/page/staging/core.js') }).catch(() => {});
      const html = await sp.evaluate(() => window.EVCore.sharePage({ id: 'x', title: 'Drill 9: Ch 3-4', items: [
        { id: 'a', type: 'single', stem: 'A made-up client asks which action comes first?', options: ['Wait', 'Assess airway'], correct: [1], rationales: ['Delays care.', 'Airway first.'], weakspotId: 'ws-x', objective: 'E9-1' },
        { id: 'b', type: 'sata', stem: 'Which findings are expected after a made-up procedure? Select all that apply.', options: ['Mild pain', 'Fever 40 C', 'Fatigue'], correct: [0, 2], rationales: ['Expected.', 'Report it.', 'Expected.'] },
        { id: 'c', type: 'matrix', stem: 'Mark each made-up finding as expected or unexpected.', matrix: { columns: ['Expected', 'Unexpected'], rows: [{ text: 'Dry skin', correct: 0, rationale: 'Normal aging.' }, { text: 'New confusion', correct: 1, rationale: 'Sudden change.' }, { text: 'Slower reaction time', correct: 0, rationale: 'Normal aging.' }] } } ] }));
      await sp.setContent(html); await sp.waitForTimeout(150);
      ok(`[${label}] the shared page shows questions with the reasons hidden, and nothing of his`, (await sp.locator('.q').count()) === 3 && (await sp.locator('.why:visible').count()) === 0 && !/ws-x|E9-1/.test(await sp.content()));
      await sp.locator('.q').nth(0).locator('label', { hasText: 'Wait' }).click(); await sp.locator('.q').nth(0).locator('button.check').click();
      ok(`[${label}] a wrong try marks the right answer and shows the reasons`, /Not quite/.test(await sp.locator('.q').nth(0).textContent()) && await sp.locator('.q').nth(0).locator('.why', { hasText: 'Airway first.' }).isVisible());
      await sp.locator('.q').nth(2).locator('input[aria-label="Dry skin: Expected"]').check(); await sp.locator('.q').nth(2).locator('input[aria-label="New confusion: Unexpected"]').check(); await sp.locator('.q').nth(2).locator('input[aria-label="Slower reaction time: Expected"]').check(); await sp.locator('.q').nth(2).locator('button.check').click();
      ok(`[${label}] a matrix answered right says so`, /Right/.test(await sp.locator('.q').nth(2).textContent()));
      ok(`[${label}] no horizontal scroll on the shared page`, await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await sp.screenshot({ path: `${shots}/share-page-${label}.png`, fullPage: true });
      ok(`[${label}] B-54: no page errors`, sErr.length === 0, sErr.join(' | '));
      await sp.close();
    }
    // ---- B-52 (D-108): both workout sequences at both widths; every workouts/<id> written validates
    {
      const { loadValidator } = await import(path.join(root, 'core/schemas.mjs'));
      const validate = loadValidator();
      for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
        const wp = await browser.newPage({ viewport: vp }); const wErr = []; wp.on('pageerror', e => wErr.push(e.message));
        await wp.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
        await openPage(wp, 'staging'); await wp.waitForTimeout(1500);
        const last = () => wp.locator('#thread .msg.ev').last();
        // CINDY from the quick ask: the picker, Start, three rounds, the cap, extra reps, then energy and mood
        await send(wp, 'Start a workout'); await wp.waitForTimeout(400);
        ok(`[${label}] start a workout offers both sequences`, /CINDY/.test(await last().textContent()) && /1,500-rep ladder/.test(await last().textContent()) && (await last().locator('button', { hasText: 'Start' }).count()) === 2);
        await last().locator('.row', { hasText: 'CINDY' }).locator('button', { hasText: 'Start' }).click(); await wp.waitForTimeout(500);
        ok(`[${label}] CINDY runs as a card with its clock and round`, /Workout · CINDY/.test(await last().textContent()) && /20:00 left|19:5\d left/.test(await last().textContent()) && /5 pull-ups/.test(await last().textContent()), (await last().textContent()).slice(0, 160));
        for (let i = 0; i < 3; i++) { await wp.clock.fastForward(5 * 60e3); await last().locator('button', { hasText: 'Round done' }).click(); await wp.waitForTimeout(250); }
        ok(`[${label}] three rounds counted`, /3 rounds so far \(90 reps\)/.test(await last().textContent()), (await last().textContent()).slice(0, 200));
        ok(`[${label}] the running workout sits in the dock too, with its round and buttons`, label === 'phone' ? (await wp.isVisible('#sksheet') && /CINDY · Round 4/.test(await wp.textContent('#sksheet')) && (await wp.locator('#sksheet button', { hasText: 'Round done' }).count()) === 1) : (await wp.isVisible('#skpanel') && /Workout · CINDY/.test(await wp.textContent('#skpanel')) && (await wp.locator('#skpanel button', { hasText: 'Round done' }).count()) === 1));
        await wp.clock.fastForward(5 * 60e3 + 5000); await wp.waitForTimeout(1500);
        ok(`[${label}] at the cap the card asks for the extra reps`, /3 rounds in 20 minutes/.test(await last().textContent()) && await last().locator('input[type=number]').count() === 1);
        await wp.screenshot({ path: `${shots}/workout-cindy-${label}.png` });
        await last().locator('input[type=number]').fill('7'); await last().locator('form button[type=submit]').click(); await wp.waitForTimeout(400);
        await last().locator('.energy button', { hasText: '4' }).click(); await last().locator('input[aria-label=Mood]').fill('strong, arms gone'); await last().locator('button', { hasText: 'Save' }).click(); await wp.waitForTimeout(400);
        const cindy = await wp.evaluate(() => Object.entries(window.__db.workouts || {}).filter(([, w]) => w.sequence === 'cindy').map(([id, w]) => ({ id, ...w })));
        ok(`[${label}] CINDY lands in workouts/<id>: rounds, extra reps, energy and mood, valid`, cindy.length === 1 && cindy[0].status === 'done' && cindy[0].result.rounds === 3 && cindy[0].result.extraReps === 7 && cindy[0].energy === 4 && cindy[0].mood === 'strong, arms gone' && validate('workouts', (({ id, ...d }) => d)(cindy[0]), { id: cindy[0].id }).ok, JSON.stringify(cindy[0] && cindy[0].result));
        ok(`[${label}] the card closes with the summary`, /3 rounds \+ 7 reps in 20 min/.test(await last().textContent()) && /Energy 4\/5/.test(await last().textContent()));
        // The ladder from the conversation: five rounds, stopped in round six
        await wp.evaluate(() => { window.__chatScript = [{ tool: 'start_workout', input: { sequence: 'ladder-1500' } }]; window.__chatReply = 'Ladder time.'; });
        await send(wp, 'Let’s do the 1500 rep ladder'); await wp.waitForTimeout(600);
        ok(`[${label}] the ladder runs round by round`, /Round 1 of 19/.test(await last().textContent()) && /1 pull-ups/.test(await last().textContent()) && /5 air squats/.test(await last().textContent()), (await last().textContent()).slice(0, 200));
        for (let i = 0; i < 5; i++) { await wp.clock.fastForward(2 * 60e3); await last().locator('button', { hasText: 'Round done' }).click(); await wp.waitForTimeout(250); }
        ok(`[${label}] round six asks for 6, 12, 18, 24 and 30`, /Round 6 of 19/.test(await last().textContent()) && /6 pull-ups/.test(await last().textContent()) && /30 air squats/.test(await last().textContent()));
        await wp.screenshot({ path: `${shots}/workout-ladder-${label}.png` });
        await wp.clock.fastForward(60e3); await last().locator('button', { hasText: 'Stop here' }).click(); await wp.waitForTimeout(400);
        await last().locator('.energy button', { hasText: '2' }).click(); await last().locator('button', { hasText: 'Save' }).click(); await wp.waitForTimeout(400);
        const lad = await wp.evaluate(() => Object.entries(window.__db.workouts || {}).filter(([, w]) => w.sequence === 'ladder-1500').map(([id, w]) => ({ id, ...w })));
        ok(`[${label}] the ladder keeps total time and where he stopped, valid`, lad.length === 1 && lad[0].status === 'stopped' && lad[0].result.stopRound === 6 && lad[0].result.reps === 225 && lad[0].result.totalSeconds >= 660 && lad[0].result.totalSeconds < 690 && lad[0].energy === 2 && lad[0].mood === null && validate('workouts', (({ id, ...d }) => d)(lad[0]), { id: lad[0].id }).ok, JSON.stringify(lad[0] && lad[0].result));
        await wp.click('#tab-record'); await wp.waitForTimeout(200);
        const wl = await wp.textContent('#workouts');
        ok(`[${label}] Record lists both workouts with their results`, /CINDY/.test(wl) && /3 rounds \+ 7 reps/.test(wl) && /stopped in round 6/.test(wl), wl.slice(0, 200));
        ok(`[${label}] B-52: no page errors`, wErr.length === 0, wErr.join(' | '));
        await wp.close();
      }
    }

    // ---- Study session, entirely in the E.V. conversation (D-073). A fake clock fast-forwards to each check.
    const ss = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const sErr = []; ss.on('pageerror', e => sErr.push(e.message)); ss.on('console', m => { if (m.type() === 'error') sErr.push(m.text()); });
    await ss.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
    await openPage(ss); await ss.waitForTimeout(900);
    const host = spec.registry.studyWatch.reader.host;
    const note1 = 'Fluids and electrolytes\nIsotonic: 0.9% NaCl stays in the vessels.';
    const setNote = (text, extra = {}) => ss.evaluate(([t, e]) => { window.__readerNote = { found: true, appVersion: '0.4', note: { id: 'x-coredata://n1', name: 'Fluids and electrolytes', folder: '2026/2026 Fall/NUR 112/Week 9', modifiedAt: new Date().toISOString(), text: t }, ...e }; }, [text, extra]);
    const sess = () => ss.evaluate(() => Object.entries(window.__db.sessions || {}).filter(([, x]) => x.source === 'E.V. Home').map(([id, x]) => ({ id, ...x }))[0] || null);
    // Moves the page's wall clock forward, then waits for done(). Not clock.fastForward: with the core's animation frames
    // keeping Playwright's fake clock busy, its real-time sync can finish after a fast-forward and rewind the clock.
    const jump = async (ms, done) => { await ss.clock.setSystemTime(await ss.evaluate(() => Date.now()) + ms); for (let i = 0; i < 50 && !(await done()); i++) await ss.waitForTimeout(100); await ss.waitForTimeout(250); };
    const hasEvent = test => async () => { const s = await sess(); return !!s && Object.values(s.events || {}).some(test); };
    // Without the reader (a browser tab or the iPhone), E.V. says where to open the page
    await ss.evaluate(() => { window.__readerFail = 'server_not_connected'; });
    ok('session chip offered', (await ss.locator('#qchips .qchip', { hasText: 'Start a study session' }).count()) === 1);
    await ss.locator('#qchips .qchip', { hasText: 'Start a study session' }).click(); await ss.waitForTimeout(300);
    ok('no reader: says to open the desktop app, starts nothing', /Claude desktop app on your Mac/.test((await msgs(ss)).slice(-1)[0].text) && !(await sess()), (await msgs(ss)).slice(-1)[0].text);
    // A #graded note is refused
    await ss.evaluate(() => { window.__readerFail = null; }); await setNote('', { graded: true });
    await send(ss, 'Start a study session'); await ss.waitForTimeout(300);
    ok('graded note refused', /#graded/.test((await msgs(ss)).slice(-1)[0].text) && !(await sess()));
    // Start
    await setNote(note1);
    await send(ss, 'start a study session'); await ss.waitForTimeout(400);
    let S1 = await sess();
    ok('session saved as active with a start mark, no note text', S1 && S1.status === 'active' && S1.topic === 'Fluids and electrolytes' && Object.values(S1.events)[0].len === note1.length && !JSON.stringify(S1).includes('Isotonic'), JSON.stringify(S1 && S1.events));
    ok('start message in the thread', /Session started on Fluids and electrolytes/.test((await msgs(ss)).slice(-1)[0].text.replace(/\*\*/g, '')));
    // Captions (B-77, D-122): in a session only her latest two lines show, and her core is at the session step (66%).
    { const cs = await ss.evaluate(() => { const h = document.getElementById('hero'); return { step: h.dataset.step, px: Math.round(h.querySelector('.ev-av').getBoundingClientRect().width), stage: Math.round(h.getBoundingClientRect().height), lines: document.querySelectorAll('#thread .msg.ev').length }; });
      ok('in a session: only her latest two lines, her core at 66% (172 px) on a 196 px stage', cs.step === 'session' && cs.lines === 2 && Math.abs(cs.px - 172) <= 1 && cs.stage === 196, JSON.stringify(cs)); }
    ok('session ring holds the core', (await ss.locator('#sbar .s-ring canvas').count()) === 1 && await ss.evaluate(() => document.body.classList.contains('in-session') && !document.body.classList.contains('opening')));
    ok('session bar shows the note and the next check', !(await ss.isHidden('#sbar')) && /Fluids and electrolytes/.test(await ss.textContent('#sbar')) && /next check 6:5\d|next check 7:00/.test(await ss.textContent('#sbar')), await ss.textContent('#sbar'));
    ok('chip hidden while a session runs', (await ss.locator('#qchips .qchip', { hasText: 'Start a study session' }).count()) === 0);
    await ss.screenshot({ path: `${shots}/session-bar.png` });
    // First check: only the new writing goes to Claude, the reply posts as a check card
    await setNote(note1 + '\nHypotonic: 0.45% NaCl shifts water into the cells.');
    await ss.evaluate(() => { window.__sampleFn = p => /Study session check/.test(p) ? { items: [{ text: '1. Why does 0.45% NaCl move water into the cells?', kind: 'why' }, { text: 'Your note has no hypertonic example yet.', kind: 'gap' }] } : { summary: 'Worked through IV fluid tonicity and where water moves.', weakSpots: [{ objective: 'E4-3', topic: 'Hypokalemia findings' }, { objective: 'E4-3', topic: 'Fluid volume excess signs' }, { objective: 'E4-3', topic: 'Hypotonic vs isotonic fluid shifts' }, { topic: 'Why the kidneys hold sodium' }], connections: ['Sodium pulls water, which links fluids to edema'], noteTodos: ['Add a hypertonic example'], cards: [{ term: 'Isotonic', definition: '0.9% NaCl; stays in the vessels' }, { term: 'Hypotonic', definition: '0.45% NaCl; water moves into cells' }] }; });
    await jump(425e3, hasEvent(e => e.type === 'check'));
    S1 = await sess(); const chk = Object.values(S1.events).find(e => e.type === 'check');
    const jp = await ss.evaluate(() => (window.__jsonCalls || []).slice(-1)[0]);
    ok('check reads the note through the reader', await ss.evaluate(h => window.__mcpCalls.some(c => c[0] === h && c[1] === 'latest_note'), host));
    ok('check prompt carries only the new writing and the record context', jp && /New text since the last check:\n\nHypotonic: 0.45% NaCl/.test(jp.prompt) && /Testable objectives:/.test(jp.prompt) && jp.tier === 'quick', jp && jp.prompt.slice(0, 400));
    ok('check event keeps a mark, not the text', chk && chk.n === 1 && chk.items === 2 && chk.len > note1.length && !JSON.stringify(S1).includes('Hypotonic'), JSON.stringify(chk));
    const lastChk = (await msgs(ss)).slice(-1)[0];
    ok('check posted as a card with its items', lastChk.cards && lastChk.cards[0].type === 'check' && lastChk.cards[0].items.length === 2 && lastChk.cards[0].items[0].text === 'Why does 0.45% NaCl move water into the cells?', JSON.stringify(lastChk.cards));
    ok('check card rendered', /Two questions on what you just wrote/.test((await msgs(ss)).slice(-1)[0].text) && /Check 1 · Fluids and electrolytes/.test(await ss.locator('#thread .msg.ev').last().textContent()) && (await ss.locator('#thread .msg.ev').last().locator('ol.check-items li').count()) === 2);
    // Answer in the composer: recorded on the session, and Claude sees the check's questions
    await ss.evaluate(() => { window.__sampleFn && (window.__chatReply = 'Right: less solute outside, so water moves in. What happens to cell size?'); window.__chatScript = []; });
    await ss.locator('#thread .msg.ev').last().locator('button', { hasText: 'Answer' }).click();
    ok('Answer focuses the composer', await ss.evaluate(() => document.activeElement && document.activeElement.id === 'ev-input' && /Answer check 1/.test(document.activeElement.placeholder)));
    await send(ss, 'There is less solute in the fluid so water moves into the cells'); await ss.waitForTimeout(400);
    S1 = await sess(); const ans = Object.values(S1.events).find(e => e.type === 'answer');
    const cc = await ss.evaluate(() => [...window.__chatCalls].reverse().find(c => Array.isArray(c.input)));
    ok('answer recorded on the session', ans && ans.n === 1 && /^m-\d{8}-\d{9}-matt$/.test(ans.msgId), JSON.stringify(ans));
    ok('chat sees the session and the check questions', /Study session running on his note "Fluids and electrolytes"/.test(cc.input[0].content) && cc.input.some(t => /Why does 0\.45% NaCl move water into the cells\?/.test(t.content)) && cc.tools.includes('study_session'));
    ok('check card shows answered', /answered/.test(await ss.locator('#thread .msg.ev', { hasText: 'Check 1 ·' }).textContent()));
    // Break and resume from the bar
    await ss.locator('#sbar button', { hasText: 'Break' }).click(); await ss.waitForTimeout(300);
    ok('break shown in the bar', /On a break/.test(await ss.textContent('#sbar')) && Object.values((await sess()).events).some(e => e.type === 'break'));
    await ss.screenshot({ path: `${shots}/session-break.png` });
    await ss.locator('#sbar button', { hasText: 'Resume' }).click(); await ss.waitForTimeout(300);
    ok('resume restarts the countdown', /next check/.test(await ss.textContent('#sbar')));
    // New writing with what looks like an identifier skips the check and says why, once
    await setNote(note1 + '\nHypotonic: 0.45% NaCl shifts water into the cells.\nThe resident in room 12 had edema.');
    const before3 = (await msgs(ss)).length; await jump(425e3, hasEvent(e => e.type === 'skip' && e.why === 'identifiers'));
    S1 = await sess();
    ok('identifier skips the check', Object.values(S1.events).some(e => e.type === 'skip' && e.why === 'identifiers') && /room number/.test((await msgs(ss)).slice(-1)[0].text) && (await msgs(ss)).length === before3 + 1);
    // End: wrap-up as JSON, filed with the same rules as evening filing; near-repeat waits on a tap
    await ss.locator('#sbar button', { hasText: 'End' }).click();
    for (let i = 0; i < 50 && !(((await sess()) || {}).status === 'ended' && /Session saved/.test((await msgs(ss)).slice(-1)[0].text)); i++) await ss.waitForTimeout(100);
    await ss.waitForTimeout(400);
    S1 = await sess();
    ok('session ended with summary, counts and cards', S1.weakSpots.length === 3 && S1.connections.includes('Why the kidneys hold sodium') && S1.status === 'ended' && /tonicity/.test(S1.summary) && S1.checks === 1 && S1.questions === 2 && S1.cardCount === 2 && S1.minutes >= 14, JSON.stringify({ st: S1.status, m: S1.minutes, c: S1.checks, q: S1.questions }));
    const wsNew = await ss.evaluate(() => Object.entries(window.__db.weakspots).filter(([, w]) => /Study session/.test(w.addedBy || '') || /^E\.V\. Home · /.test(w.source || '') || /Study session/.test(w.source || '')).map(([id, w]) => ({ id, ...w })));
    ok('new weak spot (objective) and note to-do, as Facts', wsNew.some(w => w.topic === 'Hypotonic vs isotonic fluid shifts' && w.kind === 'concept' && !w.derived && w.writer === 'page') && wsNew.some(w => w.kind === 'note' && /hypertonic/.test(w.topic)), wsNew.map(w => w.topic).join(' | '));
    ok('exact repeat bumps the existing weak spot', await ss.evaluate(() => Object.values(window.__db.weakspots['ws-2026-10-17-E4-3-hypokalemia-findings'].events || {}).some(e => e.type === 'seen' && e.by === 'Study session')));
    ok('ideas kept from the session', await ss.evaluate(() => Object.values(window.__db.ideas).filter(i => i.by === 'Study session' && /^Study session · /.test(i.source)).length === 2));
    ok('near-repeat waits on Matt', S1.pending && S1.pending.ws1 && S1.pending.ws1.candidate.id === 'ws-2026-10-17-E4-3-fluid-volume-excess', JSON.stringify(S1.pending));
    const card = ss.locator('#thread .msg.ev').last();
    ok('wrap-up card: summary, sections, Quizlet copy, same-or-different', /Session saved/.test((await msgs(ss)).slice(-1)[0].text) && /Worked through IV fluid tonicity/.test(await card.textContent()) && (await card.locator('button', { hasText: 'Copy 2 cards for Quizlet' }).count()) === 1 && (await card.locator('button', { hasText: 'Same' }).count()) === 1);
    ok('bar gone after the session', await ss.isHidden('#sbar'));
    await ss.screenshot({ path: `${shots}/session-wrap.png`, fullPage: true });
    await card.locator('button', { hasText: 'Same' }).click(); await ss.waitForTimeout(400);
    S1 = await sess();
    ok('same: bumps the old weak spot and clears the question', S1.pending.ws1 === null && await ss.evaluate(() => Object.values(window.__db.weakspots['ws-2026-10-17-E4-3-fluid-volume-excess'].events || {}).some(e => e.type === 'seen' && e.by === 'Study session')));
    ok('Record lists the session', await (async () => { await ss.click('#tab-record'); await ss.waitForTimeout(150); const t = await ss.textContent('#sessions'); await ss.click('#tab-ev'); return /Fluids and electrolytes/.test(t); })());
    ok('back on E.V., the newest message is in view', await ss.evaluate(() => { const r = [...document.querySelectorAll('#thread .msg')].pop().getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
    await ss.setViewportSize({ width: 1280, height: 860 }); await ss.waitForTimeout(300);
    await ss.screenshot({ path: `${shots}/session-wrap-desktop.png`, fullPage: false });
    await ss.setViewportSize({ width: 390, height: 844 }); await ss.waitForTimeout(200);
    ok('session: no sideways scroll', !(await ss.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
    ok('session: no page errors', sErr.length === 0, sErr.join(' | '));
    await ss.close();
  }
  await browser.close();
  for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : '');
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? `SOME FAILED: ${failed} of ${results.length}` : `ALL PASSED: ${results.length} checks`);
  process.exit(failed ? 1 : 0);
})().catch(e => { for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : ''); console.log('CRASHED', e.message.split('\n').slice(0, 14).join('\n')); process.exit(1); });
