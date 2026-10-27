    // ------------------------------------------------------------ Study
    // B-126 (D-165): the set to do next: the newest set with a question left, other than the one he is on.
    const unfinished = s => E.validItems(s).some(q => !answersOf(s)[q.id]);
    const practiceSets = () =>
      S.sets
        .filter(s => s.kind !== 'review' && E.validItems(s).length)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const nextSet = except => practiceSets().find(s => s.id !== except && unfinished(s)) || null;
    // B-370 (D-316): the demo's mini quiz: up to five one-answer questions from one set, each answered on a tap; an
    // objective's own questions lead. Questions he answered before fill in only when too few are new, as a retake
    // (D-095), so each shows fresh; every answer is written as always.
    const oneAnswer = s => E.validItems(s).filter(q => E.itemType(q) === 'single');
    let miniN = 0;
    function startMini(set, label, lead) {
      const ans = answersOf(set),
        all = oneAnswer(set),
        mine = lead ? all.filter(lead) : [],
        rest = all.filter(q => !mine.includes(q)),
        fresh = qs => qs.filter(q => !ans[q.id]),
        seen = qs => qs.filter(q => ans[q.id]),
        pick = [...fresh(mine), ...seen(mine), ...fresh(rest), ...seen(rest)].slice(0, 5);
      if (!pick.length) return false;
      if (pick.some(q => ans[q.id])) retakes[set.id] = now();
      ui.mini = { set: set.id, ids: pick.map(q => q.id), label, n: ++miniN };
      ui.openSet = set.id;
      ui.openObj = null;
      setStudy('practice');
      render();
      return true;
    }
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
        newQuiz: () => courseQuiz(),
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
    /** B-371 (D-316): a weak spot's course (its own, else its exam's) and the open ones in a course, as the demo's
     *  "Open · N in NUR 112"; a spot with no course counts in every course, so none is hidden. */
    function wsCourse(w) {
      if (w.course) return w.course;
      const ex = S.exams.find(e => e.id === w.exam);
      return ex ? E.courseOf(ex) : null;
    }
    function openInCourse(course) {
      return M.models
        .filter(w => E.isActive(w) && !w.derived.preRead && (!course || !wsCourse(w) || wsCourse(w) === course))
        .sort(
          (a, b) =>
            String(a.derived.nextDue || '9').localeCompare(String(b.derived.nextDue || '9')) ||
            String(b.addedAt || '').localeCompare(String(a.addedAt || ''))
        );
    }
    /** B-407 (D-237): her proposed spots waiting for his triage in a course (a snooze run out is back), as the demo's
     *  "To review · N"; a spot with no course shows in every course. */
    function reviewInCourse(course) {
      return E.toReview(M ? M.models : [], today).filter(
        w => (w.kind || 'concept') === 'concept' && (!course || !wsCourse(w) || wsCourse(w) === course)
      );
    }
    function syncStudyBar() {
      const v = ui.study,
        quiz = v === 'review' || v === 'practice';
      $('study-back').hidden = !quiz;
      // B-348 (D-312): the quiz's strip, as the demo's: All topics, what is open, Quiz me (a practice set's way to today's
      // review) and Weak spots with its count
      const pr = v === 'practice' && S.sets.find(s => s.id === ui.openSet);
      const mini = pr && ui.mini && ui.mini.set === pr.id ? ui.mini : null;
      $('study-qlab').hidden = !quiz;
      $('study-qlab').textContent =
        v === 'review'
          ? 'Today’s review · ' + short(today)
          : mini
            ? mini.label
            : pr
              ? (ui.openObj && ui.openObj.text) || pr.title || 'Practice'
              : '';
      // B-351 (D-313): on the overview the strip is the demo's: the course switch, Quiz me, Weak spots · N, Start session
      const ov = v === 'objectives';
      $('study-qquiz').hidden = !quiz && !ov;
      let nW = 0,
        nR = 0;
      try {
        nW = M ? openInCourse(ui.studyCourse).length : 0; // B-371: the same N as Weak spots' "Open · N in <course>"
        nR = M ? reviewInCourse(ui.studyCourse).length : 0; // B-407: and the demo's "· 1 to review"
      } catch {
        nW = nR = 0; // the bar can sync before the model is first built
      }
      $('study-qweak').hidden = !quiz && !ov;
      $('study-qweak').textContent =
        'Weak spots' + (nW || nR ? ' · ' + nW : '') + (nR ? ' · ' + nR + ' to review' : '');
      // in the quiz card the way back replaces the view tabs, so no switch shows with nothing picked (C-15)
      $('seg-study').hidden = quizOpen('study') || (innerWidth >= 600 && ui.tab !== 'study');
      $('study-course').hidden = v !== 'objectives' || $('study-course').children.length < 2;
      $('study-start').hidden = v !== 'objectives' || $('study-start').dataset.off === '1';
    }
    /** B-351 (D-313): the courses with an upcoming exam, objectives or not (Matt's record has none), each with its
     *  soonest; the overview's course switch and exam card read this. */
    function studyExams() {
      const out = [];
      for (const c of E.activeCourses()) {
        const ex = S.exams
          .filter(e => e.date && e.date >= today && E.courseOf(e) === c && e.status !== 'done')
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        out.push({ course: c, exam: ex || null }); // B-365: every course shows in the switch, an exam or not
      }
      return out;
    }
    /** B-365 (D-316): her line under Study's header, as the demo's: the quiz's rule in a quiz, how a weak spot closes on
     *  Weak spots, and on the overview the course's exam: its objectives not yet solid, or (none in the record) its plan. */
    function examPlan(ex) {
      return (
        S.plans.find(p => (p.exam || p.id) === ex.id) ||
        S.plans
          .filter(p => !p.exam && (p.days || []).some(d => d.date <= ex.date && d.date >= E.addDays(ex.date, -21)))
          .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0] ||
        null
      );
    }
    function studyLine() {
      if (ui.study === 'review' || ui.study === 'practice')
        return quizAtEnd[ui.study === 'review' ? 'rv' : 'pr'] // B-370: the results card speaks for itself, as the demo's
          ? null
          : { text: 'Misses are proposed as weak spots. You review them once, at the end.' }; // B-407, as the demo's
      const prop = reviewInCourse(ui.studyCourse);
      if (ui.study === 'weak')
        return {
          text: prop.length
            ? prop.length + ' to review. Accept the real ones, join duplicates, and decline slips.'
            : 'Each closes after two right answers on different days.',
        };
      if (prop.length) {
        // B-407: on the overview her proposed spots lead, with Review (the demo's line)
        const fromS = prop.filter(w => w.origin && w.origin.session).length === prop.length;
        const n = prop.length;
        return {
          text:
            (fromS
              ? n === 1
                ? '1 weak spot from your note session'
                : n + ' weak spots from your note sessions'
              : plural(n, 'weak spot')) + ' to review.',
          act: [
            'Review',
            () => {
              setStudy('weak');
              render();
            },
          ],
        };
      }
      const cur = studyExams().find(x => x.course === ui.studyCourse);
      if (!cur) return null;
      if (!cur.exam) {
        // B-371: a course with no exam still has her line, as the demo's strip always does
        const n = openInCourse(cur.course).length;
        return {
          text: `${cur.course} has no exam in the record yet` + (n ? `, and ${plural(n, 'weak spot')} open.` : '.'),
          act: ['Quiz me', b => courseQuiz(b)], // B-375: Quiz me always opens a quiz
        };
      }
      const ex = (cur.exam.title || cur.exam.id).replace(/:.*$/, '');
      const objs = S.objectives.filter(o => o.exam === cur.exam.id);
      if (objs.length) {
        const acc = E.answerStats(M.attempts.all).byObjective;
        const weak = objs.filter(o => objState(o, acc[o.id]).state === 'notyet');
        if (!weak.length) return null;
        const text =
          weak.length === 1
            ? `One ${ex} objective is not yet solid: ${weak[0].text || weak[0].id}.`
            : `${numWord(weak.length)} ${ex} objectives are not yet solid.`;
        return { text, act: [weak.length === 1 ? 'Quiz me on it' : 'Quiz me on them', b => quizObjective(weak[0], b)] };
      }
      const plan = examPlan(cur.exam);
      const days = E.diffDays(today, cur.exam.date);
      const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
      if (!plan)
        return {
          text: `${cur.course} ${ex} is ${when}. Its objectives aren’t in the record yet.`,
          act: ['Quiz me', b => courseQuiz(b)], // B-375
        };
      const isDone = t => !!(plan.done && plan.done[t.id]) || E.taskDone(plan, t, today, S.sets, S.answers);
      const ts = (plan.days || []).flatMap(d => (d.tasks || []).map(t => ({ ...t, date: d.date })));
      const left = ts.filter(t => !isDone(t)).length;
      return {
        text: left
          ? `${cur.course} ${ex} is ${when}, with ${plural(left, 'plan task')} left.`
          : `${cur.course} ${ex} is ${when}, and its plan is done.`,
        act: ['Quiz me', b => courseQuiz(b)],
      };
    }
    /** An objective's state from its weak spots and answers: Not yet while one is not yet right (or none answered),
     *  Almost while its open ones are right once, Solid once none is open. */
    function objState(o, acc) {
      const ws = M.models.filter(
        w =>
          (w.kind || 'concept') === 'concept' &&
          w.objective === o.id &&
          w.derived &&
          !['parked', 'moved'].includes(w.derived.status) &&
          !E.untriaged(w) // B-232 (D-235): a spot waiting for his triage counts nowhere
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
      if (pick && startMini(pick, o.text || o.id, q => q.objective === o.id)) return; // B-370: as the demo's mini quiz
      if (pick) {
        ui.mini = null;
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
        ui.studyCourse =
          ((M.target && list.find(x => x.exam && x.exam.id === M.target.id)) || list.find(x => x.exam) || list[0] || {})
            .course || null;
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
      if (!cur || !cur.exam) {
        // B-371 (D-316): no placeholder card. Coming up and the mini quiz, and the course's own pane: in the right
        // panel from 1200 px, in the card's place below that
        const d = courseDetail(cur ? cur.course : null, PANEL.matches);
        card.classList.toggle('ov-course', !PANEL.matches);
        card.hidden = false;
        if (PANEL.matches) {
          // B-375: the main column keeps an exam card saying no exam yet, the course's pane beside it
          ui.objPanel = d;
          const head = el('div', 'ov-head'),
            nm0 = el('span', 'ov-name');
          nm0.append(el('b', 'ov-ex', cur ? cur.course : 'Your courses'), el('span', 'meta', ' · No exam yet'));
          head.append(nm0, el('span', 'meta ov-count', ''));
          const bar = el('div', 'pbar ov-bar');
          bar.setAttribute('role', 'img');
          bar.setAttribute('aria-label', 'No exam yet');
          card.replaceChildren(
            head,
            bar,
            el('p', 'empty ov-none', 'Its next exam, its objectives and its plan show here once they’re in the record.')
          );
        } else card.replaceChildren(d);
        renderStudyUp(cur ? cur.course : null);
        renderMiniQuiz(cur || null);
        return;
      }
      card.hidden = false;
      card.classList.remove('ov-course');
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
      card.replaceChildren(
        ...(items.rows.length ? [head, bar, box] : [head, bar, el('p', 'empty ov-none', items.none)])
      );
      // B-375: an exam with neither objectives nor a plan still fills the panel: the exam, its date and Quiz me
      if (PANEL.matches && !ui.objPanel) ui.objPanel = examDetail(ex, fullName, days);
      renderStudyUp(cur.course);
      renderMiniQuiz(cur);
    }
    /** B-375: the panel for an exam with no objectives and no plan, laid out as an objective's pane. */
    function examDetail(ex, fullName, days) {
      const d = el('div', 'ov-detail');
      d.append(el('span', 'lab', 'Exam'), el('div', 'od-name', fullName));
      const st = el('div', 'od-row');
      st.append(
        el('span', 'badge', 'No objectives yet'),
        el(
          'span',
          'mini',
          dayMonth(ex.date) + ' · ' + (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days')
        )
      );
      d.append(
        st,
        btn('Quiz me', ev => courseQuiz(ev.currentTarget), { cls: 'btn neutral od-q' }),
        el(
          'span',
          'mini od-note',
          'Quiz me opens ' +
            miniWords(studyExams().find(x => x.course === ui.studyCourse)) +
            ' from this course. Objectives show here once they’re in the record.'
        )
      );
      return d;
    }
    /** B-371: a course with no upcoming exam: its name, that no exam is in the record, its open weak spots and Quiz me,
     *  laid out as an objective's pane. */
    function courseDetail(course, inPanel) {
      const d = el('div', 'ov-detail');
      if (inPanel) d.append(el('span', 'lab', 'Course'));
      d.append(el('div', 'od-name', course || 'Your courses'));
      const st = el('div', 'od-row');
      st.append(
        el('span', 'badge', 'No exam yet'),
        el('span', 'mini', 'Its next exam shows here once it’s in the record.')
      );
      d.append(st);
      const open = course ? openInCourse(course) : [];
      if (open.length) {
        d.append(el('span', 'lab', 'Weak spots in it'));
        for (const w of open.slice(0, 5)) {
          const si = el('div', 'od-ws');
          si.title = w.topic || '';
          si.append(
            el('i', 'dot x-yellow'),
            el('span', 'sn', w.topic || w.id),
            el('span', 'st', (w.derived.streak || 0) > 0 ? 'right once' : 'open')
          );
          d.append(si);
        }
      }
      d.append(
        btn('Quiz me', ev => courseQuiz(ev.currentTarget), { cls: 'btn neutral od-q' }),
        el(
          'span',
          'mini od-note',
          open.length > 5
            ? 'And ' +
                plural(open.length - 5, 'more') +
                ' in Weak spots. Quiz me opens ' +
                miniWords(studyExams().find(x => x.course === course)) +
                ' from this course.'
            : 'Quiz me opens ' + miniWords(studyExams().find(x => x.course === course)) + ' from this course.'
        )
      );
      return d;
    }
    /** The exam card's objective rows: state badge, words, weak spots and Quiz me on hover; the picked one's detail
     *  fills the panel from 1200 px, or opens under its row. */
    function objRows(objs, acc, fullName) {
      const rows = objs.map(o => ({ o, ...objState(o, acc[o.id]) }));
      const n = k => rows.filter(r => r.state === k).length;
      const pctOf = k => (rows.length ? (100 * n(k)) / rows.length : 0) + '%';
      if (!rows.some(r => r.o.id === objSel)) objSel = null;
      if (PANEL.matches && !objSel)
        objSel = ((rows.find(r => r.state !== 'solid') || rows[0] || {}).o || {}).id || null;
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
        count:
          n('solid') + ' of ' + rows.length + ' objectives solid' + (n('almost') ? ', ' + n('almost') + ' almost' : ''),
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
      const plan = examPlan(ex);
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
          el('span', 'ow', (r.d.date === today ? 'today' : dayMonth(r.d.date)) + ' · ' + r.nDone + ' of ' + r.ts.length)
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
            el(
              'span',
              'mini od-note',
              'Tick what you’ve done in the plan. This exam has no objectives in the record yet.'
            )
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
      // B-370: the mini quiz answers on a tap, so only one-answer questions count; B-371: a course with no exam
      // finds no set of its own and takes today's review
      const left = s => oneAnswer(s).filter(q => !answersOf(s)[q.id]).length;
      const objIds = new Set(cur.exam ? S.objectives.filter(o => o.exam === cur.exam.id).map(o => o.id) : []);
      const mine = s =>
        (cur.exam && s.exam === cur.exam.id) ||
        s.focus === cur.course || // B-375: five Quiz me wrote for the course
        E.validItems(s).some(q => objIds.has(q.objective));
      const sets = practiceSets()
        .filter(s => mine(s) && oneAnswer(s).length)
        .sort((a, b) => left(b) - left(a));
      if (sets[0] && left(sets[0])) return { set: sets[0], review: false };
      const rs = S.sets.find(s => s.id === 'review-' + today);
      if (rs && oneAnswer(rs).length) return { set: rs, review: true };
      return sets[0] ? { set: sets[0], review: false } : null;
    }
    /** B-385: how many questions a course's mini quiz holds: up to five one-answer questions from its set, else the
     *  five E.V. writes when there is none. */
    function miniCount(cur) {
      const c = cur && courseSet(cur);
      return c ? Math.min(5, oneAnswer(c.set).length) : 5;
    }
    function miniWords(cur) {
      const n = miniCount(cur);
      return n === 1 ? 'one question' : numWord(n).toLowerCase() + ' questions';
    }
    function courseQuiz(b) {
      // B-370 (D-316): Quiz me, Take the quiz and New quiz start the demo's mini quiz for the course
      const cur = studyExams().find(x => x.course === ui.studyCourse);
      const c = cur && courseSet(cur);
      if (c && startMini(c.set, 'Mini quiz · ' + (cur.course || ui.studyCourse))) return;
      return weakQuizAll(b, cur ? cur.course : ui.studyCourse);
    }
    /** B-375: Quiz me with nothing to quiz on: E.V. writes five questions for the course (Give me 5 more's path, from
     *  its objectives, else its plan and materials) and opens them; never only a toast. */
    async function quizFive(b, course) {
      const was = b && b.textContent;
      if (b) ((b.disabled = true), (b.textContent = 'Writing 5 questions…'));
      $('more-status').textContent = '';
      const ok = await morePractice({ course: course || ui.studyCourse || E.defaultCourse() });
      if (b && b.isConnected) ((b.disabled = false), (b.textContent = was));
      if (!ok) toast($('more-status').textContent || 'Couldn’t write questions right now. Try again in a moment.');
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
        // B-371 (D-316): the demo's words
        el('span', 'lab', 'Mini quiz · ' + miniWords(cur) + ' from this course'), // B-385: the number it holds
        // B-375: with nothing waiting, Take the quiz writes five for the course
        el('div', 'mq-q', teaser || 'Five new questions from this course, written when you start.'),
        el('div', 'mini', 'Misses are proposed as weak spots, for you to review.') // B-407: as the answer's own write does
      );
      const r = el('div', 'mq-row');
      r.append(btn('Take the quiz', ev => courseQuiz(ev.currentTarget), { cls: 'btn neutral' }));
      card.append(r);
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
        ...S.exams.map(e => ({
          id: 'exam-' + e.id,
          date: e.date,
          title: e.title || e.id,
          kind: 'exam',
          course: e.course,
        })),
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
        const un = el('span', 'un');
        un.append(el('i', 'dot'), el('span', 'ut', d.title || ''));
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
     *  course", Quiz me), then the open spots in that course as full-width rows under one quiet head (B-371). An open row has its dot, its topic, a grey line (where it came from, how often, when
     *  it is next due, its objective), Drill and Mark solid. The side pane is the demo's
     *  How triage works (B-365, B-407). To review leads with her proposed spots (B-407). */
    const objText = id => (S.objectives.find(o => o.id === id) || {}).text || '';
    function weakQuizAll(b, course) {
      // today's review set aims at the most due spots; with none yet, five new questions for the course (B-375)
      const rs = S.sets.find(s => s.id === 'review-' + today);
      if (rs && E.validItems(rs).length) {
        setStudy('review');
        return render();
      }
      return quizFive(b, course);
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
        objText(w.objective), // B-365: an objective not in the record shows no bare id
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
        // B-365: every open row has Drill, as the demo: its objective's quiz, or today's review with no objective
        if (!d.preRead) {
          const dr = btn('Drill', ev => (o ? quizObjective(o, ev.currentTarget) : weakQuizAll(ev.currentTarget)), {
            cls: 'btn neutral sm',
          });
          dr.setAttribute('aria-label', 'Drill ' + (w.topic || 'this weak spot'));
          row.append(dr);
        }
        const ms = btn('Mark solid', ev => guard(ev.target, () => markSolid(w), 'Marked solid'), {
          cls: 'btn ghost sm',
        });
        ms.setAttribute('aria-label', 'Mark ' + (w.topic || 'this weak spot') + ' solid');
        row.append(ms);
      }
      return row;
    }
    /** B-407: one To review row. Accept counts it under its objective from tomorrow (off unless that objective is in the
     *  record); Join links it to the spot it nearly repeats (E.joinTarget: a concept, open or solid, same objective, at
     *  least 0.5 similar; off when none, the target named in its title); Not now hides it until tomorrow; Decline keeps
     *  it, uncounted. */
    const objKnown = w => !!w.objective && S.objectives.some(o => o.id === w.objective);
    function reviewRow(w) {
      const row = el('div', 'trow');
      row.dataset.id = w.id;
      const obj = objText(w.objective);
      const to = E.joinTarget(M.models, w); // B-407 review: never one naming the opposite (hypo/hyper, left/right, 1/2)
      const tx = el('div', 'tt');
      tx.append(
        el('span', 'wn', w.topic || 'Untitled'),
        el(
          'span',
          'mini',
          [
            // B-409: a greyed Accept says why, in sight
            !objKnown(w) ? 'Pick an objective first' : obj ? 'Under “' + obj + '”' : '',
            w.source,
            to ? 'Repeats “' + (to.topic || to.id) + '”?' : '', // what Join would join it to, in sight before the tap
          ]
            .filter(Boolean)
            .join(' · ')
        )
      );
      const name = w.topic || 'this weak spot';
      const tap = (label, aria, fn, cls = 'btn ghost sm') => {
        const b = btn(label, ev => guard(ev.currentTarget, fn), { cls });
        b.setAttribute('aria-label', aria);
        return b;
      };
      const acc = tap(
        'Accept',
        'Accept ' + name + (obj ? ' under ' + obj : ''),
        () => weakAct('weakspot-accept', { items: [{ id: w.id, objective: w.objective }] }),
        'btn neutral sm'
      );
      acc.disabled = !objKnown(w); // its objective is changed in B-235's surface; with none there is nothing to count under
      if (acc.disabled) {
        acc.title = 'Pick an objective first';
        acc.setAttribute('aria-label', 'Accept ' + name + ': pick an objective first');
      }
      const join = tap(
        'Join',
        to
          ? 'Join to “' + (to.topic || to.id) + '” (it’s a duplicate)'
          : 'Join: no weak spot under this objective repeats it',
        () => weakAct('weakspot-join', { id: w.id, to: to.id }) // B-233 review: join reads the spot's links itself
      );
      join.disabled = !to;
      join.title = to ? 'Join to “' + (to.topic || to.id) + '”' : 'Nothing under this objective repeats it';
      const acts = el('div', 'acts');
      acts.append(
        acc,
        join,
        tap('Not now', 'Not now: ' + name + ' comes back tomorrow', () =>
          weakAct('weakspot-snooze', { items: [{ id: w.id }], until: E.addDays(today, 1) })
        ),
        tap('Decline', 'Decline ' + name + ': kept, never counted', () =>
          weakAct('weakspot-decline', { items: [{ id: w.id }] })
        )
      );
      row.append(tx, acts);
      return row;
    }
    function renderWeak() {
      // B-371 (D-316): the demo's sections only: To review (B-407), then
      // Open · N in the course picked on the overview, then Quiz me on all of them. Previews, solid ones, notes and
      // skills stay in the record and in Progress; this screen doesn't list them.
      const course = ui.studyCourse || E.defaultCourse();
      const active = openInCourse(course);
      $('weak-lab').textContent = 'Weak spots' + (course ? ' · ' + course : '');
      const out = [];
      // B-407 (D-237, D-242): her proposed spots first, under "To review · N", absent at zero; each row is the demo's
      // trow (its topic, where it came from and its objective) with Accept, Join, Not now and Decline, through act()
      const prop = reviewInCourse(course);
      if (prop.length) {
        out.push(el('div', 'dayh', 'To review · ' + prop.length));
        for (const w of prop) out.push(reviewRow(w));
      }
      if (active.length) {
        out.push(el('div', 'dayh', 'Open · ' + active.length + (course ? ' in ' + course : '')));
        for (const w of active) out.push(wkRow(w));
        const all = el('div', 'wl wl-all');
        all.append(btn('Quiz me on all of them', ev => weakQuizAll(ev.currentTarget), { cls: 'btn neutral sm' }));
        out.push(all);
      } else out.push(el('div', 'empty', 'No weak spots open' + (course ? ' in ' + course : '') + '.'));
      $('weak-list').replaceChildren(...out);
      // B-365 (D-316): the side pane, in the demo's place. B-407: the demo's How triage works, now that a miss is
      // proposed and waits for his tap
      const p = el('div', 'ov-detail wk-side');
      p.append(el('span', 'lab', 'How triage works'));
      for (const t of [
        'Accept: it counts under her objective',
        'Join: a duplicate of an open one',
        'Not now: back tomorrow',
        'Decline: kept, never counted',
      ]) {
        const r = el('div', 'od-ws');
        r.append(el('i', 'dot'), el('span', 'sn', t));
        p.append(r);
      }
      p.append(el('span', 'mini od-note wk-decide', 'Nothing proposed counts until you decide.'));
      p.append(el('span', 'mini od-note', 'Quizlet stays yours: E.V. reads only its home page, on Saturdays.'));
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
      const mini = ui.mini && ui.mini.set === ui.openSet ? ui.mini : null; // B-370: a mini quiz may run on today's review
      const d = ui.openSet && (list.find(x => x.id === ui.openSet) || (mini && S.sets.find(x => x.id === mini.set)));
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
      const sh = mini ? null : shareButton(d);
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
      if (mini)
        return runner({
          key: 'pr-' + d.id + '#mini' + mini.n,
          set: d,
          items: mini.ids.map(id => E.validItems(d).find(q => q.id === id)).filter(Boolean),
          body,
          countEl: $('pr-qcount'),
          barEl: $('pr-bar'),
          label: 'E.V. · ' + mini.label,
          title: mini.label,
          scoreEl: $('pr-score'),
          newQuiz: () => courseQuiz(),
        });
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
        newQuiz: () => courseQuiz(),
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
        sm.append(
          el('span', 'lab', plan.title || 'Exam plan'),
          el('div', 'big plan-lead', `${doneN} of ${tasks.length} done`)
        );
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
          '; tolerance (half the rounding step: 0.05 for tenths, 0.5 for whole drops, 0 when exact); steps (the worked solution, one line each); objective (or omit); topic (short); cjStep "take-action"; sourceRef, the ref of the passage it rests on. Never from his medication table or drug cards.',
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
        // B-375: opt.course (Study's Quiz me with nothing to quiz on) writes for that course: its exam's objectives,
        // else its plan and its materials
        const cx = opt.course ? studyExams().find(x => x.course === opt.course) : null;
        const ex = opt.course ? (cx && cx.exam) || null : M.target;
        const exId = ex ? ex.id : null;
        const inCourse = o => {
          const oe = S.exams.find(e => e.id === o.exam);
          return !!oe && E.courseOf(oe) === opt.course;
        };
        const objs = S.objectives
          .filter(o => (exId ? o.exam === exId : !opt.course || inCourse(o)))
          .map(o => ({ id: o.id, text: o.text, chapters: o.chapters }));
        const plan = opt.course && !objs.length && ex ? examPlan(ex) : null;
        const planTasks = plan
          ? (plan.days || []).flatMap(d => (d.tasks || []).map(t => t.text || '')).filter(Boolean)
          : [];
        const mats =
          opt.course && !objs.length
            ? (LIB.mats || [])
                .filter(m => m.course === opt.course && m.text)
                .slice(0, 4)
                .map(m => `[${m.title || m.id}] ` + String(m.text).slice(0, 1500))
            : [];
        const courseIds = opt.course && !exId ? new Set(openInCourse(opt.course).map(w => w.id)) : null;
        const answeredToday = new Set(
          M.attempts.all
            .filter(a => a.date === today)
            .map(a => a.weakspotId)
            .filter(Boolean)
        );
        const targets = M.models
          .filter(
            w =>
              E.isActive(w) &&
              (exId ? E.examOf(w) === exId : !courseIds || courseIds.has(w.id)) &&
              !answeredToday.has(w.id)
          )
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
            (opt.course || E.defaultCourse()) +
            '). Return JSON only.',
          ex ? `Exam: ${ex.title} on ${ex.date}.` : '',
          'Objectives: ' + JSON.stringify(objs),
          opt.course && !objs.length
            ? 'No objectives are in his record for this course yet, so leave "objective" out and write from what follows.'
            : '',
          planTasks.length ? 'His study plan for the exam: ' + JSON.stringify(planTasks.slice(0, 20)) : '',
          mats.length ? 'His course materials (ground every question in these):\n' + mats.join('\n') : '',
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
            '. Set verify true when the point relies on general knowledge rather than his chapters.',
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
            ...(opt.course ? { focus: opt.course } : {}), // B-375: the course it was written for
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
          e && e.code === 'ceiling' && e.message
            ? e.message // B-418: the Worker's words
            : e && e.code === 'rate_limited'
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
    $('more-btn').addEventListener('click', () => morePractice());
    $('study-back').addEventListener('click', () => {
      ui.openSet = null;
      ui.openObj = null;
      ui.mini = null;
      setStudy('objectives');
      render();
    });
    $('study-start').addEventListener('click', ev => {
      const b = ev.currentTarget;
      if (notesOn()) {
        // B-408 (D-325): from 1024 px a session starts in Notes, on a new note
        const from = whereNow();
        showTab('notes');
        guard(b, () => newNote(from));
        return;
      }
      showTab('ev');
      guard(b, () => quick('Start a study session'));
    });
    $('weak-quiz').addEventListener('click', ev => weakQuizAll(ev.currentTarget));
    $('study-qweak').addEventListener('click', () => {
      ui.openSet = null;
      ui.openObj = null;
      setStudy('weak');
      render();
    });
    $('study-qquiz').addEventListener('click', ev => courseQuiz(ev.currentTarget)); // B-370: a new mini quiz
    $('plan-back').addEventListener('click', () => {
      setStudy('objectives');
      render();
    });
    $('weak-back').addEventListener('click', () => {
      setStudy('objectives');
      render();
    });

