#!/usr/bin/env node
// E.V. v4 build (Operational architecture, "Release: manifest, deploy, verify"). Writes dist/:
//   manifest.json            release, commit, dirty, builtAt, file hashes, pages, tasks (prompt hashes), records
//   prompts/<task key>.txt   each task's prompt, as tools/prompts.mjs renders it
//   system/manifest.json     the record copy of the manifest (envelope added); deploy refuses it when dirty
//   system/spec.json         the spec as the record holds it
//   system/environments.json spec.environments as the record holds it
// Fails, writing nothing, when the spec and the schema registry disagree or a system document does not validate.
// Usage: node tools/build.mjs [--root <repo>] [--out <dir>] [--now <ISO>]
import { carry } from './carry.mjs';
import { gateHover } from './hover-gate.mjs'; // B-552
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeValidator, validateAgainst, describeErrors } from '../core/validate.mjs';
import { systemSize } from '../core/deploy.mjs';
import { rowProblem } from '../core/actions.mjs';
import { hisFields } from '../core/his.mjs';

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
// B-506 (D-371), D-388: the Gallery's parts, published on staging only: live's app.js and styles.css never carry them.
// A rule, not a list: page/app/89-gallery.js and each component's page/app/89-gallery-NN-<name>.js, and gallery.css.
export const STAGING_ONLY = [/^page\/app\/89-gallery[\w-]*\.js$/, /^page\/ds\/gallery\.css$/];
export const stagingOnly = p => STAGING_ONLY.some(re => re.test(p));
// D-392 to D-395: the passed UI polish design (docs/design/ui-polish/), copied into the staging app at /reference so Matt
// and the builders can open it; live's app never carries it (tools/build-pwa.mjs). It stays inert (B-425): an edit of it
// alone keeps the build commit and reaches staging with the next build.
export const STAGING_REFERENCE = { from: 'docs/design/ui-polish', at: 'reference' };
export function appSource(root = HERE, target = 'staging') {
  const dir = path.join(root, 'page', 'app');
  if (!fs.existsSync(dir)) throw new Error('no page/app/: the page logic lives there as parts (B-64)');
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .filter(f => target === 'staging' || !stagingOnly('page/app/' + f))
    .sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('');
}
/**
 * B-505 (D-373), D-388: the published styles.css. The layer order first, then each of Proprietary's files wrapped in
 * its own layer block under its `/* ---- path *\/` header: tokens, then the components, patterns and views layers, each
 * read from its folder (page/ds/components/, page/ds/patterns/, page/ds/views/) in name order, the Gallery's
 * stylesheet; page/ds/views/legacy-carry.css opens views (B-515 D2c: what was left of the old page/styles.css, once the
 * legacy layer, built through tools/carry.mjs so it still wins as legacy did; consolidation retires it). No file declares its own layer. A folder not there yet adds nothing.
 */
export const LAYER_ORDER = '@layer reset, tokens, base, components, patterns, views;';
// [layer, file or folder/]: a folder is read in name order, its *.css files each one block of that layer.
export const CARRY = 'page/ds/views/legacy-carry.css';
export const STYLE_LAYERS = [
  ['tokens', 'page/ds/tokens.css'],
  ['base', 'page/ds/base.css'],
  ['components', 'page/ds/components/'],
  ['patterns', 'page/ds/patterns/'],
  // B-515 D2c: what is left of the old page/styles.css, first in views, its legacy precedence kept (tools/carry.mjs).
  ['views', CARRY],
  ['views', 'page/ds/views/'],
  ['views', 'page/ds/gallery.css'],
];
/** The stylesheet's parts in order, [layer, path], for a target: folders expanded, missing ones and live's skips out. */
export function styleParts(root = HERE, target = 'staging') {
  const out = [];
  for (const [layer, f] of STYLE_LAYERS) {
    if (f.endsWith('/')) {
      const dir = path.join(root, f);
      if (!fs.existsSync(dir)) continue;
      for (const n of fs
        .readdirSync(dir)
        .filter(x => x.endsWith('.css') && !(f + x === CARRY))
        .sort())
        out.push([layer, f + n]);
    } else if (layer === 'tokens' || layer === 'base' || fs.existsSync(path.join(root, f))) out.push([layer, f]);
  }
  return out.filter(([, f]) => target === 'staging' || !stagingOnly(f));
}
/** B-515 D2c: every source stylesheet joined in published order (staging's set), for the tests that read the CSS. */
export const sourceStyles = (root = HERE) =>
  styleParts(root)
    .map(([, f]) => fs.readFileSync(path.join(root, f), 'utf8'))
    .join('\n');
