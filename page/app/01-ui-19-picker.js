    // ---- Proprietary 19 Picker (B-596): a chip showing the current value that opens a DS.popover with a search line
    // and rows built on Line, each with a kind dot (from DS.kind, B-594) or an icon, a check on the current value and
    // its number. Keys: type to search, arrows move, Enter picks, 1 to 9 pick a row while the search is empty, Esc closes.
    //   DS.picker({ label: 'Kind', value: 'learn', options: [{ value: 'learn', label: 'Learn', kind: 'learn' }], onPick })
    // An option's kind (or its label) names its dot; icon (an svg) replaces the dot. inline draws it open in the flow.
    function dsPicker(o = {}) {
      const opts = o.options || [];
      const cur = () => opts.find(p => p.value === o.value);
      const dot = p =>
        p.icon || el('i', 'pk-dot' + (DS.kind(p.kind || p.label) ? ' k-' + DS.kind(p.kind || p.label) : ''));
      const chip = DS.chip({ kind: 'action', cls: 'pk-chip', disabled: o.disabled, key: o.key });
      const paint = () => {
        const c = cur();
        chip.replaceChildren(
          ...(c ? [dot(c), el('span', null, c.label)] : [el('span', 'pk-ph', o.placeholder || o.label)])
        );
        chip.setAttribute('aria-label', (o.label || '') + ': ' + (c ? c.label : 'none'));
      };
      const q = el('input', 'pk-q');
      q.type = 'text';
      q.placeholder = o.search || 'Search ' + String(o.label || '').toLowerCase() + '…';
      q.setAttribute('aria-label', q.placeholder);
      const list = el('div', 'pk-list');
      list.setAttribute('role', 'listbox');
      let shown = [],
        at = 0;
      const pick = p => {
        o.value = p.value;
        paint();
        if (pop.hidePopover && pop.matches(':popover-open')) (pop.hidePopover(), chip.focus());
        if (o.onPick) o.onPick(p);
      };
      const draw = () => {
        const t = q.value.trim().toLowerCase();
        shown = opts.filter(p => !t || p.label.toLowerCase().includes(t));
        at = Math.min(at, Math.max(0, shown.length - 1));
        list.replaceChildren(
          ...shown.map((p, i) => {
            const r = DS.line({ title: p.label, cls: 'pk-row', key: p.value });
            r.setAttribute('role', 'option');
            r.setAttribute('aria-selected', String(p.value === o.value));
            if (i === at) r.dataset.active = '';
            r.prepend(dot(p));
            r.append(el('span', 'pk-n', i < 9 ? String(i + 1) : ''));
            r.addEventListener('click', () => pick(p));
            return r;
          }),
          ...(shown.length ? [] : [el('p', 'pk-none', 'No match')])
        );
      };
      q.addEventListener('input', () => ((at = 0), draw()));
      const pop = DS.popover({
        anchor: o.inline ? null : chip,
        inline: o.inline,
        label: o.label,
        cls: 'pk-pop',
        body: [q, list],
      });
      pop.addEventListener('keydown', e => {
        const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
        if (d && shown.length) ((at = (at + d + shown.length) % shown.length), draw(), e.preventDefault());
        else if (e.key === 'Enter' && shown[at]) (pick(shown[at]), e.preventDefault());
        else if (e.key === 'Enter' && o.free) {
          // B-596: a value typed in the search line (a task's own minutes), when the picker takes one; such a picker's digits
          // type into the search line instead of picking a row
          const p = o.free(q.value.trim());
          if (p) (opts.some(x => x.value === p.value) || opts.push(p), pick(p));
          e.preventDefault();
        } else if (/^[1-9]$/.test(e.key) && !q.value && !o.free && shown[e.key - 1])
          (pick(shown[e.key - 1]), e.preventDefault());
      });
      pop.addEventListener('toggle', e => e.newState === 'open' && ((q.value = ''), (at = 0), draw(), q.focus()));
      if (o.inline && o.query) q.value = o.query;
      paint();
      draw();
      const r = dsRoot('span', 'picker', { ...o, cls: dsClasses('picker', o.cls) });
      r.append(chip, pop);
      return r;
    }
