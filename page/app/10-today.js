    // ------------------------------------------------------------ Today
    // the same plan the 4:25 am run builds, from the record as it stands now (liveDay, and B-293's Plan the rest)
    function planNow(date = today) {
      return E.planDay({
        // B-68: the scheduler the morning uses (spec.study.scheduler), so a live day agrees with it
        pickReviews: window.EVStudy.picker(E, window.EVStudy.schedulerOf(EV_SPEC), EV_SPEC),
        date,
        dates: S.dates,
        exams: S.exams,
        plans: S.plans,
        weakspots: M.models,
        objectives: S.objectives,
        sets: S.sets,
      });
    }
    function liveDay() {
      // computed here when the run hasn't saved one
      const plan = planNow();
      const list = E.buildDayList(plan, {
        reviewSetId: S.sets.some(s => s.id === 'review-' + today) ? 'review-' + today : null,
        notes: M.models.filter(w => w.kind === 'note' && w.derived.status === 'open'),
        sets: S.sets,
        newSets: S.sets.filter(s => s.kind !== 'review' && E.chicagoDate(s.createdAt || '') === today),
      });
      return { dayType: plan.dayType, list, plan: { budget: plan.budget, deferred: plan.deferred }, live: true };
    }
    function planTaskById(ref) {
      // "plans/E4#<taskId>"
      const m = /^plans\/([^#]+)#(.+)$/.exec(ref || '');
      if (!m) return null;
      // the ref names the exam (planDay's b.plan); a plan in force with its own id (a study plan, B-450) is that exam's
      const p = S.plans.find(x => x.id === m[1]) || S.plans.find(x => (x.exam || x.id) === m[1]);
      if (!p) return null;
      const t = E.planTasks(p).find(t => t.id === m[2]);
      return t ? { plan: p, task: t } : null;
    }
    /** B-450: with Approved tasks set to Keep in the plan, a study plan's task stays in Study's plan, off Today's list
     *  and off the week's days. */
    const keepsInPlan = () => !!(S.planSettings && S.planSettings.approved === 'plan');
    function keptInPlan(it) {
      if (!keepsInPlan()) return false;
      const pt = planTaskById(it.ref);
      return !!(pt && pt.plan.section);
    }
    /**
     * B-483: one task, one tick. A study plan approved after the morning saved the day puts its tasks for a day on that
     * day's list (today and later; an earlier day stays as saved), as planDay builds them. An item added to a day with a
     * plan task's own words on that task's day (Plan the rest's add, or a copy it made before B-483) is that plan task:
     * shown once, ticked in the plan's planedits, and a tick the copy got on the day counts as the task's.
     */
    // B-483: and the plan item's own id ticked on the day, when it was this plan's (EVCore.planDayTickIds)
    const copyIds = (plan, task) =>
      task && task.date ? E.planDayTickIds(dayEditDoc(task.date), dayDoc(task.date), S.plans, plan, task) : [];
    function planDone(plan, task, date = today) {
      if (E.taskDone(plan, task, date, S.sets, S.answers)) return true;
      const ed = task.date && dayEditDoc(task.date);
      return copyIds(plan, task).some(id => !!(ed && ed.checks && ed.checks[id]));
    }
    function withPlanTasks(date, day) {
      if (date < today || !(S.plans || []).some(p => p.section && (p.days || []).some(d => d.date === date)))
        return day;
      const planned = E.buildDayList(planNow(date), { sets: S.sets }).items.filter(it => {
        const pt = planTaskById(it.ref);
        return pt && pt.plan.section;
      });
      return E.dayWithPlanTasks(day, planned);
    }
    function dayState(date = today) {
      // the planned list (saved at 4:25am, else built live) plus what he or E.V. added or took off (D-078); B-448: an
      // earlier day is its saved plan and its own dayedits, as the week's day panel shows it
      const past = date !== today;
      const day = withPlanTasks(date, past ? dayDoc(date) || { date } : M.day && M.day.list ? M.day : liveDay());
      const ed = past ? dayEditDoc(date) : M.dayedit;
      // B-483: an added item that is a plan task joins it: once on the list, with the plan's ref
      const v = E.joinPlanCopies(E.dayView(day, ed), S.plans, date);
      const checks = (ed && ed.checks) || {};
      const isDone = it => {
        const pt = planTaskById(it.ref);
        if (pt) return planDone(pt.plan, { ...pt.task }, date);
        return !!checks[it.id];
      };
      return { day, items: v.items.filter(it => !keptInPlan(it)), isDone, budget: v.budget, skipped: v.skipped };
    }
    const dayDoc = date => S.days.find(d => d.id === date) || null;
    const dayEditDoc = date => S.dayedits.find(d => d.id === date) || null;
    const writeDayEdit = (date, data) => write({ op: 'set', collection: 'dayedits', id: date, data }); // an Edit: replaced whole
    async function editList(date, edit, by) {
      // one add / remove / restore through EVCore.listEdit; today's planned items may be live
      const base = date >= today ? dayState(date).day : dayDoc(date) || { date }; // B-483: a later day with its plan tasks
      const r = E.listEdit(base, dayEditDoc(date), edit, { now: now(), by, date });
      if (r.doc) await writeDayEdit(date, r.doc);
      return r;
    }
    function reviewState() {
      const rs = S.sets.find(s => s.id === 'review-' + today);
      const items = rs ? E.validItems(rs) : [];
      return { rs, total: items.length, left: items.filter(q => !answersOf(rs)[q.id]).length };
    }
    function tickWrite(it, on, date = today) {
      const pt = planTaskById(it.ref);
      if (pt) return tickPlan(pt.plan, pt.task, on);
      return editList(date, { action: 'check', id: it.id, done: on }, 'Matt'); // B-448: on the day the row is on
    }
    async function tickPlan(plan, task, on) {
      // planedits/<exam id>: the page's ticks, replaced whole
      const examId = plan.exam || plan.id;
      const pe = S.planedits.find(x => x.id === examId) || null;
      const r = E.planTick(pe, examId, task.id, { done: on, now: now(), by: 'Matt' });
      await write({ op: 'set', collection: 'planedits', id: r.id, data: r.data });
      // B-483: unticked, a copy's old tick on its day goes too, so the task reads not done in both places
      const ed = !on && task.date && dayEditDoc(task.date);
      const ticked = ed ? copyIds(plan, task).filter(id => ed.checks && ed.checks[id]) : [];
      if (!ticked.length) return;
      const rest = { ...ed };
      delete rest.id; // readers carry the id beside the fields; a write never does
      const checks = { ...(ed.checks || {}) };
      for (const id of ticked) delete checks[id];
      await writeDayEdit(task.date, { ...rest, checks, updatedAt: now() }); // an Edit, replaced whole
    }
    function openItem(it) {
      const toSet = it.set || (it.ref && it.ref.startsWith('sets/') ? it.ref.slice(5) : null);
      if (!toSet) return null;
      return () => {
        if (toSet.startsWith('review-')) {
          showTab('study');
          setStudy('review');
        } else {
          ui.openSet = toSet;
          showTab('study');
          setStudy('practice');
          render();
        }
      };
    }
    const TAG_V = {
      GRADED: 'quiet',
      EXAM: 'accent',
      REVIEW: 'plum',
      'ATI REVIEW': 'plum',
      PRACTICE: 'info',
      READING: 'ok',
      LEARN: 'ok', // D-357: a study plan's Learn
      CLINICAL: 'ok',
      'CLINICAL PREP': 'ok',
      VALIDATION: 'warn',
      'VALIDATION PREP': 'warn',
      'SKILLS PREP': 'warn',
      CANVAS: 'info',
      NOTES: '',
    };
    // B-291 (D-270, D-276, C-1, C-13, D-282): an item of today's list is one row: its tick, its name, at most one badge,
    // Start on the first startable row only, and its time. Graded work is neutral and red only while it is due today or
    // tomorrow and not ticked. No Remove on a row (D-282: it lives in the task's panel); a set opens where it lives, any
    // other item opens in place to its note and who added it.
    const BADGE = {
      REVIEW: ['Review', 'x-violet'],
      'ATI REVIEW': ['ATI review', 'x-violet'],
      PRACTICE: ['Practice', 'x-violet'],
      DRILL: ['Study', 'x-violet'],
      SKILLS: ['Practice', 'x-violet'],
      READING: ['Reading', ''],
      LEARN: ['Learn', ''], // D-357: a study plan's badges are Graded, Learn, Practice, Review, Clinical prep, Skills prep
      NOTES: ['Note', 'x-blue'], // B-369: the demo's badge reads Note
      CANVAS: ['Canvas', 'x-blue'],
      CLINICAL: ['Clinical', ''],
      'CLINICAL PREP': ['Clinical prep', ''],
      VALIDATION: ['Validation', ''],
      'VALIDATION PREP': ['Validation prep', ''],
      'SKILLS PREP': ['Skills prep', 'x-yellow'], // B-450: as the plan's rows
      GRADED: ['Graded', 'x-quiet'],
    };
    // When graded work on the list is due: its calendar entry (date-, soon-), else the graded date it names.
    function gradedDue(it) {
      const m = /^dates\/(.+)$/.exec(it.ref || '');
      const d = m && S.dates.find(x => x.id === m[1]);
      if (d && d.date) return d.date;
      if (/^soon-/.test(it.id || '')) return E.addDays(today, 1);
      if (/^date-/.test(it.id || '')) return today;
      const named = S.dates
        .filter(x => x.graded && x.date >= today)
        .find(x => E.similarity(x.title || '', it.text || '') >= 0.3);
      return named ? named.date : null;
    }
    // B-364 (D-312): the name opens the task as the TaskDetail board's full view at every size, in place of the list; the
    // header's back arrow before "Today" closes it and returns to the list where it was (B-343 on the phone).
    const phone = () => innerWidth < 600;
    function openTask(id) {
      if (!(ui.taskSel && !ui.taskGone)) ui.taskScroll = window.scrollY;
      ui.taskSel = id;
      ui.taskGone = null;
      render();
      window.scrollTo(0, 0);
    }
    function closeTask() {
      ui.taskQuiz = null; // B-517: its quiz closes with it (every answer is already written)
      ui.taskSel = null;
      ui.taskGone = null;
      render();
      window.scrollTo(0, ui.taskScroll || 0);
      ui.taskScroll = 0;
    }
    const taskBack = (() => {
      const b = el('button', 'btn ghost icon sm mh-back');
      b.type = 'button';
      b.setAttribute('aria-label', 'Back to Today');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
      b.addEventListener('click', closeTask);
      const t = $('mh-title');
      if (t) t.before(b);
      // a view picked in the nav leaves the task: Today comes back as its list
      for (const tab of document.querySelectorAll('[data-tab]'))
        tab.addEventListener('click', () => {
          if (ui.taskSel) {
            ui.taskSel = null;
            ui.taskGone = null;
            ui.taskScroll = 0;
            render();
          }
        });
      return b;
    })();
    function todayRow(it, isDone, o = {}) {
      const doneNow = isDone(it);
      const text = E.rowText(it); // B-392: the row shows its day, so a heads-up drops its "(due tomorrow)"
      const sel = ui.taskSel === it.id && !ui.taskGone;
      const li = el('li', 'li today-item' + (doneNow ? ' done' : '') + (sel ? ' sel' : '') + (o.off ? ' ti-off' : ''));
      li.dataset.id = it.id;
      const tk = el('label', 'tk');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.className = 'tick';
      c.checked = c.defaultChecked = doneNow;
      c.setAttribute('aria-label', 'Done: ' + text);
      c.addEventListener('change', () => {
        T.ticked.add(it.id);
        guard(c, () => tickWrite(it, c.checked, o.date || today), null);
      });
      tk.append(c);
      const nm = el('button', 'nm ti-nm');
      nm.type = 'button';
      nm.append(el('span', 'ti-t', text));
      // B-448: an earlier day's row is checked off in place; its task view (Snooze, Start) is today's
      if (!o.date) {
        nm.setAttribute('aria-controls', 'today-task');
        nm.setAttribute('aria-expanded', String(sel));
        nm.addEventListener('click', () => openTask(it.id));
      }
      // B-343, B-382: a click anywhere on the row's free space opens the task, as the name does, at every width
      if (!o.off && !o.date)
        li.addEventListener('click', e => {
          if (!e.target.closest('button, label, input, a')) openTask(it.id);
        });
      li.append(tk, nm);
      const due = it.tag === 'GRADED' ? gradedDue(it) : null;
      const b = BADGE[it.tag];
      // B-293 (C-9): a proposed take-off keeps its row, with one "Proposed" badge and Accept and Keep in place of Start
      // B-363 (D-312): every row carries its category chip, as the demo's list does; B-361: Graded is neutral grey
      const bb = b || (catOf(it) === 'study' ? ['Study', 'x-violet'] : ['Class', '']);
      li.append(el('span', 'badge' + (bb[1] ? ' ' + bb[1] : ''), bb[0]));
      // B-369 (D-312): a proposed take-off keeps its row struck through, with why, the tick and the cross, as the demo
      if (o.off)
        li.append(
          el('span', 'sp'),
          el('span', 'pmark', 'Off today · ' + o.off.p.why),
          ...restButtons(o.off.P, o.off.p, offEdit(o.off.p), 'take “' + text + '” off today')
        );
      // B-374 (D-312): Start on every row that can start, shown on the first and on hover or focus on the others
      const go = o.start && startGo(it);
      if (go && !o.off) {
        const st = btn('Start', go, { cls: 'btn neutral sm ti-start' + (o.start === 'hov' ? ' hov' : '') });
        st.prepend(svgIcon('M8 5l11 7-11 7z'));
        st.setAttribute('aria-label', 'Start: ' + text);
        li.append(st);
      }
      // B-363 (D-312): as the demo, minutes for today's items and the short weekday (Mon) for one due later
      const when = doneNow
        ? 'Done'
        : due && due > today
          ? short(due).slice(0, 3)
          : it.minutes
            ? durFmt(it.minutes)
            : due
              ? 'Today'
              : '';
      li.append(el('span', 't', when));
      return li;
    }
    // B-517 (F-32): a practice or drill task with no set of its own starts its course's quiz inside the opened task, on
    // Today: up to five questions answered in place (or five written for the course when it has none). Never a note, a
    // study session or another view.
    /** B-517: a task's course: the record's (taskFacts), else the course its words name, else Study's or the next exam's. */
    const taskCourseOf = it =>
      quizCourse(E.taskCourse(it, { known: taskFacts(it, () => false, dayState().day).course }) || '');
    function quizTask(it) {
      if (ui.taskSel !== it.id || ui.taskGone) openTask(it.id);
      const course = taskCourseOf(it);
      const card = quizCardFor(course);
      if (card) {
        ui.taskQuiz = { task: it.id, card };
        return render();
      }
      if (!sample || T.sampleOff) return toast('No ' + course + ' questions yet, and writing them needs Claude.');
      if (morePending) return toast('E.V. is already writing questions. Try again in a moment.');
      ui.taskQuiz = { task: it.id, course, writing: true };
      render();
      morePractice({
        course,
        onSet: id => (ui.taskQuiz = { task: it.id, card: { type: 'set', id, title: 'Quiz · ' + course } }),
      }).then(ok => {
        if (!ok && ui.taskQuiz && ui.taskQuiz.task === it.id && ui.taskQuiz.writing) {
          ui.taskQuiz = null;
          toast($('more-status').textContent || 'Couldn’t write questions right now. Try again in a moment.');
        }
        render();
      });
    }
    /** B-517: the opened task's quiz, under its description; drawn on every render, as the conversation's cards are. */
    function paintTaskQuiz(it, main) {
      let tq = $('today-taskquiz');
      const q = it && ui.taskQuiz && ui.taskQuiz.task === it.id ? ui.taskQuiz : null;
      if (!q) {
        if (tq) tq.remove();
        return;
      }
      if (!tq) {
        tq = el('section', 'card ev-card tv-quiz');
        tq.id = 'today-taskquiz';
        tq.setAttribute('aria-label', 'Quiz');
      }
      if (tq.parentNode !== main) main.append(tq);
      if (q.writing) return tq.replaceChildren(el('p', 'meta', 'Writing five questions on ' + q.course + '…'));
      tq.replaceChildren();
      CARDS.set(tq, q.card, 'task-' + it.id);
    }
    /** B-520 (F-45): a note task's Write: in Notes (from 1024 px) the note it names opens, else a new one titled as the
     *  task, in the task's course; on the phone the New note sheet, filled the same way. */
    function writeTask(it, known) {
      const title = E.rowText(it);
      const course = E.taskCourse(it, { known }) || quizCourse('');
      if (!notesOn()) return newOpen('note', title, { course, body: '' });
      const n = E.noteForTask(S.notes, { text: title, course });
      const from = whereNow();
      showTab('notes');
      guard(null, () => (n ? openNote(n.id) : newNote(from, { course, title })));
    }
    // B-374 (D-312): what Start does, as the demo's: a set opens where it lives; any other item with an estimate starts a
    // study session with E.V.
    function startGo(it) {
      const go = openItem(it);
      if (go) return go;
      if (!(Number(it.minutes) > 0)) return null;
      if (E.taskStart(it) === 'quiz') return () => quizTask(it); // B-517: a practice task's quiz, in the opened task
      const notes = taskStudy(it); // B-406: on desktop the session is in Notes (or a timed one of its own)
      if (notes) return notes;
      return () => {
        showTab('ev');
        guard(null, () => quick('Start a study session'));
      };
    }
    // A row that can start, as the demo's: not done, not graded, not over the budget, and an estimate.
    const startable = (it, isDone) =>
      !isDone(it) && !it.deferred && it.tag !== 'GRADED' && Number(it.minutes) > 0 && !!startGo(it);
    // B-363 (D-312): the demo's Done group under the list: a chevron and "Done · N", opening in place to its rows.
    function doneGroup(rows, open) {
      const f = el('button', 'grp ti-fold');
      f.type = 'button';
      f.append(svgIcon(open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'), document.createTextNode('Done · ' + rows.length));
      f.setAttribute('aria-expanded', String(!!open));
      const ul = el('ul', 'list ti-folded');
      ul.hidden = !open;
      ul.append(...rows);
      f.addEventListener('click', () => {
        ui.todayFolds = { ...(ui.todayFolds || {}), done: !open };
        render();
      });
      return [f, ul];
    }
    function itemRow(it, isDone) {
      const doneNow = isDone(it);
      const go = openItem(it);
      const detail = [
        it.note,
        it.minutes ? '~' + durFmt(it.minutes) : '',
        it.deferred ? 'deferred: over today’s budget' : '',
        it.added ? 'added by ' + (it.by === 'Matt' ? 'you' : 'E.V.') : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return row({
        title: it.text,
        detail,
        chips: it.tag
          ? [[it.tag === 'GRADED' ? 'Graded' : it.tag.charAt(0) + it.tag.slice(1).toLowerCase(), TAG_V[it.tag] ?? '']]
          : [],
        cls: doneNow ? 'done' : '', // B-89: tags in sentence case
        check: {
          checked: doneNow,
          label: 'Done: ' + it.text,
          onChange: (on, c) => {
            T.ticked.add(it.id);
            if (on) sfNod(c); // B-78: a check-off in a surface: her nod, and nothing he is ticking moves
            guard(c, () => tickWrite(it, on), null);
          },
        },
        action: go ? btn('Open', go, { cls: 'btn ghost sm' }) : null,
      });
    }
    /**
     * B-292 (C-5): planDay's budget as he sees it. The planned minutes split into done (ticked) and left (the rest);
     * free is the budget minus what's done. Ticking moves minutes from left to done, so the bar never shrinks; the day is
     * over budget when what's left exceeds the time left. Null when the day has no budget.
     */
    function budgetView(budget, items, isDone) {
      if (!budget || !(budget.available > 0)) return null;
      const available = Math.round(budget.available),
        planned = Math.max(0, Math.round(budget.planned || 0));
      const doneRaw = items.filter(it => isDone(it)).reduce((s, it) => s + (Number(it.minutes) || 0), 0);
      const done = Math.min(planned, Math.round(doneRaw)),
        left = planned - done,
        free = Math.max(0, available - done),
        over = Math.max(0, left - free);
      return {
        available,
        planned,
        done,
        left,
        free,
        over,
        line: `${left} of ${available} min`,
        donePct: Math.min(100, (done / available) * 100),
        leftPct: Math.max(
          0,
          Math.min(100, ((done + left) / available) * 100) - Math.min(100, (done / available) * 100)
        ),
      };
    }
    // a toolbar icon, as the demo draws them: one 24-unit path, stroked
    function svgIcon(d) {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('class', 'ico');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
      return svg;
    }
    function renderBudget(bv, nOpen) {
      // built here, not in the shell, which is at its byte budget; first in the side column (the right panel from 1200 px)
      let card = $('today-budget');
      if (!card) {
        card = el('div', 'card');
        card.id = 'today-budget';
        document.querySelector('#p-today .col-side').prepend(card);
      }
      card.hidden = !bv;
      if (!bv) return card.replaceChildren();
      const bar = el('div', 'pbar tb-bar' + (bv.over ? ' tb-over' : ''));
      bar.setAttribute('role', 'img');
      bar.setAttribute(
        'aria-label',
        `${bv.done} min done, ${bv.left} min left, ${bv.available} min budget` + (bv.over ? `, over by ${bv.over}` : '')
      );
      // B-346 (D-312): one fill, as the demo's: what's on the list against the day's budget, red when over
      const f = el('i', (bv.over ? 'x-red' : 'tb-neutral') + ' tb-fill');
      f.style.width = Math.min(100, (bv.left / bv.available) * 100).toFixed(1) + '%';
      bar.append(f);
      // B-335, B-346 (D-312): the demo's large figure, '<on the list> of <budget> min', then the bar, then the two rows
      const big = el('p', 'tb-big' + (bv.over ? ' tb-over' : ''), `${bv.left} of ${bv.available} min`);
      const prop = (k, v, cls) => {
        const p = el('div', 'prop' + (cls ? ' ' + cls : ''));
        p.append(el('span', 'prop-k', k), el('span', 'prop-v', v));
        return p;
      };
      card.replaceChildren(
        el('h2', null, 'Today’s budget'),
        big,
        bar,
        prop('On the list', `${bv.left} min · ${plural(nOpen, 'item')}`), // B-363: what's still open, as the demo
        prop('Done', `${bv.done} min`, 'tb-done-line'),
        ...(bv.over
          ? [el('p', 'meta tb-over tb-over-line', `Over by ${bv.over} min · ${bv.available} min budget`)]
          : [])
      );
    }
    /**
     * B-294: E.V.'s changes today, newest first: her list edits of today's list, what she added (asked in the
     * conversation, or accepted from Plan the rest) and what she took off. Each Undo is one list edit: an add is taken
     * off, a take-off brought back, and the row then leaves. Only the day's edits by E.V. are read, so his own adds, his
     * ticks and a logged study session never show. Weak-spot events join once B-233 lands; until then, list edits only.
     */
    function evChanges() {
      // the day's view already leaves out prep items and fixed items taken off; the edit document says who and when
      const ed = dayEditDoc(today) || {};
      const { items, skipped } = dayState();
      const adds = items
        .filter(it => it.added && it.by === 'E.V.')
        .map(it => ({
          id: it.id,
          kind: 'add',
          text: it.text,
          at: (ed.added[it.id] || {}).at,
          undo: { action: 'remove', id: it.id },
        }));
      const offs = skipped
        .filter(x => (ed.skipped[x.id] || {}).by === 'E.V.')
        .map(x => ({
          id: x.id,
          kind: 'off',
          text: x.text,
          at: ed.skipped[x.id].at,
          undo: { action: 'restore', id: x.id },
        }));
      return [...adds, ...offs].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    }
    function renderChanges() {
      // built here, like the budget card, and placed after it in the side column (the right panel from 1200 px)
      let card = $('today-changes');
      if (!card) {
        card = el('div', 'tc-chg');
        card.id = 'today-changes';
        const budget = $('today-budget');
        budget ? budget.after(card) : document.querySelector('#p-today .col-side').prepend(card);
      }
      // B-374 (D-312): as the demo, the label and her rows under the budget, always shown; "Nothing yet today." when
      // she has changed nothing
      const ch = evChanges();
      card.hidden = false;
      const rows = ch.map(c => {
        const text = String(c.text).replace(/\s*\(~?\d+\s*min\)\s*$/i, '');
        const title = c.kind === 'add' ? `Added “${text}” to today` : `Took “${text}” off today`;
        const undo = btn('Undo', null, { cls: 'btn ghost sm' });
        undo.setAttribute('aria-label', 'Undo: ' + title);
        undo.addEventListener('click', () =>
          guard(undo, () => editList(today, c.undo, 'Matt'), c.kind === 'add' ? 'Taken off today' : 'Back on today')
        );
        const r = el('div', 'chg');
        r.dataset.id = c.id;
        const txt = el('div', 'chg-t');
        txt.append(el('span', 'ct', title), el('span', 'mini', clock12(c.at)));
        r.append(el('i', 'dot'), txt, undo);
        return r;
      });
      card.replaceChildren(
        el('span', 'lab', 'E.V.’s changes today'),
        ...(rows.length ? rows : [el('span', 'mini chg-none', 'Nothing yet today.')])
      );
    }
    /**
     * B-296 (C-10, D-282): the task's panel, first in the side column (the right panel from 1200 px, under the pane
     * below it). Its name, then status, category, estimate, due, course and topic; "Where it came from" says who put it
     * on the list and when, with the planner's note. Start is its one primary, only when the task can start and never on
     * graded work. Snooze to tomorrow (tomorrow's add, then today's take-off) and Remove from today (the take-off) are
     * the list edits D-078 already has; each leaves an Undo here that reverses what it wrote. No full-page view, no
     * previous and next, no description paragraph.
     */
    const LIST_KIND_OF = {
      READING: 'reading',
      LEARN: 'reading',
      PRACTICE: 'practice',
      REVIEW: 'review',
      NOTES: 'notes',
      GRADED: 'graded',
    };
    const fixedItem = it => FIXED.has(it.tag) || /^(date|exam|soon)-/.test(String(it.id || ''));
    /** B-388: planned graded work due today (a date- id); Snooze makes no tomorrow copy of it, so it isn't offered. */
    const dueToday = it => it.tag === 'GRADED' && /^date-/.test(String(it.id || ''));
    function taskFacts(it, isDone, day) {
      const ed = dayEditDoc(today) || {};
      const pt = planTaskById(it.ref);
      const setId = it.set || (/^sets\//.test(it.ref || '') ? it.ref.slice(5) : null);
      const set = setId && S.sets.find(s => s.id === setId);
      const dm = /^dates\/(.+)$/.exec(it.ref || '');
      const date = dm && S.dates.find(d => d.id === dm[1]);
      const wm = /^weakspots\/(.+)$/.exec(it.ref || '');
      const ws = wm && M.models.find(w => w.id === wm[1]);
      const exam = pt && S.exams.find(e => e.id === (pt.plan.exam || pt.plan.id));
      const add = it.added ? (ed.added || {})[it.id] || {} : null;
      const course =
        (add && add.course) ||
        (date && date.course) ||
        (exam && exam.course) ||
        (set && set.course) ||
        (ws && ws.course) ||
        E.namedCourse(it.text || '', { guess: false }) || // B-517 (F-31): the course its words name
        '';
      const topics = [...new Set((set && set.items ? set.items : []).map(q => q.topic).filter(Boolean))];
      const topic =
        (ws && ws.topic) ||
        (pt && pt.task.chapters && pt.task.chapters.length ? 'Chapter ' + pt.task.chapters.join(', ') : '') ||
        (topics.length ? topics.slice(0, 2).join(', ') + (topics.length > 2 ? ' and more' : '') : '');
      const due = it.tag === 'GRADED' ? gradedDue(it) : today;
      const b = BADGE[it.tag];
      const by = w => (w === 'Matt' ? 'you' : 'E.V.');
      // B-355 (D-314): where it came from as the demo's rows: what put it on the list, with when on the right.
      // B-382: in plain words, as the demo's (Added by E.V. ... · Today); never a run's clock time.
      const at = iso => (iso ? (E.chicagoDate(iso) === today ? 'Today' : short(E.chicagoDate(iso))) : '');
      const from = [
        add
          ? { t: 'Added by ' + by(add.by || it.by), when: at(add.at) }
          : { t: 'Added by E.V. when she planned your day', when: day.live ? 'Today' : at(day.at) },
        exam ? { t: 'From the ' + (exam.title || exam.id) + ' plan', when: '' } : null,
        it.deferred ? { t: 'Deferred: over today’s budget', when: '' } : null,
      ].filter(Boolean);
      // its description when it has one: the date's own notes from Canvas, else the planner's note on the item
      const dn = date && typeof date.notes === 'string' ? date.notes.trim() : '';
      const desc = dn || (it.note && it.note !== 'Graded' && !add ? String(it.note) : '');
      return {
        status: isDone(it) ? 'Done' : it.deferred ? 'Deferred' : 'To do',
        category: b ? b[0] : it.tag === 'EXAM' ? 'Exam' : 'Task',
        badge: b && b[1] && it.tag !== 'GRADED' ? b[1] : '',
        estimate: it.minutes ? durFmt(it.minutes) : '',
        due: due
          ? due === today
            ? 'Today'
            : due === E.addDays(today, 1)
              ? 'Tomorrow'
              : short(due) + ' · ' + relDay(due)
          : '',
        course,
        topic,
        desc,
        from,
      };
    }
    // B-373 (as the demo's task view): her line above an opened graded task. With an objective its title names (or its
    // course's first one not yet solid, for a quiz or exam), she offers to quiz him on it beforehand. Any other opened
    // task has no line.
    function taskLine() {
      if (!ui.taskSel || ui.taskGone || ui.todayView === 'week') return null;
      const it = dayState().items.find(x => x.id === ui.taskSel);
      if (!it || it.tag !== 'GRADED') return null;
      const text = String(it.text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '');
      const m = /^dates\/(.+)$/.exec(it.ref || '');
      const d =
        (m && S.dates.find(x => x.id === m[1])) ||
        S.dates.filter(x => x.graded && x.date >= today).find(x => E.similarity(x.title || '', text) >= 0.3) ||
        null;
      const o = d && dateObjective(d);
      if (!o) return null;
      const named = /:\s*(.+)$/.exec((d && d.title) || text);
      const on = named ? named[1].trim().replace(/[.]+$/, '') : 'it';
      return {
        text:
          'Graded. I can quiz you on ' +
          (on === 'it' ? 'it' : on.charAt(0).toLowerCase() + on.slice(1)) +
          ' beforehand; I stay out of the quiz itself.',
        act: ['Quiz me on it', b => quizObjective(o, b)],
      };
    }
    async function snoozeTask(it) {
      // tomorrow's add first, so a refused write leaves today's list as it was
      const tomorrow = E.addDays(today, 1),
        ed = dayEditDoc(today) || {},
        add = it.added ? { ...(ed.added || {})[it.id] } : null;
      const text = String(it.text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '');
      // B-381: a soon- or date- item is the planner's, already on its due day; no tomorrow copy. Graded stays graded.
      const a = /^(soon|date)-/.test(String(it.id || ''))
        ? { doc: null }
        : await editList(
            tomorrow,
            {
              action: 'add',
              text,
              kind: it.tag === 'GRADED' ? 'graded' : (add && add.kind) || LIST_KIND_OF[it.tag] || 'todo',
              minutes: Number(it.minutes) || 0,
              course: (add && add.course) || taskFacts(it, () => false, dayState().day).course,
            },
            'Matt'
          );
      try {
        await editList(today, { action: 'remove', id: it.id }, 'Matt');
      } catch (e) {
        // today's take-off refused: tomorrow's add goes again, so the task is never on both lists
        if (a.doc && !a.note) await editList(tomorrow, { action: 'remove', id: a.id }, 'Matt').catch(() => {});
        throw e;
      }
      // B-381: an item already there that the snooze marked graded stays on tomorrow's list through an undo
      return { tomorrowId: a.doc && !a.note ? a.id : null, add };
    }
    // Undo: the take-off reversed (a planned item restored, an added one added again as it was), then tomorrow's add
    async function undoTask(it, gone) {
      if (gone.add)
        await editList(
          today,
          {
            action: 'add',
            text: gone.add.text,
            kind: gone.add.kind,
            minutes: gone.add.minutes,
            course: gone.add.course,
          },
          // B-381: graded work comes back as his, so it stays GRADED and fixed
          gone.add.kind === 'graded' || gone.add.tag === 'GRADED' ? 'Matt' : gone.add.by || 'Matt'
        );
      else await editList(today, { action: 'restore', id: it.id }, 'Matt');
      if (gone.tomorrowId) await editList(E.addDays(today, 1), { action: 'remove', id: gone.tomorrowId }, 'Matt');
    }
    // B-364 (D-312): an opened task is the TaskDetail board's full view at every size. The main pane carries the
    // breadcrumb with 'N of M' and up and down, the large title with its tick, its description and Where it came from;
    // the right panel (under it below 1200 px) the properties card, the one primary Start and Snooze to tomorrow. The
    // header's back arrow returns to the list where it was; no Close, no Remove from today.
    function taskOrder(items, isDone) {
      const shown = items.filter(i => i.tag !== 'EXAM');
      const f = FILTERS.some(x => x[0] === ui.todayFilter) ? ui.todayFilter : 'all';
      const vis = shown.filter(it => f === 'all' || catOf(it) === f);
      return [
        ...vis.filter(it => !isDone(it) && !it.deferred),
        ...vis.filter(it => !isDone(it) && it.deferred),
        ...vis.filter(it => isDone(it)),
      ];
    }
    function renderTask(items, isDone, day) {
      let panel = $('today-task');
      if (!panel) {
        panel = el('div', 'tp-panel');
        panel.id = 'today-task';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', 'Task');
        document.querySelector('#p-today .col-side').prepend(panel);
      }
      let main = $('today-taskmain');
      if (!main) {
        main = el('div', 'tv-main');
        main.id = 'today-taskmain';
        main.setAttribute('role', 'region');
        main.setAttribute('aria-label', 'Task');
        document.querySelector('#p-today .col-main').prepend(main);
      }
      const G = ui.taskGone;
      const it = G ? G.it : items.find(x => x.id === ui.taskSel);
      if (!it) ui.taskSel = null;
      const open = !!it && ui.todayView !== 'week';
      panel.hidden = main.hidden = !open;
      // an opened task is the view: the list, the toolbar and the panel's other cards step aside until it closes
      for (const c of [...panel.parentNode.children, ...main.parentNode.children])
        if (c !== panel && c !== main) c.classList.toggle('tk-away', open);
      $('p-today').classList.toggle('tk-open', open);
      document.body.classList.toggle('task-open', open);
      // the header reads "Today" while a task is open, as the board's
      const head = $('mh-title'),
        tb = $('tab-today');
      if (head && tb && ui.tab === 'today')
        head.textContent = open ? tb.title : tb.title + (typeof headDate === 'function' ? ' · ' + headDate(today) : '');
      if (!open) {
        panel.dataset.k = main.dataset.k = '';
        main.replaceChildren();
        return panel.replaceChildren();
      }
      // drawn again only when what it shows changes, so a tap on its buttons is never lost to a redraw
      const f = G ? null : taskFacts(it, isDone, day);
      const order = taskOrder(items, isDone);
      const i = Math.max(
        0,
        order.findIndex(x => x.id === it.id)
      );
      const k = JSON.stringify([
        it.id,
        it.text,
        G && G.line,
        f,
        isDone(it),
        startable(it, isDone),
        !!openItem(it),
        order.map(x => x.id),
      ]);
      if (panel.dataset.k === k && main.firstChild) return paintTaskQuiz(it, main);
      panel.dataset.k = k;
      const text = E.rowText(it); // B-392: its Due property says the day
      // the board's head row: Today › Study (or Classes), N of M, up and down through the list as it is shown
      const tvh = el('div', 'tvh');
      tvh.append(
        el('span', 'mini tvh-crumb', 'Today › ' + (catOf(it) === 'study' ? 'Study' : 'Classes')),
        el('span', 'sp')
      );
      if (!G && order.length) {
        const go = d => () => {
          ui.taskSel = order[(i + d + order.length) % order.length].id;
          render();
        };
        const up = btn('', go(-1), { cls: 'btn ghost icon sm tvh-up' }),
          dn = btn('', go(1), { cls: 'btn ghost icon sm tvh-dn' });
        up.append(svgIcon('M12 19V5M6 11l6-6 6 6'));
        dn.append(svgIcon('M12 5v14M6 13l6 6 6-6'));
        up.setAttribute('aria-label', 'Previous task');
        dn.setAttribute('aria-label', 'Next task');
        tvh.append(el('span', 'mini tvh-pos', i + 1 + ' of ' + order.length), up, dn);
      }
      const tvb = el('div', 'tvb');
      const title = el('div', 'tvb-title');
      if (!G) {
        // the tick beside the title ticks the task, as the Status switch does
        const chk = el('button', 'tp-chk' + (isDone(it) ? ' done' : ''));
        chk.type = 'button';
        chk.setAttribute('aria-label', 'Done: ' + text);
        chk.setAttribute('aria-pressed', String(isDone(it)));
        chk.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
        chk.addEventListener('click', () => {
          const v = !isDone(it);
          T.ticked.add(it.id);
          guard(chk, () => tickWrite(it, v), null);
        });
        title.append(chk);
      }
      title.append(el('h2', null, text));
      tvb.append(title);
      if (G) {
        // what Snooze just wrote, and its Undo in the panel
        tvb.append(el('p', 'tp-desc tp-gone', G.line));
        const undo = btn('Undo', null, { cls: 'btn neutral wide tp-undo' });
        undo.setAttribute('aria-label', 'Undo: ' + G.line);
        undo.addEventListener('click', () =>
          guard(
            undo,
            async () => {
              await undoTask(it, G);
              ui.taskGone = null;
              ui.taskSel = it.id;
              render();
            },
            'Back on today'
          )
        );
        const acts = el('div', 'wk-acts');
        acts.append(undo);
        main.replaceChildren(tvh, tvb);
        return panel.replaceChildren(acts);
      }
      if (f.desc) tvb.append(el('p', 'tp-desc', f.desc));
      const from = el('div', 'tp-from');
      from.append(el('span', 'prop-k', 'Where it came from'));
      for (const a of f.from) {
        const r = el('div', 'tp-act');
        r.append(el('i', 'tp-dot'), el('span', 'tp-what', a.t), el('span', 'tp-when', a.when));
        from.append(r);
      }
      tvb.append(from);
      main.replaceChildren(tvh, tvb);
      paintTaskQuiz(it, main); // B-517
      const prop = (k, v) => {
        const p = el('div', 'prop');
        p.append(el('span', 'prop-k', k), el('span', 'prop-v', v));
        return p;
      };
      // the properties in one card; Status is a To do / Done switch
      const props = el('div', 'tp-props');
      const status = prop('Status', '');
      const sw = el('div', 'tp-seg');
      sw.setAttribute('role', 'group');
      sw.setAttribute('aria-label', 'Status');
      const done = isDone(it);
      for (const [name, v] of [
        ['To do', false],
        ['Done', true],
      ]) {
        const b = el('button', done === v ? 'on' : '', name);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(done === v));
        b.addEventListener('click', () => {
          if (isDone(it) === v) return;
          T.ticked.add(it.id);
          guard(b, () => tickWrite(it, v), null);
        });
        sw.append(b);
      }
      status.lastChild.append(sw);
      const cat = prop('Category', '');
      cat.lastChild.append(el('span', 'badge' + (f.badge ? ' ' + f.badge : ''), f.category));
      props.append(status, cat);
      // B-373: Estimate, Due and Course on every task, as the board's ('—' when the record has none)
      props.append(prop('Estimate', f.estimate || '—'), prop('Due', f.due || '—'), prop('Course', f.course || '—'));
      if (f.topic) props.append(prop('Topic', f.topic));
      const acts = el('div', 'wk-acts');
      const go = openItem(it);
      if (it.tag === 'NOTES' && !isDone(it)) {
        // B-520 (F-45): a note task's one primary is Write: its note opened, or started titled as the task, in its course
        const wr = btn('Write', () => writeTask(it, f.course), { cls: 'btn primary wide tp-write' });
        wr.prepend(svgIcon('M6 4h9l3 3v13H6zM9 10h6M9 14h6'));
        wr.setAttribute('aria-label', 'Write: ' + text);
        acts.append(wr);
      } else if (startable(it, isDone)) {
        // a set of questions, as the board's topic tasks: "Start the quiz"; any other task a study session (B-374)
        const st = btn(go || E.taskStart(it) === 'quiz' ? 'Start the quiz' : 'Start study session', startGo(it), {
          cls: 'btn primary wide tp-start',
        });
        st.prepend(svgIcon('M8 5l11 7-11 7z'));
        st.setAttribute('aria-label', 'Start: ' + text);
        acts.append(st);
      } else if (go && it.tag !== 'GRADED') {
        // a set that can't start now (done, or over the budget) still opens where it lives
        const op = btn('Open', go, { cls: 'btn neutral wide tp-open' });
        op.setAttribute('aria-label', 'Open: ' + text);
        acts.append(op);
      }
      // B-373: every opened task offers Snooze, as the board's; exams, clinicals and validations keep their day (the list
      // edit refuses to move them), so there it shows, off, with the reason as its title. B-374: graded work snoozes, as
      // the demo (his own move; its due date is unchanged)
      {
        const sz = btn('Snooze to tomorrow', null, { cls: 'btn neutral wide tp-snooze' });
        // B-388: graded work planned for its due day (a date- id) stays there; the list edit refuses to move it
        if ((fixedItem(it) && it.tag !== 'GRADED') || dueToday(it)) {
          sz.disabled = true;
          sz.title = dueToday(it) ? 'Due today: it stays on today’s list.' : 'This stays on the day it is due.';
        }
        sz.addEventListener('click', () =>
          guard(
            sz,
            async () => {
              ui.taskGone = { it, line: 'Moved to tomorrow’s list.', ...(await snoozeTask(it)) };
              render();
            },
            'Moved to tomorrow'
          )
        );
        acts.append(sz);
      }
      // graded work due today stays on today's list (B-388); otherwise it snoozes like any other task (B-374)
      const note =
        it.tag === 'GRADED'
          ? [
              dueToday(it)
                ? el('p', 'meta tp-note tp-due', 'It’s due today, so it stays on today’s list.')
                : el('p', 'meta tp-note', 'Snooze moves it to tomorrow, with Undo.'),
            ]
          : fixedItem(it)
            ? [el('p', 'meta tp-note', 'It stays on the day it is due.')]
            : [el('p', 'meta tp-note', 'Snooze moves it to tomorrow, with Undo.')];
      panel.replaceChildren(props, ...(acts.children.length ? [acts] : []), ...note);
    }
    /**
     * B-293 (C-9): Plan the rest. planDay runs again on the record as it stands, and its difference from today's list
     * is proposed: an exam-plan task it would put on today that the list lacks (while it fits the time left) is a
     * proposed addition; a plan task on the list that it no longer puts on today, or now defers over the budget, is a
     * proposed take-off. Reviews, graded work, exams, clinicals and validations are the morning's and stay as they are.
     * Nothing is written until he accepts, and then only through the list edits, by E.V.
     */
    const FIXED = new Set(['GRADED', 'EXAM', 'CLINICAL', 'VALIDATION']);
    const PLAN_KIND = { reading: 'reading', drill: 'practice', sim: 'practice', review: 'review' };
    function restProposal() {
      const fresh = planNow();
      const { day, items, isDone, budget } = dayState();
      const ed = dayEditDoc(today) || {};
      const skipped = ed.skipped || {};
      const onList = new Set([...items.map(it => it.id), ...Object.keys(skipped)]);
      const texts = new Set(items.map(it => E.norm(it.text || '')));
      const planned = new Map(((day.list && day.list.items) || []).map(it => [it.id, it]));
      const freshBy = new Map(fresh.blocks.map(b => [b.id, b]));
      const offs = [];
      for (const it of items) {
        if (it.added || !/^plan-/.test(it.id) || it.deferred || isDone(it) || FIXED.has(it.tag)) continue;
        const b = freshBy.get(it.id);
        if (b && !b.deferred) continue;
        const pt = planTaskById(it.ref);
        const moved = pt && pt.task.date && pt.task.date !== today ? pt.task.date : null;
        offs.push({
          id: it.id,
          text: it.text,
          minutes: Number(it.minutes) || 0,
          why: b ? 'over today’s budget' : moved ? 'planned for ' + short(moved) : 'no longer in the plan',
        });
      }
      // B-524 (F-60): over the budget she never says the list fits. When the plan's own take-offs leave the day still over,
      // she proposes the smallest further cut from what may move (not graded work, exams, clinicals, validations or
      // reviews, nor what he or E.V. added): the one smallest task that covers it, else the biggest until it is covered.
      const bv = budgetView(budget, items, isDone);
      let over = bv ? bv.over - offs.reduce((n, o) => n + o.minutes, 0) : 0;
      if (over > 0) {
        const movable = items.filter(
          it =>
            !it.added &&
            !it.deferred &&
            !isDone(it) &&
            !FIXED.has(it.tag) &&
            !/REVIEW/.test(it.tag || '') &&
            !/^(date|exam|soon)-/.test(it.id || '') &&
            Number(it.minutes) > 0 &&
            !offs.some(o => o.id === it.id)
        );
        const one = movable.filter(it => Number(it.minutes) >= over).sort((a, b) => a.minutes - b.minutes)[0];
        const cut = one ? [one] : [];
        if (!one)
          for (const it of [...movable].sort((a, b) => b.minutes - a.minutes)) {
            if (cut.reduce((n, x) => n + Number(x.minutes), 0) >= over) break;
            cut.push(it);
          }
        for (const it of cut)
          offs.push({ id: it.id, text: it.text, minutes: Number(it.minutes) || 0, why: 'over today’s budget' });
        over -= cut.reduce((n, x) => n + (Number(x.minutes) || 0), 0);
      }
      // the time left once the take-offs go: the budget less what stays planned (done or not, as budgetView counts it)
      let room = budget ? budget.available - (budget.planned - offs.reduce((n, o) => n + o.minutes, 0)) : Infinity;
      const adds = [];
      for (const b of fresh.blocks) {
        if (!b.taskId || b.required || b.deferred || b.done || onList.has(b.id) || planned.has(b.id)) continue;
        if (keptInPlan({ ref: 'plans/' + b.plan + '#' + b.taskId })) continue; // B-483: never a copy of a kept task
        if (texts.has(E.norm(b.title || ''))) continue;
        if (b.minutes > room) continue;
        room -= b.minutes;
        const exam = S.exams.find(e => e.id === b.plan);
        adds.push({
          id: b.id,
          text: b.title,
          minutes: b.minutes || 0,
          kind: PLAN_KIND[b.kind] || 'todo',
          course: (exam && exam.course) || '',
        });
      }
      // B-369 (D-312): with free minutes and nothing from the plan to add, she proposes a short quiz on the open weak
      // spot due soonest, as the demo's TodayProposal does; a toast alone is only for a day with no room and no take-off
      if (!adds.length && room >= 5) {
        const w = M.models
          .filter(x => E.isActive(x) && x.topic && !texts.has(E.norm('Quiz: ' + x.topic)))
          .sort((a, b) => String(a.derived.nextDue || '9').localeCompare(String(b.derived.nextDue || '9')))[0];
        if (w)
          adds.push({
            id: 'rest-quiz-' + (w.id || E.norm(w.topic)),
            text: 'Quiz: ' + w.topic,
            minutes: Math.min(10, Math.floor(room)),
            kind: 'practice',
            course: w.course || '',
            why: 'a weak spot',
          });
      }
      return { date: today, adds, offs, over: Math.max(0, over) };
    }
    // B-524 (F-60): what Plan the rest says when it has nothing to propose; "fits" only when the day is inside its budget
    const restNone = np =>
      np.over > 0
        ? `Today’s list is ${np.over} min over, and what’s left is fixed (graded work, reviews, clinicals) or yours, so there’s nothing for E.V. to take off. Snooze a task to move it to tomorrow.`
        : 'Nothing to change: today’s list already fits the plan.';
    const restEdit = p => ({ action: 'add', text: p.text, kind: p.kind, minutes: p.minutes, course: p.course });
    const offEdit = p => ({ action: 'remove', id: p.id });
    function restLeft(P) {
      ui.restPlan = P.adds.length || P.offs.length ? P : null;
      render();
    }
    async function restAccept(P, which) {
      // one write: each accepted edit applied in turn to the day's edits, all by E.V.
      const take = which === 'all' ? [...P.adds.map(restEdit), ...P.offs.map(offEdit)] : [which.edit];
      const base = dayState().day;
      let doc = dayEditDoc(today);
      for (const e of take) {
        const r = E.listEdit(base, doc, e, { now: now(), by: 'E.V.', date: today });
        if (r.doc) doc = r.doc;
      }
      if (doc && doc !== dayEditDoc(today)) await writeDayEdit(today, doc);
      if (which === 'all') restLeft({ ...P, adds: [], offs: [] });
      else restLeft({ ...P, adds: P.adds.filter(x => x !== which.p), offs: P.offs.filter(x => x !== which.p) });
    }
    function restButtons(P, p, edit, noun) {
      // B-369 (D-312): the demo's ghost icon buttons, a tick and a cross, labelled
      const ok = btn('', null, { cls: 'btn ghost icon sm ti-acc' });
      ok.append(svgIcon('M5 12l5 5 9-10'));
      ok.setAttribute('aria-label', 'Accept: ' + noun);
      ok.addEventListener('click', () =>
        guard(ok, () => restAccept(P, { p, edit }), 'Done. E.V. changed today’s list')
      );
      const keep = btn('', null, { cls: 'btn ghost icon sm ti-keep' });
      keep.append(svgIcon('M6 6l12 12M18 6L6 18'));
      keep.setAttribute(
        'aria-label',
        'Keep: ' + (edit.action === 'add' ? 'leave “' + p.text + '” off today' : 'keep “' + p.text + '” on today')
      );
      keep.addEventListener('click', () =>
        restLeft({ ...P, adds: P.adds.filter(x => x !== p), offs: P.offs.filter(x => x !== p) })
      );
      return [ok, keep];
    }
    function proposedAddRow(P, p) {
      // B-369 (D-312): the demo's proposed addition: a dashed card with a +, the name, its kind's badge, "Proposed",
      // the tick and the cross, and its minutes
      const li = el('li', 'li today-item ti-prop ti-padd');
      li.dataset.id = p.id;
      li.append(svgIcon('M12 5v14M5 12h14'));
      const nm = el('span', 'nm ti-nm');
      nm.append(el('span', 'ti-t', p.text));
      const tag = { practice: 'PRACTICE', review: 'REVIEW', reading: 'READING', notes: 'NOTES' }[p.kind];
      const b = (tag && BADGE[tag]) || ['Study', 'x-violet'];
      li.append(
        nm,
        el('span', 'badge' + (b[1] ? ' ' + b[1] : ''), b[0]),
        el('span', 'sp'),
        el('span', 'pmark', 'Proposed'),
        ...restButtons(P, p, restEdit(p), 'add “' + p.text + '” to today')
      );
      li.append(el('span', 't', p.minutes ? durFmt(p.minutes) : ''));
      return li;
    }
    function restLine(P, bv) {
      const parts = [
        ...P.adds.map(p => (p.minutes ? `add a ${p.minutes}-minute “${p.text}”` : `add “${p.text}”`)),
        ...P.offs.map(p => `take “${p.text}” off today, since it’s ${p.why}`),
      ];
      // B-369 (D-312): as the demo, what today would come to if he accepts
      const would = bv
        ? ` Today would be ${Math.max(0, bv.left + P.adds.reduce((n, p) => n + p.minutes, 0) - P.offs.reduce((n, p) => n + p.minutes, 0))} of ${bv.available} min.`
        : '';
      const line = el('div', 'ti-review');
      line.setAttribute('role', 'status');
      const all = btn('Accept all', null, { cls: 'btn primary sm' });
      all.addEventListener('click', () => guard(all, () => restAccept(P, 'all'), 'Done. E.V. changed today’s list'));
      const no = btn('Reject', null, { cls: 'btn neutral sm' });
      no.addEventListener('click', () => {
        ui.restPlan = null;
        render();
      });
      line.append(
        el(
          'p',
          'ti-review-t',
          'E.V. suggests: ' + parts.join(', and ') + '.' + would + ' Nothing changes until you accept.'
        ),
        all,
        no
      );
      return line;
    }
    // B-335 (D-312): the demo's filter, All / Classes / Study with the count of open rows in each. Study is the work on
    // weak spots and practice (review, practice, notes); everything else on the list is the classes' own.
    const STUDY_TAGS = new Set([
      'REVIEW',
      'ATI REVIEW',
      'PRACTICE',
      'NOTES',
      'DRILL',
      'SKILLS',
      'LEARN',
      'SKILLS PREP',
    ]);
    const catOf = it => (STUDY_TAGS.has(it.tag) ? 'study' : 'class');
    const FILTERS = [
      ['all', 'All'],
      ['class', 'Classes'],
      ['study', 'Study'],
    ];
    /** B-487 (D-368): one row for every course's due flashcards; it opens a due-cards session (Flip). */
    function cardsRow() {
      const n = E.cardsDue(
        S.decks.filter(d => d && !d.retired),
        today
      ).length;
      if (!n) return null;
      const li = el('li', 'li ti-cards'); // not a day item: no tick, not counted with them
      const tk = el('span', 'tk');
      tk.append(svgIcon('M4 7h12v12H4zM8 4h12v12'));
      const nm = el('button', 'fc-nm'); // not a task's name: it opens the cards, never a task's view
      nm.type = 'button';
      nm.append(el('span', 'ti-t', 'Cards · ' + n + ' due'));
      nm.addEventListener('click', () => startDueCards());
      const st = btn('Start', () => startDueCards(), { cls: 'btn neutral sm ti-start hov' });
      st.prepend(svgIcon('M8 5l11 7-11 7z'));
      st.setAttribute('aria-label', 'Start: Cards · ' + n + ' due');
      li.append(tk, nm, el('span', 'badge x-violet', 'Study'), st, el('span', 't', ''));
      return li;
    }
    function renderToday() {
      // B-448: the list may show an earlier day (the toolbar's arrows); a date that is today or later is today
      if (!(ui.listDay && ui.listDay < today)) ui.listDay = null;
      const ld = ui.listDay;
      const { day, items, isDone, budget } = dayState(ld || today);
      // B-291 (D-286): no Now card; the prep check is under her greeting and the exam countdown on Study.
      // List
      const box = $('today-list');
      // B-292 (C-5): the day's budget as what's left against the time left; the side card holds the bar and the rows
      const bv = ld ? null : budgetView(budget, items, isDone);
      renderChanges(); // B-294
      if (ld) ui.taskSel = null;
      renderTask(items, isDone, day); // B-296
      // B-293 (C-9): Plan the rest, in the toolbar; its proposal waits here until he accepts, keeps or rejects it
      if (ui.restPlan && ui.restPlan.date !== today) ui.restPlan = null;
      const P = ld ? null : ui.restPlan;
      const rest = btn('Plan the rest', null, { cls: 'btn neutral sm ti-rest', disabled: !!P });
      rest.prepend(svgIcon('M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z'));
      rest.addEventListener('click', () => {
        const np = restProposal();
        if (!np.adds.length && !np.offs.length) return toast(restNone(np));
        ui.restPlan = np;
        render();
      });
      // B-363 (D-312): the open rows, then the collapsible Done group, as the demo: a row he checks off moves into Done
      // at once. No Deferred or Taken off folds and no footer line (the demo has none; their data stays in the record).
      const shown = items.filter(i => i.tag !== 'EXAM'); // the exam is on the week (B-117)
      const inDone = it => isDone(it);
      const f = FILTERS.some(x => x[0] === ui.todayFilter) ? ui.todayFilter : 'all';
      const inF = it => f === 'all' || catOf(it) === f;
      const open = shown.filter(it => !inDone(it) && !it.deferred);
      const todo = open.filter(inF),
        done = shown.filter(it => inDone(it) && inF(it));
      renderBudget(bv, open.length);
      const fseg = el('div', 'seg ti-filter');
      fseg.id = 'today-filter';
      fseg.setAttribute('role', 'group');
      fseg.setAttribute('aria-label', 'Show');
      for (const [k, n] of FILTERS) {
        const b = el('button', null, n);
        b.type = 'button';
        b.dataset.f = k;
        b.setAttribute('aria-pressed', String(k === f));
        b.append(el('i', null, String(open.filter(it => k === 'all' || catOf(it) === k).length)));
        b.addEventListener('click', () => {
          ui.todayFilter = k;
          render();
        });
        fseg.append(b);
      }
      todayBar.list = [fseg];
      todayBar.nav = dayNav(ld);
      todayBar.listEnd = ld ? [] : [rest];
      todayBar.add.className = 'btn sm ti-add ' + (P ? 'neutral' : 'primary');
      const offOf = it => P && P.offs.find(p => p.id === it.id);
      const first = todo.find(it => startable(it, isDone) && !offOf(it));
      const ul = el('ul', 'list ti-list');
      const cards = !ld && (f === 'all' || f === 'study') ? cardsRow() : null; // B-487: Cards · n due
      if (cards) ul.append(cards);
      for (const it of todo) {
        const p = offOf(it);
        const st = !p && startable(it, isDone) ? (it === first ? 'first' : 'hov') : null;
        ul.append(todayRow(it, isDone, { start: ld ? null : st, off: p ? { P, p } : null, date: ld }));
      }
      // B-369 (D-312): proposed additions sit after the first row, as the demo's
      if (P)
        ul.children[0]
          ? ul.children[0].after(...P.adds.map(p => proposedAddRow(P, p)))
          : ul.append(...P.adds.map(p => proposedAddRow(P, p)));
      const folds = ui.todayFolds || {};
      const kids = [...(P ? [restLine(P, bv)] : [])];
      const after = [];
      if (todo.length || (P && P.adds.length) || cards) kids.push(ul);
      else if (shown.length && f !== 'all')
        kids.push(
          el(
            'p',
            'empty',
            'Nothing open in ' + FILTERS.find(x => x[0] === f)[1] + (ld ? ' on this day’s list.' : ' on today’s list.')
          )
        );
      else if (!shown.length && ld) kids.push(el('p', 'empty', 'Nothing was on this day’s list.'));
      else if (!shown.length)
        kids.push(
          el(
            'p',
            'empty',
            'Nothing planned for today yet. The 4:25 am run builds the list; add your own with New or ask E.V.'
          )
        );
      if (done.length)
        after.push(
          ...doneGroup(
            done.map(it => todayRow(it, isDone, { date: ld })),
            folds.done !== false
          )
        );
      // B-363 (D-312): the toolbar's + Add opens New's task form, as the demo's Add does
      box.replaceChildren(...kids, ...after);
      // Weekly review (Sundays)
      const wk = S.weeks
        .filter(w => w.id <= today && w.id >= E.addDays(today, -1))
        .sort((a, b) => b.id.localeCompare(a.id))[0];
      const wc = $('weekly');
      wc.hidden = !(wk && (wk.review || wk.reflection));
      if (!wc.hidden) {
        wc.replaceChildren(
          el('h2', null, 'Weekly review'),
          ...(wk.review ? [el('p', 'stem', wk.review)] : []),
          ...(wk.reflection ? [el('p', 'meta', 'Reflection: ' + wk.reflection)] : []),
          // B-201: the build recap, the Chart's one sentence for the week
          ...(wk.health && wk.health.recap ? [el('p', 'meta wk-recap', wk.health.recap)] : [])
        );
      }
      renderEvDates(weekDates());
      renderWeek(); // B-295
    }
    /**
     * B-295 (C-6, C-13, C-16): Today's Week view, beside List in the view's switch. Seven days from today, as seven
     * columns from 1200 px and one row per day below it. Today's column opens with the real count of today's list; each
     * date is a chip that opens its panel (the right panel from 1200 px, under the days below it): Quiz me on it, Open
     * the task, and Take off with Bring back, the calendar's existing edit (D-080). Her line counts the graded dates in
     * the seven days from the dates themselves. A taken-off date keeps its chip, so it can come back from here.
     */
    const WEEK_DAYS = 7;
    // B-335 (D-312): the demo's toolbar, one row at the top of the view: in the list the filter, List / Week and Plan the
    // rest; in the week List / Week, back / Today / forward and the date range. New in the header stays the one Add (C-7).
    const todayBar = (() => {
      const bar = el('div', 'toolbar today-bar');
      bar.id = 'today-bar';
      $('p-today').querySelector('.cols').before(bar);
      // B-363 (D-312): + Add at the toolbar's end in both views, primary until a Plan the rest proposal waits
      const add = btn('Add', () => newOpen('task'), { cls: 'btn primary sm ti-add' });
      add.prepend(svgIcon('M12 5v14M5 12h14'));
      return { bar, list: [], listEnd: [], add };
    })();
    const weekSeg = (() => {
      const sg = el('div', 'seg');
      sg.id = 'seg-today';
      sg.setAttribute('role', 'group');
      sg.setAttribute('aria-label', 'Today views');
      for (const [v, n, d] of [
        ['list', 'List', 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01'],
        ['week', 'Week', 'M4 5h16v14H4zM4 10h16M10 10v9'],
      ]) {
        const b = el('button', null, n);
        b.type = 'button';
        b.dataset.v = v;
        b.prepend(svgIcon(d));
        b.addEventListener('click', () => {
          ui.todayView = v;
          store.set('todayView', v);
          render();
        });
        sg.append(b);
      }
      ui.todayView = store.get('todayView') === 'week' ? 'week' : 'list';
      return sg;
    })();
    const WK_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function weekNav(start, wk) {
      const nav = el('div', 'wk-nav');
      const go = n => () => {
        ui.weekOff = n;
        ui.weekSel = null;
        render();
      };
      const prev = btn('', go(wk - 1), { cls: 'btn ghost icon sm' }),
        next = btn('', go(wk + 1), { cls: 'btn ghost icon sm' });
      prev.append(svgIcon('M15 6l-6 6 6 6'));
      next.append(svgIcon('M9 6l6 6-6 6'));
      prev.setAttribute('aria-label', 'Previous week');
      next.setAttribute('aria-label', 'Next week');
      const now = btn('Today', go(0), { cls: 'btn ghost sm' });
      const end = E.addDays(start, WEEK_DAYS - 1);
      const [, m0, d0] = start.split('-').map(Number),
        [, m1, d1] = end.split('-').map(Number);
      const label =
        d0 +
        (m0 !== m1 ? ' ' + WK_MON[m0 - 1] : '') +
        ' – ' +
        d1 +
        ' ' +
        WK_MON[m1 - 1] +
        (wk === 0 ? ' · next 7 days' : '');
      nav.append(prev, now, next, el('span', 'mini wk-range', label));
      return nav;
    }
    // B-448: the list's day, as the week's arrows: back a day, Today, forward a day up to today; an earlier day is named
    function dayNav(ld) {
      const nav = el('div', 'wk-nav');
      nav.id = 'today-daynav';
      const cur = ld || today;
      const go = d => () => {
        ui.listDay = d < today ? d : null;
        ui.taskSel = null;
        ui.taskGone = null;
        render();
      };
      const prev = btn('', go(E.addDays(cur, -1)), { cls: 'btn ghost icon sm' }),
        next = btn('', go(E.addDays(cur, 1)), { cls: 'btn ghost icon sm', disabled: !ld });
      prev.append(svgIcon('M15 6l-6 6 6 6'));
      next.append(svgIcon('M9 6l6 6-6 6'));
      prev.setAttribute('aria-label', 'Previous day');
      next.setAttribute('aria-label', 'Next day');
      nav.append(prev, btn('Today', go(today), { cls: 'btn ghost sm' }), next);
      if (ld) {
        const [, m, d] = ld.split('-').map(Number);
        nav.append(el('span', 'mini wk-range', dayName(ld).slice(0, 3) + ' ' + d + ' ' + WK_MON[m - 1]));
      }
      return nav;
    }
    const dayName = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    // B-382: the week's banner on one line: the count, then the next one or two graded dates, a long title cut at a
    // word with an ellipsis. B-392: the count is gradedWeek's, the same seven days and items as her answer and the pane.
    function gradedLine() {
      const g = E.gradedWeek(S.dates, S.exams, today, WEEK_DAYS);
      const n = g.length;
      const head =
        (n === 1
          ? 'One graded date'
          : (['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n] || String(n)) +
            ' graded dates') + ' in the next 7 days';
      if (!n) return head + '.';
      const each = g
        .slice(0, 2)
        .map(
          d =>
            E.shortTitle(d.title, 42) +
            (d.date === today
              ? ' today'
              : d.date === E.addDays(today, 1)
                ? ' tomorrow'
                : ' on ' + dayName(d.date).slice(0, 3))
        );
      return head + '. Next: ' + each.join(', then ') + '.';
    }
    const relDay = d => E.relDay(d, today); // B-447: a past day reads as past (yesterday, N days ago)
    function dateObjective(d) {
      // what "Quiz me on it" quizzes: the objective of his upcoming exams in its course that its title names; for an
      // exam, else its first objective not yet solid. None: no Quiz me.
      const ex =
        d.kind === 'exam'
          ? S.exams.find(e => 'exam-' + e.id === d.id || (e.date === d.date && E.courseOf(e) === E.courseOf(d)))
          : null;
      const objs = S.objectives.filter(o => {
        const e = S.exams.find(x => x.id === o.exam);
        return e && e.date >= today && (ex ? e.id === ex.id : E.courseOf(e) === E.courseOf(d));
      });
      const best = objs.map(o => [o, E.similarity(o.text || '', d.title || '')]).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 0.3) return best[0];
      // B-363 (D-312): an exam or a quiz always offers Quiz me on it, on its course's first objective not yet solid
      return ex || /\bquiz\b/i.test(d.title || '')
        ? objs.find(o => objState(o).state !== 'solid') || objs[0] || null
        : null;
    }
    function dateTask(d) {
      // the item on today's list that carries this date
      const ref = /^exam-/.test(d.id) ? 'exams/' + d.id.slice(5) : 'dates/' + d.id;
      return dayState().items.find(it => it.ref === ref) || null;
    }
    // the clock a date carries (its dueAt, Central time), or ''
    function dateClock(d) {
      const t = d.dueAt ? new Date(d.dueAt) : null;
      return t && !isNaN(t)
        ? t
            .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
            .toLowerCase()
        : '';
    }
    // B-363 (D-312): a week card as the demo's: the title, then a grey dot and its time ('9:00 am', 'Any time'); no kind
    // words, no red (B-361: Graded is neutral grey) and no bold exams.
    function weekChip(d, sel) {
      const off = E.isRemovedDate(d);
      const c = el('button', 'wchip' + (off ? ' off' : '') + (d.date < today ? ' past' : ''));
      c.type = 'button';
      c.dataset.id = d.id;
      c.title = d.title || '';
      c.setAttribute('aria-pressed', String(sel));
      const sub = el('span', 'wc-s');
      sub.append(el('i', 'dot'), document.createTextNode(off ? 'Taken off' : dateClock(d) || 'Any time'));
      c.append(el('span', 'wc-t', d.title || ''), sub);
      c.addEventListener('click', () => {
        ui.weekSel = d.id;
        render();
      });
      return c;
    }
    // B-419: a day's tasks as Today's list holds them (EVCore.dayView): its saved plan, when there is one, and what he
    // or E.V. added (dayedits/<date>), less what was taken off; today's are today's list itself.
    function weekTasks(date) {
      if (date === today) {
        const s = dayState();
        return s.items.filter(it => !it.deferred).map(it => ({ ...it, done: s.isDone(it) }));
      }
      if (date > today) {
        // B-483: a later day holds its approved plan tasks too, ticked as the plan is
        const s = dayState(date);
        return s.items.map(it => ({ ...it, done: s.isDone(it) }));
      }
      return E.dayView(dayDoc(date), dayEditDoc(date))
        .items.filter(it => !keptInPlan(it))
        .map(it => ({ ...it, done: !!it.checked }));
    }
    // B-518 (F-27): a day picked in the week opens in view: on the phone its panel sits below the seven days, so the
    // page goes to it once it is drawn; where the panel is beside the week (and on screen) nothing moves.
    function openDay(date) {
      ui.weekSel = 'day:' + date;
      render();
      requestAnimationFrame(() => {
        const p = $('today-date');
        if (!p || p.hidden) return;
        const r = p.getBoundingClientRect();
        if (r.top < 0 || r.top > innerHeight - 120) p.scrollIntoView({ block: 'start' });
      });
    }
    // B-518 (F-26): a day's real load, every task on its list (an approved plan's tasks too) and their minutes, as its
    // panel counts them; it opens the day.
    function dayLoad(tasks) {
      const real = tasks.filter(it => it.tag !== 'EXAM'); // the exam is its own card on the calendar (B-117)
      const open = real.filter(it => !it.done);
      return { all: real.length, open: open.length, mins: open.reduce((n, it) => n + (Number(it.minutes) || 0), 0) };
    }
    function loadChip(date, tasks) {
      const l = dayLoad(tasks);
      if (!l.all) return null;
      const c = el('button', 'wchip wk-load' + (l.open ? '' : ' done'));
      c.type = 'button';
      c.setAttribute('aria-pressed', String(ui.weekSel === 'day:' + date));
      const sub = el('span', 'wc-s');
      sub.append(
        el('i', 'dot'),
        document.createTextNode(l.open ? (l.mins ? durFmt(l.mins) : 'No time set') : 'All done')
      );
      c.append(el('span', 'wc-t', l.open ? plural(l.open, 'task') : plural(l.all, 'task')), sub);
      c.addEventListener('click', () => openDay(date));
      return c;
    }
    const taskSub = it =>
      [(BADGE[it.tag] || [it.tag ? 'Class' : 'To do'])[0], it.minutes ? durFmt(it.minutes) : '']
        .filter(Boolean)
        .join(' · ');
    // B-419: a task added to a day shows on that day as a card; it opens the day's panel
    function taskChip(it, date) {
      const c = el('button', 'wchip wk-task' + (it.done ? ' done' : ''));
      c.type = 'button';
      c.dataset.task = it.id;
      c.title = it.text || '';
      c.setAttribute('aria-pressed', String(ui.weekSel === 'day:' + date));
      const sub = el('span', 'wc-s');
      sub.append(el('i', 'dot'), document.createTextNode(it.done ? 'Done' : taskSub(it)));
      c.append(el('span', 'wc-t', it.text || ''), sub);
      c.addEventListener('click', () => openDay(date));
      return c;
    }
    // B-419: a day opened from the week: its name, when, its tasks (each with its kind, time and who added it) and its
    // calendar dates; today's offers its list.
    function dayPanel(date, entries) {
      const tasks = weekTasks(date);
      const dw = new Date(date + 'T12:00:00Z');
      const title = el(
        'div',
        'wd-title',
        dayName(date) +
          ' ' +
          dw.getUTCDate() +
          ' ' +
          dw.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
      );
      const open = tasks.filter(it => !it.done);
      const mins = open.reduce((n, it) => n + (Number(it.minutes) || 0), 0);
      const props = el('div', 'wd-props');
      for (const [k, v] of [
        ['When', date < today ? 'Past' : relDay(date).replace(/^./, c => c.toUpperCase())],
        [
          'Tasks',
          tasks.length ? open.length + ' open of ' + tasks.length + (mins ? ' · ' + durFmt(mins) : '') : 'None yet',
        ],
      ]) {
        const p = el('div', 'prop');
        p.append(el('span', 'prop-k', k), el('span', 'prop-v', v));
        props.append(p);
      }
      const list = el('div', 'wd-tasks');
      for (const it of tasks) {
        const r = el('div', 'wd-task' + (it.done ? ' done' : ''));
        r.dataset.task = it.id;
        r.append(
          el('span', 'wd-tt', it.text || ''),
          el(
            'span',
            'mini',
            [it.done ? 'Done' : taskSub(it), it.added ? 'added by ' + (it.by === 'Matt' ? 'you' : 'E.V.') : '']
              .filter(Boolean)
              .join(' · ')
          )
        );
        list.append(r);
      }
      if (!tasks.length) list.append(el('span', 'mini', 'Nothing on this day’s list yet.'));
      const out = [el('span', 'badge wd-badge x-quiet', 'Day'), title, props, el('span', 'lab', 'Tasks'), list];
      const dates = entries.filter(x => x.date === date);
      if (dates.length) {
        const cal = el('div', 'wd-cal');
        cal.append(...dates.map(x => weekChip(x, false)));
        out.push(el('span', 'lab', 'On the calendar'), cal);
      }
      if (date <= today) {
        // B-448: an earlier day's list opens too, to check off what was done
        const acts = el('div', 'wd-acts');
        acts.append(
          btn(
            'Open the list',
            () => {
              ui.todayView = 'list';
              store.set('todayView', 'list');
              ui.listDay = date < today ? date : null;
              render();
            },
            { cls: 'btn neutral' }
          )
        );
        out.push(acts);
      }
      return out;
    }
    // B-363 (D-312): with no card picked the week's panel is the demo's: the Next exam card (its name, when, the
    // readiness bar and its words), then Next 7 days (Those 7 days off this week) with the graded and class counts.
    function weekSummary(entries, wk) {
      const out = [];
      const ex = S.exams
        .filter(e => e.date && e.date >= today && e.status !== 'done')
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      if (ex) {
        const objs = S.objectives.filter(x => x.exam === ex.id);
        const st = objs.map(x => objState(x).state);
        const so = st.filter(x => x === 'solid').length,
          al = st.filter(x => x === 'almost').length;
        const card = el('div', 'card wd-next');
        const bar = el('div', 'hb');
        if (objs.length) {
          const g = el('i'),
            y = el('i');
          g.style.cssText = 'background:var(--sem-green);width:' + Math.round((so / objs.length) * 100) + '%';
          y.style.cssText = 'background:var(--sem-yellow);width:' + Math.round((al / objs.length) * 100) + '%';
          bar.append(g, y);
        }
        card.append(
          el('span', 'lab', 'Next exam'),
          el('div', 'wd-nx', ex.title || ex.id),
          el('div', 'mini', short(ex.date) + ' · ' + relDay(ex.date)),
          bar,
          el(
            'span',
            'mini',
            objs.length
              ? so + ' of ' + objs.length + ' objectives solid' + (al ? ', ' + al + ' almost' : '')
              : 'No objectives yet'
          )
        );
        out.push(card);
      }
      const live = entries.filter(d => !E.isRemovedDate(d));
      const first = E.addDays(today, WEEK_DAYS * wk);
      const graded = E.gradedWeek(S.dates, S.exams, first, WEEK_DAYS).length, // B-392: as the banner and her answer
        cls = live.filter(d => !(d.graded || d.kind === 'exam') && d.kind !== 'due').length;
      out.push(el('span', 'lab', wk === 0 ? 'Next 7 days' : 'Those 7 days'));
      for (const [n, v] of [
        ['Graded work and exams', graded],
        ['Classes, labs, clinicals', cls],
      ]) {
        const r = el('div', 'wd-sum');
        const l = el('span', 'wd-sum-l');
        l.append(el('i', 'dot'), document.createTextNode(n));
        r.append(l, el('span', 'mini', String(v)));
        out.push(r);
      }
      return out;
    }
    function renderWeek() {
      const on = ui.todayView === 'week';
      const wk = Number(ui.weekOff) || 0,
        start = E.addDays(today, WEEK_DAYS * wk);
      todayBar.bar.replaceChildren(
        ...(on ? [] : todayBar.list),
        weekSeg,
        ...(on ? [weekNav(start, wk)] : todayBar.nav ? [todayBar.nav] : []),
        el('span', 'sp'),
        ...(on ? [] : todayBar.listEnd),
        todayBar.add
      );
      weekSeg
        .querySelectorAll('button')
        .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === ui.todayView)));
      const main = $('p-today').querySelector('.col-main'),
        side = $('p-today').querySelector('.col-side');
      let box = $('today-week'),
        panel = $('today-date');
      if (!box) {
        box = el('div', 'card');
        box.id = 'today-week';
        box.lang = 'en'; // B-382: lets a word too long for its column hyphenate
        main.append(box);
        panel = el('div', 'wk-panel');
        panel.id = 'today-date';
        side.prepend(panel);
      }
      // the list view's cards step aside in the week, and the week's in the list
      $('today-list').hidden = on;
      for (const c of [$('today-budget'), $('today-changes'), $('weekly')]) if (c) c.classList.toggle('wk-away', on);
      box.hidden = !on;
      if (!on) {
        panel.hidden = true;
        return;
      }
      const entries = weekDates(E.addDays(start, WEEK_DAYS - 1), true, start);
      // B-363: opens on Next exam, as the demo; B-419: a picked day (day:<date>) stays while it is in the week
      const selDay = /^day:/.test(ui.weekSel || '') ? ui.weekSel.slice(4) : null;
      if (
        selDay
          ? !(selDay >= start && selDay <= E.addDays(start, WEEK_DAYS - 1))
          : !entries.some(d => d.id === ui.weekSel)
      )
        ui.weekSel = null;
      const days = el('div', 'wk-days');
      for (let i = 0; i < WEEK_DAYS; i++) {
        const date = E.addDays(start, i);
        const col = el('div', 'wk-day' + (date === today ? ' today' : ''));
        col.dataset.date = date;
        const [, m, dd] = date.split('-');
        // B-419: a day's head opens that day's panel, its tasks ahead of time
        const h = el('button', 'wk-h');
        h.type = 'button';
        h.setAttribute('aria-label', 'Open ' + dayName(date) + ' ' + Number(dd) + ': its tasks');
        h.setAttribute('aria-pressed', String(ui.weekSel === 'day:' + date));
        h.addEventListener('click', () => openDay(date));
        h.append(
          el('span', null, dayName(date).slice(0, 3)),
          el('b', null, String(Number(dd))),
          el(
            'span',
            null,
            i === 0 || dd === '01'
              ? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
              : ''
          )
        );
        const chips = el('div', 'wk-chips');
        const tasks = weekTasks(date);
        if (date === today) {
          const open = sideOpen();
          const n = open.length,
            mins = open.reduce((m, it) => m + (Number(it.minutes) || 0), 0); // B-518: today's load too
          const t = el('button', 'wchip wk-list');
          t.type = 'button';
          const ts = el('span', 'wc-s');
          ts.append(el('i', 'dot'), document.createTextNode(mins ? durFmt(mins) : 'Open the list'));
          t.append(el('span', 'wc-t', n + ' on today’s list'), ts);
          t.addEventListener('click', () => {
            ui.todayView = 'list';
            store.set('todayView', 'list');
            ui.listDay = null;
            render();
          });
          chips.append(t);
        } else {
          const lc = loadChip(date, tasks);
          if (lc) chips.append(lc);
        }
        chips.append(
          ...entries.filter(d => d.date === date).map(d => weekChip(d, d.id === ui.weekSel)),
          ...tasks.filter(it => it.added).map(it => taskChip(it, date))
        );
        col.append(h, chips);
        days.append(col);
      }
      box.replaceChildren(...(wk === 0 ? [el('p', 'wk-her', gradedLine())] : []), days);
      // the picked date's panel
      const d = entries.find(x => x.id === ui.weekSel);
      panel.hidden = false;
      if (ui.weekSel && /^day:/.test(ui.weekSel))
        return panel.replaceChildren(...dayPanel(ui.weekSel.slice(4), entries));
      if (!d) return panel.replaceChildren(...weekSummary(entries, wk));
      // B-349 (D-312): as the demo's TodayWeek board: the badge, the 18 px title, When / Course / Readiness in one card,
      // then Quiz me on it and Open the task stacked; Take off stays for a date that can leave the calendar (D-080).
      const off = E.isRemovedDate(d);
      const prop = (k, v) => {
        const p = el('div', 'prop');
        p.append(el('span', 'prop-k', k), el('span', 'prop-v', v));
        return p;
      };
      const graded = d.graded || d.kind === 'exam';
      const badge = el('span', 'badge wd-badge x-quiet', graded ? 'Graded' : 'Class');
      const title = el('div', 'wd-title', d.title || '');
      const clock = dateClock(d);
      const dw = new Date(d.date + 'T12:00:00Z');
      const day =
        dw.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) +
        ' ' +
        dw.getUTCDate() +
        ' ' +
        dw.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
      const when = day + (clock ? ', ' + clock : '') + ' · ' + relDay(d.date);
      const o = !off && dateObjective(d);
      let statLab = 'Readiness',
        stat = 'Upcoming';
      if (d.date < today) ((statLab = 'Result'), (stat = 'Done'));
      else if (d.kind === 'exam') {
        const ex = S.exams.find(e => 'exam-' + e.id === d.id || (e.date === d.date && E.courseOf(e) === E.courseOf(d)));
        const objs = ex ? S.objectives.filter(x => x.exam === ex.id) : [];
        if (objs.length) {
          const st = objs.map(x => objState(x).state);
          const so = st.filter(x => x === 'solid').length,
            al = st.filter(x => x === 'almost').length;
          stat = so + ' of ' + objs.length + ' objectives solid' + (al ? ', ' + al + ' almost' : '');
        }
      } else if (o) stat = { solid: 'Solid', almost: 'Almost', notyet: 'Not yet' }[objState(o).state] || stat;
      const props = el('div', 'wd-props');
      props.append(prop('When', when), prop('Course', E.courseOf(d) || '—'), prop(statLab, stat));
      if (off) props.append(prop('Status', 'Taken off by ' + (d.removed.by === 'Matt' ? 'you' : 'E.V.')));
      const acts = el('div', 'wd-acts');
      if (o) {
        const q = btn('Quiz me on it', ev => quizObjective(o, ev.currentTarget), { cls: 'btn neutral' });
        q.setAttribute('aria-label', 'Quiz me on ' + (o.text || o.id));
        acts.append(q);
      }
      const it = !off && dateTask(d);
      if (it)
        acts.append(
          btn(
            'Open the task',
            () => {
              ui.todayView = 'list';
              store.set('todayView', 'list');
              ui.listDay = null;
              ui.taskSel = it.id;
              ui.taskGone = null;
              render();
              const li = document.querySelector('#today-list li[data-id="' + CSS.escape(it.id) + '"]');
              if (li) li.scrollIntoView({ block: 'nearest' });
            },
            { cls: 'btn neutral' }
          )
        );
      const t = !/^exam-/.test(d.id) && dateEditButton(d, 'Take off', 'btn ghost wk-off');
      if (t) acts.append(t);
      panel.replaceChildren(badge, title, props, ...(acts.children.length ? [acts] : []));
    }
    // The exam leaves the tick list for Next 7 days (B-117): exams in the window join the calendar's dates, once each.
    // B-295: the week view asks for its seven days, with the dates taken off (their chips can bring them back).
    function weekDates(last = E.addDays(today, 7), withRemoved = false, first = today) {
      const inWeek = d => d.date >= first && d.date <= last;
      const examDates = S.exams
        .filter(e => e.date && inWeek(e) && !S.dates.some(d => d.kind === 'exam' && d.date === e.date))
        .map(e => ({ id: 'exam-' + e.id, date: e.date, title: e.title || e.id, kind: 'exam', course: E.courseOf(e) }));
      return [...(withRemoved ? S.datesAll || S.dates : S.dates).filter(inWeek), ...examDates].sort(
        (a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(b.title)
      );
    }
    // B-223 (D-245, D-294), B-290: Coming up, in the Conversation's right panel under the session card: the dates after
    // today that the sidebar doesn't already show (its Today rows can carry tomorrow's graded work), absent when there
    // are none. It lives in her side column; CSS shows it from 1200 px only, while no surface is open.
    function renderEvDates(week) {
      const side = $('ev-side');
      if (!side) return;
      const inSide = new Set(sideShown().map(it => it.ref));
      const after = week.filter(
        d =>
          d.date > today && !inSide.has('dates/' + d.id) && !inSide.has('exams/' + String(d.id).replace(/^exam-/, ''))
      );
      let card = $('ev-dates');
      if (!after.length) {
        if (card) card.remove();
        return;
      }
      if (!card) {
        card = el('div', 'card ev-dates rest');
        card.id = 'ev-dates';
        side.append(card);
      }
      const ul = el('ul', 'list');
      ul.append(...after.slice(0, 4).map(evDateRow)); // B-362 (D-316): the demo's four rows, each opening its day
      card.replaceChildren(el('h2', null, 'Coming up'), ul);
    }
    /** Remove (or Take off) and Bring back for a date that can leave the calendar (D-080); null for one that can't. */
    function dateEditButton(d, label, cls) {
      const off = E.isRemovedDate(d);
      if (!off && E.isFixedDate(d)) return null;
      // B-382: Bring back is a real button, as the demo's neutral one, wherever the date shows
      const b = btn(off ? 'Bring back' : label, null, { cls: off ? cls.replace(/\bghost\b/, 'neutral') : cls });
      b.setAttribute('aria-label', (off ? 'Bring back: ' : label + ' from the calendar: ') + (d.title || ''));
      b.addEventListener('click', () =>
        guard(
          b,
          () => editDates({ action: off ? 'restore' : 'remove', id: d.id }, 'Matt'),
          off ? 'Back on the calendar' : 'Taken off the calendar'
        )
      );
      return b;
    }
    function dateRow(d, o = {}) {
      // o.edit: Remove (or Bring back) for entries that can leave the calendar (D-080)
      const kindV = { exam: 'bad', validation: 'warn', clinical: 'ok', due: 'info' }[d.kind] || '';
      const off = E.isRemovedDate(d);
      const by = w => (w === 'Matt' ? 'you' : 'E.V.');
      const action = o.edit ? dateEditButton(d, 'Remove', 'btn ghost sm') : null;
      const detail = [
        d.graded ? 'graded' : '', // B-303 (D-276): the kind is the row's one badge
        d.course && d.course !== E.defaultCourse() ? d.course : '',
        d.notes,
        off ? 'taken off by ' + by(d.removed.by) : '',
        o.edit && d.addedBy ? 'added by ' + by(d.addedBy) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return row({
        lead: short(d.date),
        title: d.title || '',
        detail,
        chips: d.kind ? [[d.kind.charAt(0).toUpperCase() + d.kind.slice(1), kindV]] : [],
        action,
      });
    }

