    // ------------------------------------------------------------ Progress
    // B-301 (C-6): the period switch (this week, the month, the semester), its three property rows, the study-time
    // chart from his logged sessions, by course and exam readiness. A bar is the minutes of the study sessions that
    // fall in it, and the day panel lists exactly those sessions: workouts and notes are other collections and never
    // count. Nothing here is stored; the period is this device's (store).
    const PERIODS = { week: 'This week', month: 'Month', sem: 'Semester' };
    const prog = { period: PERIODS[store.get('prog.period')] ? store.get('prog.period') : 'week', pick: null };
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const hm = m => {
      m = Math.round(m || 0);
      return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
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
          return { key: d, from: d, to: d, label: short(d).split(' ')[0], full: d === today ? 'Today' : short(d) };
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
            full: rangeName(from, to),
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
          full: monthName(ym) + ' ' + ym.slice(0, 4),
        });
        ym = E.addDays(monthStart(ym), 32).slice(0, 7);
      }
      return out.slice(-6);
    }
    const rangeName = (a, b) => (a === b ? short(a) : short(a) + ' to ' + short(b));
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
                : (accPct > prevPct ? '+' : '−') + Math.abs(accPct - prevPct) + ' pts on ') + prev.name,
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
        const last = vals.map((v, i) => (v > 0 && !ahead(bs[i]) ? i : -1)).filter(i => i >= 0).pop();
        pick = last != null ? last : cur >= 0 ? cur : bs.length - 1;
      }
      $('prog-chart-h').textContent =
        P === 'week' ? 'Study time by day' : P === 'month' ? 'Study time by week' : 'Study time by month';
      const chart = $('prog-chart');
      chart.dataset.n = String(bs.length);
      chart.replaceChildren(
        ...bs.map((b, i) => {
          const col = el('div', 'pc-col');
          const bar = el('button', 'pc-bar' + (ahead(b) ? ' ahead' : ''));
          bar.type = 'button';
          bar.dataset.key = b.key;
          bar.dataset.min = String(vals[i]);
          bar.setAttribute('aria-pressed', String(i === pick));
          bar.setAttribute('aria-label', b.full + ': ' + (ahead(b) ? 'ahead' : hm(vals[i])));
          bar.title = b.full + ' · ' + (ahead(b) ? 'ahead' : hm(vals[i]));
          // the demo's slim bar: a 40 px fill on no ground, an outlined stub for a bar ahead
          if (ahead(b)) bar.append(el('span', 'pc-ahead'));
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
      // exam readiness: each active course's next exam, its weak spots solid (green) and right once (yellow)
      const next = E.nextExams(S.exams, today);
      const readyRows = E.activeCourses()
        .map(c => next.find(e => E.courseOf(e) === c))
        .filter(Boolean)
        .map(e => {
          const r = E.readiness({ examId: e.id, weakspots: M.models });
          const total = r.active + r.solid;
          if (!total) return null; // an exam with no weak spots yet is absent (D-151)
          const row = el('div', 'prog-hb');
          const top = el('div', 'prog-hb-top');
          top.append(
            el('span', null, E.courseOf(e) + ' · ' + (e.title || e.id).replace(/:.*$/, '')),
            el('span', 'meta', r.solid + ' of ' + total + ' solid')
          );
          const bar = el('div', 'pbar');
          const g = el('i', 'x-green'),
            y = el('i', 'x-yellow');
          g.style.width = Math.round((100 * r.solid) / total) + '%';
          y.style.width = Math.round((100 * r.rightOnce) / total) + '%';
          bar.append(g, y);
          row.append(top, bar);
          return row;
        })
        .filter(Boolean);
      $('prog-ready').hidden = !readyRows.length;
      $('prog-ready').replaceChildren(el('span', 'lab', 'Exam readiness · weak spots solid'), ...readyRows);
      // the day panel: the picked bar's sessions, and nothing else
      const b = bs[pick];
      const list = timed()
        .filter(s => inSpan(s.date, b.from, b.to))
        .sort((x, y) => String(y.startedAt || y.date).localeCompare(String(x.startedAt || x.date)));
      const day = $('prog-day');
      const ul = el('ul', 'prog-sessions');
      for (const s of list) {
        const li = el('li', 'prog-s');
        li.dataset.min = String(s.minutes);
        li.dataset.id = s.id;
        // the session's name opens it in Record's log, where it lives (D-147: a card holds something he does)
        const nm = el('button', 'nm', s.topic || (s.kind === 'skill' ? 'Skills practice' : 'Study session'));
        nm.type = 'button';
        nm.title = 'Open in Record';
        nm.addEventListener('click', () => openInRecord(s.id)); // B-302: on its row in the log
        const when = P === 'week' ? (s.startedAt ? clock12(s.startedAt) + ' · ' : '') : short(s.date) + ' · ';
        // the demo's row: the Session badge, then the name over its minutes, course and time
        const txt = el('div', 'prog-s-t');
        txt.append(nm, el('span', 'mini', hm(s.minutes) + ' · ' + sessionCourse(s) + (when ? ' · ' + when.slice(0, -3) : '')));
        li.append(el('span', 'badge x-violet', 'Session'), txt);
        ul.append(li);
      }
      // absent while the picked bar holds no session (D-151)
      day.hidden = !list.length;
      day.replaceChildren(
        el('span', 'lab prog-day-when', b.full),
        el('p', 'prog-day-total', hm(vals[pick])),
        el('span', 'lab prog-day-lab', P === 'week' ? 'That day in Record' : 'That ' + (P === 'month' ? 'week' : 'month') + ' in Record'),
        ul
      );
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
      R.prepend(bar);
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
      for (const id of ['ready-card', 'insights-card', 'audit-card', 'fmt-card', 'cj-card', 'days-card']) $(id).hidden = true;
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
    // A section folded under its line of count; open while ui[key] is set.
    function wsFold(lineId, listId, label, rows, cardId) {
      const line = $(lineId),
        list = $(listId),
        key = 'ws:' + listId;
      if (cardId) $(cardId).hidden = !rows.length;
      else line.hidden = !rows.length;
      line.textContent = `${label} · ${rows.length}`;
      line.setAttribute('aria-expanded', String(!!ui[key]));
      list.hidden = !ui[key] || !rows.length;
      if (!line.dataset.on) {
        line.dataset.on = '1';
        line.addEventListener('click', () => {
          ui[key] = !ui[key];
          render();
        });
      }
      list.replaceChildren(...rows.map(wsRow));
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
      $('weak-lead').textContent = due.length
        ? `${plural(due.length, 'weak spot')} due today`
        : active.length
          ? 'Nothing due today.'
          : 'No active weak spots.';
      // Due today is open: five rows, the rest under one line (D-148).
      const shown = ui.wsDueAll ? due : due.slice(0, 5);
      $('weak-due').replaceChildren(...shown.map(wsRow));
      $('weak-due').hidden = !due.length;
      const dm = $('weak-due-more');
      dm.hidden = due.length <= 5;
      dm.textContent = ui.wsDueAll ? 'Fewer' : `${due.length - 5} more due today`;
      dm.setAttribute('aria-expanded', String(!!ui.wsDueAll));
      if (!dm.dataset.on) {
        dm.dataset.on = '1';
        dm.addEventListener('click', () => {
          ui.wsDueAll = !ui.wsDueAll;
          render();
        });
      }
      $('weak-quizlet').hidden = !active.some(w => (w.kind || 'concept') === 'concept');
      wsFold('weak-tom-fold', 'weak-tom', 'Due tomorrow', tom);
      wsFold('weak-later-fold', 'weak-later', 'Later', later);
      wsFold('weak-preview-fold', 'weak-preview', 'Previews, before the reading', previews, 'weak-preview-card');
      wsFold('weak-solid-fold', 'weak-solid', 'Solid', solid, 'weak-solid-card');
      // The notes-and-skills card only while it holds something (D-151).
      $('weak-notes-card').hidden = !notes.length && !formats.length;
      $('weak-notes').replaceChildren(...notes.map(wsRow));
      $('weak-formats').textContent = formats.length
        ? 'Question format pattern: ' + formats.map(f => f.topic).join('; ') + '. Review sets lean on these formats.'
        : '';
    }

