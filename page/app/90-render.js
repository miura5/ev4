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
      // B-120 (D-157): Live, or the one problem System leads with; never counts.
      setStatus(sysProblem || 'Live', !sysProblem, !!sysProblem);
    }

