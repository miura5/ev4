// deploy and verify-deploy (B-04): verify reports red with nothing deployed; a planted wrong prompt hash and a stale
// page stamp are both reported; matching state is green; deploy prints exact calls and refuses what it must.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyRepo, git } from './helpers.mjs';
import { build } from '../tools/build.mjs';
import { verify, pageStamp, canonical } from '../core/deploy.mjs';

const CLI = new URL('../core/cli.mjs', import.meta.url).pathname;
const NOW = '2026-10-17T12:00:00Z';
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const RECORD = 'StagingRecordForTests1';
function cli(dir, ...a) {
  try { return { code: 0, out: execFileSync('node', [CLI, ...a, '--root', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}
const write = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v, null, 1)); };

/**
 * A pushed throwaway repo whose build names a staging record and page, gives every staging task a trigger and a
 * rendered prompt, and a saved state that matches it exactly. The manifest is edited after the build to stand in
 * for what B-09, B-12 and B-15 will fill.
 */
async function deployedStaging() {
  const dir = copyRepo({ push: true });
  await build({ root: dir, now: NOW });
  const dist = path.join(dir, 'dist'), state = path.join(dist, 'state', 'staging');
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  manifest.records.staging.artifact = RECORD;
  manifest.pages.staging.artifact = RECORD;
  const triggers = [];
  let n = 0;
  for (const [key, t] of Object.entries(manifest.tasks)) {
    if (t.record !== 'staging' && !key.startsWith('build.')) continue;
    t.trigger = t.trigger || `trig_test${++n}`;
    const prompt = `prompt for ${key}`;
    t.promptSha256 = sha256(prompt);
    triggers.push({ id: t.trigger, name: t.name, enabled: true, cron_expression: t.schedule || '', notifications: { channel: { push: t.push } }, ...(t.macBound ? { bound_device_uuid: 'device-1' } : {}), derived_state: { prompt, folders: t.macBound ? t.folders : [] } });
  }
  write(path.join(dist, 'manifest.json'), manifest);
  write(path.join(state, 'triggers-1.json'), { data: triggers.slice(0, 3), has_more: true, next_cursor: 'x' });
  write(path.join(state, 'triggers-2.json'), { data: triggers.slice(3), has_more: false });
  const recordManifest = { ...JSON.parse(fs.readFileSync(path.join(dist, 'system/manifest.json'), 'utf8')), ...manifest };
  write(path.join(state, 'record/system/manifest.json'), recordManifest);
  for (const id of ['spec', 'environments']) {
    const doc = JSON.parse(fs.readFileSync(path.join(dist, 'system', id + '.json'), 'utf8'));
    write(path.join(state, 'record/system', id + '.json'), { ...doc, at: '2026-10-18T00:00:00Z' });
  }
  // The page as the platform serves it back: the built shell inside its skeleton, and each published file.
  const built = path.join(dist, 'page', 'staging');
  write(path.join(state, 'page.html'), '<!doctype html><html><head><meta charset=utf8></head><body>\n' + fs.readFileSync(path.join(built, 'index.html'), 'utf8') + '\n</body></html>');
  for (const f of fs.readdirSync(built)) if (f !== 'index.html') { fs.mkdirSync(path.join(state, 'page-files'), { recursive: true }); fs.copyFileSync(path.join(built, f), path.join(state, 'page-files', f)); }
  write(path.join(state, 'page-declaration.json'), manifest.pages.staging.capabilities);
  write(path.join(state, 'record/system/seed.json'), { schema: 1, writer: 'deploy', at: '2026-10-18T05:30:00Z', source: 'seed-staging', from: 'live export', exportedAt: '2026-10-18T05:02:42Z', migration: 'v3-to-v4', counts: { weakspots: 3 }, hashes: {}, command: 'seed-staging' });
  return { dir, dist, state, manifest };
}

test('from a build chat with nothing deployed, verify-deploy staging is red and prints the reads to save', () => {
  const dir = copyRepo();
  execFileSync('node', [path.join(dir, 'tools/build.mjs'), '--root', dir, '--now', NOW]);
  const r = cli(dir, 'verify-deploy', 'staging');
  assert.equal(r.code, 1);
  assert.match(r.out, /^verify-deploy staging: RED/);
  assert.match(r.out, /NO  build commit is pushed/);
  assert.match(r.out, /NO  staging record read: no saved system\/\* documents/);
  assert.match(r.out, /ArtifactData \{"action":"get","url":"https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+","collection":"system","doc_id":"seed"/);
  assert.match(r.out, /NO  scheduled tasks read/);
  assert.match(r.out, /mcp__claude-code-remote__list_triggers \{"limit":100,"enabled":true\}/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'dist/verify-staging.json'), 'utf8'));
  assert.equal(saved.green, false);
});

