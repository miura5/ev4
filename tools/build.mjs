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
import { systemSize } from '../core/deploy.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// What the manifest hashes: everything that executes or is deployed. dist/ page outputs join when the page exists (B-15).
const HASHED = [
  /^core\/.+\.mjs$/,
  /^scripts\/.+\.js$/,
  /^page\/.+\.(html|js|css)$/,
  /^spec\/ev\.spec\.json$/,
  /^spec\/schemas\/.+\.schema\.json$/,
];
const SYSTEM_DOCS = ['system/manifest', 'system/spec', 'system/environments'];

/** The page's app.js as published: page/app/*.js in name order, joined as they are (B-64). Each part is one section of
 *  the one closure EVApp.boot runs, split by tab for the reader; only the joined file is JavaScript on its own. */
export function appSource(root = HERE) {
  const dir = path.join(root, 'page', 'app');
  if (!fs.existsSync(dir)) throw new Error('no page/app/: the page logic lives there as parts (B-64)');
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('');
}
export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// The project record (M12): chart/, the BACKLOG.md generated from it, and the Chart's own tool and test. Nothing that
// ships is built from them.
// B-143 (D-172): DECISIONS.md and CHANGELOG.md are generated with the record, like BACKLOG.md.
export const BOOKKEEPING = [
  /^chart\//,
  /^BACKLOG\.md$/,
  /^DECISIONS\.md$/,
  /^CHANGELOG\.md$/,
  /^tools\/chart\.mjs$/,
  /^test\/chart\.test\.mjs$/,
];
const bookkeeping = f => BOOKKEEPING.some(re => re.test(f));
// The same list as pathspecs, for the log that finds the build's commit (one list, so the two never drift: B-149).
export const BOOKKEEPING_PATHS = [
  'chart',
  'BACKLOG.md',
  'DECISIONS.md',
  'CHANGELOG.md',
  'tools/chart.mjs',
  'test/chart.test.mjs',
];

/**
 * The tree git would commit (tracked plus untracked-not-ignored), and whether it differs from HEAD. The build's
 * commit is the newest that changed anything but the bookkeeping (M12): recording a task or a deploy in chart/ never
 * moves it, so verify-deploy stays green across it, and a bookkeeping change left uncommitted is not dirt.
 */
export function gitState(root) {
  let commit = '';
  try {
    commit = git(root, ['log', '-1', '--format=%H', '--', '.', ...BOOKKEEPING_PATHS.map(p => `:(exclude)${p}`)]).trim();
  } catch {
    /* none in a shallow checkout */
  }
  if (!commit) commit = git(root, ['rev-parse', 'HEAD']).trim();
  const porcelain = git(root, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter(Boolean)
    .filter(l => !l.slice(3).split(' -> ').every(bookkeeping));
  const files = git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)
    .filter(f => fs.existsSync(path.join(root, f)));
  return { commit, dirty: porcelain.length > 0, changes: porcelain, files };
}

