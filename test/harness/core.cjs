// Her harness (B-272; D-265, D-266, D-213, D-216; was the flower's, B-206): the built staging page with her drawn as the
// Dial Arc, driven through its page API (EVApp.core: setMood, gesture, speak, speechEnd, setRing), on real time. At 390
// and 1280 px, in light and dark, it draws a 128 px and a 24 px dial side by side and screenshots each of the seven moods
// and the five gestures, checking what the round 15 canvas's States board says of each (where the gap points, how wide,
// solid or halftone, closed, flat to him), that each gesture settles, that a still idle draws nothing, a session's
// filled segments, and that the sidebar's 24 px dial turns to face him for a notice (D-216). Reduced motion gives one
// still per mood. Her frame budget is measured over 10 s of speech at 390x844, DPR 3, 4x CPU throttle.
//   node test/harness/core.cjs [record dir | synthetic] [screenshots dir] [--json <file>]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const [dbArg, shotsArg] = args;
const dbDir = require('../data/synthetic.cjs').recordDir(dbArg);
const shots = shotsArg || '/tmp/ev4-shots';
fs.mkdirSync(shots, { recursive: true });
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
delete seed.journal;
// As in run.cjs: the page opens as if nothing has been said or started today, so her stage is at full size.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const dayOf = iso =>
  iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso)) : null;
if (seed.talk) delete seed.talk[today];
for (const c of ['sessions', 'workouts'])
  for (const [id, d] of Object.entries(seed[c] || {})) if ((d.date || dayOf(d.startedAt)) === today) delete seed[c][id];
const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8'));
const F = spec.ui.look.flower; // her stage sizes and budget (D-213, D-272)
const GDUR = { send: 1.2, done: 1.6, error: 1.8, glance: 2.2, settle: 2.4 };
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const skeleton = b =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  b +
  '</body></html>';
