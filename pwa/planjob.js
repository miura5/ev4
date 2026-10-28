// B-459: a study plan job (an exam-plan make with its one fix ask, or a plan edit) runs to its end inside the Worker,
// whatever the page does. The page saves jobs/<id> as before, then asks POST /api/jobs/<id>/run once; the Worker answers
// 202 at once and hands the run to a Durable Object, one per job (PlanJob, keyed by the job id), whose alarm runs the
// same job runner the page used (jobs.mjs runJob: the brief, the asks, the checks and the fold), against D1 directly.
// The page reads the result from jobresults/<id> as it already does. Why an alarm: ctx.waitUntil lasts only 30 s once
// the page has gone, and a Free plan request has 10 ms of CPU; a Durable Object alarm has 15 minutes of wall time and
// 30 s of CPU, on the Free plan too (SQLite-backed).
//   - One run per job: the object starts at most one run, whatever is asked again (two tabs, a retry, a second tap).
//   - The jobresult goes none (queued) -> running -> done or failed: the runner writes running before its first ask;
//     PLAN_DEADLINE_MS after the alarm starts, a run not yet ended has its ask aborted and is marked failed with a
//     plain reason; an alarm that finds its run started but never ended (the object was reset mid-run) marks it
//     failed; a job written more than PLAN_START_MS before its alarm runs is failed unrun (the page has freed it).
//   - The Worker's Sonnet binding holds unchanged: each ask goes through handleClaude (claude.js), so the job check,
//     the 2-ask cap, the claim given back only on a refusal and the ceilings apply as they did to the page's asks; an ask
//     aborted at the deadline keeps its claim and counts an estimate, as a cut answer does (claude.js).
import { runJob, asRunDb, pinned, contextFor, statusWrite } from './jobs.mjs';
import { handleRun } from './runapi.js';
import { handleClaude } from './claude.js';

/** A run still going this long after its alarm started is stopped: its ask aborted, and the job marked failed. Under the
 * alarm's own 15-minute wall limit, so the Worker never runs a plan past it; a fix ask goes only with jobs.mjs
 * FIX_MIN_MS left. The page's stall rule (core studyPlanJobStalled, 20 minutes) waits past both. */
export const PLAN_DEADLINE_MS = 14 * 60000;
/** A run begins only this soon after the job was written: the page frees the course's guard 2 minutes after a job with
 * no result (core studyPlanJobStalled), so a run that began later could race a second tap's new job. */
export const PLAN_START_MS = 90000;
export const PLAN_KIND = 'exam-plan';
const JOB_ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const HERE = 'https://ev.worker';
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const post = (path, body) =>
  new Request(HERE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function docOf(env, c, id) {
  const row = await env.DB.prepare('SELECT data, v FROM docs WHERE c = ? AND id = ?').bind(c, id).first();
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data), v: row.v };
  } catch {
    return null;
  }
}

/** The whole record as the runner reads it ({collection: [{...doc, id}]}). */
async function loadDb(env) {
  const { results } = await env.DB.prepare('SELECT c, id, data FROM docs').all();
  const rec = {};
  for (const r of results || []) {
    try {
      (rec[r.c] = rec[r.c] || {})[r.id] = JSON.parse(r.data);
    } catch {}
  }
  return asRunDb(rec);
}

/** Writes through the run API's batch (handleRun), each pinned to the version D1 holds now; a 409 is a conflict. */
async function batchNow(env, writes, seen) {
  const versionOf = async (c, id) => {
    const row = await env.DB.prepare('SELECT v FROM docs WHERE c = ? AND id = ?').bind(c, id).first();
    return row ? row.v : null;
  };
  const r = await handleRun(
    post('/api/run/batch', { writes: await pinned(writes, versionOf, seen) }),
    env,
    new URL(HERE + '/api/run/batch')
  );
  if (r.status === 409) throw Object.assign(new Error('a document changed'), { conflict: true });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error('not saved (' + r.status + (b.error ? ': ' + String(b.error).slice(0, 120) : '') + ')');
  }
}

