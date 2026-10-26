// B-315: the run protocol's target is chosen per record. Staging's cloud runs read and write the staging Worker's run
// API (its address and token from system/worker, D-320), printed as `node core/cli.mjs api ...` commands; live (and
// the Mac lane) keep ArtifactData until B-320 and B-317. Proved on the evening-cloud pipeline end to end against a
// stand-in Worker (test/fake-worker.mjs) holding the made-up record: start, pull, compute, a batch refused on its pin
// and re-planned, apply, end, the audit, and the token in no printed line, file or rendered prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import EV from '../core/evcore.mjs';
import { loadValidator } from '../core/schemas.mjs';
import * as RUN from '../core/run.mjs';
import { renderPrompt } from '../tools/prompts.mjs';
import { ROOT, preCutoverSpec } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const AT = '2026-10-17T01:15:00Z';
const TOKEN = 'planted-test-token-' + 'x7Q9'.repeat(6);
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

async function fakeWorker() {
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'test/fake-worker.mjs'), TOKEN, path.join(ROOT, 'test/data/record')],
    {
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', d => {
      const m = /port (\d+)/.exec(String(d));
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', c => reject(new Error('fake worker exited ' + c)));
  });
  const url = `http://127.0.0.1:${port}`;
  const get = p => JSON.parse(execFileSync('curl', ['-sS', '--noproxy', '*', url + p], { encoding: 'utf8' }));
  return { url, child, get };
}
/** Runs a printed api command as a run would (from the checkout), with the session's output collected. */
function runApi(call, out) {
  assert.equal(call.tool, 'Bash');
  assert.match(call.args.command, /^node core\/cli\.mjs api (pull|batch|set) /);
  try {
    const s = execFileSync(process.execPath, call.args.command.split(' ').slice(1), {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' },
    });
    out.push(s);
    return { code: 0, out: s };
  } catch (e) {
    out.push(String(e.stdout) + String(e.stderr));
    return { code: e.status, out: String(e.stdout) };
  }
}
const bash = (seq, command) => {
  const id = 'b' + seq;
  return [
    JSON.stringify({
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id, name: 'Bash', input: { command: `cd ${ROOT} && ${command}`, description: 'run' } },
        ],
      },
    }),
    JSON.stringify({
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'ok' }] }],
      },
    }),
  ];
};
const apiCallOf = command => ({ tool: 'Bash', args: { command } });
const filesUnder = d =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? filesUnder(path.join(d, e.name)) : [path.join(d, e.name)]));

test("the target is per record: staging's and (since the cutover) live's Worker pipelines go to the Worker; the diagnostic keeps ArtifactData", () => {
  const pre = preCutoverSpec(spec);
  for (const p of ['morning', 'evening-cloud', 'weekly', 'worker', 'watchdog', 'evening-mac', 'restore-drill']) {
    assert.equal(RUN.runTarget(spec, 'staging', p), 'worker', p);
    // B-320: the cutover moved every live pipeline to the ev-live Worker
    assert.equal(RUN.runTarget(spec, 'live', p), 'worker', p);
    assert.equal(RUN.runTarget(pre, 'staging', p), 'worker', p);
  }
  // before the cutover live kept ArtifactData
  for (const p of ['morning', 'evening-cloud', 'weekly', 'worker', 'watchdog', 'evening-mac'])
    assert.equal(RUN.runTarget(pre, 'live', p), 'artifact', p);
  assert.equal(pre.registry.records.live.runs, undefined);
  // the diagnostic keeps ArtifactData (its probes test that store).
  assert.equal(RUN.runTarget(spec, 'staging', 'diagnostic'), 'artifact');
  assert.equal(RUN.runTarget(spec, 'live', 'diagnostic'), 'artifact');
});

test('a record off the Worker (live before the cutover) still prints ArtifactData at every move; live now needs its Worker file', () => {
  // B-320: since the cutover live is on the Worker, so a live run without its saved Worker file stops at start
  assert.throws(
    () =>
      RUN.start({
        spec,
        pipeline: 'evening-cloud',
        record: 'live',
        at: AT,
        dir: tmp('ev4-live-'),
        release: 'v',
        worker: '/nonexistent',
      }),
    /no Worker file at \/nonexistent.*get system\/worker/
  );
  const pre = preCutoverSpec(spec);
  const dir = tmp('ev4-live-');
  const s = RUN.start({
    spec: pre,
    pipeline: 'evening-cloud',
    record: 'live',
    at: AT,
    dir,
    release: 'v4.0.0',
    worker: '/nonexistent',
  });
  assert.deepEqual(
    [s[0].tool, s[0].args.action, s[0].args.url],
    ['ArtifactData', 'set', 'https://claude.ai/artifact/' + spec.registry.records.live.artifact]
  );
  const pulls = RUN.pull({ spec: pre, dir, at: AT });
  assert.ok(pulls.length && pulls.every(c => c.tool === 'ArtifactData'));
  const e = RUN.end({ dir, at: AT, status: 'failed', detail: 'pull: test', transcript: null });
  assert.equal(e[0].tool, 'ArtifactData');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).target, 'artifact');
});

