// B-390: the keyboard and address checks the smoke tier runs beside test/harness/smoke.cjs (`npm run smoke` runs this
// first). On the synthetic record at 390 and 1280, served without the host skeleton's [hidden] rule, so the page's own
// stylesheet must hide its panels:
// - a one-answer question in Today's review and in a practice set: focus its first option, ArrowDown moves the pick and
//   answers nothing (no verdict, nothing written); then Space answers the option in focus;
// - #system opens System, Today clears the address, and #system opens it again (the guard for the address fix);
// - the status line opens System on each tap (it opens System directly, address or not);
// - the hidden System panel takes no tap over Today;
// - once the record has loaded, a fault in the status line's lineFor is logged once ("renderLine:") and the strip stays
//   blank.
// Today's review answers on Space, the practice set on Enter.
//   node test/smoke-keys.cjs [record dir | synthetic]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const { studyView, openSet } = require('./harness/paint.cjs');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dbDir = require('./data/synthetic.cjs').recordDir(process.argv[2] || 'synthetic');
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
for (const c of ['system', 'legacy', 'debug', 'journal']) delete seed[c];
const stub = fs.readFileSync(path.join(__dirname, 'harness/stub.js'), 'utf8');
// no [hidden] rule here: the page's stylesheet carries its own (B-390)
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}</style></head><body>' +
  body +
  '</body></html>';

const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const until = (page, fn, arg, ms = 4000) =>
  page
    .waitForFunction(fn, arg, { timeout: ms })
    .then(() => true)
    .catch(() => false);

