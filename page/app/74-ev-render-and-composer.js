    // ---------------------------------------------------------------- render + composer
    const SEND_ICON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
    const STOP_ICON =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor"/></svg>';
    const PLAY_ICON =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
    // E.V.'s state, shown by every core that follows it and by the readout: streaming → speaking, Claude working → thinking,
    // a check just posted → check ready, a session break → resting, a right answer → pleased, typing → listening.
    function computeMood() {
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
      MOOD_NOW = computeMood();
      CORE.setMood(MOOD_NOW);
      const off = !sample || T.sampleOff;
      const running = liveJobs().length;
      const word =
        off && !T.busy
          ? 'quick asks only'
          : MOOD_NOW === 'sleepy' && activeSession()
            ? 'on a break'
            : MOOD_WORD[MOOD_NOW] || 'online';
      const txt = [
        P.unit || 'EV-04',
        word,
        running ? plural(running, 'job') + ' running' : '',
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
      const w = E.scanIdentifiers(input.value);
      guardEl.hidden = !w.length;
      guardEl.textContent = w.length
        ? `This ${w[0]}. Leave real patient details out.${guardFor === input.value || BUILD_ASK.test(input.value) ? '' : ' Send again to send it anyway.'}`
        : '';
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
      const w = E.scanIdentifiers(text);
      // B-180: a build ask goes into the project record, so an identifier holds it every time, never sent anyway.
      if (BUILD_ASK.test(text)) {
        guardFor = null;
        if (w.length) {
          guardEl.hidden = false;
          guardEl.textContent = `This ${w[0]}. A build ask goes into the project record, so take real patient details out first.`;
          return;
        }
        guardEl.hidden = true;
        input.value = '';
        grow();
        typing(false);
        T.bigCore = false;
        await buildAsk(text);
        return;
      }
      if (w.length && guardFor !== text) {
        guardFor = text;
        guardEl.hidden = false;
        guardEl.textContent = `This ${w[0]}. Leave real patient details out. Send again to send it anyway.`;
        return;
      }
      guardFor = null;
      guardEl.hidden = true;
      input.value = '';
      grow();
      typing(false);
      T.bigCore = false;
      if (LOCAL[key(text)]) {
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
    });

