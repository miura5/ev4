// B-326: the suite leaves nothing in the temp folder. A slice of it, and a fixture that fails on purpose, run under
// npm test's preload (test/tmp-root.mjs) with a temp folder of their own; the E.V. entries in it are counted before
// and after.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

const PRELOAD = path.join(ROOT, 'test', 'tmp-root.mjs');
// The prefixes the suite's folders use (ev4-copy, ev4-run, ev-job, "ev reader", "E.V. Study Watch", outside-, ...).
const EV = /^(ev|e\.v\.|outside-|real-sessions-|pwa-app-)/i;
const count = dir => fs.readdirSync(dir).filter(n => EV.test(n)).length;
// The files whose tests make the most kinds of temp folder, each quick.
const SLICE = ['reader', 'restore', 'guard', 'run-worker', 'evening-mac', 'check-touched', 'synthetic', 'run'].map(f =>
  path.join('test', f + '.test.mjs')
);

/** node --test over files, as npm test runs it (preload on or off), with tmp as the temp folder. */
function runSuite(files, tmp, { preload = true } = {}) {
  const env = { ...process.env, TMPDIR: tmp };
  delete env.NODE_TEST_CONTEXT; // a runner of its own, not a child of this one
  return spawnSync(process.execPath, [...(preload ? ['--import', PRELOAD] : []), '--test', ...files], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 240000,
  });
}

test('B-326: a slice of the suite leaves no E.V. folder in the temp folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-'));
  const before = count(tmp);
  const r = runSuite(SLICE, tmp);
  assert.equal(r.status, 0, 'the slice passes:\n' + (r.stdout + r.stderr).slice(-3000));
  assert.match(r.stdout, /# pass [1-9]/);
  assert.equal(count(tmp), before, 'left behind: ' + fs.readdirSync(tmp).join(', '));
});

test('B-326: a failed test still removes its folders, a kept one lasts the file, and the count sees a leak', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-'));
  const fixture = path.join(tmp, 'leak.fixture.mjs');
  const source = `import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keepForFile } from ${JSON.stringify(PRELOAD)};
const mk = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const atLoad = mk('ev4-load-');
let failed, kept;
test('fails after making folders', async t => {
  failed = mk('ev4-failed-');
  kept = keepForFile(mk('ev4-kept-'));
  await t.test('nested', () => { mk('E.V. Study Watch '); });
  assert.fail('on purpose');
});
test('the failed test left nothing; the kept and load-time folders remain', () => {
  if (!process.env.NODE_TEST_CONTEXT || !process.env.TMPDIR.includes('ev4-test-')) return; // no preload: control run
  assert.equal(fs.existsSync(failed), false);
  assert.equal(fs.readdirSync(os.tmpdir()).some(n => n.startsWith('E.V.')), false);
  assert.ok(fs.existsSync(kept) && fs.existsSync(atLoad));
});
`;
  fs.writeFileSync(fixture, source);
  const before = count(tmp);
  const on = runSuite([fixture], tmp);
  assert.equal(on.status, 1, on.stdout);
  assert.match(on.stdout, /# pass 2\n# fail 1/, 'only the on-purpose failure fails');
  assert.equal(count(tmp), before, 'left behind: ' + fs.readdirSync(tmp).join(', '));
  // The control: without the preload (nor its import) the same file leaves its folders, and the count sees them.
  const bare = path.join(tmp, 'bare.fixture.mjs');
  fs.writeFileSync(bare, source.replace(/^import \{ keepForFile \}.*$/m, 'const keepForFile = d => d;'));
  runSuite([bare], tmp, { preload: false });
  assert.ok(count(tmp) >= before + 4, 'the count sees the leak: ' + fs.readdirSync(tmp).join(', '));
});
