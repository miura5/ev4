    // ------------------------------------------------------------ render
    function renderAll() {
      if (!['weak', 'sets', 'exams'].every(k => loaded.has(k))) return;
      M = model();
      renderToday();
      renderObjectives(); // B-297
      renderReview();
      renderPractice();
      renderPlan();
      renderReadiness();
      renderWeak();
      renderRecord();
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
    function renderSide() {
      const t = $('side-today');
      if (!t) return;
      const open = sideOpen();
      const row = (dot, text, when, go, cls = 'si') => {
        const b = el('button', cls);
        b.type = 'button';
        if (dot != null) b.append(el('span', 'sdot ' + dot));
        b.append(el('span', 't', String(text || '').replace(/\s*\(~?\d+\s*min\)\s*$/i, '')));
        if (when) b.append(el('span', 'st', when));
        b.addEventListener('click', go);
        return b;
      };
      const item = it => {
        const due = it.tag === 'GRADED' ? gradedDue(it) : null;
        const dot = (it.tag !== 'GRADED' && BADGE[it.tag] && BADGE[it.tag][1]) || 'd-q'; // B-361: Graded's dot is grey
        const sel = ui.tab === 'today' && ui.taskSel === it.id && !ui.taskGone;
        return row(
          dot,
          E.rowText(it), // B-392: the row shows its day
          sideWhen(it, due),
          () => {
            showTab('today');
            openTask(it.id);
          },
          sel ? 'si on' : 'si'
        );
      };
      const more = open.length - SIDE_MAX;
      const head = el('p', 'sec');
      head.append(el('span', null, 'Today'), el('span', 'sp'), el('span', 'n-left', open.length + ' left'));
      t.replaceChildren(
        ...(open.length ? [head] : []),
        ...open.slice(0, SIDE_MAX).map(item),
        ...(more > 0 ? [row(null, more + ' more in Today', '', () => showTab('today'), 'si more')] : [])
      );
      t.hidden = !open.length;
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
        document.addEventListener('click', e => {
          if (!pop.hidden && !pop.contains(e.target) && !btnP.contains(e.target)) setOpen(false);
        });
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
      document.documentElement.style.setProperty('--line-h', line ? strip.offsetHeight + 'px' : '0px');
      renderFrame(); // B-405: the bottom strip and the pop-up follow the view
    }
    addEventListener('resize', () => {
      const s = $('evline');
      if (s && !s.hidden) document.documentElement.style.setProperty('--line-h', s.offsetHeight + 'px');
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
      min: 'M6 12h12',
      expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
      shrink: 'M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7',
      close: 'M6 6l12 12M18 6L6 18',
      send: 'M12 19V5M6 11l6-6 6 6',
      stop: 'M7 7h10v10H7z',
    };
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
      b.title = label;
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
      return (b && b.title) || 'this view';
    }
    // the closed mark: queued behind the thread's own lines, on the day it was closed (talk/<day>, made when missing)
    function markClosed(th) {
      const at = now(),
        date = E.chicagoDate(at);
      POP.closed.set(th, at);
      const p = talkQ.then(async () => {
        let exists = T.created.has(date) || S.talk.some(d => d.id === date);
        if (!exists) exists = (await db.collection('talk').doc(date).get()).exists;
        const a = ACT ? ACT.tap('chat-close', { thread: th, date, at, exists }) : { ok: false, refused: 'no actions' };
        if (!a.ok) throw new Error(a.refused);
        await run(ACT.tap('chat-close', { thread: th, date, at, exists }).writes);
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
        if (!q) return;
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
      strip.append(F.slot, el('span', 'sp'), F.chip, F.sug, F.evb, F.histB);

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
      await chat(text, { replyTo: mid, fromMatt: true, thread: th, view: viewName() });
    }
    function popMsgEl(m, last) {
      const sig = JSON.stringify([m.text, !!m.pending, m.error, (m.cards || []).length, last, T.busy]);
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
        const gos = !m.pending ? (m.cards || []).filter(c => c && c.type === 'go' && c.label) : [];
        if (gos.length && last) {
          const r = el('div', 'mch');
          r.append(...gos.map(c => btn(c.label, () => goTo(c), { cls: 'btn neutral sm' })));
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
      const title = threadTitle(msgs);
      // the strip
      F.chip.hidden = !(POP.min && !POP.open);
      F.chipT.textContent = title;
      F.chip.setAttribute('aria-label', 'Open the chat: ' + title);
      const q = POP_ASK[ui.tab] || POP_ASK.ev;
      if (F.sug.textContent !== q) F.sug.textContent = q;
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
      F.sub.textContent = POP.hist ? 'Last 7 days' : 'On ' + (viewName() === 'this task' ? 'Today' : viewName());
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
              el('span', 'pn', threadTitle(t.msgs)),
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
      const chips = [...new Set([POP_ASK[ui.tab] || POP_ASK.ev, POP_ASK.ev])].filter(c => !asked.has(c));
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
      F.ctx.replaceChildren(svgIco(POP_ICON.spark), document.createTextNode('Sees ' + viewName()));
      const sk = T.busy ? 'stop' : 'send';
      if (F.send.dataset.k !== sk) {
        F.send.dataset.k = sk;
        F.send.replaceChildren(svgIco(T.busy ? POP_ICON.stop : POP_ICON.send));
        F.send.setAttribute('aria-label', T.busy ? 'Stop' : 'Send');
      }
    }
    renderFrame();
