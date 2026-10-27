// B-318: the app (the Worker and its page files) in ship and verify-deploy. GitHub Actions holds the Cloudflare
// credential, so a build session never deploys the Worker itself: ship prints the workflow dispatch for the session
// to make (the way it prints ArtifactData calls), and a read through the GitHub API brings back what was deployed.
//
//   node tools/pwa-app.mjs message staging                        in the workflow, before the deploy: the line the
//                                                                  Worker version carries (wrangler deploy --message)
//   node tools/pwa-app.mjs deployed staging <worker url>          in the workflow, after it: the active version's
//                                                                  message and every served page file equal this
//                                                                  checkout's build; then the ::notice the read finds
//   node tools/pwa-app.mjs readback staging --out <file> [--wait <minutes>]
//                                                                  in a build session: the newest run of the target's
//                                                                  workflow, its steps and that notice, saved for verify
//
// The build hash is two sha256s: the Worker's source (worker.js and every module it imports) and the app's files (the
// public/ build-pwa writes for the target's record), each over "<path> <sha256>" lines, sorted. Prints hashes, run ids
// and step names only: never a token, never a document.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RELEASE, COMMIT } from './release-tag.mjs'; // B-420: the inputs the runner's release-tag step takes, whole

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = 'miura5/ev4';

/**
 * The app per target. live (B-320, D-330) is the ev-live Worker, deployed by pwa-live.yml in the GitHub environment
 * live; it is on in ship live and verify-deploy live only once spec.registry.records.live.app.ready is true (the
 * cutover sitting turns it on, docs/cutover.md), so no live release before then waits on a Worker that is not there.
 */
export function appsOf(spec) {
  const live = ((spec.registry || {}).records || {}).live || {};
  const app = live.app || {};
  return {
    staging: { worker: 'ev-staging', workflow: 'pwa-staging.yml', ready: true },
    live:
      app.worker && app.workflow
        ? { worker: app.worker, workflow: app.workflow, ready: app.ready === true }
        : { ready: false },
  };
}
export const APPS = appsOf(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8')));

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
/** One hash over a {path: sha256} map: its "<path> <sha256>" lines, sorted. */
export const hashOf = files =>
  sha256(
    Object.keys(files)
      .sort()
      .map(f => `${f} ${files[f]}`)
      .join('\n')
  );

/** The Worker's source: pwa/worker.js and every module it imports, by relative import, as {repo path: sha256}. */
export function workerFiles(root = ROOT) {
  const seen = [];
  const walk = rel => {
    if (seen.includes(rel)) return;
    seen.push(rel);
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm))
      walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  };
  walk('pwa/worker.js');
  return Object.fromEntries(seen.map(rel => [rel, sha256(fs.readFileSync(path.join(root, rel)))]));
}

/** The app's files in a public/ folder, as {served path: sha256}. */
export function publicFiles(dir) {
  const out = {};
  const walk = (d, rel) => {
    for (const f of fs.readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p, rel + f + '/');
      else out[rel + f] = sha256(fs.readFileSync(p));
    }
  };
  walk(dir, '');
  return out;
}

/** The build hash of a checkout: {worker, files, n} from its source and a public/ build-pwa wrote. */
export function buildHash(root, publicDir) {
  const files = publicFiles(publicDir);
  return { worker: hashOf(workerFiles(root)), files: hashOf(files), n: Object.keys(files).length };
}

/** What the session's build would deploy: build-pwa into dist/pwa/<target> (dist/page/<target> must be built). */
export async function expectedApp({ root = ROOT, dist = path.join(root, 'dist'), target }) {
  const { buildPwa } = await import('./build-pwa.mjs');
  const out = path.join(dist, 'pwa', target);
  buildPwa({ record: target, root, out });
  return buildHash(root, out);
}

/** The line a Worker version carries (wrangler's message holds 100 characters), and its reading. */
export const appMessage = ({ commit, worker, files }) =>
  `ev ${String(commit).slice(0, 12)} worker ${worker.slice(0, 16)} files ${files.slice(0, 16)}`;
