// The smoke tier (B-199): a two-minute subset of the page harnesses for every push and for a build session while it
// works. On the synthetic record, at 390 and 1280: the page boots with no page error, the greeting renders, each tab
// opens its panel, one Today check-off keeps the scroll, one review answer scores, one Your-turn reply files. The full
// `npm run check` stays nightly and before live.
//   node test/harness/smoke.cjs [record dir | synthetic] [screenshots dir] [--plant page-error|broken-tab]
// Run `node tools/build.mjs` first (`npm run smoke` does both). Exit code 1 when any check fails. --plant breaks the
// served page on purpose, to prove the tier turns red (the workflow runs both plants and expects red).
const { chromium } = require('playwright');
const { paintAnswer, painted, studyView, openSet } = require('./paint.cjs');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const plantAt = args.indexOf('--plant');
const PLANT = plantAt >= 0 ? args.splice(plantAt, 2)[1] : null;
if (PLANT && !['page-error', 'broken-tab'].includes(PLANT)) {
  console.error(`smoke: no such plant "${PLANT}" (page-error, broken-tab)`);
  process.exit(2);
}
const dbDir = require('../data/synthetic.cjs').recordDir(args[0] || 'synthetic');
const shots = args[1] || '/tmp/ev4-smoke';
fs.mkdirSync(shots, { recursive: true });
const pageDir = path.join(root, 'dist/page/staging');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'spec/ev.spec.json'), 'utf8'));
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
// One ask waiting on Matt, so the Your-turn reply has something to answer (the run harness's B-182 shape).
seed.system = {
  yourturn: {
    schema: 2,
    writer: 'deploy',
    at: new Date().toISOString(),
    source: 'ship staging at abc1234',
    commit: 'abc1234',
    groups: [
      {
        place: 'decision',
        label: 'A decision (a reply in a build chat)',
        tasks: [{ id: 'B-910', ask: 'Blue or red for the timer?', status: 'blocked', choices: ['Blue', 'Red'] }],
      },
    ],
  },
};
const stub = fs.readFileSync(path.join(__dirname, 'stub.js'), 'utf8');
const skeleton = body =>
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>' +
  body +
  '</body></html>';
// The plants: what a real regression looks like from outside. page-error: app.js throws once the page is up.
// broken-tab: the Progress panel never shows when its tab is chosen.
const planted = name => {
  const f = path.join(pageDir, name);
  if (!fs.existsSync(f)) return null;
  let body = fs.readFileSync(f, 'utf8');
  if (PLANT === 'page-error' && name === 'app.js')
    body += "\n;setTimeout(() => { throw new Error('planted page error (smoke --plant page-error)'); }, 300);\n";
  if (PLANT === 'broken-tab' && name === 'styles.css') body += '\n#p-progress{display:none!important}\n';
  return body;
};

const results = [];
const ok = (name, cond, detail = '') => results.push([cond ? 'PASS' : 'FAIL', name, detail]);
const until = (page, fn, arg, ms = 4000) =>
  page
    .waitForFunction(fn, arg, { timeout: ms })
    .then(() => true)
    .catch(() => false);

