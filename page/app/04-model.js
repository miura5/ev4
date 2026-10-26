    // ------------------------------------------------------------ model (all rules come from E.V. core)
    let M = null;
    function model() {
      const models = E.buildWeakspots({ weakspots: S.weak, sets: S.sets, answers: S.answers, exams: S.exams });
      const attempts = E.collectAttempts(S.sets, S.answers, S.weak); // B-232: a duplicate's answers on its survivor
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
    delete window.EVActions; // the two actors are all the page keeps: no other code path names its own caller
    const answersOf = set => (M && set && M.latest[set.id]) || {};
    /** One write, checked against its collection's schema first (the page refuses what the pipelines refuse). */
    // B-227 (D-232): while one of her tools runs, the documents it writes are what her reply changed (her work line).
    const WORK = { collect: null };
    // B-320 (D-306): after the cutover the claude.ai live page keeps his record readable and writes nothing: E.V. lives
    // in the app (its shim names its host, pwa/bridge.js), where this flag never holds. Every write stops here, the one
    // place the page writes, and the page says so at the top.
    const READ_ONLY = EV_SPEC.readOnly === true && !(window.claude && window.claude.host === 'ev-app');
    const READ_ONLY_TEXT = 'This page is read-only now: E.V. lives in the app.';
    if (READ_ONLY) {
      document.documentElement.setAttribute('data-readonly', '');
      const ro = document.createElement('p');
      ro.className = 'ro-banner';
      ro.setAttribute('role', 'status');
      ro.textContent = READ_ONLY_TEXT + ' Your record here stays as it was at the move.';
      document.body.prepend(ro);
    }
    async function write(w) {
      if (READ_ONLY) throw new Error(READ_ONLY_TEXT);
      if (WORK.collect && !['talk', 'jobs'].includes(w.collection)) WORK.collect.add(w.collection + '/' + w.id);
      const ref = db.collection(w.collection).doc(w.id);
      // B-401 (D-325): a note is judged on the whole document a write leaves, set or update: the schema, the size cap
      // and its write-once createdAt and earlierOf (core/validate.mjs noteProblem, which the Worker asks too).
      if (w.collection === 'notes') {
        const V = window.EVValidate;
        if (!validate || !V || !V.noteProblem) throw new Error('notes/' + w.id + ': no validator to check the note');
        const snap = await ref.get();
        const prev = snap && snap.exists ? snap.data() : null;
        if (w.op === 'update' && !prev) throw new Error('notes/' + w.id + ' does not exist to update');
        const doc = w.op === 'update' ? V.mergeUpdate(prev, w.data) : w.data;
        const bad = V.noteProblem(validate, w.id, doc, prev, (EV_SPEC.capacity || {}).documentBytes);
        if (bad) throw new Error(bad);
      }
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
      if (w.op === 'set') {
        // B-228 (D-208): paints first where the page shows it at once; a refusal takes the paint back
        const painted = paintSet(w.collection, w.id, w.data);
        try {
          return await ref.set(w.data);
        } catch (e) {
          if (painted) unpaint(w.collection, w.id, w.data);
          throw e;
        }
      }
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
      void okText; // B-380 (D-316): the demo has no confirmation toasts; the saved change shows in place
    }
    // B-200 (D-208): the tap has already painted its new state; the write catches up. A tick stays live while it saves
    // (a disabled box reads as not done); a button is held so it cannot fire twice. A refused write puts the old state
    // back (the tick unticks, undo() restores what the tap painted) and says why in one line.
    const guard = async (b, fn, okText, undo) => {
      const tick = b && b.type === 'checkbox';
      const was = tick ? !b.checked : null;
      if (b && !tick) b.disabled = true;
      try {
        await fn();
        void okText; // B-380: no confirmation-only toast; a refused write still says why below
      } catch (e) {
        if (tick) b.checked = was;
        if (undo) undo();
        toast('Couldn’t save: ' + ((e && (e.message || e.code)) || 'error'));
        if (b && !tick) b.disabled = false;
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

