// The Captions harness (B-77; D-122, D-127, D-128 gap rule): the built staging page's E.V. tab at 390 and 1280 px on
// a staging export with a planted day of talk (two earlier conversations today, one last night), the page's clock at
// 7pm Central so the greeting opens a new conversation. Checks: the greeting opens alone at her full size; a reply
// reveals word by word, each sentence announced once; Matt's echo; Back to now on scroll and on tapping her; a pull
// loads the previous conversation with its count and stops at the start of today; the layout wraps at 899 px and not
// at 900; reduced motion shows the line whole. Screenshots of each state at both widths, and the measured layout set
// against the Captions v2 artboards' numbers.
// With --artboards <dir> it also renders the Captions v2 artboards themselves, offline, beside the page: <dir> holds the
// Design artifact's project/V2.dc.html, project/V2Desktop.dc.html, project/Core2.dc.html and
// artifact-type/dc-runtime.js (Artifact read of E.V. Home: Captions; never committed here), served as ./support.js.
// Each width's open and conversation states are measured on both and saved side by side.
//   node test/harness/captions.cjs <record dir> [screenshots dir] [--artboards <dir>]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '../..');
const argv = process.argv.slice(2); const artAt = argv.indexOf('--artboards'); const artDir = artAt >= 0 ? argv.splice(artAt, 2)[1] : null;
const [dbDir, shotsArg] = argv;
if (!dbDir) { console.error('usage: node test/harness/captions.cjs <record dir> [screenshots dir]'); process.exit(2); }
const shots = shotsArg || '/tmp/ev4-shots'; fs.mkdirSync(shots, { recursive: true });
function load(dir) { const db = {}; for (const c of fs.readdirSync(dir)) { const p = path.join(dir, c); if (!fs.statSync(p).isDirectory()) continue; db[c] = {}; for (const f of fs.readdirSync(p)) if (f.endsWith('.json')) db[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')); } return db; }
const seed = load(dbDir); delete seed.system; delete seed.legacy; delete seed.debug; delete seed.journal;
const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8'));
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const fmt = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
const today = fmt(new Date()), yesterday = fmt(new Date(Date.now() - 864e5));
// Central times on a date (CDT, UTC-5, in October).
const ct = (date, hh, mm) => new Date(Date.parse(date + 'T00:00:00Z') + (hh + 5) * 3600e3 + mm * 60e3);
const NOW = ct(today, 19, 0);
const mid = (d, who) => 'm-' + d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '').replace('Z', '') + '-' + who;
const talkDoc = (date, msgs) => ({ schema: 1, writer: 'page', at: msgs[0][0].toISOString(), source: 'E.V. Home', date, messages: Object.fromEntries(msgs.map(([d, role, text]) => [mid(d, role === 'matt' ? 'matt' : 'ev'), { role, text, at: d.toISOString(), ...(role === 'ev' ? { tier: 'local', cards: [] } : {}) }])) });
// The planted day: last night (2 messages), this morning (3), noon (4); now is 7pm, so the greeting starts a new one.
const NIGHT = [[ct(yesterday, 20, 0), 'matt', 'harness night: what is on tomorrow'], [ct(yesterday, 20, 1), 'ev', 'Harness night line. Sleep well.']];
const MORNING = [[ct(today, 9, 0), 'matt', 'harness morning: what is on tonight'], [ct(today, 9, 1), 'ev', 'Harness morning line. Six review questions tonight.'], [ct(today, 9, 3), 'matt', 'harness morning: ok']];
const NOON = [[ct(today, 12, 0), 'matt', 'harness noon: explain afterload'], [ct(today, 12, 1), 'ev', 'Harness noon line. Afterload is the push back.'], [ct(today, 12, 5), 'matt', 'harness noon: and preload'], [ct(today, 12, 6), 'ev', 'Harness noon line two. Preload is the stretch.']];
// Two days ago (D-128 as amended: a pull past today goes on, under a date divider) and nine days ago, outside the talk
// read window (never loaded: That's everything from the last 7 days). Every other day of talk is taken out.
const dayBefore = (d, n) => fmt(new Date(Date.parse(d + 'T12:00:00Z') - n * 864e5));
const twoAgo = dayBefore(today, 2), nineAgo = dayBefore(today, 9);
const TWO = [[ct(twoAgo, 18, 0), 'matt', 'harness two days ago: quiz me'], [ct(twoAgo, 18, 1), 'ev', 'Harness two days ago line. Three questions.'], [ct(twoAgo, 18, 4), 'matt', 'harness two days ago: done']];
const NINE = [[ct(nineAgo, 18, 0), 'matt', 'harness nine days ago: hello'], [ct(nineAgo, 18, 1), 'ev', 'Harness nine days ago line.']];
seed.talk = Object.fromEntries(Object.entries(seed.talk || {}).filter(([k]) => !/^\d{4}-\d{2}-\d{2}$/.test(k)));
seed.talk[yesterday] = talkDoc(yesterday, NIGHT); seed.talk[today] = talkDoc(today, [...MORNING, ...NOON]);
seed.talk[twoAgo] = talkDoc(twoAgo, TWO); seed.talk[nineAgo] = talkDoc(nineAgo, NINE);
const dayLabel = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
// Enough dates in the next two weeks that the dates card is long (five rows and its more line).
seed.dates = seed.dates || {};
for (let i = 1; i <= 9; i++) { const d = dayBefore(today, -i); seed.dates['harness-' + i] = { schema: 1, writer: 'page', at: new Date().toISOString(), source: 'owner', addedAt: new Date().toISOString(), date: d, title: 'Harness date ' + i + ': a long enough title to wrap on a phone', kind: 'due', course: 'NUR 112', graded: false }; }
for (const c of ['sessions', 'workouts']) for (const [id, d] of Object.entries(seed[c] || {})) if ((d.date || (d.startedAt && fmt(new Date(d.startedAt)))) === today) delete seed[c][id];
const ORIGIN = 'https://ev.local'; const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const skeleton = b => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + b + '</body></html>';
async function openPage(page) {
  await page.clock.install({ time: NOW });
  const dir = path.join(root, 'dist/page/staging');
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await page.route(ORIGIN + '/**', r => { const name = new URL(r.request().url()).pathname.slice(1) || 'index.html'; if (name === 'index.html') return r.fulfill({ body: skeleton(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')), contentType: 'text/html' }); const f = path.join(dir, name); return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' }) : r.fulfill({ status: 404, body: '' }); });
  await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => document.querySelector('#thread .msg.greet'), null, { timeout: 15000 });
}
const results = []; const ok = (name, cond, detail = '') => { results.push([cond ? 'PASS' : 'FAIL', name, detail]); };
const view = page => page.evaluate(() => {
  const t = document.getElementById('thread'), lines = [...t.querySelectorAll('.msg')].filter(m => getComputedStyle(m).display !== 'none');
  const now = t.querySelector('.msg.ev.current .bubble'), past = t.querySelector('.msg.ev:not(.current) .bubble'), hero = document.getElementById('hero'), av = hero.querySelector('.ev-av');
  const cs = x => x ? getComputedStyle(x) : null;
  return { texts: lines.map(m => (m.classList.contains('earlier') ? 'E:' : '') + (m.classList.contains('matt') ? 'M:' : 'V:') + m.querySelector('.bubble') ?.textContent.slice(0, 60)),
    greetOnly: lines.length === 1 && lines[0].classList.contains('greet') && lines[0].classList.contains('current'),
    step: hero.dataset.step, corePx: Math.round(av.getBoundingClientRect().width), stageH: Math.round(hero.getBoundingClientRect().height),
    coreX: Math.round(av.getBoundingClientRect().x + av.getBoundingClientRect().width / 2), coreY: Math.round(av.getBoundingClientRect().y), lineY: now ? Math.round(now.getBoundingClientRect().y) : null,
    composerW: Math.round(document.querySelector('.compose-row').getBoundingClientRect().width), composerY: Math.round(document.querySelector('.compose-row').getBoundingClientRect().y),
    nowSize: cs(now) && cs(now).fontSize, pastSize: cs(past) && cs(past).fontSize, pastOpacity: cs(past) && cs(past).opacity,
    say: [...document.querySelectorAll('#ev-say p')].map(p => p.textContent), sayLive: document.getElementById('ev-say').getAttribute('aria-live'), threadLive: t.getAttribute('aria-live'),
    pull: document.querySelector('.cap-pull .lbl').textContent, now: !document.getElementById('ev-now').hidden, scrollTop: t.scrollTop, maxScroll: t.scrollHeight - t.clientHeight,
    bubbles: lines.some(m => { const b = m.querySelector('.bubble'); return b && (cs(b).backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs(b).paddingLeft) > 0); }) };
});
async function send(page, text, reply) { await page.evaluate(r => { window.__chatScript = []; window.__chatPre = ''; window.__chatReply = r; }, reply); await page.fill('#ev-input', text); await page.click('#ev-send'); }
async function pullOnce(page) { await page.evaluate(() => { const t = document.getElementById('thread'); t.scrollTop = 0; t.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(450); }
// A full pull after an edge: away from the top first (the next pull starts over), then up and hold.
async function pullAgain(page) { await page.evaluate(() => { const t = document.getElementById('thread'); t.scrollTop = Math.min(220, t.scrollHeight - t.clientHeight); t.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(120); await pullOnce(page); }
// When each word of her current line came on (D-137), from a MutationObserver started before the reply.
const watchReveal = page => page.evaluate(() => { window.__rv = []; const t0 = Date.now(); const mo = new MutationObserver(ms => { for (const m of ms) if (m.target.classList && m.target.classList.contains('w') && m.target.classList.contains('on') && !m.target.__seen) { m.target.__seen = 1; window.__rv.push([Date.now() - t0, m.target.textContent]); } }); mo.observe(document.getElementById('thread'), { subtree: true, attributes: true, attributeFilter: ['class'] }); window.__rvStop = () => { mo.disconnect(); return { t0 }; }; });
// The artboards themselves (--artboards): the design runtime renders each offline. Its scenario opens at her full
// size and moves to the talk phase on its own, so each state is caught by the width of her canvas.
const ART_MEASURE = () => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cv = [...document.querySelectorAll('canvas')].filter(vis).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  const texts = [...document.querySelectorAll('body *')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 3));
  const line = texts.map(e => e.closest('p, div')).filter(Boolean).sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0];
  const r = cv && cv.getBoundingClientRect(), lr = line && line.getBoundingClientRect(), ta = document.querySelector('textarea'), cr = ta && ta.parentElement.getBoundingClientRect();
  return { corePx: r && Math.round(r.width), coreX: r && Math.round(r.x + r.width / 2), coreY: r && Math.round(r.y), lineFs: line && getComputedStyle(line).fontSize, lineY: lr && Math.round(lr.y), composerW: cr && Math.round(cr.width), composerY: cr && Math.round(cr.y) };
};
async function artboard(browser, scheme) {
  const [file, vp, base] = scheme === 'phone' ? ['V2.dc.html', { width: 390, height: 844 }, 260] : ['V2Desktop.dc.html', { width: 1280, height: 860 }, 340];
  const ctx = await browser.newContext({ viewport: vp, colorScheme: 'dark' }); const p = await ctx.newPage();
  await p.route('**/*', r => { const u = new URL(r.request().url()); if (u.hostname !== 'art.local') return r.fulfill({ status: 404, body: '' });
    const n = u.pathname.slice(1), f = n === 'support.js' ? path.join(artDir, 'artifact-type/dc-runtime.js') : path.join(artDir, 'project', n);
    return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: n.endsWith('.js') ? 'text/javascript' : 'text/html' }) : r.fulfill({ status: 404, body: '' }); });
  await p.goto('http://art.local/' + file); const out = {};
  for (const [state, px] of [['open', base], ['conversation', Math.round(base * .8)]]) {
    const hit = await p.waitForFunction(px => [...document.querySelectorAll('canvas')].some(c => Math.round(c.getBoundingClientRect().width) === px), px, { timeout: 25000 }).then(() => true, () => false);
    await p.waitForTimeout(state === 'open' ? 250 : 2500);
    out[state] = { ...(await p.evaluate(ART_MEASURE)), caught: hit, png: `${shots}/artboard-${state}-${scheme}.png` }; await p.screenshot({ path: out[state].png });
  }
  await ctx.close(); return out;
}
async function sideBySide(browser, left, right, out, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width * 2 + 24, height: vp.height + 28 } }); const p = await ctx.newPage(); const b64 = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  await p.setContent(`<body style="margin:0;background:#2a2f36;font:12px sans-serif;color:#ccc"><div style="display:flex;gap:24px"><div>artboard (Captions v2)<br><img src="${b64(left)}" width="${vp.width}"></div><div>staging build<br><img src="${b64(right)}" width="${vp.width}"></div></div></body>`);
  await p.screenshot({ path: out }); await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const REPLY = 'Preload is the **stretch** before the squeeze. More filling, more stretch, a stronger contraction.';
  const S1 = 'Preload is the stretch before the squeeze.', S2 = 'More filling, more stretch, a stronger contraction.';
  // The artboards' numbers, read from their source (E.V. Home: Captions, V2.dc.html and V2Desktop.dc.html: the core's
  // size and scale, stageH, evStyle, mattStyle); D-122 as amended takes the desktop artboard's 16 px for earlier lines.
  const art = { phone: { core: 260, stage: 300, convCore: 208, convStage: 232, now: '20px', past: '15px', matt: '13px' }, desktop: { core: 340, stage: 370, convCore: 272, convStage: 290, now: '24px', past: '16px', matt: '14px' } };
  const measured = {}, rendered = {};
  // Our page and the artboard in one state, side by side, with the numbers that can be compared: her core's size, its
  // centre and top, her line's size and top, and the composer's width on desktop.
  const against = async (scheme, state, ours, oursPng, vp) => {
    const a = rendered[scheme] && rendered[scheme][state]; if (!a) return;
    const out = `${shots}/against-artboard-${state}-${scheme}.png`; await sideBySide(browser, a.png, oursPng, out, vp);
    const d = { corePx: [a.corePx, ours.corePx], coreX: [a.coreX, ours.coreX], coreY: [a.coreY, ours.coreY], lineFs: [a.lineFs, ours.nowSize], lineY: [a.lineY, ours.lineY], composerW: [a.composerW, ours.composerW] };
    rendered[scheme][state].vs = d;
    ok(`[${scheme}] against the rendered artboard, ${state}: her core ${a.corePx} px at the same centre, her line ${a.lineFs}`, a.caught && Math.abs(a.corePx - ours.corePx) <= 1 && Math.abs(a.coreX - ours.coreX) <= 2 && a.lineFs === ours.nowSize, JSON.stringify(d));
  };
  for (const scheme of ['phone', 'desktop']) {
    const ctx = await browser.newContext({ viewport: scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 }, colorScheme: 'dark' });
    if (artDir) rendered[scheme] = await artboard(browser, scheme);
    const VP = scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 };
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await openPage(page); await page.waitForTimeout(400);
    let v = await view(page); const A = art[scheme];
    ok(`[${scheme}] a new conversation opens on the greeting alone`, v.greetOnly, JSON.stringify(v.texts));
    ok(`[${scheme}] opening: her core at 100% (${A.core} px) on a ${A.stage} px stage, no bubbles`, v.step === 'idle' && v.corePx === A.core && v.stageH === A.stage && !v.bubbles, JSON.stringify({ step: v.step, px: v.corePx, stage: v.stageH }));
    ok(`[${scheme}] the captions are the screen reader's polite live region, the scroller is not`, v.sayLive === 'polite' && !v.threadLive);
    await page.waitForTimeout(9000); // the greeting reveals and settles
    v = await view(page); measured[scheme] = { open: { core: v.corePx, stage: v.stageH, now: v.nowSize } };
    await page.screenshot({ path: `${shots}/captions-open-${scheme}.png` });
    await against(scheme, 'open', v, `${shots}/captions-open-${scheme}.png`, VP);
    // A reply, word by word, each sentence announced once.
    const said0 = (await view(page)).say.length;
    await send(page, 'explain preload', REPLY);
    await page.waitForTimeout(250);
    const echo = await page.evaluate(() => { const e = document.getElementById('ev-echo'); return { on: e.classList.contains('on'), text: e.textContent }; });
    ok(`[${scheme}] his line echoes above the composer`, echo.on && echo.text === 'You · explain preload', JSON.stringify(echo));
    const seen = [];
    for (let i = 0; i < 8; i++) { seen.push(await page.evaluate(() => { const b = document.querySelector('#thread .msg.ev.current .bubble'); return b ? [b.querySelectorAll('.w.on').length, b.querySelectorAll('.w').length] : [0, 0]; })); await page.waitForTimeout(260); }
    const total = seen[seen.length - 1][1];
    ok(`[${scheme}] the reply reveals word by word`, total === 14 && seen.some(([n]) => n > 0 && n < total) && seen.every(([n], i) => !i || n >= seen[i - 1][0]), JSON.stringify(seen));
    await page.screenshot({ path: `${shots}/captions-reveal-${scheme}.png` });
    await page.waitForTimeout(4500);
    v = await view(page);
    const said = v.say; // the region keeps its last six lines; counted by content
    ok(`[${scheme}] each finished sentence is announced once, and his echo once`, said.filter(x => x === S1).length === 1 && said.filter(x => x === S2).length === 1 && said.filter(x => x === 'You: explain preload').length === 1, JSON.stringify(said));
    const done = await page.evaluate(() => { const b = document.querySelector('#thread .msg.ev.current .bubble'); const em = b.querySelector('b .w'); const log = window.EVApp.core.stats().log;
      return { all: b.querySelectorAll('.w.on').length === b.querySelectorAll('.w').length, teal: em && getComputedStyle(em).color, speaks: log.filter(e => e.kind === 'speak').length, emph: log.filter(e => e.kind === 'speak' && e.detail === 'emphasis').map(e => e.name), settled: log.filter(e => e.kind === 'gesture').slice(-1)[0] }; });
    ok(`[${scheme}] her core spoke each word, emphasis in teal, and settled`, done.all && done.teal === 'rgb(127, 240, 220)' && done.speaks >= 14 && done.emph.includes('stretch') && done.settled && done.settled.name === 'settle', JSON.stringify(done));
    const echoOff = await page.evaluate(() => !document.getElementById('ev-echo').classList.contains('on'));
    ok(`[${scheme}] the echo fades after about 3 s; his line is not a bubble in the captions`, echoOff && !v.texts.some(t => /^M:explain preload/.test(t)), JSON.stringify(v.texts));
    ok(`[${scheme}] in conversation: core at 80% on a ${A.convStage} px stage, her line ${A.now}, earlier ${A.past} at 60%`, v.step === 'conversation' && Math.abs(v.corePx - A.convCore) <= 1 && v.stageH === A.convStage && v.nowSize === A.now && v.pastSize === A.past && Math.abs(parseFloat(v.pastOpacity) - .6) < .01, JSON.stringify({ step: v.step, px: v.corePx, now: v.nowSize, past: v.pastSize, o: v.pastOpacity }));
    measured[scheme].conversation = { core: v.corePx, stage: v.stageH, now: v.nowSize, past: v.pastSize, pastOpacity: v.pastOpacity };
    await page.screenshot({ path: `${shots}/captions-conversation-${scheme}.png` });
    await against(scheme, 'conversation', v, `${shots}/captions-conversation-${scheme}.png`, VP);
    // D-137: the first sentence at speech pace, then faster, the whole reply out within 6 s, her speech ending with the
    // last word; a tap on her line or a scroll shows the rest at once.
    const LONG = 'Afterload is the pressure the ventricle has to push against to open the valve. Think of it as the door the heart pushes on. ' +
      'When the arteries are stiff or narrow, that door is heavier, so the heart works harder for the same output. High blood pressure raises it, and so does aortic stenosis. ' +
      'Drugs that relax the arteries lower it, which is why they help a failing heart. On the exam, link afterload to the left ventricle and to systemic resistance, and preload to filling.';
    await watchReveal(page); await send(page, 'and afterload', LONG); await page.waitForTimeout(7500);
    const rv = await page.evaluate(() => { const t = window.__rvStop(); const log = window.EVApp.core.stats().log; const end = log.filter(e => e.kind === 'speechEnd').slice(-1)[0]; return { words: window.__rv, end: end ? end.at - t.t0 : null, total: document.querySelectorAll('#thread .msg.ev.current .bubble .w').length }; });
    const W = rv.words, k1 = W.findIndex(([, w]) => /\.$/.test(w)) + 1, firstMs = k1 > 1 ? W[k1 - 1][0] - W[0][0] : 0, allMs = W.length ? W[W.length - 1][0] - W[0][0] : 0, rate1 = k1 > 1 ? (k1 - 1) / (firstMs / 1000) : null;
    const pace = { words: W.length, total: rv.total, firstSentence: k1, firstSentenceMs: firstMs, wordsPerSecFirst: rate1 && +rate1.toFixed(2), allMs, speechEndAfterLastMs: rv.end != null && W.length ? rv.end - W[W.length - 1][0] : null };
    ok(`[${scheme}] D-137: the first sentence at speech pace (about 3 words a second)`, W.length === rv.total && rate1 >= 2.2 && rate1 <= 4, JSON.stringify(pace));
    ok(`[${scheme}] D-137: then faster, the whole reply out within 6 s`, allMs <= 6000 + 250 && allMs > firstMs, JSON.stringify(pace));
    ok(`[${scheme}] D-137: her speech ends with the last word`, pace.speechEndAfterLastMs != null && pace.speechEndAfterLastMs >= 0 && pace.speechEndAfterLastMs <= 300, JSON.stringify(pace));
    measured[scheme].pace = pace;
    for (const [how, act] of [['a tap on her line', () => page.click('#thread .msg.ev.current .bubble')], ['a scroll', async () => { const b = await page.locator('#thread').boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, -60); }]]) {
      await send(page, 'again', LONG); await page.waitForTimeout(900);
      const before = await page.evaluate(() => { const b = document.querySelector('#thread .msg.ev.current .bubble'); return [b.querySelectorAll('.w.on').length, b.querySelectorAll('.w').length]; });
      await act(); await page.waitForTimeout(150);
      const after = await page.evaluate(() => { const b = document.querySelector('#thread .msg.ev.current .bubble'); return [b.querySelectorAll('.w.on').length, b.querySelectorAll('.w').length]; });
      ok(`[${scheme}] D-137: ${how} shows the rest of the reply at once`, before[0] < before[1] && after[0] === after[1], JSON.stringify({ before, after }));
      await page.waitForTimeout(600);
    }
    // Back to now: scrolling away shows the pill; tapping her returns.
    await page.evaluate(() => { const t = document.getElementById('thread'); t.scrollTop = Math.max(0, t.scrollHeight - t.clientHeight - 200); t.dispatchEvent(new Event('scroll')); });
    await page.waitForTimeout(200); v = await view(page);
    ok(`[${scheme}] scrolling away shows Back to now`, v.now, JSON.stringify({ top: v.scrollTop, max: v.maxScroll }));
    await page.screenshot({ path: `${shots}/captions-back-to-now-${scheme}.png` });
    await page.click('#hero'); await page.waitForTimeout(900); v = await view(page);
    ok(`[${scheme}] tapping her returns to now`, !v.now && v.maxScroll - v.scrollTop < 4, JSON.stringify({ top: v.scrollTop, max: v.maxScroll }));
    // Pull to load: noon (4), then this morning (3), then the start of today; last night is never loaded.
    await pullOnce(page); v = await view(page);
    ok(`[${scheme}] a pull says it is loading the noon conversation's 4 messages`, v.pull === 'Loading 4 earlier messages', v.pull);
    await page.screenshot({ path: `${shots}/captions-pull-${scheme}.png` });
    await page.waitForTimeout(1000); v = await view(page);
    const earlier = v.texts.filter(t => t.startsWith('E:'));
    ok(`[${scheme}] the noon conversation is back above, with his lines small`, earlier.length === 4 && earlier.some(t => /Harness noon line two/.test(t)) && earlier.some(t => /^E:M:harness noon: explain afterload/.test(t)) && !v.texts.some(t => /morning/.test(t)), JSON.stringify(earlier));
    await pullOnce(page); v = await view(page);
    ok(`[${scheme}] the next pull loads this morning's 3`, v.pull === 'Loading 3 earlier messages', v.pull);
    await page.waitForTimeout(1000); v = await view(page);
    ok(`[${scheme}] this morning is back too`, v.texts.filter(t => t.startsWith('E:')).length === 7 && v.texts.some(t => /Harness morning line/.test(t)));
    const mattPx = await page.evaluate(() => { const m = [...document.querySelectorAll('#thread .msg.matt')].find(x => getComputedStyle(x).display !== 'none'); return m ? getComputedStyle(m.querySelector('.bubble')).fontSize : null; });
    ok(`[${scheme}] his earlier lines are ${A.matt}, grey`, mattPx === A.matt, String(mattPx));
    await pullOnce(page); await page.waitForTimeout(1000); v = await view(page);
    ok(`[${scheme}] then: That's the start of today, and last night stays out`, v.pull === 'That’s the start of today' && !v.texts.some(t => /harness night|Harness night/.test(t)), JSON.stringify({ pull: v.pull, n: v.texts.length }));
    await page.screenshot({ path: `${shots}/captions-start-of-today-${scheme}.png` });
    // D-128 as amended: the next full pull goes on into earlier days, one conversation at a time under a date divider,
    // and stops at the read window's edge.
    const divs = () => page.evaluate(() => [...document.querySelectorAll('#thread .cap-day')].map(d => d.textContent));
    await pullAgain(page); v = await view(page);
    ok(`[${scheme}] past today, the next full pull loads last night's 2`, v.pull === 'Loading 2 earlier messages', v.pull);
    await page.waitForTimeout(1000); v = await view(page); let dv = await divs();
    ok(`[${scheme}] last night comes back under Yesterday, today's under Today`, v.texts.some(t => /Harness night line/.test(t)) && dv.join() === 'Yesterday,Today', JSON.stringify(dv));
    await pullAgain(page); v = await view(page);
    ok(`[${scheme}] then the conversation two days ago, its 3`, v.pull === 'Loading 3 earlier messages', v.pull);
    await page.waitForTimeout(1000); v = await view(page); dv = await divs();
    ok(`[${scheme}] under its own date (${dayLabel(twoAgo)})`, v.texts.some(t => /Harness two days ago line/.test(t)) && dv.join() === [dayLabel(twoAgo), 'Yesterday', 'Today'].join(), JSON.stringify(dv));
    await pullAgain(page); await page.waitForTimeout(1000); v = await view(page);
    ok(`[${scheme}] then: That's everything from the last 7 days, and nine days ago stays out`, v.pull === 'That’s everything from the last 7 days' && !v.texts.some(t => /nine days ago/.test(t)), JSON.stringify({ pull: v.pull }));
    await page.evaluate(() => { document.getElementById('thread').scrollTop = 0; }); await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/captions-last-7-days-${scheme}.png` });
    const pillShown = await page.isVisible('#ev-now'); await page.click('#ev-now'); await page.waitForTimeout(900); v = await view(page);
    ok(`[${scheme}] tapping the Back to now pill folds the earlier conversations away`, pillShown && !v.texts.some(t => t.startsWith('E:')) && !v.now && v.maxScroll - v.scrollTop < 4);
    // Until B-78: a reply with several cards shows the first under her line, capped so her line stays in view, and the
    // rest as one line.
    await page.evaluate(() => { window.__chatScript = [{ tool: 'show_card', input: { type: 'dates', days: 14 } }, { tool: 'show_card', input: { type: 'weakspots' } }, { tool: 'show_card', input: { type: 'today', filter: 'all' } }]; window.__chatPre = ''; window.__chatReply = 'Here is the next two weeks. Nine things are dated.'; });
    await page.fill('#ev-input', 'what is coming up'); await page.click('#ev-send'); await page.waitForTimeout(4500);
    const lc = await page.evaluate(() => { const t = document.getElementById('thread').getBoundingClientRect(), cur = document.querySelector('#thread .msg.ev.current'), b = cur.querySelector('.bubble').getBoundingClientRect(), card = cur.querySelector('.ev-card'), cr = card && card.getBoundingClientRect();
      return { cards: cur.querySelectorAll('.ev-card').length, more: (cur.querySelector('.cap-cards-more') || {}).textContent, line: [Math.round(b.top), Math.round(b.bottom)], card: cr && [Math.round(cr.top), Math.round(cr.bottom), card.scrollHeight > card.clientHeight + 1], thread: [Math.round(t.top), Math.round(t.bottom)] }; });
    ok(`[${scheme}] a long card: one card under her line, then "2 more cards"`, lc.cards === 1 && lc.more === '2 more cards', JSON.stringify(lc));
    ok(`[${scheme}] a long card: her line stays in view, the card fits below it`, lc.line[0] >= lc.thread[0] - 1 && lc.line[1] <= lc.thread[1] + 1 && lc.card && lc.card[1] <= lc.thread[1] + 1, JSON.stringify(lc));
    await page.screenshot({ path: `${shots}/captions-long-card-${scheme}.png` });
    // Chips and composer kept.
    ok(`[${scheme}] chips and composer kept`, (await page.locator('#qchips .qchip').count()) >= 1 && await page.isVisible('#ev-input') && await page.isVisible('#ev-send'));
    if (scheme === 'desktop') {
      // From 900 px the stage and a side column; below, the phone stack.
      const lay = async w => { await page.setViewportSize({ width: w, height: 860 }); await page.waitForTimeout(400); return page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); const s = r('ev-side'), c = r('composer'), th = r('thread'); return { sideLeft: s.left, sideTop: s.top, sideW: s.width, comp: { left: c.left, right: c.right, bottom: c.bottom, top: c.top }, threadRight: th.right, compW: document.querySelector('.compose-row').getBoundingClientRect().width }; }); };
      const at900 = await lay(900), at899 = await lay(899);
      ok('[desktop] at 900 px the side column sits beside her stage (300 to 440 px)', at900.sideLeft >= at900.threadRight && at900.sideTop < at900.comp.top && at900.sideW >= 300 && at900.sideW <= 440, JSON.stringify(at900));
      ok('[desktop] at 899 px it wraps under the stage (the phone stack)', at899.sideTop >= at899.comp.bottom - 1 && at899.sideLeft < at899.threadRight, JSON.stringify(at899));
      const at1280 = await lay(1280);
      ok('[desktop] captions and composer at most 660 px', at1280.compW <= 660 && at1280.sideW >= 300 && at1280.sideW <= 440, JSON.stringify(at1280));
      await page.setViewportSize({ width: 899, height: 860 }); await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/captions-wrap-899.png` });
      await page.setViewportSize({ width: 900, height: 860 }); await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/captions-wrap-900.png` });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`[${scheme}] no sideways scroll`, !overflow);
    ok(`[${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // Reduced motion, at both widths: the line whole at once, announced once, her core still, its gesture still raised.
  for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage(); await openPage(page); await page.waitForTimeout(1500);
    await send(page, 'explain preload', REPLY); await page.waitForTimeout(1200); // past the send and settle brightness changes
    const r = await page.evaluate(() => { const b = document.querySelector('#thread .msg.ev.current .bubble'); const ws = [...b.querySelectorAll('.w')]; return { n: ws.length, hidden: ws.filter(w => getComputedStyle(w).opacity !== '1').length, reveal: b.classList.contains('reveal') }; });
    const h1 = await page.evaluate(() => window.EVApp.core.sample(0).hash); await page.waitForTimeout(600); const h2 = await page.evaluate(() => window.EVApp.core.sample(0).hash);
    const said = await page.evaluate(() => [...document.querySelectorAll('#ev-say p')].map(p => p.textContent));
    const g1 = await page.evaluate(() => window.EVApp.core.stats().log.filter(e => e.kind === 'gesture').map(e => e.name));
    ok(`[reduced motion ${label}] her line shows whole at once`, r.n === 14 && r.hidden === 0 && !r.reveal, JSON.stringify(r));
    ok(`[reduced motion ${label}] announced once`, said.filter(x => x.includes('Preload is the stretch')).length === 1, JSON.stringify(said));
    ok(`[reduced motion ${label}] her core holds still`, h1 === h2);
    ok(`[reduced motion ${label}] the reply still ends with its gesture (settle)`, g1.slice(-1)[0] === 'settle', JSON.stringify(g1));
    // An error reply still recoils, a short brightness change under reduced motion.
    await page.evaluate(() => { window.__chatFail = 'upstream_error'; }); await send(page, 'and afterload', 'x'); await page.waitForTimeout(800);
    const g2 = await page.evaluate(() => window.EVApp.core.stats().log.filter(e => e.kind === 'gesture').map(e => e.name));
    ok(`[reduced motion ${label}] an error reply raises the error gesture`, g2.slice(-1)[0] === 'error', JSON.stringify(g2));
    await page.screenshot({ path: `${shots}/captions-reduced-${label}.png` });
    await ctx.close();
  }
  await browser.close();
  // The measured layout against the Captions v2 artboards (V2.dc.html, V2Desktop.dc.html in E.V. Home: Captions).
  console.log('against the artboards:', JSON.stringify({ artboards: art, measured, rendered: artDir ? Object.fromEntries(Object.entries(rendered).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([s, x]) => [s, x.vs || x]))])) : 'not rendered (no --artboards)' }));
  for (const [s, n, d] of results) console.log(s, n, d);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? `${failed} FAILED of ${results.length} checks` : `ALL PASSED: ${results.length} checks`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('CRASHED', e.message); process.exit(1); });
