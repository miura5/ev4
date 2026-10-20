// B-56, B-57, B-58: the build chat's hooks (tools/hooks.mjs, wired in .claude/settings.json), each run as the harness
// runs it: JSON on stdin, exit 2 and a message on stderr for "no", exit 0 to pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, copyRepo } from './helpers.mjs';
import * as H from '../tools/hooks.mjs';

const hook = (dir, cmd, input) => { const r = spawnSync(process.execPath, [path.join(dir, 'tools', 'hooks.mjs'), cmd], { input: JSON.stringify(input), encoding: 'utf8' }); return { code: r.status, err: r.stderr }; };
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8')).registry.records.live.artifact;
const STAGING = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8')).registry.records.staging.artifact;

test('the hooks are wired: Stop, PostToolUse on Edit and Write, PreToolUse on ArtifactData and Artifact', () => {
  const cmds = ev => (settings.hooks[ev] || []).flatMap(h => h.hooks.map(x => [h.matcher || '', x.command]));
  assert.ok(cmds('Stop').some(([, c]) => /hooks\.mjs" stop$/.test(c)));
  assert.ok(cmds('PostToolUse').some(([m, c]) => /Edit/.test(m) && /Write/.test(m) && /spec-format$/.test(c)));
  assert.ok(cmds('PreToolUse').some(([m, c]) => new RegExp('^(' + m + ')$').test('ArtifactData') && new RegExp('^(' + m + ')$').test('Artifact') && /live-guard$/.test(c)));
});

test('B-56: a session that leaves a failing test is told so at its end; a green one ends quietly; nothing is changed', () => {
  const dir = copyRepo();
  for (const f of fs.readdirSync(path.join(dir, 'test'))) if (f.endsWith('.test.mjs')) fs.rmSync(path.join(dir, 'test', f));
  fs.writeFileSync(path.join(dir, 'test', 'ok.test.mjs'), "import test from 'node:test'; test('fine', () => {});\n");
  assert.deepEqual(hook(dir, 'stop', {}), { code: 0, err: '' }, 'green: quiet');
  fs.writeFileSync(path.join(dir, 'test', 'planted.test.mjs'), "import test from 'node:test'; import assert from 'node:assert'; test('planted failure', () => assert.equal(1, 2));\n");
  const before = fs.readFileSync(path.join(dir, 'test', 'planted.test.mjs'), 'utf8');
  const red = hook(dir, 'stop', {});
  assert.equal(red.code, 2);
  assert.match(red.err, /npm test is red: planted failure/);
  assert.equal(fs.readFileSync(path.join(dir, 'test', 'planted.test.mjs'), 'utf8'), before, 'the hook edits nothing');
  assert.deepEqual(hook(dir, 'stop', { stop_hook_active: true }), { code: 0, err: '' }, 'never blocks twice in a row');
});

test('B-57: a spec edit at indent 2 comes back at indent 1 with no trailing newline and the same content; other files are untouched', () => {
  const dir = copyRepo();
  const spec = path.join(dir, 'spec', 'schemas', 'days.schema.json'), other = path.join(dir, 'package.json');
  const content = JSON.parse(fs.readFileSync(spec, 'utf8'));
  fs.writeFileSync(spec, JSON.stringify(content, null, 2) + '\n');
  assert.equal(hook(dir, 'spec-format', { tool_name: 'Edit', tool_input: { file_path: spec } }).code, 0);
  assert.equal(fs.readFileSync(spec, 'utf8'), JSON.stringify(content, null, 1));
  const pkg = JSON.stringify(JSON.parse(fs.readFileSync(other, 'utf8')), null, 2) + '\n'; fs.writeFileSync(other, pkg);
  hook(dir, 'spec-format', { tool_name: 'Write', tool_input: { file_path: other } });
  assert.equal(fs.readFileSync(other, 'utf8'), pkg, 'not a spec file: untouched');
  fs.writeFileSync(spec, '{ "broken": ');
  const bad = hook(dir, 'spec-format', { tool_name: 'Write', tool_input: { file_path: spec } });
  assert.equal(bad.code, 2); assert.equal(fs.readFileSync(spec, 'utf8'), '{ "broken": ', 'not JSON: said, left as it is');
  assert.equal(H.specFileOf({ tool_name: 'Read', tool_input: { file_path: spec } }, dir), null);
});

test('B-58: a live write or publish is refused without dist/live-ok, passes with a fresh one; staging always passes', () => {
  const dir = copyRepo(), url = `https://claude.ai/artifact/${LIVE}`;
  const write = { tool_name: 'ArtifactData', tool_input: { action: 'set', url, collection: 'days', doc_id: 'x', data: {} } };
  const publish = { tool_name: 'Artifact', tool_input: { file_path: 'dist/page/live/index.html', url } };
  for (const call of [write, publish]) { const r = hook(dir, 'live-guard', call); assert.equal(r.code, 2); assert.match(r.err, /^Refused: an Artifact(Data set on the live record| publish of the live page)\. Live changes only through deploy live --matt-ok/); }
  assert.equal(hook(dir, 'live-guard', { tool_name: 'ArtifactData', tool_input: { action: 'get', url, collection: 'system', doc_id: 'manifest' } }).code, 0, 'a read passes');
  assert.equal(hook(dir, 'live-guard', { tool_name: 'Artifact', tool_input: { action: 'read', url } }).code, 0);
  for (const call of [write, publish]) assert.equal(hook(dir, 'live-guard', { ...call, tool_input: { ...call.tool_input, url: `https://claude.ai/artifact/${STAGING}` } }).code, 0, 'staging passes');
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist', 'live-ok'), JSON.stringify({ at: Date.now(), commit: 'c', by: 'deploy live --matt-ok' }));
  for (const call of [write, publish]) assert.equal(hook(dir, 'live-guard', call).code, 0, 'with a fresh live-ok');
  fs.writeFileSync(path.join(dir, 'dist', 'live-ok'), JSON.stringify({ at: Date.now() - 3 * 36e5 }));
  assert.match(hook(dir, 'live-guard', write).err, /older than that/);
  assert.match(H.liveGuard({ tool_name: 'mcp__x__ArtifactData', tool_input: { action: 'batch', url } }, { liveId: LIVE }), /ArtifactData batch/);
});
