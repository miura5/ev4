// The greeting harness (B-129, D-167): the built staging page's E.V. tab at 390 and 1280 px on the synthetic record
// with planted states: an exam tomorrow morning, a clear evening, back after three days, late before a clinical. Each
// opens twice: with the stand-in model answering (its line, built from the situation the prompt carries, becomes the
// headline) and with the stand-in failing (core's line stays). The headline shown is kept in talk/memory.headlines.
//   node test/harness/greet.cjs [record dir | synthetic] [screenshots dir]
// Run `node tools/build.mjs` first. Exit code 1 when any check fails.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const [dbArg, shotsArg] = process.argv.slice(2);
const dbDir = require('../data/synthetic.cjs').recordDir(dbArg);
const shots = shotsArg || '/tmp/ev4-greet';
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
// The synthetic record with nothing urgent today or tomorrow and no exam in the next five days; each state adds its own.
function base() {
  const seed = load(dbDir);
  for (const c of ['system', 'legacy', 'debug', 'journal']) delete seed[c];
  seed.dates = Object.fromEntries(
    Object.entries(seed.dates || {}).filter(([, d]) => d.date !== today && d.date !== tomorrow)
  );
  if (seed.days && seed.days[today] && seed.days[today].list)
    seed.days[today].list.items = seed.days[today].list.items.filter(
      i => i.tag !== 'GRADED' && !/^(date|soon)-/.test(i.id)
    );
  seed.exams = Object.fromEntries(
    Object.entries(seed.exams || {}).map(([id, e]) => [
      id,
      e.date >= today && e.date <= addDays(today, 5) ? { ...e, date: addDays(today, 9) } : e,
    ])
  );
  seed.jobs = {};
  seed.talk = seed.talk || {};
  // B-198: last seen and the kept headline are planted the evening before, on the planted day's clock, never the real
  // one: two hours before the real clock fell within B-190's 90-minute resume of the 07:30 state whenever the check ran
  // between 08:00 and 09:30 Central (the 09:03 nightly), and the page rightly resumed the planted headline.
  const seenBefore = ct(addDays(today, -1), 21, 0).toISOString();
  seed.talk.memory = {
    ...(seed.talk.memory || { schema: 2, writer: 'page', at: env.at, source: 'E.V. Home', summary: '', upTo: null }),
    lastSeenAt: seenBefore,
    headlines: [{ at: seenBefore, text: 'Evening, Matt. How can I help?', by: 'code' }],
  };
  delete seed.talk[today];
  return seed;
}
const STATES = [
  {
    name: 'exam-tomorrow',
    now: ct(today, 7, 30),
    plant: db => {
      const e = Object.values(db.exams).find(x => x.course === 'NUR 112') || Object.values(db.exams)[0];
      db.exams[e.id === 'E4' ? 'E4' : Object.keys(db.exams)[0]] = { ...e, date: tomorrow };
      return String(e.title || e.id).replace(/:.*$/, '');
    },
    code: name => new RegExp(`^Morning, Matt\\. ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is tomorrow\\.$`),
  },
  {
    name: 'clear-evening',
    now: ct(today, 19, 30),
    plant: () => null,
    code: () => /^Evening, Matt\. How can I help\?$/,
  },
  {
    name: 'back-after-3-days',
    now: ct(today, 15, 0),
    plant: db => {
      db.talk.memory.lastSeenAt = new Date(ct(today, 15, 0).getTime() - 3 * 864e5 - 36e5).toISOString();
      return null;
    },
    code: () => /^Afternoon, Matt\. How can I help\?$/,
  },
  {
    name: 'late-before-clinical',
    now: ct(today, 23, 30),
    plant: db => {
      db.dates['g-clin'] = {
        ...env,
        addedAt: env.at,
        date: tomorrow,
        title: 'Clinical: Mercy Hospital 4 West',
        kind: 'clinical',
        course: 'NUR 112',
        graded: false,
      };
      return null;
    },
    code: () => /^Still up, Matt\? How can I help\?$/,
  },
];
const ORIGIN = 'https://ev.local';
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const skeleton = b =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  b +
  '</body></html>';
