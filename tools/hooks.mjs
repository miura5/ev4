#!/usr/bin/env node
// The build chat's hooks (.claude/settings.json; B-56, B-57, B-58). They may load in a scheduled pipeline run too: B-65
// proved they did not for one kind of task, and the live watchdog, created from another kind of session, loaded them and
// was refused at start (D-169, Oct 20). So every hook stands down while the session carries a fresh run marker, which
// step 1 of every task prompt writes (pipelineRun; B-131). Each reads the hook's JSON on stdin; exit 2 with a message on
// stderr is the hook's "no" (it reaches the session), exit 0 passes.
//   node tools/hooks.mjs stop          B-56: npm test before the session ends; red is reported, nothing is changed
//   node tools/hooks.mjs spec-format   B-57: after Edit or Write on spec/**/*.json, the file again at indent 1, no newline
//   node tools/hooks.mjs live-guard    B-58: an ArtifactData write or an Artifact publish aimed at the live record or
//                                      page is refused unless deploy live --matt-ok wrote dist/live-ok in the last 2 h;
//                                      B-320: so is a Bash dispatch of pwa-live.yml unless that dist/live-ok names its commit
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RUN_MARKER } from './prompts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIVE_OK_HOURS = 2;
export const TRACE_OK_MINUTES = 10; // B-178 (D-195): the builder's trace allowance
const WRITES = new Set(['set', 'update', 'delete', 'str_replace', 'batch']);

/** D-169 (B-131): the pipeline run this session is, from the marker step 1 of every task prompt writes, while it is
 * younger than spec.constants.watchdog.runTimeoutMinutes; null when there is none, it does not parse, or it is stale. */
export function pipelineRun({ file = RUN_MARKER, now = Date.now(), timeoutMinutes = 60 } = {}) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const at = Date.parse(m && m.at);
  if (!m || !m.pipeline || !Number.isFinite(at)) return null;
  if (at > now + 5 * 60e3 || now - at >= timeoutMinutes * 60e3) return null; // from the future, or stale
  return m;
}
const runTimeout = () => {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
    return s.constants.watchdog.runTimeoutMinutes || 60;
  } catch {
    return 60;
  }
};

/** B-56: what the Stop hook says for a test run's result: null when green (or when it already spoke this stop). */
export function stopVerdict(input, run) {
  if (input && input.stop_hook_active) return null; // the session is already answering a red run: never loop
  if (run.status === 0) return null;
  const failed = [...String(run.out || '').matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1]).slice(0, 8);
  return `npm test is red${failed.length ? ': ' + failed.join('; ') : ''}. Fix it or say so before ending (B-56); this hook changes nothing.`;
}

/** B-57: the spec file a tool call wrote, when it is one (spec/**\/*.json under root), else null. */
export function specFileOf(input, root = ROOT) {
  const f = input && input.tool_input && input.tool_input.file_path;
  if (!f || !['Edit', 'Write', 'MultiEdit'].includes(input.tool_name)) return null;
  const rel = path.relative(root, path.resolve(root, f));
  return /^spec\/.+\.json$/.test(rel.split(path.sep).join('/')) ? path.join(root, rel) : null;
}
/** The spec's own form (CLAUDE.md): JSON with indent 1, no trailing newline. Null when the text is not JSON. */
export function specForm(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 1);
  } catch {
    return null;
  }
}

/**
 * B-178 (D-195, D-201): whether the builder's trace names this ArtifactData call: dist/trace-ok for the live record,
 * younger than ten minutes, naming each write's action, collection and document (a batch: every one of its writes).
 * Only set and update; never a delete, a str_replace or anything on another document.
 */
export function traceAllows(a, traceOk, { liveId, now = Date.now() }) {
  if (!traceOk || traceOk.record !== 'live' || !String(traceOk.url || '').includes(liveId)) return false;
  if (!Number.isFinite(traceOk.at) || now - traceOk.at >= TRACE_OK_MINUTES * 60e3 || traceOk.at > now + 60e3)
    return false;
  const named = new Set((traceOk.calls || []).map(c => `${c.action} ${c.collection}/${c.doc_id}`));
  const writes =
    a.action === 'batch'
      ? (a.writes || []).map(w => ({ action: w.op, collection: w.collection, doc_id: w.doc_id }))
      : [{ action: a.action, collection: a.collection, doc_id: a.doc_id }];
  return (
    writes.length > 0 &&
    writes.every(w => ['set', 'update'].includes(w.action) && named.has(`${w.action} ${w.collection}/${w.doc_id}`))
  );
}

