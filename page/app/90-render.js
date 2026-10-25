    // ------------------------------------------------------------ render
    function renderAll() {
      if (!['weak', 'sets', 'exams'].every(k => loaded.has(k))) return;
      M = model();
      renderToday();
      renderObjectives(); // B-297
      renderReview();
      renderPractice();
      renderPlan();
      renderReadiness();
      renderWeak();
      renderRecord();
      renderSystem();
      renderEV();
      renderSide();
      renderStudySide(); // B-223 (D-245)
      // B-341 (D-312): the header says Live; health problems show in System only (sysProblem), never in the header.
      setStatus('Live', true, false);
    }
    // B-221 (D-210), B-286, B-334 (D-312): the sidebar's Today as in the demo, on every view: "Today" and "n left", then
    // today's first five items not done, each with a dot coloured by its type and its minutes or day, then "n more in
    // Today"; absent while empty (D-151). A row opens its task in Today. No Working section (D-291).
    const SIDE_MAX = 5;
    function sideOpen() {
      const { items, isDone } = dayState();
      return items.filter(it => it.tag !== 'EXAM' && !isDone(it) && !it.deferred); // as Today's list shows them (B-117)
    }
    const sideShown = () => sideOpen().slice(0, SIDE_MAX); // B-290: what the sidebar shows, for Coming up to leave out
    function sideWhen(it, due) {
      if (it.minutes) return it.minutes + 'm';
      if (!due) return '';
      if (due === today) return 'Today';
      return new Date(due + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
    }
    function renderSide() {
      const t = $('side-today');
      if (!t) return;
      const open = sideOpen();
      const row = (dot, text, when, go, cls = 'si') => {
        const b = el('button', cls);
        b.type = 'button';
        if (dot != null) b.append(el('span', 'sdot ' + dot));
        b.append(el('span', 't', String(text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '')));
        if (when) b.append(el('span', 'st', when));
        b.addEventListener('click', go);
        return b;
      };
      const item = it => {
        const due = it.tag === 'GRADED' ? gradedDue(it) : null;
        const red = due && due <= E.addDays(today, 1);
        const dot = red ? 'x-red' : (BADGE[it.tag] && BADGE[it.tag][1]) || 'd-q';
        const sel = ui.tab === 'today' && ui.taskSel === it.id && !ui.taskGone;
        return row(dot, it.text, sideWhen(it, due), () => {
          showTab('today');
          openTask(it.id);
        }, sel ? 'si on' : 'si');
      };
      const more = open.length - SIDE_MAX;
      const head = el('p', 'sec');
      head.append(el('span', null, 'Today'), el('span', 'sp'), el('span', 'n-left', open.length + ' left'));
      t.replaceChildren(
        ...(open.length ? [head] : []),
        ...open.slice(0, SIDE_MAX).map(item),
        ...(more > 0 ? [row(null, more + ' more in Today', '', () => showTab('today'), 'si more')] : [])
      );
      t.hidden = !open.length;
    }
    // B-334 (D-312): Preferences opens its popover (Theme, Contrast, System); Esc, a click outside or System closes it,
    // and Esc returns focus to the button.
    {
      const btnP = $('side-prefs-btn'),
        pop = $('side-prefpop');
      if (btnP && pop) {
        const setOpen = (on, focus) => {
          pop.hidden = !on;
          btnP.setAttribute('aria-expanded', String(on));
          if (!on && focus) btnP.focus();
        };
        btnP.addEventListener('click', () => {
          const on = pop.hidden;
          setOpen(on);
          if (on) (pop.querySelector('[aria-pressed="true"]') || pop.querySelector('button')).focus();
        });
        pop.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false, true);
          }
        });
        btnP.addEventListener('keydown', e => {
          if (e.key === 'Escape' && !pop.hidden) {
            e.preventDefault();
            setOpen(false, true);
          }
        });
        document.addEventListener('click', e => {
          if (!pop.hidden && !pop.contains(e.target) && !btnP.contains(e.target)) setOpen(false);
        });
        const sys = $('tab-system');
        if (sys) sys.addEventListener('click', () => setOpen(false));
      }
    }