/** jobresults/<id> set to failed with `why`, unless it already ended (done or failed): true when this wrote it. */
export async function failIfRunning(env, jobId, release, why) {
  for (let tries = 0; tries < 3; tries++) {
    const res = await docOf(env, 'jobresults', jobId);
    if (res && res.data.status !== 'running') return false;
    const ctx = contextFor({ jobId, now: new Date(), release: (res && res.data.release) || release });
    if (res && res.data.startedAt) ctx.startedAt = res.data.startedAt;
    try {
      await batchNow(env, [statusWrite(ctx, 'failed', why)], res ? { jobresults: [{ id: jobId }] } : {});
      return true;
    } catch (e) {
      if (!(e && e.conflict)) throw e;
    }
  }
  return false;
}

/** An ask through the Worker's own /api/claude, its refusals turned into the errors runJob reads (as bridge.js does). */
async function askVia(env, body, signal) {
  const r = await handleClaude(post('/api/claude', body), env, new URL(HERE + '/api/claude'), { signal });
  const text = await r.text();
  let own = null;
  try {
    own = JSON.parse(text);
  } catch {}
  if (r.ok) {
    if (!own) throw new Error('the reply was not JSON');
    return own;
  }
  if (own && own.code === 'ceiling' && own.error)
    throw Object.assign(new Error(String(own.error)), {
      code: 'ceiling',
      scope: own.scope || null,
      until: Number(own.until) || null,
    });
  const said = (own && own.error && typeof own.error === 'object' ? own.error.message : own && own.error) || '';
  const words = String(said).replace(/\s+/g, ' ').trim().slice(0, 160);
  throw Object.assign(
    new Error(words ? `Claude refused the ask (${r.status}): ${words}` : 'the Worker answered ' + r.status),
    { code: words ? 'refused' : null, status: r.status }
  );
}

const minutes = ms => Math.round(ms / 60000);
/**
 * One study plan job, start to end, in the Worker: runJob over D1, stopped at `deadlineMs`. Always leaves
 * jobresults/<id> done or failed (or as the runner found it, when it skipped the job). Returns runJob's {status, said}.
 */
export async function runPlanJob({
  env,
  jobId,
  jobsSpec,
  release,
  deadlineMs = PLAN_DEADLINE_MS,
  startMs = PLAN_START_MS,
}) {
  const { spec, schemas } = jobsSpec || {};
  const began = Date.now();
  const j = await docOf(env, 'jobs', jobId);
  const at = j ? Date.parse(j.data.at) : NaN;
  if (!(began - at <= startMs)) {
    const why = 'it didn’t start in time. Try again.';
    await failIfRunning(env, jobId, release, why);
    return { status: 'failed', said: why };
  }
  let stopped = false;
  const abort = new AbortController();
  const job = (async () => {
    if (!spec || !schemas) throw new Error('the job runner’s spec was not given');
    return runJob({
      db: await loadDb(env),
      spec,
      schemas,
      jobId,
      release,
      reload: () => loadDb(env),
      timeLeft: () => deadlineMs - (Date.now() - began),
      usage: async () => {
        const r = await handleClaude(new Request(HERE + '/api/claude/usage'), env, new URL(HERE + '/api/claude/usage'));
        return r.ok ? r.json() : null;
      },
      ask: async body => {
        if (stopped) throw new Error('the run was stopped');
        return askVia(env, body, abort.signal);
      },
      write: async (writes, seen) => {
        if (stopped) throw new Error('the run was stopped'); // nothing is written past the deadline
        return batchNow(env, writes, seen);
      },
    });
  })().then(
    r => ({ r }),
    e => ({ e })
  );
  let timer;
  const deadline = new Promise(ok => (timer = setTimeout(() => ok('deadline'), deadlineMs)));
  const out = await Promise.race([job, deadline]);
  clearTimeout(timer);
  if (out === 'deadline') {
    stopped = true;
    // the ask in flight is aborted: it keeps its Sonnet claim and counts an estimate (claude.js); the run is given a
    // moment to settle that before the job is marked failed
    abort.abort();
    await Promise.race([job, new Promise(ok => setTimeout(ok, 5000))]);
    const why = `it took longer than ${minutes(deadlineMs)} minutes, so E.V. stopped it. Try again.`;
    await failIfRunning(env, jobId, release, why);
    return { status: 'failed', said: why };
  }
  if (out.e) {
    const why = 'it stopped before it finished. Try again.';
    console.log('plan job ' + jobId + ' stopped:', String((out.e && out.e.message) || out.e));
    await failIfRunning(env, jobId, release, why);
    return { status: 'failed', said: why };
  }
  return out.r;
}

