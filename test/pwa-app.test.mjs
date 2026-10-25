// B-318: the app in ship and verify-deploy. ship prints the dispatch of the target's workflow (live only on Matt's
// OK, R-04), a read through the GitHub API brings the run and the Worker's build hash back, and verify holds that
// hash to what the session's own build would deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  APPS,
  appCalls,
  appLines,
  appMessage,
  appRead,
  parseAppMessage,
  readRun,
  activeVersion,
  hashOf,
  workerFiles,
  publicFiles,
} from '../tools/pwa-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = 'a'.repeat(40);
const EXP = { worker: '1'.repeat(64), files: '2'.repeat(64), n: 35 };
const ok = (app = { commit: C.slice(0, 12), worker: EXP.worker.slice(0, 16), files: EXP.files.slice(0, 16) }) => ({
  run: { id: 7, status: 'completed', conclusion: 'success' },
  steps: [{ name: 'deploy the ev-staging Worker', conclusion: 'success' }],
  app,
});

test('B-318: ship staging prints the pwa-staging dispatch at the build commit', () => {
  const a = appCalls({ target: 'staging', commit: C });
  assert.equal(a.ok, true);
  assert.equal(a.calls.length, 1);
  assert.equal(a.calls[0].tool, 'Bash');
  assert.equal(a.calls[0].args.command, `gh workflow run pwa-staging.yml --repo miura5/ev4 --ref main -f commit=${C}`);
  assert.match(a.calls[0].step, /^app staging: /, 'ship counts it as the app part');
  const r = appRead({ target: 'staging', stateDir: '/x/state/staging' });
  assert.equal(r.args.command, 'node tools/pwa-app.mjs readback staging --out /x/state/staging/app.json --wait 9');
  assert.equal(r.save, '/x/state/staging/app.json');
});

test("B-318: the live app is refused without Matt's OK (R-04), and stays off until it is set up", () => {
  const no = appCalls({ target: 'live', commit: C });
  assert.equal(no.ok, false);
  assert.match(no.refusals[0], /R-04/);
  assert.deepEqual(appCalls({ target: 'live', commit: C, mattOk: true }), { ok: true, calls: [] }, 'live is off');
  APPS.live.ready = true;
  try {
    const yes = appCalls({ target: 'live', commit: C, mattOk: true });
    assert.equal(
      yes.calls[0].args.command,
      `gh workflow run pwa-live.yml --repo miura5/ev4 --ref main -f commit=${C} -f matt_ok=${C}`
    );
    assert.equal(appCalls({ target: 'live', commit: C }).ok, false, 'still refused without the OK');
  } finally {
    APPS.live.ready = false;
  }
});

test('B-318: the build hash rides in the Worker version message and reads back', () => {
  const m = appMessage({ commit: C, ...EXP });
  assert.ok(m.length <= 100, "wrangler's message holds 100 characters");
  assert.deepEqual(parseAppMessage(m), { commit: C.slice(0, 12), worker: '1'.repeat(16), files: '2'.repeat(16) });
  assert.equal(parseAppMessage('a deploy with no hash'), null);
  assert.equal(
    activeVersion([
      { created_on: '2026-10-25T01:00:00Z', versions: [{ version_id: 'old', percentage: 100 }] },
      { created_on: '2026-10-25T02:00:00Z', versions: [{ version_id: 'new', percentage: 100 }] },
    ]),
    'new'
  );
  assert.equal(activeVersion([]), null);
});

