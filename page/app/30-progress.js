    // ------------------------------------------------------------ Progress
    // B-301 (C-6): the period switch (this week, the month, the semester), its three property rows, the study-time
    // chart from his logged sessions, by course and exam readiness. A bar is the minutes of the study sessions that
    // fall in it, and the day panel lists exactly those sessions: workouts and notes are other collections and never
    // count. Nothing here is stored; the period is this device's (store).
    const PERIODS = { week: 'This week', month: 'Month', sem: 'Semester' };
    const prog = { period: PERIODS[store.get('prog.period')] ? store.get('prog.period') : 'week', pick: null };
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONL = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    // B-342: the demo's long headings, Friday 23 Oct, Week of 19 October (so far), October (so far)
    const longDay = d => WDL[E.weekday(d)] + ' ' + Number(d.slice(8)) + ' ' + MON[Number(d.slice(5, 7)) - 1];
    const soFar = (a, b) => (inSpan(today, a, b) ? ' (so far)' : '');
    const hm = m => {
      m = Math.round(m || 0);
      return durFmt(m);
    };
    const monthOf = d => d.slice(0, 7);
    const monthName = ym => MON[Number(ym.slice(5, 7)) - 1];
    const monthStart = ym => ym + '-01';
    const monthEnd = ym => E.addDays(monthStart(E.addDays(monthStart(ym), 32).slice(0, 7)), -1);
    const weekStart = d => E.addDays(d, -((E.weekday(d) + 6) % 7)); // Monday
    // B-522: study time is core's one measure (EVCore.studyTime): every session Record lists (a running one at its
    // clock), and today's ticked task minutes per course, a day and course taking the larger so nothing counts twice
    function studyTime() {
      const ds = dayState();
      const ticked = ds.items
        .filter(it => ds.isDone(it) && Number(it.minutes) > 0)
        .map(it => ({ date: today, course: E.courseOf(it), minutes: Number(it.minutes) }));
      return E.studyTime(S.sessions, { now: now(), courseOf: sessionCourse, ticked });
    }
    let ST = null; // this render's study time
    const timed = () => (ST || (ST = studyTime())).sessions.map(x => ({ ...x.s, date: x.date, minutes: x.minutes }));
    // a session's course: its Study Watch folder names one (aliases), else its words guess one, else the default
    function sessionCourse(s) {
      // B-409: a Notes session's course is its note's (its folder is empty and its topic may be 'New note')
      const nid = noteOfSession(s);
      const doc = nid && (S.notes || []).find(n => n.id === nid);
      const nc = doc && doc.course ? E.normCourse(doc.course) : null;
      if (nc && E.isCourse(nc)) return nc;
      const f = E.normCourse(s.folder);
      if (E.isCourse(f)) return f;
      return E.guessCourse([s.folder, s.topic].filter(Boolean).join(' '));
    }
    // The period's buckets, oldest first: {key, from, to, label, full}. The week is its seven days from Monday; the
    // month is its weeks from Monday, cut to the month; the semester is its months back to the first logged session or
    // answer, at most six.
    function buckets(period) {
      if (period === 'week') {
        const m = weekStart(today);
        return [0, 1, 2, 3, 4, 5, 6].map(i => {
          const d = E.addDays(m, i);
          return { key: d, from: d, to: d, label: short(d).split(' ')[0], full: longDay(d) };
        });
      }
      if (period === 'month') {
        const ym = monthOf(today),
          end = monthEnd(ym),
          out = [];
        for (let w = weekStart(monthStart(ym)); w <= end; w = E.addDays(w, 7)) {
          const from = w < monthStart(ym) ? monthStart(ym) : w,
            to = E.addDays(w, 6) > end ? end : E.addDays(w, 6);
          out.push({
            key: from,
            from,
            to,
            label: monthName(ym) + ' ' + Number(from.slice(8)),
            full: 'Week of ' + Number(w.slice(8)) + ' ' + MONL[Number(w.slice(5, 7)) - 1] + soFar(from, to),
          });
        }
        return out;
      }
      // B-366: the semester is every month of the term, the future ones empty (ahead): fall is August to December,
      // spring January to May, summer June and July
      const mo = Number(today.slice(5, 7)),
        yr = today.slice(0, 4);
      const [m0, m1] = mo >= 8 ? [8, 12] : mo <= 5 ? [1, 5] : [6, 7];
      const out = [];
      for (let m = m0; m <= m1; m++) {
        const ym = yr + '-' + String(m).padStart(2, '0');
        out.push({
          key: ym,
          from: monthStart(ym),
          to: monthEnd(ym),
          label: monthName(ym),
          full: MONL[m - 1] + soFar(monthStart(ym), monthEnd(ym)),
        });
      }
      return out;
    }
    // the period before this one, for the deltas: last week, last month; the semester has none
    function before(period) {
      if (period === 'week') {
        const m = weekStart(today);
        return { from: E.addDays(m, -7), to: E.addDays(m, -1), name: 'last week' };
      }
      if (period === 'month') {
        const prev = E.addDays(monthStart(monthOf(today)), -1);
        return { from: monthStart(monthOf(prev)), to: prev, name: MONL[Number(prev.slice(5, 7)) - 1] }; // B-372: '+N points on September'
      }
      return null;
    }
    const inSpan = (d, a, b) => d >= a && d <= b;
    const minsIn = (a, b) => E.minutesIn(ST || (ST = studyTime()), a, b);
    const accIn = (a, b) => {
      const xs = M.attempts.all.filter(x => x.date && inSpan(x.date, a, b));
      return { n: xs.length, right: xs.filter(x => x.correct).length };
    };
    function deltaMin(d, name) {
      if (!d) return 'same as ' + name;
      return (d > 0 ? '+' : '−') + hm(Math.abs(d)) + ' on ' + name;
    }
    // the semester's 'since 24 August': its first day with a session or an answer, else its first month
    function firstDay(span) {
      const d = [...timed().map(s => s.date), ...M.attempts.all.map(a => a.date)]
        .filter(x => x && inSpan(x, span.from, span.to))
        .sort()[0];
      return d ? Number(d.slice(8)) + ' ' + MONL[Number(d.slice(5, 7)) - 1] : MONL[Number(span.from.slice(5, 7)) - 1];
    }
    function renderProgressTime() {
      ST = studyTime();
      const P = prog.period,
        bs = buckets(P);
      const span = { from: bs[0].from, to: bs[bs.length - 1].to };
      const grand = minsIn(span.from, span.to);
      const prev = before(P);
      // the switch
      $('prog-period')
        .querySelectorAll('button')
        .forEach(b => {
          b.setAttribute('aria-pressed', String(b.dataset.p === P));
          b.tabIndex = b.dataset.p === P ? 0 : -1;
        });
      // three property rows
      const acc = accIn(span.from, span.to);
      const pa = prev ? accIn(prev.from, prev.to) : null;
      const accPct = acc.n ? Math.round((100 * acc.right) / acc.n) : null;
      const prevPct = pa && pa.n ? Math.round((100 * pa.right) / pa.n) : null;
      const open = E.openSpots(M.models); // B-522: Study's open list, as Study counts it
      const due = open.filter(w => E.isDue(w, today)).length;
      // absent while empty (D-151): the accuracy row waits for an answer in the period
      const props = [
        [
          'Study time',
          hm(grand),
          prev ? deltaMin(grand - minsIn(prev.from, prev.to), prev.name) : 'since ' + firstDay(span),
        ],
        accPct != null && [
          'Quiz accuracy',
          accPct + '%',
          !prev
            ? 'since ' + firstDay(span)
            : prevPct == null
              ? acc.right + ' of ' + acc.n + ' right'
              : (accPct === prevPct
                  ? 'same as '
                  : (accPct > prevPct ? '+' : '−') + Math.abs(accPct - prevPct) + ' points on ') + prev.name,
        ],
        ['Weak spots', open.length + ' open', due ? due + ' due today' : 'none due today'],
      ].filter(Boolean);
      $('prog-stats').replaceChildren(
        ...props.map(([k, v, d]) => {
          const r = el('div', 'prop');
          r.dataset.k = k;
          const val = el('span', 'prop-v');
          val.append(el('b', null, v));
          if (d) val.append(el('span', 'meta', ' · ' + d));
          r.append(el('span', 'prop-k', k), val);
          // B-550: the whole stat opens its list: the time by day, the questions answered, the open weak spots
          const go = {
            'Study time': () => ($('prog-chart-h') || r).scrollIntoView({ block: 'start', behavior: 'smooth' }),
            'Quiz accuracy': () => (showTab('study'), setStudy('practice')),
            'Weak spots': () => (showTab('study'), setStudy('weak')),
          }[k];
          if (go) {
            r.setAttribute('role', 'button');
            r.tabIndex = 0;
            r.addEventListener('click', go);
            r.addEventListener('keydown', e => {
              if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), go());
            });
          }
          return r;
        })
      );
      // the chart: one bar per bucket, the picked one opening the day panel
      const ahead = b => b.from > today;
      const vals = bs.map(b => minsIn(b.from, b.to));
      const mx = Math.max(1, ...vals);
      const cur = bs.findIndex(b => inSpan(today, b.from, b.to));
      // B-338: at rest the day panel opens on the latest bar with sessions, else on the current one
      let pick = bs.findIndex(b => b.key === prog.pick);
      if (pick < 0) {
        const last = vals
          .map((v, i) => (v > 0 && !ahead(bs[i]) ? i : -1))
          .filter(i => i >= 0)
          .pop();
        pick = last != null ? last : cur >= 0 ? cur : bs.length - 1;
      }
      $('prog-chart-h').textContent =
        P === 'week' ? 'Study time by day' : P === 'month' ? 'Study time by week' : 'Study time by month';
      const chart = $('prog-chart');
      chart.dataset.n = String(bs.length);
      chart.replaceChildren(
        ...bs.map((b, i) => {
          const col = el('div', 'pc-col');
          const bar = el('button', 'pc-bar' + (ahead(b) ? ' ahead' : vals[i] ? '' : ' empty'));
          bar.type = 'button';
          bar.dataset.key = b.key;
          bar.dataset.min = String(vals[i]);
          bar.setAttribute('aria-pressed', String(i === pick));
          bar.setAttribute('aria-label', b.full + ': ' + (ahead(b) ? 'ahead' : hm(vals[i])));
          bar.title = b.full + ' · ' + (ahead(b) ? 'ahead' : hm(vals[i]));
          // the demo's slim bar: a 40 px fill on no ground, an outlined stub for a bar ahead or with nothing logged
          if (ahead(b) || !vals[i]) bar.append(el('span', 'pc-ahead'));
          else if (vals[i]) {
            const fill = el('i');
            fill.style.height = Math.max(3, Math.round((vals[i] / mx) * 100)) + '%';
            bar.append(fill);
          }
          bar.addEventListener('click', () => {
            prog.pick = b.key;
            renderProgressTime();
          });
          col.append(bar, el('span', 'pc-lab', b.label));
          return col;
        })
      );
      // by course: each active course's share of the period's study time
      const byC = E.minutesByCourse(ST, span.from, span.to); // B-522: sessions and today's ticked tasks
      const courseRows = E.activeCourses()
        .filter(c => byC[c]) // a course with no time this period is absent (D-151)
        .map(c => {
          const r = el('div', 'prog-hb');
          const top = el('div', 'prog-hb-top');
          top.append(el('span', null, c), el('span', 'meta', hm(byC[c] || 0)));
          const bar = DS.meter({
            value: grand ? Math.round((100 * (byC[c] || 0)) / grand) : 0,
            tone: 'violet',
            label: c + ': ' + hm(byC[c] || 0),
          });
          r.append(top, bar);
          return r;
        });
      $('prog-course').hidden = !courseRows.length;
      $('prog-course').replaceChildren(
        el('span', 'lab', 'By course · ' + { week: 'this week', month: 'this month', sem: 'this semester' }[P]),
        ...courseRows
      );
      // exam readiness (B-342, the demo's): each course's next exam, its objectives solid (green) and almost (yellow),
      // as Study's overview counts them; B-366: an exam with no objectives shows its plan's progress instead, tasks done
      // (green) and the rest of its started days (yellow), as Study's exam card does
      const objAcc = E.answerStats(M.attempts.all).byObjective;
      const readyRows = studyExams()
        .filter(x => x.exam) // B-357: a course with no upcoming exam (B-365) has no readiness row
        .map(({ exam: e }) => {
          const objs = S.objectives.filter(o => o.exam === e.id);
          let n, so, al, unit;
          if (objs.length) {
            const st = objs.map(o => objState(o, objAcc[o.id]).state);
            ((n = objs.length),
              (so = st.filter(x => x === 'solid').length),
              (al = st.filter(x => x === 'almost').length));
            unit = 'objectives';
          } else {
            // B-372: its plan as Study finds it (the plan named for it, else one ending in its last three weeks), else
            // the Today items tied to it (a plan task or a set on it); with neither the row is absent, never an empty bar
            const plan = examPlan(e);
            const isDone = t => !!(plan.done && plan.done[t.id]) || planDone(plan, t);
            ((n = 0), (so = 0), (al = 0), (unit = 'plan tasks'));
            for (const d of (plan && plan.days) || []) {
              const ts = (d.tasks || []).map(t => ({ ...t, date: d.date })),
                k = ts.filter(isDone).length;
              n += ts.length;
              so += k;
              if (k && k < ts.length) al += ts.length - k;
            }
            if (!n) {
              // B-378: also an item that names the exam ("Drill: Exam 4 weak spots"); the exam's own date row is not one
              const ds = dayState();
              const short = (e.title || e.id).replace(/:.*$/, '').trim();
              const named = new RegExp('\\b' + short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
              const tied = ds.items.filter(it => {
                if (it.ref === 'exams/' + e.id) return false;
                const pt = planTaskById(it.ref);
                if (pt) return (pt.plan.exam || pt.plan.id) === e.id;
                const sid = it.set || (/^sets\//.test(it.ref || '') ? it.ref.slice(5) : null);
                const set = sid && S.sets.find(x => x.id === sid);
                if (set) return set.exam === e.id;
                return named.test(it.text || it.title || '');
              });
              ((n = tied.length),
                (so = tied.filter(ds.isDone).length),
                (unit = tied.length === 1 ? 'item today' : 'items today'));
            }
            // B-378: with neither the next exam still has its row, an empty bar saying so, so By course is never alone
            if (!n) unit = 'none';
          }
          return { e, n, so, al, unit };
        })
        .map(({ e, n, so, al, unit }, _i, all) => {
          // B-386: the heading names what the rows count; when every row counts the same thing the rows carry only the
          // numbers, as the demo's; mixed rows keep their own unit and the heading names none
          const units = new Set(all.map(r => (/^items? today$/.test(r.unit) ? 'items today' : r.unit)));
          units.delete('none');
          const same = units.size === 1;
          const row = el('div', 'prog-hb');
          const top = el('div', 'prog-hb-top');
          top.append(
            el('span', null, E.courseOf(e) + ' · ' + (e.title || e.id).replace(/:.*$/, '')),
            el(
              'span',
              'meta',
              unit === 'none' ? 'no plan yet' : so + ' of ' + n + (same || unit === 'objectives' ? '' : ' ' + unit)
            )
          );
          const bar = DS.meter({
            kind: 'segments',
            parts: [
              { value: n ? Math.round((100 * so) / n) : 0, tone: 'ok' },
              { value: n ? Math.round((100 * al) / n) : 0, tone: 'warn' },
            ],
            label:
              unit === 'objectives'
                ? so + ' solid, ' + al + ' almost, of ' + n + ' objectives'
                : unit === 'none'
                  ? 'no objectives or plan yet'
                  : so + ' of ' + n + ' ' + unit + ' done',
          });
          row.append(top, bar);
          row.dataset.unit = unit;
          return row;
        })
        .filter(Boolean);
      // B-386: heading and count agree: objectives solid, plan tasks done, items done today, or (mixed) no unit
      const readyUnits = new Set(
        readyRows.map(r => r.dataset.unit).map(u => (/^items? today$/.test(u) ? 'items today' : u))
      );
      readyUnits.delete('none');
      const readyHeading =
        'Exam readiness' +
        (readyUnits.size === 1
          ? ' · ' +
            { objectives: 'objectives solid', 'plan tasks': 'plan tasks done', 'items today': 'items done today' }[
              [...readyUnits][0]
            ]
          : '');
      $('prog-ready').hidden = !readyRows.length;
      $('prog-ready').replaceChildren(el('span', 'lab', readyHeading), ...readyRows);
      // the day panel (B-342, the demo's): what that day holds in Record, sessions, quizzes and notes, newest first; the
      // total is its study time
      const b = bs[pick];
      // B-372: This week lists the picked day's; Month and Semester list the four most recent, as the demo
      const list = recEntries()
        .filter(x => x.kind !== 'workout' && x.result !== 'going now' && (P !== 'week' || inSpan(x.date, b.from, b.to)))
        .slice(0, P === 'week' ? 5 : 4);
      const ul = el('ul', 'prog-sessions');
      for (const x of list) {
        const li = el('li', 'prog-s');
        li.dataset.kind = x.kind;
        li.dataset.id = x.id;
        li.dataset.key = x.id; // D-387: the record id it shows
        // the entry's name opens it in Record's log, where it lives (D-147)
        const nm = el('button', 'nm', x.name);
        nm.type = 'button';
        nm.title = 'Open in Record';
        nm.addEventListener('click', () => openInRecord(x.id));
        nm.dataset.part = 'title';
        const txt = el('div', 'prog-s-t');
        txt.dataset.part = 'text';
        const sub = el('span', 'mini', x.result || '');
        sub.dataset.part = 'meta';
        txt.append(nm, sub);
        const [word, cls] = REC_BADGE[x.kind];
        // B-571: one 72 px badge column (DS.kind colours it), so titles start on one line whatever the word's width
        const bd = DS.badge({ text: word, kind: DS.kind(word) || x.kind, cls });
        bd.dataset.part = 'badge';
        li.append(bd, txt);
        ul.append(li);
      }
      // B-571: parts by data-part, not position (D-387); the total is minsIn's, sessions and ticked minutes (B-522)
      const part = (n, k) => ((n.dataset.part = k), n);
      ul.dataset.part = 'list';
      $('prog-day').replaceChildren(
        part(el('span', 'lab prog-day-when', b.full), 'when'),
        part(el('p', 'prog-day-total', ahead(b) ? 'Ahead' : hm(vals[pick])), 'total'),
        part(
          el(
            'span',
            'lab prog-day-lab',
            list.length ? (P === 'week' ? 'That day in Record' : 'Recent in Record') : 'Nothing logged'
          ),
          'label'
        ),
        ul
      );
      $('prog-day').hidden = false;
      // E.V.'s one line above the switch (B-342, the demo's): the topic that got most of the period's time, and the
      // next graded date in its course this week; absent while the period holds no study time (D-151)
      const byT = {};
      for (const s of timed())
        if (inSpan(s.date, span.from, span.to) && s.topic) {
          const t = sessName(s); // B-409: a Notes session by its note's title, as Record names it
          byT[t] = (byT[t] || 0) + s.minutes;
        }
      const top = Object.entries(byT).sort((x, y) => y[1] - x[1])[0];
      const line = $('prog-line');
      line.hidden = !top || !grand;
      if (top && grand) {
        const ts = timed().find(s => s.topic && sessName(s) === top[0]);
        const c = ts ? sessionCourse(ts) : null;
        const ex = E.nextExams(S.exams, today).find(e => E.courseOf(e) === c && E.diffDays(today, e.date) <= 6);
        const when = ex
          ? ex.date === today
            ? 'today'
            : ex.date === E.addDays(today, 1)
              ? 'tomorrow'
              : WDL[E.weekday(ex.date)]
          : '';
        line.querySelector('.et').textContent =
          top[0] +
          ' got ' +
          Math.round((100 * top[1]) / grand) +
          '% of ' +
          { week: 'this week’s', month: 'this month’s', sem: 'this semester’s' }[P] +
          ' time' +
          (ex ? '; ' + c + '’s ' + (ex.title || ex.id).replace(/:.*$/, '') + ' is ' + when : '') +
          '.';
      }
    }
    // its parts, built here so the shell stays in its budget: the toolbar, then the card, the chart and the pair at
    // the top of the main column, and the day panel first in the side column (the right panel from 1200 px)
    {
      const R = $('progress-readiness'),
        mk = (cls, id) => {
          const d = el('div', cls);
          d.id = id;
          return d;
        };
      const bar = mk('toolbar prog-bar', 'prog-bar'),
        seg = DS.segmented({
          label: 'Period',
          options: Object.entries(PERIODS).map(([value, label]) => ({ value, label })),
          value: prog.period,
          onPick: p => {
            prog.period = p;
            prog.pick = null;
            store.set('prog.period', p);
            renderProgressTime();
          },
        });
      seg.id = 'prog-period';
      Object.keys(PERIODS).forEach((k, i) => (seg.children[i].dataset.p = k));
      bar.append(seg);
      const card = (cls, id) => {
          const c = DS.card({ cls });
          c.id = id;
          return c;
        },
        cc = card('', 'prog-chart-card'),
        hd = el('div', 'prog-chart-head'),
        h = el('h3', null, 'Study time by day'),
        ch = mk('prog-chart', 'prog-chart');
      h.id = 'prog-chart-h';
      ch.setAttribute('role', 'group');
      ch.setAttribute('aria-labelledby', 'prog-chart-h');
      hd.append(h, el('span', 'meta', 'From your logged sessions'));
      cc.append(hd, ch);
      const grid = el('div', 'prog-grid');
      grid.append(card('', 'prog-course'), card('', 'prog-ready'));
      // E.V.'s line: the demo's strip under the header, her mark and one sentence
      const line = mk('evline prog-line', 'prog-line');
      line.innerHTML =
        '<svg class="ico sicon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"></path></svg><span class="et"></span>';
      line.hidden = true;
      R.prepend(line, bar);
      R.querySelector('.col-main').prepend(card('prog-props', 'prog-stats'), cc, grid);
      R.querySelector('.col-side').prepend(mk('card', 'prog-day'));
    }
    function renderReadiness() {
      renderProgressTime(); // B-301 (B-381: the hidden readiness, audit, score and accuracy shells are gone)
    }
    // B-123 (D-162): a weak spot is one line, its topic and objective, opening in place to its source and its action.
    const openWs = new Set();
    // B-357: his Mark solid, one site for Progress's row and Study's; B-233: through act() (weakspot-solid)
    function markSolid(w) {
      return weakAct('weakspot-solid', { id: w.id });
    }
    function wsRow(w) {
      const d = w.derived;
      const due = E.isDue(w, today);
      const when =
        w.kind === 'note' || w.kind === 'skill'
          ? ''
          : d.status === 'reviewed'
            ? (w.kind === 'note' ? 'done ' : 'solid ') + short(d.solidAt)
            : d.preRead
              ? 'first check after the reading' + (w.readingDue ? ' (' + short(w.readingDue) + ')' : '')
              : d.nextDue
                ? (due ? 'due today' : 'next ' + short(d.nextDue)) + (d.streak ? ' · ' + d.streak + ' of 2 right' : '')
                : 'not scheduled';
      const detail = [w.source, d.recurrence > 1 ? 'seen ' + d.recurrence + '×' : '', when].filter(Boolean).join(' · ');
      // B-303 (D-288, D-289): no parked spots and no Make active; one action whatever its kind, Mark solid
      const action =
        d.status === 'open'
          ? btn('Mark solid', ev => guard(ev.target, () => markSolid(w), 'Marked solid'), {
              cls: 'btn neutral sm',
            })
          : null;
      const on = openWs.has(w.id),
        li = el('li', 'row ws-item' + (on ? ' open' : ''));
      li.dataset.id = w.id;
      const b = el('button', 'ws-line');
      b.type = 'button';
      b.setAttribute('aria-expanded', String(on));
      b.append(el('span', 'ws-t', w.topic || 'Untitled'), el('span', 'ws-n', w.objective || w.exam || ''));
      b.addEventListener('click', () => {
        const o = !openWs.has(w.id);
        o ? openWs.add(w.id) : openWs.delete(w.id);
        li.classList.toggle('open', o);
        b.setAttribute('aria-expanded', String(o));
      });
      const more = el('div', 'ws-more');
      if (detail) more.append(el('p', 'meta', detail));
      if (action) {
        const a = el('div', 'actions');
        a.append(action);
        more.append(a);
      }
      li.append(b, more);
      return li;
    }

