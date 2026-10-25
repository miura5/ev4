    // ------------------------------------------------------------ Today
    // the same plan the 4:25am run builds, from the record as it stands now (liveDay, and B-293's Plan the rest)
    function planNow() {
      return E.planDay({
        // B-68: the scheduler the morning uses (spec.study.scheduler), so a live day agrees with it
        pickReviews: window.EVStudy.picker(E, window.EVStudy.schedulerOf(EV_SPEC), EV_SPEC),
        date: today,
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
      const p = S.plans.find(x => x.id === m[1]);
      if (!p) return null;
      const t = E.planTasks(p).find(t => t.id === m[2]);
      return t ? { plan: p, task: t } : null;
    }
    function dayState() {
      // the planned list (saved at 4:25am, else built live) plus what he or E.V. added or took off (D-078)
      const day = M.day && M.day.list ? M.day : liveDay();
      const v = E.dayView(day, M.dayedit);
      const checks = (M.dayedit && M.dayedit.checks) || {};
      const isDone = it => {
        const pt = planTaskById(it.ref);
        if (pt) return E.taskDone(pt.plan, { ...pt.task }, today, S.sets, S.answers);
        return !!checks[it.id];
      };
      return { day, items: v.items, isDone, budget: v.budget, skipped: v.skipped };
    }
    const dayDoc = date => S.days.find(d => d.id === date) || null;
    const dayEditDoc = date => S.dayedits.find(d => d.id === date) || null;
    const writeDayEdit = (date, data) => write({ op: 'set', collection: 'dayedits', id: date, data }); // an Edit: replaced whole
    async function editList(date, edit, by) {
      // one add / remove / restore through EVCore.listEdit; today's planned items may be live
      const base = date === today ? dayState().day : dayDoc(date) || { date };
      const r = E.listEdit(base, dayEditDoc(date), edit, { now: now(), by, date });
      if (r.doc) await writeDayEdit(date, r.doc);
      return r;
    }
    function reviewState() {
      const rs = S.sets.find(s => s.id === 'review-' + today);
      const items = rs ? E.validItems(rs) : [];
      return { rs, total: items.length, left: items.filter(q => !answersOf(rs)[q.id]).length };
    }
    function tickWrite(it, on) {
      const pt = planTaskById(it.ref);
      if (pt) return tickPlan(pt.plan, pt.task, on);
      return editList(today, { action: 'check', id: it.id, done: on }, 'Matt');
    }
    function tickPlan(plan, task, on) {
      // planedits/<exam id>: the page's ticks, replaced whole
      const examId = plan.exam || plan.id;
      const pe = S.planedits.find(x => x.id === examId) || null;
      const r = E.planTick(pe, examId, task.id, { done: on, now: now(), by: 'Matt' });
      return write({ op: 'set', collection: 'planedits', id: r.id, data: r.data });
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
      GRADED: 'bad',
      EXAM: 'accent',
      REVIEW: 'plum',
      'ATI REVIEW': 'plum',
      PRACTICE: 'info',
      READING: 'ok',
      CLINICAL: 'ok',
      'CLINICAL PREP': 'ok',
      VALIDATION: 'warn',
      'VALIDATION PREP': 'warn',
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
      READING: ['Reading', ''],
      NOTES: ['Notes', 'x-blue'],
      CANVAS: ['Canvas', 'x-blue'],
      CLINICAL: ['Clinical', ''],
      'CLINICAL PREP': ['Clinical prep', ''],
      VALIDATION: ['Validation', ''],
      'VALIDATION PREP': ['Validation prep', ''],
      GRADED: ['Graded', ''],
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
    // B-296 (C-10): the name opens the task's panel (the right panel from 1200 px, under the pane below it)
    // B-343 (D-312): on the phone (under 600 px) the opened task takes the view in place of the list, as the demo's
    // TaskDetail board at 390: a back arrow before the header's "Today" closes it and returns to the list where it was.
    const phone = () => innerWidth < 600;
    function openTask(id) {
      if (phone() && !(ui.taskSel && !ui.taskGone)) ui.taskScroll = window.scrollY;
      ui.taskSel = id; // Close closes it; a second tap on the name leaves it open
      ui.taskGone = null;
      render();
      const p = $('today-task');
      if (p && !p.hidden && phone()) window.scrollTo(0, 0);
      else if (p && !p.hidden && innerWidth < 1200) p.scrollIntoView({ block: 'nearest' });
    }
    function closeTask() {
      ui.taskSel = null;
      ui.taskGone = null;
      render();
      if (phone()) window.scrollTo(0, ui.taskScroll || 0);
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
      // a tab tapped on the phone leaves the task: Today comes back as its list
      for (const tab of document.querySelectorAll('[data-tab]'))
        tab.addEventListener('click', () => {
          if (phone() && ui.taskSel) {
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
      const text = String(it.text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '');
      const sel = ui.taskSel === it.id && !ui.taskGone;
      const li = el(
        'li',
        'li today-item' + (doneNow ? ' done' : '') + (sel ? ' sel' : '') + (o.off ? ' ti-propose' : '')
      );
      li.dataset.id = it.id;
      const tk = el('label', 'tk');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.className = 'tick';
      c.checked = c.defaultChecked = doneNow;
      c.setAttribute('aria-label', 'Done: ' + text);
      c.addEventListener('change', () => {
        T.ticked.add(it.id);
        guard(c, () => tickWrite(it, c.checked), c.checked ? 'Checked off' : 'Unchecked');
      });
      tk.append(c);
      const nm = el('button', 'nm ti-nm');
      nm.type = 'button';
      nm.append(el('span', 'ti-t', text));
      nm.setAttribute('aria-controls', 'today-task');
      nm.setAttribute('aria-expanded', String(sel));
      nm.addEventListener('click', () => openTask(it.id));
      // B-343: on the phone a tap anywhere on the row's free space opens the task, as the name does
      if (!o.off)
        li.addEventListener('click', e => {
          if (phone() && !e.target.closest('button, label, input, a')) openTask(it.id);
        });
      li.append(tk, nm);
      const due = it.tag === 'GRADED' ? gradedDue(it) : null;
      const b = BADGE[it.tag];
      // B-293 (C-9): a proposed take-off keeps its row, with one "Proposed" badge and Accept and Keep in place of Start
      if (o.off)
        li.append(
          el('span', 'badge proposed', 'Proposed'),
          ...restButtons(o.off.P, o.off.p, offEdit(o.off.p), 'take “' + text + '” off today')
        );
      else if (b) {
        const red = due && !doneNow && due <= E.addDays(today, 1);
        li.append(el('span', 'badge' + (red ? ' x-red' : b[1] ? ' ' + b[1] : ''), b[0]));
      }
      const go = openItem(it);
      if (o.start && go && !o.off) {
        const st = btn('Start', go, { cls: 'btn neutral sm ti-start' });
        st.setAttribute('aria-label', 'Start: ' + text);
        li.append(st);
      }
      const when = doneNow
        ? 'Done'
        : it.minutes
          ? it.minutes + ' min'
          : due
            ? due === today
              ? 'Today'
              : due === E.addDays(today, 1)
                ? 'Tomorrow'
                : short(due)
            : '';
      li.append(el('span', 't', when));
      return li;
    }
    // A row that can start: not done, not graded, not over the budget, and something to open (a review or practice set).
    const startable = (it, isDone) => !isDone(it) && !it.deferred && it.tag !== 'GRADED' && !!openItem(it);
    // A fold under the list: one line that opens in place to its rows (D-276).
    function todayFold(key, label, rows, open) {
      const f = el('button', 'fold-line ti-fold');
      f.type = 'button';
      f.textContent = label;
      f.setAttribute('aria-expanded', String(!!open));
      const ul = el('ul', 'list ti-folded');
      ul.hidden = !open;
      ul.append(...rows);
      f.addEventListener('click', () => {
        ui.todayFolds = { ...(ui.todayFolds || {}), [key]: !open };
        render();
      });
      return [f, ul];
    }
    function itemRow(it, isDone) {
      const doneNow = isDone(it);
      const go = openItem(it);
      const detail = [
        it.note,
        it.minutes ? '~' + it.minutes + ' min' : '',
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
            guard(c, () => tickWrite(it, on), on ? 'Checked off' : 'Unchecked');
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
        prop('On the list', `${bv.planned} min · ${plural(nOpen, 'item')}`),
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
        card = el('div', 'card');
        card.id = 'today-changes';
        const budget = $('today-budget');
        budget ? budget.after(card) : document.querySelector('#p-today .col-side').prepend(card);
      }
      const ch = evChanges();
      card.hidden = !ch.length; // D-151: absent while she has changed nothing today
      if (!ch.length) return card.replaceChildren();
      const ul = el('ul', 'list');
      for (const c of ch) {
        const text = String(c.text).replace(/\s*\(~?\d+\s*min\)\s*$/i, '');
        const title = c.kind === 'add' ? `Added “${text}” to today` : `Took “${text}” off today`;
        const undo = btn('Undo', null, { cls: 'btn ghost sm' });
        undo.setAttribute('aria-label', 'Undo: ' + title);
        undo.addEventListener('click', () =>
          guard(undo, () => editList(today, c.undo, 'Matt'), c.kind === 'add' ? 'Taken off today' : 'Back on today')
        );
        const li = row({ title, detail: clock12(c.at), action: undo, cls: 'chg' });
        li.dataset.id = c.id;
        ul.append(li);
      }
      card.replaceChildren(el('h2', null, 'E.V.’s changes today'), ul);
    }
    /**
     * B-296 (C-10, D-282): the task's panel, first in the side column (the right panel from 1200 px, under the pane
     * below it). Its name, then status, category, estimate, due, course and topic; "Where it came from" says who put it
     * on the list and when, with the planner's note. Start is its one primary, only when the task can start and never on
     * graded work. Snooze to tomorrow (tomorrow's add, then today's take-off) and Remove from today (the take-off) are
     * the list edits D-078 already has; each leaves an Undo here that reverses what it wrote. No full-page view, no
     * previous and next, no description paragraph.
     */
    const LIST_KIND_OF = { READING: 'reading', PRACTICE: 'practice', REVIEW: 'review', NOTES: 'notes' };
    const fixedItem = it => FIXED.has(it.tag) || /^(date|exam|soon)-/.test(String(it.id || ''));
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
        '';
      const topics = [...new Set((set && set.items ? set.items : []).map(q => q.topic).filter(Boolean))];
      const topic =
        (ws && ws.topic) ||
        (pt && pt.task.chapters && pt.task.chapters.length ? 'Chapter ' + pt.task.chapters.join(', ') : '') ||
        (topics.length ? topics.slice(0, 2).join(', ') + (topics.length > 2 ? ' and more' : '') : '');
      const due = it.tag === 'GRADED' ? gradedDue(it) : today;
      const b = BADGE[it.tag];
      const by = w => (w === 'Matt' ? 'you' : 'E.V.');
      const from = add
        ? 'Added by ' +
          by(add.by || it.by) +
          (add.at ? (E.chicagoDate(add.at) === today ? ' at ' : ' ') + clock12(add.at) : '')
        : day.live
          ? 'Built live from your record'
          : 'Planned by the 4:25am run' + (day.at && E.chicagoDate(day.at) === today ? ' at ' + clock12(day.at) : '');
      const note = [
        it.note && it.note !== 'Graded' && !add ? it.note : '',
        exam ? 'From the ' + (exam.title || exam.id) + ' plan' : '',
        it.deferred ? 'Deferred: over today’s budget' : '',
      ].filter(Boolean);
      return {
        status: isDone(it) ? 'Done' : it.deferred ? 'Deferred' : 'To do',
        category: b ? b[0] : it.tag === 'EXAM' ? 'Exam' : 'Task',
        badge: b && b[1] && it.tag !== 'GRADED' ? b[1] : '',
        estimate: it.minutes ? it.minutes + ' min' : '',
        due: due
          ? due === today
            ? 'Today'
            : due === E.addDays(today, 1)
              ? 'Tomorrow'
              : short(due) + ' · ' + relDay(due)
          : '',
        course,
        topic,
        from: [from, ...note].join(' · '),
      };
    }
    async function snoozeTask(it) {
      // tomorrow's add first, so a refused write leaves today's list as it was
      const tomorrow = E.addDays(today, 1),
        ed = dayEditDoc(today) || {},
        add = it.added ? { ...(ed.added || {})[it.id] } : null;
      const text = String(it.text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '');
      const a = await editList(
        tomorrow,
        {
          action: 'add',
          text,
          kind: (add && add.kind) || LIST_KIND_OF[it.tag] || 'todo',
          minutes: Number(it.minutes) || 0,
          course: (add && add.course) || taskFacts(it, () => false, dayState().day).course,
        },
        'Matt'
      );
      try {
        await editList(today, { action: 'remove', id: it.id }, 'Matt');
      } catch (e) {
        // today's take-off refused: tomorrow's add goes again, so the task is never on both lists
        if (a.doc) await editList(tomorrow, { action: 'remove', id: a.id }, 'Matt').catch(() => {});
        throw e;
      }
      return { tomorrowId: a.doc ? a.id : null, add };
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
          gone.add.by || 'Matt'
        );
      else await editList(today, { action: 'restore', id: it.id }, 'Matt');
      if (gone.tomorrowId) await editList(E.addDays(today, 1), { action: 'remove', id: gone.tomorrowId }, 'Matt');
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
      const G = ui.taskGone;
      const it = G ? G.it : items.find(x => x.id === ui.taskSel);
      if (!it) ui.taskSel = null;
      panel.hidden = !it || ui.todayView === 'week';
      // B-336 (D-312): an opened task is the panel's only card; the others step aside until it closes
      for (const c of panel.parentNode.children)
        if (c !== panel) c.classList.toggle('tk-away', !panel.hidden);
      // B-343: the phone shows the task alone, with the header's back arrow
      $('p-today').classList.toggle('tk-open', !panel.hidden);
      document.body.classList.toggle('task-open', !panel.hidden);
      if (!it) {
        panel.dataset.k = '';
        return panel.replaceChildren();
      }
      // drawn again only when what it shows changes, so a tap on its buttons is never lost to a redraw
      const f = G ? null : taskFacts(it, isDone, day);
      const k = JSON.stringify([it.id, it.text, G && G.line, f, isDone(it), startable(it, isDone), !!openItem(it)]);
      if (panel.dataset.k === k && panel.firstChild) return;
      panel.dataset.k = k;
      const text = String(it.text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '');
      const close = btn('Close', closeTask, { cls: 'btn ghost sm tp-close' });
      close.setAttribute('aria-label', 'Close the task');
      const head = el('div', 'card-head');
      head.append(el('h2', null, text), close);
      if (G) {
        // what Snooze or Remove just wrote, and its Undo
        const undo = btn('Undo', null, { cls: 'btn neutral sm tp-undo' });
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
        return panel.replaceChildren(head, el('p', 'meta tp-gone', G.line), acts);
      }
      const prop = (k, v) => {
        const p = el('div', 'prop');
        p.append(el('span', 'prop-k', k), el('span', 'prop-v', v));
        return p;
      };
      // B-336 (D-312): the properties in one card, as the demo's 'a task opened' board; Status is a To do / Done switch
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
          guard(b, () => tickWrite(it, v), v ? 'Checked off' : 'Unchecked');
        });
        sw.append(b);
      }
      status.lastChild.append(sw);
      const cat = prop('Category', '');
      cat.lastChild.append(el('span', 'badge' + (f.badge ? ' ' + f.badge : ''), f.category));
      props.append(status, cat);
      if (f.estimate) props.append(prop('Estimate', f.estimate));
      if (f.due) props.append(prop('Due', f.due));
      if (f.course) props.append(prop('Course', f.course));
      if (f.topic) props.append(prop('Topic', f.topic));
      const from = el('div', 'tp-from');
      from.append(el('span', 'prop-k', 'Where it came from'), el('p', 'meta', f.from));
      const acts = el('div', 'wk-acts');
      const go = openItem(it);
      if (go && startable(it, isDone)) {
        const st = btn('Start', go, { cls: 'btn primary wide tp-start' });
        st.setAttribute('aria-label', 'Start: ' + text);
        acts.append(st);
      } else if (go && it.tag !== 'GRADED') {
        // a set that can't start now (done, or over the budget) still opens where it lives
        const op = btn('Open', go, { cls: 'btn neutral wide tp-open' });
        op.setAttribute('aria-label', 'Open: ' + text);
        acts.append(op);
      }
      if (!fixedItem(it) && !isDone(it)) {
        const gone = (line, w) => {
          ui.taskGone = { it, line, ...w };
          render();
        };
        const sz = btn('Snooze to tomorrow', null, { cls: 'btn neutral wide tp-snooze' });
        sz.addEventListener('click', () =>
          guard(sz, async () => gone('Moved to tomorrow’s list.', await snoozeTask(it)), 'Moved to tomorrow')
        );
        const rm = btn('Remove from today', null, { cls: 'btn ghost wide tp-remove' });
        rm.addEventListener('click', () =>
          guard(
            rm,
            async () => {
              const add = it.added ? { ...((dayEditDoc(today) || {}).added || {})[it.id] } : null;
              await editList(today, { action: 'remove', id: it.id }, 'Matt');
              gone('Taken off today.', { tomorrowId: null, add });
            },
            'Taken off today'
          )
        );
        acts.append(sz, rm);
      }
      // graded work: the one line the demo carries, since E.V. helps him prepare and never with the work (B-01)
      const graded =
        it.tag === 'GRADED'
          ? [el('p', 'meta tp-note', 'Graded work: E.V. helps you prepare, never with the work itself.')]
          : [];
      const note = graded.length
        ? graded
        : acts.querySelector('.tp-snooze')
          ? [el('p', 'meta tp-note', 'Snooze moves it to tomorrow, with Undo.')]
          : [];
      panel.replaceChildren(head, props, ...(acts.children.length ? [acts] : []), ...note, from);
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
          why: b ? 'over today’s budget' : moved ? 'planned for ' + E.shortDate(moved) : 'no longer in the plan',
        });
      }
      // the time left once the take-offs go: the budget less what stays planned (done or not, as budgetView counts it)
      let room = budget ? budget.available - (budget.planned - offs.reduce((n, o) => n + o.minutes, 0)) : Infinity;
      const adds = [];
      for (const b of fresh.blocks) {
        if (!b.taskId || b.required || b.deferred || b.done || onList.has(b.id) || planned.has(b.id)) continue;
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
      return { date: today, adds, offs };
    }
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
      const ok = btn('Accept', null, { cls: 'btn neutral sm ti-acc' });
      ok.setAttribute('aria-label', 'Accept: ' + noun);
      ok.addEventListener('click', () =>
        guard(ok, () => restAccept(P, { p, edit }), 'Done. E.V. changed today’s list')
      );
      const keep = btn('Keep', null, { cls: 'btn ghost sm ti-keep' });
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
      const li = el('li', 'li today-item ti-prop ti-propose');
      li.dataset.id = p.id;
      li.append(el('span', 'tk ti-gap'));
      const nm = el('span', 'nm ti-nm');
      nm.append(el('span', 'ti-t', p.text));
      li.append(
        nm,
        el('span', 'badge proposed', 'Proposed'),
        ...restButtons(P, p, restEdit(p), 'add “' + p.text + '” to today')
      );
      li.append(el('span', 't', p.minutes ? p.minutes + ' min' : ''));
      return li;
    }
    function restLine(P) {
      const parts = [
        ...P.adds.map(p => `add “${p.text}”` + (p.minutes ? ` (${p.minutes} min)` : '')),
        ...P.offs.map(p => `take “${p.text}” off today (${p.why})`),
      ];
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
        el('p', 'ti-review-t', 'E.V. suggests: ' + parts.join(', and ') + '. Nothing changes until you accept.'),
        all,
        no
      );
      return line;
    }
    // B-335 (D-312): the demo's filter, All / Classes / Study with the count of open rows in each. Study is the work on
    // weak spots and practice (review, practice, notes); everything else on the list is the classes' own.
    const STUDY_TAGS = new Set(['REVIEW', 'ATI REVIEW', 'PRACTICE', 'NOTES']);
    const catOf = it => (STUDY_TAGS.has(it.tag) ? 'study' : 'class');
    const FILTERS = [
      ['all', 'All'],
      ['class', 'Classes'],
      ['study', 'Study'],
    ];
    function renderToday() {
      const { day, items, isDone, budget, skipped } = dayState();
      // B-291 (D-286): no Now card; the prep check is under her greeting and the exam countdown on Study.
      // List
      const box = $('today-list');
      // B-292 (C-5): the day's budget as what's left against the time left; the side card holds the bar and the rows
      const bv = budgetView(budget, items, isDone);
      renderChanges(); // B-294
      renderTask(items, isDone, day); // B-296
      // B-293 (C-9): Plan the rest, in the toolbar; its proposal waits here until he accepts, keeps or rejects it
      if (ui.restPlan && ui.restPlan.date !== today) ui.restPlan = null;
      const P = ui.restPlan;
      const rest = btn('Plan the rest', null, { cls: 'btn neutral sm ti-rest', disabled: !!P });
      rest.prepend(svgIcon('M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z'));
      rest.addEventListener('click', () => {
        const np = restProposal();
        if (!np.adds.length && !np.offs.length) return toast('Nothing to change: today’s list already fits the plan.');
        ui.restPlan = np;
        render();
      });
      // B-291: the open rows, then Done, then "Deferred: over today's budget" and "Taken off today" folded under the list.
      // A row he ticks on this visit stays where it is (rule 6); only rows done before it sit in Done.
      const shown = items.filter(i => i.tag !== 'EXAM'); // the exam is on the week (B-117)
      const inDone = it => isDone(it) && !T.ticked.has(it.id);
      const f = FILTERS.some(x => x[0] === ui.todayFilter) ? ui.todayFilter : 'all';
      const inF = it => f === 'all' || catOf(it) === f;
      const open = shown.filter(it => !inDone(it) && !it.deferred);
      const todo = open.filter(inF),
        done = shown.filter(it => inDone(it) && inF(it)),
        later = shown.filter(it => !inDone(it) && it.deferred);
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
      todayBar.listEnd = [rest];
      const offOf = it => P && P.offs.find(p => p.id === it.id);
      const first = todo.find(it => startable(it, isDone) && !offOf(it));
      const ul = el('ul', 'list ti-list');
      for (const it of todo) {
        const p = offOf(it);
        ul.append(todayRow(it, isDone, { start: it === first, off: p ? { P, p } : null }));
      }
      if (P) for (const p of P.adds) ul.append(proposedAddRow(P, p));
      const folds = ui.todayFolds || {};
      const kids = [...(P ? [restLine(P)] : [])];
      const after = [];
      if (todo.length || (P && P.adds.length)) kids.push(ul);
      else if (shown.length && f !== 'all')
        kids.push(el('p', 'empty', 'Nothing open in ' + FILTERS.find(x => x[0] === f)[1] + ' on today’s list.'));
      else if (!shown.length)
        kids.push(
          el(
            'p',
            'empty',
            'Nothing planned for today yet. The 4:25am run builds the list; add your own with New or ask E.V.'
          )
        );
      if (done.length)
        after.push(
          ...todayFold(
            'done',
            'Done · ' + done.length,
            done.map(it => todayRow(it, isDone)),
            folds.done !== false
          )
        );
      const deferred = ((day.plan && day.plan.deferred) || []).filter(d => d.kind !== 'weakspot');
      const deferredWs = ((day.plan && day.plan.deferred) || []).filter(d => d.kind === 'weakspot');
      const dRows = [
        ...later.map(it => todayRow(it, isDone)),
        ...deferred.filter(d => !later.some(it => it.text === d.title)).map(d => row({ title: d.title })),
        ...(deferredWs.length
          ? [row({ title: plural(deferredWs.length, 'weak spot') + ' over today’s review load' })]
          : []),
      ];
      if (dRows.length)
        after.push(
          ...todayFold('deferred', 'Deferred: over today’s budget · ' + dRows.length, dRows, !!folds.deferred)
        );
      if (skipped.length) {
        const sRows = skipped.map(x => row({ title: x.text }));
        sRows.push(row({ title: 'Ask E.V. to put one back.', cls: 'ti-hint' }));
        after.push(...todayFold('off', 'Taken off today · ' + skipped.length, sRows, !!folds.off));
      }
      if (day.live) after.push(el('p', 'meta ti-live', 'Built live from your record. The 4:25am run saves the day’s plan.'));
      // B-287 (C-7): no Add row; the header's New is the one way to put a task on today's list
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
          ...(wk.health && wk.health.recap ? [el('p', 'meta wk-recap', wk.health.recap)] : []),
          btn('Write a reflection', () => {
            showTab('record');
            $('seg-record').querySelector('[data-v="journal"]').click();
            $('j-kind').value = 'weekly';
            $('j-text').focus();
          })
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
      return { bar, list: [], listEnd: [] };
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
      const label = d0 + (m0 !== m1 ? ' ' + WK_MON[m0 - 1] : '') + ' – ' + d1 + ' ' + WK_MON[m1 - 1] + (wk === 0 ? ' · next 7 days' : '');
      nav.append(prev, now, next, el('span', 'mini wk-range', label));
      return nav;
    }
    const dayName = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    function gradedLine(entries) {
      const g = entries.filter(d => d.graded && !E.isRemovedDate(d));
      const n = g.length;
      const head =
        (n === 1
          ? 'One graded date'
          : (['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n] || String(n)) +
            ' graded dates') + ' in the next 7 days';
      if (!n) return head + '.';
      const each = g.map(
        d =>
          d.title +
          (d.date === today ? ' today' : d.date === E.addDays(today, 1) ? ' tomorrow' : ' on ' + dayName(d.date))
      );
      return head + ': ' + (each.length > 1 ? each.slice(0, -1).join(', ') + ' and ' + each.at(-1) : each[0]) + '.';
    }
    const relDay = d => {
      const n = Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5);
      return n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days';
    };
    const KIND_NAME = { due: 'Due', exam: 'Exam', validation: 'Validation', clinical: 'Clinical', other: 'Date' };
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
      return ex ? objs.find(o => objState(o).state !== 'solid') || objs[0] || null : null;
    }
    function dateTask(d) {
      // the item on today's list that carries this date
      const ref = /^exam-/.test(d.id) ? 'exams/' + d.id.slice(5) : 'dates/' + d.id;
      return dayState().items.find(it => it.ref === ref) || null;
    }
    function weekChip(d, sel) {
      const off = E.isRemovedDate(d);
      const urgent = d.graded && !off && d.date <= E.addDays(today, 1);
      const c = el('button', 'wchip' + (off ? ' off' : '') + (d.kind === 'exam' ? ' exam' : ''));
      c.type = 'button';
      c.dataset.id = d.id;
      c.title = d.title || '';
      c.setAttribute('aria-pressed', String(sel));
      const sub = off
        ? 'Taken off'
        : [KIND_NAME[d.kind] || 'Date', d.graded ? 'graded' : ''].filter(Boolean).join(', ');
      c.append(el('span', 'wc-t', d.title || ''), el('span', 'wc-s' + (urgent ? ' urgent' : ''), sub));
      c.addEventListener('click', () => {
        ui.weekSel = d.id;
        render();
      });
      return c;
    }
    function renderWeek() {
      const on = ui.todayView === 'week';
      const wk = Number(ui.weekOff) || 0,
        start = E.addDays(today, WEEK_DAYS * wk);
      todayBar.bar.replaceChildren(
        ...(on ? [] : todayBar.list),
        weekSeg,
        ...(on ? [weekNav(start, wk)] : []),
        el('span', 'sp'),
        ...(on ? [] : todayBar.listEnd)
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
        main.append(box);
        panel = el('div', 'wk-panel');
        panel.id = 'today-date';
        side.prepend(panel);
      }
      // the list view's cards step aside in the week, and the week's in the list
      $('today-list').hidden = on;
      for (const c of [$('today-budget'), $('today-changes'), $('weekly')])
        if (c) c.classList.toggle('wk-away', on);
      box.hidden = !on;
      if (!on) {
        panel.hidden = true;
        return;
      }
      const entries = weekDates(E.addDays(start, WEEK_DAYS - 1), true, start);
      if (!entries.some(d => d.id === ui.weekSel)) ui.weekSel = (entries[0] || {}).id || null;
      const days = el('div', 'wk-days');
      for (let i = 0; i < WEEK_DAYS; i++) {
        const date = E.addDays(start, i);
        const col = el('div', 'wk-day' + (date === today ? ' today' : ''));
        col.dataset.date = date;
        const [, m, dd] = date.split('-');
        const h = el('div', 'wk-h');
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
        if (date === today) {
          const n = sideOpen().length;
          const t = el('button', 'wchip wk-list');
          t.type = 'button';
          t.append(el('span', 'wc-t', n + ' on today’s list'), el('span', 'wc-s', 'Open the list'));
          t.addEventListener('click', () => {
            ui.todayView = 'list';
            store.set('todayView', 'list');
            render();
          });
          chips.append(t);
        }
        chips.append(...entries.filter(d => d.date === date).map(d => weekChip(d, d.id === ui.weekSel)));
        col.append(h, chips);
        days.append(col);
      }
      box.replaceChildren(...(wk === 0 ? [el('p', 'wk-her', gradedLine(entries))] : []), days);
      // the picked date's panel
      const d = entries.find(x => x.id === ui.weekSel);
      panel.hidden = !d;
      if (!d) return panel.replaceChildren();
      // B-349 (D-312): as the demo's TodayWeek board: the badge, the 18 px title, When / Course / Readiness in one card,
      // then Quiz me on it and Open the task stacked; Take off stays for a date that can leave the calendar (D-080).
      const off = E.isRemovedDate(d);
      const prop = (k, v) => {
        const p = el('div', 'prop');
        p.append(el('span', 'prop-k', k), el('span', 'prop-v', v));
        return p;
      };
      const graded = d.graded || d.kind === 'exam';
      const red = graded && !off && d.date >= today && d.date <= E.addDays(today, 1);
      const badge = el('span', 'badge wd-badge' + (red ? ' x-red' : ''), graded ? 'Graded' : 'Class');
      const title = el('div', 'wd-title', d.title || '');
      let clock = '';
      if (d.dueAt) {
        const t = new Date(d.dueAt);
        if (!isNaN(t))
          clock = t
            .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
            .toLowerCase();
      }
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
      if (d.date < today) (statLab = 'Result'), (stat = 'Done');
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
      ul.append(...after.map(weekRow));
      card.replaceChildren(el('h2', null, 'Coming up'), ul);
    }
    // B-117: a date in Next 7 days is one line (its day, its title, its kind in grey); a clinical, lab, validation or class
    // day carries the calm Prep marker (D-143); red only for graded work due today (D-270). It opens Record's Dates.
    function weekRow(d) {
      const li = el('li', 'row week-item');
      const b = el('button', 'wk-line');
      b.type = 'button';
      b.append(el('span', 'when', short(d.date)), el('span', 'wk-t', d.title || ''));
      if (E.prepKindOf(d)) b.append(el('span', 'bi-prep', 'Prep'));
      const urgent = d.graded && d.date === today && d.kind !== 'exam';
      b.append(
        el(
          'span',
          'wk-k' + (urgent ? ' urgent' : ''),
          urgent
            ? 'graded, due today'
            : [d.kind === 'other' ? '' : d.kind, d.graded ? 'graded' : ''].filter(Boolean).join(' · ')
        )
      );
      b.addEventListener('click', () => {
        showTab('record');
        $('seg-record').querySelector('[data-v="dates"]').click();
      });
      li.append(b);
      return li;
    }
    /** Remove (or Take off) and Bring back for a date that can leave the calendar (D-080); null for one that can't. */
    function dateEditButton(d, label, cls) {
      const off = E.isRemovedDate(d);
      if (!off && E.isFixedDate(d)) return null;
      const b = btn(off ? 'Bring back' : label, null, { cls });
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

