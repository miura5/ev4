// The prep check harness (B-104; D-143, D-144): the built staging page's E.V. tab at 390 and 1280 px on the synthetic
// record (or an export) with planted prep days and their materials. At 7pm Central tomorrow is a head-to-toe
// validation: the greeting's briefing carries the calm Prep marker (no urgent dot), the night-before pack check sits
// under her greeting with every item citing its file and page, each tick writes that day's dayedits, and ticked
// through it folds away to one line. At 7am today is a clinical: the morning-of bag check, an item added by hand,
// ticked through and folded. Screenshots of each state at both widths.
//   node test/harness/prep.cjs [record dir | synthetic] [screenshots dir]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const [dbArg, shotsArg] = process.argv.slice(2);
const dbDir = require('../data/synthetic.cjs').recordDir(dbArg);
const shots = shotsArg || '/tmp/ev4-prep';
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
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const fmt = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const today = fmt(new Date()),
  tomorrow = addDays(today, 1);
// Central wall-clock time on a date, whatever the offset that day.
function ct(date, hh, mm = 0) {
  let t = Date.parse(date + 'T00:00:00Z') + (hh + 6) * 36e5 + mm * 6e4;
  const h = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(t)
    )
  );
  t -= ((h - hh + 24) % 24) * 36e5;
  return new Date(t);
}
const env = { schema: 1, writer: 'page', at: new Date().toISOString(), source: 'owner' };
// Made-up materials in the shapes Canvas files have ([pN] page and [sN] slide marks).
const MATERIALS = {
  'NUR112-801': {
    ...env,
    writer: 'canvas-sync',
    source: 'Canvas',
    course: 'NUR 112',
    kind: 'lab',
    title: 'Skills Validation Guide.pdf',
    fileType: 'pdf',
    fileId: 801,
    pages: 6,
    text: '[p3] Head-to-toe assessment validation. Bring with you: stethoscope, penlight, a watch with a second hand and your skills packet. Arrive 10 minutes early.\n[p4] Medication administration validation. Bring: drug cards and your MAR worksheet.',
  },
  'NUR112-803': {
    ...env,
    writer: 'canvas-sync',
    source: 'Canvas',
    course: 'NUR 112',
    kind: 'clinical',
    title: 'Clinical Orientation Mercy.pdf',
    fileType: 'pdf',
    fileId: 803,
    pages: 5,
    text: '[p2] Mercy Hospital clinical: what to bring: clinical badge, black pen, bandage shears, Jarvis handbook, drug handbook, completed drug cards. Bring your clinical folder with the facility paperwork (the Mercy assessment form). [p5] Parking at Mercy is in lot C.',
  },
};
function record() {
  const seed = load(dbDir);
  delete seed.system;
  delete seed.legacy;
  delete seed.debug;
  delete seed.journal;
  // Only the planted prep days on today and tomorrow, so the briefing's levels are the prep check's alone.
  seed.dates = Object.fromEntries(
    Object.entries(seed.dates || {}).filter(([, d]) => d.date !== today && d.date !== tomorrow)
  );
  if (seed.days && seed.days[today] && seed.days[today].list)
    seed.days[today].list.items = seed.days[today].list.items.filter(
      i => i.tag !== 'GRADED' && !/^(date|soon)-/.test(i.id)
    );
  for (const id of Object.keys(seed.dayedits || {})) if (id === today || id === tomorrow) delete seed.dayedits[id];
  seed.exams = Object.fromEntries(
    Object.entries(seed.exams || {}).map(([id, e]) => [
      id,
      e.date === today || e.date === tomorrow ? { ...e, date: addDays(today, 5) } : e,
    ])
  );
  seed.dates['prep-val'] = {
    ...env,
    addedAt: env.at,
    date: tomorrow,
    title: 'Validation: Head-to-toe assessment',
    kind: 'validation',
    course: 'NUR 112',
    graded: true,
  };
  seed.dates['prep-clin'] = {
    ...env,
    addedAt: env.at,
    date: today,
    title: 'Clinical: Mercy Hospital 4 West',
    kind: 'clinical',
    course: 'NUR 112',
    graded: false,
  };
  seed.materials = { ...(seed.materials || {}), ...MATERIALS };
  return seed;
}
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const skeleton = b =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  b +
  '</body></html>';
