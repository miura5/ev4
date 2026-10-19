#!/usr/bin/env node
// The demo copy of E.V. Home (B-83): the live build's published files, unchanged, behind a shell whose one door to
// claude.use is swapped for demo.js. demo.js holds a made-up record built fresh on every open (demo/seed.js) and an
// in-memory stand-in for the database, Claude and the connectors with scripted replies (demo/runtime.js). Nothing it
// does leaves the viewer's tab: no record, no scheduled task, no Mac, no Claude call. A reload starts it over.
//   node tools/build.mjs && node tools/demo.mjs      -> dist/page/demo/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOOR = /const use = n => \(window\.claude && typeof window\.claude\.use === 'function'\) \? Promise\.resolve\(window\.claude\.use\(n\)\)\.catch\(\(\) => null\) : Promise\.resolve\(null\);/;

/** The demo page from the live page's files: {file: text} in, {file: text} out. */
export function demoPage(live, { seed, runtime }) {
  const shell = live['index.html'];
  if (!DOOR.test(shell)) throw new Error('the shell’s claude.use line changed; update tools/demo.mjs');
  const at = shell.indexOf('<script>\n// E.V. Home shell');
  if (at < 0) throw new Error('the shell’s boot script was not found; update tools/demo.mjs');
  let demo = shell.replace(DOOR, 'const use = n => Promise.resolve(window.EVDemo.use(n)).catch(() => null);');
  demo = demo.replace(/<title>[^<]*<\/title>/, '<title>E.V. Home Demo</title>');
  const i = demo.indexOf('<script>\n// E.V. Home shell');
  demo = demo.slice(0, i) + '<script src="demo.js"></script>\n' + demo.slice(i);
  if (/window\.claude/.test(demo)) throw new Error('the demo shell still reaches window.claude');
  return { ...live, 'index.html': demo, 'demo.js': seed + '\n' + runtime };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const src = path.join(ROOT, 'dist/page/live'), out = path.join(ROOT, 'dist/page/demo');
  if (!fs.existsSync(path.join(src, 'index.html'))) { console.error('no dist/page/live: run node tools/build.mjs first'); process.exit(1); }
  const live = Object.fromEntries(fs.readdirSync(src).map(f => [f, fs.readFileSync(path.join(src, f), 'utf8')]));
  const files = demoPage(live, { seed: fs.readFileSync(path.join(ROOT, 'demo/seed.js'), 'utf8'), runtime: fs.readFileSync(path.join(ROOT, 'demo/runtime.js'), 'utf8') });
  fs.mkdirSync(out, { recursive: true });
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(out, f), body);
  console.log('demo page -> ' + path.relative(ROOT, out) + ': ' + Object.keys(files).join(', '));
}
