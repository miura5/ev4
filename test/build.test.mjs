// Build and manifest (B-03): tools/build.mjs writes dist/manifest.json and the system documents; the manifest
// validates against its schema; a dirty tree marks dirty: true; a spec/schema disagreement fails the build.
// Each test builds a throwaway git repository holding a copy of this working tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, sha256 } from '../tools/build.mjs';
import { listRepoFiles } from '../tools/personal-data.mjs';
import { makeValidator, validateAgainst } from '../core/validate.mjs';
import { loadSchemas } from '../core/schemas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-10-17T12:00:00Z';
const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function copyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-build-'));
  for (const f of listRepoFiles(ROOT)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  git(dir, 'init', '-q');
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'add', '-A');
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'copy');
  return dir;
}

test('a clean tree builds a manifest that validates, with every file hash, task and record', async () => {
  const dir = copyRepo();
  const { manifest } = await build({ root: dir, now: NOW });
  const schemas = loadSchemas(path.join(dir, 'spec', 'schemas'));
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'spec/ev.spec.json'), 'utf8'));
  assert.equal(manifest.dirty, false);
  assert.equal(manifest.commit, git(dir, 'rev-parse', 'HEAD').trim());
  // B-149: no v4.* tag in this copy, so the release says so; tagged builds are B-149's own test.
  assert.equal(manifest.release, `v${spec.specVersion}.0+untagged`);
  assert.equal(manifest.builtAt, NOW);
  assert.ok(validateAgainst({ $ref: '#/$defs/manifestBody', $defs: schemas.system.$defs }, manifest).ok);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'dist/manifest.json'), 'utf8'));
  assert.deepEqual(onDisk, manifest);
  for (const f of ['core/validate.mjs', 'spec/ev.spec.json', 'spec/schemas/weakspots.schema.json'])
    assert.equal(manifest.files[f], sha256(fs.readFileSync(path.join(dir, f))), f);
  assert.ok(
    !Object.keys(manifest.files).some(f => f.startsWith('test/') || f.startsWith('tools/')),
    'only deployed files are hashed'
  );
  const expected =
    Object.keys(spec.tasks.live).length +
    Object.keys(spec.tasks.staging).length +
    1 +
    Object.keys(spec.tasks.build).length;
  assert.equal(Object.keys(manifest.tasks).length, expected);
  assert.equal(manifest.tasks['live.morning'].name, 'E.V. morning', 'D-192: no version in a task name');
  assert.equal(manifest.tasks['staging.worker'].name, 'E.V. staging · worker');
  assert.equal(manifest.tasks['staging.evening-mac'].macBound, true);
  assert.equal(manifest.records.live.artifact, spec.registry.records.live.artifact);
  assert.deepEqual(manifest.records.live.systemDocs, ['system/manifest', 'system/spec', 'system/environments']);
  // The record copies validate as the system collection's documents, the manifest copy clean.
  const validate = makeValidator(schemas);
  for (const id of ['manifest', 'spec', 'environments']) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'dist/system', id + '.json'), 'utf8'));
    assert.ok(validate('system', doc, { id }).ok, id);
    assert.equal(doc.writer, 'deploy');
  }
});

test('the same tree builds byte-identical output at the same time', async () => {
  const dir = copyRepo();
  await build({ root: dir, now: NOW });
  const first = fs.readFileSync(path.join(dir, 'dist/manifest.json'), 'utf8');
  await build({ root: dir, now: NOW });
  assert.equal(fs.readFileSync(path.join(dir, 'dist/manifest.json'), 'utf8'), first);
});

test('a dirty tree marks dirty: true (a changed file, a new file); ignored files do not', async () => {
  const dir = copyRepo();
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixtures', 'ignored.json'), '{}');
  assert.equal((await build({ root: dir, now: NOW })).manifest.dirty, false, 'dist/ and fixtures/ are ignored');

  fs.appendFileSync(path.join(dir, 'core/validate.mjs'), '\n// changed\n');
  const changed = await build({ root: dir, now: NOW });
  assert.equal(changed.manifest.dirty, true);
  assert.equal(
    changed.manifest.files['core/validate.mjs'],
    sha256(fs.readFileSync(path.join(dir, 'core/validate.mjs')))
  );
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'dist/system/manifest.json'), 'utf8'));
  const validate = makeValidator(loadSchemas(path.join(dir, 'spec', 'schemas')));
  assert.ok(
    validate('system', record, { id: 'manifest' }).errors.some(e => e.path === '/dirty'),
    'the record copy of a dirty build cannot validate as deployed'
  );

  git(dir, 'checkout', '-q', '--', 'core/validate.mjs');
  fs.writeFileSync(path.join(dir, 'core', 'new.mjs'), 'export {};\n');
  assert.equal((await build({ root: dir, now: NOW })).manifest.dirty, true, 'an untracked file');
});

