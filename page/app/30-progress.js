    // ------------------------------------------------------------ Progress
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
    function renderReadiness() {
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
        const kids = [el('h2', null, 'Readiness · ' + (ex.title || ex.id)), lead, ul];
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

