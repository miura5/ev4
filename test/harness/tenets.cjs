// The UI tenets' checks (B-115; D-146 to D-151, "E.V. UI tenets and catch-up"; D-276 since B-303). collect runs in the page and returns a
// plain snapshot of the view on screen; judge holds the snapshot to each tenet, so a test can plant a snapshot without a
// browser. The look pass runs both on every view at 390, 735 and 1280 (spec.ui.tenets.widths) and prints each check;
// only the tabs in spec.ui.tenets.on fail the pass, the rest report until their catch-up task turns them on.

/** In the page: the view on screen, as data. Self-contained (it is serialized into the page). */
function collect() {
  const H = innerHeight;
  const vis = e => {
    if (!e || e.closest('[hidden]')) return false;
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    return (
      s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05 && r.width > 1 && r.height > 1
    );
  };
  const first = e => e.getBoundingClientRect().top < H;
  const panel = document.querySelector('section.panel:not([hidden])');
  const scope = [document.getElementById('top'), panel].filter(Boolean);
  const all = sel => scope.flatMap(s => [...s.querySelectorAll(sel)]).filter(vis);
  const own = e =>
    [...e.childNodes]
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent)
      .join('')
      .trim();
  const CONTROLS = 'button,input,select,textarea,a[href],[role=button],summary,label';
  const cards = [...(panel ? panel.querySelectorAll('.card') : [])].filter(vis).map(c => {
    const words = [...c.querySelectorAll('*')].filter(e => vis(e) && own(e) && !e.closest('h2,h3,.card-head,.empty'));
    return {
      id: c.id || '',
      cls: c.className,
      text: c.textContent.trim().replace(/\s+/g, ' ').slice(0, 80),
      controls: [...c.querySelectorAll(CONTROLS)].filter(vis).length,
      emptyOnly: !!c.querySelector('.empty') && vis(c.querySelector('.empty')) && !words.length,
    };
  });
  const primaries = all('button.primary:not([type=submit])')
    .filter(first)
    .map(b => b.textContent.trim() || b.getAttribute('aria-label') || '');
  // A lead is a block of large text (a revealed line's words are spans inside one block).
  const block = e => {
    let b = e;
    while (b.parentElement && /^inline/.test(getComputedStyle(b).display)) b = b.parentElement;
    return b;
  };
  const leads = [
    ...new Set(
      all('*')
        .filter(
          e => first(e) && own(e) && parseFloat(getComputedStyle(e).fontSize) >= 20 && !e.closest('.ptitle,h1,#top')
        )
        .map(block)
    ),
  ].map(b => b.textContent.trim().slice(0, 40));
  const lists = [...(panel ? panel.querySelectorAll('ul,ol') : [])].filter(vis).map(l => ({
    id: l.id || l.className,
    rows: [...l.children].filter(vis).length,
    // B-223 (D-245, Matt's rule): from 1200 px the right panel lists the open set's questions beside the question
    inPanel: !!l.closest('#study-side'),
  }));
  const rows = [...(panel ? panel.querySelectorAll('li.row, li.brief-item') : [])]
    .filter(vis)
    .map(r => ({ text: r.textContent.trim().slice(0, 40), h: Math.round(r.getBoundingClientRect().height) }));
  // D-276 (B-303): never two badges on a row; a mark counts for the nearest row that holds it, nested lists apart
  const ROW = 'li, .li, .row, tr, .ov, .rec-row';
  const per = new Map();
  for (const m of all('.badge, .chip')) {
    const r = m.closest(ROW);
    if (r) per.set(r, (per.get(r) || 0) + 1);
  }
  const twoBadges = [...per]
    .filter(([, n]) => n > 1)
    .map(([r, n]) => `${(r.id || r.textContent.trim()).slice(0, 30)} (${n})`);
  const chips = all('.chip, .qchip')
    .filter(first)
    .map(c => c.textContent.trim().slice(0, 30));
  const fonts = all('*')
    .filter(e => own(e))
    .map(e => getComputedStyle(e))
    .filter(
      s => /mono/i.test(s.fontFamily) || (s.textTransform === 'uppercase' && parseFloat(s.letterSpacing) > 0.5)
    ).length;
  // D-160: a button whose only job is to close or hide (by its words or its label).
  const closers = all('button,[role=button]')
    .map(b => (b.textContent.trim() || b.getAttribute('aria-label') || '').slice(0, 30))
    .filter(t => /^(hide|close|dismiss)\b|^[×✕✖]$/i.test(t));
  const hero = document.getElementById('hero');
  return {
    tab: ((panel && panel.id) || '').replace(/^p-/, ''),
    width: innerWidth,
    step: hero && hero.dataset.step,
    cards,
    primaries,
    leads,
    lists,
    rows,
    // what is urgent on screen: the briefing's urgent items while it shows (in a conversation it folds away, B-90)
    urgent: [...document.querySelectorAll('li.brief-item[data-level="urgent"]')].filter(
      e => !e.closest('.msg.greet:not(.current)')
    ).length,
    chips,
    twoBadges,
    monoOrSpacedCaps: fonts,
    closers,
    qchipsShown: vis(document.getElementById('qchips')),
  };
}

