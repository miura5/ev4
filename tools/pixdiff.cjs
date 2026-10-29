#!/usr/bin/env node
// B-507 (D-376, D-388): the pixel diff every Proprietary lane proves "nothing on screen moved" with. It builds two
// versions of the page, a base commit and a head (a commit, or this working tree), shoots every view of the synthetic
// record (every tab and every segment, test/harness/views.cjs) at 390x844 and 1280x800 in light and dark, and compares
// the shots pixel by pixel (test/harness/png.cjs). It prints the changed pixels per shot and writes a diff image for
// each shot that changed: the base dimmed, the changed pixels red.
//   node tools/pixdiff.cjs [base ref, default origin/main] [head ref, default the working tree] [--out dir] [--tol n]
//     [--target staging|live]
// Both sides are served the same way the look pass serves the built page (stub.js over the synthetic record, built once
// from this tree's test/data/synthetic.cjs), at one frozen clock, a seeded Math.random, reduced motion and one release
// name, so only the page's own code and styles differ. --tol is the per-channel difference a pixel may show and still
// count as the same (8, as png.cjs's look pass). Exit 1 when any shot changed or a view could not be reached.
// A base ref is built in a temporary git worktree (removed after); nothing is written outside --out and the temp dir.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const png = require('../test/harness/png.cjs');
const { viewsOf } = require('../test/harness/views.cjs');
const { studyView } = require('../test/harness/paint.cjs');
const { syntheticRecord } = require('../test/data/synthetic.cjs');

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const OUT = path.resolve(flag('out', path.join(os.tmpdir(), 'ev4-pixdiff')));
const TOL = Number(flag('tol', 8));
const TARGET = flag('target', 'staging');
const [BASE = 'origin/main', HEAD = null] = argv;
const SIZES = [
  [390, 844],
  [1280, 800],
];
const SCHEMES = ['light', 'dark'];
// one release name on both sides, so the version line never differs (from the spec, as the build's own fallback, B-149)
const RELEASE = `v${JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')).specVersion}.0+pixdiff`;
const NOW = new Date(); // one clock for both sides: the record's dates and the page's Date
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  body +
  '</body></html>';
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Builds one side into tmp/<name>-dist: a ref in a temporary worktree, or (ref null) this working tree. */
function buildSide(tmp, name, ref) {
  let src = ROOT,
    label = 'working tree';
  if (ref) {
    const sha = git('rev-parse', '--verify', ref + '^{commit}').trim();
    src = path.join(tmp, name + '-src');
    git('worktree', 'add', '--detach', '-q', src, sha);
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(src, 'node_modules'), 'dir');
    label = `${ref} (${sha.slice(0, 9)})`;
  }
  const out = path.join(tmp, name + '-dist');
  try {
    execFileSync(
      process.execPath,
      [
        path.join(src, 'tools/build.mjs'),
        '--root',
        src,
        '--out',
        out,
        '--release',
        RELEASE,
        '--now',
        NOW.toISOString(),
      ],
      { cwd: src, stdio: ['ignore', 'pipe', 'inherit'] }
    );
  } finally {
    if (ref) git('worktree', 'remove', '--force', src);
  }
  return { label, dir: path.join(out, 'page', TARGET) };
}

const seed = syntheticRecord(NOW);
for (const c of ['system', 'legacy', 'debug', 'journal']) delete seed[c]; // the page never subscribes to these at boot
const stub = fs.readFileSync(path.join(ROOT, 'test/harness/stub.js'), 'utf8');
// a seeded Math.random, so anything the page picks at random picks the same on both sides
const SEEDED =
  'Math.random=(()=>{let a=0x2545f491;return()=>{a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};})();';

/** One page of a built side at one size and scheme, booted fresh over the synthetic record. */
async function boot(browser, dir, [width, height], scheme) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion: 'reduce' });
  await ctx.clock.setFixedTime(NOW);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await ctx.route(ORIGIN + '/**', r => {
    const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
    if (name === 'index.html')
      return r.fulfill({
        body: skeleton(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')),
        contentType: 'text/html',
      });
    const f = path.join(dir, name);
    return fs.existsSync(f)
      ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' })
      : r.fulfill({ status: 404, body: 'not published' });
  });
  await ctx.addInitScript(SEEDED + 'window.__db=' + JSON.stringify(seed) + ';' + stub);
  const page = await ctx.newPage();
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => document.querySelector('#thread .msg.ev'), null, { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);
  return { ctx, page };
}
/**
 * One view of a built side, on a page booted fresh (so no view inherits another's state): its tab and segment, checked
 * as the page's own view (body data-view and its panel shown) before and after the shot and clicked again (three tries)
 * if a late render took it elsewhere, then shot once two shots in a row agree, so a layout still settling is never the
 * shot.
 */
