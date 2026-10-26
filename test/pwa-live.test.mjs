// B-320 (D-306, D-330, D-331): the live app's workflow and gate, the cutover's spec, the live record's system/worker,
// and the claude.ai live page's read-only flag. Nothing here reaches a network or a record.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import {
  stagingGreen,
  nightlyGreen,
  gateRefusals,
  check,
  cutoverSpec,
  workerDoc,
  liveApp,
} from '../tools/pwa-live.mjs';
import { buildPages, loadSchemas, appSource, buildCommitOf } from '../tools/build.mjs';
import { fullCheckRefusal } from '../tools/chart.mjs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { appsOf, appCalls } from '../tools/pwa-app.mjs';
import { runTarget } from '../core/run.mjs';

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pwa-live.yml'), 'utf8');
const C = '0123456789abcdef0123456789abcdef01234567';
const on = () => {
  const s = JSON.parse(JSON.stringify(spec));
  s.registry.records.live.app.ready = true;
  return s;
};
// The spec as it was before the sitting turned the live app on (B-320, step 2.1).
const off = () => {
  const s = JSON.parse(JSON.stringify(spec));
  s.registry.records.live.app.ready = false;
  return s;
};
const jobOf = name => {
  const i = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(i > 0, name + ' job');
  const rest = wf.slice(i + 1);
  const j = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return j < 0 ? rest : rest.slice(0, j + 1);
};

test('B-320: the live workflow is dispatched by hand only, from main, and its deploy waits in the live environment', () => {
  assert.match(wf, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(
    wf,
    /^\s+(push|pull_request|schedule|workflow_run|repository_dispatch):/m,
    'nothing starts it but a dispatch'
  );
  assert.match(wf, /commit:\n\s+description: [^\n]+\n\s+type: string\n\s+required: true/);
  const gate = jobOf('gate'),
    live = jobOf('live');
  assert.match(gate, /if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/);
  assert.match(gate, /node tools\/pwa-live\.mjs gate "\$COMMIT"/);
  assert.doesNotMatch(gate, /secrets\./, 'the gate sees no secret');
  assert.doesNotMatch(gate, /environment:/);
  assert.match(live, /needs: gate\n\s+environment: live\n/, 'Matt approves the deploy in GitHub, after the gate');
  assert.match(wf, /permissions:\n {2}contents: read\n {2}actions: read\n/);
});

test('B-320: environment-only secrets, never echoed; the Claude key stays a Cloudflare secret (D-299)', () => {
  const live = jobOf('live');
  const used = [...wf.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(used)].sort(), [
    'EV_LIVE_TOKEN',
    'LIVE_CLOUDFLARE_ACCOUNT_ID',
    'LIVE_CLOUDFLARE_API_TOKEN',
  ]);
  assert.ok(
    used.every(s => live.includes('secrets.' + s)),
    'only the live job names them'
  );
  assert.doesNotMatch(
    wf,
    /ANTHROPIC_API_KEY \}|secrets\.ANTHROPIC|wrangler secret put ANTHROPIC/,
    'no Claude key here'
  );
  assert.doesNotMatch(wf, /set -x|::add-mask::|echo[^\n]*\$\{?(EV_LIVE_TOKEN|EV_TOKEN|CLOUDFLARE_API_TOKEN)\b/);
  // the token reaches wrangler on stdin only
  for (const m of wf.matchAll(/\$EV_LIVE_TOKEN/g)) {
    const line = wf.slice(wf.lastIndexOf('\n', m.index) + 1, wf.indexOf('\n', m.index));
    assert.match(line, /^\s*printf '%s' "\$EV_LIVE_TOKEN" \| npx wrangler secret put EV_TOKEN /, line);
  }
  assert.match(
    live,
    /EV_TOKEN: \$\{\{ secrets\.EV_LIVE_TOKEN \}\}\n\s+run: \|\n[^\n]*\n\s+if node tools\/pwa-live\.mjs check/
  );
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, '.github/workflows/pwa-staging.yml'), 'utf8'), /ev-live|LIVE_/);
});

