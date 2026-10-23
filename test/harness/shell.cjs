// The shell harness (B-15): drives the built shell with its published files served
// locally, at phone and desktop width, with the record, sample, mcp and the reader stubbed (stub.js).
//   node test/harness/shell.cjs [record dir] [screenshots dir] [target]
// record dir: a folder of <collection>/<id>.json (default: the synthetic record in test/data/record).
// Run `node tools/build.mjs` first: the harness reads dist/page/<target>/. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const PANEL = require('./panel.cjs');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
// B-149: the release comes from the build (git describe at the build's commit), never a literal.
const RELEASE = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json'), 'utf8')).release;
const SPEC_VERSION = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8')).specVersion;
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dbDir =
  process.argv[2] === 'synthetic'
    ? require('../data/synthetic.cjs').recordDir('synthetic')
    : process.argv[2] || path.join(root, 'test/data/record');
const shots = process.argv[3] || '/tmp/ev4-shots';
fs.mkdirSync(shots, { recursive: true });
const target = process.argv[4] || 'staging';
const pageDir = path.join(root, 'dist/page', target);
const ORIGIN = 'https://ev.local';

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
delete seed.system;
delete seed.legacy;
delete seed.debug; // the page never subscribes to these
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
// What publishing does to the shell: the platform's skeleton around it (the Artifact tool's page contract).
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  body +
  '</body></html>';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };

const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);

