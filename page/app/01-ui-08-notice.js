    // ---- Proprietary 08 Notice: function dsNotice(o), declarations only (D-388); lane C1 (B-507)
    /**
     * Notice (B-504 #8, was Empty): the one calm line a list shows when it is empty, busy or failed. Options: line (its
     * words), kind (empty when none; info; working, with expected: how long it should take, and a quiet progress; failed,
     * in plain words, with one Try again when onRetry is given), action (an element, for empty and info), tag (li inside
     * a list, as the kit's empty() made it), cls, key. Working and failed are a status the screen reader says. An empty
     * notice is today's p.empty, so it looks as empty() did (D-376).
     */
    function dsNotice(o = {}) {
      const kind = o.kind && o.kind !== 'empty' ? o.kind : undefined;
      const n = dsRoot(o.tag || 'div', 'notice', Object.assign({}, o, { kind }));
      if (kind === 'working' || kind === 'failed') n.setAttribute('role', 'status');
      const p = el('p', kind ? 'notice-line' : 'empty', o.line || '');
      n.append(p);
      if (kind === 'working') {
        if (o.expected) p.append(el('span', 'notice-when', ' · ' + o.expected));
        const bar = el('span', 'notice-bar');
        bar.setAttribute('aria-hidden', 'true');
        n.append(bar);
      }
      const act =
        kind === 'failed' && o.onRetry ? DS.button({ label: 'Try again', size: 'sm', onClick: o.onRetry }) : o.action;
      if (act) n.append(act);
      return n;
    }