test('B-320: the live D1 is found or created with the schema only: never seeded, nothing written or deleted', () => {
  const steps = wf
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');
  assert.doesNotMatch(steps, /seed/i, 'no seed, made-up or otherwise');
  const executes = [...wf.matchAll(/wrangler d1 execute ([a-z-]+) [^\n]*?(--file (\S+)|--command "([^"]+)")/g)];
  assert.ok(executes.length >= 4);
  for (const m of executes) {
    if (m[3]) assert.equal(m[3], 'schema.sql', m[0]);
    else assert.match(m[4], /^SELECT /, m[0]);
  }
  assert.doesNotMatch(
    wf,
    /\bDELETE\b|\bDROP\b|\bALTER\b|INSERT|UPDATE docs|r2 object (put|delete)|d1 delete|wrangler delete/i
  );
  assert.equal(
    fs.readFileSync(path.join(ROOT, 'pwa/schema.sql'), 'utf8').match(/CREATE TABLE IF NOT EXISTS docs/g).length,
    1
  );
  assert.match(wf, /wrangler deploy --env live --message "\$msg"/);
  assert.match(wf, /node \.\.\/tools\/pwa-app\.mjs message live/);
  assert.match(
    wf,
    /node tools\/pwa-app\.mjs deployed live "\$\{\{ steps\.deploy\.outputs\.url \}\}"/,
    'the build hash read back'
  );
  assert.match(wf, /node tools\/build-pwa\.mjs --record live/);
  const toml = fs.readFileSync(path.join(ROOT, 'pwa/wrangler.toml'), 'utf8');
  assert.match(
    toml,
    /\[env\.live\]\nname = "ev-live"\nworkers_dev = true\n\n\[\[env\.live\.d1_databases\]\]\nbinding = "DB"\ndatabase_name = "ev-live"\ndatabase_id = "filled-in-by-the-pwa-live-workflow"/
  );
});

test('B-320 (R-02, R-06): the gate refuses what ship live refuses, and passes a commit with both', () => {
  const short = C.slice(0, 7);
  const deploys = [{ target: 'staging', commit: short, verify: 'green' }];
  const runs = [{ headSha: 'b'.repeat(40), conclusion: 'success' }];
  const build = rev => (rev === 'b'.repeat(40) ? C : rev); // a later bookkeeping head builds the same commit
  const base = { commit: C, onMain: true, spec: on(), deploys, runs, buildCommit: build };
  assert.deepEqual(gateRefusals(base), []);
  const why = o => gateRefusals({ ...base, ...o }).join(' | ');
  assert.match(why({ onMain: false }), /not on origin\/main/);
  assert.match(why({ spec: off() }), /does not turn the live app on/, 'the spec at that commit has ready false');
  assert.match(why({ deploys: [] }), /R-02/);
  assert.match(why({ deploys: [{ ...deploys[0], verify: 'red' }] }), /R-02/);
  assert.match(why({ deploys: [{ target: 'live', commit: short, verify: 'green' }] }), /R-02/);
  assert.match(why({ runs: [] }), /R-06/);
  assert.match(why({ runs: [{ ...runs[0], conclusion: 'failure' }] }), /R-06/);
  assert.match(why({ buildCommit: () => 'c'.repeat(40) }), /bookkeeping commit/);
  assert.deepEqual(gateRefusals({ ...base, commit: short }), ['the commit input is not a full 40-character sha']);
  assert.equal(
    stagingGreen([{ target: 'staging', commit: 'abc', verify: 'green' }], 'abc' + C.slice(3)),
    false,
    'a short sha names nothing'
  );
  assert.equal(
    nightlyGreen(runs, C, () => null),
    false
  );
});

test('B-320 (R-06): the gate and ship live take the same nightly: at the build commit, or at a bookkeeping head on it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-r06-'));
  const git = (...a) =>
    execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q');
  const commit = (f, msg) => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), msg);
    git('add', f);
    git('commit', '-qm', msg);
    return git('rev-parse', 'HEAD');
  };
  const build = commit('a.js', 'the build');
  const books = commit('chart/deploys.json', 'ship staging recorded');
  const later = commit('b.js', 'another build after it');
  assert.equal(buildCommitOf(dir, books), build, "the bookkeeping head's build commit");
  const memo = rev => buildCommitOf(dir, rev);
  const base = {
    commit: build,
    onMain: true,
    spec: on(),
    deploys: [{ target: 'staging', commit: build, verify: 'green' }],
    buildCommit: memo,
  };
  for (const [head, green] of [
    [build, true],
    [books, true],
    [later, false],
  ]) {
    const runs = [{ headSha: head, conclusion: 'success' }];
    assert.equal(gateRefusals({ ...base, runs }).length === 0, green, `the gate, a nightly at ${head.slice(0, 7)}`);
    assert.equal(fullCheckRefusal(dir, build, runs) === null, green, `ship live, a nightly at ${head.slice(0, 7)}`);
  }
});

