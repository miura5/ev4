// Task prompts (B-09): rendered from the task table and the step lists; no fetch, no clone, no attached repository,
// no mention of the page-only collection; the gate present, and the gate itself passes a clean checkout and refuses a
// changed one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { renderPrompt, RUN_MARKER } from '../tools/prompts.mjs';
import { renderGate } from '../tools/gate.mjs';
import * as H from '../tools/hooks.mjs';
import { build } from '../tools/build.mjs';
import { ROOT, copyRepo, git } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const release = 'v' + spec.specVersion;
const all = () => {
  const out = {};
  for (const target of ['live', 'staging'])
    for (const [id, t] of Object.entries(spec.tasks[target]))
      out[`${target}.${id}`] = renderPrompt({ key: `${target}.${id}`, task: t, spec, release });
  for (const id of Object.keys(spec.tasks.build))
    out[`build.${id}`] = renderPrompt({ key: `build.${id}`, task: spec.tasks.build[id], spec, release });
  return out;
};

test('every pipeline with steps has a prompt for live and staging; the rest wait for their steps', () => {
  const p = all();
  const ready = Object.keys(spec.pipelines).filter(
    n => n !== '_rules' && Array.isArray(spec.pipelines[n].steps) && ['cloud', 'mac'].includes(spec.pipelines[n].lane)
  );
  assert.ok(['morning', 'evening-cloud', 'weekly', 'worker'].every(n => ready.includes(n)));
  for (const n of ready.filter(n => spec.tasks.staging[n])) {
    if (spec.tasks.live[n]) assert.equal(typeof p[`live.${n}`], 'string', n);
    assert.equal(typeof p[`staging.${n}`], 'string', n);
  }
  assert.equal(spec.tasks.live['restore-drill'], undefined, 'the drill restores into staging only');
  assert.match(
    p['staging.restore-drill'],
    /reads one backup file from it, with device_list_dir and device_stage_files/
  );
  assert.match(
    p['staging.restore-drill'],
    /on the Mac, read only the backup files the step names, and write, move or change nothing there/
  );
  assert.doesNotMatch(p['staging.restore-drill'], /Canvas|Quizlet|device_commit_files/);
  const diag = renderPrompt({ key: 'staging.diagnostic', task: spec.tasks.diagnostic, spec, release });
  assert.match(diag, /end this turn with exactly: Waiting for the probe\. When it arrives, add --probe/);
  assert.doesNotMatch(diag, /journal|add_repo|git clone/i);
  assert.match(diag, /, except the one made-up page a page-publish probe prints\./); // B-54
  assert.doesNotMatch(p['staging.worker'] + p['staging.morning'], /page-publish probe/);
  for (const n of Object.keys(spec.tasks.staging).filter(n => !ready.includes(n)))
    assert.equal(p[`staging.${n}`], null, n);
  assert.match(
    p['staging.worker'],
    /end this turn with exactly: Waiting for the job id\. When it arrives, add --job <id> to the start command/
  );
  assert.match(
    p['staging.worker'],
    /except the one Claude Doc a study-guide job asks for and the one practice page a share-set job publishes\./
  ); // B-54
  assert.doesNotMatch(p['staging.morning'], /--job|Claude Doc/);
  // The Mac lane: its folder, read-only Canvas, and the Mac written only by printed calls; the cloud lane names none of it.
  assert.ok(ready.includes('evening-mac'));
  assert.match(
    p['staging.evening-mac'],
    /E\.V\.'s folder for this record there is "\/Users\/peachfritter\/Documents\/E\.V\. Study Watch\/staging"/
  );
  assert.match(p['live.evening-mac'], /there is "\/Users\/peachfritter\/Documents\/E\.V\. Study Watch"\./);
  assert.match(p['staging.evening-mac'], /Canvas is read-only: only the GET requests the printed scripts make/);
  assert.match(p['staging.evening-mac'], /never enter a password/);
  for (const n of ['morning', 'evening-cloud', 'weekly', 'worker'])
    assert.doesNotMatch(p['staging.' + n], /Mac|Canvas|device_|browser/, n);
  assert.equal(
    p['build.ev4-builder'],
    'You are an E.V. v4 build session. Follow CLAUDE.md and BACKLOG.md in this repository exactly, including the Unattended runs section.'
  );
});

