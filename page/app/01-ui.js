    // ------------------------------------------------------------ Proprietary: DS and dsRoot (D-374, D-386, D-387, D-388)
    // E.V.'s own design system. Each component is one file, page/app/01-ui-NN-<name>.js (NN in B-504's order), holding
    // one hoisted function declaration, ds<Name>(o), and nothing that runs at load: the build joins page/app in name
    // order and 01-ui-NN sorts before this file, so DS is gathered here from the declarations, never assigned from the
    // component files. A component not yet built is undefined in DS, never a crash; until it is, its views keep the kit's
    // helpers (page/app/01-kit.js). Its rules are page/ds/components/NN-<name>.css, in the components layer (D-373).
    // A component is a function from options to one root element (D-374): no state, lifecycle or re-render, and inline
    // styles only as custom properties. Harnesses read its root by data-ui and the record id it shows by data-key
    // (D-387); the view's old class rides along as o.cls for one release.

    /**
     * The root every component makes: tag with class cls plus o.cls, data-ui, data-key from o.key (the record id the
     * item shows: a task, note, spot or card), data-kind, data-size and data-tone from o, and custom properties from
     * o.vars only ({ '--w': '40%' } or { w: '40%' }).
     */
    function dsRoot(tag, ui, o = {}, cls = '') {
      const e = document.createElement(tag);
      const c = [cls, o.cls].filter(Boolean).join(' ');
      if (c) e.className = c;
      e.dataset.ui = ui;
      if (o.key != null) e.dataset.key = String(o.key);
      for (const k of ['kind', 'size', 'tone']) if (o[k] != null && o[k] !== '') e.dataset[k] = String(o[k]);
      for (const [k, v] of Object.entries(o.vars || {}))
        if (v != null) e.style.setProperty(k.startsWith('--') ? k : '--' + k, String(v));
      return e;
    }
    /**
     * B-593: the full text as a tooltip only when it is cut off. dsTip(node, text) keeps the text in data-tip; one
     * delegated pointerover sets title when the node (or a child) overflows and clears it otherwise, so a fully visible
     * label never shows the browser's tooltip. Icon-only buttons name themselves with aria-label, not title.
     */
    function dsTip(node, text) {
      if (!node) return node;
      if (text) node.dataset.tip = String(text);
      else delete node.dataset.tip;
      node.removeAttribute('title');
      if (!dsTip.on && typeof document !== 'undefined') {
        dsTip.on = true;
        const cut = n => n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1; // an inline box never clips
        document.addEventListener(
          'pointerover',
          e => {
            const t = e.target && e.target.closest && e.target.closest('[data-tip]');
            if (!t) return;
            const kids = [...t.querySelectorAll('*')];
            const over = cut(t) || kids.some(cut);
            if (over) t.title = t.dataset.tip;
            else t.removeAttribute('title');
          },
          true
        );
      }
      return node;
    }
    // The 16 components (B-504), each its hoisted declaration once its lane has built it: C1 (B-507) 01 to 09, C2
    // (B-508) 10 to 16.
    const DS = Object.freeze({
      button: typeof dsButton === 'function' ? dsButton : undefined,
      badge: typeof dsBadge === 'function' ? dsBadge : undefined,
      kind: typeof dsKind === 'function' ? dsKind : () => '', // B-540
      chip: typeof dsChip === 'function' ? dsChip : undefined,
      segmented: typeof dsSegmented === 'function' ? dsSegmented : undefined,
      group: typeof dsGroup === 'function' ? dsGroup : undefined,
      tip: dsTip,
      line: typeof dsLine === 'function' ? dsLine : undefined,
      fold: typeof dsFold === 'function' ? dsFold : undefined,
      grow: typeof dsGrow === 'function' ? dsGrow : (n, o, d) => (d ? d() : o || !n || (n.hidden = true)), // B-576
      foldFlip: typeof dsFoldFlip === 'function' ? dsFoldFlip : (k, o, f) => f(),
      foldTag: typeof foldTag === 'function' ? foldTag : (k, ...n) => n.flat().filter(Boolean),
      card: typeof dsCard === 'function' ? dsCard : undefined,
      notice: typeof dsNotice === 'function' ? dsNotice : undefined,
      toast: typeof dsToast === 'function' ? dsToast : undefined,
      sheet: typeof dsSheet === 'function' ? dsSheet : undefined,
      popover: typeof dsPopover === 'function' ? dsPopover : undefined,
      field: typeof dsField === 'function' ? dsField : undefined,
      choice: typeof dsChoice === 'function' ? dsChoice : undefined,
      meter: typeof dsMeter === 'function' ? dsMeter : undefined,
      presence: typeof dsPresence === 'function' ? dsPresence : undefined,
      message: typeof dsMessage === 'function' ? dsMessage : undefined,
    });
