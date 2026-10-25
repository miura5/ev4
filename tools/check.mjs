#!/usr/bin/env node
// Every check, in the order they must run (B-101): npm test, the build, the page harnesses (core.cjs alone: it
// measures frame times, so nothing runs beside it), then the look pass's
// phone and desktop screenshots. Stops at the first failure and names it.
//   npm run check [-- --record <dir>] [--shots <dir>] [--touched [--since <sha>]]
// --touched (B-219, Matt Oct 22): npm test, the build, and only the harnesses whose paths the change since the last
// staging deploy touched (harnessesFor below; a path it does not know runs them all), the look pass at the four first
// sizes. The full check stays the nightly (nightly.yml) and the gate before live: a full GREEN writes
// dist/check-full.json for the build's commit, and ship live refuses a commit without it or a green nightly (R-06).
// --record: a folder of <collection>/<id>.json for the harnesses (default: the synthetic record, built fresh by
// test/data/synthetic.cjs; a real export stays outside the repository). --shots: where screenshots go (default
// /tmp/ev4-check).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { SIZES, FIRST, missingShots } = createRequire(import.meta.url)('../test/harness/views.cjs');
const opt = (argv, name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : dflt;
};

export const HARNESSES = ['shell', 'components', 'run', 'captions', 'prep', 'core', 'greet', 'look'];
const ALL = HARNESSES;
const PAGE = ['shell', 'run', 'captions', 'prep', 'greet', 'look']; // everything that boots the page but core's timing
// Paths no harness reads: the record of the work, the docs, CI, the Chart and every tool but the build. npm test runs
// the *.test.mjs files whatever the change.
const NONE = [
  /^chart\//,
  /\.md$/,
  /^\.github\//,
  /^\.claude\//,
  /^tools\/(?!build\.mjs$)/,
  /^test\/[^/]+\.test\.mjs$/,
  /^test\/helpers\.mjs$/,
  /^studywatch\//,
  /^scripts\//,
  /^\.prettier/,
  /^\.gitignore$/,
];
// Each page part (page/app/NN-*.js, by its number) to the harnesses that drive it; the look pass shoots every tab.
const PARTS = {
  '00': ALL,
  '01': ALL,
  '02': PAGE,
  '03': PAGE,
  '04': PAGE,
  '05': ['run', 'look'],
  10: ['run', 'prep', 'look'],
  20: ['run', 'look'],
  30: ['run', 'look'],
  40: ['run', 'look'],
  50: ['run', 'look'],
  60: ALL,
  61: ['run', 'captions', 'look'],
  62: ['run', 'captions', 'look'],
  63: ['run', 'prep', 'look'],
  64: ['run', 'captions', 'core', 'look'],
  65: ['run', 'look'],
  66: ['run', 'look'],
  67: ['run', 'captions', 'look'],
  68: ['run', 'captions', 'look'],
  69: ['run', 'look'],
  70: ['run', 'captions', 'look'],
  71: ['run', 'look'],
  72: ['run', 'captions', 'greet', 'look'],
  73: ['run', 'captions', 'prep', 'greet', 'look'],
  74: ['run', 'captions', 'look'],
  75: ['run', 'captions', 'prep', 'look'],
  90: ['run', 'look'],
  91: ['run', 'look'],
};
/** B-219: the harnesses a change to these paths needs, in check's order; an unknown path needs every one. */
export function harnessesFor(paths) {
  const need = new Set();
  for (const p of paths) {
    if (NONE.some(re => re.test(p))) continue;
    let m;
    if (p === 'test/harness/components.cjs')
      ['components', 'look'].forEach(h => need.add(h)); // B-285: look uses its checks
    else if ((m = p.match(/^test\/harness\/([a-z]+)\.cjs$/)) && HARNESSES.includes(m[1])) need.add(m[1]);
    else if (/^test\/harness\/(views|contrast)\.cjs$/.test(p)) need.add('look');
    else if (p === 'page/styles.css') ['components', 'run', 'captions', 'prep', 'look'].forEach(h => need.add(h));
    else if ((m = p.match(/^page\/app\/(\d\d)-[a-z0-9-]+\.js$/)) && PARTS[m[1]]) PARTS[m[1]].forEach(h => need.add(h));
    else ALL.forEach(h => need.add(h));
  }
  return HARNESSES.filter(h => need.has(h));
}
/** The files changed since the base commit, committed or not. */
export function changedSince(root, base) {
  const g = a => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  const out = new Set(g(['diff', '--name-only', base, 'HEAD']).split('\n').filter(Boolean));
  for (const l of g(['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean))
    out.add(l.slice(3).replace(/^.* -> /, ''));
  return [...out].sort();
}
/** The last staging deploy's commit in the Chart. */
export function lastStaging(root) {
  const d = JSON.parse(fs.readFileSync(path.join(root, 'chart', 'deploys.json'), 'utf8'));
  return ((Array.isArray(d) ? d : d.deploys).filter(x => x.target === 'staging').at(-1) || {}).commit;
}

/** The steps, in order, as [name, command, args]. With only, the harnesses in it (npm test and the build always). */
export function steps({ record, shots, only = null }) {
  const h = (name, ...a) => [name, process.execPath, [path.join('test', 'harness', name + '.cjs'), ...a]];
  return [
    [
      'npm test',
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
    ],
    ['build', process.execPath, ['tools/build.mjs']],
    h('shell', record, path.join(shots, 'shell')),
    h('components', record, path.join(shots, 'components')), // B-285: the component set's own sheet
    h('run', record, path.join(shots, 'run')),
    h('captions', record, path.join(shots, 'captions')),
    h('prep', record, path.join(shots, 'prep')),
    h('core', record, path.join(shots, 'core')),
    h('greet', record, path.join(shots, 'greet')),
    h('look', record, path.join(shots, 'look')),
  ].filter(([name, , args]) => {
    const h = path.basename(args[0] || '', '.cjs');
    return !only || !HARNESSES.includes(h) || only.includes(h);
  });
}

export function main(argv = process.argv.slice(2)) {
  const shots = opt(argv, 'shots', '/tmp/ev4-check');
  // Without --record each harness writes its own synthetic record as it starts (recordDir('synthetic')), anchored to the
  // day it runs on: one record written at the start went stale for the harnesses after midnight (B-113).
  const record = opt(argv, 'record', null) || 'synthetic';
  const touched = argv.includes('--touched');
  let only = null;
  if (touched) {
    const base = (argv.includes('--since') && argv[argv.indexOf('--since') + 1]) || lastStaging(ROOT);
    const files = changedSince(ROOT, base);
    only = harnessesFor(files);
    console.log(
      `check --touched: ${files.length} file${files.length === 1 ? '' : 's'} changed since ${String(base).slice(0, 7)}; harnesses: ${only.join(', ') || 'none'} (the full set runs nightly and before live)`
    );
    // The look pass at the four sizes every proof looks at.
    if (only.includes('look') && !process.env.LOOK_SIZES) process.env.LOOK_SIZES = FIRST.join(',');
  }
  if (record !== 'synthetic' && !fs.existsSync(record)) {
    console.error(`check: no record at ${record}`);
    return 2;
  }
  for (const [name, cmd, args] of steps({ record, shots, only })) {
    const t = Date.now();
    console.log(`\n== ${name}`);
    const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      console.log(`\ncheck: RED at ${name} (exit ${r.status ?? r.signal})`);
      return 1;
    }
    console.log(`== ${name}: ok (${Math.round((Date.now() - t) / 1000)} s)`);
  }
  if (touched && !only.includes('look')) {
    console.log(
      '\ncheck --touched: GREEN (no look pass: the change touched no page). The full set runs nightly and before live.'
    );
    return 0;
  }
  const look = path.join(shots, 'look');
  const files = fs
    .readdirSync(look)
    .filter(f => f.endsWith('.png'))
    .sort();
  // B-113: one screenshot per view per size, or the look pass missed a view (in --touched, per view at its sizes).
  const missing = missingShots(
    files,
    fs.readFileSync(path.join(ROOT, 'dist', 'page', 'staging', 'index.html'), 'utf8'),
    touched ? FIRST : null
  );
  if (missing.length) {
    console.log(
      `\ncheck: RED at look: no screenshot for ${missing.length} view${missing.length === 1 ? '' : 's'} at a size: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}`
    );
    return 1;
  }
  // B-219 (R-06): a full GREEN on a clean tree is the record ship live reads for this build's commit.
  if (!touched && !process.env.LOOK_SIZES) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'manifest.json'), 'utf8'));
    if (!m.dirty)
      fs.writeFileSync(
        path.join(ROOT, 'dist', 'check-full.json'),
        JSON.stringify({ commit: m.commit, release: m.release, at: new Date().toISOString(), record }, null, 1)
      );
  }
  console.log(`\ncheck${touched ? ' --touched' : ''}: GREEN. Look at the screenshots in ${look}, these first:`);
  for (const tag of FIRST) console.log(`  ${tag}: ${files.filter(f => f.endsWith(`-${tag}.png`)).join(', ')}`);
  if (touched) return 0;
  console.log(
    `  then the other sizes (${SIZES.filter(s => !FIRST.includes(s.tag))
      .map(s => s.tag)
      .join(', ')}): ${files.filter(f => !FIRST.some(t => f.endsWith(`-${t}.png`))).length} more`
  );
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
