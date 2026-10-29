// B-405 (D-327): the L-frame on desktop. At 1280, 1706 and 2560 on every view (Today, Study, Progress, Record, Notes
// once the page has its tab, and Conversation): the raised page ends above a 38 px strip holding the session-controls
// slot, her suggestion and the E.V. button; the button opens a chat that floats over the page, bottom right, and the
// page under it does not move; Escape closes it. On Today, one chat end to end: a line sent in the pop-up is answered
// by chat() in its own thread (talk lines carry `thread`, the model sees only that thread), minimize leaves a chip that
// reopens it, close writes talk/<day>.closed, history lists it and reopens it, and after a reload history still has it.
// On Conversation the button focuses the view's own composer and the pop-up's lines are not in its thread. At 390 the
// strip and the pop-up are absent (the phone layout is unchanged). B-406: a Notes session's controls are in the strip
// on every view at each width, its long title cut short and clear of her line and the button; the phone shows it in
// the header's line. B-428: in the installed phone app (the PWA shell's safe-area padding, touch) E.V.'s frame never
// scrolls under a swipe on the composer or chips, the thread does, and the other views still scroll.
//   node test/harness/frame.cjs [record dir | synthetic] [screenshots dir]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const dbDir = require('../data/synthetic.cjs').recordDir(args[0] || 'synthetic');
const shots = args[1] || '/tmp/ev4-frame';
fs.mkdirSync(shots, { recursive: true });
const pageDir = path.join(root, 'dist/page/staging');
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html' };

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
for (const c of ['system', 'legacy', 'debug', 'journal']) delete seed[c];
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  body +
  '</body></html>';

const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const until = (page, fn, arg, ms = 4000) =>
  page
    .waitForFunction(fn, arg, { timeout: ms })
    .then(() => true)
    .catch(() => false);

