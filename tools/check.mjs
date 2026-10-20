#!/usr/bin/env node
// Every check, in the order they must run (B-101): npm test, the build, the page harnesses (core.cjs alone: it
// measures frame times, so nothing runs beside it), the demo (tools/demo.mjs builds it first), then the look pass's
// phone and desktop screenshots. Stops at the first failure and names it.
//   npm run check [-- --record <dir>] [--shots <dir>]
// --record: a folder of <collection>/<id>.json for the harnesses (default: the synthetic record, built fresh by
// test/data/synthetic.cjs; a real export stays outside the repository). --shots: where screenshots go (default
// /tmp/ev4-check).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = (argv, name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : dflt; };

/** The steps, in order, as [name, command, args]. */
export function steps({ record, shots }) {
  const h = (name, ...a) => [name, process.execPath, [path.join('test', 'harness', name + '.cjs'), ...a]];
  return [
    ['npm test', process.execPath, ['--test', ...fs.readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join('test', f))]],
    ['build', process.execPath, ['tools/build.mjs']],
    h('shell', record, path.join(shots, 'shell')),
    h('run', record, path.join(shots, 'run')),
    h('captions', record, path.join(shots, 'captions')),
    h('core', record, path.join(shots, 'core')),
    ['demo build', process.execPath, ['tools/demo.mjs']],
    h('demo', path.join(shots, 'demo')),
    h('look', record, path.join(shots, 'look')),
  ];
}

export function main(argv = process.argv.slice(2)) {
  const shots = opt(argv, 'shots', '/tmp/ev4-check');
  const record = opt(argv, 'record', null) || createRequire(import.meta.url)('../test/data/synthetic.cjs').recordDir();
  if (!fs.existsSync(record)) { console.error(`check: no record at ${record}`); return 2; }
  for (const [name, cmd, args] of steps({ record, shots })) {
    const t = Date.now();
    console.log(`\n== ${name}`);
    const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) { console.log(`\ncheck: RED at ${name} (exit ${r.status ?? r.signal})`); return 1; }
    console.log(`== ${name}: ok (${Math.round((Date.now() - t) / 1000)} s)`);
  }
  const look = path.join(shots, 'look');
  const files = fs.readdirSync(look).filter(f => f.endsWith('.png')).sort();
  console.log(`\ncheck: GREEN. Look at the screenshots in ${look}:`);
  for (const w of ['phone', 'desktop']) console.log(`  ${w}: ${files.filter(f => f.endsWith(`-${w}.png`)).join(', ')}`);
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