async function openPage(page, now, db) {
  await page.clock.install({ time: now });
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
  await page.waitForFunction(
    () => document.querySelector('#thread .msg.greet .prep .prep-list, #thread .msg.greet .prep .prep-note'),
    null,
    { timeout: 15000 }
  );
  await page.waitForTimeout(1200); // past her greeting's reveal
}
const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const state = page =>
  page.evaluate(() => {
    const g = document.querySelector('#thread .msg.greet'),
      p = g.querySelector('.prep'),
      box = p && p.querySelector('.prep-box');
    return {
      urgentDot: !!g.querySelector('.br-dot.urgent'),
      urgentMark: !!g.querySelector('.bi-mark.urgent'),
      prepMarks: [...g.querySelectorAll('.bi-prep')].map(x => x.textContent),
      briefPrep: [...g.querySelectorAll('.brief-item[data-level="prep"] .bi-t')].map(x => x.textContent),
      headline: g.querySelector('.bubble').textContent,
      row: p && p.querySelector('.prep-row').textContent,
      open: !!(box && !box.hidden && box.getBoundingClientRect().height > 0),
      done: !!(p && p.classList.contains('done')),
      items: p
        ? [...p.querySelectorAll('.prep-item')].map(li => ({
            t: li.querySelector('.pi-t').textContent,
            c: (li.querySelector('.pi-c') || {}).textContent || '',
            on: li.querySelector('input').checked,
          }))
        : [],
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      writes: (window.__writes || [])
        .filter(w => w[1] === 'dayedits')
        .map(w => [
          w[2],
          Object.keys(w[3].checks || {}),
          Object.values(w[3].added || {}).map(a => a.tag + ':' + a.text),
        ]),
    };
  });
