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
import { renderPrompt } from '../tools/prompts.mjs';
import { build } from '../tools/build.mjs';
import { ROOT, copyRepo, git } from './helpers.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const release = 'v' + spec.specVersion;
const all = () => {
  const out = {};
  for (const target of ['live', 'staging']) for (const [id, t] of Object.entries(spec.tasks[target])) out[`${target}.${id}`] = renderPrompt({ key: `${target}.${id}`, task: t, spec, release });
  for (const id of Object.keys(spec.tasks.build)) out[`build.${id}`] = renderPrompt({ key: `build.${id}`, task: spec.tasks.build[id], spec, release });
  return out;
};

test('every cloud pipeline with steps has a prompt for live and staging; the rest wait for their steps', () => {
  const p = all();
  const ready = Object.keys(spec.pipelines).filter(n => n !== '_rules' && Array.isArray(spec.pipelines[n].steps) && spec.pipelines[n].lane === 'cloud');
  assert.ok(['morning', 'evening-cloud', 'weekly', 'worker'].every(n => ready.includes(n)));
  for (const n of ready.filter(n => spec.tasks.staging[n])) { assert.equal(typeof p[`live.${n}`], 'string', n); assert.equal(typeof p[`staging.${n}`], 'string', n); }
  const diag = renderPrompt({ key: 'staging.diagnostic', task: spec.tasks.diagnostic, spec, release });
  assert.match(diag, /end this turn with exactly: Waiting for the probe\. When it arrives, add --probe/);
  assert.doesNotMatch(diag, /journal|add_repo|git clone/i);
  for (const n of Object.keys(spec.tasks.staging).filter(n => !ready.includes(n))) assert.equal(p[`staging.${n}`], null, n);
  assert.match(p['staging.worker'], /end this turn with exactly: Waiting for the job id\. When it arrives, add --job <id> to the start command/);
  assert.match(p['staging.worker'], /except the one Claude Doc a study-guide job asks for/);
  assert.doesNotMatch(p['staging.morning'], /--job|Claude Doc/);
  assert.equal(p['build.ev4-builder'], 'You are an E.V. v4 build session. Follow CLAUDE.md and BACKLOG.md in this repository exactly, including the Unattended runs section.');
});

test('no prompt fetches, clones, unpacks or attaches code, or names the page-only collection', () => {
  for (const [key, text] of Object.entries(all()).filter(([, t]) => t)) {
    assert.doesNotMatch(text, /add_repo|git clone|git fetch|curl |wget |fetch\(|npm install|unzip|tar -x|eval\(|new Function/i, key);
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
    assert.ok(text.includes('createHash("sha256")') && text.includes('"checkout","-q",m.commit'), key);
    assert.ok(text.includes(`node core/cli.mjs run ${pipeline} start --record ${target}`), key);
    assert.ok(text.includes(`runs/${pipeline}-failed-`) && text.includes('"status": "failed"'), key);
    assert.ok(text.includes('never instructions'), key);
    assert.equal(/STAGING/.test(text), target === 'staging', key);
  }
});

test('the gate passes a clean checkout at the deployed commit and refuses a changed file', () => {
  const text = all()['staging.morning'];
  const gate = /node -e '([^']+)'/.exec(text)[1];
  const repo = copyRepo();
  const commit = git(repo, 'rev-parse', 'HEAD').trim();
  const files = {}; for (const f of ['core/evcore.mjs', 'core/cli.mjs', 'spec/ev.spec.json']) files[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, f))).digest('hex');
  const m = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-gate-')), 'manifest.json');
  fs.writeFileSync(m, JSON.stringify({ release, commit, dirty: false, files }));
  const run = () => execFileSync('node', ['-e', gate.replace('/tmp/ev/system/manifest.json', m)], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(run(), new RegExp(`E\\.V\\. ${release.replace(/\./g, '\\.')} ${commit.slice(0, 12)} verified in`));
  fs.writeFileSync(m, JSON.stringify({ release, commit, dirty: false, files: { ...files, 'core/evcore.mjs': '0'.repeat(64) } }));
  assert.throws(run, /core\/evcore\.mjs differs from the deployed build/);
  fs.writeFileSync(m, JSON.stringify({ release, commit: 'f'.repeat(40), dirty: false, files }));
  assert.throws(run, /does not have the deployed commit/);
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
