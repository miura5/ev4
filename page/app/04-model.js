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
    delete window.EVActions; // the two actors are all the page keeps: no other code path names its own caller
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
    // B-197 (Matt, Oct 21: "make it so it collects a potential violation, then some actual judgment is used"): the page's
    // identifier check, two stages. The patterns only nominate values (a field name alone is never one); a verdict kept
    // in idchecks decides a value seen before; the rest go to one quick model call with the words around them and the
    // conversation just before. Practice passes. Real or unsure is held, and he decides with It's made up (kept as his
    // own verdict) or Leave it out. With no model to ask, a candidate is unsure. {ok, text, held, line, release}.
    async function idGate(text, { ref, context = '', strict = true, judge = true } = {}) {
      const cands = E.identifierCandidates(text, { strict }).map(c => ({ ...c, around: E.idContext(text, c) }));
      if (!cands.length) return { ok: true, text, held: [] };
      const kept = E.keptVerdicts(S.idchecks);
      const fresh = cands.filter(c => !kept[c.key]);
      // Unsure until a judgment answers; only an answered judgment is kept, so a later one can still look.
      let judged = fresh.map(c => ({ ...c, verdict: 'unsure', reason: 'no judgment could run here' }));
      let answered = false;
      if (fresh.length && judge && sample && !T.sampleOff)
        try {
          const out = await Promise.race([
            sample.json(E.idJudgmentPrompt(fresh, { context }), { modelTier: 'quick', cache: false }),
            new Promise(ok => setTimeout(() => ok(null), 6000)),
          ]);
          if (out && Array.isArray(out.verdicts)) {
            judged = E.readVerdicts(fresh, out);
            answered = true;
          }
        } catch {}
      const keep = (rows, by) => ({
        checks: rows.map(c => ({
          key: c.key,
          verdict: by === 'matt' ? 'practice' : c.verdict,
          reason:
            by === 'matt'
              ? 'Matt: it’s from a practice scenario'
              : E.holdBack(c.reason, [c.value]).slice(0, 200) || 'no reason given',
          kind: c.why.slice(0, 80),
          ref: String(ref || 'E.V. Home').slice(0, 120),
          by,
        })),
      });
      const ctx = () => ({ now: now(), release: EV_SPEC.release });
      if (answered && ACT) await run(ACT.tap('id-check', keep(judged, 'judgment'), ctx()).writes).catch(() => {});
      const verdict = c => (kept[c.key] ? kept[c.key].verdict : judged.find(j => j.key === c.key).verdict);
      const held = cands.filter(c => verdict(c) !== 'practice');
      if (!held.length) return { ok: true, text, held: [] };
      return {
        ok: false,
        text,
        held,
        line: E.idHeldLine(held.length),
        left: E.holdBack(
          text,
          held.map(c => c.value)
        ),
        // His own answer: kept as <key>-matt, which every later check (here and in the runs) reads before a judged one.
        madeUp: async () => {
          if (ACT) await run(ACT.tap('id-check', keep(held, 'matt'), ctx()).writes);
        },
      };
    }
    /**
     * B-197: the quick form, where no judgment fits the moment (a tool's argument, a session note's new writing, an open
     * answer): the candidates no kept practice verdict has passed. Field names alone are never candidates.
     */
    function idUnpassed(text, { strict = true } = {}) {
      const kept = E.keptVerdicts(S.idchecks);
      return E.identifierCandidates(text, { strict }).filter(c => !(kept[c.key] && kept[c.key].verdict === 'practice'));
    }
    /** A held value's one neutral line and his two choices, in host; go(text) sends what he chose. */
    function idChoice(host, g, go) {
      host.hidden = false;
      host.textContent = '';
      const made = el('button', 'qchip', 'It’s made up');
      const leave = el('button', 'qchip', 'Leave it out');
      made.type = leave.type = 'button';
      made.addEventListener('click', async () => {
        made.disabled = leave.disabled = true;
        await g.madeUp().catch(() => {});
        await go(g.text);
      });
      leave.addEventListener('click', async () => {
        made.disabled = leave.disabled = true;
        await go(g.left);
      });
      const row = el('span', 'guard-row');
      row.append(made, leave);
      host.append(el('span', 'guard-line', g.line), row);
    }
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

