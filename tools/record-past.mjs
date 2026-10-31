// B-641: a live deploy that went out but was never recorded (the chat that shipped it ended before pushing) is recorded
// after the fact, deploying nothing: `ship live --record-past --commit <sha> --run <pwa-live run id> [--release v4.x.y]`.
// The run is read from GitHub (gh api) and must be a successful pwa-live run of exactly that commit, dispatched from
// main; the commit must carry a green staging deploy in the record (R-02). The entry is then written by recordShip,
// the same writer ship live uses, so its shape and release name are ship live's. --release names the release the
// page carried when no tag is at the commit locally (the git proxy keeps ship's tags local; tags.yml makes it on origin).
import { execFileSync } from 'node:child_process';

const TAG = /^v\d+\.\d+\.\d+$/;

/** The GitHub run, as gh api returns it. */
export function fetchRun(root, id) {
  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const url = sh('git', ['remote', 'get-url', 'origin']).trim();
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url) || /\/git\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`origin (${url}) is not a GitHub repository`);
  return JSON.parse(sh('gh', ['api', `repos/${m[1]}/actions/runs/${id}`]));
}

/** Why the run does not prove a live deploy of commit (full sha), or [] when it does. */
export function runRefusals(run, commit) {
  const why = [];
  if (!run || typeof run !== 'object') return ['no such run'];
  if (run.path !== '.github/workflows/pwa-live.yml') why.push(`run ${run.id} is ${run.path || run.name}, not pwa-live`);
  if (run.status !== 'completed' || run.conclusion !== 'success')
    why.push(`run ${run.id} is ${run.status}/${run.conclusion}, not completed/success`);
  if (run.head_branch !== 'main') why.push(`run ${run.id} ran from ${run.head_branch}, not main`);
  // pwa-live's run-name is "pwa-live <inputs.commit>": the commit it deployed (head_sha is main's head at dispatch).
  if (run.display_title !== `pwa-live ${commit}`)
    why.push(`run ${run.id} deployed "${run.display_title}", not pwa-live ${commit}`);
  return why;
}

/**
 * Records the past live deploy; deploys nothing. deps: {git(args) -> stdout, fetchRun(id), loadChart(), tagAt(sha),
 * recordShip(o, {target, manifest, release, time})}.
 */
export function recordPastLive(o, deps) {
  if (!o.commit || typeof o.commit !== 'string') throw new Error('--record-past needs --commit <sha>');
  if (!/^\d+$/.test(String(o.run || ''))) throw new Error('--record-past needs --run <pwa-live run id>');
  if (o.release !== undefined && !TAG.test(String(o.release))) throw new Error('--release takes a tag like v4.5.24');
  const commit = deps.git(['rev-parse', '--verify', `${o.commit}^{commit}`]).trim();
  const short = commit.slice(0, 7);
  const why = runRefusals(deps.fetchRun(String(o.run)), commit);
  const rec = deps.loadChart();
  if (rec.deploys.some(d => d.target === 'live' && d.commit === short))
    why.push(`a live deploy at ${short} is already recorded`);
  if (!rec.deploys.some(d => d.target === 'staging' && d.commit === short && d.verify === 'green'))
    why.push(`R-02: no green staging deploy at ${short} in the record`);
  const tag = deps.tagAt(commit);
  if (tag && o.release && tag !== o.release) why.push(`${short} is tagged ${tag} here, not ${o.release}`);
  const release = tag || o.release;
  if (!release) why.push(`no tag at ${short} here: name the release the live page carried with --release v4.x.y`);
  if (why.length) throw new Error(`record-past: ${why.join('; ')}`);
  const run = deps.fetchRun(String(o.run));
  return deps.recordShip(o, {
    target: 'live',
    manifest: { commit },
    release: tag ? undefined : release,
    time: run.updated_at || undefined,
  });
}