test('the build fails when the spec and the schema registry disagree, and writes nothing', async () => {
  const dir = copyRepo();
  const p = path.join(dir, 'spec/schemas/dayedits.schema.json');
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  s['x-ev'].writers = ['morning'];
  fs.writeFileSync(p, JSON.stringify(s, null, 1));
  await assert.rejects(build({ root: dir, now: NOW }), /dayedits: writers differ/);
  assert.equal(fs.existsSync(path.join(dir, 'dist/manifest.json')), false);
  fs.renameSync(p, p + '.off');
  await assert.rejects(build({ root: dir, now: NOW }), /dayedits: no schema file/);
});

test('B-149: the build fails when core has no release slot to write the release into', async () => {
  const dir = copyRepo();
  const p = path.join(dir, 'core/evcore.mjs');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace("'__EV_RELEASE__'", "'v3.9.9'"));
  await assert.rejects(build({ root: dir, now: NOW }), /core\/evcore\.mjs has no __EV_RELEASE__ for the release/);
});

test('B-149 (D-173): the release is the tag at a tagged commit, <tag>+<n> past it, and a bookkeeping commit never moves it', async () => {
  const dir = copyRepo();
  const g = (...a) => git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a);
  g('tag', '-a', 'v4.2.0', '-m', 'E.V. v4.2.0');
  let { manifest } = await build({ root: dir, now: NOW });
  assert.equal(manifest.release, 'v4.2.0');
  // Two product commits past it: v4.2.0+2.
  for (const n of [1, 2]) {
    fs.writeFileSync(path.join(dir, `core/extra${n}.mjs`), `export const x${n} = ${n};\n`);
    g('add', '-A');
    g('commit', '-q', '-m', `B-0${n}: a product change`);
  }
  ({ manifest } = await build({ root: dir, now: NOW }));
  assert.equal(manifest.release, 'v4.2.0+2');
  const commit = manifest.commit;
  // A record commit after it: the build's commit and its release stay.
  fs.writeFileSync(path.join(dir, 'BACKLOG.md'), 'changed\n');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), 'changed\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'B-01: notes (chart)');
  ({ manifest } = await build({ root: dir, now: NOW }));
  assert.deepEqual([manifest.commit, manifest.release], [commit, 'v4.2.0+2']);
  // A run's build of its tagless clone takes the deployed release it is given.
  ({ manifest } = await build({ root: dir, now: NOW, release: 'v4.2.0' }));
  assert.equal(manifest.release, 'v4.2.0');
  for (const t of ['live', 'staging']) {
    const page = fs.readFileSync(path.join(dir, 'dist', 'page', t, 'app.js'), 'utf8');
    assert.match(page, /const VERSION = 'v4\.2\.0'/);
  }
});

