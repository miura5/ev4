    // ---- Proprietary 09 Toast: function dsToast(o), declarations only (D-388); lane C1 (B-507)
    /**
     * Toast (B-504 #9): a short message after you do something, then gone. Options: text, action ({ label, onClick }:
     * Undo), ms (how long it shows: 2.6 s, 6 s with an action, 0 to stay), root (the element to show it in: the shell's
     * #toast, which the kit's toast() passes; a new one when none), cls. It shows at once, inside the safe area above the
     * tab bar, says itself to the screen reader (role status) and hides itself after ms. Today's class (toast) is its
     * class, so it looks as toast() did (D-376). The hide timer rides on the element, so a newer message restarts it.
     */
    function dsToast(o = {}) {
      let x = o.root;
      if (x) {
        x.dataset.ui = 'toast';
        if (o.cls) x.className = dsClasses('toast', o.cls);
      } else x = dsRoot('div', 'toast', Object.assign({}, o, { cls: dsClasses('toast', o.cls) }));
      x.setAttribute('role', 'status');
      x.textContent = o.text == null ? '' : String(o.text);
      if (o.action) {
        const a = DS.button({ label: o.action.label || 'Undo', kind: 'ghost', size: 'sm', cls: 'toast-act' });
        a.addEventListener('click', e => {
          x.hidden = true;
          if (o.action.onClick) o.action.onClick(e);
        });
        x.append(' ', a);
      }
      x.hidden = false;
      x.dataset.at = String(Date.now());
      clearTimeout(x.dsHide);
      const ms = o.ms != null ? o.ms : o.action ? 6000 : 2600;
      if (ms) x.dsHide = setTimeout(() => (x.hidden = true), ms);
      return x;
    }
