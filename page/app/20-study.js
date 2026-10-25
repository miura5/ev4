    // ------------------------------------------------------------ Study
    // B-126 (D-165): the set to do next: the newest set with a question left, other than the one he is on.
    const unfinished = s => E.validItems(s).some(q => !answersOf(s)[q.id]);
    const practiceSets = () =>
      S.sets
        .filter(s => s.kind !== 'review' && E.validItems(s).length)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const nextSet = except => practiceSets().find(s => s.id !== except && unfinished(s)) || null;
    function moreMount(on) {
      // the More practice line: inside a finished review set, else parked hidden after the card
      const mc = $('more-card'),
        home = $('study-review');
      if (!on) {
        mc.hidden = true;
        mc.classList.add('card');
        if (mc.parentElement !== home) home.append(mc);
        return null;
      }
      mc.hidden = false;
      mc.classList.remove('card');
      return mc;
    }
    function renderReview() {
      const rs = S.sets.find(s => s.id === 'review-' + today);
      const items = rs ? E.validItems(rs) : [];
      // B-116 (D-151): More practice only once today's set is done; B-126: then it is the summary's one primary.
      const rsAnswers = rs ? answersFor(rs) : {};
      const finished = !!items.length && !items.some(q => !rsAnswers[q.id]);
      if (!items.length) {
        moreMount(false);
        $('rv-count').textContent = '';
        $('rv-count').hidden = true;
        $('rv-bar').style.width = '0';
        const due = E.rankDue(M.models, today, S.exams).length;
        $('rv-body').replaceChildren(
          el(
            'p',
            'empty',
            rs
              ? 'Today’s set came through empty. Tell E.V. in a chat and it will rebuild it.'
              : 'Today’s review appears after the 4:25 am run.' + (due ? ' ' + plural(due, 'weak spot') + ' due.' : '')
          )
        );
        return;
      }
      if (!finished || !sample) moreMount(false);
      runner({
        key: 'rv',
        set: rs,
        items,
        body: $('rv-body'),
        countEl: $('rv-count'),
        barEl: $('rv-bar'),
        label: 'E.V. Review · ' + short(today),
        title: 'Today’s review',
        scoreEl: $('rv-score'),
        more: sample ? () => moreMount(true) : null,
        next: nextSet(null),
      });
    }
    // B-297 (D-283, C-8, C-13): Study's overview. The exam header with its readiness bar, then one row per objective:
    // its state, its weak spots and, on hover or focus, Quiz me. A tap on the words opens its detail in place. The
    // toolbar's Start session is the view's one primary; a set he opens shows in the quiz card (the Review and Practice
    // views), whose toolbar shows the way back instead.
    const OBJ_STATE = {
      solid: ['Solid', 'x-green'],
      almost: ['Almost', 'x-yellow'],
      notyet: ['Not yet', ''],
    };
    // B-337 (D-312): the picked objective. From 1200 px one is always picked (the first not solid) and fills the right
    // panel; below that a tap on its words opens it under its row and a second tap folds it.
    let objSel = null;
    function syncStudyBar() {
      const v = ui.study,
        quiz = v === 'review' || v === 'practice';
      $('study-back').hidden = !quiz;
      // B-348 (D-312): the quiz's strip, as the demo's: All topics, what is open, Quiz me (a practice set's way to today's
      // review) and Weak spots with its count
      const pr = v === 'practice' && S.sets.find(s => s.id === ui.openSet);
      $('study-qlab').hidden = !quiz;
      $('study-qlab').textContent =
        v === 'review' ? 'Today’s review · ' + short(today) : pr ? (ui.openObj && ui.openObj.text) || pr.title || 'Practice' : '';
      // B-351 (D-313): on the overview the strip is the demo's: the course switch, Quiz me, Weak spots · N, Start session
      const ov = v === 'objectives';
      $('study-qquiz').hidden = !pr && !ov;
      let nW = 0;
      try {
        nW = M ? M.models.filter(w => E.isActive(w) && !w.derived.preRead).length : 0;
      } catch {
        nW = 0; // the bar can sync before the model is first built
      }
      $('study-qweak').hidden = !quiz && !ov;
      $('study-qweak').textContent = 'Weak spots' + (nW ? ' · ' + nW : '');
      // in the quiz card the way back replaces the view tabs, so no switch shows with nothing picked (C-15)
      $('seg-study').hidden = quizOpen('study') || (innerWidth >= 600 && ui.tab !== 'study');
      $('study-course').hidden = v !== 'objectives' || $('study-course').children.length < 2;
      $('study-start').hidden = v !== 'objectives' || $('study-start').dataset.off === '1';
    }
    /** The courses with an upcoming exam that has objectives, each with that exam (the soonest). */
    function studyCourses() {
      const out = [];
      for (const c of E.activeCourses()) {
        const ex = S.exams
          .filter(e => e.date && e.date >= today && E.courseOf(e) === c && S.objectives.some(o => o.exam === e.id))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        if (ex) out.push({ course: c, exam: ex });
      }
      return out;
    }
    /** B-351 (D-313): the courses with an upcoming exam, objectives or not (Matt's record has none), each with its
     *  soonest; the overview's course switch and exam card read this. */
    function studyExams() {
      const out = [];
      for (const c of E.activeCourses()) {
        const ex = S.exams
          .filter(e => e.date && e.date >= today && E.courseOf(e) === c && e.status !== 'done')
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        if (ex) out.push({ course: c, exam: ex });
      }
      return out;
    }
    /** An objective's state from its weak spots and answers: Not yet while one is not yet right (or none answered),
     *  Almost while its open ones are right once, Solid once none is open. */
    function objState(o, acc) {
      const ws = M.models.filter(
        w =>
          (w.kind || 'concept') === 'concept' &&
          w.objective === o.id &&
          w.derived &&
          !['parked', 'moved'].includes(w.derived.status)
      );
      const open = ws.filter(E.isActive);
      const notYet = open.filter(w => !w.derived.preRead && !((w.derived.streak || 0) > 0));
      const state = notYet.length
        ? 'notyet'
        : open.length
          ? 'almost'
          : ws.length || (acc && acc.n)
            ? 'solid'
            : 'notyet';
      return { state, open, ws };
    }
    function quizObjective(o, b) {
      // the objective's items in his practice sets: the set with most of them left, newest first; with none, the job
      const mine = s => E.validItems(s).filter(q => q.objective === o.id);
      const left = s => mine(s).filter(q => !answersOf(s)[q.id]).length;
      const pick = practiceSets()
        .filter(s => mine(s).length)
        .sort((x, y) => left(y) - left(x))[0];
      if (pick) {
        ui.openSet = pick.id;
        ui.openObj = { set: pick.id, obj: o.id, text: o.text };
        setStudy('practice');
        render();
        return;
      }
      const going = S.jobs.find(
        j =>
          j.kind === 'practice-set' &&
          String(j.brief || '').startsWith(o.id + ':') &&
          ['queued', 'running'].includes(j.status) &&
          !(j.fired && j.fired.ok === false)
      );
      if (going) return toast('E.V. is writing questions on it. They show here when they’re ready.');
      return guard(b, async () => {
        const r = await startJob({
          kind: 'practice-set',
          title: 'Quiz me: ' + String(o.text || o.id).slice(0, 60),
          brief: o.id + ': 10 questions on this objective: ' + String(o.text || '').slice(0, 200),
        });
        toast(
          r.fired.ok
            ? 'No questions on it yet, so E.V. is writing 10. They show here in a few minutes.'
            : 'Couldn’t start it: ' + fireCopy(r.fired.error)
        );
      });
    }
    // B-351 (D-313): the plan day picked in the exam card when the exam has no objectives (as on Matt's record)
    let daySel = null;
    function renderObjectives() {
      const card = $('ov-card'),
        list = studyExams();
      const start = $('study-start');
      start.dataset.off = activeSession() ? '1' : '';
      if (!list.some(x => x.course === ui.studyCourse))
        ui.studyCourse = ((M.target && list.find(x => x.exam.id === M.target.id)) || list[0] || {}).course || null;
      const cs = $('study-course');
      const ck = list.map(x => x.course).join('|') + '#' + ui.studyCourse;
      if (cs.dataset.k !== ck) {
        cs.dataset.k = ck;
        cs.replaceChildren(
          ...list.map(x => {
            const b = el('button');
            b.type = 'button';
            b.setAttribute('aria-pressed', String(x.course === ui.studyCourse));
            b.append(el('span', 'full', x.course), el('span', 'code', String(x.course).split(' ')[0]));
            b.setAttribute('aria-label', x.course);
            b.addEventListener('click', () => {
              ui.studyCourse = x.course;
              render();
            });
            return b;
          })
        );
      }
      syncStudyBar();
      const cur = list.find(x => x.course === ui.studyCourse);
      ui.objPanel = null;
      if (!cur) {
        card.replaceChildren(el('p', 'empty', 'Your next exam shows here once it’s in the record.'));
        renderStudyUp(null);
        renderMiniQuiz(null);
        return;
      }
      const ex = cur.exam,
        acc = E.answerStats(M.attempts.all).byObjective;
      const objs = S.objectives
        .filter(o => o.exam === ex.id)
        .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
      const days = E.diffDays(today, ex.date);
      const exName = (ex.title || ex.id).replace(/:.*$/, '');
      const fullName = exName.includes(cur.course) ? exName : cur.course + ' ' + exName;
      const head = el('div', 'ov-head');
      const nm0 = el('span', 'ov-name');
      nm0.append(
        el('b', 'ov-ex', fullName),
        el(
          'span',
          'meta',
          ' · ' + dayMonth(ex.date) + ' · ' + (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days')
        )
      );
      const bar = el('div', 'pbar ov-bar');
      bar.setAttribute('role', 'img');
      const g = el('i', 'x-green'),
        y = el('i', 'x-yellow');
      bar.append(g, y);
      const box = el('div', 'ov-rows');
      // one row per objective; with none, one per day of the exam's plan
      const items = objs.length ? objRows(objs, acc, fullName) : planRows(ex, fullName);
      head.append(nm0, el('span', 'meta ov-count', items.count));
      g.style.width = items.solid;
      y.style.width = items.almost;
      bar.setAttribute('aria-label', items.aria);
      box.append(...items.rows);
      card.replaceChildren(...(items.rows.length ? [head, bar, box] : [head, bar, el('p', 'empty ov-none', items.none)]));
      renderStudyUp(cur.course);
      renderMiniQuiz(cur);
    }
    /** The exam card's objective rows: state badge, words, weak spots and Quiz me on hover; the picked one's detail
     *  fills the panel from 1200 px, or opens under its row. */
    function objRows(objs, acc, fullName) {
      const rows = objs.map(o => ({ o, ...objState(o, acc[o.id]) }));
      const n = k => rows.filter(r => r.state === k).length;
      const pctOf = k => (rows.length ? (100 * n(k)) / rows.length : 0) + '%';
      if (!rows.some(r => r.o.id === objSel)) objSel = null;
      if (PANEL.matches && !objSel) objSel = ((rows.find(r => r.state !== 'solid') || rows[0] || {}).o || {}).id || null;
      const out = [];
      for (const r of rows) {
        const [word, cls] = OBJ_STATE[r.state];
        const on = objSel === r.o.id;
        const wrap = el('div', 'ov' + (on ? ' open' : ''));
        wrap.dataset.id = r.o.id;
        const li = el('div', 'obj' + (on ? ' on' : ''));
        const nm = el('button', 'nm ov-nm', r.o.text || r.o.id);
        nm.type = 'button';
        nm.title = r.o.text || r.o.id;
        nm.setAttribute('aria-expanded', String(on));
        nm.addEventListener('click', () => {
          objSel = on && !PANEL.matches ? null : r.o.id;
          render();
        });
        const q = btn('Quiz me', ev => quizObjective(r.o, ev.currentTarget), { cls: 'btn ghost sm oq' });
        q.setAttribute('aria-label', 'Quiz me on ' + (r.o.text || r.o.id));
        li.append(
          el('span', 'badge ov-st' + (cls ? ' ' + cls : ''), word),
          nm,
          el('span', 'ow', r.open.length ? plural(r.open.length, 'weak spot') : ''),
          q
        );
        wrap.append(li);
        if (on) {
          const d = objDetail(r, word, cls, fullName, PANEL.matches);
          if (PANEL.matches) ui.objPanel = d;
          else wrap.append(d);
        }
        out.push(wrap);
      }
      return {
        rows: out,
        count: n('solid') + ' of ' + rows.length + ' objectives solid' + (n('almost') ? ', ' + n('almost') + ' almost' : ''),
        solid: pctOf('solid'),
        almost: pctOf('almost'),
        aria: `${n('solid')} solid, ${n('almost')} almost, ${n('notyet')} not yet`,
        none: '',
      };
    }
    /** B-351 (D-313): an exam with no objectives shows its plan in the card: its progress on the bar and one row per
     *  plan day (Done, Started or To do; its label; its date and count). The picked day fills the panel from 1200 px,
     *  or opens under its row, with its tasks and Open the plan. */
    function planRows(ex, fullName) {
      const plan = S.plans.find(p => (p.exam || p.id) === ex.id);
      const empty = {
        rows: [],
        count: '',
        solid: '0%',
        almost: '0%',
        aria: 'No objectives or plan yet',
        none: 'Its objectives or its plan show here once they’re in the record.',
      };
      if (!plan || !(plan.days || []).length) return empty;
      const isDone = t => !!(plan.done && plan.done[t.id]) || E.taskDone(plan, t, today, S.sets, S.answers);
      const dayRows = plan.days
        .slice()
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map(d => {
          const ts = (d.tasks || []).map(t => ({ ...t, date: d.date }));
          const nDone = ts.filter(isDone).length;
          const state = ts.length && nDone === ts.length ? 'done' : nDone ? 'started' : 'todo';
          return { d, ts, nDone, state };
        });
      const all = dayRows.reduce((a, r) => a + r.ts.length, 0),
        done = dayRows.reduce((a, r) => a + r.nDone, 0),
        startedN = dayRows.filter(r => r.state === 'started').reduce((a, r) => a + r.ts.length - r.nDone, 0);
      const key = r => plan.id + '|' + r.d.date;
      if (!dayRows.some(r => key(r) === daySel)) daySel = null;
      if (PANEL.matches && !daySel) {
        const pick = dayRows.find(r => r.d.date >= today && r.state !== 'done') || dayRows[dayRows.length - 1];
        daySel = key(pick);
      }
      const DAY_STATE = { done: ['Done', 'x-green'], started: ['Started', 'x-yellow'], todo: ['To do', ''] };
      const openPlan = () => {
        ui.planShown = plan.id;
        setStudy('plan');
        render();
      };
      const out = [];
      for (const r of dayRows) {
        const [word, cls] = DAY_STATE[r.state];
        const on = daySel === key(r);
        const wrap = el('div', 'ov' + (on ? ' open' : ''));
        const li = el('div', 'obj' + (on ? ' on' : ''));
        const name = r.d.label || (r.ts[0] && r.ts[0].text) || dayMonth(r.d.date);
        const nm = el('button', 'nm ov-nm', name);
        nm.type = 'button';
        nm.title = name;
        nm.setAttribute('aria-expanded', String(on));
        nm.addEventListener('click', () => {
          daySel = on && !PANEL.matches ? null : key(r);
          render();
        });
        li.append(
          el('span', 'badge ov-st' + (cls ? ' ' + cls : ''), word),
          nm,
          el(
            'span',
            'ow',
            (r.d.date === today ? 'today' : dayMonth(r.d.date)) + ' · ' + r.nDone + ' of ' + r.ts.length
          )
        );
        wrap.append(li);
        if (on) {
          const dt = el('div', 'ov-detail');
          if (PANEL.matches) dt.append(el('span', 'lab', 'Plan day'), el('div', 'od-name', name));
          const st = el('div', 'od-row');
          st.append(
            el('span', 'badge' + (cls ? ' ' + cls : ''), word),
            el('span', 'mini', dayMonth(r.d.date) + ' · ' + fullName)
          );
          dt.append(st, el('span', 'lab', 'On this day'));
          for (const t of r.ts) {
            const si = el('div', 'od-ws od-task');
            si.append(
              el('i', 'dot' + (isDone(t) ? ' x-green' : '')),
              el('span', 'sn', t.text || t.id),
              el('span', 'st', isDone(t) ? 'done' : 'open')
            );
            si.title = t.text || '';
            dt.append(si);
          }
          dt.append(
            btn('Open the plan', openPlan, { cls: 'btn neutral od-q' }),
            el('span', 'mini od-note', 'Tick what you’ve done in the plan. This exam has no objectives in the record yet.')
          );
          if (PANEL.matches) ui.objPanel = dt;
          else wrap.append(dt);
        }
        out.push(wrap);
      }
      return {
        rows: out,
        count: done + ' of ' + plural(all, 'plan task') + ' done',
        solid: (all ? (100 * done) / all : 0) + '%',
        almost: (all ? (100 * startedN) / all : 0) + '%',
        aria: `${done} of ${all} plan tasks done`,
        none: '',
      };
    }
    /** B-351 (D-313): the course's quiz, the demo's Quiz me and mini quiz: a practice set on this exam with questions
     *  left (most left first), else today's review. */
    function courseSet(cur) {
      const left = s => E.validItems(s).filter(q => !answersOf(s)[q.id]).length;
      const objIds = new Set(S.objectives.filter(o => o.exam === cur.exam.id).map(o => o.id));
      const mine = s =>
        s.exam === cur.exam.id || E.validItems(s).some(q => objIds.has(q.objective));
      const pick = practiceSets()
        .filter(s => mine(s) && left(s))
        .sort((a, b) => left(b) - left(a))[0];
      if (pick) return { set: pick, review: false };
      const rs = S.sets.find(s => s.id === 'review-' + today);
      if (rs && E.validItems(rs).length) return { set: rs, review: true };
      return null;
    }
    function courseQuiz(b) {
      const cur = studyExams().find(x => x.course === ui.studyCourse);
      const c = cur && courseSet(cur);
      if (!c) return weakQuizAll(b);
      if (c.review) {
        setStudy('review');
        return render();
      }
      ui.openSet = c.set.id;
      ui.openObj = null;
      setStudy('practice');
      render();
    }
    /** B-351 (D-313): the mini quiz card beside Coming up: a question from the course's next set as its teaser. */
    function renderMiniQuiz(cur) {
      let card = $('ov-quiz');
      if (!card) {
        card = el('div', 'ui-card ov-quiz');
        card.id = 'ov-quiz';
        $('ov-grid').append(card);
      }
      const c = cur && courseSet(cur);
      const q = c && E.validItems(c.set).find(x => !answersOf(c.set)[x.id]);
      const teaser = q ? String(q.stem || q.q || q.text || '').trim() : '';
      card.replaceChildren(
        el('span', 'lab', c && c.review ? 'Mini quiz · today’s review' : 'Mini quiz · questions from this course'),
        el('div', 'mq-q', teaser || 'No questions waiting for this course yet.'),
        el(
          'div',
          'mini',
          c ? 'Misses come back as weak spots, for you to review.' : 'Today’s review appears after the 4:25 am run.'
        )
      );
      if (c) {
        const r = el('div', 'mq-row');
        r.append(btn('Take the quiz', ev => courseQuiz(ev.currentTarget), { cls: 'btn neutral' }));
        card.append(r);
      }
    }
    const OV_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const OV_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function dayMonth(ds) {
      const d = new Date(ds + 'T12:00:00Z');
      return OV_WD[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + OV_MON[d.getUTCMonth()];
    }
    /** B-337: an objective's panel, as the demo's: its state, its weak spots and Quiz me on this. */
    function objDetail(r, word, cls, exName, inPanel) {
      const d = el('div', 'ov-detail');
      // under its row the words are just above, so only the panel repeats them
      if (inPanel) d.append(el('span', 'lab', 'Objective'), el('div', 'od-name', r.o.text || r.o.id));
      const st = el('div', 'od-row');
      st.append(el('span', 'badge' + (cls ? ' ' + cls : ''), word), el('span', 'mini', exName));
      d.append(st);
      if (r.open.length) {
        d.append(el('span', 'lab', 'Weak spots under it'));
        for (const w of r.open) {
          const si = el('div', 'od-ws');
          si.append(
            el('i', 'dot x-yellow'),
            el('span', 'sn', w.topic || w.id),
            el('span', 'st', (w.derived.streak || 0) > 0 ? 'right once' : 'open')
          );
          d.append(si);
        }
      }
      const q = btn('Quiz me on this', ev => quizObjective(r.o, ev.currentTarget), { cls: 'btn neutral od-q' });
      q.setAttribute('aria-label', 'Quiz me on ' + (r.o.text || r.o.id));
      d.append(
        q,
        el(
          'span',
          'mini od-note',
          r.open.length
            ? 'Drill a weak spot from Weak spots, or quiz the whole objective.'
            : 'No weak spots under it. Quiz it to check it stays solid.'
        )
      );
      return d;
    }
    /** B-337 (D-312): Coming up in this course, under the exam card: its next five dates from today, each opening
     *  Today's week; Week view opens the week. */
    function renderStudyUp(course) {
      let card = $('ov-up');
      if (!card) {
        card = el('div', 'ui-card ov-up');
        card.id = 'ov-up';
        $('ov-grid').prepend(card);
      }
      if (!course) {
        card.hidden = true;
        return card.replaceChildren();
      }
      const seen = new Set();
      const all = [
        ...S.dates.filter(d => !E.isRemovedDate(d)),
        ...S.exams.map(e => ({ id: 'exam-' + e.id, date: e.date, title: e.title || e.id, kind: 'exam', course: e.course })),
      ]
        .filter(d => d.date && d.date >= today && E.courseOf(d) === course)
        .filter(d => {
          const k = d.date + '|' + (d.kind === 'exam' ? 'exam' : d.id);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(String(b.title)))
        .slice(0, 5);
      card.hidden = !all.length;
      if (!all.length) return card.replaceChildren();
      const openWeek = () => {
        ui.todayView = 'week';
        store.set('todayView', 'week');
        showTab('today');
        render();
      };
      const hd = el('div', 'up-head');
      hd.append(el('span', 'lab', 'Coming up in ' + course), btn('Week view', openWeek, { cls: 'btn ghost sm' }));
      const list = el('div', 'up-list');
      for (const d of all) {
        const b = el('button', 'up');
        b.type = 'button';
        const days = E.diffDays(today, d.date);
        const urgent = d.graded && days <= 1;
        const un = el('span', 'un');
        un.append(el('i', 'dot' + (urgent ? ' x-red' : '')), el('span', 'ut', d.title || ''));
        b.append(
          el('span', 'ud', OV_WD[new Date(d.date + 'T12:00:00Z').getUTCDay()] + ' ' + Number(d.date.slice(8))),
          un,
          el('span', 'ud', days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days')
        );
        b.addEventListener('click', openWeek);
        list.append(b);
      }
      card.replaceChildren(hd, list);
    }
    /** B-347 (D-312): Weak spots as the demo's StudyWeak board. A strip (All topics back to Objectives, "Weak spots ·
     *  course", Quiz me), then sections of full-width rows under a quiet head: due today, due tomorrow, later, notes and
     *  skills, previews and solid. An open row has its dot, its topic, a grey line (where it came from, how often, when
     *  it is next due, its objective), Drill and Mark solid; previews and solid are quiet. From 1200 px the right panel
     *  says how a weak spot closes. There is no To review section: nothing in the record proposes weak spots yet
     *  (B-300). */
    const objText = id => ((S.objectives.find(o => o.id === id) || {}).text || '');
    function weakQuizAll(b) {
      // today's review set aims at the most due spots; with none yet, the same line as the review's own
      const rs = S.sets.find(s => s.id === 'review-' + today);
      if (rs && E.validItems(rs).length) {
        setStudy('review');
        return render();
      }
      toast('Today’s review appears after the 4:25 am run.');
    }
    function wkRow(w, quiet) {
      const d = w.derived;
      const due = E.isDue(w, today);
      const when =
        w.kind === 'note' || w.kind === 'skill'
          ? w.kind === 'skill'
            ? 'skill'
            : 'note'
          : d.status === 'reviewed'
            ? 'solid ' + short(d.solidAt)
            : d.preRead
              ? 'first check after the reading' + (w.readingDue ? ' (' + short(w.readingDue) + ')' : '')
              : d.nextDue
                ? (due ? 'due today' : 'next ' + short(d.nextDue)) + (d.streak ? ' · ' + d.streak + ' of 2 right' : '')
                : 'not scheduled';
      const sub = [
        w.source,
        d.recurrence > 1 ? 'seen ' + d.recurrence + '×' : '',
        when,
        objText(w.objective) || w.objective || '',
      ]
        .filter(Boolean)
        .join(' · ');
      const row = el('div', 'wl' + (quiet ? ' quiet' : ''));
      row.dataset.id = w.id;
      const tx = el('div', 'wt');
      tx.append(el('span', 'wn', w.topic || 'Untitled'), el('span', 'mini', sub));
      row.append(el('i', 'dot' + (quiet ? '' : ' x-yellow')), tx);
      if (d.status === 'open') {
        const o = (w.kind || 'concept') === 'concept' && !d.preRead && S.objectives.find(x => x.id === w.objective);
        if (o) {
          const dr = btn('Drill', ev => quizObjective(o, ev.currentTarget), { cls: 'btn neutral sm' });
          dr.setAttribute('aria-label', 'Drill ' + (w.topic || 'this weak spot'));
          row.append(dr);
        }
        const ms = btn('Mark solid', ev => guard(ev.target, () => write(weakEvent(w, 'solid')), 'Marked solid'), {
          cls: 'btn ghost sm',
        });
        ms.setAttribute('aria-label', 'Mark ' + (w.topic || 'this weak spot') + ' solid');
        row.append(ms);
      }
      return row;
    }
    function renderWeak() {
      const ms = M.models;
      const byAdded = (a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || ''));
      const active = ms
        .filter(w => E.isActive(w) && !w.derived.preRead)
        .sort(
          (a, b) => String(a.derived.nextDue || '9').localeCompare(String(b.derived.nextDue || '9')) || byAdded(a, b)
        );
      const previews = ms.filter(w => E.isActive(w) && w.derived.preRead).sort(byAdded);
      const notes = ms
        .filter(w => (w.kind === 'note' || w.kind === 'skill') && w.derived.status === 'open')
        .sort(byAdded);
      const solid = ms
        .filter(w => w.derived.status === 'reviewed' && w.kind !== 'note')
        .sort((a, b) => String(b.derived.solidAt || '').localeCompare(String(a.derived.solidAt || '')));
      const formats = ms.filter(w => w.kind === 'format' && w.derived.status === 'open');
      const tomorrow = E.addDays(today, 1);
      const due = active.filter(w => E.isDue(w, today)),
        tom = active.filter(w => !E.isDue(w, today) && w.derived.nextDue === tomorrow),
        later = active.filter(w => !due.includes(w) && !tom.includes(w));
      // the strip's course: the one course its open spots belong to, else none named
      const cs = new Set(
        active.concat(notes).map(w => {
          const ex = S.exams.find(e => e.id === w.exam);
          return ex ? E.courseOf(ex) : null;
        })
      );
      const one = cs.size === 1 ? [...cs][0] : null;
      $('weak-lab').textContent = 'Weak spots' + (one ? ' · ' + one : '');
      const out = [];
      const sec = (label, rows, quiet) => {
        if (!rows.length) return;
        out.push(el('div', 'dayh', label + ' · ' + rows.length));
        for (const w of rows) out.push(wkRow(w, quiet));
      };
      sec('Due today', due);
      if (active.length) {
        const all = el('div', 'wl wl-all');
        const q = btn('Quiz me on all of them', ev => weakQuizAll(ev.currentTarget), { cls: 'btn neutral sm' });
        all.append(q);
        const ql = $('weak-quizlet');
        ql.hidden = !active.some(w => (w.kind || 'concept') === 'concept');
        all.append(ql);
        if (due.length) out.push(all);
        sec('Due tomorrow', tom);
        sec('Later', later);
        if (!due.length) out.push(all);
      } else $('weak-quizlet').hidden = true;
      sec('Notes and skills', notes);
      if (formats.length)
        out.push(
          el(
            'div',
            'wl wl-note mini',
            'Question format pattern: ' + formats.map(f => f.topic).join('; ') + '. Review sets lean on these formats.'
          )
        );
      sec('Previews, before the reading', previews, true);
      sec('Solid', solid, true);
      if (!active.length && !notes.length) out.unshift(el('div', 'empty', 'No weak spots open.'));
      $('weak-list').replaceChildren(...out);
      // the right panel from 1200 px: how a weak spot closes (the demo's panel card)
      const p = el('div', 'ov-detail wk-side');
      p.append(el('span', 'lab', 'How a weak spot closes'));
      for (const t of [
        'Drill: a quiz on its objective',
        'Mark solid: you know it now',
        'Today’s review: the ones due, one question each',
        'Solid after two right answers on different days',
      ]) {
        const r = el('div', 'od-ws');
        r.append(el('i', 'dot'), el('span', 'sn', t));
        p.append(r);
      }
      p.append(
        el(
          'span',
          'mini od-note',
          due.length
            ? plural(due.length, 'weak spot') + ' due today. Quiz me runs today’s review.'
            : 'Nothing due today. Quiz me runs today’s review once it’s ready.'
        )
      );
      ui.weakPanel = p;
    }
    function giveFive() {
      // a finished practice set's Give me 5 more
      const b = btn('Give me 5 more', null, { primary: true });
      b.addEventListener('click', async () => {
        b.disabled = true;
        b.textContent = 'Writing 5 questions…';
        const ok = await morePractice();
        if (!ok) {
          b.disabled = false;
          b.textContent = 'Give me 5 more';
          toast($('more-status').textContent);
        }
      });
      return b;
    }
    function renderPractice() {
      const body = $('pr-body');
      const list = practiceSets();
      const d = ui.openSet && list.find(x => x.id === ui.openSet);
      // B-297: a set opened by an objective's Quiz me holds that objective's questions only
      const of = d && ui.openObj && ui.openObj.set === d.id ? ui.openObj : null;
      if (!of) ui.openObj = null;
      $('pr-prog').hidden = !d;
      // B-191 (D-160): an open set folds back from its own head line (its title with a chevron), never a Close button;
      // every answer stays saved (each is written as he checks it) and it reopens on the question he left. B-303 (D-283):
      // there is no list of sets to fold back into, so the head line goes back to Objectives, as the toolbar's way back.
      let fold = $('pr-fold');
      if (!fold) {
        fold = foldLine('', true, () => {
          ui.openSet = null;
          ui.openObj = null;
          setStudy('objectives');
          render();
        });
        fold.id = 'pr-fold';
        fold.classList.add('pr-fold');
        $('pr-title').before(fold);
      }
      fold.hidden = !d;
      $('pr-title').hidden = !!d;
      if (d) {
        fold.dataset.set = d.id;
        fold.textContent = d.title || 'Practice';
        fold.setAttribute('aria-label', (d.title || 'This set') + ': back to Objectives; your answers are kept');
      }
      if (!d) {
        // B-303 (D-283): the Practice list of sets is retired; a set opens from an objective's Quiz me, Today's row or
        // her card, so with none open the view goes back to Objectives.
        if ($('pr-share')) $('pr-share').hidden = true;
        body.replaceChildren();
        if (ui.study === 'practice') setStudy('objectives'); // Objectives was drawn earlier in this pass
        return;
      }
      $('pr-title').textContent = d.title || 'Practice';
      // D-110: a set that can go out as a page says so above its questions.
      let bar = $('pr-share');
      if (!bar) {
        bar = el('div', 'share-bar');
        bar.id = 'pr-share';
        body.before(bar);
      }
      const sh = shareButton(d);
      bar.hidden = !sh;
      bar.replaceChildren(
        ...(sh
          ? [
              el(
                'span',
                'meta grow',
                'Classmates can practise this set too: a page with no name and none of your weak spots.'
              ),
              sh,
            ]
          : [])
      );
      $('pr-count').textContent = '';
      runner({
        key: 'pr-' + d.id + (of ? '@' + of.obj : ''),
        set: d,
        items: of ? E.validItems(d).filter(q => q.objective === of.obj) : E.validItems(d),
        body,
        countEl: $('pr-qcount'),
        barEl: $('pr-bar'),
        label: 'E.V. · ' + (of ? of.text || of.obj : d.title || d.id),
        title: of ? 'Quiz · ' + (of.obj || '') : d.title || 'Practice',
        scoreEl: $('pr-score'),
        more: sample ? giveFive : null,
        next: nextSet(d.id),
        summaryExtra: () => {
          const a = el('div', 'actions');
          const sh = shareButton(d);
          a.append(
            ...(sh ? [sh] : []),
            btn('Retake', () => retake(d, 'pr-' + d.id))
          );
          return [a];
        },
      });
    }
    // D-110: a calendar set over a chapter range can go out once as a page for classmates (no name, none of his weak
    // spots); the worker builds and publishes it, and he shares it from that page's Share menu.
    const shareJob = set =>
      S.jobs
        .filter(j => j.kind === 'share-set' && String(j.brief || '').startsWith(set.id + ':'))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    function shareButton(set) {
      if (!E.shareableSet(set, S.plans).ok) return null;
      const j = shareJob(set);
      const url = j && j.status === 'done' && j.result && j.result.pageUrl;
      if (url) {
        const a = el('a', 'btn-link', 'Open its page');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        return a;
      }
      if (j && ['queued', 'running'].includes(j.status) && !(j.fired && j.fired.ok === false))
        return btn('Making its page…', null, { disabled: true });
      return btn('Share as a page', ev =>
        guard(ev.target, async () => {
          const r = await startJob({
            kind: 'share-set',
            title: 'Share: ' + (set.title || set.id),
            brief: set.id + ': share it as a page for classmates',
          });
          toast(
            r.fired.ok
              ? 'Making a page of it. It stays private until you share it.'
              : 'Couldn’t start it: ' + fireCopy(r.fired.error)
          );
        })
      );
    }
    function renderPlan() {
      const card = $('plan-card');
      // B-194: the plan a card opened (or he switched to) first; else the target exam's; else the newest.
      const plan =
        (ui.planShown && S.plans.find(p => p.id === ui.planShown)) ||
        (M.target && S.plans.find(p => (p.exam || p.id) === M.target.id)) ||
        S.plans
          .slice()
          .sort((a, b) => String((b.days || [])[0]?.date).localeCompare(String((a.days || [])[0]?.date)))[0];
      ui.planPanel = null;
      if (!plan) {
        $('plan-lab').textContent = 'Plan';
        card.replaceChildren(el('p', 'empty', 'The exam plan appears here once it’s in the record.'));
        return;
      }
      const tasks = E.planTasks(plan);
      const isDone = t => !!(plan.done && plan.done[t.id]) || E.taskDone(plan, t, today, S.sets, S.answers);
      const doneN = tasks.filter(isDone).length;
      const ex = S.exams.find(e => e.id === (plan.exam || plan.id)),
        exDay = ex && ex.date ? (ex.title || ex.id).replace(/:.*$/, '') + ' · ' + short(ex.date) : '';
      // B-126 (D-165): led by its count and exam day; open items as ticks by day; Done and Earlier days fold; no paragraph
      // on how ticks work and no pills.
      const tickRow = (d, t0) => {
        const t = { ...t0, date: d.date },
          on = isDone(t);
        const li = row({
          title: t.text,
          cls: 'plan-item' + (on ? ' done' : ''),
          check: {
            checked: on,
            label: 'Done: ' + t.text,
            onChange: (v, c) => guard(c, () => tickPlan(plan, t, v), v ? 'Checked off' : 'Unchecked'),
          },
        });
        const tt = li.querySelector('.title');
        tt.title = t.text;
        tt.addEventListener('click', () => li.classList.toggle('open'));
        return li;
      }; // one line; a tap on the words opens it in place
      const dayBlock = (d, list) => {
        const wrap = el('div', 'plan-day' + (d.date === today ? ' today' : ''));
        wrap.append(
          el(
            'div',
            'dayh plan-dh',
            [d.label, short(d.date) + (d.date === today ? ' · today' : ''), d.dayLabel].filter(Boolean).join(' · ')
          )
        );
        const ul = el('ul', 'list'),
          k = 'plan:' + d.date,
          all = !!sumOpen[k];
        (all ? list : list.slice(0, 5)).forEach(t => ul.append(tickRow(d, t)));
        wrap.append(ul);
        if (list.length > 5)
          wrap.append(
            foldLine(all ? 'Fewer' : list.length - 5 + ' more', all, () => {
              sumOpen[k] = !all;
              render();
            })
          );
        return wrap;
      };
      // B-348 (D-312): the strip names the plan; its summary (title, count, exam day, other plans, the original page) is
      // the panel's card from 1200 px and leads the rows below that; the days are quiet heads over full-width rows.
      $('plan-lab').textContent = 'Plan' + (ex ? ' · ' + (ex.title || ex.id).replace(/:.*$/, '') : '');
      const summaryCard = () => {
        const sm = el('div', 'ov-detail plan-sum');
        sm.append(el('span', 'lab', plan.title || 'Exam plan'), el('div', 'big plan-lead', `${doneN} of ${tasks.length} done`));
        if (exDay) sm.append(el('span', 'mini', exDay));
        // B-194: every other plan in force, one line each, to switch to (a dosage plan beside the exam's).
        const others = S.plans.filter(p => p.id !== plan.id);
        if (others.length) {
          const sw = el('p', 'mini plan-others');
          sw.append('Other plans: ');
          others.forEach((p, i) => {
            if (i) sw.append(' · ');
            sw.append(
              btn(
                p.title || 'Exam plan ' + (p.exam || p.id),
                () => {
                  ui.planShown = p.id;
                  render();
                },
                { cls: 'tlink' }
              )
            );
          });
          sm.append(sw);
        }
        if (plan.sourceUrl) {
          const a = el('a', 'mini', 'Original plan page');
          a.href = plan.sourceUrl;
          a.target = '_blank';
          a.rel = 'noopener';
          sm.append(a);
        }
        return sm;
      };
      const kids = [summaryCard()];
      ui.planPanel = summaryCard();
      const upcoming = plan.days.filter(d => d.date >= today),
        past = plan.days.filter(d => d.date < today);
      for (const d of upcoming) {
        const open = d.tasks.filter(t => !isDone({ ...t, date: d.date }));
        if (open.length) kids.push(dayBlock(d, open));
      }
      const doneItems = upcoming.flatMap(d => d.tasks.filter(t => isDone({ ...t, date: d.date })).map(t => [d, t]));
      if (doneItems.length) {
        const open = !!ui.planDoneOpen,
          ul = el('ul', 'list');
        ul.hidden = !open;
        doneItems.forEach(([d, t]) => ul.append(tickRow(d, t)));
        kids.push(
          foldLine('Done · ' + doneItems.length, open, () => {
            ui.planDoneOpen = !open;
            render();
          }),
          ul
        );
      }
      if (past.length) {
        const open = !!ui.planPastOpen,
          box = el('div', 'plan-past');
        box.hidden = !open;
        past
          .slice()
          .reverse()
          .forEach(d => {
            const w = el('div', 'plan-was');
            w.append(el('div', 'dayh plan-dh', [d.label, short(d.date)].filter(Boolean).join(' · ')));
            const ul = el('ul', 'list');
            d.tasks.forEach(t => ul.append(tickRow(d, t)));
            w.append(ul);
            box.append(w);
          });
        kids.push(
          foldLine('Earlier days · ' + past.length, open, () => {
            ui.planPastOpen = !open;
            render();
          }),
          box
        );
      }
      card.replaceChildren(...kids); // D-249: Plan is its own tab at every width
    }

    // More practice: asks Claude from the page, validated by E.V. core before it's saved.
    let morePending = false;
    // B-43 (D-100): make_practice on dosage. Five numeric items, each on a passage of his dosage material (never the
    // syllabus, a calendar, drug cards or a medication table); none when the library has no dosage material.
    async function moreDosage(opt, { say, out }) {
      const L = await library().catch(() => null);
      const mats = ((L && L.mats) || []).filter(m => E.isDosageMaterial(m));
      if (!mats.length) {
        out.textContent = 'No dosage material in your library yet.';
        say(
          'Your library has no dosage material to work from, so I won’t make up dosage math. Attach the dosage chapter or handout and ask again.'
        );
        return false;
      }
      const cfg = EV_SPEC.items.dosage || {};
      const hits = E.searchLibrary(E.libraryIndex(E.libraryChunks(mats)), `${cfg.query || ''} ${opt.topic || ''}`, {
        k: 6,
      });
      const passages = hits.map(h => ({
        ref: 'materials/' + h.id,
        page: h.page || null,
        title: h.title,
        text: String(h.text).slice(0, 600),
      }));
      const refs = new Set(passages.map(p => p.ref));
      const ex = S.exams
        .filter(e => e.kind === 'dosage' && e.date >= today)
        .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      const prompt = [
        'You write dosage calculation practice for Matt, a first-semester ADN nursing student. Return JSON only.',
        ex ? `Exam: ${ex.title} on ${ex.date}.` : '',
        'He asked for: ' + String(opt.topic).slice(0, 200),
        'Passages from his dosage material (ground every question in one; work the numbers with its method): ' +
          JSON.stringify(passages),
        'Write exactly 5 numeric questions. Each: type "numeric"; stem with the order, what is on hand and the rounding asked for; answer (a number); unit, one of ' +
          JSON.stringify(EV_SPEC.items.units) +
          '; tolerance (half the rounding step: 0.05 for tenths, 0.5 for whole drops, 0 when exact); steps (the worked solution, one line each); objective (or omit); topic (short); cjStep "take-action"; sourceRef, the ref of the passage it rests on. Never from his medication table or drug cards, never graded work.',
        'Rules: ' + (EV_SPEC.items.writingGuide || []).join(' '),
        'Shape: {"items":[{"type":"numeric","topic":"...","stem":"...","answer":10,"unit":"mL","tolerance":0.05,"steps":["..."],"cjStep":"take-action","sourceRef":"materials/<id>"}]}',
      ]
        .filter(Boolean)
        .join('\n');
      const res = await sample.json(prompt, { modelTier: 'default', cache: false });
      const fresh = (res && Array.isArray(res.items) ? res.items : [])
        .map((q, i) => ({ ...q, id: 'm' + (i + 1), kind: 'check', type: 'numeric' }))
        .filter(q => E.validateItem(q).ok && refs.has(q.sourceRef));
      if (!fresh.length) {
        out.textContent = 'That batch didn’t come back in a usable shape. Try again in a moment.';
        say('That batch came back without usable numbers, so I binned it. Ask again in a moment.');
        return false;
      }
      const n = S.sets.filter(s => s.kind === 'more' && s.date === today).length + 1;
      const id = `more-${today}-${n}`;
      await write({
        op: 'set',
        collection: 'sets',
        id,
        data: {
          ...envelope('More practice'),
          schema: 3,
          kind: 'more',
          date: today,
          ...(ex ? { exam: ex.id } : {}),
          title: 'Dosage practice · ' + short(today) + (n > 1 ? ' · ' + n : ''),
          createdAt: now(),
          items: fresh,
        },
      });
      out.textContent = plural(fresh.length, 'question') + ' ready in Practice.';
      if (opt.announce)
        await say(plural(fresh.length, 'dosage question') + ', each worked out after you answer.', [
          { type: 'set', id },
        ]);
      else {
        ui.openSet = id;
        setStudy('practice');
      }
      render();
      return true;
    }
    async function morePractice(opt = {}) {
      // opt: {announce: post the result in E.V.'s conversation, topic: a focus he named}
      if (morePending || !sample) return false;
      morePending = true;
      const b = $('more-btn'),
        out = $('more-status');
      b.disabled = true;
      out.textContent = 'Writing 5 questions…';
      const say = (text, cards) => (opt.announce ? evSay(text, cards || [], { tier: 'default' }) : null);
      try {
        if (E.isDosageTopic(opt.topic)) return await moreDosage(opt, { say, out });
        const ex = M.target;
        const exId = ex ? ex.id : null;
        const objs = S.objectives
          .filter(o => !exId || o.exam === exId)
          .map(o => ({ id: o.id, text: o.text, chapters: o.chapters }));
        const answeredToday = new Set(
          M.attempts.all
            .filter(a => a.date === today)
            .map(a => a.weakspotId)
            .filter(Boolean)
        );
        const targets = M.models
          .filter(w => E.isActive(w) && (!exId || E.examOf(w) === exId) && !answeredToday.has(w.id))
          .sort(
            (x, y) =>
              String(x.derived.nextDue || '9').localeCompare(String(y.derived.nextDue || '9')) ||
              (x.derived.streak || 0) - (y.derived.streak || 0)
          )
          .slice(0, 4)
          .map(w => ({ weakspotId: w.id, topic: w.topic, objective: w.objective }));
        const st = E.answerStats(M.attempts.all).byObjective;
        let weakest = null;
        // B-72 (D-120): the weakest objective the latest weekly measured, when there is one; else what the page counts.
        const wk = [...(S.weeks || [])]
          .filter(w => w.insights && w.insights.weakestObjective)
          .sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)))[0];
        const wo = wk && wk.insights.byObjective.find(o => o.id === wk.insights.weakestObjective);
        if (wo) weakest = { id: wo.id, r: wo.right, n: wo.n };
        else
          for (const [id, s] of Object.entries(st))
            if (s.n >= 2 && (!weakest || s.right / s.n < weakest.r / weakest.n)) weakest = { id, r: s.right, n: s.n };
        const formats = M.models.filter(w => w.kind === 'format' && w.derived.status === 'open').map(w => w.topic);
        const prompt = [
          'You write NCLEX-style practice questions for Matt, a first-semester ADN nursing student (' +
            E.defaultCourse() +
            '). Return JSON only.',
          ex ? `Exam: ${ex.title} on ${ex.date}.` : '',
          'Objectives: ' + JSON.stringify(objs),
          'Weak spots to target first, one question each (copy weakspotId, topic and objective exactly): ' +
            JSON.stringify(targets),
          weakest
            ? `Weakest objective so far: ${weakest.id} (${weakest.r} of ${weakest.n} right). Use any remaining questions on it, as new checks.`
            : '',
          formats.length
            ? 'He misses these formats, so make about half select-all or matrix: ' + formats.join('; ')
            : '',
          opt.topic
            ? 'He asked to focus on: ' +
              String(opt.topic).slice(0, 200) +
              '. Keep every question on that topic; use a matching weak spot id only when it truly matches.'
            : '',
          'Rules: ' + (EV_SPEC.items.writingGuide || []).join(' '),
          'Write exactly 5 questions. "single": 4 to 6 options, exactly one correct. "sata": 5 or 6 options, 2 or more correct, never "select N". "matrix": 2 to 3 columns and 3 to 5 rows, one correct column per row. A rationale for every option or row. Tag each with one cjStep from ' +
            JSON.stringify(E.CJ_STEPS) +
            '. Set verify true when the point relies on general knowledge rather than his chapters. No graded coursework.',
          'Shape: {"items":[{"weakspotId":"<id or omit>","objective":"E4-3","topic":"<short>","type":"single"|"sata","stem":"...","options":["..."],"correct":[0],"rationales":["..."],"cjStep":"analyze-cues","verify":false} or {"type":"matrix","objective":"...","topic":"...","stem":"...","matrix":{"columns":["Expected","Unexpected"],"rows":[{"text":"...","correct":0,"rationale":"..."}]},"cjStep":"recognize-cues","verify":false}]}',
        ]
          .filter(Boolean)
          .join('\n');
        const res = await sample.json(prompt, { modelTier: 'default', cache: false });
        const n = S.sets.filter(s => s.kind === 'more' && s.date === today).length + 1;
        const id = `more-${today}-${n}`;
        const fresh = (res && Array.isArray(res.items) ? res.items : [])
          .map((q, i) => ({ ...q, id: 'm' + (i + 1), kind: q.weakspotId ? 'review' : 'check' }))
          .filter(q => E.validateItem(q).ok)
          .map(q => E.crossCourse(q, { materials: LIB.mats || [], exams: S.exams })) // B-193 (D-205)
          .filter(c => !c.errors.length)
          .map(c => c.item)
          .filter(q => !q.weakspotId || M.models.some(w => w.id === q.weakspotId));
        if (!fresh.length) {
          out.textContent = 'That batch didn’t come back in a usable shape. Try again in a moment.';
          say('That batch came back malformed, so I binned it. Ask again in a moment.');
          return false;
        }
        await write({
          op: 'set',
          collection: 'sets',
          id,
          data: {
            ...envelope('More practice'),
            schema: 3, // B-43, B-75
            kind: 'more',
            date: today,
            ...(exId ? { exam: exId } : {}),
            title: 'More practice · ' + short(today) + (n > 1 ? ' · ' + n : ''),
            createdAt: now(),
            items: fresh,
          },
        });
        out.textContent = plural(fresh.length, 'question') + ' ready in Practice.';
        if (opt.announce)
          await say(
            `${plural(fresh.length, 'new question')}${opt.topic ? ' on ' + String(opt.topic).slice(0, 60) : ', aimed at your most due spots'}. Fresh off the line.`,
            [{ type: 'set', id }]
          );
        else {
          ui.openSet = id;
          setStudy('practice');
        }
        render();
        return true;
      } catch (e) {
        out.textContent =
          e && e.code === 'rate_limited'
            ? 'You’ve hit a usage limit for now. Try again later.'
            : e && e.code === 'not_granted'
              ? 'More practice needs permission to ask Claude. Allow it from the page’s Permissions menu.'
              : 'Couldn’t write questions right now. Try again in a moment.';
        say(out.textContent);
        return false;
      } finally {
        morePending = false;
        b.disabled = false;
      }
    }
    // B-42 (D-099): the course select reads spec.courses: its active courses, the default first.
    $('d-course').replaceChildren(
      ...E.activeCourses()
        .sort((a, b) => (b === E.defaultCourse()) - (a === E.defaultCourse()))
        .map(c => {
          const o = document.createElement('option');
          o.textContent = c;
          return o;
        })
    );
    $('more-btn').addEventListener('click', () => morePractice());
    $('study-back').addEventListener('click', () => {
      ui.openSet = null;
      ui.openObj = null;
      setStudy('objectives');
      render();
    });
    $('study-start').addEventListener('click', ev => {
      const b = ev.currentTarget;
      showTab('ev');
      guard(b, () => quick('Start a study session'));
    });
    $('weak-quizlet-btn').addEventListener('click', () => copyQuizlet($('weak-quizlet')));
    $('weak-quiz').addEventListener('click', ev => weakQuizAll(ev.currentTarget));
    $('study-qweak').addEventListener('click', () => {
      ui.openSet = null;
      ui.openObj = null;
      setStudy('weak');
      render();
    });
    $('study-qquiz').addEventListener('click', ev =>
      ui.study === 'objectives' ? courseQuiz(ev.currentTarget) : weakQuizAll(ev.currentTarget)
    );
    $('plan-back').addEventListener('click', () => {
      setStudy('objectives');
      render();
    });
    $('weak-back').addEventListener('click', () => {
      setStudy('objectives');
      render();
    });

