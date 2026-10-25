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
          out.push({ key: from, from, to, label: monthName(ym) + ' ' + Number(from.slice(8)), full: rangeName(from, to) });
        }
        return out;
      }
      const dates = [...timed().map(s => s.date), ...M.attempts.all.map(a => a.date)].filter(Boolean).sort();
      let ym = monthOf(dates[0] && dates[0] < today ? dates[0] : today);
      const out = [];
      for (let i = 0; ym <= monthOf(today) && i < 12; i++) {
        out.push({ key: ym, from: monthStart(ym), to: monthEnd(ym), label: monthName(ym), full: monthName(ym) + ' ' + ym.slice(0, 4) });
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
      const props = [
        [
          'Study time',
          hm(grand),
          prev ? deltaMin(grand - minsIn(prev.from, prev.to), prev.name) : 'since ' + bs[0].full,
        ],
        [
          'Quiz accuracy',
          accPct == null ? 'No answers yet' : accPct + '%',
          accPct == null
            ? ''
            : prevPct == null
              ? acc.right + ' of ' + acc.n + ' right'
              : (accPct === prevPct ? 'same as ' : (accPct > prevPct ? '+' : '−') + Math.abs(accPct - prevPct) + ' pts on ') +
                prev.name,
        ],
        ['Weak spots', open.length + ' open', due ? due + ' due today' : 'none due today'],
      ];
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
      let pick = bs.findIndex(b => b.key === prog.pick);
      if (pick < 0) pick = cur >= 0 ? cur : bs.length - 1;
      $('prog-chart-h').textContent = P === 'week' ? 'Study time by day' : P === 'month' ? 'Study time by week' : 'Study time by month';
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
          const fill = el('i');
          fill.style.height = vals[i] ? Math.max(3, Math.round((vals[i] / mx) * 100)) + '%' : '0';
          bar.append(fill);
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
      for (const s of timed()) if (inSpan(s.date, span.from, span.to)) byC[sessionCourse(s)] = (byC[sessionCourse(s)] || 0) + s.minutes;
      const courseRows = E.activeCourses().map(c => {
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
      $('prog-course').replaceChildren(el('h3', null, 'By course · ' + PERIODS[P].toLowerCase()), ...courseRows);
      // exam readiness: each active course's next exam, its weak spots solid (green) and right once (yellow)
      const next = E.nextExams(S.exams, today);
      const readyRows = E.activeCourses()
        .map(c => next.find(e => E.courseOf(e) === c))
        .filter(Boolean)
        .map(e => {
          const r = E.readiness({ examId: e.id, weakspots: M.models });
          const total = r.active + r.solid;
          const row = el('div', 'prog-hb');
          const top = el('div', 'prog-hb-top');
          top.append(
            el('span', null, E.courseOf(e) + ' · ' + (e.title || e.id).replace(/:.*$/, '')),
            el('span', 'meta', total ? r.solid + ' of ' + total + ' solid' : 'no weak spots yet')
          );
          const bar = el('div', 'pbar');
          const g = el('i', 'x-green'),
            y = el('i', 'x-yellow');
          g.style.width = total ? Math.round((100 * r.solid) / total) + '%' : '0';
          y.style.width = total ? Math.round((100 * r.rightOnce) / total) + '%' : '0';
          bar.append(g, y);
          row.append(top, bar);
          return row;
        });
      $('prog-ready').hidden = !readyRows.length;
      $('prog-ready').replaceChildren(el('h3', null, 'Exam readiness · weak spots solid'), ...readyRows);
      // the day panel: the picked bar's sessions, and nothing else
      const b = bs[pick];
      const list = timed()
        .filter(s => inSpan(s.date, b.from, b.to))
        .sort((x, y) => String(y.startedAt || y.date).localeCompare(String(x.startedAt || x.date)));
      const day = $('prog-day');
      const ul = el('ul', 'list prog-sessions');
      for (const s of list) {
        const li = el('li', 'li prog-s');
        li.dataset.min = String(s.minutes);
        li.dataset.id = s.id;
        // the session's name opens Record's sessions, where it lives (D-147: a card holds something he does)
        const nm = el('button', 'nm', s.topic || (s.kind === 'skill' ? 'Skills practice' : 'Study session'));
        nm.type = 'button';
        nm.title = 'Open in Record';
        nm.addEventListener('click', () => {
          showTab('record');
          $('seg-record').querySelector('[data-v="sessions"]').click();
        });
        const when = P === 'week' ? (s.startedAt ? clock12(s.startedAt) + ' · ' : '') : short(s.date) + ' · ';
        li.append(nm, el('span', 'meta', sessionCourse(s)), el('span', 't', when + hm(s.minutes)));
        ul.append(li);
      }
      // absent while the picked bar holds no session (D-151)
      day.hidden = !list.length;
      day.replaceChildren(
        el('h2', null, b.full),
        el('p', 'big prog-day-total', hm(vals[pick])),
        el('p', 'meta prog-day-lab', plural(list.length, 'study session')),
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
    // B-118 (D-155): Readiness is one lead line (percent solid, right answers to go, days left) and one objective list in
    // readinessAudit's order (most not yet first), merging the audit and accuracy by objective. Each row is one line with
    // its not-yet count and opens in place to its counts, accuracy and passages to reread; past 5 they fold under a count.
    const openObjs = new Set();
    function objRow(o, acc, folded) {
      const li = el('li', 'row obj-item' + (openObjs.has(o.id) ? ' open' : ''));
      li.dataset.id = o.id;
      li.hidden = folded;
      const b = el('button', 'obj-line');
      b.type = 'button';
      b.setAttribute('aria-expanded', String(openObjs.has(o.id)));
      b.append(el('span', 'obj-t', o.id + ' · ' + (o.text || '')), el('span', 'obj-n', o.notYet + ' not yet'));
      const more = el('div', 'obj-more');
      more.append(
        el(
          'p',
          'meta',
          [
            `${o.solid} solid · ${o.rightOnce} right once · ${o.notYet} not yet${o.preRead ? ' · ' + o.preRead + ' previews' : ''}`,
            acc ? `${acc.right} of ${acc.n} right (${pct(acc.right, acc.n)})` : 'no answers yet',
          ].join(' · ')
        )
      );
      if (o.passages && o.passages.length)
        more.append(el('p', 'meta obj-reread', 'Reread: ' + o.passages.map(x => x.cite).join('; ')));
      else if ((o.notYet || o.rightOnce) && !LIB.mats) more.append(el('p', 'meta', 'Finding passages to reread…'));
      b.addEventListener('click', () => {
        const on = !openObjs.has(o.id);
        on ? openObjs.add(o.id) : openObjs.delete(o.id);
        li.classList.toggle('open', on);
        b.setAttribute('aria-expanded', String(on));
      });
      li.append(b, more);
      return li;
    }
    function foldCard(id, rows, render) {
      // a table that folds to one line, absent while it holds one row
      const c = $(id + '-card'),
        body = c.querySelector('.scroll'),
        line = c.querySelector('.fold-line');
      c.hidden = rows < 2;
      if (!line.dataset.on) {
        line.dataset.on = '1';
        line.addEventListener('click', () => {
          body.hidden = !body.hidden;
          line.setAttribute('aria-expanded', String(!body.hidden));
        });
      }
      if (!c.hidden) render(body);
    }
    // B-48 (D-105): readiness over time for one exam: the mornings' stamps (days/<date>.readiness) inside the 14-day
    // window, each week's closing stamp (weeks/<date>.rollups.readiness) before it, and the night-before prediction
    // (predictions/<examId>, its percentSolid) as the last marked point. Nothing drawn here is stored by the page.
    function readinessTrend(examId) {
      const from = E.addDays(today, -13);
      const pts = [];
      for (const w of S.weeks || []) {
        const r = w.rollups && w.rollups.readiness && w.rollups.readiness[examId];
        if (r && r.pctSolid != null && w.date && w.date < from) pts.push({ date: w.date, v: r.pctSolid, week: true });
      }
      for (const d of S.days || []) {
        const r = d.readiness && d.readiness[examId];
        if (r && r.pctSolid != null && (d.date || d.id) >= from) pts.push({ date: d.date || d.id, v: r.pctSolid });
      }
      pts.sort((a, b) => a.date.localeCompare(b.date));
      const p = (S.predictions || []).find(x => (x.examId || x.id) === examId);
      const pred =
        p && p.percentSolid != null && p.date ? { date: p.date, v: p.percentSolid, range: p.predictedRange } : null;
      return { pts, pred };
    }
    function trendChart(examId) {
      const { pts, pred } = readinessTrend(examId);
      if (pts.length + (pred ? 1 : 0) < 2) return null;
      const all = [...pts, ...(pred ? [pred] : [])];
      const t0 = Date.parse(all[0].date + 'T12:00:00Z'),
        t1 = Date.parse(all[all.length - 1].date + 'T12:00:00Z');
      const W = 320,
        H = 96,
        L = 30,
        R = 40,
        T = 8,
        B = 18;
      const x = d => L + (t1 > t0 ? ((Date.parse(d + 'T12:00:00Z') - t0) / (t1 - t0)) * (W - L - R) : (W - L - R) / 2);
      const y = v => T + (1 - v / 100) * (H - T - B);
      const NS = 'http://www.w3.org/2000/svg';
      const mk = (tag, attrs, text) => {
        const n = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (text != null) n.textContent = text;
        return n;
      };
      const day = d => E.shortDate(d);
      const svg = mk('svg', {
        viewBox: `0 0 ${W} ${H}`,
        class: 'trend',
        role: 'img',
        'aria-label':
          'Percent solid by morning: ' +
          pts.map(p => `${day(p.date)} ${p.v}%`).join(', ') +
          (pred ? `; night before the exam ${pred.v}% (prediction)` : ''),
      });
      for (const v of [0, 50, 100]) {
        svg.append(mk('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'trend-grid' }));
        svg.append(mk('text', { x: L - 6, y: y(v) + 3, class: 'trend-axis', 'text-anchor': 'end' }, v + '%'));
      }
      if (pts.length > 1)
        svg.append(mk('polyline', { points: pts.map(p => `${x(p.date)},${y(p.v)}`).join(' '), class: 'trend-line' }));
      if (pred && pts.length)
        svg.append(
          mk('line', {
            x1: x(pts[pts.length - 1].date),
            y1: y(pts[pts.length - 1].v),
            x2: x(pred.date),
            y2: y(pred.v),
            class: 'trend-link',
          })
        );
      for (const p of pts) {
        const c = mk('circle', { cx: x(p.date), cy: y(p.v), r: 4, class: 'trend-pt' + (p.week ? ' week' : '') });
        c.append(mk('title', {}, `${day(p.date)}${p.week ? ' (week’s close)' : ''}: ${p.v}% solid`));
        svg.append(c);
      }
      const last = pts[pts.length - 1];
      if (last && !pred)
        svg.append(mk('text', { x: x(last.date) + 7, y: y(last.v) + 4, class: 'trend-label' }, last.v + '%'));
      if (pred) {
        const c = mk('circle', { cx: x(pred.date), cy: y(pred.v), r: 5, class: 'trend-pred' });
        c.append(
          mk(
            'title',
            {},
            `Night before (${day(pred.date)}): ${pred.v}% solid${pred.range ? `, predicted score ${pred.range[0]} to ${pred.range[1]}` : ''}`
          )
        );
        svg.append(c, mk('text', { x: x(pred.date) + 8, y: y(pred.v) + 4, class: 'trend-label' }, pred.v + '%'));
      }
      svg.append(mk('text', { x: L, y: H - 4, class: 'trend-axis' }, day(all[0].date)));
      svg.append(
        mk('text', { x: W - R, y: H - 4, class: 'trend-axis', 'text-anchor': 'end' }, day(all[all.length - 1].date))
      );
      const wrap = el('div', 'trend-wrap');
      const first = pts[0];
      wrap.append(
        svg,
        el(
          'p',
          'meta trend-cap',
          first && last && first !== last
            ? `Solid over ${plural(pts.length, 'morning')}: ${first.v}% to ${last.v}%${pred ? `; the night before, ${pred.v}%` : ''}.`
            : pred
              ? `The night before, ${pred.v}% solid.`
              : ''
        )
      );
      return wrap;
    }
    // B-72 (D-120): the latest week's insights, its top three lines, as the weekly computed them; nothing recomputed here.
    const latestInsights = () =>
      [...(S.weeks || [])]
        .filter(w => w.insights && (w.insights.lines || []).length)
        .sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)))[0] || null;
    // One line that opens in place to the three (D-147, D-148), so no objective shows twice beside the list above.
    function renderInsights() {
      const c = $('insights-card');
      const w = latestInsights();
      c.hidden = !w;
      if (!w) return;
      const n = w.insights.lines.slice(0, 3);
      const line = $('insights-line'),
        list = $('insights-list');
      if (!line.dataset.on) {
        line.dataset.on = '1';
        line.addEventListener('click', () => {
          list.hidden = !list.hidden;
          line.setAttribute('aria-expanded', String(!list.hidden));
        });
      }
      line.textContent = `From the week of ${E.shortDate(w.date || w.id)} · ${plural(n.length, 'finding')}`;
      list.replaceChildren(...n.map(t => el('li', 'row ins-line', t)));
    }
    function renderReadiness() {
      renderProgressTime(); // B-301
      const card = $('ready-card');
      const ex = M.target;
      const st = E.answerStats(M.attempts.all, { date: today });
      const objName = id => (S.objectives.find(o => o.id === id) || {}).text || id;
      if (ex && ui.tab === 'progress') {
        // built while Progress shows: the audit reads the library
        const r = E.readiness({ examId: ex.id, weakspots: M.models });
        const daysLeft = E.diffDays(today, ex.date);
        const lead = el(
          'p',
          'big ready-lead',
          [
            r.pctSolid != null ? r.pctSolid + '% solid' : 'No weak spots yet',
            r.need ? plural(r.need, 'right answer') + ' to go' : 'nothing to go',
            daysLeft <= 0 ? 'exam day' : plural(daysLeft, 'day') + ' left',
          ].join(' · ')
        );
        const audit = auditRows();
        const seen = new Set(audit.map(a => a.id));
        const rows = [
          ...audit,
          ...Object.keys(st.byObjective)
            .filter(id => !seen.has(id) && String(id).split('-')[0] === ex.id)
            .map(id => ({ id, text: objName(id), solid: 0, rightOnce: 0, notYet: 0, preRead: 0, passages: [] })),
        ];
        const ul = el('ul', 'list obj-list');
        rows.forEach((o, i) => ul.append(objRow(o, st.byObjective[o.id], i >= 5 && !ui.objAll)));
        const trend = trendChart(ex.id);
        const kids = [el('h2', null, 'Readiness · ' + (ex.title || ex.id)), lead, ...(trend ? [trend] : []), ul];
        if (rows.length > 5) {
          const f = el('button', 'fold-line');
          f.type = 'button';
          f.textContent = ui.objAll ? 'Fewer objectives' : `${plural(rows.length - 5, 'more objective')}`;
          f.setAttribute('aria-expanded', String(!!ui.objAll));
          f.addEventListener('click', () => {
            ui.objAll = !ui.objAll;
            render();
          });
          kids.push(f);
        }
        card.replaceChildren(...kids);
      }
      renderInsights();
      $('audit-card').hidden = true; // merged into the list above (B-118); its line in the conversation still opens here
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
        const sb = el('button', 'primary', 'Save score');
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
      const t = st.byType;
      const fr = [
        ['One best answer', 'single'],
        ['Select all that apply', 'sata'],
        ['Matrix', 'matrix'],
      ]
        .filter(([, k]) => t[k])
        .map(([lab, k]) => [lab, t[k].right + ' of ' + t[k].n, pct(t[k].right, t[k].n)]);
      foldCard('fmt', fr.length, b => b.replaceChildren(table(['Format', 'Right', '%'], fr)));
      const cj = E.CJ_STEPS.filter(s => st.byCjStep[s]).map(s => [
        cjLabel(s),
        st.byCjStep[s].right + ' of ' + st.byCjStep[s].n,
        pct(st.byCjStep[s].right, st.byCjStep[s].n),
      ]);
      foldCard('cj', cj.length, b => b.replaceChildren(table(['Step', 'Right', '%'], cj)));
      const mins = {};
      S.sessions.forEach(s => {
        if (s.date) mins[s.date] = (mins[s.date] || 0) + (s.minutes || 0);
      });
      const days = st.lastDays.filter(d => d.n || mins[d.date]);
      foldCard('days', days.length, b =>
        b.replaceChildren(
          table(
            ['Day', 'Answered', 'Right', 'Study min'],
            days.map(d => [short(d.date), String(d.n), pct(d.right, d.n), String(mins[d.date] || 0)])
          )
        )
      );
    }
    // B-123 (D-162): a weak spot is one line, its topic and objective, opening in place to its source and its action.
    const openWs = new Set();
    function wsRow(w) {
      const d = w.derived;
      const due = E.isDue(w, today);
      const when =
        d.status === 'parked'
          ? d.parkedReason || w.parkedReason || 'parked'
          : w.kind === 'note' || w.kind === 'skill'
            ? ''
            : d.status === 'reviewed'
              ? (w.kind === 'note' ? 'done ' : 'solid ') + short(d.solidAt)
              : d.preRead
                ? 'first check after the reading' + (w.readingDue ? ' (' + short(w.readingDue) + ')' : '')
                : d.nextDue
                  ? (due ? 'due today' : 'next ' + short(d.nextDue)) +
                    (d.streak ? ' · ' + d.streak + ' of 2 right' : '')
                  : 'not scheduled';
      const detail = [w.source, d.recurrence > 1 ? 'seen ' + d.recurrence + '×' : '', when].filter(Boolean).join(' · ');
      let action = null;
      if (d.status === 'parked')
        action = btn('Make active', ev => guard(ev.target, () => write(weakEvent(w, 'activate')), 'Active again'));
      else if (d.status === 'open') {
        const toDo = w.kind === 'note' || w.kind === 'skill';
        action = btn(w.kind === 'skill' ? 'Practiced' : toDo ? 'Done' : 'Mark solid', ev =>
          guard(ev.target, () => write(weakEvent(w, toDo ? 'done' : 'solid')), toDo ? 'Marked done' : 'Marked solid')
        );
      }
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
      const parked = ms.filter(w => w.derived.status === 'parked' && w.kind !== 'connection').sort(byAdded);
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
      wsFold('weak-parked-fold', 'weak-parked', 'Parked', parked, 'weak-parked-card');
      wsFold('weak-solid-fold', 'weak-solid', 'Solid', solid, 'weak-solid-card');
      // The notes-and-skills card only while it holds something (D-151).
      $('weak-notes-card').hidden = !notes.length && !formats.length;
      $('weak-notes').replaceChildren(...notes.map(wsRow));
      $('weak-formats').textContent = formats.length
        ? 'Question format pattern: ' + formats.map(f => f.topic).join('; ') + '. Review sets lean on these formats.'
        : '';
    }

