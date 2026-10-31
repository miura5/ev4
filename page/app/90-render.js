    // ------------------------------------------------------------ render
    function renderAll() {
      if (!['weak', 'sets', 'exams'].every(k => loaded.has(k))) return;
      M = model();
      renderToday();
      renderObjectives(); // B-297
      renderReview();
      renderPractice();
      renderReadiness();
      renderWeak();
      renderRecord();
      renderNotes(); // B-402: Notes (25-notes)
      renderSystem();
      renderEV();
      renderSide();
      renderStudySide(); // B-223 (D-245)
      renderLine(); // B-333
      // B-341 (D-312): at rest the header says nothing (Live stays hidden). B-381: a System problem (sysProblem) shows in
      // plain words as one quiet line that opens #system on a tap; the sidebar's status line says it too (renderMood).
      if (sysProblem) setStatus(sysProblem, false, true);
      else setStatus('Live', true, false);
      status.classList.toggle('sys', !!sysProblem);
      status.title = sysProblem ? 'Open System' : '';
    }
    // B-381: the status lines open System while they name a problem
    for (const s of [status, $('readout')])
      s.addEventListener('click', () => {
        if (s.classList.contains('sys')) showTab('system');
      });
    // B-221 (D-210), B-286, B-334 (D-312): the sidebar's Today as in the demo, on every view: "Today" and "n left", then
    // today's first five items not done, each with a dot coloured by its type and its minutes or day, then "n more in
    // Today"; absent while empty (D-151). A row opens its task in Today. No Working section (D-291).
    const SIDE_MAX = 5;
    function sideOpen() {
      const { items, isDone } = dayState();
      return items.filter(it => it.tag !== 'EXAM' && !isDone(it) && !it.deferred); // as Today's list shows them (B-117)
    }
    const sideShown = () => sideOpen().slice(0, SIDE_MAX); // B-290: what the sidebar shows, for Coming up to leave out
    function sideWhen(it, due) {
      if (it.minutes) return it.minutes + 'm';
      if (!due) return '';
      if (due === today) return 'Today';
      return new Date(due + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
    }
    // B-561: the Dock icon carries the count still open today, where the browser offers a badge; none at zero
    let badgeN = -1;
    function dockBadge(n) {
      if (n === badgeN) return;
      badgeN = n;
      try {
        if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n).catch(() => {});
        else if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
      } catch (e) {
        /* a browser without badges, or one that refuses: nothing to show */
      }
    }
    function renderSide() {
      const t = $('side-today');
      if (!t) return;
      const open = sideOpen();
      dockBadge(open.length);
      const row = (dot, text, when, go, cls = 'si') => {
        const b = el('button', cls);
        b.type = 'button';
        if (dot != null) b.append(el('span', 'sdot ' + dot));
        b.append(el('span', 't', String(text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '')));
        if (when) b.append(el('span', 'st', when));
        b.addEventListener('click', go);
        return b;
      };
      // B-407: her proposed weak spots show on the day's review row, as the demo's "Review: 3 weak spots · 1 to review";
      // with no review row today, one row of their own that opens Weak spots, so they stay in sight
      let nR = 0;
      try {
        nR = E.toReview(M.models, today).filter(w => (w.kind || 'concept') === 'concept').length;
      } catch {
        nR = 0; // the sidebar can draw before the model is first built
      }
      const revRow = open.find(it => it.tag === 'REVIEW');
      const toWeak = () => {
        showTab('study');
        setStudy('weak');
        render();
      };
      const item = it => {
        const due = it.tag === 'GRADED' ? gradedDue(it) : null;
        const dot =
          'k-' + (DS.kind(BADGE[it.tag] ? BADGE[it.tag][0] : catOf(it) === 'study' ? 'Study' : 'Class') || 'class'); // B-540
        const sel = ui.tab === 'today' && ui.taskSel === it.id && !ui.taskGone;
        const b = row(
          dot,
          E.rowText(it), // B-392: the row shows its day
          sideWhen(it, due),
          () => {
            showTab('today');
            openTask(it.id);
          },
          sel ? 'si on' : 'si'
        );
        if (it === revRow && nR) {
          // B-407: "· 1 to review" on its own line under the row's words, so neither is cut off in the 236 px sidebar
          b.classList.add('si-rev');
          b.querySelector('.t').append(el('span', 'tr', nR + ' to review'));
        }
        return b;
      };
      const more = open.length - SIDE_MAX;
      const head = el('p', 'sec');
      head.append(el('span', null, 'Today'), el('span', 'sp'), el('span', 'n-left', open.length + ' left'));
      const own = nR && !(revRow && open.indexOf(revRow) < SIDE_MAX);
      t.replaceChildren(
        ...(open.length || own ? [head] : []),
        ...open.slice(0, SIDE_MAX).map(item),
        ...(own ? [row('k-review', 'Weak spots · ' + nR + ' to review', '', toWeak)] : []),
        ...(more > 0 ? [row(null, more + ' more in Today', '', () => showTab('today'), 'si more')] : [])
      );
      t.hidden = !open.length && !own;
    }
    // B-334 (D-312): Preferences opens its popover (Theme, Contrast, System); Esc, a click outside or System closes it,
    // and Esc returns focus to the button.
    {
      const btnP = $('side-prefs-btn'),
        pop = $('side-prefpop');
      if (btnP && pop) {
        const setOpen = (on, focus) => {
          pop.hidden = !on;
          btnP.setAttribute('aria-expanded', String(on));
          if (!on && focus) btnP.focus();
        };
        btnP.addEventListener('click', () => {
          const on = pop.hidden;
          setOpen(on);
          if (on) (pop.querySelector('[aria-pressed="true"]') || pop.querySelector('button')).focus();
        });
        pop.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false, true);
          }
        });
        btnP.addEventListener('keydown', e => {
          if (e.key === 'Escape' && !pop.hidden) {
            e.preventDefault();
            setOpen(false, true);
          }
        });
        outsideTap(
          document,
          t => !pop.contains(t) && !btnP.contains(t),
          () => !pop.hidden && setOpen(false)
        );
        const sys = $('tab-system');
        if (sys) sys.addEventListener('click', () => setOpen(false));
      }
    }
    // B-333 (D-312): her one-line insight under the header, as in the demo: one sentence built from the record and at
    // most one action, on Today (list and week) and Study; absent when there is nothing to say, and never on Progress,
    // Record, System or her own view. A sticky strip spanning the window; from 1200 px the right panel starts under it.
    const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const numWord = n => NUM[n] || String(n);
    function lineFor(t) {
      // B-409: a session just ended, as the demo's band (no Undo: see noteEnded)
      const ended = SS.ended && Date.now() < SS.ended.until ? SS.ended : null;
      if (ended && t === 'notes')
        return {
          text: `Ended the session on “${ended.name}”: ${ended.mins ? plural(ended.mins, 'minute') : 'under a minute'}, logged to Record.`,
        };
      if (t === 'today') {
        if (ui.todayView === 'week') {
          // B-392: the same seven days and items as the banner, the pane and her answer
          return E.gradedWeek(S.dates, S.exams, today, WEEK_DAYS).length ? { text: gradedLine() } : null;
        }
        if (ui.taskSel && !ui.taskGone) return taskLine(); // B-373: an opened task's line is its own (10-today)
        if (ui.restPlan) return null; // the proposal speaks for itself
        const { items, isDone, budget } = dayState();
        const bv = budgetView(budget, items, isDone);
        if (!bv || !bv.left) return null;
        return {
          text: bv.over
            ? `${bv.left} minutes are on the list, ${bv.over} over the ${bv.free} you have left. Plan the rest suggests what to take off; nothing moves without you.`
            : `${bv.left} of your ${bv.available} minutes are on the list. Plan the rest suggests what to add or take off; nothing moves without you.`,
        };
      }
      if (t === 'study') return studyLine(); // B-365: Study's line is its own (20-study)
      return null;
    }
    function renderLine() {
      let strip = $('evline');
      if (!strip) {
        strip = el('div', 'evline');
        strip.id = 'evline';
        strip.setAttribute('role', 'status');
        strip.hidden = true;
        // B-551: the whole ✦ line is her button: a tap off its own button runs that button, or opens E.V. (the
        // floating chat on the desk, her sheet on the phone)
        strip.addEventListener('click', ev => {
          if (ev.target.closest('button')) return;
          const own = strip.querySelector('button');
          if (own) return own.click();
          const b = typeof F !== 'undefined' && F && F.evb;
          if (b && b.offsetParent) b.click();
          else showTab('ev');
        });
        $('mh').after(strip);
      }
      let line = null;
      try {
        line = M ? lineFor(ui.tab) : null;
      } catch (e) {
        if (!(e instanceof ReferenceError || e instanceof TypeError)) throw e; // a record still loading says nothing
        // B-390: once the record has loaded (M is set), a slip here is a fault: logged, and the strip stays blank. Before
        // that, M itself may not be declared yet (the first showTab), so reading it is guarded too.
        let up = false;
        try {
          up = !!M;
        } catch (_) {
          up = false;
        }
        if (up) console.error('renderLine:', e);
        line = null;
      }
      const key = line ? line.text + '|' + (line.act ? line.act[0] : '') : '';
      if (strip.dataset.k !== key) {
        strip.dataset.k = key;
        const ico = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        ico.setAttribute('viewBox', '0 0 24 24');
        ico.setAttribute('aria-hidden', 'true');
        ico.setAttribute('class', 'el-ico');
        ico.innerHTML = '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/>';
        strip.replaceChildren(
          ...(line
            ? [
                ico,
                el('span', 'el-t', line.text),
                ...(line.act ? [btn(line.act[0], ev => line.act[1](ev.currentTarget), { cls: 'btn neutral sm' })] : []),
              ]
            : [])
        );
      }
      strip.hidden = !line;
      document.body.classList.toggle('has-line', !!line);
      document.documentElement.style.setProperty('--status-h', line ? strip.offsetHeight + 'px' : '0px');
      renderFrame(); // B-405: the bottom strip and the pop-up follow the view
    }
    addEventListener('resize', () => {
      const s = $('evline');
      if (s && !s.hidden) document.documentElement.style.setProperty('--status-h', s.offsetHeight + 'px');
    });

    // ------------------------------------------------------------ B-405 (D-327): the L-frame on desktop
    // From 1024 px, as the AppNotes board: the raised page ends above a slim strip on the ground that holds the
    // session-controls slot (B-406 fills it), a minimized chat's chip, her suggestion for the view, the E.V. button and
    // the chats history. The button opens a chat that floats over the page, bottom right (Matt's fixed choice: the page
    // never shrinks or reflows). Each chat is a talk thread (th-...): its lines carry `thread`, chat() answers it, and
    // closing one writes talk/<day>.closed (a page mark; nothing is deleted), so it stays in history across reloads.
    // On Conversation the button focuses that view's own composer. Below 1024 px none of it shows (styles.css).
    const POP = {
      open: false,
      min: false,
      hist: false,
      big: false,
      th: null,
      els: new Map(),
      sig: '',
      closed: new Map(),
    };
    const POP_KEY = 'ev.pop';
    const TH_RE = /^th-[A-Za-z0-9-]{1,80}$/;
    const DESK = window.matchMedia ? window.matchMedia('(min-width:1024px)') : { matches: true };
    // What she offers on each view (the board's prompts); on Conversation it is asked in the Conversation itself.
    const POP_ASK = {
      ev: 'What’s due this week?',
      today: 'What should I do first today?',
      study: 'Which objectives aren’t solid yet?',
      progress: 'How did this week go?',
      record: 'What did I study yesterday?',
      notes: 'Which note should I review next?',
    };
    const POP_ICON = {
      spark: 'M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z',
      hist: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4M12 8v4l3 2',
      bubble: 'M4 5h16v11H9l-5 4z',
      note: 'M6 4h9l3 3v13H6zM9 10h6M9 14h6',
      min: 'M6 12h12',
      expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
      shrink: 'M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7',
      close: 'M6 6l12 12M18 6L6 18',
      send: 'M12 19V5M6 11l6-6 6 6',
      stop: 'M7 7h10v10H7z',
    };
    // B-409: with a note open in Notes, the pop-up and the strip speak of that note, as the demo's
    const NOTE_ASKS = ['Quiz me on this note', 'What else links to this note?'];
    const NOTE_QUIZ = NOTE_ASKS[0]; // B-438: questions on the note can be asked for again at any time
    function openNoteId() {
      try {
        return ui.tab === 'notes' && NOTE.view === 'editor' && NOTE.open ? NOTE.open : null;
      } catch (e) {
        return null; // the Notes part not declared yet
      }
    }
    // what she is told the side chat sees: the open note by its id, which her notes lookup reads
    function noteView(id) {
      const doc = (S.notes || []).find(n => n.id === id);
      return `Notes, with his note “${(doc && noteName(doc)) || 'Untitled'}” open (notes id ${id})`;
    }
    // his last session on this note today, once filed: {id, mins}
    function lastStudied(id) {
      let best = null;
      for (const s of S.sessions || [])
        if (noteOfSession(s) === id && s.filedAt && s.status !== 'discarded' && E.chicagoDate(s.filedAt) === today)
          if (!best || String(s.filedAt) > String(best.filedAt)) best = s;
      return best ? { id: best.id, mins: Math.max(0, Math.round(Number(best.minutes) || 0)) } : null;
    }
    // the strip's suggestion with a note open: {text, run} or {text, plain}; null for the view's own ask. B-438: with a
    // session on another note or task, it still opens a chat on this note
    function noteSug(id) {
      const s = activeSession();
      if (s && noteOfSession(s) === id) {
        const ask = () => {
          if (isTimed(s)) POP.th = sThread(s);
          popShow({ hist: false });
        };
        // on a break the strip keeps the demo's line; the E.V. button beside it still opens the chat
        if (s.status === 'active' && E.sessionState(s, now()).onBreak)
          return { text: 'On a break. Resume when you’re back.', plain: true };
        return { text: 'Ask E.V. about this note', run: ask };
      }
      if (s)
        return {
          text: 'Ask E.V. about this note',
          run: () => {
            POP.th = noteThread(id); // this note's own chat, not the running session's
            popShow({ hist: false });
          },
        };
      const done = lastStudied(id);
      if (done)
        return {
          text: `Studied ${done.mins ? done.mins + ' min' : 'under a minute'} on this note · open in Record`,
          run: () => goTo({ type: 'go', to: 'record', id: done.id }),
        };
      return { text: 'Study this note with E.V.', run: () => guard(null, () => noteSession(id)) };
    }
    const svgIco = (d, cls = 'ico') => {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 24 24');
      s.setAttribute('aria-hidden', 'true');
      s.setAttribute('class', cls);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d);
      s.append(p);
      return s;
    };
    const iconBtn = (d, label, fn, cls = 'btn ghost icon sm') => {
      const b = el('button', cls);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.append(svgIco(d));
      b.addEventListener('click', fn);
      return b;
    };
    function popSave() {
      try {
        localStorage.setItem(POP_KEY, JSON.stringify({ th: POP.th, min: POP.open || POP.min }));
      } catch (e) {
        /* per-device convenience only */
      }
    }
    try {
      const v = JSON.parse(localStorage.getItem(POP_KEY) || 'null');
      if (v && typeof v.th === 'string' && TH_RE.test(v.th)) POP.th = v.th;
      if (v && v.min) POP.min = true; // a chat left open comes back as its chip, never over the page on load
    } catch (e) {
      /* none kept */
    }
    const newThread = () => 'th-' + msgId('x').replace(/^m-/, '').replace(/-x$/, '');
    // talk/<day>.closed across the loaded days, with the closes this page has just painted
    function closedMap() {
      const m = new Map();
      for (const d of S.talk || [])
        for (const [th, at] of Object.entries((d && d.closed) || {})) if (!m.has(th) || at > m.get(th)) m.set(th, at);
      for (const [th, at] of POP.closed) if (!m.has(th) || at > m.get(th)) m.set(th, at);
      return m;
    }
    const threadMsgs = th => (th ? everyMsg().filter(m => m.thread === th) : []);
    function threadTitle(msgs) {
      const first = msgs.find(m => m.role === 'matt' && m.text) || msgs.find(m => m.text);
      return first ? String(first.text).replace(/\s+/g, ' ').trim().slice(0, 120) : 'New chat';
    }
    function threads() {
      const by = new Map();
      for (const m of everyMsg()) if (m.thread) (by.get(m.thread) || by.set(m.thread, []).get(m.thread)).push(m);
      const closed = closedMap();
      return [...by.entries()]
        .map(([th, msgs]) => ({ th, msgs, last: msgs[msgs.length - 1].id, closed: closed.get(th) || null }))
        .sort((a, b) => b.last.localeCompare(a.last));
    }
    const dayWord = day => (day === today ? 'Today' : day === E.addDays(today, -1) ? 'Yesterday' : short(day));
    function viewName() {
      if (ui.tab === 'today' && ui.taskSel && !ui.taskGone) return 'this task';
      const b = $('tab-' + ui.tab);
      return tabName(b) || 'this view';
    }
    // the closed mark: queued behind the thread's own lines, on the day it was closed (talk/<day>, made when missing)
    function markClosed(th) {
      const at = now(),
        date = E.chicagoDate(at);
      POP.closed.set(th, at);
      const p = talkQ.then(async () => {
        // B-409: an update first, the day made only when the store has none, so a day made meanwhile is never replaced
        if (!ACT) throw new Error('no actions');
        await ACT.closeChat({
          send: async exists => {
            const a = ACT.tap('chat-close', { thread: th, date, at, exists });
            if (!a.ok) throw new Error(a.refused);
            await run(ACT.tap('chat-close', { thread: th, date, at, exists }).writes);
          },
          exists: async () => (await db.collection('talk').doc(date).get()).exists,
        });
        T.created.add(date);
      });
      talkQ = p.then(
        () => {},
        e => {
          POP.closed.delete(th); // the chat stays open in history; nothing of it is lost
          render();
          toast('Couldn’t close that chat: ' + ((e && (e.message || e.code)) || 'error'));
        }
      );
      return p;
    }
    const F = {}; // the frame's parts, made once
    function frameBuild() {
      if (F.strip) return;
      const strip = (F.strip = el('div', 'estrip'));
      strip.id = 'evstrip';
      strip.setAttribute('role', 'region');
      strip.setAttribute('aria-label', 'E.V.');
      F.slot = el('div', 'ss');
      F.slot.id = 'ev-sslot'; // B-406: the session controls go here
      F.chip = el('button', 'btn neutral sm pchip');
      F.chip.type = 'button';
      F.chip.id = 'ev-pchip';
      F.chipT = el('span', 'pc');
      F.chip.append(svgIco(POP_ICON.bubble), F.chipT);
      F.chip.addEventListener('click', () => popShow({ hist: false }));
      F.sug = el('button', 'sug');
      F.sug.type = 'button';
      F.sug.id = 'ev-sug';
      F.sug.addEventListener('click', () => {
        const q = F.sug.textContent;
        if (!q || F.sug.disabled) return;
        if (F.sugRun) {
          F.sugRun();
          return;
        }
        if (ui.tab === 'ev') {
          sendText(q);
          return;
        }
        popShow({ hist: false });
        popSend(q);
      });
      F.evb = el('button', 'btn ghost sm evb');
      F.evb.type = 'button';
      F.evb.id = 'ev-btn';
      F.evb.setAttribute('aria-controls', 'evchat');
      F.evb.append(svgIco(POP_ICON.spark), document.createTextNode('E.V.'));
      F.evb.addEventListener('click', evButton);
      F.histB = iconBtn(POP_ICON.hist, 'Chats with E.V.', () =>
        POP.open && POP.hist ? popShow({ hist: false }) : popShow({ hist: true })
      );
      F.histB.id = 'ev-histbtn';
      // D-361: the quiet line while his writing in this note goes uncounted, beside the strip's own control
      F.unc = el('span', 'sug plain', 'Writing time isn’t being counted right now');
      F.unc.id = 'ev-uncounted';
      F.unc.setAttribute('role', 'status');
      F.unc.hidden = true;
      strip.append(F.slot, el('span', 'sp'), F.chip, F.unc, F.sug, F.evb, F.histB);

      const pop = (F.pop = el('section', 'chatp'));
      pop.id = 'evchat';
      pop.setAttribute('role', 'dialog');
      pop.hidden = true;
      const head = el('div', 'cph'),
        tt = el('div', 'tt');
      F.title = el('b');
      F.sub = el('span');
      tt.append(F.title, F.sub);
      F.bigB = iconBtn(POP_ICON.expand, 'Make bigger', () => {
        POP.big = !POP.big;
        renderFrame();
      });
      head.append(
        tt,
        iconBtn(POP_ICON.min, 'Minimize to the bar', popMin),
        F.bigB,
        iconBtn(POP_ICON.close, 'Close', () => popClose(true))
      );
      F.hist = el('div', 'hlist');
      F.hist.setAttribute('role', 'menu');
      F.hist.setAttribute('aria-label', 'Chats');
      F.msgs = el('div', 'msgs');
      F.msgs.setAttribute('aria-live', 'polite');
      F.chips = el('div', 'pchips');
      const form = (F.form = el('form', 'cin2'));
      form.autocomplete = 'off';
      F.input = el('textarea');
      F.input.id = 'evc-input';
      F.input.rows = 1;
      F.input.placeholder = 'Ask E.V.';
      F.input.setAttribute('aria-label', 'Message E.V.');
      const crow = el('div', 'crow');
      F.ctx = el('span', 'ctx');
      F.ctx.title = 'What E.V. can see in this chat';
      F.send = el('button', 'send');
      F.send.type = 'submit';
      crow.append(F.ctx, el('span', 'sp'), F.send);
      form.append(F.input, crow);
      F.input.addEventListener('input', popGrow);
      F.input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          form.requestSubmit();
        }
      });
      form.addEventListener('submit', e => {
        e.preventDefault();
        if (T.busy) {
          if (T.ctl) T.ctl.abort();
          return;
        }
        popSend(F.input.value);
      });
      pop.append(head, F.hist, F.msgs, F.chips, form);
      document.body.append(strip, pop);
      // Escape closes the pop-up from anywhere, unless a dialog or a menu above it takes Escape first
      window.addEventListener(
        'keydown',
        e => {
          if (e.key !== 'Escape' || !POP.open || !DESK.matches || e.defaultPrevented) return;
          if (document.querySelector('dialog[open]')) return;
          const pref = $('side-prefpop'),
            menu = $('new-menu');
          if ((pref && !pref.hidden) || (menu && !menu.hidden)) return;
          // B-409: a menu or popover of the view (Notes' style and course menus, its link box, Record's filter) takes
          // Escape first; the chat stays open
          // a popover counts as open by its state, not by its box: its fade-out keeps it drawn for a moment after it closes
          const shown = x =>
            (x.popover ? x.matches(':popover-open') : !x.hidden && x.getClientRects().length > 0) && !F.pop.contains(x);
          if ([...document.querySelectorAll('.menu, .n-lkp, #rec-filter')].some(shown)) return;
          e.preventDefault();
          e.stopPropagation();
          popClose(true);
        },
        true
      );
    }
    function popGrow() {
      F.input.style.height = 'auto';
      F.input.style.height = Math.min(F.input.scrollHeight, 140) + 'px';
    }
    const popRestore = text => {
      F.input.value = E.restoredBox(F.input.value, text);
      popGrow();
      return true;
    };
    function popShow({ hist }) {
      POP.open = true;
      POP.min = false;
      POP.hist = !!hist;
      popSave();
      renderFrame();
      setTimeout(() => {
        const first = POP.hist ? F.hist.querySelector('button') : F.input;
        if (first) first.focus();
      }, 0);
    }
    function popMin() {
      POP.open = false;
      POP.hist = false;
      POP.min = true;
      popSave();
      renderFrame();
      F.chip.focus();
    }
    // Close keeps the chat: a thread with lines is marked closed and listed in history; the next open is a new chat.
    function popClose(focusBtn) {
      const th = POP.th;
      POP.open = false;
      POP.min = false;
      POP.hist = false;
      POP.big = false;
      if (th && threadMsgs(th).some(m => !m.pending)) {
        POP.th = null;
        markClosed(th).catch(() => {});
      } else if (th && !threadMsgs(th).length) POP.th = null;
      popSave();
      renderFrame();
      if (focusBtn && F.evb && DESK.matches) F.evb.focus();
    }
    function evButton() {
      if (ui.tab === 'ev') {
        // on Conversation the button writes in the view's own thread; an open chat waits as its chip
        if (POP.open) {
          POP.open = false;
          POP.hist = false;
          POP.min = !!POP.th;
          popSave();
          renderFrame();
        }
        $('ev-input').focus();
        return;
      }
      if (POP.open && !POP.hist) {
        POP.open = false;
        popSave();
        renderFrame();
        return;
      }
      popShow({ hist: false });
    }
    // B-442: Ask E.V. on words selected in a note: the chat opens with them quoted in its box, for his question after
    function popQuote(quote) {
      const q = String(quote || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
      if (!q) return;
      popShow({ hist: false });
      F.input.value = E.restoredBox(F.input.value, '“' + q + '” ');
      popGrow();
      setTimeout(() => {
        F.input.focus();
        F.input.setSelectionRange(F.input.value.length, F.input.value.length);
      }, 0);
    }
    async function popSend(raw) {
      const text = String(raw || '').trim();
      if (!text || T.busy) return;
      if (!M) {
        toast('Still loading your record.');
        return;
      }
      // a chat reopened from history goes on in its own thread (closing it again marks it again)
      if (!POP.th) POP.th = newThread();
      const th = POP.th;
      popSave();
      F.input.value = '';
      popGrow();
      let mid;
      try {
        mid = await mattSay(text, { thread: th, restoreTo: popRestore });
      } catch (e) {
        if (e && e.refused) return; // his words are back in the pop-up's box
        throw e;
      }
      noteAnswer(mid, th); // B-406: in a Notes session's chat, his line answers its open check
      const nid = openNoteId();
      // B-623: Quiz me on this note is answered in code: the card here, or five started now and posted in this chat
      if (nid && text === NOTE_QUIZ) {
        const s = activeSession();
        // a running session on this note: its own check (it posts in the session's chat); else the course's quiz
        const r =
          s && s.status === 'active' && noteOfSession(s) === nid ? await quizNow() : quizInChat('', { thread: th });
        if (r) await evSay(r[0], r[1] || [], { replyTo: mid, thread: th });
        return;
      }
      await chat(text, {
        replyTo: mid,
        fromMatt: true,
        thread: th,
        view: nid ? noteView(nid) : viewName(),
        ...(nid ? { note: nid } : {}), // B-442: the open note goes with the ask, once whole, then as changes
      });
    }
    function popMsgEl(m, last) {
      // B-623: a quiz (set) card is answered in place here too, as a check is
      const checks = (m.cards || []).filter(c => c && ['check', 'set'].includes(c.type) && CARDS[c.type]);
      const sig = JSON.stringify([
        m.text,
        !!m.pending,
        m.error,
        (m.cards || []).length,
        checks.map(c => {
          const s = sessOf(c.session);
          return s ? s.status + Object.keys(s.events || {}).length : '';
        }),
        last,
        T.busy,
        T.retry.has(m.id),
      ]);
      const rec = POP.els.get(m.id);
      if (rec && rec.sig === sig) return rec.el;
      let node;
      if (m.role === 'matt') {
        node = el('div', 'myou');
        node.append(el('b', null, 'You'), el('span', null, m.text));
      } else {
        node = el('div', 'mev' + (m.error ? ' err' : ''));
        if (m.pending && !m.text) {
          const d = el('span', 'dots');
          d.setAttribute('aria-label', 'E.V. is thinking');
          d.append(el('i'), el('i'), el('i'));
          node.append(d);
        } else node.append(fmt(m.text));
        // B-406: a Notes session's check, as the Conversation shows it, in the session's own chat
        for (const c of !m.pending ? checks : []) {
          const box = el('div', 'card ev-card');
          try {
            CARDS[c.type](box, c, m.id + '#' + (c.n || c.id));
          } catch (e) {
            box.replaceChildren(el('p', 'empty', 'This check couldn’t load.'));
          }
          node.append(box);
        }
        const gos = !m.pending ? (m.cards || []).filter(c => c && c.type === 'go' && c.label) : [];
        if (gos.length && last) {
          const r = el('div', 'mch');
          r.append(...gos.map(c => btn(c.label, () => goTo(c), { cls: 'btn neutral sm' })));
          node.append(r);
        }
        // B-405 review: a pop-up reply that failed on a transient error keeps a Try again, answered in its own thread
        const ask = last && !m.pending && !T.busy ? T.retry.get(m.id) : null;
        if (ask) {
          const r = el('div', 'mch');
          r.append(
            btn(
              'Try again',
              () => {
                T.retry.delete(m.id);
                chat(ask.text, {
                  tier: ask.tier,
                  replyTo: ask.replyTo,
                  thread: ask.thread,
                  view: ask.view || viewName(),
                  ...(ask.note ? { note: ask.note } : {}),
                });
              },
              { cls: 'btn neutral sm' }
            )
          );
          node.append(r);
        }
        if (m.pending && T.ctl) node.append(btn('Stop', () => T.ctl && T.ctl.abort(), { cls: 'btn ghost sm' }));
      }
      node.dataset.id = m.id;
      POP.els.set(m.id, { sig, el: node });
      return node;
    }
    function renderFrame() {
      try {
        frameBuild();
      } catch (e) {
        if (e instanceof ReferenceError) return; // the first showTab runs before the page's parts are declared
        throw e;
      }
      const onConv = ui.tab === 'ev';
      const th = POP.th;
      const msgs = threadMsgs(th);
      const ss = sessThreadInfo(th); // B-406: a Notes session's chat is named for it, as the demo's
      const title = ss ? ss.title : threadTitle(msgs);
      // the strip
      F.chip.hidden = !(POP.min && !POP.open);
      F.chipT.textContent = ss ? ss.chip : title;
      F.chip.setAttribute('aria-label', 'Open the chat: ' + (ss ? ss.chip : title));
      const nid = openNoteId();
      const ns = nid ? noteSug(nid) : null;
      F.unc.hidden = !(nid && !activeSession() && uncountedOn(nid));
      const q = ns ? ns.text : POP_ASK[ui.tab] || POP_ASK.ev;
      if (F.sug.textContent !== q) F.sug.textContent = q;
      F.sugRun = ns && ns.run ? ns.run : null;
      F.sug.disabled = !!(ns && ns.plain); // on a break it is her line, not a button
      F.sug.classList.toggle('plain', !!(ns && ns.plain));
      F.evb.classList.toggle('on', POP.open);
      F.evb.setAttribute('aria-expanded', String(POP.open));
      F.evb.setAttribute('aria-label', onConv ? 'E.V.: write in the conversation' : 'E.V.');
      F.histB.setAttribute('aria-expanded', String(POP.open && POP.hist));
      // the pop-up
      F.pop.hidden = !POP.open;
      F.pop.classList.toggle('wide', POP.big);
      F.bigB.setAttribute('aria-label', POP.big ? 'Make smaller' : 'Make bigger');
      F.bigB.title = POP.big ? 'Make smaller' : 'Make bigger';
      F.bigB.firstChild.firstChild.setAttribute('d', POP.big ? POP_ICON.shrink : POP_ICON.expand);
      F.pop.setAttribute('aria-label', POP.hist ? 'Chats with E.V.' : title);
      document.body.classList.toggle('pop-on', POP.open);
      if (!POP.open) return;
      F.title.textContent = POP.hist ? 'Chats' : title;
      F.sub.textContent = POP.hist
        ? 'Last 7 days'
        : ss
          ? ss.sub
          : 'On ' + (viewName() === 'this task' ? 'Today' : viewName());
      F.hist.hidden = !POP.hist;
      F.msgs.hidden = F.chips.hidden = F.form.hidden = POP.hist;
      if (POP.hist) {
        const list = threads();
        const k = JSON.stringify(list.map(t => [t.th, t.last, t.closed, t.th === POP.th]));
        if (F.hist.dataset.k !== k) {
          F.hist.dataset.k = k;
          const rows = list.map(t => {
            const b = el('button', 'mi pki');
            b.type = 'button';
            b.setAttribute('role', 'menuitem');
            b.dataset.thread = t.th;
            const pt = el('span', 'pt');
            const day = E.chicagoDate(t.msgs[t.msgs.length - 1].at);
            pt.append(
              el('span', 'pn', (sessThreadInfo(t.th) || {}).chip || threadTitle(t.msgs)),
              el('span', 'pm', dayWord(day) + ' · ' + (t.closed && t.th !== POP.th ? 'closed' : 'open'))
            );
            b.append(pt);
            b.addEventListener('click', () => {
              POP.th = t.th;
              popShow({ hist: false });
            });
            return b;
          });
          F.hist.replaceChildren(
            el('div', 'mhd', 'Chats with E.V.'),
            ...(rows.length ? rows : [el('div', 'mini hnone', 'No chats yet.')])
          );
        }
        return;
      }
      const lastEv = [...msgs].reverse().find(m => m.role !== 'matt');
      const kids = msgs.map(m => popMsgEl(m, m === lastEv));
      const sig = msgs.map(m => m.id + (m.pending ? 'p' : '') + (m.text || '').length).join('|');
      if (F.msgs.dataset.k !== sig || F.msgs.childElementCount !== kids.length) {
        F.msgs.dataset.k = sig;
        F.msgs.replaceChildren(...kids);
        F.msgs.scrollTop = F.msgs.scrollHeight;
      } else kids.forEach((k, i) => F.msgs.children[i] !== k && F.msgs.children[i].replaceWith(k));
      const asked = new Set(msgs.filter(m => m.role === 'matt').map(m => m.text));
      const chips = (nid ? NOTE_ASKS : [...new Set([POP_ASK[ui.tab] || POP_ASK.ev, POP_ASK.ev])]).filter(
        c => !asked.has(c) || c === NOTE_QUIZ
      );
      if (F.chips.dataset.k !== chips.join('|')) {
        F.chips.dataset.k = chips.join('|');
        F.chips.replaceChildren(
          ...chips.map(c => {
            const b = el('button', 'qchip', c);
            b.type = 'button';
            b.addEventListener('click', () => popSend(c));
            return b;
          })
        );
      }
      F.chips.hidden = !chips.length || T.busy;
      F.ctx.replaceChildren(
        svgIco(nid ? POP_ICON.note : POP_ICON.spark),
        document.createTextNode(nid ? 'Sees this note' : 'Sees ' + viewName())
      );
      const ph = nid ? 'Ask E.V. about this note' : 'Ask E.V.';
      if (F.input.placeholder !== ph) F.input.placeholder = ph;
      const sk = T.busy ? 'stop' : 'send';
      if (F.send.dataset.k !== sk) {
        F.send.dataset.k = sk;
        F.send.replaceChildren(svgIco(T.busy ? POP_ICON.stop : POP_ICON.send));
        F.send.setAttribute('aria-label', T.busy ? 'Stop' : 'Send');
      }
    }
    renderFrame();