/** Each tenet's check on a snapshot: [{tenet, ok, detail}]. exceptions: {D-147: [card ids or classes], ...}. */
function judge(s, exceptions = {}) {
  const excused = (t, c) => (exceptions[t] || []).some(x => x === c.id || String(c.cls).split(/\s+/).includes(x));
  const r = (tenet, ok, detail) => ({ tenet, ok: !!ok, detail });
  const infoOnly = s.cards.filter(c => !c.controls && !c.emptyOnly && !excused('D-147', c));
  const emptyCards = s.cards.filter(c => c.emptyOnly && !excused('D-151', c));
  const open = s.lists.filter(l => l.rows > 5 && !l.inPanel),
    tall = s.rows.filter(x => x.h > 44);
  return [
    r(
      'D-146',
      s.primaries.length <= 1 && s.leads.length <= 1,
      `primary buttons in the first screen: ${s.primaries.length} (${s.primaries.join(', ')}); lead elements: ${s.leads.length} (${s.leads.join(' | ')})`
    ),
    r(
      'D-147',
      !infoOnly.length,
      infoOnly.length
        ? `cards with no control: ${infoOnly.map(c => c.id || c.text).join(' | ')}`
        : 'every card holds a control'
    ),
    r(
      'D-148',
      !open.length && !tall.length,
      `${open.length ? 'lists open with more than 5 rows: ' + open.map(l => `${l.id} (${l.rows})`).join(', ') + '; ' : ''}${
        tall.length
          ? `rows over 44 px: ${tall.length} (${tall
              .slice(0, 3)
              .map(x => x.h)
              .join(', ')} px)`
          : 'every row one line'
      }`
    ),
    // B-303: D-276 (words first, then the system's marks), the old words-not-chrome check brought in line: one font, no monospace or
    // spaced capitals, no more than three chips in the first screen, and never two badges on a row.
    r(
      'D-276',
      !s.monoOrSpacedCaps && s.chips.length <= 3 && !(s.twoBadges || []).length,
      `chips in the first screen: ${s.chips.length}; monospace or spaced capitals: ${s.monoOrSpacedCaps}; rows with two badges: ${(s.twoBadges || []).length ? s.twoBadges.join(', ') : 'none'}`
    ),
    r(
      'D-160',
      !(s.closers || []).length,
      (s.closers || []).length ? `buttons that only close or hide: ${s.closers.join(', ')}` : 'no close or hide button'
    ),
    r(
      'D-151',
      !emptyCards.length && !(s.step === 'conversation' && s.qchipsShown),
      `${emptyCards.length ? 'cards holding only an empty-state line: ' + emptyCards.map(c => c.id || c.text).join(' | ') : 'no empty-state card'}${s.step === 'conversation' ? `; chips ${s.qchipsShown ? 'shown' : 'hidden'} in a conversation` : ''}`
    ),
  ];
}

