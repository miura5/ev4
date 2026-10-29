    // ---- Proprietary 11 Popover (B-508; D-374, D-375): a small menu or panel anchored to the control that opens it,
    // on the native popover attribute (auto): the top layer, Esc and a tap outside close it, and focus goes back to its
    // button, all by the browser. Its button is its invoker (popoverTargetElement), so the browser also says whether it
    // is open. It opens under the button, its right edge on the button's when the screen has no room, and above it when
    // there is no room below. Items are a menu (arrow keys move between them); body is any panel. Today's look: the New
    // menu and Notes' menus; an item is DS.button. inline: true draws it in the flow, not as a popover (a preview).
    //   const p = DS.popover({ anchor: button, label: 'Kind', items: [{ label: 'Note', icon, on: true, onPick }] });
    //   document.body.append(p);                  // or { anchor, label, body: node } for a panel
    function dsPopover(o = {}) {
      const r = dsRoot('div', 'popover', o, 'popover');
      if (!o.inline) r.popover = 'auto';
      if (o.label) r.setAttribute('aria-label', o.label);
      if (o.items) {
        r.setAttribute('role', 'menu');
        for (const it of o.items) {
          const b = DS.button({ cls: 'btn popover-i', icon: it.icon, key: it.key, disabled: it.disabled });
          b.setAttribute('role', it.on == null ? 'menuitem' : 'menuitemradio');
          if (it.on != null) b.setAttribute('aria-checked', String(!!it.on));
          b.append(el('span', null, it.label)); // its words in a span, so they sit at the start
          b.addEventListener('click', () => {
            if (!o.inline) r.hidePopover();
            if (it.onPick) it.onPick(it);
          });
          r.append(b);
        }
        r.addEventListener('keydown', e => {
          const all = [...r.querySelectorAll('.popover-i:not(:disabled)')];
          const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
          if (!d || !all.length) return;
          e.preventDefault();
          all[(all.indexOf(document.activeElement) + d + all.length) % all.length].focus();
        });
      } else {
        r.setAttribute('role', 'dialog');
        r.append(...[].concat(o.body || []));
      }
      const a = o.anchor;
      if (!a || o.inline) return r;
      a.popoverTargetElement = r;
      a.setAttribute('aria-haspopup', o.items ? 'menu' : 'dialog');
      // placed under its button before it shows, then moved in when it would leave the screen
      const place = (x, y) => {
        r.style.setProperty('--pop-x', Math.round(x) + 'px');
        r.style.setProperty('--pop-y', Math.round(y) + 'px');
      };
      r.addEventListener('beforetoggle', e => {
        if (e.newState !== 'open') return;
        const b = a.getBoundingClientRect();
        place(b.left, b.bottom + 6);
      });
      r.addEventListener('toggle', e => {
        if (e.newState !== 'open') return;
        const b = a.getBoundingClientRect(),
          w = r.offsetWidth,
          h = r.offsetHeight;
        const up = b.bottom + 6 + h > innerHeight - 8 && b.top - 6 - h > 8;
        place(b.left + w > innerWidth - 8 ? Math.max(8, b.right - w) : b.left, up ? b.top - 6 - h : b.bottom + 6);
        const first = r.querySelector('.popover-i:not(:disabled),button,input,select,textarea');
        if (first) first.focus();
      });
      return r;
    }