export function parseAppMessage(s) {
  const m = /\bev ([0-9a-f]{7,40}) worker ([0-9a-f]{16}) files ([0-9a-f]{16})\b/.exec(String(s || ''));
  return m ? { commit: m[1], worker: m[2], files: m[3] } : null;
}

/** The read verify needs: the newest run of the target's workflow, through the GitHub API, saved to stateDir/app.json. */
export function appRead({ target, stateDir }) {
  const save = `${stateDir}/app.json`;
  return {
    tool: 'Bash',
    args: { command: `node tools/pwa-app.mjs readback ${target} --out ${save} --wait 9` },
    save,
    note: `the newest ${APPS[target].workflow} run, its steps and the build hash it read back from the ${APPS[target].worker} Worker (waits up to 9 minutes for a run still going)`,
  };
}

/**
 * The call that deploys the app: a dispatch of the target's workflow at the build's commit. live only on Matt's OK
 * (R-04): without it, refused here as ship live refuses before any call; with it, nothing until live is ready.
 */
export function appCalls({ target, commit, mattOk = false, release = null }) {
  const app = APPS[target];
  if (target === 'live' && !mattOk)
    return { ok: false, refusals: ["R-04 (D-083): the live app deploys only on Matt's explicit OK (--matt-ok)"] };
  if (!app || !app.ready) return { ok: true, calls: [] };
  // B-420: the commit goes into a shell command and the runner's checkout as it is, so only a whole 40-character sha
  if (!COMMIT.test(String(commit || '')))
    return {
      ok: false,
      refusals: [`app ${target}: the build commit ${JSON.stringify(String(commit || ''))} is not 40 hex characters`],
    };
  return {
    ok: true,
    calls: [
      {
        step: `app ${target}: deploy the ${app.worker} Worker and its page files at ${commit.slice(0, 7)}`,
        tool: 'Bash',
        // D-343: a release tag made here but not pushed is named, so the runner makes it too and builds the same release
        args: {
          command: `gh workflow run ${app.workflow} --repo ${REPO} --ref main -f commit=${commit}${release && RELEASE.test(release) ? ` -f release=${release}` : ''}`,
        },
        then: `the read below waits for the run (or gh run list --repo ${REPO} --workflow ${app.workflow} --limit 1)`,
      },
    ],
  };
}

/**
 * The verify lines for the app, from the saved read (null when not read) against the build's hash. Green when the
 * newest run succeeded and the Worker carries this build's hash, at this commit or at an older one with the same
 * Worker source and page files (B-63's content rule).
 */
export function appLines({ target, commit, expected, saved }) {
  const lines = [];
  const add = (ok, what, detail = '') => lines.push({ ok, what, detail });
  const app = APPS[target];
  if (!saved) {
    add(false, `app ${target} read`, `no saved read of ${app.workflow}; run the read below`);
    return lines;
  }
  const run = saved.run;
  if (!run) {
    add(false, `app ${target} workflow run`, `no ${app.workflow} run yet`);
    return lines;
  }
  if (run.status !== 'completed') {
    add(false, `app ${target} workflow run`, `run ${run.id} is ${run.status}: read again once it ends`);
    return lines;
  }
  const failed = (saved.steps || []).filter(s => s.conclusion === 'failure').map(s => s.name);
  add(
    run.conclusion === 'success',
    `app ${target} workflow run`,
    run.conclusion === 'success'
      ? `run ${run.id} green`
      : `run ${run.id} ${run.conclusion}${failed.length ? ` at: ${failed.join('; ')}` : ''}${(saved.errors || []).length ? ` (${saved.errors.join('; ')})` : ''}`
  );
  const got = saved.app;
  if (!got) {
    add(false, `app ${target} Worker build`, `run ${run.id} read back no build hash (no app notice)`);
    return lines;
  }
  const same = got.worker === expected.worker.slice(0, 16) && got.files === expected.files.slice(0, 16);
  const atCommit = String(commit).startsWith(got.commit);
  add(
    got.worker === expected.worker.slice(0, 16),
    `app ${target} Worker build`,
    got.worker === expected.worker.slice(0, 16)
      ? `worker ${got.worker} at ${got.commit.slice(0, 7)}`
      : `the Worker runs ${got.worker} (${got.commit.slice(0, 7)}), the build is ${expected.worker.slice(0, 16)}`
  );
  add(
    got.files === expected.files.slice(0, 16),
    `app ${target} files`,
    got.files === expected.files.slice(0, 16)
      ? `${expected.n} files, ${got.files}`
      : `the Worker serves ${got.files}, the build is ${expected.files.slice(0, 16)}`
  );
  if (same && !atCommit)
    lines.push({
      ok: true,
      what: `app ${target} commit`,
      detail: `deployed at ${got.commit.slice(0, 7)}, the same Worker and files as ${String(commit).slice(0, 7)}`,
    });
  return lines;
}

