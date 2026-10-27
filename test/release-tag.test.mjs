// B-420 (D-343): the app workflows' release-tag step is one tested script (tools/release-tag.mjs), run before every
// build in pwa-staging.yml and pwa-live.yml and nowhere else (the live gate job builds nothing); it checks the whole of
// each input; and the hooks' live guard accepts the dispatch ship prints with -f release=.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseTag, releaseInputRefusal } from '../tools/release-tag.mjs';
import { appCalls } from '../tools/pwa-app.mjs';
import * as H from '../tools/hooks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'tools', 'release-tag.mjs');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-release-tag-'));
  const g = (...a) =>
    execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
  g('init', '-q');
  const commit = msg => {
    fs.writeFileSync(path.join(dir, 'f.txt'), msg);
    g('add', 'f.txt');
    g('commit', '-qm', msg);
    return g('rev-parse', 'HEAD');
  };
  return { dir, g, commit };
}

test('B-420: the whole of each input is checked before git sees it', () => {
  const C = 'a'.repeat(40);
  assert.equal(releaseInputRefusal('', C), null, 'no release named is nothing to do');
  assert.equal(releaseInputRefusal('', ''), null);
  assert.equal(releaseInputRefusal('v4.5.7', C), null);
  for (const bad of [
    'v4.5.7\nrm -rf /',
    'x\nv4.5.7',
    'v4.5.7 ',
    ' v4.5.7',
    'v4.5.7+3',
    'v4.5',
    'v5.1.2',
    'v4.05.1',
    'v4.5.7;id',
    '--delete',
  ])
    assert.match(releaseInputRefusal(bad, C), /is not v4\.x\.y/, JSON.stringify(bad));
  for (const bad of ['', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), `${C}\nmain`, 'main', 'HEAD~1'])
    assert.match(releaseInputRefusal('v4.5.7', bad), /is not 40 hex/, JSON.stringify(bad));
});

test('B-420: the step makes the tag at the commit, accepts it already there, and refuses one at another commit', () => {
  const { dir, g, commit } = repo();
  const one = commit('one');
  const two = commit('two');
  const none = releaseTag({ root: dir, release: '', commit: two });
  assert.deepEqual(none, { ok: true, line: 'no release named' });
  const made = releaseTag({ root: dir, release: 'v4.2.0', commit: one });
  assert.equal(made.ok, true, made.line);
  assert.equal(g('rev-list', '-n1', 'v4.2.0'), one);
  assert.equal(g('cat-file', '-t', 'v4.2.0'), 'tag', 'an annotated tag, as ship makes');
  const again = releaseTag({ root: dir, release: 'v4.2.0', commit: one });
  assert.equal(again.ok, true, 'already at that commit: fine');
  const elsewhere = releaseTag({ root: dir, release: 'v4.2.0', commit: two });
  assert.equal(elsewhere.ok, false);
  assert.match(elsewhere.line, /already at another commit/);
  assert.equal(g('rev-list', '-n1', 'v4.2.0'), one, 'the tag is left where it was');
  const missing = releaseTag({ root: dir, release: 'v4.2.1', commit: 'b'.repeat(40) });
  assert.equal(missing.ok, false);
  assert.match(missing.line, /not in this checkout/);
  // the command line the workflows run: exit 0 made, 1 refused, the refusal before any git call
  const cli = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: dir, encoding: 'utf8' });
  const ok = cli('v4.3.0', two);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^release v4\.3\.0 at [0-9a-f]{7}/);
  assert.equal(g('rev-list', '-n1', 'v4.3.0'), two);
  assert.equal(cli('', '').status, 0);
  assert.equal(cli('v4.3.0\nx', two).status, 1);
  assert.equal(cli('v4.3.0', one).status, 1, 'v4.3.0 is at two');
  const config = spawnSync('git', ['-C', dir, 'config', '--local', '--get', 'user.name'], { encoding: 'utf8' });
  assert.equal(config.stdout.trim(), '', 'no repository config is written');
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The jobs of a workflow, each as its list of steps (the raw text of each). */
function jobs(file) {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8');
  const body = text.slice(text.indexOf('\njobs:\n') + 7);
  const out = {};
  for (const block of body.split(/\n(?=  [A-Za-z0-9_-]+:\n)/)) {
    const name = (block.match(/^  ([A-Za-z0-9_-]+):\n/) || [])[1];
    if (!name) continue;
    out[name] = block
      .split(/\n(?=      - )/)
      .slice(1)
      .map(s =>
        s
          .split('\n')
          .filter(l => !/^\s*#/.test(l))
          .join('\n')
      );
  }
  return out;
}
const isTag = s => /run: node tools\/release-tag\.mjs "\$RELEASE" "\$COMMIT"/.test(s);
const isBuild = s => /tools\/build\.mjs|build-pwa\.mjs|npm run build/.test(s);

test('B-420: the release-tag step comes before every build in the app workflows, once, and the live gate has none', () => {
  let builds = 0;
  for (const file of ['pwa-staging.yml', 'pwa-live.yml']) {
    const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8');
    assert.doesNotMatch(text, /git tag\b/, `${file}: the tag is made by the script only`);
    for (const [name, steps] of Object.entries(jobs(file))) {
      const tags = steps.map((s, i) => (isTag(s) ? i : -1)).filter(i => i >= 0);
      const built = steps.map((s, i) => (isBuild(s) ? i : -1)).filter(i => i >= 0);
      if (!built.length) {
        assert.deepEqual(tags, [], `${file} ${name} builds nothing, so it makes no tag`);
        continue;
      }
      builds++;
      assert.equal(tags.length, 1, `${file} ${name}: one release-tag step`);
      assert.ok(tags[0] < built[0], `${file} ${name}: the release-tag step before the build`);
      const checkout = steps.findIndex(s => /uses: actions\/checkout@/.test(s));
      assert.ok(checkout >= 0 && checkout < tags[0], `${file} ${name}: after the checkout`);
      assert.match(steps[checkout], /fetch-depth: 0/, `${file} ${name}: the checkout brings the tags`);
      assert.match(steps[tags[0]], /RELEASE: \$\{\{ inputs\.release \}\}/);
      const ref = (steps[checkout].match(/ref: (\$\{\{[^}]*\}\})/) || [])[1];
      // B-427: the commit it checked out, unless ship names the commit a +n build's base tag is at
      const want = ref.replace('${{ ', '${{ inputs.release_at || ');
      assert.match(steps[tags[0]], new RegExp(`COMMIT: ${want.replace(/[$|{}.]/g, '\\$&')}`), 'the tag commit');
    }
  }
  assert.equal(builds, 2, 'the staging job and the live job');
  assert.ok(jobs('pwa-live.yml').gate, 'the live gate job is read');
});

