    // ---- Proprietary 03 Chip: function dsChip(o), declarations only (D-388); lane C1 (B-507)
    /**
     * Chip (B-504 #3): a small word, like a filter, a quick ask or a state. Options: label, icon (an svg element before
     * it), tone (accent, ok, warn, bad, info, plum: today's chip colours), kind ('toggle': a filter that shows it is on
     * by aria-pressed; 'action': a quick ask; none: a static label, as today's chip() made), on (a toggle that is on),
     * disabled, onClick, cls, key. A toggle or an action is a button; the static one is a span. Today's classes (chip
     * and its colour) are its classes, so it looks as chip() did (D-376); an on toggle also takes the accent colour,
     * which is how a filter says it is on today.
     */
    function dsChip(o = {}) {
      const kind = o.kind || (o.onClick ? 'action' : undefined);
      const on = kind === 'toggle' && !!o.on;
      const tone = o.tone || undefined;
      const tag = kind ? 'button' : 'span';
      const c = dsRoot(
        tag,
        'chip',
        Object.assign({}, o, { kind, tone, cls: dsClasses('chip', o.cls, tone, on && 'accent') })
      );
      if (o.icon) c.append(o.icon);
      if (o.label != null && o.label !== '') c.append(document.createTextNode(String(o.label)));
      if (kind) {
        c.type = 'button';
        if (kind === 'toggle') c.setAttribute('aria-pressed', String(on));
        if (o.disabled) c.disabled = true;
        if (o.onClick) c.addEventListener('click', o.onClick);
      }
      return c;
    }