/** B-557: Inter from the page's own files (page/fonts/, @fontsource/inter 5.1.0, OFL), inlined in the stylesheet so
 *  it arrives with it: no Google Fonts request, nothing extra to precache, and no swap on a cold open. */
export function fontFaces(root = HERE) {
  const dir = path.join(root, 'page/fonts');
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter(f => /^inter-latin-\d00-normal\.woff2$/.test(f))
    .sort()
    .map(
      f =>
        `@font-face{font-family:Inter;font-style:normal;font-display:block;font-weight:${f.match(/\d00/)[0]};` +
        `src:url(data:font/woff2;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}) format("woff2")}`
    )
    .join('');
}
export function stylesheet(root = HERE, target = 'staging') {
  return (
    [
      "/* E.V.'s stylesheet, built by tools/build.mjs (B-505, D-373): Proprietary's layers. */",
      LAYER_ORDER,
      fontFaces(root),
      ...styleParts(root, target).map(
        ([layer, f]) =>
          `@layer ${layer}{\n/* ---- ${f} */\n${gateHover((f === CARRY ? carry : String)(fs.readFileSync(path.join(root, f), 'utf8')))}\n}`
      ),
    ].join('\n') + '\n'
  );
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
  /^tools\/chart(\/|$)/,
  /^test\/chart\.test\.mjs$/,
];
// B-425: paths no build, run, check or test reads (docs/: the hand-over, briefs, lessons and the trim maps, read only by
// people and build chats; smoke.yml skips them and tools/check.mjs runs no harness for them). A commit that touches
// only these, or these and the bookkeeping, keeps the build commit, so a docs edit never asks ship live for a new
// staging GREEN (R-02) or a new OK (R-04) on unchanged code. The personal-data test still scans them, as it scans chart/.
export const INERT = [/^docs\//];
export const INERT_PATHS = ['docs'];
const bookkeeping = f => BOOKKEEPING.some(re => re.test(f)) || INERT.some(re => re.test(f));
// The same list as pathspecs, for the log that finds the build's commit (one list, so the two never drift: B-149).
export const BOOKKEEPING_PATHS = [
  'chart',
  'BACKLOG.md',
  'DECISIONS.md',
  'CHANGELOG.md',
  'tools/chart.mjs',
  'tools/chart',
  'test/chart.test.mjs',
];

/**
 * The tree git would commit (tracked plus untracked-not-ignored), and whether it differs from HEAD. The build's
 * commit is the newest that changed anything but the bookkeeping (M12): recording a task or a deploy in chart/ never
 * moves it, so verify-deploy stays green across it, and a bookkeeping change left uncommitted is not dirt.
 */
/** The build commit of a revision: its newest commit that changed anything but the bookkeeping or the inert paths
 * (gitState; B-320: the live workflow's gate and the live copy read it from here, so they agree; B-425: a docs-only
 * commit keeps it). */
export function buildCommitOf(root, rev = 'HEAD') {
  return git(root, [
    'log',
    '-1',
    '--format=%H',
    rev,
    '--',
    '.',
    ...[...BOOKKEEPING_PATHS, ...INERT_PATHS].map(p => `:(exclude)${p}`),
  ]).trim();
}

export function gitState(root) {
  let commit = '';
  try {
    commit = buildCommitOf(root);
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
  'actions',
  'persona',
  'ui',
  'pipelines',
  'schedules',
  'schemas',
  'worker',
  'builder',
  'readOnly',
  'capacity',
];
// Notes the validator ignores (core/validate.mjs) leave the page's schemas; x-ev keeps only its documents map. A map
// of names to schemas (properties, $defs and the like) keeps every name: a field called title is not a note.
// $schema and $id too: the validator ignores both (core/validate.mjs), so the page's copies leave them out (B-197).
const NOTE_KEYS = new Set(['description', '$comment', 'title', 'examples', '$schema', '$id']);
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
  // a retired collection (idchecks, D-324) is written by no one any more, the page included
  const pageWrites = Object.entries(spec.collections)
    .filter(([c, x]) => !c.startsWith('_') && x && !x.retired && (x.writers || []).includes('page'))
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
    // B-450: the study plan's built-in instructions too, which his plan settings show, edit and reset to (D-354).
    jobs: () => ({
      kinds: Object.fromEntries(
        Object.entries(spec.jobs.kinds || {}).map(([k, x]) => [
          k,
          k === 'exam-plan' ? { label: x.label, instructions: x.instructions || '' } : { label: x.label },
        ])
      ),
      builderKinds: spec.jobs.builderKinds || [],
      builderLabels: spec.jobs.builderLabels || {},
      builderOnLive: !!spec.jobs.builderOnLive,
    }),
    // B-186 (D-203): the actions table, which the page's actor checks every call against.
    // The rows without their does line (the node side's description); _rules stay in the spec.
    actions: () =>
      Object.fromEntries(
        Object.entries(spec.actions || {})
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, row]) => [k, Object.fromEntries(Object.entries(row).filter(([f]) => f !== 'does'))])
      ),
    persona: () => spec.persona || null,
    // B-320 (D-306): the claude.ai live page after the cutover keeps the record readable and refuses every write; the
    // app on the live Worker is not read-only (the page asks its host, page/app/04-model.js). Staging never is.
    readOnly: () => target === 'live' && ((spec.registry.records || {}).live || {}).readOnly === true,
    // B-401 (D-325): the one size a page write is held to (a note over it is refused before it is sent).
    capacity: () => ({ documentBytes: (spec.capacity || {}).documentBytes || null }),
    // ui.tenets is the look pass's (test/harness/look.cjs reads it from the spec), not the page's.
    // Of ui.look.dialArc (B-276; was flower, B-515) and the retired Silk core (B-205) the page keeps only the stage sizes it lays her out by.
    ui: () =>
      Object.fromEntries(
        Object.entries(spec.ui)
          .filter(([k]) => k !== 'tenets')
          .map(([k, v]) => [
            k,
            k === 'look'
              ? {
                  ...v,
                  core: { sizes: v.core.sizes },
                  // her budget is the harness's
                  dialArc: { sizes: v.dialArc.sizes },
                }
              : v,
          ])
      ),
    pipelines: () =>
      Object.fromEntries(
        Object.entries(spec.pipelines)
          .filter(([k]) => !k.startsWith('_'))
          .map(([k, p]) => [k, { lane: p.lane, purpose: p.purpose, steps: p.steps ? p.steps.length : null }])
      ),
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
    // B-180 (D-194): the builder is one task for both pages; a build ask fires it by id.
    builder: () => {
      const b = (spec.tasks.build || {})['ev4-builder'];
      return b && b.trigger ? { trigger: b.trigger } : null;
    },
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
/**
 * B-472 (D-367): the one-time frozen claude.ai page. The app (the PWA) is E.V.'s one view; this shell replaces the
 * claude.ai page once (ship <target> --freeze-page prints that publish) with one calm line and the app's address
 * when spec.registry names one. It is not hashed and ship never publishes it on its own.
 */
