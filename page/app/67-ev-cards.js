    // ---------------------------------------------------------------- cards (rendered live on every snapshot)
    const CARD_ROWS = 5; // a long list in a card shows five and a "more" (UI and UX, rule 3)
    // The "more": opens the item in its tab (D-125 as amended; the card never scrolls inside itself).
    const cardMore = (label, go, key) => {
      // B-78 (D-123): in a surface the rest folds under one 'n more' line that opens in place; elsewhere it opens the tab
      const b = btn(label, key ? () => (SF.more.add(key), renderThread()) : go);
      b.classList.add('card-more');
      return b;
    };
    const head2 = (title, meta) => {
      const h = el('div', 'card-head');
      h.append(el('h2', null, title));
      if (meta) h.append(el('span', 'meta', meta));
      return h;
    };
    const CARDS = {
      // B-189: what to bring on a class, lab, clinical or validation day, asked in words: that day's prep check, open,
      // each item naming where it came from (calendar, announcement, course calendar, library, his kit).
      prep(box, c, key) {
        const t0 = E.chicagoDate(now());
        const lead =
          c.date === t0
            ? 'Bag check: '
            : c.date === E.addDays(t0, 1)
              ? 'Pack for tomorrow: '
              : 'Pack for ' + E.shortDate(c.date) + ': ';
        const pe = prepEl(
          { id: key, prep: { date: c.date, phase: c.phase, title: c.title, said: c.said, lead } },
          { open: true }
        );
        if (pe) box.append(pe);
        else
          box.append(el('p', 'empty', 'Nothing on your calendar makes that a class, lab, clinical or validation day.'));
      },
      // B-182 (D-196): what waits on him, grouped by where it happens; each ask with its chips.
      yourturn(box) {
        const groups = ((S.yourturn && S.yourturn.groups) || []).filter(g => (g.tasks || []).length);
        const n = groups.reduce((s, g) => s + g.tasks.length, 0);
        box.append(head2('Your turn', n ? `${n} waiting` : ''));
        if (!n) {
          box.append(el('p', 'empty', 'Nothing waits on you.'));
          return;
        }
        for (const g of groups) {
          const sec = el('div', 'yt-place');
          sec.dataset.place = g.place;
          sec.append(el('h3', 'yt-label', g.label));
          const ul = el('ul', 'list');
          for (const t of g.tasks) {
            const li = el('li', 'row yt-item');
            li.dataset.task = t.id;
            const body = el('div', 'grow');
            body.append(
              el('p', 'yt-ask', t.ask),
              el('p', 'meta', t.id + (t.status === 'blocked' ? ' · blocked on you' : ''))
            );
            const sent = T.replied.get(t.id);
            const armed = T.ytArmed && T.ytArmed.task === t.id ? T.ytArmed.words : null;
            if (sent) body.append(el('p', 'meta yt-sent', `Sent: ${sent}. The builder takes it from here.`));
            else if (armed) {
              // Oct 21: one tap must never start a builder run; the chip asks first and Send fires it.
              body.append(
                el('p', 'yt-confirm', `Send “${armed}” on ${t.id} to the builder? It starts a build session.`)
              );
              const a = el('div', 'actions yt-chips');
              a.append(
                btn(
                  'Send',
                  ev =>
                    guard(ev.target, async () => {
                      T.ytArmed = null;
                      await replyAsk(t.id, armed);
                    }),
                  { primary: true }
                ),
                btn('Cancel', () => {
                  T.ytArmed = null;
                  render();
                })
              );
              body.append(a);
            } else {
              const a = el('div', 'actions yt-chips');
              const words =
                g.place === 'decision'
                  ? t.choices && t.choices.length
                    ? t.choices
                    : ['Yes', 'No', 'Later']
                  : ['Done', 'Fine'];
              for (const w of words)
                a.append(
                  btn(w, () => {
                    T.ytArmed = { task: t.id, words: w };
                    render();
                  })
                );
              a.append(btn(g.place === 'decision' ? 'Reply' : 'What’s off', () => startReply(t.id)));
              body.append(a);
            }
            li.append(body);
            ul.append(li);
          }
          sec.append(ul);
          box.append(sec);
        }
      },
      today(box, c, key) {
        const { items, isDone } = dayState();
        const all = items.filter(it => !it.deferred);
        // An "open" card keeps what he ticked during this visit, shown done, so the rows never shift under his finger.
        const open = c.filter === 'open' ? all.filter(it => !isDone(it) || T.ticked.has(it.id)) : all;
        const doneN = all.filter(isDone).length;
        // A card fits one screen (UI rule 3): five rows, the ones this reply changed first, then "N more in Today".
        const focus = new Set(c.focus || []);
        const list = [...open.filter(it => focus.has(it.id)), ...open.filter(it => !focus.has(it.id))];
        box.append(head2('Today’s list', all.length ? `${doneN} of ${all.length} done` : ''));
        if (!all.length) box.append(el('p', 'empty', 'Nothing planned yet. The 4:25am run builds the list.'));
        else if (!list.length) box.append(el('p', 'empty', 'Everything on today’s list is done.'));
        else {
          const ul = el('ul', 'list'),
            all5 = SF.more.has(key) ? list.length : CARD_ROWS;
          list.slice(0, all5).forEach(it => ul.append(itemRow(it, isDone)));
          box.append(ul);
          if (list.length > all5) box.append(cardMore(`${list.length - all5} more`, () => showTab('today'), key));
        }
        const a = el('div', 'actions');
        a.append(btn('Open Today', () => showTab('today')));
        box.append(a);
      },
      review(box, c, key) {
        const { rs, total } = reviewState();
        const cnt = el('span', 'meta');
        const h = head2('Today’s review');
        h.append(cnt);
        box.append(h);
        if (!total) {
          box.append(
            el('p', 'empty', rs ? 'Today’s set came through empty.' : 'Today’s review arrives with the 4:25am run.')
          );
          return;
        }
        const bar = el('i');
        bar.style.width = '0';
        const pr = el('div', 'progress');
        pr.append(bar);
        const body = el('div');
        box.append(pr, body);
        runner({
          key: 'ev-' + key,
          set: rs,
          items: E.validItems(rs),
          body,
          countEl: cnt,
          barEl: bar,
          label: 'E.V. Review · ' + short(today),
        });
      },
      set(box, c, key) {
        const s = S.sets.find(x => x.id === c.id);
        if (!s) {
          box.append(head2('Practice set'), el('p', 'empty', 'This set isn’t in the record (yet).'));
          return;
        }
        const cnt = el('span', 'meta');
        const h = head2(s.title || 'Practice set');
        h.append(cnt);
        box.append(h);
        const bar = el('i');
        bar.style.width = '0';
        const pr = el('div', 'progress');
        pr.append(bar);
        const body = el('div');
        box.append(pr, body);
        runner({
          key: 'ev-' + key,
          set: s,
          items: E.validItems(s),
          body,
          countEl: cnt,
          barEl: bar,
          label: 'E.V. · ' + (s.title || s.id),
        });
      },
      workout(box, c) {
        if (c.id) {
          const w = woOf(c.id);
          if (w) workoutCard(box, w);
          else box.append(head2('Workout'), el('p', 'empty', 'Setting it up…'));
          return;
        }
        const cur = activeWorkout();
        if (cur) {
          box.append(head2('Start a workout'), el('p', 'meta', `${cur.title} is going: its card is below.`));
          return;
        }
        workoutPicker(box);
      },
      skill(box, c) {
        const s = sessOf(c.session);
        if (!s || !s.skill) {
          box.append(head2('Skills practice'), el('p', 'empty', 'Setting it up…'));
          return;
        }
        const st = E.skillState(s);
        const live = s.status === 'active' && !!st.next;
        box.classList.add('check', live ? 'live' : 'done');
        box.append(
          head2(
            'Skills · ' + s.topic,
            `${st.done} of ${st.total}${st.missed.length ? ' · ' + st.missed.length + ' missed' : ''}`
          )
        );
        const pr = el('div', 'progress');
        const bar = el('i');
        bar.style.width = (st.total ? (100 * st.done) / st.total : 0) + '%';
        pr.append(bar);
        box.append(pr);
        if (live) {
          const step = st.next;
          const p = el('p', 'stem');
          p.append(el('b', null, 'Step ' + step.n + '. '), document.createTextNode(step.text));
          box.append(p);
          box.append(
            el(
              'p',
              'meta',
              [step.critical ? 'Must not be missed (asterisk on the checklist).' : '', s.skill.cite]
                .filter(Boolean)
                .join(' · ')
            )
          );
          const a = el('div', 'actions');
          a.append(
            btn('End', ev => guard(ev.target, () => finishSkill(s, 'ended'), 'Skills run saved')),
            el('span', 'grow')
          );
          a.append(
            btn('Missed it', ev =>
              guard(ev.target, () => skillMark(s, step.n, 'miss'), 'Logged as a skill to practice')
            ),
            btn('Did it', ev => guard(ev.target, () => skillMark(s, step.n, 'pass')), { primary: true })
          );
          box.append(a);
        } else {
          if (s.summary) box.append(el('p', 'result', s.summary));
          if (st.missed.length) {
            const ul = el('ul', 'list');
            st.missed.slice(0, CARD_ROWS).forEach(n => {
              const step = s.skill.steps.find(x => x.n === n);
              ul.append(
                row({
                  title: 'Step ' + n + ': ' + step.text,
                  chips: [[step.critical ? 'must not miss' : 'missed', step.critical ? 'bad' : 'warn']],
                })
              );
            });
            box.append(ul);
          }
          box.append(
            el(
              'p',
              'meta',
              st.missed.length
                ? 'Missed steps are on Progress → Weak spots as skills to practice; a later run that gets them right clears them.'
                : 'Clean run.'
            )
          );
        }
      },
      audit(box, c, k, all) {
        const ex = M.target;
        if (!ex) {
          box.append(head2('Readiness audit'), el('p', 'empty', 'No upcoming exam with weak spots yet.'));
          return;
        }
        const rows = auditRows();
        box.append(head2('Readiness audit · ' + exShort(ex), plural(rows.length, 'objective')));
        if (!rows.length) {
          box.append(el('p', 'empty', 'No weak spots logged for this exam yet.'));
          return;
        }
        const ul = el('ul', 'list');
        rows.slice(0, all ? rows.length : CARD_ROWS).forEach(r =>
          ul.append(
            row({
              title: r.id + ' · ' + String(r.text).slice(0, 80),
              detail: [
                `${r.solid} solid · ${r.rightOnce} right once · ${r.notYet} not yet`,
                r.passages.length
                  ? 'Reread: ' + r.passages.map(x => x.cite).join('; ')
                  : (r.notYet || r.rightOnce) && !LIB.mats
                    ? 'Finding what to reread…'
                    : '',
              ]
                .filter(Boolean)
                .join(' · '),
              chips: [r.notYet ? ['not yet ' + r.notYet, 'warn'] : r.rightOnce ? ['almost', 'info'] : ['solid', 'ok']],
            })
          )
        );
        box.append(ul);
        if (!all && rows.length > CARD_ROWS)
          box.append(
            cardMore(`${rows.length - CARD_ROWS} more objectives in Progress`, () => {
              showTab('progress');
              $('seg-progress').querySelector('[data-v="readiness"]').click();
            })
          );
      },
      readiness(box) {
        const ex = M.target;
        if (!ex) {
          box.append(head2('Readiness'), el('p', 'empty', 'No upcoming exam with weak spots yet.'));
          return;
        }
        const r = E.readiness({ examId: ex.id, weakspots: M.models });
        const d = E.diffDays(today, ex.date);
        box.append(
          head2('Readiness · ' + (ex.title || ex.id).replace(/:.*$/, ''), d === 0 ? 'today' : plural(d, 'day') + ' out')
        );
        const big = el('p', 'big', r.pctSolid != null ? r.pctSolid + '% solid' : 'No weak spots yet');
        box.append(big);
        const m = el('div', 'meter');
        const i = el('i');
        i.style.width = Math.max(2, r.pctSolid || 0) + '%';
        m.append(i);
        box.append(m);
        box.append(
          el(
            'p',
            'meta',
            `${r.solid} solid · ${r.rightOnce} right once · ${r.notYet} not yet${r.preRead ? ' · ' + r.preRead + ' previews' : ''}. About ${r.need} correct reviews to go.`
          )
        );
        const a = el('div', 'actions');
        a.append(
          btn('Details', () => {
            showTab('progress');
            $('seg-progress').querySelector('[data-v="readiness"]').click();
          })
        );
        box.append(a);
      },
      dates(box, c, key) {
        const days = Math.max(1, Math.min(14, Number(c.days) || 7));
        const from = days === 1 ? E.addDays(today, 1) : today;
        const to = E.addDays(today, days);
        const list = S.dates
          .filter(d => d.date >= from && d.date <= to)
          .sort((a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(b.title));
        box.append(
          head2(
            days === 1 ? 'Tomorrow · ' + short(from) : 'Next ' + days + ' days',
            list.length ? plural(list.length, 'date') : ''
          )
        );
        if (!list.length) {
          box.append(el('p', 'empty', days === 1 ? 'Nothing dated tomorrow.' : 'Nothing dated in that window.'));
          return;
        }
        const ul = el('ul', 'list'),
          all5 = SF.more.has(key) ? list.length : CARD_ROWS;
        list.slice(0, all5).forEach(d => ul.append(dateRow(d)));
        box.append(ul);
        if (list.length > all5) box.append(cardMore(`${list.length - all5} more`, null, key));
      },
      weakspots(box) {
        const due = E.rankDue(M.models, today, S.exams);
        const act = M.models
          .filter(w => E.isActive(w) && !w.derived.preRead)
          .sort((a, b) => String(a.derived.nextDue || '9').localeCompare(String(b.derived.nextDue || '9')));
        const list = (due.length ? due : act).slice(0, 5);
        box.append(head2(due.length ? 'Due now' : 'Active weak spots', `${due.length} due · ${act.length} active`));
        if (!list.length) box.append(el('p', 'empty', 'No active weak spots. Suspiciously excellent.'));
        else {
          const ul = el('ul', 'list');
          list.forEach(w => ul.append(wsRow(w)));
          box.append(ul);
        }
        const a = el('div', 'actions');
        a.append(
          btn('All weak spots', () => {
            showTab('progress');
            $('seg-progress').querySelector('[data-v="weak"]').click();
          })
        );
        box.append(a);
      },
      // B-45 (D-102): a plan the exam-plan job drafted. While it is a draft its one action makes it the plan in force
      // (planedits/<exam>.plan, ticks kept); once in force it opens the Study tab's plan.
      plan(box, c) {
        const p = (S.plansRaw || []).find(x => x.id === c.id);
        if (!p) {
          box.append(head2('Exam plan'), el('p', 'empty', 'Saving the plan…'));
          return;
        }
        const examId = p.exam || p.id,
          inForce = S.plans.some(x => x.id === p.id),
          tasks = E.planTasks(p);
        box.append(
          head2(
            p.title || 'Exam plan ' + examId,
            `${plural((p.days || []).length, 'day')} · ${plural(tasks.length, 'task')}`
          )
        );
        const ul = el('ul', 'list');
        (p.days || [])
          .slice(0, 3)
          .forEach(d =>
            ul.append(
              row({ lead: short(d.date), title: [d.label, plural(d.tasks.length, 'task')].filter(Boolean).join(' · ') })
            )
          );
        box.append(ul);
        const a = el('div', 'actions');
        if (inForce) {
          box.append(el('p', 'meta', 'This is the plan in force.'));
          a.append(
            btn('Open the plan', () => {
              ui.planShown = p.id; // B-194: this card's plan, not the target exam's
              showTab('study');
              setStudy('plan');
              render();
            })
          );
        } else
          a.append(
            btn(
              'Use this plan',
              ev =>
                guard(
                  ev.target,
                  () => {
                    const pe = S.planedits.find(x => x.id === examId) || null;
                    const r = E.planAccept(pe, examId, p.id, { now: now() });
                    return write({ op: 'set', collection: 'planedits', id: r.id, data: r.data });
                  },
                  'This plan is in force'
                ),
              { primary: true }
            )
          );
        box.append(a);
      },
      job(box, c) {
        const j = S.jobs.find(x => x.id === c.id);
        if (!j) {
          box.append(head2('Background job'), el('p', 'empty', 'Setting it up…'));
          return;
        }
        const st = jobState(j);
        const h = el('div', 'card-head');
        h.append(el('h2', null, kindLabel(j.kind) || 'Background job'), chip(st.label, st.v));
        box.append(h);
        box.append(el('p', 'job-title', j.title || j.id));
        const r = j.result || {};
        if (j.status === 'done' && r.retro) box.append(retroList(r.retro));
        if (j.kind === 'build' && (j.status === 'done' || j.status === 'failed')) box.append(buildList(j));
        else if (j.status === 'done' && r.text) {
          const p = el('div', 'result');
          p.append(fmt(r.text));
          box.append(p);
        } else box.append(el('p', 'meta', st.detail));
        const links = (r.links || []).filter(l => l && /^https:\/\//.test(l.url || ''));
        if (links.length) {
          const L = el('div', 'links');
          links.forEach(l => {
            const a = el('a', null, (l.title || l.url).slice(0, 80));
            a.href = l.url;
            a.target = '_blank';
            a.rel = 'noopener';
            L.append(a);
          });
          box.append(L);
        }
        const a = el('div', 'actions');
        let any = false;
        if (j.status === 'done' && r.setId && S.sets.some(s => s.id === r.setId)) {
          a.append(
            btn(
              'Open the set',
              () => {
                ui.openSet = r.setId;
                showTab('study');
                setStudy('practice');
                render();
              },
              { primary: true }
            )
          );
          any = true;
        }
        if (j.status === 'done' && j.kind === 'exam-plan') {
          a.append(
            btn('See plans', () => {
              showTab('study');
              setStudy('plan');
            })
          );
          any = true;
        }
        if (st.retry) {
          a.append(btn('Try again', ev => guard(ev.target, () => refire(j))));
          any = true;
        }
        if (any) box.append(a);
      },
      chart(box) {
        const st = E.answerStats(M.attempts.all, { date: today });
        const days = st.lastDays || [];
        const n = days.reduce((s, d) => s + d.n, 0),
          r = days.reduce((s, d) => s + d.right, 0);
        box.append(head2('Last 7 days', n ? `${r} of ${n} right (${pct(r, n)})` : ''));
        if (!n) {
          box.append(el('p', 'empty', 'No answers in the last week yet.'));
          return;
        }
        const NS = 'http://www.w3.org/2000/svg';
        const W = 320,
          H = 132,
          top = 18,
          base = 104,
          bw = 30,
          gap = (W - days.length * bw) / (days.length + 1);
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('role', 'img');
        svg.setAttribute(
          'aria-label',
          'Percent right per day: ' + days.map(d => `${short(d.date)} ${d.n ? pct(d.right, d.n) : 'none'}`).join(', ')
        );
        const mk = (tag, attrs, text) => {
          const e = document.createElementNS(NS, tag);
          for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
          if (text != null) e.textContent = text;
          svg.append(e);
          return e;
        };
        days.forEach((d, i) => {
          const x = gap + i * (bw + gap);
          const h = d.n ? Math.max(3, ((base - top) * d.right) / d.n) : 0;
          mk('rect', { class: 'base', x, y: top, width: bw, height: base - top, rx: 4 });
          if (d.n) {
            mk('rect', { class: 'bar', x, y: base - h, width: bw, height: h, rx: 4 });
            mk(
              'text',
              {
                class: 'pct',
                x: x + bw / 2,
                y: base - h - 4 > top + 8 ? base - h - 4 : top - 4,
                'text-anchor': 'middle',
              },
              pct(d.right, d.n)
            );
          }
          mk('text', { x: x + bw / 2, y: base + 13, 'text-anchor': 'middle' }, short(d.date).split(' ')[0]);
          mk('text', { x: x + bw / 2, y: base + 25, 'text-anchor': 'middle' }, d.n ? d.n + ' q' : '–');
        });
        const wrap = el('div', 'chart');
        wrap.append(svg);
        box.append(wrap);
      },
      quizlet(box) {
        // B-41: the open weak spots as Quizlet cards, copied on his tap; nothing is written to the record
        const cards = quizletCards();
        box.append(head2('Weak spots for Quizlet', plural(cards.length, 'card')));
        const ul = el('ul', 'list');
        ul.append(...cards.slice(0, 4).map(c => row({ title: c.term, detail: c.definition.slice(0, 140) })));
        if (cards.length > 4)
          ul.append(row({ title: `+ ${cards.length - 4} more`, detail: 'All of them go in the copy.' }));
        const a = el('div', 'actions');
        a.append(btn(`Copy ${plural(cards.length, 'card')} for Quizlet`, () => copyQuizlet(box), { primary: true }));
        box.append(
          ul,
          a,
          el('p', 'meta', 'In Quizlet: Create, Import, then paste. Term and definition are separated by a tab.')
        );
      },
      checkin(box, c, key) {
        const ci = (M.dayedit && M.dayedit.checkin) || null;
        box.append(head2('Energy check', ci && ci.energy ? 'logged ' + clock12(ci.at) : ''));
        const g = el('div', 'energy');
        const labels = ['Empty', 'Low', 'Okay', 'Good', 'Charged'];
        labels.forEach((lab, i) => {
          const n = i + 1;
          const b = el('button');
          b.type = 'button';
          b.setAttribute('aria-pressed', String(!!ci && ci.energy === n));
          b.append(el('b', null, String(n)), el('small', null, lab));
          b.addEventListener('click', () =>
            guard(b, async () => {
              const changed = !ci || ci.energy !== n;
              await saveCheckin({ energy: n });
              if (changed && !T.posted.has('ci-' + key + n)) {
                T.posted.add('ci-' + key + n);
                await evSay(energyAdvice(n), [], { tier: 'local' });
              }
            })
          );
          g.append(b);
        });
        box.append(g, el('p', 'meta', 'Saved to today in your record. A number, not a diagnosis.'));
      },
      check(box, c, k) {
        const s = sessOf(c.session);
        const st = s ? E.sessionState(s, now()) : null;
        // B-75 (D-132): an open check is one question in its own set, answered here in his own words.
        const oset = c.setId ? S.sets.find(x => x.id === c.setId) : null;
        const oans = oset ? answersOf(oset) : null;
        const answered = (st && st.answered[c.n]) || (oset && Object.keys(oans).length > 0);
        const live = !answered && !!s && s.status === 'active';
        box.classList.add('check', live ? 'live' : 'done');
        // B-122 (D-160, D-161): its head line folds it to that one line and back; folding files nothing, and the next
        // checkpoint's card arrives open.
        const key = c.session + '#' + c.n,
          folded = T.checkFold.has(key);
        box.classList.toggle('folded', folded);
        const f = el('button', 'fold-line check-fold', `Check ${c.n} · ${plural((c.items || []).length, 'question')}`);
        f.type = 'button';
        f.setAttribute('aria-expanded', String(!folded));
        f.addEventListener('click', () => {
          const on = !T.checkFold.has(key);
          on ? T.checkFold.add(key) : T.checkFold.delete(key);
          box.classList.toggle('folded', on);
          f.setAttribute('aria-expanded', String(!on));
        });
        const h = el('div', 'card-head check-head');
        h.append(
          f,
          chip(answered ? 'answered' : live ? 'your turn' : 'session over', answered ? 'ok' : live ? 'accent' : '')
        );
        box.append(h);
        if (oset) {
          const body = el('div', 'check-open');
          box.append(body);
          runner({
            key: 'chk-' + key,
            set: oset,
            items: E.validItems(oset),
            body,
            label: 'E.V. · ' + (oset.title || ''),
          });
          return;
        }
        const ol = el('ol', 'check-items');
        const KIND = { why: 'Why', gap: 'Gap', link: 'Link', weakspot: 'Revisit' };
        (c.items || []).forEach(x => {
          const kind = KIND[x.kind] ? x.kind : 'why';
          const li = el('li');
          li.append(el('span', 'check-kind ' + kind, KIND[kind]), el('span', null, x.text));
          ol.append(li);
        });
        box.append(ol);
        if (!live) return;
        const a = el('div', 'actions');
        a.append(el('span', 'grow meta', 'Answer any of them below, in your own words.'));
        a.append(
          btn(
            'Answer',
            () => {
              input.placeholder = `Answer check ${c.n}…`;
              input.focus();
            },
            { primary: true }
          )
        );
        box.append(a);
      },
      session(box, c) {
        const s = sessOf(c.id);
        if (!s) {
          box.append(head2('Study session'), el('p', 'empty', 'Saving the session…'));
          return;
        }
        if (s.status !== 'ended') {
          box.append(
            head2('Study session · ' + (s.topic || ''), 'wrapping up'),
            el('p', 'meta', 'Writing the summary, weak spots and cards…')
          );
          return;
        }
        box.append(
          head2(
            'Study session · ' + (s.topic || ''),
            [
              s.minutes != null ? s.minutes + ' min' : '',
              s.checks ? plural(s.checks, 'check') : '',
              s.questions ? plural(s.questions, 'question') : '',
            ]
              .filter(Boolean)
              .join(' · ')
          )
        );
        if (s.summary) box.append(el('p', 'result', s.summary));
        const sec = (title, arr) => {
          if (!arr || !arr.length) return;
          const d = el('div', 'sess-sec');
          d.append(el('h3', null, title));
          const ul = el('ul');
          arr.forEach(t => ul.append(el('li', null, t)));
          d.append(ul);
          box.append(d);
        };
        sec('Weak spots', s.weakSpots);
        sec('Ideas kept', s.connections);
        sec('Note to-dos', s.noteTodos);
        for (const [k, q] of Object.entries(s.pending || {})) {
          if (!q || !q.candidate) continue;
          const p = el('div', 'pend');
          p.append(el('div', null, `Is “${q.topic}” the same as your weak spot “${q.candidate.topic}”?`));
          const a = el('div', 'actions');
          a.append(
            btn('Same', ev => guard(ev.target, () => decideSession(s, k, 'same'), 'Counted as the same weak spot'), {
              cls: 'violet',
            }),
            btn('Different', ev =>
              guard(ev.target, () => decideSession(s, k, 'different'), 'Logged as a new weak spot')
            )
          );
          p.append(a);
          box.append(p);
        }
        const a = el('div', 'actions');
        if ((s.cards || []).length) {
          const cp = btn(
            `Copy ${plural(s.cards.length, 'card')} for Quizlet`,
            async () => {
              const t = E.cardsText(s.cards);
              try {
                await navigator.clipboard.writeText(t);
                toast('Copied. In Quizlet: Create, Import, then paste.');
              } catch {
                const ta = el('textarea');
                ta.readOnly = true;
                ta.value = t;
                ta.setAttribute('aria-label', 'Flashcards as Quizlet import text');
                box.append(ta);
                ta.focus();
                ta.select();
                toast('Select all and copy, then paste into Quizlet’s Import.');
              }
            },
            { primary: true }
          );
          a.append(cp);
        }
        if (sample && !T.sampleOff)
          a.append(
            btn('5 more on this', () => {
              if (morePending) {
                toast('Already writing a batch.');
                return;
              }
              morePractice({ announce: true, topic: s.topic });
              toast('Writing 5 on ' + s.topic + '…');
            })
          );
        if (a.childElementCount) box.append(a);
      },
      material(box, c) {
        const m = c.id ? matById(c.id) : LIB.mats ? E.citeTarget(LIB.mats, c) : null;
        if (!m) {
          box.append(el('p', 'empty', c.cite && LIB.mats ? `${c.title} isn’t in your library.` : 'In your library.'));
          if (!LIB.mats && !LIB.loading) library().catch(() => {});
          return;
        }
        box.append(head2((m.title || m.id).replace(/\.(pdf|docx|pptx)$/i, ''), matMeta(m)));
        if (m.status === 'removed') {
          box.append(el('p', 'meta', 'Removed from your library.'));
          return;
        }
        // B-78 (D-126): a citation opens its passage: the words from that page on, the file and page, Read from here.
        if (c.page) {
          const r = E.readMaterial(m, { page: c.page, maxChars: 700 });
          const txt = String(r.text || '')
            .replace(/\[(?:p|s|Page |Slide )\d+\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          box.append(el('p', 'passage', txt.slice(0, 520) + (txt.length > 520 || r.more ? '…' : '')));
          const where = `${(m.title || m.id).replace(/\.(pdf|docx|pptx)$/i, '')} · ${c.unit === 'slide' ? 'slide' : 'page'} ${c.page}`;
          const a = el('div', 'actions');
          a.append(el('span', 'grow meta', where));
          a.append(btn('Read from here', () => chat(`Read ${c.cite || where} with me, from there on.`)));
          box.append(a);
          return;
        }
        box.append(
          el(
            'p',
            'stem',
            String(m.text || '')
              .replace(/\[(?:p|s|Page |Slide )\d+\]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 220) + '…'
          )
        );
        if (m.source === 'upload') {
          const a = el('div', 'actions');
          a.append(
            btn('Remove from library', ev => guard(ev.target, () => removeUpload(m), 'Removed from your library'))
          );
          box.append(a);
        }
      },
      link(box, c) {
        if (!/^https:\/\//.test(c.url || '')) return;
        const a = el('a', null, c.title || c.url);
        a.href = c.url;
        a.target = '_blank';
        a.rel = 'noopener';
        box.append(a);
      },
    };
    // A surface's line for the cards that only inform (B-85's lines, read by sfLine since B-78).
    const exShort = ex => (ex.title || ex.id).replace(/:.*$/, '');
    function auditRows() {
      const ex = M.target;
      if (!ex) return [];
      if (!LIB.mats && !LIB.loading)
        library()
          .then(() => render())
          .catch(() => {});
      return E.readinessAudit({ examId: ex.id, objectives: S.objectives, weakspots: M.models, index: LIB.idx || null });
    }
    const openIn = (tab, seg, v, at) => () => {
      showTab(tab);
      const b = seg && $('seg-' + seg).querySelector(`[data-v="${v}"]`);
      if (b) b.click();
      if (at)
        requestAnimationFrame(() => {
          const e = $(at);
          if (e && !e.hidden) e.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
    };
    const span = d =>
      d === 1
        ? 'tomorrow'
        : d === 7
          ? 'in the next week'
          : d === 14
            ? 'in the next two weeks'
            : `in the next ${d} days`;
    const LINES = {
      today() {
        const { items, isDone } = dayState();
        const all = items.filter(it => !it.deferred);
        const d = all.filter(isDone).length;
        return {
          text: all.length ? `Today’s list · ${d} of ${all.length} done` : 'Nothing on today’s list yet',
          go: () => showTab('today'),
        };
      },
      dates(c) {
        const days = Math.max(1, Math.min(14, Number(c.days) || 7));
        const from = days === 1 ? E.addDays(today, 1) : today;
        const to = E.addDays(today, days);
        const n = S.dates.filter(d => d.date >= from && d.date <= to).length;
        return {
          text: n ? `${plural(n, 'date')} ${span(days)}` : `Nothing dated ${span(days)}`,
          go: openIn('record', 'record', 'dates'),
        };
      },
      weakspots() {
        const due = E.rankDue(M.models, today, S.exams).length,
          act = M.models.filter(w => E.isActive(w) && !w.derived.preRead).length;
        return {
          text: act ? `${due} due now · ${plural(act, 'active weak spot')}` : 'No active weak spots',
          go: openIn('progress', 'progress', 'weak'),
        };
      },
      readiness() {
        const ex = M.target;
        if (!ex)
          return {
            text: 'Readiness: no upcoming exam with weak spots yet',
            go: openIn('progress', 'progress', 'readiness'),
          };
        const r = E.readiness({ examId: ex.id, weakspots: M.models });
        const d = E.diffDays(today, ex.date);
        return {
          text: `${exShort(ex)} readiness · ${r.pctSolid != null ? r.pctSolid + '% solid' : 'no weak spots yet'} · ${d === 0 ? 'today' : plural(d, 'day') + ' out'}`,
          go: openIn('progress', 'progress', 'readiness', 'ready-card'),
        };
      },
      audit() {
        const ex = M.target;
        const rows = auditRows();
        const reread = rows.filter(r => r.notYet || r.rightOnce).length;
        return {
          text: ex
            ? `${exShort(ex)} audit · ${plural(rows.length, 'objective')}${reread ? ` · ${reread} to reread` : ''}`
            : 'Readiness audit: no upcoming exam yet',
          go: openIn('progress', 'progress', 'readiness', 'audit-card'),
        };
      },
      chart() {
        const days = E.answerStats(M.attempts.all, { date: today }).lastDays || [];
        const n = days.reduce((s, d) => s + d.n, 0),
          r = days.reduce((s, d) => s + d.right, 0);
        return {
          text: n ? `Last 7 days · ${r} of ${n} right (${pct(r, n)})` : 'No answers in the last week yet',
          go: openIn('progress', 'progress', 'readiness', 'acc-days'),
        };
      },
    };
    // B-90 (Matt, Oct 19): the greeting is one line; what is behind it is a briefing folded under it on every open. As
    // Matt drew it: plain text, no pills or surfaces. The fold line counts the items, with one dot for the highest
    // priority in it (red urgent, else teal new); open, each item is one gray-bulleted line, cut with an ellipsis, a
    // small accent mark at its end for urgent or new, and a chevron that opens it in place to the full text and its
    // action as a text link.
    T.briefOpen = false;
    T.briefItem = new Set();
    const CHEV =
      '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    const goTab = t =>
      t === 'record'
        ? openIn('record', 'record', 'dates')()
        : t === 'progress'
          ? openIn('progress', 'progress', 'readiness')()
          : showTab(t);
    const TAB_NAME = { today: 'Today', record: 'Record', progress: 'Progress', system: 'System', study: 'Study' };
    function briefEl(m) {
      const b = m.brief,
        top = b.some(x => x.level === 'urgent') ? 'urgent' : b.some(x => x.level === 'new') ? 'new' : '';
      const wrap = el('div', 'brief');
      const listId = 'brief-' + m.id;
      const row = el('button', 'brief-row');
      row.type = 'button';
      row.setAttribute('aria-controls', listId);
      row.append(el('span', 'br-t', b.length === 1 ? '1 thing to know' : `${b.length} things to know`));
      if (top) {
        const d = el('span', 'br-dot ' + top);
        d.setAttribute('role', 'img');
        d.setAttribute('aria-label', top === 'urgent' ? 'something urgent' : 'something new');
        row.append(d);
      }
      row.insertAdjacentHTML('beforeend', CHEV);
      const ul = el('ul', 'brief-list');
      ul.id = listId;
      for (const it of b) {
        const li = el('li', 'brief-item');
        li.dataset.level = it.level;
        li.dataset.kind = it.kind;
        const tog = el('button', 'bi-main');
        tog.type = 'button';
        const line = el('span', 'bi-line');
        line.append(el('span', 'bi-t', it.level === 'prep' ? it.title.replace(/^Prep: /, '') : it.title));
        if (it.level === 'prep')
          line.append(el('span', 'bi-prep', 'Prep')); // D-143: its own calm marker, never the urgent one
        else if (it.level !== 'normal') {
          const a = el('span', 'bi-mark ' + it.level, '*');
          a.setAttribute('aria-label', it.level === 'urgent' ? 'urgent' : 'new');
          line.append(a);
        }
        tog.append(line);
        tog.insertAdjacentHTML('beforeend', CHEV);
        const more = el('div', 'bi-more');
        const when = it.when ? it.when.charAt(0).toUpperCase() + it.when.slice(1) + '.' : '';
        const d = [
          it.level === 'urgent' && when ? (it.kind === 'due' ? 'Due ' + it.when + '.' : when) : '',
          it.detail || '',
        ]
          .filter(Boolean)
          .join(' ');
        if (d) more.append(el('p', 'bi-d', d));
        const go = it.action
          ? btn(it.action.label === 'Start' ? 'Start review' : it.action.chip, () =>
              guard(null, () => quick(it.action.chip))
            )
          : it.tab
            ? btn('Open ' + (TAB_NAME[it.tab] || it.tab), () => goTab(it.tab))
            : null;
        if (go) {
          go.className = 'bi-go';
          go.insertAdjacentHTML('beforeend', ' <span aria-hidden="true">→</span>');
          more.append(go);
        }
        const set = o => {
          li.classList.toggle('open', o);
          tog.setAttribute('aria-expanded', String(o));
          if (o) T.briefItem.add(it.id);
          else T.briefItem.delete(it.id);
        };
        set(T.briefItem.has(it.id));
        tog.addEventListener('click', () => set(!li.classList.contains('open')));
        li.append(tog, more);
        ul.append(li);
      }
      const show = o => {
        T.briefOpen = o;
        ul.hidden = !o;
        row.setAttribute('aria-expanded', String(o));
        wrap.classList.toggle('open', o);
        try {
          renderStage();
          syncChips();
        } catch {}
      };
      show(T.briefOpen);
      row.addEventListener('click', () => {
        show(!T.briefOpen);
        CAP.stick = true; // her stage steps down over 0.8 s; then her line pins and the list comes into view
        clearTimeout(T.briefT);
        T.briefT = setTimeout(
          () => {
            pinNow();
            if (T.briefOpen) {
              const t = $('thread'),
                r = ul.getBoundingClientRect(),
                tr = t.getBoundingClientRect();
              if (r.bottom > tr.bottom)
                t.scrollTop += Math.min(r.bottom - tr.bottom + 12, Math.max(0, r.top - tr.top - 8));
            }
          },
          REDUCE ? 50 : 850
        );
      });
      wrap.append(row, ul);
      return wrap;
    }
    // The prep check under her greeting (B-104; D-143, D-144): the night-before pack check from the evening on, the
    // morning-of bag check in the morning, each a tickable list EVCore builds for that day from that day's materials.
    // A tick or an added item is that day's dayedits/<date>; once every item is ticked the check folds to one line.
    T.prepOpen = new Map();
    function prepNow(p) {
      if (!p) return null;
      if (!LIB.mats) {
        library().catch(() => {});
        return { loading: true };
      }
      // B-189: a day he named the kind of ("I have lab today") stands in when the calendar has no entry for it.
      const day = p.said && p.said.length ? E.prepDaySaid(S.dates, [], p.date, p.said) : E.prepDay(S.dates, [], p.date);
      if (!day) return null;
      return E.prepList({
        day,
        phase: p.phase,
        index: LIB.idx,
        dates: S.dates,
        dayedits: S.dayedits,
        announcements: S.announcements,
      });
    }
    async function prepWrite(date, edit) {
      const r = E.prepEdit(dayEditDoc(date), edit, { now: now(), by: 'Matt', date });
      if (r.doc) await writeDayEdit(date, r.doc);
      return r;
    }
    function prepEl(m, o = {}) {
      // o.open: whether it starts open (default: until it is ticked through)
      const p = m.prep,
        l = prepNow(p);
      if (!l) return null;
      const night = p.phase === 'night';
      const wrap = el('div', 'prep');
      wrap.dataset.phase = p.phase;
      const row = el('button', 'prep-row');
      row.type = 'button';
      row.append(
        el('span', 'prep-mark', 'Prep'),
        el('span', 'prep-t', (p.lead || (night ? 'Pack for tomorrow: ' : 'Bag check: ')) + p.title)
      );
      if (l.loading) {
        row.append(el('span', 'prep-n', 'reading your materials…'));
        row.disabled = true;
        wrap.append(row);
        return wrap;
      }
      const n = l.items.filter(i => i.checked).length;
      if (l.done) {
        wrap.classList.add('done');
        row.querySelector('.prep-t').textContent =
          (p.lead ? 'Packed: ' : night ? 'Packed for tomorrow: ' : 'Bag checked: ') + p.title;
      }
      row.append(el('span', 'prep-n', l.items.length ? `${n} of ${l.items.length}` : ''));
      row.insertAdjacentHTML('beforeend', CHEV);
      const box = el('div', 'prep-box');
      box.id = 'prep-' + m.id;
      row.setAttribute('aria-controls', box.id);
      if (l.note) box.append(el('p', 'prep-note', l.note));
      const ul = el('ul', 'prep-list');
      for (const it of l.items) {
        const li = el('li', 'prep-item' + (it.checked ? ' on' : ''));
        const lab = el('label', 'prep-lab');
        const c = el('input');
        c.type = 'checkbox';
        c.className = 'tick';
        c.checked = !!it.checked;
        c.setAttribute('aria-label', it.text);
        c.addEventListener('change', () =>
          guard(c, () => prepWrite(p.date, { action: 'check', id: it.id, phase: p.phase, done: c.checked }))
        );
        const txt = el('span', 'pi-txt');
        txt.append(el('span', 'pi-t', it.text));
        const src = it.cite ? it.cite : it.usual ? 'you usually bring' : it.added ? 'added by you' : '';
        if (src || it.paperwork)
          txt.append(
            el(
              'span',
              'pi-c',
              [src, it.paperwork ? 'bring it; filling it in is yours' : ''].filter(Boolean).join(' · ')
            )
          );
        lab.append(c, txt);
        li.append(lab);
        if (it.added) {
          const rm = btn('Remove', () => guard(rm, () => prepWrite(p.date, { action: 'remove', id: it.id })), {
            cls: 'quiet pi-rm',
          });
          rm.setAttribute('aria-label', 'Remove ' + it.text);
          li.append(rm);
        }
        ul.append(li);
      }
      if (l.items.length) box.append(ul);
      const f = el('form', 'prep-add');
      f.autocomplete = 'off';
      const inp = el('input');
      inp.type = 'text';
      inp.placeholder = 'Something else to bring';
      inp.setAttribute('aria-label', 'Add something to bring');
      inp.maxLength = 80;
      const add = el('button', null, 'Add');
      add.type = 'submit';
      f.append(inp, add);
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        const t = inp.value.trim();
        if (!t) return;
        guard(add, async () => {
          await prepWrite(p.date, { action: 'add', text: t });
          inp.value = '';
        });
      });
      box.append(f);
      const key = m.id + ':' + p.phase;
      const open = T.prepOpen.has(key) ? T.prepOpen.get(key) : o.open != null ? o.open && !l.done : !l.done;
      const show = o => {
        T.prepOpen.set(key, o);
        box.hidden = !o;
        row.setAttribute('aria-expanded', String(o));
        wrap.classList.toggle('open', o);
      };
      show(open);
      row.addEventListener('click', () => show(!wrap.classList.contains('open')));
      // Ticking the last item folds the check away; reopening it is one tap on its line.
      if (l.done && T.prepWasDone && T.prepWasDone.get(key) === false) show(false);
      (T.prepWasDone = T.prepWasDone || new Map()).set(key, l.done);
      wrap.append(row, box);
      return wrap;
    }
    // B-78: a reply's cards are no longer drawn under her line; they are the surfaces (75-ev-surfaces.js).
    function renderCards(rec) {
      if (rec.cardsBox.firstChild) rec.cardsBox.replaceChildren();
    }
    T.checkFold = new Set();

