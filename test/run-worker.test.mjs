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
import { ROOT } from './helpers.mjs';

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
  assert.match(call.args.command, /^node core\/cli\.mjs api (list|batch|set) /);
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
const filesUnder = d =>
  fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? filesUnder(path.join(d, e.name)) : [path.join(d, e.name)]));

test('the target is per record and lane: staging cloud runs go to the Worker; live and the Mac lane keep ArtifactData', () => {
  for (const p of ['morning', 'evening-cloud', 'weekly', 'worker', 'watchdog']) {
    assert.equal(RUN.runTarget(spec, 'staging', p), 'worker', p);
    assert.equal(RUN.runTarget(spec, 'live', p), 'artifact', p);
  }
  for (const p of ['evening-mac', 'restore-drill']) assert.equal(RUN.runTarget(spec, 'staging', p), 'artifact', p);
  assert.equal(spec.registry.records.live.runs, undefined, 'live keeps ArtifactData until the cutover (B-320)');
});

test('live still prints ArtifactData at every move', () => {
  const dir = tmp('ev4-live-');
  const s = RUN.start({
    spec,
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
  const pulls = RUN.pull({ spec, dir, at: AT });
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

    const pulls = RUN.pull({ spec, dir, at: AT });
    assert.ok(pulls.every(c => c.tool === 'Bash' && / api list --collection /.test(c.args.command)));
    const reads = spec.pipelines['evening-cloud'].reads;
    assert.equal(pulls.length, reads.length);
    reads.forEach((r, i) => assert.equal(/ --since \S+/.test(pulls[i].args.command), !!r.windowDays, r.collection));
    assert.throws(() => RUN.pulled({ spec, dir, transcript: '' }), /no pull result for/);
    assert.ok(make(pulls).every(r => r.code === 0));
    // A windowed read (ArtifactData's query on at) saves only the documents in the window, and keeps every version.
    const win = {
      ...pulls[0],
      args: {
        command: pulls[0].args.command.replace(
          /--collection \S+ --out-dir \S+ --versions \S+/,
          `--collection exams --out-dir ${dir}/win --versions ${dir}/win.json --since 2999-01-01`
        ),
      },
    };
    assert.match(runApi(win, out).out, /api list exams: 0 saved to .*, versions for [1-9]/);
    const pulled = RUN.pulled({ spec, dir, transcript: '' });
    assert.equal(pulled.done, true);
    assert.ok(Object.keys(pulled.versions.state || {}).length || Object.keys(pulled.versions.days || {}).length);

    const plan = RUN.compute({ spec, dir, validate, at: AT });
    assert.equal(plan.status, 'planned', JSON.stringify(plan.problems));
    // Someone (the page) saves a document the plan pinned: its batch is refused whole, then re-pulled and re-pinned.
    const pinned = plan.plan.batches[0].find(w => w.if_version != null);
    assert.ok(pinned, 'evening-cloud updates a document it read');
    fw.get(`/_bump?c=${pinned.collection}&id=${pinned.doc_id}`);
    const applied = RUN.apply({ dir });
    const first = make(applied.slice(0, 1))[0];
    assert.equal(first.code, 1);
    assert.match(first.out, /REFUSED \(409\).*nothing was written/);
    const repull = RUN.applyFailed({ dir, batch: 1 });
    assert.ok(repull.every(c => / api list /.test(c.args.command)));
    make(repull);
    const re = RUN.replan({ spec, dir, batch: 1, transcript: '' });
    assert.equal(re.done, true);
    assert.deepEqual(
      make(re.calls).map(r => r.code),
      [0]
    );
    make(applied.slice(1).filter(c => c.tool === 'Bash'));

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
    assert.deepEqual([a.ok, a.extra.length], [true, 0]);
    transcript.push(
      ...bash(++seq, `node core/cli.mjs api set --collection days --doc-id x --file /tmp/x.json --worker ${worker}`)
    );
    assert.equal(RUN.audit({ dir, transcript: transcript.join('\n') }).ok, false);

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
      // The gate line carries code; the rest of the prompt carries no token-shaped value.
      const text = p
        .split('\n')
        .filter(l => !l.startsWith("node -e '"))
        .join('\n');
      assert.ok(!tokenish.test(text), `${rec}.${key}: ${(tokenish.exec(text) || [])[0]}`);
    }
});