async function open(browser, viewport) {
  const page = await browser.newPage({ viewport, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route(ORIGIN + '/**', r => {
    const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
    const f = path.join(pageDir, name);
    if (name === 'index.html')
      return r.fulfill({ body: skeleton(fs.readFileSync(f, 'utf8')), contentType: 'text/html' });
    return fs.existsSync(f)
      ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' })
      : r.fulfill({ status: 404, body: 'not published' });
  });
  await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
  await page.goto(ORIGIN + '/');
  return { page, errors };
}

// Focus the first open option, press ArrowDown, then Space (or Enter); read the verdict and the answer writes after each.
async function keys(page, box, key = 'Space') {
  const read = () =>
    page.evaluate(box => {
      const b = document.querySelector(box);
      const v = b && [...b.querySelectorAll('.verdict')].find(e => e.getBoundingClientRect().height > 0);
      return {
        verdict: v ? v.textContent.trim().slice(0, 60) : '',
        writes: (window.__writes || []).filter(w => w[1] === 'answers').length,
        focused: document.activeElement && document.activeElement.matches(box + ' label.opt input'),
        checked: [...(b ? b.querySelectorAll('label.opt input') : [])].findIndex(i => i.checked),
        active: document.activeElement ? document.activeElement.tagName + '#' + document.activeElement.id + '.' + document.activeElement.className + '[' + (document.activeElement.name || '') + ']' : null,
        marked: !!(b && b.querySelector('fieldset.opts') && b.querySelector('fieldset.opts').__mark),
        log: (window.__klog || []).slice(-14),
        ua: navigator.userAgent.slice(-40),
      };
    }, box);
  const first = page.locator(box + ' fieldset.opts label.opt input:not(:disabled)').first();
  if (!(await first.count())) return null;
  await page.waitForTimeout(800); // the record's copy of the opened set lands and redraws first
  await first.focus();
  await page.evaluate(box => {
    window.__klog = [];
    const f = document.querySelector(box + ' fieldset.opts');
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => { window.__klog.push('RAF ' + new Error().stack.split('\n').slice(2, 9).map(l => l.trim().replace(/\(.*\//, '(')).join(' < ')); return raf(cb); };
    const st = window.setTimeout.bind(window);
    const bx = document.querySelector(box), orig = bx.replaceChildren.bind(bx);
    bx.replaceChildren = (...a) => { window.__klog.push('REPLACE ' + new Error().stack.split('\n').slice(1, 12).map(l => l.trim().replace(/\(.*\//, '(')).join(' < ')); return orig(...a); };
    if (f) f.__mark = 1;
    const t = Date.now();
    const d = e => (e.target && (e.target.tagName + ':' + (e.target.name || e.target.id || e.target.className))) || '';
    for (const ty of ['keydown', 'keyup', 'click', 'change', 'input', 'focusin', 'focusout'])
      document.addEventListener(ty, e => window.__klog.push([Date.now() - t, ty, e.key || (e.detail != null ? 'd' + e.detail : ''), d(e)].join(' ')), true);
    new MutationObserver(m => window.__klog.push((Date.now() - t) + ' mut ' + m.length + ' ' + m.map(x => x.target.id || x.target.className).slice(0, 3).join('|'))).observe(document.querySelector(box), { childList: true, subtree: true });
  }, box);
  const start = await read();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  const arrow = await read();
  await page.keyboard.press(key);
  await until(
    page,
    box => [...document.querySelectorAll(box + ' .verdict')].some(e => e.getBoundingClientRect().height > 0),
    box,
    2000
  );
  await page.waitForTimeout(200);
  const space = await read();
  return { start, arrow, space };
}

(async () => {
  const t0 = Date.now();
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  for (const [scheme, viewport] of [
    ['390', { width: 390, height: 844 }],
    ['1280', { width: 1280, height: 860 }],
  ]) {
    const tag = `[${scheme}]`;
    const { page, errors } = await open(browser, viewport);
    await until(page, () => /^Live$/.test((document.getElementById('status') || {}).textContent || ''));

    // The hidden System panel is gone without the host's [hidden] rule, and takes no tap over Today.
    await page.click('#tab-today');
    const gone = await page.evaluate(() => {
      const s = document.getElementById('p-system');
      const t = document.getElementById('p-today').getBoundingClientRect();
      const hit = document.elementFromPoint(t.left + t.width / 2, Math.min(t.top + 80, innerHeight - 10));
      return { hidden: s.hidden, display: getComputedStyle(s).display, overToday: !!(hit && hit.closest('#p-system')) };
    });
    ok(
      `${tag} a hidden panel is hidden by the page's own sheet and takes no tap`,
      gone.hidden && gone.display === 'none' && !gone.overToday,
      JSON.stringify(gone)
    );

    // System opens from its address twice, Today in between.
    const sysShown = () =>
      until(
        page,
        () => {
          const p = document.getElementById('p-system');
          return !p.hidden && p.getBoundingClientRect().height > 0;
        },
        null,
        1500
      );
    const twice = [];
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => (location.hash = 'system'));
      twice.push(await sysShown());
      await page.click('#tab-today');
      twice.push(await page.evaluate(() => location.hash === '' && document.getElementById('p-system').hidden));
    }
    ok(`${tag} #system opens System, Today clears it, and #system opens it again`, twice.every(Boolean), twice + '');
    // and from the status line, twice (it opens System while it names a problem)
    const line = [];
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => {
        const s = document.getElementById('status');
        s.classList.add('sys');
        s.click();
      });
      line.push(await sysShown());
      await page.click('#tab-today');
    }
    await page.evaluate(() => document.getElementById('status').classList.remove('sys'));
    ok(`${tag} the status line opens System on each tap`, line.every(Boolean), line + '');

    // Arrow keys never answer; Space does. Today's review, then a practice set.
    await studyView(page, 'review');
    await until(page, () => !!document.querySelector('#rv-body fieldset.opts input:not(:disabled)'), null, 2000);
    const rv = await keys(page, '#rv-body');
    const fine = r =>
      !!r &&
      !r.arrow.verdict &&
      r.arrow.writes === r.start.writes &&
      r.arrow.focused &&
      !!r.space.verdict &&
      r.space.writes > r.start.writes;
    ok(`${tag} Today's review: ArrowDown answers nothing, Space answers`, fine(rv), JSON.stringify(rv));

    const setId = await page.evaluate(
      () =>
        (Object.entries(window.__db.sets || {}).find(
          ([id, x]) =>
            !/^review-/.test(id) &&
            x.kind !== 'review' &&
            window.EVCore.validItems(x).some(
              q => (q.type || 'single') === 'single' && !(((window.__db.answers || {})[id] || {}).answers || {})[q.id]
            )
        ) || [''])[0]
    );
    await openSet(page, setId);
    await until(page, () => !!document.querySelector('#pr-body fieldset.opts input:not(:disabled)'), null, 2000);
    const pr = await keys(page, '#pr-body', 'Enter');
    ok(`${tag} a practice set: ArrowDown answers nothing, Enter answers`, fine(pr), JSON.stringify(pr));

    // A fault in the status line after the record has loaded: lineFor('today') reads the day through EVCore.dayView;
    // made to throw for one re-show of Today (which redraws only the panel's chrome and the strip), it is logged once
    // and the strip goes blank.
    await page.click('#tab-today');
    await page.waitForTimeout(300);
    const before = errors.length;
    const fault = await page.evaluate(() => {
      const E = window.EVCore,
        real = E.dayView;
      E.dayView = () => {
        throw new TypeError('planted status line fault');
      };
      try {
        document.getElementById('tab-today').click();
      } finally {
        E.dayView = real;
      }
      const strip = document.getElementById('evline');
      return { blank: !strip || strip.textContent.trim() === '' };
    });
    await page.waitForTimeout(200);
    const caught = errors.splice(before).filter(m => /^renderLine:.*planted status line fault/.test(m));
    ok(
      `${tag} a status line fault after load is logged once and the strip stays blank`,
      caught.length === 1 && fault.blank,
      JSON.stringify({ ...fault, logged: caught.length })
    );

    ok(`${tag} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }
  await browser.close();
  for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : '');
  // B-393: in CI each FAIL is also an annotation, readable through the check run's API when the log is not.
  if (process.env.GITHUB_ACTIONS)
    for (const r of results.filter(r => r[0] === 'FAIL'))
      console.log(`::error title=smoke-keys::${esc(r[1] + (r[2] ? ' · ' + r[2] : ''))}`);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(
    `${failed ? failed + ' FAILED' : 'ALL PASSED'} of ${results.length} key checks in ${Math.round((Date.now() - t0) / 1000)} s`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=smoke-keys crashed::${esc(e && e.stack ? e.stack : e)}`);
  process.exit(1);
});
