// The Captions harness (B-77; D-122, D-127, D-128 gap rule): the built staging page's E.V. tab at 390 and 1280 px on
// a staging export with a planted day of talk (two earlier conversations today, one last night), the page's clock at
// 7pm Central so the greeting opens a new conversation. Checks: the greeting opens alone at her full size; a reply
// reveals word by word, each sentence announced once; Matt's echo; Back to now on scroll and on tapping her; a pull
// loads the previous conversation with its count and stops at the start of today; the layout wraps at 1023 px and not
// at 1024 (D-159); reduced motion shows the line whole. Screenshots of each state at both widths, and the measured layout set
// against the Captions v2 artboards' numbers.
// With --artboards <dir> it also renders the Captions v2 artboards themselves, offline, beside the page: <dir> holds the
// Design artifact's project/V2.dc.html, project/V2Desktop.dc.html, project/Core2.dc.html and
// artifact-type/dc-runtime.js (Artifact read of E.V. Home: Captions; never committed here), served as ./support.js.
// Each width's open and conversation states are measured on both and saved side by side.
//   node test/harness/captions.cjs [record dir | synthetic] [screenshots dir] [--artboards <dir>]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const argv = process.argv.slice(2);
const artAt = argv.indexOf('--artboards');
const artDir = artAt >= 0 ? argv.splice(artAt, 2)[1] : null;
const [dbArg, shotsArg] = argv;
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
const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8'));
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const fmt = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
const today = fmt(new Date()),
  yesterday = fmt(new Date(Date.now() - 864e5));
// Central times on a date (CDT, UTC-5, in October).
const ct = (date, hh, mm) => new Date(Date.parse(date + 'T00:00:00Z') + (hh + 5) * 3600e3 + mm * 60e3);
const NOW = ct(today, 19, 0);
const mid = (d, who) =>
  'm-' + d.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '').replace('Z', '') + '-' + who;
const talkDoc = (date, msgs) => ({
  schema: 1,
  writer: 'page',
  at: msgs[0][0].toISOString(),
  source: 'E.V. Home',
  date,
  messages: Object.fromEntries(
    msgs.map(([d, role, text]) => [
      mid(d, role === 'matt' ? 'matt' : 'ev'),
      { role, text, at: d.toISOString(), ...(role === 'ev' ? { tier: 'local', cards: [] } : {}) },
    ])
  ),
});
// The planted day: last night (2 messages), this morning (3), noon (4); now is 7pm, so the greeting starts a new one.
const NIGHT = [
  [ct(yesterday, 20, 0), 'matt', 'harness night: what is on tomorrow'],
  [ct(yesterday, 20, 1), 'ev', 'Harness night line. Sleep well.'],
];
const MORNING = [
  [ct(today, 9, 0), 'matt', 'harness morning: what is on tonight'],
  [ct(today, 9, 1), 'ev', 'Harness morning line. Six review questions tonight.'],
  [ct(today, 9, 3), 'matt', 'harness morning: ok'],
];
const NOON = [
  [ct(today, 12, 0), 'matt', 'harness noon: explain afterload'],
  [ct(today, 12, 1), 'ev', 'Harness noon line. Afterload is the push back.'],
  [ct(today, 12, 5), 'matt', 'harness noon: and preload'],
  [ct(today, 12, 6), 'ev', 'Harness noon line two. Preload is the stretch.'],
];
// Two days ago (D-128 as amended: a pull past today goes on, under a date divider) and nine days ago, outside the talk
// read window (never loaded: That's everything from the last 7 days). Every other day of talk is taken out.
const dayBefore = (d, n) => fmt(new Date(Date.parse(d + 'T12:00:00Z') - n * 864e5));
const twoAgo = dayBefore(today, 2),
  nineAgo = dayBefore(today, 9);
const TWO = [
  [ct(twoAgo, 18, 0), 'matt', 'harness two days ago: quiz me'],
  [ct(twoAgo, 18, 1), 'ev', 'Harness two days ago line. Three questions.'],
  [ct(twoAgo, 18, 4), 'matt', 'harness two days ago: done'],
];
const NINE = [
  [ct(nineAgo, 18, 0), 'matt', 'harness nine days ago: hello'],
  [ct(nineAgo, 18, 1), 'ev', 'Harness nine days ago line.'],
];
seed.talk = Object.fromEntries(Object.entries(seed.talk || {}).filter(([k]) => !/^\d{4}-\d{2}-\d{2}$/.test(k)));
seed.talk[yesterday] = talkDoc(yesterday, NIGHT);
seed.talk[today] = talkDoc(today, [...MORNING, ...NOON]);
seed.talk[twoAgo] = talkDoc(twoAgo, TWO);
seed.talk[nineAgo] = talkDoc(nineAgo, NINE);
const dayLabel = d =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
// Enough dates in the next two weeks that the dates card is long (five rows and its more line).
seed.dates = seed.dates || {};
for (let i = 1; i <= 9; i++) {
  const d = dayBefore(today, -i);
  seed.dates['harness-' + i] = {
    schema: 1,
    writer: 'page',
    at: new Date().toISOString(),
    source: 'owner',
    addedAt: new Date().toISOString(),
    date: d,
    title: 'Harness date ' + i + ': a long enough title to wrap on a phone',
    kind: 'due',
    course: 'NUR 112',
    graded: false,
  };
}
for (const c of ['sessions', 'workouts'])
  for (const [id, d] of Object.entries(seed[c] || {}))
    if ((d.date || (d.startedAt && fmt(new Date(d.startedAt)))) === today) delete seed[c][id];
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const skeleton = b =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  b +
  '</body></html>';
async function openPage(page, db = seed) {
  await page.clock.install({ time: NOW });
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
  await page.addInitScript('window.__db=' + JSON.stringify(db) + ';' + stub);
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => document.querySelector('#thread .msg.greet'), null, { timeout: 15000 });
}
const results = [];
const ok = (name, cond, detail = '') => {
  results.push([cond ? 'PASS' : 'FAIL', name, detail]);
};
const view = page =>
  page.evaluate(() => {
    const t = document.getElementById('thread'),
      lines = [...t.querySelectorAll('.msg')].filter(m => getComputedStyle(m).display !== 'none');
    const now = t.querySelector('.msg.ev.current .bubble'),
      past = t.querySelector('.msg.ev:not(.current) .bubble'),
      hero = document.getElementById('hero'),
      av = hero.querySelector('.ev-av');
    const cs = x => (x ? getComputedStyle(x) : null);
    return {
      texts: lines.map(
        m =>
          (m.classList.contains('earlier') ? 'E:' : '') +
          (m.classList.contains('matt') ? 'M:' : 'V:') +
          m.querySelector('.bubble')?.textContent.slice(0, 60)
      ),
      greetOnly: lines.length === 1 && lines[0].classList.contains('greet') && lines[0].classList.contains('current'),
      step: hero.dataset.step,
      corePx: Math.round(av.getBoundingClientRect().width),
      stageH: Math.round(hero.getBoundingClientRect().height),
      coreX: Math.round(av.getBoundingClientRect().x + av.getBoundingClientRect().width / 2),
      coreY: Math.round(av.getBoundingClientRect().y),
      lineY: now ? Math.round(now.getBoundingClientRect().y) : null,
      composerW: Math.round(document.querySelector('.compose-row').getBoundingClientRect().width),
      composerY: Math.round(document.querySelector('.compose-row').getBoundingClientRect().y),
      nowSize: cs(now) && cs(now).fontSize,
      pastSize: cs(past) && cs(past).fontSize,
      pastOpacity: cs(past) && cs(past).opacity,
      say: [...document.querySelectorAll('#ev-say p')].map(p => p.textContent),
      sayLive: document.getElementById('ev-say').getAttribute('aria-live'),
      threadLive: t.getAttribute('aria-live'),
      pull: document.querySelector('.cap-pull .lbl').textContent,
      now: !document.getElementById('ev-now').hidden,
      scrollTop: t.scrollTop,
      maxScroll: t.scrollHeight - t.clientHeight,
      bubbles: lines.some(m => {
        const b = m.querySelector('.bubble');
        return b && (cs(b).backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs(b).paddingLeft) > 0);
      }),
    };
  });
async function send(page, text, reply) {
  await page.evaluate(r => {
    window.__chatScript = [];
    window.__chatPre = '';
    window.__chatReply = r;
  }, reply);
  await page.fill('#ev-input', text);
  await page.click('#ev-send');
}
// Now is the bottom, or, when her current line is taller than the captions, its start pinned at the top (pinNow).
const atNow = page =>
  page.evaluate(() => {
    const t = document.getElementById('thread'),
      cur = t.querySelector('.msg.ev.current'),
      tr = t.getBoundingClientRect(),
      cr = cur && cur.getBoundingClientRect();
    return (
      t.scrollHeight - t.clientHeight - t.scrollTop < 4 ||
      (!!cr && cr.height > t.clientHeight - 16 && Math.abs(cr.top - tr.top - 8) < 4)
    );
  });
