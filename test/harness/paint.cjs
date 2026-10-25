// B-222 (D-227): Check answer (or, in Study, the tap on a one-answer question, B-365) to verdict paint, with the record stub slow. One measurement for every place the question
// runner draws a question: Study's Review and Practice, a surface's set and a session's check (open answers included).
// root: the element the question sits in. With an open answer the verdict waits for grading, never for the record:
// the result says whether the record's answers write had landed when the verdict painted (it must not have).
async function paintAnswer(page, root, { delay = 2000, text = 'Fluid shifts into the cells.' } = {}) {
  return page.evaluate(
    async ([root, delay, text]) => {
      const box = document.querySelector(root);
      if (!box) return { none: 'no ' + root };
      const opt = box.querySelector('label.opt input');
      const ta = box.querySelector('textarea.open-in');
      const answersWrites = () => (window.__writes || []).filter(w => w[1] === 'answers').length;
      const before = answersWrites();
      window.__writeDelayMs = delay;
      let t0 = performance.now();
      if (opt) opt.click();
      else if (ta && !ta.value.trim()) {
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // B-365 (D-316): in Study a one-answer question grades on the tap itself, with no Check answer
      const check = [...box.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check answer');
      if (check && !check.disabled) {
        t0 = performance.now();
        check.click();
      } else if (!opt) {
        window.__writeDelayMs = 0;
        return { none: 'no Check answer in ' + root };
      }
      const verdict = () =>
        [...document.querySelectorAll(root + ' .verdict')].find(
          e => !e.closest('[hidden]') && e.getBoundingClientRect().height > 0
        );
      let frames = 0;
      while (!verdict() && performance.now() - t0 < 1500) {
        await new Promise(r => requestAnimationFrame(() => r()));
        frames++;
      }
      if (!frames) await new Promise(r => requestAnimationFrame(() => r()));
      const v = verdict();
      const out = {
        open: !opt && !!ta,
        verdict: v ? v.textContent.trim().slice(0, 80) : '',
        ms: Math.round(performance.now() - t0),
        frames,
        recordLanded: answersWrites() > before,
        saving: /Saving…/.test(document.querySelector(root).textContent),
      };
      window.__writeDelayMs = 0;
      return out;
    },
    [root, delay, text]
  );
}
/** A scored item paints on the first frame after the tap; an open one paints before the record's write lands. */
function painted(r) {
  // B-357: by frames, not wall-clock: a scored verdict is there on the first frame after the tap (frames counts the
  // frames waited before it showed; a loaded machine stretches their time, not their number), and a loose 500 ms bound
  // so a tap that stalls still fails
  return !!r && !!r.verdict && !r.saving && !r.recordLanded && (r.open || (r.frames <= 1 && r.ms < 500));
}
// B-297 (D-283): Study's tabs are Objectives, Plan and Weak spots. A set opens in the quiz card the way he opens it:
// today's review from its row on Today (its task's panel, B-296), a practice set from an objective's Quiz me (its fold line then leads back to
// the sets).
// Resolves true once the view shows.
async function studyView(page, v) {
  const shown = () => page.evaluate(v => !document.getElementById('study-' + v).hidden, v);
  if (v === 'review') {
    // today's list carries the review as the morning writes it (core buildDayList: ref sets/review-<date>); a seed
    // whose list has no such row gets one, written as the morning would and kept out of the page's own writes
    await page.evaluate(async () => {
      const today = window.EVCore.chicagoDate(new Date()),
        id = 'review-' + today;
      if (!(window.__db.sets || {})[id]) return;
      const db = await window.claude.use('db'),
        ref = db.collection('days').doc(today),
        d = (await ref.get()).data();
      if (!d || !d.list || d.list.items.some(i => i.ref === 'sets/' + id)) return;
      d.list.items.push({
        id: 'review-base',
        text: 'Review · today’s set',
        tag: 'REVIEW',
        minutes: 16,
        ref: 'sets/' + id,
      });
      await ref.set(d);
      window.__writes.pop();
    });
    await page.click('#tab-today');
    await page.waitForTimeout(150);
    const row = page.locator('#today-list .ti-nm', { hasText: /^Review/ });
    if (await row.count()) {
      // B-296 (C-10): the row's name opens its task's panel; Start (or Open, once it can't start) opens the set
      await row.first().click();
      const go = '#today-task :is(.tp-start, .tp-open)';
      if (await page.waitForSelector(go, { state: 'visible', timeout: 1500 }).catch(() => null)) await page.click(go);
    }
    await page.waitForTimeout(100);
    return shown();
  }
  await page.click('#tab-study');
  // B-357 (D-315): Study is the demo's overview with no view tabs. Each way back (All topics, the plan's and Weak
  // spots' own) returns to it; Weak spots · N opens Weak spots; a plan day's Open the plan opens the plan.
  for (const back of ['#study-back', '#plan-back', '#weak-back'])
    if (await page.isVisible(back)) {
      await page.click(back);
      await page.waitForTimeout(80);
    }
  if (v === 'objectives') return shown();
  if (v === 'weak') {
    if (await page.isVisible('#study-qweak')) await page.click('#study-qweak');
    await page.waitForTimeout(100);
    return shown();
  }
  if (v === 'plan') {
    const open = page.locator('#p-study .od-q', { hasText: 'Open the plan' });
    if (!(await open.count())) {
      const day = page.locator('#p-study .ov-nm').first();
      if (await day.count()) await day.click();
      await page.waitForTimeout(100);
    }
    if (await open.count()) await open.first().click();
    await page.waitForTimeout(100);
    return shown();
  }
  await page.waitForTimeout(100);
  const rows = page.locator('#ov-card .ov');
  for (let i = 0; i < (await rows.count()) && !(await shown()); i++) {
    const q = rows.nth(i).locator('.oq');
    await rows.nth(i).locator('.obj').hover();
    if (await q.isVisible().catch(() => false)) await q.click();
    else {
      await rows.nth(i).locator('.ov-nm').click(); // the detail opens (under the row, or in the panel), Quiz me on this
      await page.waitForTimeout(80);
      const q2 = page.locator('#p-study .od-q', { hasText: 'Quiz me on this' });
      if (await q2.count()) await q2.first().click();
    }
    await page.waitForTimeout(150);
    if (!(await shown()) && (await page.isVisible('#study-back'))) await page.click('#study-back').catch(() => {});
  }
  await page.waitForTimeout(100);
  return shown();
}
/**
 * B-303 (D-283): with the Practice list retired, a set opens where he meets it: here through a row of today's list
 * naming it (sets/<id>, as the morning or E.V. writes one), planted for the open and taken out again so no later check
 * sees it, both kept out of the page's own writes. Then the row's Start (or Open) in its task panel. Ends with the set
 * in Study's quiz card; returns whether it shows.
 */
async function openSet(page, id) {
  const plant = add =>
    page.evaluate(
      async ({ id, add }) => {
        const today = window.EVCore.chicagoDate(new Date()),
          set = (window.__db.sets || {})[id];
        const db = await window.claude.use('db'),
          ref = db.collection('days').doc(today),
          d = (await ref.get()).data() || { list: { items: [] } };
        d.list = d.list || { items: [] };
        d.list.items = (d.list.items || []).filter(i => i.id !== 'harness-open-' + id);
        if (add)
          d.list.items.unshift({
            id: 'harness-open-' + id,
            text: (set && set.title) || id,
            tag: 'PRACTICE',
            minutes: 5,
            ref: 'sets/' + id,
          });
        await ref.set(d);
        window.__writes.pop();
      },
      { id, add }
    );
  await plant(true);
  if (await page.isVisible('#study-back')) await page.click('#study-back');
  await page.click('#tab-today');
  await page.waitForTimeout(150);
  const fold = page.locator('#today-list .ti-fold[aria-expanded="false"]');
  const title = await page.evaluate(id => ((window.__db.sets || {})[id] || {}).title || id, id);
  const nm = page.locator('#today-list .ti-nm').filter({ hasText: title });
  if (!(await nm.count()) && (await fold.count())) await fold.first().click();
  await nm.first().click();
  const go = '#today-task :is(.tp-start, .tp-open)';
  if (await page.waitForSelector(go, { state: 'visible', timeout: 1500 }).catch(() => null)) await page.click(go);
  await page.waitForTimeout(150);
  await plant(false);
  await page.waitForTimeout(100);
  return page.evaluate(() => !document.getElementById('study-practice').hidden);
}
module.exports = { paintAnswer, painted, studyView, openSet };
