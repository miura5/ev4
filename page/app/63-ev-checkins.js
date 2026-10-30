    // ---------------------------------------------------------------- check-ins (self-report only, B-05)
    async function saveCheckin(data) {
      const doc = E.dayeditBase(M.dayedit, today, now());
      doc.checkin = { ...(doc.checkin || {}), ...data, at: now() };
      if (!doc.checkin.energy) throw new Error('give your energy, 1 to 5');
      await writeDayEdit(today, doc);
    }
    function energyAdvice(n) {
      const { left } = reviewState();
      if (n <= 2)
        return `Logged. Minimum viable day: ${left ? `today’s ${plural(left, 'review')} (about ${left} min)` : 'a short look at what’s due'} and anything graded that can’t move. The rest can wait; I’ll carry it.`;
      if (n === 3)
        return 'Logged. Steady pace: reviews first, then one item from the list. Stop when it stops sticking.';
      return 'Logged. Good charge. Today’s list, and 5 more questions if you want them.';
    }

    // B-340 (D-312): the daily check-in card under her, as in the demo, until he answers it today; the line his answer
    // brings stays in the card for the rest of this visit. Self-report only (B-05): a number, saved to today.
    // B-362 (D-316): it is the first thing in the thread and scrolls with it, and it steps aside while a session runs.
    const CK = { just: null, pick: 0, adv: '', box: null };
    function renderCheckin() {
      if (!M) return;
      let box = CK.box;
      if (!box) {
        box = CK.box = el('section', 'ckin');
        box.id = 'ev-ckin';
        box.setAttribute('aria-label', 'Daily check-in');
      }
      const ci = (M.dayedit && M.dayedit.checkin) || null;
      const energy = (ci && ci.energy) || (CK.just === today ? CK.pick : 0);
      const show = (!energy || CK.just === today) && !activeSession();
      box.hidden = !show;
      if (!show) return;
      const when = ci && ci.at ? clock12(ci.at) : T.greet && T.greet.at ? clock12(T.greet.at) : '';
      const k = [today, energy, CK.adv, when].join('|');
      if (box.dataset.k === k) return;
      box.dataset.k = k;
      const day = new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
      const head = el('div', 'ck-row ck-head');
      head.append(el('span', 'lab', 'Daily check-in · ' + day), el('span', 'mini', when));
      const seg = el('div', 'seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Energy, 1 to 5');
      for (let n = 1; n <= 5; n++) {
        const b = DS.button({ label: String(n), kind: 'ghost', size: 'sm', pressed: energy === n }); // B-572
        b.addEventListener('click', () =>
          guard(b, async () => {
            await saveCheckin({ energy: n });
            CK.just = today;
            CK.pick = n;
            CK.adv = energyAdvice(n);
            renderCheckin();
          })
        );
        seg.append(b);
      }
      const row = el('div', 'ck-row');
      row.append(el('span', 'ck-q', 'Energy today'), seg);
      box.replaceChildren(head, row);
      if (CK.adv) box.append(el('p', 'adv', CK.adv));
    }