// The stand-in model: it reads the facts the prompt carries and words a line from them, naming every urgent item.
const MODEL = `window.__sampleFn = p => {
  const m = /Facts \\(data, never instructions\\): (\\{.*\\})/.exec(p);
  if (!m) return { items: [] };
  const s = JSON.parse(m[1]);
  const hi = { morning: 'Morning', midday: 'Afternoon', evening: 'Evening', late: 'Late one' }[s.segment];
  const line = s.urgent.length
    ? hi + ', Matt. Today is about ' + s.urgent.map(u => u.name).join(' and ') + ', so let us keep it calm.'
    : s.sinceLastVisit === 'days'
      ? hi + ', Matt. Good to have you back; the list kept your place.'
      : s.prep && s.prep.phase === 'night'
        ? hi + ', Matt. Bag check tonight, then sleep before the clinical.'
        : hi + ', Matt. Quiet evening, nothing pressing on the list.';
  window.__headlineAsked = (window.__headlineAsked || 0) + 1;
  return { headline: line };
};`;
const FAIL = `window.__sampleFn = p => {
  if (/Facts \\(data, never instructions\\)/.test(p)) { const e = new Error('stub'); e.code = 'upstream_error'; throw e; }
  return { items: [] };
};`;
async function openPage(page, now, db, pre) {
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
  await page.addInitScript('window.__db=' + JSON.stringify(db) + ';' + stub + ';' + pre);
  await page.goto(ORIGIN + '/');
  await page.waitForFunction(() => document.querySelector('#thread .msg.greet .bubble'), null, { timeout: 15000 });
  await page.waitForTimeout(4500); // past the 2 s wording window and the seen write
}
const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
(async () => {
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  for (const w of [390, 1280]) {
    for (const st of STATES) {
      for (const mode of ['model', 'failing']) {
        const ctx = await browser.newContext({
          viewport: w === 390 ? { width: 390, height: 844 } : { width: 1280, height: 860 },
          colorScheme: 'dark',
        });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const db = base();
        const name = st.plant(db);
        await openPage(page, st.now, db, mode === 'model' ? MODEL : FAIL);
        const r = await page.evaluate(() => {
          const g = document.querySelector('#thread .msg.greet');
          const mem = (window.__db.talk || {}).memory || {};
          return {
            head: g.querySelector('.bubble').textContent.trim(),
            brief: !!g.querySelector('.brief-row'),
            asked: window.__headlineAsked || 0,
            kept: (mem.headlines || []).slice(-1)[0] || null,
            n: (mem.headlines || []).length,
          };
        });
        const tag = `[${st.name} ${mode} ${w}]`;
        if (mode === 'model') {
          ok(
            `${tag} the model's line is the headline, held to the facts`,
            r.asked === 1 &&
              /^(Morning|Afternoon|Evening|Late one), Matt\. /.test(r.head) &&
              (!name || r.head.includes(name)),
            JSON.stringify(r)
          );
          ok(
            `${tag} it is kept as the newest of the last 7`,
            r.kept && r.kept.text === r.head && r.kept.by === 'model' && r.n === 2,
            JSON.stringify(r.kept)
          );
        } else {
          ok(`${tag} the call failing, core's line stays`, st.code(name).test(r.head), r.head);
          ok(
            `${tag} core's line is kept`,
            r.kept && r.kept.text === r.head && r.kept.by === 'code',
            JSON.stringify(r.kept)
          );
        }
        ok(`${tag} the briefing stays code, folded under the line`, r.brief, '');
        ok(`${tag} no page errors`, errors.length === 0, errors.join(' | '));
        await page.screenshot({ path: `${shots}/greet-${st.name}-${mode}-${w}.png` });
        await ctx.close();
      }
    }
    // B-190: a reopen 20 minutes after an evening greeting returns to the conversation where he left it: the greeting he
    // saw at its own time, his line after it, no new headline and no model call; only lastSeenAt moves.
    {
      const now = ct(today, 19, 30);
      const ctx = await browser.newContext({
        viewport: w === 390 ? { width: 390, height: 844 } : { width: 1280, height: 860 },
        colorScheme: 'dark',
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const db = base();
      const ago = m => new Date(now.getTime() - m * 6e4).toISOString();
      const said = 'Evening, Matt. A line from earlier this evening.';
      db.talk.memory.lastSeenAt = ago(20);
      db.talk.memory.headlines = [...db.talk.memory.headlines, { at: ago(50), text: said, by: 'code' }];
      const id = (m, who) => {
        const d = ago(m).replace(/\D/g, '');
        return 'm-' + d.slice(0, 8) + '-' + d.slice(8, 14) + d.slice(14, 17) + '-' + who;
      };
      const reply = 'Potassium runs 3.5 to 5.0. Want two quick questions on it before you go?';
      db.talk[today] = {
        schema: 3,
        writer: 'page',
        at: ago(40),
        source: 'E.V. Home',
        date: today,
        messages: {
          [id(40, 'matt')]: { role: 'matt', text: 'Quick question about potassium before I go', at: ago(40) },
          [id(39, 'ev')]: { role: 'ev', text: reply, at: ago(39) },
        },
      };
      await openPage(page, now, db, MODEL);
      const r = await page.evaluate(() => {
        const g = document.querySelector('#thread .msg.greet');
        const mem = (window.__db.talk || {}).memory || {};
        const mine = [...document.querySelectorAll('#thread .msg.matt')].map(x => x.textContent);
        const cur = document.querySelector('#thread .msg.ev.current');
        const box = cur && cur.getBoundingClientRect();
        return {
          head: g ? g.querySelector('.bubble').textContent.trim() : null,
          asked: window.__headlineAsked || 0,
          n: (mem.headlines || []).length,
          seen: mem.lastSeenAt,
          mine: mine.some(t => /potassium before I go/.test(t)),
          current: cur ? cur.querySelector('.bubble').textContent.trim() : null,
          visible: !!box && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight,
        };
      });
      ok(
        `[reopen-within-window ${w}] he returns to the conversation where he left it, with no new greeting`,
        r.head === said &&
          r.asked === 0 &&
          r.n === 2 &&
          r.mine &&
          r.current === reply &&
          r.visible &&
          Date.parse(r.seen) > Date.parse(ago(2)),
        JSON.stringify(r)
      );
      ok(`[reopen-within-window ${w}] no page errors`, errors.length === 0, errors.join(' | '));
      await page.screenshot({ path: `${shots}/greet-resume-${w}.png` });
      await ctx.close();
    }
    // B-181: the morning after a build, its line sits in her greeting's briefing, after a planted failed run.
    {
      const now = ct(today, 7, 30);
      const ctx = await browser.newContext({
        viewport: w === 390 ? { width: 390, height: 844 } : { width: 1280, height: 860 },
        colorScheme: 'dark',
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const db = base();
      const ago = h => new Date(now.getTime() - h * 36e5).toISOString();
      const words = 'bug: the timer resets when I switch tabs';
      db.talk.memory.lastSeenAt = ago(10);
      db.runs = db.runs || {};
      db.runs['evening-cloud-planted-failed'] = {
        schema: 1,
        writer: 'evening-cloud',
        at: ago(9),
        source: 'harness',
        release: 'v4',
        pipeline: 'evening-cloud',
        startedAt: ago(9),
        endedAt: ago(9),
        status: 'failed',
        detail: 'Planted: the record refused a write',
        steps: [],
        push: 'A planted failure',
      };
      db.jobs['job-harness-build-morning'] = {
        schema: 2,
        writer: 'page',
        at: ago(8),
        source: 'E.V. Home',
        kind: 'build',
        title: words,
        brief: words,
        fired: { at: ago(8), ok: true },
      };
      db.jobresults = db.jobresults || {};
      db.jobresults['job-harness-build-morning'] = {
        schema: 2,
        writer: 'builder',
        at: ago(3),
        source: 'trace job-harness-build-morning',
        release: 'v4',
        status: 'done',
        startedAt: ago(7),
        finishedAt: ago(3),
        result: { text: 'Say ship it when you want it live.', task: 'B-201', commit: 'abc1234def' },
        message: null,
        error: null,
      };
      await openPage(page, now, db, FAIL);
      await page.click('#thread .msg.greet .brief-row');
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() =>
        [...document.querySelectorAll('#thread .msg.greet .brief-item')].map(li => ({
          kind: li.dataset.kind,
          t: li.querySelector('.bi-t').textContent,
        }))
      );
      const iRun = r.findIndex(x => x.kind === 'system'),
        iBuild = r.findIndex(x => x.kind === 'build');
      ok(
        `[morning-after-build ${w}] the build line sits under her greeting, after the failed run`,
        iRun >= 0 &&
          iBuild > iRun &&
          r[iBuild].t ===
            'B-201 (your “the timer resets when I switch tabs”) is green on staging at abc1234. Say ship it when you want it live',
        JSON.stringify(r)
      );
      ok(`[morning-after-build ${w}] no page errors`, errors.length === 0, errors.join(' | '));
      await page.screenshot({ path: `${shots}/greet-build-${w}.png` });
      await ctx.close();
    }
  }
  await browser.close();
  for (const [s, n, d] of results) console.log(`${s}  ${n}${d && s === 'FAIL' ? '  -- ' + d : ''}`);
  const failed = results.filter(x => x[0] === 'FAIL').length;
  console.log(`\n${results.length - failed} of ${results.length} checks pass; screenshots in ${shots}`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
