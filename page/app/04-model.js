    // ------------------------------------------------------------ model (all rules come from E.V. core)
    let M = null;
    function model() {
      const models = E.buildWeakspots({ weakspots: S.weak, sets: S.sets, answers: S.answers, exams: S.exams });
      const attempts = E.collectAttempts(S.sets, S.answers);
      const target = E.targetExam({ exams: S.exams, objectives: S.objectives, weakspots: models, date: today });
      const day = S.days.find(d => d.id === today) || null;
      const dayedit = S.dayedits.find(d => d.id === today) || null;
      const latest = {}; // set id -> item id -> its newest attempt (answers/<setId> keeps every attempt)
      for (const a of S.answers) {
        const m = (latest[a.setId || a.id] = {});
        for (const [qid, tries] of Object.entries(a.answers || {})) {
          const keys = Object.keys(tries || {}).sort();
          if (keys.length) m[qid] = tries[keys[keys.length - 1]];
        }
      }
      return { models, attempts, target, day, dayedit, latest };
    }
    // B-186 (D-203): the page's two actors over spec.actions; the caller is fixed here, never by the call. A v4.4 tap
    // (a build ask, a reply, Ship it) runs ACT.tap(...).writes through run and makes its effects; the model's tools
    // move to ACT.tool as a task touches them.
    const ACT = window.EVActions
      ? { tap: window.EVActions.actor(EV_SPEC, 'tap'), tool: window.EVActions.actor(EV_SPEC, 'tool') }
      : null;
    const answersOf = set => (M && set && M.latest[set.id]) || {};
    /** One write, checked against its collection's schema first (the page refuses what the pipelines refuse). */
    async function write(w) {
      const ref = db.collection(w.collection).doc(w.id);
      if (validate && w.op === 'set') {
        const r = validate(w.collection, w.data, { id: w.id });
        if (!r.ok)
          throw new Error(
            w.collection +
              '/' +
              w.id +
              ' does not fit its shape: ' +
              (r.errors[0] ? r.errors[0].path + ' ' + r.errors[0].message : '')
          );
      }
      if (w.op === 'set') return ref.set(w.data);
      return ref.update(w.data);
    }
    async function run(writes, okText) {
      // Creations first, then the answer (the truth), then derived caches.
      const order = [
        ...writes.filter(w => w.op === 'set'),
        ...writes.filter(w => w.op === 'update' && w.collection !== 'weakspots'),
        ...writes.filter(w => w.op === 'update' && w.collection === 'weakspots'),
      ];
      for (const w of order) await write(w);
      if (okText) toast(okText);
    }
    const guard = async (b, fn, okText) => {
      if (b) b.disabled = true;
      try {
        await fn();
        if (okText) toast(okText);
      } catch (e) {
        toast('Couldn’t save: ' + ((e && (e.message || e.code)) || 'error'));
        if (b) b.disabled = false;
      }
    };
    let lastKey = '';
    /** A key for an appended entry written by the page: page-<time>, never the same twice on this page. */
    function pageKey(at) {
      let k = E.eventKey('page', at);
      if (k <= lastKey) k = lastKey.replace(/(\d{3})?$/, m => String(Number(m || 0) + 1).padStart(3, '0'));
      lastKey = k;
      return k;
    }
    function weakEvent(w, type, note) {
      const at = now();
      return {
        op: 'update',
        collection: 'weakspots',
        id: w.id,
        data: { events: { [pageKey(at)]: { type, by: 'owner', at, ...(note ? { note } : {}) } } },
      };
    }

