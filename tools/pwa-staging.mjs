// B-311: the check on the staging Worker (ev-staging, over the staging D1). Run by the pwa-staging workflow after each
// deploy, and by a cloud session with no token to show it reaches the Worker:
//   node tools/pwa-staging.mjs check <worker url>      EV_TOKEN in the environment: the full check
//   node tools/pwa-staging.mjs reach <worker url>      no token: only that /api/db answers 401 without one
// The full check: /api/db answers 401 with no token and with a wrong one; with the token, every document of the
// made-up record the app is seeded with (pwa/seed.mjs, from test/data/synthetic.cjs) is there, and every document the
// seed does not have came from a writer staging expects (B-389): the run API suite in its own collection, in whole
// runs (B-312); the app's job runner, by its source (B-324); a save from the staging page, by its writer; a scheduled
// run of a pipeline that runs against staging (B-315), traced to its own runs/<id> document. Each writer must be one
// the spec allows for that collection (spec.collections.<c>.writers). Anything else, or a seed document gone, is red. It prints counts, ids and statuses only: never the token, never a document.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_SOURCE } from '../pwa/jobs.mjs';
import { seedRecord } from '../pwa/seed.mjs';
import { SUITE, SUITE_DOCS_PER_RUN } from '../pwa/runapi.js';

/** When the record was seeded: the oldest write in it, since the seed went into an empty database in one go (D1's
 * `at`, ms). The synthetic record is date-relative, so the seed is rebuilt as of that moment. Now when none is given. */
export function seededAt(body) {
  const at = ((body && body.docs) || []).map(d => d.at).filter(Number.isFinite);
  return at.length ? new Date(Math.min(...at)) : new Date();
}

const SPEC = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url), 'utf8'));
/** The pipelines whose scheduled runs write the staging record (B-315). */
export const STAGING_PIPELINES = SPEC.registry.records.staging.runs.pipelines;
const allows = (c, writer) => ((SPEC.collections[c] || {}).writers || []).includes(writer);

/** Each run document in a GET /api/db answer, as run id -> the pipeline that wrote it (its id begins with it). */
export function runsOf(docs) {
  const out = new Map();
  for (const d of docs || [])
    if (d.c === 'runs' && d.data && STAGING_PIPELINES.includes(d.data.writer) && d.id.startsWith(d.data.writer + '-'))
      out.set(d.id, d.data.writer);
  return out;
}

/** Who wrote a document not in the seed, when it is one of the writers staging expects (B-389): the run API suite in
 * its own collection; the app's job runner (B-324); a save from the staging page; or a scheduled run of a staging
 * pipeline (B-315) whose source names a run of that pipeline in the record (`runs`, from runsOf). The page and the
 * runs only where the spec lets that writer write. Anything else is null. */
export function knownWriter(d, runs = new Map()) {
  const data = (d && d.data) || {};
  if (d.c === SUITE) return data.writer === 'run-api-suite' ? 'suite' : null;
  if (data.source === APP_SOURCE) return 'app';
  if (data.writer === 'page') return allows(d.c, 'page') ? 'page' : null;
  const w = data.writer;
  if (!STAGING_PIPELINES.includes(w) || !allows(d.c, w)) return null;
  if (d.c === 'runs') return runs.get(d.id) === w ? 'run' : null;
  const [by, runId, ...rest] = String(data.source || '').split(' ');
  return by === w && !rest.length && runs.get(runId) === w ? 'run' : null;
}

/** The record held against the seed, document by document: every seed document is there (the Worker never deletes),
 * and every document the seed does not have was written by a known writer, the suite's in whole runs. Returns
 * { problems: [line], seedDocs, added: { suite, app, page: { collection: n }, runs: { pipeline: n } } }. */
