// B-222 (D-227): Check answer to verdict paint, with the record stub slow. One measurement for every place the question
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
      if (opt) opt.click();
      else if (ta && !ta.value.trim()) {
        ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const check = [...box.querySelectorAll('button')].find(b => b.textContent.trim() === 'Check answer');
      if (!check || check.disabled) return { none: 'no Check answer in ' + root };
      const answersWrites = () => (window.__writes || []).filter(w => w[1] === 'answers').length;
      const before = answersWrites();
      window.__writeDelayMs = delay;
      const t0 = performance.now();
      check.click();
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
        recordLanded: answersWrites() > before,
        saving: /Saving…/.test(document.querySelector(root).textContent),
      };
      window.__writeDelayMs = 0;
      return out;
    },
    [root, delay, text]
  );
}
/** A scored item paints within 100 ms of the tap; an open one paints before the record's write lands. */
function painted(r) {
  return !!r && !!r.verdict && !r.saving && !r.recordLanded && (r.open || r.ms < 100);
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
  if (await page.isVisible('#study-back')) await page.click('#study-back'); // out of the quiz card, to the view tabs
  if (v !== 'practice') {
    await page.click(`#seg-study [data-v="${v}"]`);
    return shown();
  }
  await page.click('#seg-study [data-v="objectives"]');
  await page.waitForTimeout(100);
  const rows = page.locator('#ov-card .ov');
  for (let i = 0; i < (await rows.count()) && !(await shown()); i++) {
    const q = rows.nth(i).locator('.ov-q');
    if (await q.isVisible().catch(() => false)) await q.click();
    else {
      await rows.nth(i).locator('.ov-nm').click(); // the phone: the detail opens in place, Quiz me in it
      await page.waitForTimeout(80);
      const q2 = rows.nth(i).locator('.ov-more button');
      if (await q2.count()) await q2.first().click();
    }
    await page.waitForTimeout(150);
    if (!(await shown())) await page.click('#seg-study [data-v="objectives"]').catch(() => {});
  }
  if (await page.isVisible('#pr-fold')) await page.click('#pr-fold'); // back to the list of sets
  await page.waitForTimeout(100);
  return shown();
}
module.exports = { paintAnswer, painted, studyView };
