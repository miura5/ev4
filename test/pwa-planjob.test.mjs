// B-459: a study plan job runs to its end inside the Worker (pwa/planjob.js), whatever the page does: POST
// /api/jobs/<id>/run answers 202 at once and hands the run to the job's Durable Object, whose alarm runs it over D1.
// Here the Worker runs over an in-memory SQLite standing in for D1, a stand-in Durable Object namespace, and a stand-in
// Claude API answering with the job stub (pwa/job-stub.mjs). Nothing reaches the Claude API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import worker from '../pwa/worker.js';
import { PlanJob, runPlanJob, PLAN_DEADLINE_MS } from '../pwa/planjob.js';
import { apiUrl } from '../pwa/claude.js';
import { jobReply } from '../pwa/job-stub.mjs';
import { seedRecord } from '../pwa/seed.mjs';
import { jobsSpec } from '../tools/build-pwa.mjs';
import { staleRuns, STALE_MS, FIX_MIN_MS, APP_SOURCE } from '../pwa/jobs.mjs';
import { PLANTS } from '../pwa/job-stub.mjs';
import EV from '../core/evcore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = jobsSpec(ROOT);

function fakeD1(now) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8'));
  const ins = sql.prepare('INSERT INTO docs (c, id, data, at, v) VALUES (?, ?, ?, ?, 1)');
  for (const [c, docs] of Object.entries(seedRecord(now)))
    for (const [id, d] of Object.entries(docs)) ins.run(c, id, JSON.stringify(d), now.getTime());
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
  });
  return {
    sql,
    prepare: q => stmt(q),
    batch: async list => {
      sql.exec('BEGIN');
      try {
        const out = [];
        for (const s of list) out.push(await s.all());
        sql.exec('COMMIT');
        return out;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** A Durable Object namespace standing in for PLAN_JOBS: one PlanJob per name, its storage a Map, alarms recorded. */
function fakeNamespace(envRef) {
  const objects = new Map();
  return {
    objects,
    idFromName: name => name,
    get(name) {
      if (!objects.has(name)) {
        const data = new Map();
        const storage = {
          data,
          alarms: [],
          get: async k => data.get(k),
          put: async (k, v) => {
            if (typeof k === 'object') for (const [a, b] of Object.entries(k)) data.set(a, structuredClone(b));
            else data.set(k, structuredClone(v));
          },
          setAlarm: async at => storage.alarms.push(at),
        };
        objects.set(name, new PlanJob({ storage }, envRef.env));
      }
      const obj = objects.get(name);
      return { fetch: (req, init) => obj.fetch(req instanceof Request ? req : new Request(req, init)) };
    },
  };
}

/** The Worker's env over a fresh D1 holding the synthetic record and one new-plan job, and a Claude stand-in. */
function setup({
  reply = body => jobReply(body),
  brief = 'A new study plan for E4.',
  title = 'NUR 112 study plan',
  at = null, // the job's `at`, as the phone's clock sets it
  storedAt = null, // when D1 stored the job, on the Worker's clock
} = {}) {
  const now = new Date();
  const jobAt = at || now;
  const ref = {};
  const env = {
    EV_TOKEN: 't',
    ANTHROPIC_API_KEY: 'k',
    DB: fakeD1(now),
    ASSETS: {
      fetch: req =>
        new URL(req.url).pathname === '/jobs-spec.json'
          ? new Response(JSON.stringify(SPEC))
          : new Response('', { status: 404 }),
    },
  };
  ref.env = env;
  env.PLAN_JOBS = fakeNamespace(ref);
  const id = 'job-20261028-newplan-nur112-9';
  const job = {
    schema: 2,
    writer: 'page',
    at: jobAt.toISOString(),
    source: 'E.V. Home',
    kind: 'exam-plan',
    title,
    brief,
    course: 'NUR 112',
    fired: { at: now.toISOString(), ok: true },
  };
  env.DB.sql
    .prepare('INSERT INTO docs (c, id, data, at, v) VALUES (?, ?, ?, ?, 1)')
    .run('jobs', id, JSON.stringify(job), (storedAt || now).getTime());
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url: String(url), body });
    const aborted = new Promise((_, no) => {
      if (init.signal) init.signal.addEventListener('abort', () => no(new Error('This operation was aborted')));
    });
    const r = await Promise.race([reply(body), aborted]);
    if (r instanceof Response) return r;
    return new Response(JSON.stringify({ ...r, usage: { input_tokens: 1000, output_tokens: 500 } }), { status: 200 });
  };
  const restore = () => (globalThis.fetch = realFetch);
  const start = async (jobId = id) => {
    const r = await worker.fetch(
      new Request('https://ev.example/api/jobs/' + encodeURIComponent(jobId) + '/run', {
        method: 'POST',
        headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
        body: JSON.stringify({ release: 'v4.5.14+test' }),
      }),
      env
    );
    return { status: r.status, body: await r.json() };
  };
  const doc = (c, docId = id) => {
    const row = env.DB.sql.prepare('SELECT data FROM docs WHERE c = ? AND id = ?').get(c, docId);
    return row ? JSON.parse(row.data) : null;
  };
  const object = () => env.PLAN_JOBS.objects.get(id);
  const claims = () => env.DB.sql.prepare('SELECT n FROM claude_plan_asks WHERE job = ?').get(id);
  const used = () => Number(env.DB.sql.prepare('SELECT COALESCE(SUM(tokens), 0) AS t FROM claude_usage').get().t);
  return { env, id, sent, restore, start, doc, object, claims, used };
}