export function frozenPage(spec, target, release) {
  const rec = ((spec.registry || {}).records || {})[target] || {};
  const url = rec.app && typeof rec.app.url === 'string' && /^https:\/\//.test(rec.app.url) ? rec.app.url : null;
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="ev-release" content="${esc(release)}">
<meta name="ev-frozen" content="D-367">
<title>E.V. Home</title>
<style>
:root { --bg: #fbfbfa; --fg: #1f2023; --muted: #6b6f76; --link: #4f5bd5; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #141518; --fg: #e6e6e8; --muted: #9a9ea6; --link: #8f9bff; } }
:root[data-theme="dark"] { --bg: #141518; --fg: #e6e6e8; --muted: #9a9ea6; --link: #8f9bff; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body { font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; display: grid; place-items: center; min-height: 100vh; padding: 0 16px; box-sizing: border-box; }
main { max-width: 32rem; text-align: center; }
p { margin: 0 0 8px; }
.muted { color: var(--muted); font-size: 14px; }
a { color: var(--link); }
</style>
</head>
<body>
<main>
<p>E.V. now lives in the app. This page is no longer updated.</p>
${url ? `<p class="muted"><a href="${esc(url)}">${esc(url.replace(/^https:\/\//, ''))}</a></p>\n` : ''}</main>
</body>
</html>
`;
}

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
  // core/actions.mjs (B-186, D-203): act and its actors, as window.EVActions, over the validator above.
  const actions = read('core/actions.mjs');
  if (/^import /m.test(actions)) throw new Error('core/actions.mjs must not import: it runs in the page as written');
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
    ' };\n})();\n' +
    '\n// ---- core/actions.mjs\n(function () {\n' +
    actions.replace(/^export (function|const) /gm, '$1 ') +
    '\nif (window.EVValidate) window.EVActions = makeActions(window.EVValidate.validateAgainst, window.EVCore);\n})();\n';
  // B-149: core and the page carry no release of their own; the build writes the one release into both.
  const app0 = appSource(root);
  if (!app0.includes(RELEASE_SLOT)) throw new Error(`page/app has no ${RELEASE_SLOT} for the release`);
  const appFor = target => appSource(root, target).replaceAll(RELEASE_SLOT, release);
  // Inlined without its comments and indentation, to keep the shell inside its budget; the lines stay as written.
  const theme = read('page/theme.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//'))
    .join('\n');
  if (/<\/script|\{\{/i.test(theme))
    throw new Error('page/theme.js cannot hold a closing script tag or a {{ placeholder');
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
      .replaceAll('{{TARGET}}', target)
      // B-271 (D-268): the theme generator, run in the head before first paint.
      .replace('{{THEME}}', () => theme);
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
      'app.js': appFor(target),
      // B-501 (D-372), B-505 (D-373): Proprietary's layers and today's stylesheet in legacy, in one published file;
      // B-506: the Gallery's parts on staging only.
      'styles.css': stylesheet(root, target),
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
  // B-229 (D-233): every actions row in its shape, and none with a tool, worker or builder caller writes his words.
  const his = hisFields(spec);
  const rowBad = Object.entries(spec.actions || {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, row]) => rowProblem(k, row, his))
    .filter(Boolean);
  if (rowBad.length) throw new Error('the actions table refuses its own rows:\n  ' + rowBad.join('\n  '));
  const validate = makeValidator(schemas);
  // B-149 (D-173): the release comes from the tag, through the build's own commit (so a bookkeeping commit never moves
  // it); a run that builds its checkout to compare passes the deployed release instead (its clone has no tags).
  const g0 = gitState(root);
  const release = releaseOverride || releaseOf(root, g0.commit) || `v${spec.specVersion}.0+untagged`;
  // B-42 (D-099): the course table is sound, and the repository's own record names only its courses.
  const { courseProblems, unknownCourses } = await import(pathToFileURL(path.join(root, 'core', 'lint.mjs')).href);
  const cp = courseProblems(spec);
  if (cp.length) throw new Error('spec.courses:\n  ' + cp.join('\n  '));
  // B-231 (D-241): every typed link names a collection and a field the schemas have, and a target that exists.
  const { linkProblems } = await import(pathToFileURL(path.join(root, 'core', 'links.mjs')).href);
  const lp = linkProblems(spec, schemas);
  if (lp.length) throw new Error('spec.links:\n  ' + lp.join('\n  '));
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
  const envelope = { schema: 2, writer: 'deploy', at: now, source: `deploy ${release}` }; // B-178: system schema 2
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
  // B-472 (D-367): the frozen page, beside the page and outside it (nothing hashes or ships it).
  fs.rmSync(path.join(out, 'frozen'), { recursive: true, force: true });
  for (const target of ['live', 'staging']) {
    fs.mkdirSync(path.join(out, 'frozen', target), { recursive: true });
    fs.writeFileSync(path.join(out, 'frozen', target, 'index.html'), frozenPage(spec, target, release));
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