test("B-420: the hooks' live guard accepts ship's live dispatch with -f release= under Matt's OK for that commit", () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const call = appCalls({ target: 'live', commit: sha, mattOk: true, release: 'v4.9.2' }).calls[0];
  const command = call.args.command;
  assert.match(command, / -f commit=[0-9a-f]{40} -f release=v4\.9\.2$/);
  const d = H.liveDispatch(command);
  assert.ok(d, 'it is a live dispatch');
  assert.equal(d.commit, sha, 'the release input is not read as a second commit');
  assert.deepEqual(d.why, []);
  const input = { tool_name: 'Bash', tool_input: { command } };
  const now = Date.now();
  const liveOk = { at: now - 60e3, by: 'ship live --matt-ok', commit: sha };
  assert.equal(H.liveGuard(input, { liveId: 'x', liveOk, now }), null, 'passes under the OK for that commit');
  assert.notEqual(H.liveGuard(input, { liveId: 'x', liveOk: null, now }), null, 'refused with no OK');
  assert.notEqual(
    H.liveGuard(input, { liveId: 'x', liveOk: { ...liveOk, commit: 'f'.repeat(40) }, now }),
    null,
    'refused under an OK for another commit'
  );
  // appCalls checks the whole commit too: it goes into the command as it is
  for (const bad of ['abc1234', `${sha} -f x=y`, `${sha}\n`]) {
    const r = appCalls({ target: 'staging', commit: bad, release: 'v4.9.2' });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.refusals[0], /not 40 hex/);
  }
});

test('B-427: a +n build names its base tag and the commit that tag is at; an exact release only itself', async () => {
  const { releaseArgs } = await import('../tools/pwa-app.mjs');
  const at = 'b'.repeat(40);
  assert.equal(releaseArgs('v4.5.10', at), ' -f release=v4.5.10');
  assert.equal(releaseArgs('v4.5.10+24', at), ` -f release=v4.5.10 -f release_at=${at}`);
  assert.equal(releaseArgs('v4.5.10+24', null), '', 'no tag commit: nothing, as before');
  assert.equal(releaseArgs('v4.5.10+24', 'abc;rm -rf /'), '', 'a tag commit must be 40 hex');
  for (const bad of ['v4.5.10+x', 'v4.05.1', 'v4.5.10\n', 'v4.5.10+24 -f x=y', '', null])
    assert.equal(releaseArgs(bad, at), '', JSON.stringify(bad));
});

test("B-427: the live guard reads a +n dispatch's release_at as the tag's commit, not a second build commit", () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const at = 'a'.repeat(40);
  const command = appCalls({ target: 'live', commit: sha, mattOk: true, release: 'v4.9.2+3', releaseAt: at }).calls[0]
    .args.command;
  assert.match(command, / -f commit=[0-9a-f]{40} -f release=v4\.9\.2 -f release_at=a{40}$/);
  const input = { tool_name: 'Bash', tool_input: { command } };
  const now = Date.now();
  const liveOk = { at: now - 60e3, by: 'ship live --matt-ok', commit: sha };
  assert.equal(H.liveGuard(input, { liveId: 'x', liveOk, now }), null, 'passes under the OK for the build commit');
  assert.notEqual(
    H.liveGuard(input, { liveId: 'x', liveOk: { ...liveOk, commit: at }, now }),
    null,
    'an OK for the tag commit is not an OK for the build'
  );
});