test('B-459: starting a plan job answers 202 at once, before any ask; the run is the alarm’s', async () => {
  const s = setup();
  try {
    const r = await s.start();
    assert.equal(r.status, 202);
    assert.deepEqual(r.body, { job: s.id, started: true, state: 'queued' });
    assert.equal(s.sent.length, 0, 'nothing is asked before the 202');
    assert.equal(s.doc('jobresults'), null, 'queued: no jobresult yet');
    assert.equal(s.object().state.storage.alarms.length, 1, 'the alarm is set to run it');
  } finally {
    s.restore();
  }
});

test('B-459: the alarm runs the plan to done in the Worker, through the Worker’s own Sonnet binding', async () => {
  const s = setup();
  try {
    await s.start();
    await s.object().alarm();
    const res = s.doc('jobresults');
    assert.equal(res.status, 'done', JSON.stringify(res.error));
    assert.equal(res.source, 'E.V. app');
    assert.ok(res.finishedAt);
    assert.ok(s.sent.length >= 1 && s.sent.length <= 2, s.sent.length + ' asks');
    assert.ok(s.sent.every(x => x.url === 'https://api.anthropic.com/v1/messages'));
    assert.equal(s.sent[0].body.model, 'claude-sonnet-5-5', 'the Worker picks Sonnet for the make ask');
    assert.equal(s.sent[0].body.max_tokens, 24000);
    assert.equal(s.claims().n, s.sent.length, 'each Sonnet ask is claimed against the job’s cap');
    assert.ok(s.used() > 0, 'the tokens are counted');
    const plans = s.env.DB.sql
      .prepare("SELECT data FROM docs WHERE c = 'plans'")
      .all()
      .map(r => JSON.parse(r.data));
    assert.ok(
      plans.some(p => p.writer === 'worker' && p.source === 'E.V. app'),
      'the plan is in D1'
    );
    assert.equal(s.object().state.storage.data.get('run').state, 'ended');
  } finally {
    s.restore();
  }
});

test('B-459: one tap starts one run: a second start, a second alarm and a start after the end ask nothing more', async () => {
  const s = setup();
  try {
    await s.start();
    const again = await s.start();
    assert.equal(again.status, 202);
    assert.equal(again.body.started, false);
    assert.equal(s.object().state.storage.alarms.length, 1, 'one alarm');
    await s.object().alarm();
    const asks = s.sent.length;
    await s.object().alarm();
    const after = await s.start();
    assert.equal(after.status, 409);
    assert.equal(after.body.state, 'done');
    assert.equal(s.sent.length, asks, 'no ask after the run ended');
  } finally {
    s.restore();
  }
});

test('B-459: a refused ask ends failed with Claude’s reason, and gives the Sonnet claim back', async () => {
  const s = setup({
    reply: () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad thing' } }), {
        status: 400,
      }),
  });
  try {
    await s.start();
    await s.object().alarm();
    const res = s.doc('jobresults');
    assert.equal(res.status, 'failed');
    assert.match(res.error, /Claude refused the ask \(400\): bad thing/);
    assert.equal(s.claims().n, 0, 'a refusal gives its claim back');
  } finally {
    s.restore();
  }
});

test('B-459: past the deadline the ask is aborted and the run failed with a plain reason; the aborted ask keeps its claim and counts an estimate', async () => {
  const s = setup({ reply: () => new Promise(() => {}) }); // Claude never answers
  try {
    const out = await runPlanJob({ env: s.env, jobId: s.id, jobsSpec: SPEC, release: 'v4', deadlineMs: 80 });
    assert.equal(out.status, 'failed');
    const res = s.doc('jobresults');
    assert.equal(res.status, 'failed');
    assert.match(res.error, /took longer than \d+ minutes, so E\.V\. stopped it\. Try again\./);
    assert.ok(res.finishedAt);
    assert.equal(s.claims().n, 1, 'the claim stays');
    assert.ok(
      s.used() >= 24000 * 3,
      'a conservative estimate (its whole answer allowance at Sonnet’s weight) is counted'
    );
  } finally {
    s.restore();
  }
});

