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
      renderLine(); // B-333
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
        const dot = (it.tag !== 'GRADED' && BADGE[it.tag] && BADGE[it.tag][1]) || 'd-q'; // B-361: Graded's dot is grey
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
    // B-333 (D-312): her one-line insight under the header, as in the demo: one sentence built from the record and at
    // most one action, on Today (list and week) and Study; absent when there is nothing to say, and never on Progress,
    // Record, System or her own view. A sticky strip spanning the window; from 1200 px the right panel starts under it.
    const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const numWord = n => NUM[n] || String(n);
    function lineFor(t) {
      if (t === 'today') {
        if (ui.todayView === 'week') {
          const g = weekDates(E.addDays(today, WEEK_DAYS - 1), true).filter(d => d.graded && !E.isRemovedDate(d));
          return g.length ? { text: gradedLine(g) } : null;
        }
        if (ui.restPlan) return null; // the proposal speaks for itself
        const { items, isDone, budget } = dayState();
        const bv = budgetView(budget, items, isDone);
        if (!bv || !bv.left) return null;
        return {
          text: bv.over
            ? `${bv.left} minutes are on the list, ${bv.over} over the ${bv.free} you have left. Plan the rest suggests what to take off; nothing moves without you.`
            : `${bv.left} of your ${bv.available} minutes are on the list. Plan the rest suggests what to add or take off; nothing moves without you.`,
        };
      }
      if (t === 'study') {
        if (ui.study === 'review' || ui.study === 'practice')
          return { text: 'Misses are proposed as weak spots. You review them once, at the end.' };
        const cur = studyCourses().find(x => x.course === ui.studyCourse);
        if (!cur) return null;
        const acc = E.answerStats(M.attempts.all).byObjective;
        const weak = S.objectives.filter(o => o.exam === cur.exam.id && objState(o, acc[o.id]).state === 'notyet');
        if (!weak.length) return null;
        const ex = (cur.exam.title || cur.exam.id).replace(/:.*$/, '');
        const text =
          weak.length === 1
            ? `One ${ex} objective is not yet solid: ${weak[0].text || weak[0].id}.`
            : `${numWord(weak.length)} ${ex} objectives are not yet solid.`;
        return { text, act: [weak.length === 1 ? 'Quiz me on it' : 'Quiz me on them', b => quizObjective(weak[0], b)] };
      }
      return null;
    }
    function renderLine() {
      let strip = $('evline');
      if (!strip) {
        strip = el('div', 'evline');
        strip.id = 'evline';
        strip.setAttribute('role', 'status');
        strip.hidden = true;
        $('mh').after(strip);
      }
      let line = null;
      try {
        line = M ? lineFor(ui.tab) : null;
      } catch (e) {
        if (!(e instanceof ReferenceError || e instanceof TypeError)) throw e; // a record still loading says nothing
      }
      const key = line ? line.text + '|' + (line.act ? line.act[0] : '') : '';
      if (strip.dataset.k !== key) {
        strip.dataset.k = key;
        const ico = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        ico.setAttribute('viewBox', '0 0 24 24');
        ico.setAttribute('aria-hidden', 'true');
        ico.setAttribute('class', 'el-ico');
        ico.innerHTML = '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/>';
        strip.replaceChildren(
          ...(line
            ? [
                ico,
                el('span', 'el-t', line.text),
                ...(line.act ? [btn(line.act[0], ev => line.act[1](ev.currentTarget), { cls: 'btn neutral sm' })] : []),
              ]
            : [])
        );
      }
      strip.hidden = !line;
      document.body.classList.toggle('has-line', !!line);
      document.documentElement.style.setProperty('--line-h', line ? strip.offsetHeight + 'px' : '0px');
    }
    addEventListener('resize', () => {
      const s = $('evline');
      if (s && !s.hidden) document.documentElement.style.setProperty('--line-h', s.offsetHeight + 'px');
    });
