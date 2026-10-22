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
    function enter(node) {
      // B-125 (D-222): the view shows at once, one fade of at most 0.2 s on the whole (CSS: .enter)
      if (!node) return;
      node.classList.remove('enter');
      void node.offsetWidth;
      node.classList.add('enter');
      clearTimeout(node.__enterT);
      node.__enterT = setTimeout(() => node.classList.remove('enter'), 250);
    }
    tabs.forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
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
      // A view marked data-beside sits beside the others from 1024 px (Study's plan): never chosen there, never hidden.
      const seg = $(id);
      const set = v => {
        const beside = $(prefix + '-' + v) && $(prefix + '-' + v).dataset.beside;
        if (WIDE.matches && beside) v = seg.querySelector('button').dataset.v;
        if (ui[key] !== v && seg.dataset.ready) enter($(prefix + '-' + v));
        ui[key] = v;
        seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
        seg.parentElement
          .querySelectorAll(':scope > [id^="' + prefix + '-"]')
          .forEach(p => (p.hidden = p.id !== prefix + '-' + v && !(WIDE.matches && p.dataset.beside)));
        if (!(WIDE.matches && beside)) store.set(key, v);
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
    const setStudy = wireSeg('seg-study', 'study', 'study');
    wireSeg('seg-progress', 'progress', 'progress');
    wireSeg('seg-record', 'record', 'record');
    $('seg-record').addEventListener('click', () => render());
    // The page always opens on E.V. (the conversation); a #tab link can open another tab.
    {
      const t = (location.hash || '').slice(1);
      showTab(t && $('p-' + t) ? t : 'ev');
    }

