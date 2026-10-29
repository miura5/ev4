    // ------------------------------------------------------------ connect (the shell checked the owner and subscribes)
    // The shell hands every subscription here as it arrives: a collection's rows in its window, or one document. The page
    // keeps them in S under v3's names; dates are always seen through their edits (D-080) and plans through their ticks.
    let sample = null;
    let mcp = null;
    let toolMax = -1; // -1 = not known yet; 0 = this view runs no page tools
    use('sample').then(sm => {
      sample = sm;
      if (sm && sm.limits)
        sm.limits()
          .then(l => {
            toolMax = (l && l.tools && l.tools.maxCount) || 0;
          })
          .catch(() => {});
      render();
    });
    let mcpKnown = false;
    use('mcp').then(m => {
      mcp = m;
      mcpKnown = true;
      render();
      if (!m) regreet();
    }); // connectors (background jobs, the reader) load on their own; the page works without them

    const S = {
      weak: [],
      sets: [],
      decks: [], // B-487: flashcard decks
      answers: [],
      exams: [],
      examsRaw: null,
      examedits: [],
      predictions: [],
      objectives: [],
      plans: [],
      plansRaw: [],
      planedits: [],
      dates: [],
      datesAll: [],
      datesRaw: [],
      dateedits: [],
      days: [],
      dayedits: [],
      weeks: [],
      state: null,
      health: null,
      runs: [],
      ideas: [],
      notes: [],
      journal: [], // D-335: open to the conversation's lookup
      workouts: [],
      sessions: [],
      announcements: [],
      talk: [],
      jobs: [],
      jobresults: [],
      materialedits: [],
      concepts: [],
      memory: null,
      planSettings: null, // B-450: settings/study-plan, his plan instructions and options
      yourturn: null, // B-182: system/yourturn, what waits on him by place
    };
    const NAME = { weakspots: 'weak', 'talk/memory': 'memory' };
    const loaded = new Set();
    let queued = false;
    const render = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        try {
          renderAll();
        } catch (e) {
          setStatus('Something on this page broke: ' + e.message);
          console.error(e);
        }
      });
    };
    const fail = e => {
      setStatus('Lost the connection to your record (' + ((e && e.code) || 'error') + '). Reload to retry.');
    };
    const docs = s => s.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
    // B-38: system/manifest names the deployed build. A release other than this page's, or page files that change
    // after the page loaded, mean a newer E.V. is out: one quiet bar asks for a reload (nothing reloads on its own).
    let shipped = null;
    function manifestChanged(m) {
      if (!m) return;
      const sig = JSON.stringify(((m.pages || {})[EV_SPEC.target] || {}).files || null);
      if (shipped === null) shipped = sig;
      const stale = (m.release && m.release !== EV_BUILD) || sig !== shipped;
      let bar = document.getElementById('ev-update');
      if (!stale) {
        if (bar) bar.hidden = true;
        return;
      }
      if (!bar) {
        bar = el('div', 'update');
        bar.id = 'ev-update';
        bar.setAttribute('role', 'status');
        const b = el('button', 'btn primary', 'Reload');
        b.type = 'button';
        b.addEventListener('click', () => location.reload());
        bar.append(el('span', null, 'E.V. updated: reload'), b);
        document.body.append(bar);
      }
      bar.hidden = false;
    }
    // B-228 (D-208): a list edit, an added item or an added date paints on its tap. A set write to one of these
    // collections shows at once as if the record had it (paintSet), until the record carries that document at least as
    // new, or the write is refused (unpaint).
    const PAINT = new Set(['dayedits', 'dates', 'dateedits']);
    const painting = new Map(); // `${collection}/${id}` -> data
    const lastRaw = {};
    function withPaintedRows(key, rows) {
      if (!PAINT.has(key)) return rows;
      let out = rows || [];
      for (const [pk, data] of painting) {
        const [c, id] = [pk.slice(0, pk.indexOf('/')), pk.slice(pk.indexOf('/') + 1)];
        if (c !== key) continue;
        const cur = out.find(r => r.id === id);
        // caught up when the record holds the same document (an Edit keeps its first at, so at alone cannot tell)
        if (cur && (same(cur, { id, ...data }) || String(cur.at || '') > String(data.at || ''))) painting.delete(pk);
        else out = [...out.filter(r => r.id !== id), { id, ...data }];
      }
      return out;
    }
    const stable = v =>
      Array.isArray(v)
        ? '[' + v.map(stable).join(',') + ']'
        : v && typeof v === 'object'
          ? '{' +
            Object.keys(v)
              .sort()
              .map(k => JSON.stringify(k) + ':' + stable(v[k]))
              .join(',') +
            '}'
          : JSON.stringify(v);
    const same = (a, b) => stable(a) === stable(b);
    function paintSet(collection, id, data) {
      if (!PAINT.has(collection)) return false;
      painting.set(collection + '/' + id, data);
      if (collection in lastRaw) changed(collection, lastRaw[collection]);
      return true;
    }
    function unpaint(collection, id, data) {
      const pk = collection + '/' + id;
      if (painting.get(pk) !== data) return;
      painting.delete(pk);
      if (collection in lastRaw) changed(collection, lastRaw[collection]);
    }
    function changed(key, value) {
      const k = NAME[key] || key;
      if (PAINT.has(key)) {
        lastRaw[key] = value;
        value = withPaintedRows(key, value);
      }
      if (key === 'system/manifest') {
        S.manifest = value;
        manifestChanged(value);
        return;
      }
      if (key === 'system/yourturn') {
        S.yourturn = value; // B-182 (D-196): rewritten at every ship and every builder trace
        loaded.add('yourturn');
        try {
          regreet();
        } catch {}
        render();
        return;
      }
      if (key === 'settings/study-plan') {
        S.planSettings = value; // B-450 (D-354)
        loaded.add('planSettings');
        render();
        return;
      }
      if (key === 'talk/memory') S.memory = value;
      else if (key === 'state' || key === 'health') S[k] = (value || []).find(x => x.id === 'current') || null;
      else if (key === 'dates') S.datesRaw = value;
      else if (key === 'plans') S.plansRaw = value;
      else if (key === 'exams') S.examsRaw = value || [];
      else S[k] = value || [];
      if (key === 'ideas') S.ideas = (value || []).map(i => ({ ...i, createdAt: i.createdAt || i.at }));
      if (key === 'jobs' || key === 'jobresults') {
        // a job's state lives in jobresults/<id>, written by the worker
        const by = {};
        for (const r of S.jobresults) by[r.id] = r;
        S.jobs = (key === 'jobs' ? (S.jobsRaw = value || []) : S.jobsRaw || []).map(j => {
          const r = by[j.id];
          return {
            ...j,
            createdAt: j.createdAt || j.at,
            status: r ? r.status : 'queued',
            startedAt: r ? r.startedAt : null,
            finishedAt: r ? r.finishedAt || null : null,
            result: r ? { ...(r.result || {}), ...(r.error ? { failed: r.error } : {}) } : null,
          };
        });
        if (key === 'jobresults') loaded.add('jobs');
      }
      if (key === 'dates' || key === 'dateedits') {
        // every reader sees the calendar with its edits; taken-off entries leave every view
        const by = {};
        for (const x of S.dateedits) by[x.id] = x;
        S.datesAll = S.datesRaw.map(d => E.dateView(d, by[d.id]));
        S.dates = S.datesAll.filter(d => !E.isRemovedDate(d));
        loaded.add('dates');
        // B-465: each collection's own first snapshot, so the calendar's exams wait for his date edits too
        loaded.add(key === 'dates' ? 'dates:raw' : 'dateedits');
      }
      if (key === 'plans' || key === 'planedits') {
        S.plans = E.planViews(S.plansRaw, S.planedits);
        loaded.add('plans');
      }
      // D-094: every reader sees an exam with its score and status from examedits and its night-before prediction.
      if (key === 'exams' || key === 'examedits' || key === 'predictions') {
        S.exams = E.examViews(S.examsRaw || [], S.examedits || [], S.predictions || []);
        if (S.examsRaw) loaded.add('exams');
      }
      if (key === 'dates' || key === 'dateedits' || key === 'exams') deriveExams(); // B-465: the calendar's exams
      loaded.add(k);
      render();
    }
    function lost(key, e) {
      fail(e);
    }
    const validate = window.EVValidate ? window.EVValidate.makeValidator(EV_SPEC.schemas || {}) : null;
    const envelope = (source, at) => E.envelope('page', source || 'E.V. Home', at || now());

