// B-311: the check on the staging Worker (ev-staging, over the staging D1). Run by the pwa-staging workflow after each
// deploy, and by a cloud session with no token to show it reaches the Worker:
//   node tools/pwa-staging.mjs check <worker url>      EV_TOKEN in the environment: the full check
//   node tools/pwa-staging.mjs reach <worker url>      no token: only that /api/db answers 401 without one
// The full check: /api/db answers 401 with no token and with a wrong one; with the token, every document of the
// made-up record the app is seeded with (pwa/seed.mjs, from test/data/synthetic.cjs) is there, and every document the
// seed does not have came from a writer staging expects (B-389): the run API suite in its own collection, in whole
// runs (B-312); the app's job runner, by its source (B-324); a save from the staging page, by its writer; a scheduled
// run of a pipeline that runs against staging (B-315), traced to its own runs/<id> document, and that pipeline's
// writes as one of its roles (evening-mac's Canvas sync as canvas-sync), traced to its run's window and step. Each writer must be one
// the spec allows for that collection (spec.collections.<c>.writers). Anything else, or a seed document gone, is red. It prints counts, ids and statuses only: never the token, never a document.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_SOURCE } from '../pwa/jobs.mjs';
import { seedRecord } from '../pwa/seed.mjs';
import { SUITE, SUITE_DOCS_PER_RUN } from '../pwa/runapi.js';
import { makeValidator } from '../core/validate.mjs';

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
const SCHEMAS = Object.fromEntries(
  Object.entries(SPEC.collections)
    .filter(([, v]) => v.schema)
    .map(([c, v]) => [c, JSON.parse(fs.readFileSync(new URL('../' + v.schema, import.meta.url), 'utf8'))])
);
const validate = makeValidator(SCHEMAS);

/** One of the spec's id shapes (spec.collections.<c>.key, e.g. "YYYY-MM-DD", "ws-<date>-<objective>-<slug>",
 * "E1…E6", "<id-key>[-matt]") as a whole-id pattern; null for a shape no id is held to ("job sets"). */
