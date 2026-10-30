    // ------------------------------------------------------------ navigation
    const tabs = [...document.querySelectorAll('.tab')];
    const ui = {
      tab: 'ev',
      study: 'review',
      progress: 'readiness',
      record: 'sessions',
      openSet: null,
    };
    // B-223 (D-245): from 1200 px every view has the right panel while it has something to show.
    const PANEL = window.matchMedia ? matchMedia('(min-width:1200px)') : { matches: false, addEventListener() {} };
    // From 1200 px Study's open question has the set's questions as a list in the right panel. Each Study runner leaves
    // its list here by its body; renderStudySide (05) shows the one whose view is open.
    const studyLists = new Map();
    const headDate = d =>
      new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      });
    // B-553: from 600 px the centre pane (.wrap) scrolls and the window never does; under 600 px the document scrolls.
    const pane = () => (innerWidth >= 600 && document.querySelector('.wrap')) || document.scrollingElement;
    const paneY = () => pane().scrollTop;
    const paneTo = y => {
      pane().scrollTop = y;
    };
    // B-555: each view keeps its own place in the pane, and the last view and its place come back on relaunch. Kept in
    // this device's storage (ev3-tab, ev3-scroll); an empty or blocked storage opens on E.V. at the top, as before.
    const SCROLL = {};
    try {
      Object.assign(SCROLL, JSON.parse(store.get('scroll') || '{}') || {});
    } catch (e) {
      /* a damaged entry is ignored */
    }
    let scrollSaveT = 0,
      pendingScroll = null;
    const saveScroll = () => {
      clearTimeout(scrollSaveT);
      scrollSaveT = setTimeout(() => store.set('scroll', JSON.stringify(SCROLL)), 250);
    };
    const keepScroll = () => {
      if (ui.tab === 'ev' || (pendingScroll && pendingScroll.tab === ui.tab)) return;
      SCROLL[ui.tab] = Math.round(paneY());
      saveScroll();
    };
    // the view's rows may still be arriving: try each frame for up to 3 s, until there is room; his own scroll wins
    function restoreScroll(t) {
      const y = t === 'ev' ? 0 : SCROLL[t] || 0;
      pendingScroll = y ? { tab: t, y, until: Date.now() + 3000 } : null;
      paneTo(y);
      const step = () => {
        const p = pendingScroll;
        if (!p || p.tab !== ui.tab) return;
        const el = pane();
        if (el.scrollHeight - el.clientHeight >= p.y - 1 || Date.now() > p.until) {
          paneTo(p.y);
          pendingScroll = null;
          return;
        }
        paneTo(p.y);
        requestAnimationFrame(step);
      };
      if (pendingScroll) requestAnimationFrame(step);
    }
    const userScrolls = () => (pendingScroll = null);
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown'])
      addEventListener(ev, userScrolls, { passive: true, capture: true });
    document
      .querySelector('.wrap')
      ?.addEventListener('scroll', () => innerWidth >= 600 && keepScroll(), { passive: true });
    addEventListener('scroll', () => innerWidth < 600 && keepScroll(), { passive: true });
    function showTab(t) {
      const was = ui.tab;
      if (was && was !== t && was !== 'ev' && !(pendingScroll && pendingScroll.tab === was)) {
        SCROLL[was] = Math.round(paneY());
        saveScroll();
      }
      ui.tab = t;
      store.set('tab', t);
      if (t !== 'ev') ui.planTarget = null; // B-461: Ask for changes' target is dropped when he switches away
      tabs.forEach(b =>
        b.getAttribute('role') === 'tab'
          ? b.setAttribute('aria-selected', String(b.dataset.tab === t))
          : b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false')
      );
      document.querySelectorAll('section.panel').forEach(s => (s.hidden = s.id !== 'p-' + t));
      const ask = t !== 'notes' && document.getElementById('note-ask'); // B-442: Ask E.V. stays with its note
      if (ask) ask.hidden = true;
      // B-390: leaving the view an address opened (#system) clears it, so the same address opens it again (window's
      // history: the page has a history() of its own)
      if (location.hash && location.hash.slice(1) !== t)
        try {
          window.history.replaceState(window.history.state, '', location.pathname + location.search);
        } catch (e) {
          /* a sandboxed frame may refuse; the address then stays */
        }
      document.body.classList.toggle('on-ev', t === 'ev');
      document.body.dataset.view = t; // B-223 (D-294): the sidebar's Today steps aside while Today is the view
      // B-208 (D-210), B-287 (C-4): the pane's header names the view; hers is "E.V." at every width, as its tab says.
      const head = $('mh-title'),
        b = $('tab-' + t);
      // B-346 (D-312): Today's header carries the day, as the demo's "Today · Friday 23 October"
      if (head && b) head.textContent = t === 'today' ? b.title + ' · ' + headDate(today) : b.title;
      placeSegs(t);
      renderStudySide(); // B-223 (D-245): the Study panel only while Study is the view
      renderLine(); // B-333: her insight strip follows the view
      // B-348 (D-312): a toast from the view he left (Today's Plan the rest) does not follow him into the next
      const tx = $('toast');
      if (was && was !== t && tx && !tx.hidden && Date.now() - Number(tx.dataset.at || 0) > 400) tx.hidden = true;
      if (was !== t) {
        if (t === 'ev' && was) paneTo(pane().scrollHeight);
        else restoreScroll(t);
        enter($('p-' + t));
      } // back on E.V.: the newest message
      if (t === 'progress' && was !== t) {
        try {
          if (M) renderReadiness();
        } catch (e) {
          if (!(e instanceof ReferenceError)) console.error(e);
        }
      } // the audit card (B-85; M is not set yet on the first call)
    }
    // B-213 (D-225): a view's switch is the pane header's from 600 px, and a full-width row at the top of the view on the
    // phone. Each switch keeps its id, so everything that reads or clicks it works where it sits.
    const SEG_HOME = {};
    // B-297: while a set is open in Study's quiz card, the way back stands in for the view tabs
    const quizOpen = id => id === 'study' && (ui.study === 'review' || ui.study === 'practice');
    function placeSegs(t) {
      const mh = $('mh');
      for (const id of ['study', 'progress', 'record']) {
        // B-335: Today's switch sits in its own toolbar, as in the demo
        const sg = $('seg-' + id);
        if (!sg || !mh) continue;
        if (!SEG_HOME[id]) {
          SEG_HOME[id] = document.createComment('seg-' + id);
          sg.before(SEG_HOME[id]);
        }
        if (innerWidth >= 600) {
          if (sg.parentNode !== mh) mh.insertBefore(sg, $('status')); // B-246: beside the title, before any status line, so it never moves
          sg.hidden = id !== t || sg.children.length < 2 || quizOpen(id); // a switch of one view is no switch (B-297: Progress)
        } else {
          if (sg.previousSibling !== SEG_HOME[id]) SEG_HOME[id].after(sg);
          sg.hidden = sg.children.length < 2 || quizOpen(id);
        }
      }
    }
    addEventListener('resize', () => placeSegs(ui.tab));
    function enter(node) {
      // B-225 (D-271): the view shows at once, a cut: .enter carries no animation; it only marks the switch
      if (!node) return;
      node.classList.remove('enter');
      void node.offsetWidth;
      node.classList.add('enter');
      clearTimeout(node.__enterT);
      node.__enterT = setTimeout(() => node.classList.remove('enter'), 250);
    }
    tabs.forEach(b =>
      b.addEventListener('click', () => {
        // B-208 (D-210): on the phone her flower is the E.V. tab; tapping her there, already on E.V., is tapping her.
        if (b.dataset.tab === 'ev' && ui.tab === 'ev' && innerWidth < 600) return backToNow();
        showTab(b.dataset.tab);
      })
    );
    // B-368 (D-316): the sidebar's brand is not a control, as the demo (the Conversation tab opens her view).
    const WIDE = window.matchMedia ? matchMedia('(min-width:1024px)') : { matches: false, addEventListener() {} }; // B-121 (D-158)
    function wireSeg(id, key, prefix) {
      // D-249: every view is a tab at every width (Study's plan no longer sits beside from 1024 px).
      const seg = $(id);
      const set = v => {
        if (ui[key] !== v && seg.dataset.ready) enter($(prefix + '-' + v));
        ui[key] = v;
        seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
        $('p-' + key) // B-213: the switch may sit in the pane header; its views are its tab's
          .querySelectorAll(':scope > [id^="' + prefix + '-"]')
          .forEach(p => (p.hidden = p.id !== prefix + '-' + v));
        store.set(key, v);
        if (key === 'study') {
          renderStudySide(); // B-223: the panel follows the open view
          syncStudyBar(); // B-297: the toolbar follows it too
        }
      };
      seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => set(b.dataset.v)));
      const saved = store.get(key);
      if (saved && seg.querySelector('[data-v="' + saved + '"]')) set(saved);
      else set(seg.querySelector('button').dataset.v);
      seg.dataset.ready = '1';
      WIDE.addEventListener('change', () => {
        set(store.get(key) || ui[key]);
        render();
      });
      return set;
    }
    PANEL.addEventListener('change', () => render());
    const setStudy = wireSeg('seg-study', 'study', 'study');
    wireSeg('seg-progress', 'progress', 'progress');
    // The page always opens on E.V. (the conversation); a #tab link can open another tab.
    {
      const t = (location.hash || '').slice(1);
      const last = store.get('tab'); // B-555: the view he left the app on
      showTab(
        t && $('p-' + t) ? t : last && last !== 'system' && $('p-' + last) && !$('tab-' + last)?.hidden ? last : 'ev'
      );
    }
    // B-352 (D-314): System has no link, as the demo; #system opens it
    window.addEventListener('hashchange', () => {
      const t = (location.hash || '').slice(1);
      if (t && $('p-' + t)) showTab(t);
    });

    // B-559: the Mac's keys. Cmd-1 to 6 open the sidebar's views in order, / goes to the message box, Esc closes the
    // top layer, Cmd-K opens a menu of the views and the main actions (Proprietary's Popover). Ctrl stands in for Cmd
    // off the Mac. Typing in a field is never taken: only / outside one, and the Cmd keys.
    const editable = n => !!n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
    const shownTabs = () => [...document.querySelectorAll('#top .tabs .tab')].filter(b => !b.hidden);
    const toComposer = () => {
      if (ui.tab !== 'ev') showTab('ev');
      const i = $('ev-input');
      if (i) i.focus();
    };
    const cmdNew = k =>
      typeof newOpen === 'function' ? newOpen(k) : document.querySelector('[data-new="' + k + '"]')?.click();
    let cmdk = null;
    function commandMenu() {
      if (cmdk && cmdk.matches(':popover-open')) return cmdk.hidePopover();
      if (cmdk) cmdk.remove();
      const items = shownTabs().map((b, i) => ({
        label: (b.querySelector('.lab-side') || b).textContent.trim() || b.title,
        key: '⌘' + (i + 1),
        onPick: () => showTab(b.dataset.tab),
      }));
      items.push(
        { label: 'Message E.V.', key: '/', onPick: toComposer },
        { label: 'New task', onPick: () => cmdNew('task') },
        { label: 'New note', onPick: () => cmdNew('note') },
        { label: 'System', onPick: () => showTab('system') }
      );
      cmdk = DS.popover({ label: 'Go to', items });
      cmdk.id = 'cmdk';
      cmdk.classList.add('cmdk');
      document.body.append(cmdk);
      cmdk.style.setProperty('--pop-x', Math.max(8, Math.round(innerWidth / 2 - 160)) + 'px');
      cmdk.style.setProperty('--pop-y', Math.round(innerHeight * 0.18) + 'px');
      cmdk.showPopover();
      const first = cmdk.querySelector('.popover-i');
      if (first) first.focus();
    }
    // Esc's layers that are not the browser's own (a popover or a dialog closes itself)
    const LAYERS = [
      ['side-prefpop', 'side-prefs-btn'],
      ['new-menu', 'new-btn'],
    ];
    document.addEventListener('keydown', e => {
      if (e.defaultPrevented || e.isComposing) return;
      const cmd = (e.metaKey || e.ctrlKey) && !e.altKey;
      if (cmd && /^[1-6]$/.test(e.key)) {
        const b = shownTabs()[Number(e.key) - 1];
        if (!b) return;
        e.preventDefault();
        showTab(b.dataset.tab);
        return;
      }
      if (cmd && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        commandMenu();
        return;
      }
      if (e.key === '/' && !cmd && !editable(e.target) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        toComposer();
        return;
      }
      if (e.key === 'Escape' && !document.querySelector(':popover-open, dialog[open]')) {
        for (const [layer, button] of LAYERS) {
          const l = $(layer),
            b = $(button);
          if (l && !l.hidden && b) {
            e.preventDefault();
            b.click();
            b.focus();
            return;
          }
        }
      }
    });
    // B-560: the phone keyboard's Return key says what it does. The message box sends (its own attribute); a one-line
    // answer says done; a number field opens the number pad (decimal when the field takes a fraction). Set on every
    // field as views draw it, so no view has to remember.
    const keyHints = root => {
      if (!root || !root.querySelectorAll) return;
      const all = root.matches && root.matches('input') ? [root] : root.querySelectorAll('input');
      for (const i of all) {
        if (i.type === 'number') {
          if (!i.hasAttribute('inputmode'))
            i.setAttribute('inputmode', /\.|any/.test(i.step || '') ? 'decimal' : 'numeric');
          if (!i.hasAttribute('enterkeyhint')) i.setAttribute('enterkeyhint', 'done');
        } else if (/^(text|search|)$/.test(i.getAttribute('type') || '') && !i.hasAttribute('enterkeyhint'))
          i.setAttribute('enterkeyhint', 'done');
      }
    };
    keyHints(document.body);
    if (typeof MutationObserver === 'function')
      new MutationObserver(ms => {
        for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) keyHints(n);
      }).observe(document.body, { childList: true, subtree: true });
    // B-563: the Safari settings tip shows in System only in desktop Safari (an iPad says Mac too, but has touch)
    {
      const ua = navigator.userAgent || '',
        tip = $('sys-safari');
      if (tip)
        tip.hidden = !(
          /Safari\//.test(ua) &&
          /Macintosh/.test(ua) &&
          !/Chrome|Chromium|CriOS|FxiOS|Edg\/|OPR\//.test(ua) &&
          !(navigator.maxTouchPoints > 0)
        );
    }
    // B-556: her view shows once its first message is in and her stage sits on her lines (placed after the thread has
    // laid out), steady for three frames; at most 3 s after boot
    if (document.body.classList.contains('ev-booting')) {
      const t0 = Date.now();
      const settled = () => {
        const h = $('hero'),
          th = $('thread');
        if (!th || !th.querySelector('.msg')) return false;
        if (!h || !h.offsetHeight) return true;
        // her stage drops to her lines on a 300 ms beat (74's dropSync); place it now rather than after it shows
        const was = $('p-ev').style.getPropertyValue('--ev-drop');
        if (typeof dropSync === 'function') dropSync(true);
        return $('p-ev').style.getPropertyValue('--ev-drop') === was;
      };
      let calm = 0;
      const step = () => {
        calm = settled() ? calm + 1 : 0;
        if (calm >= 3 || Date.now() - t0 > 3000) document.body.classList.remove('ev-booting');
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
