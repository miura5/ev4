// The shell harness (B-15): drives the built shell with its published files served
// locally, at phone and desktop width, with the record, sample, mcp and the reader stubbed (stub.js).
//   node test/harness/shell.cjs [record dir] [screenshots dir] [target]
// record dir: a folder of <collection>/<id>.json (default: the synthetic record in test/data/record).
// Run `node tools/build.mjs` first: the harness reads dist/page/<target>/. Exit code 1 when any check fails.
const { chromium } = require('playwright');
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
async function open(browser, { viewport, pre = '', overrides = {}, db = seed }) {
  const page = await browser.newPage({ viewport, colorScheme: 'dark' });
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
  // B-114 (D-159): the header changes only at 1024 px: icon tabs and no status line at 560, 735, 960 and 1023; named
  // tabs and the status line at 1024 and 1470. Between 600 and 1024 the column is centred at most 660 px wide.
  for (const w of [560, 735, 960, 1023, 1024, 1470]) {
    const { page } = await open(browser, { viewport: { width: w, height: 860 } });
    await page.waitForTimeout(500);
    const v = await page
      .evaluate(() => {
        const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 1;
        document.getElementById('tab-today').click();
        const wrap = document.querySelector('.wrap').getBoundingClientRect();
        return {
          iconTabs: [...document.querySelectorAll('#top .tabs .tab span')].every(s => !vis(s)),
          statusLine: vis(document.getElementById('status')),
          wrapW: Math.round(wrap.width),
          centred: Math.abs(wrap.left - (innerWidth - wrap.right)) <= 2,
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      })
      .catch(e => ({ error: e.message }));
    const desk = w >= 1024;
    ok(
      `[${w}] ${desk ? 'the desktop header: named tabs and the status line' : 'one layout: icon tabs, no status line, the column centred at most 660 px'}`,
      !v.sideways && (desk ? !v.iconTabs && v.statusLine : v.iconTabs && !v.statusLine && v.centred && v.wrapW <= 660),
      JSON.stringify(v)
    );
    await page.close();
  }
  // B-120 (D-156, D-157): the page title only from 1024 px; the status line reads Live, or the one problem by name.
  for (const w of [390, 735, 1280]) {
    const { page } = await open(browser, { viewport: { width: w, height: 844 } });
    await page.waitForTimeout(500);
    await page.click('#tab-today');
    await page.waitForTimeout(300);
    const v = await page.evaluate(() => {
      const t = document.querySelector('#p-today .ptitle'),
        s = document.getElementById('status');
      return {
        title: !!t && getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().height > 0,
        status: s.textContent,
        shown: getComputedStyle(s).display !== 'none',
      };
    });
    ok(
      `[${w}] ${w >= 1024 ? 'the page title and the status line Live' : 'no page title, no status line'}`,
      w >= 1024 ? v.title && v.status === 'Live' && v.shown : !v.title && !v.shown,
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
  await browser.close();
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d && s === 'FAIL' ? '  -- ' + d : ''}`);
  const failed = results.filter(x => x[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} of ${results.length} checks pass; screenshots in ${shots}`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