async function pullOnce(page) {
  await page.evaluate(() => {
    const t = document.getElementById('thread');
    t.scrollTop = 0;
    t.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(450);
}
// A full pull after an edge: away from the top first (the next pull starts over), then up and hold.
async function pullAgain(page) {
  await page.evaluate(() => {
    const t = document.getElementById('thread');
    t.scrollTop = Math.min(220, t.scrollHeight - t.clientHeight);
    t.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(120);
  await pullOnce(page);
}
// When each word of her current line came on (D-137), from a MutationObserver started before the reply.
const watchReveal = page =>
  page.evaluate(() => {
    window.__rv = [];
    const t0 = Date.now();
    const mo = new MutationObserver(ms => {
      for (const m of ms)
        if (
          m.target.classList &&
          m.target.classList.contains('w') &&
          m.target.classList.contains('on') &&
          !m.target.__seen
        ) {
          m.target.__seen = 1;
          window.__rv.push([Date.now() - t0, m.target.textContent]);
        }
    });
    mo.observe(document.getElementById('thread'), { subtree: true, attributes: true, attributeFilter: ['class'] });
    window.__rvStop = () => {
      mo.disconnect();
      return { t0 };
    };
  });
// The artboards themselves (--artboards): the design runtime renders each offline. Its scenario opens at her full
// size and moves to the talk phase on its own, so each state is caught by the width of her canvas.
const ART_MEASURE = () => {
  const vis = e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const cv = [...document.querySelectorAll('canvas')]
    .filter(vis)
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  const texts = [...document.querySelectorAll('body *')].filter(
    e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 3)
  );
  const line = texts
    .map(e => e.closest('p, div'))
    .filter(Boolean)
    .sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0];
  const r = cv && cv.getBoundingClientRect(),
    lr = line && line.getBoundingClientRect(),
    ta = document.querySelector('textarea'),
    cr = ta && ta.parentElement.getBoundingClientRect();
  return {
    corePx: r && Math.round(r.width),
    coreX: r && Math.round(r.x + r.width / 2),
    coreY: r && Math.round(r.y),
    lineFs: line && getComputedStyle(line).fontSize,
    lineY: lr && Math.round(lr.y),
    composerW: cr && Math.round(cr.width),
    composerY: cr && Math.round(cr.y),
  };
};
async function artboard(browser, scheme) {
  const [file, vp, base] =
    scheme === 'phone'
      ? ['V2.dc.html', { width: 390, height: 844 }, 260]
      : ['V2Desktop.dc.html', { width: 1280, height: 860 }, 340];
  const ctx = await browser.newContext({ viewport: vp, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.hostname !== 'art.local') return r.fulfill({ status: 404, body: '' });
    const n = u.pathname.slice(1),
      f = n === 'support.js' ? path.join(artDir, 'artifact-type/dc-runtime.js') : path.join(artDir, 'project', n);
    return fs.existsSync(f)
      ? r.fulfill({ body: fs.readFileSync(f), contentType: n.endsWith('.js') ? 'text/javascript' : 'text/html' })
      : r.fulfill({ status: 404, body: '' });
  });
  await p.goto('http://art.local/' + file);
  const out = {};
  for (const [state, px] of [
    ['open', base],
    ['conversation', Math.round(base * 0.8)],
  ]) {
    const hit = await p
      .waitForFunction(
        px => [...document.querySelectorAll('canvas')].some(c => Math.round(c.getBoundingClientRect().width) === px),
        px,
        { timeout: 25000 }
      )
      .then(
        () => true,
        () => false
      );
    await p.waitForTimeout(state === 'open' ? 250 : 2500);
    out[state] = { ...(await p.evaluate(ART_MEASURE)), caught: hit, png: `${shots}/artboard-${state}-${scheme}.png` };
    await p.screenshot({ path: out[state].png });
  }
  await ctx.close();
  return out;
}
async function sideBySide(browser, left, right, out, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width * 2 + 24, height: vp.height + 28 } });
  const p = await ctx.newPage();
  const b64 = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  await p.setContent(
    `<body style="margin:0;background:#2a2f36;font:12px sans-serif;color:#ccc"><div style="display:flex;gap:24px"><div>artboard (Captions v2)<br><img src="${b64(left)}" width="${vp.width}"></div><div>staging build<br><img src="${b64(right)}" width="${vp.width}"></div></div></body>`
  );
  await p.screenshot({ path: out });
  await ctx.close();
}

