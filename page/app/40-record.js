    // ------------------------------------------------------------ Record
    const IDEA_KIND = { learning: 'Learning', feature: 'Feature', general: 'General' };
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
          answers: [...last.values()],
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
        fb = el('button', 'btn neutral sm rec-fbtn'),
        pop = el('div', 'rec-pop'),
        types = el('div', 'seg');
      fb.type = 'button';
      fb.id = 'rec-filter-btn';
      // B-339: the demo's Filter button, its three-line icon and its label (with the count of filters on)
      fb.innerHTML =
        '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"></path></svg>';
      fb.append(el('span', 'rec-flab', 'Filter'));
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
        // D-109: a kind control on every idea; B-303 (D-290): no idea becomes a weak spot or a plan item
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
    // B-350 (D-312): Dates, Journal, Canvas and Library drawn as the log is: the toolbar strip under the header, rows
    // edge to edge grouped by day (Library: by course) with one badge, and the picked row in the panel with its badge,
    // its title and one property card (under its row below 1200 px). Add date and New entry open their form where the
    // detail sits; it opens on its own while the view is empty.
    const recSub = {
      dates: { sel: null, form: false, show: 'up' },
      journal: { sel: null, form: false },
      news: { sel: null },
      library: { sel: null, course: 'all' },
    };
    const recParts = {};
    const PLUS = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';
    const recDay = d =>
      d === today
        ? 'Today'
        : d === E.addDays(today, -1)
          ? 'Yesterday'
          : d === E.addDays(today, 1)
            ? 'Tomorrow'
            : short(d);
    $('weekly')?.addEventListener(
      'click',
      e => {
        if (/reflection/i.test((e.target.closest('button') || {}).textContent || '')) recSub.journal.form = true;
      },
      true
    );
    function recShell(key) {
      if (recParts[key]) return recParts[key];
      const host = $('record-' + key),
        form = host.querySelector('form'),
        bar = el('div', 'toolbar rec-bar'),
        cols = el('div', 'cols'),
        main = el('div', 'col-main'),
        side = el('div', 'col-side'),
        list = el('div', 'card rec-list'),
        det = el('div', 'rec-detail');
      main.append(list);
      side.append(det);
      cols.append(main, side);
      host.replaceChildren(bar, cols);
      return (recParts[key] = { host, bar, main, list, det, side, form });
    }
    function subSeg(label, pairs, on, pick) {
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
          renderRecord();
        });
        sg.append(b);
      }
      return sg;
    }
    function formBtn(key, label) {
      const st = recSub[key];
      const b = el('button', 'btn primary sm rec-add');
      b.type = 'button';
      b.dataset.v = 'form';
      b.innerHTML = PLUS;
      b.append(document.createTextNode(label));
      b.setAttribute('aria-pressed', String(!!st.form));
      b.addEventListener('click', () => {
        st.form = !st.form;
        if (st.form) st.sel = null;
        renderRecord();
        if (st.form) recParts[key].form.querySelector('input[type=text],textarea')?.focus();
      });
      return b;
    }
    // one detail: badge, title, the property card, her line or the text, and its actions
    function recFill(d, x, none) {
      if (!x) {
        d.replaceChildren(el('p', 'meta', none || 'Pick an entry to see it.'));
        return d;
      }
      const props = el('div', 'rec-props');
      for (const p of x.props.filter(p => p && p[1])) {
        const r = el('div', 'prop');
        r.append(el('span', 'prop-k', p[0]), el('span', 'prop-v', p[1]));
        props.append(r);
      }
      const parts = [el('span', 'badge' + (x.badge[1] ? ' ' + x.badge[1] : ''), x.badge[0]), el('h3', 'rec-title', x.title)];
      if (props.childElementCount) parts.push(props);
      if (x.body) parts.push(el('p', 'rec-desc rec-body', x.body));
      if (x.line) parts.push(el('p', 'rec-desc', x.line));
      const acts = (x.acts || []).filter(Boolean);
      if (acts.length) {
        const a = el('div', 'rec-acts');
        a.append(...acts);
        parts.push(a);
      }
      d.replaceChildren(...parts);
      return d;
    }
    function recPaint(key, cfg) {
      const p = recShell(key),
        st = recSub[key],
        rows = cfg.rows;
      if (p.form && !rows.length) st.form = true;
      const ae = document.activeElement,
        fk = p.bar.contains(ae) ? ae.dataset.v : null;
      p.bar.replaceChildren(...cfg.bar.filter(Boolean));
      if (fk) p.bar.querySelector(`[data-v="${CSS.escape(fk)}"]`)?.focus();
      if (!rows.some(x => x.id === st.sel)) st.sel = PANEL.matches && !st.form && rows[0] ? rows[0].id : null;
      const selX = rows.find(x => x.id === st.sel);
      const out = [];
      let g = null;
      for (const x of rows) {
        if (x.group !== g) out.push(el('div', 'rec-day', (g = x.group)));
        const on = x.id === st.sel;
        const li = el('div', 'li rec-li' + (on ? ' sel' : ''));
        li.dataset.id = x.id;
        const nm = el('button', 'nm', x.name);
        nm.type = 'button';
        nm.title = x.name;
        nm.setAttribute('aria-expanded', String(on));
        nm.addEventListener('click', () => {
          st.sel = on && !PANEL.matches ? null : x.id;
          st.form = false;
          renderRecord();
          p.list.querySelector(`.rec-li[data-id="${CSS.escape(x.id)}"] .nm`)?.focus();
        });
        li.append(
          el('span', 'badge' + (x.badge[1] ? ' ' + x.badge[1] : ''), x.badge[0]),
          nm,
          el('span', 'r', x.r || ''),
          el('span', 't', x.t || '')
        );
        out.push(li);
        if (on && !PANEL.matches) out.push(recFill(p.det, cfg.detail(x)));
      }
      if (!rows.length) out.push(el('p', 'empty', cfg.empty));
      p.list.replaceChildren(...out);
      // the form sits where the detail does: the panel from 1200 px, above the rows below it; it is moved only when
      // its place changes, so a field keeps its focus across a render
      if (p.form) {
        const home = PANEL.matches ? p.side : p.main;
        if (p.form.parentNode !== home) home.prepend(p.form);
        p.form.hidden = !st.form;
      }
      if (PANEL.matches || !selX) {
        recFill(p.det, PANEL.matches && !st.form && selX ? cfg.detail(selX) : null, cfg.none);
        if (p.det.parentNode !== p.side) p.side.append(p.det);
        p.det.hidden = !PANEL.matches || !!st.form || !rows.length;
      } else p.det.hidden = false;
    }
    const DATE_X = { exam: 'x-red', validation: 'x-yellow', clinical: 'x-green', due: 'x-blue' };
    const cap = w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : '');
    function recDates() {
      const st = recSub.dates;
      const up = S.dates
        .filter(d => (d.date || '') >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.title).localeCompare(b.title));
      const off = S.datesAll
        .filter(d => E.isRemovedDate(d) && (d.date || '') >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!off.length) st.show = 'up';
      const by = w => (w === 'Matt' ? 'You' : 'E.V.');
      const list = st.show === 'off' ? off : up;
      recPaint('dates', {
        bar: [
          off.length
            ? subSeg(
                'Dates',
                [
                  ['up', 'Upcoming', up.length],
                  ['off', 'Taken off', off.length],
                ],
                st.show,
                v => (st.show = v)
              )
            : el('span', 'rec-count', plural(up.length, 'upcoming date')),
          el('span', 'sp'),
          formBtn('dates', 'Add date'),
        ],
        rows: list.map(d => ({
          id: d.id,
          group: recDay(d.date),
          badge: [cap(d.kind) || 'Date', DATE_X[d.kind] || ''],
          name: d.title || '',
          r: [d.graded ? 'graded' : '', d.course && d.course !== E.defaultCourse() ? d.course : '']
            .filter(Boolean)
            .join(' · '),
          d,
        })),
        empty: st.show === 'off' ? 'Nothing taken off.' : 'No upcoming dates. Add one with Add date.',
        none: 'Pick a date to see it.',
        detail: ({ d }) => ({
          badge: [cap(d.kind) || 'Date', DATE_X[d.kind] || ''],
          title: d.title || '',
          props: [
            ['When', recDay(d.date) === short(d.date) ? short(d.date) : recDay(d.date) + ', ' + short(d.date)],
            ['Kind', cap(d.kind)],
            ['Course', d.course || ''],
            ['Graded', d.graded ? 'Yes' : ''],
            ['Added by', d.addedBy ? by(d.addedBy) : ''],
            E.isRemovedDate(d) ? ['Taken off by', by(d.removed.by)] : null,
          ],
          body: d.notes || '',
          line: E.isRemovedDate(d)
            ? 'Off your calendar and out of E.V.’s plans. Bring it back any time.'
            : '',
          acts: [dateEditButton(d, 'Remove', 'btn neutral sm')],
        }),
      });
    }
    const J_KIND = {
      free: ['Free write', 'Free', ''],
      clinical: ['After clinical', 'Clinical', 'x-green'],
      weekly: ['Weekly reflection', 'Weekly', 'x-violet'],
    };
    function recJournal() {
      const js = [...S.journal].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      recPaint('journal', {
        bar: [el('span', 'rec-count', js.length === 1 ? '1 entry' : js.length + ' entries'), el('span', 'sp'), formBtn('journal', 'New entry')],
        rows: js.map((j, i) => {
          const k = J_KIND[j.kind] || [cap(j.kind), cap(j.kind), ''];
          return {
            id: j.id || 'j' + i,
            group: recDay(E.chicagoDate(j.createdAt)),
            badge: [k[1], k[2]],
            name: String(j.text || '').split('\n')[0],
            r: '',
            t: recTime({ at: j.createdAt }),
            j,
            k,
          };
        }),
        empty: 'No entries yet. Write whenever you like; E.V. suggests one weekly and after each clinical.',
        detail: ({ j, k }) => ({
          badge: [k[1], k[2]],
          title: k[0],
          props: [
            ['When', recDay(E.chicagoDate(j.createdAt)) + (recTime({ at: j.createdAt }) ? ', ' + recTime({ at: j.createdAt }) : '')],
            ['Words', String(String(j.text || '').split(/\s+/).filter(Boolean).length)],
          ],
          body: j.text || '',
        }),
      });
    }
    function recNews() {
      const ns = [...S.announcements].sort((a, b) => String(b.postedAt || '').localeCompare(String(a.postedAt || '')));
      recPaint('news', {
        bar: [el('span', 'rec-count', plural(ns.length, 'Canvas announcement'))],
        rows: ns.map((n, i) => ({
          id: n.id || 'n' + i,
          group: recDay(E.chicagoDate(n.postedAt) || String(n.postedAt || '').slice(0, 10)),
          badge: [n.course || 'Canvas', ''],
          name: n.title || '',
          t: recTime({ at: n.postedAt }),
          n,
        })),
        empty: 'Canvas announcements arrive with the evening sync.',
        none: 'Pick an announcement to read it.',
        detail: ({ n }) => ({
          badge: [n.course || 'Canvas', ''],
          title: n.title || '',
          props: [
            ['Posted', short(n.postedAt) + (recTime({ at: n.postedAt }) ? ', ' + recTime({ at: n.postedAt }) : '')],
            ['Course', n.course || ''],
            ['From', 'Canvas'],
          ],
          body: n.text || '',
        }),
      });
    }
    const LIB_X = { lab: 'x-green', upload: 'x-violet', clinical: 'x-green', slides: 'x-blue' };
    function recLibrary() {
      const st = recSub.library;
      if (!LIB.mats) {
        if (ui.record === 'library' && !LIB.loading && !st.err)
          library()
            .catch(e => (st.err = (e && (e.code || e.message)) || 'error'))
            .then(() => render());
        recPaint('library', {
          bar: [el('span', 'rec-count', '')],
          rows: [],
          empty: st.err
            ? 'Couldn’t load the library: ' + st.err
            : LIB.loading
              ? 'Loading your library…'
              : 'Opening your library…',
          detail: () => null,
        });
        return;
      }
      const cat = E.libraryCatalog(LIB.mats);
      const order = E.courses();
      const courses = [...order, ...new Set(cat.map(x => x.course).filter(x => !order.includes(x)))].filter(c =>
        cat.some(x => x.course === c)
      );
      if (st.course !== 'all' && !courses.includes(st.course)) st.course = 'all';
      const rows = [];
      for (const c of courses)
        if (st.course === 'all' || st.course === c)
          for (const x of cat.filter(x => x.course === c)) {
            const m = matById(x.id) || x;
            const kw = MAT_KIND[x.kind] || x.kind || 'file';
            rows.push({
              id: x.id,
              group: c,
              badge: [cap(kw === 'your upload' ? 'upload' : kw), LIB_X[x.kind] || ''],
              name: x.title.replace(/\.(pdf|docx|pptx)$/i, ''),
              r: m.pages ? unitWord(m, m.pages) : '',
              t: m.source === 'upload' ? 'yours' : '',
              m,
              x,
              kw,
            });
          }
      recPaint('library', {
        bar: [
          courses.length > 1
            ? subSeg(
                'Courses',
                [['all', 'All', cat.length], ...courses.map(c => [c, c, cat.filter(x => x.course === c).length])],
                st.course,
                v => (st.course = v)
              )
            : el('span', 'rec-count', plural(cat.length, 'file')),
        ],
        rows,
        empty: 'Nothing yet. The evening run brings your Canvas files; attach your own in the conversation.',
        none: 'Pick a file to see it.',
        detail: ({ m, x, kw }) => ({
          badge: [cap(kw === 'your upload' ? 'upload' : kw), LIB_X[x.kind] || ''],
          title: x.title.replace(/\.(pdf|docx|pptx)$/i, ''),
          props: [
            ['Course', E.normCourse(m.course) || x.course],
            ['Kind', cap(kw)],
            ['Length', m.pages ? unitWord(m, m.pages) : ''],
            ['From', m.source === 'upload' ? 'You' : m.source === 'Canvas' ? 'Canvas' : m.source || ''],
            m.needsOcr && !m.ocr ? ['Read', 'Image-only, not read yet'] : m.ocr ? ['Read', 'From its images'] : null,
          ],
          line: 'E.V. searches this file when you ask, and names the page she used.',
          acts: [
            m.source === 'upload'
              ? btn('Remove', ev => guard(ev.target, () => removeUpload(m), 'Removed from your library'), {
                  cls: 'btn neutral sm',
                })
              : null,
          ],
        }),
      });
    }
    function renderRecord() {
      renderLog();
      recDates();
      recJournal();
      recNews();
      recLibrary();
    }
