    // ---- Proprietary 14 Meter (B-508; D-374, D-376): how far along, as a bar, a segmented bar, a stat (a number over
    // its label) or a legend (the key to a bar's colours, F-54). Today's look: the bar is .pbar's, the stat .stat's,
    // with one change: the stat's label reads --quiet, not --faint, so it holds 4.5:1 in dark (B-508's Gallery note).
    // Its class is gauge, because legacy's .meter is the readiness card's own. A bar's value is a percent; a stat's is
    // its text.
    //   DS.meter({ value: 60, label: 'Done', tone: 'warn' })
    //   DS.meter({ kind: 'segments', parts: [{ value: 40, tone: 'ok' }, { value: 20, tone: 'warn' }], label: '...' })
    //   DS.meter({ kind: 'stat', value: '12', label: 'cards due', onOpen })
    //   DS.meter({ kind: 'legend', parts: [{ label: 'Solid', tone: 'ok' }, { label: 'Almost', tone: 'warn' }] })
    // Tones: ok, warn, bad, info, violet (green by default). onOpen makes a stat tappable: it opens the list behind the
    // number (F-54). data-state says empty, partial or complete.
    function dsMeter(o = {}) {
      const kind = o.kind || 'bar';
      const r = dsRoot('div', 'meter', { ...o, kind, tone: null }, 'gauge');
      const pc = v => Math.max(0, Math.min(100, Number(v) || 0));
      const part = (tag, p, text) => {
        const i = el(tag, null, text);
        if (p.tone) i.dataset.tone = p.tone;
        if (p.value != null) i.style.setProperty('--v', pc(p.value) + '%');
        return i;
      };
      if (kind === 'stat') {
        r.append(el('b', null, String(o.value ?? '')), el('span', null, o.label || ''));
        if (typeof o.onOpen === 'function') {
          // a div with the button role: legacy's bare button rules would draw a pill around a stat (D-373)
          r.setAttribute('role', 'button');
          r.tabIndex = 0;
          r.addEventListener('click', o.onOpen);
          r.addEventListener('keydown', e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), o.onOpen(e)));
        }
        return r;
      }
      if (kind === 'legend') {
        r.setAttribute('role', 'list');
        for (const p of o.parts || []) {
          const k = part('span', { tone: p.tone }, p.label);
          k.setAttribute('role', 'listitem');
          r.append(k);
        }
        return r;
      }
      const parts = kind === 'bar' ? [{ value: o.value, tone: o.tone }] : o.parts || [];
      const sum = parts.reduce((n, p) => n + pc(p.value), 0);
      r.dataset.state = sum <= 0 ? 'empty' : sum >= 100 ? 'complete' : 'partial';
      r.setAttribute('role', kind === 'bar' ? 'progressbar' : 'img');
      if (o.label) r.setAttribute('aria-label', o.label);
      if (kind === 'bar') {
        r.setAttribute('aria-valuemin', '0');
        r.setAttribute('aria-valuemax', '100');
        r.setAttribute('aria-valuenow', String(pc(o.value)));
      }
      for (const p of parts) r.append(part('i', p));
      return r;
    }
