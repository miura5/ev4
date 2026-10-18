// The page as a shell plus published files (B-15): what the build makes for each target, and the one publish call
// deploy prints for it. The page itself is driven by the harness (test/harness/run.cjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { buildPages, loadSchemas } from '../tools/build.mjs';
import { deployCalls, verify } from '../core/deploy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8'));
const release = 'v' + spec.specVersion;
const schemas = loadSchemas(ROOT);
const pages = buildPages({ root: ROOT, spec, schemas, release });

test('each target gets the shell and the four published files spec.ui.page names, the shell within its budget', () => {
  for (const target of ['live', 'staging']) {
    assert.deepEqual(Object.keys(pages[target]), [spec.ui.page.shell, ...['core.js', 'spec.json', 'app.js', 'styles.css']]);
    assert.deepEqual(spec.ui.page.files.slice().sort(), ['app.js', 'core.js', 'spec.json', 'styles.css']);
    const shell = pages[target]['index.html'];
    assert.ok(Buffer.byteLength(shell) <= spec.ui.page.shellBudgetBytes, `${target} shell ${Buffer.byteLength(shell)} bytes`);
    assert.match(shell, new RegExp(`<meta name="ev-release" content="${release.replace(/\./g, '\\.')}">`));
    assert.match(shell, new RegExp(`<meta name="ev-target" content="${target}">`));
    assert.doesNotMatch(shell, /\{\{\w+\}\}/);
    for (const f of ['spec.json', 'core.js', 'app.js']) assert.match(shell, new RegExp(`['"]${f.replace('.', '\\.')}['"]`), `the shell loads ${f}`);
    assert.match(shell, /href="styles\.css"/);
  }
  assert.match(pages.staging['index.html'], /<title>E\.V\. Home Staging v4<\/title>/);
  assert.match(pages.live['index.html'], /<title>E\.V\. Home<\/title>/);
});

test('core.js is the pipelines\' own core and validator, made globals', () => {
  const core = pages.staging['core.js'];
  const src = fs.readFileSync(path.join(ROOT, 'core/evcore.mjs'), 'utf8');
  assert.ok(core.startsWith(src.replace(/export default EVCore;\s*$/, '')), 'evcore.mjs byte for byte up to its export');
  const window = {}; vm.runInNewContext(core, { window, console, TextEncoder, Intl, Date, Math, JSON });
  assert.equal(window.EVCore.VERSION, release);
  assert.equal(typeof window.EVValidate.makeValidator, 'function');
  const validate = window.EVValidate.makeValidator(schemas);
  assert.equal(validate('exams', { schema: 1 }).ok, false, 'the page refuses what the pipelines refuse');
  assert.equal(pages.live['core.js'], core, 'one core for both targets');
});

test('spec.json carries only its own target: no live task or record on staging, none of staging on live', () => {
  const s = JSON.parse(pages.staging['spec.json']); const l = JSON.parse(pages.live['spec.json']);
  assert.equal(s.target, 'staging'); assert.equal(l.target, 'live'); assert.equal(s.release, release);
  assert.equal(s.record.artifact, spec.registry.records.staging.artifact);
  assert.deepEqual(Object.keys(s.tasks).sort(), ['diagnostic', 'staging']); assert.deepEqual(Object.keys(l.tasks), ['live']);
  for (const t of Object.values(spec.tasks.live)) if (t && t.trigger) assert.ok(!pages.staging['spec.json'].includes(t.trigger), t.trigger);
  for (const t of Object.values(spec.tasks.staging)) if (t && t.trigger) assert.ok(!pages.live['spec.json'].includes(t.trigger), t.trigger);
  assert.ok(!pages.staging['spec.json'].includes(spec.registry.records.live.artifact));
  assert.ok(s.schemas.exams && s.ui.page.subscribe.length, 'the schemas the page validates with, and its subscriptions');
});

test('the build refuses a page that would name the other target, an app from another release, a shell over budget', () => {
  const leaky = JSON.parse(JSON.stringify(spec)); leaky.jobs = { ...leaky.jobs, note: 'see ' + spec.registry.records.live.artifact };
  assert.throws(() => buildPages({ root: ROOT, spec: leaky, schemas, release }), /the staging page would name live's/);
  const tight = JSON.parse(JSON.stringify(spec)); tight.ui.page.shellBudgetBytes = 1000;
  assert.throws(() => buildPages({ root: ROOT, spec: tight, schemas, release }), /over its 1000-byte budget/);
  assert.throws(() => buildPages({ root: ROOT, spec, schemas, release: 'v9.9.9' }), /page\/app\.js VERSION v4\.0\.0 differs from the release v9\.9\.9/);
});

test('deploy prints one publish call: the shell, the four files by their published names, the capabilities whole', () => {
  const files = Object.fromEntries(Object.entries(pages.staging).map(([f, b]) => ['page/staging/' + f, 'h'.repeat(64)]));
  const manifest = { release, commit: 'a'.repeat(40), dirty: false, specVersion: spec.specVersion, files: {}, tasks: {},
    pages: { live: { artifact: null, files: {}, capabilities: null }, staging: { artifact: spec.registry.records.staging.artifact, files, capabilities: spec.ui.page.capabilities } },
    records: { live: { artifact: null, systemDocs: [] }, staging: { artifact: spec.registry.records.staging.artifact, systemDocs: [] } } };
  const r = deployCalls({ manifest, target: 'staging', distDir: '/d', build: { dirty: false, pushed: true }, versions: { manifest: 1, spec: 1, environments: 1 } });
  const pub = r.calls.filter(c => c.tool === 'Artifact');
  assert.equal(pub.length, 1);
  assert.deepEqual(pub[0].args.file_path, '/d/page/staging/index.html');
  assert.deepEqual(pub[0].args.files, { 'core.js': '/d/page/staging/core.js', 'spec.json': '/d/page/staging/spec.json', 'app.js': '/d/page/staging/app.js', 'styles.css': '/d/page/staging/styles.css' });
  assert.deepEqual(pub[0].args.capabilities, spec.ui.page.capabilities);
  for (const k of ['db', 'user', 'sample', 'mcp']) assert.ok(pub[0].args.capabilities[k], `capability ${k} restated`);
  assert.deepEqual(pub[0].args.capabilities.mcp.servers.map(s => s.server), ['Claude Code Remote', 'host:E_V__Study_Watch_reader']);
  // verify: a published file that differs is reported; the shell (wrapped at publish) is held by its stamp only.
  const state = { triggers: [], record: null, pageHtml: `<meta name="ev-release" content="${release}">`, pageFiles: { ...files, 'page/staging/index.html': 'x'.repeat(64), 'page/staging/app.js': 'b'.repeat(64) } };
  const v = verify({ manifest, target: 'staging', state, build: { commit: manifest.commit, dirty: false, pushed: true }, sha256: x => x, now: '2026-10-18T06:00:00Z' });
  const line = v.lines.find(l => l.what === 'published page files');
  assert.equal(line.ok, false); assert.match(line.detail, /^1 differ: page\/staging\/app\.js$/);
});