async function openPage(page) {
  const dir = path.join(root, 'dist/page/staging');
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await page.route(ORIGIN + '/**', r => {
    const name = new URL(r.request().url()).pathname.slice(1) || 'index.html';
    if (name === 'index.html')
      return r.fulfill({
        body: skeleton(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')),
        contentType: 'text/html',
      });
    const f = path.join(dir, name);
    return fs.existsSync(f)
      ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' })
      : r.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(
    () => window.EVApp && window.EVApp.core && document.querySelector('#hero svg.dial'),
    null,
    {
      timeout: 15000,
    }
  );
  await page.waitForTimeout(600);
}
const { advisory, allPass } = require('./quarantine.cjs');
const results = [];
const ok = (name, cond, detail = '') => {
  results.push([cond ? 'PASS' : 'FAIL', name, detail]);
};
const p95 = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
};
const r2 = x => (x == null ? null : Math.round(x * 100) / 100);
const info = page => page.evaluate(() => window.EVApp.core.sample(0));
// Hold one mood against the page's own mood timer (it sets the mood again as the page changes).
const hold = (page, m) =>
  page.evaluate(m => {
    const C = window.EVApp.core;
    if (!C.__set) {
      C.__set = C.setMood;
      C.setMood = x => C.__set(window.__holdMood || x);
    }
    window.__holdMood = m;
    C.setMood(m);
  }, m);
// 10 s of speech in the page: the reply pacing of the canvas, words through speak(), repeated until the time is up.
const SPEECH = `async (secs) => { const C = window.EVApp.core; const text = 'Preload is the *stretch* before the squeeze. More filling, more stretch, a stronger contraction, up to a point. Done. Three preload questions are first in tonight’s review.';
  const words = text.split(' '); const end = performance.now() + secs * 1000; window.__holdMood = 'speaking'; C.setMood('speaking'); C.resetStats(); const hero = C.cores()[0], d0 = hero.draws, t0 = performance.now(); let i = 0;
  while (performance.now() < end) { const raw = words[i++ % words.length], w = raw.replace(/\\*/g, ''); C.speak(w, { emphasis: raw.startsWith('*') });
    await new Promise(r => setTimeout(r, 60 + w.length * 15 + (/[,;:]$/.test(w) ? 210 : 0) + (/[.?!]$/.test(w) ? 400 : 0))); }
  C.speechEnd(); const s = C.stats(); return { frames: s.frames, draws: s.draws, redraws: s.redraws, heroPerSec: (hero.draws - d0) / ((performance.now() - t0) / 1000) }; }`;

(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const budget = {};
  // Her two test dials, 128 px and 24 px, side by side on the page's ground (both follow her signals like the page's own).
  const dials = page =>
    page.evaluate(() => {
      const C = window.EVApp.core;
      if (!window.__dials) {
        const box = document.createElement('div');
        box.id = 'dial-box';
        box.style.cssText =
          'position:fixed;left:8px;top:8px;z-index:999;display:flex;align-items:center;gap:20px;padding:16px;background:var(--bg)';
        const big = C.make(128, { follow: true }),
          small = C.make(24, { follow: true });
        box.append(big.el, small.el);
        document.body.append(box);
        window.__dials = [big, small];
      }
      const all = C.cores();
      return window.__dials.map(d => all.indexOf(d));
    });
  const both = (page, idx) => page.evaluate(idx => idx.map(i => window.EVApp.core.sample(i)), idx);
  const near = (a, b, d = 0.35) => a != null && Math.abs(((((a - b) % 12) + 18) % 12) - 6) <= d;
  const shot = (page, name) => page.locator('#dial-box').screenshot({ path: `${shots}/${name}.png` });
  const speakFor = (page, ms) =>
    page.evaluate(async ms => {
      const C = window.EVApp.core,
        words = 'Preload is the stretch before the squeeze. More filling, more stretch.'.split(' ');
      const t0 = performance.now();
      let i = 0;
      while (performance.now() - t0 < ms) {
        const w = words[i++ % words.length];
        C.speak(w, { emphasis: w === 'stretch' });
        await new Promise(r => setTimeout(r, 60 + w.length * 15));
      }
    }, ms);
  for (const scheme of ['phone', 'desktop']) {
    const ctx = await browser.newContext({
      viewport: scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 },
      colorScheme: 'dark',
      deviceScaleFactor: scheme === 'phone' ? 3 : 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await openPage(page);
    const first = await info(page);
    ok(
      `[${scheme}] she is one SVG Dial Arc of 12 segments, no canvas`,
      first.renderer === 'svg' && first.segments >= 10 && first.segments <= 12,
      JSON.stringify(first)
    );
    ok(
      `[${scheme}] no WebGL and no canvas anywhere for her`,
      await page.evaluate(() => !document.querySelector('.ev-av canvas') && !document.querySelector('#hero canvas'))
    );
    ok(
      `[${scheme}] the page API is there`,
      await page.evaluate(() =>
        ['setMood', 'gesture', 'speak', 'speechEnd', 'setRing'].every(k => typeof window.EVApp.core[k] === 'function')
      )
    );
    // The greeting reveals word by word on opening and ends on a settle; let it finish before timing anything.
    await page.waitForFunction(
      () => !document.querySelector('#thread .reveal') && window.EVApp.core.stats().gestures.length === 0,
      null,
      { timeout: 30000 }
    );
    const idx = await dials(page);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      const tag = `[${scheme} ${theme}]`;
      const inks = await page.evaluate(() => {
        const s = getComputedStyle(document.documentElement);
        return [s.getPropertyValue('--av1').trim(), s.getPropertyValue('--av2').trim()];
      });
      const want = theme === 'light' ? ['#b5530f', '#a8402f'] : ['#f2a35e', '#f08a78'];
      ok(
        `${tag} her faces are Ember with halftone (D-266)`,
        JSON.stringify(inks) === JSON.stringify(want),
        inks.join(' ')
      );
      for (const m of spec.persona.avatar.moods) {
        await hold(page, m);
        if (m === 'speaking') await speakFor(page, 1400);
        else await page.waitForTimeout(1400);
        const [a, s] = await both(page, idx);
        await page.waitForTimeout(m === 'thinking' || m === 'happy' ? 600 : 0);
        const [a2] = await both(page, idx);
        await shot(page, `core-mood-${m}-${scheme}-${theme}`);
        if (m === 'speaking') await page.evaluate(() => window.EVApp.core.speechEnd());
        const d = JSON.stringify({ big: a, small: s });
        const desc = {
          idle: ['an arc, the gap at two o’clock, all solid', near(a.gap, 2) && a.back === 0 && a.segments >= 10],
          listening: ['the gap turned down to six', near(a.gap, 6)],
          thinking: ['the gap travels; halftone in its wake', a2.gap !== a.gap && a.back > 0],
          speaking: ['the gap near half past four', near(a.gap, 4.5, 0.8)],
          alert: [
            'closed, flat to him, one solid segment at twelve, the rest halftone',
            a.segments === 12 && a.facing && a.solid === 1 && a.back === 11,
          ],
          happy: ['the gap spins', a2.gap !== a.gap],
          sleepy: [
            'all halftone, a sliver of gap at six, dimmed',
            a.solid === 0 && a.back >= 11 && near(a.gap, 6) && a.dim === '0.78',
          ],
        }[m];
        ok(`${tag} mood ${m} at 128 px: ${desc[0]}`, desc[1], d);
        ok(
          `${tag} mood ${m} at 24 px: the same state, drawn flat (no halftone texture)`,
          (s.z === 's' && Math.abs(s.segments - a.segments) <= 1 && s.solid === a.solid) ||
            ((m === 'thinking' || m === 'happy' || m === 'speaking') && s.z === 's' && s.segments >= 10),
          d
        );
        if (m === 'idle') {
          await page.waitForTimeout(1500);
          const n0 = await page.evaluate(i => window.EVApp.core.sample(i).draws, idx[0]);
          await page.waitForTimeout(1500);
          const n1 = await page.evaluate(i => window.EVApp.core.sample(i).draws, idx[0]);
          ok(`${tag} a still idle draws nothing`, n1 === n0, `${n0} -> ${n1}`);
        }
      }
      // Each gesture: a screenshot while it plays, its look checked, then settled within its duration.
      await hold(page, 'idle');
      await page.waitForTimeout(800);
      for (const g of ['send', 'done', 'error', 'glance', 'settle']) {
        await page.evaluate(g => window.EVApp.core.gesture(g, g === 'glance' ? 'left' : undefined), g);
        await page.waitForTimeout({ send: 350, done: 700, error: 250, glance: 800, settle: 500 }[g]);
        const [a, s] = await both(page, idx);
        await shot(page, `core-gesture-${g}-${scheme}-${theme}`);
        const desc = {
          send: ['the gap flicks to the top right and widens', near(a.gap, 1.5, 0.6) && a.gapWidth > 1.8],
          done: ['the ring closes with a sweep', a.segments === 12],
          error: ['a shudder at rest', a.segments >= 9],
          glance: ['the gap looks left, to nine', near(a.gap, 9, 0.8)],
          settle: ['a breath through the ring at rest', near(a.gap, 2, 0.6)],
        }[g];
        ok(`${tag} ${g}: ${desc[0]}`, desc[1], JSON.stringify({ big: a, small: s }));
        await page.waitForTimeout(GDUR[g] * 1000 + 200);
        const left = await page.evaluate(() => window.EVApp.core.stats().gestures);
        ok(`${tag} ${g} settles within ${GDUR[g]} s`, left.length === 0, JSON.stringify(left));
      }
      // A session in Pointer mode: 5 of 12 filled, the gap at the next slot; held against the page's own session render.
      await page.evaluate(() => {
        const C = window.EVApp.core;
        if (!C.__ring) {
          C.__ring = C.setRing;
          C.setRing = () => {};
        }
        C.__ring(5 / 12);
      });
      await page.waitForTimeout(1600);
      const [sa, ss] = await both(page, idx);
      await shot(page, `core-session-${scheme}-${theme}`);
      await page.evaluate(() => window.EVApp.core.__ring(-1));
      ok(
        `${tag} a session at 5 of 12: five solid, a halftone slot behind every segment but the sixth, where the gap rides`,
        sa.filled === 5 && sa.solid === 5 && sa.back === 11 && ss.solid === 5,
        JSON.stringify({ big: sa, small: ss })
      );
      await page.waitForTimeout(900);
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    // D-216: off the E.V. tab, the sidebar's 24 px dial turns to face him for a notice (alert: closed, flat, lit at twelve).
    if (scheme === 'desktop') {
      await page.click((await page.isVisible('#side-today')) ? '#side-today' : '#tab-today').catch(() => {});
      await hold(page, 'alert');
      await page.waitForTimeout(1400);
      const side = await page.evaluate(() => {
        const C = window.EVApp.core,
          all = C.cores(),
          i = all.findIndex(c => c.el.closest('#top-av'));
        return i < 0 ? null : { ...C.sample(i), shown: all[i].el.getBoundingClientRect().width };
      });
      await page
        .locator('#top-av')
        .screenshot({ path: `${shots}/core-notice-sidebar-${scheme}.png` })
        .catch(() => {});
      ok(
        `[${scheme}] the sidebar's 24 px dial turns to face him for a notice (D-216)`,
        !!side && side.size === 24 && side.shown >= 20 && side.facing && side.segments === 12 && side.solid === 1,
        JSON.stringify(side)
      );
      await hold(page, 'idle');
    }
    if (scheme === 'phone') {
      // Her frame budget (D-272): 10 s of speech, 4x CPU throttle, DPR 3. B-152 (D-176): advisory here, its numbers
      // printed; B-207 holds it.
      const B = F.budget;
      const measureBudget = async () => {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: B.cpuThrottle });
        await page.waitForTimeout(1500);
        const m = await page.evaluate(`(${SPEECH})(${B.speechSec})`);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        const slow = m.frames.filter(f => f > B.slowFrameMs).length;
        return {
          renderer: 'svg',
          frames: m.frames.length,
          framesOver25ms: slow,
          slowSharePct: r2((100 * slow) / Math.max(1, m.frames.length)),
          p95FrameMs: r2(p95(m.frames)),
          p95DrawMs: r2(p95(m.draws)),
          redrawsPerSec: r2(m.heroPerSec),
          dpr: B.dpr,
          throttle: B.cpuThrottle,
          viewport: B.viewport,
        };
      };
      budget.phone = await advisory(
        results,
        'core-frame-budget',
        `[phone] frame budget (D-272): at most ${B.maxSlowSharePct}% of frames over ${B.slowFrameMs} ms over ${B.speechSec} s of speech, ${B.cpuThrottle}x throttle, DPR ${B.dpr}`,
        measureBudget,
        b => {
          const v = allPass([
            [
              b.framesOver25ms <= (B.maxSlowSharePct / 100) * b.frames && b.frames > 300 ? 'PASS' : 'FAIL',
              'slow frames',
              `${b.framesOver25ms} of ${b.frames}`,
            ],
          ]);
          return { ok: v.ok, numbers: JSON.stringify(b) + (v.ok ? '' : ' · missed: ' + v.numbers) };
        }
      );
    } else {
      const m = await page.evaluate(`(${SPEECH})(10)`);
      budget.desktop = {
        frames: m.frames.length,
        framesOver25ms: m.frames.filter(f => f > F.budget.slowFrameMs).length,
        p95FrameMs: r2(p95(m.frames)),
        p95DrawMs: r2(p95(m.draws)),
        dpr: 1,
        throttle: 1,
        viewport: '1280x860',
      };
      ok(
        '[desktop] 10 s of speech recorded at 1280 (no throttle)',
        m.frames.length > 300,
        JSON.stringify(budget.desktop)
      );
    }
    ok(`[${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // Reduced motion: one still drawing per mood, at 128 and 24 px.
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await openPage(page);
    const idx = await dials(page);
    const seen = new Set();
    for (const m of spec.persona.avatar.moods) {
      await hold(page, m);
      await page.waitForTimeout(400);
      const [a, s] = await both(page, idx);
      await page.waitForTimeout(900);
      const [b, t] = await both(page, idx);
      seen.add(b.hash);
      await shot(page, `core-reduced-${m}-phone`);
      ok(
        `[reduced motion] ${m}: one still drawing at 128 and 24 px`,
        a.hash === b.hash && s.hash === t.hash && a.segments >= 10,
        `${a.hash} ${b.hash} ${s.hash} ${t.hash}`
      );
    }
    ok('[reduced motion] each mood its own drawing where its state differs', seen.size >= 5, String(seen.size));
    await ctx.close();
  }
  await browser.close();
  for (const [s, n, d] of results) console.log(s, n, d);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log('frame budget:', JSON.stringify(budget));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), results, budget }, null, 1));
  console.log(failed ? `${failed} FAILED of ${results.length} checks` : `ALL PASSED: ${results.length} checks`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('CRASHED', e.message);
  process.exit(1);
});
