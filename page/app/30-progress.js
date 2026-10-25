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
    // the sessions that count as study time: ended (or ending) with a date and minutes
    const timed = () => (S.sessions || []).filter(s => s.status !== 'active' && s.date && (s.minutes || 0) > 0);
    // a session's course: its Study Watch folder names one (aliases), else its words guess one, else the default
    function sessionCourse(s) {
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
      const dates = [...timed().map(s => s.date), ...M.attempts.all.map(a => a.date)].filter(Boolean).sort();
      let ym = monthOf(dates[0] && dates[0] < today ? dates[0] : today);
      const out = [];
      for (let i = 0; ym <= monthOf(today) && i < 12; i++) {
        out.push({
          key: ym,
          from: monthStart(ym),
          to: monthEnd(ym),
          label: monthName(ym),
          full: MONL[Number(ym.slice(5, 7)) - 1] + soFar(monthStart(ym), monthEnd(ym)),
        });
        ym = E.addDays(monthStart(ym), 32).slice(0, 7);
      }
      return out.slice(-6);
    }
    // the period before this one, for the deltas: last week, last month; the semester has none
    function before(period) {
      if (period === 'week') {
        const m = weekStart(today);
        return { from: E.addDays(m, -7), to: E.addDays(m, -1), name: 'last week' };
      }
      if (period === 'month') {
        const prev = E.addDays(monthStart(monthOf(today)), -1);
        return { from: monthStart(monthOf(prev)), to: prev, name: 'last month' };
      }
      return null;
    }
    const inSpan = (d, a, b) => d >= a && d <= b;
    const minsIn = (a, b) => timed().reduce((t, s) => t + (inSpan(s.date, a, b) ? s.minutes : 0), 0);
    const accIn = (a, b) => {
      const xs = M.attempts.all.filter(x => x.date && inSpan(x.date, a, b));
      return { n: xs.length, right: xs.filter(x => x.correct).length };
    };
    function deltaMin(d, name) {
      if (!d) return 'same as ' + name;
      return (d > 0 ? '+' : '−') + hm(Math.abs(d)) + ' on ' + name;
    }
    function renderProgressTime() {
      const P = prog.period,
        bs = buckets(P);
      const span = { from: bs[0].from, to: bs[bs.length - 1].to };
      const grand = minsIn(span.from, span.to);
      const prev = before(P);
      // the switch
      $('prog-period')
        .querySelectorAll('button')
        .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === P)));
      // three property rows
      const acc = accIn(span.from, span.to);
      const pa = prev ? accIn(prev.from, prev.to) : null;
      const accPct = acc.n ? Math.round((100 * acc.right) / acc.n) : null;
      const prevPct = pa && pa.n ? Math.round((100 * pa.right) / pa.n) : null;
      const open = M.models.filter(w => E.isActive(w));
      const due = open.filter(w => E.isDue(w, today)).length;
      // absent while empty (D-151): the accuracy row waits for an answer in the period
      const props = [
        [
          'Study time',
          hm(grand),
          prev ? deltaMin(grand - minsIn(prev.from, prev.to), prev.name) : 'since ' + bs[0].full,
        ],
        accPct != null && [
          'Quiz accuracy',
          accPct + '%',
          prevPct == null
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
      const byC = {};
      for (const s of timed())
        if (inSpan(s.date, span.from, span.to)) byC[sessionCourse(s)] = (byC[sessionCourse(s)] || 0) + s.minutes;
      const courseRows = E.activeCourses()
        .filter(c => byC[c]) // a course with no time this period is absent (D-151)
        .map(c => {
          const r = el('div', 'prog-hb');
          const top = el('div', 'prog-hb-top');
          top.append(el('span', null, c), el('span', 'meta', hm(byC[c] || 0)));
          const bar = el('div', 'pbar x-violet');
          const f = el('i');
          f.style.width = grand ? Math.round((100 * (byC[c] || 0)) / grand) + '%' : '0';
          bar.append(f);
          r.append(top, bar);
          return r;
        });
      $('prog-course').hidden = !courseRows.length;
      $('prog-course').replaceChildren(el('span', 'lab', 'By course · ' + PERIODS[P].toLowerCase()), ...courseRows);
      // exam readiness (B-342, the demo's): each course's next exam with objectives, its objectives solid (green) and
      // almost (yellow), as Study's overview counts them
      const objAcc = E.answerStats(M.attempts.all).byObjective;
      const readyRows = studyCourses().map(({ exam: e }) => {
        const objs = S.objectives.filter(o => o.exam === e.id);
        const st = objs.map(o => objState(o, objAcc[o.id]).state);
        const so = st.filter(x => x === 'solid').length,
          al = st.filter(x => x === 'almost').length;
        const row = el('div', 'prog-hb');
        const top = el('div', 'prog-hb-top');
        top.append(
          el('span', null, E.courseOf(e) + ' · ' + (e.title || e.id).replace(/:.*$/, '')),
          el('span', 'meta', so + ' of ' + objs.length)
        );
        const bar = el('div', 'pbar');
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', so + ' solid, ' + al + ' almost, of ' + objs.length + ' objectives');
        const g = el('i', 'x-green'),
          y = el('i', 'x-yellow');
        g.style.width = Math.round((100 * so) / objs.length) + '%';
        y.style.width = Math.round((100 * al) / objs.length) + '%';
        bar.append(g, y);
        row.append(top, bar);
        return row;
      });
      $('prog-ready').hidden = !readyRows.length;
      $('prog-ready').replaceChildren(el('span', 'lab', 'Exam readiness · objectives solid'), ...readyRows);
      // the day panel (B-342, the demo's): what that day holds in Record, sessions, quizzes and notes, newest first; the
      // total is its study time
      const b = bs[pick];
      const list = recEntries()
        .filter(x => x.kind !== 'workout' && x.result !== 'going now' && inSpan(x.date, b.from, b.to))
        .slice(0, 5);
      const ul = el('ul', 'prog-sessions');
      for (const x of list) {
        const li = el('li', 'prog-s');
        li.dataset.kind = x.kind;
        li.dataset.id = x.id;
        // the entry's name opens it in Record's log, where it lives (D-147)
        const nm = el('button', 'nm', x.name);
        nm.type = 'button';
        nm.title = 'Open in Record';
        nm.addEventListener('click', () => openInRecord(x.id));
        const txt = el('div', 'prog-s-t');
        txt.append(nm, el('span', 'mini', x.result || ''));
        const [word, cls] = REC_BADGE[x.kind];
        li.append(el('span', 'badge' + (cls ? ' ' + cls : ''), word), txt);
        ul.append(li);
      }
      const unit = P === 'week' ? 'day' : P === 'month' ? 'week' : 'month';
      $('prog-day').replaceChildren(
        el('span', 'lab prog-day-when', b.full),
        el('p', 'prog-day-total', ahead(b) ? 'Ahead' : hm(vals[pick])),
        el('span', 'lab prog-day-lab', list.length ? 'That ' + unit + ' in Record' : 'Nothing logged'),
        ul
      );
      $('prog-day').hidden = false;
      // E.V.'s one line above the switch (B-342, the demo's): the topic that got most of the period's time, and the
      // next graded date in its course this week; absent while the period holds no study time (D-151)
      const byT = {};
      for (const s of timed())
        if (inSpan(s.date, span.from, span.to) && s.topic) byT[s.topic] = (byT[s.topic] || 0) + s.minutes;
      const top = Object.entries(byT).sort((x, y) => y[1] - x[1])[0];
      const line = $('prog-line');
      line.hidden = !top || !grand;
      if (top && grand) {
        const ts = timed().find(s => s.topic === top[0]);
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
        seg = mk('seg', 'prog-period');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Period');
      for (const [k, n] of Object.entries(PERIODS)) {
        const b = el('button', null, n);
        b.type = 'button';
        b.dataset.p = k;
        seg.append(b);
      }
      bar.append(seg);
      const cc = mk('ui-card', 'prog-chart-card'),
        hd = el('div', 'prog-chart-head'),
        h = el('h3', null, 'Study time by day'),
        ch = mk('prog-chart', 'prog-chart');
      h.id = 'prog-chart-h';
      ch.setAttribute('role', 'group');
      ch.setAttribute('aria-labelledby', 'prog-chart-h');
      hd.append(h, el('span', 'meta', 'From your logged sessions'));
      cc.append(hd, ch);
      const grid = el('div', 'prog-grid');
      grid.append(mk('ui-card', 'prog-course'), mk('ui-card', 'prog-ready'));
      // E.V.'s line: the demo's strip under the header, her mark and one sentence
      const line = mk('evline prog-line', 'prog-line');
      line.innerHTML =
        '<svg class="ico sicon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"></path></svg><span class="et"></span>';
      line.hidden = true;
      R.prepend(line, bar);
      R.querySelector('.col-main').prepend(mk('ui-card prog-props', 'prog-stats'), cc, grid);
      R.querySelector('.col-side').prepend(mk('card', 'prog-day'));
    }
    $('prog-period')
      .querySelectorAll('button')
      .forEach(b =>
        b.addEventListener('click', () => {
          prog.period = b.dataset.p;
          prog.pick = null;
          store.set('prog.period', prog.period);
          renderProgressTime();
        })
      );
    function renderReadiness() {
      renderProgressTime(); // B-301
      // B-338 (D-312): the readiness card, its objective list and line chart, the findings and the accuracy tables leave
      // Progress; their data stays in the record. Only the score prompt remains, while a past exam waits for its score.
      for (const id of ['ready-card', 'insights-card', 'audit-card', 'fmt-card', 'cj-card', 'days-card'])
        $(id).hidden = true;
      // Score entry for past unit exams (calibration).
      // D-094: a past NUR unit exam with no score yet; the score goes to examedits/<examId>, replaced whole.
      const needScore = S.exams
        .filter(e => e.date && e.date < today && E.examIs(e, 'scoredKinds') && typeof e.score !== 'number')
        .sort((a, b) => b.date.localeCompare(a.date));
      const sc = $('score-card');
      sc.hidden = !needScore.length;
      if (needScore.length) {
        const e = needScore[0];
        const f = el('form');
        f.id = 'score-form';
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = '0';
        inp.max = '100';
        inp.step = '0.1';
        inp.id = 'score-in';
        inp.placeholder = 'Score, e.g. 88.5';
        inp.setAttribute('aria-label', 'Score for ' + e.title);
        const a = el('div', 'actions');
        const sb = el('button', 'btn primary', 'Save score');
        sb.type = 'submit';
        a.append(sb);
        f.append(
          el('h2', null, 'Record your ' + (e.title || e.id).replace(/:.*$/, '') + ' score'),
          el('p', 'meta', 'E.V. compares it with its prediction to get better at reading your readiness.'),
          inp,
          a
        );
        f.addEventListener('submit', ev => {
          ev.preventDefault();
          const v = Number(inp.value);
          if (!(v >= 0 && v <= 100)) {
            toast('Enter a score from 0 to 100.');
            return;
          }
          guard(sb, async () => {
            const at = now();
            const cur = (S.examedits || []).find(x => x.id === e.id);
            const { id, ...base } = cur || {};
            await write({
              op: 'set',
              collection: 'examedits',
              id: e.id,
              data: {
                ...(cur ? base : envelope('E.V. Home', at)),
                updatedAt: at,
                score: v,
                scoreAt: at,
                status: 'done',
              },
            });
            // D-104: a saved score starts the post-exam retro; the worker posts it to the conversation.
            let r = null;
            try {
              r = await startJob({
                kind: 'exam-retro',
                title: 'Retro: ' + (e.title || e.id),
                brief: e.id + ': the retro after the score he entered',
              });
            } catch (err) {
              toast('Score saved. The retro didn’t start: ' + ((err && err.message) || 'error'));
              return;
            }
            toast(
              r.fired.ok
                ? 'Score saved. E.V. is writing your retro.'
                : 'Score saved. The retro didn’t start: ' + fireCopy(r.fired.error)
            );
          });
        });
        sc.replaceChildren(f);
      }
    }
    // B-123 (D-162): a weak spot is one line, its topic and objective, opening in place to its source and its action.
    const openWs = new Set();
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
          ? btn('Mark solid', ev => guard(ev.target, () => write(weakEvent(w, 'solid')), 'Marked solid'), {
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

