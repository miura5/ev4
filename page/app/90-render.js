    // ------------------------------------------------------------ render
    function renderAll() {
      if (!['weak', 'sets', 'exams'].every(k => loaded.has(k))) return;
      M = model();
      renderToday();
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
      // B-120 (D-157): Live, or the one problem System leads with; never counts.
      setStatus(sysProblem || 'Live', !sysProblem, !!sysProblem);
    }
    // B-221 (D-210), B-286: the sidebar's Today, today's first five items not done with their dots, then "n more in
    // Today"; absent while empty (D-151) and while Today is the view (D-292, styles.css). A row opens Today. No Working
    // section: background jobs show in the conversation (D-291).
    const SIDE_MAX = 5;
    function sideOpen() {
      const { items, isDone } = dayState();
      return items.filter(it => it.tag !== 'EXAM' && !isDone(it) && !it.deferred); // as Today's list shows them (B-117)
    }
    const sideShown = () => sideOpen().slice(0, SIDE_MAX); // B-290: what the sidebar shows, for Coming up to leave out
    function renderSide() {
      const t = $('side-today');
      if (!t) return;
      const open = sideOpen();
      const row = (dot, text, go, cls = 'si') => {
        const b = el('button', cls);
        b.type = 'button';
        if (dot) b.append(el('span', 'sdot ' + dot));
        b.append(el('span', 't', text));
        b.addEventListener('click', go);
        return b;
      };
      const more = open.length - SIDE_MAX;
      t.replaceChildren(
        ...(open.length ? [el('p', 'sec', 'Today')] : []),
        ...open
          .slice(0, SIDE_MAX)
          .map(it => row(it.tag === 'GRADED' ? 'd-urg' : 'd-q', it.text, () => showTab('today'))),
        ...(more > 0 ? [row('', more + ' more in Today', () => showTab('today'), 'si more')] : [])
      );
      t.hidden = !open.length;
    }