/**
 * B-320 (D-331): whether a shell command may dispatch the live app's workflow (pwa-live.yml), failing closed: null when
 * it plainly cannot, else {commit, why}. It may when, read with every quote and backslash taken out:
 *   - it posts to a /dispatches endpoint, or re-runs a run (gh run rerun, .../runs/<id>/rerun): always refused, as
 *     going back is the rollback skill's (a rerun can't be told apart from a re-run of an old pwa-live run);
 *   - it runs gh workflow run on a workflow that isn't a plain literal name (quoted, escaped, a variable, a numeric
 *     id) or whose name says pwa and live;
 *   - it says pwa and live and calls GitHub (gh other than a read, gh api, curl, wget, api.github.com);
 *   - it writes to an API (gh api, curl or wget with a method or a body) with a $ or backtick in it;
 *   - it hides what it runs: a base64 decode, eval, or a pipe into a shell.
 * (A plain "pwa" and "live" with no GitHub call is not one: the runbook's own node tools/pwa-live.mjs and pwa-copy.mjs
 * --record live commands must run; docs/cutover.md, Known limits.)
 * Plain mentions (node tools/pwa-live.mjs, git add, cat .github/workflows/pwa-live.yml) and gh reads pass. One that may
 * dispatch passes only (dispatchAllowed) when why is empty and its commit is the one dist/live-ok names: exactly one
 * literal commit=<40 hex>, and no $, backtick, base64, eval, pipe into a shell or input from a file or stdin, so the
 * commit run is the commit read.
 */
export const LIVE_WORKFLOW = 'pwa-live';
const GH_READS =
  /^(run (list|view|watch|download)|workflow (list|view)|pr (view|list|diff|checks)|secret list|auth status|repo view|release (list|view))$/;
