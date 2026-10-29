// The look pass (B-101, B-113): every view of every tab of the built page (each tab, and each segment of a tab's seg
// control) at Matt's sizes (views.cjs: phone 375 to 430, the phone with its keyboard open, the Claude side panel, half
// the laptop, half a 1080p screen, the laptop and the big screens), full-page screenshots to look at after a page
// change, with the record, sample, mcp and the reader stubbed (stub.js) as in shell.cjs. Checks what any screen must
// hold: no page error, no sideways scroll, and on the E.V. tab the composer in view.
//   node test/harness/look.cjs [record dir | synthetic] [screenshots dir] [target]
// record dir: a folder of <collection>/<id>.json (default: the synthetic record, test/data/synthetic.cjs).
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
// B-149: the release comes from the build (git describe at the build's commit), never a literal.
const RELEASE = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json'), 'utf8')).release;
const SPEC_VERSION = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8')).specVersion;
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dbDir = require('../data/synthetic.cjs').recordDir(process.argv[2]);
const shots = process.argv[3] || '/tmp/ev4-look';
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
delete seed.debug;
delete seed.journal; // the page never subscribes to these at boot
// B-111: a long idea, to hold its row to a readable shape at both widths.
const LONG_IDEA =
  'When sodium drops the brain swells because water follows the gradient into cells, so confusion and seizures come before anything shows on the heart monitor, unlike potassium, which hits rhythm.';
seed.ideas = {
  ...(seed.ideas || {}),
  'look-long-idea': {
    schema: 2,
    writer: 'page',
    at: '2026-10-19T23:00:00.000Z',
    source: 'E.V. Home',
    text: LONG_IDEA,
    objective: 'E4-2',
    status: 'open',
    links: [],
    kind: 'learning',
  },
};
// B-119: a weekly run that failed after the last health check, to hold System to leading with it.
const HC_AT = ((seed.health || {}).current || {}).at || new Date().toISOString();
const FAILED_AT = new Date(Date.parse(HC_AT) + 60000).toISOString();
seed.runs = {
  ...(seed.runs || {}),
  'weekly-look-failed': {
    schema: 1,
    writer: 'weekly',
    at: FAILED_AT,
    source: 'weekly',
    release: RELEASE,
    pipeline: 'weekly',
    startedAt: FAILED_AT,
    endedAt: FAILED_AT,
    status: 'failed',
    detail: 'the plan step stopped',
  },
};
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  body +
  '</body></html>';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };
const { SIZES, viewsOf, shotName } = require('./views.cjs');
const VIEWS = viewsOf(fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8'));
// B-115: spec.ui.tenets: the widths read closely and D-271's motion check (the look checks retired, D-327).
const TENETS = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'ev.spec.json'), 'utf8')).ui.tenets;
const { motion, judgeMotion } = require('./tenets.cjs');
const png = require('./png.cjs');
const { studyView } = require('./paint.cjs'); // B-297
const reports = [];
const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);