test('B-318: verify reads the Worker build hash and the app files back against the build', () => {
  const lines = s => appLines({ target: 'staging', commit: C, expected: EXP, saved: s });
  const green = l => l.every(x => x.ok);
  assert.match(lines(null)[0].detail, /no saved read/);
  assert.equal(green(lines({ run: null })), false);
  const going = lines({ run: { id: 9, status: 'in_progress' } });
  assert.equal(green(going), false);
  assert.match(going[0].detail, /in_progress: read again/);
  const g = lines(ok());
  assert.ok(green(g));
  assert.deepEqual(
    g.map(l => l.what),
    ['app staging workflow run', 'app staging Worker build', 'app staging files']
  );
  assert.equal(g[2].detail, `35 files, ${'2'.repeat(16)}`);
  const w = lines(ok({ commit: C.slice(0, 12), worker: '3'.repeat(16), files: EXP.files.slice(0, 16) }));
  assert.equal(w.find(l => l.what === 'app staging Worker build').ok, false);
  const f = lines(ok({ commit: C.slice(0, 12), worker: EXP.worker.slice(0, 16), files: '3'.repeat(16) }));
  assert.equal(f.find(l => l.what === 'app staging files').ok, false);
  const red = lines({
    ...ok(),
    run: { id: 8, status: 'completed', conclusion: 'failure' },
    steps: [{ name: 'x', conclusion: 'failure' }],
  });
  assert.equal(red[0].ok, false);
  assert.match(red[0].detail, /failure at: x/);
  assert.equal(green(lines({ ...ok(), app: null })), false, 'a run with no notice is not a deploy of this build');
  // An older commit carrying the same Worker and files is the same deploy (B-63's content rule).
  const older = lines(ok({ commit: 'b'.repeat(12), worker: EXP.worker.slice(0, 16), files: EXP.files.slice(0, 16) }));
  assert.ok(green(older));
  assert.match(older.at(-1).detail, /deployed at bbbbbbb, the same Worker and files/);
});

test('B-318: the readback takes the newest run, its steps and its app notice through the GitHub API', () => {
  const calls = [];
  const api = p => {
    calls.push(p);
    if (/workflows\/pwa-staging\.yml\/runs/.test(p))
      return {
        workflow_runs: [
          { id: 1, status: 'completed', conclusion: 'success', created_at: '2026-10-25T01:00:00Z' },
          {
            id: 2,
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-10-25T02:00:00Z',
            display_title: 'pwa-staging ' + C,
            head_sha: 'h',
          },
        ],
      };
    if (/runs\/2\/jobs/.test(p))
      return { jobs: [{ id: 22, steps: [{ name: 'deploy', conclusion: 'success', number: 1 }] }] };
    if (/check-runs\/22\/annotations/.test(p))
      return [
        { title: '', message: 'Node.js 20 is deprecated' },
        { title: 'app staging', message: appMessage({ commit: C, ...EXP }) },
      ];
    throw new Error(p);
  };
  const r = readRun('staging', api);
  assert.equal(r.run.id, 2);
  assert.deepEqual(r.steps, [{ name: 'deploy', conclusion: 'success' }]);
  assert.deepEqual(r.app, { commit: C.slice(0, 12), worker: '1'.repeat(16), files: '2'.repeat(16) });
  assert.ok(calls.every(p => p.startsWith('repos/miura5/ev4/')));
  const going = readRun('staging', p =>
    /runs\?/.test(p) ? { workflow_runs: [{ id: 3, status: 'queued', created_at: 'x' }] } : assert.fail('read ' + p)
  );
  assert.deepEqual([going.run.status, going.app], ['queued', null]);
});

test('B-318: the build hash covers the Worker source and every served file', () => {
  const w = workerFiles(ROOT);
  assert.ok(Object.keys(w).includes('pwa/worker.js') && Object.keys(w).includes('pwa/runapi.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-app-'));
  fs.mkdirSync(path.join(dir, 'core'));
  fs.writeFileSync(path.join(dir, 'index.html'), 'a');
  fs.writeFileSync(path.join(dir, 'core', 'x.mjs'), 'b');
  const f = publicFiles(dir);
  assert.deepEqual(Object.keys(f).sort(), ['core/x.mjs', 'index.html']);
  const h = hashOf(f);
  fs.writeFileSync(path.join(dir, 'core', 'x.mjs'), 'c');
  assert.notEqual(hashOf(publicFiles(dir)), h);
});

