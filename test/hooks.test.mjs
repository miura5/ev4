// B-56, B-57, B-58: the build chat's hooks (tools/hooks.mjs, wired in .claude/settings.json), each run as the harness
// runs it: JSON on stdin, exit 2 and a message on stderr for "no", exit 0 to pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, copyRepo } from './helpers.mjs';
import * as H from '../tools/hooks.mjs';

const hook = (dir, cmd, input) => {
  const r = spawnSync(process.execPath, [path.join(dir, 'tools', 'hooks.mjs'), cmd], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  return { code: r.status, err: r.stderr };
};
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8')).registry.records.live
  .artifact;
const STAGING = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8')).registry.records.staging
  .artifact;

test('the hooks are wired: Stop, PostToolUse on Edit and Write, PreToolUse on ArtifactData and Artifact', () => {
  const cmds = ev => (settings.hooks[ev] || []).flatMap(h => h.hooks.map(x => [h.matcher || '', x.command]));
  assert.ok(cmds('Stop').some(([, c]) => /hooks\.mjs" stop$/.test(c)));
  assert.ok(cmds('PostToolUse').some(([m, c]) => /Edit/.test(m) && /Write/.test(m) && /spec-format$/.test(c)));
  assert.ok(
    cmds('PreToolUse').some(
      ([m, c]) =>
        new RegExp('^(' + m + ')$').test('ArtifactData') &&
        new RegExp('^(' + m + ')$').test('Artifact') &&
        /live-guard$/.test(c)
    )
  );
});

test('B-56: a session that leaves a failing test is told so at its end; a green one ends quietly; nothing is changed', () => {
  const dir = copyRepo();
  for (const f of fs.readdirSync(path.join(dir, 'test')))
    if (f.endsWith('.test.mjs')) fs.rmSync(path.join(dir, 'test', f));
  fs.writeFileSync(path.join(dir, 'test', 'ok.test.mjs'), "import test from 'node:test'; test('fine', () => {});\n");
  assert.deepEqual(hook(dir, 'stop', {}), { code: 0, err: '' }, 'green: quiet');
  fs.writeFileSync(
    path.join(dir, 'test', 'planted.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert'; test('planted failure', () => assert.equal(1, 2));\n"
  );
  const before = fs.readFileSync(path.join(dir, 'test', 'planted.test.mjs'), 'utf8');
  const red = hook(dir, 'stop', {});
  assert.equal(red.code, 2);
  assert.match(red.err, /npm test is red: planted failure/);
  assert.equal(fs.readFileSync(path.join(dir, 'test', 'planted.test.mjs'), 'utf8'), before, 'the hook edits nothing');
  assert.deepEqual(hook(dir, 'stop', { stop_hook_active: true }), { code: 0, err: '' }, 'never blocks twice in a row');
});

test('B-57: a spec edit at indent 2 comes back at indent 1 with no trailing newline and the same content; other files are untouched', () => {
  const dir = copyRepo();
  const spec = path.join(dir, 'spec', 'schemas', 'days.schema.json'),
    other = path.join(dir, 'package.json');
  const content = JSON.parse(fs.readFileSync(spec, 'utf8'));
  fs.writeFileSync(spec, JSON.stringify(content, null, 2) + '\n');
  assert.equal(hook(dir, 'spec-format', { tool_name: 'Edit', tool_input: { file_path: spec } }).code, 0);
  assert.equal(fs.readFileSync(spec, 'utf8'), JSON.stringify(content, null, 1));
  const pkg = JSON.stringify(JSON.parse(fs.readFileSync(other, 'utf8')), null, 2) + '\n';
  fs.writeFileSync(other, pkg);
  hook(dir, 'spec-format', { tool_name: 'Write', tool_input: { file_path: other } });
  assert.equal(fs.readFileSync(other, 'utf8'), pkg, 'not a spec file: untouched');
  fs.writeFileSync(spec, '{ "broken": ');
  const bad = hook(dir, 'spec-format', { tool_name: 'Write', tool_input: { file_path: spec } });
  assert.equal(bad.code, 2);
  assert.equal(fs.readFileSync(spec, 'utf8'), '{ "broken": ', 'not JSON: said, left as it is');
  assert.equal(H.specFileOf({ tool_name: 'Read', tool_input: { file_path: spec } }, dir), null);
});

test('B-58: a live write or publish is refused without dist/live-ok, passes with a fresh one; staging always passes', () => {
  const dir = copyRepo(),
    url = `https://claude.ai/artifact/${LIVE}`;
  const write = {
    tool_name: 'ArtifactData',
    tool_input: { action: 'set', url, collection: 'days', doc_id: 'x', data: {} },
  };
  const publish = { tool_name: 'Artifact', tool_input: { file_path: 'dist/page/live/index.html', url } };
  for (const call of [write, publish]) {
    const r = hook(dir, 'live-guard', call);
    assert.equal(r.code, 2);
    assert.match(
      r.err,
      /^Refused: an Artifact(Data set on the live record| publish of the live page)\. Live changes only through deploy live --matt-ok/
    );
  }
  assert.equal(
    hook(dir, 'live-guard', {
      tool_name: 'ArtifactData',
      tool_input: { action: 'get', url, collection: 'system', doc_id: 'manifest' },
    }).code,
    0,
    'a read passes'
  );
  assert.equal(hook(dir, 'live-guard', { tool_name: 'Artifact', tool_input: { action: 'read', url } }).code, 0);
  for (const call of [write, publish])
    assert.equal(
      hook(dir, 'live-guard', {
        ...call,
        tool_input: { ...call.tool_input, url: `https://claude.ai/artifact/${STAGING}` },
      }).code,
      0,
      'staging passes'
    );
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'dist', 'live-ok'),
    JSON.stringify({ at: Date.now(), commit: 'c', by: 'deploy live --matt-ok' })
  );
  for (const call of [write, publish]) assert.equal(hook(dir, 'live-guard', call).code, 0, 'with a fresh live-ok');
  fs.writeFileSync(path.join(dir, 'dist', 'live-ok'), JSON.stringify({ at: Date.now() - 3 * 36e5 }));
  assert.match(hook(dir, 'live-guard', write).err, /older than that/);
  assert.match(
    H.liveGuard({ tool_name: 'mcp__x__ArtifactData', tool_input: { action: 'batch', url } }, { liveId: LIVE }),
    /ArtifactData batch/
  );
});

test('D-169 (B-131): every hook stands down while a fresh run marker says this session is a pipeline run; none or a stale one changes nothing', () => {
  const dir = copyRepo();
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-marker-')), 'pipeline-run');
  const run = (cmd, input) => {
    const r = spawnSync(process.execPath, [path.join(dir, 'tools', 'hooks.mjs'), cmd], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, EV_RUN_MARKER: marker },
    });
    return { code: r.status, err: r.stderr };
  };
  const mark = minutesAgo =>
    fs.writeFileSync(
      marker,
      JSON.stringify({
        pipeline: 'watchdog',
        record: 'live',
        at: new Date(Date.now() - minutesAgo * 60e3).toISOString(),
      }) + '\n'
    );
  const timeout = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8')).constants.watchdog
    .runTimeoutMinutes;
  // stop: a red tree is reported, unless this is a run.
  for (const f of fs.readdirSync(path.join(dir, 'test')))
    if (f.endsWith('.test.mjs')) fs.rmSync(path.join(dir, 'test', f));
  fs.writeFileSync(
    path.join(dir, 'test', 'planted.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert'; test('planted failure', () => assert.equal(1, 2));\n"
  );
  // live-guard: the watchdog's first write, as its run makes it.
  const write = {
    tool_name: 'ArtifactData',
    tool_input: { action: 'set', url: `https://claude.ai/artifact/${LIVE}`, collection: 'runs', doc_id: 'w', data: {} },
  };
  // spec-format: a spec file left at indent 2.
  const spec = path.join(dir, 'spec', 'schemas', 'days.schema.json');
  const indent2 = JSON.stringify(JSON.parse(fs.readFileSync(spec, 'utf8')), null, 2) + '\n';
  const edit = { tool_name: 'Edit', tool_input: { file_path: spec } };
  const cases = [
    ['no marker', null, 2, 2, false],
    ['a fresh marker', 1, 0, 0, true],
    ['a stale marker', timeout + 1, 2, 2, false],
  ];
  for (const [what, age, stopCode, guardCode, untouched] of cases) {
    if (age == null) fs.rmSync(marker, { force: true });
    else mark(age);
    const stop = run('stop', {});
    assert.equal(stop.code, stopCode, `stop with ${what}`);
    if (stopCode) assert.match(stop.err, /npm test is red: planted failure/);
    const guard = run('live-guard', write);
    assert.equal(guard.code, guardCode, `live-guard with ${what}`);
    if (guardCode) assert.match(guard.err, /^Refused: an ArtifactData set on the live record/);
    fs.writeFileSync(spec, indent2);
    assert.equal(run('spec-format', edit).code, 0, `spec-format with ${what}`);
    assert.equal(
      fs.readFileSync(spec, 'utf8') === indent2,
      untouched,
      `spec-format ${untouched ? 'stands down' : 'acts'} with ${what}`
    );
  }
  // A marker that does not parse, names no pipeline or is dated in the future is no marker.
  for (const bad of [
    '{',
    JSON.stringify({ at: new Date().toISOString() }),
    JSON.stringify({ pipeline: 'morning', at: new Date(Date.now() + 36e5).toISOString() }),
  ]) {
    fs.writeFileSync(marker, bad);
    assert.equal(run('live-guard', write).code, 2, bad);
  }
  assert.equal(H.pipelineRun({ file: path.join(dir, 'nothing-here') }), null);
});

test('B-146 (W-3): the Stop hook runs npm test once per tree: an unchanged tree skips with a line saying so, a changed one runs', () => {
  const dir = copyRepo();
  for (const f of fs.readdirSync(path.join(dir, 'test')))
    if (f.endsWith('.test.mjs')) fs.rmSync(path.join(dir, 'test', f));
  fs.writeFileSync(path.join(dir, 'test', 'ok.test.mjs'), "import test from 'node:test'; test('fine', () => {});\n");
  const stop = () => {
    const r = spawnSync(process.execPath, [path.join(dir, 'tools', 'hooks.mjs'), 'stop'], {
      input: '{}',
      encoding: 'utf8',
      env: { ...process.env, EV_RUN_MARKER: path.join(dir, 'no-marker') },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  let r = stop();
  assert.deepEqual([r.code, r.out], [0, ''], 'first run: tests run, green, quiet');
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'test-ok'), 'utf8')).tree);
  r = stop();
  assert.equal(r.code, 0);
  assert.match(r.out, /^npm test: skipped, the tree is unchanged since its last green run \(.+; B-146\)\n$/);
  // A changed file, tracked or not, runs the tests again; a red run leaves no green hash to skip on.
  fs.writeFileSync(
    path.join(dir, 'test', 'planted.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert'; test('planted failure', () => assert.equal(1, 2));\n"
  );
  r = stop();
  assert.equal(r.code, 2);
  assert.match(r.err, /npm test is red: planted failure/);
  r = stop();
  assert.equal(r.code, 2, 'still red: run again, never skipped');
  fs.rmSync(path.join(dir, 'test', 'planted.test.mjs'));
  fs.appendFileSync(path.join(dir, 'README.md'), '\nA tracked edit.\n');
  assert.notEqual(H.treeHash(dir), JSON.parse(fs.readFileSync(path.join(dir, 'dist', 'test-ok'), 'utf8')).tree);
  assert.deepEqual([stop().code, stop().out.startsWith('npm test: skipped')], [0, true]);
});

test('B-178 (D-195, D-201): the trace allowance: a live write dist/trace-ok names passes for ten minutes; nothing else does', () => {
  const dir = copyRepo(),
    url = `https://claude.ai/artifact/${LIVE}`;
  const call = (action, collection, doc_id, extra = {}) => ({
    tool_name: 'ArtifactData',
    tool_input: { action, url, collection, doc_id, file_path: '/tmp/x.json', ...extra },
  });
  const named = [
    { action: 'set', collection: 'jobresults', doc_id: 'job-20261021-233000-the-timer' },
    { action: 'update', collection: 'talk', doc_id: '2026-10-21' },
    { action: 'set', collection: 'system', doc_id: 'yourturn' },
  ];
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  const okFile = path.join(dir, 'dist', 'trace-ok');
  const plant = (at, record = 'live') =>
    fs.writeFileSync(okFile, JSON.stringify({ at, record, url, job: 'job-x', calls: named }));
  plant(Date.now());
  // The named trace calls pass, one by one and as one batch.
  for (const c of named)
    assert.equal(hook(dir, 'live-guard', call(c.action, c.collection, c.doc_id)).code, 0, c.doc_id);
  const batch = {
    tool_name: 'ArtifactData',
    tool_input: {
      action: 'batch',
      url,
      writes: named.map(c => ({ op: c.action, collection: c.collection, doc_id: c.doc_id })),
    },
  };
  assert.equal(hook(dir, 'live-guard', batch).code, 0, 'the three as a batch');
  // An unnamed call is refused: another document, a named id on another collection, another action, a batch with one
  // more write, a delete.
  for (const [what, c] of [
    ['an unnamed document', call('set', 'days', '2026-10-21')],
    ['a named id on another collection', call('set', 'jobs', 'job-20261021-233000-the-timer')],
    ['another action on a named document', call('set', 'talk', '2026-10-21')],
    ['a delete', call('delete', 'system', 'yourturn')],
    [
      'a batch with one more write',
      {
        ...batch,
        tool_input: {
          ...batch.tool_input,
          writes: [...batch.tool_input.writes, { op: 'set', collection: 'weakspots', doc_id: 'w' }],
        },
      },
    ],
  ]) {
    const r = hook(dir, 'live-guard', c);
    assert.equal(r.code, 2, what);
    assert.match(r.err, /^Refused: an ArtifactData \w+ on the live record/, what);
  }
  // The page is never published by a trace.
  assert.equal(hook(dir, 'live-guard', { tool_name: 'Artifact', tool_input: { url } }).code, 2, 'a publish');
  // A stale dist/trace-ok, one for the staging record, or one from the future is refused.
  plant(Date.now() - (H.TRACE_OK_MINUTES * 60e3 + 1000));
  assert.equal(hook(dir, 'live-guard', call('set', 'system', 'yourturn')).code, 2, 'stale');
  plant(Date.now(), 'staging');
  assert.equal(hook(dir, 'live-guard', call('set', 'system', 'yourturn')).code, 2, 'a staging trace-ok');
  plant(Date.now() + 5 * 60e3);
  assert.equal(hook(dir, 'live-guard', call('set', 'system', 'yourturn')).code, 2, 'from the future');
  // The pipeline-marker case is unchanged: a fresh marker stands the hook down whatever trace-ok says.
  fs.rmSync(okFile);
  const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-marker-')), 'pipeline-run');
  fs.writeFileSync(marker, JSON.stringify({ pipeline: 'watchdog', record: 'live', at: new Date().toISOString() }));
  const r = spawnSync(process.execPath, [path.join(dir, 'tools', 'hooks.mjs'), 'live-guard'], {
    input: JSON.stringify(call('set', 'runs', 'w')),
    encoding: 'utf8',
    env: { ...process.env, EV_RUN_MARKER: marker },
  });
  assert.equal(r.status, 0, 'a pipeline run is never guarded');
  assert.equal(hook(dir, 'live-guard', call('set', 'runs', 'w')).code, 2, 'and without it, refused');
});

test('B-319: the copy (tools/pwa-copy.mjs) reads or writes for the live record only on dist/live-ok bound to the commit', () => {
  const dir = copyRepo();
  const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-copy-live-'));
  const run = (record, n) =>
    spawnSync(
      process.execPath,
      [path.join(dir, 'tools', 'pwa-copy.mjs'), 'export-calls', path.join(out, n), '--record', record],
      {
        encoding: 'utf8',
      }
    );
  const okFile = path.join(dir, 'dist', 'live-ok');
  let r = run('live', 'a');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refused: a copy of the live record \(no dist\/live-ok/);
  assert.equal(fs.existsSync(path.join(out, 'a')), false, 'nothing written');
  fs.mkdirSync(path.dirname(okFile), { recursive: true });
  for (const [ok, why] of [
    [{ at: Date.now() - (H.LIVE_OK_HOURS + 1) * 36e5, commit: head }, /older than/],
    [{ at: Date.now(), commit: 'f'.repeat(40) }, /names commit f{40}, not this checkout's/],
    [{ at: Date.now() }, /names commit none/],
  ]) {
    fs.writeFileSync(okFile, JSON.stringify(ok));
    r = run('live', 'b');
    assert.equal(r.status, 1, JSON.stringify(ok));
    assert.match(r.stderr, why);
  }
  fs.writeFileSync(okFile, JSON.stringify({ at: Date.now(), commit: head, by: 'ship live --matt-ok' }));
  r = run('live', 'c');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`"url":"https://claude.ai/artifact/${LIVE}"`));
  fs.rmSync(okFile);
  assert.equal(run('staging', 'd').status, 0, 'staging needs no allowance');
});