test('a staging run without its saved Worker file stops at start, naming the file and never a value', () => {
  const dir = tmp('ev4-stg-');
  const bad = path.join(tmp('ev4-w-'), 'worker.json');
  assert.throws(
    () => RUN.start({ spec, pipeline: 'evening-cloud', record: 'staging', at: AT, dir, release: 'v', worker: bad }),
    /no Worker file at .*get system\/worker/
  );
  fs.writeFileSync(bad, JSON.stringify({ url: 'https://x.example', token: 'short' }));
  assert.throws(
    () => RUN.start({ spec, pipeline: 'evening-cloud', record: 'staging', at: AT, dir, release: 'v', worker: bad }),
    e => /no usable token/.test(e.message) && !e.message.includes('short')
  );
});

test('a staging run end to end through the run API: pinned writes, a refused batch re-planned, runs/<id> read back', async () => {
  const fw = await fakeWorker();
  try {
    const wdir = tmp('ev4-w-');
    const worker = path.join(wdir, 'worker.json');
    fs.writeFileSync(worker, JSON.stringify({ schema: 1, url: fw.url, token: TOKEN }));
    const dir = tmp('ev4-stg-');
    const out = [];
    const transcript = [];
    let seq = 0;
    const make = calls =>
      calls.map(c => {
        transcript.push(...bash(++seq, c.args.command));
        return runApi(c, out);
      });

    const start = RUN.start({
      spec,
      pipeline: 'evening-cloud',
      record: 'staging',
      at: AT,
      dir,
      release: 'v4.0.0',
      worker,
    });
    assert.equal(start.length, 1);
    const id = RUN.runIdFor('evening-cloud', AT);
    assert.deepEqual(
      make(start).map(r => r.code),
      [0]
    );
    assert.equal(fw.get('/_dump')['runs/' + id].v, 1);

    // Every read is one printed command (runs given one command per read looped them in the shell, Oct 25).
    const pulls = RUN.pull({ spec, dir, at: AT });
    assert.equal(pulls.length, 1);
    assert.match(pulls[0].args.command, /^node core\/cli\.mjs api pull --reads \S+ --worker \S+$/);
    const reads = spec.pipelines['evening-cloud'].reads;
    const planned = JSON.parse(fs.readFileSync(pulls[0].args.command.split(' ')[5], 'utf8'));
    assert.deepEqual(
      planned.map(r => [r.collection, !!r.since]),
      reads.map(r => [r.collection, !!r.windowDays])
    );
    assert.throws(() => RUN.pulled({ spec, dir, transcript: '' }), /no pull result for/);
    assert.deepEqual(
      make(pulls).map(r => r.code),
      [0]
    );
    // A windowed read (ArtifactData's query on at) saves only the documents in the window, and keeps every version.
    const winReads = path.join(dir, 'win-reads.json');
    fs.writeFileSync(
      winReads,
      JSON.stringify([{ collection: 'exams', out_dir: `${dir}/win`, versions: `${dir}/win.json`, since: '2999-01-01' }])
    );
    const win = apiCallOf(`node core/cli.mjs api pull --reads ${winReads} --worker ${worker}`);
    assert.match(runApi(win, out).out, /api pull exams: 0 saved, versions for [1-9]/);
    assert.ok(Object.keys(JSON.parse(fs.readFileSync(`${dir}/win.json`, 'utf8'))).length > 0);
    // api list is gone: no move prints it (5c25614).
    assert.throws(
      () =>
        execFileSync(process.execPath, ['core/cli.mjs', 'api', 'list', '--collection', 'exams', '--worker', worker], {
          cwd: ROOT,
          stdio: 'pipe',
        }),
      e => /api <pull\|[^>]*\|export> \.\.\. --worker/.test(String(e.stderr))
    );
    const pulled = RUN.pulled({ spec, dir, transcript: '' });
    assert.equal(pulled.done, true);
    assert.ok(Object.keys(pulled.versions.state || {}).length || Object.keys(pulled.versions.days || {}).length);

    const plan = RUN.compute({ spec, dir, validate, at: AT });
    assert.equal(plan.status, 'planned', JSON.stringify(plan.problems));
    // Someone (the page) saves a document the plan pinned: its batch is refused whole, then re-pulled and re-pinned,
    // and the one re-planned command carries it and every batch after it.
    const pinned = plan.plan.batches[0].find(w => w.if_version != null);
    assert.ok(pinned, 'evening-cloud updates a document it read');
    fw.get(`/_bump?c=${pinned.collection}&id=${pinned.doc_id}`);
    const applied = RUN.apply({ dir });
    const batchCalls = applied.filter(c => c.tool === 'Bash');
    assert.equal(batchCalls.length, 1, 'all batches in one command');
    assert.match(batchCalls[0].args.command, / api batch --files \S+ --first 1 /);
    const first = make(batchCalls)[0];
    assert.equal(first.code, 1);
    assert.match(first.out, /api batch 1: REFUSED \(409\).*nothing in batch 1 was written.*apply --failed 1/);
    const repull = RUN.applyFailed({ dir, batch: 1 });
    assert.equal(repull.length, 1);
    assert.match(repull[0].args.command, / api pull --reads /);
    assert.deepEqual(
      make(repull).map(r => r.code),
      [0]
    );
    const re = RUN.replan({ spec, dir, batch: 1, transcript: '' });
    assert.deepEqual([re.done, re.rest, re.calls.length], [true, true, 1]);
    assert.match(re.calls[0].args.command, / api batch --files \S+ --first 1 /);
    assert.equal(
      re.calls[0].args.command.split('--files ')[1].split(' ')[0].split(',').length,
      plan.plan.batches.length
    );
    assert.deepEqual(
      make(re.calls).map(r => r.code),
      [0]
    );

    const end = RUN.end({ dir, at: AT, transcript: null });
    assert.deepEqual(
      make(end).map(r => r.code),
      [0]
    );
    const back = fw.get('/_dump')['runs/' + id];
    assert.equal(back.v, 2);
    assert.equal(back.data.status, 'ok');
    assert.ok(back.data.endedAt && back.data.planHash);
    assert.equal(fw.get('/_dump')[`${pinned.collection}/${pinned.doc_id}`].v, pinned.if_version + 2);

    // The audit holds the Bash api calls to the printed ones, a cd first or not; one not printed is caught.
    const a = RUN.audit({ dir, transcript: transcript.join('\n') });
    const okLines = transcript.slice();
    assert.deepEqual([a.ok, a.extra.length], [true, 0]);
    transcript.push(
      ...bash(++seq, `node core/cli.mjs api set --collection days --doc-id x --file /tmp/x.json --worker ${worker}`)
    );
    assert.equal(RUN.audit({ dir, transcript: transcript.join('\n') }).ok, false);
    // B-315 review: a printed command chained to one that wasn't, and a raw curl to the run routes, are extra calls.
    const auditWith = cmd => RUN.audit({ dir, transcript: [...okLines, ...bash(++seq, cmd)].join('\n') });
    const printedCmd = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')).calls.find(
      c => c.tool === 'Bash'
    ).args.command;
    // (Every call above was made as `cd <checkout> && <printed>`, and the audit held them all printed.)
    const chained = auditWith(
      `${printedCmd} && node core/cli.mjs api set --collection days --doc-id x --file /tmp/x.json --worker ${worker}`
    );
    assert.equal(chained.ok, false);
    assert.ok(
      chained.extra.some(e => / api set --collection days/.test(e.summary)),
      JSON.stringify(chained.extra)
    );
    const curl = auditWith(`curl -sS -X POST ${fw.url}/api/run/batch -d @/tmp/w.json`);
    assert.equal(curl.ok, false);
    assert.ok(
      curl.extra.some(e => /\/api\/run\/batch/.test(e.summary)),
      JSON.stringify(curl.extra)
    );
    const tokenRead = auditWith(`cat ${worker}`);
    assert.equal(tokenRead.ok, false);
    const looped = auditWith(
      `for c in a b; do node core/cli.mjs api pull --reads /tmp/$c.json --worker ${worker}; done`
    );
    assert.equal(looped.ok, false);

    // The token is in no printed call, no command's output, and no file the run wrote.
    const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
    assert.equal(run.target, 'worker');
    assert.ok(!JSON.stringify(run.calls).includes(TOKEN));
    assert.ok(!out.join('\n').includes(TOKEN));
    for (const f of filesUnder(dir)) assert.ok(!fs.readFileSync(f, 'utf8').includes(TOKEN), f);
  } finally {
    fw.child.kill();
  }
});

