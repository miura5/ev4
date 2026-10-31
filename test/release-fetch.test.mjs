// B-640: a fresh shallow clone has no tags; releaseOf fetches them once and stamps the tagged release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { releaseOf } from '../tools/build.mjs';

const git = (cwd, ...a) =>
  execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function origin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b640-origin-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  for (const n of [1, 2, 3]) {
    fs.writeFileSync(path.join(dir, 'f'), String(n));
    git(dir, 'add', 'f');
    git(dir, 'commit', '-qm', `c${n}`);
    if (n === 1) git(dir, 'tag', '-a', 'v4.7.0', '-m', 't');
  }
  return dir;
}

test('B-640: a --depth 1 clone with no tags fetches them and stamps the release', () => {
  const src = origin();
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'b640-clone-'));
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${src}`, clone]);
  assert.equal(git(clone, 'tag').trim(), '');
  assert.equal(releaseOf(clone, 'HEAD', { fetchTags: false }), null);
  assert.equal(releaseOf(clone), 'v4.7.0+2');
});

test('B-640: no tags anywhere still gives null (ship refuses the untagged build)', () => {
  const src = origin();
  git(src, 'tag', '-d', 'v4.7.0');
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'b640-clone-'));
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${src}`, clone]);
  assert.equal(releaseOf(clone), null);
});
