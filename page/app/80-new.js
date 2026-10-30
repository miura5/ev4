    // ------------------------------------------------------------ the header's New (B-287, C-7)
    // New is the page's one way to create: a menu of Task for Today and Note, each a modal dialog that keeps focus
    // inside. Esc closes the menu or the dialog and gives focus back to New. A task lands on today's list through the
    // list edit; a note lands in ideas, its title first, its words and its course when picked (B-373). Each paints at once and the write catches up (D-208): a refused
    // write opens the dialog again with his words in it. The way out is Esc, a tap outside or Cancel (B-361, as the
    // demo), and leaving keeps what he typed for the next time he opens that kind. Add stays off while the title is empty.
    // B-465: the same dialog adds an exam (course, title, date, its kind from the title) from Study's No exam yet.
    const NEW = {
      task: {
        head: 'New task',
        ph: 'What needs doing?',
        hint: 'Shows on Today and in the sidebar.',
        cta: 'Add task',
        max: 140,
        ok: 'Added to today',
      },
      note: {
        head: 'New note',
        ph: 'Title, e.g. Rounding: tenths for mL',
        hint: 'Goes to Record as yours.',
        cta: 'Save note',
        max: 140,
        ok: 'Saved to Record',
      },
      exam: {
        head: 'New exam',
        ph: 'Title, e.g. Chapter 9 lab exam',
        hint: 'Shows on Study, so E.V. can plan for it.',
        cta: 'Add exam',
        max: 120,
        ok: 'Added to Study',
      },
    };
    const newBtn = $('new-btn'),
      newMenu = $('new-menu'),
      dlg = $('new-dlg');
    let newKind = null;
    const drafts = { task: '', note: '', exam: '' },
      noteDraft = { body: '', course: '' };
    // B-308 (C-7): a task's Category, Estimate, When and Course, written through the list edit (kind, minutes, date,
    // course), so it counts against that day's budget. Category is the list's own kinds; a To-do has no badge (B-291).
    // B-361: the demo's two categories: Classes is a plain to-do, Study a review item (it counts under Today's Study).
    const TASK_KINDS = [
      ['todo', 'Classes'],
      ['review', 'Study'],
    ];
    const TASK_ESTS = [
      [5, '5 min'],
      [15, '15'],
      [30, '30'],
      [45, '45'],
    ];
    const ICON = {
      task: 'M5 5h14v14H5zM9 12l2 2 4-4',
      note: 'M6 4h9l3 3v13H6zM9 10h6M9 14h6',
      exam: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5', // B-465: a calendar day
    };
    const TASK_WHENS = [
      ['today', 'Today'],
      ['tomorrow', 'Tomorrow'],
    ];
    const taskCourses = () => E.activeCourses().sort((a, b) => (b === E.defaultCourse()) - (a === E.defaultCourse()));
    const taskDefaults = () => ({ kind: 'todo', minutes: 15, when: 'today', course: taskCourses()[0] || '' });
    let taskOpts = taskDefaults();
    // B-465: an exam's course, date and kind; kind null means as the title says (core examKindFor)
    const EXAM_KIND_WORDS = { unit: 'Unit', lab: 'Lab', final: 'Final', dosage: 'Dosage', ati: 'ATI' };
    const examDefaults = () => ({ course: taskCourses()[0] || '', date: '', kind: null });
    let examOpts = examDefaults();
    /** B-513 (D-376): one of the dialog's switches as Proprietary's Segmented, in the place (and with the id, class
     *  and label) of the one the shell's markup or the last paint left; [value, words] pairs, on the picked value. */
    function newSeg(id, opts, on, pick) {
      const old = $(id);
      const sg = DS.segmented({
        cls: old.className,
        value: on,
        options: opts.map(([v, n]) => ({ value: v, label: n })),
        onPick: pick,
      });
      for (const a of old.attributes) if (!sg.hasAttribute(a.name)) sg.setAttribute(a.name, a.value);
      [...sg.children].forEach((b, i) => (b.dataset.v = String(opts[i][0])));
      old.replaceWith(sg);
      return sg;
    }
    function segPaint(id, opts, key, into = taskOpts, then) {
      newSeg(id, opts, into[key], v => {
        into[key] = v;
        if (then) then();
      });
    }
    /** B-465: the exam's Kind switch: the course's exam kinds, the one the title says pressed until he picks one. */
    function examKindPaint() {
      const kinds = E.examKinds(examOpts.course);
      if (examOpts.kind && !kinds.includes(examOpts.kind)) examOpts.kind = null;
      const auto = E.examKindFor(newField().value, examOpts.course);
      const on = examOpts.kind || auto;
      newSeg(
        'new-ekind',
        kinds.map(k => [k, EXAM_KIND_WORDS[k] || k]),
        on,
        k => (examOpts.kind = k)
      );
    }
    // B-373 (as the demo's NewItem): a note has a Title, its words, and a Course switch with None; the task rows hide.
    // B-465: an exam has a Title, its Course, its Date and its Kind.
    function newFields(kind) {
      $('new-fields').hidden = false;
      for (const id of ['new-kind-row', 'new-est-row', 'new-when-row']) $(id).hidden = kind !== 'task';
      for (const id of ['new-date-row', 'new-ekind-row']) $(id).hidden = kind !== 'exam';
      if (kind === 'note') {
        if (noteDraft.course && !taskCourses().includes(noteDraft.course)) noteDraft.course = '';
        const opts = [...taskCourses().map(c => [c, c]), ['', 'None']];
        newSeg('new-course', opts, noteDraft.course, v => (noteDraft.course = v));
        return;
      }
      if (kind === 'exam') {
        if (!taskCourses().includes(examOpts.course)) examOpts.course = taskCourses()[0] || '';
        segPaint(
          'new-course',
          taskCourses().map(c => [c, c]),
          'course',
          examOpts,
          examKindPaint
        );
        $('new-date').value = examOpts.date || '';
        examKindPaint();
        return;
      }
      if (!taskCourses().includes(taskOpts.course)) taskOpts.course = taskCourses()[0] || '';
      segPaint('new-kind', TASK_KINDS, 'kind');
      segPaint('new-est', TASK_ESTS, 'minutes');
      segPaint('new-when', TASK_WHENS, 'when');
      segPaint(
        'new-course',
        taskCourses().map(c => [c, c]),
        'course'
      );
    }
    const saveSync = () => {
      $('new-save').disabled = !newField().value.trim() || (newKind === 'exam' && !$('new-date').value);
      if (newKind === 'exam' && !examOpts.kind) examKindPaint(); // the kind follows the title until he picks one
    };
    const menuItems = () => [...newMenu.querySelectorAll('[role="menuitem"]')];
    function newMenuOpen(on) {
      newMenu.hidden = !on;
      newBtn.setAttribute('aria-expanded', String(on));
      if (on) menuItems()[0].focus();
    }
    const newField = () => $('new-title');
    function newOpen(kind, text = drafts[kind], opts) {
      newMenuOpen(false);
      newKind = kind;
      if (opts && kind === 'task') taskOpts = { ...opts };
      if (opts && kind === 'note') Object.assign(noteDraft, opts);
      if (opts && kind === 'exam') examOpts = { ...examDefaults(), ...opts }; // B-465: Study's course comes with it
      // B-520 (F-46): a new note takes the course picked on Study, else the first
      if (kind === 'note' && !opts && !drafts.note && !noteDraft.body)
        noteDraft.course = taskCourses().includes(ui.studyCourse) ? ui.studyCourse : taskCourses()[0] || '';
      const k = NEW[kind];
      $('new-head').textContent = k.head;
      $('new-ico').setAttribute('d', ICON[kind]);
      $('new-hint').textContent = k.hint;
      $('new-save').textContent = k.cta;
      $('new-text').hidden = kind !== 'note';
      $('new-text').value = kind === 'note' ? noteDraft.body : '';
      const f = newField();
      f.placeholder = k.ph;
      f.maxLength = k.max;
      f.value = text;
      newFields(kind);
      $('new-warn').textContent = '';
      saveSync();
      if (!dlg.open) dlg.showModal();
      f.focus();
    }
    function newClose() {
      if (newKind) drafts[newKind] = newField().value;
      if (newKind === 'note') noteDraft.body = $('new-text').value;
      if (newKind === 'exam') examOpts.date = $('new-date').value;
      if (dlg.open) dlg.close();
      newKind = null;
      newBtn.focus();
    }
    function newSave() {
      const kind = newKind,
        t = newField().value.replace(/\s+/g, ' ').trim();
      if (!kind) return;
      if (!t) return newField().focus();
      if (kind === 'exam' && !$('new-date').value) return $('new-date').focus();
      const body = kind === 'note' ? $('new-text').value.trim() : '';
      newClose();
      drafts[kind] = '';
      const nd = { body, course: noteDraft.course };
      if (kind === 'note') noteDraft.body = '';
      const o = kind === 'exam' ? { ...examOpts } : { ...taskOpts },
        tomorrow = kind === 'task' && o.when === 'tomorrow';
      if (kind === 'task') taskOpts = taskDefaults();
      if (kind === 'exam') examOpts = examDefaults();
      guard(
        null,
        async () => {
          if (kind === 'task') {
            const edit = { action: 'add', text: t, kind: o.kind, minutes: o.minutes, course: o.course };
            const r = await editList(tomorrow ? E.addDays(today, 1) : today, edit, 'Matt');
            if (r.note) toast('Already on the list');
          } else if (kind === 'exam') {
            // B-465: his exam, through core's composer (D-200); the kind he picked, else as the title says
            await write(
              E.examAdd(S.examsRaw, { course: o.course, title: t, date: o.date, kind: o.kind }, { now: now(), today })
            );
            ui.studyCourse = o.course;
            render();
          } else
            await write(
              E.noteIdea(t, { at: now(), date: today, body: nd.body, course: nd.course, existing: S.ideas || [] })
            );
        },
        tomorrow ? 'Added to tomorrow' : NEW[kind].ok,
        () => newOpen(kind, t, kind === 'task' || kind === 'exam' ? o : nd)
      );
    }
    newBtn.addEventListener('click', () => newMenuOpen(newMenu.hidden));
    newMenu.addEventListener('click', e => {
      const b = e.target.closest('[data-new]');
      if (b) newOpen(b.dataset.new);
    });
    newMenu.addEventListener('keydown', e => {
      const its = menuItems(),
        i = its.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        newMenuOpen(false);
        newBtn.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        its[(i + (e.key === 'ArrowDown' ? 1 : -1) + its.length) % its.length].focus();
      } else if (e.key === 'Tab') newMenuOpen(false);
    });
    document.addEventListener('pointerdown', e => {
      if (!newMenu.hidden && !e.target.closest('#new-wrap')) newMenuOpen(false);
    });
    dlg.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        newClose();
      } else if (e.key === 'Tab') {
        // keep focus inside the dialog, both ways
        const f = [...dlg.querySelectorAll('button:not([disabled]),input,textarea')].filter(
          x => !x.hidden && x.getClientRects().length
        );
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      } else if (e.key === 'Enter' && e.target.id === 'new-title') {
        e.preventDefault();
        newSave();
      }
    });
    dlg.addEventListener('cancel', e => e.preventDefault()); // Esc is the keydown's, so focus goes back to New
    outsideTap(dlg, t => t === dlg, newClose); // a tap on the backdrop (B-595)
    $('new-cancel').addEventListener('click', newClose);
    for (const id of ['new-title', 'new-text', 'new-date']) $(id).addEventListener('input', saveSync);
    $('new-form').addEventListener('submit', e => {
      e.preventDefault();
      newSave();
    });
