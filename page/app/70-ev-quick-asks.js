    // ---------------------------------------------------------------- quick asks (handled here, no model call)
    const key = t =>
      String(t || '')
        .toLowerCase()
        .replace(/[’‘]/g, "'")
        .replace(/[?.!\s]+$/, '')
        .trim();
    const LOCAL = {
      'start review': () => {
        const { rs, left } = reviewState();
        return left
          ? [
              `${plural(left, 'review')} left. One at a time; every answer updates your weak spots.`,
              [{ type: 'review' }],
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
          [{ type: 'dates', days: 7 }],
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
    async function quick(label) {
      const job = T.greet && T.greet.job && /^Open the /.test(label) ? T.greet.job : null;
      const opened = job ? openJob(job) : null; // before any await: the tab opens inside his tap
      const fn = opened ? () => opened : LOCAL[key(label)];
      if (!fn) return false;
      T.bigCore = false;
      await mattSay(label);
      const [text, cards] = await fn();
      if (text != null) await evSay(text, cards, { tier: 'local' });
      return true;
    }

