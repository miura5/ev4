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
    // B-117 (D-147, D-148, D-150): an item of today's list is one line: its tick, its words, its minutes once in grey,
    // no type pill. Coral only for graded work due today and not ticked (D-149). An item someone added opens in place to
    // its Remove (D-078); a set opens where it lives.
    const openRows = new Set();
    function todayRow(it, isDone) {
      const doneNow = isDone(it);
      const go = openItem(it);
      const li = el('li', 'row today-item' + (doneNow ? ' done' : '') + (openRows.has(it.id) ? ' open' : ''));
      li.dataset.id = it.id;
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.className = 'tick';
      c.checked = c.defaultChecked = doneNow;
      c.setAttribute('aria-label', 'Done: ' + it.text);
      c.addEventListener('change', () => {
        T.ticked.add(it.id);
        guard(c, () => tickWrite(it, c.checked), c.checked ? 'Checked off' : 'Unchecked');
      });
      const text = String(it.text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '');
      const line = el('button', 'ti-line');
      line.type = 'button';
      line.setAttribute('aria-expanded', String(openRows.has(it.id)));
      const t = el('span', 'ti-t' + (it.tag === 'GRADED' && !doneNow ? ' urgent' : ''), text);
      line.append(t);
      if (it.minutes) line.append(el('span', 'ti-min', it.minutes + ' min'));
      const more = el('div', 'ti-more');
      const bits = [
        it.note,
        it.deferred ? 'deferred: over today’s budget' : '',
        it.added ? 'added by ' + (it.by === 'Matt' ? 'you' : 'E.V.') : '',
      ]
        .filter(Boolean)
        .join(' · ');
      if (bits) more.append(el('p', 'meta', bits));
      if (it.added) {
        const rm = btn('Remove', null, { cls: 'quiet' });
        rm.setAttribute('aria-label', 'Remove from today: ' + it.text);
        rm.addEventListener('click', () =>
          guard(rm, () => editList(today, { action: 'remove', id: it.id }, 'Matt'), 'Removed')
        );
        more.append(rm);
      }
      line.addEventListener('click', () => {
        if (go && !it.added) return go();
        const on = !openRows.has(it.id);
        on ? openRows.add(it.id) : openRows.delete(it.id);
        li.classList.toggle('open', on);
        line.setAttribute('aria-expanded', String(on));
      });
      const g = el('div', 'grow');
      g.append(line, more);
      li.append(c, g);
      return li;
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
    let addForm = null;
    function todayAdd() {
      // built once and kept, so a refresh never wipes what he is typing
      if (addForm) return addForm;
      const f = el('form', 'add-row');
      const inp = el('input');
      inp.type = 'text';
      inp.id = 'today-add';
      inp.maxLength = 140;
      inp.placeholder = 'Add to today’s list';
      inp.setAttribute('aria-label', 'Add to today’s list');
      inp.autocomplete = 'off';
      const b = el('button', null, 'Add');
      b.type = 'submit';
      f.append(inp, b);
      f.addEventListener('submit', e => {
        e.preventDefault();
        const t = inp.value.replace(/\s+/g, ' ').trim();
        if (!t) {
          inp.focus();
          return;
        }
        const w = idUnpassed(t); // B-197: values only
        if (w.length) {
          toast('That looks like it ' + w[0].why + '. Take that detail out first.');
          return;
        }
        guard(
          b,
          async () => {
            const r = await editList(today, { action: 'add', text: t }, 'Matt');
            inp.value = '';
            b.disabled = false;
            if (r.note) toast('Already on the list');
          },
          'Added to today'
        );
      });
      return (addForm = f);
    }
    function renderToday() {
      const { rs, left: rLeft } = reviewState();
      const due = E.rankDue(M.models, today, S.exams);
      const { day, items, isDone, budget, skipped } = dayState();
      // Now card: one primary action.
      const nowCard = $('now');
      const parts = [];
      const openDrill = S.sets
        .filter(s => s.kind !== 'review' && E.chicagoDate(s.createdAt || '') === today)
        .find(s => E.validItems(s).some(q => !answersOf(s)[q.id]));
      const nextTask = items.find(
        it =>
          !isDone(it) &&
          !it.deferred &&
          it.tag !== 'GRADED' &&
          it.minutes > 0 &&
          !/^review/.test(it.id) &&
          it.id !== 'checks' &&
          !it.id.startsWith('set-')
      );
      if (rLeft) {
        parts.push(
          el('p', 'big', `Start review · ${rLeft}`),
          el('p', 'meta', reviewReason()),
          btn(
            'Start review',
            () => {
              showTab('study');
              setStudy('review');
            },
            { primary: true }
          )
        );
      } else if (openDrill) {
        parts.push(
          el('p', 'big', openDrill.title),
          el('p', 'meta', 'Built for today from your plan. Your answers update your weak spots.'),
          btn(
            'Start',
            () => {
              ui.openSet = openDrill.id;
              showTab('study');
              setStudy('practice');
              render();
            },
            { primary: true }
          )
        );
      } else if (nextTask) {
        parts.push(
          el('p', 'big', 'Next: ' + nextTask.text),
          el(
            'p',
            'meta',
            rs
              ? 'Today’s review is done.'
              : due.length
                ? `${plural(due.length, 'weak spot')} due. The review set arrives with the 4:25am run.`
                : 'Nothing due for review.'
          )
        );
      } else {
        parts.push(
          el('p', 'big', rs ? 'Today’s review is done.' : 'Nothing urgent right now.'),
          el(
            'p',
            'meta',
            sample
              ? 'Want more? E.V. can write 5 new questions on your weakest spots.'
              : 'Check the plan for what’s next.'
          )
        );
        if (sample)
          parts.push(
            btn(
              'More practice',
              () => {
                showTab('study');
                setStudy('review');
              },
              { primary: true }
            )
          );
      }
      // B-117 (D-154): no stat tiles; the Now card's second line carries the exam countdown, readiness lives in Progress.
      const ex =
        ((S.state && S.state.nextExams) || []).find(e => e.date >= today) ||
        E.nextExams(S.exams, E.addDays(today, -1))[0];
      if (ex && parts[1] && parts[1].classList.contains('meta')) {
        const n = E.diffDays(today, ex.date);
        parts[1].textContent += ` ${(ex.title || ex.id).replace(/:.*$/, '')} ${n === 0 ? 'is today' : n === 1 ? 'is tomorrow' : 'in ' + plural(n, 'day')}.`;
      }
      // B-124 (D-164): a prep day. From the evening before, the Now card is the pack check until it is ticked through,
      // then it folds to one line under the usual Now card; on the day itself the Now card is the day (place, hours)
      // with the bag check folded under it. Each is the same list as the greeting's: a tick in one is a tick in both.
      const hr = Number(String(E.chicagoClock(now()) || '12:00').split(':')[0]),
        eve = hr >= 17 || hr < 4;
      const pd = E.prepDay(S.dates, [], eve ? E.addDays(today, 1) : today),
        pp = pd ? { phase: eve ? 'night' : 'morning', date: pd.date, kind: pd.kind, title: pd.title } : null;
      const pl = pp && prepNow(pp),
        prepBox = pl && !pl.loading ? prepEl({ id: 'today', prep: pp }, { open: eve }) : null;
      let nowHead = (E.DAY_LABELS[day.dayType] || 'Today') + ' · ' + short(today);
      if (prepBox && eve && !pl.done) {
        parts.length = 0;
        nowHead = 'Tonight · ' + short(today);
      } else if (prepBox && !eve) {
        const hm = String(pd.title).match(/(\d{1,2}):?(\d{2})\s*[–-]\s*(\d{1,2}):?(\d{2})/),
          t12 = (h, m) => `${+h % 12 || 12}${m === '00' ? '' : ':' + m}${+h < 12 ? 'am' : 'pm'}`;
        const place =
          String(pd.subject || pd.title)
            .replace(hm ? hm[0] : /$^/, '')
            .replace(/[,\s·–-]+$/, '')
            .trim() || pd.title;
        nowHead = (E.DAY_LABELS[pd.kind] || 'Today') + ' · ' + short(today);
        parts.length = 0;
        parts.push(
          el('p', 'big', `${pd.kind[0].toUpperCase() + pd.kind.slice(1)} · ${place}`),
          el('p', 'meta', hm ? `${t12(hm[1], hm[2])} to ${t12(hm[3], hm[4])}.` : 'Today.')
        );
      }
      const nc = el('div');
      nc.style.cssText = 'display:flex;flex-direction:column;gap:8px;align-items:flex-start';
      nc.append(el('h2', null, nowHead), ...parts, ...(prepBox ? [prepBox] : []));
      nowCard.replaceChildren(nc);
      $('stats').replaceChildren();
      $('stats').hidden = true;
      // List
      const box = $('today-list');
      const head = el('div', 'card-head');
      head.append(el('h2', null, 'Today’s list'));
      const b = budget;
      if (b) head.append(el('span', 'meta', `${b.planned} of ${b.available} min planned`));
      const ul = el('ul', 'list');
      for (const it of items.filter(i => i.tag !== 'EXAM')) ul.append(todayRow(it, isDone)); // the exam is in Next 7 days (B-117)
      const kids = [head];
      const after = []; // the add row sits right under the list; Focus and notes follow it
      if (items.length) kids.push(ul);
      else
        kids.push(
          el(
            'p',
            'empty',
            'Nothing planned for today yet. The 4:25am run builds the list; add your own below or ask E.V.'
          )
        );
      const focus = (day.list && day.list.focus) || [];
      if (focus.length) {
        const f = el('ul', 'list');
        focus.forEach(t => f.append(row({ title: t })));
        after.push(el('h2', null, 'Focus'), f);
      }
      const deferred = ((day.plan && day.plan.deferred) || []).filter(d => d.kind !== 'weakspot');
      const deferredWs = ((day.plan && day.plan.deferred) || []).filter(d => d.kind === 'weakspot');
      if (deferred.length || deferredWs.length)
        after.push(
          el(
            'p',
            'meta',
            'Deferred: ' +
              [
                ...deferred.map(d => d.title),
                deferredWs.length ? plural(deferredWs.length, 'weak spot') + ' over today’s review load' : '',
              ]
                .filter(Boolean)
                .join('; ') +
              '.'
          )
        );
      if (skipped.length)
        after.push(
          el('p', 'meta', 'Taken off today: ' + skipped.map(x => x.text).join('; ') + '. Ask E.V. to put one back.')
        );
      if (day.live) after.push(el('p', 'meta', 'Built live from your record. The 4:25am run saves the day’s plan.'));
      const form = todayAdd();
      for (const n of [...box.childNodes]) if (n !== form) n.remove();
      if (!form.isConnected) box.append(form);
      form.before(...kids);
      form.after(...after);
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
          btn('Write a reflection', () => {
            showTab('record');
            $('seg-record').querySelector('[data-v="journal"]').click();
            $('j-kind').value = 'weekly';
            $('j-text').focus();
          })
        );
      }
      // Next 7 days
      // The exam leaves the tick list for Next 7 days (B-117): exams in the window join the calendar's dates, once each.
      const inWeek = d => d.date >= today && d.date <= E.addDays(today, 7);
      const examDates = S.exams
        .filter(e => e.date && inWeek(e) && !S.dates.some(d => d.kind === 'exam' && d.date === e.date))
        .map(e => ({ id: 'exam-' + e.id, date: e.date, title: e.title || e.id, kind: 'exam' }));
      const week = [...S.dates.filter(inWeek), ...examDates].sort(
        (a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(b.title)
      );
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
    // B-117: a date in Next 7 days is one line (its day, its title, its kind in grey); a clinical, lab, validation or class
    // day carries the calm Prep marker (D-143); coral only for graded work due today (D-149). It opens Record's Dates.
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
    function reviewReason() {
      const L = E.reviewLoad({
        date: today,
        dayType: E.dayType({ date: today, dates: S.dates, exams: S.exams }),
        exams: S.exams,
        weakspots: M.models,
      });
      return L.flex
        ? `${L.flex.need} correct reviews still needed for ${L.flex.exam} over ${plural(L.flex.daysLeft, 'day')}.`
        : 'Due weak spots, oldest misses first.';
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