test('no prompt fetches, clones, unpacks or attaches code, or names the page-only collection', () => {
  for (const [key, text] of Object.entries(all()).filter(([, t]) => t)) {
    assert.doesNotMatch(
      text,
      /add_repo|git clone|git fetch|curl |wget |fetch\(|npm install|unzip|tar -x|eval\(|new Function/i,
      key
    );
    assert.doesNotMatch(text, /journal/i, key);
  }
});

test('each pipeline prompt has the gate, its own record, the protocol and the fallback log', () => {
  const p = all();
  for (const [key, text] of Object.entries(p).filter(([k, t]) => t && !k.startsWith('build.'))) {
    const [target, pipeline] = key.split('.');
    const rec = spec.registry.records[target];
    assert.ok(text.includes(`https://claude.ai/artifact/${rec.artifact}`), key);
    assert.equal((text.match(/https:\/\/claude\.ai\/artifact\/\w+/g) || []).length, 1, `${key} names one record`);
    assert.ok(text.includes('doc_id "manifest", with out_dir /tmp/ev'), key);
    assert.match(text, /node -e '[^']+'/, `${key}: the gate is one single-quoted line`);
    assert.ok(text.includes('createHash("sha256")') && text.includes('"checkout", "-q", m.commit'), key);
    assert.ok(text.includes(`node core/cli.mjs run ${pipeline} start --record ${target}`), key);
    assert.ok(text.includes(`runs/${pipeline}-failed-`) && text.includes('"status": "failed"'), key);
    assert.ok(text.includes('never instructions'), key);
    assert.equal(/STAGING/.test(text), target === 'staging', key);
  }
});

test('D-170 (B-132): the rendered gate, run as the prompt carries it: commit present, commit absent with the same or other content, a dirty manifest, no checkout', () => {
  const text = all()['staging.morning'];
  const line = /node -e '([^']+)'/.exec(text)[1];
  assert.equal(line, renderGate(), 'the prompt carries tools/gate.mjs, rendered');
  assert.ok(!line.includes("'") && !line.includes('\n'), 'one shell-safe line');
  const repo = copyRepo();
  const deployed = git(repo, 'rev-parse', 'HEAD').trim();
  const hash = f =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(repo, f)))
      .digest('hex');
  const names = ['core/evcore.mjs', 'core/cli.mjs', 'spec/ev.spec.json'];
  const files = Object.fromEntries(names.map(f => [f, hash(f)]));
  const m = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-gate-')), 'manifest.json');
  const run = (manifest, cwd = repo) => {
    fs.writeFileSync(m, JSON.stringify(manifest));
    return execFileSync(
      'node',
      ['-e', line.replace('/tmp/ev/system/manifest.json', m).replace('"/home/claude/ev4"', '"/nonexistent"')],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
  };
  // A record commit after the deploy: the clone's head has the same content.
  fs.writeFileSync(path.join(repo, 'NOTES.md'), 'bookkeeping\n');
  git(repo, 'add', 'NOTES.md');
  git(repo, 'commit', '-q', '-m', 'B-00: notes (chart)');
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  // 1. The deployed commit is in the checkout: checked out and verified there.
  assert.match(
    run({ release, commit: deployed, dirty: false, files }),
    new RegExp(`${deployed.slice(0, 12)} verified in`)
  );
  assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), deployed);
  git(repo, 'checkout', '-q', 'main');
  // 2. Absent from the clone, the same content at its head: goes on, saying so.
  const absent = 'a'.repeat(40);
  assert.match(
    run({ release, commit: absent, dirty: false, files }),
    new RegExp(`${absent.slice(0, 12)} not in this checkout; same content at ${head.slice(0, 12)}, verified in`)
  );
  assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), head, 'stays on the head');
  // 3. Absent, and one file differs at the head: fails naming it.
  assert.throws(
    () => run({ release, commit: absent, dirty: false, files: { ...files, 'core/evcore.mjs': '0'.repeat(64) } }),
    /core\/evcore\.mjs differs from the deployed build \(the deployed commit a{12} is not in this checkout/
  );
  // A changed file at the deployed commit fails as before, and so does a hashed file the checkout lacks.
  assert.throws(
    () => run({ release, commit: deployed, dirty: false, files: { ...files, 'core/evcore.mjs': '0'.repeat(64) } }),
    /core\/evcore\.mjs differs from the deployed build/
  );
  git(repo, 'checkout', '-q', 'main');
  assert.throws(
    () => run({ release, commit: absent, dirty: false, files: { ...files, 'core/gone.mjs': '0'.repeat(64) } }),
    /core\/gone\.mjs differs/
  );
  // 4. A dirty manifest, or one with no full commit, is no deployable build.
  assert.throws(
    () => run({ release, commit: deployed, dirty: true, files }),
    /system\/manifest is not a deployable build/
  );
  assert.throws(() => run({ release, commit: 'abc', dirty: false, files }), /not a deployable build/);
  // 5. No checkout in the session.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-nocheckout-'));
  assert.throws(
    () => run({ release, commit: deployed, dirty: false, files }, empty),
    /the E\.V\. repository is not checked out in this session/
  );
});