(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  const REPLY = 'Preload is the **stretch** before the squeeze. More filling, more stretch, a stronger contraction.';
  const S1 = 'Preload is the stretch before the squeeze.',
    S2 = 'More filling, more stretch, a stronger contraction.';
  // The artboards' numbers, read from their source (E.V. Home: Captions, V2.dc.html and V2Desktop.dc.html: the core's
  // size and scale, stageH, evStyle, mattStyle); D-122 as amended takes the desktop artboard's 16 px for earlier lines.
  const art = {
    phone: { core: 260, stage: 300, convCore: 208, convStage: 232, now: '20px', past: '15px', matt: '13px' },
    desktop: { core: 340, stage: 370, convCore: 272, convStage: 290, now: '24px', past: '16px', matt: '14px' },
  };
  const measured = {},
    rendered = {};
  // Our page and the artboard in one state, side by side, with the numbers that can be compared: her core's size, its
  // centre and top, her line's size and top, and the composer's width on desktop.
  const against = async (scheme, state, ours, oursPng, vp) => {
    const a = rendered[scheme] && rendered[scheme][state];
    if (!a) return;
    const out = `${shots}/against-artboard-${state}-${scheme}.png`;
    await sideBySide(browser, a.png, oursPng, out, vp);
    const d = {
      corePx: [a.corePx, ours.corePx],
      coreX: [a.coreX, ours.coreX],
      coreY: [a.coreY, ours.coreY],
      lineFs: [a.lineFs, ours.nowSize],
      lineY: [a.lineY, ours.lineY],
      composerW: [a.composerW, ours.composerW],
    };
    rendered[scheme][state].vs = d;
    // Checked: her core's size in both states, and her line's size once she is talking (on opening the artboard's
    // greeting is still typing), and her core's centre (D-122 as amended: no side column while nothing is in it).
    // Reported, not checked: vertical positions, which depend on the header and the reply's length.
    ok(
      `[${scheme}] against the rendered artboard, ${state}: her core ${a.corePx} px, centred at ${a.coreX}` +
        (state === 'open' ? '' : `, her line ${a.lineFs}`),
      a.caught &&
        Math.abs(a.corePx - ours.corePx) <= 1 &&
        Math.abs(a.coreX - ours.coreX) <= 2 &&
        (state === 'open' || a.lineFs === ours.nowSize),
      JSON.stringify(d)
    );
    console.log(
      `DIFF [${scheme}] ${state}, artboard vs build:`,
      JSON.stringify({ coreX: d.coreX, coreY: d.coreY, lineY: d.lineY, composerW: d.composerW })
    );
  };
  for (const scheme of ['phone', 'desktop']) {
    const ctx = await browser.newContext({
      viewport: scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 },
      colorScheme: 'dark',
    });
    if (artDir) rendered[scheme] = await artboard(browser, scheme);
    const VP = scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 };
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await openPage(page);
    await page.waitForTimeout(400);
    let v = await view(page);
    const A = art[scheme];
    ok(`[${scheme}] a new conversation opens on the greeting alone`, v.greetOnly, JSON.stringify(v.texts));
    const gc = await page.evaluate(() => ({
      cards: document.querySelectorAll('#thread .msg.greet .ev-card').length,
      chips: [...document.querySelectorAll('#qchips .qchip')].map(c => c.textContent),
    }));
    ok(
      `[${scheme}] the greeting has no card; its offers are the chips, at most three, Start a study session last`,
      gc.cards === 0 &&
        gc.chips.length === 3 &&
        gc.chips[2] === 'Start a study session' &&
        !gc.chips.includes('File it'),
      JSON.stringify(gc)
    );
    ok(
      `[${scheme}] opening: her core at 100% (${A.core} px) on a ${A.stage} px stage, no bubbles`,
      v.step === 'idle' && v.corePx === A.core && v.stageH === A.stage && !v.bubbles,
      JSON.stringify({ step: v.step, px: v.corePx, stage: v.stageH })
    );
    ok(
      `[${scheme}] the captions are the screen reader's polite live region, the scroller is not`,
      v.sayLive === 'polite' && !v.threadLive
    );
    await page.waitForTimeout(9000); // the greeting reveals and settles
    v = await view(page);
    measured[scheme] = { open: { core: v.corePx, stage: v.stageH, now: v.nowSize } };
    await page.screenshot({ path: `${shots}/captions-open-${scheme}.png` });
    await against(scheme, 'open', v, `${shots}/captions-open-${scheme}.png`, VP);
    // A reply, word by word, each sentence announced once.
    const said0 = (await view(page)).say.length;
    await send(page, 'explain preload', REPLY);
    await page.waitForTimeout(250);
    const echo = await page.evaluate(() => {
      const e = document.getElementById('ev-echo');
      return { on: e.classList.contains('on'), text: e.textContent };
    });
    ok(
      `[${scheme}] his line echoes above the composer`,
      echo.on && echo.text === 'You · explain preload',
      JSON.stringify(echo)
    );
    const seen = [];
    for (let i = 0; i < 8; i++) {
      seen.push(
        await page.evaluate(() => {
          const b = document.querySelector('#thread .msg.ev.current .bubble');
          return b ? [b.querySelectorAll('.w.on').length, b.querySelectorAll('.w').length] : [0, 0];
        })
      );
      await page.waitForTimeout(260);
    }
    const total = seen[seen.length - 1][1];
    ok(
      `[${scheme}] the reply reveals word by word`,
      total === 14 && seen.some(([n]) => n > 0 && n < total) && seen.every(([n], i) => !i || n >= seen[i - 1][0]),
      JSON.stringify(seen)
    );
    await page.screenshot({ path: `${shots}/captions-reveal-${scheme}.png` });
    await page.waitForTimeout(4500);
    v = await view(page);
    const said = v.say; // the region keeps its last six lines; counted by content
    ok(
      `[${scheme}] each finished sentence is announced once, and his echo once`,
      said.filter(x => x === S1).length === 1 &&
        said.filter(x => x === S2).length === 1 &&
        said.filter(x => x === 'You: explain preload').length === 1,
      JSON.stringify(said)
    );
    const done = await page.evaluate(() => {
      const b = document.querySelector('#thread .msg.ev.current .bubble');
      const em = b.querySelector('b .w');
      const log = window.EVApp.core.stats().log;
      return {
        all: b.querySelectorAll('.w.on').length === b.querySelectorAll('.w').length,
        teal: em && getComputedStyle(em).color,
        speaks: log.filter(e => e.kind === 'speak').length,
        emph: log.filter(e => e.kind === 'speak' && e.detail === 'emphasis').map(e => e.name),
        settled: log.filter(e => e.kind === 'gesture').slice(-1)[0],
      };
    });
    ok(
      `[${scheme}] her core spoke each word, emphasis in teal, and settled`,
      done.all &&
        done.teal === 'rgb(127, 240, 220)' &&
        done.speaks >= 14 &&
        done.emph.includes('stretch') &&
        done.settled &&
        done.settled.name === 'settle',
      JSON.stringify(done)
    );
    const echoOff = await page.evaluate(() => !document.getElementById('ev-echo').classList.contains('on'));
    ok(
      `[${scheme}] the echo fades after about 3 s; his line is not a bubble in the captions`,
      echoOff && !v.texts.some(t => /^M:explain preload/.test(t)),
      JSON.stringify(v.texts)
    );
    ok(
      `[${scheme}] in conversation: core at 80% on a ${A.convStage} px stage, her line ${A.now}, earlier ${A.past} at 60%`,
      v.step === 'conversation' &&
        Math.abs(v.corePx - A.convCore) <= 1 &&
        v.stageH === A.convStage &&
        v.nowSize === A.now &&
        v.pastSize === A.past &&
        Math.abs(parseFloat(v.pastOpacity) - 0.6) < 0.01,
      JSON.stringify({ step: v.step, px: v.corePx, now: v.nowSize, past: v.pastSize, o: v.pastOpacity })
    );
    measured[scheme].conversation = {
      core: v.corePx,
      stage: v.stageH,
      now: v.nowSize,
      past: v.pastSize,
      pastOpacity: v.pastOpacity,
    };
    await page.screenshot({ path: `${shots}/captions-conversation-${scheme}.png` });
    await against(scheme, 'conversation', v, `${shots}/captions-conversation-${scheme}.png`, VP);
    // D-137: the first sentence at speech pace, then faster, the whole reply out within 6 s, her speech ending with the
    // last word; a tap on her line or a scroll shows the rest at once.
    const LONG =
      'Afterload is the pressure the ventricle has to push against to open the valve. Think of it as the door the heart pushes on. ' +
      'When the arteries are stiff or narrow, that door is heavier, so the heart works harder for the same output. High blood pressure raises it, and so does aortic stenosis. ' +
      'Drugs that relax the arteries lower it, which is why they help a failing heart. On the exam, link afterload to the left ventricle and to systemic resistance, and preload to filling.';
    await watchReveal(page);
    await send(page, 'and afterload', LONG);
    await page.waitForTimeout(7500);
    const rv = await page.evaluate(() => {
      const t = window.__rvStop();
      const log = window.EVApp.core.stats().log;
      const end = log.filter(e => e.kind === 'speechEnd').slice(-1)[0];
      return {
        words: window.__rv,
        end: end ? end.at - t.t0 : null,
        total: document.querySelectorAll('#thread .msg.ev.current .bubble .w').length,
      };
    });
    const W = rv.words,
      k1 = W.findIndex(([, w]) => /\.$/.test(w)) + 1,
      firstMs = k1 > 1 ? W[k1 - 1][0] - W[0][0] : 0,
      allMs = W.length ? W[W.length - 1][0] - W[0][0] : 0,
      rate1 = k1 > 1 ? (k1 - 1) / (firstMs / 1000) : null;
    const pace = {
      words: W.length,
      total: rv.total,
      firstSentence: k1,
      firstSentenceMs: firstMs,
      wordsPerSecFirst: rate1 && +rate1.toFixed(2),
      allMs,
      speechEndAfterLastMs: rv.end != null && W.length ? rv.end - W[W.length - 1][0] : null,
    };
    ok(
      `[${scheme}] D-137: the first sentence at speech pace (about 3 words a second)`,
      W.length === rv.total && rate1 >= 2.2 && rate1 <= 4,
      JSON.stringify(pace)
    );
    ok(
      `[${scheme}] D-137: then faster, the whole reply out within 6 s`,
      allMs <= 6000 + 250 && allMs > firstMs,
      JSON.stringify(pace)
    );
    ok(
      `[${scheme}] D-137: her speech ends with the last word`,
      pace.speechEndAfterLastMs != null && pace.speechEndAfterLastMs >= 0 && pace.speechEndAfterLastMs <= 300,
      JSON.stringify(pace)
    );
    measured[scheme].pace = pace;
    for (const [how, act] of [
      ['a tap on her line', () => page.click('#thread .msg.ev.current .bubble')],
      [
        'a scroll',
        async () => {
          const b = await page.locator('#thread').boundingBox();
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          await page.mouse.wheel(0, -60);
        },
      ],
    ]) {
      await send(page, 'again', LONG);
      await page.waitForTimeout(900);
      const before = await page.evaluate(() => {
        const b = document.querySelector('#thread .msg.ev.current .bubble');
        return [b.querySelectorAll('.w.on').length, b.querySelectorAll('.w').length];
      });
      await act();
      await page.waitForTimeout(150);
      const after = await page.evaluate(() => {
        const b = document.querySelector('#thread .msg.ev.current .bubble');
        return [b.querySelectorAll('.w.on').length, b.querySelectorAll('.w').length];
      });
      ok(
        `[${scheme}] D-137: ${how} shows the rest of the reply at once`,
        before[0] < before[1] && after[0] === after[1],
        JSON.stringify({ before, after })
      );
      await page.waitForTimeout(600);
    }
    // Back to now: scrolling away shows the pill; tapping her returns.
    await page.evaluate(() => {
      const t = document.getElementById('thread');
      t.scrollTop = Math.max(170, t.scrollHeight - t.clientHeight - 600);
      t.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(200);
    v = await view(page);
    ok(`[${scheme}] scrolling away shows Back to now`, v.now, JSON.stringify({ top: v.scrollTop, max: v.maxScroll }));
    await page.screenshot({ path: `${shots}/captions-back-to-now-${scheme}.png` });
    await page.click('#hero');
    await page.waitForTimeout(900);
    v = await view(page);
    ok(
      `[${scheme}] tapping her returns to now`,
      !v.now && (await atNow(page)),
      JSON.stringify({ top: v.scrollTop, max: v.maxScroll })
    );
    // Pull to load: noon (4), then this morning (3), then the start of today; last night is never loaded.
    await pullOnce(page);
    v = await view(page);
    ok(
      `[${scheme}] a pull says it is loading the noon conversation's 4 messages`,
      v.pull === 'Loading 4 earlier messages',
      v.pull
    );
    await page.screenshot({ path: `${shots}/captions-pull-${scheme}.png` });
    await page.waitForTimeout(1000);
    v = await view(page);
    const earlier = v.texts.filter(t => t.startsWith('E:'));
    ok(
      `[${scheme}] the noon conversation is back above, with his lines small`,
      earlier.length === 4 &&
        earlier.some(t => /Harness noon line two/.test(t)) &&
        earlier.some(t => /^E:M:harness noon: explain afterload/.test(t)) &&
        !v.texts.some(t => /morning/.test(t)),
      JSON.stringify(earlier)
    );
    await pullOnce(page);
    v = await view(page);
    ok(`[${scheme}] the next pull loads this morning's 3`, v.pull === 'Loading 3 earlier messages', v.pull);
    await page.waitForTimeout(1000);
    v = await view(page);
    ok(
      `[${scheme}] this morning is back too`,
      v.texts.filter(t => t.startsWith('E:')).length === 7 && v.texts.some(t => /Harness morning line/.test(t))
    );
    const mattPx = await page.evaluate(() => {
      const m = [...document.querySelectorAll('#thread .msg.matt')].find(x => getComputedStyle(x).display !== 'none');
      return m ? getComputedStyle(m.querySelector('.bubble')).fontSize : null;
    });
    ok(`[${scheme}] his earlier lines are ${A.matt}, grey`, mattPx === A.matt, String(mattPx));
    await pullOnce(page);
    await page.waitForTimeout(1000);
    v = await view(page);
    ok(
      `[${scheme}] then: That's the start of today, and last night stays out`,
      v.pull === 'That’s the start of today' && !v.texts.some(t => /harness night|Harness night/.test(t)),
      JSON.stringify({ pull: v.pull, n: v.texts.length })
    );
    await page.screenshot({ path: `${shots}/captions-start-of-today-${scheme}.png` });
    // D-128 as amended: the next full pull goes on into earlier days, one conversation at a time under a date divider,
    // and stops at the read window's edge.
    const divs = () => page.evaluate(() => [...document.querySelectorAll('#thread .cap-day')].map(d => d.textContent));
    await pullAgain(page);
    v = await view(page);
    ok(
      `[${scheme}] past today, the next full pull loads last night's 2`,
      v.pull === 'Loading 2 earlier messages',
      v.pull
    );
    await page.waitForTimeout(1000);
    v = await view(page);
    let dv = await divs();
    ok(
      `[${scheme}] last night comes back under Yesterday, today's under Today`,
      v.texts.some(t => /Harness night line/.test(t)) && dv.join() === 'Yesterday,Today',
      JSON.stringify(dv)
    );
    await pullAgain(page);
    v = await view(page);
    ok(`[${scheme}] then the conversation two days ago, its 3`, v.pull === 'Loading 3 earlier messages', v.pull);
    await page.waitForTimeout(1000);
    v = await view(page);
    dv = await divs();
    ok(
      `[${scheme}] under its own date (${dayLabel(twoAgo)})`,
      v.texts.some(t => /Harness two days ago line/.test(t)) &&
        dv.join() === [dayLabel(twoAgo), 'Yesterday', 'Today'].join(),
      JSON.stringify(dv)
    );
    await pullAgain(page);
    await page.waitForTimeout(1000);
    v = await view(page);
    ok(
      `[${scheme}] then: That's everything from the last 7 days, and nine days ago stays out`,
      v.pull === 'That’s everything from the last 7 days' && !v.texts.some(t => /nine days ago/.test(t)),
      JSON.stringify({ pull: v.pull })
    );
    await page.evaluate(() => {
      document.getElementById('thread').scrollTop = 0;
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/captions-last-7-days-${scheme}.png` });
    const pillShown = await page.isVisible('#ev-now');
    await page.click('#ev-now');
    await page.waitForTimeout(900);
    v = await view(page);
    ok(
      `[${scheme}] tapping the Back to now pill folds the earlier conversations away`,
      pillShown && !v.texts.some(t => t.startsWith('E:')) && !v.now && (await atNow(page)),
      JSON.stringify({
        pillShown,
        earlier: v.texts.filter(t => t.startsWith('E:')).length,
        pill: v.now,
        top: v.scrollTop,
        max: v.maxScroll,
        atNow: await atNow(page),
        pin: await page.evaluate(() => {
          const t = document.getElementById('thread'),
            c = t.querySelector('.msg.ev.current');
          return c
            ? [
                Math.round(c.getBoundingClientRect().top - t.getBoundingClientRect().top),
                Math.round(c.getBoundingClientRect().height),
                t.clientHeight,
              ]
            : null;
        }),
      })
    );
    // B-85 (D-125 as amended): a card that only informs is one tappable line that opens its tab; of the cards he acts in,
    // the first shows under her line (never scrolling inside itself) and the rest are one tappable line that swaps the
    // next one in. A whole card steps her down to the list size; lines alone keep her conversation size.
    await page.evaluate(() => {
      window.__chatScript = [
        { tool: 'show_card', input: { type: 'dates', days: 14 } },
        { tool: 'show_card', input: { type: 'quizlet' } },
        { tool: 'show_card', input: { type: 'review' } },
      ];
      window.__chatPre = '';
      window.__chatReply = 'Here is the next two weeks. Nine things are dated.';
    });
    await page.fill('#ev-input', 'what is coming up');
    await page.click('#ev-send');
    await page.waitForTimeout(4500);
    const cardView = () =>
      page.evaluate(() => {
        const t = document.getElementById('thread').getBoundingClientRect(),
          hero = document.getElementById('hero'),
          cur = document.querySelector('#thread .msg.ev.current'),
          b = cur.querySelector('.bubble').getBoundingClientRect(),
          card = cur.querySelector('.ev-card'),
          cr = card && card.getBoundingClientRect();
        return {
          step: hero.dataset.step,
          stage: Math.round(hero.getBoundingClientRect().height),
          cards: cur.querySelectorAll('.ev-card').length,
          lines: [...cur.querySelectorAll('.card-line .cl-t')].map(x => x.textContent),
          lineH: [...cur.querySelectorAll('.card-line')].map(x => Math.round(x.getBoundingClientRect().height)),
          title: card && (card.querySelector('h2') || {}).textContent,
          more: (cur.querySelector('.cap-cards-more') || {}).textContent,
          line: [Math.round(b.top), Math.round(b.bottom)],
          card: cr && [Math.round(cr.top), Math.round(cr.bottom)],
          scrollsInside: card ? card.scrollHeight > card.clientHeight + 1 : null,
          thread: [Math.round(t.top), Math.round(t.bottom)],
        };
      });
    const lc = await cardView();
    const listStage = scheme === 'phone' ? 150 : 260;
    ok(
      `[${scheme}] a reply with a whole card: her core steps down (the ${scheme === 'phone' ? '52%' : 'surface'} step, a ${listStage} px stage)`,
      lc.step === (scheme === 'phone' ? 'list' : 'surface') && lc.stage === listStage,
      JSON.stringify(lc)
    );
    ok(
      `[${scheme}] the dates card is one line naming its count; the Quizlet card shows whole under her line, then "1 more card"`,
      lc.lines.length === 1 &&
        /^\d+ dates? in the next two weeks$/.test(lc.lines[0]) &&
        lc.lineH[0] <= 48 &&
        lc.cards === 1 &&
        /Quizlet/.test(lc.title || '') &&
        lc.more === '1 more card',
      JSON.stringify(lc)
    );
    ok(`[${scheme}] the card never scrolls inside itself`, lc.scrollsInside === false, JSON.stringify(lc));
    ok(
      `[${scheme}] her line stays in view`,
      lc.line[0] >= lc.thread[0] - 1 && lc.line[1] <= lc.thread[1] + 1,
      JSON.stringify(lc)
    );
    await page.screenshot({ path: `${shots}/captions-long-card-${scheme}.png` });
    // D-122 as amended: now is the latest reply as a whole. Her stage stays put; scrolling down through the card shows no
    // Back to now; above her line it shows; tapping her returns to the pinned spot.
    const thru = await page.evaluate(async () => {
      const t = document.getElementById('thread'),
        h = document.getElementById('hero'),
        h0 = Math.round(h.getBoundingClientRect().top);
      const seen = [];
      const max = t.scrollHeight - t.clientHeight;
      for (let y = t.scrollTop; y <= max + 1; y += 60) {
        t.scrollTop = Math.min(y, max);
        t.dispatchEvent(new Event('scroll'));
        await new Promise(r => setTimeout(r, 40));
        seen.push(!document.getElementById('ev-now').hidden);
      }
      return {
        steps: seen.length,
        pill: seen.some(Boolean),
        stageMoved: Math.round(h.getBoundingClientRect().top) !== h0,
        step: h.dataset.step,
      };
    });
    ok(
      `[${scheme}] scrolling down through the card is still now: no Back to now, and her stage stays put`,
      thru.steps > 1 && !thru.pill && !thru.stageMoved && thru.step === lc.step,
      JSON.stringify(thru)
    );
    await page.evaluate(() => {
      const t = document.getElementById('thread'),
        c = t.querySelector('.msg.ev.current');
      t.scrollTop = Math.max(170, t.scrollTop + c.getBoundingClientRect().top - t.getBoundingClientRect().top - 260);
      t.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(200);
    const above = await page.evaluate(() => !document.getElementById('ev-now').hidden);
    ok(`[${scheme}] above her latest line, Back to now shows`, above);
    await page.screenshot({ path: `${shots}/captions-above-line-${scheme}.png` });
    await page.click('#hero');
    await page.waitForTimeout(900);
    const back = await page.evaluate(() => !document.getElementById('ev-now').hidden);
    ok(
      `[${scheme}] tapping her returns to the pinned spot`,
      !back && (await atNow(page)),
      JSON.stringify({ pill: back })
    );
    const seenCards = [lc.title];
    for (let k = 0; k < 2; k++) {
      await page.click('#thread .msg.ev.current .cap-cards-more');
      await page.waitForTimeout(300);
      const x = await cardView();
      seenCards.push(x.title);
      if (k === 0)
        ok(
          `[${scheme}] tapping "1 more card" swaps the next whole card in, the line card staying put`,
          x.cards === 1 &&
            x.title !== lc.title &&
            /Today.s review/.test(x.title || '') &&
            x.more === '1 more card' &&
            x.lines.join() === lc.lines.join(),
          JSON.stringify(x)
        );
    }
    ok(`[${scheme}] tapping on goes back to the first`, seenCards[2] === seenCards[0], JSON.stringify(seenCards));
    await page.click('#thread .msg.ev.current .card-line');
    await page.waitForTimeout(300);
    const opened = await page.evaluate(() => ({
      record: !document.getElementById('p-record').hidden,
      dates: !document.getElementById('record-dates').hidden,
    }));
    ok(
      `[${scheme}] the dates line opens it in its tab (Record → Dates)`,
      opened.record && opened.dates,
      JSON.stringify(opened)
    );
    await page.click('#tab-ev');
    await page.waitForTimeout(400);
    // Lines alone keep her conversation size.
    await page.evaluate(() => {
      window.__chatScript = [
        { tool: 'show_card', input: { type: 'weakspots' } },
        { tool: 'show_card', input: { type: 'today', filter: 'all' } },
        { tool: 'show_card', input: { type: 'chart' } },
      ];
      window.__chatPre = '';
      window.__chatReply = 'Three things to look at.';
    });
    await page.fill('#ev-input', 'how am I doing');
    await page.click('#ev-send');
    await page.waitForTimeout(4000);
    const lo = await cardView();
    ok(
      `[${scheme}] a reply with only info cards: three lines, no whole card, her core at the conversation size`,
      lo.cards === 0 &&
        lo.lines.length === 3 &&
        !lo.more &&
        lo.step === 'conversation' &&
        /due now|No active weak spots/.test(lo.lines[0]) &&
        /^(Today’s list · \d+ of \d+ done|Nothing on today’s list yet)$/.test(lo.lines[1]) &&
        /^(Last 7 days · \d+ of \d+ right \(\d+%\)|No answers in the last week yet)$/.test(lo.lines[2]),
      JSON.stringify(lo)
    );
    await page.screenshot({ path: `${shots}/captions-line-cards-${scheme}.png` });
    // B-85: in a conversation the chips step aside; an empty focused input brings them back; the composer stays.
    const quietChips = await page.isVisible('#qchips');
    await page.focus('#ev-input');
    await page.waitForTimeout(150);
    ok(
      `[${scheme}] chips step aside in a conversation and come back in an empty focused input; composer kept`,
      !quietChips &&
        (await page.locator('#qchips .qchip:visible').count()) >= 1 &&
        (await page.isVisible('#ev-input')) &&
        (await page.isVisible('#ev-send'))
    );
    await page.fill('#ev-input', 'x');
    await page.waitForTimeout(100);
    const typed = await page.isVisible('#qchips');
    await page.fill('#ev-input', '');
    await page.evaluate(() => document.activeElement.blur());
    await page.waitForTimeout(350);
    ok(
      `[${scheme}] typing puts them away again, and so does leaving the input`,
      !typed && !(await page.isVisible('#qchips'))
    );
    if (scheme === 'desktop') {
      // D-122 as amended: the side column exists only while it holds something. With nothing in it her stage centres in
      // the window; with something (a stand-in for B-78's surface) it slides in from 1024 px and her stage re-centres in
      // what is left; below 1024 it wraps under the stage (D-159).
      const lay = async w => {
        await page.setViewportSize({ width: w, height: 860 });
        await page.waitForTimeout(700);
        return page.evaluate(() => {
          const r = id => document.getElementById(id).getBoundingClientRect();
          const s = r('ev-side'),
            c = r('composer'),
            th = r('thread'),
            av = document.querySelector('#hero .ev-av').getBoundingClientRect();
          return {
            sideShown: getComputedStyle(document.getElementById('ev-side')).display !== 'none',
            sideLeft: Math.round(s.left),
            sideTop: Math.round(s.top),
            sideW: Math.round(s.width),
            comp: {
              left: Math.round(c.left),
              right: Math.round(c.right),
              bottom: Math.round(c.bottom),
              top: Math.round(c.top),
            },
            threadLeft: Math.round(th.left),
            threadRight: Math.round(th.right),
            coreX: Math.round(av.left + av.width / 2),
            compW: Math.round(document.querySelector('.compose-row').getBoundingClientRect().width),
          };
        });
      };
      const e1280 = await lay(1280),
        e900 = await lay(1024);
      ok(
        '[desktop] with nothing beside her: no side column, her stage centred in the window (640 px at 1280, 512 at 1024)',
        !e1280.sideShown && !e900.sideShown && Math.abs(e1280.coreX - 640) <= 2 && Math.abs(e900.coreX - 512) <= 2,
        JSON.stringify({ e1280, e900 })
      );
      await page.evaluate(() => {
        const d = document.createElement('div');
        d.className = 'card';
        d.id = 'harness-surface';
        d.textContent = 'Harness surface (a stand-in for B-78)';
        document.getElementById('ev-side').append(d);
      });
      const at900 = await lay(1024),
        at899 = await lay(1023);
      ok(
        '[desktop] something beside her: at 1024 px the column sits beside her stage (300 to 440 px)',
        at900.sideShown &&
          at900.sideLeft >= at900.threadRight &&
          at900.sideTop < at900.comp.top &&
          at900.sideW >= 300 &&
          at900.sideW <= 440,
        JSON.stringify(at900)
      );
      ok(
        '[desktop] at 1023 px it wraps under the stage (the phone stack)',
        at899.sideShown && at899.sideTop >= at899.comp.bottom - 1 && at899.sideLeft < at899.threadRight,
        JSON.stringify(at899)
      );
      const at1280 = await lay(1280);
      ok(
        '[desktop] at 1280 her stage re-centres in what is left; captions and composer at most 660 px',
        at1280.compW <= 660 &&
          at1280.sideW >= 300 &&
          at1280.sideW <= 440 &&
          Math.abs(at1280.coreX - (at1280.threadLeft + at1280.threadRight) / 2) <= 2 &&
          at1280.coreX < 600,
        JSON.stringify(at1280)
      );
      await page.setViewportSize({ width: 1023, height: 860 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/captions-wrap-1023.png` });
      await page.setViewportSize({ width: 1024, height: 860 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/captions-wrap-1024.png` });
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/captions-side-1280.png` });
      await page.evaluate(() => document.getElementById('harness-surface').remove());
      const back = await lay(1280);
      ok(
        '[desktop] emptied, the column goes and her stage centres again',
        !back.sideShown && Math.abs(back.coreX - 640) <= 2,
        JSON.stringify(back)
      );
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(`[${scheme}] no sideways scroll`, !overflow);
    ok(`[${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // B-82 (Matt, Oct 19): a skills run in Captions. The bottom sheet is the whole runner (her line carries no card while
  // it goes), its count line has End (B-122, D-161: no Hide; its peek line folds the sheet, the desktop panel folds by
  // its head line), End brings the summary card back; a run found going on a fresh visit waits behind the Resume chip;
  // one untouched for the conversation idle gap ends itself. A made-up checklist, planted as a lab material.
  const PACKET = {
    schema: 1,
    writer: 'canvas-sync',
    at: new Date().toISOString(),
    source: 'harness',
    title: 'Harness Skills Packet.pdf',
    course: 'NUR 112',
    kind: 'lab',
    pages: 5,
    text: [
      '[p4] 4 1 st Attempt: S or U Student Name Date Instructor Name HARNESS BED BATH VALIDATION CHECKLIST The student may miss NONE of the asterisk (*) areas and only 1 of the non-asterisk areas. * 1. Perform hand hygiene 2. Explain the procedure to the client * 3. Lower the bed rail on the working side 4. Wash from cleanest to dirtiest area',
      '[p5] 5 * 5. Raise the bed rail before stepping away 6. Document the bath and skin findings Overall Performance: ______ / 6',
    ].join('\n'),
  };
  const skillSeed = extra => {
    const d = JSON.parse(JSON.stringify(seed));
    d.materials = { ...(d.materials || {}), 'NUR112-990': PACKET };
    Object.assign((d.sessions = d.sessions || {}), extra || {});
    return d;
  };
  const plantedRun = (id, startedMinAgo, marks) => {
    const st = new Date(NOW.getTime() - startedMinAgo * 60e3).toISOString();
    const ev = { [mid(new Date(st), 'page').replace(/^m-/, 'page-')]: { type: 'start', at: st } };
    for (const [n, minAgo, r] of marks) {
      const at = new Date(NOW.getTime() - minAgo * 60e3).toISOString();
      ev['page-' + at.replace(/[-:]/g, '').replace('T', '-').replace('.', '').replace('Z', '')] = {
        type: 'step',
        n,
        result: r,
        at,
      };
    }
    return {
      [id]: {
        schema: 1,
        writer: 'page',
        at: st,
        source: 'E.V. Home',
        kind: 'skill',
        status: 'active',
        date: today,
        startedAt: st,
        topic: 'HARNESS BED BATH VALIDATION CHECKLIST',
        skill: {
          materialId: 'NUR112-990',
          page: 4,
          cite: 'Harness Skills Packet, p. 4',
          steps: [1, 2, 3, 4, 5, 6].map(n => ({ n, text: 'Harness step ' + n, critical: n % 2 === 1 })),
          rule: { missNonCritical: 1 },
        },
        events: ev,
      },
    };
  };
  const skillView = page =>
    page.evaluate(() => {
      const sh = document.getElementById('sksheet'),
        pn = document.getElementById('skpanel'),
        cur = document.querySelector('#thread .msg.ev.current');
      const vis = e =>
        !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
      return {
        sheet: vis(sh),
        panel: vis(pn),
        count: (document.querySelector('#sksheet .sk-count') || {}).textContent || null,
        minis: [...document.querySelectorAll('#sksheet .sk-mini')].map(b => b.textContent),
        panelBtns: [...document.querySelectorAll('#skpanel button')].map(b => b.textContent),
        sheetOpen: !!sh && sh.classList.contains('open'),
        panelH: pn ? Math.round(pn.getBoundingClientRect().height) : 0,
        panelActs: !!document.querySelector('#skpanel .sk-acts'),
        closers: [...document.querySelectorAll('button,[role=button]')]
          .map(b => b.textContent.trim() || b.getAttribute('aria-label') || '')
          .filter(t => /^(hide|close|dismiss)\b|^[×✕✖]$/i.test(t)),
        cards: cur ? cur.querySelectorAll('.ev-card').length : -1,
        cardText: cur && cur.querySelector('.ev-card') ? cur.querySelector('.ev-card').textContent.slice(0, 160) : '',
        greetCurrent: !!document.querySelector('#thread .msg.greet.current'),
        step: document.getElementById('hero').dataset.step,
        chips: [...document.querySelectorAll('#qchips .qchip')].filter(vis).map(c => c.textContent),
        unit: document.getElementById('readout').textContent,
      };
    });
  const skillState = page =>
    page.evaluate(() =>
      Object.entries(window.__db.sessions || {})
        .filter(([id, s]) => s.kind === 'skill' && /harness/.test(id))
        .map(([id, s]) => ({ id, status: s.status, endedBy: s.endedBy || null, summary: s.summary || '' }))
    );
  for (const scheme of ['phone', 'half', 'desktop']) {
    // B-122: 390, 735 (the phone's sheet, half the laptop) and 1280
    const vp =
        scheme === 'phone'
          ? { width: 390, height: 844 }
          : scheme === 'half'
            ? { width: 735, height: 830 }
            : { width: 1280, height: 860 },
      phone = scheme !== 'desktop';
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openPage(page, skillSeed());
    await page.waitForTimeout(1500);
    ok(
      `[skills ${scheme}] the readout names the unit EV-04`,
      /^EV-04 · /.test((await skillView(page)).unit),
      (await skillView(page)).unit
    );
    await page.evaluate(() => {
      window.__chatPre = '';
      window.__chatScript = [
        { tool: 'practice_skill', input: { action: 'start', skill: 'harness bed bath', page: 4 } },
      ];
      window.__chatReply = 'Harness bed bath: six steps. Mark each one as you go.';
    });
    await page.fill('#ev-input', 'practice harness bed bath');
    await page.click('#ev-send');
    await page.waitForTimeout(4500);
    let v = await skillView(page);
    ok(
      `[skills ${scheme}] a run starts: her line carries no card, the ${phone ? 'bottom sheet' : 'side panel'} is the runner`,
      v.cards === 0 && (phone ? v.sheet && !v.panel : v.panel),
      JSON.stringify(v)
    );
    ok(
      `[skills ${scheme}] her core steps to the skills size (${phone ? "D-122's 44%" : 'the surface step'})`,
      v.step === (phone ? 'skills' : 'surface'),
      JSON.stringify(v)
    );
    if (phone)
      ok(
        `[skills ${scheme}] the sheet's count line has End, beside Missed it and Did it; no Hide`,
        v.count === 'Step 1 of 6' && v.minis.join(',') === 'End',
        JSON.stringify(v)
      );
    else
      ok(
        '[skills desktop] the panel has End and no Hide',
        v.panelBtns.includes('End') && !v.panelBtns.includes('Hide') && !v.panelBtns.includes('Stop'),
        JSON.stringify(v.panelBtns)
      );
    ok(
      `[skills ${scheme}] no button named Hide, Close or × anywhere on the page`,
      !v.closers.length,
      JSON.stringify(v.closers)
    );
    await page.screenshot({ path: `${shots}/skills-run-${scheme}.png` });
    await page.click(
      phone ? '#sksheet .sk-acts button:has-text("Did it")' : '#skpanel .sk-acts button:has-text("Did it")'
    );
    await page.waitForTimeout(500);
    // The way out is the thing folding (D-160): the peek line on the phone, the head line beside her on the desktop.
    if (phone) {
      await page.click('#sksheet .sk-tog');
      await page.waitForTimeout(300);
      const o = await skillView(page);
      await page.click('#sksheet .sk-tog');
      await page.waitForTimeout(300);
      v = await skillView(page);
      ok(
        `[skills ${scheme}] the peek line unfolds the sheet to the whole list and folds it again`,
        o.sheetOpen && !v.sheetOpen && v.sheet && v.count === 'Step 2 of 6',
        JSON.stringify({ o: o.sheetOpen, v: v.sheetOpen, count: v.count })
      );
    } else {
      const h0 = (await skillView(page)).panelH;
      await page.click('#skpanel .sk-pfold');
      await page.waitForTimeout(300);
      const f = await skillView(page);
      await page.screenshot({ path: `${shots}/skills-folded-${scheme}.png` });
      await page.click('#skpanel .sk-pfold');
      await page.waitForTimeout(300);
      v = await skillView(page);
      ok(
        "[skills desktop] the panel's head line folds it to one line and unfolds it",
        f.panel && f.panelH <= 84 && !f.panelActs && v.panelActs && v.panelH === h0,
        JSON.stringify({ h0, folded: f.panelH, acts: f.panelActs, back: v.panelH })
      );
    }
    await page.click(phone ? '#sksheet .sk-mini:has-text("End")' : '#skpanel button:has-text("End")');
    await page.waitForTimeout(900);
    v = await skillView(page);
    const st = await skillState(page);
    ok(
      `[skills ${scheme}] End ends the run, saved; the summary card comes back under her line`,
      st.length === 1 &&
        st[0].status === 'ended' &&
        st[0].endedBy === 'ended' &&
        !v.sheet &&
        !v.panel &&
        v.cards === 1 &&
        /1 of 6 steps done right\. Stopped before the end\./.test(v.cardText),
      JSON.stringify({ st, v })
    );
    ok(`[skills ${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
    // A fresh visit with a run going (started 30 min ago, one step marked 20 min ago): the greeting is her line, the
    // runner waits behind the Resume chip.
    const c2 = await browser.newContext({ viewport: vp, colorScheme: 'dark' });
    const p2 = await c2.newPage();
    await openPage(p2, skillSeed(plantedRun('ss-skill-harness-going', 30, [[1, 20, 'pass']])));
    await p2.waitForTimeout(2500);
    v = await skillView(p2);
    ok(
      `[skills ${scheme}] a fresh visit with a run going: the greeting is her line, the runner waits, Resume leads the chips`,
      v.greetCurrent && !v.sheet && !v.panel && v.chips[0] === 'Resume Harness bed bath · 2 of 6' && v.step === 'idle',
      JSON.stringify(v)
    );
    await p2.screenshot({ path: `${shots}/skills-return-${scheme}.png` });
    await p2.click('#qchips .qchip:has-text("Resume")');
    await p2.waitForTimeout(600);
    v = await skillView(p2);
    ok(
      `[skills ${scheme}] tapping Resume brings the runner back at step 2`,
      (phone ? v.sheet && v.count === 'Step 2 of 6' : v.panel) && !v.chips.some(c => /^Resume /.test(c)),
      JSON.stringify(v)
    );
    await c2.close();
    // A run untouched for the conversation idle gap (started 3 h ago, last step 125 min ago) ends itself on open.
    const c3 = await browser.newContext({ viewport: vp, colorScheme: 'dark' });
    const p3 = await c3.newPage();
    await openPage(p3, skillSeed(plantedRun('ss-skill-harness-stale', 180, [[1, 125, 'pass']])));
    await p3.waitForTimeout(3000);
    v = await skillView(p3);
    const st3 = await skillState(p3);
    ok(
      `[skills ${scheme}] a run untouched for 2 h ends itself as left unfinished; no Resume chip, no runner`,
      st3.length === 1 &&
        st3[0].status === 'ended' &&
        st3[0].endedBy === 'idle' &&
        /Left unfinished/.test(st3[0].summary) &&
        !v.sheet &&
        !v.panel &&
        !v.chips.some(c => /^Resume /.test(c)),
      JSON.stringify({ st3, v })
    );
    await c3.close();
  }
  // D-125 as amended: File it is the fallback chip when quiet filing cannot run; here the reader is unreachable and
  // two Study Watch sessions wait. With no review left and no unseen job, it takes a priority slot.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__readerFail = 'server_not_connected';
      window.__readerSessions = {
        sessions: [
          { id: 'h1', title: 'Harness note one', modifiedAt: new Date().toISOString() },
          { id: 'h2', title: 'Harness note two', modifiedAt: new Date().toISOString() },
        ],
      };
    });
    const quiet = JSON.parse(JSON.stringify(seed));
    delete (quiet.sets || {})['review-' + today];
    quiet.talk.memory = { ...(quiet.talk.memory || {}), lastSeenAt: new Date(Date.now() + 864e5).toISOString() };
    await openPage(page, quiet);
    await page.waitForTimeout(2500);
    const chips = await page.evaluate(() => [...document.querySelectorAll('#qchips .qchip')].map(c => c.textContent));
    ok(
      '[phone] with the reader unreachable, File it is offered, Start a study session still last',
      chips.includes('File it') && chips.length === 3 && chips[2] === 'Start a study session',
      JSON.stringify(chips)
    );
    await ctx.close();
  }
  // B-122 (D-160, D-161): a session's check folds to its head line by a tap on it and back, files nothing, and the next
  // checkpoint's card arrives open; at 390, 735 and 1280.
  {
    const ITEMS = [
      { kind: 'why', text: 'Why does 0.45% saline move water into the cells?' },
      { kind: 'gap', text: 'What does 3% saline do to cell size?' },
    ];
    const checkSeed = () => {
      const db = JSON.parse(JSON.stringify(seed)),
        t0 = new Date(NOW.getTime() - 20 * 60e3).toISOString(),
        t1 = new Date(NOW.getTime() - 60e3),
        k = 'start-' + t0.replace(/[-:.TZ]/g, '').slice(0, 14);
      db.sessions = {
        ...(db.sessions || {}),
        'ss-harness-check': {
          schema: 1,
          writer: 'page',
          at: t0,
          source: 'E.V. Home',
          status: 'active',
          date: today,
          startedAt: t0,
          topic: 'Harness checks',
          noteId: 'x-coredata://check',
          driver: { view: 'gone', at: t0 },
          events: { [k]: { type: 'start', at: t0, len: 5, h: 'zz', noteId: 'x-coredata://check' } },
        },
      };
      return db;
    };
    // A checkpoint arriving: the session posts check n as a reply in today's conversation.
    const post = (page, n) =>
      page.evaluate(
        async ({ today, items, n }) => {
          const db = await window.claude.use('db'),
            at = new Date(Date.now()).toISOString(),
            id = 'm-' + at.replace(/[-:]/g, '').replace('T', '-').replace('.', '').replace('Z', '') + '-ev';
          const doc = (window.__db.talk || {})[today] || {
            schema: 1,
            writer: 'page',
            at,
            source: 'E.V. Home',
            date: today,
            messages: {},
          };
          await db
            .collection('talk')
            .doc(today)
            .set({
              ...doc,
              messages: {
                ...(doc.messages || {}),
                [id]: {
                  role: 'ev',
                  text: 'Two questions on what you just wrote.',
                  cards: [{ type: 'check', session: 'ss-harness-check', n, items }],
                  at,
                  tier: 'quick',
                },
              },
            });
        },
        { today, items: ITEMS, n }
      );
    const card = page =>
      page.evaluate(() => {
        const c = [...document.querySelectorAll('#thread .msg.ev.current .ev-card.check')].pop();
        if (!c) return null;
        const f = c.querySelector('.check-fold'),
          r = c.getBoundingClientRect();
        return {
          head: f && f.textContent,
          expanded: f && f.getAttribute('aria-expanded'),
          h: Math.round(r.height),
          lineH: f ? Math.round(f.getBoundingClientRect().height) : 0,
          items: [...c.querySelectorAll('ol.check-items')].some(o => o.getBoundingClientRect().height > 0),
          // The session's own tick (who drives it, a skipped note read) is not filing: only other writes count.
          writes: (window.__writes || []).filter(
            ([op, col, , data]) =>
              !(
                op === 'update' &&
                col === 'sessions' &&
                data &&
                Object.keys(data).every(k => k === 'driver' || k === 'events') &&
                Object.values(data.events || {}).every(e => e && e.type === 'skip')
              )
          ).length,
        };
      });
    for (const vp of [
      { width: 390, height: 844 },
      { width: 735, height: 830 },
      { width: 1280, height: 860 },
    ]) {
      const tag = vp.width;
      const ctx = await browser.newContext({ viewport: vp, colorScheme: 'dark' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openPage(page, checkSeed());
      await page.waitForTimeout(1500);
      await post(page, 1);
      await page
        .waitForFunction(() => document.querySelector('#thread .msg.ev.current .check-fold'), null, { timeout: 8000 })
        .catch(() => {});
      await page.waitForTimeout(800);
      const c0 = await card(page),
        w0 = c0 && c0.writes;
      await page.click('#thread .msg.ev.current .check-fold');
      await page.waitForTimeout(300);
      const c1 = await card(page);
      await page.screenshot({ path: `${shots}/check-folded-${tag}.png` });
      ok(
        `[check ${tag}] a tap on its head line folds the check to that one line, filing nothing`,
        c0 &&
          c0.head === 'Check 1 · 2 questions' &&
          c0.items &&
          c1 &&
          !c1.items &&
          c1.expanded === 'false' &&
          c1.h <= c1.lineH + 40 &&
          c1.writes === c0.writes,
        JSON.stringify({ c0, c1 })
      );
      await page.click('#thread .msg.ev.current .check-fold');
      await page.waitForTimeout(300);
      const c2 = await card(page);
      ok(`[check ${tag}] a second tap unfolds it`, c2 && c2.items && c2.expanded === 'true', JSON.stringify(c2));
      await page.click('#thread .msg.ev.current .check-fold');
      await page.waitForTimeout(200);
      // The next checkpoint: a new check arrives open, the folded one stays folded.
      await page.waitForTimeout(1100);
      await post(page, 2);
      await page
        .waitForFunction(
          () => /Check 2/.test((document.querySelector('#thread .msg.ev.current .check-fold') || {}).textContent || ''),
          null,
          { timeout: 6000 }
        )
        .catch(() => {});
      await page.waitForTimeout(400);
      const c3 = await card(page);
      ok(
        `[check ${tag}] the next checkpoint's check arrives open`,
        c3 && c3.head === 'Check 2 · 2 questions' && c3.items && c3.expanded === 'true',
        JSON.stringify(c3)
      );
      ok(`[check ${tag}] no page errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
  // B-112 (D-153): at short heights (390x450 is the phone with its keyboard open) the composer's bottom edge and her
  // current line stay inside the viewport, idle, in a conversation and in a session.
  {
    const sessionSeed = () => {
      const db = JSON.parse(JSON.stringify(seed)),
        t0 = new Date(NOW.getTime() - 3 * 60e3).toISOString(),
        k = 'start-' + t0.replace(/[-:.TZ]/g, '').slice(0, 14);
      db.sessions = {
        ...(db.sessions || {}),
        'ss-harness-short': {
          schema: 1,
          writer: 'page',
          at: t0,
          source: 'E.V. Home',
          status: 'active',
          date: today,
          startedAt: t0,
          topic: 'Harness short screen',
          noteId: 'x-coredata://short',
          driver: { view: 'gone', at: t0 },
          events: { [k]: { type: 'start', at: t0, len: 5, h: 'zz', noteId: 'x-coredata://short' } },
        },
      };
      return db;
    };
    const inView = page =>
      page.evaluate(() => {
        const c = document.querySelector('.compose-row').getBoundingClientRect(),
          cur = document.querySelector('#thread .msg.ev.current .bubble'),
          r = cur && cur.getBoundingClientRect(),
          H = innerHeight;
        return {
          H,
          composerBottom: Math.round(c.bottom),
          lineTop: r ? Math.round(r.top) : null,
          lineBottom: r ? Math.round(r.bottom) : null,
          step: document.getElementById('hero').dataset.step,
          stage: Math.round(document.getElementById('hero').getBoundingClientRect().height),
          scrollY: Math.round(scrollY),
          ok: c.bottom <= H + 1 && c.top >= 0 && !!r && r.top >= 0 && r.top + 18 <= Math.min(H, c.top),
        };
      });
    for (const vp of [
      { width: 390, height: 450 },
      { width: 375, height: 667 },
      { width: 735, height: 830 },
    ]) {
      const tag = `${vp.width}x${vp.height}`;
      for (const state of ['idle', 'conversation', 'session']) {
        const ctx = await browser.newContext({ viewport: vp, colorScheme: 'dark' });
        const page = await ctx.newPage();
        await openPage(page, state === 'session' ? sessionSeed() : seed);
        await page.waitForTimeout(1500);
        if (state === 'conversation') {
          await send(page, 'explain preload', REPLY);
          await page.waitForTimeout(3000);
        }
        if (state === 'session')
          await page
            .waitForFunction(() => document.getElementById('hero').dataset.step === 'session', null, { timeout: 8000 })
            .catch(() => {});
        await page.waitForTimeout(1000); // past the stage's step
        const v = await inView(page);
        ok(`[short ${tag} ${state}] the composer and her current line are in view`, v.ok, JSON.stringify(v));
        await page.screenshot({ path: `${shots}/short-${tag}-${state}.png` });
        await ctx.close();
      }
    }
  }
  // B-114 (D-159): two breakpoints. At 560, 735, 960 and 1023 one layout: icon tabs, no status line, no side column, a
  // session's notes under the stage; at 1024 and 1470 the desktop one. No sideways scroll at any of them.
  {
    const sessionSeed = () => {
      const db = JSON.parse(JSON.stringify(seed)),
        t0 = new Date(NOW.getTime() - 3 * 60e3).toISOString(),
        k = 'start-' + t0.replace(/[-:.TZ]/g, '').slice(0, 14);
      db.sessions = {
        ...(db.sessions || {}),
        'ss-harness-bp': {
          schema: 1,
          writer: 'page',
          at: t0,
          source: 'E.V. Home',
          status: 'active',
          date: today,
          startedAt: t0,
          topic: 'Harness breakpoints',
          noteId: 'x-coredata://bp',
          driver: { view: 'gone', at: t0 },
          events: { [k]: { type: 'start', at: t0, len: 5, h: 'zz', noteId: 'x-coredata://bp' } },
        },
      };
      return db;
    };
    const layout = page =>
      page.evaluate(() => {
        const vis = e =>
          !!e &&
          getComputedStyle(e).display !== 'none' &&
          e.getBoundingClientRect().width > 1 &&
          e.getBoundingClientRect().height > 1;
        const hero = document.getElementById('hero').getBoundingClientRect(),
          side = document.getElementById('ev-side'),
          notes = document.getElementById('snotes'),
          sread = document.getElementById('sread');
        return {
          iconTabs: [...document.querySelectorAll('#top .tabs .tab span')].every(s => !vis(s)),
          statusLine: vis(document.getElementById('status')),
          sideColumn: vis(side) && side.getBoundingClientRect().left >= hero.right - 1,
          notesPanel: vis(notes),
          notesUnder: vis(sread) && sread.getBoundingClientRect().top >= hero.bottom - 1,
          step: document.getElementById('hero').dataset.step,
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
    for (const w of [560, 735, 960, 1023, 1024, 1470]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 860 }, colorScheme: 'dark' });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        window.__readerNote = {
          found: true,
          appVersion: '0.4',
          note: {
            id: 'x-coredata://bp',
            name: 'Harness breakpoints',
            folder: 'NUR 112',
            modifiedAt: new Date().toISOString(),
            text: 'Preload stretches the ventricle.\nAfterload is the push back.\n',
          },
        };
      });
      await openPage(page, sessionSeed());
      await page
        .waitForFunction(() => document.getElementById('hero').dataset.step === 'session', null, { timeout: 8000 })
        .catch(() => {});
      // The session reads his note on its first poll; the stage steps.
      await page
        .waitForFunction(() => !document.getElementById('sread').hidden, null, { timeout: 12000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      const v = await layout(page),
        desk = w >= 1024;
      ok(
        `[breakpoints ${w}] ${desk ? 'the desktop layout: named tabs, the status line, the notes in the side column' : 'the phone stack: icon tabs, no status line, no side column, the notes under the stage'}`,
        !v.sideways &&
          (desk
            ? !v.iconTabs && v.statusLine && v.notesPanel && v.sideColumn
            : v.iconTabs && !v.statusLine && !v.notesPanel && !v.sideColumn && v.notesUnder),
        JSON.stringify(v)
      );
      if ([735, 960].includes(w)) await page.screenshot({ path: `${shots}/breakpoints-${w}.png` });
      await ctx.close();
    }
  }
  // Reduced motion, at both widths: the line whole at once, announced once, her core still, its gesture still raised.
  for (const [label, vp] of [
    ['phone', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 860 }],
  ]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await openPage(page);
    await page.waitForTimeout(1500);
    await send(page, 'explain preload', REPLY);
    await page.waitForTimeout(1200); // past the send and settle brightness changes
    const r = await page.evaluate(() => {
      const b = document.querySelector('#thread .msg.ev.current .bubble');
      const ws = [...b.querySelectorAll('.w')];
      return {
        n: ws.length,
        hidden: ws.filter(w => getComputedStyle(w).opacity !== '1').length,
        reveal: b.classList.contains('reveal'),
      };
    });
    const h1 = await page.evaluate(() => window.EVApp.core.sample(0).hash);
    await page.waitForTimeout(600);
    const h2 = await page.evaluate(() => window.EVApp.core.sample(0).hash);
    const said = await page.evaluate(() => [...document.querySelectorAll('#ev-say p')].map(p => p.textContent));
    const g1 = await page.evaluate(() =>
      window.EVApp.core
        .stats()
        .log.filter(e => e.kind === 'gesture')
        .map(e => e.name)
    );
    ok(
      `[reduced motion ${label}] her line shows whole at once`,
      r.n === 14 && r.hidden === 0 && !r.reveal,
      JSON.stringify(r)
    );
    ok(
      `[reduced motion ${label}] announced once`,
      said.filter(x => x.includes('Preload is the stretch')).length === 1,
      JSON.stringify(said)
    );
    ok(`[reduced motion ${label}] her core holds still`, h1 === h2);
    ok(
      `[reduced motion ${label}] the reply still ends with its gesture (settle)`,
      g1.slice(-1)[0] === 'settle',
      JSON.stringify(g1)
    );
    // An error reply still recoils, a short brightness change under reduced motion.
    await page.evaluate(() => {
      window.__chatFail = 'upstream_error';
    });
    await send(page, 'and afterload', 'x');
    await page.waitForTimeout(800);
    const g2 = await page.evaluate(() =>
      window.EVApp.core
        .stats()
        .log.filter(e => e.kind === 'gesture')
        .map(e => e.name)
    );
    ok(
      `[reduced motion ${label}] an error reply raises the error gesture`,
      g2.slice(-1)[0] === 'error',
      JSON.stringify(g2)
    );
    await page.screenshot({ path: `${shots}/captions-reduced-${label}.png` });
    await ctx.close();
  }
  await browser.close();
  // The measured layout against the Captions v2 artboards (V2.dc.html, V2Desktop.dc.html in E.V. Home: Captions).
  console.log(
    'against the artboards:',
    JSON.stringify({
      artboards: art,
      measured,
      rendered: artDir
        ? Object.fromEntries(
            Object.entries(rendered).map(([k, v]) => [
              k,
              Object.fromEntries(Object.entries(v).map(([s, x]) => [s, x.vs || x])),
            ])
          )
        : 'not rendered (no --artboards)',
    })
  );
  for (const [s, n, d] of results) console.log(s, n, d);
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(failed ? `${failed} FAILED of ${results.length} checks` : `ALL PASSED: ${results.length} checks`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('CRASHED', e.message);
  process.exit(1);
});
