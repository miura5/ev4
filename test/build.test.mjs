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
import { build, sha256, registryProblems } from '../tools/build.mjs';
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
  assert.equal(manifest.release, 'v' + spec.specVersion);
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
  assert.equal(manifest.tasks['live.morning'].name, `E.V. morning (${manifest.release})`);
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

test('registryProblems is empty for this repository', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
  assert.deepEqual(registryProblems(spec, loadSchemas()), []);
});

test('the build fails when core VERSION and the release differ', async () => {
  const dir = copyRepo();
  fs.writeFileSync(path.join(dir, 'core/evcore.mjs'), "export const VERSION = 'v3.9.9';\n");
  await assert.rejects(build({ root: dir, now: NOW }), /core VERSION v3\.9\.9 differs from the release v4\.0\.0/);
});
