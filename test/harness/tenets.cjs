// The UI tenets' checks the look pass runs (B-115). B-357 (D-327): the old look checks (one primary, cards with
// controls, five-row lists, three chips, no close buttons, no empty cards) are retired with the old UI tenets; the demo
// is the UI. What stays is D-271's motion check: motion runs in the page and judgeMotion
// holds two reads to it, so a test can plant a read without a browser.

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

module.exports = { motion, judgeMotion };
