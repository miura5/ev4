// The prep check harness (B-104; D-143, D-144): the built staging page's E.V. tab at 390 and 1280 px on the synthetic
// record (or an export) with planted prep days and their materials. At 7pm Central tomorrow is a head-to-toe
// validation: nothing on her greeting is urgent (B-358: one summary line, no line per item), the night-before pack check sits
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
      // B-368 (D-316): her greeting's line is kept in the record, not shown
      headline: ((((window.__db.talk || {}).memory || {}).headlines || []).slice(-1)[0] || {}).text || '',
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
      await page.screenshot({ path: `${shots}/prep-night-open-${scheme}.png` });
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
        `[${scheme}] morning: nothing urgent; the prep check is today's clinical`,
        !s.urgentDot && !s.urgentMark && /Clinical: Mercy Hospital 4 West/.test(s.row || ''),
        JSON.stringify([s.headline, s.row])
      );
      ok(
        `[${scheme}] morning: the bag check lists the clinical's items, each citing its file and page`,
        /^Prep\s*Bag check: Clinical: Mercy Hospital 4 West/.test(s.row) &&
          s.items.length >= 7 &&
          s.items.every(i => /^Clinical Orientation Mercy, p\. 2|^your clinical kit$/.test(i.c)) &&
          s.items.some(i => i.t === 'Penlight' && i.c === 'your clinical kit') &&
          s.items.some(i => i.t === 'Clinical folder with your paperwork' && !/filling it in/.test(i.c)), // D-324
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
  // B-291 (C-1, C-13, D-282, D-286, D-287): Today's list on a planted day, at 390 and 1280 in light and
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
        const rows = [...document.querySelectorAll('#today-list .ti-list > [data-ui=line]:not([data-key=cards])')];
        const byText = t => rows.find(li => li.querySelector('[data-part=title]').textContent.includes(t));
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
          // B-374 (D-316): Start shows on the first row that is not graded and has an estimate; on the others on hover
          starts: [...document.querySelectorAll('#today-list .ti-start')].filter(
            b =>
              getComputedStyle(b).visibility !== 'hidden' &&
              getComputedStyle(b).display !== 'none' &&
              parseFloat(getComputedStyle(b).opacity) > 0.05
          ).length,
          banned:
            !!document.getElementById('now') ||
            [...document.querySelectorAll('#p-today h2, #p-today h3')].some(h =>
              /^Focus$/.test(h.textContent.trim())
            ) ||
            // the demo's toolbar has Add (ti-add); Remove stays off Today
            [...document.querySelectorAll('#p-today button:not(.ti-add)')].some(b =>
              /^(Add|Remove)$/.test(b.textContent.trim())
            ),
          folds: [...document.querySelectorAll('#today-list .ti-fold')].map(f => f.textContent),
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      // B-357 (D-327): the rows are the demo's height (B-354); what stays is that each row's time keeps its line
      ok(`${tag} each row's time stays on its line`, r.heights.length >= 4 && r.timeOnLine, JSON.stringify(r.heights));
      ok(
        `${tag} graded work is the demo's neutral grey, never red, whenever it is due (B-361)`,
        [r.tomorrow, r.in3].every(c => /\bx-quiet\b/.test(c || '') && !/\bx-red\b/.test(c || '')),
        JSON.stringify([r.tomorrow, r.in3])
      );
      ok(
        `${tag} the tick's box is ${w < 600 ? 18 : 16} px and clear of the name`,
        r.ticks.every(t => t.w === (w < 600 ? 18 : 16) && t.h === t.w && t.clear),
        JSON.stringify(r.ticks)
      );
      ok(
        `${tag} Start on ${w < 600 ? "no row on the phone (the demo's phone rows)" : 'exactly one row'}; no Remove, Now card or Focus heading`,
        (w < 600 ? r.starts <= 1 : r.starts === 1) && !r.banned,
        JSON.stringify({ starts: r.starts })
      );
      ok(
        // B-374 (D-316): the demo's one Done · N group; no Deferred or Taken off folds (their data stays in the record)
        `${tag} Done folds under the list, the demo's one group`,
        r.folds.length === 1 && /^Done · \d+$/.test(r.folds[0]),
        JSON.stringify(r.folds)
      );
      await page.locator('#p-today').screenshot({ path: `${shots}/today-list-${w}-${scheme}.png` });
      // the phone tick: ticked, its green fill stays in the 18 px box
      const first = page.locator('#today-list .ti-list input.tick:not(:checked)').first();
      const firstId = await first.evaluate(c => c.closest('li').dataset.id || '');
      await first.click();
      await page.waitForTimeout(300);
      // B-363: a row ticked on this visit may join Done · N; it is read wherever it now sits
      const f = await page.evaluate(id => {
        const c =
          (id && document.querySelector(`#today-list li[data-id="${id}"] input.tick`)) ||
          document.querySelector('#today-list .ti-list input.tick:checked');
        const b = c.getBoundingClientRect(),
          n = c.closest('li').querySelector('.nm').getBoundingClientRect();
        return { w: Math.round(b.width), green: getComputedStyle(c).backgroundColor, clear: b.right <= n.left };
      }, firstId);
      ok(
        `${tag} a ticked box fills green inside its box only`,
        f.w === (w < 600 ? 18 : 16) && f.clear && f.green !== 'rgba(0, 0, 0, 0)',
        JSON.stringify(f)
      );
      ok(`${tag} no sideways scroll, no page errors`, !r.sideways && !errors.length, errors.join(' | '));
      await ctx.close();
    }
  // B-296 (C-10, D-282): the task's panel on the planted list day, at 390 and 1280 in light and dark, with a study task
  // (the practice set) and a graded task open. The name opens it: the right panel at 1280, under the pane at 390, the
  // list still in view (no full-page view), with no previous and next and no description paragraph. The study task's
  // one primary is Start; the graded task has no Start, Snooze or Remove. Snooze writes tomorrow's add and today's
  // take-off, and Undo reverses both; Remove writes the take-off.
  const panelRecord = () => {
    const db = listRecord();
    const base = Object.values(db.sets || {}).find(s => (s.items || []).some(q => q.topic));
    db.sets['p291-set'] = {
      ...base,
      ...env,
      kind: 'practice',
      title: 'Practice: fluid balance',
      course: 'NUR 112',
      planTaskId: null,
    };
    // B-388: planned graded work due today (a date- id) stays on today's list
    db.days[today].list.items.push({
      id: 'date-p388-quiz',
      text: 'Harness quiz due today',
      tag: 'GRADED',
      minutes: 20,
      ref: null,
    });
    return db;
  };
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 860 },
  ])
    for (const scheme of ['light', 'dark']) {
      const w = viewport.width,
        tag = `[task ${w} ${scheme}]`;
      const ctx = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openPage(page, ct(today, 10, 0), panelRecord());
      await page.click('#tab-today');
      await page.waitForTimeout(300);
      // B-364 (D-327): an opened task is the TaskDetail board's full view at every size; the header's back arrow
      // returns to the list
      const openRow = async text => {
        if (await page.isVisible('.mh-back')) {
          await page.click('.mh-back');
          await page.waitForTimeout(150);
        }
        await page.locator('#today-list .ti-list .ti-nm', { hasText: text }).first().click();
        await page.waitForSelector('#today-task:not([hidden])', { timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(100);
      };
      const readPanel = () =>
        page.evaluate(() => {
          const p = document.getElementById('today-task'),
            m = document.getElementById('today-taskmain'),
            list = document.getElementById('today-list');
          const box = e => e.getBoundingClientRect();
          const props = Object.fromEntries(
            [...p.querySelectorAll('.prop')].map(x => [
              x.querySelector('.prop-k').textContent,
              x.querySelector('.tp-seg')
                ? (x.querySelector('.tp-seg [aria-pressed="true"]') || {}).textContent
                : x.querySelector('.prop-v').textContent,
            ])
          );
          const all = [...p.querySelectorAll('button'), ...((m && m.querySelectorAll('button')) || [])];
          const btns = all.map(b => b.textContent.trim()).filter(Boolean);
          return {
            shown: !p.hidden && box(p).height > 0 && !!m && !m.hidden,
            listAway: !list || !list.getClientRects().length || box(list).height === 0,
            right: !!m && Math.round(box(p).left) >= Math.round(box(m).right) - 1,
            under: !!m && Math.round(box(p).top) >= Math.round(box(m).bottom) - 1,
            title: ((m && m.querySelector('h2')) || {}).textContent || '',
            props,
            from: [...((m && m.querySelectorAll('.tp-from .tp-what')) || [])].map(x => x.textContent).join(' | '),
            btns,
            primaries: all.filter(b => b.matches('.primary')).map(b => b.textContent.trim()),
            note: (p.querySelector('.tp-note') || {}).textContent || '',
            nav: all.some(b => /^(Previous|Next) task$/.test(b.getAttribute('aria-label') || '')),
            sideways: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
      // the study task
      await openRow('Practice: fluid balance');
      const s = await readPanel();
      ok(
        `${tag} a study task opens as its full view, its properties ${w >= 1200 ? 'in the right panel' : 'under it'}, the list stepping aside (D-327)`,
        s.shown && s.listAway && (w >= 1200 ? s.right : s.under) && /^Practice: fluid balance/.test(s.title),
        JSON.stringify(s)
      );
      ok(
        `${tag} it shows status, category, estimate, due, course and topic, and where it came from`,
        s.props.Status === 'To do' &&
          s.props.Category === 'Practice' &&
          s.props.Estimate === '10 min' &&
          s.props.Due === 'Today' &&
          s.props.Course === 'NUR 112' &&
          !!s.props.Topic &&
          /^(Planned by the 4:25\s?am run|Added by E\.V\. when she planned)/.test(s.from), // B-385's wording
        JSON.stringify({ props: s.props, from: s.from })
      );
      ok(
        `${tag} Start the quiz is its one primary, with Snooze to tomorrow, and up and down through the list (D-327)`,
        s.primaries.join() === 'Start the quiz' && s.btns.includes('Snooze to tomorrow') && s.nav,
        JSON.stringify({ btns: s.btns, primaries: s.primaries, nav: s.nav })
      );
      await page.locator('#p-today').screenshot({ path: `${shots}/today-task-study-${w}-${scheme}.png` });
      if (w >= 1200) await page.screenshot({ path: `${shots}/today-task-study-${w}-${scheme}-page.png` });
      // the graded task
      await openRow('BIO 201 lab report draft');
      const g = await readPanel();
      ok(
        // No Start on graded work, as the demo; B-374 (D-316): Snooze to tomorrow is offered on it. D-324: no line
        // that E.V. stays out of the work.
        `${tag} a graded task shows no Start, Open or Remove, and its snooze line`,
        g.shown &&
          g.props.Category === 'Graded' &&
          /^Snooze moves it to tomorrow, with Undo\.$/.test(g.note) &&
          !!g.props.Due &&
          !g.btns.some(b => /^(Start|Start the quiz|Open|Remove from today)$/.test(b)),
        JSON.stringify({ props: g.props, btns: g.btns })
      );
      const snz = () =>
        page.evaluate(() => {
          const b = document.querySelector('#today-task .tp-snooze');
          return { shown: !!b && b.getClientRects().length > 0, enabled: !!b && !b.disabled };
        });
      const labSnooze = await snz();
      ok(
        `${tag} graded work not due today (p291-lab) offers Snooze to tomorrow (B-374)`,
        labSnooze.shown && labSnooze.enabled,
        JSON.stringify(labSnooze)
      );
      await page.locator('#p-today').screenshot({ path: `${shots}/today-task-graded-${w}-${scheme}.png` });
      // B-388: graded work planned for its due day: no Snooze to take, the due-today line, and nothing written
      {
        const w0 = await page.evaluate(() => window.__writes.filter(x => x[1] === 'dayedits').length);
        await openRow('Harness quiz due today');
        const d = await snz();
        const due = await page.evaluate(() => {
          const n = document.querySelector('#today-task .tp-due');
          return n ? n.textContent : '';
        });
        await page.$eval('#today-task .tp-snooze', b => b.click()).catch(() => {});
        await page.waitForTimeout(300);
        const w1 = await page.evaluate(() => window.__writes.filter(x => x[1] === 'dayedits').length);
        ok(
          `${tag} graded work due today offers no Snooze, says it is due today, and a tap writes nothing (B-388)`,
          !d.enabled && /due today/.test(due) && w1 === w0,
          JSON.stringify({ d, due, w0, w1 })
        );
      }
      if (w >= 1200) await page.screenshot({ path: `${shots}/today-task-graded-${w}-${scheme}-page.png` });
      // Snooze, then Undo, on the reading
      const n0 = await page.evaluate(() => window.__writes.length);
      await openRow('Read chapter 39');
      await page.click('#today-task .tp-snooze');
      await page.waitForTimeout(400);
      const sz = await page.evaluate(
        ([n, today, tomorrow]) => {
          const ws = window.__writes.slice(n).filter(x => x[1] === 'dayedits');
          return {
            w: ws.map(x => [
              x[2],
              Object.values(x[3].added || {}).some(a => /^Read chapter 39/.test(a.text) && a.minutes === 45),
              !!(x[3].skipped || {})['p291-long'],
            ]),
            onList: [...document.querySelectorAll('#today-list .ti-list [data-part=title]')].some(t =>
              /^Read chapter 39/.test(t.textContent)
            ),
            line:
              document.getElementById('today-taskmain').textContent + document.getElementById('today-task').textContent,
            today,
            tomorrow,
          };
        },
        [n0, today, tomorrow]
      );
      ok(
        `${tag} Snooze writes tomorrow's add and today's take-off; the row leaves and the panel offers Undo`,
        sz.w.length === 2 &&
          sz.w[0][0] === tomorrow &&
          sz.w[0][1] &&
          sz.w[1][0] === today &&
          sz.w[1][2] &&
          !sz.onList &&
          /Moved to tomorrow’s list\..*Undo/.test(sz.line),
        JSON.stringify(sz)
      );
      await page.click('#today-task .tp-undo');
      await page.waitForTimeout(400);
      const un = await page.evaluate(
        ([n]) => {
          const ws = window.__writes.slice(n).filter(x => x[1] === 'dayedits');
          return {
            w: ws.map(x => [
              x[2],
              Object.values(x[3].added || {}).some(a => /^Read chapter 39/.test(a.text)),
              !!(x[3].skipped || {})['p291-long'],
            ]),
            onList: [...document.querySelectorAll('#today-list .ti-list [data-part=title]')].some(t =>
              /^Read chapter 39/.test(t.textContent)
            ),
          };
        },
        [n0]
      );
      ok(
        `${tag} Undo reverses both: today's take-off, then tomorrow's add`,
        un.w.length === 4 && un.w[2][0] === today && !un.w[2][2] && un.w[3][0] === tomorrow && !un.w[3][1] && un.onList,
        JSON.stringify(un)
      );
      // B-364 (D-327): the task view has no Remove from today, as the TaskDetail board
      const end = await readPanel();
      ok(`${tag} no sideways scroll, no page errors`, !end.sideways && !errors.length, errors.join(' | '));
      await ctx.close();
    }
  // B-292 (C-5): the day's budget on the planted list day, under and over, at 390 and 1280 in light and dark. The card
  // reads "<on the list> of <budget> min" with the done minutes on their own row (B-346, the demo's); ticking a
  // 45-minute row moves its minutes from the list to done and the bar keeps its length; over budget the fill is red and
  // the words that say so keep 4.5:1 against what they sit on.
  const budgetRecord = available => {
    const db = listRecord();
    const day = db.days[today];
    // planned is the list's own minutes, as planDay sums them (a deferred item carries none); the page takes off what
    // he skipped
    const planned = day.list.items.filter(i => !i.deferred).reduce((s, i) => s + (Number(i.minutes) || 0), 0);
    day.plan = { ...(day.plan || {}), budget: { available, planned, over: Math.max(0, planned - available) } };
    return db;
  };
  for (const [name, available] of [
    ['under', 240],
    ['over', 120],
  ])
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1280, height: 860 },
    ])
      for (const scheme of ['light', 'dark']) {
        const w = viewport.width,
          tag = `[budget ${name} ${w} ${scheme}]`;
        const ctx = await browser.newContext({ viewport, colorScheme: scheme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await openPage(page, ct(today, 10, 0), budgetRecord(available));
        await page.click('#tab-today');
        await page.waitForTimeout(400);
        const read = () =>
          page.evaluate(() => {
            const c = document.getElementById('today-budget');
            const num = (sel, re) => {
              const e = c.querySelector(sel);
              const m = e && re.exec(e.textContent);
              return m ? m.slice(1).map(Number) : null;
            };
            // B-346 (D-327): the demo's figure, '<on the list> of <budget> min', one fill, and Done as its own row
            const big = num('.tb-big', /^(\d+) of (\d+) min$/);
            const done = num('.tb-done-line .prop-v', /^(\d+) min$/);
            const bar = c.querySelector('.tb-bar');
            const lum = rgb => {
              // rgb(r, g, b) in 0-255, or color(srgb r g b) in 0-1 (what a color-mix computes to)
              const unit = /^color\(srgb/.test(rgb) ? 1 : 255;
              const v = (rgb.replace(/^color\(srgb/, '').match(/[\d.]+/g) || [])
                .slice(0, 3)
                .map(Number)
                .map(x => {
                  x /= unit;
                  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
                });
              return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
            };
            const ground = e => {
              for (let n = e; n; n = n.parentElement) {
                const b = getComputedStyle(n).backgroundColor;
                if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b;
              }
              return getComputedStyle(document.body).backgroundColor;
            };
            const ratio = e => {
              const a = lum(getComputedStyle(e).color),
                b = lum(ground(e));
              return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            };
            const overWords = [...document.querySelectorAll('#p-today .tb-over:not(.pbar)')].filter(
              e => e.getClientRects().length
            );
            const fill = bar.querySelector('.tb-fill');
            return {
              shown: !c.hidden && c.getClientRects().length > 0,
              big,
              done: done && done[0],
              barW: Math.round(bar.getBoundingClientRect().width),
              fillW: Math.round(fill.getBoundingClientRect().width),
              leftWarn: fill.classList.contains('x-red'),
              over: bar.classList.contains('tb-over'),
              overRatios: overWords.map(e => Math.round(ratio(e) * 100) / 100),
              sideways: document.documentElement.scrollWidth > innerWidth + 1,
            };
          });
        const a = await read();
        ok(
          `${tag} the card reads what's on the list against the day's budget, with the done minutes on their own row`,
          a.shown && a.big && a.done != null && a.big[1] === available,
          JSON.stringify(a)
        );
        ok(
          `${tag} ${name === 'over' ? "over budget: the bar's fill is red, as the demo's, and the words say so at 4.5:1" : 'under budget: no warning colour'}`,
          name === 'over'
            ? a.over && a.leftWarn && a.overRatios.length >= 1 && a.overRatios.every(r => r >= 4.5)
            : !a.over && !a.leftWarn && !a.overRatios.length,
          JSON.stringify({ over: a.over, leftWarn: a.leftWarn, ratios: a.overRatios })
        );
        // the whole page: from 1200 px the card sits in the fixed right panel, outside the Today pane
        await page.screenshot({ path: `${shots}/today-budget-${name}-${w}-${scheme}.png` });
        // tick the 45-minute reading: its minutes move from left to done and the bar keeps its length
        await page
          .locator('#today-list .ti-list [data-ui=line]:not([data-key=cards])', { hasText: 'Read chapter 39' })
          .locator('input.tick')
          .click();
        await page.waitForTimeout(400);
        const b = await read();
        ok(
          `${tag} ticking a 45-minute task moves 45 min from the list to done; the bar keeps its length, its fill shrinks`,
          b.big[0] === a.big[0] - 45 &&
            b.done === a.done + 45 &&
            Math.abs(b.barW - a.barW) <= 1 &&
            (a.big[0] > a.big[1] || b.fillW < a.fillW),
          JSON.stringify({ before: [a.big, a.done, a.barW, a.fillW], after: [b.big, b.done, b.barW, b.fillW] })
        );
        ok(`${tag} no sideways scroll, no page errors`, !b.sideways && !errors.length, errors.join(' | '));
        await ctx.close();
      }
  // B-293 (C-9, D-243): Plan the rest on a planted day with one free slot and one item due later. The exam plan now puts
  // a 25-minute drill on today and has moved the reading on today's list to tomorrow; the day's 60 minutes are full.
  // Plan the rest proposes adding the drill and taking the reading off: standard rows with one "Proposed" badge and
  // labelled Accept and Keep, and one line with Accept all and Reject. Keep and Reject write nothing; Accept all writes
  // one dayedits document with the add and the take-off, each by E.V. No x and no dashed ring on the view. At 390 and
  // 1280 in light and dark, with the proposal open.
  const restRecord = () => {
    const db = record();
    db.weakspots = {}; // no reviews: the day is the plan's alone
    db.planedits = {};
    db.plans = {
      E4: {
        ...env,
        writer: 'worker',
        source: 'Exam plan job',
        exam: 'E4',
        title: 'Exam 4 plan',
        days: [
          {
            date: today,
            label: 'Fluids',
            tasks: [
              { id: 'p293-keep', text: 'Terms: fluid and electrolyte words', kind: 'terminology' },
              { id: 'p293-new', text: 'Drill: potassium imbalances, 10 questions', tag: 'DRILL', kind: 'drill' },
            ],
          },
          {
            date: tomorrow,
            label: 'Acid-base',
            tasks: [{ id: 'p293-later', text: 'Read Ch 40: acid-base balance', tag: 'READING', kind: 'reading' }],
          },
        ],
      },
    };
    const day = db.days[today];
    day.list.items = [
      {
        id: 'date-prep-clin',
        text: 'Clinical: Mercy Hospital 4 West',
        tag: 'CLINICAL',
        minutes: 0,
        ref: 'dates/prep-clin',
      },
      {
        id: 'plan-p293-keep',
        text: 'Terms: fluid and electrolyte words',
        tag: null,
        minutes: 15,
        ref: 'plans/E4#p293-keep',
      },
      {
        id: 'plan-p293-later',
        text: 'Read Ch 40: acid-base balance',
        tag: 'READING',
        minutes: 45,
        ref: 'plans/E4#p293-later',
      },
    ];
    delete day.list.focus;
    day.plan = { ...(day.plan || {}), budget: { available: 60, planned: 60, over: 0 }, deferred: [] };
    return db;
  };
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 860 },
  ])
    for (const scheme of ['light', 'dark']) {
      const w = viewport.width,
        tag = `[plan the rest ${w} ${scheme}]`;
      const ctx = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openPage(page, ct(today, 10, 0), restRecord());
      await page.click('#tab-today');
      await page.waitForTimeout(400);
      const writes = () => page.evaluate(() => window.__writes.filter(x => x[1] === 'dayedits').length);
      const before = await writes();
      await page.click('#p-today .ti-rest');
      await page.waitForTimeout(300);
      const read = () =>
        page.evaluate(() => {
          const rows = [...document.querySelectorAll('#today-list .ti-list > li')];
          // B-369 (D-316): the demo's proposal rows: a mark (Proposed, or Off today · why) and a tick and a cross,
          // named Accept and Keep for the screen reader
          const prop = rows.filter(li => li.querySelector('.pmark'));
          const label = b => b.textContent.trim() || (b.getAttribute('aria-label') || '').split(':')[0];
          let dashed = false;
          for (const e of document.querySelectorAll('#p-today, #p-today *')) {
            const cs = getComputedStyle(e);
            if (
              [
                cs.borderTopStyle,
                cs.borderBottomStyle,
                cs.borderLeftStyle,
                cs.borderRightStyle,
                cs.outlineStyle,
              ].includes('dashed')
            )
              dashed = true;
          }
          const line = document.querySelector('#p-today .ti-review');
          return {
            prop: prop.map(li => ({
              id: li.dataset.id,
              add: li.classList.contains('ti-prop'),
              badges: [...li.querySelectorAll('.pmark')].map(label),
              buttons: [...li.querySelectorAll('button.btn')].map(label),
              h: Math.round(li.getBoundingClientRect().height),
              whole: (t => t && t.scrollWidth <= t.clientWidth + 1)(li.querySelector('[data-part=title]')),
              timeTop: (t => t && Math.round(t.getBoundingClientRect().top - li.getBoundingClientRect().top))(
                li.querySelector('.t')
              ),
            })),
            line: line ? line.textContent : null,
            lineButtons: line ? [...line.querySelectorAll('button')].map(label) : [],
            x: [...document.querySelectorAll('#p-today button')].some(
              b => /^[×✕✖x]$/i.test(label(b)) || /reject this|dismiss|close/i.test(b.getAttribute('aria-label') || '')
            ),
            dashed,
            restDisabled: document.querySelector('#p-today .ti-rest').disabled,
            sideways: document.documentElement.scrollWidth > innerWidth + 1,
          };
        });
      const a = await read();
      const add = a.prop.find(p => p.add),
        off = a.prop.find(p => !p.add);
      ok(
        `${tag} the proposal adds the drill and takes the reading due later off`,
        a.prop.length === 2 &&
          add &&
          add.id === 'plan-p293-new' &&
          off &&
          off.id === 'plan-p293-later' &&
          /add (a \d+-minute )?“Drill: potassium imbalances/.test(a.line || '') &&
          /take “Read Ch 40: acid-base balance” off today, since it’s planned for /.test(a.line || ''),
        JSON.stringify(a)
      );
      // a proposed row is a standard row of the demo's (B-357, D-327: no fixed heights): its whole name shows
      ok(
        `${tag} each proposed row has its whole name, its one mark (Proposed, or Off today · why) and Accept and Keep`,
        a.prop.every(
          p =>
            p.whole &&
            p.badges.length === 1 &&
            (p.add ? p.badges[0] === 'Proposed' : /^Off today · /.test(p.badges[0])) &&
            p.buttons.join() === 'Accept,Keep'
        ),
        JSON.stringify(a.prop)
      );
      ok(
        `${tag} one line with Accept all and Reject; Plan the rest waits while it is open`,
        a.lineButtons.join() === 'Accept all,Reject' && a.restDisabled,
        JSON.stringify(a.lineButtons)
      );
      // B-369 (D-316): the demo's proposed addition is a dashed card and Keep is its cross, so the old no-x, no-dashed
      // rule is retired
      await page.locator('#p-today').screenshot({ path: `${shots}/today-rest-${w}-${scheme}.png` });
      // Keep on the addition, then Reject: nothing is written
      await page.locator('#today-list li.ti-prop .ti-keep').click();
      await page.waitForTimeout(200);
      const k = await read();
      await page.locator('#p-today .ti-review button', { hasText: 'Reject' }).click();
      await page.waitForTimeout(200);
      const r = await read();
      ok(
        `${tag} Keep and Reject write nothing`,
        k.prop.length === 1 &&
          k.prop[0].id === 'plan-p293-later' &&
          !r.prop.length &&
          !r.line &&
          (await writes()) === before,
        JSON.stringify({ kept: k.prop.map(p => p.id), after: r.prop.length, writes: (await writes()) - before })
      );
      // Accept all (light), or each row's Accept in turn (dark): the add and the take-off, each by E.V.
      await page.click('#p-today .ti-rest');
      await page.waitForTimeout(200);
      const dayeditWrites = () => page.evaluate(n => window.__writes.filter(x => x[1] === 'dayedits').slice(n), before);
      const edits = doc => ({
        added: doc ? Object.values(doc.added || {}) : [],
        sk: doc && doc.skipped && doc.skipped['plan-p293-later'],
      });
      const good = ({ added, sk }) =>
        added.length === 1 &&
        /^Drill: potassium imbalances/.test(added[0].text) &&
        added[0].by === 'E.V.' &&
        added[0].minutes === 25 &&
        sk &&
        sk.by === 'E.V.';
      if (scheme === 'light') {
        await page.locator('#p-today .ti-review button', { hasText: 'Accept all' }).click();
        await page.waitForTimeout(400);
        const mine = await dayeditWrites();
        ok(
          `${tag} Accept all writes one add and one take-off edit by E.V., in one write`,
          mine.length === 1 && mine[0][2] === today && good(edits(mine[0][3])),
          JSON.stringify(mine)
        );
      } else {
        await page.locator('#today-list li.ti-off .ti-acc').click();
        await page.waitForTimeout(400);
        const one = await dayeditWrites();
        const mid = await read();
        const e1 = edits(one[0] && one[0][3]);
        ok(
          `${tag} a row's Accept writes its one take-off by E.V.; the addition stays proposed`,
          one.length === 1 &&
            e1.sk &&
            e1.sk.by === 'E.V.' &&
            !e1.added.length &&
            mid.prop.length === 1 &&
            mid.prop[0].id === 'plan-p293-new' &&
            mid.restDisabled,
          JSON.stringify({ one, mid: mid.prop })
        );
        await page.locator('#today-list li.ti-prop .ti-acc').click();
        await page.waitForTimeout(400);
        const two = await dayeditWrites();
        ok(
          `${tag} then the addition's Accept writes the add by E.V., keeping the take-off`,
          two.length === 2 && good(edits(two[1][3])),
          JSON.stringify(two.slice(1))
        );
      }
      const after = await read();
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll('#today-list .ti-list > li [data-part=title]')].map(t => t.textContent)
      );
      ok(
        `${tag} after Accept the drill is on the list, the reading is off and the proposal is gone`,
        !after.line &&
          !after.prop.length &&
          rows.some(t => /^Drill: potassium/.test(t)) &&
          !rows.some(t => /^Read Ch 40/.test(t)),
        JSON.stringify(rows)
      );
      ok(`${tag} no sideways scroll, no page errors`, !a.sideways && !errors.length, errors.join(' | '));
      await ctx.close();
    }
  // B-524 (F-60): Plan the rest never says the list fits while the day is over its budget. Over by 30 minutes with a
  // 40-minute reading and a 20-minute practice that may move, it proposes the one smallest cut that covers it (the
  // reading); over with only fixed work left, its toast says so and never "fits". At 390 and 1280.
  const overRecord = fixedOnly => {
    const db = record();
    db.weakspots = {};
    db.planedits = {};
    db.plans = {};
    const day = db.days[today];
    day.list.items = [
      {
        id: 'date-prep-clin',
        text: 'Clinical: Mercy Hospital 4 West',
        tag: 'CLINICAL',
        minutes: 0,
        ref: 'dates/prep-clin',
      },
      ...(fixedOnly
        ? [{ id: 'date-p524-care', text: 'Care plan 2 draft', tag: 'GRADED', minutes: 90, ref: null }]
        : [
            { id: 'p524-read', text: 'Read Ch 41: oxygenation', tag: 'READING', minutes: 40, ref: null },
            { id: 'p524-cards', text: 'Flashcards: oxygen devices', tag: 'PRACTICE', minutes: 20, ref: null },
          ]),
    ];
    delete day.list.focus;
    day.plan = { ...(day.plan || {}), budget: { available: 30, planned: fixedOnly ? 90 : 60, over: 0 }, deferred: [] };
    return db;
  };
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 860 },
  ]) {
    const w = viewport.width,
      tag = `[plan the rest over budget ${w}]`;
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openPage(page, ct(today, 10, 0), overRecord(false));
    await page.click('#tab-today');
    await page.waitForTimeout(400);
    await page.click('#p-today .ti-rest');
    await page.waitForTimeout(300);
    const o = await page.evaluate(() => ({
      offs: [...document.querySelectorAll('#today-list .ti-list > li.ti-off')].map(li => li.dataset.id),
      line: (document.querySelector('#p-today .ti-review') || {}).textContent || '',
      toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent,
    }));
    ok(
      `${tag} over by 30 min, it proposes the one smallest cut that covers it (the 40-min reading), never "fits"`,
      o.offs.join() === 'p524-read' &&
        /take “Read Ch 41: oxygenation” off today, since it’s over today’s budget/.test(o.line) &&
        !/fits/.test(o.toast),
      JSON.stringify(o)
    );
    await page.screenshot({ path: `${shots}/today-rest-over-${w}.png` });
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => errors.push(e.message));
    await openPage(p2, ct(today, 10, 0), overRecord(true));
    await p2.click('#tab-today');
    await p2.waitForTimeout(400);
    await p2.click('#p-today .ti-rest');
    await p2.waitForTimeout(200);
    const t = await p2.evaluate(() => ({
      toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent,
      prop: document.querySelectorAll('#today-list .pmark').length,
    }));
    ok(
      `${tag} over with only fixed work left, the toast says how far over and never "fits"`,
      /^Today’s list is 60 min over/.test(t.toast) && !/fits/.test(t.toast) && !t.prop,
      JSON.stringify(t)
    );
    ok(`${tag} no page errors`, !errors.length, errors.join(' | '));
    await ctx2.close();
  }
  // B-294: E.V.'s changes today. On Plan the rest's day, with a study session logged today and one task he added himself,
  // Accept all puts her add and her take-off in the right panel, newest first, each with Undo; his add and the session
  // never show. Undo on the take-off brings the reading back, and Undo on the add takes the drill off, each as one list
  // edit. At 1280 in light and dark, and at 390 in light (the card under the list), after accepting.
  for (const [w, scheme] of [
    [1280, 'light'],
    [1280, 'dark'],
    [390, 'light'],
  ]) {
    const tag = `[E.V.'s changes ${w} ${scheme}]`;
    const ctx = await browser.newContext({
      viewport: w < 600 ? { width: 390, height: 844 } : { width: 1280, height: 860 },
      colorScheme: scheme,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const db = restRecord();
    db.sessions = {
      ...(db.sessions || {}),
      's294-fluids': {
        ...env,
        writer: 'page',
        source: 'E.V. Home',
        status: 'done',
        topic: 'Fluid balance session',
        startedAt: ct(today, 8, 0),
        endedAt: ct(today, 8, 40),
      },
    };
    db.dayedits = db.dayedits || {};
    db.dayedits[today] = {
      ...env,
      writer: 'page',
      date: today,
      checks: {},
      skipped: {},
      checkin: null,
      added: {
        'add-mine': {
          text: 'Call clinical instructor',
          tag: null,
          kind: 'todo',
          minutes: 5,
          at: ct(today, 7, 0),
          by: 'Matt',
        },
      },
    };
    await openPage(page, ct(today, 10, 0), db);
    await page.click('#tab-today');
    await page.waitForTimeout(400);
    // B-374 (D-316): as the demo, the card always shows, saying Nothing yet today. while she has changed nothing
    const empty = await page.evaluate(() => {
      const c = document.getElementById('today-changes');
      return !!c && !c.hidden && !c.querySelector('.chg') && /Nothing yet today\./.test(c.textContent);
    });
    ok(`${tag} with only his own add, her changes say Nothing yet today.`, empty, String(empty));
    await page.click('#p-today .ti-rest');
    await page.waitForTimeout(200);
    await page.locator('#p-today .ti-review button', { hasText: 'Accept all' }).click();
    await page.waitForTimeout(400);
    const read = () =>
      page.evaluate(() => {
        const c = document.getElementById('today-changes');
        const rows = c && !c.hidden ? [...c.querySelectorAll('.chg')] : [];
        const r = c && c.getBoundingClientRect();
        return {
          head: c && c.querySelector('.lab') ? c.querySelector('.lab').textContent : null,
          rows: rows.map(li => ({
            id: li.dataset.id,
            title: li.querySelector('.ct').textContent,
            detail: (li.querySelector('.mini') || {}).textContent || '',
            buttons: [...li.querySelectorAll('button')].map(b => b.textContent.trim()),
          })),
          inPanel: !!r && (innerWidth < 1200 || r.left >= innerWidth - 420),
          list: [...document.querySelectorAll('#today-list .ti-list > li [data-part=title]')].map(t => t.textContent),
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
    const a = await read();
    ok(
      `${tag} after Accept all the right panel lists her add and her take-off, each with its time and Undo`,
      a.head === 'E.V.’s changes today' &&
        a.inPanel &&
        a.rows.length === 2 &&
        a.rows.some(r => /^Added “Drill: potassium imbalances/.test(r.title)) &&
        a.rows.some(r => r.title === 'Took “Read Ch 40: acid-base balance” off today') &&
        a.rows.every(r => /^\d{1,2}:\d\d [ap]m$/.test(r.detail) && r.buttons.join() === 'Undo'), // B-352: 10:00 am
      JSON.stringify(a)
    );
    ok(
      `${tag} no session row and none of his own edits`,
      !a.rows.some(r => /session|Call clinical/i.test(r.title + r.detail)),
      JSON.stringify(a.rows)
    );
    await page.locator('#today-changes').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${shots}/today-changes-${w}-${scheme}.png` });
    const before = await page.evaluate(() => window.__writes.filter(x => x[1] === 'dayedits').length);
    const since = () => page.evaluate(n => window.__writes.filter(x => x[1] === 'dayedits').slice(n), before);
    await page.locator('#today-changes .chg', { hasText: 'off today' }).locator('button').click();
    await page.waitForTimeout(400);
    const w1 = await since(),
      b = await read();
    const d1 = w1[0] && w1[0][3];
    ok(
      `${tag} Undo on the take-off brings the reading back as one list edit; the add stays`,
      w1.length === 1 &&
        d1 &&
        !(d1.skipped || {})['plan-p293-later'] &&
        Object.values(d1.added || {}).some(x => /^Drill: potassium/.test(x.text)) &&
        b.list.includes('Read Ch 40: acid-base balance') &&
        b.rows.length === 1 &&
        /^Added/.test(b.rows[0].title),
      JSON.stringify({ w1, rows: b.rows, list: b.list })
    );
    await page.locator('#today-changes .chg', { hasText: 'Added' }).locator('button').click();
    await page.waitForTimeout(400);
    const w2 = await since(),
      c = await read();
    const d2 = w2[1] && w2[1][3];
    ok(
      `${tag} Undo on the add takes the drill off as one list edit; his own add stays; the panel leaves`,
      w2.length === 2 &&
        d2 &&
        !Object.values(d2.added || {}).some(x => /^Drill: potassium/.test(x.text)) &&
        (d2.added || {})['add-mine'] &&
        !c.list.some(t => /^Drill: potassium/.test(t)) &&
        !c.rows.length,
      JSON.stringify({ w2: w2.slice(1), rows: c.rows, list: c.list })
    );
    ok(`${tag} no sideways scroll, no page errors`, !a.sideways && !c.sideways && !errors.length, errors.join(' | '));
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
      `[ask ${scheme}] the lab-exam day carries the bag check (the tag that was off on Oct 21)`,
      /Bag check: BIO 201 Lab Exam/.test(s.row || ''),
      JSON.stringify([s.row])
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
  // B-295 (C-6, C-13, C-16): Today's week on a planted week with three graded dates (tomorrow's validation and two due
  // dates) and dates he can take off.
  // Her line says three; the today chip equals the list's count; seven columns from 1200 px and one row per day below
  // it; chip titles wrap between words only (B-354); Take off writes the date's edit and Bring back reverses it.
  const weekRecord = () => {
    const db = record();
    const last = addDays(today, 6);
    db.dates = Object.fromEntries(
      Object.entries(db.dates).filter(([id, d]) => /^prep-/.test(id) || !(d.date >= today && d.date <= last))
    );
    const plant = (id, n, title, kind, graded) =>
      (db.dates[id] = { ...env, addedAt: env.at, date: addDays(today, n), title, kind, course: 'NUR 112', graded });
    plant('p295-a', 2, 'ATI Engage: fluid and electrolyte balance, the whole module', 'due', true);
    plant('p295-b', 3, 'Care plan 2 draft', 'due', true);
    plant('p295-c', 5, 'Dosage calculation practice', 'other', false);
    plant('p295-lab', 4, 'Skills lab open practice', 'other', false);
    // B-419: tasks E.V. and he added to today and to later days (dayedits/<date>.added), one of them ticked
    db.dayedits = db.dayedits || {};
    const task = (text, kind, minutes, by) => ({
      text,
      tag: kind === 'todo' ? null : kind.toUpperCase(),
      kind,
      minutes,
      course: 'NUR 112',
      at: env.at,
      by,
    });
    const added = (n, items, checks = {}) => {
      const date = addDays(today, n);
      db.dayedits[date] = {
        ...env,
        ...(db.dayedits[date] || {}),
        date,
        added: { ...((db.dayedits[date] || {}).added || {}), ...items },
        checks: { ...((db.dayedits[date] || {}).checks || {}), ...checks },
        skipped: (db.dayedits[date] || {}).skipped || {},
      };
    };
    added(0, { 'add-p419-email': task('Email the clinical instructors', 'todo', 10, 'E.V.') });
    added(2, {
      'add-p419-med-a': task('Med administration practice: oral meds', 'practice', 30, 'E.V.'),
      'add-p419-med-b': task('Med administration practice: injections', 'practice', 30, 'E.V.'),
    });
    added(
      3,
      { 'add-p419-read': task('Read the insulin chapter', 'reading', 25, 'Matt') },
      {
        'add-p419-read': { at: env.at, by: 'Matt' },
      }
    );
    return db;
  };
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 700, height: 860 },
    { width: 1000, height: 860 },
    { width: 1280, height: 860 },
  ])
    for (const scheme of ['light', 'dark']) {
      const w = viewport.width,
        tag = `[week ${w} ${scheme}]`;
      if (w === 700 && scheme === 'dark') continue; // 700 is the wrap check only
      const ctx = await browser.newContext({ viewport, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await openPage(page, ct(today, 10, 0), weekRecord());
      await page.click('#tab-today');
      await page.waitForTimeout(300);
      const listCount = await page.evaluate(
        () => document.querySelectorAll('#today-list .ti-list > [data-ui=line]:not([data-key=cards]):not(.done)').length
      );
      await page.click('#seg-today [data-v="week"]');
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const box = e => e.getBoundingClientRect();
        const days = [...document.querySelectorAll('#today-week .wk-day')];
        const titles = [...document.querySelectorAll('#today-week .wchip .wc-t')];
        return {
          her: document.querySelector('#today-week .wk-her').textContent,
          chip: (document.querySelector('#today-week .wk-day.today .wk-list .wc-t') || {}).textContent || '',
          days: days.length,
          lefts: new Set(days.map(d => Math.round(box(d).left))).size,
          tops: new Set(days.map(d => Math.round(box(d).top))).size,
          // B-354 (D-327): a title wraps between words only, as the demo's, and never runs out of its chip
          oneLine: titles.every(
            t =>
              !/break-all|anywhere/.test(getComputedStyle(t).wordBreak + getComputedStyle(t).overflowWrap) &&
              t.scrollWidth <= t.clientWidth + 1
          ),
          seg: [...document.querySelectorAll('#seg-today button')].map(b => b.getAttribute('aria-pressed')),
          segWhole: [...document.querySelectorAll('#seg-today, #seg-today button')].every(
            b => b.scrollWidth <= b.clientWidth + 1
          ),
          status: !!document.getElementById('status').textContent.trim(),
          listHidden: document.getElementById('today-list').hidden,
          panel: !document.getElementById('today-date').hidden,
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      ok(
        `${tag} her line counts the three graded dates from the dates`,
        /^(Three|Four) graded dates in the next 7 days[:.] /.test(r.her), // B-392 counts the week as the demo
        r.her
      );
      ok(
        `${tag} the today chip shows the list's count (${listCount})`,
        listCount > 0 && r.chip === listCount + ' on today’s list',
        r.chip
      );
      ok(
        `${tag} seven days, ${w >= 1200 ? 'seven columns' : 'one row per day'}; the switch says Week; the list steps aside`,
        r.days === 7 &&
          (w >= 1200 ? r.lefts === 7 && r.tops === 1 : r.tops === 7) &&
          r.seg.join() === 'false,true' &&
          r.listHidden,
        JSON.stringify(r)
      );
      ok(`${tag} chip titles wrap between words only and never overflow (B-354)`, r.oneLine);
      // B-419: every task added to a day is a card on that day, today's too; a ticked one reads Done
      const tk = await page.evaluate(() =>
        [...document.querySelectorAll('#today-week .wchip.wk-task')].map(c => [
          c.closest('.wk-day').dataset.date,
          c.dataset.task,
          c.querySelector('.wc-s').textContent,
        ])
      );
      ok(
        `${tag} the tasks added to today and later days show on their days (B-419)`,
        JSON.stringify(tk) ===
          JSON.stringify([
            [today, 'add-p419-email', 'To do · 10 min'],
            [addDays(today, 2), 'add-p419-med-a', 'Practice · 30 min'],
            [addDays(today, 2), 'add-p419-med-b', 'Practice · 30 min'],
            [addDays(today, 3), 'add-p419-read', 'Done'],
          ]),
        JSON.stringify(tk)
      );
      ok(`${tag} List and Week show whole, beside the header's status line`, r.segWhole, JSON.stringify(r.status));
      if (w !== 700) {
        await page.click('#today-week .wchip[data-id="p295-lab"]');
        await page.waitForTimeout(200);
        await page.locator('#p-today').screenshot({ path: `${shots}/today-week-${w}-${scheme}.png` });
        if (w === 1280) await page.screenshot({ path: `${shots}/today-week-${w}-${scheme}-page.png` });
        const n0 = await page.evaluate(() => window.__writes.length);
        await page.click('#today-date .wk-off');
        await page.waitForTimeout(400);
        const off = await page.evaluate(n => {
          const ws = window.__writes.slice(n).filter(x => x[1] === 'dateedits');
          return {
            w: ws.map(x => [x[2], x[3].removed && x[3].removed.by]),
            chip: document.querySelector('#today-week .wchip[data-id="p295-lab"]').className,
            btn: document.querySelector('#today-date .wk-off').textContent,
            her: document.querySelector('#today-week .wk-her').textContent,
          };
        }, n0);
        ok(
          `${tag} Take off writes the date's edit; the chip stays, taken off, with Bring back`,
          off.w.length === 1 &&
            off.w[0][0] === 'p295-lab' &&
            off.w[0][1] === 'Matt' &&
            /\boff\b/.test(off.chip) &&
            off.btn === 'Bring back' &&
            /^(Three|Four) graded/.test(off.her), // a lab taken off leaves the graded count
          JSON.stringify(off)
        );
        await page.click('#today-date .wk-off');
        await page.waitForTimeout(400);
        const back = await page.evaluate(n => {
          const ws = window.__writes.slice(n).filter(x => x[1] === 'dateedits');
          return {
            w: ws.map(x => [x[2], x[3].removed]),
            chip: document.querySelector('#today-week .wchip[data-id="p295-lab"]').className,
            btn: document.querySelector('#today-date .wk-off').textContent,
          };
        }, n0);
        // B-518 (F-26, F-27): each day shows its load, the tasks and minutes on its list; the day opens in view
        const ld = await page.evaluate(
          d => {
            const c = document.querySelector(`#today-week .wk-day[data-date="${d}"] .wk-load`);
            return c ? c.textContent : '';
          },
          addDays(today, 2)
        );
        ok(`${tag} a later day shows its load: 2 tasks · 1 h (B-518)`, ld === '2 tasks1 h', ld);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.click(`#today-week .wk-day[data-date="${addDays(today, 2)}"] .wk-h`);
        await page.waitForTimeout(250);
        const inView = await page.evaluate(() => {
          const r = document.getElementById('today-date').getBoundingClientRect();
          return { top: Math.round(r.top), h: innerHeight };
        });
        ok(
          `${tag} tapping a day brings its panel on screen (B-518)`,
          inView.top >= 0 && inView.top < inView.h - 100,
          JSON.stringify(inView)
        );
        // B-419: a later day opens ahead of time from its head: its tasks, who added them, and its calendar dates
        const dp = await page.evaluate(() => ({
          title: document.querySelector('#today-date .wd-title').textContent,
          tasks: [...document.querySelectorAll('#today-date .wd-task')].map(t => t.textContent),
          cal: [...document.querySelectorAll('#today-date .wd-cal .wchip')].map(c => c.dataset.id),
          pressed: document.querySelector('#today-week .wk-day.today .wk-h').getAttribute('aria-pressed'),
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        }));
        ok(
          `${tag} a later day opens from its head with its tasks and dates (B-419)`,
          dp.tasks.length === 2 &&
            dp.tasks.every(t => /^Med administration practice: .*Practice · 30 min · added by E\.V\.$/.test(t)) &&
            dp.cal.includes('p295-a') &&
            dp.pressed === 'false' &&
            !dp.sideways,
          JSON.stringify(dp)
        );
        await page.locator('#p-today').screenshot({ path: `${shots}/today-week-day-${w}-${scheme}.png` });
        if (w === 1280) await page.screenshot({ path: `${shots}/today-week-day-${w}-${scheme}-page.png` });
        await page.click(`#today-week .wchip[data-task="add-p419-read"]`);
        await page.waitForTimeout(200);
        const dn = await page.evaluate(() =>
          [...document.querySelectorAll('#today-date .wd-task')].map(t => [t.className, t.textContent])
        );
        ok(
          `${tag} a task's card opens its day; a ticked one reads Done (B-419)`,
          dn.length === 1 && /\bdone\b/.test(dn[0][0]) && /Done · added by you$/.test(dn[0][1]),
          JSON.stringify(dn)
        );
        ok(
          `${tag} Bring back reverses it`,
          back.w.length === 2 &&
            back.w[1][0] === 'p295-lab' &&
            back.w[1][1] === null &&
            !/\boff\b/.test(back.chip) &&
            back.btn === 'Take off',
          JSON.stringify(back)
        );
      }
      ok(`${tag} no sideways scroll, no page errors`, !r.sideways && !errors.length, errors.join(' | '));
      await ctx.close();
    }
  // B-448: Today's list goes back a day with the week's arrows. Yesterday shows its own list (its saved plan less what
  // was taken off, and the task added to it), a check-off there writes yesterday's dayedits and not today's, Next comes
  // back to today and stops there. At 390 and 1280.
  const pastRecord = () => {
    const db = record();
    const y = addDays(today, -1);
    db.days = db.days || {};
    db.days[y] = {
      ...env,
      date: y,
      dayType: 'class',
      list: {
        items: [
          { id: 'p448-read', text: 'Read chapter 12, wound care', tag: 'READING', minutes: 30, ref: null },
          { id: 'p448-cards', text: 'Flashcards: wound stages', tag: 'PRACTICE', minutes: 15, ref: null },
          { id: 'p448-off', text: 'Watch the dressing change video', tag: 'READING', minutes: 10, ref: null },
        ],
      },
      plan: { budget: { available: 120, planned: 55 }, deferred: [] },
    };
    db.dayedits = db.dayedits || {};
    db.dayedits[y] = {
      ...env,
      date: y,
      checks: { 'p448-cards': { at: env.at, by: 'Matt' } },
      added: {
        'add-p448-email': {
          text: 'Email the skills lab about makeup hours',
          kind: 'todo',
          tag: null,
          minutes: 10,
          at: env.at,
          by: 'Matt',
        },
      },
      skipped: { 'p448-off': { at: env.at, by: 'Matt' } },
      checkin: null,
    };
    return db;
  };
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 860 },
  ]) {
    const w = viewport.width,
      tag = `[past day ${w}]`,
      y = addDays(today, -1);
    const ctx = await browser.newContext({ viewport, colorScheme: 'light' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openPage(page, ct(today, 0, 40), pastRecord());
    await page.click('#tab-today');
    await page.waitForTimeout(300);
    const look = () =>
      page.evaluate(() => {
        const nav = document.getElementById('today-daynav');
        return {
          nav: nav
            ? [...nav.querySelectorAll('button')].map(
                b => (b.getAttribute('aria-label') || b.textContent) + (b.disabled ? ':off' : '')
              )
            : [],
          label: ((nav && nav.querySelector('.wk-range')) || {}).textContent || '',
          open: [...document.querySelectorAll('#today-list .ti-list > [data-ui=line]:not([data-key=cards])')].map(
            li => li.dataset.id
          ),
          done: [...document.querySelectorAll('#today-list .ti-folded > [data-ui=line]:not([data-key=cards])')].map(
            li => li.dataset.id
          ),
          rest: !!document.querySelector('#today-bar .ti-rest'),
          budget: !document.getElementById('today-budget').hidden,
          sideways: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
    const t0 = await look();
    await page.screenshot({ path: `${shots}/today-daynav-${w}.png` });
    ok(
      `${tag} the list's toolbar has back, Today and forward; forward is off on today`,
      t0.nav.join() === 'Previous day,Today,Next day:off' && !t0.label,
      JSON.stringify(t0)
    );
    await page.click('#today-daynav [aria-label="Previous day"]');
    await page.waitForTimeout(300);
    const t1 = await look();
    const [, m, d] = y.split('-').map(Number);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
    ok(
      `${tag} back a day: yesterday's own list, its plan less the take-off and its added task, its tick in Done`,
      t1.open.join() === 'p448-read,add-p448-email' &&
        t1.done.join() === 'p448-cards' &&
        t1.label.endsWith(d + ' ' + mon) &&
        t1.nav.join() === 'Previous day,Today,Next day' &&
        !t1.rest &&
        !t1.budget,
      JSON.stringify(t1)
    );
    await page.locator('#p-today').screenshot({ path: `${shots}/today-pastday-${w}.png` });
    const n0 = await page.evaluate(() => window.__writes.length);
    await page.click('#today-list li[data-id="p448-read"] input.tick');
    await page.waitForTimeout(400);
    const tk = await page.evaluate(
      n =>
        window.__writes
          .slice(n)
          .filter(x => x[1] === 'dayedits')
          .map(x => [
            x[2],
            Object.keys(x[3].checks || {})
              .sort()
              .join('+'),
          ]),
      n0
    );
    const t2 = await look();
    ok(
      `${tag} a check-off there is recorded on yesterday's dayedits, not today's`,
      tk.length === 1 && tk[0][0] === y && tk[0][1] === 'p448-cards+p448-read' && t2.done.includes('p448-read'),
      JSON.stringify({ tk, t2 })
    );
    await page.click('#today-daynav [aria-label="Next day"]');
    await page.waitForTimeout(300);
    const t3 = await look();
    ok(
      `${tag} forward comes back to today, and stops there`,
      t3.nav.join() === 'Previous day,Today,Next day:off' && !t3.open.includes('p448-read') && t3.rest,
      JSON.stringify(t3)
    );
    ok(`${tag} no sideways scroll, no page errors`, !t1.sideways && !t3.sideways && !errors.length, errors.join(' | '));
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
