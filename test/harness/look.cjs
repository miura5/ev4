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
// B-115: the tenet checks, on every view at spec.ui.tenets.widths; a tab in spec.ui.tenets.on fails the pass.
const TENETS = JSON.parse(fs.readFileSync(path.join(root, 'spec', 'ev.spec.json'), 'utf8')).ui.tenets;
const { collect, judge, motion, judgeMotion } = require('./tenets.cjs');
const png = require('./png.cjs');
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
  for (const size of SIZES.filter(z => !process.env.LOOK_SIZES || process.env.LOOK_SIZES.split(',').includes(z.tag))) {
    // LOOK_SIZES=390x844: a quicker pass while working (check.mjs runs them all)
    const width = size.tag,
      viewport = { width: size.width, height: size.height };
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
    for (const view of VIEWS) {
      await page.click('#tab-' + view.tab);
      if (view.v && (await page.isVisible(`#seg-${view.tab} [data-v="${view.v}"]`)))
        await page.click(`#seg-${view.tab} [data-v="${view.v}"]`); // B-121: from 1024 px Study's plan sits beside, with no button
      await page.waitForTimeout(500); // past the panel's fade-in
      await page.screenshot({ path: `${shots}/${shotName(view, size)}`, fullPage: true });
      ok(
        `[${width}] ${view.id}: no sideways scroll`,
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      );
      if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
        const snap = await page.evaluate(collect);
        for (const c of judge(snap, TENETS.exceptions)) {
          if (
            TENETS.on.includes(view.tab) ||
            TENETS.on.includes(view.id) ||
            ((TENETS.onFor || {})[c.tenet] || []).some(x => x === view.tab || x === view.id)
          )
            ok(`[${width}] ${view.id}: ${c.tenet}`, c.ok, c.detail);
          else reports.push([c.ok ? 'ok  ' : 'NOT ', `[${width}] ${view.id}: ${c.tenet}`, c.detail]);
        }
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
    // B-118: Progress, Readiness: at most 1.5 screens at 390 with every row closed; each objective once; an opened row
    // shows its passages to reread; the one-row format table absent: the record as planted answers one format (before the Study block below answers a matrix).
    if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
      await page.click('#tab-progress');
      await page.click('#seg-progress [data-v="readiness"]');
      await page
        .waitForFunction(
          () =>
            document.querySelector('#ready-card .obj-reread') ||
            document.querySelectorAll('#ready-card .obj-item').length,
          null,
          { timeout: 8000 }
        )
        .catch(() => {});
      await page.waitForTimeout(1200); // the library loads; the list re-renders with its passages
      const r = await page.evaluate(() => {
        const vis = e =>
          !!e &&
          !e.closest('[hidden]') &&
          getComputedStyle(e).display !== 'none' &&
          e.getBoundingClientRect().height > 0;
        const ids = [...document.querySelectorAll('#ready-card .obj-t')].map(t => t.textContent.split(' · ')[0]);
        const elsewhere = [...document.querySelectorAll('#progress-readiness td, #progress-readiness .row')].filter(
          e => !e.closest('#ready-card') && vis(e) && /\bE\d+-\d+\b/.test(e.textContent)
        ).length;
        return {
          h: Math.round(document.getElementById('progress-readiness').getBoundingClientRect().height),
          H: innerHeight,
          ids,
          once: new Set(ids).size === ids.length && !elsewhere,
          openAtLoad: document.querySelectorAll('#ready-card .obj-item.open').length,
          fmt: vis(document.getElementById('fmt-card')),
        };
      });
      ok(
        `[${width}] readiness: ${size.width === 390 ? 'at most 1.5 screens with every row closed; ' : ''}each objective once; the one-row format table absent`,
        (size.width !== 390 || r.h <= 1.5 * r.H) && r.ids.length > 0 && r.once && !r.openAtLoad && !r.fmt,
        JSON.stringify(r)
      );
      await page.locator('#ready-card .obj-line').first().click();
      await page.waitForTimeout(250);
      const o = await page.evaluate(() => {
        const li = document.querySelector('#ready-card .obj-item.open');
        const m = li && li.querySelector('.obj-more');
        return {
          open: !!li,
          shown: !!m && getComputedStyle(m).display !== 'none',
          text: m ? m.textContent.slice(0, 200) : '',
        };
      });
      ok(
        `[${width}] readiness: an opened objective shows its counts, accuracy and passages to reread`,
        o.open && o.shown && /solid/.test(o.text) && /right/.test(o.text) && /Reread: /.test(o.text),
        JSON.stringify(o)
      );
      await page.locator('#ready-card .obj-line').first().click();
      await page.waitForTimeout(150);
    }
    // B-116: the question view: the stem leads with no chip above it, one count on the screen, no More practice while
    // the set is unfinished; after the last answer, More practice is one line.
    if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
      await page.click('#tab-study');
      await page.click('#seg-study [data-v="review"]');
      await page.waitForTimeout(300);
      const q = await page.evaluate(() => {
        const vis = e =>
          !!e &&
          !e.closest('[hidden]') &&
          getComputedStyle(e).display !== 'none' &&
          e.getBoundingClientRect().height > 0;
        const stem = document.querySelector('#rv-body .q-stem'),
          panel = document.getElementById('p-study');
        const counts = [...panel.querySelectorAll('*')]
          .filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && /\b\d+ of \d+\b/.test(n.textContent)))
          .map(e => e.textContent.trim());
        return {
          stem: !!stem && parseFloat(getComputedStyle(stem).fontSize),
          chipAbove:
            !!stem &&
            [...document.querySelectorAll('#rv-body .chip')].some(
              c => vis(c) && c.getBoundingClientRect().top < stem.getBoundingClientRect().top
            ),
          counts,
          more: vis(document.getElementById('more-card')),
        };
      });
      ok(
        `[${width}] study: the stem leads at 20 px with no chip above it, one count on the screen, no More practice mid-set`,
        q.stem === 20 && !q.chipAbove && q.counts.length === 1 && !q.more,
        JSON.stringify(q)
      );
      // B-126 (D-165): the counter is the set's fold line, opening the set above the question (beside it from 1024 px).
      {
        await page.click('#rv-count');
        await page.waitForTimeout(150);
        const sl = await page.evaluate(() => {
          const l = document.querySelector('#rv-body .set-list');
          return {
            tag: document.getElementById('rv-count').tagName,
            list: l ? l.querySelectorAll('.set-item').length : 0,
            beside: !!document.querySelector('#rv-body.q-beside .q-set .set-list'),
            expanded: document.getElementById('rv-count').getAttribute('aria-expanded'),
            allQ: [...document.querySelectorAll('#p-study button')].some(b => /All questions/.test(b.textContent)),
          };
        });
        ok(
          `[${width}] study: the counter is the set's fold line, opening the set ${size.width >= 1024 ? 'beside' : 'above'} the question; no All questions`,
          sl.tag === 'BUTTON' && sl.list >= 2 && sl.expanded === 'true' && sl.beside === size.width >= 1024 && !sl.allQ,
          JSON.stringify(sl)
        );
        await page.screenshot({ path: `${shots}/look-study-set-${width}.png`, fullPage: true });
        await page.click('#rv-count');
        await page.waitForTimeout(150);
      }
      // B-126 (D-165): the planted set's first question answered wrong: one verdict line under the stem, his pick's and
      // the right answer's why shown and the rest folded under one line, nothing above the verdict moved.
      {
        const pick = await page.evaluate(() => {
          const stem = document.querySelector('#rv-body .q-stem').textContent;
          for (const x of Object.values(window.__db.sets))
            for (const q of x.items || [])
              if (q.stem === stem && q.options && q.correct)
                return q.options.findIndex((_, i) => !q.correct.includes(i));
          return 1;
        });
        await page.locator('#rv-body label.opt').nth(pick).click();
        await page.locator('#rv-body button:has-text("Check answer")').scrollIntoViewIfNeeded();
        const where = () =>
          page.evaluate(() => ({
            y: Math.round(scrollY),
            stem: Math.round(document.querySelector('#rv-body .q-stem').getBoundingClientRect().top),
            tags: Math.round(document.querySelector('#rv-body .q-tags').getBoundingClientRect().top),
            bar: Math.round(document.querySelector('#study-review .bar-row').getBoundingClientRect().top),
          }));
        const before = await where();
        await page.click('#rv-body button:has-text("Check answer")');
        await page.waitForTimeout(250);
        const after = await where();
        const v = await page.evaluate(() => {
          const vis = e =>
              !!e &&
              !e.closest('[hidden]') &&
              !e.hidden &&
              getComputedStyle(e).display !== 'none' &&
              e.getBoundingClientRect().height > 0,
            b = document.getElementById('rv-body');
          const vs = [...b.querySelectorAll('.verdict')].filter(vis),
            vd = vs[0],
            lh = vd
              ? parseFloat(getComputedStyle(vd).lineHeight) || parseFloat(getComputedStyle(vd).fontSize) * 1.3
              : 0;
          return {
            verdicts: vs.length,
            oneLine: !!vd && vd.getBoundingClientRect().height <= lh * 1.5,
            text: vd && vd.textContent,
            underStem: !!vd && vd.previousElementSibling === b.querySelector('.q-tags'),
            whys: [...b.querySelectorAll('.why')].filter(vis).length,
            folded: [...b.querySelectorAll('.why-rest')].filter(e => !vis(e)).length,
            fold: !!b.querySelector('.why-fold[aria-expanded="false"]'),
          };
        });
        ok(
          `[${width}] study: answered, one verdict line under the stem, two whys shown and the rest folded, nothing above it moved`,
          v.verdicts === 1 &&
            v.oneLine &&
            /^Missed/.test(v.text || '') &&
            v.underStem &&
            v.whys === 2 &&
            v.folded >= 1 &&
            v.fold &&
            JSON.stringify(before) === JSON.stringify(after),
          JSON.stringify({ before, after, v })
        );
        await page.screenshot({ path: `${shots}/look-study-answered-${width}.png`, fullPage: true });
        await page.click('#rv-body .why-fold');
        await page.waitForTimeout(150);
        ok(
          `[${width}] study: Why not the others opens the other whys in place`,
          await page.evaluate(
            () =>
              [...document.querySelectorAll('#rv-body .why-rest')].every(e => !e.hidden) &&
              document.querySelector('#rv-body .why-fold').getAttribute('aria-expanded') === 'true'
          )
        );
        const nx = page.locator('#rv-body button', { hasText: /Next question|See results/ }).first();
        if (await nx.count()) {
          await nx.click();
          await page.waitForTimeout(120);
        }
      }
      for (let i = 0; i < 15 && (await page.isVisible('#rv-body button:has-text("Check answer")')); i++) {
        if (await page.locator('#rv-body table.mx').count()) {
          const rows = await page.locator('#rv-body table.mx tbody tr').count();
          for (let r = 0; r < rows; r++)
            await page.locator('#rv-body table.mx tbody tr').nth(r).locator('input[type=radio]').first().check();
        } else await page.locator('#rv-body label.opt').first().click();
        await page.click('#rv-body button:has-text("Check answer")');
        await page.waitForTimeout(120);
        const next = page.locator('#rv-body button', { hasText: /Next question|See results/ }).first();
        if (await next.count()) {
          await next.click();
          await page.waitForTimeout(120);
        }
      }
      const done = await page.evaluate(() => {
        const m = document.getElementById('more-card'),
          r = m.getBoundingClientRect();
        return {
          shown: !m.hidden && r.height > 0,
          h: Math.round(r.height),
          button: (document.getElementById('more-btn') || {}).textContent,
          left:
            document.querySelectorAll('#rv-body button').length &&
            /Check answer/.test(document.getElementById('rv-body').textContent),
        };
      });
      ok(
        `[${width}] study: after the last answer, More practice is one line with Give me 5 more`,
        done.shown && done.h <= 72 && done.button === 'Give me 5 more' && !done.left,
        JSON.stringify(done)
      );
      await page.screenshot({ path: `${shots}/look-study-done-${width}.png`, fullPage: true });
      // B-126 (D-165): the finished set leads with its score; Give me 5 more is the one primary; misses are lines opening
      // to what he picked and why; right answers fold; Practice and Plan each lead with one thing and carry no pill.
      {
        const fin = await page.evaluate(() => {
          const vis = e =>
              !!e &&
              !e.closest('[hidden]') &&
              !e.hidden &&
              getComputedStyle(e).display !== 'none' &&
              e.getBoundingClientRect().height > 0,
            p = document.getElementById('p-study'),
            b = document.getElementById('rv-body');
          return {
            first: b.firstElementChild && b.firstElementChild.className,
            score: (b.querySelector('.set-score') || {}).textContent,
            primaries: [...p.querySelectorAll('button.primary')].filter(vis).map(x => x.textContent.trim()),
            misses: [...b.querySelectorAll('.sum-item')].filter(vis).length,
            rightFolded: [...b.querySelectorAll('.fold-line')].some(
              f => vis(f) && /^\d+ right$/.test(f.textContent.trim()) && f.getAttribute('aria-expanded') === 'false'
            ),
            pills: [...b.querySelectorAll('.chip')].filter(vis).length,
          };
        });
        ok(
          `[${width}] study: the finished set leads with its score, misses as lines, right answers folded, Give me 5 more the one primary`,
          /set-score/.test(fin.first || '') &&
            /^\d+ of \d+ right$/.test(fin.score || '') &&
            fin.misses >= 1 &&
            fin.rightFolded &&
            fin.primaries.length === 1 &&
            fin.primaries[0] === 'Give me 5 more' &&
            !fin.pills,
          JSON.stringify(fin)
        );
        await page.locator('#rv-body .sum-line').first().click();
        await page.waitForTimeout(150);
        const miss = await page.evaluate(
          () => (document.querySelector('#rv-body .sum-item.open .sum-more') || {}).textContent || ''
        );
        ok(
          `[${width}] study: a miss opens in place to what he picked and the answer, with their whys`,
          /You picked: /.test(miss) && /Answer: /.test(miss),
          miss.slice(0, 160)
        );
        await page.locator('#rv-body .sum-line').first().click();
        await page.waitForTimeout(100);
        for (const v of ['practice', 'plan']) {
          const seg = await page.isVisible(`#seg-study [data-v="${v}"]`);
          if (seg) await page.click(`#seg-study [data-v="${v}"]`);
          else await page.click('#plan-card .fold-line');
          await page.waitForTimeout(300);
          const r = await page.evaluate(
            box => {
              const vis = e =>
                  !!e &&
                  !e.closest('[hidden]') &&
                  !e.hidden &&
                  getComputedStyle(e).display !== 'none' &&
                  e.getBoundingClientRect().height > 0,
                c = document.querySelector(box),
                own = e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
              return {
                leads: [...c.querySelectorAll('*')]
                  .filter(e => vis(e) && own(e) && parseFloat(getComputedStyle(e).fontSize) >= 20)
                  .map(e => e.textContent.trim().slice(0, 40)),
                pills: [...c.querySelectorAll('.chip')].filter(vis).length,
                paragraph: /Ticks save/.test(c.textContent),
                tall: [...c.querySelectorAll('li.row')].filter(vis).filter(li => li.getBoundingClientRect().height > 44)
                  .length,
              };
            },
            v === 'practice' ? '#pr-card' : '#plan-card'
          );
          ok(
            `[${width}] study ${v}: one lead, no pill${v === 'plan' ? ', no paragraph on ticks' : ''}, each row one line`,
            r.leads.length === 1 && !r.pills && !r.paragraph && !r.tall,
            JSON.stringify(r)
          );
          await page.screenshot({ path: `${shots}/look-study-${v}-led-${width}.png`, fullPage: true });
          if (!seg) await page.click('#plan-card .fold-line');
        }
        await page.click('#seg-study [data-v="review"]');
        await page.waitForTimeout(150);
      }
    }
    // B-117: Today: no stat tile, no item's minutes twice, the exam in Next 7 days only, coral equal to core's urgent
    // count, a Prep marker on the clinical day; ticking keeps the scroll (v4 rule 6).
    if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
      await page.click('#tab-today');
      await page.waitForTimeout(450); // B-125: settled within 450 ms
      const t = await page.evaluate(() => {
        const vis = e =>
          !!e &&
          !e.closest('[hidden]') &&
          getComputedStyle(e).display !== 'none' &&
          e.getBoundingClientRect().height > 0;
        const items = [...document.querySelectorAll('#today-list li')]
          .filter(vis)
          .map(li => (li.querySelector('.ti-t') || li).textContent.trim());
        const ahead = [...document.querySelectorAll('#ahead li')].filter(vis);
        const coralRgb = /rgba?\((240, 138, 120|244, 167, 151)/,
          panel = document.getElementById('p-today');
        const coral = [...panel.querySelectorAll('*')].filter(
          e =>
            vis(e) &&
            [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) &&
            coralRgb.test(getComputedStyle(e).color)
        ).length;
        return {
          tiles: [...document.querySelectorAll('#stats .stat')].filter(vis).length,
          minsTwice: items.filter(x => (x.match(/\d+\s*min/g) || []).length > 1),
          examInList: items.some(x => /^Exam \d/.test(x)),
          examAhead: ahead.some(li => /Exam/.test(li.textContent)) || !document.querySelector('#ahead'),
          coral,
          urgent: document.querySelectorAll('li.brief-item[data-level="urgent"]').length,
          prepOnClinical:
            ahead.filter(li => /clinical/i.test(li.textContent)).every(li => li.querySelector('.bi-prep')) &&
            ahead.some(li => /clinical/i.test(li.textContent)),
        };
      });
      ok(
        `[${width}] today: no stat tile, minutes once, the exam in Next 7 days only, coral equal to the urgent count, Prep on the clinical day`,
        !t.tiles && !t.minsTwice.length && !t.examInList && t.coral === t.urgent && t.prepOnClinical,
        JSON.stringify(t)
      );
      const tick = page.locator('#today-list li.today-item input.tick').first();
      // Rule 6: the row he ticks stays where it is on the screen.
      if (await tick.count()) {
        const at = () =>
          page.evaluate(() =>
            Math.round(document.querySelector('#today-list li.today-item').getBoundingClientRect().top + scrollY)
          );
        /* in the document: the click itself may scroll it into view */ const y0 = await at();
        await tick.click();
        await page.waitForTimeout(400);
        const y1 = await at();
        await page.locator('#today-list li.today-item input.tick').first().click();
        await page.waitForTimeout(300);
        ok(
          `[${width}] today: ticking an item keeps it where it is`,
          Math.abs(y1 - y0) <= 1,
          JSON.stringify({ y0, y1 })
        );
      }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    // B-119: System: the planted failed run leads; no ok pill; no card stands empty; the pipeline and run lists fold
    // under one line each, and only the runs that did not finish ok are marked.
    if (TENETS.widths.includes(size.width) && [844, 830, 800].includes(size.height)) {
      await page.click('#tab-system');
      await page.waitForTimeout(500);
      const s0 = await page.evaluate(() => {
        const vis = e =>
            !!e &&
            !e.closest('[hidden]') &&
            getComputedStyle(e).display !== 'none' &&
            e.getBoundingClientRect().height > 0,
          panel = document.getElementById('p-system');
        return {
          lead: (document.querySelector('#health .sys-lead') || {}).textContent,
          okPill: [...panel.querySelectorAll('.chip, .sys-mark')]
            .filter(vis)
            .some(c => /^ok$/i.test(c.textContent.trim())),
          empty: [...panel.querySelectorAll('.empty')].filter(vis).length,
          emptyCards: [...panel.querySelectorAll('.card')]
            .filter(c => vis(c) && !c.querySelector('li, #health-top *'))
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
        [...document.querySelectorAll('#runs li.sys-item')].map(li => ({
          t: li.querySelector('.sys-t').textContent,
          mark: (li.querySelector('.sys-mark') || {}).textContent || '',
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
    // B-121 (D-158): from 1024 px each tab but E.V. is two columns, its lead and its primary on the left; at 1023 one.
    if ([1280, 1470].includes(size.width)) {
      const columns = () =>
        page.evaluate(() => {
          const vis = e =>
            !!e &&
            !e.closest('[hidden]') &&
            getComputedStyle(e).display !== 'none' &&
            e.getBoundingClientRect().height > 0;
          const panel = document.querySelector('section.panel:not([hidden])'),
            cards = [...panel.querySelectorAll('.card, .sys-foot')].filter(
              c => vis(c) && !c.parentElement.closest('.card')
            );
          const L = c => Math.round(c.getBoundingClientRect().left - parseFloat(getComputedStyle(c).marginLeft)),
            lefts = [...new Set(cards.map(L))].sort((a, b) => a - b);
          const prim = [...panel.querySelectorAll('button.primary')].filter(vis).map(b => L(b.closest('.card')));
          return {
            lefts,
            lead: cards.length && L(cards[0]),
            prim,
            sideways: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
      for (const tab of ['today', 'study', 'progress', 'record', 'system']) {
        await page.click('#tab-' + tab);
        const first = await page.$(`#seg-${tab} button`);
        if (first) await first.click();
        await page.waitForTimeout(500);
        const c = await columns();
        ok(
          `[${width}] ${tab}: two columns, the lead and the primary on the left`,
          c.lefts.length === 2 && c.lead === c.lefts[0] && c.prim.every(x => x === c.lefts[0]) && !c.sideways,
          JSON.stringify(c)
        );
        if (size.width === 1280) {
          await page.screenshot({ path: `${shots}/look-cols-${tab}-${width}.png`, fullPage: true });
          await page.setViewportSize({ width: 1023, height: 800 });
          await page.waitForTimeout(300);
          const n = await columns();
          ok(`[1023x800] ${tab}: one column`, n.lefts.length === 1 && !n.sideways, JSON.stringify(n));
          await page.setViewportSize(viewport);
          await page.waitForTimeout(200);
        }
      }
    }
    // B-123 (D-162): Weak spots at 390, 735 and 1470: no due pill and no Mark solid at load; Due today open, the other
    // sections closed; an opened row shows Mark solid, and marking one moves it to Solid without moving the page.
    if ([390, 735, 1470].includes(size.width) && [844, 830].includes(size.height)) {
      await page.click('#tab-progress');
      await page.click('#seg-progress [data-v="weak"]');
      await page.waitForTimeout(500);
      const w = await page.evaluate(() => {
        const vis = e =>
            !!e &&
            !e.closest('[hidden]') &&
            getComputedStyle(e).display !== 'none' &&
            e.getBoundingClientRect().height > 0,
          p = document.getElementById('progress-weak');
        return {
          lead: (document.getElementById('weak-lead') || {}).textContent,
          pills: [...p.querySelectorAll('.chip')].filter(vis).map(c => c.textContent),
          markSolid: [...p.querySelectorAll('button')].filter(b => vis(b) && /Mark solid/.test(b.textContent)).length,
          dueOpen: vis(document.getElementById('weak-due')),
          closed: ['weak-tom', 'weak-later', 'weak-preview', 'weak-parked', 'weak-solid'].filter(id =>
            vis(document.getElementById(id))
          ),
          form: !!document.getElementById('weak-add'),
        };
      });
      ok(
        `[${width}] weak spots: the count due leads, no pill, no Mark solid at load, Due today open and the rest closed, no Log form`,
        /due today$/.test(w.lead || '') && !w.pills.length && !w.markSolid && w.dueOpen && !w.closed.length && !w.form,
        JSON.stringify(w)
      );
      const first = page.locator('#weak-due .ws-item').first(),
        id = await first.getAttribute('data-id');
      await first.locator('.ws-line').click();
      await page.waitForTimeout(200);
      const y0 = await page.evaluate(() => scrollY),
        shown = await first.locator('button', { hasText: 'Mark solid' }).isVisible();
      await first.locator('button', { hasText: 'Mark solid' }).click();
      await page.waitForTimeout(600);
      const m = await page.evaluate(
        id => ({
          y: scrollY,
          inDue: !!document.querySelector(`#weak-due [data-id="${id}"]`),
          inSolid: !!document.querySelector(`#weak-solid [data-id="${id}"]`),
          solidLine: document.getElementById('weak-solid-fold').textContent,
        }),
        id
      );
      ok(
        `[${width}] weak spots: an opened row shows Mark solid; marking it moves it to Solid and the page stays put`,
        shown && !m.inDue && m.inSolid && Math.abs(m.y - y0) <= 1,
        JSON.stringify({ id, shown, y0, ...m })
      );
      await page.screenshot({ path: `${shots}/look-weak-marked-${width}.png`, fullPage: true });
    }
    // B-125 (D-163): every view at 390 and 1280: no transition or animation over 450 ms outside her stage, her core (the
    // header avatar too), the reveal and the echo of his line; the view settled 450 ms after the switch; and the
    // reduced-motion screenshot the same as the settled one.
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
        await page.click(view.tab === 'system' ? '#tab-today' : '#tab-system');
        await page.waitForTimeout(300);
        await page.evaluate(() => window.scrollTo(0, 0));
        const t0 = Date.now();
        await page.click('#tab-' + view.tab);
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
          `[${width}] ${view.id}: D-163 motion`,
          c.ok && s0 === s1,
          c.detail + (s0 === s1 ? '' : '; the layout still moved after 450 ms: ' + JSON.stringify(moved))
        );
        // On E.V. the end state is after her reveal, which ends within 6 s (D-163); the settled shot waits it out.
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
        await page.click('#tab-' + v.tab);
        await page.click(`#seg-${v.tab} [data-v="${v.v}"]`);
      }
    if (['390x844', '1280x800'].includes(width)) {
      // B-111: the long idea's text is at most 3 lines and at least 80% of its card's width; opening it shows its controls.
      await page.click('#tab-record');
      await page.click('#seg-record [data-v="sessions"]');
      await page.waitForTimeout(400);
      const idea = await page.evaluate(() => {
        const li = document.querySelector('#ideas li.idea[data-id="look-long-idea"]');
        if (!li) return null;
        const t = li.querySelector('.title'),
          card = li.closest('.card'),
          cs = getComputedStyle(t);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
        const acts = li.querySelector('.idea-acts');
        return {
          lines: Math.round(t.getBoundingClientRect().height / lh),
          share:
            t.getBoundingClientRect().width /
            (card.clientWidth -
              parseFloat(getComputedStyle(card).paddingLeft) -
              parseFloat(getComputedStyle(card).paddingRight)),
          hidden: getComputedStyle(acts).display === 'none',
        };
      });
      ok(`[${width}] record: the 30-word idea is at most 3 lines`, idea && idea.lines <= 3, JSON.stringify(idea));
      ok(
        `[${width}] record: the idea's text is at least 80% of its card's width`,
        idea && idea.share >= 0.8,
        JSON.stringify(idea)
      );
      ok(
        `[${width}] record: an idea's menu and button wait until it is opened`,
        idea && idea.hidden,
        JSON.stringify(idea)
      );
      await page.click('#ideas li.idea[data-id="look-long-idea"] .idea-head');
      const opened = await page.evaluate(() => {
        const li = document.querySelector('#ideas li.idea[data-id="look-long-idea"]');
        const vis = e => e && e.getBoundingClientRect().height > 0;
        return {
          menu: vis(li.querySelector('select.idea-kind')),
          button: [...li.querySelectorAll('button')].some(b => /Make it a weak spot/.test(b.textContent) && vis(b)),
          expanded: li.querySelector('.idea-head').getAttribute('aria-expanded'),
        };
      });
      ok(
        `[${width}] record: opening the idea shows its menu and Make it a weak spot`,
        opened.menu && opened.button && opened.expanded === 'true',
        JSON.stringify(opened)
      );
      ok(
        `[${width}] record: the planted idea is 30 words, and opened it shows them all`,
        LONG_IDEA.split(/\s+/).length === 30 &&
          (await page.evaluate(() => {
            const t = document.querySelector('#ideas li.idea[data-id="look-long-idea"] .title');
            return t.scrollHeight <= t.clientHeight + 1;
          }))
      );
      await page
        .locator('#ideas li.idea[data-id="look-long-idea"]')
        .screenshot({ path: `${shots}/look-idea-open-${width}.png` });
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
  console.error(e);
  process.exit(1);
});
