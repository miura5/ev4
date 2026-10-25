// B-317 (D-322): staging's evening-mac and restore drill on the Worker target. The backup folder is one spec value; the
// nightly backup is the run's pull of D1 in the R2 export's shape, with pwa/backup.js's hashes; the drill restores the
// newest backup (from the Mac, or the newest R2 export) into the scratch D1 under drills/<run id>/, writes nothing else
// but its own runs entry, and passes only when the scratch read-back matches the backup's counts and SHA-256. Proved
// against a stand-in Worker (test/fake-worker.mjs) that serves the record and the scratch D1 by host.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import EV from '../core/evcore.mjs';
import { loadValidator } from '../core/schemas.mjs';
import * as RUN from '../core/run.mjs';
import { CODE_STEPS } from '../core/steps.mjs';
import * as D1B from '../core/d1backup.mjs';
import { manifestOf } from '../pwa/backup.js';
import { renderPrompt } from '../tools/prompts.mjs';
import { ROOT } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
EV.configure(spec);
const validate = loadValidator();
const AT = '2026-10-18T01:55:00Z'; // a Saturday evening in Chicago: no mirror
const TOKEN = 'planted-drill-token-' + 'Zq81'.repeat(6);
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ENV = { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };

async function fakeWorker() {
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'test/fake-worker.mjs'), TOKEN, path.join(ROOT, 'test/data/record')],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', d => {
      const m = /port (\d+)/.exec(String(d));
      if (m) resolve(Number(m[1]));
    });
    child.on('exit', c => reject(new Error('fake worker exited ' + c)));
  });
  const base = `http://127.0.0.1:${port}`;
  const get = p => JSON.parse(execFileSync('curl', ['-sS', '--noproxy', '*', base + p], { encoding: 'utf8' }));
  // The record's Worker by name, so the scratch Worker is the same url with its first label replaced (onHost).
  return { url: `http://ev-staging.localhost:${port}`, child, get };
}
function sh(call, out) {
  assert.equal(call.tool, 'Bash');
  assert.match(call.args.command, /^node core\/cli\.mjs api /);
  try {
    const s = execFileSync(process.execPath, call.args.command.split(' ').slice(1), {
      cwd: ROOT,
      encoding: 'utf8',
      env: ENV,
    });
    out.push(s);
    return { code: 0, out: s };
  } catch (e) {
    out.push(String(e.stdout) + String(e.stderr));
    return { code: e.status, out: String(e.stdout) };
  }
}
const worker = url => {
  const f = path.join(tmp('ev4-w-'), 'worker.json');
  fs.writeFileSync(f, JSON.stringify({ schema: 1, url, token: TOKEN }));
  return f;
};
const rowsOf = (dump, keep = c => c !== 'system') =>
  Object.entries(dump)
    .map(([k, v]) => ({ c: k.split('/')[0], id: k.split('/').slice(1).join('/'), data: JSON.stringify(v.data) }))
    .filter(r => keep(r.c));

test('the backup folder is one spec value, every Worker pipeline of staging is targeted, and no prompt names Study Watch anew', () => {
  const runs = spec.registry.records.staging.runs;
  for (const p of ['evening-mac', 'restore-drill']) {
    assert.equal(RUN.runTarget(spec, 'staging', p), 'worker', p);
    assert.deepEqual(spec.tasks.staging[p].folders, [runs.backup.folder], `${p} lists the one backup folder`);
    assert.equal(spec.tasks.staging[p].trigger, null, `${p}: its replacement is created with Matt present`);
  }
  assert.equal(RUN.runTarget(spec, 'live', 'evening-mac'), 'artifact');
  assert.equal(RUN.runTarget(spec, 'staging', 'diagnostic'), 'artifact');
  assert.ok(['mac', 'r2'].includes(runs.backup.restoreFrom));
  const retired = spec.tasks.retired.map(r => r.trigger);
  for (const t of ['trig_01EQBnYdtbqUKkh8bjTiTvCA', 'trig_011xnMqTq16qeEw68DPJzXVH']) assert.ok(retired.includes(t), t);
  for (const k of ['evening-mac', 'restore-drill']) {
    const p = renderPrompt({ key: 'staging.' + k, task: spec.tasks.staging[k], spec });
    assert.ok(p.includes('doc_id "worker"') && p.includes('--worker /tmp/ev/system/worker.json'), k);
    assert.ok(p.includes(runs.backup.folder), k);
    assert.ok(!/Study Watch/.test(p), k);
    assert.ok(
      !/Bearer|"token"\s*:/.test(
        p
          .split('\n')
          .filter(l => !l.startsWith("node -e '"))
          .join('\n')
      ),
      k
    );
  }
});

