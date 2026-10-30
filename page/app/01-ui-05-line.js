    // ---- Proprietary 05 Line: function dsLine(o), declarations only (D-388); lane C1 (B-507)
    /**
     * Line (B-504 #5): one row in a list: a task, a note, a weak spot. Two shapes of today's, both kept exactly (D-376):
     * the set's one-line row (none: .li, B-285: the tick, the name, its one badge, the time at the end, an action that
     * shows on hover or focus; 32 px from 600 px, 44 px on the phone, C-1) and the stacked row (kind 'stack': the kit's
     * row(), the title over its meta, the lead time before them). Options: lead (the time), check ({ checked, label,
     * onChange(on, input), disabled }: one tick shape, a 44 px tap on the phone), title, badge ([text, tone], { text,
     * tone } or an element; one per row, D-276), meta, action (an element), key (the record id it shows, data-key, D-387),
     * onOpen (the title becomes the button that opens it), open (that button's aria-expanded), done (struck), urgent
     * (the bad tone's edge), disabled (aria-disabled, with reason as its meta), tag (li for a list's row), cls.
     */
    function dsLine(o = {}) {
      const stack = o.kind === 'stack';
      const mods = [o.done && 'done'];
      const li = dsRoot(
        o.tag || (stack ? 'li' : 'div'),
        'line',
        Object.assign({}, o, { tone: o.urgent ? 'bad' : o.tone, cls: dsClasses(stack ? 'row' : 'li', o.cls, ...mods) })
      );
      if (o.disabled) li.setAttribute('aria-disabled', 'true');
      if (o.check) {
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.className = 'tick';
        c.checked = c.defaultChecked = !!o.check.checked;
        c.setAttribute('aria-label', o.check.label || o.title);
        if (o.check.disabled || o.disabled) c.disabled = true;
        c.addEventListener('change', () => o.check.onChange && o.check.onChange(c.checked, c));
        li.append(c);
      }
      const b = o.badge;
      const badge =
        b == null || b === false
          ? null
          : b instanceof Element
            ? b
            : Array.isArray(b)
              ? DS.badge({ text: b[0], tone: b[1], cls: stack ? 'row-badge' : '' })
              : DS.badge(Object.assign({ cls: stack ? 'row-badge' : '' }, b));
      const meta = o.disabled && o.reason ? o.reason : o.meta;
      let name;
      if (o.onOpen) {
        name = el('button', stack ? 'title' : 'nm');
        name.type = 'button';
        name.addEventListener('click', o.onOpen);
        if (o.open != null) name.setAttribute('aria-expanded', String(!!o.open));
        if (o.disabled) name.disabled = true;
      } else name = el(stack ? 'div' : 'span', stack ? 'title' : 'nm');
      name.append(document.createTextNode(o.title || ''));
      // B-544: one line with an ellipsis; the full text on a long press (data-full until the next) and, B-593, on hover
      // only when it is cut off (dsTip)
      if (o.title) dsTip(name, o.title);
      let press = 0;
      li.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse') return;
        clearTimeout(press);
        press = setTimeout(() => li.toggleAttribute('data-full'), 500);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
        li.addEventListener(ev, () => clearTimeout(press));
      if (stack) {
        if (o.lead) li.append(el('span', 'when', o.lead));
        const g = el('div', 'grow');
        if (badge) name.append(badge);
        g.append(name);
        if (meta) g.append(el('div', 'meta', meta));
        li.append(g);
      } else {
        li.append(name);
        if (badge) li.append(badge);
        if (o.lead || meta) li.append(el('span', 't', o.lead || meta));
      }
      if (o.action) {
        if (!stack && o.action.classList) o.action.classList.add('hov');
        li.append(o.action);
      }
      return li;
    }
