#!/usr/bin/env node
// E.V. v4 build (Operational architecture, "Release: manifest, deploy, verify"). Writes dist/:
//   manifest.json            release, commit, dirty, builtAt, file hashes, pages, tasks (prompt hashes), records
//   prompts/<task key>.txt   each task's prompt, as tools/prompts.mjs renders it
//   system/manifest.json     the record copy of the manifest (envelope added); deploy refuses it when dirty
//   system/spec.json         the spec as the record holds it
//   system/environments.json spec.environments as the record holds it
// Fails, writing nothing, when the spec and the schema registry disagree or a system document does not validate.
// Usage: node tools/build.mjs [--root <repo>] [--out <dir>] [--now <ISO>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeValidator, validateAgainst, describeErrors } from '../core/validate.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// What the manifest hashes: everything that executes or is deployed. dist/ page outputs join when the page exists (B-15).
const HASHED = [/^core\/.+\.mjs$/, /^scripts\/.+\.js$/, /^page\/.+\.(html|js|css)$/, /^spec\/ev\.spec\.json$/, /^spec\/schemas\/.+\.schema\.json$/];
const SYSTEM_DOCS = ['system/manifest', 'system/spec', 'system/environments'];

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The tree git would commit (tracked plus untracked-not-ignored), and whether it differs from HEAD. */
export function gitState(root) {
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  const porcelain = git(root, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean);
  const files = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
    .filter(f => fs.existsSync(path.join(root, f)));
  return { commit, dirty: porcelain.length > 0, changes: porcelain, files };
}

export function loadSchemas(root) {
  const dir = path.join(root, 'spec', 'schemas');
  const out = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.schema.json')).sort()) out[f.slice(0, -12)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return out;
}

/** The registry rule: the build fails if a schema and the spec's collection map disagree. Returns a list of problems. */
export function registryProblems(spec, schemas) {
  const problems = [];
  const cols = Object.keys(spec.collections), have = Object.keys(schemas);
  for (const c of cols) if (!have.includes(c)) problems.push(`${c}: no schema file`);
  for (const c of have) if (!cols.includes(c)) problems.push(`${c}: a schema with no collection in the spec`);
  for (const c of cols.filter(c => have.includes(c))) {
    const meta = schemas[c]['x-ev'] || {}, want = spec.collections[c];
    if (want.schema !== `spec/schemas/${c}.schema.json`) problems.push(`${c}: the spec names schema file ${want.schema}`);
    if (meta.class !== want.class) problems.push(`${c}: class ${meta.class} in the schema, ${want.class} in the spec`);
    if (JSON.stringify(meta.writers) !== JSON.stringify(want.writers)) problems.push(`${c}: writers differ between the schema and the spec`);
    // B-32 (D-089): a Fact's marks, each with the roles that may change it, named alike in the schema and the spec.
    if (JSON.stringify(meta.marks || null) !== JSON.stringify(want.marks || null)) problems.push(`${c}: marks differ between the schema (x-ev.marks) and the spec`);
    for (const [f, roles] of Object.entries(meta.marks || {})) {
      if (want.class !== 'Fact') problems.push(`${c}: marks on a ${want.class}; only a Fact has marks`);
      if (!schemas[c].properties || !schemas[c].properties[f]) problems.push(`${c}: mark ${f} is not a property of its schema`);
      if (!Array.isArray(roles) || !roles.length) problems.push(`${c}: mark ${f} names no role`);
      if ((want.appends || {})[f]) problems.push(`${c}: ${f} is both a mark and an append map`);
    }
    if (c !== 'legacy' && JSON.stringify((schemas[c].properties.writer || {}).enum) !== JSON.stringify(want.writers)) problems.push(`${c}: the envelope writer enum differs from the spec`);
  }
  return problems;
}

function taskEntries(spec, release) {
  const out = {};
  const name = (lane, pipeline) => spec.tasks.nameTemplate[lane].replace('<pipeline>', pipeline).replace('<release>', release);
  const entry = (key, t, displayName, promptSha256) => {
    out[key] = { name: displayName, pipeline: t.pipeline, record: t.record, lane: t.lane, schedule: t.schedule, macBound: t.macBound, folders: t.folders, push: t.push, trigger: t.trigger, promptSha256 };
  };
  for (const target of ['live', 'staging']) for (const [id, t] of Object.entries(spec.tasks[target])) entry(`${target}.${id}`, t, name(target, id), null);
  entry('staging.diagnostic', spec.tasks.diagnostic, name('staging', 'diagnostic'), null);
  for (const [id, t] of Object.entries(spec.tasks.build)) entry(`build.${id}`, t, id, null);
  return out;
}

