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
// B-115: the tenet checks, on every view at spec.ui.tenets.widths; a tab in spec.ui.tenets.on fails the pass.
const TENETS = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'ev.spec.json'), 'utf8')).ui.tenets;
const { collect, judge } = require('./tenets.cjs');
const reports = [];
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
      if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
        const snap = await page.evaluate(collect);
        for (const c of judge(snap, TENETS.exceptions)) {
          if (TENETS.on.includes(view.tab) || TENETS.on.includes(view.id)) ok(`[${width}] ${view.id}: ${c.tenet}`, c.ok, c.detail);
          else reports.push([c.ok ? 'ok  ' : 'NOT ', `[${width}] ${view.id}: ${c.tenet}`, c.detail]);
        }
      }
      if (view.tab === 'ev') ok(`[${width}] ev: the composer is in view`, await page.evaluate(() => { const c = document.querySelector('.compose-row').getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight + 1 && c.height > 0; }));
    }
    // B-116: the question view: the stem leads with no chip above it, one count on the screen, no More practice while
    // the set is unfinished; after the last answer, More practice is one line.
    if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
      await page.click('#tab-study'); await page.click('#seg-study [data-v="review"]'); await page.waitForTimeout(300);
      const q = await page.evaluate(() => { const vis = e => !!e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
        const stem = document.querySelector('#rv-body .q-stem'), panel = document.getElementById('p-study');
        const counts = [...panel.querySelectorAll('*')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && /\b\d+ of \d+\b/.test(n.textContent))).map(e => e.textContent.trim());
        return { stem: !!stem && parseFloat(getComputedStyle(stem).fontSize), chipAbove: !!stem && [...document.querySelectorAll('#rv-body .chip')].some(c => vis(c) && c.getBoundingClientRect().top < stem.getBoundingClientRect().top), counts, more: vis(document.getElementById('more-card')) }; });
      ok(`[${width}] study: the stem leads at 20 px with no chip above it, one count on the screen, no More practice mid-set`, q.stem === 20 && !q.chipAbove && q.counts.length === 1 && !q.more, JSON.stringify(q));
      for (let i = 0; i < 15 && await page.isVisible('#rv-body button:has-text("Check answer")'); i++) {
        if (await page.locator('#rv-body table.mx').count()) { const rows = await page.locator('#rv-body table.mx tbody tr').count(); for (let r = 0; r < rows; r++) await page.locator('#rv-body table.mx tbody tr').nth(r).locator('input[type=radio]').first().check(); }
        else await page.locator('#rv-body label.opt').first().click();
        await page.click('#rv-body button:has-text("Check answer")'); await page.waitForTimeout(120);
        const next = page.locator('#rv-body button', { hasText: /Next question|See results/ }).first(); if (await next.count()) { await next.click(); await page.waitForTimeout(120); }
      }
      const done = await page.evaluate(() => { const m = document.getElementById('more-card'), r = m.getBoundingClientRect(); return { shown: !m.hidden && r.height > 0, h: Math.round(r.height), button: (document.getElementById('more-btn') || {}).textContent, left: document.querySelectorAll('#rv-body button').length && /Check answer/.test(document.getElementById('rv-body').textContent) }; });
      ok(`[${width}] study: after the last answer, More practice is one line with Give me 5 more`, done.shown && done.h <= 72 && done.button === 'Give me 5 more' && !done.left, JSON.stringify(done));
      await page.screenshot({ path: `${shots}/look-study-done-${width}.png`, fullPage: true });
    }
    // B-117: Today: no stat tile, no item's minutes twice, the exam in Next 7 days only, coral equal to core's urgent
    // count, a Prep marker on the clinical day; ticking keeps the scroll (v4 rule 6).
    if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
      await page.click('#tab-today'); await page.waitForTimeout(800); // past the panel's rise
      const t = await page.evaluate(() => { const vis = e => !!e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
        const items = [...document.querySelectorAll('#today-list li')].filter(vis).map(li => (li.querySelector('.ti-t') || li).textContent.trim());
        const ahead = [...document.querySelectorAll('#ahead li')].filter(vis);
        const coralRgb = /rgba?\((240, 138, 120|244, 167, 151)/, panel = document.getElementById('p-today');
        const coral = [...panel.querySelectorAll('*')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && coralRgb.test(getComputedStyle(e).color)).length;
        return { tiles: [...document.querySelectorAll('#stats .stat')].filter(vis).length, minsTwice: items.filter(x => (x.match(/\d+\s*min/g) || []).length > 1), examInList: items.some(x => /^Exam \d/.test(x)), examAhead: ahead.some(li => /Exam/.test(li.textContent)) || !document.querySelector('#ahead'),
          coral, urgent: document.querySelectorAll('li.brief-item[data-level="urgent"]').length, prepOnClinical: ahead.filter(li => /clinical/i.test(li.textContent)).every(li => li.querySelector('.bi-prep')) && ahead.some(li => /clinical/i.test(li.textContent)) }; });
      ok(`[${width}] today: no stat tile, minutes once, the exam in Next 7 days only, coral equal to the urgent count, Prep on the clinical day`, !t.tiles && !t.minsTwice.length && !t.examInList && t.coral === t.urgent && t.prepOnClinical, JSON.stringify(t));
      const tick = page.locator('#today-list li.today-item input.tick').first();
      // Rule 6: the row he ticks stays where it is on the screen.
      if (await tick.count()) { const at = () => page.evaluate(() => Math.round(document.querySelector('#today-list li.today-item').getBoundingClientRect().top + scrollY)); /* in the document: the click itself may scroll it into view */ const y0 = await at(); await tick.click(); await page.waitForTimeout(400); const y1 = await at(); await page.locator('#today-list li.today-item input.tick').first().click(); await page.waitForTimeout(300);
        ok(`[${width}] today: ticking an item keeps it where it is`, Math.abs(y1 - y0) <= 1, JSON.stringify({ y0, y1 })); }
      await page.evaluate(() => window.scrollTo(0, 0));
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
  // The tabs whose tenet checks are not on yet: each check per view, reported, not failed (B-115).
  if (reports.length) { console.log(`\ntenet checks, reported until each tab's catch-up task turns them on (${reports.filter(r => r[0] === 'ok  ').length} of ${reports.length} pass):`); for (const [s, n, d] of reports) console.log(`${s}  ${n}  -- ${d}`); }
  const failed = results.filter(x => x[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} of ${results.length} checks pass; screenshots in ${shots}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
