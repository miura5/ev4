    // ------------------------------------------------------------ navigation
    const tabs = [...document.querySelectorAll('.tab')];
    const ui = {
      tab: 'ev',
      study: 'review',
      progress: 'readiness',
      record: 'sessions',
      openSet: null,
      planShown: null,
    }; // B-194
    // B-223 (D-245): from 1200 px every view has the right panel while it has something to show.
    const PANEL = window.matchMedia ? matchMedia('(min-width:1200px)') : { matches: false, addEventListener() {} };
    // From 1200 px Study's open question has the set's questions as a list in the right panel. Each Study runner leaves
    // its list here by its body; renderStudySide (05) shows the one whose view is open.
    const studyLists = new Map();
    const headDate = d =>
      new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    function showTab(t) {
      const was = ui.tab;
      ui.tab = t;
      tabs.forEach(b =>
        b.getAttribute('role') === 'tab'
          ? b.setAttribute('aria-selected', String(b.dataset.tab === t))
          : b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false')
      );
      document.querySelectorAll('section.panel').forEach(s => (s.hidden = s.id !== 'p-' + t));
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
        window.scrollTo(0, t === 'ev' && was ? document.documentElement.scrollHeight : 0);
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
      for (const id of ['study', 'progress', 'record']) { // B-335: Today's switch sits in its own toolbar, as in the demo
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
    $('brand').addEventListener('click', () => {
      // on E.V., the small core brings the large one back (and tucks it away again)
      if (ui.tab !== 'ev') {
        showTab('ev');
        return;
      }
      backToNow();
    });
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
    wireSeg('seg-record', 'record', 'record');
    $('seg-record').addEventListener('click', () => render());
    // The page always opens on E.V. (the conversation); a #tab link can open another tab.
    {
      const t = (location.hash || '').slice(1);
      showTab(t && $('p-' + t) ? t : 'ev');
    }

