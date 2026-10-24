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
              : 'Today’s review appears after the 4:25am run.' + (due ? ' ' + plural(due, 'weak spot') + ' due.' : '')
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
    const openObjRows = new Set();
    function syncStudyBar() {
      const v = ui.study,
        quiz = v === 'review' || v === 'practice';
      $('study-back').hidden = !quiz;
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
    function renderObjectives() {
      const card = $('ov-card'),
        list = studyCourses();
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
      if (!cur) {
        card.replaceChildren(el('p', 'empty', 'Objectives appear once an upcoming exam has them.'));
        return;
      }
      const ex = cur.exam,
        acc = E.answerStats(M.attempts.all).byObjective;
      const objs = S.objectives
        .filter(o => o.exam === ex.id)
        .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
      const rows = objs.map(o => ({ o, ...objState(o, acc[o.id]) }));
      const n = k => rows.filter(r => r.state === k).length;
      const pctOf = k => (rows.length ? (100 * n(k)) / rows.length : 0) + '%';
      const days = E.diffDays(today, ex.date);
      const head = el('div', 'ov-head');
      head.append(
        el('b', 'ov-ex', (ex.title || ex.id).replace(/:.*$/, '')),
        el(
          'span',
          'meta',
          short(ex.date) + ' · ' + (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days')
        ),
        el('span', 'meta ov-count', n('solid') + ' of ' + rows.length + ' solid')
      );
      const bar = el('div', 'pbar ov-bar');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `${n('solid')} solid, ${n('almost')} almost, ${n('notyet')} not yet`);
      const g = el('i', 'x-green'),
        y = el('i', 'x-yellow');
      g.style.width = pctOf('solid');
      y.style.width = pctOf('almost');
      bar.append(g, y);
      const box = el('div', 'ov-rows');
      for (const r of rows) {
        const [word, cls] = OBJ_STATE[r.state];
        const on = openObjRows.has(r.o.id);
        const wrap = el('div', 'ov' + (on ? ' open' : ''));
        wrap.dataset.id = r.o.id;
        const li = el('div', 'li ov-li');
        const nm = el('button', 'nm ov-nm', r.o.text || r.o.id);
        nm.type = 'button';
        nm.title = r.o.text || r.o.id;
        nm.setAttribute('aria-expanded', String(on));
        nm.addEventListener('click', () => {
          on ? openObjRows.delete(r.o.id) : openObjRows.add(r.o.id);
          render();
        });
        const q = btn('Quiz me', ev => quizObjective(r.o, ev.currentTarget), { cls: 'btn ghost sm hov ov-q' });
        q.setAttribute('aria-label', 'Quiz me on ' + (r.o.text || r.o.id));
        li.append(
          el('span', 'badge ov-st' + (cls ? ' ' + cls : ''), word),
          nm,
          el('span', 't', r.open.length ? plural(r.open.length, 'weak spot') : ''),
          q
        );
        wrap.append(li);
        if (on) {
          const more = el('div', 'ov-more');
          const a = acc[r.o.id];
          more.append(el('p', 'meta', [r.o.id, a ? `${a.right} of ${a.n} right` : 'no answers yet'].join(' · ')));
          if (r.open.length) {
            const ul = el('ul', 'ov-ws');
            r.open.forEach(w =>
              ul.append(
                el('li', null, w.topic + ' · ' + ((w.derived.streak || 0) > 0 ? 'right once' : 'not yet right'))
              )
            );
            more.append(ul);
          }
          const q2 = btn('Quiz me', ev => quizObjective(r.o, ev.currentTarget), { cls: 'btn neutral sm' });
          q2.setAttribute('aria-label', 'Quiz me on ' + (r.o.text || r.o.id));
          more.append(q2);
          wrap.append(more);
        }
        box.append(wrap);
      }
      card.replaceChildren(head, bar, box);
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
    function practiceLine(x, o = {}) {
      // a set as one line, opening in place to its actions
      const items = E.validItems(x),
        ans = answersOf(x),
        n = items.filter(q => ans[q.id]).length,
        r = items.filter(q => ans[q.id] && ans[q.id].correct).length;
      const k = 'pr:' + x.id,
        open = !!sumOpen[k];
      const li = el('li', 'row pr-item' + (open ? ' open' : ''));
      li.dataset.id = x.id;
      const line = el('button', 'pr-line');
      line.type = 'button';
      line.setAttribute('aria-expanded', String(open));
      line.append(
        el('span', 'pr-t', x.title || x.id),
        el(
          'span',
          'pr-s',
          n === items.length
            ? r + ' of ' + n + ' right'
            : n
              ? n + ' of ' + items.length
              : plural(items.length, 'question')
        )
      );
      line.addEventListener('click', () => {
        sumOpen[k] = !open;
        render();
      });
      const acts = el('div', 'pr-acts');
      acts.hidden = !open;
      if (n === items.length)
        acts.append(
          btn('Review', () => {
            ui.openSet = x.id;
            views['pr-' + x.id] = '__summary';
            render();
          }),
          btn('Retake', () => {
            ui.openSet = x.id;
            retake(x, 'pr-' + x.id);
          })
        );
      else
        acts.append(
          btn(n ? 'Continue' : 'Start', () => {
            ui.openSet = x.id;
            render();
          })
        );
      const g = el('div', 'grow');
      g.append(line, acts);
      li.append(g);
      return li;
    }
    function renderPractice() {
      const body = $('pr-body');
      const list = practiceSets();
      const d = ui.openSet && list.find(x => x.id === ui.openSet);
      // B-297: a set opened by an objective's Quiz me holds that objective's questions only
      const of = d && ui.openObj && ui.openObj.set === d.id ? ui.openObj : null;
      if (!of) ui.openObj = null;
      $('pr-prog').hidden = !d;
      // B-191 (D-160): an open set folds back into the list from its own head line (its title with a chevron), never a
      // Close button; every answer stays saved (each is written as he checks it) and it reopens on the question he left.
      let fold = $('pr-fold');
      if (!fold) {
        fold = foldLine('', true, () => {
          const id = fold.dataset.set || '';
          ui.openSet = null;
          render();
          const li = document.querySelector('#pr-body [data-id="' + CSS.escape(id) + '"]');
          if (li) li.scrollIntoView({ block: 'nearest' });
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
        fold.setAttribute(
          'aria-label',
          (d.title || 'This set') + ': fold it back into the list; your answers are kept'
        );
      }
      if (!d) {
        if ($('pr-share')) $('pr-share').hidden = true;
        $('pr-title').textContent = 'Drills and practice';
        $('pr-count').textContent = list.length ? plural(list.length, 'set') : '';
        if (!list.length) {
          body.replaceChildren(
            el('p', 'empty', 'E.V. builds drills from your exam plan, and More practice adds sets here.')
          );
          return;
        }
        // B-126 (D-165): led by the set to do next and its Start; the other open sets one line each; finished sets fold,
        // each opening to Review and Retake. No pills: the titles already say Drill or More practice.
        const todo = list.filter(unfinished),
          done = list.filter(x => !unfinished(x)),
          kids = [];
        const lead = todo[0],
          box = el('div', 'pr-lead');
        if (lead) {
          const items = E.validItems(lead),
            ans = answersOf(lead),
            n = items.filter(q => ans[q.id]).length;
          box.append(
            el('p', 'big', lead.title || lead.id),
            el(
              'p',
              'meta',
              [plural(items.length, 'question'), n ? n + ' answered' : '', lead.exam, short(lead.createdAt)]
                .filter(Boolean)
                .join(' · ')
            ),
            btn(
              n ? 'Continue' : 'Start',
              () => {
                ui.openSet = lead.id;
                render();
              },
              { primary: true }
            )
          );
        } else box.append(el('p', 'big', 'Every set is done'), ...(sample ? [giveFive()] : []));
        kids.push(box);
        if (todo.length > 1) {
          const ul = el('ul', 'list');
          todo.slice(1, 6).forEach(x => ul.append(practiceLine(x)));
          kids.push(ul);
        }
        if (done.length) {
          const open = !!ui.prDoneOpen,
            ul = el('ul', 'list');
          ul.id = 'pr-done';
          ul.hidden = !open;
          done.forEach(x => ul.append(practiceLine(x)));
          const f = foldLine(plural(done.length, 'finished set'), open, () => {
            ui.prDoneOpen = !open;
            render();
          });
          f.id = 'pr-done-fold';
          f.setAttribute('aria-controls', 'pr-done');
          kids.push(f, ul);
        }
        body.replaceChildren(...kids);
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
        more: sample ? giveFive : null,
        next: nextSet(d.id),
        summaryExtra: () => {
          const a = el('div', 'actions');
          const sh = shareButton(d);
          a.append(
            btn('All sets', () => {
              delete retakes[d.id];
              ui.openSet = null;
              render();
            }),
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
      if (!plan) {
        card.replaceChildren(
          el('h2', null, 'Exam plan'),
          el('p', 'empty', 'The exam plan appears here once it’s in the record.')
        );
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
            'p',
            'meta plan-dh',
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
      const head = el('div', 'card-head');
      head.append(el('h2', null, plan.title || 'Exam plan'));
      const kids = [head, el('p', 'big plan-lead', `${doneN} of ${tasks.length} done`)];
      if (exDay) kids.push(el('p', 'meta', exDay));
      // B-194: every other plan in force, one line each, to switch to (a dosage plan beside the exam's).
      const others = S.plans.filter(p => p.id !== plan.id);
      if (others.length) {
        const sw = el('p', 'meta plan-others');
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
        kids.push(sw);
      }
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
            w.append(el('p', 'meta plan-dh', [d.label, short(d.date)].filter(Boolean).join(' · ')));
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
      if (plan.sourceUrl) {
        const a = el('a', 'meta', 'Original plan page');
        a.href = plan.sourceUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        kids.push(a);
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

