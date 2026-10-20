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

