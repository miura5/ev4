// B-184 (D-200): the hard line. A builder session (an unattended ev4-builder run) knows itself by the marker its first
// step writes, /tmp/ev/builder-run ({at, head}: when the run started and main's head then; the pipeline marker's
// pattern, D-169). Under it, a commit that touches a guarded path (spec.boundaries.guarded) is refused at the push by
// log, plan and ship, and fails npm test (test/guard.test.mjs); log decision refuses a tenet; deploy prints no
// create_trigger or update_trigger. A hand chat writes no marker, so with Matt present it keeps its powers. The marker
// is self-declared: it guards a well-meaning session against a mistake, not an adversarial one (v5's trust harness).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUILDER_MARKER = '/tmp/ev/builder-run';
const MAX_HOURS = 12; // a builder run is far shorter; an older marker is a leftover, not this session

/** The builder run this session is, from its marker while it is fresh; null in a hand chat. */
export function builderRun({ file = process.env.EV_BUILDER_MARKER || BUILDER_MARKER, now = Date.now() } = {}) {
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const at = Date.parse(m && m.at);
  if (!Number.isFinite(at) || at > now + 5 * 60e3 || now - at >= MAX_HOURS * 36e5) return null;
  return { at: m.at, head: typeof m.head === 'string' && /^[0-9a-f]{7,40}$/.test(m.head) ? m.head : null };
}

const git = (root, a) => String(execFileSync('git', ['-C', root, ...a], { stdio: 'pipe', maxBuffer: 64 << 20 }));
const show = (root, rev, file) => {
  try {
    return git(root, ['show', `${rev}:${file}`]);
  } catch {
    return null;
  }
};
const json = s => {
  try {
    return s == null ? null : JSON.parse(s);
  } catch {
    return null;
  }
};
/** The text of a markdown section from its heading to the next heading of the same or a higher level. */
export function sectionOf(text, heading) {
  const lines = String(text || '').split('\n');
  const i = lines.findIndex(l => l.trim() === heading);
  if (i < 0) return null;
  const level = heading.match(/^#+/)[0].length;
  let j = i + 1;
  while (j < lines.length && !(/^#+ /.test(lines[j]) && lines[j].match(/^#+/)[0].length <= level)) j++;
  return lines.slice(i, j).join('\n');
}
/** The guarded list as the spec at a revision has it. */
export function guardedOf(spec) {
  const g = (spec && spec.boundaries && spec.boundaries.guarded) || {};
  return { files: g.files || [], spec: g.spec || [], sections: g.sections || [], decisions: g.decisions || null };
}
/** Tenets, and decisions that supersede or amend one, whose record differs between two decisions.json texts. */
export function tenetChanges(before, after) {
  const a = json(before) || [],
    b = json(after) || [];
  const byId = new Map(a.map(d => [d.id, d]));
  const tenets = new Set([...a, ...b].filter(d => d.kind === 'tenet').map(d => d.id));
  const touches = d =>
    d && (d.kind === 'tenet' || [...(d.supersedes || []), ...(d.amends || [])].some(x => tenets.has(x)));
  const ids = new Set([...a, ...b].map(d => d.id));
  return [...ids].filter(id => {
    const x = byId.get(id),
      y = b.find(d => d.id === id);
    return (touches(x) || touches(y)) && JSON.stringify(x || null) !== JSON.stringify(y || null);
  });
}
/** What a range of commits changes on the guarded list: one line each, empty when nothing guarded moved. */
export function guardedChanges(root = ROOT, from, to = 'HEAD') {
  // Both revisions' lists: emptying the list in the same range guards nothing less.
  const [ga, gb] = [from, to].map(r => guardedOf(json(show(root, r, 'spec/ev.spec.json'))));
  const uniq = (xs, key = JSON.stringify) => [...new Map(xs.map(x => [key(x), x])).values()];
  const g = {
    files: uniq([...ga.files, ...gb.files]),
    spec: uniq([...ga.spec, ...gb.spec]),
    sections: uniq([...ga.sections, ...gb.sections]),
    decisions: ga.decisions || gb.decisions,
  };
  const changed = new Set(git(root, ['diff', '--name-only', from, to]).split('\n').filter(Boolean));
  const out = g.files.filter(f => changed.has(f)).map(f => `${f} changed`);
  if (changed.has('spec/ev.spec.json')) {
    const a = json(show(root, from, 'spec/ev.spec.json')) || {},
      b = json(show(root, to, 'spec/ev.spec.json')) || {};
    for (const k of g.spec) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`spec.${k} changed`);
  }
  for (const s of g.sections)
    if (
      changed.has(s.file) &&
      sectionOf(show(root, from, s.file), s.heading) !== sectionOf(show(root, to, s.file), s.heading)
    )
      out.push(`${s.file} "${s.heading.replace(/^#+ /, '')}" changed`);
  if (g.decisions === 'tenet' && changed.has('chart/decisions.json')) {
    const ids = tenetChanges(show(root, from, 'chart/decisions.json'), show(root, to, 'chart/decisions.json'));
    if (ids.length) out.push(`tenets changed: ${ids.join(', ')}`);
  }
  return out;
}
/** The start of a builder run's own commits: the head its marker names, else origin/main, else nothing. */
export function runBase(root, run) {
  for (const rev of [run && run.head, 'origin/main'].filter(Boolean))
    try {
      return git(root, ['rev-parse', '--verify', '-q', rev + '^{commit}']).trim();
    } catch {
      /* not here */
    }
  return null;
}
/** Under the builder marker: why a push of this repository's head is refused (null when it is not). */
export function pushRefusal(root = ROOT, run = builderRun()) {
  if (!run) return null;
  const base = runBase(root, run);
  if (!base) return null;
  const found = guardedChanges(root, base, 'HEAD');
  return found.length
    ? `a builder run never changes a guarded path (D-200): ${found.join('; ')}. It reaches main only from a chat with Matt present`
    : null;
}