// Every task's prompt from tools/prompts.mjs: its hash in the manifest, its text in dist/prompts/<key>.txt (the file
// deploy's create_trigger and update_trigger calls name). A task whose pipeline has no steps yet keeps a null hash.
async function promptHashes(root, spec, release, tasks) {
  const p = path.join(root, 'tools', 'prompts.mjs');
  if (!fs.existsSync(p)) return {};
  const { renderPrompt } = await import(pathToFileURL(p).href);
  const texts = {};
  for (const [key, t] of Object.entries(tasks)) {
    const text = renderPrompt({ key, task: t, spec, release });
    if (typeof text === 'string') { t.promptSha256 = sha256(text); texts[key] = text; }
  }
  return texts;
}

// ------------------------------------------------------------------------------------------------ the page
/**
 * The page as a shell plus published files (Operational architecture, "Page delivery"), once per target:
 * {live: {'index.html': text, 'core.js', 'spec.json', 'app.js', 'styles.css'}, staging: {...}}, the shell first.
 * core.js is evcore.mjs with its export made a global, then validate.mjs the same way: the same rules the pipelines
 * run. spec.json is what the page needs of the spec for its own target only; the build refuses a page that names
 * the other target's tasks or record (the v3 staging check, kept). null when the repository has no shell yet.
 */
export function buildPages({ root, spec, schemas, release }) {
  const ui = spec.ui && spec.ui.page; const shellFile = path.join(root, 'page', 'index.src.html');
  if (!ui || !fs.existsSync(shellFile)) return null;
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const core = read('core/evcore.mjs');
  if (!/export default EVCore;\s*$/.test(core)) throw new Error('core/evcore.mjs must end with export default EVCore;');
  const validate = read('core/validate.mjs');
  if (/^import /m.test(validate)) throw new Error('core/validate.mjs must not import: it runs in the page as written');
  const names = [...validate.matchAll(/^export function (\w+)/gm)].map(m => m[1]);
  const coreJs = core.replace(/export default EVCore;\s*$/, 'window.EVCore = EVCore;\n')
    + '\n// ---- core/validate.mjs\n(function () {\n' + validate.replace(/^export function /gm, 'function ') + '\nwindow.EVValidate = { ' + names.join(', ') + ' };\n})();\n';
  const app = read('page/app.js');
  const appVersion = (app.match(/const VERSION = '([^']+)'/) || [])[1];
  if (appVersion !== release) throw new Error(`page/app.js VERSION ${appVersion || '(none)'} differs from the release ${release}`);
  const out = {};
  for (const target of ['live', 'staging']) {
    const other = target === 'live' ? 'staging' : 'live';
    const rec = spec.registry.records[target] || {};
    const pageSpec = {
      release, target, specVersion: spec.specVersion,
      record: { artifact: rec.artifact || null, name: rec.name || null },
      tasks: { [target]: spec.tasks[target], ...(target === 'staging' ? { diagnostic: spec.tasks.diagnostic } : {}) },
      constants: spec.constants, capacity: spec.capacity, ui: spec.ui, jobs: spec.jobs, boundaries: spec.boundaries,
      workingAgreements: spec.workingAgreements, persona: spec.persona || null, items: spec.items || null, pipelines: Object.fromEntries(Object.entries(spec.pipelines).filter(([k]) => !k.startsWith('_')).map(([k, p]) => [k, { lane: p.lane, purpose: p.purpose, steps: p.steps ? p.steps.length : null }])),
      reader: (spec.registry.studyWatch || {}).reader || null,
      schedules: Object.fromEntries(Object.entries(spec.tasks.live || {}).filter(([, t]) => t && t.pipeline).map(([k, t]) => [t.pipeline, t.schedule || null])), // when each runs live (no task ids)
      collections: spec.collections, schemas,
    };
    const specJson = JSON.stringify(pageSpec);
    const foreign = [...Object.values(spec.tasks[other] || {}).map(t => t && t.trigger).filter(Boolean), (spec.registry.records[other] || {}).artifact].filter(Boolean);
    const leak = foreign.find(id => specJson.includes(id));
    if (leak) throw new Error(`the ${target} page would name ${other}'s ${leak}`);
    const shell = read('page/index.src.html').replaceAll('{{TITLE}}', rec.name || 'E.V. Home').replaceAll('{{RELEASE}}', release).replaceAll('{{TARGET}}', target);
    if (/\{\{\w+\}\}/.test(shell)) throw new Error('page/index.src.html has a placeholder the build does not fill: ' + shell.match(/\{\{\w+\}\}/)[0]);
    if (Buffer.byteLength(shell) > ui.shellBudgetBytes) throw new Error(`the shell is ${Buffer.byteLength(shell)} bytes, over its ${ui.shellBudgetBytes}-byte budget`);
    out[target] = { [ui.shell]: shell, 'core.js': coreJs, 'spec.json': specJson, 'app.js': app, 'styles.css': read('page/styles.css') };
    const want = [ui.shell, ...ui.files].sort().join(); if (Object.keys(out[target]).sort().join() !== want) throw new Error('spec.ui.page lists ' + want + '; the build makes ' + Object.keys(out[target]).sort().join());
  }
  return out;
}