test('B-318: the workflows deploy at the build commit with its hash; pwa-live is gated and never makes a database', () => {
  const st = fs.readFileSync(path.join(ROOT, '.github/workflows/pwa-staging.yml'), 'utf8');
  assert.match(st, /run-name: pwa-staging \$\{\{ inputs\.commit \|\| github\.sha \}\}/);
  assert.match(st, /ref: \$\{\{ inputs\.commit \|\| github\.sha \}\}\n\s+fetch-depth: 0/);
  assert.match(st, /wrangler deploy --env staging --message "\$msg"/);
  assert.match(st, /node tools\/pwa-app\.mjs deployed staging/);
  const lv = fs.readFileSync(path.join(ROOT, '.github/workflows/pwa-live.yml'), 'utf8');
  const on = lv.slice(lv.indexOf('\non:'), lv.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch/);
  assert.doesNotMatch(on, /push|pull_request|schedule/);
  assert.match(lv, /\[ "\$MATT_OK" = "\$COMMIT" \] \|\| \{ echo "R-04/);
  assert.ok(lv.indexOf('R-04') < lv.indexOf('wrangler'), 'the OK is checked before any Cloudflare call');
  assert.match(lv, /display_title == \\"pwa-staging \$COMMIT\\"/, 'R-02: staging first');
  assert.match(lv, /environment: live/);
  assert.doesNotMatch(lv.replace(/^#.*$/gm, ''), /d1 create|seed|d1 execute|_STAGING|ev-staging|delete|DROP/);
  for (const line of lv.split('\n').filter(l => /\b(echo|printf|cat)\b/.test(l))) {
    if (/\|\s*npx wrangler secret put/.test(line)) continue;
    assert.doesNotMatch(
      line,
      /\$\{?(CLOUDFLARE_API_TOKEN|EV_LIVE_TOKEN|ANTHROPIC_API_KEY_LIVE)\b|secrets\./,
      line.trim()
    );
  }
  const toml = fs.readFileSync(path.join(ROOT, 'pwa/wrangler.toml'), 'utf8');
  assert.match(toml, /\[env\.live\]\s+name = "ev-live"/);
  assert.equal(APPS.live.ready, false, 'live stays off until its Worker and D1 exist');
});

test('B-318: ship carries the app read and dispatch as its own part, and reads it again after a dispatch', async () => {
  const { shipStep } = await import('../tools/chart.mjs');
  const read = { ...appRead({ target: 'staging', stateDir: '/s' }), have: true };
  const sys = { tool: 'ArtifactData', args: {}, save: '/s/m.json', have: true };
  const base = {
    target: 'staging',
    manifest: { commit: C },
    state: { record: { manifest: { commit: C } } },
    verifyResult: { lines: [{ ok: false, what: 'app staging Worker build' }] },
    reads: [sys, read],
    deploy: { ok: true, calls: [{ tool: 'ArtifactData' }, ...appCalls({ target: 'staging', commit: C }).calls] },
    rec: { deploys: [] },
    refusals: [],
    skip: { tasks: true, pages: true },
    stale: null,
  };
  const step = shipStep(base);
  assert.equal(step.kind, 'deploy');
  assert.deepEqual(
    step.calls.map(c => c.tool),
    ['ArtifactData', 'Bash'],
    'the dispatch is not skipped with the tasks and page'
  );
  const again = shipStep({ ...base, stale: { tasks: false, pages: false, app: true } });
  assert.deepEqual(
    again.reads.map(r => r.tool),
    ['ArtifactData', 'Bash']
  );
  const missing = shipStep({ ...base, reads: [sys, { ...read, have: false }] });
  assert.deepEqual([missing.kind, missing.reads.map(r => r.save)], ['reads', ['/s/app.json']]);
});