const ON_VIEW = t =>
  document.body.dataset.view === t && !!document.getElementById('p-' + t) && !document.getElementById('p-' + t).hidden;
async function shootView(browser, dir, size, scheme, view, file) {
  const { ctx, page } = await boot(browser, dir, size, scheme);
  try {
    const go = async () => {
      await page.$eval('#tab-' + view.tab, b => b.click());
      if (view.v && (await page.isVisible(`#seg-${view.tab} [data-v="${view.v}"]`)))
        await page.click(`#seg-${view.tab} [data-v="${view.v}"]`, { timeout: 3000 });
      else if (view.v && view.tab === 'study') await studyView(page, view.v);
    };
    const there = () =>
      page
        .waitForFunction(ON_VIEW, view.tab, { timeout: 2000 })
        .then(() => true)
        .catch(() => false);
    // up to three tries: a late render at boot can take the page back to Conversation after the click
    let last = null;
    for (let tries = 0; tries < 3; tries++) {
      await go();
      await page.waitForTimeout(300);
      if (!(await there())) continue;
      await page.mouse.move(0, size[1] - 1); // no hover left on what was clicked
      await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await page.evaluate(() => document.fonts.ready);
      last = null;
      await page.waitForTimeout(400); // past the panel's fade-in
      // the whole page in one shot, by a viewport as tall as the page: Chromium's fullPage shot briefly reports a
      // 1 px wide window, which flips the page's width queries (and Notes' wide-only check sends it to Conversation)
      for (let i = 0, h = size[1]; i < 4; i++) {
        const want = await page.evaluate(() =>
          Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)
        );
        if (want <= h || want > 12000) break;
        await page.setViewportSize({ width: size[0], height: (h = want) });
        await page.waitForTimeout(200);
      }
      for (let i = 0; i < 8; i++) {
        if (i) await page.waitForTimeout(250);
        const buf = await page.screenshot({ animations: 'disabled', caret: 'hide' });
        if (last && buf.equals(last)) break;
        last = buf;
      }
      if (await page.evaluate(ON_VIEW, view.tab)) break; // still there after the shot
      last = null;
    }
    if (!last) throw new Error(`the page did not stay on ${view.tab}`);
    fs.writeFileSync(file, last);
    return file;
  } finally {
    await ctx.close();
  }
}
/**
 * Shoots every view of one built side at one size and scheme; returns {view id: file} and the views it could not
 * reach. A tab the page adds at boot and shows at this size (Notes from 1024 px, B-402) is a view too, though the
 * shell's markup does not name it.
 */
async function shoot(browser, side, dir, size, scheme, views) {
  const first = await boot(browser, dir, size, scheme);
  const added = (
    await first.page.$$eval('[id^="tab-"][data-tab]', bs =>
      bs.filter(b => !b.closest('[hidden]')).map(b => b.dataset.tab)
    )
  )
    .filter(t => !views.some(v => v.tab === t))
    .map(tab => ({ tab, v: null, id: tab }));
  await first.ctx.close();
  const shots = {},
    missed = [],
    all = [...views, ...added];
  for (const view of all) {
    try {
      shots[view.id] = await shootView(browser, dir, size, scheme, view, shotFile(side, view.id, size, scheme));
    } catch (e) {
      missed.push(`${view.id}: ${String(e.message).split('\n')[0]}`);
    }
  }
  return { shots, missed, views: all };
}
const shotFile = (side, id, size, scheme, n = 0) =>
  path.join(OUT, side, `${id}-${size[0]}-${scheme}${n ? '-again' + n : ''}.png`);