test("manifestSync is pwa/backup.js's manifestOf", async () => {
  const rows = [
    { c: 'b', id: '2', data: '{"x":1}' },
    { c: 'a', id: '1', data: '{"y":"é"}' },
    { c: 'b', id: '10', data: '{}' },
  ];
  assert.deepEqual(D1B.manifestSync(rows.map(r => ({ ...r }))), await manifestOf(rows.map(r => ({ ...r }))));
});

test("evening-mac's backup is its pull of D1, its hashes D1's, written to the one folder by a printed device call", async () => {
  const fw = await fakeWorker();
  try {
    const dir = tmp('ev4-em-');
    const out = [];
    const w = worker(fw.url);
    RUN.start({ spec, pipeline: 'evening-mac', record: 'staging', at: AT, dir, release: 'v4.0.0', worker: w });
    const pulls = RUN.pull({ spec, dir, at: AT });
    assert.deepEqual(
      pulls.map(c => sh(c, out).code),
      [0]
    );
    const ctx = {
      target: 'worker',
      dir,
      outputs: path.join(dir, 'outputs'),
      runId: 'evening-mac-x',
      record: 'staging',
      pipeline: 'evening-mac',
      date: EV.chicagoDate(AT),
      now: AT,
      release: 'v4.0.0',
      input: {},
    };
    const r = CODE_STEPS['mac-files'](RUN.loadPulled(dir), ctx, spec);
    const files = r.device.flatMap(d => d.args.files);
    assert.equal(files.length, 1);
    assert.ok(files[0].devicePath.startsWith(spec.registry.records.staging.runs.backup.folder + '/backup/'));
    const b = JSON.parse(fs.readFileSync(files[0].stagedPath, 'utf8'));
    assert.deepEqual(D1B.backupProblems(b), []);
    const reads = new Set(spec.pipelines['evening-mac'].reads.map(x => x.collection));
    const d1 = await manifestOf(rowsOf(fw.get('/_dump'), c => reads.has(c)));
    assert.deepEqual(b.collections, d1, 'the backup hashes match D1 (pwa/backup.js manifestOf)');
    assert.ok(!JSON.stringify(b).includes(TOKEN));
  } finally {
    fw.child.kill();
  }
});

