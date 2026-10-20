// The UI tenets' checks (B-115; D-146 to D-151, "E.V. UI tenets and catch-up"). collect runs in the page and returns a
// plain snapshot of the view on screen; judge holds the snapshot to each tenet, so a test can plant a snapshot without a
// browser. The look pass runs both on every view at 390, 735 and 1280 (spec.ui.tenets.widths) and prints each check;
// only the tabs in spec.ui.tenets.on fail the pass, the rest report until their catch-up task turns them on.

/** In the page: the view on screen, as data. Self-contained (it is serialized into the page). */
function collect() {
  const H = innerHeight;
  const vis = e => { if (!e || e.closest('[hidden]')) return false; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05 && r.width > 1 && r.height > 1; };
  const first = e => e.getBoundingClientRect().top < H;
  const panel = document.querySelector('section.panel:not([hidden])');
  const scope = [document.getElementById('top'), panel].filter(Boolean);
  const all = sel => scope.flatMap(s => [...s.querySelectorAll(sel)]).filter(vis);
  const own = e => [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  const CONTROLS = 'button,input,select,textarea,a[href],[role=button],summary,label';
  const cards = [...(panel ? panel.querySelectorAll('.card') : [])].filter(vis).map(c => {
    const words = [...c.querySelectorAll('*')].filter(e => vis(e) && own(e) && !e.closest('h2,h3,.card-head,.empty'));
    return { id: c.id || '', cls: c.className, text: c.textContent.trim().replace(/\s+/g, ' ').slice(0, 80), controls: [...c.querySelectorAll(CONTROLS)].filter(vis).length, emptyOnly: !!c.querySelector('.empty') && vis(c.querySelector('.empty')) && !words.length };
  });
  const primaries = all('button.primary:not([type=submit])').filter(first).map(b => b.textContent.trim() || b.getAttribute('aria-label') || '');
  // A lead is a block of large text (a revealed line's words are spans inside one block).
  const block = e => { let b = e; while (b.parentElement && /^inline/.test(getComputedStyle(b).display)) b = b.parentElement; return b; };
  const leads = [...new Set(all('*').filter(e => first(e) && own(e) && parseFloat(getComputedStyle(e).fontSize) >= 20 && !e.closest('.ptitle,h1,#top')).map(block))].map(b => b.textContent.trim().slice(0, 40));
  const lists = [...(panel ? panel.querySelectorAll('ul,ol') : [])].filter(vis).map(l => ({ id: l.id || l.className, rows: [...l.children].filter(vis).length }));
  const rows = [...(panel ? panel.querySelectorAll('li.row, li.brief-item') : [])].filter(vis).map(r => ({ text: r.textContent.trim().slice(0, 40), h: Math.round(r.getBoundingClientRect().height) }));
  const coralRgb = /rgba?\((240, 138, 120|244, 167, 151)(, (1|0\.[3-9]\d*))?\)/;
  const coralAll = all('*').filter(e => { const s = getComputedStyle(e); return coralRgb.test(s.color) && own(e) || coralRgb.test(s.backgroundColor); });
  const coral = coralAll.filter(e => !coralAll.some(o => o !== e && o.contains(e))).map(e => (own(e) || e.className).slice(0, 30));
  const chips = all('.chip, .qchip').filter(first).map(c => c.textContent.trim().slice(0, 30));
  const fonts = all('*').filter(e => own(e)).map(e => getComputedStyle(e)).filter(s => /mono/i.test(s.fontFamily) || (s.textTransform === 'uppercase' && parseFloat(s.letterSpacing) > 0.5)).length;
  const hero = document.getElementById('hero');
  return { tab: (panel && panel.id || '').replace(/^p-/, ''), width: innerWidth, step: hero && hero.dataset.step, cards, primaries, leads, lists, rows, coral, urgent: document.querySelectorAll('li.brief-item[data-level="urgent"]').length, chips, monoOrSpacedCaps: fonts, qchipsShown: vis(document.getElementById('qchips')) };
}

/** Each tenet's check on a snapshot: [{tenet, ok, detail}]. exceptions: {D-147: [card ids or classes], ...}. */
function judge(s, exceptions = {}) {
  const excused = (t, c) => (exceptions[t] || []).some(x => x === c.id || String(c.cls).split(/\s+/).includes(x));
  const r = (tenet, ok, detail) => ({ tenet, ok: !!ok, detail });
  const infoOnly = s.cards.filter(c => !c.controls && !c.emptyOnly && !excused('D-147', c));
  const emptyCards = s.cards.filter(c => c.emptyOnly && !excused('D-151', c));
  const open = s.lists.filter(l => l.rows > 5), tall = s.rows.filter(x => x.h > 44);
  return [
    r('D-146', s.primaries.length <= 1 && s.leads.length <= 1, `primary buttons in the first screen: ${s.primaries.length} (${s.primaries.join(', ')}); lead elements: ${s.leads.length} (${s.leads.join(' | ')})`),
    r('D-147', !infoOnly.length, infoOnly.length ? `cards with no control: ${infoOnly.map(c => c.id || c.text).join(' | ')}` : 'every card holds a control'),
    r('D-148', !open.length && !tall.length, `${open.length ? 'lists open with more than 5 rows: ' + open.map(l => `${l.id} (${l.rows})`).join(', ') + '; ' : ''}${tall.length ? `rows over 44 px: ${tall.length} (${tall.slice(0, 3).map(x => x.h).join(', ')} px)` : 'every row one line'}`),
    // Coral never outnumbers what is urgent; the E.V. tab, which carries the briefing, also shows it when there is any.
    r('D-149', s.coral.length <= s.urgent && (s.tab !== 'ev' || !s.urgent || s.coral.length >= 1), `coral elements: ${s.coral.length} (${s.coral.join(', ')}); urgent in the record: ${s.urgent}`),
    r('D-150', !s.monoOrSpacedCaps && s.chips.length <= 3, `chips in the first screen: ${s.chips.length}; monospace or spaced capitals: ${s.monoOrSpacedCaps}`),
    r('D-151', !emptyCards.length && !(s.step === 'conversation' && s.qchipsShown), `${emptyCards.length ? 'cards holding only an empty-state line: ' + emptyCards.map(c => c.id || c.text).join(' | ') : 'no empty-state card'}${s.step === 'conversation' ? `; chips ${s.qchipsShown ? 'shown' : 'hidden'} in a conversation` : ''}`),
  ];
}

module.exports = { collect, judge };