test('build writes each prompt beside the manifest, and the manifest carries its hash', async () => {
  const repo = copyRepo();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-dist-'));
  const { manifest } = await build({ root: repo, out, now: '2026-10-18T06:00:00Z' });
  for (const [key, t] of Object.entries(manifest.tasks).filter(([, t]) => t.promptSha256)) {
    const text = fs.readFileSync(path.join(out, 'prompts', key + '.txt'), 'utf8');
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'), t.promptSha256, key);
  }
  assert.ok(manifest.tasks['staging.morning'].promptSha256 && manifest.tasks['build.ev4-builder'].promptSha256);
});

test('B-49: every pipeline prompt says who asked for its writes and how a refused start leaves a trace', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url), 'utf8'));
  let n = 0;
  for (const target of ['live', 'staging'])
    for (const [key, task] of Object.entries(spec.tasks[target])) {
      const prompt = renderPrompt({ key: `${target}.${key}`, task, spec, release: 'v4.0.0' });
      if (!prompt) continue;
      n++;
      assert.match(prompt, /Matt set this scheduled task up himself and approved what it does\./, key);
      assert.match(prompt, /only its owner read or write it/, key);
      assert.match(prompt, /starting with this run's own runs\/<id> entry, is the job he asked for/, key);
      assert.match(
        prompt,
        new RegExp(
          `If the start write itself is refused, make no other call to the record and end with: E\\.V\\. ${task.pipeline} failed at start`
        ),
        key
      );
      assert.match(prompt, /--status failed --detail "<move>: <the refusal, quoted>"/, key);
    }
  assert.ok(n >= 12, 'live and staging prompts rendered');
});

test('B-49: no pipeline purpose describes re-firing or deploying (the live watchdog was refused as "Production Deploy" while its purpose said it re-fires misses)', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url), 'utf8'));
  for (const [name, p] of Object.entries(spec.pipelines))
    if (p && p.purpose) assert.doesNotMatch(p.purpose, /re-?fir|deploy|trigger/i, name);
});

test('D-169 (B-131): step 1 of every task prompt writes the run marker, naming its pipeline and record, before any other call', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url), 'utf8'));
  let n = 0;
  for (const target of ['live', 'staging'])
    for (const [key, task] of Object.entries(spec.tasks[target])) {
      const prompt = renderPrompt({ key: `${target}.${key}`, task, spec, release: 'v4.0.0' });
      if (!prompt) continue;
      n++;
      const step1 = prompt.split('\n').find(l => l.startsWith('1. '));
      assert.ok(step1 && prompt.indexOf(step1) < prompt.indexOf('2. Load the ArtifactData tool'), key);
      const cmd = /: (mkdir -p \/tmp\/ev && printf .+)$/.exec(step1)[1];
      assert.ok(cmd.endsWith(`| tee ${RUN_MARKER}`), key);
      // The shell line, run as written, writes the marker the hooks read.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-mark-'));
      const out = execFileSync('bash', ['-c', cmd.replaceAll('/tmp/ev', dir)], { encoding: 'utf8' });
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'pipeline-run'), 'utf8'));
      assert.deepEqual([m.pipeline, m.record], [task.pipeline, task.record], key);
      assert.match(m.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, key);
      assert.equal(out.trim(), JSON.stringify(m), `${key}: the start time is printed`);
      assert.ok(H.pipelineRun({ file: path.join(dir, 'pipeline-run') }), `${key}: the hooks read it as a fresh run`);
    }
  assert.ok(n >= 12);
});