test('B-149 (D-173): no version literal lives outside the spec: core, the page, the tools and the scripts carry none', () => {
  const ROOT_ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const found = [];
  const walk = d => {
    for (const f of fs.readdirSync(path.join(ROOT_, d))) {
      const rel = path.join(d, f);
      if (fs.statSync(path.join(ROOT_, rel)).isDirectory()) walk(rel);
      else if (/\.(mjs|cjs|js|html)$/.test(f)) {
        const text = fs.readFileSync(path.join(ROOT_, rel), 'utf8');
        for (const m of text.matchAll(/['"`]v4\.\d+\.\d+[^'"`]*['"`]/g)) found.push(`${rel}: ${m[0]}`);
      }
    }
  };
  for (const d of ['core', 'page', 'tools', 'scripts']) walk(d);
  assert.deepEqual(found, []);
});

test('B-149: the bookkeeping patterns and the pathspecs that find the build commit name the same files', async () => {
  const { BOOKKEEPING, BOOKKEEPING_PATHS } = await import('../tools/build.mjs');
  for (const p of BOOKKEEPING_PATHS)
    assert.ok(
      BOOKKEEPING.some(re => re.test(p === 'chart' ? 'chart/x.json' : p)),
      p
    );
  assert.equal(BOOKKEEPING.length, BOOKKEEPING_PATHS.length);
});

test('B-150: build refuses to write a system document past spec.capacity.system.failBytes', async () => {
  const dir = copyRepo();
  const p = path.join(dir, 'spec/ev.spec.json');
  const spec = JSON.parse(fs.readFileSync(p, 'utf8'));
  spec.capacity.system = { ...spec.capacity.system, warnBytes: 40000, failBytes: 50000 };
  fs.writeFileSync(p, JSON.stringify(spec, null, 1));
  await assert.rejects(
    build({ root: dir, now: NOW }),
    /system\/spec is \d+ bytes \(\d+ KiB; warns at 39 KiB, fails at 49 KiB\): over the budget/
  );
});

test('B-425: a docs-only commit keeps the build commit; a code commit moves it; a commit mixing both moves it', async () => {
  const { buildCommitOf, gitState } = await import('../tools/build.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-b425-'));
  const g = (...a) => git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a).trim();
  g('init', '-q');
  const commit = (files, msg) => {
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), msg);
    }
    g('add', ...files);
    g('commit', '-qm', msg);
    return g('rev-parse', 'HEAD');
  };
  const code = commit(['core/a.mjs', 'docs/handover.md'], 'the build');
  const docs = commit(['docs/review-brief.md'], 'a docs edit');
  assert.equal(buildCommitOf(dir, docs), code, 'a docs-only commit keeps the build commit');
  const both = commit(['docs/trim/scan/core.md', 'chart/deploys.json'], 'docs and the record');
  assert.equal(buildCommitOf(dir, both), code, 'docs plus bookkeeping keeps it too');
  assert.equal(gitState(dir).commit, code, 'gitState names the same build commit');
  fs.writeFileSync(path.join(dir, 'docs/lessons.md'), 'an uncommitted docs edit');
  assert.equal(gitState(dir).dirty, false, 'an uncommitted docs edit is not dirt');
  const moved = commit(['core/a.mjs'], 'a code change');
  assert.equal(buildCommitOf(dir, moved), moved, 'a code commit moves it');
  const mixed = commit(['docs/handover.md', 'page/x.js'], 'docs and code together');
  assert.equal(buildCommitOf(dir, mixed), mixed, 'a commit mixing docs and code moves it');
  for (const f of ['docs.md', 'test/docs/x.json', 'core/docs.mjs']) {
    const c = commit([f], `${f} is not under docs/`);
    assert.equal(buildCommitOf(dir, c), c, f);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('B-425: no build, run, check or test code reads a file under docs/ (so a docs commit can keep the build commit)', () => {
  // a read naming docs/ in its call, a path literal under docs/, or a path built with a 'docs' segment (save for the
  // export folders named docs inside a run's own directory: core/cli.mjs and tools/pwa-copy.mjs)
  // B-449: docs/study-plan-brief.md is the study plans' default instructions, built into the spec; its drift test reads
  // it, so an edit of the brief is a build change (the spec copy follows it), never a docs-only one
  // D-392 to D-395: docs/design/ui-polish/ is copied to staging's /reference by tools/build-pwa.mjs; it stays inert (a
  // reference-only edit keeps the build commit and reaches staging with the next build), and live never carries it
  const allowed = /path\.join\((out|dir), 'docs'|docs\/study-plan-brief\.md|docs\/design\/ui-polish/;
  const reads = [
    /(readFileSync|readdirSync|existsSync|statSync|createReadStream)\([^)]*['"`]docs[/'"`]/,
    /['"`]docs\/[^'"`\s]/,
    /path\.(join|resolve)\([^)]*['"`]docs['"`/]/,
  ];
  // (test files name docs/ paths as fixtures in throwaway repositories: for them only a read call counts)
  const read = {
    test: (t, rel) =>
      t
        .split('\n')
        .some(l => !allowed.test(l) && (rel.startsWith('test') ? reads.slice(0, 1) : reads).some(re => re.test(l))),
  };
  const found = [];
  const walk = d => {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(rel);
      } else if (/\.(m?js|cjs)$/.test(e.name) && read.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel))
        found.push(rel);
    }
  };
  for (const d of ['core', 'page', 'pwa', 'scripts', 'tools', 'test']) walk(d);
  assert.deepEqual(found, []);
  // The workflows name docs/ only to skip it (smoke.yml's paths-ignore) or in a message.
  for (const f of fs.readdirSync(path.join(ROOT, '.github', 'workflows'))) {
    const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8');
    const uses = text
      .split('\n')
      .filter(l => /(^|[\s'"(])docs\//.test(l))
      .filter(l => !/^\s*#/.test(l) && !/^\s*- 'docs\/\*\*'\s*$/.test(l) && !/::warning/.test(l));
    assert.deepEqual(uses, [], `${f} reads docs/`);
  }
});

test('B-434: the app asks for its stylesheet and scripts under the release, so a new release never meets an old stylesheet', async () => {
  const { releaseKeyed } = await import('../tools/build-pwa.mjs');
  const shell =
    '<meta name="ev-release" content="v4.5.13+2">\n<link rel="stylesheet" href="styles.css">\n<script>(async()=>{await script(\'core.js\'); await script(\'app.js\');})()</script>';
  const out = releaseKeyed(shell);
  for (const f of ['styles.css', 'core.js', 'app.js']) assert.ok(out.includes(f + '?v=v4.5.13%2B2'), f);
  assert.throws(() => releaseKeyed('<link rel="stylesheet" href="styles.css">'), /names no release/);
  // the real shell: its lines are the ones keyed
  const real = fs.readFileSync(path.join(ROOT, 'page/index.src.html'), 'utf8');
  assert.ok(real.includes('<link rel="stylesheet" href="styles.css">'));
  assert.ok(real.includes("await script('core.js'); await script('app.js');"));
});

// D-386, D-388: Proprietary's budget holds over the split, summed: one file per component (page/app/01-ui-NN-<name>.js
// with page/app/01-ui.js, page/ds/components/NN-<name>.css, the Gallery's page/app/89-gallery-NN-<name>.js), the
// patterns one file each under page/ds/patterns/. Sixteen files would hide a total, so the test adds them up.
const PROPRIETARY = [
  'button',
  'badge',
  'chip',
  'segmented',
  'line',
  'fold',
  'card',
  'notice',
  'toast',
  'sheet',
  'popover',
  'field',
  'choice',
  'meter',
  'presence',
  'message',
];
const linesOf = f => {
  const t = fs.readFileSync(f, 'utf8');
  return t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
};
const inDir = (dir, re) =>
  fs.existsSync(path.join(ROOT, dir))
    ? fs
        .readdirSync(path.join(ROOT, dir))
        .filter(f => re.test(f))
        .sort()
    : [];

test('D-388: one file per component in each of its three homes, in B-504’s order', () => {
  const want = PROPRIETARY.map((n, i) => String(i + 1).padStart(2, '0') + '-' + n);
  assert.deepEqual(
    inDir('page/app', /^01-ui-.+\.js$/).map(f => f.slice(6, -3)),
    want
  );
  assert.deepEqual(
    inDir('page/ds/components', /\.css$/).map(f => f.slice(0, -4)),
    want
  );
  assert.deepEqual(
    inDir('page/app', /^89-gallery-.+\.js$/).map(f => f.slice(11, -3)),
    want
  );
  assert.ok(fs.existsSync(path.join(ROOT, 'page/app/01-ui.js')), 'DS and dsRoot');
});

test('D-386, D-388: the budget, summed over the split files: about 900 lines of JS, 900 of CSS, 500 of patterns', () => {
  const sum = (dir, re) => inDir(dir, re).reduce((n, f) => n + linesOf(path.join(ROOT, dir, f)), 0);
  const js = sum('page/app', /^01-ui[\w-]*\.js$/),
    css = sum('page/ds/components', /\.css$/),
    patterns = sum('page/ds/patterns', /\.css$/);
  assert.ok(js <= 900, `page/app/01-ui*.js: ${js} lines (budget 900; going over needs a superseding decision)`);
  assert.ok(css <= 900, `page/ds/components/*.css: ${css} lines (budget 900)`);
  assert.ok(patterns <= 500, `page/ds/patterns/*.css: ${patterns} lines (budget 500)`);
});