export function keyPattern(shape) {
  if (shape === 'auto') return /^[A-Za-z0-9_.:~+@-]+$/;
  if (/\s/.test(shape.replace(/<[^>]*>/g, ''))) return null;
  const PART = '[A-Za-z0-9_.:~+@-]+';
  const DATE = '\\d{4}-\\d{2}-\\d{2}';
  let out = '';
  for (const tok of shape.match(/<[^>]*>|\[[^\]]*\]|YYYY-MM-DD|YYYYMMDD-HHMMSS|\*|…|[^<[*…Y]+|Y/g)) {
    if (tok === 'YYYY-MM-DD') out += DATE;
    else if (tok === 'YYYYMMDD-HHMMSS') out += '\\d{8}-\\d{6}';
    else if (tok === '<YYYYMMDD-HHMMSS>') out += '\\d{8}-\\d{6}';
    else if (tok.startsWith('<')) out += /^<[^>]*date>$/i.test(tok) ? DATE : PART;
    else if (tok.startsWith('[')) out += '(?:' + keyPattern(tok.slice(1, -1)).source.slice(1, -1) + ')?';
    else if (tok === '*') out += PART;
    else if (tok === '…') out = out.replace(/\d+$/, '') + '\\d+';
    else out += tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  if (shape.includes('…')) out = out.replace(/\\d\+[A-Za-z]*\d+$/, '\\d+');
  return new RegExp('^' + out + '$');
}
/** Whether an id has one of its collection's shapes in the spec, or is a document its schema names on its own
 * (x-ev.documents, as talk/memory). */
export function keyOk(c, id) {
  const key = (SPEC.collections[c] || {}).key;
  if (Object.hasOwn(SCHEMAS[c]?.['x-ev']?.documents || {}, id)) return true;
  return [].concat(key || []).some(k => {
    const re = keyPattern(k);
    return !!re && re.test(id);
  });
}

/** Each run document in a GET /api/db answer, as run id -> { pipeline, startedAt, endedAt, status, steps }: a run of a
 * staging pipeline (its writer) whose id begins with that pipeline. */
export function runsOf(docs) {
  const out = new Map();
  for (const d of docs || [])
    if (d.c === 'runs' && d.data && STAGING_PIPELINES.includes(d.data.writer) && d.id.startsWith(d.data.writer + '-'))
      out.set(d.id, {
        pipeline: d.data.writer,
        startedAt: d.data.startedAt,
        endedAt: d.data.endedAt,
        status: d.data.status,
        steps: d.data.steps,
      });
  return out;
}

/** The roles staging pipelines write as (spec.pipelines.<p>.roles: evening-mac writes Canvas's documents as
 * canvas-sync), each with the pipeline and the step that folds that role's writes: role -> [{ pipeline, step }]. */
export const ROLES = (() => {
  const out = {};
  for (const p of STAGING_PIPELINES) {
    const def = SPEC.pipelines[p] || {};
    for (const role of def.roles || []) {
      const step = (def.steps || []).find(s => s.fold === role);
      (out[role] = out[role] || []).push({ pipeline: p, step: step ? step.id : null });
    }
  }
  return out;
})();

const ms = t => (typeof t === 'string' ? Date.parse(t) : NaN);
/** Whether a document a staging pipeline wrote as one of its roles is traced to a run of that pipeline in the record:
 * its source names that run ("<pipeline> <run id>", as a step's own writes do), or its own `at` falls inside a run of
 * that pipeline whose runs/<id> document says the step that folds the role ended ok (a run still going: from its
 * start, for at most RUNNING_MAX_MS, so a run that never ended opens no endless window). A role's own source ("Canvas
 * sync") names no run, so the run's window and its step are the trace. Both times must fall in the window: the
 * document's own `at` and the row's `at` the Worker stamps on every write (rowAt, ms), when there is one. */
export const RUNNING_MAX_MS = 3 * 60 * 60 * 1000;
function roleRun(data, role, runs, rowAt) {
  const [by, runId, ...rest] = String(data.source || '').split(' ');
  const at = ms(data.at);
  const times = Number.isFinite(rowAt) ? [at, rowAt] : [at];
  const inside = (from, to) => times.every(t => from <= t && t <= to);
  for (const { pipeline, step } of ROLES[role] || []) {
    if (by === pipeline && !rest.length && runs.get(runId)?.pipeline === pipeline) return true;
    if (!Number.isFinite(at) || !step) continue;
    for (const r of runs.values()) {
      if (r.pipeline !== pipeline) continue;
      const from = ms(r.startedAt);
      if (r.status === 'running' && r.endedAt == null) {
        if (inside(from, from + RUNNING_MAX_MS)) return true;
        continue;
      }
      if (inside(from, ms(r.endedAt)) && (r.steps || []).some(s => s && s.id === step && s.status === 'ok'))
        return true;
    }
  }
  return false;
}

/** Who wrote a document not in the seed, when it is one of the writers staging expects (B-389): the run API suite in
 * its own collection; the app's job runner (B-324); a save from the staging page (of the spec's id shape and schema
 * for that collection); a scheduled run of a staging pipeline (B-315) whose source names a run of that pipeline in the
 * record (`runs`, from runsOf); or a staging pipeline writing as one of its roles (evening-mac's canvas-sync), traced
 * to its run by roleRun. The page, the runs and the roles only where the spec lets that writer write. Anything else is
 * null. */
export function knownWriter(d, runs = new Map()) {
  const data = (d && d.data) || {};
  if (d.c === SUITE) return data.writer === 'run-api-suite' ? 'suite' : null;
  if (data.source === APP_SOURCE) return 'app';
  // B-389: a page save is held to the spec, not only to its own writer field: a collection the page writes, an id of
  // that collection's shape (spec.collections.<c>.key), and a document its schema passes
  if (data.writer === 'page')
    return allows(d.c, 'page') && keyOk(d.c, d.id) && validate(d.c, data, { id: d.id }).ok ? 'page' : null;
  const w = data.writer;
  if (typeof w !== 'string' || !allows(d.c, w)) return null;
  if (!STAGING_PIPELINES.includes(w)) return Object.hasOwn(ROLES, w) && roleRun(data, w, runs, d.at) ? 'role' : null;
  if (d.c === 'runs') return runs.get(d.id)?.pipeline === w ? 'run' : null;
  const [by, runId, ...rest] = String(data.source || '').split(' ');
  return by === w && !rest.length && runs.get(runId)?.pipeline === w ? 'run' : null;
}

/** The record held against the seed, document by document: every seed document is there (the Worker never deletes),
 * and every document the seed does not have was written by a known writer, the suite's in whole runs. Returns
 * { problems: [line], seedDocs, added: { suite, app, page: { collection: n }, runs: { pipeline or role: n } } }. */
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
    else if (w === 'run' || w === 'role') added.runs[d.data.writer] = (added.runs[d.data.writer] || 0) + 1;
    else (unknown[d.c] = unknown[d.c] || []).push(d);
  }
  // Each line names up to three ids and the writer and source labels those documents carry (never a document).
  const label = v => (typeof v === 'string' ? v.slice(0, 40) : String(v));
  for (const c of Object.keys(unknown).sort()) {
    const by = [...new Set(unknown[c].map(d => `${label((d.data || {}).writer)} / ${label((d.data || {}).source)}`))];
    problems.push(
      `${c}: ${unknown[c].length} documents not in the seed and from no known writer (${unknown[c]
        .slice(0, 3)
        .map(d => d.id)
        .join(', ')}; writer / source: ${by.slice(0, 3).join('; ')})`
    );
  }
  if (added.suite % SUITE_DOCS_PER_RUN)
    problems.push(`${SUITE}: ${added.suite} documents, not a whole number of runs of ${SUITE_DOCS_PER_RUN}`);
  return { problems, seedDocs, added };
}