export function loadSchemas(root) {
  const dir = path.join(root, 'spec', 'schemas');
  const out = {};
  for (const f of fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.schema.json'))
    .sort())
    out[f.slice(0, -12)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return out;
}

/** The registry rule: the build fails if a schema and the spec's collection map disagree. Returns a list of problems. */
export function registryProblems(spec, schemas) {
  const problems = [];
  const cols = Object.keys(spec.collections),
    have = Object.keys(schemas);
  for (const c of cols) if (!have.includes(c)) problems.push(`${c}: no schema file`);
  for (const c of have) if (!cols.includes(c)) problems.push(`${c}: a schema with no collection in the spec`);
  for (const c of cols.filter(c => have.includes(c))) {
    const meta = schemas[c]['x-ev'] || {},
      want = spec.collections[c];
    if (want.schema !== `spec/schemas/${c}.schema.json`)
      problems.push(`${c}: the spec names schema file ${want.schema}`);
    if (meta.class !== want.class) problems.push(`${c}: class ${meta.class} in the schema, ${want.class} in the spec`);
    if (JSON.stringify(meta.writers) !== JSON.stringify(want.writers))
      problems.push(`${c}: writers differ between the schema and the spec`);
    // B-32 (D-089): a Fact's marks, each with the roles that may change it, named alike in the schema and the spec.
    if (JSON.stringify(meta.marks || null) !== JSON.stringify(want.marks || null))
      problems.push(`${c}: marks differ between the schema (x-ev.marks) and the spec`);
    for (const [f, roles] of Object.entries(meta.marks || {})) {
      if (want.class !== 'Fact') problems.push(`${c}: marks on a ${want.class}; only a Fact has marks`);
      if (!schemas[c].properties || !schemas[c].properties[f])
        problems.push(`${c}: mark ${f} is not a property of its schema`);
      if (!Array.isArray(roles) || !roles.length) problems.push(`${c}: mark ${f} names no role`);
      if ((want.appends || {})[f]) problems.push(`${c}: ${f} is both a mark and an append map`);
    }
    if (c !== 'legacy' && JSON.stringify((schemas[c].properties.writer || {}).enum) !== JSON.stringify(want.writers))
      problems.push(`${c}: the envelope writer enum differs from the spec`);
  }
  return problems;
}

/** B-149: where core and the page take the release the build writes in (no version literal lives in the code). */
export const RELEASE_SLOT = '__EV_RELEASE__';
/**
 * B-149 (D-173): the release at a commit, from the newest v4.* tag reachable from it: the tag itself at a tagged
 * commit, <tag>+<n> n commits past it (SemVer build metadata), null when no tag is reachable (a shallow clone).
 */
export function releaseOf(root, commit = 'HEAD') {
  try {
    const d = execFileSync('git', ['-C', root, 'describe', '--tags', '--long', '--match', 'v4.*', commit], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = /^(v4\.\d+\.\d+)-(\d+)-g[0-9a-f]+$/.exec(d);
    return m ? (m[2] === '0' ? m[1] : `${m[1]}+${m[2]}`) : null;
  } catch {
    return null;
  }
}
/** D-192 (B-173): every task's entry; its name comes from spec.tasks.nameTemplate, which carries no version. */
export function taskEntries(spec, release) {
  const out = {};
  const name = (lane, pipeline) => {
    const t = spec.tasks.nameTemplate[lane];
    // D-192: a version in a name renames every task at every release, and a Mac-bound rename needs Matt at the Mac.
    if (/<minor>|<release>/.test(t)) throw new Error(`spec.tasks.nameTemplate.${lane} carries a version (D-192)`);
    return t.replace('<pipeline>', pipeline);
  };
  const entry = (key, t, displayName, promptSha256) => {
    out[key] = {
      name: displayName,
      pipeline: t.pipeline,
      record: t.record,
      lane: t.lane,
      schedule: t.schedule,
      macBound: t.macBound,
      folders: t.folders,
      push: t.push,
      trigger: t.trigger,
      promptSha256,
    };
  };
  for (const target of ['live', 'staging'])
    for (const [id, t] of Object.entries(spec.tasks[target])) entry(`${target}.${id}`, t, name(target, id), null);
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
    if (typeof text === 'string') {
      t.promptSha256 = sha256(text);
      texts[key] = text;
    }
  }
  return texts;
}

// ------------------------------------------------------------------------------------------------ the page
// B-161 (A-3): the page gets only the top-level spec keys it reads, the page logic, the shell and core.js together;
// test/page.test.mjs holds this list to what they read. The Mac folder and the task table stay out: the page needs
// one task, its target's worker, by trigger id.
export const PAGE_SPEC_KEYS = [
  'release',
  'target',
  'specVersion',
  'constants',
  'courses',
  'study',
  'items',
  'workouts',
  'jobs',
  'persona',
  'ui',
  'pipelines',
  'reader',
  'schedules',
  'schemas',
  'worker',
];
// Notes the validator ignores (core/validate.mjs) leave the page's schemas; x-ev keeps only its documents map. A map
// of names to schemas (properties, $defs and the like) keeps every name: a field called title is not a note.
const NOTE_KEYS = new Set(['description', '$comment', 'title', 'examples']);
const NAME_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const schemaForPage = o =>
  Array.isArray(o)
    ? o.map(schemaForPage)
    : o && typeof o === 'object'
      ? Object.fromEntries(
          Object.entries(o)
            .filter(([k]) => !NOTE_KEYS.has(k))
            .map(([k, v]) => [
              k,
              k === 'x-ev'
                ? v && v.documents
                  ? { documents: v.documents }
                  : {}
                : NAME_MAPS.has(k) && v && typeof v === 'object'
                  ? Object.fromEntries(Object.entries(v).map(([n, x]) => [n, schemaForPage(x)]))
                  : schemaForPage(v),
            ])
        )
      : o;
// The spec's prose (_rules, _note and every other key starting with _) is for people and build chats; no page file
// reads it, so it stays out of spec.json.
const withoutProse = o =>
  Array.isArray(o)
    ? o.map(withoutProse)
    : o && typeof o === 'object'
      ? Object.fromEntries(
          Object.entries(o)
            .filter(([k]) => !k.startsWith('_'))
            .map(([k, v]) => [k, withoutProse(v)])
        )
      : o;
/** What spec.json holds for one target's page: PAGE_SPEC_KEYS, each made here. */
export function pageSpecFor(spec, schemas, { target, release }) {
  const pageWrites = Object.entries(spec.collections)
    .filter(([c, x]) => !c.startsWith('_') && x && (x.writers || []).includes('page'))
    .map(([c]) => c);
  const worker = (spec.tasks[target] || {}).worker;
  const make = {
    release: () => release,
    target: () => target,
    specVersion: () => spec.specVersion,
    constants: () => spec.constants,
    courses: () => spec.courses,
    study: () => spec.study,
    items: () => spec.items || null,
    workouts: () => spec.workouts || null,
    // A job kind by its label: each kind's guide is the worker's, read in its run (core/steps.mjs), not the page's.
    jobs: () => ({
      kinds: Object.fromEntries(Object.entries(spec.jobs.kinds || {}).map(([k, x]) => [k, { label: x.label }])),
      builderKinds: spec.jobs.builderKinds || [],
    }),
    persona: () => spec.persona || null,
    // ui.tenets is the look pass's (test/harness/look.cjs reads it from the spec), not the page's.
    ui: () => Object.fromEntries(Object.entries(spec.ui).filter(([k]) => k !== 'tenets')),
    pipelines: () =>
      Object.fromEntries(
        Object.entries(spec.pipelines)
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, p]) => [k, { lane: p.lane, purpose: p.purpose, steps: p.steps ? p.steps.length : null }])
      ),
    // The Study Watch reader by the host the page calls (the rest of its row is the Mac's).
    reader: () => {
      const r = (spec.registry.studyWatch || {}).reader;
      return r ? { name: r.name, host: r.host, tools: r.tools } : null;
    },
    // When each runs live (no task ids); a pipeline with no live task (the restore drill, which drills into staging)
    // shows its staging task's schedule.
    schedules: () =>
      Object.fromEntries([
        ...Object.values(spec.tasks.staging || {})
          .filter(t => t && t.pipeline && t.schedule)
          .map(t => [t.pipeline, t.schedule]),
        ...Object.values(spec.tasks.live || {})
          .filter(t => t && t.pipeline)
          .map(t => [t.pipeline, t.schedule || null]),
      ]),
    // The page validates what it writes: the schemas of the collections it writes, without their notes.
    schemas: () => Object.fromEntries(pageWrites.filter(c => schemas[c]).map(c => [c, schemaForPage(schemas[c])])),
    worker: () => (worker && worker.trigger ? { trigger: worker.trigger } : null),
  };
  const missing = PAGE_SPEC_KEYS.filter(k => !make[k]);
  if (missing.length || Object.keys(make).length !== PAGE_SPEC_KEYS.length)
    throw new Error(`PAGE_SPEC_KEYS and pageSpecFor disagree: ${missing.join(', ') || 'an extra maker'}`);
  return Object.fromEntries(PAGE_SPEC_KEYS.map(k => [k, k === 'schemas' ? make[k]() : withoutProse(make[k]())]));
}