// ---- a PNG writer (RGBA, no filter), enough for the diff images
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = buf => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function encode(width, height, rgba) {
  const chunk = (kind, data) => {
    const len = Buffer.alloc(4),
      crc = Buffer.alloc(4),
      body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Changed pixels between two shots (over TOL in any channel), and the diff image: base dimmed, changes red. */
function compare(fa, fb) {
  const A = png.decode(fs.readFileSync(fa)),
    B = png.decode(fs.readFileSync(fb));
  const w = Math.max(A.width, B.width),
    h = Math.max(A.height, B.height);
  const img = Buffer.alloc(w * h * 4);
  let n = 0;
  const at = (P, x, y, k) => (x < P.width && y < P.height ? P.px[(y * P.width + x) * P.bpp + k] : -999);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let changed = false;
      for (let k = 0; k < 3 && !changed; k++) changed = Math.abs(at(A, x, y, k) - at(B, x, y, k)) > TOL;
      const o = (y * w + x) * 4;
      if (changed) {
        n++;
        img[o] = 255;
        img[o + 1] = img[o + 2] = 0;
      } else {
        const g = Math.round(0.3 * at(A, x, y, 0) + 0.59 * at(A, x, y, 1) + 0.11 * at(A, x, y, 2));
        img[o] = img[o + 1] = img[o + 2] = 200 + Math.round(Math.max(0, g) * 0.2);
      }
      img[o + 3] = 255;
    }
  const sizes = A.width === B.width && A.height === B.height ? '' : `${A.width}x${A.height} -> ${B.width}x${B.height}`;
  return { n, sizes, image: n ? encode(w, h, img) : null };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ev4-pixdiff-'));
  for (const d of ['base', 'head', 'diff']) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  for (const d of ['base', 'head', 'diff']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
  let base, head;
  try {
    base = buildSide(tmp, 'base', BASE);
    head = buildSide(tmp, 'head', HEAD);
  } catch (e) {
    console.error('pixdiff: a build failed: ' + e.message);
    process.exit(2);
  }
  const vb = viewsOf(fs.readFileSync(path.join(base.dir, 'index.html'), 'utf8')),
    vh = viewsOf(fs.readFileSync(path.join(head.dir, 'index.html'), 'utf8'));
  const views = [...vh, ...vb.filter(v => !vh.some(x => x.id === v.id))];
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  console.log(`pixdiff ${TARGET}: base ${base.label} vs head ${head.label}; tolerance ${TOL}`);
  const rows = [],
    problems = [];
  for (const size of SIZES)
    for (const scheme of SCHEMES) {
      const [a, b] = await Promise.all([
        shoot(browser, 'base', base.dir, size, scheme, vb),
        shoot(browser, 'head', head.dir, size, scheme, vh),
      ]);
      problems.push(
        ...a.missed.map(m => `base ${size[0]} ${scheme} ${m}`),
        ...b.missed.map(m => `head ${size[0]} ${scheme} ${m}`)
      );
      const ids = [...new Set([...views.map(v => v.id), ...Object.keys(a.shots), ...Object.keys(b.shots)])];
      for (const v of ids.map(id => ({ id }))) {
        const tag = `${v.id} ${size[0]} ${scheme}`;
        if (!a.shots[v.id] || !b.shots[v.id]) {
          rows.push([tag, a.shots[v.id] ? 'only in base' : b.shots[v.id] ? 'only in head' : 'in neither']);
          continue;
        }
        let r = compare(a.shots[v.id], b.shots[v.id]);
        let note = '';
        // a changed shot is shot again on both sides, twice at most: a real change shows every time, a flake does not
        for (let n = 1; r.n && n <= 2; n++) {
          const va = a.views.find(x => x.id === v.id),
            vb2 = b.views.find(x => x.id === v.id);
          const [fa, fb] = await Promise.all([
            shootView(browser, base.dir, size, scheme, va, shotFile('base', v.id, size, scheme, n)),
            shootView(browser, head.dir, size, scheme, vb2, shotFile('head', v.id, size, scheme, n)),
          ]).catch(() => [null, null]);
          if (!fa) break;
          const again = compare(fa, fb);
          if (!again.n) note = ` (first shot ${r.n}, 0 on shot ${n + 1}: a flake)`;
          r = again.n ? r : again;
        }
        note = String(r.n) + note;
        if (r.sizes) note += ` (size ${r.sizes})`;
        if (r.image) {
          const f = path.join(OUT, 'diff', `${v.id}-${size[0]}-${scheme}.png`);
          fs.writeFileSync(f, r.image);
          note += '  ' + f;
        }
        rows.push([tag, note, r.n]);
      }
    }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const wide = Math.max(...rows.map(r => r[0].length));
  console.log('view size scheme'.padEnd(wide) + '  changed pixels');
  for (const [tag, note] of rows) console.log(tag.padEnd(wide) + '  ' + note);
  for (const p of problems) console.log('not reached: ' + p);
  const changed = rows.filter(r => r[2] !== 0);
  console.log(
    changed.length || problems.length
      ? `RED: ${changed.length} of ${rows.length} shots changed${problems.length ? `, ${problems.length} not reached` : ''}; shots in ${OUT}`
      : `GREEN: 0 changed pixels in all ${rows.length} shots; shots in ${OUT}`
  );
  process.exit(changed.length || problems.length ? 1 : 0);
})().catch(e => {
  console.error('pixdiff: ' + (e.stack || e.message));
  process.exit(2);
});
