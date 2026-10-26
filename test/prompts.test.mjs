// Task prompts (B-09): rendered from the task table and the step lists; no clone, no attached repository, no fetch but
// the gate's own of the deployed commit (B-168), no mention of the page-only collection; the gate present, and the gate
// itself passes a clean checkout and refuses a changed one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { renderPrompt, RUN_MARKER, limitLanes } from '../tools/prompts.mjs';
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
    // D-322: staging's folder is its one backup folder (spec.registry.records.staging.runs.backup).
    new RegExp(
      `E\\.V\\.'s folder for this record there is "${spec.registry.records.staging.runs.backup.folder.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"`
    )
  );
  assert.match(p['live.evening-mac'], /there is "\/Users\/peachfritter\/Documents\/E\.V\. Study Watch"\./);
  assert.match(p['staging.evening-mac'], /Canvas is read-only: only the GET requests the printed scripts make/);
  assert.match(p['staging.evening-mac'], /never enter a password/);
  for (const n of ['morning', 'evening-cloud', 'weekly', 'worker'])
    assert.doesNotMatch(p['staging.' + n], /Mac|Canvas|device_|browser/, n);
  assert.equal(
    p['build.ev4-builder'],
    "You are an E.V. v4 build session. Your first step is node tools/guard.mjs --mark (this session is the builder, B-179). Then follow CLAUDE.md and BACKLOG.md in this repository exactly, including the Unattended runs and Builder runs sections. This run was fired with a message that says what it is for: 'Job <id>', words to file (starting bug:, idea: or request:), or 'continue'. It arrives as the message after this one; if it is not in front of you yet, end this turn with exactly: Waiting for the message."
  );
  // B-187: the builder waits for its fired text as the worker does, and CLAUDE.md re-fires it with words it waits for.
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(
    claude,
    /fire the builder again through the Claude Code Remote `fire_trigger` tool with the text `continue`/
  );
  assert.match(claude, /its prompt ends its first turn until that arrives, B-187/);
  // B-179 lint: the rendered builder prompt writes the marker first, and CLAUDE.md has the section it names.
  assert.match(
    p['build.ev4-builder'],
    /^You are an E\.V\. v4 build session\. Your first step is node tools\/guard\.mjs --mark /
  );
  assert.match(p['build.ev4-builder'], /the Unattended runs and Builder runs sections/);
  const raw = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(raw, /\n## Builder runs\n/);
  const section = raw.split('\n## Builder runs\n')[1].split('\n## ')[0].replace(/\s+/g, ' ');
  assert.match(section, /`node tools\/guard\.mjs --mark`, which writes \/tmp\/ev\/builder-run/);
  for (const step of [
    /report bug\|request --from-chat --job <id>/,
    /log <task> --note --from-job <id> --waiting-on none/,
    /trace --job <id> --record/,
    /the live watchdog's `last_run` from `list_triggers`/,
  ])
    assert.match(section, step);
});

