// deploy and verify-deploy (B-04): verify reports red with nothing deployed; a planted wrong prompt hash and a stale
// page stamp are both reported; matching state is green; deploy prints exact calls and refuses what it must.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyRepo, git, ROOT } from './helpers.mjs';
import { build } from '../tools/build.mjs';
import { verify, pageStamp, canonical, contentHash, deployCalls } from '../core/deploy.mjs';

const CLI = new URL('../core/cli.mjs', import.meta.url).pathname;
const NOW = '2026-10-17T12:00:00Z';
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const RECORD = 'StagingRecordForTests1';
function cli(dir, ...a) {
  try {
    return {
      code: 0,
      out: execFileSync('node', [CLI, ...a, '--root', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}
const write = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v, null, 1));
};

/**
 * A pushed throwaway repo whose build names a staging record and page, gives every staging task a trigger and a
 * rendered prompt, and a saved state that matches it exactly. The manifest is edited after the build to stand in
 * for what B-09, B-12 and B-15 will fill.
 */
async function deployedStaging() {
  const dir = copyRepo({ push: true });
  await build({ root: dir, now: NOW });
  const dist = path.join(dir, 'dist'),
    state = path.join(dist, 'state', 'staging');
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
    triggers.push({
      id: t.trigger,
      name: t.name,
      enabled: true,
      cron_expression: t.schedule || '',
      notifications: { channel: { push: t.push } },
      ...(t.macBound ? { bound_device_uuid: 'device-1' } : {}),
      derived_state: { prompt, folders: t.macBound ? t.folders : [] },
    });
  }
  write(path.join(dist, 'manifest.json'), manifest);
  write(path.join(state, 'triggers-1.json'), { data: triggers.slice(0, 3), has_more: true, next_cursor: 'x' });
  write(path.join(state, 'triggers-2.json'), { data: triggers.slice(3), has_more: false });
  const recordManifest = {
    ...JSON.parse(fs.readFileSync(path.join(dist, 'system/manifest.json'), 'utf8')),
    ...manifest,
  };
  write(path.join(state, 'record/system/manifest.json'), recordManifest);
  for (const id of ['spec', 'environments']) {
    const doc = JSON.parse(fs.readFileSync(path.join(dist, 'system', id + '.json'), 'utf8'));
    write(path.join(state, 'record/system', id + '.json'), { ...doc, at: '2026-10-18T00:00:00Z' });
  }
  // The page as the platform serves it back: the built shell inside its skeleton, and each published file.
  const built = path.join(dist, 'page', 'staging');
  write(
    path.join(state, 'page.html'),
    '<!doctype html><html><head><meta charset=utf8></head><body>\n' +
      fs.readFileSync(path.join(built, 'index.html'), 'utf8') +
      '\n</body></html>'
  );
  for (const f of fs.readdirSync(built))
    if (f !== 'index.html') {
      fs.mkdirSync(path.join(state, 'page-files'), { recursive: true });
      fs.copyFileSync(path.join(built, f), path.join(state, 'page-files', f));
    }
  write(path.join(state, 'page-declaration.json'), manifest.pages.staging.capabilities);
  write(path.join(state, 'record/system/seed.json'), {
    schema: 1,
    writer: 'deploy',
    at: '2026-10-18T05:30:00Z',
    source: 'seed-staging',
    from: 'live export',
    exportedAt: '2026-10-18T05:02:42Z',
    migration: 'v3-to-v4',
    counts: { weakspots: 3 },
    hashes: {},
    command: 'seed-staging',
  });
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
  assert.match(
    r.out,
    /ArtifactData \{"action":"get","url":"https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+","collection":"system","doc_id":"seed"/
  );
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
  // B-150: the size of each system document the deploy writes, with its budget.
  assert.match(r.out, /ok  system\/spec size: \d+ bytes \(\d+ KiB; warns at 192 KiB, fails at 240 KiB\)/);
  assert.match(r.out, /ok  system\/environments size: /);
});

