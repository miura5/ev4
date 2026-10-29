    // ---- Proprietary 06 Fold: function dsFold(o), declarations only (D-388); lane C1 (B-507)
    /**
     * Fold (B-504 #6): a heading that opens to show more beneath it. Options: head (its words), body (an element or a
     * list of them), open, onToggle(open, event), cls (a view's old class for the root), key. The head is today's
     * fold-line (› closed, ⌄ open) and says its state by aria-expanded; the body opens beneath it in 0.28 s and closes
     * in 0.16 s (D-271), so what is above it never moves, and a closed body is inert: out of the tab order and the
     * screen reader's tree. A tap flips it in the same frame (D-208) before onToggle runs.
     */
    function dsFold(o = {}) {
      const f = dsRoot('div', 'fold', o);
      const h = el('button', 'fold-line', o.head || '');
      h.type = 'button';
      const body = el('div', 'fold-body');
      const inner = el('div', 'fold-in');
      const kids = o.body == null ? [] : Array.isArray(o.body) ? o.body : [o.body];
      inner.append(...kids.filter(Boolean));
      body.append(inner);
      body.id = 'fold-' + Math.random().toString(36).slice(2, 9);
      h.setAttribute('aria-controls', body.id);
      const set = on => {
        h.setAttribute('aria-expanded', String(on));
        body.inert = !on;
      };
      set(!!o.open);
      h.addEventListener('click', e => {
        const on = h.getAttribute('aria-expanded') !== 'true';
        set(on);
        if (o.onToggle) o.onToggle(on, e);
      });
      f.append(h, body);
      return f;
    }
