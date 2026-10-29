    // ---- Proprietary 07 Card: function dsCard(o), declarations only (D-388); lane C1 (B-507)
    /**
     * Card (B-504 #7): a box that holds one thing on a screen, one level deep (cards never nest). Options: title, aside
     * (a short line beside it), actions (elements at the head's end), body (an element or a list), foot (likewise), kind
     * (plain when none; quiet: no lift, on the sunken ground; fold: the head is a Fold that opens the body, with open
     * and onToggle), cls, key. A title alone is today's .ui-card > h3, so a plain card looks as it did (D-376).
     */
    function dsCard(o = {}) {
      const kind = o.kind && o.kind !== 'plain' ? o.kind : undefined;
      const c = dsRoot('section', 'card', Object.assign({}, o, { kind, cls: dsClasses('ui-card', o.cls) }));
      const list = x => (x == null ? [] : Array.isArray(x) ? x.filter(Boolean) : [x]);
      if (kind === 'fold') {
        c.append(
          dsFold({ head: o.title, body: list(o.body).concat(list(o.foot)), open: o.open, onToggle: o.onToggle })
        );
        return c;
      }
      const acts = list(o.actions);
      if (o.title != null && !o.aside && !acts.length) c.append(el('h3', null, o.title));
      else if (o.title != null || o.aside || acts.length) {
        const h = el('div', 'ui-card-h');
        if (o.title != null) h.append(el('h3', null, o.title));
        if (o.aside) h.append(el('span', 'meta', o.aside));
        if (acts.length) {
          const a = el('div', 'ui-card-acts');
          a.append(...acts);
          h.append(a);
        }
        c.append(h);
      }
      c.append(...list(o.body));
      if (o.foot != null) {
        const f = el('div', 'ui-card-f');
        f.append(...list(o.foot));
        c.append(f);
      }
      return c;
    }
