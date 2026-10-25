// Renders the built staging page on the synthetic record, like smoke.cjs. Read only.
const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path');
const root = require('path').resolve(__dirname, '../..');
const dbDir = require(root + '/test/data/synthetic.cjs').recordDir('synthetic');
const pageDir = path.join(root, 'dist/page/staging');
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
function load(dir) {
  const db = {};
  for (const c of fs.readdirSync(dir)) {
    const p = path.join(dir, c);
    if (!fs.statSync(p).isDirectory()) continue;
    db[c] = {};
    for (const f of fs.readdirSync(p))
      if (f.endsWith('.json')) db[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8'));
  }
  return db;
}
const seed = load(dbDir);
for (const c of ['legacy', 'debug', 'journal']) delete seed[c];
if (process.env.STALE && seed.health)
  for (const k in seed.health) seed.health[k].at = new Date(Date.now() - 82 * 3600e3).toISOString();
const stub = fs.readFileSync(path.join(root, 'test/harness/stub.js'), 'utf8');
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  body +
  '</body></html>';
const out = process.argv[2] || (process.env.FIDELITY_OUT || '/tmp/fidelity') + '/built';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const report = {};
  for (const vp of process.env.SIZES
    ? JSON.parse(process.env.SIZES)
    : [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
      ]) {
    const page = await browser.newPage({ viewport: vp, colorScheme: 'light' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.route(ORIGIN + '/**', r => {
      const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
      if (name === 'index.html')
        return r.fulfill({
          body: skeleton(fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8')),
          contentType: 'text/html',
        });
      const f = path.join(pageDir, name);
      return fs.existsSync(f)
        ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' })
        : r.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
    await page.goto(ORIGIN + '/');
    await page
      .waitForFunction(() => /^Live$/.test((document.getElementById('status') || {}).textContent || ''), null, {
        timeout: 8000,
      })
      .catch(() => {});
    await page.waitForTimeout(1500);
    for (const t of ['ev', 'today', 'study', 'progress', 'record']) {
      await page.click('#tab-' + t).catch(e => errors.push('click ' + t));
      await page.waitForTimeout(900);
      const tag = `${t}-${vp.width}`;
      await page.screenshot({ path: `${out}/${tag}.png` });
      await page.screenshot({ path: `${out}/${tag}-full.png`, fullPage: true });
      report[tag] = await page.evaluate(t => {
        const R = el => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const vis = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
        const p = document.getElementById('p-' + t);
        const mw = [];
        document.querySelectorAll('body *').forEach(el => {
          if (!vis(el)) return;
          const cs = getComputedStyle(el);
          if (cs.maxWidth !== 'none' && !cs.maxWidth.endsWith('%') && el.getBoundingClientRect().width > 200)
            mw.push({
              el:
                el.tagName.toLowerCase() +
                (el.id ? '#' + el.id : '') +
                (el.className && typeof el.className === 'string'
                  ? '.' + el.className.split(' ').slice(0, 2).join('.')
                  : ''),
              maxWidth: cs.maxWidth,
              w: Math.round(el.getBoundingClientRect().width),
              x: Math.round(el.getBoundingClientRect().x),
            });
        });
        const asides = [...document.querySelectorAll('aside, [id$="-side"], .side, .rpanel, .panel-right')]
          .filter(vis)
          .map(a => ({ id: a.id || a.className, r: R(a) }));
        return {
          top: R(document.getElementById('top')),
          mh: R(document.getElementById('mh')),
          mhText: (document.getElementById('mh') || {}).innerText,
          mhHer: vis(document.getElementById('mh-her')) ? document.getElementById('mh-her').innerText : null,
          panel: R(p),
          main: R(document.querySelector('main')),
          maxWidths: mw.slice(0, 15),
          asides,
          scrollH: document.documentElement.scrollHeight,
          sideways: document.documentElement.scrollWidth > innerWidth,
          text: p ? p.innerText.slice(0, 1500) : '',
          bannerish: [...document.querySelectorAll('body *')]
            .filter(e => vis(e) && /hours? old|health/i.test(e.childNodes.length === 1 ? e.textContent : ''))
            .map(e => e.textContent.trim().slice(0, 120))
            .slice(0, 5),
        };
      }, t);
    }
    report['errors-' + vp.width] = errors;
    await page.close();
  }
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
  await browser.close();
})();
