// Shared test helpers (not a test file: npm test runs test/*.test.mjs only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listRepoFiles } from '../tools/personal-data.mjs';

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
