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
module.exports = { paintAnswer, painted };
