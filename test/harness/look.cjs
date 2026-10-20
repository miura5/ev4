// The look pass (B-101): every tab of the built page at phone (390) and desktop (1280) width, full-page screenshots
// to look at after a page change, with the record, sample, mcp and the reader stubbed (stub.js) as in shell.cjs. Checks
// only what any screen must hold: no page error and no sideways scroll.
//   node test/harness/look.cjs [record dir | synthetic] [screenshots dir] [target]
// record dir: a folder of <collection>/<id>.json (default: the synthetic record, test/data/synthetic.cjs).
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '../..');
const dbDir = require('../data/synthetic.cjs').recordDir(process.argv[2]);
const shots = process.argv[3] || '/tmp/ev4-look'; fs.mkdirSync(shots, { recursive: true });
const target = process.argv[4] || 'staging';
const pageDir = path.join(root, 'dist/page', target);
const ORIGIN = 'https://ev.local';

function load(dir) { const db = {}; for (const c of fs.readdirSync(dir)) { const p = path.join(dir, c); if (!fs.statSync(p).isDirectory()) continue; db[c] = {}; for (const f of fs.readdirSync(p)) if (f.endsWith('.json')) db[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')); } return db; }
const seed = load(dbDir);
delete seed.system; delete seed.legacy; delete seed.debug; delete seed.journal; // the page never subscribes to these at boot
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const skeleton = body => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
const TABS = ['ev', 'today', 'study', 'progress', 'record', 'system'];
const results = []; const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  for (const [width, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
    const page = await browser.newPage({ viewport, colorScheme: 'dark' });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
    await page.route(ORIGIN + '/**', r => {
      const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
      if (name === 'index.html') return r.fulfill({ body: skeleton(fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8')), contentType: 'text/html' });
      const f = path.join(pageDir, name);
      return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' }) : r.fulfill({ status: 404, body: 'not published' });
    });
    await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
    await page.goto(ORIGIN + '/');
    await page.waitForFunction(() => document.querySelector('#thread .msg.ev'), null, { timeout: 5000 }).catch(() => {});
    for (const t of TABS) {
      await page.click('#tab-' + t); await page.waitForTimeout(700); // past the panel's fade-in
      await page.screenshot({ path: `${shots}/look-${t}-${width}.png`, fullPage: true });
      ok(`[${width}] ${t}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    }
    ok(`[${width}] no page errors`, errors.length === 0, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d && s === 'FAIL' ? '  -- ' + d : ''}`);
  const failed = results.filter(x => x[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} of ${results.length} checks pass; screenshots in ${shots}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
