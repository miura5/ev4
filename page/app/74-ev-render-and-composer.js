    // ---------------------------------------------------------------- render + composer
    const SEND_ICON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'; // B-340: the demo's arrow
    const STOP_ICON =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor"/></svg>';
    // E.V.'s state, shown by every core that follows it and by the readout: streaming → speaking, Claude working → thinking,
    // a check just posted → check ready, a session break → resting, a right answer → pleased, typing → listening.
    // B-215 (D-216): turning to face him is the notification. A job that finishes, or a new ask in Your turn, while he is on
    // another tab: her small dial turns to face him, closed, with one segment lit at twelve (alert, B-272), and her
    // status reads something's ready, until he opens E.V. What the page found on load is not news.
    const NT = { seen: null, yt: 0, on: false };
    function noticeSync() {
      if (!loaded.has('jobs') || !T.ready) return;
      const fin = (S.jobs || []).filter(j => j.status === 'done' || j.status === 'failed').map(j => j.id);
      const yt = yourTurnCount();
      if (NT.seen === null) {
        NT.seen = new Set(fin);
        NT.yt = yt;
        return;
      }
      const fresh = fin.filter(id => !NT.seen.has(id));
      fresh.forEach(id => NT.seen.add(id));
      const more = yt > NT.yt;
      NT.yt = yt;
      if (ui.tab === 'ev') NT.on = false;
      else if (fresh.length || more) NT.on = true;
    }
    function computeMood() {
      if (NT.on && ui.tab !== 'ev') return 'alert';
      if (T.revealing) return 'speaking';
      if (T.busy) return T.streaming ? 'speaking' : 'thinking';
      if (SS.busy || T.reading) return 'thinking';
      if (Date.now() < (SS.alertUntil || 0)) return 'alert';
      const s = activeSession();
      if (s && s.status === 'active' && E.sessionState(s, now()).onBreak) return 'sleepy';
      if (Date.now() < (T.happyUntil || 0)) return 'happy';
      if (T.typing) return 'listening';
      // B-284: the greeting sets no mood; she rests at Idle.
      return 'idle';
    }
    // B-352 (D-314), B-361: the demo's words under her name: ready when you are at rest, thinking… while she works on a
    // reply (never 'replying', which stayed up while her greeting typed out)
    const MOOD_WORD = {
      idle: 'ready when you are',
      listening: 'ready when you are',
      thinking: 'thinking…',
      speaking: 'thinking…',
      alert: 'check ready',
      happy: 'ready when you are',
      sleepy: 'resting',
    };
    // B-377 (D-316): her status reads on a break whenever the session is on one, as the demo
    function onBreakNow() {
      const s = activeSession();
      return !!s && E.sessionState(s, now()).onBreak;
    }
    function renderMood() {
      noticeSync();
      MOOD_NOW = computeMood();
      CORE.setMood(MOOD_NOW);
      const off = !sample || T.sampleOff;
      const running = liveJobs().length;
      const word =
        off && !T.busy
          ? 'quick asks only'
          : onBreakNow()
            ? 'on a break'
            : NT.on && ui.tab !== 'ev'
              ? 'something’s ready'
              : MOOD_NOW === 'speaking' && !T.busy
                ? 'ready when you are'
                : MOOD_WORD[MOOD_NOW] || 'online';
      // B-221 (D-210): her status word beside her name; the readout code has left the screen.
      const parts = [
        off && !T.busy
          ? word
          : activeSession()
            ? onBreakNow()
              ? 'on a break'
              : 'in a session'
            : NT.on && ui.tab !== 'ev'
              ? word
              : running
                ? 'thinking…'
                : ui.restPlan && MOOD_NOW === 'idle'
                  ? 'waiting on your review'
                  : sysProblem && word === 'ready when you are' // B-381: a System problem, in plain words, at rest
                    ? sysProblem
                    : word,
        STAGING ? 'staging' : '',
      ];
      // B-384: a System problem's short phrase stands alone, so it is never cut by the staging word
      if (sysProblem && parts[0] === sysProblem) parts.pop();
      const txt = parts.filter(Boolean).join(' · ');
      const cls = 'led' + (T.busy || SS.busy ? ' busy' : MOOD_NOW === 'sleepy' ? ' brk' : off ? ' off' : '');
      const ro = $('readout');
      const sys = !!sysProblem && txt.startsWith(sysProblem);
      if (ro.dataset.k !== cls + txt) {
        ro.dataset.k = cls + txt;
        ro.classList.toggle('sys', sys);
        ro.title = sys ? 'Open System' : '';
        ro.replaceChildren(el('span', cls), document.createTextNode(txt));
      }
    }
    // B-340 (D-312): as in the demo, her and her lines sit down by the chips while they leave room: the room left in
    // her lines' scroller goes above her stage, so a short conversation reads from the composer up.
    function dropSync() {
      const box = $('thread'),
        inn = box.firstElementChild,
        p = $('p-ev');
      // B-387: while he reads back (Back to now up) the room above her holds still: her fold and a pull's lift change
      // the scroller's height and content, and re-measuring then moved her lines under him mid-scroll.
      if (!inn || p.hidden || !capNow.hidden) return;
      const kids = [...inn.children].filter(c => !c.classList.contains('cap-pull') && c.getClientRects().length);
      const cur = parseFloat(p.style.getPropertyValue('--ev-drop')) || 0;
      const content = kids.length
        ? kids[kids.length - 1].getBoundingClientRect().bottom - kids[0].getBoundingClientRect().top + 18
        : 0;
      const free = Math.max(0, Math.round(box.clientHeight + cur - content));
      if (Math.abs(free - cur) > 2) p.style.setProperty('--ev-drop', free + 'px');
    }
    setInterval(() => {
      try {
        renderMood();
        dropSync();
      } catch {}
    }, 300);
    // B-85: the chips show under the greeting (her stage idle), or while the input is focused and empty; in a conversation,
    // a session or a skills run they stay out of the way. A tap on a chip holds them until its click lands.
    const CH = { hold: false };
    // B-340 (D-312): as in the demo, the chips stay under her lines at rest, in a conversation and in a session.
    function syncChips() {
      document.body.classList.remove('chips-quiet');
    }
    $('qchips').addEventListener('pointerdown', () => {
      CH.hold = true;
    });
    ['pointerup', 'pointercancel'].forEach(ev =>
      $('qchips').addEventListener(ev, () =>
        setTimeout(() => {
          CH.hold = false;
          syncChips();
        }, 350)
      )
    );
    $('ev-input').addEventListener('focus', () => syncChips());
    $('ev-input').addEventListener('blur', () => setTimeout(syncChips, 200));
    // B-428: the phone's keyboard may leave the window panned when it closes; E.V.'s frame never scrolls, so put it back
    $('ev-input').addEventListener('blur', () =>
      setTimeout(() => {
        if (innerWidth < 600 && document.body.classList.contains('on-ev') && scrollY) window.scrollTo(0, 0);
      }, 250)
    );
    // B-433: in the installed app the frame is the screen's height (styles.css), whatever height iOS gives the viewport
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) {
      const appHeight = () => {
        const tall =
          innerHeight >= innerWidth ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
        document.documentElement.style.setProperty('--app-h', Math.max(innerHeight, tall) + 'px');
      };
      appHeight();
      addEventListener('resize', appHeight);
      // a tab switch can leave the document scrolled where iOS's shortened viewport lets it; E.V.'s frame sits at 0
      new MutationObserver(() => {
        if (document.body.classList.contains('on-ev') && scrollY) window.scrollTo(0, 0);
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      addEventListener('orientationchange', () => setTimeout(appHeight, 300));
    }
    // B-432: with the phone's keyboard up, E.V.'s frame is the visible viewport and the tab bar steps aside (styles.css)
    const vv = window.visualViewport;
    if (vv) {
      const fitKeyboard = () => {
        const a = document.activeElement,
          kb = innerWidth < 600 && innerHeight - vv.height > 120 && !!a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName);
        document.body.classList.toggle('kb', kb);
        document.documentElement.style.setProperty('--vvh', kb ? Math.round(vv.height) + 'px' : '');
        if (kb && document.body.classList.contains('on-ev') && scrollY) window.scrollTo(0, 0);
      };
      vv.addEventListener('resize', fitKeyboard);
      vv.addEventListener('scroll', fitKeyboard);
      document.addEventListener('focusin', () => setTimeout(fitKeyboard, 60));
      document.addEventListener('focusout', () => setTimeout(fitKeyboard, 60));
    }
    // B-85: a placeholder that fits one line in a narrow pane.
    // B-340 (D-312): the demo's placeholder at every width; "note: …" saves a note (B-290).
    const PH_LONG = 'Ask E.V., or “note: …” to log something',
      PH_SHORT = 'Ask E.V., or “note: …”'; // B-432: at 16 px the long line no longer fits the phone's field
    const placeholder = () => (innerWidth < 600 ? PH_SHORT : PH_LONG);
    const fitPlaceholder = () => {
      const i = $('ev-input');
      if (i.placeholder === PH_LONG || i.placeholder === PH_SHORT) i.placeholder = placeholder();
    };
    addEventListener('resize', fitPlaceholder);
    fitPlaceholder();
    function renderEV() {
      if (!T.greet && loaded.has('memory')) newMaterials();
      if (
        !T.greet &&
        ['days', 'dates', 'jobs', 'talk', 'memory', 'state', 'sessions', 'newmats'].every(k => loaded.has(k))
      )
        greetNow();
      // Opening: E.V. greets at full size until the conversation starts (his first message today) or a session runs.
      const opening =
        !activeSession() &&
        !T.expanded &&
        !allMsgs().some(
          m =>
            m.role === 'matt' &&
            (T.greet ? String(m.at) > String(T.greet.at) : (m.day || E.chicagoDate(m.at)) === today)
        ); // B-91: each open starts at her greeting
      document.body.classList.toggle('opening', opening);
      document.body.classList.toggle('core-big', !opening && !activeSession() && !!T.bigCore);
      renderMood();
      const sa = activeSession();
      let chips =
        COMMENT && sa && sa.status === 'active'
          ? ['Quiz me now']
          : ((T.greet && T.greet.chips) || ['What’s due this week?', 'How ready am I?']).filter(
              c => !(c === 'Start a study session' && (sa || notesOn()))
            );
      // B-408 (D-325): from 1024 px, as the Notes demo, a session on a note offers the one way back to it
      if (sa && sa.status === 'active' && notesOn() && noteOfSession(sa)) chips = ['Back to my note'];
      // B-362 (D-316): on a break, the demo's one chip back to work
      if (sa && sa.status === 'active' && E.sessionState(sa, now()).onBreak) chips = ['I’m back early'];
      // B-358 (D-314): at rest, the demo's five chips and only those.
      // B-357: a skills run left going keeps its Resume chip first (the runner waits behind it, B-82)
      const resume = ((T.greet && T.greet.chips) || []).filter(c => /^Resume .+ · \d+ of \d+$/.test(c));
      // B-408 (D-325): from 1024 px a session is in Notes, so the first chip is the Notes demo's Start a note and study
      if (!sa)
        chips = [
          ...resume,
          notesOn() ? 'Start a note and study' : 'Start a study session',
          'What’s due this week?',
          quizChip(),
          'How did this week go?',
          'Plan the rest of today',
        ];
      renderSession();
      renderSkillDock();
      const qc = $('qchips');
      if (qc.dataset.k !== chips.join('|')) {
        qc.dataset.k = chips.join('|');
        const bs = chips.map(c => {
          const b = /^Resume .+ · \d+ of \d+$/.test(c)
            ? btn(c, () => skillPark(false))
            : c === 'I’m back early' // B-377 (D-316): as the demo, her line only
              ? btn(c, () => guard(null, () => breakOrResume('resume')))
              : c === 'Start a note and study' // B-408: as the Notes demo, a new note with its session, no line of his
                ? btn(c, () => {
                    const from = whereNow();
                    showTab('notes');
                    guard(null, () => newNote(from));
                  })
                : c === 'Back to my note'
                  ? btn(c, () => {
                      const s = activeSession();
                      if (s && noteOfSession(s)) guard(null, () => noteSession(noteOfSession(s)));
                    })
                  : btn(c, () => {
                      if (/^attach a file$/i.test(c)) $('ev-file').click(); // B-381: inside his tap, before any await
                      guard(null, () => quick(c));
                    });
          b.className = 'qchip';
          return b;
        });
        // B-360: one row at every size (styles.css scrolls it sideways when it overflows).
        qc.replaceChildren(...bs);
      }
      syncChips();
      renderCheckin();
      const sb = $('ev-send');
      const sk = T.busy ? 'stop' : 'send';
      if (sb.dataset.k !== sk) {
        sb.dataset.k = sk;
        sb.innerHTML = T.busy ? STOP_ICON : SEND_ICON;
        sb.setAttribute('aria-label', T.busy ? 'Stop' : 'Send');
        sb.classList.toggle('primary', !T.busy);
      }
      renderThread();
    }
    const input = $('ev-input');
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    };
    const typing = on => {
      T.typing = on;
      clearTimeout(T.typeT);
      if (on)
        T.typeT = setTimeout(() => {
          T.typing = false;
        }, 1800);
    };
    input.addEventListener('blur', () => typing(false));
    input.addEventListener('input', () => {
      grow();
      syncChips();
      typing(!!input.value.trim());
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
        e.preventDefault();
        $('ev-form').requestSubmit();
      }
    });
    $('ev-form').addEventListener('submit', async e => {
      e.preventDefault();
      if (T.busy) {
        if (T.ctl) T.ctl.abort();
        return;
      }
      const text = input.value.trim();
      if (!text) return;
      // B-381: a phone opens the picker only inside his send, so the click comes before any await.
      if (/^attach a file$/i.test(text)) $('ev-file').click();
      if (!M) {
        toast('Still loading your record.');
        return;
      }
      // B-180: a build ask goes into the project record; B-182: so does a typed reply to a Your turn item.
      if (
        BUILDER_HERE &&
        (BUILD_ASK.test(text) || REPLY_ASK.test(text) || DESIGN_ASK.test(text) || FILE_ASK.test(text))
      ) {
        input.value = '';
        grow();
        typing(false);
        T.bigCore = false;
        try {
          if (REPLY_ASK.test(text)) await replyTyped(text);
          else await buildAsk(text);
        } catch (e) {
          if (!(e && e.refused)) throw e; // B-394: his ask was not saved, so nothing is sent to the builder
        }
        return;
      }
      await sendText(text);
    });
    // B-290 (P-5): "note: …" saves his words as a note in Record's ideas, the same save as New › Note, with no model
    // call; "idea: …" stays a build ask (BUILD_ASK).
    const NOTE_ASK = /^\s*note\s*:\s*(\S[\s\S]*)$/i;
    async function noteSave(text, words) {
      await mattSay(text);
      try {
        await write(
          E.noteIdea(words.replace(/\s+/g, ' ').trim().slice(0, 400), {
            at: now(),
            date: today,
            existing: S.ideas || [],
          })
        );
        await evSay('Saved to Record as a note.', [], { tier: 'local' });
      } catch (e) {
        await evSay('I couldn’t save that note (' + ((e && (e.message || e.code)) || 'error') + ').', [], {
          tier: 'local',
        });
      }
    }
    // B-389, B-395: a line of his the record refused comes back into the box by one rule (E.restoredBox): at the end,
    // after a blank line, or alone when the box is empty. No state is kept, so refusals in a row come back in the order
    // he sent them and his own typing is never changed.
    T.restoreInput = text => {
      if (!text) return false;
      input.value = E.restoredBox(input.value, text);
      grow();
      return true;
    };
    // B-394: a send whose line the record refused stops there (mattSay rejected with e.refused; postMsg already put
    // his words back and said why): no model call, no answer to a line that was never saved.
    async function sendText(text) {
      try {
        await sendTextNow(text);
      } catch (e) {
        if (!(e && e.refused)) throw e;
      }
    }
    async function sendTextNow(text) {
      input.value = '';
      grow();
      typing(false);
      T.bigCore = false;
      const nt = NOTE_ASK.exec(text);
      if (nt) {
        await noteSave(text, nt[1]);
        return;
      }
      // B-357: with the demo's five chips (B-358) a finished job's Open the … is asked in words, as Your turn is
      const jobAsk = T.greet && T.greet.job && /^\s*open the /i.test(text);
      if (LOCAL[key(text)] || YOUR_TURN.test(text) || quizTopicAsk(text) || jobAsk) {
        await quick(text);
        return;
      }
      const pa = E.prepAsk(text, now());
      if (pa) {
        input.placeholder = placeholder();
        await prepAnswer(text, pa);
        return;
      }
      input.placeholder = placeholder();
      const mid = await mattSay(text);
      noteAnswer(mid);
      await chat(text, { replyTo: mid, fromMatt: true }); // B-381: this turn carries his new line
    }

