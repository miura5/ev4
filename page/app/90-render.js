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
    // B-221 (D-210): the sidebar's Today (today's first three items not done) and Working (each running job, one row),
    // each absent while empty (D-151). A row opens where it lives.
    function renderSide() {
      const t = $('side-today'),
        w = $('side-work');
      if (!t || !w) return;
      const { items, isDone } = dayState();
      const open3 = items.filter(it => !isDone(it) && !it.deferred).slice(0, 3);
      const row = (dot, text, go) => {
        const b = el('button', 'si');
        b.type = 'button';
        b.append(el('span', 'sdot ' + dot), el('span', 't', text));
        b.addEventListener('click', go);
        return b;
      };
      t.replaceChildren(
        ...(open3.length ? [el('p', 'sec', 'Today')] : []),
        ...open3.map(it => row(it.tag === 'GRADED' ? 'd-urg' : 'd-q', it.text, () => showTab('today')))
      );
      t.hidden = !open3.length;
      const jobs = liveJobs();
      w.replaceChildren(
        ...(jobs.length ? [el('p', 'sec', 'Working')] : []),
        ...jobs.map(j =>
          row('d-her', (kindLabel(j.kind) || j.title || 'A job') + ' · ' + jobState(j).label, () => showTab('ev'))
        )
      );
      w.hidden = !jobs.length;
    }
