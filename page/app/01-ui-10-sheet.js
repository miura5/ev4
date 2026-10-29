    // ---- Proprietary 10 Sheet (B-508; D-374, D-375): a native dialog, opened with showModal(): the top layer, the
    // page inert, Esc and focus kept inside by the browser, no focus trap of ours. A tap on the plain backdrop closes
    // it (iOS has no closedby yet), and so does a swipe down on its head on the phone. Focus returns to whatever opened
    // it. From 600 px it centres 110 px from the top, 560 px wide (today's New dialog); under 600 px it is a bottom
    // sheet whose foot clears the home bar (env(safe-area-inset-bottom)) and whose height follows the keyboard (--vvh).
    // Kinds: sheet, and confirm (narrower, its foot the decision). A sheet opened with show() instead sits in the flow
    // (a preview).
    //   const s = DS.sheet({ title: 'Study plan instructions', icon, aside, body: [nodes], foot: [buttons],
    //     kind: 'sheet' | 'confirm', label, onClose: () => {} });
    //   document.body.append(s); s.showModal();     // s.close() or Esc, the backdrop or a swipe closes it
    let dsSheetN = 0;
    function dsSheet(o = {}) {
      const kind = o.kind === 'confirm' ? 'confirm' : 'sheet';
      const r = dsRoot('dialog', 'sheet', { ...o, kind }, 'sheet');
      const head = el('div', 'sheet-h');
      if (o.icon) head.append(o.icon);
      const h = el('h2', null, o.title || '');
      h.id = 'ds-sheet-' + ++dsSheetN;
      head.append(h, ...[].concat(o.aside || []));
      if (o.title) r.setAttribute('aria-labelledby', h.id);
      else if (o.label) r.setAttribute('aria-label', o.label);
      const body = el('div', 'sheet-b');
      body.append(...[].concat(o.body || []));
      const foot = el('div', 'sheet-f');
      foot.append(...[].concat(o.foot || []));
      r.append(head, body);
      if (foot.childNodes.length) r.append(foot);
      // focus returns to the opener: the browser does it where it can; this covers the rest
      let opener = null;
      const show = r.showModal.bind(r);
      r.showModal = () => {
        opener = o.opener || document.activeElement;
        r.style.removeProperty('--sheet-dy');
        show();
      };
      r.addEventListener('close', () => {
        if (opener && opener.isConnected && !r.contains(opener) && document.activeElement !== opener) opener.focus();
        opener = null;
        if (o.onClose) o.onClose(r.returnValue);
      });
      r.addEventListener('click', e => e.target === r && r.matches(':modal') && r.close()); // the backdrop
      // a swipe down on the head closes it on the phone; it follows the finger until then
      let y0 = null;
      head.addEventListener('pointerdown', e => e.pointerType !== 'mouse' && (y0 = e.clientY));
      head.addEventListener('pointermove', e => {
        if (y0 != null) r.style.setProperty('--sheet-dy', Math.max(0, e.clientY - y0) + 'px');
      });
      const end = e => {
        if (y0 == null) return;
        const dy = e.clientY - y0;
        y0 = null;
        r.style.removeProperty('--sheet-dy');
        if (dy > 80 && e.type === 'pointerup') r.close();
      };
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
      return r;
    }