async function open(ctx, db) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route(ORIGIN + '/**', r => {
    const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
    const f = path.join(pageDir, name);
    if (name === 'index.html')
      return r.fulfill({ body: skeleton(fs.readFileSync(f, 'utf8')), contentType: 'text/html' });
    return fs.existsSync(f)
      ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' })
      : r.fulfill({ status: 404, body: 'not published' });
  });
  await page.addInitScript('window.__db=' + JSON.stringify(db) + ';' + stub);
  await page.goto(ORIGIN + '/');
  await until(page, () => /^Live$/.test((document.getElementById('status') || {}).textContent || ''), null, 8000);
  return { page, errors };
}
const geo = page =>
  page.evaluate(() => {
    const r = s => {
      const e = document.querySelector(s);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const pop = document.getElementById('evchat');
    return {
      vw: innerWidth,
      vh: innerHeight,
      strip: r('#evstrip'),
      stripShown:
        !!document.getElementById('evstrip') && getComputedStyle(document.getElementById('evstrip')).display !== 'none',
      paneBottom: getComputedStyle(document.body, '::before').bottom,
      pop: pop && !pop.hidden && getComputedStyle(pop).display !== 'none' ? r('#evchat') : null,
      slot: !!document.getElementById('ev-sslot'),
      sug: ((document.getElementById('ev-sug') || {}).textContent || '').trim(),
      evb: r('#ev-btn'),
      chip: r('#ev-pchip:not([hidden])'),
      head: r('#mh'),
      panel: r('section.panel:not([hidden])'),
      scroll: Math.round(scrollY),
      focus: (document.activeElement && document.activeElement.id) || '',
    };
  });
const writesOf = page => page.evaluate(() => window.__writes.filter(w => w[1] === 'talk'));
const SIZES = [
  [1280, 860],
  [1706, 1240],
  [2560, 1240],
];

(async () => {
  const t0 = Date.now();
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  for (const [w, h] of SIZES) {
    const tag = `[${w}]`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light' });
    const { page, errors } = await open(ctx, seed);
    const views = ['today', 'study', 'progress', 'record'];
    if (await page.locator('#tab-notes').count()) views.push('notes');
    // 1. Every view: the frame, then the pop-up over the page, the page unmoved, Escape closes it.
    for (const v of views) {
      await page.click('#tab-' + v);
      await page.waitForTimeout(150);
      const g = await geo(page);
      ok(
        `${tag} ${v}: the page ends above a 38 px strip with the slot, her suggestion and the E.V. button`,
        g.stripShown &&
          g.strip &&
          g.strip.h === 38 &&
          g.strip.y + g.strip.h === g.vh &&
          g.paneBottom === '38px' &&
          g.slot &&
          !!g.sug &&
          !!g.evb &&
          !g.pop,
        JSON.stringify({ strip: g.strip, pane: g.paneBottom, sug: g.sug })
      );
      await page.click('#ev-btn');
      await page.waitForTimeout(250);
      const o = await geo(page);
      ok(
        `${tag} ${v}: E.V. opens the chat floating bottom right over the page, which does not move`,
        !!o.pop &&
          o.vw - (o.pop.x + o.pop.w) <= 12 &&
          o.pop.y + o.pop.h <= o.strip.y &&
          o.focus === 'evc-input' &&
          JSON.stringify([o.head, o.panel, o.scroll]) === JSON.stringify([g.head, g.panel, g.scroll]),
        JSON.stringify({ pop: o.pop, before: [g.head, g.panel], after: [o.head, o.panel] })
      );
      // B-409: away from an open note, the pop-up's words are the view's own
      const pw = await page.evaluate(() => ({
        ph: document.getElementById('evc-input').placeholder,
        ctx: document.querySelector('#evchat .ctx').textContent,
      }));
      ok(
        `${tag} ${v}: with no note open the box reads "Ask E.V." and its chip names the view`,
        pw.ph === 'Ask E.V.' && /^Sees /.test(pw.ctx) && pw.ctx !== 'Sees this note',
        JSON.stringify(pw)
      );
      await page.screenshot({ path: `${shots}/frame-${v}-open-${w}.png` });
      await page.locator('#tab-' + v).focus(); // Escape from anywhere, not only inside the pop-up
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      ok(`${tag} ${v}: Escape closes the chat`, !(await geo(page)).pop);
    }

    // B-409: a note open in Notes with no session: the strip offers "Study this note with E.V.", and the pop-up's box,
    // chip and asks speak of this note; the format bar runs the page's full width right under the header
    if (views.includes('notes')) {
      await page.click('#tab-notes');
      await page.click('#notes-pv-open');
      await page.waitForTimeout(300);
      const fb = await page.evaluate(() => {
        const a = document.querySelector('#p-notes .n-fbar').getBoundingClientRect();
        const m = document.getElementById('mh').getBoundingClientRect();
        return [Math.round(a.left - m.left), Math.round(a.width - m.width), Math.round(a.top - m.bottom), a.height];
      });
      ok(`${tag} the format bar spans the page under the header, 44 px high`, JSON.stringify(fb) === '[0,0,0,44]', fb);
      const sug0 = (await geo(page)).sug;
      await page.click('#ev-btn');
      await page.waitForTimeout(250);
      const nw = await page.evaluate(() => ({
        ph: document.getElementById('evc-input').placeholder,
        ctx: document.querySelector('#evchat .ctx').textContent,
        chips: [...document.querySelectorAll('#evchat .pchips .qchip')].map(b => b.textContent),
      }));
      ok(
        `${tag} a note open: "Study this note with E.V." in the strip; "Ask E.V. about this note", "Sees this note" and its two asks`,
        sug0 === 'Study this note with E.V.' &&
          nw.ph === 'Ask E.V. about this note' &&
          nw.ctx === 'Sees this note' &&
          JSON.stringify(nw.chips) === '["Quiz me on this note","What else links to this note?"]',
        JSON.stringify({ sug0, nw })
      );
      await page.screenshot({ path: `${shots}/frame-note-open-${w}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      await page.click('#mh button[aria-label="Back to Notes"]');
    }

    // 2. One chat on Today: send, minimize, reopen, close, history, reopen from history.
    await page.click('#tab-today');
    await page.evaluate(() => (window.__chatReply = 'Start with the reading, then the drill.'));
    await page.click('#ev-btn');
    const asked = `What first? (${w})`;
    await page.fill('#evc-input', asked);
    await page.press('#evc-input', 'Enter');
    const answered = await until(page, () =>
      [...document.querySelectorAll('#evchat .mev')].some(m => /reading, then the drill/.test(m.textContent))
    );
    const ws = await writesOf(page);
    const lines = ws.flatMap(x => Object.values((x[3] && x[3].messages) || {}));
    const th = (lines.find(m => m.text === asked) || {}).thread || '';
    const call = await page.evaluate(() => window.__chatCalls[window.__chatCalls.length - 1]);
    ok(
      `${tag} a pop-up line is answered by chat() and both lines are written with the chat's thread`,
      answered &&
        /^th-[A-Za-z0-9-]+$/.test(th) &&
        lines.some(m => m.role === 'ev' && m.thread === th && /drill/.test(m.text)),
      JSON.stringify({ answered, th, n: lines.length })
    );
    ok(
      `${tag} the model sees the view and only this chat's lines`,
      !!call &&
        /side chat over the Today view/.test(call.input[0].content) &&
        call.input.slice(1, -1).length === 0 &&
        call.input[call.input.length - 1].content === asked,
      JSON.stringify(call && call.input.map(x => String(x.content).slice(0, 40)))
    );
    await page.screenshot({ path: `${shots}/frame-chat-${w}.png` });
    await page.click('#evchat [aria-label="Minimize to the bar"]');
    await page.waitForTimeout(150);
    let g = await geo(page);
    const chipText = await page.locator('#ev-pchip').textContent();
    ok(
      `${tag} minimize leaves the chat as a chip in the strip`,
      !g.pop && !!g.chip && chipText.includes('What first?')
    );
    await page.screenshot({ path: `${shots}/frame-min-${w}.png` });
    await page.click('#ev-pchip');
    await page.waitForTimeout(150);
    ok(
      `${tag} the chip reopens the same chat`,
      !!(await geo(page)).pop && (await page.locator('#evchat .myou').count()) === 1
    );
    await page.click('#evchat [aria-label="Close"]');
    await page.waitForTimeout(400);
    const closedW = (await writesOf(page)).find(x => x[3] && x[3].closed && x[3].closed[th]);
    ok(`${tag} close writes the chat's closed mark (talk/<day>.closed)`, !!closedW && !(await geo(page)).pop);
    await page.click('#ev-histbtn');
    await page.waitForTimeout(200);
    const row = page.locator(`#evchat .hlist [data-thread="${th}"]`);
    ok(
      `${tag} history lists the closed chat`,
      (await row.count()) === 1 && /closed/.test(await row.textContent()),
      (await page
        .locator('#evchat .hlist')
        .textContent()
        .catch(() => '')) || ''
    );
    await page.screenshot({ path: `${shots}/frame-history-${w}.png` });
    await row.click();
    await page.waitForTimeout(200);
    ok(
      `${tag} history reopens the chat with its lines`,
      (await page.locator('#evchat .myou').count()) === 1 && (await page.locator('#evchat .mev').count()) >= 1
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // a new chat after closing starts empty
    await page.click('#ev-btn');
    await page.waitForTimeout(150);
    ok(
      `${tag} the next open is a new chat`,
      (await page.locator('#evchat .myou').count()) === 0 &&
        (await page.locator('#evchat .cph b').textContent()) === 'New chat'
    );
    await page.keyboard.press('Escape');

    // 2b. On every view, Conversation too: reopen the chat from history, minimize it to the chip, reopen it, close it.
    for (const v of [...views, 'ev']) {
      await page.click('#tab-' + v);
      await page.waitForTimeout(120);
      await page.click('#ev-histbtn');
      await page.waitForTimeout(150);
      const r = page.locator(`#evchat .hlist [data-thread="${th}"]`);
      const listed = (await r.count()) === 1;
      if (listed) await r.click();
      await page.waitForTimeout(150);
      const reopened = (await page.locator('#evchat:not([hidden]) .myou').count()) === 1;
      await page.click('#evchat [aria-label="Minimize to the bar"]');
      await page.waitForTimeout(120);
      const m = await geo(page);
      await page.click('#ev-pchip');
      await page.waitForTimeout(120);
      const back = !!(await geo(page)).pop && (await page.locator('#evchat .myou').count()) === 1;
      await page.click('#evchat [aria-label="Close"]');
      await page.waitForTimeout(200);
      const shut = !(await geo(page)).pop;
      ok(
        `${tag} ${v}: reopen from history, minimize to the chip, reopen, close`,
        listed && reopened && !m.pop && !!m.chip && back && shut,
        JSON.stringify({ listed, reopened, chip: !!m.chip, back, shut })
      );
    }

    // 3. Conversation: the button focuses its own composer; the pop-up's lines stay out of its thread.
    await page.click('#tab-ev');
    await page.waitForTimeout(200);
    await page.click('#ev-btn');
    await page.waitForTimeout(150);
    g = await geo(page);
    const inThread = await page.evaluate(q => (document.getElementById('thread').textContent || '').includes(q), asked);
    ok(
      `${tag} on Conversation the E.V. button focuses its composer and opens no pop-up`,
      g.focus === 'ev-input' && !g.pop && g.stripShown,
      JSON.stringify({ focus: g.focus, pop: g.pop })
    );
    ok(`${tag} the Conversation's thread does not show the pop-up's lines`, !inThread);
    await page.screenshot({ path: `${shots}/frame-ev-${w}.png` });

    // 4. A reload keeps history: the record carries the thread and its closed mark.
    const db = await page.evaluate(() => JSON.parse(JSON.stringify(window.__db)));
    ok(`${tag} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
    const again = await open(ctx, db);
    await again.page.click('#tab-study');
    await again.page.click('#ev-histbtn');
    await again.page.waitForTimeout(250);
    const row2 = again.page.locator(`#evchat .hlist [data-thread="${th}"]`);
    ok(
      `${tag} after a reload history still lists the chat, closed`,
      (await row2.count()) === 1 && /closed/.test(await row2.textContent())
    );
    if (await row2.count()) {
      await row2.click();
      await again.page.waitForTimeout(200);
      ok(
        `${tag} after a reload the chat reopens from history with its lines`,
        (await again.page.locator('#evchat .myou').count()) === 1 &&
          (await again.page.locator('#evchat .mev').textContent()).includes('drill')
      );
    }
    ok(`${tag} no page errors after the reload`, again.errors.length === 0, again.errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  // 6. B-406 (D-325): a Notes session's controls in the strip on every view, its long title cut short, never over her
  // suggestion or the E.V. button; the header's session line stays hidden; on the phone the header's line shows it.
  const LONG =
    'Fluid and electrolyte imbalances, acid–base compensation and the IV rate calculations for Tuesday’s unit quiz';
  const NID = 'n-20261025-120000-framelongtitle';
  const withLong = JSON.parse(JSON.stringify(seed));
  withLong.notes = {
    ...(withLong.notes || {}),
    [NID]: {
      schema: 1,
      writer: 'page',
      at: '2026-10-25T17:00:00.000Z',
      source: 'E.V. Home',
      createdAt: '2026-10-25T17:00:00.000Z',
      editedAt: '2026-10-25T17:00:00.000Z',
      title: LONG,
      course: 'NUR 112',
      blocks: [
        { type: 'h1', runs: [{ text: LONG }] },
        { type: 'p', runs: [{ text: 'Hyperkalemia peaks the T waves.' }] },
      ],
    },
  };
  for (const [w, h] of SIZES) {
    const tag = `[${w} session]`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'light' });
    const { page, errors } = await open(ctx, withLong);
    if (!(await page.locator('#tab-notes').count())) {
      await ctx.close();
      continue;
    }
    await page.click('#tab-notes');
    await page.click(`#notes-rows [data-note="${NID}"] .nm`);
    await page.click('#notes-pv-study');
    await until(page, () =>
      /left|writing|Paused/.test((document.querySelector('#ev-sslot .s-left') || {}).textContent || '')
    );
    for (const v of ['notes', 'today', 'study', 'progress', 'record', 'ev']) {
      await page.click('#tab-' + v);
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const box = s => {
          const e = document.querySelector(s);
          if (!e || e.hidden || getComputedStyle(e).display === 'none') return null;
          const b = e.getBoundingClientRect();
          return b.width ? { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) } : null;
        };
        const tn = document.querySelector('#ev-sslot .tn');
        return {
          slot: box('#ev-sslot'),
          tn: box('#ev-sslot .tn'),
          end: box('#ev-sslot .s-end'),
          sug: box('#ev-sug'),
          evb: box('#ev-btn'),
          cut: !!tn && tn.scrollWidth > tn.clientWidth,
          left: (document.querySelector('#ev-sslot .s-left') || {}).textContent || '',
          header: !document.getElementById('sbar').hidden,
          sx: document.documentElement.scrollWidth - innerWidth,
        };
      });
      const clear = r.end && r.evb && r.end.r <= r.evb.l && (!r.sug || r.end.r <= r.sug.l);
      ok(
        `${tag} ${v}: the strip holds the session (its clock, the note cut short, Break, End), clear of her line and the button`,
        !!r.slot &&
          /^(\d+:\d\d (left|writing)|Paused · \d+:\d\d)$/.test(r.left) &&
          r.cut &&
          r.tn.w <= 260 &&
          clear &&
          !r.header &&
          r.sx <= 0,
        JSON.stringify(r)
      );
    }
    await page.screenshot({ path: `${shots}/frame-session-${w}.png` });
    ok(`${tag} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    if (w === 1280) {
      // the same record on the phone: no strip; the header's line shows the running session
      const db = await page.evaluate(() => JSON.parse(JSON.stringify(window.__db)));
      const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
      const ph = await open(pctx, db);
      await ph.page.click('#tab-today');
      await ph.page.waitForTimeout(1300);
      const g = await geo(ph.page);
      const bar = await ph.page.evaluate(() => !document.getElementById('sbar').hidden);
      ok('[390 session] a Notes session shows in the header’s line on the phone, with no strip', !g.stripShown && bar);
      await ph.page.screenshot({ path: `${shots}/frame-session-390.png` });
      ok('[390 session] no page errors', ph.errors.length === 0, ph.errors.slice(0, 3).join(' | '));
      await pctx.close();
    }
    await ctx.close();
  }

  // 5. The phone: no strip, no pop-up, nothing taken from the page's height.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const { page, errors } = await open(ctx, seed);
    for (const v of ['today', 'study', 'progress', 'record', 'ev']) {
      await page.click('#tab-' + v);
      await page.waitForTimeout(100);
      const g = await geo(page);
      const dock = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--dock-h').trim()
      );
      ok(`[390] ${v}: no strip and no pop-up below 1024 px`, !g.stripShown && !g.pop && dock === '60px', dock);
    }
    ok('[390] no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 7. B-428: the installed phone app (390x844, touch, the PWA shell's safe-area padding on <html>, iPhone insets 47/34):
  // on E.V. the frame never scrolls. A swipe up on the message box or the chips leaves the document at 0 and the header,
  // the composer and the tab bar where they were; the thread still scrolls; the other views still scroll the document.
  // Chromium's touch emulation, not iOS Safari: the swipe is a finger drag sent as touch events (Input.dispatchTouchEvent).
  {
    const { HEAD } = await import(path.join(root, 'tools/build-pwa.mjs'));
    const shellCss = (HEAD.match(/<style>([^<]*)<\/style>/) || [])[1] || '';
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
      colorScheme: 'light',
    });
    const { page, errors } = await open(ctx, seed);
    const cdp = await ctx.newCDPSession(page);
    const insets = await cdp
      .send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } })
      .then(() => true)
      .catch(() => false);
    await page.addStyleTag({ content: shellCss });
    await page.waitForTimeout(150);
    ok('[390 app] the PWA shell pads <html> by the safe areas', /safe-area-inset-top/.test(shellCss) && insets);
    const box = s =>
      page.evaluate(s => {
        const b = document.querySelector(s).getBoundingClientRect();
        return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)].join(',');
      }, s);
    const frame = async () => ({
      doc: await page.evaluate(() => document.scrollingElement.scrollTop),
      body: await page.evaluate(() => document.body.scrollTop),
      head: await box('#mh'),
      bar: await box('.side .tabs'),
      comp: await box('#composer'),
    });
    // a finger drag: touchStart, 12 moves over about 200 ms, touchEnd (Chromium turns these into a touch scroll)
    const drag = async (x, y, dy) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let k = 1; k <= 12; k++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * k) / 12 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
    };
    const swipe = async (s, dy) => {
      const b = await page.locator(s).first().boundingBox();
      await drag(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2), dy);
    };
    // entering E.V. from a scrolled view leaves the frame at the top (the switch scrolls to the end of the document)
    await page.click('#tab-record');
    await page.evaluate(() => window.scrollTo(0, 60));
    await page.click('#tab-ev');
    await page.waitForTimeout(300);
    const fit = await page.evaluate(() => [document.scrollingElement.scrollHeight, innerHeight]);
    const f0 = await frame();
    ok(
      '[390 app] E.V.: the document is exactly the screen and sits at 0, the header below the status bar',
      fit[0] === fit[1] && f0.doc === 0 && f0.body === 0 && Number(f0.head.split(',')[1]) === 47,
      JSON.stringify({ fit, f0 })
    );
    await page.screenshot({ path: `${shots}/frame-app-ev-390-before.png` });
    // B-452 retired the quick-ask chips (Matt's call), and with them their swipe case.
    for (const [what, s] of [['the message box', '#ev-input']]) {
      if (!(await page.locator(s).first().isVisible())) {
        ok(`[390 app] ${what} is on screen to swipe`, false);
        continue;
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await swipe(s, -150);
      const f = await frame();
      ok(
        `[390 app] a swipe up on ${what} moves nothing: the document and body at 0, the header, composer and tab bar unmoved`,
        f.doc === 0 && f.body === 0 && f.head === f0.head && f.bar === f0.bar && f.comp === f0.comp,
        JSON.stringify({ f0, f })
      );
    }
    await page.screenshot({ path: `${shots}/frame-app-ev-390-after.png` });
    // the thread is still the scroller: it overflows (its pull room at least) and a swipe on it moves it, not the frame
    const t0 = await page.evaluate(() => {
      const t = document.querySelector('#p-ev .thread');
      return [t.scrollHeight - t.clientHeight, t.scrollTop];
    });
    await swipe('#p-ev .thread', t0[1] > 40 ? 120 : -120);
    const t1 = await page.evaluate(() => document.querySelector('#p-ev .thread').scrollTop);
    const f1 = await frame();
    ok(
      '[390 app] the thread still scrolls under a swipe, and the frame does not',
      t0[0] > 0 && t1 !== t0[1] && f1.doc === 0 && f1.head === f0.head && f1.bar === f0.bar,
      JSON.stringify({ overflow: t0[0], from: t0[1], to: t1, f1 })
    );
    // every other view still scrolls its content (the document) under a swipe, its header held below the status bar
    for (const v of ['today', 'study', 'progress', 'record']) {
      await page.click('#tab-' + v);
      await page.waitForTimeout(250);
      await page.evaluate(() => window.scrollTo(0, 0));
      const room = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
      await drag(195, 420, -200);
      const y = await page.evaluate(() => document.scrollingElement.scrollTop);
      const head = await box('#mh');
      ok(
        `[390 app] ${v} still scrolls its content under a swipe, the header held below the status bar`,
        room > 0 && y > 0 && head === f0.head,
        JSON.stringify({ room, y, head })
      );
      await page.screenshot({ path: `${shots}/frame-app-${v}-390-scrolled.png` });
    }
    ok('[390 app] no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 8. B-432: the phone's keyboard. Chromium has no on-screen keyboard, so visualViewport is stood in for (its height
  // shrinks as iOS's does when the keyboard rises). Focusing the message box must not zoom (16 px or more), and with the
  // keyboard up the frame is the space above it: header and composer on screen, the tab bar stepped aside, nothing past
  // the right edge. When the box is left and the keyboard drops, the tab bar is back.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => {
      const real = window.visualViewport,
        fake = new EventTarget();
      let h = null;
      for (const k of ['width', 'offsetLeft', 'offsetTop', 'pageLeft', 'pageTop', 'scale'])
        Object.defineProperty(fake, k, { get: () => real[k] });
      Object.defineProperty(fake, 'height', { get: () => (h == null ? real.height : h) });
      Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
      window.__kb = px => {
        h = px;
        fake.dispatchEvent(new Event('resize'));
      };
    });
    const { page, errors } = await open(ctx, seed);
    await page.click('#tab-ev');
    await page.waitForTimeout(200);
    const fs = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('ev-input')).fontSize));
    ok('[390 keyboard] the message box is 16 px or more, so Safari does not zoom on focus', fs >= 16, String(fs));
    const others = await page.evaluate(() =>
      ['#new-title', '#new-text'].map(s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize))
    );
    ok(
      "[390 keyboard] the New dialog's title and note fields are 16 px or more too",
      others.every(n => n >= 16),
      String(others)
    );
    const KB = 844 - 336;
    await page.focus('#ev-input');
    await page.evaluate(h => window.__kb(h), KB);
    await page.waitForTimeout(250);
    const up = await page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      return {
        kb: document.body.classList.contains('kb'),
        side: getComputedStyle(document.querySelector('.side')).display,
        head: r('#mh').top,
        comp: r('#composer').bottom,
        send: r('#ev-send').right,
        wide: document.documentElement.scrollWidth,
        doc: document.scrollingElement.scrollTop,
      };
    });
    ok(
      '[390 keyboard] with the keyboard up the header and composer fit above it, the tab bar steps aside, nothing past the edge',
      up.kb &&
        up.side === 'none' &&
        up.head >= 0 &&
        up.comp <= KB + 1 &&
        up.send <= 390 &&
        up.wide <= 390 &&
        up.doc === 0,
      JSON.stringify(up)
    );
    await page.screenshot({ path: `${shots}/frame-keyboard-390-up.png` });
    await page.evaluate(() => document.activeElement.blur());
    await page.evaluate(() => window.__kb(null));
    await page.waitForTimeout(400);
    const down = await page.evaluate(() => ({
      kb: document.body.classList.contains('kb'),
      side: getComputedStyle(document.querySelector('.side')).display,
      vvh: document.documentElement.style.getPropertyValue('--vvh'),
    }));
    ok(
      '[390 keyboard] the keyboard down, the tab bar is back and the frame is the screen again',
      !down.kb && down.side !== 'none' && !down.vvh,
      JSON.stringify(down)
    );
    ok('[390 keyboard] no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // 9. B-433: on the phone nothing widens the document (a Record row's long result wraps; iOS shrinks a wider page to
  // fit), and with the installed app's screen height (--app-h) the tab bar sits on the screen's bottom edge.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const { page, errors } = await open(ctx, seed);
    await page.click('#tab-record');
    await page.waitForTimeout(300);
    const wide = await page.evaluate(() => {
      const r = document.querySelector('#rec-list [data-part=row] .r');
      if (!r) return { row: false };
      r.textContent =
        'stopped in round 4 after 6:53 (90 reps) · energy 5/5 · ' + '“' + 'a long quoted line '.repeat(12) + '”';
      return {
        row: true,
        doc: document.documentElement.scrollWidth,
        right: Math.round(r.getBoundingClientRect().right),
      };
    });
    ok(
      '[390] Record: a row with a long result wraps inside the screen, and the document is no wider than the screen',
      wide.row && wide.doc <= 390 && wide.right <= 390,
      JSON.stringify(wide)
    );
    await page.screenshot({ path: `${shots}/frame-record-long-390.png` });
    await page.click('#tab-ev');
    await page.evaluate(() => document.documentElement.style.setProperty('--app-h', '844px'));
    await page.waitForTimeout(200);
    const bar = await page.evaluate(() => Math.round(document.querySelector('.side').getBoundingClientRect().bottom));
    ok('[390 app] with the screen height set, the tab bar ends on the screen bottom', bar === 844, String(bar));
    ok('[390] no page errors (B-433)', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
  for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : '');
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(
    `${failed ? failed + ' FAILED' : 'ALL PASSED'} of ${results.length} frame checks in ${Math.round((Date.now() - t0) / 1000)} s; shots in ${shots}`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
