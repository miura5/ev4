    // ---- Proprietary 04 Segmented: function dsSegmented(o), declarations only (D-388); lane C1 (B-507)
    /**
     * Segmented (B-504 #4): a row of two to five choices where exactly one is picked. Options: label (the group's name
     * for a screen reader), options (strings, or { value, label, count, icon }), value (the picked one), onPick(value,
     * event), cls, key. The picked option says so by aria-pressed (C-15); one roving tab stop, the arrow keys, Home and
     * End move between options, and a tap paints its pick in the same frame (D-208) before onPick runs. It scrolls
     * inside itself when the options overflow. Today's class (seg, B-285) is its class, so it looks as before (D-376).
     */
    function dsSegmented(o = {}) {
      const g = dsRoot('div', 'segmented', Object.assign({}, o, { cls: dsClasses('seg', o.cls) }));
      g.setAttribute('role', 'group');
      if (o.label) g.setAttribute('aria-label', String(o.label));
      const opts = (o.options || []).map(x => (x && typeof x === 'object' ? x : { value: x, label: String(x) }));
      const pick = (b, x, e) => {
        for (const y of g.children) {
          y.setAttribute('aria-pressed', String(y === b));
          y.tabIndex = y === b ? 0 : -1;
        }
        if (o.onPick) o.onPick(x.value, e);
      };
      for (const x of opts) {
        const b = el('button');
        b.type = 'button';
        if (x.icon) b.append(x.icon);
        b.append(document.createTextNode(String(x.label != null ? x.label : x.value)));
        if (x.count != null) b.append(' ', el('span', 'n', String(x.count)));
        const on = x.value === o.value;
        b.setAttribute('aria-pressed', String(on));
        b.tabIndex = on ? 0 : -1;
        b.addEventListener('click', e => pick(b, x, e));
        g.append(b);
      }
      if (!opts.some(x => x.value === o.value) && g.firstChild) g.firstChild.tabIndex = 0;
      g.addEventListener('keydown', e => {
        const all = [...g.children];
        const i = all.indexOf(document.activeElement);
        if (i < 0) return;
        const to = {
          ArrowRight: i + 1,
          ArrowDown: i + 1,
          ArrowLeft: i - 1,
          ArrowUp: i - 1,
          Home: 0,
          End: all.length - 1,
        }[e.key];
        if (to == null) return;
        e.preventDefault();
        const n = all[(to + all.length) % all.length];
        for (const y of all) y.tabIndex = y === n ? 0 : -1;
        n.focus();
      });
      return g;
    }
