// The prep check harness (B-104; D-143, D-144): the built staging page's E.V. tab at 390 and 1280 px on the synthetic
// record (or an export) with planted prep days and their materials. At 7pm Central tomorrow is a head-to-toe
// validation: the greeting's briefing carries the calm Prep marker (no urgent dot), the night-before pack check sits
// under her greeting with every item citing its file and page, each tick writes that day's dayedits, and ticked
// through it folds away to one line. At 7am today is a clinical: the morning-of bag check, an item added by hand,
// ticked through and folded. Screenshots of each state at both widths.
//   node test/harness/prep.cjs [record dir | synthetic] [screenshots dir]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const root = path.resolve(__dirname, '../..');
const [dbArg, shotsArg] = process.argv.slice(2);
const dbDir = require('../data/synthetic.cjs').recordDir(dbArg);
const shots = shotsArg || '/tmp/ev4-prep'; fs.mkdirSync(shots, { recursive: true });
function load(dir) { const db = {}; for (const c of fs.readdirSync(dir)) { const p = path.join(dir, c); if (!fs.statSync(p).isDirectory()) continue; db[c] = {}; for (const f of fs.readdirSync(p)) if (f.endsWith('.json')) db[c][f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')); } return db; }
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const fmt = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d);
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const today = fmt(new Date()), tomorrow = addDays(today, 1);
// Central wall-clock time on a date, whatever the offset that day.
function ct(date, hh, mm = 0) {
  let t = Date.parse(date + 'T00:00:00Z') + (hh + 6) * 36e5 + mm * 6e4;
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
  t -= ((h - hh + 24) % 24) * 36e5; return new Date(t);
}
const env = { schema: 1, writer: 'page', at: new Date().toISOString(), source: 'owner' };
// Made-up materials in the shapes Canvas files have ([pN] page and [sN] slide marks).
const MATERIALS = {
  'NUR112-801': { ...env, writer: 'canvas-sync', source: 'Canvas', course: 'NUR 112', kind: 'lab', title: 'Skills Validation Guide.pdf', fileType: 'pdf', fileId: 801, pages: 6, text: '[p3] Head-to-toe assessment validation. Bring with you: stethoscope, penlight, a watch with a second hand and your skills packet. Arrive 10 minutes early.\n[p4] Medication administration validation. Bring: drug cards and your MAR worksheet.' },
  'NUR112-803': { ...env, writer: 'canvas-sync', source: 'Canvas', course: 'NUR 112', kind: 'clinical', title: 'Clinical Orientation Mercy.pdf', fileType: 'pdf', fileId: 803, pages: 5, text: '[p2] Mercy Hospital clinical: what to bring: clinical badge, black pen, bandage shears, Jarvis handbook, drug handbook, completed drug cards. Bring your clinical folder with the facility paperwork (the Mercy assessment form). [p5] Parking at Mercy is in lot C.' },
};
function record() {
  const seed = load(dbDir); delete seed.system; delete seed.legacy; delete seed.debug; delete seed.journal;
  // Only the planted prep days on today and tomorrow, so the briefing's levels are the prep check's alone.
  seed.dates = Object.fromEntries(Object.entries(seed.dates || {}).filter(([, d]) => d.date !== today && d.date !== tomorrow));
  if (seed.days && seed.days[today] && seed.days[today].list) seed.days[today].list.items = seed.days[today].list.items.filter(i => i.tag !== 'GRADED' && !/^(date|soon)-/.test(i.id));
  for (const id of Object.keys(seed.dayedits || {})) if (id === today || id === tomorrow) delete seed.dayedits[id];
  seed.exams = Object.fromEntries(Object.entries(seed.exams || {}).map(([id, e]) => [id, e.date === today || e.date === tomorrow ? { ...e, date: addDays(today, 5) } : e]));
  seed.dates['prep-val'] = { ...env, addedAt: env.at, date: tomorrow, title: 'Validation: Head-to-toe assessment', kind: 'validation', course: 'NUR 112', graded: true };
  seed.dates['prep-clin'] = { ...env, addedAt: env.at, date: today, title: 'Clinical: Mercy Hospital 4 West', kind: 'clinical', course: 'NUR 112', graded: false };
  seed.materials = { ...(seed.materials || {}), ...MATERIALS };
  return seed;
}
const ORIGIN = 'https://ev.local'; const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const skeleton = b => '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' + b + '</body></html>';
async function openPage(page, now, db) {
  await page.clock.install({ time: now });
  const dir = path.join(root, 'dist/page/staging');
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '' }));
  await page.route(ORIGIN + '/**', r => { const name = new URL(r.request().url()).pathname.slice(1) || 'index.html'; if (name === 'index.html') return r.fulfill({ body: skeleton(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')), contentType: 'text/html' }); const f = path.join(dir, name); return fs.existsSync(f) ? r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(name)] || 'application/octet-stream' }) : r.fulfill({ status: 404, body: '' }); });
  await page.addInitScript('window.__db=' + JSON.stringify(db) + ';' + stub);
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => document.querySelector('#thread .msg.greet'), null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#thread .msg.greet .prep .prep-list, #thread .msg.greet .prep .prep-note'), null, { timeout: 15000 });
  await page.waitForTimeout(1200); // past her greeting's reveal
}
const results = []; const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const state = page => page.evaluate(() => {
  const g = document.querySelector('#thread .msg.greet'), p = g.querySelector('.prep'), box = p && p.querySelector('.prep-box');
  return { urgentDot: !!g.querySelector('.br-dot.urgent'), urgentMark: !!g.querySelector('.bi-mark.urgent'), prepMarks: [...g.querySelectorAll('.bi-prep')].map(x => x.textContent),
    briefPrep: [...g.querySelectorAll('.brief-item[data-level="prep"] .bi-t')].map(x => x.textContent), headline: g.querySelector('.bubble').textContent,
    row: p && p.querySelector('.prep-row').textContent, open: !!(box && !box.hidden && box.getBoundingClientRect().height > 0), done: !!(p && p.classList.contains('done')),
    items: p ? [...p.querySelectorAll('.prep-item')].map(li => ({ t: li.querySelector('.pi-t').textContent, c: (li.querySelector('.pi-c') || {}).textContent || '', on: li.querySelector('input').checked })) : [],
    sideways: document.documentElement.scrollWidth > window.innerWidth + 1, writes: (window.__writes || []).filter(w => w[1] === 'dayedits').map(w => [w[2], Object.keys(w[3].checks || {}), Object.values(w[3].added || {}).map(a => a.tag + ':' + a.text)]) };
});
async function tickAll(page) {
  for (let i = 0; ; i++) {
    const box = await page.$('#thread .msg.greet .prep .prep-item:not(.on) input'); if (!box) break;
    await box.click(); await page.waitForTimeout(250); if (i > 20) break;
  }
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  for (const scheme of ['phone', 'desktop']) {
    const viewport = scheme === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 };
    // The night before: tomorrow is the head-to-toe validation.
    {
      const ctx = await browser.newContext({ viewport, colorScheme: 'dark' }); const page = await ctx.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await openPage(page, ct(today, 19, 0), record());
      let s = await state(page);
      ok(`[${scheme}] night: nothing urgent (no urgent dot or mark; the headline names no prep day)`, !s.urgentDot && !s.urgentMark && !/validation|clinical/i.test(s.headline), s.headline);
      ok(`[${scheme}] night: the briefing carries the calm Prep marker for tomorrow's validation`, s.prepMarks.length === 1 && s.prepMarks[0] === 'Prep' && s.briefPrep[0] === 'Validation: Head-to-toe assessment', JSON.stringify([s.prepMarks, s.briefPrep]));
      ok(`[${scheme}] night: the pack check is open under her greeting`, s.open && /^Prep\s*Pack for tomorrow: Validation: Head-to-toe assessment/.test(s.row), s.row);
      ok(`[${scheme}] night: its items are the validation's, each citing its file and page`, JSON.stringify(s.items.map(i => i.t)) === JSON.stringify(['Stethoscope', 'Penlight', 'Watch with a second hand', 'Skills packet']) && s.items.every(i => i.c === 'Skills Validation Guide, p. 3'), JSON.stringify(s.items));
      await page.click('#thread .msg.greet .brief-row'); await page.waitForTimeout(1100);
      await page.screenshot({ path: `${shots}/prep-night-open-${scheme}.png` });
      await page.click('#thread .msg.greet .brief-row'); await page.waitForTimeout(900);
      await page.$eval('#thread .msg.greet .prep', e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300);
      await page.click('#thread .msg.greet .prep .prep-item input'); await page.waitForTimeout(400);
      s = await state(page);
      ok(`[${scheme}] night: a tick shows and writes tomorrow's dayedits (prep-night-…)`, s.items[0].on && /1 of 4/.test(s.row) && s.writes.some(w => w[0] === tomorrow && w[1].includes('prep-night-stethoscope')), JSON.stringify([s.row, s.writes]));
      await page.screenshot({ path: `${shots}/prep-night-ticking-${scheme}.png` });
      await tickAll(page); s = await state(page);
      ok(`[${scheme}] night: ticked through, it folds away to one line`, s.done && !s.open && /Packed for tomorrow: Validation: Head-to-toe assessment/.test(s.row), JSON.stringify([s.row, s.open, s.done]));
      await page.screenshot({ path: `${shots}/prep-night-done-${scheme}.png` });
      await page.click('#thread .msg.greet .prep-row'); await page.waitForTimeout(300); s = await state(page);
      ok(`[${scheme}] night: one tap on its line opens it again`, s.open && s.items.every(i => i.on));
      ok(`[${scheme}] night: no sideways scroll`, !s.sideways);
      ok(`[${scheme}] night: no page errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    // The morning of: today is the clinical.
    {
      const ctx = await browser.newContext({ viewport, colorScheme: 'dark' }); const page = await ctx.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await openPage(page, ct(today, 7, 0), record());
      let s = await state(page);
      ok(`[${scheme}] morning: nothing urgent; the Prep marker is today's clinical`, !s.urgentDot && !s.urgentMark && s.briefPrep[0] === 'Clinical: Mercy Hospital 4 West', JSON.stringify([s.headline, s.briefPrep]));
      ok(`[${scheme}] morning: the bag check lists the clinical's items, each citing its file and page`, /^Prep\s*Bag check: Clinical: Mercy Hospital 4 West/.test(s.row) && s.items.length >= 7 && s.items.every(i => /^Clinical Orientation Mercy, p\. 2/.test(i.c)) && s.items.some(i => i.t === 'Clinical folder with your paperwork' && /filling it in is yours/.test(i.c)), JSON.stringify(s.items));
      await page.screenshot({ path: `${shots}/prep-morning-open-${scheme}.png` });
      await page.fill('#thread .msg.greet .prep-add input', 'Lunch and a water bottle'); await page.click('#thread .msg.greet .prep-add button'); await page.waitForTimeout(500);
      s = await state(page);
      ok(`[${scheme}] morning: an item added by hand joins the check and is kept on today's dayedits`, s.items.some(i => i.t === 'Lunch and a water bottle' && /added by you/.test(i.c)) && s.writes.some(w => w[0] === today && w[2].includes('PREP:Lunch and a water bottle')), JSON.stringify(s.writes));
      await page.$eval('#thread .msg.greet .prep', e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200);
      await page.click('#thread .msg.greet .prep .prep-item input'); await page.click('#thread .msg.greet .prep .prep-item:nth-child(2) input'); await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/prep-morning-ticking-${scheme}.png` });
      await tickAll(page); s = await state(page);
      ok(`[${scheme}] morning: ticked through, it folds away to one line`, s.done && !s.open && /Bag checked: Clinical: Mercy Hospital 4 West/.test(s.row) && s.writes.some(w => w[0] === today && w[1].some(k => k.startsWith('prep-morning-'))), JSON.stringify([s.row, s.open]));
      await page.screenshot({ path: `${shots}/prep-morning-done-${scheme}.png` });
      ok(`[${scheme}] morning: no sideways scroll`, !s.sideways);
      ok(`[${scheme}] morning: no page errors`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
  await browser.close();
  for (const [st, n, d] of results) console.log(`${st}  ${n}${d && st === 'FAIL' ? '  -- ' + d : ''}`);
  const failed = results.filter(x => x[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} of ${results.length} checks pass; screenshots in ${shots}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