export function recordDiffs(body, seed = seedRecord()) {
  const have = new Set(((body && body.docs) || []).map(d => d.c + '\u0000' + d.id));
  const problems = [];
  let seedDocs = 0;
  for (const c of Object.keys(seed).sort()) {
    const ids = Object.keys(seed[c]);
    seedDocs += ids.length;
    const gone = ids.filter(id => !have.has(c + '\u0000' + id));
    if (gone.length)
      problems.push(
        `${c}: ${gone.length} of the seed's ${ids.length} documents missing (${gone.slice(0, 3).join(', ')})`
      );
  }
  const added = { suite: 0, app: 0, page: {}, runs: {} };
  const unknown = {};
  const runs = runsOf((body && body.docs) || []);
  for (const d of (body && body.docs) || []) {
    if (seed[d.c] && Object.hasOwn(seed[d.c], d.id)) continue;
    const w = knownWriter(d, runs);
    if (w === 'suite') added.suite++;
    else if (w === 'app') added.app++;
    else if (w === 'page') added.page[d.c] = (added.page[d.c] || 0) + 1;
    else if (w === 'run') added.runs[d.data.writer] = (added.runs[d.data.writer] || 0) + 1;
    else (unknown[d.c] = unknown[d.c] || []).push(d.id);
  }
  for (const c of Object.keys(unknown).sort())
    problems.push(
      `${c}: ${unknown[c].length} documents not in the seed and from no known writer (${unknown[c].slice(0, 3).join(', ')})`
    );
  if (added.suite % SUITE_DOCS_PER_RUN)
    problems.push(`${SUITE}: ${added.suite} documents, not a whole number of runs of ${SUITE_DOCS_PER_RUN}`);
  return { problems, seedDocs, added };
}

const status = async (url, token) =>
  (await fetch(url, token == null ? {} : { headers: { authorization: 'Bearer ' + token } })).status;

/** The checks, as [{ ok, what }]. */
export async function check(base, token, { seed = null } = {}) {
  const url = base.replace(/\/+$/, '') + '/api/db';
  const lines = [];
  const add = (ok, what) => lines.push({ ok, what });
  const none = await status(url);
  add(none === 401, `no token: /api/db answers ${none}${none === 401 ? '' : ', expected 401'}`);
  if (token == null) return lines;
  const wrong = await status(url, token + '-wrong');
  add(wrong === 401, `a wrong token: /api/db answers ${wrong}${wrong === 401 ? '' : ', expected 401'}`);
  const r = await fetch(url, { headers: { authorization: 'Bearer ' + token } });
  if (r.status !== 200) {
    add(false, `the token: /api/db answers ${r.status}, expected 200`);
    return lines;
  }
  const body = await r.json();
  const { problems, seedDocs, added } = recordDiffs(body, seed || seedRecord(seededAt(body)));
  const list = o =>
    Object.entries(o)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ') || 'none';
  const page = list(added.page);
  const runs = list(added.runs);
  add(
    problems.length === 0,
    problems.length
      ? `the record differs from the seed: ${problems.join('; ')}`
      : `the token: all ${seedDocs} seed documents there; added since: ${added.suite / SUITE_DOCS_PER_RUN} suite runs, ` +
          `${added.app} by the app's jobs, page saves ${page}, scheduled runs ${runs}`
  );
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, base] = process.argv.slice(2);
  if (!['check', 'reach'].includes(cmd) || !/^https:\/\//.test(base || '')) {
    console.error('usage: node tools/pwa-staging.mjs check|reach https://<the staging Worker>');
    process.exit(2);
  }
  const token = cmd === 'check' ? process.env.EV_TOKEN : null;
  if (cmd === 'check' && !token) {
    console.error('pwa-staging check: EV_TOKEN is not set');
    process.exit(2);
  }
  const lines = await check(base, token);
  for (const l of lines) console.log(`${l.ok ? 'ok ' : 'NO '} ${l.what}`);
  const green = lines.every(l => l.ok);
  console.log(`pwa-staging ${cmd}: ${green ? 'GREEN' : 'RED'}`);
  process.exit(green ? 0 : 1);
}
