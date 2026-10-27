#!/usr/bin/env node
// D-343 (B-420): the app workflows' release-tag step, in one tested place. A cloud session's git proxy keeps a release
// tag ship made local, and the app workflows check out from origin, so the runner would build the release as the next
// one. ship names the tag (appCalls, -f release=v4.x.y) and this makes it again in the runner, at the same commit,
// before the build; a tag of that name already at another commit is refused.
//
//   node tools/release-tag.mjs <release> <commit>    run in pwa-staging.yml and pwa-live.yml's build jobs only
//
// No release named is nothing to do. The whole of each input is checked: the release is exactly v4.<n>.<n> and the
// commit exactly 40 lowercase hex characters, so nothing else reaches git. Node built-ins only: it runs before npm ci.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE = /^v4\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
export const COMMIT = /^[0-9a-f]{40}$/;

/** The input refusal, or null when both inputs are whole and well formed (an empty release is allowed: nothing to do). */
export function releaseInputRefusal(release, commit) {
  const r = String(release ?? '');
  if (r === '') return null;
  if (!RELEASE.test(r)) return `release ${JSON.stringify(r)} is not v4.x.y`;
  if (!COMMIT.test(String(commit ?? '')))
    return `commit ${JSON.stringify(String(commit ?? ''))} is not 40 hex characters`;
  return null;
}

/** Make the release tag at the commit in the repository at root: {ok, line}. */
export function releaseTag({ root, release, commit }) {
  const refused = releaseInputRefusal(release, commit);
  if (refused) return { ok: false, line: refused };
  if (!release) return { ok: true, line: 'no release named' };
  const git = (...a) =>
    execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let at;
  try {
    at = git('rev-parse', '--verify', '-q', `${commit}^{commit}`);
  } catch {
    return { ok: false, line: `commit ${commit.slice(0, 7)} is not in this checkout` };
  }
  let tagged = null;
  try {
    tagged = git('rev-parse', '--verify', '-q', `refs/tags/${release}^{commit}`);
  } catch {
    /* no such tag yet */
  }
  if (tagged && tagged !== at)
    return {
      ok: false,
      line: `${release} is already at another commit (${tagged.slice(0, 7)}, not ${at.slice(0, 7)})`,
    };
  if (!tagged)
    git(
      '-c',
      'user.name=E.V. CI',
      '-c',
      'user.email=ci@example.invalid',
      'tag',
      '-a',
      release,
      at,
      '-m',
      `E.V. ${release} (made in this runner only, D-343)`
    );
  return { ok: true, line: `release ${release} at ${at.slice(0, 7)}${tagged ? ' (already tagged)' : ''}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [release = '', commit = ''] = process.argv.slice(2);
  const r = releaseTag({ root: process.cwd(), release, commit });
  console.log(r.line);
  process.exit(r.ok ? 0 : 1);
}