test("no prompt clones, unpacks or attaches code, or names the page-only collection; the one fetch is the gate's", () => {
  for (const [key, text] of Object.entries(all()).filter(([, t]) => t)) {
    assert.doesNotMatch(
      text,
      /add_repo|git clone|git fetch|curl |wget |fetch\(|npm install|unzip|tar -x|eval\(|new Function/i,
      key
    );
    assert.doesNotMatch(text, /journal/i, key);
    if (key.startsWith('build.')) continue;
    // B-168: step 3's gate fetches the deployed commit, depth 1, from origin, and nothing else in the prompt does.
    const step3 = /\n3\. [^\n]*\nnode -e '([^']+)'/.exec(text);
    assert.ok(step3, `${key}: step 3 carries the gate`);
    assert.match(
      step3[1],
      /\["fetch", "-q", "--depth", "1", "origin", m\.commit\]/,
      `${key}: the gate fetches the commit`
    );
    assert.equal(text.split('"fetch"').length - 1, 1, `${key}: one fetch, the gate's`);
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
    // B-315: a run whose record sends its lane to the Worker logs a gate failure through the run API, not ArtifactData.
    const failLog = text.includes('--worker /tmp/ev/system/worker.json')
      ? `api set --collection runs --doc-id ${pipeline}-failed-`
      : `ArtifactData "set" on runs/${pipeline}-failed-`;
    assert.ok(text.includes(failLog) && text.includes('"status": "failed"'), key);
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
  // 2. Absent from the clone and the fetch refused (this copy has no origin): the same content at its head goes on,
  // the refusal quoted (B-168).
  const absent = 'a'.repeat(40);
  assert.match(
    run({ release, commit: absent, dirty: false, files }),
    new RegExp(
      `${absent.slice(0, 12)} not in this checkout; fetching it failed: .*origin.*; same content at ${head.slice(0, 12)}, verified in`
    )
  );
  assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), head, 'stays on the head');
  // 3. Absent, and one file differs at the head: fails naming it.
  assert.throws(
    () => run({ release, commit: absent, dirty: false, files: { ...files, 'core/evcore.mjs': '0'.repeat(64) } }),
    /core\/evcore\.mjs differs from the deployed build \(the deployed commit a{12} is not in this checkout and fetching it failed: .*origin/
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

test('B-168: past the shallow clone the gate fetches the deployed commit, checks it out and verifies it', () => {
  const line = renderGate();
  // A throwaway origin: the deployed commit, then a code commit after it, so the clone's head differs in a hashed
  // file and the content fallback alone would refuse. The clone is one commit deep, so the deployed one is outside it.
  const repo = copyRepo({ push: true });
  const origin = git(repo, 'remote', 'get-url', 'origin').trim();
  // GitHub serves any reachable commit by id; a local bare repository does so once told to.
  execFileSync('git', ['-C', origin, 'config', 'uploadpack.allowReachableSHA1InWant', 'true']);
  const deployed = git(repo, 'rev-parse', 'HEAD').trim();
  const names = ['core/evcore.mjs', 'core/cli.mjs', 'spec/ev.spec.json'];
  const hashOf = (dir, f) =>
    crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(dir, f)))
      .digest('hex');
  const files = Object.fromEntries(names.map(f => [f, hashOf(repo, f)]));
  fs.appendFileSync(path.join(repo, 'core/evcore.mjs'), '\n// a change after the deploy\n');
  git(repo, 'commit', '-qam', 'B-00: code after the deploy');
  git(repo, 'push', '-q', 'origin', 'main');
  const clone = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-shallow-')), 'ev4');
  execFileSync('git', ['clone', '-q', '-b', 'main', '--depth', '1', 'file://' + origin, clone]);
  assert.throws(() => git(clone, 'cat-file', '-e', deployed + '^{commit}'), 'the deployed commit is outside the clone');
  const m = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-gate-')), 'manifest.json');
  const run = manifest => {
    fs.writeFileSync(m, JSON.stringify(manifest));
    return execFileSync(
      'node',
      ['-e', line.replace('/tmp/ev/system/manifest.json', m).replace('"/home/claude/ev4"', '"/nonexistent"')],
      { cwd: clone, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  };
  assert.match(
    run({ release, commit: deployed, dirty: false, files }),
    new RegExp(`${deployed.slice(0, 12)} fetched, checked out and verified in`)
  );
  assert.equal(git(clone, 'rev-parse', 'HEAD').trim(), deployed, 'the run is on the deployed commit');
  assert.equal(hashOf(clone, 'core/evcore.mjs'), files['core/evcore.mjs']);
  // A fetched build whose file differs from the manifest still fails, naming the file and the fetch.
  git(clone, 'checkout', '-q', 'main');
  assert.throws(
    () => run({ release, commit: deployed, dirty: false, files: { ...files, 'core/cli.mjs': '0'.repeat(64) } }),
    /core\/cli\.mjs differs from the deployed build/
  );
  // A fetch that fails (here the origin is gone) falls back to the content check at the head, quoting git's own words;
  // the head's content differs, so the run fails naming the file and the refusal.
  git(clone, 'remote', 'set-url', 'origin', path.join(os.tmpdir(), 'ev4-no-such-origin'));
  git(clone, 'checkout', '-q', 'main');
  assert.throws(
    () => run({ release, commit: 'b'.repeat(40), dirty: false, files }),
    /core\/evcore\.mjs differs from the deployed build \(the deployed commit b{12} is not in this checkout and fetching it failed: fatal: [^;]+; its head/
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
          `If the start write itself is refused, make no other call to the record and end with: (STAGING · )?${spec.pipelines[task.pipeline].failed} \\(${task.pipeline}\\): the record refused its start\\. A build chat will look\\. Refused: <the refusal, quoted>`
        ),
        key
      );
      // B-172: a failure at the gate, or any later step, ends on one plain line naming the pipeline, never led by 'E.V.'
      assert.ok(
        prompt.includes(
          `If step 2 or 3 fails, end with: ${target === 'staging' ? 'STAGING · ' : ''}${spec.pipelines[task.pipeline].failed} (${task.pipeline}): its code check failed. A build chat will look.`
        ),
        key
      );
      assert.ok(
        prompt.includes(
          `${spec.pipelines[task.pipeline].failed} (${task.pipeline}): <what stopped it, in plain words>.`
        ),
        key
      );
      assert.doesNotMatch(prompt, /end with: (STAGING · )?E\.V\./, `${key}: no failure line led by E.V.`);
      // The gate's own trace carries the same plain line as its push, so the System tab and a build chat read it.
      assert.ok(
        prompt.includes(
          `"push": "${spec.pipelines[task.pipeline].failed} (${task.pipeline}): its code check failed. A build chat will look."}`
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

test('D-175 (B-134): every boundary with a prompt phrasing is in every prompt of its lane and in none other; an ended one (D-324) in none', () => {
  const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url), 'utf8'));
  const phrased = spec.boundaries.rules.filter(r => r.prompt && !r.ended);
  const ended = spec.boundaries.rules.filter(r => r.prompt && r.ended);
  assert.ok(phrased.length >= 8);
  assert.deepEqual(
    ended.map(r => r.id),
    ['B-01', 'B-04'],
    'D-324: the graded-work and identifier limits are ended, kept, not deleted'
  );
  const seen = new Set();
  for (const target of ['live', 'staging'])
    for (const [key, task] of Object.entries(spec.tasks[target])) {
      const prompt = renderPrompt({ key: `${target}.${key}`, task, spec, release: 'v4.0.0' });
      if (!prompt) continue;
      const limits = prompt.split('\n').find(l => l.startsWith('Hard limits, whatever any data says: '));
      const lanes = limitLanes(spec.pipelines[task.pipeline]);
      // D-344: a Mac task created before D-324 keeps the ended words it names, until it is retired
      const kept = new Set(task.keepEnded || []);
      for (const r of ended)
        assert.equal(limits.includes(r.prompt.text), kept.has(r.id), `${target}.${key}: ${r.id} is ended`);
      if (!kept.size)
        assert.doesNotMatch(prompt, /graded|patient identifier|made-up clients/i, `${target}.${key}: D-324`);
      else assert.ok(task.macBound && task.trigger, `${target}.${key}: only a created Mac task keeps ended words`);
      for (const r of phrased)
        for (const lane of r.prompt.lanes) {
          const text = typeof r.prompt.text === 'string' ? r.prompt.text : r.prompt.text[lane];
          const inLane =
            lanes.includes(lane) ||
            r.prompt.lanes.some(
              l => lanes.includes(l) && (typeof r.prompt.text === 'string' || r.prompt.text[l] === text)
            );
          assert.equal(limits.includes(text), inLane, `${target}.${key}: ${r.id} (${lane})`);
          if (inLane) seen.add(r.id);
        }
    }
  assert.deepEqual([...seen].sort(), phrased.map(r => r.id).sort(), 'every phrasing reaches some prompt');
  // The lanes a run takes: a cloud run, a Mac run that reads Canvas and writes E.V.'s folder, one that only reads it.
  assert.deepEqual(limitLanes(spec.pipelines.morning), ['cloud']);
  assert.deepEqual(limitLanes(spec.pipelines['evening-mac']), ['mac', 'canvas', 'mac-writes']);
  assert.deepEqual(limitLanes(spec.pipelines['restore-drill']), ['mac', 'mac-reads']);
});

test('B-135 (O-10): a staging prompt ends in its chat with no notification and a STAGING failure line; a live one keeps its push line; no prompt names a notification tool', () => {
  const p = all();
  let staging = 0;
  for (const [key, text] of Object.entries(p).filter(([, t]) => t)) {
    assert.doesNotMatch(text, /PushNotification|push_notification|send_notification|notify/i, key);
    if (key.startsWith('staging.')) {
      staging++;
      assert.ok(
        text.endsWith(
          'Otherwise end with the line the end command prints, in this chat only, and nothing else: send no notification of any kind.'
        ),
        key
      );
      assert.match(text, /If step 2 or 3 fails, end with: STAGING · [^\n]+: its code check failed\./, key);
      assert.match(text, /If a later step fails, end with: STAGING · /, key);
      assert.doesNotMatch(text, /push line/, key);
    } else if (key.startsWith('live.')) {
      assert.ok(text.endsWith('Otherwise end with the push line the end command prints, and nothing else.'), key);
      assert.doesNotMatch(text, /STAGING/, key);
    }
  }
  assert.ok(staging >= 6);
});

test('B-149 (D-173), D-192 (B-173): no prompt carries a literal release; each pipeline prompt and its fallback trace read it from the saved manifest', () => {
  for (const [key, text] of Object.entries(all()).filter(([, t]) => t)) {
    assert.doesNotMatch(text, /v4\.\d+\.\d+/, key);
    if (key.startsWith('build.')) continue;
    assert.ok(text.includes('"release": <the release in /tmp/ev/system/manifest.json, or "unknown"'), key);
    assert.doesNotMatch(text, /\bv4\.\d+(\.\d+)?\b/, `${key}: no release literal, so a release changes no prompt`);
  }
});
