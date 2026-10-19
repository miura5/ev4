// The core v2 harness (B-76; D-134, D-135): the built staging page with E.V.'s core driven through its page API
// (EVApp.core: setMood, gesture, speak, speechEnd, setRing), on real time (no fake clock: it would fake the animation
// frames being measured). It renders each mood and gesture at 390 and 1280 px with screenshots, checks that each
// gesture settles, that coral shows only on an error and that reduced motion holds a still frame per mood, and measures
// 10 s of speech, with wisps and the ring, at 390x844, DPR 3, Chromium, 4x CPU throttle (CDP
// Emulation.setCPUThrottlingRate): the share of frames over 25 ms and the core's own draw p95 against
// spec.ui.look.core.frameBudget (D-135 as amended). It then throttles harder to watch the run-time step-down, and checks
// the Canvas 2D fallback, both where WebGL is missing and where its context is lost. The record is a staging export as for run.cjs.
//   node test/harness/core.cjs <record dir> [screenshots dir] [--json <file>]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2); const jsonAt = args.indexOf('--json'); const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const [dbDir, shotsArg] = args;
if (!dbDir) { console.error('usage: node test/harness/core.cjs <record dir> [screenshots dir] [--json <file>]'); process.exit(2); }
const shots = shotsArg || '/tmp/ev4-shots'; fs.mkdirSync(shots, { recursive: true });
function load(dir) { const db = {}; for (const c of fs.readdirSync(dir)) { const p = path.join(dir, c); if (!fs.statSync(p).isDirectory()) continue; db[c] = {}; for (const f of fs.readdirSync(p)) if (f.endsWith('.json')) db[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')); } return db; }
const seed = load(dbDir); delete seed.system; delete seed.legacy; delete seed.debug; delete seed.journal;
// As in run.cjs: the page opens as if nothing has been said or started today, so her stage core is at full size.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const dayOf = iso => iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso)) : null;
if (seed.talk) delete seed.talk[today];
for (const c of ['sessions', 'workouts']) for (const [id, d] of Object.entries(seed[c] || {})) if ((d.date || dayOf(d.startedAt)) === today) delete seed[c][id];
const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8'));
const L = spec.ui.look.core;
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const ORIGIN = 'https://ev.local'; const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const skeleton = b => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + b + '</body></html>';
async function openPage(page, { renderer } = {}) {
  const dir = path.join(root, 'dist/page/staging');
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await page.route(ORIGIN + '/**', r => { const name = new URL(r.request().url()).pathname.slice(1) || 'index.html'; if (name === 'index.html') return r.fulfill({ body: skeleton(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')), contentType: 'text/html' }); const f = path.join(dir, name); if (name === 'spec.json' && renderer) { const sp = JSON.parse(fs.readFileSync(f, 'utf8')); sp.ui.look.core.renderer = renderer; return r.fulfill({ body: JSON.stringify(sp), contentType: 'application/json' }); } return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' }) : r.fulfill({ status: 404, body: '' }); });
  await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => window.EVApp && window.EVApp.core && document.querySelector('#hero canvas'), null, { timeout: 15000 });
  await page.waitForTimeout(600);
}
const results = []; const ok = (name, cond, detail = '') => { results.push([cond ? 'PASS' : 'FAIL', name, detail]); };
const p95 = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(.95 * s.length) - 1)]; };
const r2 = x => x == null ? null : Math.round(x * 100) / 100;
// The stage core's last frame as numbers (EVApp.core.sample: lit pixels, mean colour of what is lit, a hash).
const canvasInfo = page => page.evaluate(() => window.EVApp.core.sample(0));
// 10 s of speech in the page: the canvas's reply pacing, words through speak(), repeated until the time is up.
const SPEECH = `async (secs) => { const C = window.EVApp.core; const text = 'Preload is the *stretch* before the squeeze. More filling, more stretch, a stronger contraction, up to a point. Done. Three preload questions are first in tonight’s review.';
  const words = text.split(' '); const end = performance.now() + secs * 1000; C.setMood('speaking'); C.setRing(.6); C.resetStats(); let i = 0;
  while (performance.now() < end) { const raw = words[i++ % words.length], w = raw.replace(/\\*/g, ''); C.speak(w, { emphasis: raw.startsWith('*') });
    await new Promise(r => setTimeout(r, 60 + w.length * 15 + (/[,;:]$/.test(w) ? 210 : 0) + (/[.?!]$/.test(w) ? 400 : 0))); }
  C.speechEnd(); const s = C.stats(); return { frames: s.frames, draws: s.draws, level: s.level, env: s.envelope }; }`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const budget = {};
  for (const scheme of ['phone', 'desktop']) {
    const ctx = await browser.newContext({ viewport: scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 }, colorScheme: 'dark', deviceScaleFactor: scheme === 'phone' ? 3 : 1 });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await openPage(page);
    const want = scheme === 'phone' ? 260 : 340;
    const size = await page.evaluate(() => document.querySelector('#hero .ev-av').getBoundingClientRect().width);
    ok(`[${scheme}] her stage core is ${want} px (spec.ui.look.core.sizes at 100%)`, Math.round(size) === want, String(size));
    ok(`[${scheme}] she draws with WebGL`, (await canvasInfo(page)).renderer === 'webgl');
    ok(`[${scheme}] the page API is there`, await page.evaluate(() => ['setMood', 'gesture', 'speak', 'speechEnd', 'setRing'].every(k => typeof window.EVApp.core[k] === 'function')));
    // B-77: the greeting reveals word by word on opening and ends on a settle; let it finish before timing anything.
    await page.waitForFunction(() => !document.querySelector('#thread .reveal') && window.EVApp.core.stats().gestures.length === 0, null, { timeout: 30000 });
    // Each mood, held long enough to ease in (the page's own mood timer is held off by setting it again).
    for (const m of spec.persona.avatar.moods) {
      await page.evaluate(m => { const C = window.EVApp.core; if (!C.__set) { C.__set = C.setMood; C.setMood = x => C.__set(window.__holdMood || x); } window.__holdMood = m; C.setMood(m); }, m);
      await page.waitForTimeout(1300);
      const info = await canvasInfo(page);
      await page.locator('#hero').screenshot({ path: `${shots}/core-mood-${m}-${scheme}.png` });
      ok(`[${scheme}] mood ${m}: drawn, teal and violet`, info.lit > 2000 && info.g > info.r * .9 && (await page.evaluate(() => window.EVApp.core.stats().mood)) === m, JSON.stringify({ lit: info.lit, r: Math.round(info.r), g: Math.round(info.g), b: Math.round(info.b) }));
    }
    await page.evaluate(() => { window.__holdMood = 'idle'; });
    await page.waitForTimeout(800);
    // Each gesture: a screenshot while it plays, settled within its duration.
    for (const g of ['send', 'done', 'error', 'glance', 'settle']) {
      const before = await canvasInfo(page);
      await page.evaluate(g => window.EVApp.core.gesture(g, g === 'glance' ? 'left' : undefined), g);
      await page.waitForTimeout(g === 'glance' ? 600 : 250);
      const mid = await canvasInfo(page); const state = await page.evaluate(() => window.EVApp.core.cores()[0].eng.state());
      await page.locator('#hero').screenshot({ path: `${shots}/core-gesture-${g}-${scheme}.png` });
      // Coral is red rising against green (her teal ring and ripple raise both).
      const rg = x => Math.round(x.r - x.g);
      if (g === 'error') ok(`[${scheme}] error: tinted coral, the only gesture that is`, rg(mid) > rg(before) + 8, `red-green ${rg(before)} -> ${rg(mid)}`);
      else ok(`[${scheme}] ${g}: no coral`, rg(mid) <= rg(before) + 6, `red-green ${rg(before)} -> ${rg(mid)}`);
      if (g === 'glance') ok(`[${scheme}] glance left moves her nucleus left`, state.n.x < -1, JSON.stringify(state.n));
      if (g === 'send') ok(`[${scheme}] send ripples`, state.ripples > 0);
      await page.waitForTimeout(L.gestures[g].durationSec * 1000 + 150);
      const left = await page.evaluate(() => window.EVApp.core.stats().gestures);
      ok(`[${scheme}] ${g} settles within ${L.gestures[g].durationSec} s`, left.length === 0, JSON.stringify(left));
    }
    // A glance at a target on the page: toward the composer, which sits below her.
    await page.evaluate(() => window.EVApp.core.gesture('glance', document.getElementById('ev-input')));
    await page.waitForTimeout(600);
    const gs = await page.evaluate(() => window.EVApp.core.cores()[0].eng.state());
    ok(`[${scheme}] glance at a target (the composer, below her) moves her nucleus down`, gs.n.y > 1, JSON.stringify(gs.n));
    await page.waitForTimeout(2000);
    // Speech: the swell rises with words, holds between them, and rests after speechEnd.
    const sp = await page.evaluate(async () => { const C = window.EVApp.core; const seen = []; for (const w of ['Preload', 'is', 'the', 'stretch', 'before', 'the', 'squeeze.']) { C.speak(w, { emphasis: w === 'stretch' }); await new Promise(r => setTimeout(r, 160)); seen.push(C.stats().envelope.env); }
      C.speechEnd(); await new Promise(r => setTimeout(r, 4500)); return { during: seen, after: C.stats().envelope.env, log: C.stats().log.filter(e => e.kind === 'speak').length }; });
    const emph = await page.evaluate(() => { const C = window.EVApp.core; C.speak('stretch', true); C.speak('stretch', { emphasis: true }); C.speak('plain'); C.speechEnd(); return C.stats().log.filter(e => e.kind === 'speak').slice(-3).map(e => e.detail || null); });
    ok(`[${scheme}] speak(word, emphasis) takes a boolean or {emphasis}`, JSON.stringify(emph) === JSON.stringify(['emphasis', 'emphasis', null]), JSON.stringify(emph));
    await page.waitForTimeout(4500);
    ok(`[${scheme}] speech swells while she talks and rests after speechEnd`, Math.min(...sp.during.slice(2)) > .1 && sp.after === 0 && sp.log >= 7, JSON.stringify(sp));
    // The progress ring.
    await page.evaluate(() => window.EVApp.core.setRing(.45)); await page.waitForTimeout(1200);
    await page.locator('#hero').screenshot({ path: `${shots}/core-ring-${scheme}.png` });
    const ringed = await canvasInfo(page); await page.evaluate(() => window.EVApp.core.setRing(-1));
    ok(`[${scheme}] the progress ring draws round her`, ringed.lit > 0);
    if (scheme === 'phone') {
      // The frame budget (D-135): 10 s of speech with wisps and the ring, 4x CPU throttle, DPR 3.
      const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.waitForTimeout(1500);
      const m = await page.evaluate(`(${SPEECH})(10)`);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const FB = L.frameBudget, slow = m.frames.filter(f => f > FB.slowFrameMs).length;
      budget.phone = { renderer: (await canvasInfo(page)).renderer, frames: m.frames.length, framesOver25ms: slow, slowSharePct: r2(100 * slow / Math.max(1, m.frames.length)), p95FrameMs: r2(p95(m.frames)), p95CoreDrawMs: r2(p95(m.draws)), medianFrameMs: r2(m.frames.slice().sort((a, b) => a - b)[m.frames.length >> 1]), stepDownLevel: m.level, dpr: 3, throttle: 4, viewport: '390x844' };
      // D-135 as amended: dropped frames are the measure, since rAF intervals cannot go below the harness's vsync floor
      // (about 16.8 ms); the p95 frame time is still reported.
      ok(`[phone] frame budget: at most ${FB.maxSlowShare * 100}% of frames over ${FB.slowFrameMs} ms over 10 s of speech, 4x throttle, DPR 3`, slow <= FB.maxSlowShare * m.frames.length && m.frames.length > 300, JSON.stringify(budget.phone));
      ok(`[phone] frame budget: the core's own draw ≤ ${L.frameBudget.p95CoreDrawMs} ms p95`, budget.phone.p95CoreDrawMs <= L.frameBudget.p95CoreDrawMs, JSON.stringify(budget.phone));
      ok('[phone] she ran whole through it (no step-down during the measured speech)', m.level === 0, 'level ' + m.level);
    } else {
      const m = await page.evaluate(`(${SPEECH})(10)`);
      budget.desktop = { frames: m.frames.length, framesOver25ms: m.frames.filter(f => f > L.frameBudget.slowFrameMs).length, p95FrameMs: r2(p95(m.frames)), p95CoreDrawMs: r2(p95(m.draws)), stepDownLevel: m.level, dpr: 1, throttle: 1, viewport: '1280x860' };
      ok('[desktop] 10 s of speech recorded at 1280 (no throttle)', m.frames.length > 300, JSON.stringify(budget.desktop));
    }
    ok(`[${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // The fallback where WebGL is missing (spec.ui.look.core.renderer 2d): the same body in a 2D canvas.
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 3 });
    const page = await ctx.newPage(); await openPage(page, { renderer: '2d' }); await page.waitForTimeout(900);
    const info = await canvasInfo(page); await page.locator('#hero').screenshot({ path: `${shots}/core-renderer-2d-phone.png` });
    ok('[2d fallback] she draws on a 2D canvas, teal and violet', info.renderer === '2d' && info.lit > 2000 && info.g > info.r * .9, JSON.stringify({ renderer: info.renderer, lit: info.lit }));
    await ctx.close(); }
  // The fallback where the WebGL context is lost (D-134): the canvas is swapped for a fresh 2D one, carrying her core,
  // and she keeps drawing.
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 3 });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await openPage(page); await page.waitForTimeout(600);
    const before = await canvasInfo(page);
    const lost = await page.evaluate(() => { const cv = document.querySelector('#hero canvas'); const gl = cv.getContext('webgl'); const x = gl && gl.getExtension('WEBGL_lose_context'); if (!x) return false; x.loseContext(); return true; });
    await page.waitForTimeout(900);
    const info = await canvasInfo(page); await page.locator('#hero').screenshot({ path: `${shots}/core-renderer-lost-phone.png` });
    const after = await page.evaluate(() => { const C = window.EVApp.core, c = C.cores()[0]; const cv = c.eng.canvas; return { inPage: cv.isConnected && document.querySelectorAll('#hero canvas').length === 1, tagged: cv.__core === c, log: C.stats().log.filter(e => e.kind === 'renderer').map(e => e.detail) }; });
    ok('[context lost] WebGL drew first, then the context was lost', before.renderer === 'webgl' && lost, JSON.stringify({ before: before.renderer, lost }));
    ok('[context lost] she goes on drawing on a fresh 2D canvas, teal and violet', info.renderer === '2d' && info.lit > 2000 && info.g > info.r * .9 && after.inPage && after.tagged, JSON.stringify({ renderer: info.renderer, lit: info.lit, ...after }));
    ok('[context lost] no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close(); }
  // Reduced motion (D-127): a still frame per mood, a gesture a short brightness change and back.
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage(); await openPage(page);
    for (const m of ['idle', 'speaking', 'sleepy']) {
      await page.evaluate(m => { const C = window.EVApp.core; if (!C.__set) { C.__set = C.setMood; C.setMood = x => C.__set(window.__holdMood || x); } window.__holdMood = m; C.setMood(m); }, m);
      await page.waitForTimeout(300); const a = await canvasInfo(page); await page.waitForTimeout(700); const b = await canvasInfo(page);
      await page.locator('#hero').screenshot({ path: `${shots}/core-reduced-${m}-phone.png` });
      ok(`[reduced motion] ${m}: one still frame`, a.hash === b.hash && a.lit > 1000, `${a.hash} ${b.hash} lit ${a.lit}`);
    }
    await page.evaluate(() => { window.__holdMood = 'idle'; }); await page.waitForTimeout(400);
    const a = await canvasInfo(page); await page.evaluate(() => window.EVApp.core.gesture('done')); await page.waitForTimeout(150);
    const b = await canvasInfo(page); await page.waitForTimeout(600); const c = await canvasInfo(page);
    ok('[reduced motion] a gesture is a short brightness change, then the same still frame', b.hash !== a.hash && c.hash === a.hash, `${a.hash} ${b.hash} ${c.hash}`);
    await ctx.close(); }
  // The run-time step-down (D-135 as amended): throttled hard, more than 10% of frames over 25 ms in a rolling 2 s turns
  // wisps off, then halves the points; the Silk outline stays.
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 3 });
    const page = await ctx.newPage(); await openPage(page);
    const before = await page.evaluate(() => window.EVApp.core.cores()[0].eng.state().points);
    const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 40 });
    const sd = await page.evaluate(async () => { const C = window.EVApp.core; C.setMood('speaking'); const t0 = performance.now(); while (performance.now() - t0 < 14000 && C.stats().level < 2) { C.speak('stretch'); await new Promise(r => setTimeout(r, 200)); } C.speechEnd(); const s = C.stats(); return { level: s.level, steps: s.steps, log: s.log.filter(e => e.kind === 'stepDown').map(e => e.name) }; });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await page.waitForTimeout(600);
    const info = await canvasInfo(page); await page.locator('#hero').screenshot({ path: `${shots}/core-stepdown-phone.png` });
    ok('[step-down] under a 40x throttle: wisps off, then half the points', sd.level === 2 && sd.log.join() === 'wisps,halfPoints', JSON.stringify(sd));
    ok('[step-down] the Silk outline is still drawn', info.lit > 1500 && before > 0, `lit ${info.lit}`);
    await ctx.close(); }
  await browser.close();
  for (const [s, n, d] of results) console.log(s, n, d);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log('frame budget:', JSON.stringify(budget));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), results, budget }, null, 1));
  console.log(failed ? `${failed} FAILED of ${results.length} checks` : `ALL PASSED: ${results.length} checks`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('CRASHED', e.message); process.exit(1); });