/** The modules evcore.mjs imports (one factory each, no imports of their own) and evcore without those lines. */
export function coreParts(root, core) {
  const parts = [];
  const rest = core.replace(/^import \{ (\w+) \} from '\.\/([\w-]+\.mjs)';\n/gm, (_, name, file) => {
    const text = fs.readFileSync(path.join(root, 'core', file), 'utf8');
    if (/^import /m.test(text)) throw new Error(`core/${file} must not import: it runs in the page as written`);
    if (!new RegExp(`^export function ${name}\\(`, 'm').test(text))
      throw new Error(`core/${file} has no export function ${name}`);
    if ((text.match(/^export /gm) || []).length !== 1) throw new Error(`core/${file} exports more than ${name}`);
    parts.push(`// ---- core/${file}\n` + text.replace(/^export function /m, 'function '));
    return '';
  });
  if (/^import /m.test(rest)) throw new Error('core/evcore.mjs imports something other than a core factory');
  return { core: rest, parts: parts.join('\n') + (parts.length ? '\n' : '') };
}

/**
 * The page as a shell plus published files (Operational architecture, "Page delivery"), once per target:
 * {live: {'index.html': text, 'core.js', 'spec.json', 'app.js', 'styles.css'}, staging: {...}}, the shell first.
 * core.js is evcore.mjs with its export made a global, then validate.mjs the same way: the same rules the pipelines
 * run. spec.json is what the page needs of the spec for its own target only; the build refuses a page that names
 * the other target's tasks or record (the v3 staging check, kept). null when the repository has no shell yet.
 */
