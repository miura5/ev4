    // ---- Proprietary 01 Button: function dsButton(o), declarations only (D-388); lane C1 (B-507)
    // Two helpers every component uses live here, in the first file: dsClasses (the root's class list) and dsTone (a
    // coded tone's class). Both are hoisted declarations, as the components are.

    /**
     * A root's class list: its own class first, then the caller's (o.cls: a view's old class riding along, D-387), then
     * its modifiers, each once and in that order, so a class string a view made before keeps its words and their order.
     */
    function dsClasses(...parts) {
      const out = [];
      for (const p of parts) for (const c of String(p || '').split(/\s+/)) if (c && !out.includes(c)) out.push(c);
      return out.join(' ');
    }
    /** The coded class for a tone (D-269): Proprietary's names (ok, warn, bad, info, violet), the colours, or the kit's
     *  old ones (plum); quiet is the grey tone; '' when none. */
    function dsTone(t) {
      const X = { ok: 'green', warn: 'yellow', bad: 'red', info: 'blue', violet: 'violet', plum: 'violet' };
      const c = X[t] || t;
      return ['green', 'yellow', 'red', 'blue', 'violet', 'quiet'].includes(c) ? 'x-' + c : '';
    }
    /** True when a class string holds the word c. */
    function dsHas(cls, c) {
      return (' ' + String(cls || '') + ' ').includes(' ' + c + ' ');
    }

    /**
     * Button (B-504 #1): what you tap to do one thing. Options: label, icon (an svg element before the label), iconOnly
     * (the icon alone, named by label), kind (primary, neutral, ghost or tint; neutral when none), tone (a tint's
     * coded colour), size ('sm'), count (a number after the label), pressed (a toggle's aria-pressed), disabled, busy
     * (aria-busy: a spinner over the label, which keeps the width), type (button), onClick, cls, key. Today's classes
     * (btn and its kind, B-303) are its classes, so it looks exactly as btn() did (D-376); a class string that already
     * names btn is kept as given, which is how the kit's btn() delegates.
     */
    function dsButton(o = {}) {
      const given = String(o.cls || '');
      const old = dsHas(given, 'btn');
      const kinds = ['primary', 'neutral', 'ghost', 'tint'];
      const kind = o.kind || kinds.find(k => dsHas(given, k)) || (old ? undefined : 'neutral');
      const size = o.size || (dsHas(given, 'sm') ? 'sm' : undefined);
      const tone = o.tone || (kind === 'tint' ? (given.match(/(?:^|\s)x-(\w+)/) || [])[1] : undefined);
      const only = !!(o.icon && o.iconOnly);
      const cls = old
        ? dsClasses(
            'btn',
            given,
            o.kind,
            size === 'sm' && 'sm',
            only && 'icon',
            o.tone && kind === 'tint' && dsTone(tone)
          )
        : dsClasses('btn', given, kind, size === 'sm' && 'sm', only && 'icon', kind === 'tint' && dsTone(tone));
      const b = dsRoot('button', 'button', Object.assign({}, o, { kind, size, tone, cls }));
      b.type = o.type || 'button';
      if (o.icon) b.append(o.icon);
      if (o.label != null && o.label !== '' && !only) {
        if (o.busy) b.append(el('span', 'ds-label', String(o.label)));
        else b.append(document.createTextNode(String(o.label)));
      }
      if (only && o.label) b.setAttribute('aria-label', String(o.label));
      if (o.ariaLabel) b.setAttribute('aria-label', o.ariaLabel);
      if (o.count != null) b.append(el('span', 'n', String(o.count)));
      if (o.pressed != null) b.setAttribute('aria-pressed', String(!!o.pressed));
      if (o.disabled) b.disabled = true;
      if (o.busy) b.setAttribute('aria-busy', 'true');
      if (o.onClick) b.addEventListener('click', o.onClick);
      return b;
    }