export async function build({ root = HERE, out = path.join(root, 'dist'), now = new Date().toISOString() } = {}) {
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'ev.spec.json'), 'utf8'));
  const schemas = loadSchemas(root);
  const problems = registryProblems(spec, schemas);
  if (problems.length) throw new Error('the spec and the schema registry disagree:\n  ' + problems.join('\n  '));
  const validate = makeValidator(schemas);
  const release = 'v' + spec.specVersion;
  const coreVersionFile = path.join(root, 'core', 'evcore.mjs');
  if (fs.existsSync(coreVersionFile)) {
    const m = fs.readFileSync(coreVersionFile, 'utf8').match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (!m || m[1] !== release) throw new Error(`core VERSION ${m ? m[1] : '(none)'} differs from the release ${release}`);
  }

  const g = gitState(root);
  const files = {};
  for (const f of g.files.filter(f => HASHED.some(re => re.test(f))).sort()) files[f] = sha256(fs.readFileSync(path.join(root, f)));
  const pageOut = buildPages({ root, spec, schemas, release });
  const page = target => ({ artifact: (spec.registry.records[target] || {}).artifact || null, files: pageOut ? Object.fromEntries(Object.entries(pageOut[target]).map(([f, body]) => ['page/' + target + '/' + f, sha256(body)])) : {}, capabilities: pageOut ? spec.ui.page.capabilities : null });
  const tasks = taskEntries(spec, release);
  const prompts = await promptHashes(root, spec, release, tasks);
  const records = Object.fromEntries(['live', 'staging'].map(t => [t, { artifact: (spec.registry.records[t] || {}).artifact || null, systemDocs: SYSTEM_DOCS }]));
  const manifest = { release, commit: g.commit, dirty: g.dirty, builtAt: now, specVersion: spec.specVersion, files, pages: { live: page('live'), staging: page('staging') }, tasks, records };

  const system = schemas.system;
  const body = validateAgainst({ $ref: '#/$defs/manifestBody', $defs: system.$defs }, manifest);
  if (!body.ok) throw new Error('dist/manifest.json does not validate:\n' + describeErrors('manifest', body));
  const envelope = { schema: 1, writer: 'deploy', at: now, source: `deploy ${release}` };
  const docs = {
    'system/manifest': { ...envelope, ...manifest },
    'system/spec': { ...envelope, ...spec },
    'system/environments': { ...envelope, ...spec.environments },
  };
  for (const [key, doc] of Object.entries(docs)) {
    const id = key.split('/')[1];
    const r = validate('system', doc, { id });
    // A dirty build may still be written, so the manifest says so; deploy refuses it (B-04).
    const errors = r.errors.filter(e => !(id === 'manifest' && g.dirty && e.path === '/dirty'));
    if (errors.length) throw new Error(`${key} does not validate:\n` + describeErrors(key, { errors }));
  }

  fs.mkdirSync(path.join(out, 'system'), { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  for (const [key, doc] of Object.entries(docs)) fs.writeFileSync(path.join(out, key + '.json'), JSON.stringify(doc, null, 1));
  fs.rmSync(path.join(out, 'page'), { recursive: true, force: true });
  if (pageOut) for (const [target, files] of Object.entries(pageOut)) {
    fs.mkdirSync(path.join(out, 'page', target), { recursive: true });
    for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(out, 'page', target, f), body);
  }
  fs.rmSync(path.join(out, 'prompts'), { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'prompts'), { recursive: true });
  for (const [key, text] of Object.entries(prompts)) fs.writeFileSync(path.join(out, 'prompts', key + '.txt'), text);
  return { manifest, changes: g.changes, out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    const { manifest, changes, out } = await build({ root: arg('root') ? path.resolve(arg('root')) : HERE, out: arg('out') ? path.resolve(arg('out')) : undefined, now: arg('now') });
    console.log(`E.V. ${manifest.release} at ${manifest.commit.slice(0, 12)}: ${Object.keys(manifest.files).length} files hashed, ${Object.keys(manifest.tasks).length} tasks -> ${path.relative(process.cwd(), out) || out}`);
    if (manifest.dirty) console.log(`dirty: true (${changes.length} uncommitted change${changes.length === 1 ? '' : 's'}); deploy will refuse this build`);
  } catch (e) {
    console.error('build failed: ' + e.message);
    process.exit(1);
  }
}