export function buildPages({ root, spec, schemas, release }) {
  const ui = spec.ui && spec.ui.page;
  const shellFile = path.join(root, 'page', 'index.src.html');
  if (!ui || !fs.existsSync(shellFile)) return null;
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const core0 = read('core/evcore.mjs');
  if (!/export default EVCore;\s*$/.test(core0))
    throw new Error('core/evcore.mjs must end with export default EVCore;');
  // B-155..B-160 (D-166): core's sections that live in their own files. evcore.mjs imports each one's factory; core.js
  // holds each file as written, without its export, ahead of E.V. core, and E.V. core without its imports.
  const { core, parts } = coreParts(root, core0);
  const validate = read('core/validate.mjs');
  if (/^import /m.test(validate)) throw new Error('core/validate.mjs must not import: it runs in the page as written');
  const names = [...validate.matchAll(/^export function (\w+)/gm)].map(m => m[1]);
  // core/motion.mjs (B-76): core v2's springs, speech envelope and gesture blend, as window.EVMotion.
  const motion = read('core/motion.mjs');
  if (/^import /m.test(motion)) throw new Error('core/motion.mjs must not import: it runs in the page as written');
  const motionNames = [...motion.matchAll(/^export (?:function|const) (\w+)/gm)].map(m => m[1]);
  // core/study.mjs (B-68): the review schedulers, as window.EVStudy; its functions take E.V. core as an argument.
  const study = read('core/study.mjs');
  if (/^import /m.test(study)) throw new Error('core/study.mjs must not import: it runs in the page as written');
  const studyNames = [...study.matchAll(/^export (?:function|const) (\w+)/gm)].map(m => m[1]);
  if (!core.includes(RELEASE_SLOT)) throw new Error(`core/evcore.mjs has no ${RELEASE_SLOT} for the release`);
  const coreJs =
    parts +
    core.replaceAll(RELEASE_SLOT, release).replace(/export default EVCore;\s*$/, 'window.EVCore = EVCore;\n') +
    '\n// ---- core/validate.mjs\n(function () {\n' +
    validate.replace(/^export function /gm, 'function ') +
    '\nwindow.EVValidate = { ' +
    names.join(', ') +
    ' };\n})();\n' +
    '\n// ---- core/motion.mjs\n(function () {\n' +
    motion.replace(/^export (function|const) /gm, '$1 ') +
    '\nwindow.EVMotion = { ' +
    motionNames.join(', ') +
    ' };\n})();\n' +
    '\n// ---- core/study.mjs\n(function () {\n' +
    study.replace(/^export (function|const) /gm, '$1 ') +
    '\nwindow.EVStudy = { ' +
    studyNames.join(', ') +
    ' };\n})();\n';
  // B-149: core and the page carry no release of their own; the build writes the one release into both.
  const app0 = appSource(root);
  if (!app0.includes(RELEASE_SLOT)) throw new Error(`page/app has no ${RELEASE_SLOT} for the release`);
  const app = app0.replaceAll(RELEASE_SLOT, release);
  const out = {};
  for (const target of ['live', 'staging']) {
    const other = target === 'live' ? 'staging' : 'live';
    const rec = spec.registry.records[target] || {};
    const pageSpec = pageSpecFor(spec, schemas, { target, release });
    const specJson = JSON.stringify(pageSpec);
    const foreign = [
      ...Object.values(spec.tasks[other] || {})
        .map(t => t && t.trigger)
        .filter(Boolean),
      (spec.registry.records[other] || {}).artifact,
    ].filter(Boolean);
    const leak = foreign.find(id => specJson.includes(id));
    if (leak) throw new Error(`the ${target} page would name ${other}'s ${leak}`);
    const shell = read('page/index.src.html')
      .replaceAll('{{TITLE}}', rec.name || 'E.V. Home')
      .replaceAll('{{RELEASE}}', release)
      .replaceAll('{{TARGET}}', target);
    if (/\{\{\w+\}\}/.test(shell))
      throw new Error(
        'page/index.src.html has a placeholder the build does not fill: ' + shell.match(/\{\{\w+\}\}/)[0]
      );
    if (Buffer.byteLength(shell) > ui.shellBudgetBytes)
      throw new Error(`the shell is ${Buffer.byteLength(shell)} bytes, over its ${ui.shellBudgetBytes}-byte budget`);
    out[target] = {
      [ui.shell]: shell,
      'core.js': coreJs,
      'spec.json': specJson,
      'app.js': app,
      'styles.css': read('page/styles.css'),
    };
    const want = [ui.shell, ...ui.files].sort().join();
    if (Object.keys(out[target]).sort().join() !== want)
      throw new Error('spec.ui.page lists ' + want + '; the build makes ' + Object.keys(out[target]).sort().join());
  }
  return out;
}