/** A page with the published files served from dist (overrides: {file: body | null to fail it}) and the stub. */
async function open(browser, { viewport, pre = '', overrides = {}, db = seed, scheme = 'dark' }) {
  const page = await browser.newPage({ viewport, colorScheme: scheme });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route(ORIGIN + '/**', r => {
    const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
    if (name === 'index.html')
      return r.fulfill({
        body: skeleton(fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8')),
        contentType: 'text/html',
      });
    if (Object.prototype.hasOwnProperty.call(overrides, name))
      return overrides[name] == null
        ? r.fulfill({ status: 404, body: 'gone' })
        : r.fulfill({ body: overrides[name], contentType: TYPES[path.extname(name)] });
    const f = path.join(pageDir, name);
    return fs.existsSync(f)
      ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' })
      : r.fulfill({ status: 404, body: 'not published' });
  });
  await page.addInitScript(pre + 'window.__db=' + JSON.stringify(db) + ';' + stub);
  await page.goto(ORIGIN + '/');
  return { page, errors };
}
const statusText = page => page.evaluate(() => (document.getElementById('status') || {}).textContent || '');

(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  for (const [scheme, viewport] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 860 }],
  ]) {
    const { page, errors } = await open(browser, { viewport });
    await page
      .waitForFunction(() => document.querySelector('#thread .msg.ev'), null, { timeout: 5000 })
      .catch(() => {});
    await page.screenshot({ path: `${shots}/shell-${scheme}.png` });
    ok(
      `[${scheme}] the shell loads core.js, spec.json, app.js and styles.css from beside it`,
      await page.evaluate(
        () =>
          !!(window.EVCore && window.EVApp && window.EVValidate) &&
          getComputedStyle(document.body).getPropertyValue('--accent').trim() !== ''
      )
    );
    ok(
      `[${scheme}] opens on E.V. with the greeting`,
      (await page.isVisible('#p-ev')) &&
        !(await page.isVisible('#p-today')) &&
        /Matt|Still up|Afternoon/.test(
          await page
            .locator('#thread .msg.ev')
            .first()
            .textContent()
            .catch(() => '')
        )
    );
    ok(
      `[${scheme}] five tabs in the top bar beside System`,
      (await page.locator('#top .tabs .tab').count()) === 5 && (await page.isVisible('#tab-system'))
    );
    ok(
      `[${scheme}] the staging stamp, a quiet status and the staging readout`,
      /^Live$/.test(await statusText(page)) &&
        /staging/.test(await page.locator('#readout').textContent()) &&
        (await page.evaluate(
          release =>
            document.querySelector('meta[name="ev-release"]').content === release &&
            document.querySelector('meta[name="ev-target"]').content === 'staging',
          RELEASE
        )),
      await statusText(page)
    );
    ok(
      `[${scheme}] no sideways scroll`,
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    );
    for (const t of ['today', 'study', 'progress', 'record']) {
      await page.click('#tab-' + t);
      await page.waitForTimeout(60);
    }
    ok(
      `[${scheme}] each tab opens its own panel`,
      (await page.isVisible('#p-record')) && !(await page.isVisible('#p-ev'))
    );
    await page.click('#tab-system');
    await page.waitForTimeout(80);
    ok(
      `[${scheme}] System shows the release`,
      new RegExp('Release ' + reEsc(RELEASE)).test(await page.locator('#versions').textContent())
    );
    await page.screenshot({ path: `${shots}/system-${scheme}.png` });
    ok(`[${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    if (scheme === 'phone') {
      const q = await page.evaluate(() => window.__queries);
      const where = c => (q.find(([n, f]) => n === c && f.length) || [])[1];
      ok(
        'subscribes by window: talk and days by date, runs by at',
        (where('talk') || [])[0] &&
          where('talk')[0][0] === 'date' &&
          where('days')[0][0] === 'date' &&
          where('runs')[0][0] === 'at' &&
          !q.some(
            ([n]) => ['system', 'legacy', 'debug', 'materials', 'libindex', 'journal'].includes(n) && n !== 'journal'
          ),
        JSON.stringify(q.filter(([, f]) => f.length))
      );
      ok(
        'never subscribes to system, legacy, debug, materials or libindex at boot',
        !q.some(([n]) => ['system', 'legacy', 'debug', 'materials', 'libindex'].includes(n))
      );
    }
    await page.close();
  }
  // B-208 (D-210, D-225): three layouts by width. Under 600 px the sections are a tab bar along the bottom; 600 to 1199
  // px a sidebar on the left beside the pane; from 1200 px the details panel on the right too (Today has a side
  // column). The top bar is gone; the reading column is at most 680 px and centred in the pane; nothing scrolls sideways.
  for (const w of [390, 560, 599, 600, 735, 960, 1199, 1200, 1706, 2560]) {
    const { page } = await open(browser, { viewport: { width: w, height: 860 } });
    await page.waitForTimeout(500);
    const v = await page
      .evaluate(() => {
        document.getElementById('tab-today').click();
        const side = document.getElementById('top').getBoundingClientRect(),
          wrap = document.querySelector('.wrap').getBoundingClientRect(),
          tabs = [...document.querySelectorAll('#top .tabs .tab')].map(t => t.getBoundingClientRect()),
          right = document.querySelector('#p-today .col-side'),
          rr = right && right.firstElementChild && right.getBoundingClientRect(),
          pane = parseFloat(getComputedStyle(document.body).paddingLeft);
        return {
          bar:
            Math.round(side.bottom) === innerHeight &&
            side.width === innerWidth &&
            tabs.every(t => Math.abs(t.top - tabs[0].top) < 1),
          sidebar:
            side.left === 0 && side.top === 0 && side.height === innerHeight && side.width >= 180 && side.width <= 240,
          right: !!rr && getComputedStyle(right).position === 'fixed' && rr.left >= wrap.right,
          wrapW: Math.round(wrap.width),
          centred:
            Math.abs(
              wrap.left - pane - (innerWidth - parseFloat(getComputedStyle(document.body).paddingRight) - wrap.right)
            ) <= 2,
          topBar: !!document.querySelector('header.top'),
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      })
      .catch(e => ({ error: e.message }));
    const want =
      w < 600
        ? 'the tab bar'
        : w < 1200
          ? 'the sidebar beside the pane'
          : 'the sidebar, the pane and the details panel';
    ok(
      `[${w}] ${want}; no top bar; the column at most 680 px, centred`,
      !v.sideways &&
        !v.topBar &&
        v.wrapW <= 680 &&
        v.centred &&
        (w < 600 ? v.bar && !v.sidebar && !v.right : w < 1200 ? v.sidebar && !v.right : v.sidebar && v.right),
      JSON.stringify(v)
    );
    await page.close();
  }
  // B-221 (Matt, Oct 22): from 600 px the sidebar sits on the sunken ground and the view in a raised, outlined pane, in
  // both themes; nothing the shell paints before the stylesheet covers them. The sidebar's sections, the status word.
  for (const scheme of ['light', 'dark'])
    for (const w of [735, 1706]) {
      const { page } = await open(browser, { viewport: { width: w, height: 860 }, scheme });
      await page.waitForTimeout(600);
      const v = await page.evaluate(() => {
        const cs = getComputedStyle,
          root = cs(document.documentElement),
          pane = cs(document.body, '::before'),
          tok = n => root.getPropertyValue(n).trim();
        const rgb = h => {
          const x = document.createElement('i');
          x.style.color = h;
          document.body.append(x);
          const c = cs(x).color;
          x.remove();
          return c;
        };
        return {
          html: root.backgroundColor,
          body: cs(document.body).backgroundColor,
          pane: pane.backgroundColor,
          outline: pane.boxShadow !== 'none',
          sunken: rgb(tok('--sunken')),
          bg: rgb(tok('--bg')),
          today:
            !document.getElementById('side-today').hidden &&
            [...document.querySelectorAll('#side-today .si .t')].every(t => t.textContent.trim().length > 2),
          readout: document.getElementById('readout').textContent,
          first:
            document.querySelector('#tab-ev .lab-side') &&
            cs(document.querySelector('#tab-ev .lab-side')).display !== 'none',
        };
      });
      ok(
        `[${w} ${scheme}] the sidebar on the sunken ground, the view in a raised, outlined pane; Today in the sidebar; her status word; Conversation`,
        v.html === v.sunken &&
          v.pane === v.bg &&
          v.html !== v.pane &&
          v.outline &&
          /rgba\(0, 0, 0, 0\)|transparent/.test(v.body) &&
          v.today &&
          !/EV-04/.test(v.readout) &&
          v.first,
        JSON.stringify(v)
      );
      await page.close();
    }
  // B-208 (D-151, D-210): the pane's header names the view; the status line shows only a problem, by name.
  for (const w of [390, 735, 1280]) {
    const { page } = await open(browser, { viewport: { width: w, height: 844 } });
    await page.waitForTimeout(500);
    await page.click('#tab-today');
    await page.waitForTimeout(300);
    const v = await page.evaluate(() => {
      const s = document.getElementById('status');
      return {
        head: document.getElementById('mh-title').textContent,
        status: s.textContent,
        ok: s.classList.contains('ok'),
        shown: getComputedStyle(s).display !== 'none',
      };
    });
    ok(
      `[${w}] the header names the view; the status line hides while all is well`,
      v.head === 'Today' && (v.ok ? !v.shown : v.shown),
      JSON.stringify(v)
    );
    await page.close();
  }
  {
    const at = ((seed.health || {}).current || {}).at || new Date().toISOString(),
      t = new Date(Date.parse(at) + 60000).toISOString();
    const db = {
      ...seed,
      runs: {
        ...(seed.runs || {}),
        'weekly-shell-failed': {
          schema: 1,
          writer: 'weekly',
          at: t,
          source: 'weekly',
          release: RELEASE,
          pipeline: 'weekly',
          startedAt: t,
          endedAt: t,
          status: 'failed',
        },
      },
    };
    const { page } = await open(browser, { viewport: { width: 1280, height: 860 }, db });
    await page.waitForTimeout(600);
    const v = await page.evaluate(() => {
      const s = document.getElementById('status');
      return { status: s.textContent, shown: getComputedStyle(s).display !== 'none', color: getComputedStyle(s).color };
    });
    ok(
      '[1280] a planted failed run is the status line, by name, with no count',
      /^Weekly review’s last run failed/.test(v.status) && v.shown && !/\d+ (active|practice|things)/.test(v.status),
      JSON.stringify(v)
    );
    await page.screenshot({ path: `${shots}/status-problem-1280.png` });
    await page.close();
  }
  // The boot's refusals, each with its plain sentence and nothing else drawn.
  const phone = { width: 390, height: 844 };
  let r = await open(browser, { viewport: phone, pre: 'window.__notOwner=true;' });
  await r.page.waitForTimeout(400);
  ok(
    'someone other than the owner sees only the private-record line',
    /private study record/.test(await statusText(r.page)) &&
      !(await r.page.isVisible('#p-ev')) &&
      !(await r.page.isVisible('.tabs'))
  );
  await r.page.close();
  r = await open(browser, {
    viewport: phone,
    overrides: {
      'app.js': fs
        .readFileSync(path.join(pageDir, 'app.js'), 'utf8')
        .replace(`const VERSION = '${RELEASE}'`, "const VERSION = 'v4.0.0-old'"),
    },
  });
  await r.page.waitForTimeout(400);
  ok(
    'files from two releases stop the boot and say so',
    /different releases.*app v4\.0\.0-old/.test(await statusText(r.page)),
    await statusText(r.page)
  );
  await r.page.close();
  r = await open(browser, { viewport: phone, overrides: { 'core.js': null } });
  await r.page.waitForTimeout(400);
  ok(
    'a file that does not load stops the boot and says which',
    /could not load its files \(core\.js did not load\)/.test(await statusText(r.page)),
    await statusText(r.page)
  );
  await r.page.screenshot({ path: `${shots}/boot-failed-phone.png` });
  await r.page.close();
  // B-223 (D-245, D-228): one right panel on every view, each thing once, in both themes at Matt's widths; her lines
  // left-aligned on Conversation. Each view and state is judged by panel.cjs (planted failures in test/panel.test.mjs).
  for (const scheme of ['light', 'dark'])
    for (const w of [735, 1280, 1470, 1706, 2560]) {
      const { page, errors } = await open(browser, { viewport: { width: w, height: 1000 }, scheme });
      await page.waitForTimeout(700);
      const judged = [];
      const look = async (label, shot) => {
        await page.waitForTimeout(350);
        const snap = await page.evaluate(PANEL.collect);
        for (const j of PANEL.judge(snap)) judged.push([label, j]);
        if (shot && scheme === 'light') await page.screenshot({ path: `${shots}/panel-${label}-${w}.png` });
      };
      await look('ev', true);
      // a review opened on Conversation: the panel holds it, in the same shade, its count once
      const chip = page.locator('#qchips button', { hasText: /^Start review/ });
      if (await chip.count()) {
        await chip.first().click();
        await page.waitForSelector('#ev-surf', { timeout: 4000 }).catch(() => {});
        await look('ev-review', true);
        const once = await page.evaluate(() => {
          const s = document.getElementById('ev-surf');
          if (!s) return null;
          const t = s.innerText;
          const m = t.match(/\b(\d+) of (\d+)\b/g) || [];
          return { counts: m.length, text: t.slice(0, 120) };
        });
        ok(
          `[${w} ${scheme}] a review on Conversation shows its count once (D-228)`,
          !!once && once.counts === 1,
          JSON.stringify(once)
        );
        await page
          .locator('#ev-surf .sf-head')
          .click()
          .catch(() => {});
      } else
        ok(`[${w} ${scheme}] a review on Conversation shows its count once (D-228)`, false, 'no Start review chip');
      for (const t of ['today', 'progress', 'record', 'system']) {
        await page.click('#tab-' + t);
        await look(t, t === 'today');
      }
      await page.click('#tab-study');
      await page.click('#seg-study [data-v="review"]');
      await look('study-review', true);
      await page.click('#seg-study [data-v="practice"]');
      const lead = page.locator('#pr-body .pr-lead button.primary');
      if (await lead.count()) await lead.first().click();
      await look('study-practice', true);
      const bad = judged.filter(([, j]) => !j.ok);
      ok(
        `[${w} ${scheme}] one right panel on every view with detail, one shade, nothing twice, Today steps aside, her lines left (D-245, D-228)`,
        !bad.length && judged.length > 0 && !errors.length,
        bad.length
          ? bad
              .slice(0, 4)
              .map(([l, j]) => `${l}: ${j.rule}: ${j.detail}`)
              .join(' || ')
          : errors.slice(0, 2).join(' | ')
      );
      await page.close();
    }
  await browser.close();
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d && s === 'FAIL' ? '  -- ' + d : ''}`);
  const failed = results.filter(x => x[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} of ${results.length} checks pass; screenshots in ${shots}`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