async function tickAll(page) {
  for (let i = 0; ; i++) {
    const box = await page.$('#thread .msg.greet .prep .prep-item:not(.on) input');
    if (!box) break;
    await box.click();
    await page.waitForTimeout(250);
    if (i > 20) break;
  }
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  for (const scheme of ['phone', 'desktop']) {
    const viewport = scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 };
    // The night before: tomorrow is the head-to-toe validation.
    {
      const ctx = await browser.newContext({ viewport, colorScheme: 'dark' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await openPage(page, ct(today, 19, 0), record());
      let s = await state(page);
      ok(
        `[${scheme}] night: nothing urgent (no urgent dot or mark; the headline names no prep day)`,
        !s.urgentDot && !s.urgentMark && !/validation|clinical/i.test(s.headline),
        s.headline
      );
      ok(
        `[${scheme}] night: the briefing carries the calm Prep marker for tomorrow's validation`,
        s.prepMarks.length === 1 &&
          s.prepMarks[0] === 'Prep' &&
          s.briefPrep[0] === 'Validation: Head-to-toe assessment',
        JSON.stringify([s.prepMarks, s.briefPrep])
      );
      ok(
        `[${scheme}] night: the pack check is open under her greeting`,
        s.open && /^Prep\s*Pack for tomorrow: Validation: Head-to-toe assessment/.test(s.row),
        s.row
      );
      // B-189: the materials' items first, each citing its file and page; then what his validation kit adds.
      ok(
        `[${scheme}] night: its items are the validation's, each citing its file and page, then his kit's`,
        JSON.stringify(s.items.map(i => i.t)) ===
          JSON.stringify(['Stethoscope', 'Penlight', 'Watch with a second hand', 'Skills packet', 'Black pen']) &&
          s.items.slice(0, 4).every(i => i.c === 'Skills Validation Guide, p. 3') &&
          s.items[4].c === 'your validation kit',
        JSON.stringify(s.items)
      );
      await page.click('#thread .msg.greet .brief-row');
      await page.waitForTimeout(1100);
      await page.screenshot({ path: `${shots}/prep-night-open-${scheme}.png` });
      await page.click('#thread .msg.greet .brief-row');
      await page.waitForTimeout(900);
      await page.$eval('#thread .msg.greet .prep', e => e.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(300);
      await page.click('#thread .msg.greet .prep .prep-item input');
      await page.waitForTimeout(400);
      s = await state(page);
      ok(
        `[${scheme}] night: a tick shows and writes tomorrow's dayedits (prep-night-…)`,
        s.items[0].on &&
          /1 of 5/.test(s.row) &&
          s.writes.some(w => w[0] === tomorrow && w[1].includes('prep-night-stethoscope')),
        JSON.stringify([s.row, s.writes])
      );
      await page.screenshot({ path: `${shots}/prep-night-ticking-${scheme}.png` });
      await tickAll(page);
      s = await state(page);
      ok(
        `[${scheme}] night: ticked through, it folds away to one line`,
        s.done && !s.open && /Packed for tomorrow: Validation: Head-to-toe assessment/.test(s.row),
        JSON.stringify([s.row, s.open, s.done])
      );
      await page.screenshot({ path: `${shots}/prep-night-done-${scheme}.png` });
      await page.click('#thread .msg.greet .prep-row');
      await page.waitForTimeout(300);
      s = await state(page);
      ok(`[${scheme}] night: one tap on its line opens it again`, s.open && s.items.every(i => i.on));
      ok(`[${scheme}] night: no sideways scroll`, !s.sideways);
      ok(`[${scheme}] night: no page errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    // The morning of: today is the clinical.
    {
      const ctx = await browser.newContext({ viewport, colorScheme: 'dark' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await openPage(page, ct(today, 7, 0), record());
      let s = await state(page);
      ok(
        `[${scheme}] morning: nothing urgent; the Prep marker is today's clinical`,
        !s.urgentDot && !s.urgentMark && s.briefPrep[0] === 'Clinical: Mercy Hospital 4 West',
        JSON.stringify([s.headline, s.briefPrep])
      );
      ok(
        `[${scheme}] morning: the bag check lists the clinical's items, each citing its file and page`,
        /^Prep\s*Bag check: Clinical: Mercy Hospital 4 West/.test(s.row) &&
          s.items.length >= 7 &&
          s.items.every(i => /^Clinical Orientation Mercy, p\. 2|^your clinical kit$/.test(i.c)) &&
          s.items.some(i => i.t === 'Penlight' && i.c === 'your clinical kit') &&
          s.items.some(i => i.t === 'Clinical folder with your paperwork' && /filling it in is yours/.test(i.c)),
        JSON.stringify(s.items)
      );
      await page.screenshot({ path: `${shots}/prep-morning-open-${scheme}.png` });
      await page.fill('#thread .msg.greet .prep-add input', 'Lunch and a water bottle');
      await page.click('#thread .msg.greet .prep-add button');
      await page.waitForTimeout(500);
      s = await state(page);
      ok(
        `[${scheme}] morning: an item added by hand joins the check and is kept on today's dayedits`,
        s.items.some(i => i.t === 'Lunch and a water bottle' && /added by you/.test(i.c)) &&
          s.writes.some(w => w[0] === today && w[2].includes('PREP:Lunch and a water bottle')),
        JSON.stringify(s.writes)
      );
      await page.$eval('#thread .msg.greet .prep', e => e.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(200);
      await page.click('#thread .msg.greet .prep .prep-item input');
      await page.click('#thread .msg.greet .prep .prep-item:nth-child(2) input');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/prep-morning-ticking-${scheme}.png` });
      await tickAll(page);
      s = await state(page);
      ok(
        `[${scheme}] morning: ticked through, it folds away to one line`,
        s.done &&
          !s.open &&
          /Bag checked: Clinical: Mercy Hospital 4 West/.test(s.row) &&
          s.writes.some(w => w[0] === today && w[1].some(k => k.startsWith('prep-morning-'))),
        JSON.stringify([s.row, s.open])
      );
      await page.screenshot({ path: `${shots}/prep-morning-done-${scheme}.png` });
      ok(`[${scheme}] morning: no sideways scroll`, !s.sideways);
      ok(`[${scheme}] morning: no page errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
  // B-124 (D-164) is retired by D-286 (B-291): Today has no Now card, so the pack and bag checks live only under her
  // greeting (checked above). What stays: on a prep evening and morning Today shows no prep check of its own and the
  // greeting still carries it, at 390, 735 and 1280.
  const clinicalRecord = () => {
    const db = record();
    delete db.dates['prep-val'];
    db.dates['prep-clin-tmr'] = {
      ...env,
      addedAt: env.at,
      date: tomorrow,
      title: 'Clinical: Mercy Hospital 4 West, 0630–1500',
      kind: 'clinical',
      course: 'NUR 112',
      graded: false,
    };
    db.dates['prep-clin'] = { ...db.dates['prep-clin'], title: 'Clinical: Mercy Hospital 4 West, 0630–1500' };
    return db;
  };
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 735, height: 830 },
    { width: 1280, height: 860 },
  ]) {
    const w = viewport.width;
    for (const [when, at] of [
      ['evening', ct(today, 19, 0)],
      ['morning', ct(today, 7, 0)],
    ]) {
      const ctx = await browser.newContext({ viewport, colorScheme: 'dark' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openPage(page, at, clinicalRecord());
      const g = await state(page);
      await page.click('#tab-today');
      await page.waitForTimeout(400);
      const t = await page.evaluate(() => ({
        now: !!document.getElementById('now'),
        prep: !!document.querySelector('#p-today .prep'),
        sideways: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      ok(
        `[today ${w}] ${when} of a clinical: no Now card or prep check on Today; the greeting carries the check`,
        !t.now && !t.prep && !!g.row && g.items.length >= 3,
        JSON.stringify({ t, row: g.row, n: g.items.length })
      );
      await page.screenshot({ path: `${shots}/today-prep-${when}-${w}.png`, fullPage: true });
      ok(`[today ${w}] ${when}: no sideways scroll, no page errors`, !t.sideways && !errors.length, errors.join(' | '));
      await ctx.close();
    }
  }
  // B-291 (C-1, C-13, D-270, D-276, D-282, D-286, D-287): Today's list on a planted day, at 390 and 1280 in light and
  // dark. Rows are 32 px from 600 px and 44 px on the phone, each row's time on its line; graded work due tomorrow shows
  // a red badge, graded work due in three days a neutral one; the phone tick's green fill stays in its 18 px box, clear
  // of the name; Start shows on one row at most; no Add, Remove, Now card or Focus heading; Done, Deferred and Taken off
  // fold under the list.
  const listRecord = () => {
    const db = record();
    const in3 = addDays(today, 3);
    db.dates['p291-tmr'] = {
      ...env,
      addedAt: env.at,
      date: tomorrow,
      title: 'NUR 112 quiz: fluid balance',
      kind: 'due',
      course: 'NUR 112',
      graded: true,
    };
    db.dates['p291-3d'] = {
      ...env,
      addedAt: env.at,
      date: in3,
      title: 'BIO 201 lab report draft',
      kind: 'due',
      course: 'BIO 201',
      graded: true,
    };
    const day = db.days && db.days[today];
    if (day && day.list) {
      day.list.items = [
        {
          id: 'soon-p291-tmr',
          text: 'NUR 112 quiz: fluid balance (due tomorrow)',
          tag: 'GRADED',
          note: 'Graded',
          minutes: 0,
          ref: 'dates/p291-tmr',
        },
        { id: 'p291-lab', text: 'BIO 201 lab report draft', tag: 'GRADED', minutes: 30, ref: null },
        {
          id: 'p291-long',
          text: 'Read chapter 39, fluid, electrolyte and acid-base balance, the whole section on potassium',
          tag: 'READING',
          minutes: 45,
          ref: null,
        },
        {
          id: 'p291-set',
          text: 'Practice: fluid balance, 5 questions',
          tag: 'PRACTICE',
          minutes: 10,
          ref: 'sets/p291-set',
          set: 'p291-set',
        },
        { id: 'p291-done', text: 'Flashcards: cranial nerves', tag: 'PRACTICE', minutes: 15, ref: null },
        { id: 'p291-skip', text: 'Watch the IV pump video', tag: 'READING', minutes: 10, ref: null },
        { id: 'p291-later', text: 'Care plan outline', tag: 'NOTES', minutes: 20, ref: null, deferred: true },
        ...day.list.items.filter(i => i.tag !== 'GRADED' && !/^(date|soon)-/.test(i.id)),
      ];
      delete day.list.focus;
    }
    db.dayedits = db.dayedits || {};
    db.dayedits[today] = {
      ...env,
      date: today,
      checks: { 'p291-done': { at: env.at, by: 'Matt' } },
      added: {},
      skipped: { 'p291-skip': { at: env.at, by: 'Matt' } },
      checkin: null,
    };
    return db;
  };
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 860 },
  ])
    for (const scheme of ['light', 'dark']) {
      const w = viewport.width,
        tag = `[list ${w} ${scheme}]`;
      const ctx = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openPage(page, ct(today, 10, 0), listRecord());
      await page.click('#tab-today');
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const box = e => e && e.getBoundingClientRect();
        const rows = [...document.querySelectorAll('#today-list .ti-list > li.today-item')];
        const byText = t => rows.find(li => li.querySelector('.ti-t').textContent.includes(t));
        const badge = li => li && li.querySelector('.badge');
        return {
          heights: rows.map(li => Math.round(box(li).height)),
          timeOnLine: rows.every(li => {
            const t = box(li.querySelector('.t')),
              l = box(li);
            return t.top >= l.top - 1 && t.bottom <= l.bottom + 1 && t.right <= l.right + 1;
          }),
          tomorrow: (badge(byText('fluid balance')) || {}).className,
          in3: (badge(byText('lab report draft')) || {}).className,
          ticks: rows.map(li => {
            const c = box(li.querySelector('input.tick')),
              n = box(li.querySelector('.nm'));
            return { w: Math.round(c.width), h: Math.round(c.height), clear: c.right <= n.left };
          }),
          starts: document.querySelectorAll('#today-list .ti-start').length,
          banned:
            !!document.getElementById('now') ||
            [...document.querySelectorAll('#p-today h2, #p-today h3')].some(h =>
              /^Focus$/.test(h.textContent.trim())
            ) ||
            [...document.querySelectorAll('#p-today button')].some(b => /^(Add|Remove)$/.test(b.textContent.trim())),
          folds: [...document.querySelectorAll('#today-list .ti-fold')].map(f => f.textContent),
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      const want = w < 600 ? 44 : 32;
      ok(
        `${tag} rows are ${want} px and each row's time stays on its line`,
        r.heights.length >= 4 && r.heights.every(h => h === want) && r.timeOnLine,
        JSON.stringify(r.heights)
      );
      ok(
        `${tag} graded due tomorrow is red, graded due in three days neutral`,
        /\bx-red\b/.test(r.tomorrow || '') && /^badge$/.test(r.in3 || ''),
        JSON.stringify([r.tomorrow, r.in3])
      );
      ok(
        `${tag} the tick's box is ${w < 600 ? 18 : 16} px and clear of the name`,
        r.ticks.every(t => t.w === (w < 600 ? 18 : 16) && t.h === t.w && t.clear),
        JSON.stringify(r.ticks)
      );
      ok(
        `${tag} Start on exactly one row; no Add, Remove, Now card or Focus heading`,
        r.starts === 1 && !r.banned,
        JSON.stringify({ starts: r.starts })
      );
      ok(
        `${tag} Done, Deferred and Taken off today fold under the list`,
        r.folds.length === 3 &&
          /^Done/.test(r.folds[0]) &&
          /^Deferred: over today’s budget/.test(r.folds[1]) &&
          /^Taken off today/.test(r.folds[2]),
        JSON.stringify(r.folds)
      );
      await page.locator('#p-today').screenshot({ path: `${shots}/today-list-${w}-${scheme}.png` });
      // the phone tick: ticked, its green fill stays in the 18 px box
      const first = page.locator('#today-list .ti-list input.tick:not(:checked)').first();
      await first.click();
      await page.waitForTimeout(300);
      const f = await page.evaluate(() => {
        const c = document.querySelector('#today-list .ti-list input.tick:checked');
        const b = c.getBoundingClientRect(),
          n = c.closest('li').querySelector('.nm').getBoundingClientRect();
        return { w: Math.round(b.width), green: getComputedStyle(c).backgroundColor, clear: b.right <= n.left };
      });
      ok(
        `${tag} a ticked box fills green inside its box only`,
        f.w === (w < 600 ? 18 : 16) && f.clear && f.green !== 'rgba(0, 0, 0, 0)',
        JSON.stringify(f)
      );
      ok(`${tag} no sideways scroll, no page errors`, !r.sideways && !errors.length, errors.join(' | '));
      await ctx.close();
    }
  // B-189: asked in words on a planted lab day (a lab exam and a class exam today, as on Oct 21), E.V. answers from the
  // record without a model call: the greeting already carries the Prep marker for the day, and the reply's card is the
  // day's check with each item naming its source (the calendar entry, the announcement, the course calendar's row, the
  // lab kit). Then a day the calendar does not know, named in his words.
  const labRecord = () => {
    const db = record();
    delete db.dates['prep-val'];
    delete db.dates['prep-clin'];
    const later = addDays(today, 2); // the day only his words name
    for (const [id, d] of Object.entries(db.dates)) if (d.date === later) delete db.dates[id];
    db.dates['prep-lab-exam'] = {
      ...env,
      addedAt: env.at,
      date: today,
      title: 'BIO 201 Lab Exam: bones (Group A or B slot)',
      kind: 'exam',
      course: 'BIO 201',
      graded: true,
      notes: 'Study from the bones list. Bring a pencil.',
    };
    db.dates['prep-class-exam'] = {
      ...env,
      addedAt: env.at,
      date: today,
      title: 'Exam 4: Health Promotion, Pharmacology, Functional Ability',
      kind: 'exam',
      course: 'NUR 112',
      graded: true,
    };
    const [, m, d] = today.split('-').map(Number);
    db.announcements = {
      ...(db.announcements || {}),
      'canvas-prep-1': {
        ...env,
        writer: 'canvas-sync',
        source: 'Canvas',
        course: 'BIO 201',
        title: 'Lab exam reminders',
        postedAt: new Date(Date.parse(addDays(today, -2) + 'T15:00:00Z')).toISOString(),
        text: `On ${m}/${d} bring your bones lab sheet for the spelling section.`,
      },
    };
    db.materials['BIO201-7001'] = {
      ...env,
      writer: 'canvas-sync',
      source: 'Canvas',
      course: 'BIO 201',
      kind: 'course',
      title: 'BIO 201 Lab Calendar.pdf',
      fileType: 'pdf',
      fileId: 7001,
      pages: 2,
      text: `[p2] ${m}/${d} Lab Exam 2 (bones), lab manual Ch 7 and 8 ${addDays(today, 7).slice(5).replace('-', '/')} Ch 9 joints lab`,
    };
    return db;
  };
  const surf = page =>
    page.evaluate(() => {
      const s = document.getElementById('ev-surf'),
        cur = document.querySelector('#thread .msg.ev.current .bubble'),
        p = s && s.querySelector('.sf-body .prep');
      return {
        line: cur ? cur.textContent : '',
        head: s ? (s.querySelector('.sf-head .sf-t') || {}).textContent : null,
        row: p ? p.querySelector('.prep-row').textContent : null,
        open: !!(p && !p.querySelector('.prep-box').hidden),
        items: p
          ? [...p.querySelectorAll('.prep-item')].map(li => ({
              t: li.querySelector('.pi-t').textContent,
              c: (li.querySelector('.pi-c') || {}).textContent || '',
            }))
          : [],
        asked: (window.__sampled || []).length,
        sideways: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
  for (const scheme of ['phone', 'desktop']) {
    const viewport = scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 };
    const ctx = await browser.newContext({ viewport, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await openPage(page, ct(today, 7, 20), labRecord());
    let s = await state(page);
    ok(
      `[ask ${scheme}] the lab-exam day carries the Prep marker and the bag check (the tag that was off on Oct 21)`,
      s.briefPrep[0] === 'BIO 201 Lab Exam: bones (Group A or B slot)' &&
        /Bag check: BIO 201 Lab Exam/.test(s.row || ''),
      JSON.stringify([s.briefPrep, s.row])
    );
    await page.fill('#ev-input', 'I have lab/class today. Make a prep list of items to bring');
    await page.click('#ev-send');
    await page
      .waitForFunction(() => document.querySelector('#ev-surf .sf-body .prep .prep-item'), null, { timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(2500);
    let a = await surf(page);
    const by = Object.fromEntries(a.items.map(i => [i.t, i.c]));
    ok(
      `[ask ${scheme}] she answers from the record: which day, how many items the record names, what the kit adds`,
      /^For BIO 201 Lab Exam: bones \(Group A or B slot\) today: \d+ named in your record/.test(a.line) &&
        /from your lab kit/.test(a.line),
      a.line
    );
    ok(
      `[ask ${scheme}] the card is that day's check, open, every item naming its source`,
      a.open &&
        /^Prep · BIO 201 Lab Exam/.test(a.head || '') &&
        by['Pencil'] === 'Your calendar: BIO 201 Lab Exam: bones (Group A or B slot)' &&
        /^Canvas announcement: Lab exam reminders, /.test(by['Bones lab sheet'] || '') &&
        by['Lab manual'] === 'BIO 201 Lab Calendar, p. 2' &&
        by['Lab kit'] === 'your lab kit' &&
        a.items.every(i => i.c.trim()) &&
        !a.items.some(i => /Ch 9/.test(i.t)),
      JSON.stringify(a)
    );
    await page.screenshot({ path: `${shots}/ask-lab-day-${scheme}.png` });
    // A day the calendar has nothing on, named in his words: his lab kit, said plainly.
    await page.fill('#ev-input', 'what do I bring to lab on ' + addDays(today, 2).slice(5).replace('-', '/'));
    await page.click('#ev-send');
    await page.waitForTimeout(3000);
    a = await surf(page);
    ok(
      `[ask ${scheme}] a day only his words name: the lab kit, and she says the materials name nothing`,
      /: 1 from your lab kit\. Your materials don’t name anything for this day/.test(a.line) &&
        a.items.length === 1 &&
        a.items[0].t === 'Lab kit',
      JSON.stringify(a)
    );
    await page.screenshot({ path: `${shots}/ask-said-day-${scheme}.png` });
    ok(`[ask ${scheme}] no sideways scroll`, !a.sideways);
    ok(`[ask ${scheme}] no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  for (const [st, n, d] of results) console.log(`${st}  ${n}${d && st === 'FAIL' ? '  -- ' + d : ''}`);
  const failed = results.filter(x => x[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} of ${results.length} checks pass; screenshots in ${shots}`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