export async function build({
  root = HERE,
  out = path.join(root, 'dist'),
  now = new Date().toISOString(),
  release: releaseOverride = null,
} = {}) {
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'ev.spec.json'), 'utf8'));
  const schemas = loadSchemas(root);
  const problems = registryProblems(spec, schemas);
  if (problems.length) throw new Error('the spec and the schema registry disagree:\n  ' + problems.join('\n  '));
  const validate = makeValidator(schemas);
  // B-149 (D-173): the release comes from the tag, through the build's own commit (so a bookkeeping commit never moves
  // it); a run that builds its checkout to compare passes the deployed release instead (its clone has no tags).
  const g0 = gitState(root);
  const release = releaseOverride || releaseOf(root, g0.commit) || `v${spec.specVersion}.0+untagged`;
  // B-42 (D-099): the course table is sound, and the repository's own record names only its courses.
  const { courseProblems, unknownCourses } = await import(pathToFileURL(path.join(root, 'core', 'lint.mjs')).href);
  const cp = courseProblems(spec);
  if (cp.length) throw new Error('spec.courses:\n  ' + cp.join('\n  '));
  {
    const EVm = (await import(pathToFileURL(path.join(root, 'core', 'evcore.mjs')).href)).default;
    EVm.configure(spec);
    const rec = path.join(root, 'test', 'data', 'record'),
      db = {};
    for (const col of ['exams', 'materials']) {
      const d = path.join(rec, col);
      db[col] = fs.existsSync(d)
        ? fs
            .readdirSync(d)
            .filter(f => f.endsWith('.json'))
            .map(f => ({ id: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) }))
        : [];
    }
    const bad = unknownCourses(db);
    if (bad.length)
      throw new Error(
        'test/data/record names courses spec.courses does not: ' + bad.map(b => `${b.ref} (${b.course})`).join(', ')
      );
  }

  const g = g0;
  const files = {};
  for (const f of g.files.filter(f => HASHED.some(re => re.test(f))).sort())
    files[f] = sha256(fs.readFileSync(path.join(root, f)));
  const pageOut = buildPages({ root, spec, schemas, release });
  const page = target => ({
    artifact: (spec.registry.records[target] || {}).artifact || null,
    files: pageOut
      ? Object.fromEntries(
          Object.entries(pageOut[target]).map(([f, body]) => ['page/' + target + '/' + f, sha256(body)])
        )
      : {},
    capabilities: pageOut ? spec.ui.page.capabilities : null,
  });
  const tasks = taskEntries(spec, release);
  const prompts = await promptHashes(root, spec, release, tasks);
  const records = Object.fromEntries(
    ['live', 'staging'].map(t => [
      t,
      { artifact: (spec.registry.records[t] || {}).artifact || null, systemDocs: SYSTEM_DOCS },
    ])
  );
  const manifest = {
    release,
    commit: g.commit,
    dirty: g.dirty,
    builtAt: now,
    specVersion: spec.specVersion,
    files,
    pages: { live: page('live'), staging: page('staging') },
    tasks,
    records,
  };

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
    // B-150 (D-183): a deploy never writes a system document past its budget; the warning line is verify-deploy's.
    const z = systemSize(id, doc, (spec.capacity || {}).system);
    if (z.level === 'fail') throw new Error(`${z.line}: trim the spec (B-161 publishes the page only its subset)`);
  }

  fs.mkdirSync(path.join(out, 'system'), { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  for (const [key, doc] of Object.entries(docs))
    fs.writeFileSync(path.join(out, key + '.json'), JSON.stringify(doc, null, 1));
  fs.rmSync(path.join(out, 'page'), { recursive: true, force: true });
  if (pageOut)
    for (const [target, files] of Object.entries(pageOut)) {
      fs.mkdirSync(path.join(out, 'page', target), { recursive: true });
      for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(out, 'page', target, f), body);
    }
  fs.rmSync(path.join(out, 'prompts'), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'prompts'), { recursive: true });
  for (const [key, text] of Object.entries(prompts)) fs.writeFileSync(path.join(out, 'prompts', key + '.txt'), text);
  return { manifest, changes: g.changes, out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = n => {
    const i = process.argv.indexOf('--' + n);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  try {
    const { manifest, changes, out } = await build({
      root: arg('root') ? path.resolve(arg('root')) : HERE,
      out: arg('out') ? path.resolve(arg('out')) : undefined,
      now: arg('now'),
      release: arg('release') || null,
    });
    console.log(
      `E.V. ${manifest.release} at ${manifest.commit.slice(0, 12)}: ${Object.keys(manifest.files).length} files hashed, ${Object.keys(manifest.tasks).length} tasks -> ${path.relative(process.cwd(), out) || out}`
    );
    if (manifest.dirty)
      console.log(
        `dirty: true (${changes.length} uncommitted change${changes.length === 1 ? '' : 's'}); deploy will refuse this build`
      );
  } catch (e) {
    console.error('build failed: ' + e.message);
    process.exit(1);
  }
}
