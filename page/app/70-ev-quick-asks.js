    // ---------------------------------------------------------------- quick asks (handled here, no model call)
    const key = t =>
      String(t || '')
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/[?.!\s]+$/, '')
        .trim();
    const YOUR_TURN = /^\s*your turn\b/i; // B-182: "Your turn (n)", the count changing
    const LOCAL = {
      // B-182 (D-196): what waits on him, as one card grouped by where it happens.
      'your turn': async () =>
        yourTurnCount()
          ? ['Here’s what waits on you, by where it happens.', [{ type: 'yourturn' }]]
          : ['Nothing waits on you right now.', []],
      // B-45 (D-102): the briefing's plan offer, the one way a draft starts without his asking in words.
      'draft its plan': async () => {
        const item = ((T.greet && T.greet.brief) || []).find(b => b.kind === 'plan' && b.exam);
        const ex = item && S.exams.find(e => e.id === item.exam);
        if (!ex) return ['There’s no exam waiting on a plan right now.', []];
        const r = await startJob({
          kind: 'exam-plan',
          title: 'Exam plan: ' + (ex.title || ex.id).replace(/:.*$/, ''),
          brief: ex.id + ': draft its plan from the new exam content',
        });
        return r.fired && r.fired.ok
          ? [
              `Drafting the ${(ex.title || ex.id).replace(/:.*$/, '')} plan in the background. It arrives as a card you can use or leave.`,
              [{ type: 'job', id: r.id }],
            ]
          : ['Couldn’t start it: ' + fireCopy(r.fired && r.fired.error), []];
      },
      // B-46 (D-103): the briefing's clinical offer; the brief is written only on this tap.
      'brief me for clinical': async () => {
        const item = ((T.greet && T.greet.brief) || []).find(b => b.kind === 'clinical-prep' && b.date);
        const day = item ? E.prepDay(S.dates, [], item.date) : E.nextClinical(S.dates, [], today);
        if (!day || day.kind !== 'clinical') return ['There’s no clinical day coming up on your calendar.', []];
        const r = await startJob({
          kind: 'clinical-prep',
          title: 'Clinical prep: ' + (day.subject || day.title.replace(/\s*\([^)]*\)\s*$/, '')),
          brief: day.date + ': a prep brief for ' + day.title,
        });
        return r.fired && r.fired.ok
          ? [
              'Writing your clinical prep brief in the background: the skills with their packet pages, your skill weak spots and any instructor note. Never your paperwork.',
              [{ type: 'job', id: r.id }],
            ]
          : ['Couldn’t start it: ' + fireCopy(r.fired && r.fired.error), []];
      },
      'start review': () => {
        const { rs, left } = reviewState();
        return left
          ? [
              `${plural(left, 'review')} left. One at a time; every answer updates your weak spots.`,
              [{ type: 'go', label: 'Open the quiz', to: 'review' }], // B-362: on Study, never a card in the pane
            ]
          : rs
            ? ['Today’s review is done. Logged with quiet satisfaction.', []]
            : ['Today’s review lands with the 4:25am run. Want 5 fresh questions instead?', []];
      },
      "what's due this week": () => {
        const w = S.dates.filter(d => d.date >= today && d.date <= E.addDays(today, 7));
        const g = w.filter(d => d.graded).length;
        return [
          w.length
            ? `${plural(w.length, 'date')} in the next 7 days${g ? `, ${g} graded` : ''}.`
            : 'Nothing dated in the next 7 days. Suspiciously calm.',
          [{ type: 'go', label: 'Open the week', to: 'week' }], // B-362 (D-316): one line and one button, as the demo
        ];
      },
      'give me 5 more': () => {
        if (!sample || T.sampleOff)
          return ['Writing questions needs permission to ask Claude, which this view doesn’t have.', []];
        if (morePending) return ['Already writing a batch. Hold tight.', []];
        morePractice({ announce: true });
        return ['Writing 5 now, aimed at your weakest spots. They’ll post here in about a minute.', []];
      },
      'file it': () => fileItReply(),
      // B-353: the paperclip's job, asked in words (or a file dropped on the pane); the picker opens inside his send.
      'attach a file': () => {
        $('ev-file').click();
        return ['Pick a PDF, Word, PowerPoint, text file or photo and I’ll save it to your library.', []];
      },
      'how ready am i': () => {
        const ex = M.target;
        if (!ex) return ['No upcoming exam with weak spots yet, so nothing to measure.', []];
        const r = E.readiness({ examId: ex.id, weakspots: M.models });
        const d = E.diffDays(today, ex.date);
        return [
          `${(ex.title || ex.id).replace(/:.*$/, '')}${d > 0 ? ' in ' + plural(d, 'day') : ' is today'}: ${r.pctSolid ?? 0}% of its weak spots solid, about ${r.need} correct reviews to go.`,
          [{ type: 'readiness' }, { type: 'audit' }],
        ];
      },
      "i'm wiped": () => [
        'Noted. Energy check, 1 to 5? I’ll size the rest of today to match. No guilt either way.',
        [{ type: 'checkin' }],
      ],
      'show my progress': () => ['Here’s the week.', [{ type: 'chart' }]],
      // B-353 (D-314): the demo's chips. How did this week go is the week's chart; Plan the rest of today proposes on
      // Today what B-293's Plan the rest would, nothing changed until he accepts.
      // B-362 (D-316): one line with the week's numbers and Open Progress, as the demo; no chart card.
      'how did this week go': () => [weekLine(), [{ type: 'go', label: 'Open Progress', to: 'progress' }]],
      'plan the rest of today': () => {
        const np = restProposal();
        if (!np.adds.length && !np.offs.length) return ['Nothing to change: today’s list already fits the plan.', []];
        ui.restPlan = np;
        const bits = [
          np.adds.length ? plural(np.adds.length, 'thing') + ' to add' : '',
          np.offs.length ? plural(np.offs.length, 'thing') + ' to take off' : '',
        ].filter(Boolean);
        return [
          `I suggested ${bits.join(' and ')} on Today. Nothing changes until you accept.`,
          [{ type: 'go', label: 'Review on Today', to: 'today' }],
        ];
      },
      'start a workout': () => {
        const cur = activeWorkout();
        return cur
          ? [`${cur.title} is going.`, [{ type: 'workout', id: cur.id }]]
          : ['Which one? The clock starts when you tap Start.', [{ type: 'workout' }]];
      },
      'weak spots to quizlet': () => {
        const n = quizletCards().length;
        return n
          ? [
              `${plural(n, 'open weak spot')} as Quizlet cards: the topic on the front, the objective and the last rationale you missed on the back.`,
              [{ type: 'quizlet' }],
            ]
          : ['No open weak spots right now, so nothing to send to Quizlet.', []];
      },
      'start a study session': () => startSession(),
      'start session': () => startSession(),
      'start studying': () => startSession(),
      'start a session': () => startSession(),
      'end session': () => endSession('ended'),
      'end the session': () => endSession('ended'),
      'end study session': () => endSession('ended'),
      'end my session': () => endSession('ended'),
      'quiz me now': async () => (await quizNow()) || [null, []],
      "i'm back early": async () => [await sessionCmd('resume'), []], // B-362: the demo's chip on a break
      'take a break': async () => [await sessionCmd('break'), []],
      break: async () => [await sessionCmd('break'), []],
      resume: async () => [await sessionCmd('resume'), []],
      'add 5 minutes': async () => [await sessionCmd('extend'), []],
      '+5 min': async () => [await sessionCmd('extend'), []],
    };
    // B-41: the open weak spots as Quizlet import text, nothing written to the record.
    function quizletCards() {
      return E.weakspotCards({ weakspots: M.models, objectives: S.objectives, sets: S.sets, answers: S.answers });
    }
    async function copyQuizlet(box) {
      const cards = quizletCards();
      if (!cards.length) {
        toast('No open weak spots to copy.');
        return 0;
      }
      const t = E.cardsText(cards);
      try {
        await navigator.clipboard.writeText(t);
        toast(`Copied ${plural(cards.length, 'card')}. In Quizlet: Create, Import, then paste.`);
      } catch {
        if (box) {
          const ta = el('textarea');
          ta.readOnly = true;
          ta.value = t;
          ta.setAttribute('aria-label', 'Weak spots as Quizlet import text');
          box.append(ta);
          ta.focus();
          ta.select();
        }
        toast('Select all and copy, then paste into Quizlet’s Import.');
      }
      return cards.length;
    }
    // The greeting's finished job (D-125 as amended): its chip opens the result and answers with the job's card.
    function openJob(id) {
      const j = S.jobs.find(x => x.id === id);
      if (!j) return ['That job isn’t in the record any more.', []];
      const url = ((j.result || {}).links || []).map(l => l && l.url).find(u => /^https:\/\//.test(u || ''));
      if (url) {
        try {
          window.open(url, '_blank', 'noopener');
        } catch {}
      }
      return [`${j.title || 'Your job'}${url ? ', opening in a new tab.' : '.'}`, [{ type: 'job', id: j.id }]];
    }
    // B-189: "what do I bring to lab today" is answered from his record, never from general knowledge: that day's
    // calendar entries, the announcements and course-calendar rows that name it, his library and his kit, as the
    // day's prep check (the same check the greeting shows), each item naming its source.
    async function prepAnswer(text, pa) {
      T.bigCore = false;
      const mid = await mattSay(text);
      if (!LIB.mats) await library().catch(() => {});
      const today = E.chicagoDate(now());
      const said = pa.said || [];
      const day = said.length ? E.prepDaySaid(S.dates, [], pa.date, said) : E.prepDay(S.dates, [], pa.date);
      const phase = pa.date > today ? 'night' : 'morning';
      const list = day
        ? E.prepList({
            day,
            phase,
            index: LIB.idx,
            dates: S.dates,
            dayedits: S.dayedits,
            announcements: S.announcements,
          })
        : null;
      const card = day
        ? [{ type: 'prep', date: pa.date, phase, title: day.title, ...(day.said ? { said } : {}) }]
        : [{ type: 'dates', days: 7 }];
      await evSay(E.prepReply(list, pa.date, today), card, { tier: 'local', replyTo: mid });
      return true;
    }
    // B-353 (D-314): the demo's "Quiz me on <topic>" chip names his weakest open weak spot: the open concept spot with
    // an objective that has the shortest streak, the soonest due first among equals.
    function weakestSpot() {
      return (M.models || [])
        .filter(w => (w.kind || 'concept') === 'concept' && w.objective && w.derived && E.isActive(w))
        .sort(
          (a, b) =>
            (a.derived.streak || 0) - (b.derived.streak || 0) ||
            String(a.derived.nextDue || '').localeCompare(String(b.derived.nextDue || ''))
        )[0];
    }
    function topicLabel(w) {
      let t = String(w.topic || w.objective).replace(/\s+/g, ' ').trim();
      const head = t.split(/\s*[:(–—]\s*/)[0];
      if (head.length >= 4) t = head;
      if (t.length > 28) t = t.slice(0, 28).replace(/\s+\S*$/, '');
      return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
    }
    function quizChip() {
      const w = weakestSpot();
      return w ? 'Quiz me on ' + topicLabel(w) : 'Start review';
    }
    function quizTopicAsk(label) {
      const w = weakestSpot();
      if (!w || key('Quiz me on ' + topicLabel(w)) !== key(label)) return null;
      // B-362 (D-316): as the demo, she answers in one line and Open the quiz opens it.
      return () => [
        `Questions on ${topicLabel(w)}. Misses are proposed as weak spots at the end, for you to review.`,
        [{ type: 'go', label: 'Open the quiz', to: 'quiz', objective: w.objective, topic: w.topic || '' }],
      ];
    }
    // B-362: the week in one line, as the demo's How did this week go: study time, against last week, quiz accuracy,
    // and the open weak spots.
    function weekLine() {
      const m0 = weekStart(today);
      const mins = minsIn(m0, today),
        prev = minsIn(E.addDays(m0, -7), E.addDays(m0, -1));
      const acc = accIn(m0, today);
      const d = mins - prev;
      const open = (M.models || []).filter(w => E.isActive(w)).length;
      return (
        `${hm(mins)} this week` +
        (prev || mins ? (d ? `, ${hm(Math.abs(d))} ${d > 0 ? 'more' : 'less'} than last week` : ', same as last week') : '') +
        (acc.n ? `, and ${Math.round((100 * acc.right) / acc.n)}% on quizzes` : '') +
        '.' +
        (open ? ` ${plural(open, 'weak spot')} open.` : ' No weak spots open.')
      );
    }
    // B-362 (D-316): a Coming up row in her panel, as the demo's: a dot, the title and the day (Mon 26); it opens
    // Today's week with that date picked.
    const UP_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function evDateRow(d) {
      const li = el('li', 'row week-item');
      const b = el('button', 'wk-line');
      b.type = 'button';
      b.title = d.title || '';
      const dt = new Date(d.date + 'T12:00:00Z');
      b.append(el('span', 'when', UP_WD[dt.getUTCDay()] + ' ' + dt.getUTCDate()), el('span', 'wk-t', d.title || ''));
      b.addEventListener('click', () => goTo({ to: 'week', date: d.date, id: d.id }));
      li.append(b);
      return li;
    }
    // B-362 (D-316): where a line's button goes. Open the week opens Today's week with the date picked (a Coming up
    // row passes its date); Open Progress opens the week's progress; Open the quiz the objective's questions; Review on
    // Today the list with the suggestion.
    function goTo(c) {
      if (c.to === 'week') {
        ui.todayView = 'week';
        store.set('todayView', 'week');
        ui.weekOff = c.date && c.date > today ? Math.floor(E.diffDays(today, c.date) / WEEK_DAYS) : 0;
        ui.weekSel = c.id || null;
        showTab('today');
      } else if (c.to === 'progress') {
        prog.period = 'week';
        showTab('progress');
      } else if (c.to === 'quiz') {
        const o = S.objectives.find(x => x.id === c.objective) || { id: c.objective, text: c.topic };
        showTab('study');
        quizObjective(o, null);
        return;
      } else if (c.to === 'review') {
        showTab('study');
        setStudy('review');
      } else if (c.to === 'record') {
        openInRecord(c.id); // B-377: a saved session opens on its row in Record's log
        return;
      } else if (c.to === 'today') {
        ui.todayView = 'list';
        store.set('todayView', 'list');
        showTab('today');
      }
      render();
    }
    async function quick(label) {
      const job = T.greet && T.greet.job && /^Open the /.test(label) ? T.greet.job : null;
      const opened = job ? openJob(job) : null; // before any await: the tab opens inside his tap
      const fn = opened
        ? () => opened
        : LOCAL[key(label)] || (YOUR_TURN.test(label) ? LOCAL['your turn'] : null) || quizTopicAsk(label);
      if (!fn) return false;
      T.bigCore = false;
      await mattSay(label);
      const [text, cards] = await fn();
      if (text != null) await evSay(text, cards, { tier: 'local' });
      return true;
    }