const VALUE_FLAGS = new Set(['-R', '--repo', '-r', '--ref', '-f', '-F', '--field', '--raw-field']);
// what makes any command one that may dispatch (it hides what it runs), and, more broadly, what a dispatch may not hold
const HIDES = [
  [/\bbase64\s+(-\w*d\w*|--decode)\b|\bb64decode\b|\batob\s*\(|base64['"]?\s*\)\.toString/, 'a base64 decode'],
  [/(^|[;&|({]\s*)eval\b/, 'eval'],
  [/\|\s*(sudo\s+)?(env\s+)?(ba|z|da|k|c|tc|fi)?sh\b/, 'a pipe into a shell'],
];
const NEVER_IN_DISPATCH = [
  [/[$`]/, 'it builds part of itself at run time ($ or a backtick)'],
  [/base64/i, 'it names base64'],
  [/\beval\b/, 'it names eval'],
  [/\|\s*(sudo\s+)?(env\s+)?(ba|z|da|k|c|tc|fi)?sh\b/, 'it pipes into a shell'],
  [/<|\|\s*gh\b|--json\b|--input\b|=@/, 'it reads inputs from a file or stdin'],
];
export function liveDispatch(command) {
  const raw = String(command || '');
  const c = raw.replace(/["'\\]/g, ''); // any quoting or escaping, taken out
  const pwaLive = /pwa/i.test(c) && /live/i.test(c);
  const rerun = /\brun\s+rerun\b|\/rerun/.test(c);
  const reasons = [];
  if (/\/dispatches\b/.test(c)) reasons.push('posts to a dispatches endpoint');
  if (rerun) reasons.push('re-runs a run');
  // gh workflow run: the workflow it names, from the raw command (a literal name has no quote, escape or $)
  for (const m of raw.matchAll(/\bworkflow\s+run\b([^;&|\n]*)/g)) {
    const toks = m[1].trim().split(/\s+/).filter(Boolean);
    let name = null;
    for (let i = 0; i < toks.length; i++) {
      if (VALUE_FLAGS.has(toks[i])) i++;
      else if (!toks[i].startsWith('-')) {
        name = toks[i];
        break;
      }
    }
    if (!name || !/^[A-Za-z0-9_.\/-]+$/.test(name) || /^\d+$/.test(name))
      reasons.push('runs a workflow it does not name');
    else if (/pwa/i.test(name) && /live/i.test(name)) reasons.push('runs the live workflow');
  }
  if (!/\bworkflow\s+run\b/.test(raw) && /\bworkflow\s+run\b/.test(c)) reasons.push('runs a workflow it does not name');
  if (pwaLive) {
    const ghCalls = [...c.matchAll(/\bgh\s+(\S+)(?:\s+(\S+))?/g)].map(m => `${m[1]} ${m[2] || ''}`.trim());
    if (ghCalls.some(g => !GH_READS.test(g)) || /\b(curl|wget|http|https?ie)\b|api\.github\.com|\bfetch\s*\(/i.test(c))
      reasons.push('names the live workflow and calls GitHub');
  }
  if (
    /\bgh\s+api\b|\bcurl\b|\bwget\b/i.test(c) &&
    /[$`]/.test(raw) &&
    /(-X|--method|--request)\s*(POST|PUT|PATCH)\b|\s-[fFd]\s|--(field|raw-field|input|data|post-data)\b/i.test(c)
  )
    reasons.push('writes to an API at an address or with a body it builds at run time');
  for (const [re, what] of HIDES) if (re.test(raw) || re.test(c)) reasons.push(`hides what it runs (${what})`);
  if (!reasons.length) return null;
  const why = [];
  if (rerun)
    why.push("a re-run is never a live dispatch: going back is the rollback skill's (.claude/skills/rollback)");
  for (const [re, what] of NEVER_IN_DISPATCH) if (re.test(raw) || re.test(c)) why.push(what);
  const named = [...c.matchAll(/\bcommit\]?\s*[=:]\s*(\S*)/gi)].map(m => m[1]);
  const commit = named.length === 1 && /^[0-9a-f]{40}(?![0-9a-f])/.test(named[0]) ? named[0].slice(0, 40) : null;
  if (named.length !== 1) why.push(named.length ? `it names ${named.length} commits` : 'it names no commit');
  else if (!commit) why.push('its commit is not one literal 40-character sha');
  return { commit, why, reasons };
}
/** B-320: whether dist/live-ok allows dispatching the live workflow at this commit: fresh, Matt's OK, the same full
 * 40-character commit. */
export function dispatchAllowed(liveOk, commit, now = Date.now()) {
  if (!liveOk || !Number.isFinite(liveOk.at) || now - liveOk.at >= LIVE_OK_HOURS * 36e5 || liveOk.at > now + 60e3)
    return false;
  if (!/^(deploy live --matt-ok|ship live --matt-ok|ship live --from-job \S+)$/.test(String(liveOk.by || '')))
    return false;
  return /^[0-9a-f]{40}$/.test(String(commit || '')) && liveOk.commit === commit;
}

/** B-58: the refusal for a tool call aimed at the live record or page, or null when it may go. */
export function liveGuard(input, { liveId, liveOk = null, traceOk = null, now = Date.now() }) {
  const name = String((input && input.tool_name) || ''),
    a = (input && input.tool_input) || {};
  // B-320 (D-331): dispatching the live app's workflow needs Matt's OK bound to that commit (dist/live-ok), as a live
  // deploy does; GitHub's live environment then waits for his approval there too.
  if (name === 'Bash') {
    const d = liveDispatch(a.command);
    if (!d) return null;
    if (!d.why.length && dispatchAllowed(liveOk, d.commit, now)) return null;
    const why = d.why.length ? d.why.join('; ') : `dist/live-ok does not allow ${d.commit.slice(0, 7)}`;
    return `Refused: a dispatch of the live app's workflow (${LIVE_WORKFLOW}.yml), or a command that may be one (it ${d.reasons.join(', ')}): ${why}. It goes only as one plain command naming one literal commit=<40 hex> that Matt's OK names: deploy live --matt-ok or ship live --matt-ok writes dist/live-ok for that commit for ${LIVE_OK_HOURS} hours (B-58, D-331)${liveOk ? `; the one there names ${String(liveOk.commit || 'none').slice(0, 7)}, by ${liveOk.by || 'nothing'}, and may be older than that` : ''}.`;
  }
  const aimed = String(a.url || a.from_url || '').includes(liveId);
  let what = null;
  if (/(^|__)ArtifactData$/.test(name) && aimed && WRITES.has(a.action))
    what = `an ArtifactData ${a.action} on the live record`;
  if (/(^|__)Artifact$/.test(name) && aimed && (a.action == null || a.action === 'publish' || a.action === 'delete'))
    what = `an Artifact ${a.action || 'publish'} of the live page`;
  if (!what) return null;
  const fresh = liveOk && Number.isFinite(liveOk.at) && now - liveOk.at < LIVE_OK_HOURS * 36e5;
  if (fresh) return null;
  if (/(^|__)ArtifactData$/.test(name) && traceAllows(a, traceOk, { liveId, now })) return null; // B-178
  return `Refused: ${what}. Live changes only through deploy live --matt-ok (Matt's explicit OK in the chat), which writes dist/live-ok for ${LIVE_OK_HOURS} hours (B-58)${liveOk ? '; the one there is older than that' : ''}.`;
}

/**
 * B-146 (W-3): the tree npm test would see, as one hash: the index (git ls-files -s), the working tree's changes against
 * it (git diff) and every untracked file not ignored, with its content. The Stop hook skips when it equals the hash
 * the last green run left in dist/test-ok.
 */
export function treeHash(root = ROOT) {
  // B-320: a buffer the whole diff fits in (the default 1 MiB cut it short, a different length each run)
  const g = a => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 1 << 30 }).stdout || '';
  const h = createHash('sha256');
  h.update(g(['ls-files', '-s']));
  h.update('\0' + g(['diff', '--no-color', '--no-ext-diff']));
  for (const f of g(['ls-files', '-o', '--exclude-standard']).split('\n').filter(Boolean).sort()) {
    h.update('\0' + f + '\0');
    try {
      h.update(fs.readFileSync(path.join(root, f)));
    } catch {
      /* gone since the listing */
    }
  }
  return h.digest('hex');
}
const testOkFile = root => path.join(root, 'dist', 'test-ok');

// Its own test run, never a child of another (node:test skips the files when NODE_TEST_CONTEXT is set at all).
const ownRun = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
};
const readStdin = () => {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
};
const no = msg => {
  process.stderr.write(msg + '\n');
  return 2;
};

export function main(argv = process.argv.slice(2), { marker = process.env.EV_RUN_MARKER || RUN_MARKER } = {}) {
  const input = readStdin(),
    cmd = argv[0];
  // A pipeline run is not a build chat: no hook acts in it (D-169).
  if (
    ['stop', 'spec-format', 'live-guard'].includes(cmd) &&
    pipelineRun({ file: marker, timeoutMinutes: runTimeout() })
  )
    return 0;
  if (cmd === 'stop') {
    const tree = treeHash(ROOT);
    let ok = null;
    try {
      ok = JSON.parse(fs.readFileSync(testOkFile(ROOT), 'utf8'));
    } catch {
      /* no green run recorded */
    }
    if (ok && ok.tree === tree) {
      process.stdout.write(`npm test: skipped, the tree is unchanged since its last green run (${ok.at}; B-146)\n`);
      return 0;
    }
    const r = spawnSync(
      process.execPath,
      [
        '--import',
        './test/tmp-root.mjs', // B-326: each test process empties its own temp folder
        '--test',
        ...fs
          .readdirSync(path.join(ROOT, 'test'))
          .filter(f => f.endsWith('.test.mjs'))
          .sort()
          .map(f => path.join('test', f)),
      ],
      { cwd: ROOT, encoding: 'utf8', env: ownRun() }
    );
    const v = stopVerdict(input, { status: r.status, out: (r.stdout || '') + (r.stderr || '') });
    if (r.status === 0) {
      fs.mkdirSync(path.dirname(testOkFile(ROOT)), { recursive: true });
      fs.writeFileSync(testOkFile(ROOT), JSON.stringify({ tree, at: new Date().toISOString() }));
    }
    return v ? no(v) : 0;
  }
  if (cmd === 'spec-format') {
    const f = specFileOf(input);
    if (!f || !fs.existsSync(f)) return 0;
    const text = fs.readFileSync(f, 'utf8'),
      form = specForm(text);
    if (form == null) return no(`${path.relative(ROOT, f)} is not valid JSON after that edit (B-57 left it as it is).`);
    if (form !== text) fs.writeFileSync(f, form);
    return 0;
  }
  if (cmd === 'live-guard') {
    // B-320: a shell command is read only for a dispatch of the live workflow; anything else passes at once
    if (input && input.tool_name === 'Bash' && !liveDispatch((input.tool_input || {}).command)) return 0;
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
    const okFile = path.join(ROOT, 'dist', 'live-ok');
    let liveOk = null;
    try {
      liveOk = JSON.parse(fs.readFileSync(okFile, 'utf8'));
    } catch {
      /* none */
    }
    let traceOk = null;
    try {
      traceOk = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'trace-ok'), 'utf8'));
    } catch {
      /* none */
    }
    const v = liveGuard(input, { liveId: spec.registry.records.live.artifact, liveOk, traceOk });
    return v ? no(v) : 0;
  }
  return no('usage: node tools/hooks.mjs stop|spec-format|live-guard');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
