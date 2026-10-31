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
    // D-362 (B-449): the one way chat starts a new (Sonnet) study plan: his tap on the chip E.V. offered, which starts one
    // exam-plan job with the words that led to it. Once the job is in the record the chip is that job's card; a tap not
    // yet saved shows it started, so a second tap can't start another.
    const newPlanTapped = new Set();
    const CARDS = {
      newplan(box, c, key) {
        // the job this chip started, else any new plan for the course still queued or running (one at a time)
        const job = E.studyPlanChipStarted(c, S.jobs, key) || E.studyPlanNewJobRunning(S.jobs, c.course);
        if (job) return CARDS.job(box, { type: 'job', id: job.id }); // the job it started, as its own card shows it
        box.append(head2('A new study plan', c.course));
        const started = newPlanTapped.has(key);
        box.append(
          el(
            'p',
            'meta',
            started
              ? 'Started: it shows here when it’s ready, as a draft beside the plan you have.'
              : 'A whole new plan from today. The plan you have stays until you use the new one.'
          )
        );
        if (started) return;
        const a = el('div', 'actions');
        a.append(
          btn(
            `Make a new ${c.course} plan`,
            ev =>
              guard(
                ev.target,
                async () => {
                  newPlanTapped.add(key);
                  const r = await startJob(E.studyPlanChipJob(c, key));
                  // B-456: on the claude.ai page nothing was written: the chip stays, and says where plans are made
                  if (!r.id) {
                    newPlanTapped.delete(key);
                    toast(fireCopy(r.fired.error));
                  }
                  render();
                },
                null,
                () => newPlanTapped.delete(key)
              ),
            { primary: true }
          )
        );
        box.append(a);
      },
      // B-189: what to bring on a class, lab, clinical or validation day, asked in words: that day's prep check, open,
      // each item naming where it came from (calendar, announcement, course calendar, library, his kit).
      prep(box, c, key) {
        const t0 = E.chicagoDate(now());
        const lead =
          c.date === t0
            ? 'Bag check: '
            : c.date === E.addDays(t0, 1)
              ? 'Pack for tomorrow: '
              : 'Pack for ' + short(c.date) + ': ';
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
        if (!all.length) box.append(el('p', 'empty', 'Nothing planned yet. The 4:25 am run builds the list.'));
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
            el('p', 'empty', rs ? 'Today’s set came through empty.' : 'Today’s review arrives with the 4:25 am run.')
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
        // B-517: a quiz started in place names the questions it holds (c.ids) and its own title
        const pick = Array.isArray(c.ids) && c.ids.length ? new Set(c.ids) : null;
        const items = E.validItems(s).filter(q => !pick || pick.has(q.id));
        const shortBy = pick ? '' : E.practiceReply.setShortfall(s, items.length); // B-480: "9 of 10: 1 didn't pass E.V.'s checks"
        const h = head2((c.title || s.title || 'Practice set') + (shortBy ? ' · ' + shortBy : ''));
        h.append(cnt); // B-191 (D-160): a set surface folds back into the conversation by its own head line
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
          items,
          body,
          countEl: cnt,
          barEl: bar,
          label: 'E.V. · ' + (c.title || s.title || s.id),
        });
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
          head2(
            'Readiness · ' + (ex.title || ex.id).replace(/:.*$/, ''),
            d > 0 ? plural(d, 'day') + ' out' : E.relDay(ex.date, today)
          )
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
            showTab('study'); // B-297 (D-281): weak spots live in Study
            $('seg-study').querySelector('[data-v="weak"]').click();
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
            btn('Open the plan', () => openPlanInStudy(examId, p.id)) // B-450: the plan lives in Study's overview
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
        const j0 = S.jobs.find(x => x.id === c.id);
        // B-200 (D-208): Try again shows the job queued on the tap; the record catches up (or a refusal puts it back).
        const j = jobSeen(j0);
        if (!j) {
          box.append(head2('Background job'), el('p', 'empty', 'Setting it up…'));
          return;
        }
        const st = jobState(j);
        const h = el('div', 'card-head');
        h.append(el('h2', null, kindLabel(j.kind) || 'Background job'), chip(st.label, st.v));
        box.append(h);
        box.append(el('p', 'job-title', j.title || j.id));
        // B-227 (D-232): done, how long it worked, opening in place to what it changed.
        if (j.status === 'done' && j.startedAt && j.finishedAt)
          box.append(workEl({ ms: E.toMs(j.finishedAt) - E.toMs(j.startedAt), changed: jobChanges(j) }, 'job:' + j.id));
        const r = j.result || {};
        if (j.status === 'done' && r.retro) box.append(retroList(r.retro));
        if (j.kind === 'build' && (j.status === 'done' || j.status === 'failed')) box.append(buildList(j));
        else if (j.status === 'done' && r.text) {
          const p = el('div', 'result');
          p.append(fmt(r.text));
          box.append(p);
        } else {
          // B-521: a job at work says so with how long, as it goes
          if (st.live) box.append(liveSince(jobSince(j), st.live, 'meta job-since'));
          box.append(el('p', 'meta', st.detail));
        }
        // B-479: a flashcards job's cards, as the Quizlet import text Copy puts on the clipboard, exactly
        const qz = j.status === 'done' && typeof r.quizlet === 'string' && r.quizlet ? r.quizlet : '';
        if (qz) {
          const pre = el('pre', 'quizlet-block', qz);
          pre.setAttribute('aria-label', 'Flashcards as Quizlet import text');
          box.append(pre);
        }
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
        // B-487: a flashcards job made a deck in E.V.: Open deck studies it
        if (j.status === 'done' && r.deckId && S.decks.some(d => d.id === r.deckId)) {
          a.append(btn('Open deck', () => openDeck(r.deckId), { primary: true }));
          any = true;
        }
        if (qz) {
          const n = qz.split('\n').length;
          const cp = btn(
            `Copy ${plural(n, 'card')} for Quizlet`,
            async () => {
              try {
                await navigator.clipboard.writeText(qz);
                cp.textContent = 'Copied. In Quizlet: Import, then paste';
              } catch {
                const ta = el('textarea');
                ta.readOnly = true;
                ta.value = qz;
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
          any = true;
        }
        if (j.status === 'done' && j.kind === 'exam-plan') {
          a.append(
            btn('See the plan', () =>
              openPlanInStudy((S.plansRaw.find(p => p.id === r.planId) || {}).exam || null, r.planId)
            )
          );
          any = true;
        }
        if (st.retry) {
          a.append(
            btn('Try again', () => {
              T.retrying.add(j.id);
              render();
              const done = () => {
                T.retrying.delete(j.id);
                render();
              };
              guard(null, () => refire(j0).then(done), null, done);
            })
          );
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
        {
          // B-380: the button says it copied (no toast); the fallback opens the text to copy by hand
          const qb = btn(
            `Copy ${plural(cards.length, 'card')} for Quizlet`,
            async () => {
              const n = await copyQuizlet(box);
              if (n && !box.querySelector('textarea')) qb.textContent = 'Copied. In Quizlet: Import, then paste';
            },
            { primary: true }
          );
          a.append(qb);
        }
        box.append(
          ul,
          a,
          el('p', 'meta', 'In Quizlet: Create, Import, then paste. Term and definition are separated by a tab.')
        );
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
        // B-572: Proprietary's Fold: the head line (its chip inside it) over the card's rows, which open by height
        // and opacity
        const fb = el('div', 'check-body');
        const f = DS.fold({
          head: `Check ${c.n} · ${plural((c.items || []).length, 'question')}`,
          open: !folded,
          body: fb,
          cls: 'check-fold-wrap',
          onToggle: open => (open ? T.checkFold.delete(key) : T.checkFold.add(key)),
        });
        const fl = f.querySelector('.fold-line');
        fl.classList.add('check-fold');
        fl.append(
          chip(answered ? 'answered' : live ? 'your turn' : 'session over', answered ? 'ok' : live ? 'accent' : '')
        );
        box.append(f);
        if (oset) {
          const body = el('div', 'check-open');
          fb.append(body);
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
        fb.append(ol);
        if (!live) return;
        // B-638: answered in the card, in his own words, as an open check is: a text box and Check answer. The answer
        // goes into this check's chat as his line (it answers the check there, and the reply gives the why); the Answer
        // button that only pointed at a composer did nothing in a Notes session's chat.
        const ta = document.createElement('textarea');
        ta.className = 'open-in';
        ta.rows = 3;
        ta.maxLength = 1200;
        ta.dataset.ui = 'check-answer';
        ta.setAttribute('aria-label', `Your answer to check ${c.n}`);
        ta.placeholder = 'Answer any of them, in your own words';
        ta.value = T.checkDraft.get(key) || '';
        const go = btn(T.checkSent.has(key) ? 'Checking…' : 'Check answer', null, { primary: true });
        go.dataset.ui = 'check-submit';
        go.disabled = T.checkSent.has(key) || !ta.value.trim();
        ta.addEventListener('input', () => {
          T.checkDraft.set(key, ta.value);
          go.disabled = T.checkSent.has(key) || !ta.value.trim();
        });
        go.addEventListener('click', async () => {
          const text = ta.value.trim();
          if (!text) return;
          T.checkSent.add(key);
          go.disabled = ta.disabled = true;
          go.textContent = 'Checking…';
          try {
            // B-638: a reply in flight (or the record not loaded) sends nothing; his answer stays in the card
            if ((await checkSend(s, text)) === false)
              toast('E.V. is still replying — your answer is kept, press Check answer again.');
            else T.checkDraft.delete(key);
          } catch (e) {
            toast('Couldn’t send that answer: ' + ((e && (e.message || e.code)) || 'error'));
          } finally {
            T.checkSent.delete(key);
            go.textContent = 'Check answer';
            go.disabled = ta.disabled = false;
          }
        });
        const a = el('div', 'actions');
        a.append(el('span', 'grow'), go);
        fb.append(ta, a);
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
              s.minutes != null ? durFmt(s.minutes) : '',
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
                cp.textContent = 'Copied. In Quizlet: Import, then paste'; // B-380: inline, no toast
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
              morePractice({ announce: true, topic: s.topic }); // B-380: it announces itself; no toast
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
          go: openIn('today', 'today', 'week'),
        };
      },
      weakspots() {
        const due = E.rankDue(M.models, today, S.exams).length,
          act = M.models.filter(w => E.isActive(w) && !w.derived.preRead).length;
        return {
          text: act ? `${due} due now · ${plural(act, 'active weak spot')}` : 'No active weak spots',
          go: openIn('study', 'study', 'weak'),
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
          text: `${exShort(ex)} readiness · ${r.pctSolid != null ? r.pctSolid + '% solid' : 'no weak spots yet'} · ${d > 0 ? plural(d, 'day') + ' out' : E.relDay(ex.date, today)}`,
          go: openIn('progress', 'progress', 'readiness'), // B-381: the Progress view itself
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
          go: openIn('study', 'study', 'objectives'), // B-381: Study's objectives, where the rereads are
        };
      },
      chart() {
        const days = E.answerStats(M.attempts.all, { date: today }).lastDays || [];
        const n = days.reduce((s, d) => s + d.n, 0),
          r = days.reduce((s, d) => s + d.right, 0);
        return {
          text: n ? `Last 7 days · ${r} of ${n} right (${pct(r, n)})` : 'No answers in the last week yet',
          go: openIn('progress', 'progress', 'readiness'), // B-381: the Progress view itself
        };
      },
    };
    // B-358 (D-314): under her greeting line, one summary line as the demo's Main board: what's on today's list, its
    // minutes, and the next graded date the greeting hasn't named; never a line per item and no buttons.
    const SUM_NUM = [
      'No',
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
      'Six',
      'Seven',
      'Eight',
      'Nine',
      'Ten',
      'Eleven',
      'Twelve',
    ];
    const SUM_DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const SUM = { at: 0, key: '', line: '' };
    function summaryLine(m) {
      // computed at most once a second: the thread's redraw check asks for it on every frame
      const t = Date.now();
      if (t - SUM.at < 1000 && SUM.key === m.text) return SUM.line;
      SUM.at = t;
      SUM.key = m.text;
      return (SUM.line = summaryNow(m));
    }
    // a long name to its lead (before a colon), else to its first words: the line stays one sentence
    function shortTitle(t) {
      let s = String(t || '')
        .replace(/[.\s]+$/, '')
        .trim();
      if (s.length <= 40) return s;
      const c = s.indexOf(':');
      if (c >= 10 && c <= 40) return s.slice(0, c);
      return s.slice(0, 40).replace(/\s+\S*$/, '') + '…';
    }
    function summaryNow(m) {
      const { items, isDone, budget } = dayState();
      const n = sideOpen().length; // as Today's list and the sidebar count them
      const things = (SUM_NUM[n] || String(n)) + (n === 1 ? ' thing' : ' things') + ' on today’s list';
      const bv = budgetView(budget, items, isDone);
      const mins = bv && bv.available ? `${bv.left} of your ${bv.available} minutes` : '';
      const said = String(m.text || '').toLowerCase();
      const g = S.dates
        .filter(d => d.graded && d.date >= today && !E.isRemovedDate(d) && d.title)
        .sort((x, y) => (x.date + (x.time || '')).localeCompare(y.date + (y.time || '')))
        .find(d => !said.includes(shortTitle(d.title).toLowerCase().split(' ').slice(0, 2).join(' ')));
      let when = '';
      if (g) {
        const days = Math.round((Date.parse(g.date) - Date.parse(today)) / 864e5);
        when =
          days === 0
            ? ' today'
            : days === 1
              ? ' tomorrow'
              : days < 7
                ? ' on ' + SUM_DOWS[new Date(g.date + 'T12:00:00Z').getUTCDay()]
                : ' on ' +
                  new Date(g.date + 'T12:00:00Z').toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'UTC',
                  });
      }
      const graded = g ? shortTitle(g.title) + when : '';
      const parts = [things, mins, graded].filter(Boolean);
      return (parts.length > 1 ? parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1] : parts[0]) + '.';
    }
    // B-572 (D-393): her greeting block as the reference's empty state: her Arc beside a short hello, the summary line
    // under it, then Next up (the first open item on today's list) with its Start.
    const GREET_WORD = { morning: 'Good morning', midday: 'Good afternoon', evening: 'Good evening', late: 'Still up' };
    function greetHead(m) {
      const part = E.partOfDay ? E.partOfDay(m.at || new Date().toISOString()) : 'evening';
      return (GREET_WORD[part] || 'Hello') + ', Matt';
    }
    function nextUpEl() {
      let it = null,
        go = null;
      try {
        it = sideOpen()[0] || null;
        go = it && startGo(it);
      } catch (e) {
        if (!(e instanceof ReferenceError || e instanceof TypeError)) throw e; // Today still loading
      }
      if (!it) return null;
      const r = el('div', 'next-up');
      r.dataset.part = 'next-up';
      r.append(el('span', 'nu-k', 'Next up'), el('span', 'nu-t', E.rowText ? E.rowText(it) : String(it.text || '')));
      if (it.minutes) r.append(el('span', 'nu-m', durFmt(it.minutes)));
      if (go) {
        const st = DS.button({ label: 'Start', kind: 'ghost', size: 'sm', cls: 'nu-go', onClick: go });
        st.prepend(svgIcon('M8 5l11 7-11 7z'));
        r.append(st);
      }
      return r;
    }
    function briefEl(m) {
      const wrap = el('div', 'brief');
      const head = el('div', 'greet-head');
      head.dataset.part = 'greet-head';
      head.append(DS.presence({ size: 'md', follow: true }), el('p', 'greet-t', greetHead(m)));
      const sum = el('div', 'greet-sum');
      sum.append(el('p', 'brief-line', summaryLine(m)));
      wrap.append(head, sum);
      const nu = nextUpEl();
      if (nu) wrap.append(nu);
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
      const row = DS.button({ kind: 'ghost', cls: 'prep-row' }); // B-572: Proprietary's Button
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
        if (src) txt.append(el('span', 'pi-c', src));
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
      const add = DS.button({ label: 'Add', kind: 'neutral', size: 'sm', type: 'submit' });
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
      let open = T.prepOpen.has(key) ? T.prepOpen.get(key) : o.open != null ? o.open && !l.done : !l.done;
      // Ticking the last item folds the check away; reopening it is one tap on its line.
      if (l.done && T.prepWasDone && T.prepWasDone.get(key) === false) open = false;
      (T.prepWasDone = T.prepWasDone || new Map()).set(key, l.done);
      T.prepOpen.set(key, open);
      wrap.classList.toggle('open', open);
      // B-572: Proprietary's Fold, so the list opens by height and opacity; its head carries the row's parts
      const fold = DS.fold({
        open,
        body: box,
        cls: 'prep-fold',
        onToggle: on => {
          T.prepOpen.set(key, on);
          wrap.classList.toggle('open', on);
        },
      });
      const head = fold.querySelector('.fold-line');
      head.classList.add('prep-row');
      head.replaceChildren(...row.childNodes);
      wrap.append(fold);
      return wrap;
    }
    // B-78: a reply's cards are no longer drawn under her line; they are the surfaces (75-ev-surfaces.js).
    function renderCards(rec) {
      if (rec.cardsBox.firstChild) rec.cardsBox.replaceChildren();
    }
    T.checkFold = new Set();
    T.checkDraft = new Map(); // B-638: an items check's typed answer, kept across a repaint
    T.checkSent = new Set(); // B-638: an items check whose answer is on its way
    T.nudged = new Set(); // B-638: the checks whose chat already had its answer-in-the-card reminder