async function drill(opts = {}) {
  const fw = await fakeWorker();
  try {
    return await drillWith(fw, opts);
  } catch (e) {
    fw.child.kill();
    throw e;
  }
}
async function drillWith(fw, { from = 'mac', tamper = false }) {
  const s = JSON.parse(JSON.stringify(spec));
  s.registry.records.staging.runs.backup.restoreFrom = from;
  const dir = tmp('ev4-drill-');
  const out = [];
  const lines = [];
  let seq = 0;
  const made = c => {
    const id = 'b' + ++seq;
    lines.push(
      JSON.stringify({
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id, name: 'Bash', input: { command: c.args.command } }],
        },
      }),
      JSON.stringify({
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'ok' }] }],
        },
      })
    );
    return sh(c, out);
  };
  const w = worker(fw.url);
  const start = RUN.start({
    spec: s,
    pipeline: 'restore-drill',
    record: 'staging',
    at: AT,
    dir,
    release: 'v4.0.0',
    worker: w,
  });
  assert.deepEqual(
    start.map(made).map(r => r.code),
    [0]
  );
  RUN.pull({ spec: s, dir, at: AT }).forEach(made);
  RUN.pulled({ spec: s, dir, transcript: '' });
  const wait = RUN.compute({ spec: s, dir, validate, at: AT });
  assert.equal(wait.status, 'waiting');
  const m = wait.question.material;
  const saveTo = path.join(dir, 'in', 'backup.json');
  assert.equal(m.saveTo, saveTo);
  if (from === 'r2') {
    const calls = m.groups[0].calls;
    assert.match(calls[0].args.command, /^node core\/cli\.mjs api export --out \S+ --worker \S+$/);
    assert.match(made(calls[0]).out, /api export: exports\/\S+ saved to /);
  } else {
    assert.deepEqual(m.look, [spec.registry.records.staging.runs.backup.folder + '/backup']);
    // The Mac's newest backup, as evening-mac writes it: the record's pull of D1.
    const rows = rowsOf(fw.get('/_dump'));
    fs.mkdirSync(path.dirname(saveTo), { recursive: true });
    const b = D1B.backupOf(rows, { at: AT, label: 'evening-mac x', release: 'v4.0.0' });
    if (tamper) b.docs[0].data = b.docs[0].data.replace('}', ',"x":1}');
    fs.writeFileSync(saveTo, JSON.stringify(b));
  }
  fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'answers', 'fetch-backup.json'),
    JSON.stringify({ status: 'ok', path: 'E.V.-v4-backup-saturday.json' })
  );
  const plan = RUN.compute({ spec: s, dir, validate, at: AT });
  return { fw, dir, out, lines, made, plan, s, before: fw.get('/_dump') };
}

test('the drill restores the newest Mac backup into the scratch D1, reads it back, and passes on counts and SHA-256', async () => {
  const d = await drill();
  try {
    assert.equal(d.plan.status, 'planned', JSON.stringify(d.plan.problems));
    assert.equal(d.plan.plan.writes, 0, 'nothing for the record but its runs entry');
    const apply = RUN.apply({ dir: d.dir });
    assert.deepEqual(
      apply.map(c => c.args.command.split(' ').slice(0, 4).join(' ')),
      ['node core/cli.mjs api batch', 'node core/cli.mjs api restore-check']
    );
    assert.ok(apply.every(c => / --host ev-staging-scratch /.test(c.args.command)));
    assert.deepEqual(
      apply.map(d.made).map(r => r.code),
      [0, 0],
      d.out.join('\n')
    );
    const end = RUN.end({ dir: d.dir, at: AT, transcript: d.lines.join('\n') });
    assert.deepEqual(
      end.map(d.made).map(r => r.code),
      [0]
    );
    const id = RUN.runIdFor('restore-drill', AT);
    const rec = d.fw.get('/_dump');
    assert.equal(rec['runs/' + id].data.status, 'ok', rec['runs/' + id].data.detail);
    assert.match(
      rec['runs/' + id].data.detail,
      /read back from the scratch D1: \d+ documents in \d+ collections, counts and SHA-256 match/
    );
    const audit = rec['runs/' + id].data.steps.find(x => x.id === 'audit');
    assert.equal(audit.status, 'ok', audit.detail);
    // The record changed only by the run's own entry; the scratch holds the backup under drills/<run id>/.
    const changed = Object.keys(rec).filter(k => JSON.stringify(rec[k]) !== JSON.stringify(d.before[k]));
    assert.deepEqual(changed, ['runs/' + id]);
    const sc = d.fw.get('/_dump?store=scratch');
    const n = Object.keys(d.before).filter(k => !k.startsWith('system/') && !k.startsWith('runs/' + id)).length;
    assert.ok(Object.keys(sc).every(k => k.startsWith(`drills/${id}/`)));
    assert.ok(Object.keys(sc).length >= n - 1);
    // The audit counts a scratch write no command printed.
    const extra = `node core/cli.mjs api batch --files /tmp/x.json --first 1 --label scratch --host ev-staging-scratch --worker /tmp/w.json`;
    d.lines.push(
      JSON.stringify({
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'zz', name: 'Bash', input: { command: extra } }],
        },
      }),
      JSON.stringify({
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'zz', content: [{ type: 'text', text: 'ok' }] }],
        },
      })
    );
    assert.equal(RUN.audit({ dir: d.dir, transcript: d.lines.join('\n') }).ok, false);
    assert.ok(!d.out.join('\n').includes(TOKEN));
  } finally {
    d.fw.child.kill();
  }
});