test('verify-deploy is green when the saved state matches the manifest', async () => {
  const { dir } = await deployedStaging();
  const r = cli(dir, 'verify-deploy', 'staging');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^verify-deploy staging: GREEN/);
  assert.doesNotMatch(r.out, /NO  /);
  assert.match(r.out, /ok  staging seed: 3 documents from a live export taken 2026-10-18, \d+ days? old/);
});

test('a planted wrong prompt hash and a stale page stamp are both reported', async () => {
  const { dir, state, manifest } = await deployedStaging();
  const p = path.join(state, 'triggers-1.json');
  const page1 = JSON.parse(fs.readFileSync(p, 'utf8'));
  const victim = page1.data.find(t => manifest.tasks[Object.keys(manifest.tasks).find(k => manifest.tasks[k].trigger === t.id)].pipeline);
  victim.derived_state.prompt += ' (edited by hand)';
  write(p, page1);
  write(path.join(state, 'page.html'), '<!doctype html><meta name="ev-release" content="v4.0.0-old"><title>x</title>');
  const r = cli(dir, 'verify-deploy', 'staging');
  assert.equal(r.code, 1);
  assert.match(r.out, /RED \(3 differences\)/);
  assert.match(r.out, /NO  task staging\.[\w-]+: prompt hash differs from the manifest/);
  assert.match(r.out, /NO  page stamp: the published page says v4\.0\.0-old, the build is v4\.\d+\.\d+/);
  assert.match(r.out, /NO  published page files: 1 differ: page\/staging\/index\.html/, 'an old page does not hold the built shell');
});

test('verify reports each kind of drift: missing task, schedule, binding, push, record content, file hashes', async () => {
  const { dist, state, manifest } = await deployedStaging();
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const triggers = [...read(path.join(state, 'triggers-1.json')).data, ...read(path.join(state, 'triggers-2.json')).data];
  const byKey = k => triggers.find(t => t.id === manifest.tasks[k].trigger);
  byKey('staging.evening-mac').bound_device_uuid = undefined;
  byKey('staging.weekly').cron_expression = 'CRON_TZ=America/Chicago 0 9 * * *';
  byKey('staging.worker').notifications.channel.push = true;
  byKey('staging.watchdog').enabled = false;
  const gone = triggers.filter(t => t.id !== manifest.tasks['staging.morning'].trigger);
  const rec = read(path.join(state, 'record/system/manifest.json'));
  rec.files['core/validate.mjs'] = '0'.repeat(64);
  const spec = read(path.join(state, 'record/system/spec.json'));
  spec.specVersion = '4.9.9';
  const dist2 = { spec: read(path.join(dist, 'system/spec.json')), environments: read(path.join(dist, 'system/environments.json')) };
  const result = verify({ manifest, target: 'staging', build: { pushed: true }, dist: dist2, sha256,
    state: { triggers: gone, record: { manifest: rec, spec, environments: read(path.join(state, 'record/system/environments.json')) }, pageHtml: `<meta name="ev-release" content="${manifest.release}">`, pageFiles: null } });
  const bad = Object.fromEntries(result.lines.filter(l => !l.ok).map(l => [l.what, l.detail]));
  assert.match(bad['task staging.morning'], /not found/);
  assert.match(bad['task staging.evening-mac'], /not bound to the Mac/);
  assert.match(bad['task staging.weekly'], /schedule CRON_TZ=America\/Chicago 0 9 \* \* \*, expected none/);
  assert.match(bad['task staging.worker'], /push true, expected false/);
  assert.match(bad['task staging.watchdog'], /disabled/);
  assert.match(bad['system/manifest file hashes'], /core\/validate\.mjs/);
  assert.match(bad['system/spec matches the build'], /differs/);
  assert.equal(result.green, false);
});

