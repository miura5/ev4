#!/usr/bin/env node
// B-320 (D-330, D-331): the live app's tools. The live Worker (ev-live, over the ev-live D1) is deployed only by
// .github/workflows/pwa-live.yml, in the GitHub environment "live", whose required reviewer is Matt; a build session
// dispatches it only under dist/live-ok for that commit (tools/hooks.mjs live-guard). Nothing here deploys, writes the
// live record or prints a token.
//   node tools/pwa-live.mjs gate <commit>          in the workflow's gate job (GH_TOKEN set): refuses unless the commit
//                                                   is on main, its spec turns the live app on, origin/main's Chart
//                                                   records a GREEN staging ship at it (R-02) and a nightly full check
//                                                   passed at it (R-06), as ship live refuses
//   node tools/pwa-live.mjs check <worker url>     in the deploy job, EV_TOKEN set: 401 without the token and with a
//                                                   wrong one, 200 with it; prints the collections and counts only
//   node tools/pwa-live.mjs cutover [--apply]      the cutover commit's spec change (docs/cutover.md), printed; with
//                                                   --apply written to spec/ev.spec.json
//   node tools/pwa-live.mjs worker-doc --token-file <f> --out <f>
//                                                   the live record's system/worker document (D-320) from a token file
//                                                   outside the repository, written to the record by file_path on
//                                                   Matt's OK; prints the token's length only
//   node tools/pwa-live.mjs reach --worker <f>     read-back: the Worker's collections and counts, through the saved
//                                                   system/worker (the token to curl on stdin)
//   node tools/pwa-live.mjs run --worker <f> --id <runs id>   read-back: one runs/<id>'s status and step statuses
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCommitOf } from './build.mjs'; // one build-commit rule for the gate, ship live and the copy

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = 'miura5/ev4';

const readSpec = (root = ROOT) => JSON.parse(fs.readFileSync(path.join(root, 'spec', 'ev.spec.json'), 'utf8'));
const git = (root, a) =>
  execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The live app's settings (spec.registry.records.live.app), or null. */
export const liveApp = spec => ((spec.registry.records || {}).live || {}).app || null;

/** R-02 (D-049): a staging deploy recorded GREEN at the commit (the Chart's deploys, as origin/main holds them). */
export function stagingGreen(deploys, commit) {
  return (deploys || []).some(
    d =>
      d.target === 'staging' && d.verify === 'green' && d.commit && d.commit.length >= 7 && commit.startsWith(d.commit)
  );
}

/** R-06 (D-226): a green nightly full check whose head is this commit or builds it (its build commit, so a later
 * bookkeeping commit on main is the same build). runs: [{headSha, conclusion}]. ship live's R-06 (tools/chart.mjs
 * fullCheckRefusal) calls this too, so the workflow's gate and ship live take the same runs. */
export const NIGHTLY_RUNS = 50;
export function nightlyGreen(runs, commit, buildCommit) {
  return (runs || []).some(
    r => r.conclusion === 'success' && r.headSha && (r.headSha === commit || buildCommit(r.headSha) === commit)
  );
}

/** Every reason the workflow refuses this commit; empty when it may deploy. */
export function gateRefusals({ commit, onMain, spec, deploys, runs, buildCommit }) {
  const out = [];
  if (!/^[0-9a-f]{40}$/.test(commit || '')) return ['the commit input is not a full 40-character sha'];
  if (!onMain) out.push(`${commit.slice(0, 7)} is not on origin/main`);
  const app = liveApp(spec || {});
  if (!app || app.ready !== true)
    out.push(
      `the spec at ${commit.slice(0, 7)} does not turn the live app on (spec.registry.records.live.app.ready; docs/cutover.md)`
    );
  if (buildCommit(commit) !== commit)
    out.push(
      `${commit.slice(0, 7)} is a bookkeeping commit: name its build commit (${buildCommit(commit).slice(0, 7)})`
    );
  if (!stagingGreen(deploys, commit))
    out.push(
      `R-02 (D-049): no GREEN staging ship of ${commit.slice(0, 7)} in the Chart on origin/main: ship staging at it first`
    );
  if (!nightlyGreen(runs, commit, buildCommit))
    out.push(
      `R-06 (D-226): no green nightly full check at ${commit.slice(0, 7)}: gh workflow run nightly.yml --ref main while main's head builds it, wait for it green, then dispatch again (docs/cutover.md step 2)`
    );
  return out;
}

