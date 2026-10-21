    // ---------------------------------------------------------------- greeting (once per open)
    const latestRuns = () => E.lastRuns(S.runs);
    // The chips change once quiet filing has run (or could not): the greeting's offers are recomputed, its lines kept.
    function regreet() {
      if (!T.greet || !T.greetCtx) return;
      const c = E.greeting({
        ...T.greetCtx,
        unfiled: fileUnfiled(),
        sessionActive: !!activeSession(),
        skillRun: resumeChip(),
      }).chips;
      if (c.join('|') !== (T.greet.chips || []).join('|')) {
        T.greet.chips = c;
        render();
      }
    }
    // B-45 (D-102): the materials the Canvas sync brought in since he last looked (one small query, at the first open),
    // so the greeting can offer a plan draft for an exam whose content just arrived. A failed read offers nothing.
    const NEWMATS = { docs: [], asked: false };
    function newMaterials() {
      if (NEWMATS.asked) return;
      NEWMATS.asked = true;
      const since = (S.memory && S.memory.lastSeenAt) || new Date(Date.now() - 864e5).toISOString();
      Promise.resolve()
        .then(() => db.collection('materials').where('at', '>=', since).get())
        .then(
          snap => {
            NEWMATS.docs = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
          },
          () => {}
        )
        .finally(() => {
          loaded.add('newmats');
          render();
        });
    }
    function greetNow() {
      const { day, items, isDone } = dayState();
      const { left, total } = reviewState();
      const rd = M.target ? E.readiness({ examId: M.target.id, weakspots: M.models }) : null;
      const g = E.greeting(
        (T.greetCtx = {
          now: new Date(),
          date: today,
          unfiled: fileUnfiled(),
          dayType: day.dayType,
          items: items.map(it => ({
            id: it.id,
            text: it.text,
            tag: it.tag,
            done: isDone(it),
            deferred: !!it.deferred,
            minutes: it.minutes,
            set: it.set,
          })),
          reviewLeft: left,
          reviewTotal: total,
          push: (M.day && M.day.push) || null,
          nextExams: S.exams
            .filter(e => e.date)
            .map(e => ({ id: e.id, title: e.title || e.id, date: e.date, course: e.course, kind: e.kind })),
          readiness: rd ? { examId: M.target.id, pctSolid: rd.pctSolid, need: rd.need } : null,
          dueCount: E.rankDue(M.models, today, S.exams).length,
          jobs: S.jobs.map(j => ({
            id: j.id,
            kind: j.kind,
            title: j.title,
            status: j.status,
            finishedAt: j.finishedAt,
          })),
          dueSoon: S.dates.filter(d => d.date >= today && d.date <= E.addDays(today, 7)).length,
          lastSeenAt: (S.memory && S.memory.lastSeenAt) || new Date(Date.now() - 864e5).toISOString(),
          runs: latestRuns(),
          tomorrow: { dates: S.dates.filter(d => d.date === E.addDays(today, 1)) },
          todayDates: S.dates
            .filter(d => d.date === today)
            .map(d => ({ title: d.title, graded: !!d.graded, kind: d.kind })),
          quizlet: null,
          // B-45 (D-102): an exam-content module the Canvas sync brought in since he last looked, for an exam with no plan.
          planOffer: E.planOffer({
            materials: NEWMATS.docs,
            plans: S.plansRaw || [],
            exams: S.exams,
            jobs: S.jobs,
            since: (S.memory && S.memory.lastSeenAt) || null,
            date: today,
          }),
          // B-46 (D-103): tomorrow is a clinical day with no prep brief asked for yet.
          clinicalOffer: E.clinicalPrepOffer({ dates: S.dates, dateedits: [], jobs: S.jobs, date: today }),
          checkin: (M.dayedit && M.dayedit.checkin) || null,
          sessionActive: !!activeSession(),
          skillRun: resumeChip(),
          prep: { today: E.prepDay(S.dates, [], today), tomorrow: E.prepDay(S.dates, [], E.addDays(today, 1)) },
        })
      );
      const at = now();
      T.greet = {
        id: msgId('g'),
        role: 'ev',
        greeting: true,
        text: g.headline,
        lines: g.lines,
        brief: g.brief,
        cards: g.cards,
        at,
        day: today,
        mood: g.mood,
        chips: g.chips,
        job: g.job,
        prep: g.prep,
      };
      T.briefOpen = false;
      T.briefItem = new Set(); // B-90: the briefing starts folded on every open
      T.scrollTo = T.greet.id;
      T.firstScroll = true;
      // Mark this open as seen, so the next greeting only reports what's new. One write per open.
      setTimeout(() => {
        write({ op: 'set', collection: 'talk', id: 'memory', data: memoryEdit({ lastSeenAt: at }, at) }).catch(
          () => {}
        );
      }, 1500);
    }