// ------------------------------------------------------------------------------------------ the GitHub API reads
const gh = (...a) =>
  JSON.parse(
    execFileSync('gh', ['api', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 })
  );

/** The newest run of a workflow, its job's steps and the app notice, as saved for verify. */
export function readRun(target, api = gh) {
  const app = APPS[target];
  const runs = api(`repos/${REPO}/actions/workflows/${app.workflow}/runs?per_page=5`).workflow_runs || [];
  const r = runs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const out = { target, readAt: new Date().toISOString(), run: null, steps: [], app: null };
  if (!r) return out;
  out.run = {
    id: r.id,
    status: r.status,
    conclusion: r.conclusion,
    title: r.display_title,
    headSha: r.head_sha,
    at: r.created_at,
  };
  if (r.status !== 'completed') return out;
  // B-320: every job's steps and notes (pwa-live.yml has a gate job before the one that deploys)
  const jobs = api(`repos/${REPO}/actions/runs/${r.id}/jobs`).jobs || [];
  if (!jobs.length) return out;
  out.steps = jobs.flatMap(job => (job.steps || []).map(s => ({ name: s.name, conclusion: s.conclusion })));
  const notes = jobs.flatMap(job => api(`repos/${REPO}/check-runs/${job.id}/annotations`) || []);
  const mine = notes.filter(a => a.title === `app ${target}`);
  const note = mine.filter(a => a.annotation_level === 'notice').at(-1);
  out.app = note ? parseAppMessage(note.message) : null;
  out.errors = mine.filter(a => a.annotation_level === 'failure').map(a => String(a.message).slice(0, 300));
  return out;
}

/** In the workflow: the active version of the Worker, from wrangler's JSON (deployments list, then versions view). */
export function activeVersion(deployments) {
  const d = [...(deployments || [])].sort((a, b) => String(a.created_on).localeCompare(String(b.created_on))).at(-1);
  const v = d && [...(d.versions || [])].sort((a, b) => b.percentage - a.percentage)[0];
  return v ? v.version_id : null;
}

/**
 * The version whose code the active one runs: `wrangler secret put` makes a new version (triggered_by "secret", no
 * message) over the same code, so walk back from the active version past those to the upload that carries the message.
 * versions: wrangler versions list --json (oldest first).
 */
export function codeVersion(versions, activeId) {
  const vs = [...(versions || [])].sort((a, b) =>
    String((a.metadata || {}).created_on).localeCompare(String((b.metadata || {}).created_on))
  );
  let i = vs.findIndex(v => v.id === activeId);
  while (i > 0 && (vs[i].annotations || {})['workers/triggered_by'] === 'secret') i--;
  return i >= 0 ? vs[i] : null;
}