test('B-459: an alarm that finds its run started but never ended marks it failed, and asks nothing', async () => {
  const s = setup();
  try {
    await s.start();
    const st = s.object().state.storage;
    // the run was cut (the object reset mid-run) after the runner wrote running
    const run = st.data.get('run');
    st.data.set('run', { ...run, state: 'running' });
    const at = new Date().toISOString();
    s.env.DB.sql.prepare('INSERT INTO docs (c, id, data, at, v) VALUES (?, ?, ?, ?, 1)').run(
      'jobresults',
      s.id,
      JSON.stringify({
        ...EV.envelope('worker', 'E.V. app', new Date()),
        schema: 2,
        release: 'v4',
        status: 'running',
        startedAt: at,
        finishedAt: null,
        result: null,
        message: null,
        error: null,
      }),
      Date.now()
    );
    await s.object().alarm();
    const res = s.doc('jobresults');
    assert.equal(res.status, 'failed');
    assert.match(res.error, /stopped before it finished/);
    assert.equal(res.startedAt, at, 'its start is kept');
    assert.equal(s.sent.length, 0);
  } finally {
    s.restore();
  }
});

test('B-459: only a study plan job starts here; ids are checked', async () => {
  const s = setup();
  try {
    assert.equal((await s.start('job-nope')).status, 404);
    assert.equal((await s.start('bad id!')).status, 400);
    const noAuth = await worker.fetch(new Request('https://ev.example/api/jobs/x/run', { method: 'POST' }), s.env);
    assert.equal(noAuth.status, 401);
  } finally {
    s.restore();
  }
});

test('B-459: the page’s stall rule waits past the Worker’s deadline, so the Worker’s own reason lands first', () => {
  const now = Date.now();
  const iso = ms => new Date(now - ms).toISOString();
  const j = { kind: 'exam-plan', status: 'running', at: iso(PLAN_DEADLINE_MS + 90000) };
  assert.equal(EV.studyPlanJobStalled({ ...j, startedAt: iso(PLAN_DEADLINE_MS + 60000) }, now), null);
  // held past the alarm's 15-minute wall limit too: a stall never frees the guard while the Worker could still run it
  assert.equal(EV.studyPlanJobStalled({ ...j, startedAt: iso(15 * 60000 + 60000) }, now), null);
  assert.ok(EV.studyPlanJobStalled({ ...j, startedAt: iso(STALE_MS + 60000) }, now));
  // queued (no jobresult): the Worker writes running within seconds of the 202, so 2 minutes still means it never began
  assert.ok(EV.studyPlanJobStalled({ kind: 'exam-plan', status: 'queued', at: iso(3 * 60000) }, now));
});

test('B-459: the API URL override is honoured only on this machine (the local smoke’s stand-in)', () => {
  assert.equal(apiUrl({}), 'https://api.anthropic.com/v1/messages');
  assert.equal(apiUrl({ CLAUDE_API_URL: 'http://127.0.0.1:4321/v1/messages' }), 'http://127.0.0.1:4321/v1/messages');
  assert.equal(apiUrl({ CLAUDE_API_URL: 'https://evil.example/v1/messages' }), 'https://api.anthropic.com/v1/messages');
  assert.equal(
    apiUrl({ CLAUDE_API_URL: 'http://127.0.0.1.evil.example:80/' }),
    'https://api.anthropic.com/v1/messages'
  );
});

test('B-459: a fix ask goes only with enough time left before the deadline; else the first plan is saved', async () => {
  // PLANT-LOW scores itself under the bar on the first ask, so it would get its one fix ask
  const roomy = setup({ title: PLANTS.low + ' NUR 112' });
  try {
    await runPlanJob({ env: roomy.env, jobId: roomy.id, jobsSpec: SPEC, release: 'v4' });
    assert.equal(roomy.sent.length, 2, 'with time left: the make ask and its fix ask');
  } finally {
    roomy.restore();
  }
  const tight = setup({ title: PLANTS.low + ' NUR 112' });
  try {
    await runPlanJob({ env: tight.env, jobId: tight.id, jobsSpec: SPEC, release: 'v4', deadlineMs: FIX_MIN_MS - 1000 });
    assert.equal(tight.sent.length, 1, 'too little time: no fix ask');
    assert.equal(tight.doc('jobresults').status, 'done', 'the first plan is saved as it is');
  } finally {
    tight.restore();
  }
});

