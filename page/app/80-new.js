    // ------------------------------------------------------------ the header's New (B-287, C-7)
    // New is the page's one way to create: a menu of Task for Today and Note, each a modal dialog that keeps focus
    // inside. Esc closes the menu or the dialog and gives focus back to New. A task lands on today's list through the
    // list edit; a note lands in ideas, with no course. Each paints at once and the write catches up (D-208): a refused
    // write opens the dialog again with his words in it. The way out is Esc or a tap outside, never a Cancel button
    // (D-160), and leaving keeps what he typed for the next time he opens that kind.
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
        ph: 'What did you learn, in your words?',
        hint: 'Goes to Record as yours.',
        cta: 'Save note',
        max: 400,
        ok: 'Saved to Record',
      },
    };
    const newBtn = $('new-btn'),
      newMenu = $('new-menu'),
      dlg = $('new-dlg');
    let newKind = null;
    const drafts = { task: '', note: '' };
    // B-308 (C-7): a task's Category, Estimate, When and Course, written through the list edit (kind, minutes, date,
    // course), so it counts against that day's budget. Category is the list's own kinds; a To-do has no badge (B-291).
    const TASK_KINDS = [
      ['todo', 'To-do'],
      ['reading', 'Reading'],
      ['practice', 'Practice'],
      ['review', 'Review'],
      ['notes', 'Notes'],
    ];
    const TASK_WHENS = [
      ['today', 'Today'],
      ['tomorrow', 'Tomorrow'],
    ];
    const taskCourses = () => E.activeCourses().sort((a, b) => (b === E.defaultCourse()) - (a === E.defaultCourse()));
    const taskDefaults = () => ({ kind: 'todo', minutes: 15, when: 'today', course: taskCourses()[0] || '' });
    let taskOpts = taskDefaults();
    function segPaint(id, opts, key) {
      $(id).replaceChildren(
        ...opts.map(([v, n]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = n;
          b.dataset.v = v;
          b.setAttribute('aria-pressed', String(taskOpts[key] === v));
          b.addEventListener('click', () => {
            taskOpts[key] = v;
            for (const x of $(id).children) x.setAttribute('aria-pressed', String(x.dataset.v === v));
          });
          return b;
        })
      );
    }
    function taskFields(on) {
      $('new-fields').hidden = !on;
      $('new-min').hidden = !on;
      if (!on) return;
      if (!taskCourses().includes(taskOpts.course)) taskOpts.course = taskCourses()[0] || '';
      segPaint('new-kind', TASK_KINDS, 'kind');
      segPaint('new-when', TASK_WHENS, 'when');
      segPaint(
        'new-course',
        taskCourses().map(c => [c, c]),
        'course'
      );
      $('new-min').value = String(taskOpts.minutes);
    }
    const readMinutes = () => Math.max(0, Math.min(240, Math.round(Number($('new-min').value) || 0)));
    const menuItems = () => [...newMenu.querySelectorAll('[role="menuitem"]')];
    function newMenuOpen(on) {
      newMenu.hidden = !on;
      newBtn.setAttribute('aria-expanded', String(on));
      if (on) menuItems()[0].focus();
    }
    const newField = () => (newKind === 'note' ? $('new-text') : $('new-title'));
    function newOpen(kind, text = drafts[kind], opts) {
      newMenuOpen(false);
      newKind = kind;
      if (opts) taskOpts = { ...opts };
      taskFields(kind === 'task');
      const k = NEW[kind];
      $('new-head').textContent = k.head;
      $('new-hint').textContent = k.hint;
      $('new-save').textContent = k.cta;
      $('new-title').hidden = kind !== 'task';
      $('new-text').hidden = kind !== 'note';
      const f = newField();
      f.placeholder = k.ph;
      f.maxLength = k.max;
      f.value = text;
      $('new-warn').textContent = '';
      if (!dlg.open) dlg.showModal();
      f.focus();
    }
    function newClose() {
      if (newKind) drafts[newKind] = newField().value;
      if (newKind === 'task') taskOpts.minutes = readMinutes();
      if (dlg.open) dlg.close();
      newKind = null;
      newBtn.focus();
    }
    function newSave() {
      const kind = newKind,
        t = newField().value.replace(/\s+/g, ' ').trim();
      if (!kind) return;
      if (kind === 'task') taskOpts.minutes = readMinutes();
      if (!t) return newField().focus();
      const w = idUnpassed(t); // B-197: values only
      if (w.length) {
        $('new-warn').textContent = 'That looks like it ' + w[0].why + '. Take that detail out first.';
        return newField().focus();
      }
      newClose();
      drafts[kind] = '';
      const o = { ...taskOpts },
        tomorrow = kind === 'task' && o.when === 'tomorrow';
      if (kind === 'task') taskOpts = taskDefaults();
      guard(
        null,
        async () => {
          if (kind === 'task') {
            const edit = { action: 'add', text: t, kind: o.kind, minutes: o.minutes, course: o.course };
            const r = await editList(tomorrow ? E.addDays(today, 1) : today, edit, 'Matt');
            if (r.note) toast('Already on the list');
          } else await write(E.noteIdea(t, { at: now(), date: today }));
        },
        tomorrow ? 'Added to tomorrow' : NEW[kind].ok,
        () => newOpen(kind, t, kind === 'task' ? o : null)
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
    dlg.addEventListener('click', e => {
      if (e.target === dlg) newClose(); // a tap on the backdrop
    });
    $('new-form').addEventListener('submit', e => {
      e.preventDefault();
      newSave();
    });