test('the rendered prompts: staging cloud tasks read system/worker into a file; live ones do not; no token anywhere', () => {
  const tokenish = /Bearer|"token"\s*:|[A-Za-z0-9_-]{40,}/;
  for (const rec of ['live', 'staging'])
    for (const [key, task] of Object.entries(spec.tasks[rec])) {
      const p = renderPrompt({ key: `${rec}.${key}`, task, spec });
      if (!p) continue;
      const worker = RUN.runTarget(spec, rec, task.pipeline) === 'worker';
      assert.equal(p.includes('doc_id "worker"'), worker, `${rec}.${key}`);
      assert.equal(p.includes('--worker /tmp/ev/system/worker.json'), worker, `${rec}.${key}`);
      assert.equal(/ArtifactData "set" on runs\//.test(p), !worker, `${rec}.${key}`);
      // B-397: OUTCOME UNKNOWN is routed to apply --failed in a Worker run's prompt, and only there
      assert.equal(/ends OUTCOME UNKNOWN .* run the apply --failed command it names/.test(p), worker, `${rec}.${key}`);
      // The gate line carries code; the rest of the prompt carries no token-shaped value.
      const text = p
        .split('\n')
        .filter(l => !l.startsWith("node -e '"))
        .join('\n');
      assert.ok(!tokenish.test(text), `${rec}.${key}: ${(tokenish.exec(text) || [])[0]}`);
    }
});

test('B-397: a batch whose reply is lost after it landed ends OUTCOME UNKNOWN, and apply --failed re-pulls and finishes', async () => {
  const fw = await fakeWorker();
  try {
    const wdir = tmp('ev4-w-');
    const worker = path.join(wdir, 'worker.json');
    fs.writeFileSync(worker, JSON.stringify({ schema: 1, url: fw.url, token: TOKEN }));
    const dir = tmp('ev4-stg-');
    const out = [];
    const make = calls => calls.map(c => runApi(c, out));
    const id = RUN.runIdFor('evening-cloud', AT);
    make(RUN.start({ spec, pipeline: 'evening-cloud', record: 'staging', at: AT, dir, release: 'v4.0.0', worker }));
    make(RUN.pull({ spec, dir, at: AT }));
    assert.equal(RUN.pulled({ spec, dir, transcript: '' }).done, true);
    const plan = RUN.compute({ spec, dir, validate, at: AT });
    assert.equal(plan.status, 'planned', JSON.stringify(plan.problems));
    // the batch is written, then its answer is lost (a 503 after the write)
    fw.get('/_failnext?status=503&land=1');
    const first = make(RUN.apply({ dir }).filter(c => c.tool === 'Bash'))[0];
    assert.equal(first.code, 1);
    assert.match(
      first.out,
      /api batch 1: OUTCOME UNKNOWN \(503\): "the outcome is unknown: the batch may have been written/
    );
    assert.match(first.out, /Run the apply --failed 1 command: it re-pulls/);
    assert.doesNotMatch(first.out, /REFUSED|nothing in batch 1 was written/);
    const landed = fw.get('/_dump');
    // the printed path: apply --failed re-pulls, replan drops what landed, and the run ends with nothing doubled
    const repull = RUN.applyFailed({ dir, batch: 1 });
    assert.match(repull[0].args.command, / api pull --reads /);
    assert.deepEqual(
      make(repull).map(r => r.code),
      [0]
    );
    const re = RUN.replan({ spec, dir, batch: 1, transcript: '' });
    assert.equal(re.done, true, JSON.stringify(re));
    assert.deepEqual(
      make(re.calls.filter(c => c.tool === 'Bash')).map(r => r.code),
      re.calls.filter(c => c.tool === 'Bash').map(() => 0)
    );
    const after = fw.get('/_dump');
    for (const w of plan.plan.batches[0]) {
      const k = `${w.collection}/${w.doc_id}`;
      // a fact the batch created is dropped by replan (never doubled); a derived document is written again, the same
      assert.deepEqual(after[k].data, landed[k].data, `${k}: the same document as the one that landed`);
      if (w.op === 'set' && w.if_version == null && spec.collections[w.collection].class === 'Fact')
        assert.equal(after[k].v, landed[k].v, `${k}: a fact that landed is not written again`);
    }
    make(RUN.end({ dir, at: AT, transcript: null }));
    assert.equal(fw.get('/_dump')['runs/' + id].data.status, 'ok');
    assert.ok(!out.join('\n').includes(TOKEN));
  } finally {
    fw.child.kill();
  }
});
