    // ---------------------------------------------------------------- workouts (D-108): a sequence card on the skills-runner pattern
    const SEQ = E.workoutSequences();
    const activeWorkout = () =>
      S.workouts
        .filter(w => w.status === 'active')
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] || null;
    const mmss = ms => {
      const s = Math.max(0, Math.round(ms / 1000));
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    const seqLine = q =>
      q.kind === 'amrap'
        ? `${q.capMinutes}-minute AMRAP: ${q.round.map(m => m.reps + ' ' + m.move).join(', ')}`
        : `${q.rungs.length} rounds, ${Math.min(...q.rungs)} up to ${Math.max(...q.rungs)} and back: ${q.moves.map(m => m.move + ' ×' + m.per).join(', ')}`;
    async function startWorkoutRun(seqId) {
      const q = SEQ[seqId];
      if (!q) throw new Error('no workout called ' + seqId);
      const cur = activeWorkout();
      if (cur)
        return { text: `${cur.title} is still going; finish or stop it first.`, card: { type: 'workout', id: cur.id } };
      const w = E.startWorkout(q, { now: now(), date: today });
      await write(w);
      return {
        text: `${q.title}: ${seqLine(q)}. The clock is running; tap Round done after each round.`,
        card: { type: 'workout', id: w.id },
      };
    }
    const woOf = id => S.workouts.find(w => w.id === id) || null;
    function clockText(w, q) {
      const st = E.workoutState(w, q, now());
      return q.kind === 'amrap' ? (st.over ? 'Time!' : mmss(st.leftMs) + ' left') : mmss(st.elapsedMs);
    }
    // The clocks on open workout cards tick in place; when an amrap's cap passes, the card redraws to ask for the extra reps.
    setInterval(() => {
      try {
        for (const n of document.querySelectorAll('[data-wo-clock]')) {
          const w = woOf(n.dataset.woClock);
          const q = w && SEQ[w.sequence];
          if (!w || !q || w.status !== 'active') continue;
          const t = clockText(w, q);
          if (n.textContent !== t) {
            n.textContent = t;
            if (t === 'Time!') render();
          }
        }
      } catch {}
    }, 1000);
    function workoutCard(box, w) {
      const q = SEQ[w.sequence];
      if (!q) {
        box.append(head2('Workout'), el('p', 'empty', 'This workout isn’t in E.V.’s list any more.'));
        return;
      }
      const st = E.workoutState(w, q, now());
      const live = w.status === 'active';
      box.classList.add('check', live ? 'live' : 'done');
      const meta = live
        ? q.kind === 'ladder'
          ? `Round ${Math.min(st.done + 1, st.total)} of ${st.total}`
          : st.over
            ? plural(st.done, 'round')
            : `Round ${st.done + 1}`
        : w.status === 'stopped'
          ? 'stopped'
          : 'done';
      const h = head2('Workout · ' + q.title, meta);
      box.append(h);
      if (live) {
        const clock = el('p', 'wo-clock', clockText(w, q));
        clock.dataset.woClock = w.id;
        box.append(clock);
        if (q.kind === 'ladder') {
          const pr = el('div', 'progress');
          const bar = el('i');
          bar.style.width = (100 * st.done) / st.total + '%';
          pr.append(bar);
          box.append(pr);
        }
        if (!st.over) {
          const ul = el('ul', 'wo-moves');
          for (const m of st.moves) {
            const li = el('li');
            li.append(el('b', null, String(m.reps)), document.createTextNode(' ' + m.move));
            ul.append(li);
          }
          box.append(ul);
          if (q.kind === 'amrap' && st.done)
            box.append(el('p', 'meta', `${plural(st.done, 'round')} so far (${st.reps} reps).`));
          const a = el('div', 'actions');
          a.append(
            btn(q.kind === 'ladder' ? 'Stop here' : 'Finish', ev =>
              guard(ev.target, () => write(E.endWorkout(w, q, { now: now(), stopped: true })), 'Workout saved')
            ),
            el('span', 'grow')
          );
          a.append(
            btn(
              'Round done',
              ev =>
                guard(ev.target, async () => {
                  await write(E.workoutRound(w, q, { now: now() }));
                  const w2 = woOf(w.id);
                  if (w2 && q.kind === 'ladder' && E.workoutState(w2, q, now()).over)
                    await write(E.endWorkout(w2, q, { now: now() }));
                }),
              { primary: true }
            )
          );
          box.append(a);
        } else {
          // an amrap at its cap: the rounds stand; the reps into the next round are his to type
          box.append(el('p', 'stem', `${plural(st.done, 'round')} in ${q.capMinutes} minutes.`));
          const f = el('form', 'wo-extra');
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.min = '0';
          inp.step = '1';
          inp.inputMode = 'numeric';
          inp.placeholder = 'Reps into the next round, e.g. 12';
          inp.setAttribute('aria-label', 'Extra reps');
          const sb = el('button', 'primary', 'Save');
          sb.type = 'submit';
          const a = el('div', 'actions');
          a.append(sb);
          f.append(inp, a);
          f.addEventListener('submit', ev => {
            ev.preventDefault();
            guard(sb, () => write(E.endWorkout(w, q, { now: now(), extraReps: inp.value })), 'Workout saved');
          });
          box.append(f);
        }
        return;
      }
      box.append(el('p', 'stem', E.workoutSummary({ ...w, energy: null, mood: null }, q)));
      if (!w.energy) {
        // the energy and mood line at the end (D-108)
        box.append(el('p', 'meta', 'How do you feel? Energy 1 to 5, and a few words if you like.'));
        const pick = { n: 0 };
        const row5 = el('div', 'energy');
        row5.setAttribute('role', 'group');
        row5.setAttribute('aria-label', 'Energy');
        const bs = [1, 2, 3, 4, 5].map(n => {
          const b = btn(String(n), () => {
            pick.n = n;
            bs.forEach((x, i) => x.setAttribute('aria-pressed', String(i + 1 === n)));
          });
          b.setAttribute('aria-pressed', 'false');
          return b;
        });
        row5.append(...bs);
        const mood = document.createElement('input');
        mood.type = 'text';
        mood.maxLength = 200;
        mood.placeholder = 'Mood, e.g. strong, legs gone';
        mood.setAttribute('aria-label', 'Mood');
        const a = el('div', 'actions');
        const sv = btn(
          'Save',
          ev => {
            if (!pick.n) {
              toast('Pick your energy, 1 to 5.');
              return;
            }
            guard(ev.target, () => write(E.workoutCheckin(w, { energy: pick.n, mood: mood.value })), 'Logged');
          },
          { primary: true }
        );
        a.append(sv);
        box.append(row5, mood, a);
      } else
        box.append(
          el('p', 'meta', [`Energy ${w.energy}/5`, w.mood ? '“' + w.mood + '”' : ''].filter(Boolean).join(' · '))
        );
    }
    function workoutPicker(box) {
      box.append(head2('Start a workout'));
      const ul = el('ul', 'list');
      for (const q of Object.values(SEQ))
        ul.append(
          row({
            title: q.title,
            detail: seqLine(q),
            action: btn(
              'Start',
              ev =>
                guard(ev.target, async () => {
                  const r = await startWorkoutRun(q.id);
                  await evSay(r.text, r.card ? [r.card] : [], { tier: 'local' });
                }),
              { primary: true }
            ),
          })
        );
      box.append(ul);
    }
    function renderWorkoutList() {
      let card = $('workouts-card');
      if (!card) {
        card = el('div', 'card');
        card.id = 'workouts-card';
        const h = el('h2', null, 'Workouts');
        const ul = el('ul', 'list');
        ul.id = 'workouts';
        card.append(h, ul);
        const host = document.querySelector('#record-sessions .col-side');
        if (!host) return;
        host.append(card);
      } // B-121: beside the sessions, under the ideas
      const ws = [...S.workouts].sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
      $('workouts').replaceChildren(
        ...(ws.length
          ? ws.map(w => {
              const q = SEQ[w.sequence];
              return row({
                lead: short(w.date),
                title: w.title || w.sequence,
                detail: w.status === 'active' ? 'going now' : E.workoutSummary(w, q),
                chips: [
                  [
                    w.status === 'active' ? 'live' : w.status === 'stopped' ? 'stopped' : 'done',
                    w.status === 'active' ? 'info' : w.status === 'stopped' ? 'warn' : 'ok',
                  ],
                ],
              });
            })
          : [el('p', 'empty', 'Say “start a workout” to run CINDY or the 1,500-rep ladder.')])
      );
    }

