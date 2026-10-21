#!/usr/bin/env node
// B-175 (D-173): every live deploy carries its release tag on origin. `ship live` tags the build where it runs and
// pushes the tag, but a cloud session's git proxy refuses tag pushes, so this runs in GitHub Actions (tags.yml) on
// every push that touches chart/deploys.json and makes the tags origin is missing. A deploy's release is the one it
// recorded (deploy.release, or "release vX.Y.Z" in a correcting note); a deploy recorded without one, after the last
// tagged live deploy, takes the next patch in deploy order. Deploys before the last tagged one are left alone.
//   node tools/tags.mjs            print the tags it would make
//   node tools/tags.mjs --push     make them (annotated) and push them
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The release a deploy recorded, if any. */
export function recordedRelease(d) {
  if (d && TAG.test(d.release || '')) return d.release;
  for (const n of [...((d && d.notes) || [])].reverse()) {
    const x = /\brelease (v\d+\.\d+\.\d+)\b/.exec(String(n));
    if (x) return x[1];
  }
  return null;
}
const bump = t => {
  const [, M, m, p] = TAG.exec(t).map(Number);
  return `v${M}.${m}.${p + 1}`;
};
/**
 * The tags to make: deploys (chart/deploys.json order), tags as {name: commit} on origin, and full(short) giving a
 * deploy's full commit. Returns [{tag, commit, deploy}] for each live deploy after the last tagged one.
 */
export function missingTags(deploys, tags, full = c => c) {
  const live = (deploys || []).filter(d => d.target === 'live' && d.commit);
  const byCommit = new Map();
  for (const [name, c] of Object.entries(tags || {})) if (TAG.test(name)) byCommit.set(full(c), name);
  const tagged = i => byCommit.get(full(live[i].commit));
  let lastI = -1;
  live.forEach((d, i) => {
    if (tagged(i)) lastI = i;
  });
  if (lastI < 0) return [];
  const names = new Set(Object.keys(tags || {}));
  let last = tagged(lastI);
  const out = [];
  for (let i = lastI + 1; i < live.length; i++) {
    const d = live[i];
    if (tagged(i)) {
      last = tagged(i);
      continue;
    }
    const tag = recordedRelease(d) || bump(last);
    if (names.has(tag)) throw new Error(`${tag} is on origin at another commit than the live deploy ${d.commit}`);
    out.push({ tag, commit: full(d.commit), deploy: d });
    names.add(tag);
    last = tag;
  }
  return out;
}

function main(argv) {
  const git = (...a) => String(execFileSync('git', ['-C', ROOT, ...a], { stdio: 'pipe' })).trim();
  const deploys = JSON.parse(fs.readFileSync(path.join(ROOT, 'chart', 'deploys.json'), 'utf8'));
  const list = Array.isArray(deploys) ? deploys : deploys.deploys;
  const tags = {};
  for (const line of git('ls-remote', '--tags', 'origin').split('\n').filter(Boolean)) {
    const [sha, ref] = line.split('\t');
    const name = ref.replace(/^refs\/tags\//, '');
    if (name.endsWith('^{}')) tags[name.slice(0, -3)] = sha;
    else if (!(name in tags)) tags[name] = sha;
  }
  const full = c => {
    try {
      return git('rev-parse', '--verify', '-q', String(c) + '^{commit}');
    } catch {
      return String(c);
    }
  };
  const todo = missingTags(list, tags, full);
  if (!todo.length) {
    console.log('tags: every live deploy since the last tag carries its release on origin');
    return 0;
  }
  for (const t of todo) {
    console.log(`tags: ${t.tag} at ${t.commit.slice(0, 7)} (the live deploy of ${t.deploy.time || '?'})`);
    if (!argv.includes('--push')) continue;
    git('tag', '-a', t.tag, t.commit, '-m', `E.V. ${t.tag} (the live deploy at ${t.commit.slice(0, 7)}, D-173)`);
    git('push', '-q', 'origin', `refs/tags/${t.tag}`);
  }
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exit(main(process.argv.slice(2)));