(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  // B-162 (A-9): the page's open time at 390 px on a throttled profile (4x CPU, as the frame budget's phone), from the
  // shell's request to E.V.'s first line, the files served from dist as the record's host would. One number, reported.
  let openTime = null;
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
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
        : r.fulfill({ status: 404, body: 'not published' });
    });
    await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
    const t0 = Date.now();
    await page.goto(ORIGIN + '/');
    const shown = await page
      .waitForFunction(() => document.querySelector('#thread .msg.ev'), null, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    openTime = shown ? Date.now() - t0 : null;
    ok(
      '[390x844] B-162: the page opens on a throttled profile and its time is recorded',
      shown,
      'no E.V. line in 20 s'
    );
    console.log(
      `open time: ${openTime == null ? 'none (the page did not open in 20 s)' : openTime + ' ms'} at 390x844, 4x CPU, from the shell's request to E.V.'s first line`
    );
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await ctx.close();
  }
  // B-204 (D-211), B-271 (D-273): D-273's floors on the tokens the built page computes, in both themes: the system
  // theme by prefers-color-scheme, and the stored toggle (ev.theme) over a system that says the other.
  {
    const C = require('./contrast.cjs'),
      TH = C.load();
    for (const [label, scheme, stored, want] of [
      ['system dark', 'dark', null, 'dark'],
      ['system light', 'light', null, 'light'],
      ['stored light over a dark system', 'dark', 'light', 'light'],
      ['stored dark over a light system', 'light', 'dark', 'dark'],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      const page = await ctx.newPage();
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
          ? r.fulfill({
              body: fs.readFileSync(f),
              contentType: TYPES[path.extname(name)] || 'application/octet-stream',
            })
          : r.fulfill({ status: 404, body: 'not published' });
      });
      if (stored) await page.addInitScript(`try{localStorage.setItem('ev.theme','${stored}')}catch(e){}`);
      await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
      await page.goto(ORIGIN + '/');
      await page
        .waitForFunction(() => document.querySelector('#thread .msg.ev'), null, { timeout: 8000 })
        .catch(() => {});
      const got = await page.evaluate(names => {
        const cs = getComputedStyle(document.documentElement);
        return {
          tokens: Object.fromEntries(names.map(n => [n, cs.getPropertyValue(n).trim()])),
          scheme: cs.colorScheme,
          body: getComputedStyle(document.body).backgroundColor,
        };
      }, C.TOKENS);
      const bad = C.judge(got.tokens, label);
      ok(
        `[390x844] B-271: ${label}: D-273's floors (text 4.5, faint 4.6, her ink 4.5, coded 3:1)`,
        !bad.length,
        bad.join('; ')
      );
      const ground = TH.genTheme(want, 60).bg.toUpperCase();
      ok(
        `[390x844] B-204: ${label}: the page is ${want}`,
        got.tokens['--bg'].toUpperCase() === ground && String(got.scheme).trim() === want,
        `--bg ${got.tokens['--bg']}, color-scheme ${got.scheme}`
      );
      await page.screenshot({ path: `${shots}/theme-${label.replace(/\W+/g, '-')}-390x844.png` });
      if (!stored && want === 'dark') {
        // B-214 (D-211): System's switch: Light stores light on this device and paints it now; System forgets it.
        await page.$eval('#tab-system', b => b.click());
        await page.click('#theme-seg [data-t="light"]');
        const a = await page.evaluate(() => ({
          attr: document.documentElement.getAttribute('data-theme'),
          stored: localStorage.getItem('ev.theme'),
          bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toUpperCase(),
          pressed: document.querySelector('#theme-seg [aria-pressed="true"]').dataset.t,
        }));
        await page.screenshot({ path: `${shots}/theme-switch-light-390x844.png` });
        await page.click('#theme-seg [data-t="system"]');
        const b = await page.evaluate(() => ({
          attr: document.documentElement.getAttribute('data-theme'),
          stored: localStorage.getItem('ev.theme'),
          bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toUpperCase(),
          pressed: document.querySelector('#theme-seg [aria-pressed="true"]').dataset.t,
        }));
        ok(
          "[390x844] B-214: System's switch: Light paints light at once and is stored on this device; System forgets it and follows the device again",
          a.attr === 'light' &&
            a.stored === 'light' &&
            a.bg === TH.genTheme('light', 60).bg.toUpperCase() &&
            a.pressed === 'light' &&
            b.attr === null &&
            b.stored === null &&
            b.bg === TH.genTheme('dark', 60).bg.toUpperCase() &&
            b.pressed === 'system',
          JSON.stringify({ a, b })
        );
        // B-271 (D-268, D-273): Contrast walks 30, 60 and 100 in both themes; each press runs the generator at once,
        // the page's tokens equal the generator's, the floors hold, and the choice is stored on this device.
        const walk = [];
        for (const t of ['light', 'dark'])
          for (const c of [30, 60, 100]) {
            await page.click(`#theme-seg [data-t="${t}"]`);
            await page.click(`#contrast-seg [data-c="${c}"]`);
            const g = await page.evaluate(names => {
              const cs = getComputedStyle(document.documentElement);
              return {
                tokens: Object.fromEntries(names.map(n => [n, cs.getPropertyValue(n).trim()])),
                stored: localStorage.getItem('ev.contrast'),
                pressed: document.querySelector('#contrast-seg [aria-pressed="true"]').dataset.c,
              };
            }, C.TOKENS);
            const gen = TH.vars(TH.genTheme(t, c)),
              off = C.TOKENS.filter(k => g.tokens[k].toLowerCase() !== gen[k]);
            walk.push(
              ...C.judge(g.tokens, `${t} ${c}`),
              ...off.map(k => `${t} ${c}: ${k} ${g.tokens[k]}, generator ${gen[k]}`)
            );
            if (g.pressed !== String(c) || g.stored !== (c === 60 ? null : String(c)))
              walk.push(`${t} ${c}: pressed ${g.pressed}, stored ${g.stored}`);
            await page.mouse.move(0, 0);
            await page.waitForTimeout(450); // the buttons' fills settle (B-125: within 450 ms) before the shot
            await page.screenshot({ path: `${shots}/theme-${t}-contrast-${c}-390x844.png` });
          }
        ok(
          "[390x844] B-271: Contrast 30, 60 and 100 in light and dark: the generator's tokens, D-273's floors, stored on this device",
          !walk.length,
          walk.join('; ')
        );
        await page.click('#contrast-seg [data-c="60"]');
        await page.click('#theme-seg [data-t="system"]');
      }
      await ctx.close();
    }
  }
  for (const size of SIZES.filter(z => !process.env.LOOK_SIZES || process.env.LOOK_SIZES.split(',').includes(z.tag))) {
    // LOOK_SIZES=390x844: a quicker pass while working (check.mjs runs them all)
    const width = size.tag,
      viewport = { width: size.width, height: size.height };
    // B-204: each size in the theme its canvas draws (views.cjs): the phone and a third of the ultrawide light.
    const page = await browser.newPage({ viewport, colorScheme: size.scheme });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const fontAsks = []; // B-303: the page asks Google Fonts for Inter (answered empty here: the pass has no network)
    await page.route('https://fonts.googleapis.com/**', r => {
      fontAsks.push(r.request().url());
      return r.fulfill({ body: '', contentType: 'text/css' });
    });
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
        : r.fulfill({ status: 404, body: 'not published' });
    });
    await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
    await page.goto(ORIGIN + '/');
    await page
      .waitForFunction(() => document.querySelector('#thread .msg.ev'), null, { timeout: 5000 })
      .catch(() => {});
    if ([390, 1280].includes(size.width) && [844, 800].includes(size.height)) {
      // B-303: Inter is the page's font: asked for from Google Fonts, the system font after it in the stack, and read
      // back as the computed font of the body, a row's name and a button
      const f = await page.evaluate(() =>
        ['body', '.side .tab', '#ev-input'].map(sel => {
          const e = document.querySelector(sel);
          return e ? getComputedStyle(e).fontFamily : '';
        })
      );
      ok(
        `[${width}] Inter is the computed font, asked for from Google Fonts, the system font its fallback (B-303)`,
        fontAsks.some(u => /family=Inter\b/.test(u)) &&
          f.every(x => /^"?Inter"?,/.test(x)) &&
          f.every(x => /system-ui/.test(x)),
        JSON.stringify({ fontAsks, f })
      );
    }
    for (const view of VIEWS) {
      await page.$eval('#tab-' + view.tab, b => b.click());
      if (view.v && (await page.isVisible(`#seg-${view.tab} [data-v="${view.v}"]`)))
        await page.click(`#seg-${view.tab} [data-v="${view.v}"]`); // D-249: every view is a tab at every width
      else if (view.v && view.tab === 'study') await studyView(page, view.v); // B-297: the review's quiz card
      await page.waitForTimeout(500); // past the panel's fade-in
      await page.screenshot({ path: `${shots}/${shotName(view, size)}`, fullPage: true });
      ok(
        `[${width}] ${view.id}: no sideways scroll`,
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      );
      if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
        // B-357 (D-327): the old look tenets' checks and the five kinds, one primary, are retired with the old UI
        // tenets; the demo is the UI.
        // B-285 (C-15): the screen-reader tree names the picked option of every switch on screen.
        for (const id of await page.$$eval('.seg[id]', s =>
          s.filter(x => !x.closest('[hidden]') && x.getBoundingClientRect().width > 1).map(x => x.id)
        )) {
          const tree = await page.locator('#' + id).ariaSnapshot();
          const picked = await page.$eval('#' + id, s =>
            // what shows (innerText): a segment's count reads "All 3", and a label hidden at this width is not read
            ((s.querySelector('[aria-pressed="true"],[aria-checked="true"]') || {}).innerText || '')
              .replace(/\s+/g, ' ')
              .trim()
          );
          const named = [...tree.matchAll(/button "([^"]+)" \[(?:pressed|checked)\]/g)].map(m => m[1]);
          ok(
            `[${width}] ${view.id}: C-15: the screen-reader tree names ${id}'s picked option`,
            named.length === 1 && named[0] === picked,
            `picked ${picked || 'none'}; tree: ${tree.replace(/\n/g, ' | ')}`
          );
        }
      }
      // B-275: Ember is hers alone: on this view, the sidebar and the header, no visible element draws in her
      // accent or her two faces except her avatar, a primary button and send.
      if (['390x844', '1280x800'].includes(width)) {
        const strays = await page.evaluate(() => {
          const cs = getComputedStyle(document.documentElement),
            probe = document.createElement('i');
          document.body.append(probe);
          const rgbOf = v => ((probe.style.color = v), getComputedStyle(probe).color);
          const ember = new Set(['--her', '--her2', '--av1', '--av2'].map(n => rgbOf(cs.getPropertyValue(n).trim())));
          probe.remove();
          const mine = e => e.closest('.ev-av, button.primary, #ev-send');
          const out = [];
          for (const e of document.querySelectorAll('body *')) {
            if (mine(e) || (e.checkVisibility && !e.checkVisibility({ visibilityProperty: true }))) continue;
            const s = getComputedStyle(e),
              r = e.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const used = [
              ['color', s.color, e.childNodes.length > 0],
              ['background', s.backgroundColor, true],
              ['border', s.borderTopColor, parseFloat(s.borderTopWidth) > 0],
              ['outline', s.outlineColor, s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0],
              ['fill', s.fill, e instanceof SVGElement],
              ['stroke', s.stroke, e instanceof SVGElement && s.stroke !== 'none'],
              ['shadow', s.boxShadow, s.boxShadow !== 'none'],
            ];
            for (const [what, v, on] of used)
              if (on && [...ember].some(c => String(v).includes(c)))
                out.push(
                  `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className.baseVal ?? e.className).split(' ')[0]} ${what}`
                );
          }
          // and selected text is the neutral wash, not the system highlight
          const sel = getComputedStyle(document.body, '::selection').backgroundColor,
            want = `rgba(${cs.getPropertyValue('--tint').trim().split(',').join(', ')}, 0.18)`;
          if (sel !== want) out.push(`::selection ${sel}, want ${want}`);
          return out.slice(0, 8);
        });
        ok(
          `[${width}] ${view.id}: B-275: Ember only on her, a primary button and send; selection neutral`,
          !strays.length,
          strays.join('; ')
        );
      }
      if (view.tab === 'ev')
        ok(
          `[${width}] ev: the composer is in view`,
          await page.evaluate(() => {
            const c = document.querySelector('.compose-row').getBoundingClientRect();
            return c.top >= 0 && c.bottom <= innerHeight + 1 && c.height > 0;
          })
        );
    }
    // B-357 (D-327): the old look's Today row heights, the view switch in the header, the Plan tab and the 680 px
    // column are retired; the demo's boards are the UI (the fidelity tools compare them)
    // B-338 (D-327): the readiness card and its objective list left Progress (the exam readiness rows are the run
    // harness's check)
    // B-357 (D-327): the old question view's layout checks (B-116, B-126) are retired; the quiz is the demo's StudyQuiz
    // (B-348, B-365, B-370), and its behaviour is the run harness's
    // B-357 (D-327): B-117's Today layout checks are retired with the old look (the prep harness checks Today's list)
    // B-119: System: the planted failed run leads; no ok pill; no card stands empty; the pipeline and run lists fold
    // under one line each, and only the runs that did not finish ok are marked.
    if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
      await page.$eval('#tab-system', b => b.click());
      await page.waitForTimeout(500);
      const s0 = await page.evaluate(() => {
        const vis = e =>
            !!e &&
            !e.closest('[hidden]') &&
            getComputedStyle(e).display !== 'none' &&
            e.getBoundingClientRect().height > 0,
          panel = document.getElementById('p-system');
        return {
          lead: (document.querySelector('#health-top > p') || {}).textContent,
          okPill: [...panel.querySelectorAll('.chip, li[data-key] button > span + span')]
            .filter(vis)
            .some(c => /^ok$/i.test(c.textContent.trim())),
          empty: [...panel.querySelectorAll('.empty')].filter(vis).length,
          emptyCards: [...panel.querySelectorAll('.card')]
            .filter(c => vis(c) && !c.querySelector('li, #health-top *, .seg button'))
            .map(c => c.id),
          listsOpen: ['pipes', 'runs'].filter(id => vis(document.getElementById(id))),
        };
      });
      ok(
        `[${width}] system: the failed run leads, no ok pill, no empty card, the lists folded`,
        /^Weekly review’s last run failed/.test(s0.lead || '') &&
          !s0.okPill &&
          !s0.empty &&
          !s0.emptyCards.length &&
          !s0.listsOpen.length,
        JSON.stringify(s0)
      );
      await page.click('#runs-fold');
      await page.waitForTimeout(150);
      const s1 = await page.evaluate(() =>
        [...document.querySelectorAll('#runs li[data-key]')].map(li => ({
          t: li.querySelector('button > span').textContent,
          mark: (li.querySelector('button > span + span') || {}).textContent || '',
          h: Math.round(li.getBoundingClientRect().height),
        }))
      );
      ok(
        `[${width}] system: opened, the runs are one line each and only the failed one is marked`,
        s1.length >= 2 &&
          s1.every(r => r.h <= 44) &&
          s1.filter(r => r.mark).length === 1 &&
          /Weekly review/.test(s1.find(r => r.mark).t) &&
          s1.find(r => r.mark).mark === 'failed',
        JSON.stringify(s1)
      );
      await page.screenshot({ path: `${shots}/look-system-runs-${width}.png`, fullPage: true });
      await page.click('#runs-fold');
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    // B-357 (D-327): B-121's two columns are retired; the demo's frame is the shell harness's
    // B-357 (D-327): B-123's Weak spots layout is retired with the old look (StudyWeak, B-365; Mark solid's write is the
    // run harness's)
    // B-125 (D-271): every view at 390 and 1280: no transition or animation over 450 ms outside her stage, her core (the
    // header avatar too), the reveal and the echo of his line; the view settled 450 ms after the switch; and the
    // reduced-motion screenshot the same as the settled one (B-224).
    if (['390x844', '1280x800'].includes(width)) {
      const M = TENETS.motion,
        sig = () =>
          page.evaluate(ex => {
            const p = document.querySelector('section.panel:not([hidden])');
            return [...p.querySelectorAll('*')]
              .filter(
                e =>
                  !ex.some(x => e.closest(x)) &&
                  (!e.checkVisibility || e.checkVisibility({ contentVisibilityAuto: true }))
              )
              .slice(0, 400)
              .map(e => {
                const r = e.getBoundingClientRect();
                return [
                  e.id || e.className,
                  Math.round(r.top),
                  Math.round(r.left),
                  Math.round(r.width),
                  Math.round(r.height),
                  getComputedStyle(e).opacity,
                ].join(',');
              })
              .join(';');
          }, M.exempt);
      const open = async view => {
        // B-297: the review's quiz card is reached from Today first; the timed open is then Study's tab, which keeps it
        if (view.v && view.tab === 'study' && !(await page.$(`#seg-study [data-v="${view.v}"]`)))
          await studyView(page, view.v);
        await page.$eval(view.tab === 'system' ? '#tab-today' : '#tab-system', b => b.click());
        await page.waitForTimeout(300);
        await page.evaluate(() => window.scrollTo(0, 0));
        const t0 = Date.now();
        await page.$eval('#tab-' + view.tab, b => b.click());
        if (view.v && (await page.isVisible(`#seg-${view.tab} [data-v="${view.v}"]`)))
          await page.click(`#seg-${view.tab} [data-v="${view.v}"]`);
        return t0;
      };
      const settledShot = () =>
        page.screenshot({
          fullPage: false,
          caret: 'hide',
          mask: M.exempt.map(x => page.locator(x)),
          maskColor: '#000',
        }); // her stage, core, reveal and echo keep their own pace
      for (const view of VIEWS) {
        const t0 = await open(view),
          first = await page.evaluate(motion, M);
        await page.waitForTimeout(Math.max(0, t0 + M.maxMs - Date.now()));
        const at = await page.evaluate(motion, M),
          s0 = await sig();
        await page.waitForTimeout(700);
        const s1 = await sig();
        const c = judgeMotion(first, at, M.maxMs);
        const moved =
          s0 === s1
            ? []
            : [s0.split(';').length + ' -> ' + s1.split(';').length].concat(
                s0
                  .split(';')
                  .map((x, i) => [i, x, s1.split(';')[i]])
                  .filter(([, a, b]) => a !== b)
                  .slice(0, 3)
              );
        ok(
          `[${width}] ${view.id}: D-271 motion`,
          c.ok && s0 === s1,
          c.detail + (s0 === s1 ? '' : '; the layout still moved after 450 ms: ' + JSON.stringify(moved))
        );
        // On E.V. the end state is after her reveal, which ends within 6 s (D-137); the settled shot waits it out.
        const ENDS = view.tab === 'ev' ? 6000 : 0;
        if (ENDS) await page.waitForTimeout(ENDS);
        const moving = await settledShot();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open(view);
        await page.waitForTimeout(1150 + ENDS);
        const still = await settledShot();
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const d = png.diff(moving, still);
        ok(
          `[${width}] ${view.id}: the reduced-motion screenshot matches the settled one`,
          d.share <= M.shotTolerance,
          JSON.stringify(d)
        );
        if (d.share > M.shotTolerance) {
          fs.writeFileSync(`${shots}/motion-${view.id}-${width}-settled.png`, moving);
          fs.writeFileSync(`${shots}/motion-${view.id}-${width}-reduced.png`, still);
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    // Each seg control back to its first view, as a fresh open has it.
    for (const v of VIEWS.filter(x => x.v))
      if (VIEWS.find(x => x.tab === v.tab).v === v.v) {
        await page.$eval('#tab-' + v.tab, b => b.click());
        if (await page.isVisible(`#seg-${v.tab} [data-v="${v.v}"]`))
          await page.click(`#seg-${v.tab} [data-v="${v.v}"]`); // a one-view switch is hidden (B-297)
        else if (v.tab === 'study') await studyView(page, v.v); // out of the review's quiz card (B-297)
      }
    if (['390x844', '1280x800'].includes(width)) {
      // B-111, B-302: the long note is one row in the log, its words cut to the row's line; opening it shows all 30
      // words in its detail, with its kind menu (B-303, D-290: and no Make it a weak spot).
      await page.click('#tab-record'); // B-359: Record is its log alone
      await page.waitForTimeout(400);
      const sel = '#rec-list [data-part=row][data-key="look-long-idea"]';
      const idea = await page.evaluate(s => {
        const li = document.querySelector(s);
        if (!li) return null;
        const nm = li.querySelector('.nm');
        return {
          h: Math.round(li.getBoundingClientRect().height),
          oneLine: nm.scrollHeight <= nm.clientHeight + 1,
          rowControls: li.querySelectorAll('select').length,
        };
      }, sel);
      ok(
        `[${width}] record: the 30-word note is one row, its words cut to its line, no control on it (B-357: the demo's height)`,
        idea && idea.oneLine && idea.rowControls === 0,
        JSON.stringify(idea)
      );
      if ((await page.getAttribute(sel + ' .nm', 'aria-expanded')) !== 'true') await page.click(sel + ' .nm');
      await page.waitForTimeout(150);
      const opened = await page.evaluate(() => {
        const d = document.getElementById('rec-detail');
        const vis = e => e && e.getBoundingClientRect().height > 0;
        const t = d.querySelector('.rec-title');
        return {
          menu: vis(d.querySelector('select.idea-kind')),
          button: [...d.querySelectorAll('button')].some(b => /Make it a weak spot/.test(b.textContent) && vis(b)),
          words: t ? t.textContent.split(/\s+/).filter(Boolean).length : 0,
          whole: t ? t.scrollHeight <= t.clientHeight + 1 && t.scrollWidth <= t.clientWidth + 1 : false,
        };
      });
      ok(
        `[${width}] record: opening the note shows all 30 words and its menu, no Make it a weak spot (D-290)`,
        LONG_IDEA.split(/\s+/).length === 30 && opened.menu && !opened.button && opened.words === 30 && opened.whole,
        JSON.stringify(opened)
      );
      await page.locator('#rec-detail').screenshot({ path: `${shots}/look-idea-open-${width}.png` });
    }
    ok(`[${width}] no page errors`, errors.length === 0, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d && s === 'FAIL' ? '  -- ' + d : ''}`);
  // The tabs whose tenet checks are not on yet: each check per view, reported, not failed (B-115).
  if (reports.length) {
    console.log(
      `\ntenet checks, reported until each tab's catch-up task turns them on (${reports.filter(r => r[0] === 'ok  ').length} of ${reports.length} pass):`
    );
    for (const [s, n, d] of reports) console.log(`${s}  ${n}  -- ${d}`);
  }
  const failed = results.filter(x => x[0] === 'FAIL').length;
  console.log(
    `\n${results.length - failed} of ${results.length} checks pass; open time ${openTime == null ? 'none' : openTime + ' ms'} at 390x844, 4x CPU; screenshots in ${shots}`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  for (const [st, n, d] of results) if (st === 'FAIL') console.log(`${st}  ${n}  -- ${d}`);
  console.error(e);
  process.exit(1);
});
