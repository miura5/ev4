#!/usr/bin/env node
// B-490: the app's icons are her avatar at idle, drawn by the page's own Dial Arc (page/app/60-ev-conversation.js's
// CORE, run as written in Chromium) in the light theme's colours (page/theme.js: --av1 on --bg), centred on her drawn
// shape. One drawing, five files in pwa/, committed beside the shim (build-pwa copies them; SHIM names them):
//   icon-192.png, icon-512.png   manifest, purpose any: the ring at 64% on a cream rounded tile
//   icon-maskable-512.png        manifest, purpose maskable: full-bleed cream, the ring inside the central 80% circle
//   apple-touch-icon.png         180, full-bleed cream with no transparency (iOS rounds it itself)
//   favicon.svg, favicon-32.png  the browser tab: the same tile as the any icons
// Run it again only when her drawing or her colours change: node tools/pwa-icons.mjs [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/** The Dial Arc's source, sliced from the page as written: the CORE closure, nothing else of the page. */
export function coreSource(root = ROOT) {
  const src = fs.readFileSync(path.join(root, 'page/app/60-ev-conversation.js'), 'utf8');
  const a = src.indexOf('const CORE = (() => {'),
    b = src.indexOf('window.EVApp.core = CORE;');
  if (a < 0 || b < a) throw new Error('pwa-icons: CORE not found in page/app/60-ev-conversation.js');
  return src.slice(a, b);
}

/** The light theme at the default contrast: her solid face and the ground she sits on. */
export function colours(root = ROOT) {
  const m = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'page/theme.js'), 'utf8'), { module: m });
  const T = m.exports;
  const v = T.vars(T.genTheme('light', 60));
  return { av1: v['--av1'], av2: v['--av2'], bg: v['--bg'] };
}

// The icons: size, how much of it her ring spans, the background's shape.
//   ring: the drawn shape's larger side as a share of the icon (any, apple, favicon)
//   safe: the farthest drawn point from the centre as a share of the icon (maskable: inside the 40% radius)
//   tile: a rounded tile (radius as a share), or 'bleed' for a full square
export const ICONS = [
  { file: 'icon-192.png', size: 192, ring: 0.64, tile: 0.22 },
  { file: 'icon-512.png', size: 512, ring: 0.64, tile: 0.22 },
  { file: 'icon-maskable-512.png', size: 512, safe: 0.33, tile: 'bleed' },
  { file: 'apple-touch-icon.png', size: 180, ring: 0.62, tile: 'bleed' },
  { file: 'favicon-32.png', size: 32, ring: 0.74, tile: 0.22 },
];
export const FAVICON_SVG = { file: 'favicon.svg', size: 64, ring: 0.74, tile: 0.22 };

/** Her idle drawing: the paths the page paints, settled, as {cls, d, opacity}, with their box and farthest point. */
async function idleDrawing(page, root) {
  await page.setContent('<!doctype html><html><head></head><body></body></html>');
  return page.evaluate(src => {
    // eslint-disable-next-line no-new-func
    const CORE = new Function(src + '; return CORE;')();
    const c = CORE.make(512, { mood: 'idle', still: true });
    document.body.append(c.el);
    const paths = [...c.body.childNodes]
      .filter(p => p.getAttribute('d'))
      .map(p => ({ cls: p.getAttribute('class'), d: p.getAttribute('d'), opacity: p.getAttribute('opacity') }));
    const box = c.body.getBBox();
    const cx = box.x + box.width / 2,
      cy = box.y + box.height / 2;
    let far = 0;
    for (const p of c.body.childNodes) {
      const n = p.getTotalLength ? p.getTotalLength() : 0;
      for (let i = 0; i <= 400; i++) {
        const q = p.getPointAtLength((n * i) / 400);
        far = Math.max(far, Math.hypot(q.x - cx, q.y - cy));
      }
    }
    return { paths, box: { x: box.x, y: box.y, w: box.width, h: box.height }, cx, cy, far };
  }, coreSource(root));
}

/** One icon's SVG: the background, then her drawing scaled and centred on its own box. */
export function iconSvg(icon, drawing, col) {
  const { size } = icon,
    { box, cx, cy, far } = drawing;
  const scale = icon.safe ? (icon.safe * size) / far : (icon.ring * size) / Math.max(box.w, box.h);
  const fill = { c1: col.av1, c2: col.av2, under: col.bg };
  const r = icon.tile === 'bleed' ? 0 : +(icon.tile * size).toFixed(2);
  const bg =
    icon.tile === 'bleed'
      ? `<rect width="${size}" height="${size}" fill="${col.bg}"/>`
      : `<rect width="${size}" height="${size}" rx="${r}" fill="${col.bg}"/>`;
  const paths = drawing.paths
    .map(
      p => `<path d="${p.d}" fill="${fill[p.cls] || col.av1}"${p.opacity === '1' ? '' : ` opacity="${p.opacity}"`}/>`
    )
    .join('');
  const t = `translate(${+(size / 2).toFixed(3)} ${+(size / 2).toFixed(3)}) scale(${+scale.toFixed(5)}) translate(${+(-cx).toFixed(3)} ${+(-cy).toFixed(3)})`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `${bg}<g transform="${t}">${paths}</g></svg>`
  );
}

export async function makeIcons({ root = ROOT, out = path.join(root, 'pwa') } = {}) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const drawing = await idleDrawing(page, root);
    if (!drawing.paths.length) throw new Error('pwa-icons: her idle drawing is empty');
    const col = colours(root);
    const written = [];
    for (const icon of ICONS) {
      const svg = iconSvg(icon, drawing, col);
      await page.setViewportSize({ width: icon.size, height: icon.size });
      await page.setContent(
        `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`
      );
      const png = await page.locator('svg').screenshot({ omitBackground: icon.tile !== 'bleed' });
      fs.writeFileSync(path.join(out, icon.file), png);
      written.push(icon.file);
    }
    fs.writeFileSync(path.join(out, FAVICON_SVG.file), iconSvg(FAVICON_SVG, drawing, col));
    written.push(FAVICON_SVG.file);
    return { written, drawing, col };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  makeIcons(i > 0 ? { out: path.resolve(process.argv[i + 1]) } : {})
    .then(r =>
      console.log(
        `pwa-icons: ${r.drawing.paths.length} segments (${[...new Set(r.drawing.paths.map(p => p.cls))].join(', ')}), ${r.col.av1} on ${r.col.bg}: ${r.written.join(', ')}`
      )
    )
    .catch(e => {
      console.error(e.message);
      process.exit(2);
    });
}
