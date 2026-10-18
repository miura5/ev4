#!/usr/bin/env node
// E.V. v4 build (Operational architecture, "Release: manifest, deploy, verify"). Writes dist/:
//   manifest.json            release, commit, dirty, builtAt, file hashes, pages, tasks (prompt hashes), records
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

function loadSchemas(root) {
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

// Prompt hashes come from tools/prompts.mjs once it exists (B-09); until then every promptSha256 is null.
async function promptHashes(root, spec, release, tasks) {
  const p = path.join(root, 'tools', 'prompts.mjs');
  if (!fs.existsSync(p)) return;
  const { renderPrompt } = await import(pathToFileURL(p).href);
  for (const [key, t] of Object.entries(tasks)) {
    const text = renderPrompt({ key, task: t, spec, release });
    if (typeof text === 'string') t.promptSha256 = sha256(text);
  }
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
  const page = target => ({ artifact: target === 'live' ? (spec.registry.records.live || {}).artifact || null : (spec.registry.records.staging || {}).artifact || null, files: {}, capabilities: null });
  const tasks = taskEntries(spec, release);
  await promptHashes(root, spec, release, tasks);
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