async function deployedCheck(target, base) {
  const wrangler = (...a) =>
    JSON.parse(
      execFileSync('npx', ['wrangler', ...a, '--env', target, '--json'], {
        cwd: path.join(ROOT, 'pwa'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    );
  const publicDir = path.join(ROOT, 'pwa', 'public');
  const want = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ...buildHash(ROOT, publicDir),
  };
  const lines = [];
  const add = (ok, what) => lines.push({ ok, what });
  const id = activeVersion(wrangler('deployments', 'list'));
  const v = id ? codeVersion(wrangler('versions', 'list'), id) : null;
  const msg = v ? ((v.annotations || {})['workers/message'] ?? '') : '';
  const got = parseAppMessage(msg);
  const via = v && v.id !== id ? ` (its code version ${v.id}, under secret changes)` : '';
  add(
    msg === appMessage(want),
    got
      ? `the active version${via} carries ${msg}${msg === appMessage(want) ? '' : `, the build is ${appMessage(want)}`}`
      : `the active version carries no build hash (${id || 'no version'}${v ? `, code version ${v.id}` : ''})`
  );
  const files = publicFiles(publicDir),
    bad = [];
  for (const f of Object.keys(files)) {
    const r = await fetch(base.replace(/\/+$/, '') + '/' + (f === 'index.html' ? '' : f));
    const h = r.status === 200 ? sha256(Buffer.from(await r.arrayBuffer())) : `status ${r.status}`;
    if (h !== files[f]) bad.push(f);
  }
  add(!bad.length, bad.length ? `served files differ: ${bad.join(', ')}` : `${want.n} served files equal the build`);
  return { lines, message: appMessage(want) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, target, third] = process.argv.slice(2);
  const opt = k => {
    const i = process.argv.indexOf(k);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  if (!['message', 'deployed', 'readback'].includes(cmd) || !(APPS[target] && APPS[target].ready)) {
    console.error(
      'usage: node tools/pwa-app.mjs message|deployed|readback staging|live [...] (live only once spec.registry.records.live.app.ready)'
    );
    process.exit(2);
  }
  if (cmd === 'message') {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    console.log(appMessage({ commit, ...buildHash(ROOT, path.join(ROOT, 'pwa', 'public')) }));
  } else if (cmd === 'deployed') {
    if (!/^https:\/\//.test(third || '')) {
      console.error('usage: node tools/pwa-app.mjs deployed staging|live https://<the Worker>');
      process.exit(2);
    }
    const { lines, message } = await deployedCheck(target, third).catch(e => ({
      lines: [{ ok: false, what: `the read back failed: ${String(e.message).split('\n')[0].slice(0, 200)}` }],
      message: '',
    }));
    for (const l of lines) console.log(`${l.ok ? 'ok ' : 'NO '} ${l.what}`);
    // A build session cannot read run logs: each difference is also an error annotation readback brings home.
    for (const l of lines) if (!l.ok) console.log(`::error title=app ${target}::${l.what}`);
    const green = lines.every(l => l.ok);
    // The read a build session makes finds this notice through the GitHub API (run logs are out of its reach).
    if (green) console.log(`::notice title=app ${target}::${message}`);
    console.log(`app ${target} deployed: ${green ? 'GREEN' : 'RED'}`);
    process.exit(green ? 0 : 1);
  } else {
    const out = opt('--out'),
      wait = Number(opt('--wait') || 0);
    if (!out) {
      console.error('readback: --out <file>');
      process.exit(2);
    }
    let r = readRun(target);
    const until = Date.now() + wait * 60e3;
    while (r.run && r.run.status !== 'completed' && Date.now() < until) {
      await new Promise(res => setTimeout(res, 20e3));
      r = readRun(target);
    }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(r, null, 1));
    console.log(
      r.run
        ? `${APPS[target].workflow} run ${r.run.id} (${r.run.title}): ${r.run.status}${r.run.conclusion ? ' ' + r.run.conclusion : ''}; build hash ${r.app ? `${r.app.commit.slice(0, 7)} worker ${r.app.worker} files ${r.app.files}` : 'none read'} -> ${out}`
        : `no ${APPS[target].workflow} run yet -> ${out}`
    );
  }
}
