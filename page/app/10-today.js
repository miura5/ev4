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
      // B-293 (C-9): a proposed take-off keeps its row, with one "Proposed" badge and Accept and Keep in place of Start
      if (o.off) li.append(el('span', 'badge proposed', 'Proposed'), ...restButtons(o.off.P, o.off.p, offEdit(o.off.p), 'take “' + text + '” off today'));
      else if (b) {
        const red = due && !doneNow && due <= E.addDays(today, 1);
        li.append(el('span', 'badge' + (red ? ' x-red' : b[1] ? ' ' + b[1] : ''), b[0]));
      }
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
        line: `${left} min left · ${free} free`,
        donePct: Math.min(100, (done / available) * 100),
        leftPct: Math.max(
          0,
          Math.min(100, ((done + left) / available) * 100) - Math.min(100, (done / available) * 100)
        ),
      };
    }
    function renderBudget(bv) {
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
      const d = el('i', 'x-green tb-done'),
        l = el('i', (bv.over ? 'x-yellow' : 'tb-neutral') + ' tb-left');
      d.style.width = bv.donePct.toFixed(1) + '%';
      l.style.width = bv.leftPct.toFixed(1) + '%';
      bar.append(d, l);
      card.replaceChildren(
        el('h2', null, 'Today’s budget'),
        el('p', 'tb-big' + (bv.over ? ' tb-over' : ''), bv.line),
        bar,
        el('p', 'meta tb-done-line', `${bv.done} min done`),
        ...(bv.over
          ? [el('p', 'meta tb-over tb-over-line', `Over by ${bv.over} min · ${bv.available} min budget`)]
          : [])
      );
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
      ok.addEventListener('click', () => guard(ok, () => restAccept(P, { p, edit }), 'Done. E.V. changed today’s list'));
      const keep = btn('Keep', null, { cls: 'btn ghost sm ti-keep' });
      keep.setAttribute('aria-label', 'Keep: ' + (edit.action === 'add' ? 'leave “' + p.text + '” off today' : 'keep “' + p.text + '” on today'));
      keep.addEventListener('click', () =>
        restLeft({ ...P, adds: P.adds.filter(x => x !== p), offs: P.offs.filter(x => x !== p) })
      );
      return [ok, keep];
    }
    function proposedAddRow(P, p) {
      const li = el('li', 'li today-item ti-prop');
      li.dataset.id = p.id;
      li.append(el('span', 'tk ti-gap'));
      const nm = el('span', 'nm ti-nm');
      nm.append(el('span', 'ti-t', p.text));
      li.append(nm, el('span', 'badge proposed', 'Proposed'), ...restButtons(P, p, restEdit(p), 'add “' + p.text + '” to today'));
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
      line.append(el('p', 'ti-review-t', 'E.V. suggests: ' + parts.join(', and ') + '. Nothing changes until you accept.'), all, no);
      return line;
    }
    function renderToday() {
      const { day, items, isDone, budget, skipped } = dayState();
      // B-291 (D-286): no Now card; the prep check is under her greeting and the exam countdown on Study.
      // List
      const box = $('today-list');
      const head = el('div', 'card-head');
      head.append(el('h2', null, 'Today’s list'));
      // B-292 (C-5): the day's budget as what's left against the time left; the side card holds the bar and the done line
      const bv = budgetView(budget, items, isDone);
      if (bv) head.append(el('span', 'meta tb-short' + (bv.over ? ' tb-over' : ''), bv.line));
      renderBudget(bv);
      // B-293 (C-9): Plan the rest, at the head's end; its proposal waits here until he accepts, keeps or rejects it
      if (ui.restPlan && ui.restPlan.date !== today) ui.restPlan = null;
      const P = ui.restPlan;
      const rest = btn('Plan the rest', null, { cls: 'btn neutral sm ti-rest', disabled: !!P });
      rest.addEventListener('click', () => {
        const np = restProposal();
        if (!np.adds.length && !np.offs.length) return toast('Nothing to change: today’s list already fits the plan.');
        ui.restPlan = np;
        render();
      });
      head.append(rest);
      // B-291: the open rows, then Done, then "Deferred: over today's budget" and "Taken off today" folded under the list.
      // A row he ticks on this visit stays where it is (rule 6); only rows done before it sit in Done.
      const shown = items.filter(i => i.tag !== 'EXAM'); // the exam is in Next 7 days (B-117)
      const inDone = it => isDone(it) && !T.ticked.has(it.id);
      const todo = shown.filter(it => !inDone(it) && !it.deferred),
        done = shown.filter(inDone),
        later = shown.filter(it => !inDone(it) && it.deferred);
      const offOf = it => P && P.offs.find(p => p.id === it.id);
      const first = todo.find(it => startable(it, isDone) && !offOf(it));
      const ul = el('ul', 'list ti-list');
      for (const it of todo) {
        const p = offOf(it);
        ul.append(todayRow(it, isDone, { start: it === first, off: p ? { P, p } : null }));
      }
      if (P) for (const p of P.adds) ul.append(proposedAddRow(P, p));
      const folds = ui.todayFolds || {};
      const kids = [head, ...(P ? [restLine(P)] : [])];
      const after = [];
      if (shown.length || (P && P.adds.length)) kids.push(ul);
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