async function open(browser, viewport) {
  const page = await browser.newPage({ viewport, colorScheme: 'dark' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route(ORIGIN + '/**', r => {
    const name = new URL(r.request().url()).pathname.replace(/^\//, '') || 'index.html';
    if (name === 'index.html')
      return r.fulfill({
        body: skeleton(fs.readFileSync(path.join(pageDir, 'index.html'), 'utf8')),
        contentType: 'text/html',
      });
    const body = planted(name);
    return body == null
      ? r.fulfill({ status: 404, body: 'not published' })
      : r.fulfill({ body, contentType: TYPES[path.extname(name)] || 'application/octet-stream' });
  });
  await page.addInitScript('window.__db=' + JSON.stringify(seed) + ';' + stub);
  await page.goto(ORIGIN + '/');
  return { page, errors };
}

(async () => {
  const t0 = Date.now();
  const browser = await chromium
    .launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
    .catch(() => chromium.launch());
  for (const [scheme, viewport] of [
    ['390', { width: 390, height: 844 }],
    ['1280', { width: 1280, height: 860 }],
  ]) {
    const tag = `[${scheme}]`;
    const { page, errors } = await open(browser, viewport);

    // 1. Boots: the shell loads its files from one release and connects.
    const booted = await until(page, () => /^Live$/.test((document.getElementById('status') || {}).textContent || ''));
    ok(
      `${tag} the page boots and connects to the record`,
      booted && (await page.evaluate(() => !!(window.EVCore && window.EVApp))),
      await page.evaluate(() => (document.getElementById('status') || {}).textContent || '')
    );

    // 2. The greeting renders.
    const greeted = await until(page, () => {
      const m = document.querySelector('#thread .msg.ev');
      return !!m && m.textContent.trim().length > 0;
    });
    ok(
      `${tag} the greeting renders`,
      greeted,
      await page
        .locator('#thread .msg.ev')
        .first()
        .textContent()
        .catch(() => '')
    );

    // 3. Each tab opens its own panel.
    const opened = [];
    for (const t of ['today', 'study', 'progress', 'record', 'system', 'ev']) {
      // B-334: System sits in the Preferences popover
      if (t === 'system' && !(await page.isVisible('#tab-system'))) await page.click('#side-prefs-btn');
      await page.click('#tab-' + t);
      const shown = await until(
        page,
        id => {
          const p = document.getElementById('p-' + id);
          return !!p && !p.hidden && getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 0;
        },
        t,
        1500
      );
      if (!shown) opened.push(t);
    }
    ok(
      `${tag} each tab opens its panel`,
      opened.length === 0,
      opened.length ? 'did not open: ' + opened.join(', ') : ''
    );

    // 4. One Today check-off keeps the scroll and the rows in place.
    await page.click('#tab-today');
    const tick = page.locator('#today-list input.tick:not(:checked)').first();
    if (await tick.count()) {
      await tick.evaluate(n => n.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(150);
      const before = await page.evaluate(() => ({
        y: Math.round(scrollY),
        rows: [...document.querySelectorAll('#today-list .li')].map(r => Math.round(r.getBoundingClientRect().top)),
        n: document.querySelectorAll('#today-list input.tick:checked').length,
      }));
      await tick.click();
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => ({
        y: Math.round(scrollY),
        rows: [...document.querySelectorAll('#today-list .li')].map(r => Math.round(r.getBoundingClientRect().top)),
        n: document.querySelectorAll('#today-list input.tick:checked').length,
      }));
      ok(
        `${tag} a Today check-off ticks and keeps the scroll and the rows in place`,
        after.n === before.n + 1 &&
          Math.abs(after.y - before.y) <= 1 &&
          after.rows.length === before.rows.length &&
          after.rows.every((y, i) => Math.abs(y - before.rows[i]) <= 1),
        JSON.stringify({ before, after })
      );
    } else ok(`${tag} a Today check-off ticks and keeps the scroll and the rows in place`, false, 'no item to tick');

    // B-200 (D-208): with the record 2 s slow, the next check-off paints ticked (and live) on the tap's next frame; a
    // refused one unticks and says why in one line.
    const tapTick = (fail, delay) =>
      page.evaluate(
        async ([fail, delay]) => {
          const c = document.querySelector('#today-list input.tick:not(:checked)');
          if (!c) return null;
          window.__writeDelayMs = delay;
          window.__writeFail = fail;
          const t0 = performance.now();
          c.click();
          await new Promise(r => requestAnimationFrame(() => r()));
          const painted = { ticked: c.checked, live: !c.disabled, ms: Math.round(performance.now() - t0) };
          if (fail) await new Promise(r => setTimeout(r, delay + 300));
          window.__writeDelayMs = 0;
          window.__writeFail = null;
          const toast = document.getElementById('toast');
          return { ...painted, after: c.checked, line: toast && !toast.hidden ? toast.textContent.trim() : '' };
        },
        [fail, delay]
      );
    const slowTick = await tapTick(null, 2000);
    ok(
      `${tag} a check-off paints ticked on the tap's frame, the record 2 s behind (D-208)`,
      !!slowTick && slowTick.ticked && slowTick.live && slowTick.ms < 100,
      JSON.stringify(slowTick)
    );
    const refused = await tapTick('permission_denied', 300);
    ok(
      `${tag} a refused check-off unticks and says why in one line (D-208)`,
      !!refused && refused.ticked && !refused.after && /^Couldn’t save: .*permission_denied/.test(refused.line),
      JSON.stringify(refused)
    );

    // 5. One review answer scores.
    await studyView(page, 'review'); // B-297: from Today, as he opens it
    const hasQ = await until(page, () => !!document.querySelector('#rv-body label.opt'), null, 2000);
    // B-222 (D-227): Check answer paints the verdict and its why on the tap's next frame, the record 2 s behind; a
    // refused write puts the question back unanswered (his pick kept) with one line saying why.
    const checkAnswer = (root, fail, delay) =>
      page.evaluate(
        async ([root, fail, delay]) => {
          const box = document.querySelector(root);
          const opt = box && box.querySelector('label.opt input');
          const check = box && [...box.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check answer');
          if (!opt || !check) return { none: (box ? box.textContent : 'no box').slice(0, 300) };
          opt.click();
          window.__writeDelayMs = delay;
          window.__writeFail = fail;
          const t0 = performance.now();
          check.click();
          await new Promise(r => requestAnimationFrame(() => r()));
          const ms = Math.round(performance.now() - t0);
          const verdict = () =>
            [...document.querySelectorAll(root + ' .verdict')].find(
              e => !e.closest('[hidden]') && e.getBoundingClientRect().height > 0
            );
          const v = verdict();
          const painted = {
            verdict: v ? v.textContent.trim().slice(0, 80) : '',
            ms,
            saving: /Saving/.test(box.textContent),
          };
          if (fail) await new Promise(r => setTimeout(r, delay + 300));
          window.__writeDelayMs = 0;
          window.__writeFail = null;
          const t = document.getElementById('toast');
          const again = [...document.querySelectorAll(root + ' button')].some(
            b => b.textContent.trim() === 'Check answer'
          );
          const kept = !!document.querySelector(root + ' label.opt input:checked');
          return { ...painted, back: !verdict() && again, kept, line: t && !t.hidden ? t.textContent.trim() : '' };
        },
        [root, fail, delay]
      );
    if (hasQ) {
      const slow = await checkAnswer('#rv-body', null, 2000);
      ok(
        `${tag} Check answer paints the verdict on the tap's frame, the record 2 s behind (D-227)`,
        !!slow && /^(Right|Missed|Partly)\b/.test(slow.verdict) && !slow.saving && slow.ms < 100,
        JSON.stringify(slow)
      );
      const scored = await until(
        page,
        () => {
          const v = [...document.querySelectorAll('#rv-body .verdict')].find(
            e => !e.closest('[hidden]') && e.getBoundingClientRect().height > 0
          );
          return !!v && /^(Right|Missed|Partly)\b/.test(v.textContent.trim());
        },
        null,
        2000
      );
      ok(
        `${tag} a review answer scores`,
        scored,
        await page
          .locator('#rv-body .verdict')
          .first()
          .textContent()
          .catch(() => '')
      );
      // the next question (the record's own copy of the answer may land and redraw meanwhile)
      await until(
        page,
        () => {
          const b = [...document.querySelectorAll('#rv-body button')].find(x =>
            /^Next (question|unanswered)/.test(x.textContent.trim())
          );
          if (b) b.click();
          return (
            !!document.querySelector('#rv-body label.opt input:not(:checked)') &&
            [...document.querySelectorAll('#rv-body button')].some(x => x.textContent.trim() === 'Check answer')
          );
        },
        null,
        3000
      );
      const refused = await checkAnswer('#rv-body', 'permission_denied', 300);
      ok(
        `${tag} a refused answer puts the question back unanswered, his pick kept, and says why (D-227)`,
        !!refused &&
          !!refused.verdict &&
          refused.back &&
          refused.kept &&
          /^Couldn’t save that answer: .*permission_denied/.test(refused.line),
        JSON.stringify(refused)
      );
    } else ok(`${tag} a review answer scores`, false, 'no open review question');

    // B-222 (D-227): Practice's question runner paints the same way (a drill opened from today's list, B-303, its
    // first question).
    await openSet(
      page,
      await page.evaluate(
        () =>
          (Object.entries(window.__db.sets || {}).find(
            ([id, x]) =>
              !/^review-/.test(id) &&
              x.kind !== 'review' &&
              window.EVCore.validItems(x).some(
                q => (q.type || 'single') === 'single' && !(((window.__db.answers || {})[id] || {}).answers || {})[q.id]
              )
          ) || [''])[0]
      )
    );
    await until(page, () => !!document.querySelector('#pr-body label.opt input'), null, 2000);
    const pr = await paintAnswer(page, '#pr-body');
    ok(
      `${tag} Practice paints Check answer's verdict on the tap's frame, the record 2 s behind (D-227)`,
      painted(pr),
      JSON.stringify(pr)
    );

    // 6. One Your-turn reply files: the chip asks, Send writes the reply job and fires the builder.
    await page.click('#tab-ev');
    const chip = page.locator('#qchips button', { hasText: /^Your turn/ });
    if (
      await until(page, () =>
        [...document.querySelectorAll('#qchips button')].some(b => /^Your turn/.test(b.textContent))
      )
    ) {
      await chip.click();
      const item = page.locator('#ev-surf .yt-item[data-task="B-910"]');
      await until(page, () => !!document.querySelector('#ev-surf .yt-item[data-task="B-910"]'));
      await item.locator('.yt-chips button', { hasText: 'Blue' }).click();
      await item.locator('.yt-chips button', { hasText: 'Send' }).waitFor({ timeout: 3000 });
      // B-210 (D-208): with the record 2 s slow, Send shows the reply as sent on the tap's next frame.
      const painted = await page.evaluate(async () => {
        window.__writeDelayMs = 2000;
        const b = [...document.querySelectorAll('#ev-surf .yt-item[data-task="B-910"] .yt-chips button')].find(
          x => x.textContent.trim() === 'Send'
        );
        const t0 = performance.now();
        b.click();
        await new Promise(r => requestAnimationFrame(() => r()));
        const sent = !!document.querySelector('#ev-surf .yt-item[data-task="B-910"] .yt-sent');
        window.__writeDelayMs = 0;
        return { sent, ms: Math.round(performance.now() - t0) };
      });
      ok(
        `${tag} a Your-turn Send paints its sent state on the tap's frame, the record 2 s behind (D-208)`,
        painted.sent && painted.ms < 100,
        JSON.stringify(painted)
      );
      const filed = await until(
        page,
        trig =>
          Object.values(window.__db.jobs || {}).some(
            j => j.kind === 'reply' && j.title === 'B-910' && j.brief === 'Blue'
          ) && window.__mcpCalls.some(c => c[1] === 'fire_trigger' && c[2] && c[2].trigger_id === trig),
        spec.tasks.build['ev4-builder'].trigger,
        6000
      );
      ok(`${tag} a Your-turn reply files its job and fires the builder`, filed);
    } else ok(`${tag} a Your-turn reply files its job and fires the builder`, false, 'no Your turn chip');

    // B-200 (D-208): a quick-ask chip puts his line in the thread on the tap's next frame, the record 2 s behind.
    const chipPaint = await page.evaluate(async () => {
      const b = [...document.querySelectorAll('#qchips button')].find(x => !/^Your turn|^Resume /.test(x.textContent));
      if (!b) return null;
      const said = b.textContent.trim();
      window.__writeDelayMs = 2000;
      const t0 = performance.now();
      b.click();
      await new Promise(r => requestAnimationFrame(() => r()));
      const ms = Math.round(performance.now() - t0);
      const shown = [...document.querySelectorAll('#thread .msg.matt, #thread .cap-echo')].some(m =>
        m.textContent.trim().includes(said)
      );
      window.__writeDelayMs = 0;
      return { said, shown, ms };
    });
    ok(
      `${tag} a chip shows his line on the tap's frame, the record 2 s behind (D-208)`,
      !!chipPaint && chipPaint.shown && chipPaint.ms < 100,
      JSON.stringify(chipPaint)
    );

    await page.screenshot({ path: `${shots}/smoke-${scheme}.png` });
    ok(`${tag} no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  }
  await browser.close();
  for (const r of results) console.log(r[0], r[1], r[2] ? '· ' + r[2] : '');
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(
    `${failed ? failed + ' FAILED' : 'ALL PASSED'} of ${results.length} smoke checks in ${Math.round((Date.now() - t0) / 1000)} s${PLANT ? ' (planted: ' + PLANT + ')' : ''}`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
