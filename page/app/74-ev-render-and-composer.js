    // ---------------------------------------------------------------- render + composer
    const SEND_ICON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
    const STOP_ICON =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor"/></svg>';
    const PLAY_ICON =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
    // E.V.'s state, shown by every core that follows it and by the readout: streaming → speaking, Claude working → thinking,
    // a check just posted → check ready, a session break → resting, a right answer → pleased, typing → listening.
    // B-215 (D-216): turning to face him is the notification. A job that finishes, or a new ask in Your turn, while he is on
    // another tab: her small dial turns to face him, closed, with the segments at twelve lit (alert, B-272), and her
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
      return (T.greet && T.greet.mood) || 'idle';
    }
    const MOOD_WORD = {
      idle: 'online',
      listening: 'listening',
      thinking: 'thinking',
      speaking: 'replying',
      alert: 'check ready',
      happy: 'online',
      sleepy: 'resting',
    };
    function renderMood() {
      noticeSync();
      MOOD_NOW = computeMood();
      CORE.setMood(MOOD_NOW);
      const off = !sample || T.sampleOff;
      const running = liveJobs().length;
      const word =
        off && !T.busy
          ? 'quick asks only'
          : MOOD_NOW === 'sleepy' && activeSession()
            ? 'on a break'
            : NT.on && ui.tab !== 'ev'
              ? 'something’s ready'
              : MOOD_WORD[MOOD_NOW] || 'online';
      // B-221 (D-210): her status word beside her name; the readout code has left the screen.
      const txt = [
        off && !T.busy
          ? word
          : activeSession()
            ? MOOD_NOW === 'sleepy'
              ? 'on a break'
              : 'in a session'
            : NT.on && ui.tab !== 'ev'
              ? word
              : running
                ? 'working'
                : word,
        STAGING ? 'staging' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const cls = 'led' + (T.busy || SS.busy ? ' busy' : MOOD_NOW === 'sleepy' ? ' brk' : off ? ' off' : '');
      const ro = $('readout');
      if (ro.dataset.k !== cls + txt) {
        ro.dataset.k = cls + txt;
        ro.replaceChildren(el('span', cls), document.createTextNode(txt));
      }
    }
    setInterval(() => {
      try {
        renderMood();
      } catch {}
    }, 300);
    // B-85: the chips show under the greeting (her stage idle), or while the input is focused and empty; in a conversation,
    // a session or a skills run they stay out of the way. A tap on a chip holds them until its click lands.
    const CH = { hold: false };
    function syncChips() {
      const inp = $('ev-input');
      const want =
        CH.hold ||
        stageState() === 'idle' ||
        (T.briefOpen && !allMsgs().some(m => m.role === 'matt' && m.at > T.greet.at)) ||
        $('qchips').dataset.k === 'Quiz me now' ||
        /(^|\|)Resume .+ · \d+ of \d+(\||$)/.test($('qchips').dataset.k || '') ||
        (document.activeElement === inp && !inp.value.trim());
      document.body.classList.toggle('chips-quiet', !want);
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
    // B-85: a placeholder that fits one line in a narrow pane.
    const PH_LONG = 'Ask E.V., or tell it something to log',
      PH_SHORT = 'Ask E.V. or log something';
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
      const chips =
        COMMENT && sa && sa.status === 'active'
          ? ['Quiz me now']
          : ((T.greet && T.greet.chips) || ['What’s due this week?', 'How ready am I?']).filter(
              c => !(c === 'Start a study session' && sa)
            );
      renderBar();
      renderSkillDock();
      const qc = $('qchips');
      if (qc.dataset.k !== chips.join('|')) {
        qc.dataset.k = chips.join('|');
        qc.replaceChildren(
          ...chips.map(c => {
            const b = /^Resume .+ · \d+ of \d+$/.test(c)
              ? btn(c, () => skillPark(false))
              : btn(c, () => guard(null, () => quick(c)));
            b.className = 'qchip';
            if (c === 'Start a study session') {
              b.classList.add('go');
              b.insertAdjacentHTML('afterbegin', PLAY_ICON);
            }
            return b;
          })
        );
      }
      syncChips();
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
    const guardEl = $('ev-guard');
    let guardFor = null;
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
      // B-197: nothing is said while he types; a field name alone is never a candidate, and a value is looked at on send.
      if (!guardEl.hidden && guardFor !== input.value) {
        guardEl.hidden = true;
        guardEl.textContent = '';
      }
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
      if (!M) {
        toast('Still loading your record.');
        return;
      }
      // B-180: a build ask goes into the project record, so a value that could be an identifier holds it every time,
      // practice or not (B-197: a field name alone passes). B-182: so does a typed reply to a Your turn item.
      if (
        BUILDER_HERE &&
        (BUILD_ASK.test(text) || REPLY_ASK.test(text) || DESIGN_ASK.test(text) || FILE_ASK.test(text))
      ) {
        guardFor = null;
        const w = E.identifierCandidates(text, { strict: true });
        if (w.length) {
          guardEl.hidden = false;
          guardEl.textContent = `That looks like it ${w[0].why}. A build ask goes into the project record, so take that detail out first.`;
          return;
        }
        guardEl.hidden = true;
        input.value = '';
        grow();
        typing(false);
        T.bigCore = false;
        if (REPLY_ASK.test(text)) await replyTyped(text);
        else await buildAsk(text);
        return;
      }
      // B-197: a value that might be an identifier is looked at with the words around it; practice goes straight on.
      let g = { ok: true };
      if (E.identifierCandidates(text, { strict: true }).length) {
        guardFor = text;
        guardEl.hidden = false;
        guardEl.textContent = 'Checking one detail first…';
        g = await idGate(text, { ref: 'talk/' + today, context: recentLines(8) });
        if (input.value.trim() !== text) return; // he changed it meanwhile: his new words are checked on their own send
      }
      if (!g.ok) {
        heldChoice(g);
        return;
      }
      guardFor = null;
      guardEl.hidden = true;
      await sendText(text);
    });
    /** The last n lines of this conversation, as "Matt:" and "E.V.:", for the identifier judgment's context. */
    function recentLines(n) {
      return allMsgs()
        .filter(m => !m.pending && m.text)
        .slice(-n)
        .map(m => (m.role === 'matt' ? 'Matt: ' : 'E.V.: ') + String(m.text).replace(/\s+/g, ' ').slice(0, 300))
        .join('\n');
    }
    function heldChoice(g) {
      idChoice(guardEl, g, t => {
        guardFor = null;
        guardEl.hidden = true;
        return sendText(t);
      });
    }
    async function sendText(text) {
      input.value = '';
      grow();
      typing(false);
      T.bigCore = false;
      if (LOCAL[key(text)] || YOUR_TURN.test(text)) {
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
      await chat(text, { replyTo: mid });
    }