test('B-320 (D-330): the live app in the spec, on from the cutover sitting; ship live dispatches it on his OK', () => {
  const app = liveApp(spec);
  assert.equal(app.worker, 'ev-live');
  assert.match(app.url, /^https:\/\/ev-live\.[a-z0-9-]+\.workers\.dev$/);
  assert.equal(app.workflow, 'pwa-live.yml');
  assert.equal(app.environment, 'live');
  assert.equal(app.ready, true, 'turned on at the sitting (docs/cutover.md step 2.1)');
  assert.equal(spec.registry.records.live.copy.worker, 'ev-live', "B-319's copy target");
  assert.equal(
    spec.registry.records.live.runs,
    undefined,
    'live pipelines stay on the claude.ai record until the cutover'
  );
  for (const p of ['morning', 'evening-cloud', 'evening-mac', 'weekly', 'worker', 'watchdog'])
    assert.equal(runTarget(spec, 'live', p), 'artifact', p);
  const apps = appsOf(on());
  assert.deepEqual(apps.live, { worker: 'ev-live', workflow: 'pwa-live.yml', ready: true });
  assert.equal(appsOf(off()).live.ready, false);
  assert.equal(appCalls({ target: 'live', commit: C }).ok, false, 'never without --matt-ok');
});

test('B-320: the live check: 401 without the token and with a wrong one, 200 with it; counts only', async () => {
  const f =
    good =>
    async (url, init = {}) => {
      const auth = (init.headers || {}).authorization;
      assert.match(url, /\/api\/run\/collections$/);
      if (auth === 'Bearer t0k' && good)
        return { status: 200, json: async () => ({ collections: [{ collection: 'days', count: 3 }] }) };
      return { status: auth === 'Bearer t0k' ? 500 : 401, json: async () => ({}) };
    };
  const lines = await check('https://ev-live.x.workers.dev/', 't0k', { f: f(true) });
  assert.ok(
    lines.every(l => l.ok),
    JSON.stringify(lines)
  );
  assert.match(lines.at(-1).what, /1 collections: days 3/);
  assert.ok(!JSON.stringify(lines).includes('t0k'), 'never the token');
  const red = await check('https://ev-live.x.workers.dev', 't0k', { f: f(false) });
  assert.equal(red.at(-1).ok, false);
});

test('B-320: the cutover spec turns on read-only, D1, the live runs and the Mac tasks; the old evening-mac is retired', () => {
  assert.throws(() => cutoverSpec(off()), /live app is not on/);
  const before = on();
  const after = cutoverSpec(before);
  const live = after.registry.records.live;
  assert.equal(live.readOnly, true);
  assert.equal(live.d1, true);
  assert.deepEqual(live.runs, before.registry.records.live.cutover.runs);
  assert.deepEqual(Object.keys(live.cutover), ['_why']);
  for (const [k, t] of Object.entries(after.tasks.live))
    assert.equal(runTarget(after, 'live', t.pipeline), 'worker', k);
  const folder = live.runs.backup.folder;
  assert.equal(folder, '/Users/peachfritter/Documents/E.V. Backups');
  for (const k of ['evening-mac', 'restore-drill']) {
    assert.deepEqual(after.tasks.live[k].folders, [folder], k);
    assert.equal(after.tasks.live[k].trigger, null, k + ': created at the Mac');
    assert.equal(after.tasks.live[k].macBound, true);
  }
  const old = before.tasks.live['evening-mac'].trigger;
  assert.deepEqual(
    after.tasks.retired.slice(before.tasks.retired.length).map(r => [r.trigger, r.was]),
    [[old, 'live.evening-mac']]
  );
  assert.deepEqual(before, on(), 'the input is left as it is');
  assert.throws(() => cutoverSpec(after), /no staged cutover/);
  // the staged runs mirror staging's, on their own scratch and folder
  const st = spec.registry.records.staging.runs;
  assert.deepEqual(live.runs.pipelines, st.pipelines);
  assert.deepEqual(live.runs.worker, st.worker);
  assert.equal(live.runs.scratch.host, 'ev-live-scratch');
  // the cutover page is read-only on live only
  const pages = buildPages({ root: ROOT, spec: after, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion });
  assert.equal(JSON.parse(pages.live['spec.json']).readOnly, true);
  assert.equal(JSON.parse(pages.staging['spec.json']).readOnly, false);
});