/**
 * POST /api/jobs/<id>/run {release?}: starts the study plan job's run in its Durable Object and answers 202 at once
 * ({job, started, state}; started false when this job's run had already begun). 404 for no such study plan job, 409
 * when it already has a result.
 */
export async function startPlanJob(request, env, id) {
  if (!JOB_ID.test(id)) return json({ error: 'job: not a job id' }, 400);
  if (!env.PLAN_JOBS) return json({ error: 'no PLAN_JOBS Durable Object on this Worker' }, 503);
  const job = await docOf(env, 'jobs', id);
  if (!job || job.data.kind !== PLAN_KIND) return json({ error: `jobs/${id} is no study plan job` }, 404);
  const res = await docOf(env, 'jobresults', id);
  if (res && res.data.status !== 'running') return json({ job: id, started: false, state: res.data.status }, 409);
  let body = {};
  try {
    body = await request.json();
  } catch {}
  const release = typeof body.release === 'string' && body.release.length <= 60 ? body.release : 'v4';
  // the runner's spec and schemas, as this release publishes them for the page (tools/build-pwa.mjs jobs-spec.json)
  const a = await env.ASSETS.fetch(new Request(new URL('/jobs-spec.json', request.url)));
  if (!a.ok) return json({ error: 'jobs-spec.json answered ' + a.status }, 503);
  const jobsSpec = await a.json();
  const stub = env.PLAN_JOBS.get(env.PLAN_JOBS.idFromName(id));
  const r = await stub.fetch(post('/start', { job: id, release, jobsSpec }));
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}

/** The Durable Object: one per study plan job. Its storage holds the run's state and the spec it runs with. */
export class PlanJob {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let b;
    try {
      b = await request.json();
    } catch {
      return json({ error: 'the body is not JSON' }, 400);
    }
    const had = await this.state.storage.get('run');
    if (had) return json({ job: had.job, started: false, state: had.state }, 202);
    if (!b || !JOB_ID.test(String(b.job)) || !b.jobsSpec)
      return json({ error: 'start: {job, release, jobsSpec}' }, 400);
    await this.state.storage.put({
      run: { job: b.job, release: b.release || 'v4', state: 'queued', at: Date.now() },
      spec: b.jobsSpec,
    });
    await this.state.storage.setAlarm(Date.now());
    return json({ job: b.job, started: true, state: 'queued' }, 202);
  }

  async alarm() {
    const st = this.state.storage;
    const run = await st.get('run');
    if (!run) return;
    if (run.state === 'queued') {
      // marked before it runs: an alarm that finds it running again knows the run was cut, and never runs it twice
      await st.put('run', { ...run, state: 'running', startedAt: Date.now() });
      let out;
      try {
        out = await runPlanJob({ env: this.env, jobId: run.job, jobsSpec: await st.get('spec'), release: run.release });
      } catch (e) {
        out = { status: 'failed', said: String((e && e.message) || e).slice(0, 200) };
      }
      await st.put('run', { ...run, state: 'ended', status: out.status, said: out.said, endedAt: Date.now() });
      return;
    }
    if (run.state === 'running') {
      try {
        await failIfRunning(this.env, run.job, run.release, 'it stopped before it finished. Try again.');
      } catch (e) {
        console.log('plan job ' + run.job + ': not marked failed:', String(e));
      }
      await st.put('run', { ...run, state: 'ended', status: 'failed', endedAt: Date.now() });
    }
  }
}
