#!/usr/bin/env node
// The build chat's hooks (.claude/settings.json; B-56, B-57, B-58). They may load in a scheduled pipeline run too: B-65
// proved they did not for one kind of task, and the live watchdog, created from another kind of session, loaded them and
// was refused at start (D-169, Oct 20). So every hook stands down while the session carries a fresh run marker, which
// step 1 of every task prompt writes (pipelineRun; B-131). Each reads the hook's JSON on stdin; exit 2 with a message on
// stderr is the hook's "no" (it reaches the session), exit 0 passes.
//   node tools/hooks.mjs stop          B-56: npm test before the session ends; red is reported, nothing is changed
//   node tools/hooks.mjs spec-format   B-57: after Edit or Write on spec/**/*.json, the file again at indent 1, no newline
//   node tools/hooks.mjs live-guard    B-58: an ArtifactData write or an Artifact publish aimed at the live record or
//                                      page is refused unless deploy live --matt-ok wrote dist/live-ok in the last 2 h
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RUN_MARKER } from './prompts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIVE_OK_HOURS = 2;
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

/** B-58: the refusal for a tool call aimed at the live record or page, or null when it may go. */
export function liveGuard(input, { liveId, liveOk = null, now = Date.now() }) {
  const name = String((input && input.tool_name) || ''),
    a = (input && input.tool_input) || {};
  const aimed = String(a.url || a.from_url || '').includes(liveId);
  let what = null;
  if (/(^|__)ArtifactData$/.test(name) && aimed && WRITES.has(a.action))
    what = `an ArtifactData ${a.action} on the live record`;
  if (/(^|__)Artifact$/.test(name) && aimed && (a.action == null || a.action === 'publish' || a.action === 'delete'))
    what = `an Artifact ${a.action || 'publish'} of the live page`;
  if (!what) return null;
  const fresh = liveOk && Number.isFinite(liveOk.at) && now - liveOk.at < LIVE_OK_HOURS * 36e5;
  if (fresh) return null;
  return `Refused: ${what}. Live changes only through deploy live --matt-ok (Matt's explicit OK in the chat), which writes dist/live-ok for ${LIVE_OK_HOURS} hours (B-58)${liveOk ? '; the one there is older than that' : ''}.`;
}

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
    const r = spawnSync(
      process.execPath,
      [
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
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec', 'ev.spec.json'), 'utf8'));
    const okFile = path.join(ROOT, 'dist', 'live-ok');
    let liveOk = null;
    try {
      liveOk = JSON.parse(fs.readFileSync(okFile, 'utf8'));
    } catch {
      /* none */
    }
    const v = liveGuard(input, { liveId: spec.registry.records.live.artifact, liveOk });
    return v ? no(v) : 0;
  }
  return no('usage: node tools/hooks.mjs stop|spec-format|live-guard');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
