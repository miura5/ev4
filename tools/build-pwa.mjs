#!/usr/bin/env node
// The app's page (pwa/public/), from the page the main build writes for one record (dist/page/<record>/).
//   node tools/build-pwa.mjs --record staging|live [--out <dir>]
// It wraps that record's built page, byte for byte, in the document claude.ai adds at publish, and puts the shim
// (pwa/bridge.js) first, so window.claude exists before the page asks for it. The app is named "E.V.": its window
// title and icon label come from the wrapper's head, ahead of the page's own title. Run `node tools/build.mjs` first.
// B-324: beside the shim, the app's job runner (pwa/jobs.mjs) and the core modules it imports, served as ES modules at
// the paths they have in the repository (jobs.mjs at the root, core/ beside it), with an import map that gives node:fs
// node:path and node:url their browser stand-ins; and jobs-spec.json, the spec sections and schemas the runner reads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEC_KEYS } from '../pwa/jobs.mjs';
import { STAGING_REFERENCE } from './build.mjs';

export const RECORDS = ['staging', 'live'];
export const NAME = 'E.V.';
// B-490: the icons are her idle avatar, made by tools/pwa-icons.mjs and kept in pwa/.
export const ICON_FILES = [
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon.svg',
  'favicon-32.png',
];
export const GALLERY_PAGE = 'gallery.html';
export const SHIM = ['bridge.js', 'sw.js', 'manifest.webmanifest', ...ICON_FILES];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HEAD =
  '<!doctype html><html lang=en><head><meta charset=utf-8>' +
  `<title>${NAME}</title>` +
  '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<link rel=manifest href="manifest.webmanifest"><link rel=apple-touch-icon href="apple-touch-icon.png">' +
  '<link rel=icon href="favicon.svg" type="image/svg+xml"><link rel=icon href="favicon-32.png" sizes="32x32">' +
  `<meta name=apple-mobile-web-app-title content="${NAME}"><meta name=application-name content="${NAME}">` +
  '<meta name=apple-mobile-web-app-capable content=yes><meta name=mobile-web-app-capable content=yes>' +
  '<meta name=apple-mobile-web-app-status-bar-style content=black-translucent><meta name=theme-color content="#1c1a17">' +
  '<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>' +
  '<script type=importmap>{"imports":{"node:fs":"./node-fs.mjs","node:path":"./node-path.mjs","node:url":"./node-url.mjs"}}</script>' +
  '<script src="bridge.js"></script></head><body>';
export const FOOT = '</body></html>';

// The wrapped document: the head, then the record's built page exactly as the build wrote it, then the foot.
export const wrap = page => Buffer.concat([Buffer.from(HEAD), page, Buffer.from(FOOT)]);

/** B-324: the runner and every module it imports, by relative import, as repository paths (pwa/jobs.mjs first). */
export function jobModules(root = ROOT, entry = 'pwa/jobs.mjs') {
  const seen = [];
  const walk = rel => {
    if (seen.includes(rel)) return;
    seen.push(rel);
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm))
      walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
  };
  walk(entry);
  return seen;
}
/** Where a module is served: pwa/<f> at the root, core/<f> under core/ (so '../core/x' from the root resolves). */
export const servedAt = rel => (rel.startsWith('pwa/') ? rel.slice(4) : rel);
export const JOB_SHIMS = ['node-fs.mjs', 'node-path.mjs', 'node-url.mjs'];

export function jobsSpec(root = ROOT) {
  const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8'));
  const dir = path.join(root, 'spec/schemas');
  const schemas = {};
  for (const f of fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.schema.json'))
    .sort())
    schemas[f.slice(0, -'.schema.json'.length)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return { spec: Object.fromEntries(SPEC_KEYS.map(k => [k, spec[k]])), schemas };
}

/** B-434: the page's stylesheet and scripts asked for under the release's name (styles.css?v=<release>), so a browser or
 * installed app that kept an earlier copy never pairs this release's scripts with an older stylesheet. */
export function releaseKeyed(html) {
  const m = String(html).match(/<meta name="ev-release" content="([^"]+)">/);
  if (!m) throw new Error('build-pwa: the page names no release (meta ev-release)');
  const v = encodeURIComponent(m[1]);
  let out = String(html)
    .replace('<link rel="stylesheet" href="styles.css">', `<link rel="stylesheet" href="styles.css?v=${v}">`)
    .replace(
      "await script('core.js'); await script('app.js');",
      `await script('core.js?v=${v}'); await script('app.js?v=${v}');`
    );
  for (const f of ['styles.css', 'core.js', 'app.js'])
    if (!out.includes(f + '?v=' + v)) throw new Error('build-pwa: could not key ' + f + ' to the release');
  return out;
}

export function buildPwa({ record, root = ROOT, out = path.join(root, 'pwa', 'public') } = {}) {
  if (!RECORDS.includes(record)) throw new Error('build-pwa: --record must be one of ' + RECORDS.join(', '));
  const from = path.join(root, 'dist/page', record);
  if (!fs.existsSync(path.join(from, 'index.html')))
    throw new Error(`no dist/page/${record}/: run node tools/build.mjs first`);
  // Emptied, not removed: `wrangler dev` keeps watching the folder itself.
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
  for (const f of fs.readdirSync(from)) if (f !== 'index.html') fs.copyFileSync(path.join(from, f), path.join(out, f));
  for (const f of SHIM) fs.copyFileSync(path.join(root, 'pwa', f), path.join(out, f));
  for (const rel of jobModules(root)) {
    const to = path.join(out, servedAt(rel));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, rel), to);
  }
  for (const f of JOB_SHIMS) fs.copyFileSync(path.join(root, 'pwa', f), path.join(out, f));
  fs.writeFileSync(path.join(out, 'jobs-spec.json'), JSON.stringify(jobsSpec(root)));
  const page = releaseKeyed(wrap(fs.readFileSync(path.join(from, 'index.html'))));
  fs.writeFileSync(path.join(out, 'index.html'), page);
  // B-506 (D-371): the Gallery's own address on staging, /gallery: the same app (signed in as staging always is), which
  // opens the Gallery over itself there. Live has no such file, and its app.js has no Gallery.
  if (record === 'staging') fs.writeFileSync(path.join(out, GALLERY_PAGE), page);
  // D-392 to D-395: the UI polish reference at /reference on staging only (README.md stays in the repository).
  if (record === 'staging')
    fs.cpSync(path.join(root, STAGING_REFERENCE.from), path.join(out, STAGING_REFERENCE.at), {
      recursive: true,
      filter: f => !f.endsWith('.md'),
    });
  return { record, from, out, files: fs.readdirSync(out) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    opt = k => {
      const i = args.indexOf(k);
      return i >= 0 ? args[i + 1] : null;
    };
  try {
    const r = buildPwa({ record: opt('--record'), ...(opt('--out') ? { out: path.resolve(opt('--out')) } : {}) });
    console.log(`pwa: ${path.relative(ROOT, r.out) || r.out} written from the ${r.record} page: ${r.files.join(', ')}`);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