test('B-150: systemSize measures compact JSON and marks the warning and failing lines', async () => {
  const { systemSize } = await import('../core/deploy.mjs');
  const budget = { warnBytes: 196608, failBytes: 245760 };
  const doc = n => ({ pad: 'x'.repeat(n) });
  assert.equal(systemSize('spec', doc(10), budget).bytes, JSON.stringify(doc(10)).length);
  assert.equal(systemSize('spec', doc(100 * 1024), budget).level, 'ok');
  const warn = systemSize('spec', doc(200 * 1024), budget);
  assert.equal(warn.level, 'warn');
  assert.match(warn.line, /^system\/spec is \d+ bytes \(200 KiB; warns at 192 KiB, fails at 240 KiB\): WARNING/);
  assert.equal(systemSize('spec', doc(241 * 1024), budget).level, 'fail');
  assert.equal(systemSize('spec', doc(241 * 1024), {}).level, 'ok', 'no budget, no verdict');
});

test('a planted wrong prompt hash and a stale page stamp are both reported', async () => {
  const { dir, state, manifest } = await deployedStaging();
  const p = path.join(state, 'triggers-1.json');
  const page1 = JSON.parse(fs.readFileSync(p, 'utf8'));
  const victim = page1.data.find(
    t => manifest.tasks[Object.keys(manifest.tasks).find(k => manifest.tasks[k].trigger === t.id)].pipeline
  );
  victim.derived_state.prompt += ' (edited by hand)';
  write(p, page1);
  write(path.join(state, 'page.html'), '<!doctype html><meta name="ev-release" content="v4.0.0-old"><title>x</title>');
  const r = cli(dir, 'verify-deploy', 'staging');
  assert.equal(r.code, 1);
  assert.match(r.out, /RED \(3 differences\)/);
  assert.match(r.out, /NO  task staging\.[\w-]+: prompt hash differs from the manifest/);
  assert.match(r.out, /NO  page stamp: the published page says v4\.0\.0-old, the build is v4\.\d+\.\d+/);
  assert.match(
    r.out,
    /NO  published page files: 1 differ: page\/staging\/index\.html/,
    'an old page does not hold the built shell'
  );
});