function gate(commit, root = ROOT) {
  git(root, ['fetch', '-q', 'origin', 'main']);
  let onMain = false;
  try {
    git(root, ['merge-base', '--is-ancestor', commit, 'origin/main']);
    onMain = true;
  } catch {
    /* not on main, or not a commit */
  }
  let spec = null;
  try {
    spec = JSON.parse(git(root, ['show', `${commit}:spec/ev.spec.json`]));
  } catch {
    /* no spec at that commit */
  }
  const deploys = JSON.parse(git(root, ['show', 'origin/main:chart/deploys.json']));
  const runs = JSON.parse(
    execFileSync(
      'gh',
      [
        'run',
        'list',
        '--repo',
        process.env.GITHUB_REPOSITORY || REPO,
        '--workflow',
        'nightly.yml',
        '--limit',
        String(NIGHTLY_RUNS),
        '--json',
        'headSha,conclusion,databaseId',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }
    )
  );
  const memo = new Map();
  const buildCommit = rev => {
    if (!memo.has(rev))
      try {
        memo.set(rev, buildCommitOf(root, rev));
      } catch {
        memo.set(rev, null);
      }
    return memo.get(rev);
  };
  return gateRefusals({ commit, onMain, spec, deploys, runs, buildCommit });
}

/** The live Worker's checks, as [{ok, what}]: 401 without the token and with a wrong one; 200 with it on the run
 * API's collections, whose names and counts are printed (no document). */
export async function check(base, token, { f = fetch } = {}) {
  const url = base.replace(/\/+$/, '') + '/api/run/collections';
  const lines = [];
  const add = (ok, what) => lines.push({ ok, what });
  const st = async t => (await f(url, t == null ? {} : { headers: { authorization: 'Bearer ' + t } })).status;
  const none = await st(null);
  add(none === 401, `no token: ${none}${none === 401 ? '' : ', expected 401'}`);
  const wrong = await st(token + '-wrong');
  add(wrong === 401, `a wrong token: ${wrong}${wrong === 401 ? '' : ', expected 401'}`);
  const r = await f(url, { headers: { authorization: 'Bearer ' + token } });
  if (r.status !== 200) {
    add(false, `the token: ${r.status}, expected 200`);
    return lines;
  }
  const cols = ((await r.json()).collections || []).map(c => `${c.collection} ${c.count}`);
  add(true, `the token: 200; ${cols.length} collections${cols.length ? ': ' + cols.join(', ') : ' (an empty D1)'}`);
  return lines;
}

/**
 * The cutover commit's spec (D-306, D-307, D-331): a copy of spec with the live page read-only, live on D1, the staged
 * runs moved to records.live.runs, live evening-mac re-pointed at the backup folder with no trigger (re-created at the
 * Mac) and its old trigger listed retired, and the staged live tasks added. Refuses a spec already cut over.
 */
export function cutoverSpec(spec, { at = 'the cutover' } = {}) {
  const s = JSON.parse(JSON.stringify(spec));
  const live = s.registry.records.live;
  const c = live.cutover;
  if (!c || !c.runs) throw new Error('no staged cutover in spec.registry.records.live.cutover (already cut over?)');
  if (live.runs) throw new Error('spec.registry.records.live.runs is already set');
  if (!live.app || live.app.ready !== true)
    throw new Error(
      'the live app is not on (spec.registry.records.live.app.ready): docs/cutover.md step 3 comes first'
    );
  live.readOnly = true;
  live.d1 = true;
  live.runs = c.runs;
  const folder = c.runs.backup.folder;
  const em = s.tasks.live['evening-mac'];
  if (em.trigger)
    s.tasks.retired.push({
      trigger: em.trigger,
      was: 'live.evening-mac',
      name: 'E.V. evening-mac',
      reason: `B-320 (D-303, D-322): replaced at ${at} by the live evening-mac on the ev-live Worker, writing E.V. Backups; disabled (update_trigger enabled false) once its replacement exists, from the chat linked to the Mac with Matt present. Kept, never deleted.`,
    });
  s.tasks.live['evening-mac'] = { ...em, folders: [folder], trigger: null };
  for (const [k, t] of Object.entries(c.tasks || {})) s.tasks.live[k] = t;
  live.cutover = {
    _why: `B-320: applied at ${at} (tools/pwa-live.mjs cutover --apply): readOnly, d1, runs and the live Mac tasks above.`,
  };
  return s;
}

/** reach's line: the Worker and its collections with their counts (no document, no token). */
export const runLine = (url, cols) =>
  `${url}: ${cols.length} collections${cols.length ? ': ' + cols.map(c => `${c.collection} ${c.count}`).join(', ') : ' (an empty D1)'}`;
/** run's line: a runs/<id> document's pipeline, status, times and each step's status (no step's content). */
export const runSummary = (id, d) =>
  `runs/${id}: ${d.writer || d.pipeline || '?'} ${d.status || '?'} (${d.startedAt || '?'} to ${d.endedAt || 'not ended'}); steps: ${(
    d.steps || []
  )
    .map(x => `${x.id} ${x.status}`)
    .join(', ')}`;

