// Her harness (B-206; D-212, D-215, D-223, D-224; was core v2's, B-76): the built staging page with her drawn as the 2D
// forget-me-not, driven through its page API (EVApp.core: setMood, gesture, speak, speechEnd, setRing), on real time
// (no fake clock: it would fake the held frames being checked). At 390 and 1280 px it draws each of the seven moods and
// the five gestures with screenshots, checks the pose each one names (facing him or tipped away, the top petal, coral
// only on an error, the speech chart's poses held two frames), that each gesture settles, that she draws on held frames
// (at most heldFps drawings a second) and nothing at a still idle, the session's petals, and reduced motion's one still
// drawing per mood. Her frame budget (D-224) is measured over 10 s of speech at 390x844, DPR 3, 4x CPU throttle.
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
const F = spec.ui.look.flower;
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
  await page.waitForFunction(() => window.EVApp && window.EVApp.core && document.querySelector('#hero svg.fl'), null, {
    timeout: 15000,
  });
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
      `[${scheme}] she is one SVG flower of five petals, no canvas`,
      first.renderer === 'svg' && first.petals === 5,
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
    ok(
      `[${scheme}] her petals are her blue (D-214)`,
      /rgb\(122, 167, 255\)|url\(/.test(first.colour || '') ||
        (await page.evaluate(() =>
          getComputedStyle(document.querySelector('#hero .ev-av')).getPropertyValue('--ink1').trim()
        )) !== '',
      first.colour
    );
    // The greeting reveals word by word on opening and ends on a settle; let it finish before timing anything.
    await page.waitForFunction(
      () => !document.querySelector('#thread .reveal') && window.EVApp.core.stats().gestures.length === 0,
      null,
      { timeout: 30000 }
    );
    // Each mood (D-223): facing him when she attends (listening, speaking, alert, happy), tipped away otherwise.
    for (const m of spec.persona.avatar.moods) {
      await hold(page, m);
      await page.waitForTimeout(F.view.holdSec * 1000 + 900);
      const s = await info(page);
      await page.locator('#hero').screenshot({ path: `${shots}/core-mood-${m}-${scheme}.png` });
      const faces = F.view.facing.includes(m);
      ok(
        `[${scheme}] mood ${m}: drawn, ${faces ? 'facing him' : 'tipped away'}`,
        s.petals === 5 && s.facing === faces && (await page.evaluate(() => window.EVApp.core.stats().mood)) === m,
        JSON.stringify({ facing: s.facing, view: s.view })
      );
      if (m === 'alert')
        ok(
          `[${scheme}] alert: the top petal is lit`,
          await page.evaluate(() => !!document.querySelector('#hero .pet.hi'))
        );
    }
    // She draws on held frames: at most heldFps drawings a second while she moves (D-230), counted over 2 s of thinking.
    await hold(page, 'thinking');
    await page.waitForTimeout(400);
    const rate = await page.evaluate(async () => {
      const C = window.EVApp.core;
      const a = C.cores()[0].draws;
      await new Promise(r => setTimeout(r, 2000));
      return (C.cores()[0].draws - a) / 2;
    });
    ok(
      `[${scheme}] she moves on held frames: ${rate} drawings a second, at most ${F.clock.heldFps}`,
      rate > 2 && rate <= F.clock.heldFps,
      String(rate)
    );
    // A still idle draws nothing outside the falling petal (D-224): 2 s after the petal has fallen, before the next.
    await hold(page, 'idle');
    await page.waitForTimeout(F.view.holdSec * 1000 + 1500);
    const idle = await page.evaluate(async P => {
      const C = window.EVApp.core,
        c = C.cores()[0];
      // wait for a petal to fall and land: the next one is due everySec - forSec later, so 2 s after that are still.
      const falling = () => c.svg.querySelector('g.fall').getAttribute('opacity') !== '0';
      const t0 = performance.now();
      while (!falling() && performance.now() - t0 < 14000) await new Promise(r => setTimeout(r, 50));
      while (falling() && performance.now() - t0 < 20000) await new Promise(r => setTimeout(r, 50));
      await new Promise(r => setTimeout(r, 300));
      const a = c.draws;
      await new Promise(r => setTimeout(r, 2000));
      const fell = c.svg.querySelector('g.fall').getAttribute('opacity') !== '0';
      return { draws: c.draws - a, fell };
    }, F.moods.idle.fallingPetal);
    ok(
      `[${scheme}] a still idle draws nothing between falling petals (D-224)`,
      !idle.fell && idle.draws === 0,
      JSON.stringify(idle)
    );
    // Each gesture: a screenshot while it plays; coral on an error only; settled within its duration.
    for (const g of ['send', 'done', 'error', 'glance', 'settle']) {
      await page.evaluate(g => window.EVApp.core.gesture(g, g === 'glance' ? 'left' : undefined), g);
      await page.waitForTimeout(g === 'glance' || g === 'error' ? 700 : 300);
      const coral = await page.evaluate(() => document.querySelector('#hero .ev-av').classList.contains('err'));
      await page.locator('#hero').screenshot({ path: `${shots}/core-gesture-${g}-${scheme}.png` });
      if (g === 'error') ok(`[${scheme}] error: coral, the only gesture that is`, coral);
      else ok(`[${scheme}] ${g}: no coral`, !coral);
      if (g === 'error') ok(`[${scheme}] error: she turns to him`, (await info(page)).turned);
      await page.waitForTimeout(F.gestures[g].durationSec * 1000 + 200);
      const left = await page.evaluate(() => window.EVApp.core.stats().gestures);
      ok(`[${scheme}] ${g} settles within ${F.gestures[g].durationSec} s`, left.length === 0, JSON.stringify(left));
    }
    // Speech (D-215): the three-pose chart, each pose held two held frames at least.
    const sp = await page.evaluate(async () => {
      const C = window.EVApp.core,
        c = C.cores()[0];
      window.__holdMood = 'speaking';
      C.setMood('speaking');
      c.G.spLog = [];
      const words = 'Preload is the stretch before the squeeze. More filling, more stretch.'.split(' ');
      const t0 = performance.now();
      let i = 0;
      while (performance.now() - t0 < 4000) {
        const w = words[i++ % words.length];
        C.speak(w, { emphasis: w === 'stretch' });
        await new Promise(r => setTimeout(r, 60 + w.length * 15 + (/[.,]$/.test(w) ? 300 : 0)));
      }
      C.speechEnd();
      const log = c.G.spLog.slice();
      // each pose's run, in held frames, from one change to the next
      const runs = log.slice(1).map((x, k) => [log[k][1], x[0] - log[k][0]]);
      return { poses: [...new Set(log.map(x => x[1]))].sort(), runs };
    });
    ok(
      `[${scheme}] speech moves through the three poses, each held at least ${F.speech.minHoldFrames} frames`,
      sp.poses.length >= 2 && sp.runs.every(([, n]) => n >= F.speech.minHoldFrames),
      JSON.stringify(sp)
    );
    const emph = await page.evaluate(() => {
      const C = window.EVApp.core;
      C.speak('stretch', true);
      C.speak('stretch', { emphasis: true });
      C.speak('plain');
      C.speechEnd();
      return C.stats()
        .log.filter(e => e.kind === 'speak')
        .slice(-3)
        .map(e => e.detail || null);
    });
    ok(
      `[${scheme}] speak(word, emphasis) takes a boolean or {emphasis}`,
      JSON.stringify(emph) === JSON.stringify(['emphasis', 'emphasis', null]),
      JSON.stringify(emph)
    );
    // A session's progress (D-217): the petals past it are drawn quiet.
    await hold(page, 'idle');
    // Held against the page's own session render, which sets it again as the page changes.
    await page.evaluate(() => {
      const C = window.EVApp.core;
      C.__ring = C.setRing;
      C.setRing = () => {};
      C.__ring(0.4);
    });
    await page.waitForTimeout(500);
    const dim = await page.evaluate(() => document.querySelectorAll('#hero .pet.dim').length);
    const dimInfo = await page.evaluate(() => {
      const c = window.EVApp.core.cores()[0];
      return {
        vis: c.vis,
        connected: c.el.isConnected,
        ring: window.EVApp.core.stats().ring,
        draws: c.draws,
        box: c.svg.getBoundingClientRect().height,
      };
    });
    await page.locator('#hero').screenshot({ path: `${shots}/core-session-${scheme}.png` });
    await page.evaluate(() => window.EVApp.core.setRing(-1));
    ok(
      `[${scheme}] two answers of five: the other petals quiet`,
      dim >= 3 && dim <= 4,
      JSON.stringify({ dim, ...dimInfo })
    );
    if (scheme === 'phone') {
      // Her frame budget (D-224): 10 s of speech, 4x CPU throttle, DPR 3. B-152 (D-176): advisory here, its numbers
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
        `[phone] frame budget (D-224): at most ${B.maxSlowSharePct}% of frames over ${B.slowFrameMs} ms over ${B.speechSec} s of speech, ${B.cpuThrottle}x throttle, DPR ${B.dpr}; at most ${B.maxRedrawsPerSec} drawings a second`,
        measureBudget,
        b => {
          const v = allPass([
            [
              b.framesOver25ms <= (B.maxSlowSharePct / 100) * b.frames && b.frames > 300 ? 'PASS' : 'FAIL',
              'slow frames',
              `${b.framesOver25ms} of ${b.frames}`,
            ],
            [
              b.redrawsPerSec <= B.maxRedrawsPerSec + 0.5 ? 'PASS' : 'FAIL',
              'drawings a second',
              String(b.redrawsPerSec),
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
  // Reduced motion: one still drawing per mood; an error still shows coral.
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await openPage(page);
    const seen = new Set();
    for (const m of spec.persona.avatar.moods) {
      await hold(page, m);
      await page.waitForTimeout(400);
      const a = await info(page);
      await page.waitForTimeout(900);
      const b = await info(page);
      seen.add(b.hash);
      await page.locator('#hero').screenshot({ path: `${shots}/core-reduced-${m}-phone.png` });
      ok(`[reduced motion] ${m}: one still drawing`, a.hash === b.hash && a.petals === 5, `${a.hash} ${b.hash}`);
    }
    ok('[reduced motion] each mood its own drawing where its pose differs', seen.size >= 3, String(seen.size));
    await hold(page, 'idle');
    await page.evaluate(() => window.EVApp.core.gesture('error'));
    await page.waitForTimeout(300);
    ok(
      '[reduced motion] an error still shows coral',
      await page.evaluate(() => document.querySelector('#hero .ev-av').classList.contains('err'))
    );
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
