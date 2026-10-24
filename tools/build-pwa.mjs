#!/usr/bin/env node
// The PWA demo's page (pwa/public/), from the staging page the main build writes (dist/page/staging/).
// It wraps the shell in the document claude.ai adds at publish, and puts the shim (pwa/bridge.js) first, so
// window.claude exists before the page asks for it. Run `node tools/build.mjs` first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'dist/page/staging');
const pwa = path.join(root, 'pwa');
const out = path.join(pwa, 'public');
if (!fs.existsSync(path.join(from, 'index.html')))
  throw new Error('no dist/page/staging/: run node tools/build.mjs first');

// Emptied, not removed: `wrangler dev` keeps watching the folder itself.
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
for (const f of fs.readdirSync(from)) if (f !== 'index.html') fs.copyFileSync(path.join(from, f), path.join(out, f));
for (const f of ['bridge.js', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'])
  fs.copyFileSync(path.join(pwa, f), path.join(out, f));

const head =
  '<!doctype html><html lang=en><head><meta charset=utf-8>' +
  '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<link rel=manifest href="manifest.webmanifest"><link rel=apple-touch-icon href="icon-192.png">' +
  '<meta name=apple-mobile-web-app-capable content=yes><meta name=mobile-web-app-capable content=yes>' +
  '<meta name=apple-mobile-web-app-status-bar-style content=black-translucent><meta name=theme-color content="#1c1a17">' +
  '<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>' +
  '<script src="bridge.js"></script></head><body>';
fs.writeFileSync(
  path.join(out, 'index.html'),
  head + fs.readFileSync(path.join(from, 'index.html'), 'utf8') + '</body></html>'
);
console.log('pwa/public/ written: ' + fs.readdirSync(out).join(', '));
