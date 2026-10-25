// B-318: the app (the Worker and its page files) in ship and verify-deploy. GitHub Actions holds the Cloudflare
// credential, so a build session never deploys the Worker itself: ship prints the workflow dispatch for the session
// to make (the way it prints ArtifactData calls), and a read through the GitHub API brings back what was deployed.
//
//   node tools/pwa-app.mjs message <staging|live>                 in the workflow, before the deploy: the line the
//                                                                  Worker version carries (wrangler deploy --message)
//   node tools/pwa-app.mjs deployed <staging|live> <worker url>   in the workflow, after it: the active version's
//                                                                  message and every served page file equal this
//                                                                  checkout's build; then the ::notice the read finds
//   node tools/pwa-app.mjs readback <staging|live> --out <file> [--wait <minutes>]
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = 'miura5/ev4';

/**
 * The app per target. live stays off (ready: false) until its Worker, D1 and secrets exist (B-283 and the move to D1):
 * until then ship live and verify-deploy live leave the app out, and nothing ever dispatches pwa-live.
 */
export const APPS = {
  staging: { worker: 'ev-staging', workflow: 'pwa-staging.yml', ready: true },
  live: { worker: 'ev-live', workflow: 'pwa-live.yml', ready: false },
};

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
 * (R-04): without it, refused here as ship live refuses before any call; and pwa-live itself refuses a run whose
 * matt_ok is not the commit it deploys.
 */
export function appCalls({ target, commit, mattOk = false }) {
  const app = APPS[target];
  if (target === 'live' && !mattOk)
    return { ok: false, refusals: ["R-04 (D-083): the live app deploys only on Matt's explicit OK (--matt-ok)"] };
  if (!app || !app.ready) return { ok: true, calls: [] };
  const fields = target === 'live' ? `-f commit=${commit} -f matt_ok=${commit}` : `-f commit=${commit}`;
  return {
    ok: true,
    calls: [
      {
        step: `app ${target}: deploy the ${app.worker} Worker and its page files at ${commit.slice(0, 7)}`,
        tool: 'Bash',
        args: { command: `gh workflow run ${app.workflow} --repo ${REPO} --ref main ${fields}` },
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
      : `run ${run.id} ${run.conclusion}${failed.length ? ` at: ${failed.join('; ')}` : ''}`
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
  const job = (api(`repos/${REPO}/actions/runs/${r.id}/jobs`).jobs || [])[0];
  if (!job) return out;
  out.steps = (job.steps || []).map(s => ({ name: s.name, conclusion: s.conclusion }));
  const notes = api(`repos/${REPO}/check-runs/${job.id}/annotations`);
  const note = (notes || []).filter(a => a.title === `app ${target}`).at(-1);
  out.app = note ? parseAppMessage(note.message) : null;
  return out;
}

/** In the workflow: the active version of the Worker, from wrangler's JSON (deployments list, then versions view). */
export function activeVersion(deployments) {
  const d = [...(deployments || [])].sort((a, b) => String(a.created_on).localeCompare(String(b.created_on))).at(-1);
  const v = d && [...(d.versions || [])].sort((a, b) => b.percentage - a.percentage)[0];
  return v ? v.version_id : null;
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
  const msg = id ? ((wrangler('versions', 'view', id).annotations || {})['workers/message'] ?? '') : '';
  const got = parseAppMessage(msg);
  add(
    msg === appMessage(want),
    got ? `the active version carries ${msg}` : `the active version carries no build hash (${id || 'no version'})`
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
  if (!['message', 'deployed', 'readback'].includes(cmd) || !APPS[target]) {
    console.error('usage: node tools/pwa-app.mjs message|deployed|readback <staging|live> [...]');
    process.exit(2);
  }
  if (cmd === 'message') {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    console.log(appMessage({ commit, ...buildHash(ROOT, path.join(ROOT, 'pwa', 'public')) }));
  } else if (cmd === 'deployed') {
    if (!/^https:\/\//.test(third || '')) {
      console.error('usage: node tools/pwa-app.mjs deployed <staging|live> https://<the Worker>');
      process.exit(2);
    }
    const { lines, message } = await deployedCheck(target, third);
    for (const l of lines) console.log(`${l.ok ? 'ok ' : 'NO '} ${l.what}`);
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
