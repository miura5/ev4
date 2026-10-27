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
// B-427: a build after a release, v4.x.y+n: its base tag is made at the commit ship names, and the checkout must then
// describe as exactly this release (the base commit an ancestor of it, n commits past)
export const BUILD_RELEASE = /^(v4\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5}))(?:\+([1-9]\d{0,5}))?$/;
export const COMMIT = /^[0-9a-f]{40}$/;

/** The input refusal, or null when both inputs are whole and well formed (an empty release is allowed: nothing to do). */
export function releaseInputRefusal(release, commit) {
  const r = String(release ?? '');
  if (r === '') return null;
  if (!BUILD_RELEASE.test(r)) return `release ${JSON.stringify(r)} is not v4.x.y or v4.x.y+n`;
  if (!COMMIT.test(String(commit ?? '')))
    return `commit ${JSON.stringify(String(commit ?? ''))} is not 40 hex characters`;
  return null;
}

/** Make the release tag at the commit in the repository at root: {ok, line}. */
export function releaseTag({ root, release, commit }) {
  const refused = releaseInputRefusal(release, commit);
  if (refused) return { ok: false, line: refused };
  if (!release) return { ok: true, line: 'no release named' };
  const base = BUILD_RELEASE.exec(release)[1];
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
    tagged = git('rev-parse', '--verify', '-q', `refs/tags/${base}^{commit}`);
  } catch {
    /* no such tag yet */
  }
  if (tagged && tagged !== at)
    return {
      ok: false,
      line: `${base} is already at another commit (${tagged.slice(0, 7)}, not ${at.slice(0, 7)})`,
    };
  if (!tagged)
    git(
      '-c',
      'user.name=E.V. CI',
      '-c',
      'user.email=ci@example.invalid',
      'tag',
      '-a',
      base,
      at,
      '-m',
      `E.V. ${base} (made in this runner only, D-343)`
    );
  // B-427: the checkout must build exactly ship's release: the tag's commit an ancestor of it, and its describe equal
  try {
    git('merge-base', '--is-ancestor', at, 'HEAD');
  } catch {
    return { ok: false, line: `${base}'s commit ${at.slice(0, 7)} is not an ancestor of the checkout` };
  }
  let d = '';
  try {
    d = git('describe', '--tags', '--long', '--match', 'v4.*', 'HEAD');
  } catch {
    /* no tag reachable */
  }
  const m = /^(v4\.\d+\.\d+)-(\d+)-g[0-9a-f]+$/.exec(d);
  const built = m ? (m[2] === '0' ? m[1] : `${m[1]}+${m[2]}`) : '(none)';
  if (built !== release) return { ok: false, line: `the checkout builds as ${built}, not ship's ${release}` };
  return { ok: true, line: `release ${release} (${base} at ${at.slice(0, 7)}${tagged ? ', already tagged' : ''})` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [release = '', commit = ''] = process.argv.slice(2);
  const r = releaseTag({ root: process.cwd(), release, commit });
  console.log(r.line);
  process.exit(r.ok ? 0 : 1);
}
