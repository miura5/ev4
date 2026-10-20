// The look pass (B-101, B-113): every view of every tab of the built page (each tab, and each segment of a tab's seg
// control) at Matt's sizes (views.cjs: phone 375 to 430, the phone with its keyboard open, the Claude side panel, half
// the laptop, half a 1080p screen, the laptop and the big screens), full-page screenshots to look at after a page
// change, with the record, sample, mcp and the reader stubbed (stub.js) as in shell.cjs. Checks what any screen must
// hold: no page error, no sideways scroll, and on the E.V. tab the composer in view.
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
// B-111: a long idea, to hold its row to a readable shape at both widths.
const LONG_IDEA = 'When sodium drops the brain swells because water follows the gradient into cells, so confusion and seizures come before anything shows on the heart monitor, unlike potassium, which hits rhythm.';
seed.ideas = { ...(seed.ideas || {}), 'look-long-idea': { schema: 2, writer: 'page', at: '2026-10-19T23:00:00.000Z', source: 'E.V. Home', text: LONG_IDEA, objective: 'E4-2', status: 'open', links: [], kind: 'learning' } };
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const skeleton = body => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
const { SIZES, viewsOf, shotName } = require('./views.cjs');
const VIEWS = viewsOf(fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8'));
const results = []; const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  for (const size of SIZES) {
    const width = size.tag, viewport = { width: size.width, height: size.height };
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
    for (const view of VIEWS) {
      await page.click('#tab-' + view.tab); if (view.v) await page.click(`#seg-${view.tab} [data-v="${view.v}"]`);
      await page.waitForTimeout(500); // past the panel's fade-in
      await page.screenshot({ path: `${shots}/${shotName(view, size)}`, fullPage: true });
      ok(`[${width}] ${view.id}: no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      if (view.tab === 'ev') ok(`[${width}] ev: the composer is in view`, await page.evaluate(() => { const c = document.querySelector('.compose-row').getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight + 1 && c.height > 0; }));
    }
    // Each seg control back to its first view, as a fresh open has it.
    for (const v of VIEWS.filter(x => x.v)) if (VIEWS.find(x => x.tab === v.tab).v === v.v) { await page.click('#tab-' + v.tab); await page.click(`#seg-${v.tab} [data-v="${v.v}"]`); }
    if (['390x844', '1280x800'].includes(width)) {
    // B-111: the long idea's text is at most 3 lines and at least 80% of its card's width; opening it shows its controls.
    await page.click('#tab-record'); await page.click('#seg-record [data-v="sessions"]'); await page.waitForTimeout(400);
    const idea = await page.evaluate(() => {
      const li = document.querySelector('#ideas li.idea[data-id="look-long-idea"]'); if (!li) return null;
      const t = li.querySelector('.title'), card = li.closest('.card'), cs = getComputedStyle(t);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const acts = li.querySelector('.idea-acts');
      return { lines: Math.round(t.getBoundingClientRect().height / lh), share: t.getBoundingClientRect().width / (card.clientWidth - parseFloat(getComputedStyle(card).paddingLeft) - parseFloat(getComputedStyle(card).paddingRight)), hidden: getComputedStyle(acts).display === 'none' };
    });
    ok(`[${width}] record: the 30-word idea is at most 3 lines`, idea && idea.lines <= 3, JSON.stringify(idea));
    ok(`[${width}] record: the idea's text is at least 80% of its card's width`, idea && idea.share >= 0.8, JSON.stringify(idea));
    ok(`[${width}] record: an idea's menu and button wait until it is opened`, idea && idea.hidden, JSON.stringify(idea));
    await page.click('#ideas li.idea[data-id="look-long-idea"] .idea-head');
    const opened = await page.evaluate(() => { const li = document.querySelector('#ideas li.idea[data-id="look-long-idea"]'); const vis = e => e && e.getBoundingClientRect().height > 0; return { menu: vis(li.querySelector('select.idea-kind')), button: [...li.querySelectorAll('button')].some(b => /Make it a weak spot/.test(b.textContent) && vis(b)), expanded: li.querySelector('.idea-head').getAttribute('aria-expanded') }; });
    ok(`[${width}] record: opening the idea shows its menu and Make it a weak spot`, opened.menu && opened.button && opened.expanded === 'true', JSON.stringify(opened));
    ok(`[${width}] record: the planted idea is 30 words, and opened it shows them all`, LONG_IDEA.split(/\s+/).length === 30 && await page.evaluate(() => { const t = document.querySelector('#ideas li.idea[data-id="look-long-idea"] .title'); return t.scrollHeight <= t.clientHeight + 1; }));
    await page.locator('#ideas li.idea[data-id="look-long-idea"]').screenshot({ path: `${shots}/look-idea-open-${width}.png` });
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
