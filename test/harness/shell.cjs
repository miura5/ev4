// The shell harness (B-15): drives the built shell with its published files served
// locally, at phone and desktop width, with the record, sample, mcp and the reader stubbed (stub.js).
//   node test/harness/shell.cjs [record dir] [screenshots dir] [target]
// record dir: a folder of <collection>/<id>.json (default: the synthetic record in test/data/record).
// Run `node tools/build.mjs` first: the harness reads dist/page/<target>/. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const PANEL = require('./panel.cjs');
const png = require('./png.cjs');
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
  // B-224 (D-229): System's Preferences. Larger puts every text one step up (x1.125) with no sideways scroll at Matt's
  // sizes; Reduce motion On gives the same screenshots as the system's reduced motion; both survive a reload.
  {
    const texts = page =>
      page.evaluate(() =>
        [...document.querySelectorAll('body *')]
          .filter(e => {
            if (e.closest('[hidden]') || getComputedStyle(e).display === 'none') return false;
            return [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
          })
          .map(e => parseFloat(getComputedStyle(e).fontSize))
      );
    for (const w of [390, 735]) {
      const { page } = await open(browser, { viewport: { width: w, height: 844 } });
      await page.waitForTimeout(600);
      await page.click('#tab-system');
      await page.waitForTimeout(300);
      const before = await texts(page);
      await page.click('#text-seg [data-p="larger"]');
      await page.waitForTimeout(200);
      const after = await texts(page);
      const off = before.map((b, i) => [b, after[i]]).filter(([b, a]) => Math.abs(a - b * 1.125) > 0.6);
      ok(
        `[${w}] Text size Larger puts every text one step up (x1.125) (D-229)`,
        before.length > 20 && before.length === after.length && !off.length,
        `${before.length} texts; off: ${JSON.stringify(off.slice(0, 5))}`
      );
      await page.click('#motion-seg [data-p="reduce"]');
      await page.reload();
      await page.waitForTimeout(700);
      await page.click('#tab-system');
      await page.waitForTimeout(200);
      const kept = await page.evaluate(() => ({
        text: document.documentElement.getAttribute('data-text'),
        motion: document.documentElement.getAttribute('data-motion'),
        pressed: [
          ...document.querySelectorAll('#text-seg [aria-pressed="true"], #motion-seg [aria-pressed="true"]'),
        ].map(b => b.dataset.p),
      }));
      ok(
        `[${w}] Larger and Reduce motion On survive a reload (D-229)`,
        kept.text === 'larger' && kept.motion === 'reduce' && kept.pressed.join() === 'larger,reduce',
        JSON.stringify(kept)
      );
      await page.close();
    }
    const larger = 'try{localStorage.setItem("ev.text","larger")}catch(e){};';
    for (const [w, h] of [
      [390, 844],
      [735, 830],
      [1706, 1240],
      [2560, 1240],
    ]) {
      const { page } = await open(browser, { viewport: { width: w, height: h }, pre: larger });
      await page.waitForTimeout(600);
      const wide = [];
      for (const t of ['ev', 'today', 'study', 'progress', 'record', 'system']) {
        await page.click('#tab-' + t);
        await page.waitForTimeout(250);
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(t);
      }
      const on = await page.evaluate(() => document.documentElement.getAttribute('data-text'));
      ok(`[${w}x${h}] Larger: no sideways scroll on any tab (D-229)`, on === 'larger' && !wide.length, wide.join(', '));
      if (w === 390) await page.screenshot({ path: `${shots}/prefs-larger-${w}.png` });
      await page.close();
    }
    // the same view twice, once under the system's reduced motion, once under his On: the same pixels
    for (const w of [390, 735])
      for (const t of ['today', 'progress']) {
        // (not System: its Preferences show which setting is on)
        const shot = async (pre, reduce) => {
          const { page } = await open(browser, { viewport: { width: w, height: 844 }, pre });
          await page.emulateMedia({ reducedMotion: reduce ? 'reduce' : 'no-preference' });
          await page.waitForTimeout(700);
          await page.click('#tab-' + t);
          await page.waitForTimeout(800);
          const b = await page.screenshot();
          await page.close();
          return b;
        };
        const sys = await shot('', true),
          mine = await shot('try{localStorage.setItem("ev.motion","reduce")}catch(e){};', false);
        const d = png.diff(sys, mine);
        ok(
          `[${w}] ${t}: Reduce motion On matches the system's reduced motion (D-229)`,
          d.share <= 0.002,
          JSON.stringify(d)
        );
      }
  }
  // B-225 (D-271): a fold opens in at most 0.28 s and closes in at most 0.16 s (the chevron of her briefing line and of
  // a surface's head line, each read in its open and its closed state), at 390 and 1280.
  for (const w of [390, 1280]) {
    const { page } = await open(browser, { viewport: { width: w, height: 844 } });
    await page.waitForTimeout(900);
    const dur = sel =>
      page.evaluate(sel => {
        const e = document.querySelector(sel);
        if (!e) return null;
        return Math.max(
          ...getComputedStyle(e)
            .transitionDuration.split(',')
            .map(x => parseFloat(x) * 1000)
        );
      }, sel);
    const fold = async (line, chev) => {
      if (!(await page.locator(line).count())) return null;
      await page.locator(line).first().click();
      await page.waitForTimeout(350);
      const open = await dur(chev);
      await page.locator(line).first().click();
      await page.waitForTimeout(350);
      return { open, closed: await dur(chev) };
    };
    const brief = await fold('#thread .brief-row', '#thread .brief-row .chev');
    ok(
      `[${w}] a fold opens in 0.28 s and closes in 0.16 s (D-271)`,
      !!brief && brief.open > 0 && brief.open <= 280 && brief.closed > 0 && brief.closed <= 160,
      JSON.stringify({ brief })
    );
    await page.close();
  }
  // B-228 (D-208): with the record 2 s slow, Enter adds three Today items and two dates: each lands in its list before
  // the record answers, focus stays in a fresh row, and Esc leaves it. At 390 and 1280.
  for (const w of [390, 1280]) {
    const { page } = await open(browser, { viewport: { width: w, height: 844 } });
    await page.waitForTimeout(700);
    await page.evaluate(() => (window.__writeDelayMs = 2000));
    await page.click('#tab-today');
    await page.click('#today-add');
    const added = [];
    for (const t of ['Harness item one', 'Harness item two', 'Harness item three']) {
      await page.keyboard.type(t);
      const t0 = Date.now();
      await page.keyboard.press('Enter');
      const r = await page.evaluate(
        t =>
          new Promise(ok =>
            requestAnimationFrame(() =>
              ok({
                listed: [...document.querySelectorAll('#today-list .ti-t')].some(x => x.textContent.trim() === t),
                fresh:
                  document.activeElement && document.activeElement.id === 'today-add' && !document.activeElement.value,
              })
            )
          ),
        t
      );
      added.push({ t, ...r, ms: Date.now() - t0 });
    }
    const listedBefore = await page.evaluate(() => (window.__writes || []).filter(x => x[1] === 'dayedits').length);
    await page.keyboard.press('Escape');
    const left = await page.evaluate(() => !document.activeElement || document.activeElement.id !== 'today-add');
    ok(
      `[${w}] Enter adds three Today items on their frame, the row fresh and focused each time; Esc leaves (D-208)`,
      added.every(a => a.listed && a.fresh) && listedBefore === 0 && left,
      JSON.stringify({ added, listedBefore, left })
    );
    await page.click('#tab-record');
    await page.click('#seg-record [data-v="dates"]');
    const day = await page.evaluate(() => {
      const d = new Date(Date.now() + 3 * 864e5);
      return d.toISOString().slice(0, 10);
    });
    await page.fill('#d-date', day);
    const dates = [];
    for (const t of ['Harness date A', 'Harness date B']) {
      await page.fill('#d-title', t);
      await page.press('#d-title', 'Enter');
      const r = await page.evaluate(
        t =>
          new Promise(ok =>
            requestAnimationFrame(() =>
              ok({
                listed: document.getElementById('dates').textContent.includes(t),
                fresh:
                  document.activeElement && document.activeElement.id === 'd-title' && !document.activeElement.value,
              })
            )
          ),
        t
      );
      dates.push({ t, ...r });
    }
    await page.keyboard.press('Escape');
    const leftD = await page.evaluate(() => !document.activeElement || document.activeElement.id !== 'd-title');
    ok(
      `[${w}] Enter adds two dates on their frame, the title fresh and focused each time; Esc leaves (D-208)`,
      dates.every(d => d.listed && d.fresh) && leftD,
      JSON.stringify({ dates, leftD })
    );
    if (w === 390) await page.screenshot({ path: `${shots}/enter-dates-${w}.png` });
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
