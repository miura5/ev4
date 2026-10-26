// B-320: D-307's lint (tenet, data; checked by lint). D1 is E.V.'s only live record: no code reads or writes both D1
// and a claude.ai artifact database for one record, and nothing syncs them. The rule is on for a record once the spec
// marks it on D1 (spec.registry.records.<r>.d1, which the cutover commit sets for live: tools/pwa-live.mjs cutover).
// For such a record:
//   1. every scheduled task of the record runs on the Worker (core/run.mjs runTarget): B-315's per-record ArtifactData
//      target is gone for it;
//   2. its claude.ai page is read-only (records.<r>.readOnly, D-306): the page writes nothing there;
// and, while any record is on D1:
//   3. no module names both ArtifactData and the Worker's run API, outside the exemptions below, each with its reason.
// test/d307.test.mjs runs it in npm test, on the spec as it is and on the cutover's spec.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTarget } from '../core/run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Modules that may name both stores, and why. A new one is a decision, not an edit here. */
export const EXEMPT = {
  'tools/pwa-copy.mjs':
    "B-319 (D-307's own exemption): the one-way, one-time copy reads the artifact's database and writes an empty D1; it never writes the artifact and never syncs",
  'core/run.mjs':
    'the one run engine: each run of a record and pipeline uses one store (runTarget), and rule 1 holds every task of a D1 record to the Worker',
  'tools/prompts.mjs':
    "the prompts' text: ArtifactData names the deploy's system documents and system/worker (the Worker's address and token, D-320), not the record; a D1 record's runs write only the Worker (rule 1)",
  'core/cli.mjs':
    'one store per command: migrate plans ArtifactData batches for an artifact record, api talks to a Worker record',
  'tools/d307.mjs': 'the rule itself names both stores to find them',
};
/** Where modules are read: the code that runs (tests and the page's own record calls are not modules of either). */
export const DIRS = ['core', 'tools', 'tools/chart', 'pwa'];
const RUN_API = /runapi|\/api\/run\b|apiBatch|\bapi batch\b|WORKER_FILE|core\/cli\.mjs api\b/;

/** Code without its comments (block and line; a // inside a string or a URL stays). */
export function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/(^|[^:"'`\\])\/\/.*$/, '$1'))
    .join('\n');
}

/** Every module under DIRS: {repo path: text}; tests left out. */
export function sourcesOf(root = ROOT) {
  const out = {};
  for (const d of DIRS) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort())
      if (/\.(mjs|js)$/.test(f) && !/\.test\.mjs$/.test(f))
        out[`${d}/${f}`] = fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return out;
}

/** The records on D1. */
export const d1Records = spec =>
  Object.entries((spec.registry || {}).records || {})
    .filter(([, r]) => r && r.d1 === true)
    .map(([k]) => k);

/** Each finding as one line; empty when D-307 holds (or no record is on D1 yet). */
export function d307Findings(spec, sources = {}, { exempt = EXEMPT } = {}) {
  const out = [];
  const recs = d1Records(spec);
  for (const r of recs) {
    for (const [k, t] of Object.entries((spec.tasks || {})[r] || {}))
      if (t && t.pipeline && runTarget(spec, r, t.pipeline) !== 'worker')
        out.push(
          `${r}.${k}: runs on ArtifactData though ${r} is on D1 (B-315's per-record target; add it to records.${r}.runs)`
        );
    if (spec.registry.records[r].readOnly !== true)
      out.push(`${r}: its claude.ai page still writes (records.${r}.readOnly is not true, D-306)`);
  }
  if (recs.length)
    for (const [f, src] of Object.entries(sources)) {
      if (Object.hasOwn(exempt, f)) continue;
      const code = stripComments(src);
      if (/\bArtifactData\b/.test(code) && RUN_API.test(code))
        out.push(`${f}: names both ArtifactData and the Worker's run API (D-307), with no exemption in tools/d307.mjs`);
    }
  return out;
}