const status = async (url, token) =>
  (await fetch(url, token == null ? {} : { headers: { authorization: 'Bearer ' + token } })).status;

/** The checks, as [{ ok, what, problems? }]: the record's line carries its problem lines one by one. */
export async function check(base, token, { seed = null } = {}) {
  const url = base.replace(/\/+$/, '') + '/api/db';
  const lines = [];
  const add = (ok, what, problems) => lines.push({ ok, what, ...(problems ? { problems } : {}) });
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
  const when = seededAt(body);
  const { problems, seedDocs, added } = recordDiffs(body, seed || seedRecord(when));
  const as = seed ? 'the given seed' : `the seed as of ${when.toISOString()}`;
  const list = o =>
    Object.entries(o)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ') || 'none';
  const page = list(added.page);
  const runs = list(added.runs);
  add(
    problems.length === 0,
    problems.length
      ? `the record differs from ${as}: ${problems.join('; ')}`
      : `the token: all ${seedDocs} documents of ${as} there; added since: ${added.suite / SUITE_DOCS_PER_RUN} suite ` +
          `runs, ${added.app} by the app's jobs, page saves ${page}, scheduled runs and their roles ${runs}`,
    problems
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
  // The workflow's log is not readable where its annotations are: a red line, each problem on its own, as an error
  // (on the last try only, PWA_STAGING_LAST=1, so retries do not crowd them out), and the green record line as a notice.
  const esc = t => String(t).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  if (process.env.GITHUB_ACTIONS) {
    if (green) console.log(`::notice title=pwa-staging ${cmd}::${esc(lines.at(-1).what)}`);
    else if (process.env.PWA_STAGING_LAST === '1')
      for (const l of lines.filter(x => !x.ok))
        for (const p of l.problems && l.problems.length ? [l.what.split(': ')[0], ...l.problems] : [l.what])
          console.log(`::error title=pwa-staging ${cmd}::${esc(p)}`);
  }
  process.exit(green ? 0 : 1);
}
