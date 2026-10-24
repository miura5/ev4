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
  // B-288 (D-225, C-4): at 390, 700, 1000 and 1280 in both themes. The tab bar shows only at 390, its E.V. tab is her
  // 24 px avatar (no icon) and every tab target there, System's included, is 44 px or more each way. The right panel
  // shows only from 1200 px; below that, each view's side column follows its main column inside the pane.
  for (const scheme of ['light', 'dark'])
    for (const w of [390, 700, 1000, 1280]) {
      const { page, errors } = await open(browser, { viewport: { width: w, height: w < 600 ? 844 : 900 }, scheme });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${shots}/widths-ev-${w}-${scheme}.png` });
      const bar = await page.evaluate(() => {
        const side = document.getElementById('top').getBoundingClientRect(),
          her = document.getElementById('tab-her'),
          hr = her.getBoundingClientRect(),
          icon = document.querySelector('#tab-ev > svg'),
          targets = [...document.querySelectorAll('#top .tabs .tab'), document.getElementById('tab-system')].map(t => {
            const r = t.getBoundingClientRect();
            return [t.id, Math.round(r.width), Math.round(r.height)];
          });
        return {
          bar: Math.round(side.bottom) === innerHeight && Math.round(side.width) === innerWidth,
          avatar:
            getComputedStyle(her).display !== 'none' &&
            !!her.querySelector('.ev-av') &&
            Math.round(hr.width) === 24 &&
            Math.round(hr.height) === 24 &&
            getComputedStyle(icon).display === 'none',
          targets,
        };
      });
      const phone = w < 600;
      ok(
        `[${w} ${scheme}] the tab bar shows only on the phone, its E.V. tab her 24 px avatar (B-288)`,
        phone ? bar.bar && bar.avatar : !bar.bar && !bar.avatar,
        JSON.stringify({ bar: bar.bar, avatar: bar.avatar })
      );
      if (phone)
        ok(
          `[${w} ${scheme}] every tab target, System's too, is 44 px or more each way (B-288)`,
          bar.targets.length === 6 && bar.targets.every(([, tw, th]) => tw >= 44 && th >= 44),
          JSON.stringify(bar.targets)
        );
      const panels = [];
      for (const t of ['today', 'progress', 'record', 'system']) {
        await page.click('#tab-' + t);
        await page.waitForTimeout(250);
        if (t === 'today') await page.screenshot({ path: `${shots}/widths-today-${w}-${scheme}.png` });
        panels.push(
          await page.evaluate(t => {
            const p = document.getElementById('p-' + t),
              open = [...p.querySelectorAll('.cols')].find(c => !c.closest('[hidden]')),
              side = open && open.querySelector(':scope > .col-side'),
              main = open && open.querySelector(':scope > .col-main'),
              vis = el =>
                [...el.children].filter(x => x.getClientRects().length && getComputedStyle(x).display !== 'none'),
              wrap = document.querySelector('.wrap').getBoundingClientRect();
            if (!side || !vis(side).length) return { t, none: true };
            const s = vis(side)[0].getBoundingClientRect(),
              m = vis(main),
              mb = m.length ? Math.max(...m.map(x => x.getBoundingClientRect().bottom)) : s.top;
            return {
              t,
              fixed: getComputedStyle(side).position === 'fixed',
              right: s.left >= wrap.right - 1,
              follows: s.top >= mb - 1 && s.left >= wrap.left - 1 && s.right <= wrap.right + 1,
            };
          }, t)
        );
      }
      const shown = panels.filter(p => !p.none);
      ok(
        `[${w} ${scheme}] the right panel shows only from 1200 px; below that its content follows the pane (B-288)`,
        shown.length > 0 &&
          !errors.length &&
          shown.every(p => (w >= 1200 ? p.fixed && p.right : !p.fixed && p.follows)),
        JSON.stringify(panels) + (errors.length ? ' errors: ' + errors.slice(0, 2).join(' | ') : '')
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
            cs(document.querySelector('#tab-ev .lab-side')).display !== 'none' &&
            document.querySelector('#tab-ev .lab-side').textContent.trim() === 'E.V.',
        };
      });
      ok(
        `[${w} ${scheme}] the sidebar on the sunken ground, the view in a raised, outlined pane; Today in the sidebar; her status word; E.V. first (D-293)`,
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
  // B-286 (D-280, D-291, D-292, D-293, C-4, C-14, C-15): the sidebar at 1280 in both themes. The nav reads E.V., Today,
  // Study, Progress, Record, its icons in the label's own neutral colour; her 24 px dial in her palette (--av1, --av2),
  // never the accent; no Working heading; Theme and Contrast in the foot; today's first five open items, then "n more in
  // Today", and no Today list while Today is open. Every nav item takes Tab with a ring of 3:1 or more against the
  // sidebar, and Enter opens its view.
  {
    const many = JSON.parse(JSON.stringify(seed));
    const dayId = Object.keys(many.days || {})
      .sort()
      .pop();
    for (let i = 1; i <= 4; i++)
      many.days[dayId].list.items.push({ id: 'b286-' + i, text: 'Planted item ' + i, tag: 'READING', minutes: 10 });
    for (const scheme of ['light', 'dark']) {
      const { page, errors } = await open(browser, { viewport: { width: 1280, height: 900 }, scheme, db: many });
      await page.waitForTimeout(700);
      const v = await page.evaluate(() => {
        const cs = getComputedStyle,
          root = cs(document.documentElement),
          side = document.getElementById('top');
        const rgb = h => {
          const x = document.createElement('i');
          x.style.color = h;
          document.body.append(x);
          const c = x.ownerDocument.defaultView.getComputedStyle(x).color;
          x.remove();
          return c;
        };
        const tok = n => rgb(root.getPropertyValue(n).trim());
        const nav = [...side.querySelectorAll('.tabs .tab')];
        const coded = ['--her', '--her2', '--sem-green', '--sem-yellow', '--sem-red', '--sem-blue', '--sem-violet'].map(
          tok
        );
        const c1 = side.querySelector('.top-av .c1'),
          c2 = side.querySelector('.top-av .c2');
        return {
          names: nav.map(b => b.innerText.trim()),
          neutral: nav.every(b => {
            const ic = b.querySelector(':scope > svg');
            return ic && cs(ic).color === cs(b).color && !coded.includes(cs(ic).color);
          }),
          av1: c1 && cs(c1).fill === tok('--av1') && cs(c1).fill !== tok('--her'),
          av2: c2 ? cs(c2).fill === tok('--av2') : true,
          avSize: Math.round(side.querySelector('.top-av').getBoundingClientRect().width),
          working:
            [...side.querySelectorAll('.sec')].some(x => /working/i.test(x.textContent)) ||
            !!document.getElementById('side-work'),
          foot: ['side-theme-seg', 'side-contrast-seg'].every(id => {
            const g = document.getElementById(id);
            return g && g.offsetParent && g.querySelectorAll('[aria-pressed="true"]').length === 1;
          }),
          rows: [...document.querySelectorAll('#side-today .si:not(.more)')].length,
          more: (document.querySelector('#side-today .si.more') || {}).textContent || '',
        };
      });
      ok(
        `[1280 ${scheme}] sidebar: E.V., Today, Study, Progress, Record with neutral icons; her dial in her palette; Theme and Contrast in the foot; no Working (B-286)`,
        v.names.join(',') === 'E.V.,Today,Study,Progress,Record' &&
          v.neutral &&
          v.av1 &&
          v.av2 &&
          v.avSize === 24 &&
          !v.working &&
          v.foot,
        JSON.stringify(v)
      );
      ok(
        `[1280 ${scheme}] sidebar Today: five open items, then "n more in Today" (B-286)`,
        v.rows === 5 && /^2 more in Today$/.test(v.more.trim()),
        JSON.stringify({ rows: v.rows, more: v.more })
      );
      // Tab from the brand through the five nav items: each takes the focus with a visible ring, and Enter opens it.
      await page.focus('#brand');
      const ring = [];
      for (const t of ['ev', 'today', 'study', 'progress', 'record']) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => {
          const a = document.activeElement,
            c = getComputedStyle(a);
          const lum = s => {
            const m = s.match(/[\d.]+/g).map(Number);
            const [r, g, b] = m.slice(0, 3).map(v => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const ground = getComputedStyle(document.documentElement).backgroundColor;
          const x = lum(c.outlineColor),
            y = lum(ground);
          return {
            id: a.id,
            ring: c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) >= 2,
            ratio: Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100,
          };
        });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(150);
        const opened = await page.evaluate(t => !document.getElementById('p-' + t).hidden, t);
        ring.push({ t, ...f, opened });
      }
      ok(
        `[1280 ${scheme}] every nav item takes Tab with a ring of 3:1 or more, and Enter opens it (B-286)`,
        ring.every(
          (r, i) =>
            r.id === 'tab-' + ['ev', 'today', 'study', 'progress', 'record'][i] && r.ring && r.ratio >= 3 && r.opened
        ),
        JSON.stringify(ring)
      );
      // Today is open now (the walk passed it); open it again and read the sidebar.
      await page.click('#tab-today');
      await page.waitForTimeout(150);
      const hiddenOnToday = await page.evaluate(() => {
        const t = document.getElementById('side-today');
        return t.hidden || getComputedStyle(t).display === 'none';
      });
      ok(
        `[1280 ${scheme}] with Today open, the sidebar shows no Today list (D-292)`,
        hiddenOnToday && !errors.length,
        errors.slice(0, 2).join(' | ')
      );
      await page.screenshot({ path: `${shots}/shell-sidebar-1280-${scheme}.png` });
      await page.close();
    }
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
  // B-223 (D-245, D-292): one right panel on every view, each thing once, in both themes at Matt's widths; her lines
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
          `[${w} ${scheme}] a review on Conversation shows its count once (D-245)`,
          !!once && once.counts === 1,
          JSON.stringify(once)
        );
        await page
          .locator('#ev-surf .sf-head')
          .click()
          .catch(() => {});
      } else
        ok(`[${w} ${scheme}] a review on Conversation shows its count once (D-245)`, false, 'no Start review chip');
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
        `[${w} ${scheme}] one right panel on every view with detail, one shade, nothing twice, Today steps aside, her lines left (D-245, D-292)`,
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
  // B-287 (C-4, C-7): the 48 px header names the view ("E.V." on hers) and ends with New, the one way to create. New
  // opens a menu of Task for Today and Note; each opens a modal dialog that Tab and Shift+Tab never leave (20 presses
  // each); Esc closes the menu or the dialog and gives focus back to New. A note lands in ideas with no course. No other
  // button on any view creates a task or a note (the exam prep check's "Add", one more thing to bring, is neither).
  for (const w of [390, 1280])
    for (const scheme of ['light', 'dark']) {
      const { page, errors } = await open(browser, { viewport: { width: w, height: w < 600 ? 844 : 900 }, scheme });
      await page.waitForTimeout(700);
      const tag = `[${w} ${scheme}]`;
      const head = await page.evaluate(() => ({
        title: document.getElementById('mh-title').textContent,
        h: Math.round(document.getElementById('mh').getBoundingClientRect().height),
        newShown: !!document.getElementById('new-btn').offsetParent,
      }));
      ok(
        `${tag} the header is 48 px, names her view "E.V." and ends with New (B-287)`,
        head.title === 'E.V.' && head.h === 48 && head.newShown,
        JSON.stringify(head)
      );
      const focusId = () => page.evaluate(() => (document.activeElement && document.activeElement.id) || '');
      await page.click('#new-btn');
      await page.waitForTimeout(80);
      const menu = await page.evaluate(() => ({
        shown: !document.getElementById('new-menu').hidden,
        items: [...document.querySelectorAll('#new-menu [role="menuitem"]')].map(b => b.textContent.trim()),
        expanded: document.getElementById('new-btn').getAttribute('aria-expanded'),
        first: document.activeElement && document.activeElement.dataset.new,
      }));
      await page.screenshot({ path: `${shots}/new-menu-${w}-${scheme}.png` });
      await page.keyboard.press('Escape');
      const fromMenu = {
        hidden: await page.evaluate(() => document.getElementById('new-menu').hidden),
        focus: await focusId(),
      };
      ok(
        `${tag} New opens a menu of Task for Today and Note; Esc closes it and gives focus back to New (B-287)`,
        menu.shown &&
          menu.items.join('|') === 'Task for Today|Note' &&
          menu.expanded === 'true' &&
          menu.first === 'task' &&
          fromMenu.hidden &&
          fromMenu.focus === 'new-btn',
        JSON.stringify({ menu, fromMenu })
      );
      const trap = async kind => {
        await page.click('#new-btn');
        await page.click(`#new-menu [data-new="${kind}"]`);
        await page.waitForTimeout(80);
        const out = { open: await page.evaluate(() => document.getElementById('new-dlg').open), left: [] };
        for (const key of ['Tab', 'Shift+Tab'])
          for (let i = 0; i < 20; i++) {
            await page.keyboard.press(key);
            const inside = await page.evaluate(
              () => !!(document.activeElement && document.activeElement.closest('#new-dlg'))
            );
            if (!inside) out.left.push(key + ' ' + (i + 1));
          }
        return out;
      };
      const t = await trap('task');
      await page.screenshot({ path: `${shots}/new-task-${w}-${scheme}.png` });
      await page.keyboard.press('Escape');
      const fromTask = {
        open: await page.evaluate(() => document.getElementById('new-dlg').open),
        focus: await focusId(),
      };
      const n = await trap('note');
      const noteShape = await page.evaluate(() => ({
        head: document.getElementById('new-head').textContent,
        fields: [...document.querySelectorAll('#new-dlg :is(input,textarea,select)')]
          .filter(x => !x.hidden)
          .map(x => x.id),
      }));
      await page.screenshot({ path: `${shots}/new-note-${w}-${scheme}.png` });
      await page.keyboard.press('Escape');
      const fromNote = {
        open: await page.evaluate(() => document.getElementById('new-dlg').open),
        focus: await focusId(),
      };
      ok(
        `${tag} the New task and New note dialogs are modal: 20 Tabs and 20 Shift+Tabs stay inside; Esc gives focus back to New (B-287)`,
        t.open &&
          n.open &&
          !t.left.length &&
          !n.left.length &&
          !fromTask.open &&
          fromTask.focus === 'new-btn' &&
          !fromNote.open &&
          fromNote.focus === 'new-btn',
        JSON.stringify({ t, n, fromTask, fromNote })
      );
      if (scheme === 'light') {
        await page.click('#new-btn');
        await page.click('#new-menu [data-new="note"]');
        await page.keyboard.type('Rounding to tenths for mL');
        await page.click('#new-save');
        await page.waitForTimeout(150);
        const note = await page.evaluate(() => {
          const w = (window.__writes || []).find(
            x => x[1] === 'ideas' && x[3] && x[3].text === 'Rounding to tenths for mL'
          );
          return { data: w && w[3], focus: document.activeElement && document.activeElement.id };
        });
        await page.click('#tab-record');
        await page.waitForTimeout(150);
        const listed = await page.evaluate(() =>
          document.getElementById('ideas').textContent.includes('Rounding to tenths for mL')
        );
        ok(
          `${tag} a new note lands in ideas, with no course, and shows in Record (B-287)`,
          !!note.data &&
            !('course' in note.data) &&
            note.data.status === 'open' &&
            listed &&
            note.focus === 'new-btn' &&
            noteShape.fields.join() === 'new-text',
          JSON.stringify({ note, listed, noteShape })
        );
        // B-308 (C-7): the New task window's Category, Estimate, When and Course go through the list edit: a 20-minute
        // Reading task for today lands on Today's list with its badge, course and 20 min, and the budget counts it; one
        // saved for tomorrow lands on tomorrow's list.
        await page.evaluate(() => document.getElementById('tab-today').click());
        await page.waitForTimeout(120);
        const planned = () =>
          page.evaluate(() => {
            const m = /(\d+) of \d+ min planned/.exec(document.getElementById('today-list').textContent);
            return m ? Number(m[1]) : null;
          });
        const before = await planned();
        await page.click('#new-btn');
        await page.click('#new-menu [data-new="task"]');
        const shape = await page.evaluate(() => ({
          fields: !document.getElementById('new-fields').hidden,
          kinds: [...document.querySelectorAll('#new-kind button')].map(b => b.textContent),
          whens: [...document.querySelectorAll('#new-when button')].map(b => b.textContent),
          courses: [...document.querySelectorAll('#new-course button')].map(b => b.textContent),
        }));
        await page.keyboard.type('Harness reading chapter 12');
        await page.click('#new-kind [data-v="reading"]');
        await page.fill('#new-min', '20');
        const course = shape.courses[shape.courses.length - 1];
        await page.click(`#new-course [data-v="${course}"]`);
        await page.click('#new-save');
        await page.waitForTimeout(150);
        const added = await page.evaluate(
          ({ course }) => {
            const today = window.EVCore.chicagoDate(new Date());
            const w = (window.__writes || [])
              .filter(x => x[1] === 'dayedits' && x[2] === today)
              .map(x => Object.values((x[3] && x[3].added) || {}).find(a => a.text === 'Harness reading chapter 12'))
              .find(Boolean);
            const row = [...document.querySelectorAll('#today-list .today-item')].find(li =>
              li.textContent.includes('Harness reading chapter 12')
            );
            return {
              w,
              badge: row && row.querySelector('.badge') && row.querySelector('.badge').textContent,
              time: row && row.querySelector('.t') && row.querySelector('.t').textContent,
              more: row && row.querySelector('.ti-more') && row.querySelector('.ti-more').textContent,
              course,
            };
          },
          { course }
        );
        const after = await planned();
        await page.click('#new-btn');
        await page.click('#new-menu [data-new="task"]');
        const reset = await page.evaluate(() => ({
          min: document.getElementById('new-min').value,
          when: (document.querySelector('#new-when [aria-pressed="true"]') || {}).textContent,
        }));
        await page.keyboard.type('Harness tomorrow task');
        await page.click('#new-when [data-v="tomorrow"]');
        await page.click('#new-save');
        await page.waitForTimeout(150);
        const tom = await page.evaluate(() => {
          const t = window.EVCore.addDays(window.EVCore.chicagoDate(new Date()), 1);
          const w = (window.__writes || []).find(
            x =>
              x[1] === 'dayedits' &&
              x[2] === t &&
              Object.values((x[3] && x[3].added) || {}).some(a => a.text === 'Harness tomorrow task')
          );
          const onToday = document.getElementById('today-list').textContent.includes('Harness tomorrow task');
          return { written: !!w, onToday };
        });
        ok(
          `${tag} New task's Category, Estimate, When and Course: 20 min of Reading lands on today with its badge and course and the budget counts it; Tomorrow lands on tomorrow's list (B-308)`,
          shape.fields &&
            shape.kinds.join('|') === 'To-do|Reading|Practice|Review|Notes' &&
            shape.whens.join('|') === 'Today|Tomorrow' &&
            shape.courses.length > 0 &&
            !!added.w &&
            added.w.kind === 'reading' &&
            added.w.minutes === 20 &&
            added.w.course === course &&
            added.badge === 'Reading' &&
            added.time === '20 min' &&
            String(added.more).includes(course) &&
            (before == null || after === before + 20) &&
            reset.min === '15' &&
            reset.when === 'Today' &&
            tom.written &&
            !tom.onToday,
          JSON.stringify({ shape, added, before, after, reset, tom })
        );
        const creates = [];
        for (const v of ['ev', 'today', 'study', 'progress', 'record', 'system']) {
          await page.evaluate(v => document.getElementById('tab-' + v).click(), v);
          await page.waitForTimeout(120);
          creates.push(
            ...(await page.evaluate(
              v =>
                [...document.querySelectorAll('button, input[type=submit]')]
                  .filter(b => b.offsetParent && !b.closest('#new-wrap, #new-dlg, .prep-add'))
                  .map(b => (b.textContent || b.value || '').trim())
                  .filter(t =>
                    /^(\+\s*)?(add|new|create|log something|add task|add note|save note|new task|new note)$/i.test(t)
                  )
                  .map(t => v + ': ' + t),
              v
            ))
          );
        }
        const addRow = await page.evaluate(() => !!document.querySelector('#today-add, .add-row'));
        ok(
          `${tag} no other button on any view creates a task or a note (B-287)`,
          !creates.length && !addRow,
          JSON.stringify({ creates, addRow })
        );
      }
      ok(`${tag} no page errors with New`, errors.length === 0, errors.join(' | '));
      await page.close();
    }
  // B-228 (D-208), B-287 (C-7): with the record 2 s slow, a task from New lands on Today's list on Enter's frame, before
  // the record answers, and focus is back on New; Enter adds two dates the same way, the title fresh and focused, and
  // Esc leaves it. At 390 and 1280.
  for (const w of [390, 1280]) {
    const { page } = await open(browser, { viewport: { width: w, height: 844 } });
    await page.waitForTimeout(700);
    await page.evaluate(() => (window.__writeDelayMs = 2000));
    await page.click('#tab-today');
    const added = [];
    for (const t of ['Harness item one', 'Harness item two', 'Harness item three']) {
      await page.click('#new-btn');
      await page.click('#new-menu [data-new="task"]');
      await page.keyboard.type(t);
      const t0 = Date.now();
      await page.keyboard.press('Enter');
      const r = await page.evaluate(
        t =>
          new Promise(ok =>
            requestAnimationFrame(() =>
              ok({
                listed: [...document.querySelectorAll('#today-list .ti-t')].some(x => x.textContent.trim() === t),
                fresh: document.activeElement && document.activeElement.id === 'new-btn',
              })
            )
          ),
        t
      );
      added.push({ t, ...r, ms: Date.now() - t0 });
    }
    const listedBefore = await page.evaluate(() => (window.__writes || []).filter(x => x[1] === 'dayedits').length);
    ok(
      `[${w}] a task from New lands on Today's list on Enter's frame, before the record answers, focus back on New (D-208)`,
      added.every(a => a.listed && a.fresh) && listedBefore === 0,
      JSON.stringify({ added, listedBefore })
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
