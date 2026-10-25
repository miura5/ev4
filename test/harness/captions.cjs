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
const { paintAnswer, painted } = require('./paint.cjs');
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
// B-352 (D-316): the demo's day format, Fri 23 Oct
const dayLabel = d => {
  const x = new Date(d + 'T12:00:00Z'),
    f = o => x.toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
  return `${f({ weekday: 'short' })} ${f({ day: 'numeric' })} ${f({ month: 'short' })}`;
};
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
const { advisory, allPass } = require('./quarantine.cjs');
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
// Returns the pull's line as he holds at the top, before the 0.3 s hold loads (B-250: the count is on it).
async function pullOnce(page) {
  await page.evaluate(() => {
    const t = document.getElementById('thread');
    t.scrollTop = 0;
    t.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(120);
  const held = await page.evaluate(() => document.querySelector('.cap-pull .lbl').textContent);
  await page.waitForTimeout(330);
  return held;
}
// A full pull after an edge: away from the top first (the next pull starts over), then up and hold.
async function pullAgain(page) {
  await page.evaluate(() => {
    const t = document.getElementById('thread');
    t.scrollTop = Math.min(220, t.scrollHeight - t.clientHeight);
    t.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(120);
  return pullOnce(page);
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
    // B-209 (D-213): her stage is one size per layout now, 104 px on the phone, 140 px wide at 1280 (no step down in a
    // conversation or for a surface); the stage is her size and its padding.
    phone: {
      core: 104,
      stage: [104, 164],
      convCore: 104,
      convStage: [104, 164],
      now: '20px',
      past: '15px',
      matt: '14px', // B-209 (D-210): his lines are quiet 14 px lines at every width
    },
    desktop: {
      core: 140,
      stage: [140, 200],
      convCore: 140,
      convStage: [140, 200],
      now: '20px', // D-247: the direction C prototype's sizes (D-122 had 24 and 16)
      past: '14px',
      matt: '14px',
    },
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
      `[${scheme}] the greeting has no card; its offers are the demo's five chips, Start a study session first (B-358)`,
      gc.cards === 0 &&
        gc.chips.length === 5 &&
        gc.chips[0] === 'Start a study session' &&
        !gc.chips.includes('File it'),
      JSON.stringify(gc)
    );
    ok(
      `[${scheme}] opening: her flower at ${A.core} px on her stage (D-213), no bubbles`,
      v.step === 'idle' && v.corePx === A.core && v.stageH >= A.stage[0] && v.stageH <= A.stage[1] && !v.bubbles,
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
    // B-209 (D-210): his line stays in the conversation, quiet and right-aligned; there is no echo.
    const mine = await page.evaluate(() => {
      const m = [...document.querySelectorAll('#thread .msg.matt')].pop(),
        e = document.getElementById('ev-echo');
      const r = m && m.getBoundingClientRect(),
        t = document.getElementById('thread').getBoundingClientRect();
      return {
        shown: !!m && r.height > 0,
        text: m && m.textContent,
        right: !!m && Math.abs(r.right - t.right) < t.width / 4 && getComputedStyle(m).textAlign === 'right',
        echo: !!e && getComputedStyle(e).display !== 'none' && e.classList.contains('on'),
      };
    });
    ok(
      `[${scheme}] his line stays as a quiet right-aligned line; no echo above the composer`,
      mine.shown && /explain preload/.test(mine.text) && mine.right && !mine.echo,
      JSON.stringify(mine)
    );
    // B-264: her lines read left-aligned at every width, the phone's too
    const herAlign = await page.evaluate(() => {
      const b = document.querySelector('#thread .msg.ev .bubble');
      return b ? getComputedStyle(b).textAlign : null;
    });
    ok(`[${scheme}] her lines read left-aligned (B-264)`, /^(left|start)$/.test(herAlign || ''), herAlign);
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
      const log = window.EVApp.core.stats().log;
      return {
        all: b.querySelectorAll('.w.on').length === b.querySelectorAll('.w').length,
        speaks: log.filter(e => e.kind === 'speak').length,
        emph: log.filter(e => e.kind === 'speak' && e.detail === 'emphasis').map(e => e.name),
        settled: log.filter(e => e.kind === 'gesture').slice(-1)[0],
      };
    });
    ok(
      `[${scheme}] her core spoke each word and settled`,
      done.all && done.speaks >= 14 && done.emph.includes('stretch') && done.settled && done.settled.name === 'settle',
      JSON.stringify(done)
    );
    ok(
      `[${scheme}] his line is still there once she has answered`,
      v.texts.some(t => /explain preload/.test(t)),
      JSON.stringify(v.texts)
    );
    ok(
      // B-357 (D-315): her lines' sizes and the earlier lines' fade are the demo's; her flower and stage stay (D-213)
      `[${scheme}] in conversation: her flower the same ${A.convCore} px on its stage (D-213)`,
      v.step === 'conversation' &&
        Math.abs(v.corePx - A.convCore) <= 1 &&
        v.stageH >= A.convStage[0] &&
        v.stageH <= A.convStage[1],
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
    // B-152 (D-176): advisory; its numbers are printed, and a miss is measured once more before it fails.
    const measurePace = async () => {
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
      return {
        words: W.length,
        total: rv.total,
        firstSentence: k1,
        firstSentenceMs: firstMs,
        wordsPerSecFirst: rate1 && +rate1.toFixed(2),
        allMs,
        speechEndAfterLastMs: rv.end != null && W.length ? rv.end - W[W.length - 1][0] : null,
      };
    };
    const pace = await advisory(
      results,
      'captions-pace',
      `[${scheme}] D-137: the first sentence at speech pace (about 3 words a second), the whole reply out within 6 s, her speech ending with the last word`,
      measurePace,
      x => {
        const v = allPass([
          [
            x.words === x.total && x.wordsPerSecFirst >= 2.2 && x.wordsPerSecFirst <= 4 ? 'PASS' : 'FAIL',
            'speech pace',
            `${x.wordsPerSecFirst} words/s over the first ${x.firstSentence} words`,
          ],
          [x.allMs <= 6000 + 250 && x.allMs > x.firstSentenceMs ? 'PASS' : 'FAIL', 'within 6 s', `${x.allMs} ms`],
          [
            x.speechEndAfterLastMs != null && x.speechEndAfterLastMs >= 0 && x.speechEndAfterLastMs <= 300
              ? 'PASS'
              : 'FAIL',
            'speech ends with the last word',
            `${x.speechEndAfterLastMs} ms after`,
          ],
        ]);
        return { ok: v.ok, numbers: JSON.stringify(x) + (v.ok ? '' : ' · missed: ' + v.numbers) };
      }
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
    // B-209 (D-213): reading back, her stage is folded and she is the flower in the pane's header.
    ok(`[${scheme}] reading back folds her stage to the header's 24 px flower`, await page.isVisible('#mh-her'));
    await page.click((await page.isVisible('#mh-her')) ? '#mh-her' : '#hero');
    await page.waitForTimeout(900);
    v = await view(page);
    ok(
      `[${scheme}] tapping her returns to now`,
      !v.now && (await atNow(page)),
      JSON.stringify({ top: v.scrollTop, max: v.maxScroll })
    );
    // B-152 (D-176): the history pull block is advisory: its sub-checks are judged as one, printed, and a miss runs the
    // block once more in place after the Back to now pill folds the earlier conversations away.
    const pullBlock = async () => {
      const sub = [];
      const ck = (name, cond, detail = '') => sub.push([cond ? 'PASS' : 'FAIL', name, detail]);
      // Pull to load: noon (4), then this morning (3), then the start of today; last night is never loaded.
      let held = await pullOnce(page);
      ck(
        `[${scheme}] holding at the top names the noon conversation's 4 messages`,
        held === 'Hold for 4 earlier messages',
        held
      );
      await page.screenshot({ path: `${shots}/captions-pull-${scheme}.png` });
      await page.waitForTimeout(50); // B-250: no pause; the lines are there as the hold lands
      v = await view(page);
      const earlier = v.texts.filter(t => t.startsWith('E:'));
      ck(
        `[${scheme}] the noon conversation is back above, with his lines small`,
        earlier.length === 4 &&
          earlier.some(t => /Harness noon line two/.test(t)) &&
          earlier.some(t => /^E:M:harness noon: explain afterload/.test(t)) &&
          !v.texts.some(t => /morning/.test(t)),
        JSON.stringify(earlier)
      );
      held = await pullOnce(page);
      ck(`[${scheme}] the next pull names this morning's 3`, held === 'Hold for 3 earlier messages', held);
      await page.waitForTimeout(50);
      v = await view(page);
      ck(
        `[${scheme}] this morning is back too`,
        v.texts.filter(t => t.startsWith('E:')).length === 7 && v.texts.some(t => /Harness morning line/.test(t))
      );
      const mattPx = await page.evaluate(() => {
        const m = [...document.querySelectorAll('#thread .msg.matt')].find(x => getComputedStyle(x).display !== 'none');
        return m ? getComputedStyle(m.querySelector('.bubble')).fontSize : null;
      });
      ck(`[${scheme}] his earlier lines are ${A.matt}, grey`, mattPx === A.matt, String(mattPx));
      await pullOnce(page);
      await page.waitForTimeout(1000);
      v = await view(page);
      ck(
        `[${scheme}] then: That's the start of today, and last night stays out`,
        v.pull === 'That’s the start of today' && !v.texts.some(t => /harness night|Harness night/.test(t)),
        JSON.stringify({ pull: v.pull, n: v.texts.length })
      );
      await page.screenshot({ path: `${shots}/captions-start-of-today-${scheme}.png` });
      // D-128 as amended: the next full pull goes on into earlier days, one conversation at a time under a date divider,
      // and stops at the read window's edge.
      const divs = () =>
        page.evaluate(() => [...document.querySelectorAll('#thread .cap-day')].map(d => d.textContent));
      held = await pullAgain(page);
      ck(
        `[${scheme}] past today, the next full pull names last night's 2`,
        held === 'Hold for 2 earlier messages',
        held
      );
      await page.waitForTimeout(50);
      v = await view(page);
      let dv = await divs();
      ck(
        `[${scheme}] last night comes back under Yesterday, today's under Today`,
        v.texts.some(t => /Harness night line/.test(t)) && dv.join() === 'Yesterday,Today',
        JSON.stringify(dv)
      );
      held = await pullAgain(page);
      ck(`[${scheme}] then the conversation two days ago, its 3`, held === 'Hold for 3 earlier messages', held);
      await page.waitForTimeout(50);
      v = await view(page);
      dv = await divs();
      ck(
        `[${scheme}] under its own date (${dayLabel(twoAgo)})`,
        v.texts.some(t => /Harness two days ago line/.test(t)) &&
          dv.join() === [dayLabel(twoAgo), 'Yesterday', 'Today'].join(),
        JSON.stringify(dv)
      );
      await pullAgain(page);
      await page.waitForTimeout(1000);
      v = await view(page);
      ck(
        `[${scheme}] then: That's everything from the last 7 days, and nine days ago stays out`,
        v.pull === 'That’s everything from the last 7 days' && !v.texts.some(t => /nine days ago/.test(t)),
        JSON.stringify({ pull: v.pull })
      );
      return sub;
    };
    await advisory(
      results,
      'captions-history-pull',
      `[${scheme}] the history pull (D-128): noon, this morning, the start of today, then earlier days under their dates to the read window's edge`,
      pullBlock,
      allPass,
      {
        reset: async () => {
          if (await page.isVisible('#ev-now')) await page.click('#ev-now');
          await page.waitForTimeout(900);
        },
      }
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
    // B-78 (D-123, D-125): a reply's cards are surfaces. The first opens under its head line (title and state, a
    // chevron) and the others wait as one-line rows under that line, never pills; a row opens in place and folds the
    // open one to a row; the head line folds the surface to that line and unfolds it. Below 1024 px the surface is the
    // sheet over the composer, from 1024 px the side column. She glances toward a surface as it opens.
    await page.evaluate(() => {
      window.__chatScript = [
        { tool: 'show_card', input: { type: 'dates', days: 14 } },
        { tool: 'show_card', input: { type: 'quizlet' } },
        { tool: 'show_card', input: { type: 'review' } },
      ];
      window.__chatPre = '';
      window.__chatReply = 'Here is the next two weeks. Nine things are dated.';
    });
    const logAt = await page.evaluate(() => window.EVApp.core.stats().log.length);
    await page.fill('#ev-input', 'what is coming up');
    await page.click('#ev-send');
    await page.waitForTimeout(4500);
    const sfView = () =>
      page.evaluate(() => {
        const t = document.getElementById('thread').getBoundingClientRect(),
          hero = document.getElementById('hero'),
          cur = document.querySelector('#thread .msg.ev.current'),
          b = cur.querySelector('.bubble').getBoundingClientRect(),
          s = document.getElementById('ev-surf'),
          r = s && s.getBoundingClientRect(),
          head = s && s.querySelector('.sf-head');
        // a pill standing for a card: the old "n more cards", or a surface line drawn as a pill
        const pills = [
          ...document.querySelectorAll('.cap-cards-more'),
          ...[...document.querySelectorAll('#ev-surf .sf-head, #ev-surf .sf-row')].filter(x =>
            /999px/.test(getComputedStyle(x).borderRadius)
          ),
        ];
        return {
          step: hero.dataset.step,
          stage: Math.round(hero.getBoundingClientRect().height),
          inThread: cur.querySelectorAll('.ev-card, .card-line').length,
          head: head && head.querySelector('.sf-t').textContent,
          open: head && head.getAttribute('aria-expanded') === 'true',
          rows: s ? [...s.querySelectorAll('.sf-row .sf-t')].map(x => x.textContent) : [],
          rowH: s ? [...s.querySelectorAll('.sf-row')].map(x => Math.round(x.getBoundingClientRect().height)) : [],
          cards: s ? s.querySelectorAll('.sf-body .ev-card').length : 0,
          type: s && s.dataset.type,
          pills: pills.length,
          closers: s
            ? [...s.querySelectorAll('button')].filter(x => /^(close|hide|×|x)$/i.test(x.textContent.trim())).length
            : 0,
          surf: r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          line: [Math.round(b.top), Math.round(b.bottom)],
          thread: [Math.round(t.top), Math.round(t.bottom), Math.round(t.right)],
          comp: Math.round(document.getElementById('composer').getBoundingClientRect().top),
          surfaceOpen: document.body.classList.contains('surface-open'),
        };
      });
    const lc = await sfView();
    const listStage = A.stage; // B-209 (D-213): a surface does not step her down
    ok(
      `[${scheme}] a reply with three cards opens one surface with two rows under its head line, no pill and no close; none under her line`,
      lc.cards === 1 &&
        lc.open &&
        /^\d+ dates? in the next two weeks$/.test(lc.head || '') &&
        lc.rows.length === 2 &&
        lc.rows[0] === 'Quizlet' &&
        /^Review · /.test(lc.rows[1]) &&
        lc.rowH.every(h => h <= 48) &&
        !lc.pills &&
        !lc.closers &&
        !lc.inThread,
      JSON.stringify(lc)
    );
    ok(
      `[${scheme}] an open surface keeps her at her size (the ${scheme === 'phone' ? 'list' : 'surface'} step, D-213)`,
      lc.step === (scheme === 'phone' ? 'list' : 'surface') &&
        lc.stage >= listStage[0] &&
        lc.stage <= listStage[1] &&
        lc.surfaceOpen,
      JSON.stringify(lc)
    );
    ok(
      scheme === 'phone'
        ? '[phone] below 1200 px the surface is the sheet over the composer, at most 410 px tall'
        : '[desktop] from 1200 px the surface is the details panel beside her captions',
      scheme === 'phone'
        ? lc.surf && lc.surf[1] >= lc.thread[1] - 1 && lc.surf[1] + lc.surf[3] <= lc.comp + 1 && lc.surf[3] <= 410
        : lc.surf && lc.surf[0] >= lc.thread[2],
      JSON.stringify(lc)
    );
    ok(
      `[${scheme}] her line stays in view`,
      lc.line[0] >= lc.thread[0] - 1 && lc.line[1] <= lc.thread[1] + 1,
      JSON.stringify(lc)
    );
    const glanced = await page.evaluate(
      at =>
        window.EVApp.core
          .stats()
          .log.slice(at)
          .some(e => e.kind === 'gesture' && e.name === 'glance'),
      logAt
    );
    ok(`[${scheme}] she glances toward the surface as it opens (the core's event log)`, glanced);
    await page.screenshot({ path: `${shots}/captions-surface-${scheme}.png` });
    await page.click('#ev-surf .sf-row[data-type="quizlet"]');
    await page.waitForTimeout(300);
    const q = await sfView();
    ok(
      `[${scheme}] tapping a row opens it in place and folds the open one to a row`,
      q.head === 'Quizlet' &&
        q.open &&
        q.cards === 1 &&
        /^\d+ dates? in the next two weeks$/.test(q.rows[0] || '') &&
        /^Review · /.test(q.rows[1] || ''),
      JSON.stringify(q)
    );
    await page.click('#ev-surf .sf-head');
    await page.waitForTimeout(300);
    const f = await sfView();
    ok(
      `[${scheme}] its head line folds it to that one line (rows kept, her core back to the conversation size)`,
      f.head === 'Quizlet' &&
        !f.open &&
        f.cards === 0 &&
        f.rows.length === 2 &&
        f.step === 'conversation' &&
        !f.surfaceOpen,
      JSON.stringify(f)
    );
    await page.click('#ev-surf .sf-head');
    await page.waitForTimeout(300);
    const u = await sfView();
    ok(`[${scheme}] and unfolds from it`, u.head === 'Quizlet' && u.open && u.cards === 1, JSON.stringify(u));
    // A review answered in the surface: she nods, and its line reads Review · n of N folded and open.
    await page.click('#ev-surf .sf-row[data-type="review"]');
    await page.waitForTimeout(300);
    const r0 = await sfView();
    const answered = await page.evaluate(() => {
      const s = document.getElementById('ev-surf');
      const radios = {};
      for (const i of s.querySelectorAll('input[type=radio]')) if (!radios[i.name]) ((radios[i.name] = 1), i.click());
      const cb = s.querySelector('input[type=checkbox]');
      if (cb) cb.click();
      const num = s.querySelector('input.num-in');
      if (num) {
        num.value = '1';
        num.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const ta = s.querySelector('textarea');
      if (ta) {
        ta.value = 'Fluid shifts.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const b = [...s.querySelectorAll('button')].find(x => x.textContent === 'Check answer');
      if (!b || b.disabled) return false;
      b.click();
      return true;
    });
    await page.waitForTimeout(1200);
    const r1 = await sfView();
    const nodded = await page.evaluate(
      at =>
        window.EVApp.core
          .stats()
          .log.slice(at)
          .some(e => e.kind === 'gesture' && e.name === 'done'),
      logAt
    );
    await page.click('#ev-surf .sf-head');
    await page.waitForTimeout(300);
    const r2 = await sfView();
    await page.click('#ev-surf .sf-head');
    await page.waitForTimeout(300);
    const r3 = await sfView();
    const n0 = Number((/^Review · (\d+) of/.exec(r0.head || '') || [])[1]);
    ok(
      `[${scheme}] a review answered in the surface: she nods, it folds to Review · n of N and unfolds from that line`,
      answered &&
        nodded &&
        r1.head === `Review · ${n0 + 1} of ${(/of (\d+)$/.exec(r0.head || '') || [])[1]}` &&
        r2.head === r1.head &&
        !r2.open &&
        r3.open &&
        r3.cards === 1,
      JSON.stringify({ answered, nodded, r0: r0.head, r1: r1.head, r2: [r2.head, r2.open], r3: [r3.head, r3.open] })
    );
    // B-222 (D-227): the surface's next question paints its verdict on the tap's frame, the record 2 s behind.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#ev-surf button')].find(x =>
        /^Next (question|unanswered)/.test(x.textContent.trim())
      );
      if (b) b.click();
    });
    await page.waitForTimeout(200);
    const sfPaint = await paintAnswer(page, '#ev-surf');
    ok(
      `[${scheme}] a surface's set paints Check answer's verdict on the tap's frame, the record 2 s behind (D-227)`,
      painted(sfPaint),
      JSON.stringify(sfPaint)
    );
    await page.waitForTimeout(2200);
    // A reply with only cards that inform still opens one surface, its others as rows.
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
    const lo = await sfView();
    ok(
      `[${scheme}] the next reply's cards replace them: the first open, the rest rows, each its title and state`,
      lo.open &&
        /due now|No active weak spots/.test(lo.head || '') &&
        lo.rows.length === 2 &&
        /^(Today’s list · \d+ of \d+ done|Nothing on today’s list yet)$/.test(lo.rows[0]) &&
        /^(Last 7 days · \d+ of \d+ right \(\d+%\)|No answers in the last week yet)$/.test(lo.rows[1]),
      JSON.stringify(lo)
    );
    await page.screenshot({ path: `${shots}/captions-line-cards-${scheme}.png` });
    // B-360 (D-316): the demo's chips stay, one row, in a conversation too, typing or not; the composer stays.
    // below 1200 px an open surface is a sheet over the composer, and the chips wait under it (B-78)
    const sheet = await page.evaluate(() => document.body.classList.contains('surface-open') && innerWidth < 1200);
    const quietChips = sheet || (await page.isVisible('#qchips'));
    await page.fill('#ev-input', 'x');
    await page.waitForTimeout(100);
    const typed = sheet || (await page.isVisible('#qchips'));
    await page.fill('#ev-input', '');
    ok(
      `[${scheme}] the chips stay in a conversation, typing or not, beside a kept composer (B-360)`,
      quietChips && typed && (await page.isVisible('#ev-input')) && (await page.isVisible('#ev-send'))
    );
    if (scheme === 'desktop') {
      // D-122 as amended: the side column exists only while it holds something. With nothing in it her stage centres in
      // the window; with something (a stand-in for B-78's surface) it slides in from 1024 px and her stage re-centres in
      // what is left; below 1024 it wraps under the stage (D-159).
      const lay = async w => {
        await page.setViewportSize({ width: w, height: 860 });
        await page.waitForTimeout(700);
        // B-223: crossing 1200 px re-renders (Study's panel follows the width), which brings a removed surface back
        if (await page.evaluate(() => !!window.__noSurface && !!document.getElementById('ev-surf'))) {
          await page.evaluate(() => document.getElementById('ev-surf').remove());
          await page.waitForTimeout(150);
        }
        return page.evaluate(() => {
          const r = id => document.getElementById(id).getBoundingClientRect();
          const s = r('ev-side'),
            c = r('composer'),
            th = r('thread'),
            av = document.querySelector('#hero .ev-av').getBoundingClientRect();
          return {
            sideShown: getComputedStyle(document.getElementById('ev-side')).display !== 'none',
            // B-223 (D-315), B-290: with nothing beside her, from 1200 px the panel holds its resting content only:
            // the session card and Coming up
            datesOnly: [...document.getElementById('ev-side').children]
              .filter(c => getComputedStyle(c).display !== 'none')
              .every(c => c.id === 'ev-dates' || c.id === 'ev-sess'),
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
      // With no surface (taken off for this check; the next render brings it back).
      await page.evaluate(() => {
        window.__noSurface = true;
        const s = document.getElementById('ev-surf');
        if (s) s.remove();
      });
      const e1280 = await lay(1280),
        e900 = await lay(1024);
      ok(
        // B-208 (D-210): centred in the pane, which starts after the 212 px sidebar and ends 8 px from the edge; from
        // 1200 px (B-223, D-315) the right panel holds the dates after today, and the pane ends where it begins.
        "[desktop] with nothing beside her: at 1280 the panel holds only the session card and the dates, and her stage centres over her lines; at 1024 no side column (B-357: the demo's pane widths)",
        e1280.sideShown &&
          e1280.datesOnly &&
          Math.abs(e1280.coreX - (e1280.threadLeft + e1280.threadRight) / 2) <= 2 &&
          !e900.sideShown &&
          Math.abs(e900.coreX - (e900.threadLeft + e900.threadRight) / 2) <= 2,
        JSON.stringify({ e1280, e900 })
      );
      await page.evaluate(() => {
        window.__noSurface = false;
        const d = document.createElement('div');
        d.className = 'card';
        d.id = 'harness-surface';
        d.textContent = 'Harness surface (a stand-in for B-78)';
        document.getElementById('ev-side').append(d);
      });
      // B-210 (D-210): from 1200 px a surface is the details panel on the right (320 px, 380 from 2000); below, the
      // sheet over the composer.
      const at900 = await lay(1200),
        at899 = await lay(1199);
      ok(
        '[desktop] something beside her: at 1200 px it is the details panel on the right of the pane',
        at900.sideShown &&
          at900.sideLeft >= at900.threadRight &&
          at900.sideW >= 300 &&
          at900.sideW <= 400 &&
          at900.sideLeft + at900.sideW >= 1200 - 10,
        JSON.stringify(at900)
      );
      ok(
        '[desktop] at 1199 px it is the sheet over the composer, in the pane (B-78)',
        at899.sideShown && at899.sideTop < at899.comp.top && at899.sideLeft < at899.threadRight,
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
      await page.evaluate(() => {
        window.__noSurface = true;
        document.getElementById('harness-surface').remove();
        const s = document.getElementById('ev-surf');
        if (s) s.remove();
      });
      const back = await lay(1280);
      ok(
        '[desktop] emptied, what was beside her goes; the panel keeps the dates (D-315) and her stage centres in the pane',
        back.sideShown && back.datesOnly && Math.abs(back.coreX - (back.threadLeft + back.threadRight) / 2) <= 2,
        JSON.stringify(back)
      );
    }
    // B-265: a stored line that failed on a transient error (as after a reload) offers Try again, never Go deeper
    await page.evaluate(async () => {
      const db = await window.claude.use('db'),
        today = window.EVCore.chicagoDate(new Date()),
        t = Date.now(),
        stamp = ms => new Date(ms).toISOString(),
        mid = (ms, r) =>
          'm-' + stamp(ms).replace(/[-:]/g, '').replace('T', '-').replace('.', '').replace('Z', '') + '-' + r;
      const doc = (window.__db.talk || {})[today] || {
        schema: 4,
        writer: 'page',
        at: stamp(t),
        source: 'E.V. Home',
        date: today,
        messages: {},
      };
      const q = mid(t + 60000, 'matt');
      await db
        .collection('talk')
        .doc(today)
        .set({
          ...doc,
          messages: {
            ...(doc.messages || {}),
            [q]: { role: 'matt', text: 'Tell me my past exam scores', at: stamp(t + 60000) },
            [mid(t + 60200, 'ev')]: {
              role: 'ev',
              text: 'Connection hiccup. Tap Try again.',
              cards: [],
              error: 'upstream_error',
              replyTo: q,
              tier: 'quick',
              at: stamp(t + 60200),
            },
          },
        });
    });
    await page.waitForTimeout(600);
    const failed = await page.evaluate(() => {
      const m = [...document.querySelectorAll('#thread .msg.ev')].pop();
      const bs = m ? [...m.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
      return {
        text: m && m.textContent.slice(0, 60),
        tryAgain: bs.includes('Try again'),
        deeper: bs.includes('Go deeper'),
      };
    });
    ok(
      `[${scheme}] a stored failed line offers Try again, not Go deeper (B-265)`,
      failed.tryAgain && !failed.deeper,
      JSON.stringify(failed)
    );
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
        panelActs: !!document.querySelector('#skpanel .sk-step'),
        bar: (document.querySelector('#kbar .s-clock') || {}).textContent || null,
        barBtns: [...document.querySelectorAll('#kbar button')].map(b => b.textContent),
        barInHeader: !!document.querySelector('#mh > #kbar'),
        closers: [...document.querySelectorAll('button,[role=button]')]
          .map(b => b.textContent.trim() || b.getAttribute('aria-label') || '')
          .filter(t => /^(hide|close|dismiss)\b|^[×✕✖]$/i.test(t)),
        // B-78: a reply's card is a surface (#ev-surf), not under her line
        cards: cur ? document.querySelectorAll('#ev-surf .sf-body .ev-card').length : -1,
        cardText: (document.querySelector('#ev-surf .sf-body .ev-card') || { textContent: '' }).textContent.slice(
          0,
          160
        ),
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
      `[skills ${scheme}] beside her name, her status word; the readout code has left the screen (D-210)`,
      // B-352, B-361 (D-316): the demo's status words
      /^(online|ready when you are|replying|listening|thinking…?|working|in a session|on a break|check ready|resting|something’s ready)\b/.test(
        (await skillView(page)).unit
      ) && !/EV-04/.test((await skillView(page)).unit),
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
      `[skills ${scheme}] a run starts: her line carries no card; the step is in the pane${phone ? '' : ', the list in the right panel'} (D-217)`,
      v.cards === 0 && v.sheet && (phone ? !v.panel : v.panel),
      JSON.stringify(v)
    );
    ok(
      `[skills ${scheme}] her core steps to the skills size (${phone ? "D-122's 44%" : 'the surface step'})`,
      v.step === (phone ? 'skills' : 'surface'),
      JSON.stringify(v)
    );
    ok(
      `[skills ${scheme}] the pane header bar says Step 1 of 6 and holds End; the pane and the panel hold no End and no Hide (D-217)`,
      v.barInHeader &&
        v.bar === 'Step 1 of 6' &&
        v.barBtns.join(',') === 'End' &&
        /Step 1 of 6$/.test(v.count) &&
        !v.minis.length &&
        !v.panelBtns.some(b => /^(End|Hide|Stop)$/.test(b)),
      JSON.stringify({ bar: v.bar, barBtns: v.barBtns, count: v.count, minis: v.minis, panelBtns: v.panelBtns })
    );
    ok(
      `[skills ${scheme}] no button named Hide, Close or × anywhere on the page`,
      !v.closers.length,
      JSON.stringify(v.closers)
    );
    await page.screenshot({ path: `${shots}/skills-run-${scheme}.png` });
    await page.click('#sksheet .sk-acts button:has-text("Did it")');
    await page.waitForTimeout(500);
    // The way out is the thing folding: the peek line on the phone, the head line beside her on the desktop.
    if (phone) {
      await page.click('#sksheet .sk-tog');
      await page.waitForTimeout(300);
      const o = await skillView(page);
      await page.click('#sksheet .sk-tog');
      await page.waitForTimeout(300);
      v = await skillView(page);
      ok(
        `[skills ${scheme}] the peek line unfolds the sheet to the whole list and folds it again`,
        o.sheetOpen && !v.sheetOpen && v.sheet && /Step 2 of 6$/.test(v.count),
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
    await page.click('#kbar button:has-text("End")');
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
      v.sheet &&
        /Step 2 of 6$/.test(v.count) &&
        v.bar === 'Step 2 of 6' &&
        (phone || v.panel) &&
        !v.chips.some(c => /^Resume /.test(c)),
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
    // B-358 (D-316): the chips are the demo's five; File it is asked in words, and she answers it
    const before = await page.locator('#thread .msg.ev').count();
    await page.fill('#ev-input', 'File it');
    await page.click('#ev-send');
    await page.waitForTimeout(1200);
    ok(
      "[phone] with the reader unreachable, the demo's five chips, and File it asked in words gets her answer",
      chips.length === 5 &&
        chips[0] === 'Start a study session' &&
        (await page.locator('#thread .msg.ev').count()) > before,
      JSON.stringify(chips)
    );
    await ctx.close();
  }
  // B-122 (D-161): a session's check folds to its head line by a tap on it and back, files nothing, and the next
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
        // B-78: the check is a surface; its head line (#ev-surf .sf-head) folds it.
        const c = document.getElementById('ev-surf');
        if (!c || c.dataset.type !== 'check') return null;
        const f = c.querySelector('.sf-head .sf-t') && c.querySelector('.sf-head'),
          r = c.getBoundingClientRect();
        return {
          head: f && f.querySelector('.sf-t').textContent,
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
        .waitForFunction(() => document.querySelector('#ev-surf .sf-head'), null, { timeout: 8000 })
        .catch(() => {});
      await page.waitForTimeout(800);
      const c0 = await card(page),
        w0 = c0 && c0.writes;
      await page.click('#ev-surf .sf-head');
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
      await page.click('#ev-surf .sf-head');
      await page.waitForTimeout(300);
      const c2 = await card(page);
      ok(`[check ${tag}] a second tap unfolds it`, c2 && c2.items && c2.expanded === 'true', JSON.stringify(c2));
      await page.click('#ev-surf .sf-head');
      await page.waitForTimeout(200);
      // The next checkpoint: a new check arrives open, the folded one stays folded.
      await page.waitForTimeout(1100);
      await post(page, 2);
      await page
        .waitForFunction(
          () => /Check 2/.test((document.querySelector('#ev-surf .sf-head') || {}).textContent || ''),
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
  // B-75 (D-132, D-165): an open check answered in his own words, once graded by the stubbed model and once offline
  // (the model call failing): the verdict one line, hit and missed points as lines, Checked offline, Add to it once.
  {
    const SET = 'check-ss-harness-open-2';
    const ITEM = {
      id: 'o1',
      kind: 'check',
      type: 'open',
      stem: 'Why does 0.45% saline move water into the cells?',
      keyPoints: [
        { text: 'It is hypotonic to the blood', keywords: [['hypotonic']] },
        { text: 'Water moves toward the higher concentration in the cells', keywords: [['water'], ['cell']] },
      ],
      modelAnswer: 'Half-normal saline is hypotonic, so water moves by osmosis into the cells, which hold more solute.',
      sourceRef: 'note/x-coredata://open#0.45% saline is hypotonic',
      topic: 'Hypotonic fluids',
    };
    const openSeed = () => {
      const db = JSON.parse(JSON.stringify(seed)),
        t0 = new Date(NOW.getTime() - 20 * 60e3).toISOString();
      db.sessions = {
        ...(db.sessions || {}),
        'ss-harness-open': {
          schema: 2,
          writer: 'page',
          at: t0,
          source: 'E.V. Home',
          status: 'active',
          date: today,
          startedAt: t0,
          topic: 'Harness open check',
          noteId: 'x-coredata://open',
          driver: { view: 'gone', at: t0 },
          events: { ['start-' + t0.replace(/[-:.TZ]/g, '').slice(0, 14)]: { type: 'start', at: t0 } },
        },
      };
      db.sets = {
        ...(db.sets || {}),
        [SET]: {
          schema: 3,
          writer: 'page',
          at: t0,
          source: 'Study session',
          kind: 'check',
          title: 'Check 2 · Harness open check',
          date: today,
          exam: null,
          items: [ITEM],
        },
      };
      return db;
    };
    const post = page =>
      page.evaluate(
        async ({ today, SET, stem }) => {
          const db = await window.claude.use('db'),
            at = new Date(Date.now()).toISOString(),
            id = 'm-' + at.replace(/[-:]/g, '').replace('T', '-').replace('.', '').replace('Z', '') + '-ev';
          const doc = (window.__db.talk || {})[today] || {
            schema: 2,
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
                  text: 'One question on what you just wrote. Answer it in your own words.',
                  cards: [
                    {
                      type: 'check',
                      session: 'ss-harness-open',
                      n: 2,
                      format: 'open',
                      setId: SET,
                      items: [{ text: stem, kind: 'why' }],
                    },
                  ],
                  at,
                  tier: 'quick',
                },
              },
            });
        },
        { today, SET, stem: ITEM.stem }
      );
    const read = page =>
      page.evaluate(SET => {
        const c = [...document.querySelectorAll('#ev-surf .ev-card.check')].pop();
        const att = Object.values(((window.__db.answers || {})[SET] || { answers: {} }).answers.o1 || {}).pop() || null;
        return {
          verdict: c && (c.querySelector('.verdict') || {}).textContent,
          given: c && (c.querySelector('.open-given') || {}).textContent,
          points: c ? [...c.querySelectorAll('.open-points li')].map(l => l.className + ':' + l.textContent) : [],
          offline: !!(c && c.querySelector('.open-offline')),
          add: !!(c && c.querySelector('.open-add')),
          added: c && (c.querySelector('.open-added') || {}).textContent,
          att,
        };
      }, SET);
    for (const [tag, vp, mode] of [
      [390, { width: 390, height: 844 }, 'model'],
      [1280, { width: 1280, height: 860 }, 'offline'],
    ]) {
      const ctx = await browser.newContext({ viewport: vp, colorScheme: 'dark' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openPage(page, openSeed());
      await page.waitForTimeout(1500);
      await page.evaluate(mode => {
        window.__sampleFn =
          mode === 'model'
            ? p => (/Key points:/.test(p) ? { hits: [true, false] } : { items: [] })
            : () => {
                const e = new Error('stub');
                e.code = 'upstream_error';
                throw e;
              };
      }, mode);
      await post(page);
      await page.waitForSelector('#ev-surf .ev-card.check textarea.open-in', { timeout: 8000 }).catch(() => {});
      await page.fill(
        '#ev-surf .ev-card.check textarea.open-in',
        mode === 'model'
          ? 'It pulls water toward where there is more stuff.'
          : 'Half-normal saline is hypotonic, so water moves into each cell.'
      );
      // B-222 (D-227): an open answer shows Checking… until grading returns, then its verdict at once, before the
      // record's write (2 s behind) lands.
      const openPaint = await paintAnswer(page, '#ev-surf .ev-card.check');
      ok(
        `[open ${tag}] a session check's open answer paints its verdict when grading returns, before the record (D-227)`,
        painted(openPaint),
        JSON.stringify(openPaint)
      );
      await page.waitForSelector('#ev-surf .ev-card.check .verdict', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2400);
      const r = await read(page);
      if (mode === 'model') {
        ok(
          `[open ${tag}] graded by the model: Partly right, one point hit and one missed, as lines under his answer`,
          /^Partly right/.test(r.verdict || '') &&
            r.points.length === 2 &&
            /^hit:Hit: It is hypotonic/.test(r.points[0]) &&
            /^miss:Missed: Water moves/.test(r.points[1]) &&
            !r.offline &&
            r.att &&
            r.att.gradedBy === 'model' &&
            r.att.grade === 'partial' &&
            r.att.correct === false,
          JSON.stringify(r)
        );
        await page.click('#ev-surf .ev-card.check .open-add');
        await page.fill('#ev-surf .ev-card.check textarea.open-in', 'Water follows the solute into the cells.');
        await page.click('#ev-surf .ev-card.check button:has-text("Save")');
        await page.waitForTimeout(600);
        const r2 = await read(page);
        ok(
          `[open ${tag}] Add to it once: stored on the same attempt, the grade unchanged, offered no more`,
          r2.att &&
            r2.att.added === 'Water follows the solute into the cells.' &&
            r2.att.grade === 'partial' &&
            /^Partly right/.test(r2.verdict || '') &&
            /You added: Water follows/.test(r2.added || '') &&
            !r2.add,
          JSON.stringify(r2)
        );
      } else
        ok(
          `[open ${tag}] the model call failing, the keyword groups grade it: Right, Checked offline`,
          /^Right/.test(r.verdict || '') &&
            r.points.every(p => p.startsWith('hit:')) &&
            r.offline &&
            r.att &&
            r.att.gradedBy === 'local' &&
            r.att.grade === 'right',
          JSON.stringify(r)
        );
      const c = await page.$('#ev-surf .ev-card.check');
      if (c) await c.screenshot({ path: `${shots}/open-check-${mode}-${tag}.png` });
      ok(`[open ${tag}] no page errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
  // B-112 (D-315): at short heights (390x450 is the phone with its keyboard open) the composer's bottom edge and her
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
          // B-368: her greeting's visible line is its summary line
          cur = document.querySelector('#thread .msg.ev.current .bubble, #thread .msg.ev.current .brief-line'),
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
    for (const w of [560, 735, 960, 1199, 1200, 1470]) {
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
      await page.waitForTimeout(1200);
      const v = await layout(page),
        desk = w >= 1200; // B-210: the details panel from 1200 px
      ok(
        // B-208: the sections' layout is the shell's (shell.cjs); the side column keeps 1024 px until B-210 moves it.
        // B-362 (D-316): no notes card and no Reading line in a session; the session card is the side column's from 1200
        `[breakpoints ${w}] in a session, ${desk ? 'the side column beside her' : 'no side column'}; no sideways scroll`,
        !v.sideways && (desk ? v.sideColumn : !v.sideColumn),
        JSON.stringify(v)
      );
      if ([735, 960].includes(w)) await page.screenshot({ path: `${shots}/breakpoints-${w}.png` });
      await ctx.close();
    }
  }
  // B-289 (D-213, C-2, C-3, C-15): her stage and captions, measured. Her flower is 104 px at 390, 140 px at 1280 x 900
  // and 168 px when taller than 1000 px, 70% of that in a session; her current line 20 px, earlier lines 15 px on the
  // phone and 14 px at 1280; her two faces are her own palette (--av1, --av2), never the accent. Light and dark, idle
  // and in a session (on desktop the session's notes beside her name the step 'surface'; her size is the session's),
  // each screenshotted.
  {
    const FZ = spec.ui.look.flower.sizes;
    const inSession = () => {
      const db = JSON.parse(JSON.stringify(seed)),
        t0 = new Date(NOW.getTime() - 3 * 60e3).toISOString(),
        k = 'start-' + t0.replace(/[-:.TZ]/g, '').slice(0, 14);
      db.sessions = {
        ...(db.sessions || {}),
        'ss-harness-stage': {
          schema: 1,
          writer: 'page',
          at: t0,
          source: 'E.V. Home',
          status: 'active',
          date: today,
          startedAt: t0,
          topic: 'Harness stage',
          noteId: 'x-coredata://stage',
          driver: { view: 'gone', at: t0 },
          events: { [k]: { type: 'start', at: t0, len: 5, h: 'zz', noteId: 'x-coredata://stage' } },
        },
      };
      return db;
    };
    for (const [tag, vp, idle, past] of [
      ['390', { width: 390, height: 844 }, FZ.phone, '15px'],
      ['1280x900', { width: 1280, height: 900 }, FZ.wide, '14px'],
      ['1280x1100', { width: 1280, height: 1100 }, FZ.wideTall, '14px'],
    ])
      for (const scheme of ['light', 'dark'])
        for (const state of ['idle', 'session']) {
          const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme });
          const page = await ctx.newPage();
          await openPage(page, state === 'session' ? inSession() : seed);
          if (state === 'session')
            await page
              .waitForFunction(
                () => ['session', 'surface'].includes(document.getElementById('hero').dataset.step),
                null,
                {
                  timeout: 8000,
                }
              )
              .catch(() => {});
          else await send(page, 'explain preload', REPLY);
          await page.waitForTimeout(2500);
          const v = await page.evaluate(() => {
            const av = document.querySelector('#hero .ev-av'),
              root = getComputedStyle(document.documentElement),
              c1 = av && av.querySelector('.c1'),
              c2 = av && av.querySelector('.c2'),
              size = sel => {
                const e = document.querySelector(sel);
                return e ? getComputedStyle(e).fontSize : null;
              };
            return {
              step: document.getElementById('hero').dataset.step,
              px: Math.round(av.getBoundingClientRect().width),
              now: size('#thread .msg.ev.current .bubble'),
              past: size('#thread .msg.ev:not(.current) .bubble'),
              face: c1 && getComputedStyle(c1).fill,
              back: c2 && getComputedStyle(c2).fill,
              av1: root.getPropertyValue('--av1').trim(),
              av2: root.getPropertyValue('--av2').trim(),
              accent: root.getPropertyValue('--accent').trim(),
            };
          });
          const want = state === 'session' ? Math.round(idle * FZ.sessionShare) : idle;
          ok(
            `[stage ${tag} ${scheme} ${state}] her flower measures ${want} px (D-213)`,
            v.px === want,
            JSON.stringify(v)
          );
          // B-357 (D-315): her lines' sizes are the demo's (C-2's 20 px and 14/15 px retired)
          const hex = c =>
            /^#/.test(String(c))
              ? String(c).toLowerCase()
              : '#' +
                (String(c).match(/\d+/g) || [])
                  .slice(0, 3)
                  .map(n => (+n).toString(16).padStart(2, '0'))
                  .join('');
          ok(
            `[stage ${tag} ${scheme} ${state}] her faces come from her own palette, not the accent (C-15)`,
            !!v.face &&
              !!v.back &&
              hex(v.face) === v.av1.toLowerCase() &&
              hex(v.back) === v.av2.toLowerCase() &&
              ![hex(v.face), hex(v.back)].includes(hex(v.accent)),
            JSON.stringify(v)
          );
          await page.screenshot({ path: `${shots}/stage-${tag}-${scheme}-${state}.png` });
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
  // B-78 (D-123, D-125, D-126): the surfaces at 390, 735 and 1280 px. A reply with three cards opens one surface with
  // two rows under its head line; a library
  // citation in her current line and in an earlier one opens the passage (file, page, Read from here) in place of the
  // open surface, which folds to a row under it.
  {
    const sf = page =>
      page.evaluate(() => {
        const s = document.getElementById('ev-surf');
        if (!s) return null;
        return {
          type: s.dataset.type,
          head: s.querySelector('.sf-head .sf-t').textContent,
          open: s.querySelector('.sf-head').getAttribute('aria-expanded') === 'true',
          rows: [...s.querySelectorAll('.sf-row .sf-t')].map(x => x.textContent),
          body: (s.querySelector('.sf-body') || { textContent: '' }).textContent,
          read: [...s.querySelectorAll('button')].some(b => b.textContent === 'Read from here'),
          pills: document.querySelectorAll('.cap-cards-more').length,
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
      await openPage(page, skillSeed());
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        window.__chatScript = [
          { tool: 'show_card', input: { type: 'review' } },
          { tool: 'show_card', input: { type: 'today', filter: 'open' } },
          { tool: 'show_card', input: { type: 'dates', days: 7 } },
        ];
        window.__chatPre = '';
        window.__chatReply = 'The bath starts with hand hygiene (Harness Skills Packet, p. 4). Three things below.';
      });
      await page.fill('#ev-input', 'what now');
      await page.click('#ev-send');
      await page.waitForTimeout(4500);
      const s0 = await sf(page);
      ok(
        `[surfaces ${tag}] a reply with three cards opens one surface with two rows under its head line, no pill`,
        s0 &&
          s0.type === 'review' &&
          s0.open &&
          /^Review · \d+ of \d+$/.test(s0.head) &&
          s0.rows.length === 2 &&
          /^Today’s list · /.test(s0.rows[0]) &&
          /in the next week$/.test(s0.rows[1]) &&
          !s0.pills,
        JSON.stringify(s0)
      );
      // B-357: the old look tenets' checks on the open surface are retired (D-315)
      // B-244: the review card in the surface reads no larger than her line above it
      const sizes = await page.evaluate(() => {
        const px = q => {
          const e = document.querySelector(q);
          return e ? parseFloat(getComputedStyle(e).fontSize) : null;
        };
        return { line: px('#thread .msg.ev.current .bubble'), stem: px('#ev-surf .q-stem'), opt: px('#ev-surf .opt') };
      });
      ok(
        `[surfaces ${tag}] the card's question is no larger than her line, its options smaller`,
        sizes.line && sizes.stem && sizes.opt && sizes.stem <= sizes.line && sizes.opt < sizes.line,
        JSON.stringify(sizes)
      );
      await page.screenshot({ path: `${shots}/surfaces-${tag}.png` });
      await page.evaluate(() => {
        window.__chatScript = [];
        window.__chatReply = 'Then the rail goes up before you step away (Harness Skills Packet, p. 5).';
      });
      await page.fill('#ev-input', 'and then');
      await page.click('#ev-send');
      await page.waitForTimeout(4500);
      await page.click('#thread .msg.ev.current a.cite');
      await page.waitForTimeout(400);
      const s1 = await sf(page);
      ok(
        `[surfaces ${tag}] a citation in her current line opens the passage in place, the open surface folding to a row`,
        s1 &&
          s1.type === 'material' &&
          s1.open &&
          s1.head === 'Harness Skills Packet, p. 5' &&
          /Raise the bed rail/.test(s1.body) &&
          s1.read &&
          s1.rows.length === 3 &&
          /^Review · /.test(s1.rows[0]),
        JSON.stringify(s1)
      );
      await page.screenshot({ path: `${shots}/surfaces-cite-${tag}.png` });
      await page.evaluate(() => {
        const a = [...document.querySelectorAll('#thread .msg.ev:not(.current) a.cite')].pop();
        a.scrollIntoView({ block: 'center' });
      });
      await page.waitForTimeout(200);
      await page.locator('#thread .msg.ev:not(.current) a.cite').last().click();
      await page.waitForTimeout(400);
      const s2 = await sf(page);
      ok(
        `[surfaces ${tag}] a citation in an earlier line opens its passage, the previous one folding to a row`,
        s2 &&
          s2.head === 'Harness Skills Packet, p. 4' &&
          /Perform hand hygiene/.test(s2.body) &&
          s2.rows.includes('Harness Skills Packet, p. 5'),
        JSON.stringify(s2)
      );
      ok(
        `[surfaces ${tag}] no sideways scroll`,
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
      );
      ok(`[surfaces ${tag}] no page errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
  // B-248, B-249: at his laptop's pane (1150 wide, short and tall), folding the review surface and scrolling up through
  // a pull never flip her in and out: each frame is sampled (Back to now, her stage's height, her latest line's top).
  {
    const watch = (page, ms) =>
      page.evaluate(
        ms =>
          new Promise(res => {
            const out = [],
              t0 = performance.now();
            const tick = () => {
              const n = document.querySelector('.cap-now'),
                cur = document.querySelector('#thread .msg.ev.current');
              out.push({
                back: !!n && !n.hidden,
                hero: Math.round(document.getElementById('hero').getBoundingClientRect().height),
                top: cur ? Math.round(cur.getBoundingClientRect().top) : null,
              });
              if (performance.now() - t0 < ms) requestAnimationFrame(tick);
              else res(out);
            };
            tick();
          }),
        ms
      );
    const flips = (xs, f) => xs.slice(1).filter((x, i) => f(x) !== f(xs[i])).length;
    for (const vp of [
      { width: 1150, height: 700 },
      { width: 1150, height: 840 },
    ]) {
      const tag = `${vp.width}x${vp.height}`;
      const ctx = await browser.newContext({ viewport: vp, colorScheme: 'light' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openPage(page);
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        window.__chatScript = [{ tool: 'show_card', input: { type: 'review' } }];
        window.__chatPre = '';
        window.__chatReply = '10 reviews left. One at a time; every answer updates your weak spots.';
      });
      await page.fill('#ev-input', 'show me the review here'); // B-362: typed Start review is the local one-line answer
      await page.click('#ev-send');
      await page.waitForTimeout(4500);
      await page.click('#ev-surf .sf-head');
      await page.waitForTimeout(800);
      await page.click('#ev-surf .sf-head');
      await page.waitForTimeout(800);
      const w = watch(page, 900);
      await page.click('#ev-surf .sf-head');
      const f = await w;
      ok(
        `[jank ${tag}] folding the review surface at now shows no Back to now and keeps her stage (B-248)`,
        !f.some(x => x.back) && Math.max(...f.map(x => x.hero)) - Math.min(...f.map(x => x.hero)) <= 1,
        JSON.stringify({ back: f.filter(x => x.back).length, hero: [...new Set(f.map(x => x.hero))] })
      );
      const b = await (await page.$('#thread')).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      const s = watch(page, 4200);
      for (let i = 0; i < 40; i++) {
        await page.mouse.wheel(0, -40);
        await page.waitForTimeout(60);
      }
      const r = await s;
      const jumps = r
        .slice(1)
        .map((x, i) => (x.top != null && r[i].top != null ? Math.abs(x.top - r[i].top) : 0))
        .filter(d => d > 90);
      ok(
        `[jank ${tag}] scrolling up through a pull: Back to now comes once, her stage folds at most once and never comes back, no jump (B-249)`,
        flips(r, x => x.back) <= 1 &&
          flips(r, x => x.hero > 30) <= 1 &&
          !(r[r.length - 1].hero > 30 && r.some(x => x.hero <= 30)) &&
          !jumps.length,
        JSON.stringify({ back: flips(r, x => x.back), hero: flips(r, x => x.hero > 30), jumps })
      );
      await page.screenshot({ path: `${shots}/jank-pull-${tag}.png` });
      ok(`[jank ${tag}] no page errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
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
  for (const [s, n, d] of results) console.log(s, n, d);
  console.error(
    'CRASHED',
    e.message,
    '\n',
    String(e.stack || '')
      .split('\n')
      .filter(l => /harness\//.test(l))
      .join('\n')
  );
  process.exit(1);
});