test('verify reports each kind of drift: missing task, schedule, binding, push, record content, file hashes', async () => {
  const { dist, state, manifest } = await deployedStaging();
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const triggers = [
    ...read(path.join(state, 'triggers-1.json')).data,
    ...read(path.join(state, 'triggers-2.json')).data,
  ];
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
  const dist2 = {
    spec: read(path.join(dist, 'system/spec.json')),
    environments: read(path.join(dist, 'system/environments.json')),
  };
  const result = verify({
    manifest,
    target: 'staging',
    build: { pushed: true },
    dist: dist2,
    sha256,
    state: {
      triggers: gone,
      record: { manifest: rec, spec, environments: read(path.join(state, 'record/system/environments.json')) },
      pageHtml: `<meta name="ev-release" content="${manifest.release}">`,
      pageFiles: null,
    },
  });
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
  assert.deepEqual(
    batch.args.writes.map(w => [w.doc_id, w.if_version, path.relative(dist, w.file_path)]),
    [
      ['manifest', 7, 'system/manifest.json'],
      ['spec', 3, 'system/spec.json'],
      ['environments', undefined, 'system/environments.json'],
    ]
  );
  assert.ok(!plan.calls.some(c => c.tool.endsWith('update_trigger')), 'prompts already match: no task updates');
  assert.ok(
    !plan.skipped.some(s => /staging\.evening-mac: Mac-bound/.test(s)),
    'a Mac-bound task whose prompt matches is not named as skipped (B-149)'
  );
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

  // B-87: live waits for a running study session, and it needs a fresh read of the live record's running sessions.
  assert.match(live(), /REFUSED[\s\S]*read the live record's running sessions first/);
  const lst = path.join(dist, 'state', 'live');
  fs.mkdirSync(path.join(lst, 'running', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(lst, 'running.txt'), 'No documents matched in collection "sessions".');
  assert.doesNotMatch(live(), /running sessions first|is running on live/, 'a fresh read with nothing running passes');
  write(path.join(lst, 'running', 'sessions', 'ss-x.json'), {
    status: 'active',
    kind: 'note',
    topic: 'Ch 39',
    startedAt: new Date(Date.now() - 5 * 60e3).toISOString(),
    events: {},
  });
  assert.match(live(), /REFUSED[\s\S]*a study session is running on live \("Ch 39", last activity 5 min ago\)/);
  assert.doesNotMatch(
    cli(dir, 'deploy', 'live', '--matt-ok', '--during-session').out,
    /is running on live|running sessions first/,
    '--during-session overrides'
  );
  write(path.join(lst, 'running', 'sessions', 'ss-x.json'), {
    status: 'active',
    kind: 'note',
    topic: 'Ch 39',
    startedAt: new Date(Date.now() - 3 * 3600e3).toISOString(),
    events: {},
  });
  assert.doesNotMatch(live(), /is running on live/, 'a session left active for hours does not block');
  const old = (Date.now() - 20 * 60e3) / 1000;
  fs.utimesSync(path.join(lst, 'running.txt'), old, old);
  assert.match(live(), /REFUSED[\s\S]*running sessions first[\s\S]*20 min old/);
  fs.rmSync(path.join(lst, 'running'), { recursive: true, force: true });
  fs.rmSync(path.join(lst, 'running.txt'), { force: true });

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
  assert.deepEqual(
    updates.map(u => u.args.trigger_id),
    [cloud.id]
  );
  assert.match(updates[0].args.prompt, /dist\/prompts\/staging\.[\w-]+\.txt/);
});

test("B-149: deploy renames a task whose name changed; a Mac-bound one by name alone, on Matt's OK", async () => {
  const { dir, state } = await deployedStaging();
  const p = path.join(state, 'triggers-2.json');
  const page = JSON.parse(fs.readFileSync(p, 'utf8'));
  const cloud = page.data.find(t => !t.bound_device_uuid && /^E\.V\. staging/.test(t.name));
  const mac = page.data.find(t => t.bound_device_uuid && /^E\.V\. staging/.test(t.name));
  const want = { cloud: cloud.name, mac: mac && mac.name };
  cloud.name = 'E.V. old name';
  if (mac) mac.name = 'E.V. old mac name';
  write(p, page);
  const plan = JSON.parse(cli(dir, 'deploy', 'staging', '--json').out);
  const updates = plan.calls.filter(c => c.tool === 'mcp__claude-code-remote__update_trigger');
  const c = updates.find(u => u.args.trigger_id === cloud.id);
  assert.deepEqual(c.args, { trigger_id: cloud.id, name: want.cloud }, 'the name alone: the prompt already matches');
  if (mac) {
    const m = updates.find(u => u.args.trigger_id === mac.id);
    assert.deepEqual(m.args, { trigger_id: mac.id, name: want.mac });
    assert.match(m.step, /Mac-bound.*without the prompt.*Matt's explicit OK/);
  }
});

test('B-137 (O-5): a Mac task is created, never edited: its create_trigger printout carries notifications and folders', async () => {
  const { dir, dist } = await deployedStaging();
  const mp = path.join(dist, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
  const want = manifest.tasks['staging.evening-mac'];
  delete want.trigger;
  write(mp, manifest);
  const plan = JSON.parse(cli(dir, 'deploy', 'staging', '--json').out);
  const create = plan.calls.find(c => c.tool === 'mcp__claude-code-remote__create_trigger');
  assert.ok(create, JSON.stringify(plan.calls.map(c => c.step)));
  assert.match(create.step, /create staging\.evening-mac \(only from a chat linked to the Mac, with Matt present\)/);
  assert.deepEqual(
    create.args.notifications,
    { push: false, email: false },
    'every channel named, none left to a default'
  );
  assert.equal(create.args.requires_local_device, true);
  assert.deepEqual(create.args.folders, ['/Users/peachfritter/Documents/E.V. Study Watch/staging']);
  assert.equal(create.args.cron_expression, undefined, 'staging evening-mac is fire-only');
  assert.match(create.then, /spec\.tasks\.staging\.evening-mac\.trigger/);
  assert.match(create.then, /retired/, 'the old task is disabled and listed as retired, never deleted');
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(
    claude,
    /never change a task in the desktop app; re-create it from a session with the Mac link and the repository/
  );
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
  assert.equal(r.code, 1);
  assert.match(r.out, /NO  staging seed: no system\/seed: run seed-staging/);
});

test('verify-deploy: a task whose pipeline has no steps in the build is pending, not a difference', async () => {
  const { verify } = await import('../core/deploy.mjs');
  const manifest = {
    release: 'v4.0.0',
    commit: 'a'.repeat(40),
    dirty: false,
    specVersion: '4.0.0',
    files: {},
    pages: { staging: { artifact: null, files: {}, capabilities: null } },
    records: { staging: { artifact: null, systemDocs: [] } },
    tasks: {
      'staging.evening-mac': {
        name: 'x',
        pipeline: 'evening-mac',
        record: 'staging',
        lane: 'mac',
        schedule: null,
        macBound: true,
        folders: [],
        push: false,
        trigger: null,
        promptSha256: null,
      },
      'staging.weekly': {
        name: 'y',
        pipeline: 'weekly',
        record: 'staging',
        lane: 'cloud',
        schedule: null,
        macBound: false,
        folders: [],
        push: false,
        trigger: null,
        promptSha256: 'b'.repeat(64),
      },
    },
  };
  const r = verify({
    manifest,
    target: 'staging',
    state: { triggers: [], record: null, pageHtml: null },
    build: { commit: manifest.commit, dirty: false, pushed: true },
    sha256: s => s,
    now: '2026-10-18T06:00:00Z',
  });
  const line = k => r.lines.find(l => l.what === `task ${k}`);
  assert.deepEqual(
    [line('staging.evening-mac').ok, line('staging.evening-mac').detail],
    [true, 'pending: its pipeline has no steps in this build']
  );
  assert.deepEqual([line('staging.weekly').ok, line('staging.weekly').detail], [false, 'not created yet']);
});

test('B-63 (D-114): verify compares content, not commit; the B-35 gate compares a content hash', async () => {
  const { dist, state, manifest } = await deployedStaging();
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const triggers = [
    ...read(path.join(state, 'triggers-1.json')).data,
    ...read(path.join(state, 'triggers-2.json')).data,
  ];
  const dist2 = {
    spec: read(path.join(dist, 'system/spec.json')),
    environments: read(path.join(dist, 'system/environments.json')),
  };
  const record = rec => ({
    manifest: rec,
    spec: read(path.join(state, 'record/system/spec.json')),
    environments: read(path.join(state, 'record/system/environments.json')),
  });
  const older = { ...read(path.join(state, 'record/system/manifest.json')), commit: 'e'.repeat(40) };
  const run = (rec, behind) =>
    verify({
      manifest,
      target: 'staging',
      dist: dist2,
      sha256,
      build: { pushed: true, behind: c => (c === older.commit ? behind : null) },
      state: {
        triggers,
        record: record(rec),
        pageHtml: `<meta name="ev-release" content="${manifest.release}">`,
        pageFiles: null,
      },
    }).lines.find(l => l.what === 'system/manifest commit');
  assert.deepEqual(
    run(older, 3),
    { ok: true, what: 'system/manifest commit', detail: 'deployed eeeeeee, 3 notes-only commits behind' },
    'an ancestor with the same content is green'
  );
  assert.equal(run(older, null).ok, false, 'not an ancestor: red');
  assert.equal(
    run({ ...older, files: { ...older.files, 'core/validate.mjs': '0'.repeat(64) } }, 3).ok,
    false,
    'a differing file hash stays red'
  );
  const prompts = JSON.parse(JSON.stringify(older));
  const k = Object.keys(prompts.tasks).find(x => prompts.tasks[x].promptSha256);
  prompts.tasks[k].promptSha256 = '1'.repeat(64);
  assert.match(run(prompts, 3).detail, /content differs \(prompts: /, 'a differing prompt hash stays red');
  // The content hash covers files, prompts and spec; deployCalls' B-35 gate passes on it at another commit.
  const h = contentHash(manifest, dist2.spec, sha256);
  assert.equal(
    h,
    contentHash({ ...manifest, commit: 'e'.repeat(40), builtAt: 'later' }, { ...dist2.spec, at: 'later' }, sha256),
    'commit, build time and envelope are not content'
  );
  assert.notEqual(
    h,
    contentHash({ ...manifest, files: { ...manifest.files, 'core/validate.mjs': '0'.repeat(64) } }, dist2.spec, sha256)
  );
  assert.notEqual(h, contentHash(manifest, { ...dist2.spec, specVersion: '9' }, sha256));
  const gate = v =>
    deployCalls({
      manifest,
      target: 'live',
      distDir: dist,
      build: { pushed: true, contentHash: h },
      mattOk: true,
      duringSession: true,
      sha256,
      stagingVerify: v,
    }).refusals || [];
  assert.ok(
    !gate({ commit: 'e'.repeat(40), contentHash: h, green: true }).some(r => /staging/.test(r)),
    'same content at another commit passes'
  );
  assert.ok(
    gate({ commit: manifest.commit, contentHash: '2'.repeat(64), green: true }).some(r =>
      /ran on other content/.test(r)
    )
  );
});

test("B-110: verify goes red when the deployed commit is too far behind origin/main for the runs' 50-deep clone", async () => {
  const { dist, state, manifest } = await deployedStaging();
  const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
  const triggers = [
    ...read(path.join(state, 'triggers-1.json')).data,
    ...read(path.join(state, 'triggers-2.json')).data,
  ];
  const dist2 = {
    spec: read(path.join(dist, 'system/spec.json')),
    environments: read(path.join(dist, 'system/environments.json')),
  };
  const rec = {
    manifest: { ...read(path.join(state, 'record/system/manifest.json')), commit: 'e'.repeat(40) },
    spec: read(path.join(state, 'record/system/spec.json')),
    environments: read(path.join(state, 'record/system/environments.json')),
  };
  const line = behindMain =>
    verify({
      manifest,
      target: 'live',
      dist: dist2,
      sha256,
      build: { pushed: true, behind: () => 3, behindMain: () => behindMain },
      state: { triggers, record: rec, pageHtml: null, pageFiles: null },
    }).lines.find(l => l.what === "deployed commit within the runs' clone");
  assert.deepEqual(line(12), {
    ok: true,
    what: "deployed commit within the runs' clone",
    detail: '12 commits behind origin/main; runs clone 50 deep',
  });
  // D-170 (B-132), B-168: the distance is a note; past the clone the gate fetches the deployed commit.
  assert.deepEqual(
    line(45),
    {
      ok: true,
      what: "deployed commit within the runs' clone",
      detail: '45 commits behind origin/main; runs clone 50 deep',
    },
    'a build planted 45 behind is no longer red'
  );
  assert.equal(line(106).ok, true);
  assert.match(line(106).detail, /past it, the gate fetches the deployed commit \(B-168\)$/);
  assert.doesNotMatch(line(106).detail, /risk|same content/, 'no longer a risk to note');
  assert.equal(line(null).ok, false, 'a deployed commit not on origin/main is still red');
  assert.equal(
    verify({
      manifest,
      target: 'live',
      dist: dist2,
      sha256,
      build: { pushed: true, behind: () => 3 },
      state: { triggers, record: rec, pageHtml: null, pageFiles: null },
    }).lines.some(l => /runs' clone/.test(l.what)),
    false,
    'a read-only verify without git (the weekly run) leaves the line out'
  );
});
