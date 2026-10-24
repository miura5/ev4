// B-223 (D-245, D-294): one right panel on every view, each thing once. collect() runs in the page and snapshots the
// three regions (sidebar, pane, right panel); judge() is pure, so a test can plant a repeat, an off-shade card or an
// empty panel and see each fail.
//   D-245: from 1200 px a view with detail to show has the right panel and a view without has none; its cards sit on
//          the ground with a hairline, in one shade on every tab and both themes, a review on Conversation included.
//   D-294: no record item shows in two of the sidebar, the pane and the right panel; the sidebar's Today steps aside
//          while Today is the view.
//   Matt, Oct 23: from 600 px her greeting and her lines read left-aligned on Conversation.

/** In the page: what each region shows. Titles are the rows' own names (a date's title, a task's words, a question's
 *  topic), so the same record item matches across regions whatever else its row carries. */
function collect() {
  const cs = getComputedStyle;
  const vis = e =>
    !!e &&
    !e.closest('[hidden]') &&
    cs(e).display !== 'none' &&
    cs(e).visibility !== 'hidden' &&
    e.getBoundingClientRect().height > 0 &&
    e.getBoundingClientRect().width > 0;
  const TITLE = '.si .t, .ti-t, .wk-t, .sq-t, li.row .grow > :first-child';
  const rgb = v => {
    const x = document.createElement('i');
    x.style.color = v;
    document.body.append(x);
    const c = cs(x).color;
    x.remove();
    return c;
  };
  const ground = rgb(cs(document.documentElement).getPropertyValue('--bg').trim());
  const view =
    (document.body.dataset.view || 'ev') + (document.body.classList.contains('surface-open') ? '+surface' : '');
  const side = document.querySelector('aside.side');
  // The right panel: whatever is fixed to the window's right edge beside the pane.
  const fixedRight = e => {
    if (!vis(e) || cs(e).position !== 'fixed') return false;
    const r = e.getBoundingClientRect();
    return Math.abs(innerWidth - 8 - r.right) <= 2 && r.left > innerWidth / 2;
  };
  const candidates = [
    ...document.querySelectorAll('section.panel:not([hidden]) .col-side, #study-side, #ev-side'),
  ].filter(fixedRight);
  const panel = candidates[0] || null;
  const cardsOf = p =>
    [...p.children]
      .filter(c => vis(c) && c.matches('.card, .surf, .sk-panel'))
      .map(c => ({
        // text lines are not cards
        id: c.id || c.className,
        bg: cs(c).backgroundColor,
        shadow: cs(c).boxShadow,
        text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
      }));
  const titles = (scope, skip = []) =>
    [...scope.querySelectorAll(TITLE)]
      .filter(t => vis(t) && !skip.some(s => s && s.contains(t)))
      .map(t => t.textContent.replace(/\s+/g, ' ').trim())
      .filter(t => t.length > 2);
  const pane = document.querySelector('section.panel:not([hidden])');
  const greet = document.querySelector('#thread .msg.greet .bubble, #thread .msg.ev.current .bubble');
  const capIn = document.querySelector('#thread .cap-in');
  const has = {
    ev: !!document.querySelector('#ev-dates, #ev-sess') || document.body.classList.contains('side-on'),
    study: [...document.querySelectorAll('#rv-body .q-stem, #pr-body .q-stem')].some(vis),
  };
  const v = document.body.dataset.view || 'ev';
  const detail =
    v === 'ev'
      ? has.ev
      : v === 'study'
        ? has.study
        : [...((pane && pane.querySelectorAll('.col-side > *')) || [])].some(vis);
  return {
    width: innerWidth,
    view,
    ground,
    detail,
    panel: panel ? { id: panel.id || panel.className, cards: cardsOf(panel), titles: titles(panel) } : null,
    pane: pane ? titles(pane, [panel]) : [],
    sidebar: side ? titles(side) : [],
    sideToday: vis(document.getElementById('side-today')),
    sideTodayItems: document.querySelectorAll('#side-today .si').length,
    greet:
      greet && capIn
        ? {
            align: cs(greet).textAlign,
            leftGap: Math.round(greet.getBoundingClientRect().left - capIn.getBoundingClientRect().left),
          }
        : null,
  };
}

/** The rules on one snapshot: [{rule, ok, detail}]. */
function judge(s) {
  const out = [];
  const r = (rule, ok, detail) => out.push({ rule, ok: !!ok, detail });
  const wide = s.width >= 1200;
  const base = s.view.replace('+surface', '');
  r(
    'D-245 panel',
    wide ? !!s.panel === !!s.detail : !s.panel,
    `${s.view} at ${s.width}: detail ${!!s.detail}, panel ${s.panel ? s.panel.id : 'none'}`
  );
  if (s.panel) {
    r('D-245 not empty', s.panel.cards.length > 0, `${s.panel.id}: ${s.panel.cards.length} visible cards`);
    const off = s.panel.cards.filter(c => c.bg !== s.ground || !/1px/.test(c.shadow) || c.shadow === 'none');
    r(
      'D-245 shade',
      !off.length,
      off.length
        ? 'off the ground or without a hairline: ' + off.map(c => `${c.id} (${c.bg}; ${c.shadow})`).join(' | ')
        : `every card on ${s.ground} with a hairline`
    );
  }
  const regions = { sidebar: s.sidebar, pane: s.pane, panel: s.panel ? s.panel.titles : [] };
  const seen = {};
  for (const [name, list] of Object.entries(regions))
    for (const t of new Set(list)) (seen[t] = seen[t] || []).push(name);
  const twice = Object.entries(seen).filter(([, w]) => w.length > 1);
  r(
    'D-294 once',
    !twice.length,
    twice.length ? twice.map(([t, w]) => `"${t.slice(0, 40)}" in ${w.join(' and ')}`).join(' | ') : 'nothing twice'
  );
  if (base === 'today') r('D-294 Today steps aside', !s.sideToday, `sidebar Today shown: ${s.sideToday}`);
  if (base === 'study' && s.width >= 600 && s.sideTodayItems)
    r('D-294 Today in the sidebar elsewhere', s.sideToday, `sidebar Today shown: ${s.sideToday}`);
  if (base === 'ev' && s.width >= 600 && s.greet)
    r(
      'left-aligned (Matt, Oct 23)',
      /^(left|start)$/.test(s.greet.align) && s.greet.leftGap <= 12,
      JSON.stringify(s.greet)
    );
  return out;
}
module.exports = { collect, judge };