test('the drill can test the newest R2 export instead (restoreFrom r2), through one printed command', async () => {
  const d = await drill({ from: 'r2' });
  try {
    assert.equal(d.plan.status, 'planned', JSON.stringify(d.plan.problems));
    assert.deepEqual(
      RUN.apply({ dir: d.dir })
        .map(d.made)
        .map(r => r.code),
      [0, 0]
    );
    RUN.end({ dir: d.dir, at: AT, transcript: null }).forEach(d.made);
    const id = RUN.runIdFor('restore-drill', AT);
    assert.equal(d.fw.get('/_dump')['runs/' + id].data.status, 'ok');
  } finally {
    d.fw.child.kill();
  }
});

test('a backup that does not match its own manifest is refused, and nothing is restored', async () => {
  const d = await drill({ tamper: true });
  try {
    assert.equal(d.plan.status, 'refused');
    assert.match(d.plan.problems.join('\n'), /against its own manifest: .*the hash differs/);
    assert.deepEqual(d.fw.get('/_dump?store=scratch'), {});
  } finally {
    d.fw.child.kill();
  }
});

test('a scratch read-back that differs fails the run, naming the collection', async () => {
  const d = await drill();
  try {
    const apply = RUN.apply({ dir: d.dir });
    // Only the check runs: nothing was restored, so every collection is missing from the scratch D1.
    assert.equal(d.made(apply[1]).code, 1);
    const end = RUN.end({ dir: d.dir, at: AT, transcript: null });
    end.forEach(d.made);
    const id = RUN.runIdFor('restore-drill', AT);
    const run = d.fw.get('/_dump')['runs/' + id].data;
    assert.equal(run.status, 'failed');
    assert.match(run.detail, /the scratch D1 differs from the backup: \w+: 0 restored/);
  } finally {
    d.fw.child.kill();
  }
});

test('the Worker serves one export read-only, only under exports/, behind the token (B-317)', async () => {
  const { default: W } = await import('../pwa/worker.js');
  const objects = { 'exports/2026-10-25/a.json': '{"kind":"ev-d1-export"}' };
  const env = {
    EV_TOKEN: TOKEN,
    EXPORTS: { get: async k => (k in objects ? { body: objects[k] } : null) },
    ASSETS: { fetch: async () => new Response('page') },
  };
  const ask = (q, token = TOKEN, method = 'GET') =>
    W.fetch(
      new Request('https://w.example/api/backup/get' + q, { method, headers: { authorization: 'Bearer ' + token } }),
      env
    );
  const ok = await ask('?key=exports/2026-10-25/a.json');
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), objects['exports/2026-10-25/a.json']);
  assert.equal((await ask('?key=exports/2026-10-25/a.json', 'wrong')).status, 401);
  assert.equal((await ask('?key=secrets/x.json')).status, 400);
  assert.equal((await ask('?key=exports/../x.json')).status, 400);
  assert.equal((await ask('?key=exports/none.json')).status, 404);
  assert.notEqual((await ask('?key=exports/2026-10-25/a.json', TOKEN, 'DELETE')).status, 200);
});