test('B-459: a job D1 stored longer ago than the start window is failed unrun, so it never races a second tap', async () => {
  const s = setup({ storedAt: new Date(Date.now() - 3 * 60000) });
  try {
    await s.start();
    await s.object().alarm();
    const res = s.doc('jobresults');
    assert.equal(res.status, 'failed');
    assert.match(res.error, /didn’t start in time/);
    assert.equal(s.sent.length, 0);
  } finally {
    s.restore();
  }
});

test('B-459: the start window reads the Worker’s clock, not the phone’s: a phone 10 minutes behind still gets its plan', async () => {
  const s = setup({ at: new Date(Date.now() - 10 * 60000) });
  try {
    await s.start();
    await s.object().alarm();
    assert.equal(s.doc('jobresults').status, 'done', JSON.stringify(s.doc('jobresults').error));
  } finally {
    s.restore();
  }
});

test('B-459: every Worker config the workflows generate (the scratch and copy targets) gives node:fs, node:path and node:url their stand-ins', () => {
  const ALIASES = ['"node:fs" = "./node-fs.mjs"', '"node:path" = "./node-path.mjs"', '"node:url" = "./node-url.mjs"'];
  const main = fs.readFileSync(path.join(ROOT, 'pwa/wrangler.toml'), 'utf8');
  for (const a of ALIASES) assert.ok(main.includes(a), 'wrangler.toml: ' + a);
  let n = 0;
  for (const wf of ['pwa-staging.yml', 'pwa-live.yml']) {
    const text = fs.readFileSync(path.join(ROOT, '.github/workflows', wf), 'utf8');
    for (const line of text.split('\n').filter(l => /printf '[^']*main = "worker\.js"/.test(l))) {
      const cmd = line.trim().replace(/>\s*\S+\.toml\s*$/, '');
      const toml = execFileSync('bash', ['-c', cmd], {
        env: { ...process.env, id: '00000000-0000-0000-0000-000000000000', COPY_D1: 'ev-staging-scratch' },
      }).toString();
      assert.match(toml, /^main = "worker\.js"$/m, wf);
      assert.match(toml, /^\[alias\]$/m, wf + ': an [alias] table');
      for (const a of ALIASES) assert.ok(toml.includes(a), `${wf}: ${a}`);
      n++;
    }
  }
  assert.equal(n, 2, 'the staging copy target and the live scratch Worker');
});

test('B-459: at boot the app marks failed its jobs still running past the stale window, and only those', () => {
  const now = Date.parse('2026-10-28T14:00:00Z');
  const r = (id, status, mins, source = APP_SOURCE) => ({
    id,
    status,
    source,
    startedAt: new Date(now - mins * 60000).toISOString(),
  });
  const db = {
    jobresults: [
      r('old-running', 'running', 121), // Matt's 11:58 job
      r('fresh-running', 'running', 5),
      r('just-under', 'running', STALE_MS / 60000 - 1),
      r('old-done', 'done', 300),
      r('cloud-running', 'running', 300, 'E.V. worker run'),
    ],
  };
  assert.deepEqual(staleRuns(db, now), ['old-running']);
  assert.ok(STALE_MS > PLAN_DEADLINE_MS + 60000, 'past the Worker deadline and its wall limit');
  const bridge = fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8');
  assert.match(bridge, /if \(net\.online\) failStale\(\);/, 'run at boot');
  assert.match(bridge, /J\.staleRuns\(all\)/);
  assert.match(bridge, /batch\(\[w\], J\.asRunDb\(db\)\)/, 'through the app’s own batch, never by hand');
});

test('B-459: the page sends every study plan job, new or a change, to the app, and reports a declined hand-off as not started', () => {
  const js = fs.readFileSync(path.join(ROOT, 'page/app/62-ev-jobs-and-filing.js'), 'utf8');
  assert.match(
    js,
    /if \(kind === 'exam-plan' && !inApp\(\)\)\s*return \{ id: null, fired: \{ at: now\(\), ok: false, error: 'app_only' \} \};/
  );
  assert.doesNotMatch(js, /kind === 'exam-plan' && !revise && !inApp\(\)/);
  // the hand-off counts as started only when the saved job says it was made
  assert.match(js, /if \(f && f\.ok === true\) return \{ id, fired: \{ at: f\.at \|\| fired\.at, ok: true \} \};/);
  assert.doesNotMatch(js, /inApp\(\)\) return \{ id, fired: \{ at: fired\.at, ok: true \} \}/);
  const bridge = fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8');
  assert.match(
    bridge,
    /\(doc\.kind === 'exam-plan' \? startWorkerJob : runAppJob\)\(id\)/,
    'a plan job runs in the Worker'
  );
});
