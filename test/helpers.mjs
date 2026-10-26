// Shared test helpers (not a test file: npm test runs test/*.test.mjs only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listRepoFiles } from '../tools/personal-data.mjs';
import { keepForFile } from './tmp-root.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** A source file as one line (B-64): the formatter's line breaks and indents collapse to single spaces, and none
 *  follows an opening or precedes a closing bracket, so a test can match the code it names however it is wrapped. */
export const flatText = text =>
  String(text)
    .replace(/\s+/g, ' ')
    .replace(/([([{]) /g, '$1')
    .replace(/,? ([)\]}])/g, '$1');
export const flatSource = rel =>
  fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\s+/g, ' ')
    .replace(/([([{]) /g, '$1')
    .replace(/,? ([)\]}])/g, '$1');
export const git = (dir, ...args) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** A throwaway git repository holding a copy of this working tree, committed; with push: true, also pushed to a bare origin. */
export function copyRepo({ push = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-copy-'));
  for (const f of listRepoFiles(ROOT)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'copy');
  if (push) {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-origin-'));
    execFileSync('git', ['init', '-q', '--bare', bare]);
    git(dir, 'remote', 'add', 'origin', bare);
    git(dir, 'push', '-q', 'origin', 'main');
  }
  return dir;
}

/** The ids of n open tasks in a copied repository (from copyRepo). The real record can have none open (the freeze
 *  week, D-246, parks every feature task), so when it has fewer, the first blocked ones are reopened in the copy only,
 *  committed and, when the copy has an origin, pushed. */
export function openTasks(dir, n = 1) {
  const file = path.join(dir, 'chart', 'tasks.json');
  const tasks = JSON.parse(fs.readFileSync(file, 'utf8'));
  const open = tasks.filter(t => t.status === 'open');
  if (open.length < n) {
    for (const t of tasks.filter(t => t.status === 'blocked').slice(0, n - open.length)) {
      t.status = 'open';
      delete t.waitingOn;
      open.push(t);
    }
    fs.writeFileSync(file, JSON.stringify(tasks, null, 1));
    git(dir, 'commit', '-q', '-am', 'test: reopen tasks in the copy');
    if (git(dir, 'remote').trim()) git(dir, 'push', '-q', 'origin', 'main');
  }
  return open.slice(0, n).map(t => t.id);
}

// B-153 (T-5): the record files a test reads. Another chat may write chart/ while npm test runs here, so every Chart
// test reads one copy taken when the tests start: chart/ (with its import folder) and the three files generated from
// it, all from the same moment. A lint test (chart.test.mjs) refuses a direct read of the real ones.
export const RECORD_FILES = ['chart', 'BACKLOG.md', 'DECISIONS.md', 'CHANGELOG.md'];
let recordCopy = null;
/** A folder holding a copy of the record as it was when first called, taken once per test process. */
export function chartCopy(root = ROOT) {
  if (recordCopy && root === ROOT) return recordCopy;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-record-'));
  for (const f of RECORD_FILES) fs.cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
  if (root === ROOT) recordCopy = keepForFile(dir); // B-326: shared by the file's tests, removed at exit
  return dir;
}
/** Direct reads of the real record in a test's source: ROOT joined to a record file, or loadChart(ROOT). */
export function directRecordReads(text) {
  const files = RECORD_FILES.map(f => f.replace('.', '\\.')).join('|');
  const re = new RegExp(
    `path\\.join\\(ROOT,\\s*'(?:${files})'|loadChart\\(ROOT\\)|read(?:FileSync|Json)\\(\\s*['"\`](?:\\.\\/)?chart\\/`,
    'g'
  );
  return String(text).match(re) || [];
}

/** The live Mac folder evening-mac wrote before the cutover re-pointed it at E.V. Backups (D-322). */
export const PRE_CUTOVER_MAC_FOLDER = '/Users/peachfritter/Documents/E.V. Study Watch';
/**
 * B-320: the spec as it stood before the cutover commit, rebuilt from a cut-over spec (the reverse of
 * tools/pwa-live.mjs cutoverSpec): the live page writing, live off D1, the live runs staged back under
 * records.live.cutover with restore-drill (no trigger yet), and the old evening-mac back from tasks.retired with its
 * Study Watch folder and kept ended words. Lets the pre-cutover behaviour keep its tests after the spec moves on.
 */
export function preCutoverSpec(spec) {
  const s = JSON.parse(JSON.stringify(spec));
  const live = s.registry.records.live;
  if (!live.runs) throw new Error('the spec is not cut over (no spec.registry.records.live.runs)');
  const i = s.tasks.retired.findLastIndex(r => r.was === 'live.evening-mac' && /cutover/.test(r.reason || ''));
  if (i < 0) throw new Error('no retired live.evening-mac to restore');
  const [old] = s.tasks.retired.splice(i, 1);
  const { 'restore-drill': drill, ...tasks } = s.tasks.live;
  tasks['evening-mac'] = {
    ...tasks['evening-mac'],
    folders: [PRE_CUTOVER_MAC_FOLDER],
    trigger: old.trigger,
    keepEnded: ['B-01', 'B-04'],
    _keepEndedWhy:
      'D-344: this Mac task was created before D-324 ended B-01 and B-04; it keeps those words until the cutover retires it (O-5: Mac tasks are never edited).',
  };
  s.tasks.live = tasks;
  live.readOnly = false;
  live.d1 = false;
  live.cutover = {
    _why: 'B-320: what the cutover commit turns on (rebuilt by test/helpers.mjs preCutoverSpec).',
    runs: live.runs,
    tasks: { 'restore-drill': { ...drill, trigger: null } },
  };
  delete live.runs;
  return s;
}
