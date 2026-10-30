    // ------------------------------------------------------------ Record
    const IDEA_KIND = { learning: 'Learning', feature: 'Feature', general: 'General' };
    const MATT_KINDS = ['learning', 'general']; // B-531: the Kind menu's choices; feature is E.V.'s own (save_idea)
    // B-302 (C-1, C-7, C-13): Record's log, the first of its views. Everything he logged, newest first and grouped by
    // day, one row each (32 px from 600 px, 44 px on the phone): its one badge (Session, Quiz, Note or Workout), its
    // name, its result and its time, all on the row's line. The type switch (Notes, Sessions, Quizzes, Everything;
    // B-570, D-393: it opens on Notes on every load, the type is never restored) and the
    // filter (course, when, Show workouts) narrow it. The picked row's detail is the right panel from 1200 px and opens
    // under its row below that. The log creates nothing: New in the header makes a note (C-7). Notes carry no course,
    // so a course in the filter leaves them out, as it leaves out workouts. The filter is this device's (store).
    const REC_TYPES = { note: 'Notes', session: 'Sessions', quiz: 'Quizzes', all: 'Everything' };
    const REC_BADGE = {
      session: ['Session', 'x-violet'],
      quiz: ['Quiz', 'x-violet'],
      note: ['Note', 'x-blue'],
      workout: ['Workout', ''],
    };
    const REC_WHEN = { today: 'Today', two: '2 days', all: 'All' };
    const SET_KIND = {
      review: 'Review',
      drill: 'Drill',
      sim: 'Exam practice',
      more: 'Five more',
      job: 'Practice set',
      check: 'Check',
    };
    const recF = (() => {
      let f = {};
      try {
        f = JSON.parse(store.get('rec.filter') || '{}') || {};
      } catch {}
      return {
        type: 'note', // B-570: Record opens on Notes
        course: typeof f.course === 'string' ? f.course : 'any',
        when: REC_WHEN[f.when] ? f.when : 'all',
        workouts: f.workouts !== false,
      };
    })();
    const rec = { sel: null };
    let recDet = null; // the detail card: it moves between the list and the side column, so it is held, never looked up
    const saveRecF = () => store.set('rec.filter', JSON.stringify(recF));
    const ideaName = i => String(i.text || '').split('\n')[0] || 'Note';
    // a quiz is the questions of one set he answered on one day: its newest answer to each, right of asked
    function quizEntries() {
      const by = new Map();
      for (const a of M.attempts.all) {
        const k = a.setId + '|' + a.date;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(a);
      }
      const out = [];
      for (const [k, as] of by) {
        const set = S.sets.find(s => s.id === as[0].setId) || {};
        const last = new Map();
        for (const a of as) last.set(a.itemId, a); // attempts are oldest first
        const right = [...last.values()].filter(a => a.correct).length;
        const exams = new Set([set.exam, ...as.map(a => String(a.objective || '').split('-')[0])].filter(Boolean));
        const courses = [...new Set([...exams].map(x => (S.exams.find(e => e.id === x) || {}).course).filter(Boolean))];
        const at = as[as.length - 1].at;
        out.push({
          kind: 'quiz',
          id: 'quiz-' + k,
          name: set.title || SET_KIND[set.kind] || 'Quiz',
          at,
          date: as[0].date,
          result: right + ' of ' + last.size,
          courses,
          props: [['Set', SET_KIND[set.kind] || 'Practice']],
          answers: [...last.values()],
          detail: '',
        });
      }
      return out;
    }
    function recEntries() {
      // B-406: a session an Undo took back (discarded) is kept in the record but never listed or counted
      const ses = S.sessions
        .filter(s => s.status !== 'discarded')
        .map(s => ({
          kind: 'session',
          id: s.id,
          name:
            (noteOfSession(s) && sessName(s)) || s.topic || (s.kind === 'skill' ? 'Skills practice' : 'Study session'),
          at: s.startedAt || s.date,
          date: s.date || E.chicagoDate(s.startedAt),
          result:
            s.status === 'active' || s.status === 'ending'
              ? 'going now'
              : [
                  // B-406: a session a switch ended shows its minutes before it is filed
                  (s.minutes ?? E.sessionState(s, now()).minutes)
                    ? durFmt(s.minutes ?? E.sessionState(s, now()).minutes)
                    : '',
                  s.questions ? plural(s.questions, 'question') : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
          courses: [sessionCourse(s)].filter(Boolean),
          props: [
            s.cardCount ? ['Cards', String(s.cardCount)] : null,
            s.source === 'E.V. Home' ? ['From', 'E.V.'] : null,
          ],
          detail: s.summary || '',
        }));
      const notes = S.ideas
        .filter(i => i.status !== 'archived')
        .map(i => ({
          kind: 'note',
          id: i.id,
          name: ideaName(i),
          at: i.createdAt,
          date: E.chicagoDate(i.createdAt),
          result: IDEA_KIND[i.kind || 'learning'] || 'Learning',
          courses: i.course ? [i.course] : [], // B-373: the course a note from New carries
          idea: i,
        }));
      const wos = S.workouts.map(w => ({
        kind: 'workout',
        id: w.id,
        name: w.title || w.sequence,
        at: w.startedAt || w.date,
        date: w.date || E.chicagoDate(w.startedAt),
        result: w.status === 'active' ? 'going now' : E.workoutSummary(w, SEQ[w.sequence]),
        courses: [],
        props: [w.energy ? ['Energy', w.energy + ' of 5'] : null],
        detail: w.mood ? '“' + w.mood + '”' : '',
      }));
      return [...ses, ...quizEntries(), ...notes, ...wos]
        .filter(x => x.date)
        .sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)));
    }
    const recPass = x =>
      (recF.course === 'any' || x.courses.includes(recF.course)) &&
      (recF.workouts || x.kind !== 'workout') &&
      (recF.when === 'all' || x.date >= (recF.when === 'today' ? today : E.addDays(today, -1)));
    const recType = (x, t) => t === 'all' || x.kind === t;
    const recTime = x => (String(x.at || '').length > 10 ? clock12(x.at) : '');
    // its parts, built here so the shell stays in its budget: the toolbar (Filter, then the type tabs), the list, and
    // the detail card, the right panel's from 1200 px
    {
      const host = $('record-sessions'),
        bar = el('div', 'toolbar rec-bar'),
        fw = el('div', 'rec-fwrap'),
        fb = DS.button({ cls: 'btn neutral sm rec-fbtn', icon: recIco('M4 6h16M7 12h10M10 18h4') }),
        pop = el('div', 'rec-pop'),
        types = DS.segmented({ label: 'Types' });
      fb.id = 'rec-filter-btn';
      // B-339: the demo's Filter button, its three-line icon and its label (with the count of filters on)
      fb.append(el('span', 'rec-flab', 'Filter'));
      fb.setAttribute('aria-expanded', 'false');
      fb.setAttribute('aria-controls', 'rec-filter');
      pop.id = 'rec-filter';
      pop.hidden = true;
      pop.setAttribute('role', 'group');
      pop.setAttribute('aria-label', 'Filter');
      types.id = 'rec-types';
      fw.append(fb, pop);
      // B-367: the board's Log something, at the toolbar's right on every size; it opens New's note
      const log = DS.button({
        cls: 'btn primary sm rec-log',
        icon: recIco('M12 5v14M5 12h14'),
        label: 'Log something',
        onClick: () => newOpen('note'),
      });
      bar.append(fw, types, el('span', 'sp'), log);
      const cols = el('div', 'cols'),
        main = el('div', 'col-main'),
        side = el('div', 'col-side'),
        list = el('div', 'card rec-list'),
        det = el('div', 'rec-detail');
      list.id = 'rec-list';
      det.id = 'rec-detail';
      recDet = det;
      main.append(list);
      side.append(det);
      cols.append(main, side);
      host.replaceChildren(bar, cols);
      const close = () => {
        pop.hidden = true;
        fb.setAttribute('aria-expanded', 'false');
      };
      fb.addEventListener('click', () => {
        pop.hidden = !pop.hidden;
        fb.setAttribute('aria-expanded', String(!pop.hidden));
        if (!pop.hidden) (renderLog(), pop.querySelector('button')?.focus());
      });
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !pop.hidden) {
          e.preventDefault();
          close();
          fb.focus();
        }
      });
      document.addEventListener('click', e => {
        if (!pop.hidden && !e.composedPath().includes(fw)) close(); // its own parts re-render under the tap
      });
    }
    // B-339's icons, drawn as the demo's (B-513: inside Proprietary's Button)
    function recIco(d) {
      const t = document.createElement('template');
      t.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"></path></svg>';
      return t.content.firstChild;
    }
    // a segmented switch of [value, label] pairs; the picked one is pressed (C-15); B-513: Proprietary's Segmented
    function recSeg(label, pairs, on, pick) {
      const sg = DS.segmented({
        label,
        value: on,
        options: pairs.map(([v, t, n]) => ({ value: v, label: t, count: n })),
        onPick: v => {
          pick(v);
          saveRecF();
          renderLog();
        },
      });
      [...sg.children].forEach((b, i) => (b.dataset.v = pairs[i][0]));
      return sg;
    }
    function renderFilter() {
      const pop = $('rec-filter');
      const lab = t => el('span', 'lbl', t);
      const ck = el('label', 'rec-ck'),
        box = document.createElement('input');
      box.type = 'checkbox';
      box.id = 'rec-workouts';
      box.checked = recF.workouts;
      box.addEventListener('change', () => {
        recF.workouts = box.checked;
        saveRecF();
        renderLog();
      });
      ck.append(box, document.createTextNode('Show workouts'));
      const foot = el('div', 'rec-pop-foot');
      const reset = btn(
        'Reset',
        () => {
          Object.assign(recF, { course: 'any', when: 'all', workouts: true });
          saveRecF();
          renderLog();
        },
        { cls: 'btn ghost sm' }
      );
      const done = btn(
        'Done',
        () => {
          pop.hidden = true;
          $('rec-filter-btn').setAttribute('aria-expanded', 'false');
          $('rec-filter-btn').focus();
        },
        { cls: 'btn neutral sm' }
      );
      foot.append(reset, done);
      // the tap's own control keeps the focus across the re-render
      const ae = document.activeElement,
        fk = pop.contains(ae)
          ? ae.id || (ae.dataset.v ? ae.parentNode.getAttribute('aria-label') + '|' + ae.dataset.v : ae.textContent)
          : null;
      pop.replaceChildren(
        lab('Course'),
        recSeg('Course', [['any', 'Any'], ...E.activeCourses().map(c => [c, c])], recF.course, v => (recF.course = v)),
        lab('When'),
        recSeg('When', Object.entries(REC_WHEN), recF.when, v => (recF.when = v)),
        ck,
        foot
      );
      if (fk)
        [...pop.querySelectorAll('button,input')]
          .find(
            b =>
              (b.id || (b.dataset.v ? b.parentNode.getAttribute('aria-label') + '|' + b.dataset.v : b.textContent)) ===
              fk
          )
          ?.focus();
    }
    function quizTopic(x) {
      const n = new Map();
      for (const a of x.answers || [])
        if (a.objective) n.set(a.objective, (n.get(a.objective) || 0) + (a.correct ? 1 : 100));
      const id = [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
      return id ? S.objectives.find(o => o.id === id) : null;
    }
    function recDetail(x) {
      const d = recDet;
      if (!x) {
        d.replaceChildren(el('p', 'meta', 'Pick an entry to see it.'));
        return d;
      }
      const [word, cls] = REC_BADGE[x.kind];
      const props = el('div', 'rec-props');
      const when =
        (x.date === today ? 'Today' : x.date === E.addDays(today, -1) ? 'Yesterday' : short(x.date)) +
        (recTime(x) ? ', ' + recTime(x) : '');
      for (const p of [
        ['When', when],
        [x.kind === 'note' ? 'Kind' : 'Result', x.result],
        x.courses.length ? ['Course', x.courses.join(', ')] : null,
        ...(x.props || []),
      ].filter(p => p && p[1])) {
        const r = el('div', 'prop');
        r.append(el('span', 'prop-k', p[0]), el('span', 'prop-v', p[1]));
        props.append(r);
      }
      const parts = [
        DS.badge({ text: word, cls }),
        el('h3', 'rec-title', x.kind === 'note' ? ideaName(x.idea) : x.name),
        props,
      ];
      if (x.kind === 'note') {
        const i = x.idea;
        // B-373: a note's words after its title line
        const rest = String(i.text || '')
          .split('\n')
          .slice(1)
          .join('\n')
          .trim();
        if (rest) parts.push(el('p', 'rec-desc', rest));
        const src = [
          i.sourceLabel || i.source,
          (i.links || []).length
            ? plural(new Set(i.links.map(l => (l && l.to) + '|' + (l && l.type))).size, 'link')
            : '',
          i.status === 'promoted' ? 'now a weak spot' : '',
        ]
          .filter(Boolean)
          .join(' · ');
        if (src) parts.push(el('p', 'meta', src));
        // D-109: a kind control on every idea; B-303 (D-290): no idea becomes a weak spot or a plan item
        const acts = el('div', 'idea-acts');
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', 'Kind of note');
        sel.className = 'idea-kind';
        // B-531 (F-50): the menu offers Matt's kinds only; a note E.V. filed as an idea for her (feature) shows that
        // kind, greyed, until he picks one of his
        const cur = i.kind || 'learning';
        for (const [v, t] of Object.entries(IDEA_KIND)) {
          if (!MATT_KINDS.includes(v) && v !== cur) continue;
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          o.selected = cur === v;
          o.disabled = !MATT_KINDS.includes(v);
          sel.append(o);
        }
        sel.addEventListener('change', () =>
          guard(
            sel,
            () => write({ op: 'update', collection: 'ideas', id: i.id, data: { kind: sel.value } }),
            'Kind changed'
          )
        );
        acts.append(sel);
        parts.push(acts);
      } else if (x.detail) parts.push(el('p', 'rec-desc', x.detail));
      // B-339: a quiz offers Quiz me on its topic: the objective it missed most, else the one it asked most; her line
      // says what it missed
      const o = x.kind === 'quiz' && quizTopic(x);
      if (x.kind === 'quiz') {
        const miss = (x.answers || []).filter(a => !a.correct).length;
        parts.push(
          el(
            'p',
            'rec-desc',
            miss
              ? 'Missed ' + miss + (o && o.text ? ', most on “' + o.text.replace(/\.$/, '') + '”.' : '.')
              : 'Every answer right.'
          )
        );
      }
      if (o) {
        const q = btn('Quiz me on it', ev => quizObjective(o, ev.currentTarget), { cls: 'btn neutral rec-quiz' });
        q.setAttribute('aria-label', 'Quiz me on ' + (o.text || o.id));
        q.title = o.text || o.id;
        parts.push(q);
      }
      d.replaceChildren(...parts);
      return d;
    }
    function renderLog() {
      if (!$('rec-list')) return;
      const all = recEntries(),
        shown = all.filter(recPass);
      const nF = (recF.course !== 'any') + (recF.when !== 'all') + !recF.workouts;
      $('rec-filter-btn').querySelector('.rec-flab').textContent = nF ? 'Filter · ' + nF : 'Filter';
      const tf = $('rec-types');
      const tfFocus = tf.contains(document.activeElement) && document.activeElement.dataset.v;
      tf.replaceWith(
        Object.assign(
          recSeg(
            'Types',
            Object.entries(REC_TYPES).map(([k, t]) => [k, t, shown.filter(x => recType(x, k)).length]),
            recF.type,
            v => (recF.type = v)
          ),
          { id: 'rec-types' }
        )
      );
      if (tfFocus) $('rec-types').querySelector(`[data-v="${tfFocus}"]`)?.focus();
      if (!$('rec-filter').hidden) renderFilter();
      const rows = shown.filter(x => recType(x, recF.type));
      if (!rows.some(x => x.id === rec.sel)) rec.sel = PANEL.matches && rows[0] ? rows[0].id : null;
      const selX = rows.find(x => x.id === rec.sel);
      const list = $('rec-list'),
        out = [];
      let day = null;
      for (const x of rows) {
        if (x.date !== day) {
          day = x.date;
          out.push(
            el('div', 'rec-day', day === today ? 'Today' : day === E.addDays(today, -1) ? 'Yesterday' : short(day))
          );
        }
        const [word, cls] = REC_BADGE[x.kind];
        const on = x.id === rec.sel;
        // B-513: the row keeps today's markup (Line's own rules would move it, D-376); data-key names the entry (D-387)
        const li = el('div', 'li rec-li' + (on ? ' sel' : ''));
        li.dataset.key = x.id;
        li.dataset.part = 'row';
        li.dataset.kind = x.kind;
        li.dataset.id = x.id;
        const nm = el('button', 'nm', x.name);
        nm.type = 'button';
        nm.title = x.name;
        nm.setAttribute('aria-expanded', String(on));
        nm.addEventListener('click', () => {
          rec.sel = on && !PANEL.matches ? null : x.id;
          renderLog();
          $('rec-list')
            .querySelector(`.rec-li[data-id="${CSS.escape(x.id)}"] .nm`)
            ?.focus();
        });
        li.append(
          DS.badge({ text: word, cls }),
          nm,
          el('span', 'sp'),
          el('span', 'r', x.result || ''),
          el('span', 't', recTime(x))
        );
        out.push(li);
        if (on && !PANEL.matches) out.push(recDetail(x));
      }
      if (!rows.length)
        out.push(
          el(
            'p',
            'empty',
            all.length
              ? 'Nothing matches this filter.'
              : 'What you log shows up here: study sessions, quizzes, notes and workouts.'
          )
        );
      list.replaceChildren(...out);
      // from 1200 px the right panel; below it the card sits under the picked row, and waits hidden in the side column
      // while no row is picked
      if (PANEL.matches || !selX) {
        const d = recDetail(PANEL.matches ? selX : null);
        $('record-sessions').querySelector('.col-side').append(d);
        d.hidden = !PANEL.matches;
      } else recDet.hidden = false;
    }
    // Opens the log on one entry (Progress's day panel, D-147): every type and the filter cleared, if they hide it.
    function openInRecord(id) {
      showTab('record');
      if (!recEntries().some(x => x.id === id && recPass(x) && recType(x, recF.type))) {
        Object.assign(recF, { type: 'all', course: 'any', when: 'all', workouts: true });
        saveRecF();
      }
      rec.sel = id;
      renderLog();
      $('rec-list')
        .querySelector(`.rec-li[data-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
    // B-359 (D-316): Record is the Record board's log alone; Dates, Journal, Canvas and Library left the page (their
    // data stays in the record; dates are Today's Week).
    function renderRecord() {
      renderLog();
    }