test('B-320: the live record system/worker carries the address from the spec and the token from its file only', () => {
  const s = on();
  const t = 'a'.repeat(64);
  const d = workerDoc(s, t, { at: '2026-10-27T00:00:00Z' });
  assert.equal(d.url, liveApp(s).url);
  assert.equal(d.token, t);
  assert.throws(() => workerDoc(s, 'short'), /no usable token/);
  assert.throws(() => workerDoc(s, 'a'.repeat(40) + '"'), /no usable token/);
  const bad = on();
  bad.registry.records.live.app.url = 'http://ev-live.x.workers.dev';
  assert.throws(() => workerDoc(bad, t), /not an https workers.dev/);
});

test('B-320 (D-306): the read-only flag: off now on both pages; on, the claude.ai live page refuses every write first', () => {
  const pages = buildPages({ root: ROOT, spec, schemas: loadSchemas(ROOT), release: 'v' + spec.specVersion });
  for (const t of ['live', 'staging']) assert.equal(JSON.parse(pages[t]['spec.json']).readOnly, false, t);
  const app = appSource(ROOT);
  // the flag, evaluated as the page does: the flag on and not the app's host
  const m =
    /const READ_ONLY = (EV_SPEC\.readOnly === true && !\(window\.claude && window\.claude\.host === 'ev-app'\));/.exec(
      app
    );
  assert.ok(m, 'the read-only flag');
  const ro = (flag, claude) => new Function('EV_SPEC', 'window', 'return ' + m[1])({ readOnly: flag }, { claude });
  assert.equal(ro(true, {}), true, 'the claude.ai live page, cut over');
  assert.equal(ro(true, { host: 'ev-app' }), false, 'the app is never read-only');
  assert.equal(ro(false, {}), false);
  assert.equal(ro(undefined, {}), false);
  // write() refuses before anything else, and it is the page's one record write
  assert.match(app, /async function write\(w\) \{\n\s+if \(READ_ONLY\) throw new Error\(READ_ONLY_TEXT\);/);
  assert.equal(app.match(/\bref\.(set|update)\(/g).length, 2, 'set and update only in write()');
  assert.equal(app.match(/\.doc\([^)]*\)\.(set|update|delete)\(/g), null, 'no other record write');
  assert.match(fs.readFileSync(path.join(ROOT, 'pwa/bridge.js'), 'utf8'), /host: 'ev-app',/);
  assert.match(
    fs.readFileSync(path.join(ROOT, 'page/styles.css'), 'utf8'),
    /\[data-readonly\] #composer,\[data-readonly\] #new-wrap\{display:none!important\}/
  );
});

test('B-320: the read-back lines name collections, counts and step statuses only', async () => {
  const { runLine, runSummary } = await import('../tools/pwa-live.mjs');
  assert.equal(
    runLine('https://ev-live.x.workers.dev', []),
    'https://ev-live.x.workers.dev: 0 collections (an empty D1)'
  );
  assert.equal(runLine('u', [{ collection: 'days', count: 2 }]), 'u: 1 collections: days 2');
  const d = {
    writer: 'morning',
    status: 'ok',
    startedAt: 'a',
    endedAt: 'b',
    steps: [{ id: 'pull', status: 'ok', notes: 'his words' }],
  };
  const line = runSummary('morning-1', d);
  assert.equal(line, 'runs/morning-1: morning ok (a to b); steps: pull ok');
  assert.ok(!line.includes('his words'));
});
