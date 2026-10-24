// The Chart's record and its shared helpers (B-262, D-264): the record's files, statuses and kinds, its load and save,
// the next free ids, Central time, and the small file, git and list helpers every command of tools/chart.mjs uses.
// tools/chart.mjs re-exports what it exported before, so its importers are unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newestTranscript } from '../../core/transcript.mjs';

export const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FILES = ['tasks', 'decisions', 'deploys', 'rules', 'views'];
export const TASK_STATUS = ['inbox', 'open', 'in progress', 'blocked', 'done', 'declined'];
export const TASK_KINDS = ['task', 'bug', 'request'];
// The design's three, plus revisit, which three decisions carry.
export const DECISION_STATUS = ['proposed', 'accepted', 'superseded', 'revisit'];
// B-109: a decision is one-time; a tenet is a standing principle, with the parts of E.V. it governs and how it is checked.
export const DECISION_KINDS = ['decision', 'tenet'];
export const TENET_SCOPES = ['ui', 'data', 'ops', 'pipelines'];
export const TENET_CHECKS = ['harness', 'lint', 'ship', 'review'];
export const kindOf = d => d.kind || 'decision';
export const TZ = 'America/Chicago';
export const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
export const readJsonIf = p => (fs.existsSync(p) ? readJson(p) : null);
export const readSpec = root => readJson(path.join(root, 'spec', 'ev.spec.json'));
// This session's transcript (--transcript, else the newest), or '' when there is none.
export const transcriptOf = o => {
  const file = o.transcript || newestTranscript();
  return file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};
export const waitOnNoOne = t => {
  delete t.waitingOn;
  delete t.waitingWhere;
};
export const commitMessage = (message, trailers) => [message, ...(trailers.length ? ['', ...trailers] : [])].join('\n');
// Same as the spec: indent 1, no trailing newline.
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1));
export const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
export const git = (root, a, opts = {}) =>
  execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
export const ids = s => [...String(s || '').matchAll(/\b([BD]-\d{2,3})\b/g)].map(m => m[1]);
export const list = s =>
  s == null || s === true
    ? []
    : String(s)
        .split(/[\s,]+/)
        .filter(Boolean);

// ------------------------------------------------------------------------------------------------ the record
export const chartDir = root => path.join(root, 'chart');
export function loadChart(root = HERE) {
  const dir = chartDir(root);
  return Object.fromEntries(FILES.map(f => [f, readJson(path.join(dir, f + '.json'))]));
}
export function saveChart(root, rec) {
  fs.mkdirSync(chartDir(root), { recursive: true });
  for (const f of FILES) writeJson(path.join(chartDir(root), f + '.json'), rec[f]);
}
export const findTask = (rec, id) => rec.tasks.filter(t => t.id === id);
/** The next free B- id: one past the highest in the record. */
export function nextTaskId(rec) {
  const n = Math.max(0, ...rec.tasks.map(t => Number(t.id.slice(2))).filter(Number.isFinite));
  return 'B-' + String(n + 1).padStart(2, '0');
}
export function nextDecisionId(rec) {
  return 'D-' + String(Math.max(0, ...rec.decisions.map(d => Number(d.id.slice(2)))) + 1).padStart(3, '0');
}

// ------------------------------------------------------------------------------------------------ time
export const parts = (d, o) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).formatToParts(d).map(p => [p.type, p.value])
  );
/** "Oct 19" in Central time. */
export const ctDate = iso => {
  const p = parts(new Date(iso), { month: 'short', day: 'numeric' });
  return `${p.month} ${p.day}`;
};
/** "16:20" in Central time. */
export const ctClock = iso => {
  const p = parts(new Date(iso), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
};
