    // ------------------------------------------------------------ Record
    const IDEA_KIND = { learning: 'Learning', feature: 'Feature', general: 'General' };
    const promote = i =>
      btn('Make it a weak spot', ev =>
        guard(
          ev.target,
          async () => {
            const at = now();
            const id = E.safeId('ws-idea-' + i.id);
            const facts = {
              ...envelope('Promoted idea', at),
              topic: String(i.text || '').slice(0, 140),
              objective: i.objective || '',
              exam: String(i.objective || '').split('-')[0] || '',
              course: E.defaultCourse(),
              kind: 'concept',
              addedBy: 'page',
              origin: { idea: i.id },
              initial: { streak: 0, nextDue: E.addDays(today, 1), recurrence: 1, misses: 0 },
              events: {},
            };
            await write({ op: 'set', collection: 'weakspots', id, data: facts });
            await write({ op: 'update', collection: 'ideas', id: i.id, data: { status: 'promoted', weakspotId: id } });
          },
          'Now a weak spot'
        )
      );
    // B-302 (C-1, C-7, C-13): Record's log, the first of its views. Everything he logged, newest first and grouped by
    // day, one row each (32 px from 600 px, 44 px on the phone): its one badge (Session, Quiz, Note or Workout), its
    // name, its result and its time, all on the row's line. The type tabs (All, Sessions, Quizzes, Notes) and the
    // filter (course, when, Show workouts) narrow it. The picked row's detail is the right panel from 1200 px and opens
    // under its row below that. The log creates nothing: New in the header makes a note (C-7). Notes carry no course,
    // so a course in the filter leaves them out, as it leaves out workouts. The filter is this device's (store).
    const REC_TYPES = { all: 'All', session: 'Sessions', quiz: 'Quizzes', note: 'Notes' };
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
        type: REC_TYPES[f.type] ? f.type : 'all',
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
          detail: '',
        });
      }
      return out;
    }
    function recEntries() {
      const ses = S.sessions.map(s => ({
        kind: 'session',
        id: s.id,
        name: s.topic || (s.kind === 'skill' ? 'Skills practice' : 'Study session'),
        at: s.startedAt || s.date,
        date: s.date || E.chicagoDate(s.startedAt),
        result:
          s.status === 'active' || s.status === 'ending'
            ? 'going now'
            : [s.minutes ? s.minutes + ' min' : '', s.questions ? plural(s.questions, 'question') : '']
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
          courses: [],
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
        fb = el('button', 'btn neutral sm', 'Filter'),
        pop = el('div', 'rec-pop'),
        types = el('div', 'seg');
      fb.type = 'button';
      fb.id = 'rec-filter-btn';
      fb.setAttribute('aria-expanded', 'false');
      fb.setAttribute('aria-controls', 'rec-filter');
      pop.id = 'rec-filter';
      pop.hidden = true;
      pop.setAttribute('role', 'group');
      pop.setAttribute('aria-label', 'Filter');
      types.id = 'rec-types';
      types.setAttribute('role', 'group');
      types.setAttribute('aria-label', 'Types');
      fw.append(fb, pop);
      bar.append(fw, types);
      const cols = el('div', 'cols'),
        main = el('div', 'col-main'),
        side = el('div', 'col-side'),
        list = el('div', 'card rec-list'),
        det = el('div', 'card rec-detail');
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
    // a segmented switch of [value, label] pairs; the picked one is pressed (C-15)
    function recSeg(label, pairs, on, pick) {
      const sg = el('div', 'seg');
      sg.setAttribute('role', 'group');
      sg.setAttribute('aria-label', label);
      for (const [v, t, n] of pairs) {
        const b = el('button', null, t);
        b.type = 'button';
        b.dataset.v = v;
        b.setAttribute('aria-pressed', String(v === on));
        if (n != null) b.append(el('span', 'n', String(n)));
        b.addEventListener('click', () => {
          pick(v);
          saveRecF();
          renderLog();
        });
        sg.append(b);
      }
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
        el('span', 'badge' + (cls ? ' ' + cls : ''), word),
        el('h3', 'rec-title', x.kind === 'note' ? x.idea.text || '' : x.name),
        props,
      ];
      if (x.kind === 'note') {
        const i = x.idea;
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
        // D-109: a kind control on every idea; only a learning idea can become a weak spot
        const acts = el('div', 'idea-acts');
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', 'Kind of note');
        sel.className = 'idea-kind';
        for (const [v, t] of Object.entries(IDEA_KIND)) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          o.selected = (i.kind || 'learning') === v;
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
        if (i.status !== 'promoted' && (i.kind || 'learning') === 'learning') {
          const p = promote(i);
          p.className = 'btn neutral sm';
          acts.append(p);
        }
        parts.push(acts);
      } else if (x.detail) parts.push(el('p', 'rec-desc', x.detail));
      d.replaceChildren(...parts);
      return d;
    }
    function renderLog() {
      if (!$('rec-list')) return;
      const all = recEntries(),
        shown = all.filter(recPass);
      const nF = (recF.course !== 'any') + (recF.when !== 'all') + !recF.workouts;
      $('rec-filter-btn').textContent = nF ? 'Filter · ' + nF : 'Filter';
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
        const li = el('div', 'li rec-li' + (on ? ' sel' : ''));
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
          el('span', 'badge' + (cls ? ' ' + cls : ''), word),
          nm,
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
      $('seg-record').querySelector('[data-v="sessions"]').click();
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
    function renderRecord() {
      renderLog();
      const up = S.dates
        .filter(d => (d.date || '') >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(b.title));
      $('dates').replaceChildren(
        ...(up.length ? up.map(d => dateRow(d, { edit: true })) : [empty('No upcoming dates. Add one below.')])
      );
      const offUp = S.datesAll
        .filter(d => E.isRemovedDate(d) && (d.date || '') >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      $('dates-off-card').hidden = !offUp.length;
      $('dates-off').replaceChildren(...offUp.map(d => dateRow(d, { edit: true })));
      const js = [...S.journal].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      $('journal').replaceChildren(
        ...(js.length
          ? js.map(j => {
              const li = row({
                title:
                  ({ free: 'Free write', clinical: 'After clinical', weekly: 'Weekly reflection' }[j.kind] || j.kind) +
                  ' · ' +
                  short(j.createdAt),
              });
              const p = el('div', 'stem');
              p.style.fontSize = '.95rem';
              p.textContent = j.text || '';
              li.querySelector('.grow').append(p);
              return li;
            })
          : [empty('No entries yet. Write whenever you like; E.V. suggests one weekly and after each clinical.')])
      );
      renderLibrary();
      const ns = [...S.announcements].sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
      $('news').replaceChildren(
        ...(ns.length
          ? ns.map(n => {
              const li = row({ lead: short(n.postedAt), title: n.title || '', detail: n.course || '' });
              const det = el('details');
              det.append(el('summary', null, 'Read'));
              const p = el('p', 'stem');
              p.style.fontSize = '.92rem';
              p.textContent = n.text || '';
              det.append(p);
              li.querySelector('.grow').append(det);
              return li;
            })
          : [empty('Canvas announcements arrive with the evening sync.')])
      );
    }

