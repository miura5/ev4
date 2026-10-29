// B-521 (UX map F-12, F-13): a long job (a plan, or any background job) shows that it is working, with how long so far,
// and a job that failed (or a plan that stalled) shows as failed everywhere in plain words: her status, the job's card
// and the plan card, whose button stays Make a plan. The page's side runs in test/harness/run.cjs (Make a plan, notice).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import EV from '../core/evcore.mjs';
import './core-fixtures.mjs';

const app = n => fs.readFileSync(new URL('../page/app/' + n, import.meta.url), 'utf8');
const jobs = app('62-ev-jobs-and-filing.js');

/** The page's elapsedWords and jobSince, run as written. */
function helpers() {
  const src = ['const jobSince', 'function elapsedWords'].map(k => {
    const at = jobs.indexOf(k);
    const end = jobs.indexOf('\n    }\n', jobs.indexOf('{', at)) + 6;
    return k === 'const jobSince' ? jobs.slice(at, jobs.indexOf(';\n', at) + 1) : jobs.slice(at, end);
  });
  const ctx = {};
  vm.runInNewContext(src.join('\n') + '\nthis.jobSince = jobSince; this.elapsedWords = elapsedWords;', ctx);
  return ctx;
}

test('B-521: elapsed time reads in plain units, seconds kept only while it is short', () => {
  const { elapsedWords } = helpers();
  assert.equal(elapsedWords(0), '0 s');
  assert.equal(elapsedWords(42000), '42 s');
  assert.equal(elapsedWords(80000), '1 min 20 s');
  assert.equal(elapsedWords(9 * 60000), '9 min');
  assert.equal(elapsedWords(14 * 60000 + 5000), '14 min');
  assert.equal(elapsedWords(75 * 60000), '1 h 15 min');
});

test('B-521: a job is timed from its run, else its hand-off, else when it was asked', () => {
  const { jobSince } = helpers();
  assert.equal(jobSince({ startedAt: 'b', fired: { at: 'a' }, createdAt: 'c' }), 'b');
  assert.equal(jobSince({ fired: { at: 'a' }, createdAt: 'c' }), 'a');
  assert.equal(jobSince({ createdAt: 'c' }), 'c');
  assert.equal(jobSince(null), null);
});

test('B-521: running and waiting jobs are live on their card; a stalled plan is never "working"', () => {
  assert.match(jobs, /live: 'Working' \}/);
  assert.match(jobs, /live: 'Waiting to start',/);
  assert.match(jobs, /!E\.studyPlanJobStalled\(j\) && \/\/ B-521/);
  assert.match(
    app('67-ev-cards.js'),
    /if \(st\.live\) box\.append\(liveSince\(jobSince\(j\), st\.live, 'meta job-since'\)\)/
  );
  const now = Date.parse('2026-10-29T15:00:00Z');
  const job = {
    kind: 'exam-plan',
    course: 'NUR 112',
    at: '2026-10-29T14:55:00Z',
    status: 'queued',
    fired: { ok: true },
  };
  assert.ok(EV.studyPlanJobStalled(job, now), 'no result 5 minutes on: stalled');
});

test('B-521 (F-12): her status says working with how long, and a failure in plain words, never "something’s ready"', () => {
  const r = app('74-ev-render-and-composer.js');
  assert.match(r, /const jobFailed = j => j\.status === 'failed' \|\| !!E\.studyPlanJobStalled\(j\);/);
  assert.match(r, /bad\.kind === 'exam-plan' \? 'your plan didn’t finish' : 'a job didn’t finish'/);
  assert.match(r, /\? NT\.failed \|\| 'something’s ready'/);
  assert.match(r, /\? workingWord\(liveJobs\(\)\)/);
  assert.doesNotMatch(r, /running\s*\?\s*'thinking…'/);
});

test('B-521 (F-13): the plan card says it is making the plan, how long, and its button is Make a plan in every state', () => {
  const p = app('21-study-plan.js');
  assert.doesNotMatch(p, /'Making…'|'Try again'/);
  assert.match(p, /planWorking\(making, 'Making your plan'\)/);
  assert.match(p, /liveSince\(jobSince\(j\), words, 'pl-since'\)/);
});
