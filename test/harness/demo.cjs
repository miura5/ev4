// The demo copy's harness (B-83): dist/page/demo served as it will be published, with nothing stubbed (demo.js is the
// stub), at 390 and 1280. A tour a visitor would take: the greeting and chips, a review answer, a scripted chat reply,
// a skills run, the tabs. Checks that no request leaves the page's own files and that nothing throws.
//   node tools/build.mjs && node tools/demo.mjs && node test/harness/demo.cjs [screenshots dir]
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '../..'), dir = path.join(root, 'dist/page/demo');
const shots = process.argv[2] || '/tmp/ev4-demo-shots'; fs.mkdirSync(shots, { recursive: true });
const ORIGIN = 'https://demo.local', TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
const skeleton = b => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + b + '</body></html>';
const results = []; const ok = (n, c, d = '') => results.push([c ? 'PASS' : 'FAIL', n, d]);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  for (const [scheme, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'dark' }); const page = await ctx.newPage();
    const errors = [], outside = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/*', r => { const u = new URL(r.request().url());
      if (u.origin !== ORIGIN) { if (!/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) outside.push(u.href); return r.fulfill({ body: '' }); }
      const name = u.pathname.slice(1) || 'index.html', f = path.join(dir, name);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
      const body = fs.readFileSync(f, 'utf8'); return r.fulfill({ body: name === 'index.html' ? skeleton(body) : body, contentType: TYPES[path.extname(name)] || 'text/plain' }); });
    await page.goto(ORIGIN + '/');
    const greeted = await page.waitForFunction(() => document.querySelector('#thread .msg.greet'), null, { timeout: 20000 }).then(() => true, () => false);
    ok(`[${scheme}] the demo boots on its own record and greets`, greeted, await page.textContent('#status').catch(() => ''));
    await page.waitForTimeout(3500);
    const toastNote = await page.evaluate(() => { const t = document.getElementById('toast'); return !t.hidden && /^Demo copy/.test(t.textContent); });
    ok(`[${scheme}] the demo note shows once as a toast when it opens`, toastNote);
    await page.waitForTimeout(3500);
    const g = await page.evaluate(() => ({ greet: document.querySelector('#thread .msg.greet .bubble').textContent, chips: [...document.querySelectorAll('#qchips .qchip')].map(c => c.textContent), fine: document.getElementById('sys-note').textContent, title: document.title, unit: document.getElementById('readout').textContent }));
    ok(`[${scheme}] greeting with the review and Exam 4, three chips, the demo note`, /review/.test(g.greet) && /Exam 4/.test(g.greet) && g.chips.length === 3 && /^Demo copy/.test(g.fine) && /^EV-04/.test(g.unit), JSON.stringify(g));
    await page.screenshot({ path: `${shots}/demo-open-${scheme}.png` });
    // A scripted reply
    await page.fill('#ev-input', 'explain preload'); await page.click('#ev-send'); await page.waitForTimeout(6500);
    const r1 = await page.evaluate(() => document.querySelector('#thread .msg.ev.current .bubble').textContent);
    ok(`[${scheme}] a scripted reply: explain preload`, /stretch/.test(r1) && /afterload/i.test(r1), r1.slice(0, 120));
    await page.screenshot({ path: `${shots}/demo-reply-${scheme}.png` });
    // Today's review from the chip, one answer
    // B-85: in a conversation the chips step aside; focusing the empty input brings them back.
    const quiet = await page.isVisible('#qchips'); await page.focus('#ev-input'); await page.waitForTimeout(150);
    ok(`[${scheme}] the chips step aside in a conversation and come back on an empty focused input`, !quiet && await page.isVisible('#qchips .qchip:has-text("Start review")'));
    await page.click('#qchips .qchip:has-text("Start review")'); await page.waitForTimeout(3500);
    const card = page.locator('#thread .msg.ev.current .ev-card');
    ok(`[${scheme}] Start review shows today's review in a card`, (await card.count()) === 1 && /Today.s review/.test(await card.textContent()), (await card.textContent().catch(() => '')).slice(0, 120));
    await card.locator('label.opt').first().click(); await card.locator('button:has-text("Check answer")').click(); await page.waitForTimeout(500);
    ok(`[${scheme}] answering scores it and says why`, /Correct\.|Not quite/.test(await card.textContent()), (await card.textContent()).slice(0, 200));
    await page.screenshot({ path: `${shots}/demo-review-${scheme}.png` });
    // A skills run
    await page.fill('#ev-input', 'practice bed bath'); await page.click('#ev-send'); await page.waitForTimeout(6000);
    const sk = await page.evaluate(m => { const v = id => { const e = document.getElementById(id); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; }; return { sheet: v('sksheet'), panel: v('skpanel'), text: (document.getElementById(m ? 'sksheet' : 'skpanel') || {}).textContent || '' }; }, scheme === 'phone');
    ok(`[${scheme}] practice bed bath runs the made-up checklist in the skills ${scheme === 'phone' ? 'sheet' : 'panel'}`, (scheme === 'phone' ? sk.sheet : sk.panel) && /Step 1 of 8/.test(sk.text), JSON.stringify(sk).slice(0, 200));
    await page.screenshot({ path: `${shots}/demo-skills-${scheme}.png` });
    await page.click(scheme === 'phone' ? '#sksheet .sk-mini:has-text("Stop")' : '#skpanel button:has-text("Stop")'); await page.waitForTimeout(600);
    // The tabs
    for (const [tab, want] of [['today', /Read Ch 39/], ['progress', /Readiness/], ['record', /Fluids and electrolytes/]]) {
      await page.click('#tab-' + tab); await page.waitForTimeout(700);
      const t = await page.textContent('#p-' + tab); ok(`[${scheme}] the ${tab} tab has the demo's data`, want.test(t), t.replace(/\s+/g, ' ').slice(0, 140));
      await page.screenshot({ path: `${shots}/demo-${tab}-${scheme}.png` });
    }
    await page.click('#tab-ev'); await page.waitForTimeout(300);
    ok(`[${scheme}] no request leaves the page's own files (fonts aside)`, outside.length === 0, outside.join(' '));
    ok(`[${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    ok(`[${scheme}] no sideways scroll`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    await ctx.close();
  }
  await browser.close();
  for (const [s, n, d] of results) console.log(s, n, d);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? `${failed} FAILED of ${results.length} checks` : `ALL PASSED: ${results.length} checks`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('CRASHED', e.message); process.exit(1); });