/** The live record's system/worker (D-320): the Worker's address from the spec and the token from a file. */
export function workerDoc(spec, token, { at = new Date().toISOString() } = {}) {
  const app = liveApp(spec);
  if (!app || !/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(app.url || ''))
    throw new Error('spec.registry.records.live.app.url is not an https workers.dev address');
  if (typeof token !== 'string' || !/^[\x21-\x7e]{32,}$/.test(token) || /["\\]/.test(token))
    throw new Error('the token file holds no usable token (32 or more printable characters, no quote or backslash)');
  return { schema: 2, writer: 'deploy', at, source: 'B-320 cutover (D-320)', url: app.url, token };
}

async function main(argv) {
  const [cmd, a1] = argv;
  const opt = k => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  if (cmd === 'gate') {
    const why = gate(a1 || '');
    for (const w of why) console.log(`::error title=app live::${w}`);
    console.log(`pwa-live gate ${String(a1).slice(0, 7)}: ${why.length ? 'REFUSED\n  ' + why.join('\n  ') : 'GREEN'}`);
    return why.length ? 1 : 0;
  }
  if (cmd === 'check') {
    if (!/^https:\/\//.test(a1 || '')) throw new Error('usage: check https://<the live Worker>');
    if (!process.env.EV_TOKEN) throw new Error('EV_TOKEN is not set');
    const want = liveApp(readSpec()).url;
    const lines = [
      { ok: a1.replace(/\/+$/, '') === want, what: `the Worker is ${want}` },
      ...(await check(a1, process.env.EV_TOKEN)),
    ];
    for (const l of lines) console.log(`${l.ok ? 'ok ' : 'NO '} ${l.what}`);
    const green = lines.every(l => l.ok);
    console.log(`pwa-live check: ${green ? 'GREEN' : 'RED'}`);
    return green ? 0 : 1;
  }
  if (cmd === 'cutover') {
    const before = readSpec();
    const after = cutoverSpec(before, { at: opt('--at') || 'the cutover' });
    const live = after.registry.records.live;
    console.log(
      [
        'the cutover spec:',
        '  registry.records.live.readOnly true (the claude.ai live page refuses writes, D-306)',
        '  registry.records.live.d1 true (D-307 lint on for live)',
        `  registry.records.live.runs: ${live.runs.pipelines.join(', ')} on the Worker`,
        `  tasks.live: ${Object.entries(after.tasks.live)
          .filter(([, t]) => t.macBound)
          .map(([k, t]) => `${k} -> ${t.folders.join(', ')} (trigger ${t.trigger || 'to create at the Mac'})`)
          .join('; ')}`,
        `  tasks.retired: +${after.tasks.retired.length - before.tasks.retired.length}`,
      ].join('\n')
    );
    if (argv.includes('--apply')) {
      fs.writeFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), JSON.stringify(after, null, 1));
      console.log('written to spec/ev.spec.json: commit it as the cutover commit (docs/cutover.md)');
    } else console.log('a dry run: --apply writes it');
    return 0;
  }
  if (cmd === 'worker-doc') {
    const tf = opt('--token-file'),
      out = opt('--out');
    if (!tf || !out) throw new Error('usage: worker-doc --token-file <f> --out <f>');
    for (const f of [tf, out]) {
      const rel = path.relative(fs.realpathSync(ROOT), path.resolve(f));
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`${f} is inside the repository`);
    }
    const token = fs.readFileSync(tf, 'utf8').trim();
    const doc = workerDoc(readSpec(), token);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(doc, null, 1), { mode: 0o600 });
    console.log(`system/worker for live: ${doc.url}, a token of ${token.length} characters -> ${out}`);
    return 0;
  }
  if (cmd === 'reach' || cmd === 'run') {
    // read-backs through a saved system/worker (the token goes to curl on stdin, core/runapi-client.mjs)
    const file = opt('--worker');
    if (!file) throw new Error(`usage: ${cmd} --worker <saved system/worker>${cmd === 'run' ? ' --id <runs id>' : ''}`);
    const { readWorker, request } = await import('../core/runapi-client.mjs');
    const w = readWorker(path.resolve(file));
    if (cmd === 'reach') {
      const r = request(w, { route: 'collections' });
      if (r.status !== 200) throw new Error(`${w.url}: ${r.status} ${(r.body && r.body.error) || 'refused'}`);
      console.log(runLine(w.url, r.body.collections || []));
      return 0;
    }
    const id = opt('--id');
    const r = request(w, { route: 'get', params: { collection: 'runs', doc_id: id } });
    if (r.status !== 200) throw new Error(`runs/${id}: ${r.status} ${(r.body && r.body.error) || 'refused'}`);
    console.log(runSummary(id, (r.body && r.body.data) || {}));
    return 0;
  }
  console.error(
    'usage: node tools/pwa-live.mjs gate <commit> | check <url> | cutover [--apply] | worker-doc ... | reach|run --worker <f>'
  );
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(
    c => process.exit(c),
    e => {
      console.error('pwa-live: ' + e.message);
      process.exit(1);
    }
  );