test('deploy prints the system batch with expected versions, refuses dirty, unpushed and live without OK', async () => {
  const { dir, dist } = await deployedStaging();
  const r = cli(dir, 'deploy', 'staging', '--version', 'manifest=7', '--version', 'spec=3');
  assert.equal(r.code, 0, r.out);
  const plan = JSON.parse(fs.readFileSync(path.join(dist, 'deploy-staging.json'), 'utf8'));
  const batch = plan.calls[0];
  assert.equal(batch.tool, 'ArtifactData');
  assert.equal(batch.args.url, `https://claude.ai/artifact/${RECORD}`);
  assert.deepEqual(batch.args.writes.map(w => [w.doc_id, w.if_version, path.relative(dist, w.file_path)]), [['manifest', 7, 'system/manifest.json'], ['spec', 3, 'system/spec.json'], ['environments', undefined, 'system/environments.json']]);
  assert.ok(!plan.calls.some(c => c.tool.endsWith('update_trigger')), 'prompts already match: no task updates');
  assert.ok(plan.skipped.some(s => /staging\.evening-mac: Mac-bound/.test(s)));
  assert.match(cli(dir, 'deploy', 'live').out, /REFUSED[\s\S]*Matt's explicit OK/);

  // B-35: live refuses without a green staging verify at the same commit, even with Matt's OK.
  const live = () => cli(dir, 'deploy', 'live', '--matt-ok').out;
  fs.rmSync(path.join(dist, 'verify-staging.json'), { force: true });
  assert.match(live(), /REFUSED[\s\S]*no dist\/verify-staging\.json/);
  const commit = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8')).commit;
  write(path.join(dist, 'verify-staging.json'), { target: 'staging', commit: 'f'.repeat(40), green: true, lines: [] });
  assert.match(live(), /REFUSED[\s\S]*verify-deploy staging ran at ffffffffffff/);
  write(path.join(dist, 'verify-staging.json'), { target: 'staging', commit, green: false, lines: [] });
  assert.match(live(), /REFUSED[\s\S]*verify-deploy staging is red/);
  write(path.join(dist, 'verify-staging.json'), { target: 'staging', commit, green: true, lines: [] });
  assert.doesNotMatch(live(), /verify-staging|verify-deploy staging/, 'green at this commit: the staging rule passes');

  fs.appendFileSync(path.join(dir, 'core/validate.mjs'), '\n// changed\n');
  await build({ root: dir, now: NOW });
  const dirty = cli(dir, 'deploy', 'staging');
  assert.equal(dirty.code, 1);
  assert.match(dirty.out, /REFUSED[\s\S]*dirty/);

  git(dir, 'commit', '-qam', 'unpushed');
  await build({ root: dir, now: NOW });
  assert.match(cli(dir, 'deploy', 'staging').out, /not pushed to origin\/main/);
});

test('deploy prints update_trigger for a task whose live prompt differs', async () => {
  const { dir, state } = await deployedStaging();
  const p = path.join(state, 'triggers-2.json');
  const page = JSON.parse(fs.readFileSync(p, 'utf8'));
  const cloud = page.data.find(t => !t.bound_device_uuid && /^E\.V\. staging/.test(t.name));
  cloud.derived_state.prompt = 'old prompt';
  write(p, page);
  const r = cli(dir, 'deploy', 'staging', '--json');
  const plan = JSON.parse(r.out);
  const updates = plan.calls.filter(c => c.tool === 'mcp__claude-code-remote__update_trigger');
  assert.deepEqual(updates.map(u => u.args.trigger_id), [cloud.id]);
  assert.match(updates[0].args.prompt, /dist\/prompts\/staging\.[\w-]+\.txt/);
});

test('helpers: page stamps and canonical JSON', () => {
  assert.equal(pageStamp('<head><meta name="ev-release" content="v4.1.2"></head>'), 'v4.1.2');
  assert.equal(pageStamp('<head></head>'), null);
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
});

test('usage: an unknown command or target exits 2', () => {
  const r = cli(process.cwd(), 'verify-deploy', 'prod');
  assert.equal(r.code, 2);
});

test('verify-deploy staging is red without a seed stamp', async () => {
  const { dir, state } = await deployedStaging();
  fs.rmSync(path.join(state, 'record/system/seed.json'));
  const r = cli(dir, 'verify-deploy', 'staging');
  assert.equal(r.code, 1); assert.match(r.out, /NO  staging seed: no system\/seed: run seed-staging/);
});

test('verify-deploy: a task whose pipeline has no steps in the build is pending, not a difference', async () => {
  const { verify } = await import('../core/deploy.mjs');
  const manifest = { release: 'v4.0.0', commit: 'a'.repeat(40), dirty: false, specVersion: '4.0.0', files: {}, pages: { staging: { artifact: null, files: {}, capabilities: null } }, records: { staging: { artifact: null, systemDocs: [] } },
    tasks: { 'staging.evening-mac': { name: 'x', pipeline: 'evening-mac', record: 'staging', lane: 'mac', schedule: null, macBound: true, folders: [], push: false, trigger: null, promptSha256: null },
             'staging.weekly': { name: 'y', pipeline: 'weekly', record: 'staging', lane: 'cloud', schedule: null, macBound: false, folders: [], push: false, trigger: null, promptSha256: 'b'.repeat(64) } } };
  const r = verify({ manifest, target: 'staging', state: { triggers: [], record: null, pageHtml: null }, build: { commit: manifest.commit, dirty: false, pushed: true }, sha256: s => s, now: '2026-10-18T06:00:00Z' });
  const line = k => r.lines.find(l => l.what === `task ${k}`);
  assert.deepEqual([line('staging.evening-mac').ok, line('staging.evening-mac').detail], [true, 'pending: its pipeline has no steps in this build']);
  assert.deepEqual([line('staging.weekly').ok, line('staging.weekly').detail], [false, 'not created yet']);
});
