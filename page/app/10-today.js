    // ------------------------------------------------------------ Today
    function liveDay() {
      // the same plan the 4:25am run builds, computed here when the run hasn't saved one
      const plan = E.planDay({
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
    const openRows = new Set();
    function todayRow(it, isDone, o = {}) {
      const doneNow = isDone(it);
      const go = openItem(it);
      const text = String(it.text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '');
      const li = el('li', 'li today-item' + (doneNow ? ' done' : '') + (openRows.has(it.id) ? ' open' : ''));
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
      const bits = [
        it.note && it.note !== 'Graded' ? it.note : '',
        it.deferred ? 'deferred: over today’s budget' : '',
        it.added ? 'added by ' + (it.by === 'Matt' ? 'you' : 'E.V.') : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (!go) nm.setAttribute('aria-expanded', String(openRows.has(it.id)));
      nm.addEventListener('click', () => {
        if (go) return go();
        const on = !openRows.has(it.id);
        on ? openRows.add(it.id) : openRows.delete(it.id);
        li.classList.toggle('open', on);
        nm.setAttribute('aria-expanded', String(on));
      });
      li.append(tk, nm);
      const due = it.tag === 'GRADED' ? gradedDue(it) : null;
      const b = BADGE[it.tag];
      if (b) {
        const red = due && !doneNow && due <= E.addDays(today, 1);
        li.append(el('span', 'badge' + (red ? ' x-red' : b[1] ? ' ' + b[1] : ''), b[0]));
      }
      if (o.start && go) {
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
      if (bits) li.append(el('p', 'meta ti-more', bits));
      return li;
    }
    // A row that can start: not done, not graded, not over the budget, and something to open (a review or practice set).
    const startable = (it, isDone) => !isDone(it) && !it.deferred && it.tag !== 'GRADED' && !!openItem(it);
    // A fold under the list: one line that opens in place to its rows (D-150).
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
    function itemRow(it, isDone, o = {}) {
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
      const rm = o.remove && it.added ? btn('Remove', null, { cls: 'quiet' }) : null;
      if (rm) {
        rm.setAttribute('aria-label', 'Remove from today: ' + it.text);
        rm.addEventListener('click', () =>
          guard(rm, () => editList(today, { action: 'remove', id: it.id }, 'Matt'), 'Removed')
        );
      }
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
        action: go ? btn('Open', go) : rm,
      });
    }
    // B-292 (C-5): the day's budget card, the right panel's first card (under the list below 1200 px). What the list
    // still asks against the time left; done minutes on their own line; the bar is done plus left on the day's
    // whole, so a tick moves minutes from left to done and the bar never empties; warning colour when over.
    function renderBudget(b) {
      // the card is made here, the side column's first, so the shell stays inside its byte budget
      let card = $('today-budget');
      if (!card) {
        card = el('div', 'card');
        card.id = 'today-budget';
        $('weekly').before(card);
      }
      card.hidden = !b;
      if (!b) return;
      const whole = Math.max(b.available, b.planned) || 1;
      const pct = n => Math.round((n / whole) * 1000) / 10 + '%';
      const bar = el('div', 'pbar tb-bar' + (b.over ? ' over' : ''));
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `${b.done + b.left} of ${b.available} minutes on today’s list`);
      const seg = (cls, n) => {
        const i = el('i', cls);
        i.style.width = pct(n);
        return i;
      };
      bar.append(seg('tb-done', b.done), seg('tb-left', b.left));
      // D-147: each line he reads opens where it lives: what's left goes to the list's first open row, done to the
      // Done fold (opened); a line with nowhere to go stays a line.
      const go = (cls, text, to) => {
        const r = el(to ? 'button' : 'p', cls);
        if (to) {
          r.type = 'button';
          r.addEventListener('click', to);
        }
        if (Array.isArray(text)) r.append(...text);
        else r.textContent = text;
        return r;
      };
      const toRow = () => {
        const nm = $('today-list').querySelector('.ti-list li:not(.done) .nm');
        if (!nm) return;
        nm.scrollIntoView({ block: 'nearest' });
        nm.focus({ preventScroll: true });
      };
      const toDone = () => {
        ui.todayFolds = { ...(ui.todayFolds || {}), done: true };
        render();
        // a row ticked on this visit stays in place (rule 6): it is the one to go to until the Done fold holds it
        const box = $('today-list');
        const tick = box.querySelector('.ti-list li input.tick:checked');
        const fold = [...box.querySelectorAll('.ti-fold')].find(x => /^Done/.test(x.textContent));
        const f = fold || (tick && tick.closest('li').querySelector('.nm'));
        if (!f) return;
        f.scrollIntoView({ block: 'nearest' });
        f.focus({ preventScroll: true });
      };
      card.replaceChildren(
        el('h2', null, 'Today’s budget'),
        go('tb-big', `${b.left} min left · ${b.free} free`, b.left ? toRow : null),
        bar,
        ...(b.over ? [el('p', 'tb-over', `${b.over} min over today’s ${b.available}`)] : []),
        go('tb-line', [el('span', 'tb-k', 'Done'), el('span', 'tb-v', b.done + ' min')], b.done ? toDone : null)
      );
    }
    function renderToday() {
      const { day, items, isDone, budget, skipped } = dayState();
      // B-291 (D-286): no Now card; the prep check is under her greeting and the exam countdown on Study.
      // List
      const box = $('today-list');
      const head = el('div', 'card-head');
      head.append(el('h2', null, 'Today’s list'));
      renderBudget(E.dayBudget(budget, items, isDone));
      // B-291: the open rows, then Done, then "Deferred: over today's budget" and "Taken off today" folded under the list.
      // A row he ticks on this visit stays where it is (rule 6); only rows done before it sit in Done.
      const shown = items.filter(i => i.tag !== 'EXAM'); // the exam is in Next 7 days (B-117)
      const inDone = it => isDone(it) && !T.ticked.has(it.id);
      const rest = shown.filter(it => !inDone(it) && !it.deferred),
        done = shown.filter(inDone),
        later = shown.filter(it => !inDone(it) && it.deferred);
      const first = rest.find(it => startable(it, isDone));
      const ul = el('ul', 'list ti-list');
      for (const it of rest) ul.append(todayRow(it, isDone, { start: it === first }));
      const folds = ui.todayFolds || {};
      const kids = [head];
      const after = [];
      if (shown.length) kids.push(ul);
      else
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
      if (day.live) after.push(el('p', 'meta', 'Built live from your record. The 4:25am run saves the day’s plan.'));
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
      // Next 7 days
      const week = weekDates();
      renderEvDates(week);
      const ahead = $('ahead'),
        open = week.length <= 5 || ui.aheadOpen;
      let fold = $('ahead-fold');
      if (week.length > 5) {
        if (!fold) {
          fold = el('button', 'fold-line');
          fold.id = 'ahead-fold';
          fold.type = 'button';
          fold.addEventListener('click', () => {
            ui.aheadOpen = !ui.aheadOpen;
            render();
          });
          ahead.before(fold);
        }
        fold.textContent = plural(week.length, 'date') + ' this week';
        fold.setAttribute('aria-expanded', String(!!open));
      } else if (fold) fold.remove();
      ahead.hidden = !open;
      ahead.replaceChildren(...(week.length ? week.map(weekRow) : [empty('No dates in the next week.')]));
    }
    // The exam leaves the tick list for Next 7 days (B-117): exams in the window join the calendar's dates, once each.
    function weekDates() {
      const inWeek = d => d.date >= today && d.date <= E.addDays(today, 7);
      const examDates = S.exams
        .filter(e => e.date && inWeek(e) && !S.dates.some(d => d.kind === 'exam' && d.date === e.date))
        .map(e => ({ id: 'exam-' + e.id, date: e.date, title: e.title || e.id, kind: 'exam' }));
      return [...S.dates.filter(inWeek), ...examDates].sort(
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
    function dateRow(d, o = {}) {
      // o.edit: Remove (or Bring back) for entries that can leave the calendar (D-080)
      const kindV = { exam: 'accent', validation: 'warn', clinical: 'ok', due: 'info' }[d.kind] || '';
      const off = E.isRemovedDate(d);
      const by = w => (w === 'Matt' ? 'you' : 'E.V.');
      let action = null;
      if (o.edit && (off || !E.isFixedDate(d))) {
        action = btn(off ? 'Bring back' : 'Remove', null, { cls: 'quiet' });
        action.setAttribute('aria-label', (off ? 'Bring back: ' : 'Remove from the calendar: ') + (d.title || ''));
        action.addEventListener('click', () =>
          guard(
            action,
            () => editDates({ action: off ? 'restore' : 'remove', id: d.id }, 'Matt'),
            off ? 'Back on the calendar' : 'Taken off the calendar'
          )
        );
      }
      const detail = [
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
        chips: [d.kind ? [d.kind, kindV] : null, d.graded ? ['graded', 'bad'] : null],
        action,
      });
    }