/** In the page (B-125, D-271): every CSS transition and animation declared on the bar and the tab on screen, with the
 * ones longer than maxMs (delay included) outside the exempt elements (her stage, her core and the header avatar, the
 * reveal, the echo of his line); and whether the tab has settled: nothing finite still running, the panel opaque.
 * Self-contained; the look pass calls it right after a switch and again at maxMs. */
function motion({ maxMs, exempt }) {
  const panel = document.querySelector('section.panel:not([hidden])');
  const scope = [document.getElementById('top'), panel].filter(Boolean);
  const free = e => !exempt.some(x => e.closest(x));
  const ms = v =>
    String(v)
      .split(',')
      .map(x => {
        x = x.trim();
        return x.endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000;
      });
  const name = e =>
    (e.id
      ? '#' + e.id
      : e.tagName.toLowerCase() +
        (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '')
    ).slice(0, 60);
  const over = [];
  let declared = 0;
  for (const e of scope.flatMap(s => [s, ...s.querySelectorAll('*')])) {
    if (!free(e)) continue;
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(e, pseudo);
      const td = ms(cs.transitionDuration),
        tl = ms(cs.transitionDelay),
        tp = cs.transitionProperty.split(',').map(x => x.trim());
      td.forEach((d, i) => {
        if (d > 0) {
          declared++;
          const t = d + (tl[i % tl.length] || 0);
          if (t > maxMs) over.push(`${name(e)}${pseudo || ''} transition ${tp[i % tp.length]} ${t} ms`);
        }
      });
      if (cs.animationName && cs.animationName !== 'none') {
        const an = cs.animationName.split(','),
          ad = ms(cs.animationDuration),
          al = ms(cs.animationDelay);
        an.forEach((n, i) => {
          const d = ad[i % ad.length];
          if (d > 0) {
            declared++;
            const t = d + (al[i % al.length] || 0);
            if (t > maxMs) over.push(`${name(e)}${pseudo || ''} animation ${n.trim()} ${t} ms`);
          }
        });
      }
    }
  }
  const running = (document.getAnimations ? document.getAnimations() : [])
    .filter(a => {
      const t = a.effect && a.effect.target;
      return (
        t &&
        panel &&
        panel.contains(t) &&
        free(t) &&
        a.playState === 'running' &&
        a.effect.getComputedTiming().iterations !== Infinity
      );
    })
    .map(a => `${name(a.effect.target)} ${a.animationName || a.transitionProperty || 'animation'}`);
  return {
    tab: ((panel && panel.id) || '').replace(/^p-/, ''),
    over,
    declared,
    running,
    opacity: panel ? parseFloat(getComputedStyle(panel).opacity) : 1,
  };
}

/** D-271 on two motion reads: the one taken at the switch and the one taken maxMs after it. */
function judgeMotion(atSwitch, settled, maxMs = 450) {
  const over = [...new Set([...(atSwitch.over || []), ...(settled.over || [])])];
  // B-225 (D-271): a view switch is a cut: full opacity on the first read after the tap, not only once settled.
  const cut = atSwitch.opacity == null || atSwitch.opacity >= 0.999;
  const ok = !over.length && !settled.running.length && settled.opacity >= 0.999 && cut;
  return {
    tenet: 'D-271',
    ok,
    detail: `${over.length ? 'over ' + maxMs + ' ms: ' + over.slice(0, 6).join('; ') + (over.length > 6 ? ` (+${over.length - 6})` : '') : `nothing over ${maxMs} ms (${atSwitch.declared} declared)`}; at ${maxMs} ms ${settled.running.length ? 'still running: ' + settled.running.slice(0, 4).join(', ') : 'settled'}, opacity ${settled.opacity}${cut ? '' : '; at the tap the view was still fading in (opacity ' + atSwitch.opacity + ')'}`,
  };
}

module.exports = { collect, judge, motion, judgeMotion };
